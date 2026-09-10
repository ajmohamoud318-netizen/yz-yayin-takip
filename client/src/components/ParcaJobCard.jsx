import { ArrowRight, CheckCircle2, Send, Package, MessageSquareWarning, Ban } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import OrderNoBadge from '@/components/OrderNoBadge'
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
 * `compact` is for the project's own page, where the header directly above
 * already names the book and links nowhere else: the project line and the
 * "Detay" button both become restatements, and on a 390px screen each one
 * costs a row of the card the parça needs.
 *
 * A third state joins the two above once the leader can ask for a parça back
 * (migration 077): a pending change request. It is answered here rather than
 * through the sheet, because unlike Başlat and Teslim it is not a commitment
 * to produce anything — it is a yes or no to a question, and the note the
 * leader wrote is the whole of what the printer needs to decide.
 *
 * @param {{
 *   row: { project_id: string, project_title: string, parca: string,
 *          state: string, gate: string, attempt?: number, reason?: string,
 *          change_requested_at?: string|null, change_requested_by_name?: string|null,
 *          change_requested_note?: string|null, fix_pending?: boolean },
 *   busy?: boolean,
 *   compact?: boolean,
 *   onAct: (row: object) => void,
 *   onRespondChange?: (row: object, answer: 'accept' | 'decline') => void,
 *   onNavigate: (projectId: string) => void,
 * }} props
 */
export default function ParcaJobCard({
  row, busy = false, compact = false, onAct, onRespondChange, onNavigate,
}) {
  const started = row.state === 'in_round'
  const asked = !!row.change_requested_at
  // The leader's correction is owed, and `startParca` refuses until it lands.
  // Offering the button anyway would be a guaranteed 400 dressed as work.
  const awaitingFix = !!row.fix_pending
  const status = awaitingFix
    ? { tone: 'bg-blue-50 text-blue-700 ring-blue-200', label: 'Düzeltilmiş form bekleniyor' }
    : asked
      ? { tone: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'Değişiklik talebi · yanıtınız bekleniyor' }
      : started
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
          {!compact && (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {row.project_title}
            </p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">
              {row.gate === 'ozalit' ? 'Prova baskı' : 'Numune baskı'}
            </Badge>
            {row.attempt > 1 && (
              <Badge variant="outline" className="text-[10px]">{row.attempt}. tur</Badge>
            )}
            {/* The last parça of a sipariş round lands here alone, and without
                this it reads exactly like the project's own round of the
                same book — or like the other reprint of it. */}
            {row.order_id && <OrderNoBadge order={row} />}
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
          {/* The ask, in the leader's own words. The printer is being asked to
              drop work in progress; without the note they can only guess at
              whether it is worth it, which makes the answer arbitrary. */}
          {asked && (
            <div className="mt-2 rounded-lg bg-amber-50 p-2.5 ring-1 ring-inset ring-amber-200">
              <p className="flex items-start gap-1.5 text-xs font-medium leading-snug text-amber-800">
                <MessageSquareWarning className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  {row.change_requested_by_name || 'Ekip lideri'} bu parça için değişiklik istiyor
                </span>
              </p>
              {row.change_requested_note && (
                <p className="mt-1 pl-5 text-xs italic leading-snug text-amber-800">
                  “{row.change_requested_note}”
                </p>
              )}
              <p className="mt-1 pl-5 text-[11px] leading-snug text-amber-700">
                Kabul ederseniz çalışma durur ve düzeltilmiş formu beklersiniz.
                Reddederseniz baskıya devam edip teslim edersiniz.
              </p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          {/* An unanswered ask replaces the work button rather than sitting
              beside it. Both at once would let the printer deliver a parça
              in the same breath as agreeing to stop working on it. */}
          {asked ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5 sm:w-auto"
                disabled={busy}
                onClick={() => onRespondChange?.(row, 'accept')}
              >
                <CheckCircle2 className="h-4 w-4" />
                Kabul Edin
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5 text-destructive hover:text-destructive sm:w-auto"
                disabled={busy}
                onClick={() => onRespondChange?.(row, 'decline')}
              >
                <Ban className="h-4 w-4" />
                Reddedin
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="w-full gap-1.5 sm:w-auto"
              disabled={busy || awaitingFix}
              onClick={() => onAct?.(row)}
            >
              <ActionIcon className="h-4 w-4" />
              {awaitingFix ? 'Düzeltme Bekleniyor' : actionLabel}
            </Button>
          )}
          {!compact && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full gap-1.5 text-muted-foreground sm:w-auto"
              onClick={() => onNavigate?.(row.project_id)}
            >
              <ArrowRight className="h-3.5 w-3.5" />
              Detay
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
