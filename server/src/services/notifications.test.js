import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSIGNMENT_GREETINGS, pickAssignmentGreeting,
  notifyProjectTransition, notifyDemoReceived, notifyOzalitReceived,
} from './notifications.js'

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

/* ==========================================================================
 *  Demo teslim → onay routing
 *
 *  The rule these guard: a notification must only ever name an action its
 *  recipient can actually take. Designers were being told "Demo onayınızı
 *  bekliyor" at demo_onay, but approval is the leader's (or matbaa's) call and
 *  is blocked anyway until someone marks "Teslim Alındı". Getting the audience
 *  wrong here is invisible in code review and obvious on a phone.
 * ======================================================================== */

const ROLE_USERS = { team_leader: ['u-ayse'], printer: ['u-oktay'], satis: ['u-esra'] }

/** Minimal pg-client stand-in: resolves roles, records every emitted row. */
function fakeClient() {
  const rows = []
  return {
    rows,
    async query(sql, params) {
      if (sql.includes('FROM users')) {
        const ids = (params[0] ?? []).flatMap((role) => ROLE_USERS[role] ?? [])
        return { rows: ids.map((id) => ({ id })) }
      }
      // emit()'s multi-row INSERT: 10 bound params per recipient, in the
      // column order declared there.
      for (let i = 0; i < params.length; i += 10) {
        rows.push({
          userId: params[i], type: params[i + 1], body: params[i + 3], tone: params[i + 4],
        })
      }
      return { rows: rows.map((r, i) => ({ id: `n-${i}`, user_id: r.userId })) }
    },
  }
}

const project = { id: 'p-1', title: 'KEÇEMİNO ÇİFTLİK', type: 'TR' }
const assignees = [{ id: 'u-aylin' }, { id: 'u-feyza' }]

test('a delivered demo asks for receipt, never for a designer\'s approval', async () => {
  const client = fakeClient()
  await notifyProjectTransition(client, {
    project, fromStage: 'demo_teslim', toStage: 'demo_onay', action: 'advance',
    actor: { id: 'u-oktay', name: 'Oktay' }, assignees,
  })
  assert.deepEqual(
    client.rows.map((r) => r.userId).sort(),
    ['u-aylin', 'u-ayse', 'u-feyza'],
    'leader + both assigned designers are told the demo arrived',
  )
  for (const r of client.rows) {
    assert.equal(r.type, 'demo_receipt_pending')
    assert.ok(!/onayınızı/.test(r.body), `named an action the recipient may not have: ${r.body}`)
  }
})

test('marking Teslim Alındı pings the other side, not the person who clicked', async () => {
  const client = fakeClient()
  await notifyDemoReceived(client, {
    project, actor: { id: 'u-aylin', name: 'Aylin' }, assignees,
  })
  const byUser = Object.fromEntries(client.rows.map((r) => [r.userId, r]))
  assert.ok(!('u-aylin' in byUser), 'the acknowledging designer must not ping themselves')
  // Only the leader is invited to act — the gate they were blocked on is open.
  assert.equal(byUser['u-ayse'].type, 'demo_approval_pending')
  assert.match(byUser['u-ayse'].body, /onayınızı bekliyor/)
  // A co-assigned designer is kept in the loop without being asked for anything.
  assert.equal(byUser['u-feyza'].type, 'demo_received')
  assert.ok(!/onayınızı/.test(byUser['u-feyza'].body))
})

test('a leader acknowledging tells the designers and nobody else', async () => {
  const client = fakeClient()
  await notifyDemoReceived(client, {
    project, actor: { id: 'u-ayse', name: 'Ayşenur' }, assignees,
  })
  assert.deepEqual(client.rows.map((r) => r.userId).sort(), ['u-aylin', 'u-feyza'])
  for (const r of client.rows) assert.equal(r.type, 'demo_received')
})

test('a held demo does not re-ask for the approval it just got', async () => {
  // approve at <100% keeps the stage put; the naive switch would fall into
  // `demo_onay` and re-send the pending-approval ping to everyone.
  const client = fakeClient()
  await notifyProjectTransition(client, {
    project, fromStage: 'demo_onay', toStage: 'demo_onay', action: 'approve',
    actor: { id: 'u-ayse', name: 'Ayşenur' }, assignees,
  })
  assert.deepEqual(client.rows.map((r) => r.userId).sort(), ['u-aylin', 'u-feyza'])
  for (const r of client.rows) {
    assert.equal(r.type, 'demo_held')
    assert.ok(!/bekliyor$/.test(r.body))
  }
})

/* ==========================================================================
 *  Ozalit teslim → onay routing (migration 035)
 *
 *  Same rule as the demo leg, one stage later: since ozalit approval is gated
 *  on "Teslim Alındı", the delivery ping must ask for receipt, and the approval
 *  ping only goes out once someone has acknowledged the physical proof.
 * ======================================================================== */

test('a delivered ozalit asks for receipt, not for an approval that is blocked', async () => {
  const client = fakeClient()
  await notifyProjectTransition(client, {
    project, fromStage: 'ozalit_teslim', toStage: 'ozalit_onay', action: 'advance',
    actor: { id: 'u-oktay', name: 'Oktay' }, assignees,
  })
  assert.deepEqual(
    client.rows.map((r) => r.userId).sort(),
    ['u-aylin', 'u-ayse', 'u-feyza'],
    'leader + both assigned designers are told the ozalit arrived',
  )
  for (const r of client.rows) {
    assert.equal(r.type, 'ozalit_receipt_pending')
    assert.ok(!/onayınızı/.test(r.body), `named an action the recipient may not have: ${r.body}`)
  }
})

test('acknowledging an ozalit asks everyone who must sign off — except the clicker', async () => {
  // Ozalit onay is multi-party (every leader AND every assigned designer), so
  // unlike the demo there is no leader-only split here.
  const client = fakeClient()
  await notifyOzalitReceived(client, {
    project, actor: { id: 'u-aylin', name: 'Aylin' }, assignees,
  })
  assert.deepEqual(client.rows.map((r) => r.userId).sort(), ['u-ayse', 'u-feyza'])
  for (const r of client.rows) {
    assert.equal(r.type, 'ozalit_approval_pending')
    assert.match(r.body, /onayınızı bekliyor/)
  }
})

test('a ÇİN demo approval reaches the designers who drew it', async () => {
  // cin_demo_onay → uretime_hazir is the ÇİN pipeline's "approved" moment;
  // there is no ozalit leg to carry the news.
  const client = fakeClient()
  await notifyProjectTransition(client, {
    project: { ...project, type: 'CIN' }, fromStage: 'cin_demo_onay', toStage: 'uretime_hazir',
    action: 'approve', actor: { id: 'u-ayse', name: 'Ayşenur' }, assignees,
  })
  const recipients = client.rows.map((r) => r.userId)
  assert.ok(recipients.includes('u-aylin') && recipients.includes('u-feyza'))
  assert.ok(recipients.includes('u-oktay'), 'matbaa still gets its queue')
})
