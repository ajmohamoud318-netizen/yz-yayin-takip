/**
 * Server-side transition tests.
 *
 * The server delegates to the client's `project-transitions.js`, so
 * the deep branch coverage already lives in
 * `client/src/infrastructure/mock/helpers/project-transitions.test.js`.
 *
 * What this file covers: that the adapters in
 * `server/src/services/project-transitions.js` correctly bind the
 * shape Fastify routes hand in (user with `role` and `name`) and
 * don't drop fields on the way out. A single happy-path + a 409
 * stub is enough.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyAdvance, applyApproval, applyRejection } from './project-transitions.js'

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

