import { useMemo } from 'react'
import { ThumbsUp, AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import ParcaApprovalRow from '@/components/ParcaApprovalRow'
import {
  pendingParcalar, approvedParcalar, rejectedParcalar, bulkApproveAvailable,
  parcaAwaitsReceipt, parcaDecidable,
} from '@/domain'

/**
 * Per-parça approval grid — the multi-parça surface for demo/ozalit/baski
 * approval. Renders one row per parça on the snapshot's
 * `_selectedComponents`, plus the "Tüm parçaları onaylayın" bulk shortcut
 * (disabled / hidden on single-parça sheets where the existing single button
 * is enough).
 *
 * `kind` ∈ {'demo' | 'ozalit' | 'baski_onay' | 'cin_baski_onay'} picks the
 * matching per-parça ledger for the status pills.
 *
 * `actions`:
 *   onApproveParcalar(parcalar)   — bulk or single parça approve. parcalar is
 *                                   `string[]`; null = "all still-pending".
 *   onRejectParcalar(parcalar, …) — optional; if omitted, the per-row reject
 *                                   button is hidden.
 *
 *   onBulkReject — optional; if present, the grid adds a "Hepsini Reddedin"
 *                   button at the top so the leader can bounce the whole
 *                   round in one click. Calls onRejectParcalar(null, …).
 *
 * `parcaRows` turns the grid into the surface for a round that is STILL OUT at
 * the matbaa (migration 076). Pass the project's routing rows and each parça is
 * rendered by where it actually is — waiting to be received, ready to decide, or
 * on somebody else's desk — instead of by the ledger alone, which cannot tell
 * "not approved yet" from "not here yet". Omit it at the *_onay gates, where the
 * whole round has arrived and one project-level receipt covers it; passing rows
 * there would offer "Teslim Alın" on parçalar that were already received that
 * way.
 *
 * @param {{
 *   project: object,
 *   kind: 'demo' | 'ozalit' | 'baski_onay' | 'cin_baski_onay',
 *   snapshotParcalar?: Array<string | { component?: string }>,
 *   busy?: boolean,
 *   onApproveParcalar: (parcalar: string[] | null) => void,
 *   onRejectParcalar?: (parcalar: string[] | null, reason?: string, target?: 'designer' | 'matbaa') => void,
 *   onBulkApprove?: () => void,
 *   onBulkReject?: () => void,
 *   parcaRows?: Array<{ parca: string, state: string, owner_role: string|null,
 *                       delivered_at?: string|null, received_at?: string|null }>,
 *   onReceiveParca?: (parca: string) => void,
 *   bulkApproveLabel?: string,
 *   showHeader?: boolean,
 *   className?: string,
 * }} props
 */
export default function ParcaApprovalGrid({
  project,
  kind,
  snapshotParcalar = [],
  busy = false,
  onApproveParcalar,
  onRejectParcalar,
  onBulkApprove,
  onBulkReject,
  parcaRows = null,
  onReceiveParca,
  bulkApproveLabel = 'Tüm parçaları onaylayın',
  showHeader = true,
  className,
}) {
  const pending = useMemo(
    () => pendingParcalar(project, kind, snapshotParcalar),
    [project, kind, snapshotParcalar],
  )
  const approved = useMemo(() => approvedParcalar(project, kind), [project, kind])
  const rejected = useMemo(() => rejectedParcalar(project, kind), [project, kind])

  /* Where each parça physically is, when the caller knows (migration 076).
     Empty map = the *_onay behaviour this grid has always had: the ledger is
     the only thing that decides a row. */
  const rowByParca = useMemo(() => {
    const map = new Map()
    for (const row of (parcaRows ?? [])) if (row?.parca) map.set(row.parca, row)
    return map
  }, [parcaRows])
  const routingAware = !!parcaRows

  /**
   * A parça's state as the leader experiences it, most decided first.
   *
   * The ledger wins: a signed-off or bounced parça reads the same whatever its
   * routing row says. Below that, routing answers the question the ledger
   * cannot — a parça with no approval row is "not approved yet" at the gate,
   * but on an unfinished round it is just as likely to be still in the press.
   */
  function statusOf(parca) {
    if (rejected.includes(parca)) return 'rejected'
    if (!pending.includes(parca)) return 'approved'
    if (!routingAware) return 'pending'
    const row = rowByParca.get(parca)
    if (parcaDecidable(row)) return 'pending'
    if (parcaAwaitsReceipt(row)) return 'awaiting_receipt'
    // No row at all means the matbaa has not handed it back even once.
    return 'out'
  }
  function outLabelOf(parca) {
    const row = rowByParca.get(parca)
    if (row?.state === 'with_designer') return 'Tasarımcıda'
    if (row?.route === 'ekran') return 'Ekran turunda'
    return 'Matbaada'
  }

  // What the leader still has to DO here. At the gate that is every un-signed
  // parça; on an unfinished round it is only what is in their hands — a header
  // reading "3 bekliyor" above two rows marked "Matbaada" describes the round,
  // not the reader's to-do list, and the two are no longer the same thing.
  const awaitingLeader = () => (parcaRows
    ? orderedParcalar.filter((p) => {
      const status = statusOf(p)
      return status === 'pending' || status === 'awaiting_receipt'
    })
    : pending)

  // What the bulk button may actually sign off. At the gate that is everything
  // pending; on an unfinished round only what is in the leader's hands — the
  // server refuses the rest, so offering them would build a button that fails.
  const bulkTarget = routingAware
    ? pending.filter((p) => statusOf(p) === 'pending')
    : pending

  // …and the button only appears when that set is ALL of them.
  //
  // It says "Tüm parçaları onaylayın", and on a round the matbaa is still
  // producing it did not mean it: a two-parça sheet with one still on the
  // press rendered "Tüm parçaları onaylayın (1)" — a button promising the
  // whole round while signing off half of it, with the count as the only hint.
  // The leader's real move there is the single row's own thumbs-up.
  //
  // Parçalar the leader has already sent back are not counted: `pending` drops
  // them (see pendingParcalar), because a rejected parça is not a decision
  // still owed — it is one already taken, and waiting for it would make the
  // shortcut unreachable for the rest of the round.
  const everyPendingDecidable = !routingAware || bulkTarget.length === pending.length
  const showBulk = bulkApproveAvailable(project, kind, snapshotParcalar)
    && bulkTarget.length > 0
    && everyPendingDecidable
  const orderedParcalar = useMemo(() => {
    // Pending first (so the to-do list reads top-down), then approved, then
    // rejected. Stable order matters: the same parça keeps the same row
    // across reloads, so the leader's muscle memory survives a refresh.
    const seen = new Set()
    const out = []
    for (const p of [...pending, ...approved, ...rejected]) {
      if (seen.has(p)) continue
      seen.add(p)
      out.push(p)
    }
    return out
  }, [pending, approved, rejected])

  // Normalise the per-parça approval rows into a `{ name }[]` shape that
  // ParcaApprovalRow can render without knowing the ledger shape.
  const signersByParca = useMemo(() => {
    const map = new Map()
    if (kind === 'demo') {
      for (const row of (project?.demo_parca_approvals ?? [])) {
        if (!row?.parca) continue
        const list = map.get(row.parca) ?? []
        list.push({ name: row.by_name ?? row.by ?? '—', at: row.at })
        map.set(row.parca, list)
      }
    } else if (kind === 'ozalit') {
      for (const [parca, rows] of Object.entries(project?.ozalit_parca_approvals ?? {})) {
        if (!Array.isArray(rows)) continue
        map.set(parca, rows.map((r) => ({ name: r?.name ?? r?.id ?? '—', at: r?.at })))
      }
    }
    return map
  }, [project, kind])

  if (orderedParcalar.length === 0) return null

  return (
    <div className={className}>
      {showHeader && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Parça onayı · {orderedParcalar.length} parça
          </p>
          {awaitingLeader().length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
              <AlertTriangle className="h-3 w-3" />
              {awaitingLeader().length} bekliyor
            </span>
          )}
        </div>
      )}

      {showBulk && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="success"
            className="w-full gap-1.5 sm:w-auto"
            disabled={busy || bulkTarget.length === 0}
            // On an unfinished round the click has to NAME the parçalar: a null
            // means "everything still pending" to the server, which includes the
            // parçalar still in the press.
            onClick={onBulkApprove ?? (() => onApproveParcalar?.(routingAware ? bulkTarget : null))}
            aria-label={bulkApproveLabel}
          >
            <ThumbsUp className="h-4 w-4" />
            {bulkApproveLabel} ({bulkTarget.length})
          </Button>
          {onBulkReject && !routingAware && pending.length > 0 && (
            <Button
              size="sm"
              variant="destructive"
              className="w-full gap-1.5 sm:w-auto"
              disabled={busy}
              onClick={onBulkReject}
            >
              Hepsini Reddedin
            </Button>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        {orderedParcalar.map((parca) => {
          const status = statusOf(parca)
          const decidable = status === 'pending'
          return (
            <ParcaApprovalRow
              key={parca}
              parca={parca}
              status={status}
              outLabel={outLabelOf(parca)}
              signers={signersByParca.get(parca) ?? []}
              busy={busy}
              onApprove={decidable ? () => onApproveParcalar?.([parca]) : undefined}
              onReject={
                decidable && onRejectParcalar
                  ? () => onRejectParcalar([parca])
                  : undefined
              }
              onReceive={
                status === 'awaiting_receipt' && onReceiveParca
                  ? () => onReceiveParca(parca)
                  : undefined
              }
            />
          )
        })}
      </div>
    </div>
  )
}
