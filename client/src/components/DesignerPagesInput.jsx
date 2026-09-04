import { useState } from 'react'
import { Check, Loader2, User as UserIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import UserAvatar from '@/components/UserAvatar.jsx'
import { cn } from '@/lib/utils'

/**
 * migration 067 — replace PageChipGrid with a per-designer number input.
 *
 * Each assigned designer gets a row with their avatar, name, a numeric
 * input pre-filled with their current count, a "/ {total_pages}" cap
 * and a "Kaydet" button. Saving fires for one designer at a time —
 * either by clicking the button or by pressing Enter / Tab away from
 * the input. One round-trip to PATCH /subtasks/:id/designer-counts per
 * save.
 *
 * Compared with the chip grid this is dramatically lighter on the DB:
 * one UPSERT + trigger + patchProject per save instead of ~12 SQL
 * statements per chip click. A designer marking "48 / 80 done" lands
 * as a single commit, regardless of how many intermediate values they
 * typed before settling on 48.
 *
 * Props:
 *   • subtask — the İç Sayfalar row from the project's subtasks list.
 *     Carries `total_pages`, the page cap; `designer_counts` (the
 *     server-derived slots) carries the per-designer current counts.
 *   • canEdit — boolean. Subtasks in revision / on a frozen stage read
 *     the existing values but the inputs disable.
 *   • onSave — async (designerId, pagesDone) => Promise. Parent hook
 *     (`useProjectSubtasks.handleDesignerCountChange`) wires the API
 *     call + optimistic merge + revert on failure.
 *
 * Slot visibility: if `designer_counts` is empty (a leader hasn't
 * assigned anyone yet) we render a single empty row for the current
 * user, so a designer hitting "İç Sayfalar" on a project that has no
 * slot yet gets a writable input. Submitting that row materialises the
 * slot on the server (the route's `INSERT … ON CONFLICT DO UPDATE` is
 * idempotent for first-time rows).
 */
export default function DesignerPagesInput({ subtask, canEdit, onSave }) {
  const total = Number(subtask.total_pages ?? 0)
  const slots = Array.isArray(subtask.designer_counts) ? subtask.designer_counts : []
  const pagesDone = Number(subtask.pages_done ?? 0)
  const isDone = !!subtask.is_done
  // Per-row local state. Optimistically cleared after a successful
  // save so the next edit starts from the server-confirmed value, but
  // while the user is typing we hold the in-flight value to avoid
  // round-tripping on every keystroke.
  const [drafts, setDrafts] = useState({}) // designer_id -> string
  const [savingId, setSavingId] = useState(null)
  const [errorId, setErrorId] = useState(null)

  // Build a stable slot list — fall back to a single anonymous row when
  // there are no slots yet (the leader hasn't assigned anyone, or the
  // migration's pre-create INSERT hasn't yet run for the current user).
  // The latter is what makes the input appear for the designer the
  // first time the project lands at the right stage.
  const rows = slots.length > 0
    ? slots.map((s) => ({
        designer_id: s.designer_id,
        designer_name: s.designer_name ?? s.designer_id,
        pages_done: s.pages_done,
      }))
    : []

  function valueFor(designerId, fallback) {
    return drafts[designerId] ?? String(fallback ?? '')
  }

  function setDraft(designerId, v) {
    setDrafts((prev) => ({ ...prev, [designerId]: v }))
    if (errorId === designerId) setErrorId(null)
  }

  async function commit(row, raw) {
    if (!canEdit) return
    const trimmed = String(raw ?? '').trim()
    if (!trimmed) {
      setErrorId(row.designer_id)
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setErrorId(row.designer_id)
      return
    }
    if (total > 0 && parsed > total) {
      setErrorId(row.designer_id)
      return
    }
    setSavingId(row.designer_id)
    setErrorId(null)
    try {
      await onSave(row.designer_id, Math.floor(parsed))
      // Clear draft so the next render reads from the (now-confirmed)
      // server value via `valueFor(…, fallback)`.
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[row.designer_id]
        return next
      })
    } catch (e) {
      setErrorId(row.designer_id)
    } finally {
      setSavingId(null)
    }
  }

  function onKeyDown(e, row, raw) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(row, raw)
    } else if (e.key === 'Escape') {
      // Restore the server-confirmed value, drop any draft.
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[row.designer_id]
        return next
      })
    }
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-background px-3 py-2.5 text-sm transition',
        isDone
          ? 'border-emerald-200 bg-emerald-50/40'
          : 'hover:border-primary/30',
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

      <div className="mt-2 space-y-1.5">
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground">
            Henüz tasarımcı atanmamış.
          </p>
        ) : (
          rows.map((row) => {
            const isSaving = savingId === row.designer_id
            const hasError = errorId === row.designer_id
            const val = valueFor(row.designer_id, row.pages_done)
            const dirty = val !== String(row.pages_done ?? '')
            return (
              <div
                key={row.designer_id}
                className={cn(
                  'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-background/60 px-2.5 py-1.5 transition',
                  hasError
                    ? 'border-rose-300 ring-1 ring-rose-200'
                    : dirty
                      ? 'border-primary/40 ring-1 ring-primary/15'
                      : 'border-transparent',
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <UserAvatar user={{ id: row.designer_id, name: row.designer_name }} size="xs" />
                  <span className="truncate text-xs font-medium text-foreground">{row.designer_name}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={total || undefined}
                    step={1}
                    value={val}
                    disabled={!canEdit || isSaving}
                    onChange={(e) => setDraft(row.designer_id, e.target.value)}
                    onBlur={() => dirty && commit(row, val)}
                    onKeyDown={(e) => onKeyDown(e, row, val)}
                    className={cn(
                      'h-8 w-20 rounded-md border border-input bg-background px-2 text-right tabular-nums text-sm shadow-sm transition',
                      'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                    )}
                  />
                  <span className="text-[11px] tabular-nums text-muted-foreground">/ {total || '—'}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={dirty ? 'default' : 'outline'}
                    disabled={!canEdit || isSaving || !dirty}
                    onClick={() => commit(row, val)}
                    className="h-8 px-2.5"
                  >
                    {isSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : dirty ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <span className="text-[11px]">Kaydet</span>
                    )}
                  </Button>
                </div>
                {hasError && (
                  <span className="basis-full text-[11px] text-rose-600">
                    Geçerli bir sayı girin (0–{total || '—'}).
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
