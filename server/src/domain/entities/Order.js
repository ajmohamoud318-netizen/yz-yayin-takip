/**
 * Order aggregate root.
 *
 * Owns every state-changing rule for an `order_requests` row. Each method:
 *   1. validates preconditions (state, actor role, ownership),
 *   2. mutates the entity in place,
 *   3. returns a structured domain event (or `null` for idempotent no-op).
 *
 * The entity never touches SQL, never fires notifications, never writes
 * cross-aggregate history (project timeline, order_subtasks.needs_revize).
 * The application service (`services/orders-service.js`) is responsible
 * for translating events into persistence + side effects.
 *
 * Field naming follows the DB schema (snake_case) so the entity can be
 * constructed directly from a row and persisted back without translation.
 */

import { ORDER_STEP_NEXT, ORDER_STEP_OWNER, ORDER_REJECT_TARGETS } from '../orders.js'
import { badRequest, conflict, forbidden } from '../errors.js'

/**
 * Multi-party matbaa_onay approval. Every active team leader AND every
 * assigned designer must sign before the order advances to the next
 * print-approval gate (siparis_baski_onay). Leader-first: a designer can
 * only counter-sign a proof a leader has already accepted. Same shape as
 * the main pipeline's `computeOzalitOnayApproval` (transitions.js).
 *
 * Returns `{ order: { matbaa_approvals }, advanced, history: { step, note } }`.
 */
function computeMatbaaOnayApproval(order, actor, ctx) {
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
  const leaderApproved = approvals.some(
    (a) => a.role === 'team_leader' || teamLeaderIds.includes(a.id),
  )
  if (isAssignedDesigner && teamLeaderIds.length > 0 && !leaderApproved) {
    badRequest('Önce ekip lideri onaylamalıdır, tasarımcı onayı ondan sonra verilebilir.')
  }

  const already = approvals.some((a) => a.id === actor?.id)
  const nextApprovals = already
    ? approvals
    : [...approvals, { id: actor?.id, role: actor?.role, name: actorName, at: now }]

  const required = [...new Set([...teamLeaderIds, ...designerIds])]
  const approvedIds = new Set(nextApprovals.map((a) => a.id))
  const allApproved = required.length > 0 && required.every((id) => approvedIds.has(id))

  if (!allApproved) {
    const remaining = required.filter((id) => !approvedIds.has(id)).length
    return {
      order: { matbaa_approvals: nextApprovals },
      advanced: false,
      history: { step: 'matbaa_approve', note: `Matbaa onayı verildi, ${remaining} onay daha bekleniyor` },
    }
  }

  return {
    order: { matbaa_approvals: [] },
    advanced: true,
    history: { step: 'siparis_baski_onay', note: 'Matbaa onayı tamamlandı, baskı onayına gönderildi' },
  }
}

export class Order {
  constructor(record) {
    Object.assign(this, record)
    this._events = []
  }

  _record(event) {
    this._events.push(event)
    return event
  }

  /** Pull all recorded events; the entity's internal buffer is cleared. */
  pullEvents() {
    const out = this._events
    this._events = []
    return out
  }

  /**
   * Project-timeline note for an order advance, mirroring the long
   * `next === 'goruldu' ? ... : next === 'kontrol_edildi' ? ...` ladder
   * that used to live inline in routes/orders.js. Kept here because
   * it's a property of the FSM, not of the persistence layer.
   */
  _advanceProjectNote(next) {
    switch (next) {
      case 'goruldu': return 'Baskı tasarımcıya aktarıldı'
      case 'kontrol_edildi': return 'Tasarımcı kontrolleri yapıldı'
      case 'tasarimci_onay': return 'Ozalit istendi, matbaaya gönderildi'
      case 'ekran_onay': return 'Baskı ekran onayına gönderildi'
      case 'matbaa_onay': return 'Matbaa teslimi yapıldı'
      case 'siparis_baski_onay': return 'Baskı onay formuna gönderildi'
      default: return `Baskı adımı: ${next}`
    }
  }

  /**
   * Advance through the workflow FSM. Handles every branch:
   *   - siparis_baski_onay refusal (must use the dedicated approve route)
   *   - kontrol_edildi resubmit route choice ('tasarimci_onay' | 'ekran_onay')
   *   - matbaa_onay multi-party approval (leader-first, gated on receipt)
   *   - tasarimci_onay gates (ozalit_started, no pending change request)
   *   - ORDER_STEP_OWNER role check for flat steps
   *   - pending step assignees validation (presence only — service
   *     validates ids / roles / is_active against the DB)
   *
   * Returns a domain event the service persists; throws on precondition
   * violation.
   *
   * @param {object} actor — request.user (id, name, role)
   * @param {object} ctx
   * @param {string} [ctx.notes]
   * @param {string[]} [ctx.assignees] — required when status === 'pending'
   * @param {number} [ctx.expectedVersion]
   * @param {string} [ctx.route] — 'tasarimci_onay' | 'ekran_onay' on resubmit
   * @param {string[]} [ctx.teamLeaderIds] — active leader ids for matbaa_onay
   * @param {string[]} [ctx.designerIds] — order assignee ids
   */
  advance(actor, ctx = {}) {
    // Each gate below is ordered so the caller sees the same message, in the
    // same precedence, that the HTTP route enforced before this logic moved
    // into the aggregate.
    this._assertExpectedVersion(ctx.expectedVersion)
    const { next, clearResubmitFlag } = this._resolveAdvanceTarget(ctx.route)
    const matbaaInfo = this._authorizeAdvance(actor, ctx)
    this._assertAssigneesPresent(ctx.assignees)

    // Whether THIS click completes the round. Always true for a flat step;
    // for matbaa_onay only once every required approver has signed.
    const advancing = matbaaInfo ? matbaaInfo.advanced : true
    const wasPending = this.status === 'pending'

    this._applyAdvance({
      next, advancing, wasPending, clearResubmitFlag, matbaaInfo, assignees: ctx.assignees,
    })
    return this._record(this._composeAdvanceEvent({ next, advancing, wasPending, matbaaInfo, ctx }))
  }

  /** Optimistic concurrency: refuse a click made against a stale read.
   *  The message matches the SQL-level guard in `services/order-repository.js`
   *  so a 409 from either side surfaces the same Turkish phrase to the user.
   */
  _assertExpectedVersion(expectedVersion) {
    if (expectedVersion != null && this.version !== expectedVersion) {
      conflict('Bu kayıt başka biri tarafından güncellendi. Sayfayı yenileyin.')
    }
  }

  /**
   * Where this advance lands, and whether it consumes the resubmit flag.
   *
   * siparis_baski_onay is refused outright — it has its own
   * form-fill-then-approve command. From kontrol_edildi the destination is a
   * fixed 'tasarimci_onay' on a first submission; only on a RESUBMIT (a prior
   * reject-to-designer set last_reject_type) may the designer choose between
   * another physical ozalit and a digital Ekran Onayı.
   */
  _resolveAdvanceTarget(route) {
    if (this.status === 'siparis_baski_onay') {
      badRequest('Bu adımda ilerlemek için baskı onay formunu doldurup onaylamalısınız.')
    }
    let next = ORDER_STEP_NEXT[this.status]
    if (!next) badRequest('Bu talep zaten tamamlandı.')

    if (this.status !== 'kontrol_edildi') {
      if (route != null) badRequest('Onay seçimi yalnızca ozalit isteme adımında yapılabilir.')
      return { next, clearResubmitFlag: false }
    }

    const isResubmit = this.last_reject_type === 'designer'
    if (route != null && !isResubmit) badRequest('İlk gönderimde onay seçimi yapılamaz.')
    if (isResubmit) {
      if (!route) {
        badRequest('Revize sonrası Ozalit mi yoksa Ekran Onayı mı isteneceğini seçmelisiniz.')
      }
      next = route
    }
    // Cleared whenever the order leaves kontrol_edildi at all, resubmit or
    // not: the flag only ever needs to survive for the one click it gates.
    return { next, clearResubmitFlag: true }
  }

  /**
   * Role and state gates for this step.
   *
   * matbaa_onay is multi-party (every active team leader AND every assigned
   * designer, leader-first) and returns its approval tally; every other step
   * is a flat single-owner advance and returns null.
   */
  _authorizeAdvance(actor, ctx) {
    if (this.status === 'matbaa_onay') {
      return computeMatbaaOnayApproval(this, actor, {
        teamLeaderIds: ctx.teamLeaderIds ?? [],
        designerIds: ctx.designerIds ?? [],
      })
    }
    const owner = ORDER_STEP_OWNER[this.status]
    if (owner && actor.role !== owner) {
      forbidden('Bu adımı yalnızca ilgili rol imzalayabilir.')
    }
    // tasarimci_onay is the printer's ozalit round: it must have been
    // started, with no change request left hanging, before it can be
    // delivered.
    if (this.status === 'tasarimci_onay') {
      if (this.ozalit_change_requested_at != null) {
        badRequest('Bekleyen bir değişiklik talebi var, önce kabul veya reddedin.')
      }
      if (!this.ozalit_started) {
        badRequest('Teslim etmeden önce İşlemi Başlatın işaretlemelisiniz.')
      }
    }
    return null
  }

  /**
   * The pending handoff must name its designers. Presence only — validating
   * the ids against the user table needs the DB, so the service does it.
   */
  _assertAssigneesPresent(assignees) {
    if (this.status !== 'pending') return
    if (!Array.isArray(assignees) || assignees.length === 0) {
      badRequest('Tasarımcı seçmeden talebi aktaramazsın.')
    }
  }

  /** Apply the advance to this aggregate. */
  _applyAdvance({ next, advancing, wasPending, clearResubmitFlag, matbaaInfo, assignees }) {
    this.version = (this.version ?? 0) + 1
    if (wasPending) this.assignee_ids = assignees
    if (advancing) this.status = next
    if (clearResubmitFlag) this.last_reject_type = null
    if (matbaaInfo) this.matbaa_approvals = matbaaInfo.order.matbaa_approvals
  }

  /**
   * Build the domain event. Runs after the mutations above, so the
   * notification's assignee fallback reads the freshly-set roster.
   *
   * A matbaa_onay click that does NOT complete the round gets its own
   * partial-approval timeline entry and pings only whoever still owes an
   * approval; the round-completing click falls through to the generic
   * advance entry instead.
   */
  _composeAdvanceEvent({ next, advancing, wasPending, matbaaInfo, ctx }) {
    const projectHistories = []
    if (wasPending && advancing) {
      projectHistories.push({
        event: 'order_transfer', action: 'system',
        note: 'Baskı aktarımı: tasarımcı atandı',
      })
    }
    if (matbaaInfo && !advancing) {
      projectHistories.push({
        event: 'order_matbaa_approve', action: 'approve',
        note: matbaaInfo.history.note,
      })
    } else if (advancing) {
      projectHistories.push({
        event: 'order_advance', action: 'system',
        note: this._advanceProjectNote(next),
      })
    }

    return {
      type: 'order.advanced',
      orderHistory: {
        step: matbaaInfo ? matbaaInfo.history.step : next,
        note: matbaaInfo
          ? (ctx.notes ? `${ctx.notes} · ${matbaaInfo.history.note}` : matbaaInfo.history.note)
          : (ctx.notes ?? ''),
      },
      projectHistories,
      notification: matbaaInfo && !advancing
        ? {
            kind: 'matbaaApprovalPending',
            teamLeaderIds: ctx.teamLeaderIds ?? [],
            designerIds: ctx.designerIds ?? [],
          }
        : {
            kind: 'transition',
            destination: next,
            assigneeIds: ctx.assignees ?? (Array.isArray(this.assignee_ids) ? this.assignee_ids : []),
          },
    }
  }

  /**
   * Mark a delivered matbaa ozalit "Teslim Alındı" — the gate before the
   * multi-party matbaa_onay approval. Idempotent: acknowledging twice
   * returns `null` so the service short-circuits the write + notify.
   *
   * @param {object} actor
   * @param {object} ctx
   * @param {string[]} ctx.designerIds — order.assignee_ids
   */
  receiveMatbaaOzalit(actor, ctx = {}) {
    const designerIds = ctx.designerIds ?? []
    const isLeader = actor?.role === 'team_leader'
    const isAssignedDesigner = actor?.role === 'designer' && designerIds.includes(actor?.id)
    if (!isLeader && !isAssignedDesigner) {
      badRequest('Teslim almayı yalnızca ekip lideri veya atanmış tasarımcı yapabilir.')
    }
    if (this.status !== 'matbaa_onay') {
      badRequest('Teslim alma yalnızca matbaa onay aşamasında yapılabilir.')
    }
    if (this.matbaa_received) return null // idempotent

    const now = new Date().toISOString()
    this.matbaa_received = true
    this.matbaa_received_by = actor?.name ?? 'Bilinmeyen'
    this.matbaa_received_at = now
    this.version = (this.version ?? 0) + 1

    return this._record({
      type: 'order.matbaa_received',
      orderHistory: { step: 'matbaa_received', note: 'Matbaa ozaliti teslim alındı' },
      projectHistories: [{
        event: 'order_matbaa_received', action: 'system',
        note: 'Matbaa ozaliti teslim alındı',
      }],
      notification: { kind: 'matbaaReceived', assigneeIds: designerIds },
    })
  }

  /**
   * Counterpart to receiveMatbaaOzalit: the physical proof never arrived.
   * Sends the order back to tasarimci_onay for re-delivery, wipes the
   * partial approval ledger and any change-request state, and bumps
   * ozalit_attempt (new sipariş ozalit round — migration 053).
   * ozalit_started is kept: the work was done, the delivery wasn't.
   */
  markMatbaaNotReceived(actor, ctx = {}) {
    const designerIds = ctx.designerIds ?? []
    const isLeader = actor?.role === 'team_leader'
    const isAssignedDesigner = actor?.role === 'designer' && designerIds.includes(actor?.id)
    if (!isLeader && !isAssignedDesigner) {
      badRequest('Bu işlemi yalnızca ekip lideri veya atanmış tasarımcı yapabilir.')
    }
    if (this.status !== 'matbaa_onay') {
      badRequest('Bu işlem yalnızca matbaa onay aşamasında yapılabilir.')
    }
    if (this.matbaa_received) {
      badRequest('Matbaa teslimi zaten teslim alındı olarak işaretlenmiş.')
    }

    const now = new Date().toISOString()
    this.status = 'tasarimci_onay'
    this.matbaa_received = false
    this.matbaa_received_by = null
    this.matbaa_received_at = null
    this.matbaa_approvals = []
    // ozalit_started deliberately survives — see computeDemoNotReceived in
    // transitions.js. The matbaa already did the physical work; only the
    // handover failed, so TalepSignDialog keeps showing "Teslim Edin" rather
    // than sending the printer back through "İşlemi Başlatın", and the leader
    // keeps the change-request path instead of a free cancel/edit.
    this.ozalit_change_requested_at = null
    this.ozalit_change_requested_by = null
    this.ozalit_change_requested_by_name = null
    this.ozalit_change_requested_note = null
    this.ozalit_fix_pending = false
    this.ozalit_attempt = (this.ozalit_attempt ?? 0) + 1
    this.version = (this.version ?? 0) + 1
    this.updated_at = now

    return this._record({
      type: 'order.matbaa_not_received',
      orderHistory: { step: 'matbaa_not_received', note: 'Matbaa teslimi alınamadı, matbaaya geri gönderildi' },
      projectHistories: [{
        event: 'order_matbaa_not_received', action: 'system',
        note: 'Matbaa teslimi alınamadı, matbaaya geri gönderildi',
      }],
      notification: { kind: 'transition', destination: 'tasarimci_onay' },
    })
  }

  /**
   * Matbaa marks physical work begun. Idempotent (already-started returns
   * null so the service doesn't write or notify twice).
   */
  startOzalit(actor) {
    if (actor?.role !== 'printer') {
      badRequest('Bu işlemi yalnızca matbaa yapabilir.')
    }
    if (this.status !== 'tasarimci_onay') {
      badRequest('Bu işlem yalnızca ozalit matbaa aşamasında yapılabilir.')
    }
    if (this.ozalit_started) return null
    if (this.ozalit_fix_pending) {
      badRequest('Kabul edilen değişiklik talebi için düzeltme bekleniyor, önce ürün bilgileri güncellenmelidir.')
    }

    const now = new Date().toISOString()
    this.ozalit_started = true
    this.ozalit_started_at = now
    this.ozalit_started_by = actor?.id ?? null
    this.ozalit_started_by_name = actor?.name ?? 'Bilinmeyen'
    this.version = (this.version ?? 0) + 1

    return this._record({
      type: 'order.ozalit_started',
      orderHistory: { step: 'ozalit_started', note: 'Matbaa ozalit çalışmasına başladı' },
      projectHistories: [{
        event: 'order_ozalit_started', action: 'system',
        note: 'Matbaa ozalit çalışmasına başladı',
      }],
      notification: { kind: 'ozalitStarted' },
    })
  }

  /**
   * Team leader cancels a pending (not-yet-started) ozalit outright —
   * back to goruldu, no attempt bump (nothing was delivered).
   */
  cancelOzalit(actor) {
    if (this.status !== 'tasarimci_onay') {
      badRequest('İptal yalnızca ozalit matbaa sürecindeyken yapılabilir.')
    }
    if (actor?.role !== 'team_leader') {
      badRequest('Bu işlemi yalnızca ekip lideri yapabilir.')
    }
    if (this.ozalit_started) {
      badRequest('Matbaa ozalit çalışmasına başladı, doğrudan iptal edilemez, değişiklik isteyin.')
    }

    this.status = 'goruldu'
    this.ozalit_started = false
    this.ozalit_started_at = null
    this.ozalit_started_by = null
    this.ozalit_started_by_name = null
    this.ozalit_change_requested_at = null
    this.ozalit_change_requested_by = null
    this.ozalit_change_requested_by_name = null
    this.ozalit_change_requested_note = null
    this.ozalit_fix_pending = false
    this.version = (this.version ?? 0) + 1

    return this._record({
      type: 'order.ozalit_cancelled',
      orderHistory: { step: 'ozalit_cancelled', note: 'Ozalit talebi iptal edildi, tasarımcıya geri döndü' },
      projectHistories: [{
        event: 'order_ozalit_cancelled', action: 'system',
        note: 'Ozalit talebi iptal edildi, tasarımcıya geri döndü',
      }],
      notification: { kind: 'ozalitCancelled' },
    })
  }

  /**
   * Team leader corrects the sipariş's ozalit sheet while it's still
   * sitting with the matbaa, pre-start. Clears the "fix owed" flag an
   * accepted change request may have set — this submission IS the fix.
   *
   * @param {object} actor
   * @param {object} ctx
   * @param {string|null} ctx.demoId — service fills this from the
   *   demos snapshot row it inserts in the same tx; null when no payload
   */
  editOzalit(actor, ctx = {}) {
    if (this.status !== 'tasarimci_onay') {
      badRequest('Bildirim yalnızca ozalit matbaa sürecindeyken yapılabilir.')
    }
    if (actor?.role !== 'team_leader') {
      badRequest('Bu işlemi yalnızca ekip lideri yapabilir.')
    }
    if (this.ozalit_started) {
      badRequest('Matbaa ozalit çalışmasına başladı, değişiklik isteyin.')
    }

    this.ozalit_fix_pending = false
    this.version = (this.version ?? 0) + 1

    const demoId = ctx.demoId ?? null
    return this._record({
      type: 'order.ozalit_edited',
      orderHistory: { step: 'ozalit_edited', note: 'Ozalit ürün bilgileri güncellendi', demoId },
      projectHistories: [{
        event: 'order_ozalit_edited', action: 'system',
        note: 'Ozalit ürün bilgileri güncellendi', demoId,
      }],
      notification: { kind: 'ozalitEdited' },
    })
  }

  /**
   * Team leader asks for a change AFTER the matbaa has started physical
   * work. Refused on a not-yet-started round (use cancel/edit instead) and
   * when a change request is already pending.
   */
  requestOzalitChange(actor, { note } = {}) {
    if (this.status !== 'tasarimci_onay') {
      badRequest('Bu işlem yalnızca ozalit matbaa aşamasında yapılabilir.')
    }
    if (actor?.role !== 'team_leader') {
      badRequest('Bu işlemi yalnızca ekip lideri yapabilir.')
    }
    if (!this.ozalit_started) {
      badRequest('Matbaa henüz başlamadı, doğrudan iptal veya düzenleme yapabilirsiniz.')
    }
    if (this.ozalit_change_requested_at != null) {
      badRequest('Zaten bekleyen bir değişiklik talebi var.')
    }

    const now = new Date().toISOString()
    const trimmed = note?.trim() || null
    this.ozalit_change_requested_at = now
    this.ozalit_change_requested_by = actor?.id ?? null
    this.ozalit_change_requested_by_name = actor?.name ?? 'Bilinmeyen'
    this.ozalit_change_requested_note = trimmed
    this.version = (this.version ?? 0) + 1

    return this._record({
      type: 'order.ozalit_change_requested',
      orderHistory: { step: 'ozalit_change_requested', note: trimmed || 'Değişiklik istendi' },
      projectHistories: [{
        event: 'order_ozalit_change_requested', action: 'system',
        note: trimmed || 'Değişiklik istendi',
      }],
      notification: { kind: 'ozalitChangeRequested', note: trimmed },
    })
  }

  /**
   * Matbaa accepts the pending change request: un-starts the round
   * (reopens free cancel/edit) and marks a fix owed before the matbaa
   * can re-lock it.
   */
  acceptOzalitChange(actor) {
    if (actor?.role !== 'printer') {
      badRequest('Bu işlemi yalnızca matbaa yapabilir.')
    }
    if (this.ozalit_change_requested_at == null) {
      badRequest('Bekleyen bir değişiklik talebi yok.')
    }

    this.ozalit_started = false
    this.ozalit_started_at = null
    this.ozalit_started_by = null
    this.ozalit_started_by_name = null
    this.ozalit_change_requested_at = null
    this.ozalit_change_requested_by = null
    this.ozalit_change_requested_by_name = null
    this.ozalit_change_requested_note = null
    this.ozalit_fix_pending = true
    this.version = (this.version ?? 0) + 1

    return this._record({
      type: 'order.ozalit_change_accepted',
      orderHistory: { step: 'ozalit_change_accepted', note: 'Matbaa değişiklik talebini kabul etti' },
      projectHistories: [{
        event: 'order_ozalit_change_accepted', action: 'system',
        note: 'Matbaa değişiklik talebini kabul etti',
      }],
      notification: { kind: 'ozalitChangeAccepted' },
    })
  }

  /**
   * Matbaa declines the pending change request: round stays started,
   * nothing else changes.
   */
  declineOzalitChange(actor) {
    if (actor?.role !== 'printer') {
      badRequest('Bu işlemi yalnızca matbaa yapabilir.')
    }
    if (this.ozalit_change_requested_at == null) {
      badRequest('Bekleyen bir değişiklik talebi yok.')
    }

    this.ozalit_change_requested_at = null
    this.ozalit_change_requested_by = null
    this.ozalit_change_requested_by_name = null
    this.ozalit_change_requested_note = null
    this.version = (this.version ?? 0) + 1

    return this._record({
      type: 'order.ozalit_change_declined',
      orderHistory: { step: 'ozalit_change_declined', note: 'Matbaa değişiklik talebini reddetti' },
      projectHistories: [{
        event: 'order_ozalit_change_declined', action: 'system',
        note: 'Matbaa değişiklik talebini reddetti',
      }],
      notification: { kind: 'ozalitChangeDeclined' },
    })
  }

  /**
   * Team leader rejects the talep. Sends the order back to a chosen
   * target (matbaa | designer | reassign). Wipes the receipt gate and
   * partial approval ledger unconditionally — a re-delivered proof
   * needs fresh sign-off. Resets ozalit round state and bumps
   * ozalit_attempt because the rejected proof is spent.
   *
   * @param {object} actor
   * @param {object} input
   * @param {string} input.reason
   * @param {string} input.rejectTarget — 'matbaa' | 'designer' | 'reassign'
   * @param {string[]} [input.revizeIds] — subtask ids to flag (designer only)
   */
  reject(actor, { reason, rejectTarget, revizeIds = [] }) {
    if (actor?.role !== 'team_leader') {
      forbidden('Yalnızca takım lideri reddedebilir.')
    }
    const targets = ORDER_REJECT_TARGETS[this.status]
    if (!targets) badRequest('Bu aşamada red işlemi yapılamaz.')
    const targetStatus = targets[rejectTarget]
    if (!targetStatus) badRequest('Geçersiz red hedefi.')

    const now = new Date().toISOString()
    this.status = targetStatus
    this.matbaa_received = false
    this.matbaa_received_by = null
    this.matbaa_received_at = null
    this.matbaa_approvals = []
    if (rejectTarget === 'designer') {
      this.last_reject_type = 'designer'
    }
    this.ozalit_started = false
    this.ozalit_started_at = null
    this.ozalit_started_by = null
    this.ozalit_started_by_name = null
    this.ozalit_change_requested_at = null
    this.ozalit_change_requested_by = null
    this.ozalit_change_requested_by_name = null
    this.ozalit_change_requested_note = null
    this.ozalit_fix_pending = false
    this.ozalit_attempt = (this.ozalit_attempt ?? 0) + 1
    this.version = (this.version ?? 0) + 1
    this.updated_at = now

    return this._record({
      type: 'order.rejected',
      orderHistory: { step: `reject→${rejectTarget}`, note: reason ?? '' },
      projectHistories: [{
        event: 'order_reject', action: 'reject',
        note: revizeIds.length > 0
          ? `Baskı reddedildi (${rejectTarget}), revize: ${revizeIds.join(', ')}`
          : `Baskı reddedildi (${rejectTarget})`,
        reason,
        rejectTarget,
      }],
      notification: {
        kind: 'rejected',
        reason,
        revizeIds,
        destination: targetStatus,
      },
    })
  }

  /**
   * Shared gate for the two commands that EDIT the siparis_baski_onay sheet
   * (save draft, prepare): only a team leader, only at that step. Pulled out
   * because the maker half (migration 060) would otherwise have copied it.
   *
   * `approveBaskiOnayForm` deliberately keeps its own copy: signing is a
   * different act from editing, and its Turkish says so ("onayını
   * verebilir" / "bu işlem" rather than "formunu düzenleyebilir").
   */
  _assertBaskiOnayEditable(actor) {
    if (actor?.role !== 'team_leader') {
      forbidden('Baskı onay formunu yalnızca ekip lideri düzenleyebilir.')
    }
    if (this.status !== 'siparis_baski_onay') {
      badRequest('Baskı onay formu yalnızca bu aşamada düzenlenebilir.')
    }
  }

  /**
   * ADET / TARİH / BASIM YERİ / HAZIRLAYAN are what the matbaa physically
   * prints from, so neither half of the maker-checker pair may leave them
   * blank — the preparer because the checker would be signing an incomplete
   * sheet, the approver because that sheet is the final snapshot.
   */
  static _assertBaskiOnayFormComplete(form) {
    const { adet, tarih, basimYeri, hazirlayan } = form ?? {}
    if (![adet, tarih, basimYeri, hazirlayan].every((v) => v?.trim())) {
      badRequest('Adet, tarih, basım yeri ve hazırlayan alanları zorunludur.')
    }
  }

  /**
   * Save a draft of the siparis_baski_onay print-spec form. No
   * timeline log, no notification — this is a partial-friendly save.
   */
  saveBaskiOnayForm(actor, form) {
    this._assertBaskiOnayEditable(actor)

    const now = new Date().toISOString()
    const nextForm = {
      ...(this.baski_onay_form ?? {}),
      ...form,
      saved_by: actor?.id,
      saved_by_name: actor?.name,
      saved_at: now,
    }
    this.baski_onay_form = nextForm
    this.version = (this.version ?? 0) + 1

    return this._record({
      type: 'order.baski_onay_form_saved',
      // No order_history entry — drafts are quiet.
      orderHistory: null,
      projectHistories: [],
      notification: null,
    })
  }

  /**
   * Prepare the siparis_baski_onay form — the MAKER half of the maker-checker
   * pair (migration 060), mirroring the project pipeline's
   * `computeBaskiOnayPrepare` (domain/transitions.js).
   *
   * Saves the sheet AND stamps it "hazırlandı". Deliberately does NOT advance
   * the order: it stays at siparis_baski_onay until a team leader approves,
   * and `approveBaskiOnayForm` additionally requires that leader to be a
   * DIFFERENT person whenever there is another active one.
   *
   * Distinct from `saveBaskiOnayForm` on purpose — a quiet parked draft must
   * never count as a preparation, or the checker would be signing off on
   * something nobody claimed to have finished. Re-preparing after further
   * edits just re-stamps who/when.
   *
   * @param {object} actor
   * @param {object} input
   * @param {object} input.form — { components, adet, tarih, basimYeri, hazirlayan }
   * @param {string} [input.notes]
   */
  prepareBaskiOnayForm(actor, { form, notes = '' } = {}) {
    this._assertBaskiOnayEditable(actor)
    Order._assertBaskiOnayFormComplete(form)

    const now = new Date().toISOString()
    const { components, adet, tarih, basimYeri, hazirlayan } = form ?? {}
    this.baski_onay_form = {
      ...(this.baski_onay_form ?? {}),
      components, adet, tarih, basimYeri, hazirlayan,
      saved_by: actor?.id,
      saved_by_name: actor?.name,
      saved_at: now,
    }
    this.baski_onay_prepared = true
    this.baski_onay_prepared_by = actor?.id ?? null
    this.baski_onay_prepared_by_name = actor?.name ?? null
    this.baski_onay_prepared_at = now
    this.version = (this.version ?? 0) + 1

    return this._record({
      type: 'order.baski_onay_prepared',
      orderHistory: {
        step: 'baski_onay_prepared',
        note: notes
          ? `${notes} · Baskı onay formu hazırlandı`
          : 'Baskı onay formu hazırlandı, onay bekleniyor',
      },
      projectHistories: [{
        event: 'order_baski_onay_prepared', action: 'system',
        note: 'Baskı onay formu hazırlandı, onay bekleniyor',
      }],
      notification: { kind: 'baskiOnayPrepared' },
    })
  }

  /**
   * Approve the siparis_baski_onay form — the CHECKER half. Saves the
   * final snapshot AND flips the order to onaylandi. Project stage
   * flip (forward-only to baskida) is the service's job, not the
   * entity's, because it touches a different aggregate.
   *
   * Since migration 060 this requires a preparation to exist and to have been
   * made by someone else, unless the preparer is the only active team leader
   * there is — the same escape hatch computeApproval's baski_onay branch uses,
   * for the same reason: enforcing "different person" with nobody else left
   * would strand the order with no one who could ever approve it.
   *
   * @param {object} actor
   * @param {object} input
   * @param {object} input.form — { components, adet, tarih, basimYeri, hazirlayan }
   * @param {string} [input.notes]
   * @param {object} [ctx]
   * @param {string[]} [ctx.teamLeaderIds] — active leader ids
   */
  approveBaskiOnayForm(actor, { form, notes = '' } = {}, ctx = {}) {
    if (actor?.role !== 'team_leader') {
      forbidden('Baskı onayını yalnızca ekip lideri verebilir.')
    }
    if (this.status !== 'siparis_baski_onay') {
      badRequest('Bu işlem yalnızca baskı onay aşamasında yapılabilir.')
    }
    if (!this.baski_onay_prepared) {
      badRequest('Önce baskı onay formu hazırlanmalıdır.')
    }
    const teamLeaderIds = ctx.teamLeaderIds ?? []
    const otherActiveLeaders = teamLeaderIds.filter((id) => id !== this.baski_onay_prepared_by)
    if (actor?.id === this.baski_onay_prepared_by && otherActiveLeaders.length > 0) {
      badRequest('Baskı onay formunu hazırlayan kişi kendi onayını veremez, başka bir ekip lideri onaylamalıdır.')
    }
    Order._assertBaskiOnayFormComplete(form)
    const { components, adet, tarih, basimYeri, hazirlayan } = form ?? {}

    const now = new Date().toISOString()
    const finalForm = {
      ...(this.baski_onay_form ?? {}),
      components, adet, tarih, basimYeri, hazirlayan,
      approved_by: actor?.id,
      approved_by_name: actor?.name,
      approved_at: now,
    }
    this.baski_onay_form = finalForm
    this.status = 'onaylandi'
    // Consumed — a re-run of this gate must be prepared afresh rather than
    // inherit a stamp from the round that just closed (mirrors migration 045's
    // reset on the project side).
    this.baski_onay_prepared = false
    this.baski_onay_prepared_by = null
    this.baski_onay_prepared_by_name = null
    this.baski_onay_prepared_at = null
    this.version = (this.version ?? 0) + 1

    return this._record({
      type: 'order.approved',
      orderHistory: {
        step: 'onaylandi',
        note: notes ? `${notes} · Baskı onaylandı` : 'Baskı onaylandı',
      },
      projectHistories: [{
        event: 'order_final', action: 'system',
        note: 'Baskı onaylandı',
      }],
      notification: { kind: 'finalApproved' },
    })
  }

  /**
   * Validate a subtask patch for this order's own order_subtasks snapshot.
   * Pure validation — does NOT mutate the entity (the subtask is a
   * separate aggregate persisted via the repo). Returns the whitelisted
   * field set the service should apply.
   *
   * @param {object} subtask — the locked order_subtasks row
   * @param {object} body
   * @param {object} actor
   * @returns {object} — fields to set
   */
  validateSubtaskUpdate(subtask, body, actor) {
    const allowed = {}
    if (typeof body?.is_done === 'boolean') {
      allowed.is_done = body.is_done
      allowed.done_at = body.is_done ? new Date().toISOString() : null
    }
    if (Number.isFinite(body?.pages_done)) {
      if (subtask.total_pages != null && body.pages_done > subtask.total_pages) {
        badRequest(`İç sayfalar toplam iç sayfa sayısını (${subtask.total_pages}) aşamaz.`)
      }
      allowed.pages_done = body.pages_done
    }
    if (Number.isFinite(body?.stickers_done)) {
      if (subtask.total_stickers != null && body.stickers_done > subtask.total_stickers) {
        badRequest(`Etiket sayısı toplam etiket sayısını (${subtask.total_stickers}) aşamaz.`)
      }
      allowed.stickers_done = body.stickers_done
    }
    if (typeof body?.needs_revize === 'boolean') {
      if (actor?.role !== 'designer') {
        badRequest('Revize işaretini yalnızca tasarımcı değiştirebilir.')
      }
      const assignees = Array.isArray(this.assignee_ids) ? this.assignee_ids : []
      if (assignees.length > 0 && !assignees.includes(actor?.id)) {
        badRequest('Bu baskı size atanmadı.')
      }
      allowed.needs_revize = body.needs_revize
    }
    if (Object.keys(allowed).length === 0) badRequest('Geçerli alan yok.')
    return allowed
  }
}
