/**
 * Sipariş (order) transition helpers — currently just the matbaa_onay gate.
 *
 * Full parity with the main pipeline's ozalit_onay (see `transitions.js`):
 * a physical-proof receipt gate ("Teslim Alındı" / "Teslim Alınamadı") that
 * must clear before anyone can approve, then a multi-party approval ledger
 * (every active team leader AND every assigned designer) with a leader-first
 * ordering rule. `computeMatbaaOnayApproval` is a direct port of
 * `computeOzalitOnayApproval`; see that function's comments for the full
 * rationale of each rule.
 *
 * Unlike `transitions.js` (which returns a full `stage_history`-shaped entry
 * via `makeEntry`), these return a lightweight `{ step, note }` pair — the
 * order pipeline's audit trail (`order_history`) is a flat `step, notes`
 * table, not `stage_history`'s richer shape, and the route already builds
 * those inserts inline.
 */

import { badRequest } from './errors.js'

/**
 * Mark a delivered matbaa ozalit "Teslim Alındı" (received) — the gate
 * before the multi-party matbaa_onay approval. Allowed for the team leader
 * or an assigned designer, only at matbaa_onay. Idempotent: acknowledging
 * twice returns `history: null` so the route doesn't double-notify.
 */
export function computeMatbaaReceive(order, actor, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (order.status !== 'matbaa_onay') {
    badRequest('Teslim alma yalnızca matbaa onay aşamasında yapılabilir.')
  }
  const designerIds = ctx.designerIds ?? []
  const isLeader = actor?.role === 'team_leader'
  const isAssignedDesigner = actor?.role === 'designer' && designerIds.includes(actor?.id)
  if (!isLeader && !isAssignedDesigner) {
    badRequest('Teslim almayı yalnızca ekip lideri veya atanmış tasarımcı yapabilir.')
  }
  if (order.matbaa_received) {
    return { order: {}, history: null }
  }
  return {
    order: {
      matbaa_received: true,
      matbaa_received_by: actorName,
      matbaa_received_at: now,
    },
    history: { step: 'matbaa_received', note: 'Matbaa ozaliti teslim alındı' },
  }
}

/**
 * Counterpart to computeMatbaaReceive: the physical proof never reached the
 * leader/designer. Sends the order back to tasarimci_onay for re-delivery,
 * wipes the partial approval ledger (a new proof needs everyone's sign-off
 * again), and bumps the project's ozalit_attempt (mirrors a matbaa reject).
 * Only valid before matbaa_received is set.
 */
export function computeMatbaaNotReceived(order, actor, ctx = {}) {
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (order.status !== 'matbaa_onay') {
    badRequest('Bu işlem yalnızca matbaa onay aşamasında yapılabilir.')
  }
  const designerIds = ctx.designerIds ?? []
  const isLeader = actor?.role === 'team_leader'
  const isAssignedDesigner = actor?.role === 'designer' && designerIds.includes(actor?.id)
  if (!isLeader && !isAssignedDesigner) {
    badRequest('Bu işlemi yalnızca ekip lideri veya atanmış tasarımcı yapabilir.')
  }
  if (order.matbaa_received) {
    badRequest('Matbaa teslimi zaten teslim alındı olarak işaretlenmiş.')
  }
  return {
    order: {
      status: 'tasarimci_onay',
      matbaa_received: false,
      matbaa_received_by: null,
      matbaa_received_at: null,
      matbaa_approvals: [],
    },
    history: { step: 'matbaa_not_received', note: 'Matbaa teslimi alınamadı, matbaaya geri gönderildi' },
  }
}

/**
 * Multi-party matbaa_onay approval. Every active team leader AND every order
 * assignee (order.assignee_ids) must approve before the order advances to
 * onaylandi, and a team leader has to sign first — a designer only
 * counter-signs a proof a leader has already accepted. Direct port of
 * `computeOzalitOnayApproval` in transitions.js.
 *
 * Returns `{ order, advanced, history }`. `order` carries only the fields
 * that changed (either the appended ledger, or the cleared ledger on
 * advance) — the route persists it as a patch, same contract as the receive
 * functions above.
 */
export function computeMatbaaOnayApproval(order, actor, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  const teamLeaderIds = ctx.teamLeaderIds ?? []
  const designerIds = ctx.designerIds ?? []

  const isLeader = actor?.role === 'team_leader'
  const isAssignedDesigner = actor?.role === 'designer' && designerIds.includes(actor?.id)
  if (!isLeader && !isAssignedDesigner) {
    badRequest('Matbaa onayını yalnızca ekip lideri veya atanmış tasarımcı yapabilir.')
  }
  if (!order.matbaa_received) {
    badRequest('Önce matbaa teslimi "Teslim Alındı" olarak işaretlenmelidir.')
  }

  const approvals = Array.isArray(order.matbaa_approvals) ? order.matbaa_approvals : []

  // Leader-first: a designer only counter-signs a proof a team leader has
  // already accepted. Skipped when there is no active team leader at all —
  // none would be in the required set either, so enforcing it would strand
  // the order at matbaa_onay with nobody able to open the gate.
  const leaderApproved = approvals.some(
    (a) => a.role === 'team_leader' || teamLeaderIds.includes(a.id),
  )
  if (isAssignedDesigner && teamLeaderIds.length > 0 && !leaderApproved) {
    badRequest('Önce ekip lideri onaylamalıdır, tasarımcı onayı ondan sonra verilebilir.')
  }

  // Record this approver (idempotent — approving twice is a no-op).
  const already = approvals.some((a) => a.id === actor?.id)
  const nextApprovals = already
    ? approvals
    : [...approvals, { id: actor?.id, role: actor?.role, name: actorName, at: now }]

  const required = [...new Set([...teamLeaderIds, ...designerIds])]
  const approvedIds = new Set(nextApprovals.map((a) => a.id))
  const allApproved = required.length > 0 && required.every((id) => approvedIds.has(id))

  if (!allApproved) {
    const remaining = required.filter((id) => !approvedIds.has(id)).length
    // A distinct step name from 'matbaa_onay' on purpose: that step name is
    // reserved for the printer's original delivery entry, which
    // StepSignatureFooter (client) reads back with a last-match lookup to
    // print "Matbaa Yetkilisi" on the ozalit sheet. Reusing 'matbaa_onay'
    // here would let a later approval's signer overwrite the printer's name
    // on that line. Same reasoning keeps 'matbaa_approve' distinct from
    // 'siparis_baski_onay' below — the completing approval's step name must
    // not collide with a partial one either.
    return {
      order: { matbaa_approvals: nextApprovals },
      advanced: false,
      history: { step: 'matbaa_approve', note: `Matbaa onayı verildi, ${remaining} onay daha bekleniyor` },
    }
  }

  // Everyone approved → the print proof itself is settled, but production
  // doesn't start yet: the order lands on siparis_baski_onay first, where a
  // team leader gives the final print-spec form + approval before onaylandi.
  return {
    order: { matbaa_approvals: [] },
    advanced: true,
    history: { step: 'siparis_baski_onay', note: 'Matbaa onayı tamamlandı, baskı onayına gönderildi' },
  }
}
