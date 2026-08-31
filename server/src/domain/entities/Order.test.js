/**
 * Entity tests for the Order aggregate. Pure JS — no DB. Each test
 * constructs an Order from a fixture record, calls a method, asserts
 * mutation + event shape, and verifies precondition violations.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Order } from './Order.js'

const L1 = { id: 'L1', role: 'team_leader', name: 'Ayşenur' }
const L2 = { id: 'L2', role: 'team_leader', name: 'İkinci Lider' }
const D1 = { id: 'D1', role: 'designer', name: 'Abdijibar' }
const D2 = { id: 'D2', role: 'designer', name: 'Rahşan' }
const printer = { id: 'P1', role: 'printer', name: 'Oktay' }
const satis = { id: 'S1', role: 'satis', name: 'Esra' }

function baseOrder(overrides = {}) {
  return {
    id: 'o-1',
    project_id: 'p-1',
    status: 'pending',
    requested_by: 'S1',
    payload: {},
    assignee_ids: [],
    matbaa_received: false,
    matbaa_received_by: null,
    matbaa_received_at: null,
    matbaa_approvals: [],
    ozalit_started: false,
    ozalit_started_by: null,
    ozalit_started_by_name: null,
    ozalit_started_at: null,
    ozalit_change_requested_at: null,
    ozalit_change_requested_by: null,
    ozalit_change_requested_by_name: null,
    ozalit_change_requested_note: null,
    ozalit_fix_pending: false,
    ozalit_attempt: 0,
    last_reject_type: null,
    baski_onay_form: null,
    baski_onay_prepared: false,
    baski_onay_prepared_by: null,
    baski_onay_prepared_by_name: null,
    baski_onay_prepared_at: null,
    version: 1,
    ...overrides,
  }
}

describe('Order.receiveMatbaaOzalit', () => {
  it('records the ack and emits a matbaaReceived event', () => {
    const order = new Order(baseOrder({
      status: 'matbaa_onay', matbaa_received: false, assignee_ids: ['D1'],
    }))
    const event = order.receiveMatbaaOzalit(L1, { designerIds: ['D1'] })
    assert.equal(order.matbaa_received, true)
    assert.equal(order.matbaa_received_by, 'Ayşenur')
    assert.ok(order.matbaa_received_at)
    assert.equal(order.version, 2)
    assert.equal(event.type, 'order.matbaa_received')
    assert.equal(event.orderHistory.step, 'matbaa_received')
    assert.equal(event.notification.kind, 'matbaaReceived')
    assert.deepEqual(event.notification.assigneeIds, ['D1'])
  })

  it('is idempotent — second call returns null and does not mutate', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay', matbaa_received: true }))
    const event = order.receiveMatbaaOzalit(L1, { designerIds: [] })
    assert.equal(event, null)
    assert.equal(order.version, 1, 'version must NOT bump on idempotent no-op')
  })

  it('refuses non-approvers', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay' }))
    assert.throws(
      () => order.receiveMatbaaOzalit(printer, { designerIds: ['D1'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('refuses designers not on this order', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay', assignee_ids: ['D2'] }))
    assert.throws(
      () => order.receiveMatbaaOzalit(D1, { designerIds: ['D2'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('refuses outside matbaa_onay', () => {
    const order = new Order(baseOrder({ status: 'tasarimci_onay' }))
    assert.throws(
      () => order.receiveMatbaaOzalit(L1, { designerIds: [] }),
      /yalnızca matbaa onay aşamasında/,
    )
  })
})

describe('Order.markMatbaaNotReceived', () => {
  it('sends the order back to tasarimci_onay and wipes the ledger', () => {
    const order = new Order(baseOrder({
      status: 'matbaa_onay',
      matbaa_approvals: [{ id: 'L1', role: 'team_leader', name: 'Ayşenur' }],
      ozalit_started: true,
      ozalit_attempt: 2,
    }))
    const event = order.markMatbaaNotReceived(L1, { designerIds: [] })
    assert.equal(order.status, 'tasarimci_onay')
    assert.deepEqual(order.matbaa_approvals, [])
    assert.equal(order.ozalit_attempt, 3)
    assert.equal(event.notification.destination, 'tasarimci_onay')
  })

  it('keeps ozalit_started — the work was done, only the handover failed', () => {
    const order = new Order(baseOrder({
      status: 'matbaa_onay', ozalit_started: true, ozalit_started_by_name: 'Matbaa',
    }))
    order.markMatbaaNotReceived(L1, { designerIds: [] })
    // TalepSignDialog gates "Teslim Edin" on this: the printer re-delivers
    // instead of pressing "İşlemi Başlatın" a second time.
    assert.equal(order.ozalit_started, true)
    assert.equal(order.ozalit_started_by_name, 'Matbaa')
  })

  it('refuses once the proof has been acknowledged', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay', matbaa_received: true }))
    assert.throws(() => order.markMatbaaNotReceived(L1, { designerIds: [] }), /zaten teslim alındı/)
  })

  it('refuses non-approvers', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay' }))
    assert.throws(
      () => order.markMatbaaNotReceived(printer, { designerIds: ['D1'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })
})

describe('Order.startOzalit', () => {
  it('marks started for the printer', () => {
    const order = new Order(baseOrder({ status: 'tasarimci_onay' }))
    const event = order.startOzalit(printer)
    assert.equal(order.ozalit_started, true)
    assert.equal(order.ozalit_started_by, 'P1')
    assert.equal(order.ozalit_started_by_name, 'Oktay')
    assert.equal(event.notification.kind, 'ozalitStarted')
  })

  it('is idempotent — already-started returns null', () => {
    const order = new Order(baseOrder({ status: 'tasarimci_onay', ozalit_started: true }))
    assert.equal(order.startOzalit(printer), null)
  })

  it('refuses non-printer', () => {
    const order = new Order(baseOrder({ status: 'tasarimci_onay' }))
    assert.throws(() => order.startOzalit(L1), /yalnızca matbaa/)
  })

  it('refuses outside tasarimci_onay', () => {
    const order = new Order(baseOrder({ status: 'goruldu' }))
    assert.throws(() => order.startOzalit(printer), /yalnızca ozalit matbaa/)
  })

  it('refuses while a fix is owed (change request accepted)', () => {
    // acceptOzalitChange un-starts the round as it sets the fix flag, so
    // "a fix is owed" always means not-started — a still-started round would
    // hit the idempotent early return above instead.
    const order = new Order(baseOrder({
      status: 'tasarimci_onay', ozalit_started: false, ozalit_fix_pending: true,
    }))
    assert.throws(() => order.startOzalit(printer), /düzeltme bekleniyor/)
  })
})

describe('Order.cancelOzalit', () => {
  it('cancels a not-yet-started round back to goruldu', () => {
    const order = new Order(baseOrder({ status: 'tasarimci_onay' }))
    const event = order.cancelOzalit(L1)
    assert.equal(order.status, 'goruldu')
    assert.equal(order.ozalit_started, false)
    assert.equal(event.notification.kind, 'ozalitCancelled')
  })

  it('refuses once the round has started', () => {
    const order = new Order(baseOrder({ status: 'tasarimci_onay', ozalit_started: true }))
    assert.throws(() => order.cancelOzalit(L1), /doğrudan iptal edilemez/)
  })

  it('refuses non-leader', () => {
    const order = new Order(baseOrder({ status: 'tasarimci_onay' }))
    assert.throws(() => order.cancelOzalit(printer), /yalnızca ekip lideri/)
  })

  it('wipes pending change-request state on cancel', () => {
    const order = new Order(baseOrder({
      status: 'tasarimci_onay',
      ozalit_change_requested_at: new Date().toISOString(),
      ozalit_change_requested_by: 'L1',
      ozalit_fix_pending: true,
    }))
    order.cancelOzalit(L1)
    assert.equal(order.ozalit_change_requested_at, null)
    assert.equal(order.ozalit_fix_pending, false)
  })
})

describe('Order.editOzalit', () => {
  it('clears fix_pending and records the demo id', () => {
    const order = new Order(baseOrder({
      status: 'tasarimci_onay', ozalit_fix_pending: true,
    }))
    const event = order.editOzalit(L1, { demoId: 'd-1' })
    assert.equal(order.ozalit_fix_pending, false)
    assert.equal(event.orderHistory.demoId, 'd-1')
    assert.equal(event.projectHistories[0].demoId, 'd-1')
  })

  it('refuses once started', () => {
    const order = new Order(baseOrder({ status: 'tasarimci_onay', ozalit_started: true }))
    assert.throws(() => order.editOzalit(L1, { demoId: null }), /değişiklik isteyin/)
  })

  it('refuses non-leader', () => {
    const order = new Order(baseOrder({ status: 'tasarimci_onay' }))
    assert.throws(() => order.editOzalit(printer, { demoId: null }), /yalnızca ekip lideri/)
  })
})

describe('Order.requestOzalitChange', () => {
  it('stamps the change request with note', () => {
    const order = new Order(baseOrder({ status: 'tasarimci_onay', ozalit_started: true }))
    const event = order.requestOzalitChange(L1, { note: '  cover needs shift  ' })
    assert.ok(order.ozalit_change_requested_at)
    assert.equal(order.ozalit_change_requested_note, 'cover needs shift')
    assert.equal(event.orderHistory.note, 'cover needs shift')
  })

  it('refuses when not started', () => {
    const order = new Order(baseOrder({ status: 'tasarimci_onay' }))
    assert.throws(() => order.requestOzalitChange(L1, { note: 'x' }), /henüz başlamadı/)
  })

  it('refuses when one is already pending', () => {
    const order = new Order(baseOrder({
      status: 'tasarimci_onay',
      ozalit_started: true,
      ozalit_change_requested_at: new Date().toISOString(),
    }))
    assert.throws(() => order.requestOzalitChange(L1, { note: 'x' }), /Zaten bekleyen/)
  })
})

describe('Order.acceptOzalitChange', () => {
  it('un-starts the round and marks fix owed', () => {
    const order = new Order(baseOrder({
      status: 'tasarimci_onay',
      ozalit_started: true,
      ozalit_change_requested_at: new Date().toISOString(),
      ozalit_change_requested_by: 'L1',
      ozalit_change_requested_by_name: 'Ayşenur',
      ozalit_change_requested_note: 'fix cover',
    }))
    order.acceptOzalitChange(printer)
    assert.equal(order.ozalit_started, false)
    assert.equal(order.ozalit_fix_pending, true)
    assert.equal(order.ozalit_change_requested_at, null)
  })

  it('refuses when no pending change request', () => {
    const order = new Order(baseOrder({ status: 'tasarimci_onay' }))
    assert.throws(() => order.acceptOzalitChange(printer), /Bekleyen bir değişiklik talebi yok/)
  })

  it('refuses non-printer', () => {
    const order = new Order(baseOrder({
      status: 'tasarimci_onay', ozalit_change_requested_at: new Date().toISOString(),
    }))
    assert.throws(() => order.acceptOzalitChange(L1), /yalnızca matbaa/)
  })
})

describe('Order.declineOzalitChange', () => {
  it('clears the change request, leaves started intact', () => {
    const order = new Order(baseOrder({
      status: 'tasarimci_onay',
      ozalit_started: true,
      ozalit_change_requested_at: new Date().toISOString(),
    }))
    order.declineOzalitChange(printer)
    assert.equal(order.ozalit_change_requested_at, null)
    assert.equal(order.ozalit_started, true, 'round stays started')
  })

  it('refuses non-printer', () => {
    const order = new Order(baseOrder({
      status: 'tasarimci_onay', ozalit_change_requested_at: new Date().toISOString(),
    }))
    assert.throws(() => order.declineOzalitChange(L1), /yalnızca matbaa/)
  })
})

describe('Order.reject', () => {
  it('sends a matbaa_onay rejection to tasarimci_onay and wipes state', () => {
    const order = new Order(baseOrder({
      status: 'matbaa_onay',
      matbaa_approvals: [{ id: 'L1', role: 'team_leader', name: 'Ayşenur' }],
      ozalit_attempt: 1,
    }))
    const event = order.reject(L1, { reason: 'Yanlış baskı', rejectTarget: 'matbaa' })
    assert.equal(order.status, 'tasarimci_onay')
    assert.deepEqual(order.matbaa_approvals, [])
    assert.equal(order.ozalit_attempt, 2)
    assert.equal(event.notification.kind, 'rejected')
    assert.equal(event.notification.destination, 'tasarimci_onay')
  })

  it('a designer rejection sets last_reject_type', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay' }))
    order.reject(L1, { reason: 'X', rejectTarget: 'designer', revizeIds: ['sub-1'] })
    assert.equal(order.status, 'goruldu')
    assert.equal(order.last_reject_type, 'designer')
  })

  it('a reassign rejection leaves last_reject_type untouched', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay', last_reject_type: 'designer' }))
    order.reject(L1, { reason: 'X', rejectTarget: 'reassign' })
    assert.equal(order.status, 'pending')
    assert.equal(order.last_reject_type, 'designer', 'not overwritten on reassign')
  })

  it('refuses non-leader', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay' }))
    assert.throws(
      () => order.reject(D1, { reason: 'X', rejectTarget: 'matbaa' }),
      /Yalnızca takım lideri/,
    )
  })

  it('refuses invalid reject target for current status', () => {
    const order = new Order(baseOrder({ status: 'goruldu' }))
    assert.throws(
      () => order.reject(L1, { reason: 'X', rejectTarget: 'matbaa' }),
      /Bu aşamada red işlemi yapılamaz/,
    )
  })
})

describe('Order.saveBaskiOnayForm', () => {
  it('stamps saved_by/at without advancing', () => {
    const order = new Order(baseOrder({ status: 'siparis_baski_onay', baski_onay_form: null }))
    const event = order.saveBaskiOnayForm(L1, {
      components: [{ name: 'KİTAP' }], adet: '500', tarih: '2026-09-01',
    })
    assert.equal(order.status, 'siparis_baski_onay', 'status must not change')
    assert.equal(order.baski_onay_form.saved_by, 'L1')
    assert.equal(order.baski_onay_form.saved_by_name, 'Ayşenur')
    assert.equal(order.baski_onay_form.adet, '500')
    assert.equal(event.notification, null)
  })

  it('refuses non-leader', () => {
    const order = new Order(baseOrder({ status: 'siparis_baski_onay' }))
    assert.throws(() => order.saveBaskiOnayForm(D1, {}), /yalnızca ekip lideri/)
  })

  it('refuses outside siparis_baski_onay', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay' }))
    assert.throws(() => order.saveBaskiOnayForm(L1, {}), /yalnızca bu aşamada/)
  })
})

const FULL_FORM = {
  components: [], adet: '500', tarih: '2026-09-01',
  basimYeri: 'Oktay Matbaa', hazirlayan: 'Ayşenur',
}

/** An order already through the maker half, prepared by `leader`. */
function preparedOrder(leader = L1, overrides = {}) {
  return baseOrder({
    status: 'siparis_baski_onay',
    baski_onay_prepared: true,
    baski_onay_prepared_by: leader.id,
    baski_onay_prepared_by_name: leader.name,
    baski_onay_prepared_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  })
}

describe('Order.prepareBaskiOnayForm', () => {
  it('stamps the preparation without advancing', () => {
    const order = new Order(baseOrder({ status: 'siparis_baski_onay' }))
    const event = order.prepareBaskiOnayForm(L1, { form: FULL_FORM })
    assert.equal(order.status, 'siparis_baski_onay', 'prepare must not advance')
    assert.equal(order.baski_onay_prepared, true)
    assert.equal(order.baski_onay_prepared_by, 'L1')
    assert.equal(order.baski_onay_prepared_by_name, 'Ayşenur')
    assert.equal(order.baski_onay_form.adet, '500')
    assert.equal(event.notification.kind, 'baskiOnayPrepared')
    assert.match(event.orderHistory.note, /hazırlandı/)
  })

  it('refuses when required fields are missing', () => {
    const order = new Order(baseOrder({ status: 'siparis_baski_onay' }))
    assert.throws(
      () => order.prepareBaskiOnayForm(L1, { form: { ...FULL_FORM, basimYeri: '  ' } }),
      /Adet, tarih, basım yeri/,
    )
  })

  it('refuses non-leader', () => {
    const order = new Order(baseOrder({ status: 'siparis_baski_onay' }))
    assert.throws(() => order.prepareBaskiOnayForm(D1, { form: FULL_FORM }), /yalnızca ekip lideri/)
  })

  it('refuses outside siparis_baski_onay', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay' }))
    assert.throws(() => order.prepareBaskiOnayForm(L1, { form: FULL_FORM }), /yalnızca bu aşamada/)
  })

  it('a parked draft does NOT count as a preparation', () => {
    const order = new Order(baseOrder({ status: 'siparis_baski_onay' }))
    order.saveBaskiOnayForm(L1, FULL_FORM)
    assert.equal(order.baski_onay_prepared, false)
    assert.throws(
      () => order.approveBaskiOnayForm(L2, { form: FULL_FORM }, { teamLeaderIds: ['L1', 'L2'] }),
      /Önce baskı onay formu hazırlanmalıdır/,
    )
  })
})

describe('Order.approveBaskiOnayForm', () => {
  it('flips the order to onaylandi with approved_by/at', () => {
    const order = new Order(preparedOrder(L1))
    const event = order.approveBaskiOnayForm(L2, { form: FULL_FORM, notes: 'all good' },
      { teamLeaderIds: ['L1', 'L2'] })
    assert.equal(order.status, 'onaylandi')
    assert.equal(order.baski_onay_form.approved_by, 'L2')
    assert.match(event.orderHistory.note, /Baskı onaylandı/)
    assert.equal(event.notification.kind, 'finalApproved')
  })

  it('clears the preparation stamps once it advances', () => {
    const order = new Order(preparedOrder(L1))
    order.approveBaskiOnayForm(L2, { form: FULL_FORM }, { teamLeaderIds: ['L1', 'L2'] })
    assert.equal(order.baski_onay_prepared, false)
    assert.equal(order.baski_onay_prepared_by, null)
    assert.equal(order.baski_onay_prepared_by_name, null)
    assert.equal(order.baski_onay_prepared_at, null)
  })

  it('refuses an approve with no preparation at all', () => {
    const order = new Order(baseOrder({ status: 'siparis_baski_onay' }))
    assert.throws(
      () => order.approveBaskiOnayForm(L1, { form: FULL_FORM }, { teamLeaderIds: ['L1'] }),
      /Önce baskı onay formu hazırlanmalıdır/,
    )
  })

  it('refuses the preparer while another leader is active', () => {
    const order = new Order(preparedOrder(L1))
    assert.throws(
      () => order.approveBaskiOnayForm(L1, { form: FULL_FORM }, { teamLeaderIds: ['L1', 'L2'] }),
      /kendi onayını veremez/,
    )
  })

  // The escape hatch, and today's production shape: one active leader means
  // the maker and the checker are necessarily the same person. Enforcing
  // "different person" here would strand the order forever.
  it('lets the preparer self-approve when they are the only active leader', () => {
    const order = new Order(preparedOrder(L1))
    order.approveBaskiOnayForm(L1, { form: FULL_FORM }, { teamLeaderIds: ['L1'] })
    assert.equal(order.status, 'onaylandi')
  })

  // A leader deactivated after preparing must not block the remaining one.
  it('lets an active leader approve a sheet prepared by a now-inactive leader', () => {
    const order = new Order(preparedOrder(L2))
    order.approveBaskiOnayForm(L1, { form: FULL_FORM }, { teamLeaderIds: ['L1'] })
    assert.equal(order.status, 'onaylandi')
  })

  it('refuses when required fields are missing', () => {
    const order = new Order(preparedOrder(L1))
    assert.throws(
      () => order.approveBaskiOnayForm(L2, {
        form: { ...FULL_FORM, tarih: '' },
      }, { teamLeaderIds: ['L1', 'L2'] }),
      /Adet, tarih, basım yeri/,
    )
  })

  it('refuses non-leader', () => {
    const order = new Order(preparedOrder(L1))
    assert.throws(
      () => order.approveBaskiOnayForm(D1, { form: FULL_FORM }, { teamLeaderIds: ['L1', 'L2'] }),
      /yalnızca ekip lideri/,
    )
  })
})

describe('Order.advance — flat steps', () => {
  it('pending → goruldu stamps assignees and emits transfer + advance', () => {
    const order = new Order(baseOrder({ status: 'pending' }))
    const event = order.advance(L1, { assignees: ['D1', 'D2'], notes: 'go' })
    assert.equal(order.status, 'goruldu')
    assert.deepEqual(order.assignee_ids, ['D1', 'D2'])
    assert.equal(event.orderHistory.step, 'goruldu')
    assert.equal(event.orderHistory.note, 'go')
    assert.equal(event.projectHistories.length, 2, 'transfer + advance')
    assert.equal(event.projectHistories[0].event, 'order_transfer')
    assert.equal(event.projectHistories[1].event, 'order_advance')
    assert.equal(event.notification.kind, 'transition')
    assert.equal(event.notification.destination, 'goruldu')
  })

  it('refuses pending step without assignees', () => {
    const order = new Order(baseOrder({ status: 'pending' }))
    assert.throws(() => order.advance(L1, {}), /Tasarımcı seçmeden/)
  })

  it('goruldu → kontrol_edildi for designer only', () => {
    const order = new Order(baseOrder({ status: 'goruldu' }))
    const event = order.advance(D1, {})
    assert.equal(order.status, 'kontrol_edildi')
    assert.equal(event.notification.destination, 'kontrol_edildi')
  })

  it('refuses goruldu advance by non-designer', () => {
    const order = new Order(baseOrder({ status: 'goruldu' }))
    assert.throws(() => order.advance(L1, {}), /yalnızca ilgili rol/)
  })

  it('kontrol_edildi → tasarimci_onay on first submit', () => {
    const order = new Order(baseOrder({ status: 'kontrol_edildi' }))
    const event = order.advance(D1, {})
    assert.equal(order.status, 'tasarimci_onay')
    assert.equal(order.last_reject_type, null, 'cleared on every kontrol_edildi leave')
    assert.equal(event.notification.destination, 'tasarimci_onay')
  })

  it('kontrol_edildi resubmit honours chosenRoute and clears last_reject_type', () => {
    const order = new Order(baseOrder({ status: 'kontrol_edildi', last_reject_type: 'designer' }))
    const event = order.advance(D1, { route: 'ekran_onay' })
    assert.equal(order.status, 'ekran_onay')
    assert.equal(order.last_reject_type, null)
    assert.equal(event.notification.destination, 'ekran_onay')
  })

  it('refuses chosenRoute on first submission', () => {
    const order = new Order(baseOrder({ status: 'kontrol_edildi' }))
    assert.throws(() => order.advance(D1, { route: 'tasarimci_onay' }), /İlk gönderimde/)
  })

  it('refuses missing chosenRoute on resubmit', () => {
    const order = new Order(baseOrder({ status: 'kontrol_edildi', last_reject_type: 'designer' }))
    assert.throws(() => order.advance(D1, {}), /Ozalit mi yoksa Ekran Onayı/)
  })

  it('refuses chosenRoute outside kontrol_edildi', () => {
    const order = new Order(baseOrder({ status: 'goruldu' }))
    assert.throws(() => order.advance(D1, { route: 'ekran_onay' }), /yalnızca ozalit isteme/)
  })

  it('refuses siparis_baski_onay advance — must use dedicated route', () => {
    const order = new Order(baseOrder({ status: 'siparis_baski_onay' }))
    assert.throws(() => order.advance(L1, {}), /baskı onay formunu doldurup/)
  })

  it('version conflict throws 409', () => {
    const order = new Order(baseOrder({ status: 'pending', version: 3 }))
    try {
      order.advance(L1, { assignees: ['D1'], expectedVersion: 2 })
      assert.fail('expected throw')
    } catch (err) {
      assert.equal(err.status, 409)
    }
  })

  it('tasarimci_onay gates: requires ozalit_started', () => {
    const order = new Order(baseOrder({
      status: 'tasarimci_onay', ozalit_started: false,
    }))
    assert.throws(() => order.advance(printer, {}), /İşlemi Başlatın/)
  })

  it('tasarimci_onay gates: refuses with pending change request', () => {
    const order = new Order(baseOrder({
      status: 'tasarimci_onay',
      ozalit_started: true,
      ozalit_change_requested_at: new Date().toISOString(),
    }))
    assert.throws(() => order.advance(printer, {}), /Bekleyen bir değişiklik talebi/)
  })
})

describe('Order.advance — matbaa_onay multi-party', () => {
  const ctx = { teamLeaderIds: ['L1', 'L2'], designerIds: ['D1'] }

  it('a single leader approval is partial — status stays, project log only', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay', matbaa_received: true }))
    const event = order.advance(L1, ctx)
    assert.equal(order.status, 'matbaa_onay', 'no advance on partial')
    assert.equal(order.matbaa_approvals.length, 1)
    assert.equal(event.notification.kind, 'matbaaApprovalPending')
    assert.equal(event.projectHistories.length, 1)
    assert.equal(event.projectHistories[0].event, 'order_matbaa_approve')
  })

  it('two leaders + designer → advances to siparis_baski_onay, ledger cleared', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay', matbaa_received: true }))
    const r1 = order.advance(L1, ctx)
    assert.equal(r1.notification.kind, 'matbaaApprovalPending')
    // Force the matbaa_approvals back so we exercise the multi-step
    const r2 = order.advance(L2, ctx)
    assert.equal(r2.notification.kind, 'matbaaApprovalPending')
    const r3 = order.advance(D1, ctx)
    assert.equal(order.status, 'siparis_baski_onay')
    assert.deepEqual(order.matbaa_approvals, [])
    assert.equal(r3.notification.kind, 'transition')
    assert.equal(r3.notification.destination, 'siparis_baski_onay')
  })

  it('refuses a designer approving before any leader', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay', matbaa_received: true }))
    assert.throws(() => order.advance(D1, ctx), /Önce ekip lideri onaylamalıdır/)
  })

  it('refuses non-approver (printer)', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay', matbaa_received: true }))
    assert.throws(() => order.advance(printer, ctx), /yalnızca ekip lideri veya atanmış tasarımcı/)
  })

  it('refuses before the receipt gate', () => {
    const order = new Order(baseOrder({ status: 'matbaa_onay', matbaa_received: false }))
    assert.throws(() => order.advance(L1, ctx), /Teslim Alındı/)
  })
})

describe('Order.validateSubtaskUpdate', () => {
  const subtask = {
    id: 'sub-1', order_id: 'o-1', title: 'Kapak', kind: 'pages',
    is_done: false, total_pages: 48, pages_done: 10,
    total_stickers: null, stickers_done: 0,
  }

  it('whitelists is_done + done_at', () => {
    const order = new Order(baseOrder({ assignee_ids: ['D1'] }))
    const allowed = order.validateSubtaskUpdate(subtask, { is_done: true }, D1)
    assert.equal(allowed.is_done, true)
    assert.ok(allowed.done_at)
  })

  it('rejects pages_done above total_pages', () => {
    const order = new Order(baseOrder({ assignee_ids: ['D1'] }))
    assert.throws(
      () => order.validateSubtaskUpdate(subtask, { pages_done: 50 }, D1),
      /toplam iç sayfa sayısını/,
    )
  })

  it('refuses needs_revize from non-designer', () => {
    const order = new Order(baseOrder({ assignee_ids: ['D1'] }))
    assert.throws(
      () => order.validateSubtaskUpdate(subtask, { needs_revize: true }, L1),
      /yalnızca tasarımcı/,
    )
  })

  it('refuses needs_revize from non-assigned designer', () => {
    const order = new Order(baseOrder({ assignee_ids: ['D1'] }))
    assert.throws(
      () => order.validateSubtaskUpdate(subtask, { needs_revize: true }, D2),
      /size atanmadı/,
    )
  })

  it('refuses empty patch', () => {
    const order = new Order(baseOrder({ assignee_ids: ['D1'] }))
    assert.throws(() => order.validateSubtaskUpdate(subtask, {}, D1), /Geçerli alan yok/)
  })
})

// satis role is used by the create flow (not entity methods), but include
// here so the test suite has a single fixture for all roles.
describe('role fixtures', () => {
  it('satis is distinct from team_leader / designer / printer', () => {
    assert.equal(satis.role, 'satis')
  })
})
