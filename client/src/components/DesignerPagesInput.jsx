import { useState } from 'react'
import { Check, Loader2, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import UserAvatar from '@/components/UserAvatar.jsx'
import { cn, formatDateTr } from '@/lib/utils'
import { parsePageRange } from '@/lib/page-range'

/**
 * migration 067/068 — the "İç Sayfalar" subtask renders as a session log.
 *
 * Top of the card: each prior batch (id + designer + pages + when),
 * each with its own "Yeniden Çalıştım" affordance when `redone_at` is
 * null. Bottom of the card: a per-designer range input. A range like
 * "1-5" or a single page "5" lands as one POST to the new
 * `/subtasks/:id/designer-batches` endpoint = one row appended to the
 * top of the list.
 *
 * Migration 068 — the row also pins to a page range `[start_page,
 * start_page + pages - 1]`. The server rejects any save whose range
 * overlaps an existing batch on this subtask, so the designer's log
 * can never double-count a page.
 *
 * Props:
 *   • subtask — kind='pages' row from project.subtasks:
 *       { id, total_pages, pages_done, is_done, designer_batches: […],
 *         assigned_to, … }
 *       `designer_batches` is the server-derived per-session log
 *       (newest first). Each entry:
 *         { id, designer_id, designer_name, pages, start_page,
 *           created_at, redone_at, redone_by, redone_by_name }
 *   • canEdit — boolean. Stages where the input is read-only still
 *       render the batch log so the team can see who shipped what.
 *   • onAddBatch — async (designerId, pages, startPage) => Promise.
 *       Hook wires the API call + optimistic merge + revert on failure.
 *   • onRedoneBatch — async (batchId) => Promise. Idempotent — a second
 *       call after the first is a no-op.
 */
export default function DesignerPagesInput({
  subtask,
  canEdit,
  currentUserId,
  allUsers = [],
  onAddBatch,
  onRedoneBatch,
}) {
  const total = Number(subtask.total_pages ?? 0)
  const batches = Array.isArray(subtask.designer_batches) ? subtask.designer_batches : []
  const pagesDone = Number(subtask.pages_done ?? 0)
  const isDone = !!subtask.is_done

  // Map designer_id → { name, id } for fast lookup when rendering batch
  // rows. Falls back gracefully if the user list is still loading —
  // server already JOINs users.name, so this is just for the
  // add-row's avatar (which the server hasn't prefilled).
  const usersById = new Map(
    (Array.isArray(allUsers) ? allUsers : [])
      .filter((u) => u && u.id)
      .map((u) => [u.id, u]),
  )

  // ── local state for the "+N ekledim" input row ─────────────────────
  const [draftPage, setDraftPage] = useState('')
  const [draftDesignerId, setDraftDesignerId] = useState(() => {
    // Default to "my slot" when the actor is one of the slot owners,
    // else the subtask's primary. The team leader can change the
    // picker to log a batch on a teammate's behalf.
    const me = currentUserId
    const owners = new Set(batches.map((b) => b.designer_id).filter(Boolean))
    if (me && owners.has(me)) return me
    return subtask.assigned_to || me || ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [redoneBusyId, setRedoneBusyId] = useState(null)

  async function commitAdd(e) {
    if (e) e.preventDefault()
    if (!canEdit || saving) return
    const parsed_range = parsePageRange(draftPage)
    if (!parsed_range) {
      setError('Sayfa numarası veya aralığı girin (örn. 5 veya 1-5).')
      return
    }
    const { start: startPage, pages } = parsed_range
    // Migration 068 — the route checks both the range bounds (start + pages
    // - 1 ≤ total) and the overlap with existing batches. We mirror the
    // bounds check here so the designer gets feedback before the round
    // trip; the server still re-validates inside the FOR UPDATE lock,
    // so a concurrent bump of total_pages can't sneak past.
    if (total > 0 && startPage + pages - 1 > total) {
      setError(
        `Sayfa aralığı (${startPage}-${startPage + pages - 1}) toplam sayfa sayısını (${total}) aşamaz.`,
      )
      return
    }
    if (!draftDesignerId) {
      setError('Lütfen tasarımcı seçin.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onAddBatch(draftDesignerId, pages, startPage)
      setDraftPage('')
    } catch (e2) {
      setError(e2?.message || 'Sayfa eklenemedi.')
    } finally {
      setSaving(false)
    }
  }

  async function commitRedone(batchId) {
    if (redoneBusyId === batchId) return
    setRedoneBusyId(batchId)
    setError(null)
    try {
      await onRedoneBatch(batchId)
    } catch (e) {
      setError(e?.message || 'Yeniden çalıştım kaydedilemedi.')
    } finally {
      setRedoneBusyId(null)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') commitAdd()
    else if (e.key === 'Escape') setDraftPage('')
  }

  // ── derive the add-row designer choices ────────────────────────────
  // Designers that already have batches (so the leader can add a
  // continuation) plus the subtask's primary owner, plus the current
  // user. De-duped and ordered by name for the picker.
  const designerChoices = (() => {
    const ids = new Set()
    for (const b of batches) ids.add(b.designer_id)
    if (subtask.assigned_to) ids.add(subtask.assigned_to)
    if (currentUserId) ids.add(currentUserId)
    return Array.from(ids)
      .map((id) => usersById.get(id) ?? { id, name: null })
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'tr'))
  })()

  return (
    <div
      className={cn(
        'rounded-lg border bg-background px-3 py-2.5 text-sm transition',
        isDone && 'border-emerald-200 bg-emerald-50/40',
        !canEdit && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={cn(
            'min-w-0 flex-1 basis-40 text-sm font-medium',
            isDone && 'text-muted-foreground line-through',
          )}
        >
          İç Sayfalar
        </span>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {pagesDone} / {total || '—'} tamamlandı
        </span>
      </div>

      {/* Batch log — newest first. The team's daily cadence lives here;
          a leader can scroll back through the day to see who shipped
          what when. */}
      <ul className="mt-2 space-y-1">
        {batches.length === 0 ? (
          <li className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground">
            Henüz sayfa eklenmedi.
          </li>
        ) : (
          batches.map((b) => {
            const redoBusy = redoneBusyId === b.id
            const user = usersById.get(b.designer_id) ?? {
              id: b.designer_id,
              name: b.designer_name,
            }
            const isMine = currentUserId && b.designer_id === currentUserId
            const canRedo = canEdit && !b.redone_at && (isMine || canEdit /* leader override */)
            const whenLabel = (() => {
              const d = b.created_at ? new Date(b.created_at) : null
              if (!d || Number.isNaN(d.getTime())) return ''
              return formatDateTr(d)
            })()
            // Migration 068 — each batch knows the page range it covers.
            // Render "1-5" when start_page is known (new writes and
            // backfilled rows); fall back to "+N sayfa" only for legacy
            // rows where start_page is null.
            const rangeLabel = (() => {
              if (b.start_page == null) return `+${b.pages} sayfa`
              const start = Number(b.start_page)
              const end = start + Number(b.pages ?? 0) - 1
              return start === end ? `${start} sayfa` : `${start}-${end} sayfa`
            })()
            return (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-background/60 px-2.5 py-1.5 text-xs"
              >
                <UserAvatar user={user} size="xs" />
                <span className="font-medium">{user.name || b.designer_name || b.designer_id}</span>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 font-semibold tabular-nums text-primary">
                  {rangeLabel}
                </span>
                <span className="text-muted-foreground">{whenLabel}</span>
                {b.redone_at ? (
                  <span
                    className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                    title={b.redone_at}
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    {b.redone_by_name ? `${b.redone_by_name} yeniden çalıştı` : 'Yeniden çalışıldı'}
                  </span>
                ) : (
                  canRedo && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => commitRedone(b.id)}
                      disabled={redoBusy}
                      className="ml-auto h-7 px-2 text-[11px]"
                      title="Bu partiyi yeniden gözden geçirdim"
                    >
                      {redoBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <RotateCcw className="mr-1 h-3 w-3" />
                          Yeniden Çalıştım
                        </>
                      )}
                    </Button>
                  )
                )}
              </li>
            )
          })
        )}
      </ul>

      {/* Add row — disabled when the actor can't edit. The designer
          picker lets the leader attribute a batch to a teammate;
          a designer usually sees only themselves. */}
      {canEdit && (
        <form
          onSubmit={commitAdd}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          {designerChoices.length > 1 && (
            <select
              value={draftDesignerId}
              onChange={(e) => setDraftDesignerId(e.target.value)}
              disabled={saving}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {designerChoices.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.id}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">+</span>
            <input
              type="text"
              inputMode="numeric"
              // Migration 068 — accept either "5" or "1-5". Anything else
              // falls through to parsePageRange returning null and the
              // route's "Sayfa numarası veya aralığı girin" message. A
              // number-type input would refuse the dash, hence text.
              value={draftPage}
              disabled={saving}
              onChange={(e) => {
                setDraftPage(e.target.value)
                if (error) setError(null)
              }}
              onBlur={() => {
                if (draftPage && parsePageRange(draftPage)) commitAdd()
              }}
              onKeyDown={onKeyDown}
              placeholder="5 veya 1-5"
              className={cn(
                'h-8 w-24 rounded-md border bg-background px-2 text-right tabular-nums text-sm shadow-sm',
                'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
                'disabled:cursor-not-allowed disabled:opacity-60',
                error ? 'border-rose-300 ring-1 ring-rose-200' : 'border-input',
              )}
            />
            <span className="text-xs tabular-nums text-muted-foreground">/ {total || '—'}</span>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !draftPage}
              className="h-8 px-2.5"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Ekle
                </>
              )}
            </Button>
          </div>
          {error && (
            <span className="basis-full text-[11px] text-rose-600">
              {error}
            </span>
          )}
        </form>
      )}
    </div>
  )
}
