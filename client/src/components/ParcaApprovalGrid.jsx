import { useMemo } from 'react'
import { ThumbsUp, AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import ParcaApprovalRow from '@/components/ParcaApprovalRow'
import { pendingParcalar, approvedParcalar, rejectedParcalar, bulkApproveAvailable } from '@/domain'

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
 * @param {{
 *   project: object,
 *   kind: 'demo' | 'ozalit' | 'baski_onay' | 'cin_baski_onay',
 *   snapshotParcalar?: Array<string | { component?: string }>,
 *   busy?: boolean,
 *   onApproveParcalar: (parcalar: string[] | null) => void,
 *   onRejectParcalar?: (parcalar: string[] | null, reason?: string, target?: 'designer' | 'matbaa') => void,
 *   onBulkApprove?: () => void,
 *   onBulkReject?: () => void,
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

  const showBulk = bulkApproveAvailable(project, kind, snapshotParcalar)
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
          {pending.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
              <AlertTriangle className="h-3 w-3" />
              {pending.length} bekliyor
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
            disabled={busy || pending.length === 0}
            onClick={onBulkApprove ?? (() => onApproveParcalar?.(null))}
            aria-label={bulkApproveLabel}
          >
            <ThumbsUp className="h-4 w-4" />
            {bulkApproveLabel} ({pending.length})
          </Button>
          {onBulkReject && pending.length > 0 && (
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
          const isPending = pending.includes(parca)
          const isRejected = rejected.includes(parca)
          const status = isPending ? 'pending' : isRejected ? 'rejected' : 'approved'
          return (
            <ParcaApprovalRow
              key={parca}
              parca={parca}
              status={status}
              signers={signersByParca.get(parca) ?? []}
              busy={busy}
              onApprove={isPending ? () => onApproveParcalar?.([parca]) : undefined}
              onReject={
                isPending && onRejectParcalar
                  ? () => onRejectParcalar([parca])
                  : undefined
              }
            />
          )
        })}
      </div>
    </div>
  )
}
