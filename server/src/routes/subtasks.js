import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { withTx } from '../db/pool.js'
import {
  getProject, getProjectForUpdate, patchProject, logHistory,
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
    if ((old.assigned_to ?? null) !== (s.assigned_to ?? null)) bits.push('atama değişti')
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
          badRequest(`Sayfa sayısı toplam sayfa sayısını (${sub.total_pages}) aşamaz.`)
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
      const updProject = await patchProject(client, project.id, { progress })
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
      return { subtask: updatedSub[0], project: updProject }
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
      return { project, entry: rows[0] }
    })
    return result
  })

  fastify.put('/projects/:id/subtasks', { schema: schemas.projectsSubtasksPut }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const project = await getProject(request.params.id)
    if (!project) notFound('Proje bulunamadı.')
    const subtasks = request.body.subtasks
    const result = await withTx(async (client) => {
      // ── Reconcile, don't recreate ──────────────────────────────────
      //
      // This route used to DELETE every subtask and re-INSERT the whole
      // list. The team leader edits the SHAPE of the list here (titles,
      // kinds, totals, assignment) — but the recreate also silently threw
      // away everything the DESIGNERS owned on those rows:
      //
      //   • pages_done / stickers_done   reset to 0
      //   • needs_revize                 cleared, so flagged rework vanished
      //   • done_at                      lost
      //   • subtask_updates              DELETED — the notes table FKs to
      //                                  subtasks.id ON DELETE CASCADE, so a
      //                                  save wiped every note on the project
      //
      // Updating survivors in place keeps their id, which is what saves the
      // notes; the columns above are simply never touched.
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
        const params = [
          s.title,
          s.kind ?? 'check',
          s.total_pages ?? null,
          s.total_stickers ?? null,
          !!s.is_done,
          subAssignee,
          index,
        ]

        if (existing) {
          const { rows } = await client.query(
            `UPDATE subtasks
                SET title = $2, kind = $3, total_pages = $4, total_stickers = $5,
                    is_done = $6, assigned_to = $7, position = $8,
                    -- Stamp done_at on the transition only, and clear it when
                    -- the row is reopened; an unchanged is_done keeps its
                    -- original completion time.
                    done_at = CASE WHEN $6 AND NOT is_done THEN NOW()
                                   WHEN NOT $6 THEN NULL
                                   ELSE done_at END,
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
               (project_id, title, kind, total_pages, total_stickers, is_done, assigned_to, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
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

      const inserted = finalRows
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
}
