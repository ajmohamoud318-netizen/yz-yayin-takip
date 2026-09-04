/**
 * Bespoke admin CRUD for the Project domain.
 *
 * These operations don't go through `runProjectCommand` because they have
 * no prior-state FSM to delegate to (creation, bulk import, partial
 * field patches, catalog delist) — they're write-the-row, not mutate-
 * the-state-machine. They live together here so the orchestrator +
 * transition entries in `project-service.js` and `transitions.js` can
 * stay focused on state changes.
 *
 * Reads and the two thin state-changing CRUD paths (`deleteProjectSoft`,
 * `restoreProjectSoft`) stay in `project-service.js` — this file is the
 * admin surface only.
 */

import { withTx, getPool } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../domain/errors.js'
import { ORDERABLE_STAGES, STAGE_LABELS } from '../../domain/stages.js'
import { subtaskProgress } from '../../domain/progress.js'
import { inferComponentKind } from '../product-info-capture.js'
import {
  normaliseProjectTitle,
  isTitleConflictError,
  titleConflictMessage,
} from '../../domain/project-title.js'
import {
  insertProject,
  findProjectByTitle,
  getProjectForUpdate,
  patchProject,
  setProjectCatalogHidden,
  logHistory,
} from '../project-repository.js'
import { notifyProjectCreated, notifyProductCatalogChanged } from '../notifications.js'

/**
 * Raise the 409 for a title that is already taken by `existing`.
 * One place so the create, rename and import paths word it identically.
 */
function rejectTitleClash(existing) {
  conflict(titleConflictMessage(existing.title, STAGE_LABELS[existing.stage]))
}

/**
 * Translate the unique-title index's violation into that same 409.
 *
 * Reached only when the in-transaction check above and a concurrent
 * writer's insert interleave — two leaders adding the same book at the
 * same moment. Without this the race surfaces as a raw PG error and the
 * leader gets "Beklenmeyen sunucu hatası" for an ordinary duplicate.
 */
const rethrowTitleConflict = (title) => (err) => {
  if (isTitleConflictError(err)) conflict(titleConflictMessage(title))
  throw err
}

/**
 * POST /api/projects — create a new project + its subtasks.
 *
 * The bulk of the body parsing (subtaskAssignees lookup, kind='pages' page
 * seeding, progress recompute) stays here, NOT in the route, because the
 * create flow is a single business operation — there's no entity method to
 * delegate to. `Order` did exactly the same: order creation has its own
 * service entry point because there's no prior state to mutate.
 */
export async function createProject(actor, body) {
  const {
    title, type, target_month, subtasks = [], pass_kind,
    assigned_to, assignees = [], subtaskAssignees = {},
    productInfo = null,
  } = body
  const primaryAssignee = assigned_to ?? (Array.isArray(assignees) && assignees[0]) ?? null

  return withTx(async (client) => {
    // Titles are the team's only handle on a project (domain/project-title.js),
    // and a reprint reuses this row rather than opening a second one — so a
    // title that already exists is a double entry, and we stop here rather
    // than letting two identical rows into every list and picker.
    const clash = await findProjectByTitle(client, title)
    if (clash) rejectTitleClash(clash)
    const project = await insertProject(client, {
      title, type, target_month, pass_kind, assigned_to: primaryAssignee,
      created_by: actor.id,
    })
    const subRows = []
    for (const [index, s] of subtasks.entries()) {
      // Look up the per-subtask override by either the SPA's library key
      // (e.g. "kapak") or — for custom ad-hoc subtasks — by the title the
      // team leader just typed. Falls back to the project primary so the
      // assignment is never silently empty.
      const subAssignee =
        subtaskAssignees?.[s.title] ??
        subtaskAssignees?.[s.key] ??
        primaryAssignee
      // `position` stamps the order the leader chose at creation time
      // (migration 027) rather than leaving it to created_at ties.
      const { rows } = await client.query(
        `INSERT INTO subtasks (project_id, title, kind, total_pages, total_stickers, assigned_to, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [project.id, s.title, s.kind ?? 'check', s.total_pages ?? null, s.total_stickers ?? null, subAssignee, index],
      )
      subRows.push(rows[0])
      if (rows[0].kind === 'pages' && Number(rows[0].total_pages) > 0 && subAssignee) {
        // migration 067 — pre-create the subtask_designer_counts row so the
        // designer's "I did X / Y" input shows up ready on first paint
        // instead of an empty field that only materialises on first save.
        // The trigger recomputes subtasks.pages_done / is_done on the
        // INSERT — both are zero, so the recompute is a no-op-and-redundant
        // UPDATE that we eat on purpose to keep this call site trivial.
        // ON CONFLICT keeps the create idempotent if a future flow re-seeds
        // the same subtask (e.g. the legacy import path lands here twice).
        await client.query(
          `INSERT INTO subtask_designer_counts (subtask_id, designer_id, pages_done)
           VALUES ($1, $2, 0)
           ON CONFLICT (subtask_id, designer_id) DO NOTHING`,
          [rows[0].id, subAssignee],
        )
      }
    }
    const progress = subtaskProgress(subRows)
    // SQL-level OCC guard: the freshly-inserted project's version is 0
    // (default in migration 002), so the WHERE clause matches the row
    // we just created. Passing the post-insert version keeps the contract
    // uniform with every other patchProject call site.
    const updated = await patchProject(
      client,
      project.id,
      { progress },
      { expectedVersion: project.version },
    )
    // Seed product_info alongside the project when the leader opted into
    // the Kutu / Kılavuz library subtasks. NewProjectDialog derives the
    // matching component shells from the subtask selection and ships them
    // in `productInfo` so the project lands with its parça spec already
    // attached — no separate PUT /product-info round-trip needed, and
    // the upsert commits inside the same transaction so a half-seeded
    // project can't enter the catalog. The backfill on GET (server/src/
    // routes/product-info.js#withKind) makes sure any component the SPA
    // forgot to tag still gets a `kind` on read.
    if (Array.isArray(productInfo) && productInfo.length > 0) {
      const stamped = productInfo.map((c) => ({
        kind: inferComponentKind(c?.component),
        ...c,
      }))
      await client.query(
        `INSERT INTO product_info (project_id, components, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, NOW())`,
        [project.id, JSON.stringify(stamped), actor.id],
      )
    }
    await logHistory(
      client,
      {
        project_id: project.id,
        from_stage: null,
        to_stage: 'tasarim',
        action: 'create',
        event: 'project_created',
        note: 'Proje oluşturuldu',
      },
      actor,
    )
    // Notify the assigned designer(s). Subtasks were just inserted in this
    // same tx, so loadProjectAssignees (called inside the helper) sees them.
    await notifyProjectCreated(client, { project: updated, actor })
    return { ...updated, subtasks: subRows, history: [] }
  }).catch(rethrowTitleConflict(title))
}

/**
 * POST /api/projects/import — legacy/backlist product batch import.
 *
 * Whole batch runs in ONE transaction: a half-imported catalog is worse
 * than a rejected file, and `dryRun` relies on being able to roll back
 * after doing every real check.
 */
export async function importLegacyProjects(actor, items, dryRun = false) {
  // Duplicate detection is on normalised title (case-insensitive, collapsed
  // whitespace) against live projects AND within the batch itself — the same
  // key createProject rejects on, so a title can't enter through the batch
  // door that the single-create door would have turned away.
  const norm = normaliseProjectTitle

  const result = await withTx(async (client) => {
    const { rows: existingRows } = await client.query(
      'SELECT id, title FROM projects WHERE deleted_at IS NULL',
    )
    const existingTitles = new Map(existingRows.map((r) => [norm(r.title), r.title]))
    const existingIds = new Set(existingRows.map((r) => r.id))

    const created = []
    const duplicates = []
    const errors = []
    const seenInBatch = new Set()
    let missingProductInfo = 0

    for (const [index, item] of items.entries()) {
      const key = norm(item.title)
      if (!key) {
        errors.push({ row: index + 1, message: 'Kitap adı boş.' })
        continue
      }
      if (item.id && existingIds.has(item.id)) {
        duplicates.push(item.title)
        continue
      }
      if (existingTitles.has(key) || seenInBatch.has(key)) {
        duplicates.push(item.title)
        continue
      }
      seenInBatch.add(key)

      const components = Array.isArray(item.components) ? item.components : []
      if (components.length === 0) missingProductInfo += 1

      const stage = item.stage ?? 'satista'
      if (!ORDERABLE_STAGES.has(stage)) {
        badRequest(`Kayıtlı ürün yalnızca üretime hazır ve sonrası aşamalara aktarılabilir (satır ${index + 1}).`)
      }

      const project = await insertProject(client, {
        id: item.id,
        title: item.title,
        type: item.type,
        stage,
        progress: 100,
        pass_kind: item.pass_kind ?? 'first_edition',
        target_month: item.target_month ?? null,
        assigned_to: null,
        origin: 'legacy',
        created_by: actor.id,
      })

      if (components.length > 0) {
        await client.query(
          `INSERT INTO product_info (project_id, components, updated_by, updated_at)
           VALUES ($1, $2::jsonb, $3, NOW())
           ON CONFLICT (project_id)
           DO UPDATE SET components = EXCLUDED.components,
                         updated_by = EXCLUDED.updated_by,
                         updated_at = NOW()`,
          [project.id, JSON.stringify(components), actor.id],
        )
      }

      await logHistory(
        client,
        {
          project_id: project.id,
          from_stage: null,
          to_stage: stage,
          action: 'create',
          event: 'legacy_import',
          note: 'Kayıttan ürün olarak eklendi',
        },
        actor,
      )

      existingIds.add(project.id)
      existingTitles.set(key, item.title)
      created.push(project)
    }

    const summary = {
      willCreate: created.length,
      duplicates,
      missingProductInfo,
      errors,
      dryRun,
    }

    // Deliberately NOT calling notifyProjectCreated: it fans out to
    // assignees, and a legacy row has none — across a 90-item batch it would
    // be a notification flood for no reader.

    if (dryRun) {
      const rollback = new Error('dry-run')
      rollback.__dryRunSummary = summary
      throw rollback
    }
    return { ...summary, created }
  }).catch((e) => {
    if (e && e.__dryRunSummary) return { ...e.__dryRunSummary, created: [] }
    throw e
  })

  return result
}

/**
 * PATCH /api/projects/:id — edit title / type / target_month / assigned_to.
 *
 * Builds a per-field diff description for the timeline ("Tasarımcı
 * değiştirildi → Aylin") and resolves `assigned_to` to a name. Behaves
 * like the pre-refactor route.
 */
export async function patchProjectFields(id, actor, fields) {
  // Schema already restricts to the allowed keys; no manual filter needed.
  return withTx(async (client) => {
    const before = await getProjectForUpdate(client, id)
    if (!before) notFound('Proje bulunamadı.')
    // Renaming onto another live project's title produces exactly the
    // duplicate creation refuses, so it's refused too. Excludes this row so
    // a no-op rename (or a pure casing fix) still goes through.
    if (Object.prototype.hasOwnProperty.call(fields, 'title')) {
      const clash = await findProjectByTitle(client, fields.title, { excludeId: id })
      if (clash) rejectTitleClash(clash)
    }
    // SQL-level OCC guard: pass the locked row's version so a concurrent
    // writer (admin script that doesn't go through the orchestrator,
    // future non-locking path) can't silently overwrite this admin edit.
    const updated = await patchProject(
      client,
      id,
      fields,
      { expectedVersion: before.version },
    )
    if (!updated) notFound('Proje bulunamadı.')
    const FIELD_LABELS = {
      title: 'Başlık',
      type: 'Tür (TR / ÇİN)',
      target_month: 'Hedef ay',
      assigned_to: 'Tasarımcı',
    }
    const changes = []
    for (const [key, label] of Object.entries(FIELD_LABELS)) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue
      const oldVal = before[key]
      const newVal = updated[key]
      if (oldVal === newVal) continue
      if (key === 'assigned_to') {
        const { rows: u } = await client.query(
          'SELECT name FROM users WHERE id = $1', [newVal],
        )
        changes.push(`${label} → ${u[0]?.name ?? 'atanmadı'}`)
      } else {
        changes.push(`${label} → ${newVal ?? '—'}`)
      }
    }
    if (changes.length > 0) {
      await logHistory(
        client,
        {
          project_id: updated.id,
          from_stage: updated.stage,
          to_stage: updated.stage,
          action: 'system',
          event: 'project_edit',
          note: changes.join(' · '),
        },
        actor,
      )
    }
    return updated
  }).catch(rethrowTitleConflict(fields.title))
}

/**
 * POST /api/projects/:id/catalog — kaldır / geri al in Ürünler
 * (team_leader only). Only orderable-stage projects can be catalog-listed;
 * hiding anything earlier is a no-op that the leader couldn't see or undo.
 */
export async function setCatalogHidden(id, actor, hidden, note) {
  await withTx(async (client) => {
    const project = await getProjectForUpdate(client, id)
    if (!project) notFound('Proje bulunamadı.')
    if (hidden && !ORDERABLE_STAGES.has(project.stage)) {
      badRequest('Yalnızca katalogdaki (üretime hazır ve sonrası) ürünler kaldırılabilir.')
    }
    // Idempotent: re-sending the same state is a no-op rather than a second
    // history row + notification for a change that didn't happen.
    if (!!project.catalog_hidden === hidden) return
    await setProjectCatalogHidden(client, project.id, hidden, actor)
    await logHistory(client, {
      project_id: project.id,
      action: 'system',
      event: hidden ? 'catalog_delist' : 'catalog_relist',
      from_stage: project.stage,
      to_stage: project.stage,
      pass_number: project.pass_number ?? 1,
      note: note || (hidden ? 'Ürün katalogdan kaldırıldı.' : 'Ürün katalogda tekrar yayında.'),
    }, actor)
    await notifyProductCatalogChanged(client, { project, actor, hidden })
  })
  // Re-read outside the tx: `setProjectCatalogHidden` returns the raw column
  // set, which has no `has_product_info` — the Ürünler row needs it to decide
  // between the "Sipariş" action and the "ürün bilgisi eksik" warning.
  return getProject(id)
}