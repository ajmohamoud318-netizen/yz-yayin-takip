/**
 * POST /approve at a stage with no approval gate.
 *
 * The generic fallback at the bottom of computeApproval pushed the project one
 * stage on for ANY caller — no role check — so a satış or matbaa account could
 * approve a Baskıda project straight onto Satışta, skipping the teslim, or move
 * a 40% design out of Tasarım. Those stages move by advance or by the teslim
 * confirm; an approval there has nothing to decide.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeApproval } from './transitions.js'

const ACTORS = [
  { id: 'L1', role: 'team_leader', name: 'Ayşenur' },
  { id: 'P1', role: 'printer', name: 'Oktay' },
  { id: 'S1', role: 'satis', name: 'Esra' },
  { id: 'D1', role: 'designer', name: 'Aylin' },
]

const UNGATED = [
  ['TR', 'tasarim'], ['TR', 'baskida'], ['TR', 'satista'],
  ['CIN', 'tasarim'], ['CIN', 'baskida'], ['CIN', 'gumruk'],
]

describe('computeApproval — stages with nothing to approve', () => {
  for (const [type, stage] of UNGATED) {
    it(`refuses every role at ${type} ${stage}`, () => {
      for (const actor of ACTORS) {
        const project = { id: 'p1', type, stage, progress: 100 }
        assert.throws(
          () => computeApproval(project, actor, {}),
          /onaylanacak bir adım yok/,
          `${actor.role} must not move a project out of ${stage} by approving`,
        )
        assert.equal(project.stage, stage)
      }
    })
  }
})
