import { orderStepPath } from '@/api'
import { cn } from '@/lib/utils'

/**
 * The sipariş step strip at the top of TalepSignDialog — split out of it
 * (slice: client god-components).
 *
 * Where this order is on its path, as one row of chips: everything up to and
 * including the current status reads as done, the next step is outlined, the
 * rest are grey.
 */

// ── Order-step progress helpers ──────────────────────────────────────────────
// An order's TRUE position is its current `status`, NOT whatever lingers in
// order_history. A rejection loops the order backward (e.g. matbaa_onay →
// goruldu) yet leaves the old forward entries in history; deriving state
// from `status` makes rolled-back steps correctly render as "not yet reached"
// instead of falsely showing as signed.
function reachedStepIndex(order) {
  return orderStepPath(order).indexOf(order?.status)
}

// Compact label for the mini-pipeline strip — a long raw step key like
// `baski_onayi_bekleniyor` would overflow the chip and visually crash into
// its neighbour (see chip layout note below). The earlier map keyed on the
// pre-migration-066 step names (pending / goruldu / kontrol_edildi / …) and
// silently fell through to the raw key once the workflow was renamed — that
// was the actual cause of the truncated/overlapping text in the screenshot.
const MINI_PIPELINE_LABELS = {
  atama_bekleniyor: 'Atama',
  tasarimciya_atandi: 'Tasarım',
  kontroller_tamam: 'Kontrol',
  matbaa_ozalit_yapiyor: 'Ozalit',
  ekran_onayinda: 'Ekran',
  imza_bekleniyor: 'İmza',
  baski_onayi_bekleniyor: 'Baskı Onayı',
  baskida: 'Üretim',
}

function stepShortLabel(step) {
  return MINI_PIPELINE_LABELS[step] ?? step
}

export default function MiniPipeline({ order, nextStep }) {
  const allSteps = orderStepPath(order)
  const reached = reachedStepIndex(order)
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {allSteps.map((step, i) => {
        const done = i <= reached
        const isNext = step === nextStep
        const label = stepShortLabel(step)
        return (
          // Wrapper keeps the chip + connector glued. `shrink-0` on both the
          // pair and the inner pill is critical: with `min-w-0` + `whitespace-nowrap`
          // the long step text used to overflow the chip's bounds, drawing
          // across the neighbour and producing the "stacked-on-top" look.
          // Refusing to shrink and letting the outer `overflow-x-auto`
          // scroll instead is the actual fix.
          <div key={step} className="flex shrink-0 items-center">
            <div className={cn(
              'flex h-6 shrink-0 items-center justify-center rounded-full px-2 text-[10px] font-semibold whitespace-nowrap',
              done ? 'bg-emerald-100 text-emerald-700' : isNext ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'bg-muted text-muted-foreground/50',
            )}>
              {label}
            </div>
            {i < allSteps.length - 1 && (
              <span className={cn('mx-0.5 h-px w-3 shrink-0', done ? 'bg-emerald-300' : 'bg-border')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

