/**
 * Server-side transition tests.
 *
 * The server delegates to `server/src/domain/transitions.js`, which is
 * a deliberate mirror of
 * `client/src/infrastructure/mock/helpers/project-transitions.js`. The
 * deep branch coverage lives in the client's Vitest suite; this file
 * checks the thin adapter layer in
 * `server/src/services/project-transitions.js` — that it correctly
 * binds the shape Fastify routes hand in (user with `role` + `name`)
 * and doesn't drop fields on the way out.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyAdvance, applyApproval, applyRejection,
  applyDemoStart, applyOzalitStart, applyDemoCancel, applyOzalitCancel,
  applyDemoChangeRequest, applyOzalitChangeRequest,
  applyDemoChangeAccept, applyDemoChangeDecline, applyOzalitChangeAccept, applyOzalitChangeDecline,
} from './project-transitions.js'

const designer = { id: 'u-d', role: 'designer', name: 'Aylin' }
const printer = { id: 'u-p', role: 'printer', name: 'Oktay' }
const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }

function makeProject(overrides = {}) {
  return {
    id: 'p-test', type: 'TR', stage: 'tasarim', progress: 100,
    demo_attempt: 0, ozalit_attempt: 0,
    last_reject_reason: null, last_reject_type: null, reject_target: null,
    history: [], assignees: [{ id: designer.id, name: designer.name }],
    subtasks: [], ozalit_requested: false,
    ...overrides,
  }
}

describe('applyAdvance (server adapter)', () => {
  it('passes the actor through and returns a stage+history pair', () => {
    const { project, history } = applyAdvance(makeProject(), { user: designer })
    assert.equal(project.stage, 'demo_teslim')
    assert.equal(history?.to_stage, 'demo_teslim')
    assert.equal(history?.done_by_name, designer.name)
  })
})

describe('applyApproval (server adapter)', () => {
  it('routes through the printer-gated demo delivery step', () => {
    const { project } = applyApproval(
      makeProject({ stage: 'demo_teslim' }),
      { user: printer },
    )
    assert.equal(project.stage, 'demo_onay')
  })
})

describe('applyRejection (server adapter)', () => {
  it('throws 409 when the named stage is not the current one', () => {
    assert.throws(
      () => applyRejection(
        makeProject({ stage: 'demo_teslim' }),
        { user: leader, stage: 'demo_onay', reason: 'wrong stage' },
      ),
      /stage/,
    )
  })

  it('returns bounced-back state with bumped demo_attempt', () => {
    const { project } = applyRejection(
      makeProject({ stage: 'demo_onay', demo_attempt: 2 }),
      { user: leader, stage: 'demo_onay', reason: 'renkler marka dışı' },
    )
    assert.equal(project.stage, 'tasarim')
    assert.equal(project.demo_attempt, 3)
  })
})

describe('demo/ozalit "Başladım" + cancel + change-request adapters', () => {
  it('applyDemoStart/applyOzalitStart bind the printer through', () => {
    const { project: demoNext } = applyDemoStart(makeProject({ stage: 'demo_teslim' }), { user: printer })
    assert.equal(demoNext.demo_started, true)
    const { project: ozalitNext } = applyOzalitStart(
      makeProject({ stage: 'ozalit_teslim', ozalit_requested: true }), { user: printer },
    )
    assert.equal(ozalitNext.ozalit_started, true)
  })

  it('applyDemoCancel/applyOzalitCancel bind the (team-leader) actor through', () => {
    const { project: demoNext } = applyDemoCancel(
      makeProject({ stage: 'demo_teslim' }), { user: leader, designerIds: [designer.id] },
    )
    assert.equal(demoNext.stage, 'tasarim')
    const { project: ozalitNext } = applyOzalitCancel(
      makeProject({ stage: 'ozalit_teslim', ozalit_requested: true }),
      { user: leader, designerIds: [designer.id] },
    )
    assert.equal(ozalitNext.stage, 'tasarim')
  })

  it('applyDemoChangeRequest/applyOzalitChangeRequest bind the note through', () => {
    const { project: demoNext } = applyDemoChangeRequest(
      makeProject({ stage: 'demo_teslim', demo_started: true }),
      { user: leader, designerIds: [], note: 'renk yanlış' },
    )
    assert.equal(demoNext.demo_change_requested_note, 'renk yanlış')
    const { project: ozalitNext } = applyOzalitChangeRequest(
      makeProject({ stage: 'ozalit_teslim', ozalit_requested: true, ozalit_started: true }),
      { user: leader, designerIds: [], note: 'ölçü yanlış' },
    )
    assert.equal(ozalitNext.ozalit_change_requested_note, 'ölçü yanlış')
  })

  it('applyDemoChangeAccept/Decline and applyOzalitChangeAccept/Decline bind the printer through', () => {
    const started = makeProject({
      stage: 'demo_teslim', demo_started: true, demo_change_requested_at: '2026-01-01T00:00:00Z',
    })
    assert.equal(applyDemoChangeAccept(started, { user: printer }).project.demo_started, false)
    assert.equal(applyDemoChangeDecline(started, { user: printer }).project.demo_started, true)

    const ozalitStarted = makeProject({
      stage: 'ozalit_teslim', ozalit_requested: true,
      ozalit_started: true, ozalit_change_requested_at: '2026-01-01T00:00:00Z',
    })
    assert.equal(applyOzalitChangeAccept(ozalitStarted, { user: printer }).project.ozalit_started, false)
    assert.equal(applyOzalitChangeDecline(ozalitStarted, { user: printer }).project.ozalit_started, true)
  })
})

