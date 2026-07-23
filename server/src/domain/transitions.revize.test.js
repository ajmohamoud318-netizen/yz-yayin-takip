/**
 * Reject-to-designer revise rules (computeRejection + applyRevize).
 *
 * Guards the fix for the "phantom 100%" bug: rejecting an incomplete demo used
 * to force every un-flagged subtask to done, inflating progress. The rule now:
 *   • flagged (done) subtasks reopen for rework,
 *   • un-flagged subtasks keep their real state,
 *   • incomplete work stays incomplete — never force-completed.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeRejection } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }

function projectWith(subtasks) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_onay',
    demo_attempt: 0, ozalit_attempt: 0,
    reject_target: null, ozalit_requested: false,
    subtasks,
  }
}

const ctx = { actorName: leader.name, actor: leader }

describe('computeRejection — revise rules', () => {
  it('flagging a done subtask keeps it complete (progress NOT reduced); undone stays undone', () => {
    const project = projectWith([
      { id: 's1', kind: 'check', is_done: true, done_at: '2026-01-01T00:00:00Z' },
      { id: 's2', kind: 'check', is_done: false, done_at: null },
    ])
    const { project: next } = computeRejection(project, 'kapak revize', ['s1'], 'designer', ctx)

    const s1 = next.subtasks.find((s) => s.id === 's1')
    const s2 = next.subtasks.find((s) => s.id === 's2')
    assert.equal(s1.needs_revize, true)    // flagged for revision
    assert.equal(s1.is_done, true)         // but stays complete — progress preserved
    assert.equal(s2.is_done, false)        // undone → unchanged
    assert.equal(next.stage, 'tasarim')
    assert.equal(next.progress, 50)        // 1/2 done — unchanged by the flag
    assert.equal(next.demo_attempt, 1)     // attempt counter bumped
  })

  it('rejecting with zero selections preserves every subtask (just send it back)', () => {
    const project = projectWith([
      { id: 's1', kind: 'check', is_done: true, done_at: '2026-01-01T00:00:00Z' },
      { id: 's2', kind: 'check', is_done: false, done_at: null },
    ])
    const { project: next } = computeRejection(project, 'tekrar bak', [], 'designer', ctx)

    assert.equal(next.subtasks.find((s) => s.id === 's1').is_done, true)   // stays done
    assert.equal(next.subtasks.find((s) => s.id === 's2').is_done, false)  // stays undone
    assert.equal(next.progress, 50)  // 1/2 — would have been 100 under the old force-done bug
  })
})
