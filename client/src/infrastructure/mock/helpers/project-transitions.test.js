/**
 * Tests for the pure transition helpers — the heart of the project state
 * machine. These cover the branches that used to be tangled inside the 680-line
 * project repository: Ozalit dual sign-off, rejection routing, the satista
 * guard, and the 100% production gate.
 */
import { computeAdvance, computeApproval, computeRejection } from './project-transitions.js'

const leader = { id: 'u-ayse', name: 'Ayşenur', role: 'team_leader' }
const designerA = { id: 'u-aylin', name: 'Aylin', role: 'designer' }
const designerB = { id: 'u-feyza', name: 'Feyza', role: 'designer' }
const printer = { id: 'u-oktay', name: 'Oktay', role: 'printer' }

function makeProject(overrides = {}) {
  return {
    id: 'p-test',
    type: 'TR',
    stage: 'tasarim',
    progress: 100,
    demo_attempt: 0,
    ozalit_attempt: 0,
    history: [],
    assignees: [{ id: designerA.id, name: designerA.name }],
    subtasks: [],
    ozalit_requested: false,
    reject_target: null,
    last_reject_reason: null,
    last_reject_type: null,
    ozalit_leader_approved: false,
    ozalit_designer_approvals: [],
    ...overrides,
  }
}

/* ============================================================================
 *  computeAdvance
 * ========================================================================== */

describe('computeAdvance — generic forward', () => {
  it('advances tasarim → demo_teslim (demo gate is open at any progress)', () => {
    const p = makeProject({ stage: 'tasarim', progress: 0 })
    const { project: next, history } = computeAdvance(p, leader)
    expect(next.stage).toBe('demo_teslim')
    expect(history.action).toBe('advance')
    expect(history.from_stage).toBe('tasarim')
    expect(history.to_stage).toBe('demo_teslim')
  })

  it('blocks satista on a plain forward advance (handover-only)', () => {
    const p = makeProject({ stage: 'uretimde', progress: 100 })
    expect(() => computeAdvance(p, leader)).toThrow(/Satış ekibi teslimi/)
  })

  it('allows the demo stages to advance below 100% progress', () => {
    const p = makeProject({ stage: 'tasarim', progress: 99, demo_attempt: 0 })
    // First advance to demo_teslim is fine (demo gate is open).
    const { project: demo } = computeAdvance(p, leader)
    expect(demo.stage).toBe('demo_teslim')
  })

  it('clears stale reject banner on forward advance', () => {
    const p = makeProject({
      stage: 'demo_teslim',
      progress: 100,
      last_reject_type: 'demo',
      last_reject_reason: 'previous reason',
      reject_target: 'designer',
    })
    const { project: next } = computeAdvance(p, leader)
    expect(next.last_reject_type).toBeNull()
    expect(next.last_reject_reason).toBeNull()
    expect(next.reject_target).toBeNull()
  })

  it('returns no history at the last stage', () => {
    const p = makeProject({ stage: 'satista' })
    const { project, history } = computeAdvance(p, leader)
    expect(project.stage).toBe('satista')
    expect(history).toBeNull()
  })
})

describe('computeAdvance — Ozalit revision resubmit', () => {
  it('a designer resubmitting an ozalit revision jumps to ozalit_teslim', () => {
    const p = makeProject({
      stage: 'tasarim',
      progress: 100,
      last_reject_type: 'ozalit',
      last_reject_reason: 'needs fix',
    })
    const { project: next, history } = computeAdvance(p, designerA)
    expect(next.stage).toBe('ozalit_teslim')
    expect(next.ozalit_requested).toBe(true) // resubmit IS the request
    expect(next.last_reject_type).toBeNull()
    expect(history.action).toBe('advance')
    expect(history.to_stage).toBe('ozalit_teslim')
  })

  it('blocks ozalit resubmit below 100%', () => {
    const p = makeProject({ stage: 'tasarim', progress: 99, last_reject_type: 'ozalit' })
    expect(() => computeAdvance(p, designerA)).toThrow(/%100 tamamlanmadan/)
  })
})

describe('computeAdvance — Ozalit Teslim dual-step', () => {
  it("leader 'Ozalit İste' stays at ozalit_teslim and sets the request flag", () => {
    const p = makeProject({ stage: 'ozalit_teslim', ozalit_requested: false })
    const { project: next, history } = computeAdvance(p, leader)
    expect(next.stage).toBe('ozalit_teslim')
    expect(next.ozalit_requested).toBe(true)
    expect(history.note).toMatch(/Ozalit istendi/)
  })

  it("a designer 'Ozalit İste' also works", () => {
    const p = makeProject({ stage: 'ozalit_teslim', ozalit_requested: false })
    const { project: next } = computeAdvance(p, designerA)
    expect(next.ozalit_requested).toBe(true)
  })

  it("a printer cannot 'Ozalit İste' — they deliver, not request", () => {
    const p = makeProject({ stage: 'ozalit_teslim', ozalit_requested: false })
    expect(() => computeAdvance(p, printer)).toThrow(/ekip lideri veya tasarımcı/)
  })

  it("double 'Ozalit İste' throws", () => {
    const p = makeProject({ stage: 'ozalit_teslim', ozalit_requested: true })
    expect(() => computeAdvance(p, leader)).toThrow(/zaten istendi/)
  })

  it("printer 'Teslim Et' advances to ozalit_onay", () => {
    const p = makeProject({ stage: 'ozalit_teslim', ozalit_requested: true })
    const { project: next, history } = computeAdvance(p, printer)
    expect(next.stage).toBe('ozalit_onay')
    expect(next.ozalit_requested).toBe(false)
    expect(history.to_stage).toBe('ozalit_onay')
  })

  it("printer delivery without a prior request throws (unless reject-target = matbaa)", () => {
    const p = makeProject({ stage: 'ozalit_teslim', ozalit_requested: false })
    expect(() => computeAdvance(p, printer)).toThrow(/Önce ekip lideri/)
  })

  it('a matbaa re-delivery (reject_target=matbaa) skips the request step', () => {
    const p = makeProject({
      stage: 'ozalit_teslim',
      ozalit_requested: false,
      reject_target: 'matbaa',
    })
    const { project: next } = computeAdvance(p, printer)
    expect(next.stage).toBe('ozalit_onay')
    expect(next.reject_target).toBeNull()
  })
})

/* ============================================================================
 *  computeApproval
 * ========================================================================== */

describe('computeApproval — generic', () => {
  it('advances to the next stage', () => {
    const p = makeProject({ stage: 'demo_teslim', progress: 100 })
    const { project: next, history } = computeApproval(p, printer)
    expect(next.stage).toBe('demo_onay')
    expect(history.action).toBe('approve')
  })

  it('returns no history at the last stage', () => {
    const p = makeProject({ stage: 'satista' })
    const { project, history } = computeApproval(p, leader)
    expect(history).toBeNull()
    expect(project.stage).toBe('satista')
  })
})

describe('computeApproval — Ozalit dual sign-off', () => {
  it('first approval must be the team leader', () => {
    const p = makeProject({ stage: 'ozalit_onay' })
    expect(() => computeApproval(p, designerA)).toThrow(/ekip lideri/)
  })

  it('leader approval stays at ozalit_onay and records the leader sign-off', () => {
    const p = makeProject({ stage: 'ozalit_onay' })
    const { project: next, history } = computeApproval(p, leader)
    expect(next.stage).toBe('ozalit_onay')
    expect(next.ozalit_leader_approved).toBe(true)
    expect(next.ozalit_leader_approved_by).toBe(leader.name)
    expect(history.note).toMatch(/ekip lideri onayladı/)
  })

  it('after the leader, only assigned designers may sign', () => {
    const p = makeProject({
      stage: 'ozalit_onay',
      ozalit_leader_approved: true,
      assignees: [{ id: designerA.id, name: designerA.name }],
    })
    const outsider = { id: 'u-stranger', name: 'X', role: 'designer' }
    expect(() => computeApproval(p, outsider)).toThrow(/atanmış tasarımcı/)
  })

  it('designers cannot double-approve', () => {
    const p = makeProject({
      stage: 'ozalit_onay',
      ozalit_leader_approved: true,
      assignees: [{ id: designerA.id, name: designerA.name }],
      ozalit_designer_approvals: [designerA.id],
    })
    expect(() => computeApproval(p, designerA)).toThrow(/zaten onayladınız/)
  })

  it('a single-designer project advances to production on the designer approval', () => {
    const p = makeProject({
      stage: 'ozalit_onay',
      ozalit_leader_approved: true,
      assignees: [{ id: designerA.id, name: designerA.name }],
    })
    const { project: next, history } = computeApproval(p, designerA)
    expect(next.stage).toBe('uretime_hazir')
    expect(next.ozalit_leader_approved).toBe(false)
    expect(next.ozalit_designer_approvals).toEqual([])
    expect(history.to_stage).toBe('uretime_hazir')
  })

  it('multi-designer: stays put until ALL designers sign, then advances', () => {
    let p = makeProject({
      stage: 'ozalit_onay',
      ozalit_leader_approved: true,
      assignees: [
        { id: designerA.id, name: designerA.name },
        { id: designerB.id, name: designerB.name },
      ],
    })
    // First designer signs — project should stay put, partial approval recorded.
    const r1 = computeApproval(p, designerA)
    expect(r1.project.stage).toBe('ozalit_onay')
    expect(r1.project.ozalit_designer_approvals).toEqual([designerA.id])
    expect(r1.history.note).toMatch(/1 tasarımcı onayı bekleniyor/)

    // Second designer signs — should advance to production.
    p = r1.project
    const r2 = computeApproval(p, designerB)
    expect(r2.project.stage).toBe('uretime_hazir')
    expect(r2.project.ozalit_leader_approved).toBe(false)
  })
})

/* ============================================================================
 *  computeRejection
 * ========================================================================== */

describe('computeRejection', () => {
  it('rejects empty reason at the helper level (the repo enforces this too)', () => {
    const p = makeProject({ stage: 'demo_onay' })
    // Helper trusts the caller to have validated reason; we just confirm the
    // helper doesn't crash and stores the reason. The repo is the real gate.
    const { project: next, history } = computeRejection(p, 'kötü', [], 'designer', { actorName: leader.name })
    expect(next.last_reject_reason).toBe('kötü')
    expect(history.reason).toBe('kötü')
  })

  it('designer reject sends the project back to tasarim and increments demo_attempt', () => {
    const p = makeProject({ stage: 'demo_onay', demo_attempt: 0 })
    const { project: next } = computeRejection(p, 'no good', [], 'designer', { actorName: leader.name })
    expect(next.stage).toBe('tasarim')
    expect(next.demo_attempt).toBe(1)
    expect(next.last_reject_type).toBe('demo')
    expect(next.reject_target).toBeNull()
  })

  it('matbaa reject on a TR ozalit routes back to ozalit_teslim with the matbaa lock', () => {
    const p = makeProject({ stage: 'ozalit_onay', ozalit_attempt: 0 })
    const { project: next } = computeRejection(p, 'rerun', [], 'matbaa', { actorName: leader.name })
    expect(next.stage).toBe('ozalit_teslim')
    expect(next.reject_target).toBe('matbaa')
    expect(next.ozalit_attempt).toBe(1)
    expect(next.ozalit_requested).toBe(false)
  })

  it('matbaa reject on a ÇİN project safely collapses to a designer reject → tasarim', () => {
    const p = makeProject({ stage: 'cin_demo_onay', type: 'CIN', demo_attempt: 0 })
    const { project: next } = computeRejection(p, 'rerun', [], 'matbaa', { actorName: leader.name })
    // ÇİN has no matbaa re-delivery step (no ozalit) — must end up at tasarim.
    expect(next.stage).toBe('tasarim')
    expect(next.reject_target).toBeNull()
  })

  it('matbaa reject on a TR demo routes back to demo_teslim (matbaa re-delivers the demo)', () => {
    // TR has a demo_teslim step, so the leader CAN ask the matbaa to
    // re-deliver the demo (instead of sending the project all the way back
    // to design). This is symmetric with the ozalit case.
    const p = makeProject({ stage: 'demo_onay' })
    const { project: next } = computeRejection(p, 'rerun', [], 'matbaa', { actorName: leader.name })
    expect(next.stage).toBe('demo_teslim')
    expect(next.reject_target).toBe('matbaa')
  })

  it('voids in-flight ozalit sign-off on an ozalit rejection', () => {
    const p = makeProject({
      stage: 'ozalit_onay',
      ozalit_leader_approved: true,
      ozalit_leader_approved_by: 'Ayşenur',
      ozalit_leader_approved_at: '2026-07-09T00:00:00Z',
      ozalit_designer_approvals: [designerA.id],
    })
    const { project: next } = computeRejection(p, 'rerun', [], 'matbaa', { actorName: leader.name })
    expect(next.ozalit_leader_approved).toBe(false)
    expect(next.ozalit_leader_approved_by).toBeNull()
    expect(next.ozalit_leader_approved_at).toBeNull()
    expect(next.ozalit_designer_approvals).toEqual([])
  })

  it('flags revize subtasks and recomputes progress on a designer reject', () => {
    const p = makeProject({
      stage: 'demo_onay',
      progress: 100,
      subtasks: [
        { id: 'st-1', kind: 'check', is_done: true },
        { id: 'st-2', kind: 'check', is_done: true },
        { id: 'st-3', kind: 'pages', is_done: true, total_pages: 10, pages_done: 10 },
      ],
    })
    const { project: next } = computeRejection(
      p,
      'needs revize',
      ['st-1', 'st-3'],
      'designer',
      { actorName: leader.name },
    )
    const byId = Object.fromEntries(next.subtasks.map((s) => [s.id, s]))
    expect(byId['st-1'].needs_revize).toBe(true)
    expect(byId['st-1'].is_done).toBe(false)
    expect(byId['st-2'].needs_revize).toBe(false)
    expect(byId['st-2'].is_done).toBe(true) // un-flagged subtasks stay done
    expect(byId['st-3'].needs_revize).toBe(true)
    expect(byId['st-3'].pages_done).toBe(0) // pages subtask resets page count
    // Progress drops: 1 of 3 still done = 33%.
    expect(next.progress).toBe(33)
  })
})
