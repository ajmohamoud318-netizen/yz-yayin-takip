import { CheckCircle2, Send, Layers } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import ParcaJobCard from '@/components/ParcaJobCard'

/**
 * One project's parçalar as a single matbaa job, with the choice of doing them
 * together or one at a time.
 *
 * The printer's real workflow is both: a fresh sheet is usually produced in one
 * pass, but a round where only KUTU came back — or where KİTAP is ready and the
 * kutu stock hasn't arrived — is worked piecemeal. Forcing either shape is
 * wrong, so the group offers the bulk action at the top and leaves every parça
 * its own button underneath.
 *
 * Whatever they don't act on stays in the queue. The project itself only moves
 * when the last parça is delivered — `allParcalarDelivered` in
 * services/parca-service.js is the gate, not this card.
 *
 * Both bulk buttons can be present at once on a mixed group (some started, some
 * not); each is scoped to the parçalar actually in that state and says how
 * many, so neither ever silently acts on something the printer didn't mean.
 *
 * @param {{
 *   projectId: string,
 *   projectTitle: string,
 *   rows: object[],
 *   busy?: boolean,
 *   onAct: (row: object) => void,
 *   onActAll: (rows: object[]) => void,
 *   onNavigate: (projectId: string) => void,
 * }} props
 */
export default function ParcaJobGroup({
  projectTitle, rows = [], busy = false, onAct, onActAll, onNavigate,
}) {
  if (rows.length === 0) return null

  // A lone parça needs no group chrome — it IS the job.
  if (rows.length === 1) {
    return <ParcaJobCard row={rows[0]} busy={busy} onAct={onAct} onNavigate={onNavigate} />
  }

  const unstarted = rows.filter((r) => r.state !== 'in_round')
  const started = rows.filter((r) => r.state === 'in_round')
  const gateLabel = rows[0].gate === 'ozalit' ? 'Prova baskı' : 'Numune baskı'

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="border-b bg-muted/30 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              {/* Wraps, never truncates — this is the book they are printing. */}
              <p className="text-sm font-semibold leading-snug text-foreground">
                {projectTitle}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5" />
                  {rows.length} parça
                </span>
                <Badge variant="outline" className="text-[10px]">{gateLabel}</Badge>
              </p>
            </div>

            {/* Bulk first: doing the whole sheet in one pass is the common
                case, and the per-parça buttons below are the exception that
                has to be possible — not the other way round. */}
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              {unstarted.length > 1 && (
                <Button
                  size="sm"
                  className="w-full gap-1.5 sm:w-auto"
                  disabled={busy}
                  onClick={() => onActAll?.(unstarted)}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Hepsini Başlatın ({unstarted.length})
                </Button>
              )}
              {started.length > 1 && (
                <Button
                  size="sm"
                  variant="success"
                  className="w-full gap-1.5 sm:w-auto"
                  disabled={busy}
                  onClick={() => onActAll?.(started)}
                >
                  <Send className="h-4 w-4" />
                  Hepsini Teslim Edin ({started.length})
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2 p-3">
          {rows.map((row) => (
            <ParcaJobCard
              key={row.parca}
              row={row}
              busy={busy}
              onAct={onAct}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
