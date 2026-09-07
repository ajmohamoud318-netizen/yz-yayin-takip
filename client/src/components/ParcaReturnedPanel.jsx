import { RotateCcw, Printer, Monitor, Package, Hourglass } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * "Size dönen parçalar" — the parçalar a leader sent back to the designer,
 * and the way back out (migration 074).
 *
 * Before per-parça routing a reject bounced the whole project, so the designer's
 * cue was the project's own stage and the flagged subtasks. Neither works now:
 * the project stays at its approval gate while one parça is with them, so
 * nothing on the page would otherwise say "KİTAP is yours and KUTU is not".
 *
 * The route choice mirrors the project-level post-revize picker exactly, scoped
 * to one parça — physical means the matbaa produces it again, Ekran means a
 * screen check that skips the matbaa entirely. There is no default: the server
 * requires the choice for the same reason the project-level one does, and
 * guessing sends real work to the wrong desk.
 *
 * It is gated behind the sheet. "Revize Bitti, Gönderin" opens the spec form
 * (`onReview`) and the two roads only appear once the parent reports it read
 * (`reviewedParca`) — the same see-it-before-you-commit rule the matbaa's
 * İşlemi Başlatın and the leader's per-parça Onayla both follow. The designer
 * is about to put work back into the pipeline; they see what they are sending.
 *
 * Rows the designer does NOT own are shown too, greyed and without actions.
 * That is deliberate — the point of the feature is that work is happening in
 * parallel, and a designer who can only see their own parça cannot tell whether
 * the project is waiting on them or on the matbaa.
 *
 * @param {{
 *   rows: Array<{ parca: string, state: string, owner_role: string|null,
 *                 reason?: string, attempt?: number }>,
 *   canAct?: boolean,
 *   busyParca?: string | null,
 *   reviewedParca?: string | null,
 *   onReview: (parca: string) => void,
 *   onRequestRound: (parca: string, route: 'physical' | 'ekran') => void,
 *   className?: string,
 * }} props
 */
export default function ParcaReturnedPanel({
  rows = [], canAct = false, busyParca = null, reviewedParca = null,
  onReview, onRequestRound, className,
}) {
  const mine = rows.filter((r) => r.state === 'with_designer')
  const elsewhere = rows.filter((r) => r.state === 'with_matbaa' || r.state === 'in_round')

  // Nothing is out — the parça grid on this page already tells the whole story.
  if (mine.length === 0 && elsewhere.length === 0) return null

  return (
    <div className={cn('rounded-xl border bg-card p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Parça durumu
        </p>
        {mine.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
            <RotateCcw className="h-3 w-3" />
            {mine.length} parça sizde
          </span>
        )}
      </div>

      <div className="space-y-2">
        {mine.map((row) => (
          <ReturnedRow
            key={row.parca}
            row={row}
            canAct={canAct}
            busy={busyParca === row.parca}
            reviewed={reviewedParca === row.parca}
            onReview={onReview}
            onRequestRound={onRequestRound}
          />
        ))}
        {elsewhere.map((row) => (
          <ElsewhereRow key={row.parca} row={row} />
        ))}
      </div>
    </div>
  )
}

/** A parça that came back to the designer, with its way forward. */
function ReturnedRow({ row, canAct, busy, reviewed, onReview, onRequestRound }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <RotateCcw className="h-3.5 w-3.5 shrink-0 text-amber-600" strokeWidth={2.5} />
        {/* Wraps rather than truncates — the parça name is the subject of the
            whole row, and a clipped one is the wrong thing to redo. */}
        <span className="text-sm font-medium text-foreground">{row.parca}</span>
        {row.attempt > 1 && (
          <Badge variant="outline" className="text-[10px]">{row.attempt}. tur</Badge>
        )}
      </div>

      {row.reason && (
        <p className="mt-1.5 text-xs italic leading-snug text-muted-foreground">
          “{row.reason}”
        </p>
      )}

      {canAct && (
        reviewed ? (
          // The two roads back. Stacked on a phone so neither is a mis-tap
          // away from the other.
          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              size="sm"
              className="w-full gap-1.5"
              disabled={busy}
              onClick={() => onRequestRound?.(row.parca, 'physical')}
            >
              <Printer className="h-3.5 w-3.5" />
              Matbaadan İsteyin
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              disabled={busy}
              onClick={() => onRequestRound?.(row.parca, 'ekran')}
            >
              <Monitor className="h-3.5 w-3.5" />
              Ekran Onayı İsteyin
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="success"
            className="mt-2.5 w-full gap-1.5 sm:w-auto"
            disabled={busy}
            onClick={() => onReview?.(row.parca)}
          >
            {busy ? 'İşleniyor…' : 'Revize Bitti, Gönderin'}
          </Button>
        )
      )}
    </div>
  )
}

/** A parça that is somebody else's right now. Read-only, on purpose. */
function ElsewhereRow({ row }) {
  const started = row.state === 'in_round'
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
      {started
        ? <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        : <Hourglass className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <span className="text-sm text-muted-foreground">{row.parca}</span>
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
        {started ? 'Matbaada çalışılıyor' : 'Matbaada bekliyor'}
      </span>
    </div>
  )
}
