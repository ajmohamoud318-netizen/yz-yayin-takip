import { ArrowRight, CheckCircle2, Send, Package } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * One parça of one project, as a job in its own right (migration 074).
 *
 * Every other card in the matbaa's queue is a project — one row, one sheet,
 * one button. That stops working once a leader can send back KUTU alone: the
 * project card would say "Demo teslimi bekleniyor" while three quarters of the
 * sheet is already approved and nothing tells the printer which parça they
 * actually owe. This card is the answer — its subject is the parça, and the
 * project is context.
 *
 * The two states mirror the project-level ladder exactly, because it is the
 * same job scoped smaller:
 *
 *   with_matbaa → "İşlemi Başlatın"  (work not begun)
 *   in_round    → "Teslim Edin"      (work begun, delivery owed)
 *
 * Both open the spec sheet rather than acting directly. That is not a detail:
 * the matbaa commits to producing what is on the sheet, so they see it first —
 * the same rule the project-level buttons follow (see useProjectDelivery's
 * note on why there is no bare 'demo-start' confirm).
 *
 * @param {{
 *   row: { project_id: string, project_title: string, parca: string,
 *          state: string, gate: string, attempt?: number, reason?: string },
 *   busy?: boolean,
 *   onAct: (row: object) => void,
 *   onNavigate: (projectId: string) => void,
 * }} props
 */
export default function ParcaJobCard({ row, busy = false, onAct, onNavigate }) {
  const started = row.state === 'in_round'
  const status = started
    ? { tone: 'bg-primary/10 text-primary ring-primary/20', label: 'Matbaada · teslime hazır' }
    : { tone: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'Matbaa çalışması başlamadı' }
  const ActionIcon = started ? Send : CheckCircle2
  const actionLabel = started ? 'Teslim Edin' : 'İşlemi Başlatın'

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
        <span className={cn(
          'grid h-10 w-10 shrink-0 place-items-center rounded-full ring-1 ring-inset',
          status.tone,
        )}>
          <Package className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          {/* The parça leads, because it is what the printer has to produce.
              The project title follows on its own line and wraps rather than
              truncating — on a 390px screen a clipped title is how you print
              the wrong book. */}
          <p className="text-sm font-semibold leading-snug text-foreground">
            {row.parca}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {row.project_title}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">
              {row.gate === 'ozalit' ? 'Prova baskı' : 'Numune baskı'}
            </Badge>
            {row.attempt > 1 && (
              <Badge variant="outline" className="text-[10px]">{row.attempt}. tur</Badge>
            )}
          </p>
          <span className={cn(
            'mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
            status.tone,
          )}>
            {status.label}
          </span>
          {/* Why it came back. The printer is being asked to redo one parça —
              without the reason they are guessing at what was wrong with it. */}
          {row.reason && (
            <p className="mt-1.5 text-xs italic leading-snug text-muted-foreground">
              “{row.reason}”
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            size="sm"
            className="w-full gap-1.5 sm:w-auto"
            disabled={busy}
            onClick={() => onAct?.(row)}
          >
            <ActionIcon className="h-4 w-4" />
            {actionLabel}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="w-full gap-1.5 text-muted-foreground sm:w-auto"
            onClick={() => onNavigate?.(row.project_id)}
          >
            <ArrowRight className="h-3.5 w-3.5" />
            Detay
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
