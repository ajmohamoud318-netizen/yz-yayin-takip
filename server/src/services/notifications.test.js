import test from 'node:test'
import assert from 'node:assert/strict'
import { ASSIGNMENT_GREETINGS, pickAssignmentGreeting } from './notifications.js'

/**
 * Assignment greeting copy tests.
 *
 * These guard the constraints that aren't obvious when someone adds a line to
 * the list months from now: length (iOS truncates the lock-screen body), and
 * the fact that the picker must never return undefined — an empty body ships
 * a blank notification banner, which looks broken rather than merely dull.
 */

test('every greeting is present, trimmed, and lock-screen sized', () => {
  assert.ok(ASSIGNMENT_GREETINGS.length >= 5, 'need enough variety to not repeat quickly')
  for (const g of ASSIGNMENT_GREETINGS) {
    assert.equal(typeof g, 'string')
    assert.ok(g.length > 0, 'no empty greeting')
    assert.equal(g, g.trim(), `leading/trailing space in: ${g}`)
    // ~45 chars is roughly two short lines on an iPhone lock screen before
    // iOS truncates with an ellipsis and eats the punchline.
    assert.ok([...g].length <= 45, `too long (${[...g].length} chars): ${g}`)
  }
})

test('greetings are unique', () => {
  assert.equal(new Set(ASSIGNMENT_GREETINGS).size, ASSIGNMENT_GREETINGS.length)
})

test('no greeting repeats the project title placeholder or looks templated', () => {
  // The title already renders directly above the body; a greeting containing
  // a template slot means someone expected interpolation that never happens.
  for (const g of ASSIGNMENT_GREETINGS) {
    assert.ok(!/\$\{|\{\{|%s/.test(g), `looks like an uninterpolated template: ${g}`)
  }
})

test('pickAssignmentGreeting always returns a real greeting', () => {
  for (const r of [0, 0.5, 0.999999]) {
    assert.ok(ASSIGNMENT_GREETINGS.includes(pickAssignmentGreeting(() => r)))
  }
})

test('pickAssignmentGreeting survives an out-of-range random source', () => {
  // Math.random() never returns 1, but a stubbed or buggy source might —
  // and indexing past the end would emit an empty notification body.
  assert.ok(ASSIGNMENT_GREETINGS.includes(pickAssignmentGreeting(() => 1)))
  assert.ok(ASSIGNMENT_GREETINGS.includes(pickAssignmentGreeting(() => -0.3)))
})

test('the picker actually varies across many draws', () => {
  const seen = new Set()
  for (let i = 0; i < 400; i += 1) seen.add(pickAssignmentGreeting())
  assert.ok(seen.size > 1, 'picker returned a constant — randomness is not wired up')
})
