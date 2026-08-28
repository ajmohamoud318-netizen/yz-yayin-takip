import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSIGNMENT_GREETINGS, pickAssignmentGreeting,
  notifyProjectTransition, notifyDemoReceived, notifyOzalitReceived,
  notifyBaskiOnayPrepared,
  notifyDemoStarted, notifyOzalitStarted, notifyDemoCancelled, notifyOzalitCancelled,
  notifyDemoChangeRequested, notifyOzalitChangeRequested,
  notifyDemoChangeAccepted, notifyDemoChangeDeclined,
  notifyOzalitChangeAccepted, notifyOzalitChangeDeclined,
  notifyOrderTransition,
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
      // Event store INSERT (migration 058): domain_events table.
      // Return a dummy row so emit() gets an event id for SSE signalling.
      if (sql.includes('INTO domain_events')) {
        return { rows: [{ id: 'ev-1', created_at: new Date() }] }
      }
      // emit()'s multi-row INSERT: 10 bound params per recipient, in the
      // column order declared there.
      const prevCount = rows.length
      for (let i = 0; i < params.length; i += 10) {
        rows.push({
          userId: params[i], type: params[i + 1], title: params[i + 2],
          body: params[i + 3], tone: params[i + 4],
        })
      }
      return { rows: rows.slice(prevCount).map((r, i) => ({ id: `n-${prevCount + i}`, user_id: r.userId })) }
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

test('a receipt notification leads with the person, then the book', async () => {
  // The whole news of these two events is WHO acted, and the title is the line
  // a phone shows first — so it holds the name, and the book sits in the body
  // where nothing truncates it. Reads "Aylin / «kitap» demoyu teslim aldı".
  const client = fakeClient()
  await notifyDemoReceived(client, { project, actor: { id: 'u-aylin', name: 'Aylin' }, assignees })
  await notifyOzalitReceived(client, { project, actor: { id: 'u-aylin', name: 'Aylin' }, assignees })
  for (const r of client.rows) {
    assert.equal(r.title, 'Aylin', `title must be the actor, got: ${r.title}`)
    assert.ok(r.body.startsWith(project.title), `body must open with the book: ${r.body}`)
    assert.ok(!r.body.includes('Aylin'), `name repeated in the body: ${r.body}`)
  }
})

test('an unnamed actor still produces a readable receipt notification', async () => {
  // actor.name is optional on the route's user object; a missing one must not
  // ship a blank bold line ("" renders as the app name in the push payload).
  const client = fakeClient()
  await notifyDemoReceived(client, { project, actor: { id: 'u-x' }, assignees })
  for (const r of client.rows) assert.equal(r.title, 'Ekipten biri')
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

test('acknowledging an ozalit asks the leader first, designers only for info', async () => {
  // Ozalit onay is multi-party but leader-first: at receipt time a designer
  // still cannot approve, so telling them "onayınızı bekliyor" would name an
  // action the server refuses. Same split as the demo leg.
  const client = fakeClient()
  await notifyOzalitReceived(client, {
    project, actor: { id: 'u-aylin', name: 'Aylin' }, assignees,
  })
  const byUser = Object.fromEntries(client.rows.map((r) => [r.userId, r]))
  assert.ok(!('u-aylin' in byUser), 'the acknowledging designer must not ping themselves')
  assert.equal(byUser['u-ayse'].type, 'ozalit_approval_pending')
  assert.match(byUser['u-ayse'].body, /onayınızı bekliyor/)
  assert.equal(byUser['u-feyza'].type, 'ozalit_received')
  assert.ok(!/onayınızı/.test(byUser['u-feyza'].body))
})

test('a leader ozalit sign-off is the designers\' cue, not a re-run of the delivery ping', async () => {
  // Partial approval keeps the stage put (from === to). The naive switch would
  // fall into `ozalit_onay` and re-announce "matbaa teslim etti" to people who
  // already took delivery; what they actually need is "your turn".
  const client = fakeClient()
  await notifyProjectTransition(client, {
    project: { ...project, ozalit_approvals: [{ id: 'u-ayse', role: 'team_leader' }] },
    fromStage: 'ozalit_onay', toStage: 'ozalit_onay', action: 'approve',
    actor: { id: 'u-ayse', name: 'Ayşenur' }, assignees,
  })
  assert.deepEqual(client.rows.map((r) => r.userId).sort(), ['u-aylin', 'u-feyza'])
  for (const r of client.rows) {
    assert.equal(r.type, 'ozalit_approval_pending')
    assert.match(r.body, /onayladı, onayınız bekleniyor/)
  }
})

test('an approver who already signed is not asked again on the next sign-off', async () => {
  const client = fakeClient()
  await notifyProjectTransition(client, {
    project: {
      ...project,
      ozalit_approvals: [{ id: 'u-ayse', role: 'team_leader' }, { id: 'u-aylin', role: 'designer' }],
    },
    fromStage: 'ozalit_onay', toStage: 'ozalit_onay', action: 'approve',
    actor: { id: 'u-aylin', name: 'Aylin' }, assignees,
  })
  assert.deepEqual(client.rows.map((r) => r.userId), ['u-feyza'])
})

/* ==========================================================================
 *  Baskı Onay Formu — dual-approval (migration 045)
 *
 *  Two distinct events, two distinct audiences: everyone signing off on
 *  ozalit lands the project on `baski_onay` and every active leader is asked
 *  to PREPARE the form; once someone does, only the OTHER active leaders are
 *  asked to APPROVE it — the preparer already knows they did it.
 * ======================================================================== */

test('everyone finishing ozalit asks every active leader to prepare the form', async () => {
  const client = fakeClient()
  await notifyProjectTransition(client, {
    project, fromStage: 'ozalit_onay', toStage: 'baski_onay', action: 'approve',
    actor: { id: 'u-aylin', name: 'Aylin' }, assignees,
  })
  assert.deepEqual(client.rows.map((r) => r.userId), ['u-ayse'])
  assert.equal(client.rows[0].type, 'baski_onay_pending')
  assert.match(client.rows[0].body, /hazırlanması bekleniyor/)
})

test('preparing the form asks the OTHER active leaders, not the preparer', async () => {
  const client = fakeClient()
  await notifyBaskiOnayPrepared(client, {
    project, actor: { id: 'u-ayse', name: 'Ayşenur' },
    teamLeaderIds: ['u-ayse', 'u-serpil'],
  })
  assert.deepEqual(client.rows.map((r) => r.userId), ['u-serpil'])
  assert.equal(client.rows[0].type, 'baski_onay_prepared')
  assert.equal(client.rows[0].title, 'Ayşenur', 'receipt-style: person in the title, book in the body')
  assert.match(client.rows[0].body, /onayınız bekleniyor/)
})

test('preparing the form as the only active leader pings nobody (no error)', async () => {
  const client = fakeClient()
  const count = await notifyBaskiOnayPrepared(client, {
    project, actor: { id: 'u-ayse', name: 'Ayşenur' },
    teamLeaderIds: ['u-ayse'],
  })
  assert.equal(count, 0)
  assert.deepEqual(client.rows, [])
})

test('a ÇİN demo approval pings leaders to prepare the print-approval form', async () => {
  // Migration 047: cin_demo_onay → cin_baski_onay, mirroring TR's
  // ozalit_onay → baski_onay — a team leader must prepare/approve the print
  // spec before the project is actually in print, same as TR. Approved by
  // the printer here (canApproveAt allows it at cin_demo_onay) so the sole
  // team_leader fixture isn't the actor — otherwise emit()'s actor-drop
  // would leave the leader recipient list empty and the test couldn't tell
  // "no recipients" apart from "correctly not notifying designers yet".
  const client = fakeClient()
  await notifyProjectTransition(client, {
    project: { ...project, type: 'CIN' }, fromStage: 'cin_demo_onay', toStage: 'cin_baski_onay',
    action: 'approve', actor: { id: 'u-oktay', name: 'Oktay' }, assignees,
  })
  const recipients = client.rows.map((r) => r.userId)
  assert.ok(!recipients.includes('u-aylin') && !recipients.includes('u-feyza'), 'not a designer action yet')
  assert.ok(recipients.includes('u-ayse'), 'the team leader is told to prepare the form')
  assert.match(client.rows[0].body, /Demo onaylandı/)
})

test('a ÇİN project reaching baskida notifies the designers who drew it AND matbaa', async () => {
  // cin_baski_onay → baskida is the ÇİN pipeline's "your book cleared the
  // print gate" moment; there is no ozalit leg to carry the news earlier.
  const client = fakeClient()
  await notifyProjectTransition(client, {
    project: { ...project, type: 'CIN' }, fromStage: 'cin_baski_onay', toStage: 'baskida',
    action: 'approve', actor: { id: 'u-ayse', name: 'Ayşenur' }, assignees,
  })
  const recipients = client.rows.map((r) => r.userId)
  assert.ok(recipients.includes('u-aylin') && recipients.includes('u-feyza'))
  assert.ok(recipients.includes('u-oktay'), 'matbaa gets notified it is baskıda directly')
})

/* ==========================================================================
 *  Matbaa "Başladım" gate + cancel + change-request (migration 048)
 * ======================================================================== */

test('cancelling a demo/ozalit request tells the matbaa their pending work is gone', async () => {
  const client = fakeClient()
  await notifyDemoCancelled(client, { project, actor: { id: 'u-ayse', name: 'Ayşenur' } })
  assert.deepEqual(client.rows.map((r) => r.userId), ['u-oktay'])
  assert.equal(client.rows[0].type, 'demo_cancelled')
  assert.match(client.rows[0].body, /iptal edildi/)
  assert.ok(!client.rows[0].body.includes('—'), 'Turkish copy joins with a comma, not an em-dash')

  const client2 = fakeClient()
  await notifyOzalitCancelled(client2, { project, actor: { id: 'u-ayse', name: 'Ayşenur' } })
  assert.deepEqual(client2.rows.map((r) => r.userId), ['u-oktay'])
  assert.equal(client2.rows[0].type, 'ozalit_cancelled')
})

test('"Başladım" tells the leader + assigned designers, not the printer who clicked', async () => {
  const client = fakeClient()
  await notifyDemoStarted(client, { project, actor: { id: 'u-oktay', name: 'Oktay' }, assignees })
  assert.deepEqual(
    client.rows.map((r) => r.userId).sort(),
    ['u-aylin', 'u-ayse', 'u-feyza'],
  )
  for (const r of client.rows) assert.equal(r.type, 'demo_started')
})

test('a change-request asks the printers, not the leader/designer set', async () => {
  const client = fakeClient()
  await notifyDemoChangeRequested(client, {
    project, actor: { id: 'u-ayse', name: 'Ayşenur' }, note: 'renk yanlış',
  })
  assert.deepEqual(client.rows.map((r) => r.userId), ['u-oktay'])
  assert.equal(client.rows[0].type, 'demo_change_requested')
  assert.equal(client.rows[0].title, 'Ayşenur')
  assert.match(client.rows[0].body, /renk yanlış/)
  assert.ok(!client.rows[0].body.includes('—'), 'Turkish copy joins with a comma, not an em-dash')
})

test('change-request accept/decline tell the leader + designers the outcome', async () => {
  const acceptClient = fakeClient()
  await notifyDemoChangeAccepted(acceptClient, { project, actor: { id: 'u-oktay', name: 'Oktay' }, assignees })
  assert.deepEqual(acceptClient.rows.map((r) => r.userId).sort(), ['u-aylin', 'u-ayse', 'u-feyza'])
  assert.equal(acceptClient.rows[0].type, 'demo_change_accepted')

  const declineClient = fakeClient()
  await notifyDemoChangeDeclined(declineClient, { project, actor: { id: 'u-oktay', name: 'Oktay' }, assignees })
  assert.deepEqual(declineClient.rows.map((r) => r.userId).sort(), ['u-aylin', 'u-ayse', 'u-feyza'])
  assert.equal(declineClient.rows[0].type, 'demo_change_declined')
})

test('ozalit change-request mirrors the demo leg', async () => {
  const client = fakeClient()
  await notifyOzalitChangeRequested(client, { project, actor: { id: 'u-ayse', name: 'Ayşenur' } })
  assert.deepEqual(client.rows.map((r) => r.userId), ['u-oktay'])
  assert.equal(client.rows[0].type, 'ozalit_change_requested')

  const acceptClient = fakeClient()
  await notifyOzalitChangeAccepted(acceptClient, { project, actor: { id: 'u-oktay', name: 'Oktay' }, assignees })
  assert.equal(acceptClient.rows[0].type, 'ozalit_change_accepted')

  const declineClient = fakeClient()
  await notifyOzalitChangeDeclined(declineClient, { project, actor: { id: 'u-oktay', name: 'Oktay' }, assignees })
  assert.equal(declineClient.rows[0].type, 'ozalit_change_declined')
})

test('"Ozalit Başladım" tells the leader + assigned designers', async () => {
  const client = fakeClient()
  await notifyOzalitStarted(client, { project, actor: { id: 'u-oktay', name: 'Oktay' }, assignees })
  assert.deepEqual(
    client.rows.map((r) => r.userId).sort(),
    ['u-aylin', 'u-ayse', 'u-feyza'],
  )
  for (const r of client.rows) assert.equal(r.type, 'ozalit_started')
})

/* ==========================================================================
 *  Order-step notification tones
 *
 *  `notifications.tone` is a CHECK constraint (migration 022), not a free
 *  text column. A tone outside its five values doesn't degrade to a default
 *  colour — it fails the INSERT inside `emit`, which runs in the SAME
 *  transaction as the status change that called it. The whole advance rolls
 *  back and the client gets a bare 500.
 *
 *  ORDER_STEP_TONE carried 'violet' for siparis_baski_onay and did exactly
 *  that to every advance into that step. Nothing caught it because `emit`
 *  short-circuits when the actor is the only recipient, so a dev DB with one
 *  team leader never reaches the INSERT — the actor below is deliberately in
 *  no role list so every step really emits.
 * ======================================================================== */

// Mirrors migration 022's CHECK. Update both together or neither.
const ALLOWED_TONES = ['amber', 'green', 'rose', 'blue', 'pink']

test('every order step emits a tone the notifications CHECK accepts', async () => {
  const steps = [
    'pending', 'goruldu', 'tasarimci_onay', 'ekran_onay',
    'matbaa_onay', 'siparis_baski_onay', 'onaylandi',
  ]
  for (const newStatus of steps) {
    const client = fakeClient()
    await notifyOrderTransition(client, {
      order: { id: 'o-1', project_id: 'p-1' },
      project,
      newStatus,
      actor: { id: 'u-nobody', name: 'Biri' },
      requesterId: 'u-esra',
      assigneeIds: ['u-aylin'],
    })
    assert.ok(client.rows.length > 0, `${newStatus} emitted nothing — the tone was never exercised`)
    for (const r of client.rows) {
      assert.ok(
        ALLOWED_TONES.includes(r.tone),
        `${newStatus} emits tone "${r.tone}", which violates notifications_tone_check`,
      )
    }
  }
})
