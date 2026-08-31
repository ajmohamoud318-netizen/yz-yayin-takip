import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { withTx } from '../db/pool.js'
import {
  getProject, getProjectForUpdate, patchProject, logHistory,
  listProjectSubtasks, listProjectHistory, loadProjectAssignees,
  seedSubtaskPages, pruneSubtaskPages,
  resyncSubtaskPageAssignments,
  setSubtaskPage, assignSubtaskPage,
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
 * PATCH /api/subtasks/:id                 — toggle or update fields
 * POST  /api/subtasks/:id/updates         — append a designer note
 * PUT   /api/projects/:id/subtasks        — team_leader bulk replaces the list
 *
 * The `progress` field on the parent project is recomputed in the same
 * transaction so the client cache stays valid. Every state change also
 * writes a `stage_history` row so the project timeline can show who did
 * what (subtask_done / subtask_undone / subtask_progress / subtask_note /
 * subtask_list_update).
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
      // concurrent writer (admin script, future non-locking path) can't
      // silently overwrite this progress bump. Mirrors the contract the
      // `runProjectCommand` orchestrator uses for FSM-driven writes.
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
      // is_done and done_at are the designer's work state, set by
      // PATCH /subtasks/:id (whole-subtask toggle) and
      // PATCH /subtasks/:id/pages/:pageIndex (per-page chip flip), and must
      // not be writable from here. The SPA mapper that builds the body
      // reads is_done from the project repo's in-memory cache, which is
      // NOT refreshed on every subtask mutation (toggleSubtask /
      // setSubtaskPage return the response without touching the cache), so
      // a leader adding a designer to a project whose cache predates the
      // designer's work would otherwise POST every subtask as is_done=false
      // and the project's progress would reset to 0% on save.
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
        // designer's work state is owned by the toggle and per-page routes
        // and must not be writable from the bulk reconcile — see the block
        // comment at the top of the route. Clients that post it are
        // silently ignored.
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
                    -- toggle route and the per-page endpoint. done_at
                    -- follows the column (keep when the flag is set, clear
                    -- when it is not) so the two stay in lock-step — a
                    -- row that has somehow been cleared outside this route
                    -- still has its done_at nulled on the next save.
                    done_at = CASE WHEN is_done THEN done_at ELSE NULL END,
                    -- Lowering a total must not leave a counter above it
                    -- (12/16 pages becoming 12/8). Raising one changes nothing.
                    pages_done = LEAST(pages_done, COALESCE($4, pages_done)),
                    stickers_done = LEAST(stickers_done, COALESCE($5, stickers_done)),
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
        }
      }

      // Only rows the leader actually removed are deleted — and those SHOULD
      // take their notes with them, which the existing cascade handles.
      await client.query(
        `DELETE FROM subtasks
          WHERE project_id = $1 AND NOT (id = ANY($2::text[]))`,
        [project.id, keptIds],
      )

      // migration 055 — reconcile the per-page rows for every kind='pages'
      // subtask in the saved list. Growing total_pages adds new pending rows;
      // shrinking it drops rows past the new total (the chip grid only ever
      // shows what's in scope). Same set of operations is done at create
      // time on POST /projects — this branch catches the leader editing an
      // existing list.
      //
      // Snapshot the previous `assigned_to` for every subtask that survived
      // the save so the sweep below can tell "leader just reassigned" from
      // "leader only renamed / re-totalled / no-op'd".
      const previousAssignedToById = new Map(previous.map((p) => [p.id, p.assigned_to]))
      const previousById = new Map(previous.map((p) => [p.id, p]))
      for (const row of finalRows) {
        if (row.kind !== 'pages') continue
        const total = Number(row.total_pages ?? 0)
        if (total > 0) {
          // New rows added when total_pages grows pick up the just-saved
          // subtask owner — same default-stamping rule POST /projects uses,
          // so a 12 → 16 page change doesn't leave the 4 new chips looking
          // orphaned when the subtask is owned by a real designer.
          await seedSubtaskPages(client, row.id, total, row.assigned_to)
        }
        await pruneSubtaskPages(client, row.id, total)
        // If the team leader reassigned this `kind='pages'` subtask to a
        // different designer (or cleared the assignment entirely) on this
        // save, propagate the change to the per-page grid. The sweep:
        //   • updates `assigned_to` + `assigned_at` on every non-done row
        //   • leaves `done` rows alone — `done_by` is the audit trail for
        //     who actually shipped the page, and overwriting the planned
        //     owner of a finished page would visually re-attribute work.
        //   • is a no-op when the value didn't actually change, both via
        //     the comparison here and the SQL `IS DISTINCT FROM` guard
        //     inside resyncSubtaskPageAssignments.
        const previousAssignedTo = previousAssignedToById.get(row.id) ?? null
        if (previousAssignedTo !== row.assigned_to) {
          await resyncSubtaskPageAssignments(client, row.id, row.assigned_to)
        }
      }

      // ── Reopen done work when the leader reassigns the owner ───────────────
      //
      // The leader's reassignment of a `kind='check'` or `kind='pages'`
      // subtask whose work was already complete implies "the new owner
      // has to redo this." Without this branch, the previous fix that
      // protects the designer's work state would let the leader move
      // a finished alt görev to a different designer and leave the
      // "tamamlandı" checkmark in place — which silently strands the
      // credit with the old finisher while the new designer is now on
      // the hook for delivery they never had a chance to do.
      //
      // Behaviour by kind:
      //   • kind='check' — flip is_done=false, clear done_at. The
      //     subtask goes back into B's queue; the audit-trail row in
      //     stage_history from when A finished it is unchanged.
      //   • kind='pages' — every page that was status='done' flips to
      //     status='rework' with rework_count incremented. done_by /
      //     done_at are intentionally NOT in the SET clause, so the
      //     audit trail of who last shipped the page stays. The next
      //     time B clicks a chip to mark it done, done_by updates
      //     through the normal per-page route and both names end up
      //     in the timeline.
      //
      // pages_done AND is_done are recomputed afterwards (the LEAST
      // clamp inside the bulk UPDATE only fires when total_pages
      // changes, and is_done is the parent flag progressFor counts).
      //
      // The detection: previous.is_done (from the snapshot at the top
      // of the route) is true AND previous.assigned_to !== new
      // assigned_to. A "leader only renamed" or "leader only changed
      // totals" save keeps the original finisher's credit and is
      // intentionally not affected by this branch.
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
          await client.query(
            `UPDATE subtask_pages
                SET status = 'rework',
                    rework_count = rework_count + 1,
                    updated_at = NOW()
              WHERE subtask_id = $1
                AND status = 'done'`,
            [row.id],
          )
          // Recompute pages_done AND is_done from the actual chip-grid
          // state. Without this, is_done stays true (stale) and the
          // progress recompute further down would count a subtask whose
          // pages have all been flipped to rework as "done".
          await client.query(
            `UPDATE subtasks
                SET pages_done = COALESCE((
                      SELECT COUNT(*)::int
                        FROM subtask_pages
                       WHERE subtask_id = $1
                         AND status = 'done'
                    ), 0),
                    is_done = COALESCE((
                      SELECT (COUNT(*) FILTER (WHERE status = 'done')
                              = COUNT(*))
                        FROM subtask_pages
                       WHERE subtask_id = $1
                    ), false),
                    updated_at = NOW()
              WHERE id = $1`,
            [row.id],
          )
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
      const updated = await patchProject(client, project.id, { progress })
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
   * PATCH /api/subtasks/:id/pages/:pageIndex
   *
   * Per-page state flip on the "İç Sayfalar" subtask (migration 055). Every
   * chip click on the SPA grid hits this endpoint — it's intentionally the
   * cheapest possible write: one UPDATE on `subtask_pages`, one counter
   * UPDATE on `subtasks`, then a project progress recompute.
   *
   * Ownership mirrors the project subtask PATCH route: any project assignee
   * can drive a page to `done` (pages are commonly split across designers);
   * only the actor who marked a page done (or the team leader) can clear it
   * back to `pending` or mark it for `rework`. The team leader override is
   * what lets them resolve a stale "page marked done by someone who no
   * longer works here" without a manual SQL fix.
   */
  fastify.patch('/subtasks/:id/pages/:pageIndex', { schema: schemas.subtasksPagePatch }, async (request) => {
    await attachUser(request)
    const subtaskId = request.params.id
    const pageIndex = Number(request.params.pageIndex)
    const { status } = request.body

    const result = await withTx(async (client) => {
      const { rows: subRows } = await client.query(
        'SELECT id, project_id, title, kind, total_pages FROM subtasks WHERE id = $1 FOR UPDATE',
        [subtaskId],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      if (sub.kind !== 'pages') badRequest('Bu alt görev "İç Sayfalar" türünde değil.')
      // Same gate the existing PATCH /subtasks/:id uses: the project must
      // not be in a frozen stage, and the actor must either be the team
      // leader or an assigned designer. Assignees come from the same load
      // helper every other route uses — `project.assigned_to` plus the
      // per-subtask designers (see project-repository.loadProjectAssignees).
      const project = await getProjectForUpdate(client, sub.project_id)
      if (!project) notFound('Proje bulunamadı.')
      const assigneeIds = new Set(
        (await loadProjectAssignees(client, project)).map((a) => a.id),
      )
      const isLeader = request.user.role === 'team_leader'
      const isAssignedDesigner =
        request.user.role === 'designer' && assigneeIds.has(request.user.id)
      if (!isLeader && !isAssignedDesigner) {
        badRequest('Yalnızca ekip lideri veya atanmış tasarımcı sayfa işaretleyebilir.')
      }

      // The leader bypasses the "only the original finisher can rework a
      // page" rule — see setSubtaskPage's docblock.
      const result = await setSubtaskPage(client, {
        subtaskId,
        pageIndex,
        status,
        actorId: request.user.id,
        actorName: request.user.name,
      })
      if (result.error === 'not_yours') {
        // Non-leader: surface the ownership gate as a 400. Leader: setSubtaskPage
        // returned not_yours because the page was owned by someone else, but the
        // route's !isLeader bypass let execution fall through. Without this
        // short-circuit we'd log a phantom "Sayfa N tamamlandı" history row for a
        // transition that never actually happened — the page didn't change.
        if (!isLeader) {
          // Bug #6 brought the rework branch into the same ownership gate as
          // done/pending, so the error message has to use the right verb per
          // transition — designers reading "geri alabilir" on a rework click
          // would think they tried to undo when they actually tried to flag.
          const verb = status === 'rework' ? 'revize edebilir' : 'geri alabilir'
          badRequest(`Bu sayfayı yalnızca işaretleyen kişi ${verb}.`)
        }
        const currentSubs = await listProjectSubtasks(client, project.id)
        const currentHistory = await listProjectHistory(client, project.id)
        const currentAssignees = await loadProjectAssignees(client, project)
        return {
          page: result.updated ?? null,
          subtask: result.subtask ?? null,
          project: {
            ...project,
            assignees: currentAssignees,
            assigned_name: currentAssignees.map((a) => a.name).join(', ') || project.assigned_name || '—',
            subtasks: currentSubs,
            history: currentHistory,
          },
        }
      }
      if (result.error === 'out_of_range') {
        badRequest(`Sayfa numarası 1 ile ${sub.total_pages} arasında olmalı.`)
      }
      if (result.error === 'wrong_kind') {
        badRequest('Bu alt görev "İç Sayfalar" türünde değil.')
      }
      if (result.error === 'bad_status') {
        badRequest('Geçersiz sayfa durumu.')
      }
      if (result.error === 'not_found') {
        // Defensive: setSubtaskPage returns this when its own SELECT finds no
        // subtask row. The route's pre-check at the top of withTx already
        // would have notFound'd first, so this branch is unreachable today —
        // but if anyone ever loosens the pre-check, a missing subtask would
        // otherwise silently fall through to logHistory and return a phantom
        // 200 with no actual change (same shape as bug #2 used to produce).
        notFound('Alt görev bulunamadı.')
      }

      // Same "return the full project shape" contract every other subtask
      // route keeps — the SPA merges it into state without a follow-up GET.
      //
      // Recompute project.progress from the just-updated subtask list. The
      // subtasks the previous PATCH /subtasks/:id route did was the same
      // query; doing it here makes a chip click update the header bar the
      // same way a checkbox toggle does, so the designer sees the
      // percentage move as they click through the grid. Without this the
      // project.progress field never changes for İç Sayfalar subtasks
      // — the value got stuck the day the project was created, and the
      // "10/48 tamamlandı" chip-grid header was the only signal designers
      // had that work was actually happening.
      const { rows: projectSubs } = await client.query(
        'SELECT * FROM subtasks WHERE project_id = $1', [project.id],
      )
      const progress = progressFor(project, projectSubs)
      const updProject = await patchProject(client, project.id, { progress })
      const subtasksList = await listProjectSubtasks(client, project.id)
      const history = await listProjectHistory(client, project.id)
      const assigneesOut = await loadProjectAssignees(client, updProject)
      // Log the page-level event so the project timeline shows "Sayfa 5,
      // tamamlandı" rather than just a silent subtask counter bump. Three
      // things have to line up for a row to be written:
      //
      //   1. The status actually changed (`prevStatus !== status`). A
      //      same-author redundant done click passes the not_yours gate and
      //      gets through, but it isn't an event — without this check every
      //      double-click on a done chip produced an identical "tamamlandı"
      //      row in the timeline.
      //   2. The right event name for the new status. Pending used to log as
      //      `subtask_done` (same icon as a fresh completion) — the
      //      timeline's undo gesture should read as `subtask_undone`, the
      //      way PATCH /subtasks/:id already distinguishes them.
      //   3. The Turkish verb agrees with the new status.
      const prevStatus = result.prevStatus
      if (prevStatus !== status) {
        const labelMap = { done: 'tamamlandı', pending: 'tamamlanmadı', rework: 'revize edildi' }
        const eventName =
          status === 'done' ? 'subtask_done'
            : status === 'pending' ? 'subtask_undone'
              : 'subtask_progress'
        await logHistory(
          client,
          {
            project_id: project.id,
            from_stage: project.stage,
            to_stage: project.stage,
            action: 'system',
            event: eventName,
            note: `${sub.title}, sayfa ${pageIndex} ${labelMap[status]}`,
          },
          request.user,
        )
      }
      return {
        page: result.updated,
        subtask: result.subtask,
        project: {
          ...updProject,
          assignees: assigneesOut,
          assigned_name: assigneesOut.map((a) => a.name).join(', ') || updProject.assigned_name || '—',
          subtasks: subtasksList,
          history,
        },
      }
    })
    return result
  })

  /**
   * PATCH /api/subtasks/:id/pages/:pageIndex/assign
   *
   * Migration 056 — assign or un-assign a single page's owner. The team
   * leader calls this to pre-allocate pages ("Aylin does 1-24, Rahşan
   * does 25-48") or to reassign mid-revision ("move 5, 8, 12 from Aylin
   * to Rahşan because Aylin is stretched"). Body `assigned_to` is the
   * designer id; null means "un-assign".
   *
   * Leader-only by design — only the team_leader role can name a page's
   * owner. Designers can't reassign someone else's pages away because
   * the chip grid already lets them claim work via done_by, and the two
   * signals (assigned_to vs done_by) intentionally diverge: a designer
   * who finishes a page reassigned to someone else gets done_by credit
   * for the audit trail without claiming the planned owner slot.
   *
   * Returns the same full project shape as setSubtaskPage so the SPA's
   * `setProject` can drop it straight into state.
   */
  fastify.patch('/subtasks/:id/pages/:pageIndex/assign', { schema: schemas.subtasksPageAssign }, async (request) => {
    await attachUser(request)
    // The chip grid has a leader-only assign UI, but the schema's
    // assigned_to can also be null (un-assign), so role-gate here
    // rather than relying on the schema to refuse designers.
    requireRole(request, 'team_leader')
    const subtaskId = request.params.id
    const pageIndex = Number(request.params.pageIndex)
    const { assigned_to } = request.body

    const result = await withTx(async (client) => {
      const { rows: subRows } = await client.query(
        'SELECT id, project_id, title, kind, total_pages FROM subtasks WHERE id = $1 FOR UPDATE',
        [subtaskId],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      if (sub.kind !== 'pages') badRequest('Bu alt görev "İç Sayfalar" türünde değil.')
      const project = await getProjectForUpdate(client, sub.project_id)
      if (!project) notFound('Proje bulunamadı.')
      const result = await assignSubtaskPage(client, {
        subtaskId,
        pageIndex,
        assignedTo: assigned_to,
        actorId: request.user.id,
      })
      if (result.error === 'not_found') notFound('Alt görev bulunamadı.')
      if (result.error === 'wrong_kind') badRequest('Bu alt görev "İç Sayfalar" türünde değil.')
      if (result.error === 'out_of_range') {
        badRequest(`Sayfa numarası 1 ile ${sub.total_pages} arasında olmalı.`)
      }
      // Same full-project-shape contract every other subtask route uses.
      const updProject = await patchProject(client, project.id, {})
      const subtasksList = await listProjectSubtasks(client, project.id)
      const history = await listProjectHistory(client, project.id)
      const assigneesOut = await loadProjectAssignees(client, updProject)
      // Log the assignment so the project timeline shows "Sayfa 5,
      // Aylin'e atandı" rather than just a silent column flip. Skipped
      // when the assignment didn't actually change (un-assigning a
      // already-unassigned page, or reassigning to the same designer).
      const prevAssignee = result.page?.assigned_to ?? null
      if (prevAssignee !== assigned_to) {
        const verb = assigned_to ? `${result.page.assigned_to_name ?? '?'} tarafından atandı` : 'atama kaldırıldı'
        await logHistory(
          client,
          {
            project_id: project.id,
            from_stage: project.stage,
            to_stage: project.stage,
            action: 'system',
            event: 'subtask_progress',
            note: `${sub.title}, sayfa ${pageIndex} ${verb}`,
          },
          request.user,
        )
      }
      return {
        page: result.page,
        project: {
          ...updProject,
          assignees: assigneesOut,
          assigned_name: assigneesOut.map((a) => a.name).join(', ') || updProject.assigned_name || '—',
          subtasks: subtasksList,
          history,
        },
      }
    })
    return result
  })

  /**
   * POST /api/subtasks/:id/pages/bulk-assign
   *
   * Two modes, picked by the body shape:
   *   • `{ assigned_to: '<designerId>' }` — every page in the subtask
   *     goes to that one designer. The leader's "this whole book is
   *     Rahşan's now" gesture, replacing 200 per-chip popovers with
   *     one click.
   *   • `{ distribute: true }` — pages are assigned to the active
   *     designer roster in round-robin order (page 1 → designer A,
   *     page 2 → designer B, page N → designer N mod len). The
   *     leader's "split this whole book across the team" gesture.
   *
   * Both modes are leader-only and only meaningful on `kind='pages'`
   * subtasks. The body schema's `oneOf` enforces that exactly one of
   * the two keys is present; sending both or neither is a 400 before
   * the route runs.
   *
   * Implementation: a single UPDATE that joins a generated series of
   * page indexes against the computed per-page owner. For the
   * single-designer mode the per-page owner is constant; for the
   * distribute mode it's an array of length total_pages. Both run in
   * one statement, no per-page round-trip.
   *
   * Returns the same full project shape every other subtask route
   * uses so the SPA's `setProject` can drop it straight into state.
   */
  fastify.post('/subtasks/:id/pages/bulk-assign', { schema: schemas.subtasksPagesBulkAssign }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const subtaskId = request.params.id
    const { assigned_to, distribute } = request.body

    const result = await withTx(async (client) => {
      const { rows: subRows } = await client.query(
        'SELECT id, project_id, title, kind, total_pages FROM subtasks WHERE id = $1 FOR UPDATE',
        [subtaskId],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      if (sub.kind !== 'pages') badRequest('Bu alt görev "İç Sayfalar" türünde değil.')
      const project = await getProjectForUpdate(client, sub.project_id)
      if (!project) notFound('Proje bulunamadı.')

      const totalPages = Number(sub.total_pages)
      if (!Number.isFinite(totalPages) || totalPages <= 0) {
        badRequest('Alt görevin sayfa sayısı tanımsız.')
      }

      // Build the per-page owner array. For single-designer mode every
      // entry is the same id; for distribute mode we round-robin across
      // the designers actively working on THIS project — same set the
      // leader sees in the popover. Using the global active designer
      // roster would hand pages to designers who aren't even on the
      // project, which would surprise the leader and dump random work
      // on the recipient with no prior context. The query returns the
      // project primary UNION all distinct per-subtask assignees on
      // this project, filtered to role=designer AND is_active=true.
      let perPageOwners
      let summaryLabel
      if (distribute) {
        const { rows: designers } = await client.query(
          `SELECT DISTINCT u.id, u.name
             FROM users u
            WHERE u.is_active = true
              AND u.role = 'designer'
              AND (
                u.id = (SELECT assigned_to FROM projects WHERE id = $2)
                OR EXISTS (
                  SELECT 1 FROM subtasks s
                   WHERE s.project_id = $2
                     AND s.assigned_to = u.id
                )
              )
            ORDER BY u.name`,
          [subtaskId, project.id],
        )
        if (designers.length === 0) {
          badRequest('Bu projede atanmış aktif tasarımcı yok.')
        }
        perPageOwners = Array.from(
          { length: totalPages },
          (_, i) => designers[i % designers.length].id,
        )
        summaryLabel = 'tasarımcılara dağıtıldı'
      } else {
        // Validate the target designer is real and active before
        // committing the UPDATE. Cheap to do; cheap to skip; the
        // alternative is a 200-page UPDATE that succeeds against a
        // ghost id, which would be much harder to debug.
        const { rows: u } = await client.query(
          `SELECT 1 FROM users WHERE id = $1::text AND role = 'designer' AND is_active = true`,
          [assigned_to],
        )
        if (u.length === 0) {
          badRequest('Tasarımcı bulunamadı veya aktif değil.')
        }
        perPageOwners = new Array(totalPages).fill(assigned_to)
        summaryLabel = `${u[0]?.name ?? 'tasarımcı'} adına atandı`
      }

      // Single UPDATE that stamps every page's assigned_to. The
      // generate_series gives us (1, 2, …, total_pages); the array
      // literal gives us the per-page owner; the join lines them up
      // and the IS DISTINCT FROM guard makes the whole thing a no-op
      // when the new owners already match (avoids touching assigned_at
      // and updated_at on a redundant call).
      await client.query(
        `UPDATE subtask_pages
            SET assigned_to = owners.new_owner::text,
                assigned_at = CASE
                  WHEN assigned_to IS DISTINCT FROM owners.new_owner::text
                    THEN NOW()
                  ELSE assigned_at
                END,
                updated_at = NOW()
           FROM (
             SELECT g.i AS page_index, o.new_owner
               FROM generate_series(1, $2::int) AS g(i)
               CROSS JOIN UNNEST($3::text[]) WITH ORDINALITY AS o(new_owner, ord)
              WHERE o.ord = g.i
           ) AS owners
          WHERE subtask_pages.subtask_id = $1
            AND subtask_pages.page_index = owners.page_index`,
        [subtaskId, totalPages, perPageOwners],
      )

      // Same full-project-shape contract every other subtask route uses.
      const updProject = await patchProject(client, project.id, {})
      const subtasksList = await listProjectSubtasks(client, project.id)
      const history = await listProjectHistory(client, project.id)
      const assigneesOut = await loadProjectAssignees(client, updProject)
      await logHistory(
        client,
        {
          project_id: project.id,
          from_stage: project.stage,
          to_stage: project.stage,
          action: 'system',
          event: 'subtask_progress',
          note: `${sub.title}, tüm sayfalar ${summaryLabel}`,
        },
        request.user,
      )
      return {
        project: {
          ...updProject,
          assignees: assigneesOut,
          assigned_name: assigneesOut.map((a) => a.name).join(', ') || updProject.assigned_name || '—',
          subtasks: subtasksList,
          history,
        },
      }
    })
    return result
  })
}
