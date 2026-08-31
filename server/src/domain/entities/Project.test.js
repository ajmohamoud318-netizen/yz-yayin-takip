/**
 * Entity tests for the Project aggregate. Pure JS — no DB. Each test
 * constructs a Project from a fixture record, calls a method, asserts
 * mutation + event shape, and verifies precondition violations.
 *
 * The FSM tests in `domain/transitions.*.test.js` (1392 lines) cover the
 * compute* helpers in depth; this file focuses on the WRAPPING — the
 * translation from `{ project, history }` to `{ type, projectHistory,
 * notification }`, the idempotent null short-circuit, and the
 * `updatedSubtasks` carry on reject.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Project } from './Project.js'

const L1 = { id: 'L1', role: 'team_leader', name: 'Ayşenur' }
const D1 = { id: 'D1', role: 'designer', name: 'Rahşan' }
const P1 = { id: 'P1', role: 'printer', name: 'Oktay' }

function baseProject(overrides = {}) {
  return {
    id: 'p-1',
    title: 'Test Book',
    type: 'TR',
    stage: 'tasarim',
    assigned_to: null,
    created_by: 'L1',
    target_month: null,
    demo_attempt: 0,
    ozalit_attempt: 0,
    pass_number: 1,
    pass_kind: 'first_edition',
    last_reject_reason: null,
    progress: 0,
    version: 1,
    ozalit_leader_approved: false,
    ozalit_leader_approved_by: null,
    ozalit_leader_approved_at: null,
    ozalit_designer_approvals: [],
    demo_held: false,
    demo_held_at: null,
    demo_held_by_name: null,
    demo_received: false,
    demo_received_by: null,
    demo_received_at: null,
    ozalit_received: false,
    ozalit_received_by: null,
    ozalit_received_at: null,
    baski_onay_prepared: false,
    baski_onay_prepared_by: null,
    baski_onay_prepared_by_name: null,
    baski_onay_prepared_at: null,
    demo_delivered_at: null,
    demo_delivered_by: null,
    ozalit_requested: false,
    reject_target: null,
    last_reject_type: null,
    last_reject_target: null,
    ozalit_approvals: [],
    demo_started: false,
    demo_started_at: null,
    demo_started_by: null,
    demo_started_by_name: null,
    demo_change_requested_at: null,
    demo_change_requested_by: null,
    demo_change_requested_by_name: null,
    demo_change_requested_note: null,
    demo_fix_pending: false,
    ozalit_started: false,
    ozalit_started_at: null,
    ozalit_started_by: null,
    ozalit_started_by_name: null,
    ozalit_change_requested_at: null,
    ozalit_change_requested_by: null,
    ozalit_change_requested_by_name: null,
    ozalit_change_requested_note: null,
    ozalit_fix_pending: false,
    ekran_demo_requested_at: null,
    ekran_demo_requested_by: null,
    ekran_demo_requested_by_name: null,
    catalog_hidden: false,
    origin: 'pipeline',
    assignees: [],
    subtasks: [],
    ...overrides,
  }
}

describe('Project constructor + events', () => {
  it('copies fields from the record', () => {
    const project = new Project(baseProject({ stage: 'demo_onay', progress: 75 }))
    assert.equal(project.stage, 'demo_onay')
    assert.equal(project.progress, 75)
  })

  it('records events on _record and clears them on pullEvents', () => {
    const project = new Project(baseProject({ stage: 'demo_teslim', demo_started: false }))
    const event = project.demoStart(P1)
    const pulled = project.pullEvents()
    assert.equal(pulled.length, 1)
    assert.equal(pulled[0].type, 'project.demo_started')
    assert.deepEqual(project.pullEvents(), [])
  })
})

describe('Project.demoReceive', () => {
  it('stamps demo_received + emits demoReceived notification', () => {
    const project = new Project(baseProject({
      stage: 'demo_onay', demo_received: false, assignees: [D1],
    }))
    const event = project.demoReceive(L1, { designerIds: ['D1'] })
    assert.equal(project.demo_received, true)
    assert.equal(project.demo_received_by, 'Ayşenur')
    assert.ok(project.demo_received_at)
    assert.equal(event.type, 'project.demo_received')
    assert.equal(event.notification.kind, 'demoReceived')
    assert.equal(event.projectHistory.note, 'Demo teslim alındı')
  })

  it('is idempotent — second click returns null, entity unchanged', () => {
    const project = new Project(baseProject({ stage: 'demo_onay', demo_received: true }))
    const before = { ...project }
    const event = project.demoReceive(L1, { designerIds: [] })
    assert.equal(event, null)
    assert.equal(project.demo_received_by, before.demo_received_by)
  })

  it('refuses non-approver', () => {
    const project = new Project(baseProject({ stage: 'demo_onay' }))
    assert.throws(
      () => project.demoReceive(P1, { designerIds: ['D1'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('refuses non-assigned designer', () => {
    const project = new Project(baseProject({
      stage: 'demo_onay', assignees: [{ id: 'D2', name: 'X' }],
    }))
    assert.throws(
      () => project.demoReceive({ id: 'D1', role: 'designer', name: 'Y' }, { designerIds: ['D2'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('refuses outside demo_onay / cin_demo_onay', () => {
    const project = new Project(baseProject({ stage: 'tasarim' }))
    assert.throws(
      () => project.demoReceive(L1, { designerIds: [] }),
      /yalnızca demo onay aşamasında/,
    )
  })
})

describe('Project.demoStart', () => {
  it('flips demo_started for the printer', () => {
    const project = new Project(baseProject({ stage: 'demo_teslim' }))
    const event = project.demoStart(P1)
    assert.equal(project.demo_started, true)
    assert.equal(project.demo_started_by, 'P1')
    assert.equal(event.type, 'project.demo_started')
    assert.equal(event.notification.kind, 'demoStarted')
  })

  it('is idempotent — already-started returns null', () => {
    const project = new Project(baseProject({ stage: 'demo_teslim', demo_started: true }))
    assert.equal(project.demoStart(P1), null)
  })

  it('refuses non-printer', () => {
    const project = new Project(baseProject({ stage: 'demo_teslim' }))
    assert.throws(() => project.demoStart(L1), /yalnızca matbaa/)
  })

  it('refuses while a fix is owed', () => {
    const project = new Project(baseProject({
      stage: 'demo_teslim', demo_started: false, demo_fix_pending: true,
    }))
    assert.throws(() => project.demoStart(P1), /düzeltme bekleniyor/)
  })
})

describe('Project.ozalitCancel', () => {
  it('cancels a not-yet-started request back to tasarim, no attempt bump', () => {
    const project = new Project(baseProject({
      stage: 'ozalit_teslim', ozalit_requested: true, ozalit_attempt: 1,
    }))
    const event = project.ozalitCancel(L1)
    assert.equal(project.stage, 'tasarim')
    assert.equal(project.ozalit_requested, false)
    assert.equal(project.ozalit_attempt, 1, 'attempt untouched')
    assert.equal(event.notification.kind, 'ozalitCancelled')
  })

  it('refuses once the matbaa has started', () => {
    const project = new Project(baseProject({
      stage: 'ozalit_teslim', ozalit_requested: true, ozalit_started: true,
    }))
    assert.throws(() => project.ozalitCancel(L1), /doğrudan iptal edilemez/)
  })

  it('refuses a reject-to-matbaa re-delivery (not a real request)', () => {
    const project = new Project(baseProject({
      stage: 'ozalit_teslim', ozalit_requested: false, reject_target: 'matbaa',
    }))
    assert.throws(() => project.ozalitCancel(L1), /Bekleyen bir ozalit talebi yok/)
  })
})

describe('Project.demoChangeAccept', () => {
  it('un-starts the round and marks fix owed', () => {
    const project = new Project(baseProject({
      stage: 'demo_teslim', demo_started: true,
      demo_change_requested_at: new Date().toISOString(),
      demo_change_requested_by: 'L1',
      demo_change_requested_by_name: 'Ayşenur',
    }))
    const event = project.demoChangeAccept(P1)
    assert.equal(project.demo_started, false)
    assert.equal(project.demo_fix_pending, true)
    assert.equal(project.demo_change_requested_at, null)
    assert.equal(event.notification.kind, 'demoChangeAccepted')
  })

  it('refuses when no pending change request', () => {
    const project = new Project(baseProject({ stage: 'demo_teslim', demo_started: true }))
    assert.throws(() => project.demoChangeAccept(P1), /Bekleyen bir değişiklik talebi yok/)
  })

  it('refuses non-printer', () => {
    const project = new Project(baseProject({
      stage: 'demo_teslim', demo_change_requested_at: new Date().toISOString(),
    }))
    assert.throws(() => project.demoChangeAccept(L1), /yalnızca matbaa/)
  })
})

describe('Project.advance', () => {
  it('tasarim → ozalit_teslim on ozalit rejection resubmit', () => {
    const project = new Project(baseProject({
      stage: 'tasarim', last_reject_type: 'ozalit', progress: 100,
    }))
    const event = project.advance(L1)
    assert.equal(project.stage, 'ozalit_teslim')
    assert.equal(project.last_reject_type, null)
    assert.equal(event.type, 'project.advance')
    assert.equal(event.notification.kind, 'transition')
  })

  it('refuses a tasarim resubmit with outstanding revize flags', () => {
    const project = new Project(baseProject({
      stage: 'tasarim', subtasks: [{ kind: 'check', needs_revize: true }],
    }))
    assert.throws(() => project.advance(L1), /Revize bekleyen/)
  })

  it('approve at <100% holds the project at demo_onay (demo_held=true)', () => {
  // The "approve at <100% holds the project at demo_onay" branch is a
  // success case, not an error — it sets demo_held=true and emits a
  // history row noting the hold. No throw, no advance.
  const project = new Project(baseProject({
    stage: 'demo_onay', progress: 50, demo_received: true, demo_held: false,
  }))
  const event = project.approve(L1, { teamLeaderIds: ['L1'], designerIds: [] })
  assert.equal(project.stage, 'demo_onay')
  assert.equal(project.demo_held, true)
  assert.match(event.projectHistory.note, /tasarım tamamlanmadığı için/)
})
})

describe('Project.reject — designer target', () => {
  it('flags the chosen subtasks and recomputes progress', () => {
    const project = new Project(baseProject({
      stage: 'demo_onay', demo_received: true,
      progress: 50,
      subtasks: [
        { id: 'sub-1', kind: 'check', is_done: true, done_at: 'x', pages_done: null, needs_revize: false },
        { id: 'sub-2', kind: 'check', is_done: true, done_at: 'x', pages_done: null, needs_revize: false },
      ],
    }))
    const event = project.reject(L1, {
      reason: 'yanlış renk', rejectTarget: 'designer', revizeIds: ['sub-1'], note: '',
    })
    assert.equal(project.stage, 'tasarim')
    assert.equal(project.last_reject_type, 'demo')
    assert.equal(project.last_reject_target, 'designer')
    const updated = event.updatedSubtasks
    assert.equal(updated.length, 2)
    assert.equal(updated.find((s) => s.id === 'sub-1').needs_revize, true)
    assert.equal(updated.find((s) => s.id === 'sub-2').needs_revize, false)
  })

  it('em carries updatedSubtasks on the event (service handles the UPDATEs)', () => {
    const project = new Project(baseProject({
      stage: 'demo_onay', demo_received: true,
      subtasks: [{ id: 'sub-1', kind: 'check', is_done: true, done_at: 'x', pages_done: null, needs_revize: false }],
    }))
    const event = project.reject(L1, { reason: 'x', rejectTarget: 'designer' })
    assert.ok(Array.isArray(event.updatedSubtasks), 'subtasks attached for service to write')
  })
})

describe('Project.reject — matbaa target', () => {
  it('does not include updatedSubtasks (matbaa re-delivery, design unchanged)', () => {
    const project = new Project(baseProject({
      stage: 'demo_onay', demo_received: true, type: 'TR',
      subtasks: [{ id: 'sub-1', kind: 'check', is_done: true, done_at: 'x', pages_done: null, needs_revize: false }],
    }))
    const event = project.reject(L1, { reason: 'x', rejectTarget: 'matbaa' })
    assert.equal(project.reject_target, 'matbaa')
    assert.equal(event.updatedSubtasks, null, 'FSM omits subtasks on matbaa target')
  })

  it('bumps demo_attempt on reject-to-matbaa', () => {
    const project = new Project(baseProject({
      stage: 'demo_onay', demo_received: true, demo_attempt: 2, type: 'TR',
    }))
    project.reject(L1, { reason: 'x', rejectTarget: 'matbaa' })
    assert.equal(project.demo_attempt, 3)
  })

  it('refuses non-leader', () => {
    const project = new Project(baseProject({ stage: 'demo_onay', demo_received: true }))
    assert.throws(
      () => project.reject(D1, { reason: 'x', rejectTarget: 'matbaa' }),
      /Reddi yalnızca ekip lideri/,
    )
  })
})

describe('Project.approve — multi-party ozalit', () => {
  it('partial approval: stays at ozalit_onay, appends to ledger', () => {
    const project = new Project(baseProject({
      stage: 'ozalit_onay', ozalit_received: true,
    }))
    const event = project.approve(L1, { teamLeaderIds: ['L1'], designerIds: ['D1'] })
    assert.equal(project.stage, 'ozalit_onay', 'no advance on partial')
    assert.equal(project.ozalit_approvals.length, 1)
    assert.equal(event.notification.kind, 'transition')
  })

  it('full approval: advances to baski_onay after L1 + D1 sign', () => {
    const project = new Project(baseProject({
      stage: 'ozalit_onay', ozalit_received: true, progress: 100,
    }))
    const partial = project.approve(L1, { teamLeaderIds: ['L1'], designerIds: ['D1'] })
    assert.equal(partial.type, 'project.approve', 'first sign is partial')
    assert.equal(project.stage, 'ozalit_onay')
    const full = project.approve(D1, { teamLeaderIds: ['L1'], designerIds: ['D1'] })
    assert.equal(project.stage, 'baski_onay')
    assert.deepEqual(project.ozalit_approvals, [])
    assert.equal(full.notification.kind, 'transition')
  })

  it('refuses designer before any leader (leader-first)', () => {
    const project = new Project(baseProject({ stage: 'ozalit_onay', ozalit_received: true }))
    assert.throws(
      () => project.approve(D1, { teamLeaderIds: ['L1'], designerIds: ['D1'] }),
      /Önce ekip lideri onaylamalıdır/,
    )
  })

  it('refuses before ozalit receipt', () => {
    const project = new Project(baseProject({ stage: 'ozalit_onay', ozalit_received: false }))
    assert.throws(
      () => project.approve(L1, { teamLeaderIds: ['L1'], designerIds: [] }),
      /Önce ozalit/,
    )
  })
})

describe('Project.approve — baski_onay dual-leader', () => {
  it('refuses when no baski_onay_prepared yet', () => {
    const project = new Project(baseProject({
      stage: 'baski_onay', baski_onay_prepared: false, progress: 100,
    }))
    assert.throws(
      () => project.approve(L1, { teamLeaderIds: ['L1'], designerIds: [] }),
      /Önce baskı onay formu/,
    )
  })

  it('refuses same-leader prepare+approve', () => {
    const project = new Project(baseProject({
      stage: 'baski_onay', baski_onay_prepared: true,
      baski_onay_prepared_by: 'L1', progress: 100,
    }))
    assert.throws(
      () => project.approve(L1, { teamLeaderIds: ['L1', 'L2'], designerIds: [] }),
      /hazırlayan kişi kendi onayını veremez/,
    )
  })

  it('approves when a different leader signs off', () => {
    const project = new Project(baseProject({
      stage: 'baski_onay', baski_onay_prepared: true,
      baski_onay_prepared_by: 'L1', progress: 100,
    }))
    const L2 = { id: 'L2', role: 'team_leader', name: 'İkinci' }
    const event = project.approve(L2, { teamLeaderIds: ['L1', 'L2'], designerIds: [] })
    assert.equal(project.stage, 'baskida')
    assert.equal(project.baski_onay_prepared, false)
    assert.equal(event.notification.kind, 'transition')
  })
})

describe('Project.ekranDemoReject', () => {
  it('clears the pending request and emits reason on the history row', () => {
    const project = new Project(baseProject({
      stage: 'demo_onay', demo_held: true, progress: 100,
      ekran_demo_requested_at: new Date().toISOString(),
      ekran_demo_requested_by: 'L1',
      ekran_demo_requested_by_name: 'Ayşenur',
    }))
    const event = project.ekranDemoReject(L1, { reason: '  daha çok revizyon  ' })
    assert.equal(project.ekran_demo_requested_at, null)
    assert.equal(event.notification.kind, 'ekranDemoRejected')
    // The FSM trims `reason.trim()` on the history row; the entity surfaces
    // the raw value on the notification so the service can decide what to send.
    assert.equal(event.notification.reason, '  daha çok revizyon  ')
    assert.equal(event.projectHistory.reason, 'daha çok revizyon')
  })

  it('refuses when no pending request', () => {
    const project = new Project(baseProject({ stage: 'demo_onay', demo_held: true }))
    assert.throws(
      () => project.ekranDemoReject(L1, { reason: 'x' }),
      /Bekleyen bir ekran demo onayı talebi yok/,
    )
  })

  it('refuses missing reason', () => {
    const project = new Project(baseProject({
      stage: 'demo_onay', demo_held: true,
      ekran_demo_requested_at: new Date().toISOString(),
    }))
    assert.throws(() => project.ekranDemoReject(L1, { reason: '  ' }), /Red sebebi zorunludur/)
  })
})

describe('Project events emit the right shape', () => {
  it('demoStarted: type + projectHistory.note + notification.kind', () => {
    const project = new Project(baseProject({ stage: 'demo_teslim' }))
    const event = project.demoStart(P1)
    assert.equal(event.type, 'project.demo_started')
    assert.match(event.projectHistory.note, /Matbaa demo çalışmasına başladı/)
    assert.equal(event.notification.kind, 'demoStarted')
  })

  it('demoChangeRequest: notification carries the note', () => {
    const project = new Project(baseProject({
      stage: 'demo_teslim', demo_started: true,
    }))
    const event = project.demoChangeRequest(L1, { note: 'cover needs shift' })
    assert.equal(event.notification.kind, 'demoChangeRequested')
    assert.equal(event.notification.note, 'cover needs shift')
  })

  it('ozalitEdit: cleared fix_pending + history note', () => {
    const project = new Project(baseProject({
      stage: 'ozalit_teslim', ozalit_fix_pending: true, ozalit_started: false,
      ozalit_requested: true,
    }))
    const event = project.ozalitEdit(L1, { demoId: 'd-1' })
    assert.equal(project.ozalit_fix_pending, false)
    assert.equal(event.notification.kind, 'ozalitEdited')
    assert.equal(event.projectHistory.demo_id, 'd-1')
  })
})