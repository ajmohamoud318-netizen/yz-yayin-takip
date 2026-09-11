import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { withTx } from '../db/pool.js'
import {
  getProject, getProjectForUpdate, patchProject, logHistory,
  listProjectSubtasks, listProjectHistory, loadProjectAssignees,
  addSubtaskDesignerBatch,
  removeSubtaskDesignerBatch,
  markSubtaskDesignerBatchRedone,
  loadSubtaskDesignerBatches,
  getSubtaskDesignerBatches,
} from '../services/project-repository.js'
import { schemas } from '../schemas/index.js'
import { batchCounter } from '../domain/page-segments.js'
import { subtaskProgress } from '../domain/progress.js'
import { progressFor } from '../domain/progress.js'
import { ALL_DESIGNERS_SENTINEL } from '../domain/subtask-assignee.js'

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
export function describeSubtaskListChange(before, after, { redoFlaggedIds } = {}) {
  const beforeByTitle = new Map(before.map((s) => [s.title, s]))
  const afterTitles = new Set(after.map((s) => s.title))
  const flagged = redoFlaggedIds instanceof Set ? redoFlaggedIds : new Set()

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
      // Reopen-on-reassign: if this save flipped the row's `needs_redo`
      // flag from false to true, the leader's reassignment of a
      // completed check subtask is what triggered the redo (migration
      // 085). The timeline bit is the only place this intent is
      // recorded — a plain "atama değişti" would leave the team
      // wondering why the row is suddenly wearing a redo pill, so the
      // bit names the cause explicitly.
      //
      // Also emits when `old.is_done && !s.is_done` for defence in depth:
      // any future path that unchecks a subtask during the bulk reconcile
      // (a pages reopen, an admin correction) should still surface that
      // as a redo-worthy change rather than a plain rename. The redo
      // flag is the primary trigger; the is_done delta is the safety
      // net for behaviours the flag doesn't yet cover.
      bits.push(
        flagged.has(s.id) || (old.is_done && !s.is_done)
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
 * PATCH  /api/subtasks/:id                                    — toggle or update fields
 * POST   /api/subtasks/:id/updates                            — append a designer note (also acks
 *                                                              `needs_redo` when caller is the
 *                                                              assigned designer — migration 085)
 * POST   /api/subtasks/:id/revize                             — designer clears `needs_revize`
 * PUT    /api/projects/:id/subtasks                           — team_leader bulk replaces the list
 * POST   /api/subtasks/:id/designer-batches                   — append one +N batch row (migration 067)
 * DELETE /api/subtasks/:id/designer-batches/:batchId          — remove one batch row (migration 084)
 * POST   /api/subtasks/:id/designer-batches/:batchId/redone
 *                                                             — stamp "Yeniden Çalıştım" on a batch
 *
 * Per-chip PATCH /subtasks/:id/pages/:pageIndex and the
 * per-page ASSIGN / BULK-ASSIGN routes are gone — chip-grid UX is gone.
 * Pages are entered as a session log of "+N ekledim" batches; the running
 * total on the parent subtask row is the SUM of every batch. Migration 084
 * dropped the slot-range (`start_page`) bookkeeping — a designer can now
 * add or remove their own +N rows and the trigger sums whatever is left.
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
      // kind='pages' and (migration 082) kind='sticker-count' subtasks are
      // driven exclusively by POST /subtasks/:id/designer-batches; the
      // per-chip PATCH is gone. Refuse a direct counter write on either here
      // so a stale SPA that still uses the old toggle can't desync the
      // trigger-derived counter from the underlying batches.
      if (batchCounter(sub.kind)
        && (pagesChanged || stickersChanged)) {
        badRequest(`${sub.kind === 'pages' ? 'İç sayfalar' : 'Sticker'} için tasarımcı sayısı kullanılır.`)
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
      // migration 085: also pull `needs_redo` and `assigned_to` so the
      // shared note endpoint can double as the new owner's redo
      // acknowledgment. The flag-clear branch is gated on the caller
      // being the assigned designer — anyone else can still drop a
      // timeline note, but only the row's owner gets to flip the flag.
      const { rows: subRows } = await client.query(
        'SELECT id, project_id, title, kind, needs_redo, assigned_to FROM subtasks WHERE id = $1', [request.params.id],
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
      // migration 085 — handover redo acknowledgment piggybacks on the
      // shared "Yeniden Çalıştım" note button. When the row carries a
      // `needs_redo` flag AND the caller is the assigned designer, the
      // single click both stamps the timeline note (above) AND clears
      // the flag. Two birds, one button — the leader's reassignment
      // intent ("the new owner owes an ack pass") collapses into the
      // designer's existing informal-redo affordance instead of
      // spawning a second button on the row.
      //
      // Owner gate mirrors `/subtasks/:id/revize`: the leader who set
      // the flag can't clear it themselves, and a non-owner designer
      // can't ack a row that wasn't reassigned to them. A note-only
      // drop from a non-owner still works — they just don't move the
      // flag.
      let redoCleared = false
      if (
        sub.needs_redo
        && sub.assigned_to
        && sub.assigned_to === request.user.id
      ) {
        await client.query(
          'UPDATE subtasks SET needs_redo = FALSE, updated_at = NOW() WHERE id = $1',
          [sub.id],
        )
        // Distinct history row for the fold bucket — same note copy the
        // dedicated /redo-ack endpoint wrote, but with the caller's
        // note appended so the timeline reads "KAPAK, yeniden
        // çalışıldı olarak işaretlendi · Yeniden çalışıldı." instead
        // of dropping the original button's intent on the floor.
        await logHistory(
          client,
          {
            project_id: project.id,
            from_stage: project.stage,
            to_stage: project.stage,
            action: 'system',
            event: 'subtask_redo_acked',
            note: `${sub.title}, yeniden çalışıldı olarak işaretlendi${note ? ` · ${note}` : ''}`,
          },
          request.user,
        )
        redoCleared = true
      }
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
        // Surfaced on the response so the client can show a "redoesi
        // onaylandı" toast distinct from a plain note save without
        // having to diff the project state.
        redoCleared,
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
      // A subtask with the ALL_DESIGNERS sentinel covers every project
      // designer for orphan-check purposes: "Tüm Tasarımcılar" IS the
      // assignment for all of them (İç Sayfalar's batch log then lets any
      // of them log pages against the ownerless row). Without this, a
      // leader who assigns Ayşe to İç Sayfalar via "Tüm Tasarımcılar" and
      // to no other subtask would trip the orphan guard.
      const hasSharedSubtask = subtasks.some(
        (s) => s.assigned_to === ALL_DESIGNERS_SENTINEL,
      )
      const subAssigneeIds = new Set(
        subtasks
          .map((s) => s.assigned_to)
          .filter((v) => v && v !== ALL_DESIGNERS_SENTINEL),
      )
      // The first id in `assignees` is the project primary (the PATCH
      // route's behaviour, mirrored here for the validation's sake so
      // we don't flag the primary as orphan).
      const primaryAssignee = declaredAssignees[0] ?? null
      for (const id of declaredAssignees) {
        if (id === primaryAssignee) continue
        if (hasSharedSubtask) continue
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
        `SELECT id, title, kind, total_pages, total_stickers, assigned_to, is_done, needs_redo
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
        // project's primary `assigned_to` so a subtask is never ownerless
        // when the leader leaves the picker empty.
        //
        // The SPA sends ALL_DESIGNERS_SENTINEL for İç Sayfalar when the
        // leader picks "Tüm Tasarımcılar". That's a deliberate "no primary
        // owner" signal, so it MUST bypass the null→primary fallback (and
        // MUST NOT reach the FK-constrained assigned_to column as a
        // literal string). null / undefined without the sentinel still
        // means "no picker choice" and keeps the existing primary
        // fallback, so non-İç-Sayfalar subtasks are unaffected.
        const subAssignee = s.assigned_to === ALL_DESIGNERS_SENTINEL
          ? null
          : (s.assigned_to ?? project.assigned_to ?? null)
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
          // Which parça this subtask belongs to (migration 075). NULL means
          // project-wide, which is what every pre-075 row is and what a
          // subtask like "Yazılım" stays. It is what scopes a per-parça
          // reject's revize flags to the parça that actually came back.
          s.parca ?? null,
        ]

        if (existing) {
          const { rows } = await client.query(
            `UPDATE subtasks
                SET title = $2, kind = $3, total_pages = $4, total_stickers = $5,
                    assigned_to = $6, position = $7, parca = $8,
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
               (project_id, title, kind, total_pages, total_stickers, assigned_to, position, parca)
             -- The done flag is omitted: the column defaults to FALSE in
             -- migration 003, and brand-new subtasks have no designer
             -- work to credit. Keep the column out of the column list
             -- AND the VALUES list so future readers don't see the
             -- route as a legitimate writer of designer state.
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [project.id, ...params],
          )
          finalRows.push(rows[0])
          keptIds.push(rows[0].id)
          // No designer-work row is seeded for a brand-new kind='pages'
          // subtask. Migration 071 replaced the per-designer counter with
          // an append-only batch log (CHECK pages > 0), so there is no
          // empty slot to materialise — the first /designer-batches POST
          // creates the first row.
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
      // new owner has to redo this." For kind='check' we now stamp the
      // `needs_redo` flag (migration 085) instead of flipping is_done
      // back to false: the previous designer's completion credit is
      // preserved on the row and the new owner sees a pill telling them
      // the redo is owed. Clearing the flag is what
      // POST /subtasks/:id/redo-ack does, which is the check twin of
      // the /revize action.
      //
      // Why the flag and not an uncheck: a check subtask has one boolean
      // column that historically doubled as "finished this round" AND
      // "who owes work right now". Handing it off to a new designer
      // meant those two collapsed into one wrong answer either way —
      // uncheck and the timeline reads "back to zero"; leave it checked
      // and the new owner has no visible signal to act on. The flag
      // splits them: `is_done` stays as "the work reached done at some
      // point", `needs_redo` carries the "still owed for the current
      // owner" bit until they acknowledge.
      //
      // For kind='pages' the reopen stays a no-op: the new designer's
      // first /designer-batches POST will create their first batch from
      // a clean slate, every batch row that already exists stays
      // attributed to its original designer (audit trail), and the
      // trigger on subtask_designer_batches sums whatever is left. The
      // net effect on a pages subtask is that a handover spawns a fresh
      // contribution for the new owner without disturbing the previous
      // owner's record.
      const previousById = new Map(previous.map((p) => [p.id, p]))
      // Ids whose `needs_redo` was flipped from false to true in this
      // save. Passed into describeSubtaskListChange below so the timeline
      // bit for a redo-flagged reassign reads "atama değişti, yeniden
      // yapılacak" instead of the plain "atama değişti" — same wording
      // the pre-flag behaviour emitted when the reassign unchecked the
      // row, so the timeline reads the same for the team either way.
      const redoFlaggedIds = new Set()
      for (const row of finalRows) {
        if (row.kind !== 'check' && row.kind !== 'pages') continue
        const prev = previousById.get(row.id)
        if (!prev) continue                // brand-new subtask, no reopen to do
        if (prev.assigned_to === row.assigned_to) continue  // assignee didn't move
        if (!prev.is_done) continue        // wasn't done, no work to reopen
        if (row.kind === 'check') {
          // Only stamp when the flag isn't already carried — a repeat
          // reassignment while a redo is still pending shouldn't rewrite
          // the timeline entry or the updated_at, since nothing new is
          // being asked of the new owner.
          if (prev.needs_redo) continue
          await client.query(
            `UPDATE subtasks
                SET needs_redo = TRUE,
                    updated_at = NOW()
              WHERE id = $1`,
            [row.id],
          )
          redoFlaggedIds.add(row.id)
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
                needs_revize, needs_redo, position, created_at, updated_at
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
      const summary = describeSubtaskListChange(previous, inserted, { redoFlaggedIds })
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
   * Designer-facing write for the "İç Sayfalar" / "Sticker" subtasks
   * (migrations 067 + 082, simplified in 084). Each save is one +N row
   * in the per-designer log; the running total on the parent subtask
   * is the SUM of every batch's `pages`, kept in sync by the
   * `recompute_subtask_pages_counter` trigger.
   *
   * Migration 084 — the slot-range model (`start_page` + range-overlap
   * probe) is gone. Two designers logging "+5 pages" apiece just each
   * contribute +5 to `pages_done`; the batch table is a per-designer
   * audit log ("who did what today"), not a coverage map of unique
   * pages. That matches how the team actually works: one clicks
   * "Ekle", another does the same on their own machine, and the row's
   * counter climbs — nobody has to hand off page numbers.
   *
   * Body: `{ designer_id: string, pages: integer (1..) }`. One batch
   * per call — a save is one +N entry.
   *
   * Gating:
   *   • team_leader role may add a batch for any active designer;
   *   • designer role may add a batch only for themselves (the body's
   *     designer_id must match their own id).
   *
   * Inside the transaction:
   *   1. Lock the subtask (FOR UPDATE) and the parent project.
   *   2. Validate — `pages` is a positive integer (schema also
   *      enforces this, backstopped here so a JSON-native caller can't
   *      slip a 0 past ajv via a coerced type), `pages_done + pages`
   *      still fits inside `total_pages` (or `total_stickers` for a
   *      sticker subtask). The cap is JS-side so the leader can raise
   *      total_pages mid-stream without orphaning prior batches.
   *   3. Resolve the designer id → active user; reject unknown /
   *      inactive designers with a Turkish message.
   *   4. addSubtaskDesignerBatch — the INSERT fires the counter trigger
   *      which recomputes pages_done / is_done on the parent row.
   *   5. Re-select the subtask row (post-trigger), refresh the full
   *      batch list, recompute project progress, patchProject with
   *      the locked version as the OCC guard.
   *   6. logHistory — one row per save, "Alt görev, +5 sayfa (12/40)".
   *
   * Returns a slim shape so the SPA can merge into state without
   * hitting /projects/:id for the full payload:
   *   { subtask_id,
   *     batches: [{ id, designer_id, designer_name, pages, created_at,
   *                 redone_at, redone_by, redone_by_name }, …],
   *     batch: <batches[0]>,                  // older callers
   *     project_progress, project: { id, progress, version } }
   */
  fastify.post('/subtasks/:id/designer-batches', {
    schema: schemas.subtasksDesignerBatchCreate,
  }, async (request) => {
    await attachUser(request)
    const subtaskId = request.params.id
    const designerId = String(request.body?.designer_id ?? '').trim()
    if (!designerId) badRequest('designer_id gerekli.')
    // Schema enforces `pages >= 1`; backstop here defends against a
    // future caller that bypasses ajv (test harness, admin script) and
    // keeps the Turkish message path consistent with everything else in
    // this handler.
    const pages = Math.floor(Number(request.body?.pages))
    if (!Number.isFinite(pages) || pages <= 0) {
      badRequest('pages sıfırdan büyük olmalı.')
    }

    const result = await withTx(async (client) => {
      const { rows: subRows } = await client.query(
        `SELECT id, project_id, title, kind, total_pages, pages_done, total_stickers, stickers_done
           FROM subtasks WHERE id = $1 FOR UPDATE`,
        [subtaskId],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      // İç Sayfalar counts pages, Sticker counts stickers (migration 082);
      // everything below reads the counter so the two share one path.
      const counter = batchCounter(sub.kind)
      if (!counter) {
        badRequest('Bu alt görev için tasarımcı sayısı desteklenmiyor.')
      }
      const { unit, unitTitle } = counter
      const total = Number(sub[counter.total] ?? 0)
      const currentDone = Number(sub[counter.done] ?? 0)
      const project = await getProjectForUpdate(client, sub.project_id)
      if (!project) notFound('Proje bulunamadı.')

      const isLeader = request.user.role === 'team_leader'
      if (!isLeader && request.user.role !== 'designer') {
        badRequest(`Yalnızca ekip lideri veya tasarımcı ${unit} ekleyebilir.`)
      }
      if (!isLeader && designerId !== request.user.id) {
        badRequest(`Yalnızca kendi adınıza ${unit} ekleyebilirsiniz.`)
      }
      // Backstop cap. `total = 0` means the leader hasn't set a page count
      // yet — leave the check off in that case so a designer isn't blocked
      // by an unset field. `is_done` is a trigger-flipped flag, not a hard
      // ceiling, but the running total is a promise ("Kaç sayfa?"), so
      // going past it here would silently corrupt the promise. Enforced in
      // JS so the leader can still raise total_pages mid-stream without
      // orphaning prior batches.
      if (total > 0 && (currentDone + pages) > total) {
        badRequest(
          `${unitTitle} ${currentDone + pages} toplam ${unit} sayısını (${total}) aşamaz.`,
        )
      }
      // Batched existence/role check + name resolution in one round-trip:
      // the designer id must exist, be `role='designer'`, and `is_active`.
      // The name comes back so the response can include it without a
      // second SELECT the SPA would otherwise need for its optimistic row.
      const { rows: designerRows } = await client.query(
        `SELECT name FROM users
          WHERE id = $1::text
            AND role = 'designer'
            AND is_active = true`,
        [designerId],
      )
      if (designerRows.length === 0) {
        badRequest('Tasarımcı bulunamadı.')
      }

      const inserted = await addSubtaskDesignerBatch(client, {
        subtaskId: sub.id,
        designerId,
        pages,
      })
      if (!inserted) badRequest(`${unitTitle} eklenemedi.`)

      // The trigger's UPDATE fired inside this transaction, so a
      // re-SELECT reads the freshly summed pages_done / is_done — the
      // note below quotes them and the client relies on the batches
      // list agreeing with the counter.
      const { rows: refreshedSubRows } = await client.query(
        `SELECT id, ${counter.done} AS done, is_done FROM subtasks WHERE id = $1`,
        [subtaskId],
      )
      const refreshed = refreshedSubRows[0] ?? { done: currentDone + pages, is_done: false }

      const batches = await getSubtaskDesignerBatches(client, subtaskId)

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
          // "Alt görev, +5 sayfa (10/40)" — the running total after this
          // save is more useful in the timeline than a bare delta, so a
          // leader scanning the day's activity sees the trajectory
          // without having to sum rows in their head.
          note: `${sub.title}, +${pages} ${unit} (${Number(refreshed.done ?? 0)}/${total || '?'})`,
        },
        request.user,
      )

      return {
        subtask_id: subtaskId,
        batches,
        // Older callers written against the one-row-per-save shape read
        // `batch`; the new callers read `batches[0]` themselves. Both
        // point at the same newest row.
        batch: batches[0] ?? null,
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
   * DELETE /api/subtasks/:id/designer-batches/:batchId
   *
   * Migration 084 — a designer can remove their own +N row; the team
   * leader can remove anyone's. Removing a row is atomic with the
   * counter recompute: the DELETE fires the same trigger that
   * addSubtaskDesignerBatch does, so `pages_done` / `is_done` drop by
   * exactly the removed row's `pages`.
   *
   * The path captures both ids so a stray `DELETE /some-other-subtask/
   * batches/:batchId` can't wipe a row on a different subtask —
   * matches the redone route's belt-and-braces.
   *
   * Response shape mirrors the POST so the SPA's optimistic merge can
   * use the same reducer for either delta:
   *   { subtask_id, removed_batch_id, batches, project_progress,
   *     project: { id, progress, version } }
   */
  fastify.delete('/subtasks/:id/designer-batches/:batchId', {
    schema: schemas.subtasksDesignerBatchDelete,
  }, async (request) => {
    await attachUser(request)
    const subtaskId = request.params.id
    const batchId = request.params.batchId

    const result = await withTx(async (client) => {
      // Lock the batch row by BOTH ids so a concurrent redone/delete on
      // the same row serialises against us, and a mismatched subtaskId
      // (URL tampering) fails closed rather than silently deleting a row
      // on a different subtask.
      const { rows: batchRows } = await client.query(
        `SELECT id, subtask_id, designer_id
           FROM subtask_designer_batches
          WHERE id = $1 AND subtask_id = $2
          FOR UPDATE`,
        [batchId, subtaskId],
      )
      const batch = batchRows[0]
      if (!batch) notFound('Batch bulunamadı.')

      const { rows: subRows } = await client.query(
        `SELECT id, project_id, title, kind, total_pages, pages_done, total_stickers, stickers_done
           FROM subtasks WHERE id = $1 FOR UPDATE`,
        [subtaskId],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      const project = await getProjectForUpdate(client, sub.project_id)
      if (!project) notFound('Proje bulunamadı.')

      // Auth: leader can delete any row; a designer may only delete
      // their own. Anyone else (matbaa, sales) is refused. Same message
      // shape as the redone route so the SPA can surface either from
      // one branch.
      const isLeader = request.user.role === 'team_leader'
      if (!isLeader && request.user.id !== batch.designer_id) {
        badRequest('Bu kaydı silme yetkiniz yok.')
      }

      // Defensive — the DELETE trigger only exists on subtasks whose
      // `kind` has a counter. Reject anything else so a future non-
      // counter subtask type that somehow held rows in this table can't
      // slip past the guard.
      const counter = batchCounter(sub.kind)
      if (!counter) {
        badRequest('Bu alt görev için tasarımcı sayısı desteklenmiyor.')
      }

      const removed = await removeSubtaskDesignerBatch(client, { batchId })
      if (!removed) notFound('Batch bulunamadı.')

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

      // Refresh after the trigger recomputed so the returned list is
      // the ground truth the SPA can replace its optimistic state with.
      const batches = await getSubtaskDesignerBatches(client, subtaskId)

      await logHistory(
        client,
        {
          project_id: project.id,
          from_stage: project.stage,
          to_stage: project.stage,
          action: 'system',
          event: 'subtask_progress',
          note: `${sub.title}, -${removed.pages} ${counter.unit} silindi`,
        },
        request.user,
      )

      return {
        subtask_id: subtaskId,
        removed_batch_id: batchId,
        batches,
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
        'SELECT id, project_id, title, kind FROM subtasks WHERE id = $1 FOR UPDATE',
        [subtaskId],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      const project = await getProjectForUpdate(client, sub.project_id)
      if (!project) notFound('Proje bulunamadı.')
      const counter = batchCounter(sub.kind) ?? batchCounter('pages')

      const isLeader = request.user.role === 'team_leader'
      if (!isLeader && request.user.role !== 'designer') {
        badRequest('Yalnızca ekip lideri veya tasarımcı yeniden çalıştım işaretleyebilir.')
      }
      if (!isLeader && batch.designer_id !== request.user.id) {
        badRequest(`Yalnızca kendi ${counter.unit} eklemenizi yeniden çalıştım işaretleyebilirsiniz.`)
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
          // `counter.sized` ("sayfalık" / "adetlik") was dropped from
          // BATCH_COUNTERS in migration 084's domain trim; the plain
          // unit ("sayfa" / "sticker") is the surviving field.
          note: `${sub.title}: ${updated.pages} ${counter.unit} ekleme yeniden çalışıldı`,
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
