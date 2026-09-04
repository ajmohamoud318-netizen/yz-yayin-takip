/**
 * Project persistence: thin SQL wrapper for the `projects` table (and
 * its closely coupled `stage_history` + `demos` tables). Designed for
 * use from route handlers and service entry points inside `withTx`.
 *
 * Sibling to `subtask-repository.js` — that file owns the `subtasks`
 * and `subtask_pages` tables. The split keeps each aggregate's CRUD in
 * one file: projects and history here, subtasks and pages next door.
 * `loadProjectAssignees` stays here because it returns project-level
 * data (the merge of project primary + every distinct per-subtask
 * owner) — its purpose is to feed project-level UI like the assignee
 * avatar stack and the notification fan-out, not to mutate subtasks.
 *
 * Returns plain JS objects shaped for the SPA. Project history is
 * fetched lazily by `listProjectHistory` so list endpoints stay light.
 */

import { getPool, withTx } from '../db/pool.js'
import { nanoid } from 'nanoid'
import { HttpError } from '../domain/errors.js'
import { normaliseProjectTitle } from '../domain/project-title.js'

// Per-parça approval ledgers (migrations 068/069/070): the gate that
// keeps a project at demo_onay / ozalit_onay / baski_onay until every
// parça on the latest snapshot has been signed off. JSONB so the rule
// layer can evolve without further migrations. List column is a flat
// comma-separated bare-name list — `listProjects` prefixes every entry
// with `p.` by splitting on commas, so adding any non-bare-name text
// here would shred the only query that does the prefixing.
const PROJECT_COLUMNS = `
  id, title, type, stage, assigned_to, created_by, target_month,
  demo_attempt, ozalit_attempt, pass_number, pass_kind,
  last_reject_reason, progress, version,
  ozalit_leader_approved, ozalit_leader_approved_by, ozalit_leader_approved_at,
  ozalit_designer_approvals,
  demo_held, demo_held_at, demo_held_by_name,
  demo_received, demo_received_by, demo_received_at,
  ozalit_received, ozalit_received_by, ozalit_received_at,
  baski_onay_prepared, baski_onay_prepared_by, baski_onay_prepared_by_name, baski_onay_prepared_at,
  demo_delivered_at, demo_delivered_by,
  ozalit_requested, reject_target, last_reject_type, last_reject_target,
  ozalit_approvals,
  demo_started, demo_started_at, demo_started_by, demo_started_by_name,
  demo_change_requested_at, demo_change_requested_by, demo_change_requested_by_name, demo_change_requested_note,
  demo_fix_pending,
  ozalit_started, ozalit_started_at, ozalit_started_by, ozalit_started_by_name,
  ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name, ozalit_change_requested_note,
  ozalit_fix_pending,
  ekran_demo_requested_at, ekran_demo_requested_by, ekran_demo_requested_by_name,
  ekran_ozalit,
  origin,
  catalog_hidden, catalog_hidden_at, catalog_hidden_by,
  demo_parca_approvals, demo_parca_rejections,
  ozalit_parca_approvals, ozalit_parca_rejections,
  baski_parca_preparers, baski_parca_approvals,
  cin_baski_parca_preparers, cin_baski_parca_approvals,
  created_at, updated_at,
  deleted_at, deleted_by, deleted_by_name
`

/**
 * `demo_delivered_by_name`, resolved live from `users` instead of read back
 * from the snapshot `computeDemoTeslimAdvance` stamped at delivery time.
 *
 * The stored column froze whatever the account was called on the day the
 * matbaa delivered, so renaming a user (the realistic fix when a shared login
 * like "yukselen zeka" turns out to be doing the deliveries) left this field
 * reading the old string forever — while the timeline right next to it, which
 * resolves `done_by` through a LEFT JOIN at read time, showed the new one.
 * Same bug class as the nameless history rows that JOIN was added to fix.
 *
 * COALESCE rather than a bare lookup, because the snapshot is still worth
 * something: if the user row is ever deleted the live name goes null and the
 * frozen string is all that's left of who delivered it. Live name wins when
 * there is one; the snapshot is the floor. That's the same shape as
 * `deleted_by` / `deleted_by_name` elsewhere in this table.
 *
 * Written as a scalar subquery, not a LEFT JOIN, because this expression has
 * to survive three different contexts: a plain SELECT, a `RETURNING` clause
 * (patchProject), and a `SELECT ... FOR UPDATE` (getProjectForUpdate). A join
 * would break the last one — Postgres refuses FOR UPDATE on the nullable side
 * of an outer join — and would need `FOR UPDATE OF projects` plus a different
 * column prefix at every call site. A subquery is a separate query level, so
 * it locks nothing and reads the same everywhere.
 *
 * `table` is the name the enclosing query uses for `projects` ('p' in the
 * joined list query, 'projects' in the single-row ones).
 */
const deliveredByNameSql = (table) => `
  COALESCE(
    (SELECT u.name FROM users u WHERE u.id = ${table}.demo_delivered_by),
    ${table}.demo_delivered_by_name
  ) AS demo_delivered_by_name
`

export async function listProjects() {
  // LEFT JOIN the assignee so the list path returns a fully-hydrated
  // `assigned_name`. Without this every project card on the dashboard
  // crashed with "Cannot read properties of null (reading 'split')"
  // because `project-mapper.js` passed the null straight into
  // `initials(project.assigned_name)`. The `assigned_name = $alias`
  // fallback keeps unassigned projects rendering "—".
  const { rows } = await getPool().query(
    // NB: the `p.`-prefixing below splits PROJECT_COLUMNS on commas, so that
    // constant must stay a flat list of bare column names — derived
    // expressions are appended separately, already qualified.
    `SELECT ${PROJECT_COLUMNS.split(',').map((c) => 'p.' + c.trim()).join(', ')}
       , ${deliveredByNameSql('p')}
       , a.name AS assignee_name
       -- The components check is not redundant with EXISTS: Ürün Bilgileri's
       -- "Ürünü Sil" clears a product's spec by saving an EMPTY components
       -- array, so the row keeps existing. A bare EXISTS reported
       -- has_product_info=true for those, and Sales could still raise an order
       -- against a product with a blank spec sheet.
       , EXISTS(SELECT 1 FROM product_info pi WHERE pi.project_id = p.id AND pi.components <> '[]'::jsonb) AS has_product_info
     FROM projects p
     LEFT JOIN users a ON a.id = p.assigned_to
     WHERE p.deleted_at IS NULL
     ORDER BY p.created_at DESC, p.id`,
  )
  // Build a per-project `assignees` array (`[{id, name}, ...]`) from BOTH
  // the project primary (`assigned_to`) AND every distinct per-subtask
  // `assigned_to`. Without the subtask merge, a project where the team
  // leader split the work across Kapak → Rahşan, Kutu → Aylin would
  // show only the primary assignee on the dashboard / Tüm Projeler row
  // and the team leader would never see the second designer until they
  // opened the detail page.
  const ids = rows.map((r) => r.id).filter(Boolean)
  const subAssignees = new Map() // projectId -> [{id, name}, ...]
  if (ids.length > 0) {
    const subRes = await getPool().query(
      `SELECT s.project_id, s.assigned_to, u.name AS assignee_name
         FROM subtasks s
         LEFT JOIN users u ON u.id = s.assigned_to
        WHERE s.project_id = ANY($1) AND s.assigned_to IS NOT NULL`,
      [ids],
    )
    for (const row of subRes.rows) {
      const list = subAssignees.get(row.project_id) ?? []
      list.push({ id: row.assigned_to, name: row.assignee_name })
      subAssignees.set(row.project_id, list)
    }
  }
  // History for every listed project in one query. The client's status
  // color rules (statusKeyForProject → isSecondDemoCycle) read history to
  // tell the first demo cycle (purple) from the second (green). Without it
  // the dashboard rendered purple/"Demo aşamasında: 0" until the user
  // opened a project detail (whose payload does include history), at which
  // point the merged store flipped the same project to green — the color
  // and the counters visibly changed after just opening and closing a
  // project. Shipping the real history with the list keeps every view
  // consistent from first load.
  const historyByProject = new Map() // projectId -> [rows]
  if (ids.length > 0) {
    const histRes = await getPool().query(
      `SELECT h.id, h.project_id, h.from_stage, h.to_stage,
              h.action, h.event, h.reason, h.reject_target,
              h.pass_number, h.done_by, h.note, h.demo_id, h.created_at,
              u.name AS done_by_name
         FROM stage_history h
         LEFT JOIN users u ON u.id = h.done_by
        WHERE h.project_id = ANY($1)
        ORDER BY h.created_at, h.id`,
      [ids],
    )
    for (const row of histRes.rows) {
      const list = historyByProject.get(row.project_id) ?? []
      list.push(row)
      historyByProject.set(row.project_id, list)
    }
  }
  return Promise.all(rows.map(async (r) => {
    const project = rowToProject(r)
    project.assigned_name = r.assignee_name ?? null
    project.history = historyByProject.get(r.id) ?? []
    // Build the assignees array from designers who actually have work:
    //   1. everyone with at least one subtask `assigned_to` set
    //   2. project primary (`assigned_to`) — but ONLY if they also have a
    //      subtask. If the team leader reassigned every subtask off the
    //      primary, that primary is no longer a designer on this project
    //      and shouldn't render in the row card / dashboard tile.
    const projectSubAssignees = subAssignees.get(r.id) ?? []
    const subtaskOwnerIds = new Set(projectSubAssignees.map((s) => s.id))
    const seen = new Set()
    const merged = []
    // Subtask assignees first (they're guaranteed to have real work).
    for (const sa of projectSubAssignees) {
      if (seen.has(sa.id)) continue
      seen.add(sa.id)
      merged.push(sa)
    }
    // Project primary only if they're already one of the subtask owners.
    if (project.assigned_to && subtaskOwnerIds.has(project.assigned_to)) {
      // De-dup: the primary may already be in `merged` via the subtask
      // loop. Move them to the front so the avatar stack always leads
      // with the primary (matches the "primary leads" convention used
      // elsewhere in the UI).
      const existingIdx = merged.findIndex((a) => a.id === project.assigned_to)
      if (existingIdx > 0) {
        const [existing] = merged.splice(existingIdx, 1)
        merged.unshift(existing)
      } else if (existingIdx === -1) {
        merged.unshift({ id: project.assigned_to, name: project.assigned_name })
      }
      seen.add(project.assigned_to)
    }
    project.assignees = merged
    return project
  }))
}

/**
 * Resolve the assignee list for a single project. Mirrors the list
 * endpoint: returns the project primary assignee AND every distinct
 * per-subtask assignee, in stable order (primary first, then subtask
 * owners in insertion order, deduped by id). Without the subtask merge
 * a project where the team leader split the work across Kapak → Rahşan,
 * Kutu → Aylin, Ses → Abdijibar would only ship one designer in the
 * detail response and the edit dialog would pre-fill with just that
 * one — the per-subtask designers would silently vanish from the picker.
 *
 * The merge order is intentional: the primary leads so the AssigneeAvatars
 * stack and the "Tasarımcılar" header card on the detail page both render
 * the project owner first, with the per-subtask designers following.
 */
export async function loadProjectAssignees(client, project) {
  if (!project.assigned_to && !(project.id ?? project.project_id)) return []
  const projectId = project.id ?? project.project_id
  const seen = new Set()
  const merged = []
  if (project.assigned_to) {
    const { rows } = await client.query(
      'SELECT id, name FROM users WHERE id = $1',
      [project.assigned_to],
    )
    if (rows[0]) {
      merged.push({ id: rows[0].id, name: rows[0].name })
      seen.add(rows[0].id)
    }
  }
  if (projectId) {
    const { rows } = await client.query(
      `SELECT s.assigned_to, u.name AS assignee_name
         FROM subtasks s
         LEFT JOIN users u ON u.id = s.assigned_to
        WHERE s.project_id = $1 AND s.assigned_to IS NOT NULL
        ORDER BY s.position, s.created_at, s.id`,
      [projectId],
    )
    for (const r of rows) {
      if (seen.has(r.assigned_to)) continue
      seen.add(r.assigned_to)
      merged.push({ id: r.assigned_to, name: r.assignee_name })
    }
  }
  return merged
}

export async function getProject(id) {
  const { rows } = await getPool().query(
    `SELECT ${PROJECT_COLUMNS}
       , ${deliveredByNameSql('projects')}
       , EXISTS(SELECT 1 FROM product_info pi WHERE pi.project_id = projects.id AND pi.components <> '[]'::jsonb) AS has_product_info
     FROM projects WHERE id = $1 AND deleted_at IS NULL`, [id],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

/**
 * Same as `getProject` but does NOT filter out soft-deleted rows. Used only
 * by the detail GET route: someone who had this project open (or clicked a
 * "project deleted" notification) should still be able to see what it was —
 * read-only — rather than hitting a bare 404 that throws away all context.
 * Every mutation route keeps using `getProject`/`getProjectForUpdate` (which
 * DO filter), so a deleted project stays fully frozen either way.
 */
export async function getProjectIncludingDeleted(id) {
  const { rows } = await getPool().query(
    `SELECT ${PROJECT_COLUMNS}
       , ${deliveredByNameSql('projects')}
       , EXISTS(SELECT 1 FROM product_info pi WHERE pi.project_id = projects.id AND pi.components <> '[]'::jsonb) AS has_product_info
     FROM projects WHERE id = $1`, [id],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

/** Same shape, but as a single `client.query` argument for use inside `withTx`. */
export async function getProjectForUpdate(client, id) {
  const { rows } = await client.query(
    `SELECT ${PROJECT_COLUMNS}
       , ${deliveredByNameSql('projects')}
       , EXISTS(SELECT 1 FROM product_info pi WHERE pi.project_id = projects.id AND pi.components <> '[]'::jsonb) AS has_product_info
     FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

/**
 * The live project whose title normalises to the same key as `title`, or
 * null. `excludeId` lets the rename path ignore the row it is editing.
 *
 * Compares in JS, not SQL. The unique index (migration 065) keys on
 * the same shape, but it can only reject — this returns the row, which is
 * what lets the caller name the offending project instead of surfacing a
 * bare constraint violation. `normaliseProjectTitle` is also marginally
 * stricter (NFC, full Unicode whitespace), so it stays the authority.
 *
 * Scanning every live title is fine at this table's size — a publisher's
 * pipeline, hundreds of rows at the outside — and importLegacyProjects
 * already pulls the same set for the same reason. Callers run it inside the
 * creating/renaming transaction so the read is ordered against concurrent
 * writers by the row locks they hold; the index closes the remaining race.
 */
export async function findProjectByTitle(client, title, { excludeId = null } = {}) {
  const key = normaliseProjectTitle(title)
  if (!key) return null
  const { rows } = await client.query(
    `SELECT id, title, stage FROM projects
      WHERE deleted_at IS NULL AND ($1::text IS NULL OR id <> $1)`,
    [excludeId],
  )
  return rows.find((r) => normaliseProjectTitle(r.title) === key) ?? null
}

export async function listProjectHistory(client, projectId) {
  // LEFT JOIN users so each row carries `done_by_name`. Without this the
  // ProjectDetail UI shows the user icon with no name — every entry would
  // render `h.done_by_name` as null because the raw SELECT only returned
  // `done_by` (the foreign key id). The two-pass order keeps the timeline
  // stable even when two rows share the same created_at timestamp (common
  // for batched inserts).
  const { rows } = await client.query(
    `SELECT h.id, h.project_id, h.from_stage, h.to_stage,
            h.action, h.event, h.reason, h.reject_target,
            h.pass_number, h.done_by, h.note, h.demo_id, h.created_at,
            u.name AS done_by_name
       FROM stage_history h
       LEFT JOIN users u ON u.id = h.done_by
      WHERE h.project_id = $1
      ORDER BY h.created_at, h.id`,
    [projectId],
  )
  return rows
}

// Columns writable on projects. Anything else arriving in `fields` is
// dropped here so a schema-accepted but column-less key (assignees,
// subtasks, subtaskAssignees, pageCount, stickerCount) can't reach the
// SQL and 500 on a "column does not exist" PG error.
const PROJECT_WRITABLE_COLUMNS = new Set([
  'title',
  'type',
  'target_month',
  'assigned_to',
  'stage',
  'progress',
  'version',
  'last_reject_reason',
  'demo_attempt',
  'ozalit_attempt',
  'ozalit_leader_approved',
  'ozalit_leader_approved_by',
  'ozalit_leader_approved_at',
  'ozalit_designer_approvals',
  // demo_held trio — flipped by the demo "approve-but-stay" branch in
  // computeApproval and reset when a second demo is sent (computeAdvance).
  'demo_held',
  'demo_held_at',
  'demo_held_by_name',
  // Demo "received" gate — set at demo_onay by a designer/leader, reset when a
  // fresh demo is delivered. Blocks the demo approve until true.
  'demo_received',
  'demo_received_by',
  'demo_received_at',
  // Ozalit "received" gate — the same rule one leg later: set at ozalit_onay,
  // reset when the matbaa delivers a fresh proof, blocks the ozalit approve
  // until true (migration 035).
  'ozalit_received',
  'ozalit_received_by',
  'ozalit_received_at',
  // Baskı Onay Formu dual-approval (migration 045): one team leader prepares
  // (sets these three), a DIFFERENT team leader approves — computeApproval's
  // baski_onay branch refuses the same actor unless no other active leader
  // exists. Reset once the project actually advances to Üretime Hazır.
  'baski_onay_prepared',
  'baski_onay_prepared_by',
  'baski_onay_prepared_by_name',
  'baski_onay_prepared_at',
  // Who/when the matbaa delivered the current demo round. Set by
  // computeDemoTeslimAdvance, nulled by a resend or "Teslim Alınamadı".
  // `demo_delivered_by` is the id everything now reads through; the _name
  // stays writable on purpose as the fallback snapshot described on
  // `deliveredByNameSql` — it is no longer what gets read back.
  'demo_delivered_at',
  'demo_delivered_by',
  'demo_delivered_by_name',
  // ozalit_teslim two-step + reject-to-matbaa re-delivery lock. Set by the
  // ozalit transitions (computeOzalitTeslimAdvance) and computeRejection.
  'ozalit_requested',
  'reject_target',
  // Which kind of rejection sent the project back to Tasarım. computeAdvance
  // reads last_reject_type to route an ozalit-revision resubmit to ozalit_teslim.
  'last_reject_type',
  'last_reject_target',
  // Multi-party ozalit approval: array of { id, role, name, at } approvers.
  'ozalit_approvals',
  // Matbaa "Başladım" gate (migration 048): flag-only marker the printer sets
  // once physical work begins. While false, the leader/assigned designer can
  // cancel or edit the request freely; reset on every fresh printer round.
  'demo_started',
  'demo_started_at',
  'demo_started_by',
  'demo_started_by_name',
  'ozalit_started',
  'ozalit_started_at',
  'ozalit_started_by',
  'ozalit_started_by_name',
  // Pending change-request ledger (migration 048): presence of
  // `*_change_requested_at` IS the pending flag, no separate boolean. Set by
  // computeDemoChangeRequest/computeOzalitChangeRequest, cleared by the
  // matching accept/decline transition.
  'demo_change_requested_at',
  'demo_change_requested_by',
  'demo_change_requested_by_name',
  'demo_change_requested_note',
  'ozalit_change_requested_at',
  'ozalit_change_requested_by',
  'ozalit_change_requested_by_name',
  'ozalit_change_requested_note',
  // "Fix owed" gate (migration 049): set true only by an accepted change
  // request, cleared by the matching edit-notify submission or an outright
  // cancel. While true, computeDemoStart/computeOzalitStart refuse to
  // re-lock the round.
  'demo_fix_pending',
  'ozalit_fix_pending',
  // Ekran Demo Onayı pending-request ledger (migration 050): presence of
  // `ekran_demo_requested_at` IS the pending flag, same convention as
  // `demo_change_requested_at`. Set by computeEkranDemoRequest, cleared by
  // computeEkranDemoApprove/Reject.
  'ekran_demo_requested_at',
  'ekran_demo_requested_by',
  'ekran_demo_requested_by_name',
  // Ekran Ozalit (migration 061): set by the designer's post-revize resubmit,
  // cleared when the round ends (approved by a leader, or rejected into a new
  // round). Unlike the ekran-demo trio above this is a plain boolean — the
  // round IS the request, there is no separate pending state.
  'ekran_ozalit',
  // Per-parça approval ledgers (migrations 068/069/070). Each gate
  // (demo_onay / cin_demo_onay / ozalit_onay / ekran_ozalit /
  // baski_onay / cin_baski_onay) refuses to advance until every parça in
  // the latest snapshot's `_selectedComponents` has the required party
  // sign-off recorded in the matching ledger. demo/ozalit rejections
  // mirror the project-level reject (reason + target).
  'demo_parca_approvals',
  'demo_parca_rejections',
  'ozalit_parca_approvals',
  'ozalit_parca_rejections',
  'baski_parca_preparers',
  'baski_parca_approvals',
  'cin_baski_parca_preparers',
  'cin_baski_parca_approvals',
])

// The JSONB columns on `projects`. They MUST be serialised with
// `JSON.stringify` and bound through an explicit `::jsonb` cast — same
// contract as `ORDER_JSONB_COLUMNS` in order-repository.js.
//
// Without it node-postgres encodes a JS array as a Postgres ARRAY LITERAL,
// not as JSON: `[{ id: 'u1', ... }]` goes to the wire as
// `{"{\"id\":\"u1\",...}"}`, which the jsonb input parser rejects with
// `22P02 invalid input syntax for type json` — a raw PG error with no
// statusCode, i.e. a 500 out of POST /projects/:id/approve the moment a
// team leader recorded the first ozalit sign-off. The empty-array reset
// was worse than an error because it *succeeded*: `[]` encodes to `{}`,
// so the column quietly held an empty JSON object instead of an array and
// `jsonb_array_length` then failed on that row (see
// reconcileOzalitApprovals).
const PROJECT_JSONB_COLUMNS = new Set([
  'ozalit_approvals',
  'ozalit_designer_approvals',
  // Per-parça approval ledgers (migrations 068/069/070) — all JSONB and
  // all need the `JSON.stringify` + `::jsonb` cast dance described above.
  // demo_parca_approvals/rejections are list-shaped (the same as
  // ozalit_designer_approvals). The other four are object-shaped
  // (`{ '<parca>': [{...}] }`) — same wire-format contract.
  'demo_parca_approvals',
  'demo_parca_rejections',
  'ozalit_parca_approvals',
  'ozalit_parca_rejections',
  'baski_parca_preparers',
  'baski_parca_approvals',
  'cin_baski_parca_preparers',
  'cin_baski_parca_approvals',
])

export async function patchProject(client, id, fields, { expectedVersion = null } = {}) {
  // Translate the SPA's `assignees[0]` convenience field into the
  // `assigned_to` column the projects table actually has. The SPA
  // payload includes `assignees` as a convenience for multi-select
  // UIs; we only persist the first one (the primary owner).
  if (Array.isArray(fields.assignees)) {
    fields = {
      ...fields,
      assigned_to: fields.assignees[0] ?? null,
    }
    delete fields.assignees
  }
  const cols = Object.keys(fields).filter((c) => PROJECT_WRITABLE_COLUMNS.has(c))
  if (cols.length === 0) return getProjectForUpdate(client, id)
  // SQL-side version bump: the entity (`Project`) bumps `this.version` in
  // memory, but `version` is in NON_DIFFED_COLUMNS so it's never in `fields`.
  // Without this SET clause the DB row stays at the old version forever,
  // silently breaking the optimistic-concurrency check on the next read.
  // The route's `updated_at = NOW()` is the same pattern — the SQL owns
  // the counter, not the in-memory entity.
  const setSql = [
    ...cols.map((c, i) => `${c} = $${i + 2}${PROJECT_JSONB_COLUMNS.has(c) ? '::jsonb' : ''}`),
    'version = version + 1',
    'updated_at = NOW()',
  ].join(', ')
  // Optimistic-concurrency guard: when the caller passes `expectedVersion`
  // (the version observed when the row was locked at the top of the tx),
  // the UPDATE only matches if no concurrent writer bumped the row in
  // between. Zero rows = throw 409 so the service surfaces the same
  // conflict message the entity's _assertExpectedVersion already uses.
  // The `SELECT ... FOR UPDATE` in getProjectForUpdate already serialises
  // tx-scoped writers, but this is the backstop for out-of-band writes
  // (admin scripts, future non-locking paths) and for the rare case the
  // lock wasn't acquired.
  const whereExtra = expectedVersion != null
    ? ` AND version = $${cols.length + 2}`
    : ''
  const values = [
    ...cols.map((c) => (
      PROJECT_JSONB_COLUMNS.has(c) ? JSON.stringify(fields[c] ?? null) : fields[c]
    )),
    ...(expectedVersion != null ? [expectedVersion] : []),
  ]
  const { rows } = await client.query(
    // The routes hand this row straight back to the SPA, so the derived name
    // has to be resolved here too — otherwise the response to the very
    // request that renamed things would still carry the stale snapshot.
    `UPDATE projects SET ${setSql} WHERE id = $1${whereExtra}
     RETURNING ${PROJECT_COLUMNS}, ${deliveredByNameSql('projects')}`,
    [id, ...values],
  )
  if (expectedVersion != null && rows.length === 0) {
    // Same Turkish message the Order entity uses for its 409 — the SPA's
    // `Bu kayıt başka biri tarafından güncellendi. Sayfayı yenileyin.` toast
    // comes from this single source of truth regardless of which guard
    // (entity or SQL) caught the stale write. The `conflict` code mirrors
    // `domain/errors.js#conflict`.
    throw new HttpError(
      409,
      'Bu kayıt başka biri tarafından güncellendi. Sayfayı yenileyin.',
      'conflict',
    )
  }
  return rows[0] ? rowToProject(rows[0]) : null
}

// Soft-delete: the row stays put (and out of `listProjects`/`getProject`)
// so a misclick is recoverable from the "Silinen Projeler" page instead of
// being gone for good. Takes a tx `client` (not the pool) so the route can
// commit it atomically with the "project deleted" notification fan-out.
export async function deleteProject(client, id, actor) {
  await client.query(
    'UPDATE projects SET deleted_at = NOW(), deleted_by = $2, deleted_by_name = $3 WHERE id = $1',
    [id, actor?.id ?? null, actor?.name ?? null],
  )
}

/**
 * "Kaldır" / "Geri Al" — delist a product from the Ürünler catalog, or put it
 * back (migration 033).
 *
 * Deliberately NOT a soft delete: the project keeps its stage, history,
 * assignees and dashboard presence, and only drops out of the sipariş catalog.
 * The stamp columns are cleared on re-listing so "kaldıran / tarih" always
 * describes the CURRENT hidden state rather than the last one.
 *
 * Returns the updated project, or null when the id doesn't exist (or is
 * soft-deleted — a deleted project isn't in the catalog to begin with).
 */
export async function setProjectCatalogHidden(client, id, hidden, actor) {
  const { rows } = await client.query(
    `UPDATE projects
        SET catalog_hidden = $2,
            catalog_hidden_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
            catalog_hidden_by = CASE WHEN $2 THEN $3::text ELSE NULL END,
            updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${PROJECT_COLUMNS}, ${deliveredByNameSql('projects')}`,
    [id, hidden, actor?.id ?? null],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

export async function listDeletedProjects() {
  const { rows } = await getPool().query(
    `SELECT p.id, p.title, p.type, p.stage, p.target_month, p.created_at,
            p.deleted_at, p.deleted_by, p.deleted_by_name,
            a.name AS assignee_name
       FROM projects p
     LEFT JOIN users a ON a.id = p.assigned_to
      WHERE p.deleted_at IS NOT NULL
      ORDER BY p.deleted_at DESC, p.id`,
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    stage: r.stage,
    target_month: r.target_month,
    assigned_name: r.assignee_name ?? null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    deleted_at: r.deleted_at instanceof Date ? r.deleted_at.toISOString() : r.deleted_at,
    deleted_by: r.deleted_by,
    deleted_by_name: r.deleted_by_name,
  }))
}

export async function restoreProject(client, id) {
  const { rows } = await client.query(
    `UPDATE projects
        SET deleted_at = NULL, deleted_by = NULL, deleted_by_name = NULL
      WHERE id = $1 AND deleted_at IS NOT NULL
      RETURNING ${PROJECT_COLUMNS}, ${deliveredByNameSql('projects')}`,
    [id],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

export async function insertHistory(client, entry) {
  await client.query(
    `INSERT INTO stage_history
       (project_id, from_stage, to_stage, action, event, reason, reject_target, pass_number, done_by, note, demo_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      entry.project_id,
      entry.from_stage ?? null,
      entry.to_stage,
      entry.action,
      entry.event ?? 'general',
      entry.reason ?? null,
      entry.reject_target ?? null,
      entry.pass_number ?? 1,
      entry.done_by ?? null,
      entry.note ?? null,
      // The spec-sheet snapshot this row produced, when it produced one
      // (migration 052) — the only way to tell two corrections of the same
      // round apart, since both share an attempt slot.
      entry.demo_id ?? null,
    ],
  )
}

/**
 * Convenience helper that wraps `insertHistory` and automatically tags the
 * entry with the current user's id + name. Route handlers should prefer
 * this call so a forgotten `done_by` doesn't silently produce a nameless
 * timeline row. Falls back to whatever `entry.done_by` / `entry.done_by_name`
 * were passed if `user` is missing (defensive — every route that mutates
 * project state has a logged-in user by the time it gets here).
 */
export async function logHistory(client, entry, user) {
  const doneBy = user?.id ?? entry.done_by ?? null
  const doneByName = user?.name ?? entry.done_by_name ?? null
  return insertHistory(client, {
    ...entry,
    done_by: doneBy,
    // Persist the name in the JSONB-shaped row — we don't have a column for
    // it, but `listProjectHistory` will overwrite it via the JOIN on
    // `done_by`. Setting it here too keeps the object shape consistent
    // when callers read it back from the in-memory return value before
    // refetching.
    done_by_name: doneByName,
  })
}

/**
 * Re-evaluate pending ozalit approvals after the set of active team leaders
 * changes (e.g. a leader was deactivated). The ozalit rule is "every ACTIVE
 * team leader + every assigned designer must approve"; that required set only
 * gets re-checked when someone clicks Approve. So if the only outstanding
 * approval was a leader who just got deactivated, the project would otherwise
 * sit at ozalit_onay forever. This advances any such project to Baskı Onayı
 * (migration 044) — same destination as a normal completed round; the final
 * print approval is still owed there before Üretime Hazır.
 *
 * Call it AFTER the deactivation is committed so the active-leaders query
 * excludes the deactivated user. `actor` is stamped on the history row.
 * Returns the number of projects advanced.
 */
/**
 * Insert one demo/ozalit form snapshot.
 *
 * Shared by `POST /demos` and the demo/ozalit edit-notify routes so a
 * correction to an already-sent sheet is written inside the same transaction
 * that authorizes it. Takes a `client` (never the pool) for exactly that
 * reason — if the caller's guard throws afterwards, the row rolls back with
 * it. See the "Başladım" guard in routes/demos.js for what goes wrong when
 * the write and the guard live in separate requests.
 */
export async function insertDemoSnapshot(client, { project_id, order_id = null, kind, payload, attempt, created_by }) {
  // demos.id is TEXT PRIMARY KEY with no default — mint a `d-<nanoid>` so the
  // INSERT satisfies NOT NULL. The prefix keeps it visually distinct from
  // user (u-…) / project (p-…) ids.
  //
  // order_id is NULL for a project's own demo/ozalit round and set for a
  // sipariş's (migration 053). project_id is filled either way — a sipariş
  // sheet still belongs to a product — so every read must scope on BOTH or a
  // sipariş round shows up as the project's latest sheet.
  const { rows } = await client.query(
    `INSERT INTO demos (id, project_id, order_id, kind, payload, attempt, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, project_id, order_id, kind, payload, attempt, created_by, created_at`,
    [`d-${nanoid(16)}`, project_id, order_id, kind, payload, attempt, created_by],
  )
  return rows[0]
}

/**
 * Load the latest demo/ozalit/baski_onay snapshot for a project — the
 * source of truth for "which parçalar are on this round's sheet". The
 * per-parça approval FSM (migrations 068/069/070) compares this snapshot's
 * `_selectedComponents` against the per-parça ledger to decide whether the
 * round can advance.
 *
 * `kind` is the gate we want: 'demo' for demo_onay, 'ozalit' for
 * ozalit_onay, 'baski_onay' for baski_onay (and 'cin_' mirrors just change
 * the `attempt` scoping). Returns `{ selectedComponents, attempt }` from
 * the most recent demo row whose `_selectedComponents` actually contains
 * parçalar; falls back to the most recent row of the kind even if it has
 * no parçalar, so an empty demo still resolves to an attempt number.
 *
 * `client` is the tx-scoped pool client, never the pool — the demo row
 * sits under the same FOR UPDATE the route already holds, so reading it
 * here is free.
 */
export async function loadLatestDemoSnapshot(client, projectId, kind) {
  const { rows } = await client.query(
    `SELECT payload, attempt
       FROM demos
      WHERE project_id = $1 AND order_id IS NULL AND kind = $2
        AND jsonb_typeof(payload) = 'object'
        AND jsonb_typeof(COALESCE(payload->'_selectedComponents', '[]'::jsonb)) = 'array'
      ORDER BY attempt DESC, created_at DESC
      LIMIT 1`,
    [projectId, kind],
  )
  if (!rows[0]) return null
  const payload = rows[0].payload ?? {}
  const selected = Array.isArray(payload._selectedComponents)
    ? payload._selectedComponents
        .map((c) => (typeof c === 'string' ? c : c?.component))
        .filter(Boolean)
    : []
  return { selectedComponents: selected, attempt: rows[0].attempt }
}

export async function reconcileOzalitApprovals(actor) {
  const { rows: leaderRows } = await getPool().query(
    "SELECT id FROM users WHERE role = 'team_leader' AND is_active = TRUE",
  )
  const activeLeaderIds = leaderRows.map((r) => r.id)

  // `jsonb_typeof(...) = 'array'` is not decoration: rows written before
  // patchProject's `::jsonb` cast existed hold `{}` (an empty JSON object)
  // rather than `[]`, and `jsonb_array_length` raises `22023 cannot get
  // array length of a non-array` on those — one bad row took the whole
  // reconcile down. Migration 059 normalises them; this guard keeps the
  // query safe on any DB that hasn't run it yet.
  const { rows: candidates } = await getPool().query(
    `SELECT id FROM projects
      WHERE stage = 'ozalit_onay'
        AND jsonb_typeof(COALESCE(ozalit_approvals, '[]'::jsonb)) = 'array'
        AND jsonb_array_length(COALESCE(ozalit_approvals, '[]'::jsonb)) > 0`,
  )

  let advanced = 0
  for (const { id } of candidates) {
    // eslint-disable-next-line no-await-in-loop
    await withTx(async (client) => {
      const project = await getProjectForUpdate(client, id)
      if (!project || project.stage !== 'ozalit_onay') return
      // Can't enter production below 100% — leave it (shouldn't happen at
      // ozalit_onay, but stay safe).
      if ((project.progress ?? 0) < 100) return

      const assignees = await loadProjectAssignees(client, project)
      const designerIds = assignees.map((a) => a.id)
      const required = [...new Set([...activeLeaderIds, ...designerIds])]
      const approvals = Array.isArray(project.ozalit_approvals) ? project.ozalit_approvals : []
      const approvedIds = new Set(approvals.map((a) => a.id))
      const complete = required.length > 0 && required.every((rid) => approvedIds.has(rid))
      if (!complete) return

      await patchProject(
        client,
        id,
        {
          stage: 'baski_onay',
          ozalit_approvals: [],
          ozalit_leader_approved: false,
          ozalit_leader_approved_by: null,
          ozalit_leader_approved_at: null,
          ozalit_designer_approvals: [],
        },
        // Pass the locked row's version as the SQL-level OCC guard. The
        // previous contract set `version: (project.version ?? 0) + 1` in
        // `fields`, but `version = version + 1` in the SET clause is now
        // authoritative; the `expectedVersion` is what the WHERE clause
        // matches against to refuse a concurrent writer.
        { expectedVersion: project.version },
      )
      await logHistory(
        client,
        {
          project_id: id,
          from_stage: 'ozalit_onay',
          to_stage: 'baski_onay',
          action: 'approve',
          note: 'Ozalit onaylandı, baskı onayına gönderildi (bekleyen lider devre dışı bırakıldı)',
        },
        actor,
      )
      // Ürün Bilgileri capture is NOT done here — the project no longer enters
      // production directly from this path, it lands on baski_onay like any
      // other completed ozalit round. Capture happens once a team leader gives
      // the final Baskı Onayı (routes/projects.js's approve route).
      advanced += 1
    })
  }
  return advanced
}

/**
 * Insert a project.
 *
 * `stage`, `progress` and `origin` are parameterised rather than hardcoded so
 * the legacy/backlist import (`POST /api/projects/import`) can create a row
 * that already sits at a finished stage. The defaults reproduce the normal
 * create path exactly — a new project starts at Tasarım, 0% done, provenance
 * 'pipeline' — so every pre-existing caller behaves identically.
 *
 * `progress` matters more than it looks for legacy rows: every orderable stage
 * is in STAGES_REQUIRING_FULL_PROGRESS, and the client colours cards off
 * progress, so a finished book imported at 0% renders as overdue/red.
 */
export async function insertProject(client, fields) {
  // The projects table has `id TEXT PRIMARY KEY` with no default — we
  // mint a `p-<nanoid>` here so the INSERT doesn't violate the not-null
  // constraint. The prefix keeps it visually distinct from user (u-…)
  // and order/handover ids, and nanoid(16) gives plenty of entropy for
  // a small-to-medium team.
  //
  // A caller-supplied `id` is honoured — the legacy import reuses the
  // REÇETE.xlsx seed id (`p-x1`) so the Ürün Bilgileri orphan row converts
  // in place instead of appearing twice. The route restricts which ids may
  // be passed; do NOT widen that without re-reading why.
  const projectId = fields.id ?? `p-${nanoid(16)}`
  const { rows } = await client.query(
    `INSERT INTO projects
       (id, title, type, stage, assigned_to, created_by, target_month,
        pass_number, pass_kind, progress, origin, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10, NOW(), NOW())
     RETURNING ${PROJECT_COLUMNS}, ${deliveredByNameSql('projects')}`,
    [
      projectId,
      fields.title,
      fields.type,
      fields.stage ?? 'tasarim',
      fields.assigned_to ?? null,
      fields.created_by ?? null,
      fields.target_month ?? null,
      fields.pass_kind ?? 'first_edition',
      fields.progress ?? 0,
      fields.origin ?? 'pipeline',
    ],
  )
  return rowToProject(rows[0])
}

function rowToProject(r) {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    stage: r.stage,
    assigned_to: r.assigned_to,
    assigned_name: null, // hydrated by /projects/:id detail route via the users table
    created_by: r.created_by,
    target_month: r.target_month,
    demo_attempt: r.demo_attempt,
    ozalit_attempt: r.ozalit_attempt,
    pass_number: r.pass_number,
    pass_kind: r.pass_kind,
    last_reject_reason: r.last_reject_reason,
    progress: r.progress,
    version: r.version,
    ozalit_leader_approved: r.ozalit_leader_approved,
    ozalit_leader_approved_by: r.ozalit_leader_approved_by,
    ozalit_leader_approved_at: r.ozalit_leader_approved_at instanceof Date
      ? r.ozalit_leader_approved_at.toISOString()
      : r.ozalit_leader_approved_at,
    ozalit_designer_approvals: r.ozalit_designer_approvals ?? [],
    demo_held: r.demo_held ?? false,
    demo_held_at: r.demo_held_at instanceof Date
      ? r.demo_held_at.toISOString()
      : r.demo_held_at,
    demo_held_by_name: r.demo_held_by_name ?? null,
    demo_received: r.demo_received ?? false,
    demo_received_by: r.demo_received_by ?? null,
    demo_received_at: r.demo_received_at instanceof Date
      ? r.demo_received_at.toISOString()
      : r.demo_received_at,
    ozalit_received: r.ozalit_received ?? false,
    ozalit_received_by: r.ozalit_received_by ?? null,
    ozalit_received_at: r.ozalit_received_at instanceof Date
      ? r.ozalit_received_at.toISOString()
      : r.ozalit_received_at,
    // Baskı Onay Formu dual-approval (migration 045): one team leader
    // prepares the form, a DIFFERENT one approves it. `_by` is a user id
    // (not just a name) so computeApproval can check "is the approver the
    // same person who prepared it".
    baski_onay_prepared: r.baski_onay_prepared ?? false,
    baski_onay_prepared_by: r.baski_onay_prepared_by ?? null,
    baski_onay_prepared_by_name: r.baski_onay_prepared_by_name ?? null,
    baski_onay_prepared_at: r.baski_onay_prepared_at instanceof Date
      ? r.baski_onay_prepared_at.toISOString()
      : r.baski_onay_prepared_at,
    demo_delivered_at: r.demo_delivered_at instanceof Date
      ? r.demo_delivered_at.toISOString()
      : r.demo_delivered_at,
    demo_delivered_by: r.demo_delivered_by ?? null,
    demo_delivered_by_name: r.demo_delivered_by_name ?? null,
    ozalit_requested: r.ozalit_requested ?? false,
    reject_target: r.reject_target ?? null,
    last_reject_type: r.last_reject_type ?? null,
    last_reject_target: r.last_reject_target ?? null,
    ozalit_approvals: r.ozalit_approvals ?? [],
    // Matbaa "Başladım" gate + pending change-request ledger (migration 048).
    demo_started: r.demo_started ?? false,
    demo_started_at: r.demo_started_at instanceof Date
      ? r.demo_started_at.toISOString()
      : r.demo_started_at,
    demo_started_by: r.demo_started_by ?? null,
    demo_started_by_name: r.demo_started_by_name ?? null,
    demo_change_requested_at: r.demo_change_requested_at instanceof Date
      ? r.demo_change_requested_at.toISOString()
      : r.demo_change_requested_at,
    demo_change_requested_by: r.demo_change_requested_by ?? null,
    demo_change_requested_by_name: r.demo_change_requested_by_name ?? null,
    demo_change_requested_note: r.demo_change_requested_note ?? null,
    demo_fix_pending: r.demo_fix_pending ?? false,
    ozalit_started: r.ozalit_started ?? false,
    ozalit_started_at: r.ozalit_started_at instanceof Date
      ? r.ozalit_started_at.toISOString()
      : r.ozalit_started_at,
    ozalit_started_by: r.ozalit_started_by ?? null,
    ozalit_started_by_name: r.ozalit_started_by_name ?? null,
    ozalit_change_requested_at: r.ozalit_change_requested_at instanceof Date
      ? r.ozalit_change_requested_at.toISOString()
      : r.ozalit_change_requested_at,
    ozalit_change_requested_by: r.ozalit_change_requested_by ?? null,
    ozalit_change_requested_by_name: r.ozalit_change_requested_by_name ?? null,
    ozalit_change_requested_note: r.ozalit_change_requested_note ?? null,
    ozalit_fix_pending: r.ozalit_fix_pending ?? false,
    // Ekran Demo Onayı pending-request ledger (migration 050).
    ekran_demo_requested_at: r.ekran_demo_requested_at instanceof Date
      ? r.ekran_demo_requested_at.toISOString()
      : r.ekran_demo_requested_at,
    ekran_demo_requested_by: r.ekran_demo_requested_by ?? null,
    ekran_demo_requested_by_name: r.ekran_demo_requested_by_name ?? null,
    // Ekran Ozalit (migration 061): plain boolean — round IS the request,
    // no separate pending state.
    ekran_ozalit: r.ekran_ozalit ?? false,
    // Per-parça approval ledgers (migrations 068/069/070). All default to
    // empty / {} — the per-parça check is "every parça in the latest
    // snapshot's `_selectedComponents` is recorded here", and an empty
    // ledger trivially satisfies that for projects with zero parçalar
    // (legacy single-product work).
    demo_parca_approvals: r.demo_parca_approvals ?? [],
    demo_parca_rejections: r.demo_parca_rejections ?? [],
    ozalit_parca_approvals: r.ozalit_parca_approvals ?? {},
    ozalit_parca_rejections: r.ozalit_parca_rejections ?? [],
    baski_parca_preparers: r.baski_parca_preparers ?? {},
    baski_parca_approvals: r.baski_parca_approvals ?? {},
    cin_baski_parca_preparers: r.cin_baski_parca_preparers ?? {},
    cin_baski_parca_approvals: r.cin_baski_parca_approvals ?? {},
    has_product_info: r.has_product_info ?? false,
    // 'pipeline' | 'legacy'. The client's projects store filters `legacy` out of
    // every pipeline view (Kanban, Tüm Projeler, counts) — see migration 031.
    origin: r.origin ?? 'pipeline',
    // Delisted from the Ürünler catalog by the team leader (migration 033).
    // The project is otherwise untouched — this only hides it from Sales.
    catalog_hidden: r.catalog_hidden ?? false,
    catalog_hidden_at: r.catalog_hidden_at instanceof Date
      ? r.catalog_hidden_at.toISOString()
      : r.catalog_hidden_at ?? null,
    catalog_hidden_by: r.catalog_hidden_by ?? null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    deleted_at: r.deleted_at instanceof Date ? r.deleted_at.toISOString() : r.deleted_at,
    deleted_by: r.deleted_by ?? null,
    deleted_by_name: r.deleted_by_name ?? null,
  }
}

/* ----------------------------- Barrel re-exports --------------------------- */

/**
 * `services/project-service.js`, `routes/subtasks.js`, etc. all do
 * `import { listProjectSubtasks, setSubtaskPage, … } from '../services/project-repository.js'`.
 * Keep that import shape working by re-exporting the subtask concern's
 * surface here. Zero lines change in any caller.
 */
export * from './subtask-repository.js'