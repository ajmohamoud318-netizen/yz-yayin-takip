import { useState } from 'react'
import { Check, Loader2, RotateCcw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import UserAvatar from '@/components/UserAvatar.jsx'
import { cn, formatDateTr } from '@/lib/utils'
import { batchCounter } from '@/domain/constants/subtasks'

/**
 * migration 067/071/082 — the "İç Sayfalar" (and, since 082, "Sticker")
 * subtask renders as a per-session log: each save appends one row to
 * `subtask_designer_batches`, a trigger recomputes the running total
 * on the subtask (`pages_done` / `stickers_done`) and flips `is_done`
 * when the counter meets the target. The log lives on the card so the
 * team's daily cadence is visible: who shipped how much, when.
 *
 * Migration 072 pinned each row to a `[start_page, start_page + pages - 1]`
 * range so two designers couldn't double-count a slot. The overlap
 * check kept the numbers honest but the UX was confusing — a designer
 * finishing "5 pages today" cared nothing about which slots those
 * were, and the parser (commas, dashes, mid-typing tolerance) still
 * misfired on nearly every input. Migration 084 walks it back: the
 * column, the index, the overlap probe and the range parser are gone.
 *
 * The new model — the one this component implements — is deliberately
 * additive:
 *   • A single numeric input ("+N sayfa" / "+N sticker"). No slots.
 *   • One shared counter on the subtask, summed across every designer.
 *   • Each entry appears in the log with the row's designer, when it
 *     landed, and — new here — a "Sil" affordance so a designer can
 *     retract their own mistake. The team leader can remove any row.
 *   • The "Yeniden Çalıştım" flow on unredone rows is unchanged.
 *
 * The server still validates: `pages > 0` and `pages_done + pages ≤
 * total`. We mirror both here so most bad inputs are stopped before
 * the round trip; the FOR UPDATE lock in the route still has the
 * final say on races against a concurrent bump of `total_*`.
 *
 * Props:
 *   • subtask — kind='pages'|'sticker-count' row from project.subtasks:
 *       { id, total_pages, pages_done, is_done, designer_batches: […],
 *         assigned_to, … }
 *       `designer_batches` is the server-derived per-session log
 *       (newest first). Each entry:
 *         { id, subtask_id, designer_id, designer_name, pages,
 *           created_at, redone_at, redone_by, redone_by_name }
 *       No `start_page` — migration 084 dropped the column.
 *   • canEdit — boolean. Stages where the input is read-only still
 *       render the batch log so the team can see who shipped what.
 *   • currentUserId — the viewing user's id; used to gate the "Sil"
 *       button on the row's own designer.
 *   • isLeader — boolean. Team leaders can remove any row; without
 *       this, a leader viewing a designer's row wouldn't see the
 *       affordance.
 *   • allUsers — the project's assignee list (name lookup for the
 *       add-row avatar). Server already JOINs `users.name` into each
 *       batch row so the log's avatars fill in without it.
 *   • onAddBatch — async (designerId, pages) => Promise. `pages` is
 *       a positive integer. Hook wires the API call + optimistic
 *       merge + revert on failure.
 *   • onRedoneBatch — async (batchId) => Promise. Idempotent — a
 *       second call after the first is a no-op.
 *   • onRemoveBatch — async (batchId) => Promise. The row disappears
 *       optimistically; on failure the hook re-inserts it and this
 *       component surfaces the error.
 */
export default function DesignerPagesInput({
  subtask,
  canEdit,
  currentUserId,
  isLeader,
  allUsers = [],
  onAddBatch,
  onRedoneBatch,
  onRemoveBatch,
}) {
  // İç Sayfalar counts pages, Sticker counts stickers (migration 082); the
  // log, the input and the rules are otherwise the same.
  const { total: totalField, done: doneField, unit, unitTitle } =
    batchCounter(subtask.kind) ?? batchCounter('pages')
  const total = Number(subtask[totalField] ?? 0)
  const batches = Array.isArray(subtask.designer_batches) ? subtask.designer_batches : []
  const pagesDone = Number(subtask[doneField] ?? 0)
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
  const [draftPages, setDraftPages] = useState('')
  const [draftDesignerId, setDraftDesignerId] = useState(() => {
    // Default to "my slot" when the actor is one of the designers who
    // already logged on this subtask, else the subtask's primary owner.
    // The team leader can change the picker to log a batch on a
    // teammate's behalf.
    const me = currentUserId
    const owners = new Set(batches.map((b) => b.designer_id).filter(Boolean))
    if (me && owners.has(me)) return me
    return subtask.assigned_to || me || ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [redoneBusyId, setRedoneBusyId] = useState(null)
  const [removingBusyId, setRemovingBusyId] = useState(null)

  // Placeholder mirrors the remaining work so the designer sees the
  // ceiling before typing. Bare number — no more comma/dash example,
  // because the input no longer accepts either.
  const remaining = Math.max(0, total - pagesDone)
  const placeholder = remaining > 0 ? String(remaining) : '—'

  async function commitAdd(e) {
    if (e) e.preventDefault()
    if (!canEdit || saving) return
    const pages = Number.parseInt(draftPages, 10)
    if (!Number.isFinite(pages) || pages <= 0) {
      setError(`${unitTitle} sayısı girin (örn. 5).`)
      return
    }
    // Bounds check mirrors the route (`pages_done + pages ≤ total`) so
    // most bad inputs are caught before the round trip. The server
    // still re-validates under a row lock, so a concurrent bump of the
    // total can't sneak past.
    if (total > 0 && pagesDone + pages > total) {
      setError(
        `${unitTitle} ${pagesDone + pages} toplam ${unit} sayısını (${total}) aşamaz.`,
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
      await onAddBatch(draftDesignerId, pages)
      setDraftPages('')
    } catch (e2) {
      setError(e2?.message || `${unitTitle} eklenemedi.`)
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

  async function commitRemove(batchId) {
    if (removingBusyId === batchId) return
    setRemovingBusyId(batchId)
    setError(null)
    try {
      await onRemoveBatch(batchId)
    } catch (e) {
      setError(e?.message || 'Kayıt silinemedi.')
    } finally {
      setRemovingBusyId(null)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') commitAdd()
    else if (e.key === 'Escape') setDraftPages('')
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
          {subtask.title || 'İç Sayfalar'}
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
            Henüz {unit} eklenmedi.
          </li>
        ) : (
          batches.map((b) => {
            const redoBusy = redoneBusyId === b.id
            const removeBusy = removingBusyId === b.id
            const user = usersById.get(b.designer_id) ?? {
              id: b.designer_id,
              name: b.designer_name,
            }
            const isMine = currentUserId && b.designer_id === currentUserId
            // Only the batch's own designer can redo it — canEdit alone
            // (any assigned designer on this subtask) is not enough,
            // or Mehmet could redo Ayşe's batch and vice versa.
            const canRedo = canEdit && !b.redone_at && isMine
            // A designer can remove their own row; the team leader can
            // remove any row. The plan doesn't exclude redone rows —
            // if the leader wants to prune the audit trail, they can.
            const canRemove = canEdit && (isMine || isLeader)
            const whenLabel = (() => {
              const d = b.created_at ? new Date(b.created_at) : null
              if (!d || Number.isNaN(d.getTime())) return ''
              return formatDateTr(d)
            })()
            // Additive model (migration 084): each row is a plain
            // "+N sayfa" / "+N sticker" contribution to the shared
            // counter. No more page ranges.
            const rangeLabel = `+${b.pages} ${unit}`
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
                {canRemove && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => commitRemove(b.id)}
                    disabled={removeBusy}
                    // If a redone badge or Yeniden Çalıştım already
                    // claimed `ml-auto`, this button follows it. On a
                    // fresh row with neither, it takes `ml-auto` itself
                    // so the button lands at the right edge.
                    className={cn(
                      'h-7 w-7 p-0 text-muted-foreground hover:text-rose-600',
                      !b.redone_at && !canRedo && 'ml-auto',
                    )}
                    title="Sil"
                  >
                    {removeBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
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
              // Digits only — 6 chars is enough for the largest book
              // we'd ever ship, and stops any comma/dash from arriving
              // as a hangover from the old parser.
              value={draftPages}
              disabled={saving}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/\D/g, '').slice(0, 6)
                setDraftPages(cleaned)
                if (error) setError(null)
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              className={cn(
                'h-8 w-36 rounded-md border bg-background px-2 text-right tabular-nums text-sm shadow-sm',
                'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
                'disabled:cursor-not-allowed disabled:opacity-60',
                error ? 'border-rose-300 ring-1 ring-rose-200' : 'border-input',
              )}
            />
            <span className="text-xs tabular-nums text-muted-foreground">/ {total || '—'}</span>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !draftPages}
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
