import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { withTx } from '../db/pool.js'
import {
  getProject, getProjectForUpdate, patchProject, logHistory,
  listProjectSubtasks, listProjectHistory, loadProjectAssignees,
  setSubtaskDesignerCounts,
  refreshSubtaskPagesCounters,
} from '../services/project-repository.js'
import { schemas } from '../schemas/index.js'
import { subtaskProgress } from '../domain/progress.js'
import { progressFor } from '../domain/progress.js'

// How many names to spell out before switching to "+N". Three fits the
// timeline's single line at the widths the /projects/:id page actually uses.
const MAX_NAMES = 3

function listNames(names) {
  if (names.length <= MAX_NAMES) return names.join(', ')
  return `${names.slice(0, MAX_NAMES).join(', ')} +${names.length - MAX_NAMES}`
}

/**
 * Describe what a bulk subtask-list save actually changed, or return null if
 * it changed nothing.
 *
 * Every other subtask event names its subtask ("Kapak — tamamlandı"), but
 * this one used to log a bare count — `Alt görev listesi güncellendi (5
 * görev)` — so a leader who opened the editor and saved five times left five
 * identical, contentless rows in the timeline with no way to tell what any
 * of them did. Two fixes here: say which subtasks moved, and return null for
 * a no-op save so the row is never written in the first place.
 *
 * Identity is the title, because that's the only handle the user has: the
 * PUT replaces every row, so incoming subtasks have no id to match on. A
 * rename therefore reads as one addition plus one removal, which is honest —
 * without stable ids we genuinely cannot distinguish a rename from a swap.
 */
export function describeSubtaskListChange(before, after) {
  const beforeByTitle = new Map(before.map((s) => [s.title, s]))
  const afterTitles = new Set(after.map((s) => s.title))

  const added = after.filter((s) => !beforeByTitle.has(s.title)).map((s) => s.title)
  const removed = before.filter((s) => !afterTitles.has(s.title)).map((s) => s.title)

  // Metadata edits on subtasks that survived the save — a page count going
  // 12 → 16 is a real change the timeline should record, and it's invisible
  // in an added/removed diff.
  const changed = []
  for (const s of after) {
    const old = beforeByTitle.get(s.title)
    if (!old) continue
    const bits = []
    if ((old.total_pages ?? null) !== (s.total_pages ?? null)) {
      bits.push(`sayfa ${old.total_pages ?? '—'} → ${s.total_pages ?? '—'}`)
    }
    if ((old.total_stickers ?? null) !== (s.total_stickers ?? null)) {
      bits.push(`etiket ${old.total_stickers ?? '—'} → ${s.total_stickers ?? '—'}`)
    }
    if ((old.assigned_to ?? null) !== (s.assigned_to ?? null)) {
      // Reopen-on-reassign: if the previous row was is_done=true and the
      // new row is is_done=false, the leader's reassignment of a
      // completed alt görev is what triggered the reopen. The
      // timeline bit is the only place this intent is recorded —
      // a plain "atama değişti" would leave the team wondering why
      // a previously-finished alt görev is suddenly back in the
      // queue, so the bit names the cause explicitly.
      bits.push(
        old.is_done && !s.is_done
          ? 'atama değişti, yeniden yapılacak'
          : 'atama değişti',
      )
    }
    if (bits.length) changed.push(`${s.title} (${bits.join(', ')})`)
  }

  const parts = []
  if (added.length) parts.push(`Eklendi: ${listNames(added)}`)
  if (removed.length) parts.push(`Çıkarıldı: ${listNames(removed)}`)
  if (changed.length) parts.push(`Güncellendi: ${listNames(changed)}`)
  if (parts.length === 0) return null

  const note = parts.join(' · ')
  // Same 200-char ceiling the designer-note handler uses, so one project with
  // forty renamed subtasks can't write a paragraph into the column.
  return note.length > 200 ? `${note.slice(0, 199)}…` : note
}

/**
 * Subtask API.
 *
 * PATCH /api/subtasks/:id                    — toggle or update fields
 * POST  /api/subtasks/:id/updates            — append a designer note
 * POST  /api/subtasks/:id/revize             — designer clears `needs_revize`
 * PUT   /api/projects/:id/subtasks           — team_leader bulk replaces the list
 * PATCH /api/subtasks/:id/designer-counts    — designer pages-done input (migration 067)
 *
 * Per-chip PATCH /subtasks/:id/pages/:pageIndex and the
 * per-page ASSIGN / BULK-ASSIGN routes are gone — chip-grid UX is gone.
 * Pages are now entered as a number per assigned designer.
 *
 * `subtasks.pages_done` and `subtasks.is_done` are derived from
 * `subtask_designer_counts` via a trigger (see migration 067), so this
 * file never writes them directly. `progressFor` and `progress` on
 * `projects` are recomputed in the same transaction so the project
 * progress bar reflects the change without a follow-up GET.
 */
export async function subtaskRoutes(fastify) {
  fastify.patch('/subtasks/:id', { schema: schemas.subtasksPatch }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const { rows: subRows } = await client.query(
        'SELECT * FROM subtasks WHERE id = $1 FOR UPDATE', [request.params.id],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      const project = await getProjectForUpdate(client, sub.project_id)
      const allowed = {}
      let isDoneChanged = false
      let pagesChanged = false
      let stickersChanged = false
      if (typeof request.body.is_done === 'boolean') {
        allowed.is_done = request.body.is_done
        allowed.done_at = request.body.is_done ? new Date().toISOString() : null
        isDoneChanged = request.body.is_done !== sub.is_done
      }
      if (Number.isFinite(request.body.pages_done)) {
        if (sub.total_pages != null && request.body.pages_done > sub.total_pages) {
          badRequest(`İç sayfalar toplam iç sayfa sayısını (${sub.total_pages}) aşamaz.`)
        }
        allowed.pages_done = request.body.pages_done
        pagesChanged = request.body.pages_done !== sub.pages_done
      }
      if (Number.isFinite(request.body.stickers_done)) {
        if (sub.total_stickers != null && request.body.stickers_done > sub.total_stickers) {
          badRequest(`Etiket sayısı toplam etiket sayısını (${sub.total_stickers}) aşamaz.`)
        }
        allowed.stickers_done = request.body.stickers_done
        stickersChanged = request.body.stickers_done !== sub.stickers_done
      }
      // Rework flag. Same ownership rules as POST /subtasks/:id/revize: this
      // is the designer's own judgement about their own work, so the team
      // leader and matbaa cannot set it from here (the leader flags rework by
      // rejecting, which routes through computeRejection instead).
      if (typeof request.body.needs_revize === 'boolean') {
        if (request.user.role !== 'designer') {
          badRequest('Revize işaretini yalnızca tasarımcı değiştirebilir.')
        }
        if (sub.assigned_to && sub.assigned_to !== request.user.id) {
          badRequest('Bu alt görev size atanmadı.')
        }
        allowed.needs_revize = request.body.needs_revize
      }
      if (Object.keys(allowed).length === 0) badRequest('Geçerli alan yok.')
      // kind='pages' subtasks are driven exclusively by
      // PATCH /subtasks/:id/designer-counts; the per-chip PATCH is gone.
      // Refuse a direct pages_done write on a pages subtask here so a stale
      // SPA that still uses the old toggle can't desync the trigger-derived
      // pages_done from the underlying counts.
      if (sub.kind === 'pages'
        && (pagesChanged || stickersChanged)) {
        badRequest('İç sayfalar için tasarımcı sayısı kullanılır.')
      }
      const cols = Object.keys(allowed)
      const setSql = cols.map((c, i) => `${c} = $${i + 2}`).join(', ')
      const { rows: updatedSub } = await client.query(
        `UPDATE subtasks SET ${setSql}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [sub.id, ...cols.map((c) => allowed[c])],
      )
      const { rows: projectSubs } = await client.query(
        'SELECT * FROM subtasks WHERE project_id = $1', [project.id],
      )
      const progress = progressFor(project, projectSubs)
      // Pass the locked row's version as the SQL-level OCC guard so a
      // concurrent writer that raced past `getProjectForUpdate` (admin
      // script, future non-locking path) can't silently overwrite. Same
      // `expectedVersion` contract the `runProjectCommand` orchestrator
      // uses for FSM-driven writes.
      const updProject = await patchProject(
        client,
        project.id,
        { progress },
        { expectedVersion: project.version },
      )
      // The project timeline is the single source of truth for "who did
      // what". We tag every subtask change with a fine-grained event so
      // the UI can pick the right icon (check toggle vs. page counter vs.
      // sticker counter vs. note). Skipping the history row when nothing
      // actually changed keeps the timeline clean.
      if (isDoneChanged) {
        await logHistory(
          client,
          {
            project_id: project.id,
            from_stage: project.stage,
            to_stage: project.stage,
            action: 'system',
            event: request.body.is_done ? 'subtask_done' : 'subtask_undone',
            note: `${sub.title}, ${request.body.is_done ? 'tamamlandı' : 'tamamlanmadı olarak işaretlendi'}`,
          },
          request.user,
        )
      }
      if (pagesChanged) {
        await logHistory(
          client,
          {
            project_id: project.id,
            from_stage: project.stage,
            to_stage: project.stage,
            action: 'system',
            event: 'subtask_progress',
            note: `${sub.title}, sayfa ${request.body.pages_done}/${sub.total_pages ?? '?'}`,
          },
          request.user,
        )
      }
      if (stickersChanged) {
        await logHistory(
          client,
          {
            project_id: project.id,
            from_stage: project.stage,
            to_stage: project.stage,
            action: 'system',
            event: 'subtask_progress',
            note: `${sub.title}, etiket ${request.body.stickers_done}/${sub.total_stickers ?? '?'}`,
          },
          request.user,
        )
      }
      // The client merges this straight into its project state (no
      // follow-up GET), so it needs the same shape as GET /projects/:id —
      // subtasks/history/assignees included, not just the bare row —
      // otherwise addCount's setProject() wipes the Alt Görevler/Geçmiş/
      // Tasarımcı cards until the page is manually refreshed.
      const subtasksList = await listProjectSubtasks(client, project.id)
      const history = await listProjectHistory(client, project.id)
      const assignees = await loadProjectAssignees(client, updProject)
      return {
        subtask: updatedSub[0],
        project: {
          ...updProject,
          assignees,
          assigned_name: assignees.map((a) => a.name).join(', ') || updProject.assigned_name || '—',
          subtasks: subtasksList,
          history,
        },
      }
    })
    // Returning the full project so the client can refresh its tile without
    // a follow-up GET.
    return result.project
  })

  // Designer marks a flagged subtask as revised. The subtask stays complete
  // (progress unchanged) — this only clears the needs_revize flag and logs a
  // timeline entry. Once every flagged subtask is revized the designer can
  // resubmit (the advance route enforces the same gate).
  fastify.post('/subtasks/:id/revize', { schema: schemas.subtasksRevize }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const { rows: subRows } = await client.query(
        'SELECT * FROM subtasks WHERE id = $1 FOR UPDATE', [request.params.id],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      if (!sub.needs_revize) badRequest('Bu alt görev revize beklemiyor.')
      // Revize is the designer's rework acknowledgment — only the assigned
      // designer may do it (the team leader / matbaa never revize).
      if (request.user.role !== 'designer') {
        badRequest('Revize işlemini yalnızca tasarımcı yapabilir.')
      }
      if (sub.assigned_to && sub.assigned_to !== request.user.id) {
        badRequest('Bu alt görev size atanmadı.')
      }
      const project = await getProjectForUpdate(client, sub.project_id)
      await client.query(
        'UPDATE subtasks SET needs_revize = FALSE, updated_at = NOW() WHERE id = $1', [sub.id],
      )
      await logHistory(
        client,
        {
          project_id: project.id,
          from_stage: project.stage,
          to_stage: project.stage,
          action: 'system',
          event: 'subtask_revize',
          note: `${sub.title}, revize edildi`,
        },
        request.user,
      )
      return getProject(sub.project_id)
    })
    return result
  })

  fastify.post('/subtasks/:id/updates', { schema: schemas.subtasksUpdates }, async (request) => {
    await attachUser(request)
    const { note } = request.body
    const result = await withTx(async (client) => {
      const { rows: subRows } = await client.query(
        'SELECT id, project_id, title FROM subtasks WHERE id = $1', [request.params.id],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      const { rows } = await client.query(
        `INSERT INTO subtask_updates (subtask_id, note, author_id)
         VALUES ($1,$2,$3) RETURNING *`,
        [sub.id, note, request.user.id],
      )
      const project = await getProjectForUpdate(client, sub.project_id)
      // Append a project-level history entry so the timeline captures the
      // what-changed note alongside the subtask_updates row. Truncated to
      // 200 chars so a fat paragraph doesn't blow up the column.
      await logHistory(
        client,
        {
          project_id: project.id,
          from_stage: project.stage,
          to_stage: project.stage,
          action: 'system',
          event: 'subtask_note',
          note: `${sub.title}, ${note.length > 200 ? note.slice(0, 200) + '…' : note}`,
        },
        request.user,
      )
      // Same shape requirement as PATCH /subtasks/:id above — saveUpdateSub
      // merges `project.subtasks` straight into client state.
      const subtasksList = await listProjectSubtasks(client, project.id)
      const history = await listProjectHistory(client, project.id)
      const assignees = await loadProjectAssignees(client, project)
      return {
        project: {
          ...project,
          assignees,
          assigned_name: assignees.map((a) => a.name).join(', ') || project.assigned_name || '—',
          subtasks: subtasksList,
          history,
        },
        entry: rows[0],
      }
    })
    return result
  })

  fastify.put('/projects/:id/subtasks', { schema: schemas.projectsSubtasksPut }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const project = await getProject(request.params.id)
    if (!project) notFound('Proje bulunamadı.')
    const subtasks = request.body.subtasks
    // Orphan-designer check: when the leader's full assignee list is in
    // the body, every designer except the first (which becomes the
    // project primary) must be on at least one subtask in this same
    // payload. Without this guard a leader could add a designer via the
    // chip-grid picker in the dialog, forget to drop them onto a
    // subtask, and end up with someone in the project's `assignees`
    // list who is on no work — invisible to the chip grid, unreachable
    // for the work queue, no notifications fired for them. The check
    // runs BEFORE the writes so the transaction is aborted on failure.
    const declaredAssignees = Array.isArray(request.body.assignees)
      ? request.body.assignees
      : null
    if (declaredAssignees) {
      const subAssigneeIds = new Set(
        subtasks
          .map((s) => s.assigned_to)
          .filter(Boolean),
      )
      // The first id in `assignees` is the project primary (the PATCH
      // route's behaviour, mirrored here for the validation's sake so
      // we don't flag the primary as orphan).
      const primaryAssignee = declaredAssignees[0] ?? null
      for (const id of declaredAssignees) {
        if (id === primaryAssignee) continue
        if (subAssigneeIds.has(id)) continue
        badRequest(
          `Tasarımcı atanmamış: ${id}. Listeye eklediğiniz her tasarımcı en az bir alt göreve atanmalı.`,
        )
      }
    }
    const result = await withTx(async (client) => {
      // Lock the project inside the tx so the SQL-level OCC guard on the
      // later patchProject matches a version that no concurrent writer
      // can mutate underneath us. The earlier non-locking `getProject`
      // read above is only used for the orphan-designer guard.
      const lockedProject = await getProjectForUpdate(client, project.id)
      // ── Reconcile, don't recreate ──────────────────────────────────
      //
      // This route used to DELETE every subtask and re-INSERT the whole
      // list. The team leader edits the SHAPE of the list here (titles,
      // kinds, totals, assignment) — but the recreate also silently threw
      // away everything the DESIGNERS owned on those rows:
      //
      //   • is_done                     reset to false
      //   • pages_done / stickers_done   reset to 0
      //   • needs_revize                 cleared, so flagged rework vanished
      //   • done_at                      lost
      //   • subtask_updates              DELETED — the notes table FKs to
      //                                  subtasks.id ON DELETE CASCADE, so a
      //                                  save wiped every note on the project
      //
      // Updating survivors in place keeps their id, which is what saves the
      // notes; the columns above are simply never touched by this route.
      //
      // is_done and pages_done are derived columns kept in sync by the
      // migration 067 trigger on `subtask_designer_counts` — this route
      // never writes them directly. Per-designer page counts persist
      // across leader edits since they live in a separate table; the
      // chip-grid's "reset everything on rename" hazard is gone with the
      // chip grid.
      const { rows: previous } = await client.query(
        `SELECT id, title, kind, total_pages, total_stickers, assigned_to, is_done
           FROM subtasks WHERE project_id = $1 ORDER BY position, created_at`,
        [project.id],
      )

      // Match by id first, falling back to title for payloads that carry no
      // ids (and for rows the leader just added). Title-only matching made a
      // RENAME look like "delete + create": the new row lost the designer's
      // counters and, because subtask_updates FKs ON DELETE CASCADE, every
      // note on that subtask went with it. Consumed on match so two incoming
      // rows can't both claim one survivor.
      const byId = new Map()
      const byTitle = new Map()
      for (const p of previous) {
        byId.set(p.id, p)
        if (!byTitle.has(p.title)) byTitle.set(p.title, p)
      }
      const claim = (s) => {
        const hit = (s.id && byId.get(s.id)) || byTitle.get(s.title)
        if (!hit) return null
        byId.delete(hit.id)
        if (byTitle.get(hit.title) === hit) byTitle.delete(hit.title)
        return hit
      }

      const finalRows = []
      const keptIds = []

      for (const [index, s] of subtasks.entries()) {
        // Per-subtask designer override from the editor. Falls back to the
        // project's primary `assigned_to` so a subtask is never ownerless.
        const subAssignee = s.assigned_to ?? project.assigned_to ?? null
        const existing = claim(s)
        // NOTE: `is_done` is intentionally absent from this param list. The
        // designer's work state is owned by the toggle and the
        // /designer-counts endpoint and must not be writable from the bulk
        // reconcile — see the block comment at the top of the route.
        // Clients that post it are silently ignored.
        const params = [
          s.title,
          s.kind ?? 'check',
          s.total_pages ?? null,
          s.total_stickers ?? null,
          subAssignee,
          index,
        ]

        if (existing) {
          const { rows } = await client.query(
            `UPDATE subtasks
                SET title = $2, kind = $3, total_pages = $4, total_stickers = $5,
                    assigned_to = $6, position = $7,
                    -- The done flag is intentionally NOT in the SET clause:
                    -- the designer's work state is owned by the per-row
                    -- toggle route and the designer-counts endpoint.
                    -- done_at follows the column (keep when the flag is
                    -- set, clear when it is not) so the two stay in
                    -- lock-step — a row that has somehow been cleared
                    -- outside this route still has its done_at nulled on
                    -- the next save.
                    done_at = CASE WHEN is_done THEN done_at ELSE NULL END,
                    updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [existing.id, ...params],
          )
          finalRows.push(rows[0])
          keptIds.push(existing.id)
        } else {
          const { rows } = await client.query(
            `INSERT INTO subtasks
               (project_id, title, kind, total_pages, total_stickers, assigned_to, position)
             -- The done flag is omitted: the column defaults to FALSE in
             -- migration 003, and brand-new subtasks have no designer
             -- work to credit. Keep the column out of the column list
             -- AND the VALUES list so future readers don't see the
             -- route as a legitimate writer of designer state.
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [project.id, ...params],
          )
          finalRows.push(rows[0])
          keptIds.push(rows[0].id)
          // migration 067 — for a brand-new kind='pages' subtask the
          // designer-counts slot is pre-created here so the SPA
          // doesn't have to send a zero-write first to materialise it.
          if (rows[0].kind === 'pages' && Number(rows[0].total_pages) > 0 && subAssignee) {
            await client.query(
              `INSERT INTO subtask_designer_counts (subtask_id, designer_id, pages_done)
               VALUES ($1, $2, 0)
               ON CONFLICT (subtask_id, designer_id) DO NOTHING`,
              [rows[0].id, subAssignee],
            )
          }
        }
      }

      // Only rows the leader actually removed are deleted — and those SHOULD
      // take their notes with them, which the existing cascade handles.
      await client.query(
        `DELETE FROM subtasks
          WHERE project_id = $1 AND NOT (id = ANY($2::text[]))`,
        [project.id, keptIds],
      )

      // ── Reopen done work when the leader reassigns the owner ───────────────
      //
      // The leader's reassignment of a completed alt görev implies "the
      // new owner has to redo this." For kind='check' we flip is_done
      // straight back to false. For kind='pages' we no longer have per-
      // page rows to flip — instead we pre-create the new owner's
      // designer-counts row at 0; existing counts are kept (they
      // represent who actually shipped the pages and stay in the audit
      // trail), and the trigger on subtask_designer_counts recomputes
      // subtasks.pages_done / is_done from the row set. Net effect: a
      // leader handover of a previously-completed pages subtask spawns
      // a fresh "0" slot for the new owner without disturbing the
      // previous owner's record.
      const previousById = new Map(previous.map((p) => [p.id, p]))
      for (const row of finalRows) {
        if (row.kind !== 'check' && row.kind !== 'pages') continue
        const prev = previousById.get(row.id)
        if (!prev) continue                // brand-new subtask, no reopen to do
        if (prev.assigned_to === row.assigned_to) continue  // assignee didn't move
        if (!prev.is_done) continue        // wasn't done, no work to reopen
        if (row.kind === 'check') {
          await client.query(
            `UPDATE subtasks
                SET is_done = false,
                    done_at = NULL,
                    updated_at = NOW()
              WHERE id = $1`,
            [row.id],
          )
        } else {
          // kind='pages' — pre-create the new owner's slot at 0. ON
          // CONFLICT leaves an existing slot alone (the leader picked
          // someone who already had a slot; nothing to reset).
          await client.query(
            `INSERT INTO subtask_designer_counts (subtask_id, designer_id, pages_done)
             VALUES ($1, $2, 0)
             ON CONFLICT (subtask_id, designer_id) DO NOTHING`,
            [row.id, row.assigned_to],
          )
          // The trigger on subtask_designer_counts runs on the INSERT and
          // refreshes pages_done / is_done on the subtask row. Nothing
          // else to do here.
        }
      }

      // Re-SELECT the rows so `inserted` carries the post-reopen is_done
      // and pages_done values. Without this the in-memory finalRows would
      // still describe a "done" subtask the DB now says is "not done",
      // and the response the SPA merges into state would lie.
      const { rows: refreshedRows } = await client.query(
        `SELECT id, title, kind, is_done, total_pages, pages_done,
                total_stickers, stickers_done, assigned_to, done_at,
                needs_revize, position, created_at, updated_at
           FROM subtasks
          WHERE project_id = $1
          ORDER BY position, created_at`,
        [project.id],
      )
      const inserted = refreshedRows
      const progress = progressFor(project, inserted)
      // SQL-level OCC guard: refuse the write if the project's version
      // moved between the lock at the top of this tx and now. A concurrent
      // writer that raced past us would have bumped version, so the WHERE
      // guard catches it and surfaces a 409 with the same Turkish message
      // the entity-level guard uses.
      const updated = await patchProject(
        client,
        project.id,
        { progress },
        { expectedVersion: lockedProject.version },
      )
      // Only log when something actually moved. Opening the editor and
      // hitting save is not an event, and the old unconditional write is
      // exactly how a project ends up with eight identical timeline rows.
      const summary = describeSubtaskListChange(previous, inserted)
      if (summary) {
        await logHistory(
          client,
          {
            project_id: project.id,
            from_stage: project.stage,
            to_stage: project.stage,
            action: 'system',
            event: 'subtask_list_update',
            note: summary,
          },
          request.user,
        )
      }
      return { project: updated, subtasks: inserted, progress }
    })
    return result
  })

  /**
   * PATCH /api/subtasks/:id/designer-counts
   *
   * The designer-facing write for the "İç Sayfalar" subtask (migration
   * 067). Replaces the per-chip PATCH /subtasks/:id/pages/:pageIndex
   * route — designers no longer click chips one at a time; they enter
   * the page count they shipped into a per-designer input and save.
   *
   * Body: `{ counts: [{ designer_id, pages_done }, ...] }`. Multiple
   * slots can be updated in one call (the leader may correct several
   * designers' counts at once on a handover), but every entry maps to
   * exactly one (subtask, designer) row.
   *
   * Gating:
   *   • team_leader role may edit any slot;
   *   • designer role may edit only their own slot (the body must
   *     contain exactly their designer_id, and the slot must exist on
   *     this subtask or be insertable via ON CONFLICT).
   *
   * Inside the transaction:
   *   1. Lock the subtask (FOR UPDATE) and the parent project.
   *   2. Validate the body — every designer_id is a known user with
   *      role='designer' AND is_active=true; every pages_done is a
   *      non-negative integer ≤ the subtask's total_pages (the latter
   *      isn't enforced by the column CHECK because that's a per-row
   *      cap; the per-subtask cap is the route's responsibility).
   *   3. setSubtaskDesignerCounts — single UPSERT that triggers the
   *      subtask-pages counter recompute (subtasks.pages_done /
   *      is_done handled by migration 067's trigger).
   *   4. refreshSubtaskPagesCounters — explicit recompute inside the
   *      same tx so the response carries the post-write totals without
   *      a follow-up SELECT (the trigger agrees, but the route wants
   *      them in the same response).
   *   5. patchProject with the recomputed progress.
   *   6. logHistory — one summary row per save, e.g.
   *      "İç Sayfalar: Ayşe 12, Gönül 8 sayfa tamamlandı". Skipped when
   *      every entry is a no-op (same pages_done as already on disk).
   *
   * Returns a slim shape so the SPA can merge into state without
   * hitting /projects/:id for the full payload:
   *   { subtask_id, project_id, total_pages, pages_done, is_done,
   *     designer_counts: [{ designer_id, designer_name, pages_done }],
   *     project_progress, project: { id, progress, version } }
   *
   * The SPA's `setProject` on project detail can still tolerate the
   * full project response (PATCH /subtasks/:id returns it for the
   * `is_done` toggle case), so we include a `project` fragment here
   * too — just the columns the consuming components need to update
   * the header bar in place.
   */
  fastify.patch('/subtasks/:id/designer-counts', {
    schema: schemas.subtasksDesignerCountsPatch,
  }, async (request) => {
    await attachUser(request)
    const subtaskId = request.params.id
    const counts = Array.isArray(request.body?.counts) ? request.body.counts : []

    const result = await withTx(async (client) => {
      const { rows: subRows } = await client.query(
        'SELECT id, project_id, title, kind, total_pages FROM subtasks WHERE id = $1 FOR UPDATE',
        [subtaskId],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      if (sub.kind !== 'pages') {
        badRequest('Bu alt görev "İç Sayfalar" türünde değil.')
      }
      const total = Number(sub.total_pages ?? 0)
      const project = await getProjectForUpdate(client, sub.project_id)
      if (!project) notFound('Proje bulunamadı.')

      // Validate the body before any writes. Designer may only touch
      // their own row; team_leader may touch any (and may add a brand-new
      // designer slot by listing someone whose row didn't exist yet).
      const isLeader = request.user.role === 'team_leader'
      if (!isLeader && request.user.role !== 'designer') {
        badRequest('Yalnızca ekip lideri veya tasarımcı sayfa sayısını güncelleyebilir.')
      }
      if (counts.length === 0) badRequest('En az bir tasarımcı sayısı gerekli.')
      const seen = new Set()
      const cleaned = []
      for (const c of counts) {
        const designerId = String(c?.designer_id ?? '').trim()
        if (!designerId) badRequest('designer_id gerekli.')
        if (seen.has(designerId)) badRequest('Aynı tasarımcı için birden fazla girdi olamaz.')
        seen.add(designerId)
        const raw = Number(c?.pages_done)
        if (!Number.isFinite(raw)) badRequest('pages_done bir sayı olmalı.')
        const pagesDone = Math.max(0, Math.floor(raw))
        if (!isLeader && designerId !== request.user.id) {
          badRequest('Yalnızca kendi sayınızı güncelleyebilirsiniz.')
        }
        // Per-row cap: each designer's individual count can't exceed
        // the subtask's total. The summed-cap check lives in the
        // trigger (recompute_subtask_pages_counter). Negative inputs
        // are clamped to 0 above; a per-row cap ensures a designer
        // can't accidentally type `total * designers` and inflate the
        // subtask's progress.
        if (total > 0 && pagesDone > total) {
          badRequest(`pages_done (${pagesDone}) total_pages (${total}) değerinden büyük olamaz.`)
        }
        cleaned.push({ designer_id: designerId, pages_done: pagesDone })
      }
      // Verify every designer_id exists with role=designer and is
      // active. A single batched SELECT keeps the per-call round-trip
      // count low — the same pattern the bulk-assign route uses.
      const { rows: validUsers } = await client.query(
        `SELECT id FROM users
          WHERE id = ANY($1::text[])
            AND role = 'designer'
            AND is_active = true`,
        [cleaned.map((c) => c.designer_id)],
      )
      const validIds = new Set(validUsers.map((r) => r.id))
      for (const c of cleaned) {
        if (!validIds.has(c.designer_id)) {
          badRequest(`Tasarımcı bulunamadı veya aktif değil: ${c.designer_id}`)
        }
      }

      // Snapshot previous counts so the history row can describe the
      // diff (e.g. "Ayşe 8 → 12") instead of the absolute new value.
      const { rows: priorRows } = await client.query(
        `SELECT designer_id, pages_done FROM subtask_designer_counts WHERE subtask_id = $1`,
        [subtaskId],
      )
      const prior = new Map(priorRows.map((r) => [r.designer_id, Number(r.pages_done)]))

      // Single UPSERT per batch. The trigger recomputes
      // subtasks.pages_done / is_done on every row written; we also
      // call refreshSubtaskPagesCounters below so the response shape
      // carries the post-write totals without a follow-up SELECT.
      await setSubtaskDesignerCounts(client, { subtaskId, counts: cleaned })
      const refreshed = await refreshSubtaskPagesCounters(client, subtaskId)

      // Read back the full counts so the response + history row describe
      // every slot (not just the ones in this save).
      const { rows: postRows } = await client.query(
        `SELECT sdc.designer_id, sdc.pages_done, u.name AS designer_name
           FROM subtask_designer_counts sdc
           LEFT JOIN users u ON u.id = sdc.designer_id
          WHERE sdc.subtask_id = $1
          ORDER BY u.name NULLS LAST, sdc.designer_id`,
        [subtaskId],
      )

      const { rows: projectSubs } = await client.query(
        'SELECT * FROM subtasks WHERE project_id = $1', [project.id],
      )
      const progress = progressFor(project, projectSubs)
      // SQL-level OCC guard: refuse the write if the project's version
      // moved between the lock at the top of this tx and now. Same
      // contract every other subtask-mutation route uses.
      const updProject = await patchProject(
        client,
        project.id,
        { progress },
        { expectedVersion: project.version },
      )

      // One history row summarising the diff. Skip when nothing moved —
      // opening the editor and saving twice with the same values used
      // to leave two identical rows in the timeline (the old per-chip
      // route had the same kind of leak, just at a smaller cadence).
      const diffs = cleaned
        .map((c) => {
          const before = prior.get(c.designer_id) ?? 0
          if (before === c.pages_done) return null
          return { designer_id: c.designer_id, before, after: c.pages_done }
        })
        .filter(Boolean)
      if (diffs.length > 0) {
        const label = (id) => {
          const found = postRows.find((r) => r.designer_id === id)
          return found?.designer_name ?? id
        }
        const note = diffs.map((d) => (
          d.before === 0
            ? `${label(d.designer_id)} ${d.after} sayfa`
            : `${label(d.designer_id)} ${d.before} → ${d.after} sayfa`
        )).join(' · ')
        await logHistory(
          client,
          {
            project_id: project.id,
            from_stage: project.stage,
            to_stage: project.stage,
            action: 'system',
            event: 'subtask_progress',
            note: `${sub.title}: ${note}`,
          },
          request.user,
        )
      }

      return {
        subtask_id: subtaskId,
        project_id: project.id,
        total_pages: total,
        pages_done: refreshed?.pages_done ?? 0,
        is_done: refreshed?.is_done ?? false,
        designer_counts: postRows.map((r) => ({
          designer_id: r.designer_id,
          designer_name: r.designer_name ?? null,
          pages_done: r.pages_done,
        })),
        project_progress: progress,
        project: {
          id: updProject.id,
          progress: updProject.progress,
          version: updProject.version,
        },
      }
    })
    return result
  })
}
