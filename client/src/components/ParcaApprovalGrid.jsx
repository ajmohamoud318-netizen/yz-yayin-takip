import { useMemo } from 'react'
import { ThumbsUp, ThumbsDown, AlertTriangle, PackageCheck, PackageX, FileEdit } from 'lucide-react'

import { Button } from '@/components/ui/button'
import ParcaApprovalRow from '@/components/ParcaApprovalRow'
import {
  pendingParcalar, approvedParcalar, rejectedParcalar, bulkApproveAvailable,
  parcaAwaitsReceipt, parcaDecidable, unpreparedParcalar,
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
 *   roundAwaitsReceipt — the round is at its gate and nobody has confirmed the
 *                   proof arrived. Every row renders as awaiting receipt with no
 *                   decision on it, and the bulk pair becomes
 *                   "Tümünü Teslim Alın" / "Teslim Alınamadı". This is one
 *                   receipt for the whole round, not a per-parça one: the stage
 *                   only reaches its gate once the matbaa has delivered every
 *                   parça, so the proof arrives as a single package. (The
 *                   genuinely per-parça receipt is `onReceiveParca`, for the
 *                   *_teslim surface where parçalar trickle back one at a time.)
 *
 *   onPrepareSheet — Baskı Onayı only. Opens the baskı formu so a leader can
 *                   fill it in and mark it hazırlandı. One button, not one per
 *                   parça: the baskı formu is a single document, so preparing it
 *                   prepares every parça on it. The SECOND step, onay, is the
 *                   per-parça one — that is where the maker-checker lives, with
 *                   different leaders signing different parçalar.
 *
 *   onBulkReject — optional; if present, the grid adds a "Tümünü Reddedin"
 *                   button beside the bulk approve so the leader can bounce the
 *                   whole round in one click. This is the header's old Reddet,
 *                   relocated: it opens the same reason + designer/matbaa
 *                   dialog and takes the same whole-round action. Pass it only
 *                   when that action is actually permitted — the grid does not
 *                   re-derive the receipt / role / split-across-desks gates.
 *
 * `neverSentParcalar` are parçalar the PROJECT has (Ürün Bilgileri) that no round
 * has ever carried. They are not on the snapshot — that is what makes them
 * invisible everywhere else — so without them here the grid describes the round
 * and quietly implies it describes the project. It does not: a leader could sign
 * off every row in this grid and still be leaving a parça that never had a demo.
 * The server refuses to advance in that state (assertNoNeverSentParcalar), so
 * these rows are also the only explanation the leader gets for why the round will
 * not close. They carry no buttons; "Kalan Parçaları Gönderin" in the header is
 * what acts on them.
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
 *   neverSentParcalar?: string[],
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
  neverSentParcalar = [],
  roundAwaitsReceipt = false,
  onBulkReceive,
  onBulkNotReceived,
  onPrepareSheet,
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

  /* Parçalar of the project that no round has ever carried. They are absent
     from every ledger and from the snapshot, so they can only come in from
     outside — see the prop's note above. */
  const neverSent = useMemo(
    () => new Set((neverSentParcalar ?? []).filter(Boolean)),
    [neverSentParcalar],
  )

  /* Baskı Onayı's first step. `pendingParcalar` folds "nobody prepared it" and
     "nobody approved it" together — right for the gate, wrong for the panel,
     which has to say which of the two steps is owed. */
  const unprepared = useMemo(
    () => new Set(unpreparedParcalar(project, kind, snapshotParcalar)),
    [project, kind, snapshotParcalar],
  )

  /**
   * A parça's state as the leader experiences it, most decided first.
   *
   * The ledger wins: a signed-off or bounced parça reads the same whatever its
   * routing row says. Below that, routing answers the question the ledger
   * cannot — a parça with no approval row is "not approved yet" at the gate,
   * but on an unfinished round it is just as likely to be still in the press.
   */
  function statusOf(parca) {
    // First, because it is the one status no ledger can contradict: a parça no
    // round ever carried has nothing in any of them.
    if (neverSent.has(parca)) return 'never_sent'
    if (rejected.includes(parca)) return 'rejected'
    // Before the ledger checks below: an unprepared baskı parça has no approval
    // row either, and "not approved" is the wrong thing to tell the leader when
    // the step actually owed is the one before it.
    if (unprepared.has(parca)) return 'needs_prepare'
    // Nothing on this round is decidable until somebody confirms the proof
    // physically arrived — the same rule the receipt gate has always carried,
    // now visible per parça instead of implied by an empty screen. Below the
    // ledger checks: a parça already signed off on a previous round keeps
    // reading as signed off.
    if (roundAwaitsReceipt && pending.includes(parca)) return 'awaiting_receipt'
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
  //
  // A never-sent parça counts: it is outstanding, it is the leader's to act on,
  // and it is the reason the round will not close. Leaving it out of the count
  // is what made the omission invisible in the first place.
  const awaitingLeader = () => (parcaRows
    ? orderedParcalar.filter((p) => {
      const status = statusOf(p)
      return status === 'pending' || status === 'awaiting_receipt' || status === 'never_sent'
    })
    : [...pending, ...neverSent])

  // What the bulk button may actually sign off. At the gate that is everything
  // pending; on an unfinished round only what is in the leader's hands — the
  // server refuses the rest, so offering them would build a button that fails.
  const bulkTarget = routingAware
    ? pending.filter((p) => statusOf(p) === 'pending')
    // An unprepared baskı parça cannot be approved — the server filters it out
    // of the target set — so a bulk that counted it would promise more than it
    // signs. Same rule as never-sent: the button covers what it can, honestly.
    : pending.filter((p) => !unprepared.has(p))

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
  // Never-sent parçalar do NOT suppress this. Both bulk buttons act on the
  // round — the parçalar that were actually sent — and a parça nobody sent is
  // not part of it: it cannot be approved, cannot be rejected, and the count on
  // the button says exactly how many it covers. Signing off what arrived is real
  // work the server records; the round simply holds at the gate afterwards until
  // the missing parça is sent too, which the `Gönderilmedi` row explains.
  const showBulk = bulkApproveAvailable(project, kind, snapshotParcalar)
    && bulkTarget.length > 0
    && everyPendingDecidable
    // Not before the proof has been taken delivery of. The server refuses every
    // sign-off until then (computeApproval's receipt gate), and the bulk pair in
    // that state is the receipt itself, below.
    && !roundAwaitsReceipt

  // The whole-round bounce, moved here from the header so that every decision on
  // a multi-parça round is taken in one place. It is offered only when the
  // caller passes a handler, and ProjectDetail passes one only when
  // `availableActions` says the whole-round reject is permitted — receipt gate,
  // role, and the split-across-desks rule all included. `!routingAware` keeps it
  // off the unfinished-round surface, where bouncing the whole round would
  // discard parçalar that are still in the press.
  // …and not while the round is still owed its receipt: the leader cannot bounce
  // a proof they have not taken delivery of (the server's own reject gate), and
  // the pair on offer in that state is the receipt.
  const showBulkReject = !!onBulkReject && !routingAware && !roundAwaitsReceipt

  // The whole-round receipt, in the panel for the same reason the other two are:
  // it is the round's decision, and the round is what this panel describes.
  const showBulkReceipt = roundAwaitsReceipt && !routingAware && !!onBulkReceive

  /* Is this the whole round arriving, or one parça coming back?
   *
   * Both look identical from the project row — `settleParcaAtGate` clears the
   * project-level `demo_received` when the matbaa hands back a SINGLE parça
   * after a per-parça reject, exactly as a fresh whole-round delivery does. The
   * ledger is what tells them apart: a round nobody has signed anything on is a
   * fresh delivery; one with sign-offs on it is mid-decision, and what just
   * arrived is the one parça that went back.
   *
   * It changes both the label and what is offered. "Tümünü Teslim Alın" is a lie
   * about a single reprint, and "Teslim Alınamadı" is worse than a lie: it
   * bounces the WHOLE round and wipes those sign-offs (the server refuses it now
   * — see computeDemoNotReceived — so offering it would only produce an error). */
  const partialArrival = approved.length > 0 || rejected.length > 0
  const receiptLabel = partialArrival ? 'Teslim Alın' : 'Tümünü Teslim Alın'

  // Baskı Onayı's first step, and the reason it is one button rather than one
  // per row: the baskı formu is a single document, so a leader fills it once and
  // every parça on it becomes hazırlandı together. Only the onay that follows is
  // per parça.
  const showPrepare = !!onPrepareSheet && unprepared.size > 0 && !roundAwaitsReceipt

  const orderedParcalar = useMemo(() => {
    // Pending first (so the to-do list reads top-down), then approved, then
    // rejected. Stable order matters: the same parça keeps the same row
    // across reloads, so the leader's muscle memory survives a refresh.
    //
    // Never-sent last: they belong to the project rather than to this round, and
    // grouping them at the bottom keeps the round's own decisions reading as one
    // list instead of interleaving two different kinds of thing.
    const seen = new Set()
    const out = []
    for (const p of [...pending, ...approved, ...rejected, ...neverSent]) {
      if (seen.has(p)) continue
      seen.add(p)
      out.push(p)
    }
    return out
  }, [pending, approved, rejected, neverSent])

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

      {showBulkReceipt && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="w-full gap-1.5 sm:w-auto"
            disabled={busy}
            onClick={onBulkReceive}
            aria-label={receiptLabel}
          >
            <PackageCheck className="h-4 w-4" />
            {receiptLabel}
          </Button>
          {onBulkNotReceived && !partialArrival && (
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5 sm:w-auto"
              disabled={busy}
              onClick={onBulkNotReceived}
              aria-label="Teslim Alınamadı"
            >
              <PackageX className="h-4 w-4" />
              Teslim Alınamadı
            </Button>
          )}
        </div>
      )}

      {(showBulk || showBulkReject || showPrepare) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {showPrepare && (
            <Button
              size="sm"
              className="w-full gap-1.5 sm:w-auto"
              disabled={busy}
              onClick={onPrepareSheet}
              aria-label="Baskı Onayı Hazırlayın"
            >
              <FileEdit className="h-4 w-4" />
              Baskı Onayı Hazırlayın ({unprepared.size})
            </Button>
          )}
          {showBulk && (
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
          )}
          {showBulkReject && (
            <Button
              size="sm"
              variant="destructive"
              className="w-full gap-1.5 sm:w-auto"
              disabled={busy}
              onClick={onBulkReject}
              aria-label="Tümünü Reddedin"
            >
              <ThumbsDown className="h-4 w-4" />
              Tümünü Reddedin
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
