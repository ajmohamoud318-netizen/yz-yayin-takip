import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { withTx } from '../db/pool.js'
import {
  getProject, getProjectForUpdate, patchProject, logHistory,
  listProjectSubtasks, listProjectHistory, loadProjectAssignees,
  addSubtaskDesignerBatch,
  markSubtaskDesignerBatchRedone,
  loadSubtaskDesignerBatches,
  getSubtaskDesignerBatches,
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
 * PATCH /api/subtasks/:id                       — toggle or update fields
 * POST  /api/subtasks/:id/updates               — append a designer note
 * POST  /api/subtasks/:id/revize                — designer clears `needs_revize`
 * PUT   /api/projects/:id/subtasks              — team_leader bulk replaces the list
 * POST  /api/subtasks/:id/designer-batches      — append one batch row (migration 067)
 * POST  /api/subtasks/:id/designer-batches/:id/redone
 *                                              — stamp "Yeniden Çalıştım" on a batch
 *
 * Per-chip PATCH /subtasks/:id/pages/:pageIndex and the
 * per-page ASSIGN / BULK-ASSIGN routes are gone — chip-grid UX is gone.
 * Pages are entered as a session log of "+N ekledim" batches; the running
 * total on the parent subtask row is the SUM of every batch.
 *
 * `subtasks.pages_done` and `subtasks.is_done` are derived from
 * `subtask_designer_batches` via a trigger (see migration 067), so this
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
      // POST /subtasks/:id/designer-batches; the per-chip PATCH is gone.
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
      // migration 067 trigger on `subtask_designer_batches` — this route
      // never writes them directly. Per-designer batch rows persist
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
      // straight back to false. For kind='pages' the new owner
      // starts clean on their first /designer-batches POST — every
      // batch row that already exists stays attributed to its
      // original designer (audit trail), and the new designer's
      // contribution is a fresh batch, not a re-stamp of the old
      // total. The trigger on subtask_designer_batches recomputes
      // subtasks.pages_done / is_done from the live row set, which
      // already excludes the previous owner's contribution once
      // their rows are migrated away — except that, in this
      // implementation, we LEAVE the previous owner's rows in
      // place (they did the work, the audit trail says so). The
      // net effect: a leader handover of a previously-completed
      // pages subtask spawns a fresh contribution for the new owner
      // without disturbing the previous owner's record, and the
      // sum drives pages_done / is_done exactly the same way.
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
        }
        // kind='pages' is a no-op here: the new designer's first
        // /designer-batches POST will create their first batch from
        // a clean slate, and existing owner rows are preserved.
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
   * POST /api/subtasks/:id/designer-batches
   *
   * Designer-facing write for the "İç Sayfalar" subtask (migration
   * 067). Replaces the per-chip PATCH /subtasks/:id/pages/:pageIndex
   * route: each save creates ONE batch row, the running total on the
   * subtask is the SUM of every batch's `pages` (kept in sync by the
   * `recompute_subtask_pages_counter` trigger). Designers can sit
   * down, ship 8 pages, save → a tickbox appears in the team's
   * daily log; ship another 3, save → another tick. The first batch
   * of 8 doesn't vanish when the second arrives.
   *
   * Body: `{ designer_id: string, pages: number }`. The route
   * ignores multi-row payloads (one POST = one tickbox). The leader
   * can correct multiple designers' numbers with separate calls.
   *
   * Gating:
   *   • team_leader role may add a batch for any active designer;
   *   • designer role may add a batch only for themselves (the body's
   *     designer_id must match their own id).
   *
   * Inside the transaction:
   *   1. Lock the subtask (FOR UPDATE) and the parent project.
   *   2. Validate the body — `designer_id` is an active designer;
   *     `pages` is a positive integer ≤ the subtask's total_pages
   *     (a designer can ship at most one full book in one go; the
   *     cumulative sum is allowed to grow past total_pages because
   *     the leader can raise total_pages mid-stream without
   *     orphaning prior batches).
   *   3. addSubtaskDesignerBatch — single INSERT that triggers the
   *      subtask-pages counter recompute (subtasks.pages_done /
   *      is_done handled by migration 067's trigger).
   *   4. patchProject with the recomputed progress (refreshed inside
   *      the trigger, no extra SELECT needed beyond the row we
   *      already touched for the lock).
   *   5. logHistory — one row per save, e.g.
   *      "İç Sayfalar: Ayşe +8 sayfa ekledi". This is read on
   *      everything but no-ops on nothing.
   *
   * Returns a slim shape so the SPA can merge into state without
   * hitting /projects/:id for the full payload:
   *   { subtask_id, project_id, total_pages, pages_done, is_done,
   *     batch: { id, designer_id, designer_name, pages, created_at },
   *     project_progress, project: { id, progress, version } }
   */
  fastify.post('/subtasks/:id/designer-batches', {
    schema: schemas.subtasksDesignerBatchCreate,
  }, async (request) => {
    await attachUser(request)
    const subtaskId = request.params.id
    const designerId = String(request.body?.designer_id ?? '').trim()
    const pagesRaw = Number(request.body?.pages)
    if (!designerId) badRequest('designer_id gerekli.')
    if (!Number.isFinite(pagesRaw)) badRequest('pages bir sayı olmalı.')

    const result = await withTx(async (client) => {
      const { rows: subRows } = await client.query(
        'SELECT id, project_id, title, kind, total_pages, pages_done FROM subtasks WHERE id = $1 FOR UPDATE',
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

      const isLeader = request.user.role === 'team_leader'
      if (!isLeader && request.user.role !== 'designer') {
        badRequest('Yalnızca ekip lideri veya tasarımcı sayfa ekleyebilir.')
      }
      if (!isLeader && designerId !== request.user.id) {
        badRequest('Yalnızca kendi adınıza sayfa ekleyebilirsiniz.')
      }
      // The column CHECK refuses non-positive inputs; the route returns
      // a friendlier error before the INSERT fails with a bare
      // constraint violation.
      const pages = Math.floor(pagesRaw)
      if (pages <= 0) badRequest('pages sıfırdan büyük olmalı.')
      if (total > 0 && pages > total) {
        badRequest(`pages (${pages}) total_pages (${total}) değerinden büyük olamaz.`)
      }
      // Batched existence/role check — one round-trip verifies the
      // designer exists, is role='designer', and is_active=true.
      const { rows: validUsers } = await client.query(
        `SELECT 1 FROM users
          WHERE id = $1::text
            AND role = 'designer'
            AND is_active = true`,
        [designerId],
      )
      if (validUsers.length === 0) {
        badRequest(`Tasarımcı bulunamadı veya aktif değil: ${designerId}`)
      }

      // Resolve the designer's display name live so the response
      // carries it without a second SELECT.
      const { rows: designerRows } = await client.query(
        'SELECT name FROM users WHERE id = $1::text',
        [designerId],
      )
      const designerName = designerRows[0]?.name ?? null

      // INSERT one batch row. The trigger recomputes the subtask's
      // pages_done / is_done the same transaction; we read them back
      // from the row directly (the SELECT FOR UPDATE above captured
      // the pre-write values, and the trigger's UPDATE bumped the
      // row in the same tx).
      const inserted = await addSubtaskDesignerBatch(client, {
        subtaskId,
        designerId,
        pages,
      })
      if (!inserted) badRequest('Sayfa eklenemedi.')
      const { rows: refreshedSub } = await client.query(
        `SELECT id, pages_done, is_done FROM subtasks WHERE id = $1`,
        [subtaskId],
      )
      const refreshed = refreshedSub[0] ?? { pages_done: pages, is_done: false }

      const { rows: projectSubs } = await client.query(
        'SELECT * FROM subtasks WHERE project_id = $1', [project.id],
      )
      const progress = progressFor(project, projectSubs)
      const updProject = await patchProject(
        client,
        project.id,
        { progress },
        { expectedVersion: project.version },
      )

      await logHistory(
        client,
        {
          project_id: project.id,
          from_stage: project.stage,
          to_stage: project.stage,
          action: 'system',
          event: 'subtask_progress',
          note: pagesRaw === 1
            ? `${sub.title}: ${designerName ?? designerId} 1 sayfa ekledi`
            : `${sub.title}: ${designerName ?? designerId} +${pages} sayfa ekledi`,
        },
        request.user,
      )

      return {
        subtask_id: subtaskId,
        project_id: project.id,
        total_pages: total,
        pages_done: Number(refreshed.pages_done ?? 0),
        is_done: !!refreshed.is_done,
        batch: {
          id: inserted.id,
          designer_id: inserted.designer_id,
          designer_name: designerName,
          pages: inserted.pages,
          created_at: inserted.created_at instanceof Date
            ? inserted.created_at.toISOString()
            : inserted.created_at,
          redone_at: null,
          redone_by: null,
          redone_by_name: null,
        },
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

  /**
   * POST /api/subtasks/:id/designer-batches/:batchId/redone
   *
   * Stamp the "Yeniden Çalıştım" trail on a single batch — idempotent.
   * Once a batch is redone, further clicks are no-ops; the audit trail
   * records the FIRST re-touch.
   *
   * The path captures subtask_id AND batch_id in the URL so a stray
   * `POST /some-other-subtask/batch/redone` can't write the wrong
   * redone_by against someone else's row.
   *
   * Gating: designer may only re-touch their own batches; team_leader
   * may re-touch any. Other roles 403.
   *
   * Returns the post-update row plus the project's refreshed progress
   * so the SPA can toggle the row's "✓ yeniden çalıştım" affordance
   * without a follow-up SELECT.
   */
  fastify.post('/subtasks/:id/designer-batches/:batchId/redone', {
    schema: schemas.subtasksDesignerBatchRedone,
  }, async (request) => {
    await attachUser(request)
    const subtaskId = request.params.id
    const batchId = request.params.batchId

    const result = await withTx(async (client) => {
      // Lock the batch by both ids so a concurrent re-delete (future
      // feature) can't race with the read. The lock is on the batch
      // row, not the subtask — we only need the FOR UPDATE to ensure
      // the row we read+update is the same instance the SELECT
      // FOR UPDATE on subtasks will (separately) protect.
      const { rows: batchRows } = await client.query(
        `SELECT subtask_id, designer_id FROM subtask_designer_batches
           WHERE id = $1::text FOR UPDATE`,
        [batchId],
      )
      const batch = batchRows[0]
      if (!batch) notFound('Sayfa eklemesi bulunamadı.')
      if (batch.subtask_id !== subtaskId) {
        badRequest('Bu sayfa eklemesi bu alt görevde değil.')
      }
      // Lock the parent subtask + project for the projected progress.
      const { rows: subRows } = await client.query(
        'SELECT id, project_id, title FROM subtasks WHERE id = $1 FOR UPDATE',
        [subtaskId],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      const project = await getProjectForUpdate(client, sub.project_id)
      if (!project) notFound('Proje bulunamadı.')

      const isLeader = request.user.role === 'team_leader'
      if (!isLeader && request.user.role !== 'designer') {
        badRequest('Yalnızca ekip lideri veya tasarımcı yeniden çalıştım işaretleyebilir.')
      }
      if (!isLeader && batch.designer_id !== request.user.id) {
        badRequest('Yalnızca kendi sayfanızı yeniden çalıştım işaretleyebilirsiniz.')
      }

      const updated = await markSubtaskDesignerBatchRedone(client, {
        batchId,
        actorId: request.user.id,
        actorName: request.user.name,
      })
      if (!updated) notFound('Sayfa eklemesi bulunamadı.')

      // Project progress is unchanged by redoing (the batch already
      // contributed its `pages` to the sum). We still refresh the
      // round-trip so a future "redo zeroes contribution" semantics
      // change doesn't have to chase the route.
      const { rows: projectSubs } = await client.query(
        'SELECT * FROM subtasks WHERE project_id = $1', [project.id],
      )
      const progress = progressFor(project, projectSubs)
      const updProject = await patchProject(
        client,
        project.id,
        { progress },
        { expectedVersion: project.version },
      )

      await logHistory(
        client,
        {
          project_id: project.id,
          from_stage: project.stage,
          to_stage: project.stage,
          action: 'system',
          event: 'subtask_progress',
          note: `${sub.title}: ${updated.pages} sayfalık ekleme yeniden çalışıldı`,
        },
        request.user,
      )

      return {
        subtask_id: subtaskId,
        batch: {
          id: updated.id,
          subtask_id: updated.subtask_id,
          designer_id: updated.designer_id,
          pages: updated.pages,
          redone_at: updated.redone_at instanceof Date
            ? updated.redone_at.toISOString()
            : updated.redone_at,
          redone_by: updated.redone_by,
          redone_by_name: updated.redone_by_name ?? request.user.name ?? null,
        },
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
