/**
 * Notifications service.
 *
 * The single place that decides WHO gets told WHAT when project / order /
 * handover state changes. Called from the transition routes inside the same
 * `withTx` client that wrote the `stage_history` row, so a notification is
 * committed iff the state change it describes is committed — no more
 * client-side diffing / guessing.
 *
 * Design:
 *  • `emit()` is the low-level primitive: fan a single event out to a set of
 *    recipient user ids (deduped, actor removed) as one row each.
 *  • The `notify*` helpers encode the role/assignment rules that used to live
 *    (twice, and drifting) in the client's NotificationSync + buildNotifications.
 *    Now they live here once, event-driven.
 *
 * Recipients are resolved against the CURRENT active user set, so a
 * deactivated user never accrues a feed and "all team leaders" always means
 * the live ones.
 */

import { loadProjectAssignees } from './project-repository.js'
import { ORDER_STEP_OWNER } from '../domain/orders.js'
import { getPool } from '../db/pool.js'
import { isPushEnabled, sendToRecipients } from './push.js'

/**
 * How many times a notification whose delivery keeps failing transiently is
 * retried before we give up and mark it pushed anyway.
 *
 * Delivery is best-effort by design — the bell feed is the source of truth and
 * is unaffected — so the only thing an unbounded retry buys is an ever-growing
 * pending set. Five attempts spans roughly a minute of sweeps, which covers a
 * push-service blip or a redeploy without chasing a genuinely broken device.
 */
export const PUSH_MAX_ATTEMPTS = 5

/** Active user ids for the given role(s). */
export async function activeUserIdsByRole(client, ...roles) {
  if (roles.length === 0) return []
  const { rows } = await client.query(
    `SELECT id FROM users WHERE role = ANY($1) AND is_active = TRUE`,
    [roles],
  )
  return rows.map((r) => r.id)
}

/**
 * Low-level fan-out. Inserts one notification row per recipient.
 *
 *  recipientIds  array of user ids (may contain dups / the actor / nulls —
 *                all are cleaned here)
 *  actorId       who caused the event; removed from recipients so you never
 *                get pinged for your own action
 *
 * Returns the number of rows written.
 */
export async function emit(client, {
  recipientIds = [],
  actorId = null,
  type,
  title = '',
  body = '',
  tone = 'blue',
  projectId = null,
  orderId = null,
  link = null,
}) {
  const clean = [...new Set(recipientIds.filter(Boolean))].filter((id) => id !== actorId)
  if (clean.length === 0) return 0

  // Delivery state (migration 034). When push is disabled server-side — the
  // local dev default, and any deploy without VAPID keys — nothing will ever
  // deliver these, so stamp them settled at insert time. Leaving them owed
  // would grow the `pushed_at IS NULL` partial index to cover the whole table
  // and give the sweeper a backlog it can never drain.
  const settledNow = isPushEnabled() ? null : new Date()

  // Multi-row parameterised insert: one ($n,…) tuple per recipient.
  const cols = '(user_id, type, title, body, tone, project_id, order_id, link, actor_id, pushed_at)'
  const tuples = []
  const values = []
  clean.forEach((uid, i) => {
    const b = i * 10
    tuples.push(
      `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`,
    )
    values.push(uid, type, title, body, tone, projectId, orderId, link, actorId, settledNow)
  })
  // RETURNING the recipient alongside the id: each row is a DISTINCT
  // notification and must be pushed under its OWN id, not the first one's.
  const { rows } = await client.query(
    `INSERT INTO notifications ${cols} VALUES ${tuples.join(',')} RETURNING id, user_id`,
    values,
  )

  // Deliver to registered devices as well as the in-app feed. Runs only
  // after the caller's transaction commits — see dispatchPush.
  dispatchPush(client, rows.map((r) => ({
    userId: r.user_id,
    notificationId: r.id,
    payload: { type, title, body, tone, link, projectId, notificationId: r.id },
  })))

  return clean.length
}

/**
 * Schedule web push for a just-inserted batch of notifications.
 *
 * Two properties this has to get right, and both are why it isn't just an
 * `await deliverBatch(...)` inline above:
 *
 *  1. It must not run inside the caller's transaction. `emit()` is called
 *     with the same client that wrote stage_history, mid-transaction. Awaiting
 *     an HTTPS round-trip to Apple/Google there would hold a Postgres
 *     transaction (and a pool connection) open for the duration — under
 *     concurrent teslim/onay traffic that exhausts the pool.
 *
 *  2. It must not push for a transaction that later rolls back. A push for an
 *     approval that never happened is worse than a missed one.
 *
 * `client.afterCommit` (see db/pool.js#withTx) satisfies both exactly: the
 * callback is queued now and invoked only once COMMIT succeeds, outside the
 * transaction.
 *
 * ⚠️ The obvious-looking alternative — `setImmediate` plus a "are the rows
 * visible yet?" probe — is WRONG and shipped broken once. `setImmediate`
 * fires on the next event-loop check phase, which arrives well before `fn`
 * resolves and COMMIT is issued, so the probe always found nothing and every
 * push for a real pipeline event was silently dropped. Only `/api/push/test`
 * worked, because it calls sendToUsers directly. Do not reintroduce timing
 * guesses here.
 *
 * When `emit` is called with a plain pool client (no transaction, e.g. from a
 * future non-transactional caller) there is nothing to wait for, so the send
 * is scheduled immediately.
 *
 * NOTE: "fire and forget" no longer means "and hope". The rows are written
 * with `pushed_at` NULL, so anything this hook fails to deliver — including
 * everything in flight when the container is stopped, which happens on every
 * deploy — is still owed and gets retried by `sweepPendingPushes`. See
 * migration 034.
 */
function dispatchPush(client, entries) {
  if (!isPushEnabled() || entries.length === 0) return
  const send = () => deliverBatch(entries)
  if (typeof client?.afterCommit === 'function') {
    client.afterCommit(send)
  } else {
    setImmediate(() => {
      Promise.resolve()
        .then(send)
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[notifications] push dispatch failed:', err?.message)
        })
    })
  }
}

/* --------------------------- delivery bookkeeping ------------------------- */

/**
 * Push a batch of notification rows and record what happened to each.
 *
 * This is the half of the outbox pattern that closes the loop: `emit` writes
 * rows with `pushed_at` NULL ("owed"), this marks them settled once a device
 * has them. If the process dies before this runs — which is exactly what a
 * redeploy does to any request in flight — the rows stay owed and
 * `sweepPendingPushes` picks them up on the next boot. Before migration 034
 * that push was simply lost, invisibly, because the bell still showed the
 * notification.
 *
 * Three outcomes per row, and the distinction is the whole point:
 *   • at least one device reached      → settled
 *   • no live device for the recipient → settled (nothing to deliver, ever)
 *   • every attempt failed transiently → still owed; the sweeper retries
 *
 * Never throws — the caller is a detached afterCommit hook.
 */
export async function deliverBatch(entries) {
  if (!isPushEnabled() || !entries || entries.length === 0) {
    return { delivered: 0, settled: 0, retry: 0 }
  }
  const { delivered, settled, retry } = classifyDelivery(await sendToRecipients(entries))

  await markPushed(settled)
  await recordPushAttempt(retry)
  return { delivered, settled: settled.length, retry: retry.length }
}

/**
 * Turn per-notification send stats into "settle it" / "retry it" buckets.
 *
 * Pure and exported because this three-way rule is the subtle part of the
 * outbox and the easy thing to get backwards:
 *
 *   • sent > 0        → at least one of the recipient's devices has it. Done.
 *                       (Partial success is still success — retrying to reach
 *                       the second device would re-buzz the first.)
 *   • transient > 0   → a network error / 429 / 5xx. The push is still owed;
 *                       leave the row pending so the sweeper tries again.
 *   • neither         → the recipient has no live device, or every device
 *                       returned 404/410. Nothing will ever deliver this, so
 *                       settling it is correct — retrying forever is how the
 *                       pending index turns into a full-table scan.
 *
 * Note the ordering: `sent > 0` wins even when some other device of the same
 * user failed transiently. Delivered once is delivered.
 */
export function classifyDelivery(results) {
  const settled = []
  const retry = []
  let delivered = 0
  for (const [id, stat] of results ?? []) {
    delivered += stat?.sent ?? 0
    if ((stat?.sent ?? 0) > 0 || (stat?.transient ?? 0) === 0) settled.push(id)
    else retry.push(id)
  }
  return { delivered, settled, retry }
}

/** Stamp rows as delivered (or as having nothing to deliver). Best-effort. */
async function markPushed(ids) {
  if (ids.length === 0) return
  try {
    await getPool().query(
      'UPDATE notifications SET pushed_at = NOW() WHERE id = ANY($1) AND pushed_at IS NULL',
      [ids],
    )
  } catch (err) {
    // Not fatal: the row stays owed and the sweeper retries. At-least-once —
    // a duplicate push collapses under the payload tag, a lost one doesn't.
    // eslint-disable-next-line no-console
    console.error('[notifications] mark-pushed failed:', err?.message)
  }
}

/**
 * Count a failed attempt, and give up once the cap is reached — the CASE arm
 * settles the row so a device that is permanently unreachable (but never
 * returns a clean 404/410) can't hold a slot in the pending index forever.
 */
async function recordPushAttempt(ids) {
  if (ids.length === 0) return
  try {
    await getPool().query(
      `UPDATE notifications
          SET push_attempts = push_attempts + 1,
              pushed_at = CASE WHEN push_attempts + 1 >= $2 THEN NOW() ELSE NULL END
        WHERE id = ANY($1) AND pushed_at IS NULL`,
      [ids, PUSH_MAX_ATTEMPTS],
    )
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notifications] attempt bookkeeping failed:', err?.message)
  }
}

/**
 * Retry every push still owed. Called on a timer by the maintenance loop.
 *
 * `minAgeSeconds` keeps the sweeper off rows the in-process dispatch is still
 * working on — without it, a slow Apple round-trip would be duplicated by a
 * sweep firing underneath it. Ten seconds is comfortably longer than a normal
 * send and short enough that a redeploy-dropped push arrives while it still
 * matters.
 */
export async function sweepPendingPushes({ minAgeSeconds = 10, limit = 200 } = {}) {
  if (!isPushEnabled()) return { delivered: 0, settled: 0, retry: 0 }
  let rows
  try {
    ({ rows } = await getPool().query(
      `SELECT id, user_id, type, title, body, tone, link, project_id
         FROM notifications
        WHERE pushed_at IS NULL
          AND created_at < NOW() - make_interval(secs => $1::int)
        ORDER BY created_at
        LIMIT $2`,
      [minAgeSeconds, limit],
    ))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notifications] sweep query failed:', err?.message)
    return { delivered: 0, settled: 0, retry: 0 }
  }
  if (rows.length === 0) return { delivered: 0, settled: 0, retry: 0 }

  return deliverBatch(rows.map((r) => ({
    userId: r.user_id,
    notificationId: r.id,
    payload: {
      type: r.type,
      title: r.title,
      body: r.body,
      tone: r.tone,
      link: r.link,
      projectId: r.project_id,
      notificationId: r.id,
    },
  })))
}

/* --------------------------- project pipeline ---------------------------- */

/**
 * Greetings for a fresh project assignment, picked at random.
 *
 * This is the only notification in the app that OPENS someone's work rather
 * than chasing it, so the copy is deliberately warmer than everything else
 * (the rest stay terse on purpose — "Ozalit teslimi bekleniyor" is a task,
 * not a greeting). Rotating the wording keeps it from going stale for people
 * who get assigned several books a month.
 *
 * Rules for anything added here:
 *  • Never repeat the project title — it is already the bold line directly
 *    above this text in both the bell and the phone lock screen.
 *  • Keep it under ~45 characters. iOS truncates the body to roughly two
 *    short lines on the lock screen, and the punchline must survive.
 *  • Warm, not cutesy. These go to colleagues at work, every single time.
 */
export const ASSIGNMENT_GREETINGS = Object.freeze([
  'Yeni proje sizde ✨ Hadi başlayalım!',
  'Yeni bir kitap sizi bekliyor 📚',
  'Bu kitap size emanet 📖',
  'Yeni proje elinizde, kolay gelsin! 💪',
  'Sıradaki kitap sizin, başarılar! 🌟',
  'Yeni bir sayfa açılıyor ✨',
  'Taze bir proje geldi, sıra sizde! 🎨',
  'Yeni bir tasarım başlıyor ✏️',
  'Güzel işler çıkaralım! 🎯',
  'Yeni proje hazır, ilham dolu olsun 🌱',
])

/** Pick one greeting. Exported so tests can stub the randomness. */
export function pickAssignmentGreeting(rand = Math.random) {
  const i = Math.floor(rand() * ASSIGNMENT_GREETINGS.length)
  // Guard the edges: a rand() that returns exactly 1 (or anything out of
  // range) would index past the end and emit an empty notification body.
  return ASSIGNMENT_GREETINGS[Math.min(Math.max(i, 0), ASSIGNMENT_GREETINGS.length - 1)]
}

/**
 * New project created → tell the assigned designer(s).
 *
 * The greeting is chosen once, here, and stored on the notification row — so
 * it stays put across refreshes and matches whatever the push already
 * delivered. Picking at render time instead would make the same notification
 * say something different every poll.
 */
export async function notifyProjectCreated(client, { project, actor, assignees }) {
  const designerIds = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  return emit(client, {
    recipientIds: designerIds,
    actorId: actor?.id,
    type: 'assignment',
    title: project.title,
    body: pickAssignmentGreeting(),
    tone: 'green',
    projectId: project.id,
    link: `/projects/${project.id}`,
  })
}

/**
 * A delivered demo was just marked "Teslim Alındı" (received).
 *
 * Not a stage transition — the project stays at demo_onay — so it can't ride
 * notifyProjectTransition, but it's the event that unblocks the approval, and
 * until now it was silent: whoever didn't click stayed unaware the gate had
 * opened. Either the team leader or an assigned designer can acknowledge, so
 * we fan out to both sides and let emit() drop the actor — "whoever marked it,
 * the other one hears about it".
 *
 * The two sides get different copy on purpose: the leader is the only one who
 * can act on it now (approval is theirs alone at this stage), the designers
 * are just being kept in the loop.
 *
 * ⚠️ Unlike every other notification, the bold `title` line here is the PERSON,
 * not the book — "Aylin / «Kitap» demoyu teslim aldı". These two events are the
 * only ones whose news is *who acted*, and the first thing a phone shows is the
 * title, so leading with the project buried the answer one line down. The book
 * moves into the body, which nothing truncates — long titles survive intact.
 */
export async function notifyDemoReceived(client, { project, actor, assignees }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const who = actor?.name ?? 'Ekipten biri'
  const base = {
    actorId: actor?.id, title: who, projectId: project.id, link: `/projects/${project.id}`,
  }
  const a = await emit(client, {
    ...base, recipientIds: leaders, type: 'demo_approval_pending', tone: 'amber',
    body: `${project.title} demoyu teslim aldı, onayınızı bekliyor`,
  })
  const b = await emit(client, {
    ...base, recipientIds: designers, type: 'demo_received', tone: 'blue',
    body: `${project.title} demoyu teslim aldı, onay bekleniyor`,
  })
  return a + b
}

/**
 * A delivered ozalit was just marked "Teslim Alındı" (received) — the ozalit
 * twin of notifyDemoReceived (migration 035).
 *
 * Ozalit approval is multi-party, but leader-first: acknowledging the proof
 * unblocks the team leaders only, and the assigned designers counter-sign after
 * one of them approves (computeOzalitOnayApproval). So this takes the same
 * split as the demo — leaders are asked to act, designers are kept in the loop
 * — and the designers' "your turn" ping comes later, from the partial-approval
 * branch of notifyProjectTransition. emit() drops the actor, so whoever clicked
 * doesn't get told about their own click.
 */
export async function notifyOzalitReceived(client, { project, actor, assignees }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const who = actor?.name ?? 'Ekipten biri'
  const base = {
    // Person as the title, book in the body — see notifyDemoReceived.
    actorId: actor?.id, title: who, projectId: project.id, link: `/projects/${project.id}`,
  }
  const a = await emit(client, {
    ...base, recipientIds: leaders, type: 'ozalit_approval_pending', tone: 'amber',
    body: `${project.title} ozaliti teslim aldı, onayınızı bekliyor`,
  })
  const b = await emit(client, {
    ...base, recipientIds: designers, type: 'ozalit_received', tone: 'blue',
    body: `${project.title} ozaliti teslim aldı, ekip lideri onayı bekleniyor`,
  })
  return a + b
}

/**
 * The Baskı Onay Formu was just marked "hazırlandı" (prepared) — the maker
 * half of migration 045's dual-approval pair. Only the OTHER active team
 * leaders are told an approval is now owed; the preparer isn't (emit()
 * drops the actor via actorId), and there are no designers/printers in this
 * loop — the checker step is team_leader-only, same as the preparer step.
 */
export async function notifyBaskiOnayPrepared(client, { project, actor, teamLeaderIds }) {
  const leaders = teamLeaderIds ?? (await activeUserIdsByRole(client, 'team_leader'))
  const who = actor?.name ?? 'Ekipten biri'
  return emit(client, {
    actorId: actor?.id, title: who, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: leaders, type: 'baski_onay_prepared', tone: 'amber',
    body: `${project.title} için baskı onay formunu hazırladı, onayınız bekleniyor`,
  })
}

/**
 * A project pipeline transition (advance / approve / reject) just committed.
 * `toStage` / `fromStage` / `action` come straight from the history row the
 * route already built. We map the resulting state to the people who now need
 * to know — and skip the actor.
 *
 * `assignees` may be passed by callers that already loaded it (advance /
 * approve / receive routes do); otherwise we resolve it here (reject route).
 */
export async function notifyProjectTransition(client, {
  project, fromStage, toStage, action, actor, assignees,
}) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const printers = await activeUserIdsByRole(client, 'printer')
  const sales = await activeUserIdsByRole(client, 'satis')
  const base = { actorId: actor?.id, title: project.title, projectId: project.id }

  // Rejection back to Tasarım → the designer has to rework.
  if (action === 'reject' && toStage === 'tasarim') {
    return emit(client, {
      ...base, recipientIds: designers, type: 'rejection', tone: 'rose',
      body: 'Revizyon gerekiyor, tasarıma geri döndü', link: `/projects/${project.id}`,
    })
  }

  // Demo approved but HELD: the leader signed off at <100% progress, so the
  // stage doesn't move and a second demo is owed once the design is finished.
  // Caught before the switch because from === to here — falling through to
  // `demo_onay` would re-send "waiting for your approval" to the very people
  // who have nothing left to approve.
  if (action === 'approve' && toStage === fromStage &&
      (toStage === 'demo_onay' || toStage === 'cin_demo_onay')) {
    return emit(client, {
      ...base, recipientIds: designers, type: 'demo_held', tone: 'amber',
      body: 'Demo onaylandı, tasarım bitince demo gerekiyor', link: `/projects/${project.id}`,
    })
  }

  // One party signed off on the ozalit but the round isn't complete, so the
  // stage stays put (from === to). Caught before the switch for the same reason
  // as the held demo above: `case 'ozalit_onay'` would re-announce the matbaa's
  // delivery to a room that has already taken delivery of it. Whoever still
  // owes an approval is asked for it — and since approval is leader-first, a
  // leader's sign-off is exactly what turns this into the designers' cue.
  if (action === 'approve' && toStage === fromStage && toStage === 'ozalit_onay') {
    const approved = new Set((project.ozalit_approvals ?? []).map((a) => a.id))
    const pending = [...leaders, ...designers].filter((id) => !approved.has(id))
    return emit(client, {
      ...base, recipientIds: pending, type: 'ozalit_approval_pending', tone: 'amber',
      body: `${actor?.name ?? 'Ekipten biri'} ozaliti onayladı, onayınız bekleniyor`,
      link: `/projects/${project.id}`,
    })
  }

  switch (toStage) {
    // Matbaa must deliver the requested demo.
    case 'demo_teslim':
    case 'cin_demo_teslim':
      return emit(client, {
        ...base, recipientIds: printers, type: 'demo_delivery_pending', tone: 'blue',
        body: 'Demo teslimi bekleniyor', link: `/projects/${project.id}`,
      })

    // Matbaa delivered the demo. NOT an approval ping: nobody can approve yet
    // — computeApproval refuses until the delivery is marked "Teslim Alındı",
    // and that acknowledgement is the leader's OR an assigned designer's to
    // give. Telling a designer "your approval is awaited" named an action they
    // don't have; the approval ping is sent later, by notifyDemoReceived().
    case 'demo_onay':
    case 'cin_demo_onay':
      return emit(client, {
        ...base, recipientIds: [...leaders, ...designers], type: 'demo_receipt_pending', tone: 'amber',
        body: 'Matbaa demoyu teslim etti, "Teslim Alındı" bekleniyor', link: `/projects/${project.id}`,
      })

    // Reaching ozalit_teslim: either the demo was just approved (designer may
    // now request ozalit), the designer requested ozalit (matbaa must
    // deliver), or a reject/not-received sent it back locked to the matbaa
    // for redelivery (no fresh request needed — same as demo's teslim case).
    case 'ozalit_teslim':
      if (project.ozalit_requested || project.reject_target === 'matbaa') {
        return emit(client, {
          ...base, recipientIds: printers, type: 'ozalit_delivery_pending', tone: 'blue',
          body: 'Ozalit teslimi bekleniyor', link: `/projects/${project.id}`,
        })
      }
      return emit(client, {
        ...base, recipientIds: designers, type: 'ozalit_requestable', tone: 'blue',
        body: 'Demo onaylandı, ozalit isteyebilirsiniz', link: `/projects/${project.id}`,
      })

    // Matbaa delivered the ozalit. Like the demo case above, this is NOT an
    // approval ping: since migration 035 computeOzalitOnayApproval refuses
    // until the proof is marked "Teslim Alındı". The approval ping follows
    // from notifyOzalitReceived once someone acknowledges it.
    case 'ozalit_onay':
      return emit(client, {
        ...base, recipientIds: [...leaders, ...designers], type: 'ozalit_receipt_pending', tone: 'amber',
        body: 'Matbaa ozaliti teslim etti, "Teslim Alındı" bekleniyor', link: `/projects/${project.id}`,
      })

    // Everyone signed off on the ozalit (TR) / the demo (ÇİN, migration 047's
    // cin_baski_onay mirror gate) — a team leader now needs to PREPARE the
    // Baskı Onay Formu (migration 045's maker half); every active leader is
    // told, since any one of them may do it.
    case 'baski_onay':
    case 'cin_baski_onay':
      return emit(client, {
        ...base, recipientIds: leaders, type: 'baski_onay_pending', tone: 'amber',
        body: toStage === 'cin_baski_onay'
          ? 'Demo onaylandı, baskı onay formu hazırlanması bekleniyor'
          : 'Ozalit onaylandı, baskı onay formu hazırlanması bekleniyor',
        link: `/projects/${project.id}`,
      })

    // Baskı onayı approved (both pipelines, migration 047) → matbaa is IN
    // PRINT immediately, no separate "take into production" step anymore.
    //
    // Split by role because the destination is not the same for both, and a
    // link the recipient can't open is worse than no link: /baski-listesi is
    // guarded to `printer`, so a team leader tapping that push was bounced
    // straight back to the dashboard. Printers get the queue they act on;
    // leaders + designers get the project itself, which they can always open.
    // Assigned designers are included because for a ÇİN project this stage IS
    // the "your book cleared the print gate" moment; TR designers hear it at
    // ozalit_teslim instead, but a second confirmation is harmless.
    case 'baskida': {
      const ready = { ...base, tone: 'green' }
      const a = await emit(client, {
        ...ready, recipientIds: printers, type: 'production_ready',
        body: 'Proje baskıda alındı', link: '/baski-listesi',
      })
      const b = await emit(client, {
        ...ready, recipientIds: [...leaders, ...designers], type: 'in_production',
        body: 'Baskıya alındı', link: `/projects/${project.id}`,
      })
      return a + b
    }

    case 'gumruk':
      return emit(client, {
        ...base, recipientIds: leaders, type: 'in_customs', tone: 'blue',
        body: 'Gümrük aşamasında', link: `/projects/${project.id}`,
      })

    case 'satista':
      return emit(client, {
        ...base, recipientIds: [...leaders, ...designers, ...sales], type: 'on_sale', tone: 'pink',
        body: 'Satışa çıktı 🎉', link: `/projects/${project.id}`,
      })

    default:
      return 0
  }
}

/**
 * A project was soft-deleted. Whoever might have it queued — the assigned
 * designer(s), active printers (a demo/ozalit delivery could be sitting in
 * their queue), and the other active team leaders — get told it's gone,
 * instead of just finding it silently missing from their lists next time
 * they act on it.
 *
 * Team leaders are linked to "Silinen Projeler" since they're the ones who can
 * restore it. Designers/printers can't reach that page, and the project detail
 * 404s once deleted — so they go to the project LIST instead.
 *
 * Note the explicit link rather than leaving it null: both the bell and
 * `buildPayload` fall back to `/projects/<id>` whenever a notification carries
 * a project id, so "no link" quietly became "link to the deleted project" —
 * a tap that 404s. If you ever want a genuinely inert notification, the
 * fallback has to change too.
 */
export async function notifyProjectDeleted(client, { project, actor, assignees }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const printers = await activeUserIdsByRole(client, 'printer')
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const base = {
    actorId: actor?.id, title: project.title, projectId: project.id,
    type: 'project_deleted', tone: 'rose', body: 'Proje silindi',
  }
  const a = await emit(client, { ...base, recipientIds: [...designers, ...printers], link: '/projects' })
  const b = await emit(client, { ...base, recipientIds: leaders, link: '/deleted-projects' })
  return a + b
}

/**
 * A product was taken out of the Ürünler catalog ("kaldırıldı"), or put back.
 *
 * Sales is the audience that actually loses/regains something here: the product
 * simply stops appearing in their catalog, and an order they were about to
 * raise now 400s. Telling them beats letting the row vanish silently.
 *
 * Other team leaders are copied because catalog membership is shared state —
 * the same reason `notifyProjectDeleted` copies them. Designers and printers
 * are NOT: delisting changes nothing about the production work they own.
 *
 * The link goes to /urunler either way; a delisted product still shows there
 * for the leader, and for Sales the page is where they'd notice the change.
 */
export async function notifyProductCatalogChanged(client, { project, actor, hidden }) {
  const sales = await activeUserIdsByRole(client, 'satis')
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    recipientIds: [...sales, ...leaders],
    actorId: actor?.id,
    title: project.title,
    projectId: project.id,
    type: hidden ? 'product_delisted' : 'product_relisted',
    tone: hidden ? 'amber' : 'green',
    body: hidden
      ? 'Ürün katalogdan kaldırıldı, baskı verilemez'
      : 'Ürün katalogda tekrar yayında',
    link: '/urunler',
  })
}

/* --------------------------- hedef projeler ------------------------------- */

/**
 * A new Hedef Proje idea was added on Baskı Listesi (migration
 * 036__target_project_ideas.sql). Only fires when the author isn't a team
 * leader — the leader is the one curating this list, so their own additions
 * need no ping; anyone else's does, since otherwise it's only noticed by
 * chance the next time the leader happens to open the page.
 */
export async function notifyTargetProjectIdeaCreated(client, { idea, actor }) {
  if (actor?.role === 'team_leader') return 0
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    recipientIds: leaders,
    actorId: actor?.id,
    type: 'target_project_idea',
    title: idea.name,
    body: `${actor?.name ?? 'Ekipten biri'} yeni bir hedef proje ekledi`,
    tone: 'blue',
    link: '/baski-listesi',
  })
}

/* ----------------------------- toplantılar --------------------------------- */

/**
 * A new meeting was logged (migration 040__meetings.sql). Only fires when
 * the author isn't a team leader, same reasoning as
 * notifyTargetProjectIdeaCreated — the leader is the one who most needs to
 * know a designer or printer scheduled/logged a meeting.
 */
export async function notifyMeetingCreated(client, { meeting, actor }) {
  if (actor?.role === 'team_leader') return 0
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    recipientIds: leaders,
    actorId: actor?.id,
    type: 'meeting',
    title: meeting.title,
    body: `${actor?.name ?? 'Ekipten biri'} yeni bir toplantı ekledi`,
    tone: 'blue',
    link: '/toplanti',
  })
}

/* ------------------------------- orders ---------------------------------- */

const ORDER_STEP_BODY = {
  pending: 'Yeni baskı talebi, onayınızı bekliyor',
  goruldu: 'Baskı kontrolünüzü bekliyor',
  tasarimci_onay: 'Baskı ozalit isteniyor',
  ekran_onay: 'Ekran onayı bekleniyor',
  siparis_baski_onay: 'Baskı onay formu bekleniyor',
}
const ORDER_STEP_LINK = {
  pending: '/siparis-talepleri',
  goruldu: '/siparis-onay',
  tasarimci_onay: '/approvals/siparis',
  ekran_onay: '/siparis-talepleri',
  siparis_baski_onay: '/siparis-talepleri',
}
const ORDER_STEP_TONE = {
  pending: 'amber', goruldu: 'green', tasarimci_onay: 'blue',
  ekran_onay: 'blue', siparis_baski_onay: 'violet',
}

/**
 * A sipariş (order) moved to `newStatus`. Notify whoever must act on that
 * step. `onaylandi` is terminal → the sales requester is told it's approved.
 * `assigneeIds` are the designers assigned to THIS order (so the 'goruldu'
 * step pings the right designers, not every designer).
 */
export async function notifyOrderTransition(client, {
  order, project, newStatus, actor, requesterId, assigneeIds = [],
}) {
  const title = project?.title ?? order?.project_title ?? 'Baskı'
  const base = { actorId: actor?.id, title, projectId: order?.project_id ?? project?.id, orderId: order?.id }

  if (newStatus === 'onaylandi') {
    return emit(client, {
      ...base, recipientIds: [requesterId], type: 'order_approved', tone: 'green',
      body: 'Talebiniz onaylandı, üretime alındı', link: '/siparis-talebi',
    })
  }

  // Matbaa just delivered the reprint's ozalit: nobody can approve it yet —
  // computeMatbaaOnayApproval refuses until "Teslim Alındı" is marked, and
  // that's the leader's OR an assigned designer's to give. Mirrors
  // notifyProjectTransition's `ozalit_receipt_pending` case. Split into two
  // emits (unlike that one) because the two audiences land on different
  // pages here — leaders review from /siparis-talepleri, designers from
  // /siparis-onay.
  if (newStatus === 'matbaa_onay') {
    const leaders = await activeUserIdsByRole(client, 'team_leader')
    const a = await emit(client, {
      ...base, recipientIds: leaders, type: 'matbaa_receipt_pending', tone: 'amber',
      body: 'Matbaa ozaliti teslim etti, "Teslim Alındı" bekleniyor', link: '/siparis-talepleri',
    })
    const b = await emit(client, {
      ...base, recipientIds: assigneeIds, type: 'matbaa_receipt_pending', tone: 'amber',
      body: 'Matbaa ozaliti teslim etti, "Teslim Alındı" bekleniyor', link: '/siparis-onay',
    })
    return a + b
  }

  const owner = ORDER_STEP_OWNER[newStatus]
  if (!owner) return 0
  // The designer step targets the order's assigned designers specifically;
  // every other step targets all active holders of the owner role.
  const recipientIds = owner === 'designer' && assigneeIds.length > 0
    ? assigneeIds
    : await activeUserIdsByRole(client, owner)

  return emit(client, {
    ...base, recipientIds, type: 'order_step', tone: ORDER_STEP_TONE[newStatus] ?? 'blue',
    body: ORDER_STEP_BODY[newStatus] ?? 'Baskı güncellendi', link: ORDER_STEP_LINK[newStatus] ?? '/siparis-talepleri',
  })
}

/** Order rejected → tell the sales requester it bounced. */
export async function notifyOrderRejected(client, { order, project, actor, requesterId, reason }) {
  return emit(client, {
    actorId: actor?.id,
    recipientIds: [requesterId],
    type: 'order_rejected',
    title: project?.title ?? order?.project_title ?? 'Baskı',
    body: reason ? `Baskı reddedildi: ${reason}` : 'Baskı reddedildi',
    tone: 'rose',
    projectId: order?.project_id ?? project?.id,
    orderId: order?.id,
    link: '/siparis-talebi',
  })
}

/**
 * A delivered matbaa ozalit was just marked "Teslim Alındı" — the sipariş
 * twin of notifyOzalitReceived. Matbaa approval is multi-party but
 * leader-first: acknowledging the proof unblocks the team leaders, and the
 * order's assigned designers counter-sign after one of them approves
 * (computeMatbaaOnayApproval). Split into two emits since the audiences land
 * on different pages (see notifyOrderTransition's matbaa_onay case above).
 */
export async function notifyMatbaaReceived(client, { order, project, actor, assigneeIds = [] }) {
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const who = actor?.name ?? 'Ekipten biri'
  const base = {
    actorId: actor?.id, title: who, projectId: order?.project_id ?? project?.id, orderId: order?.id,
  }
  const a = await emit(client, {
    ...base, recipientIds: leaders, type: 'matbaa_approval_pending', tone: 'amber',
    body: `${project?.title ?? order?.project_title ?? 'Baskı'} ozaliti teslim alındı, onayınız bekleniyor`,
    link: '/siparis-talepleri',
  })
  const b = await emit(client, {
    ...base, recipientIds: assigneeIds, type: 'matbaa_received', tone: 'blue',
    body: `${project?.title ?? order?.project_title ?? 'Baskı'} ozaliti teslim alındı, ekip lideri onayı bekleniyor`,
    link: '/siparis-onay',
  })
  return a + b
}

/**
 * One party signed off on the matbaa ozalit but the round isn't complete —
 * ping whoever still owes an approval. Twin of the partial-approval branch in
 * notifyProjectTransition for ozalit_onay.
 */
export async function notifyMatbaaApprovalPending(client, { order, project, actor, teamLeaderIds = [], designerIds = [] }) {
  const approved = new Set((order?.matbaa_approvals ?? []).map((a) => a.id))
  const pendingLeaders = teamLeaderIds.filter((id) => !approved.has(id))
  const pendingDesigners = designerIds.filter((id) => !approved.has(id))
  const base = {
    actorId: actor?.id, title: project?.title ?? order?.project_title ?? 'Baskı',
    projectId: order?.project_id ?? project?.id, orderId: order?.id,
    type: 'matbaa_approval_pending', tone: 'amber',
    body: `${actor?.name ?? 'Ekipten biri'} baskı ozaliti onayladı, onayınız bekleniyor`,
  }
  const a = await emit(client, { ...base, recipientIds: pendingLeaders, link: '/siparis-talepleri' })
  const b = await emit(client, { ...base, recipientIds: pendingDesigners, link: '/siparis-onay' })
  return a + b
}

/* ------------------------------ handovers -------------------------------- */

/** Matbaa raised a teslim → tell sales to confirm receipt. */
export async function notifyHandoverRequested(client, { project, actor }) {
  const sales = await activeUserIdsByRole(client, 'satis')
  return emit(client, {
    recipientIds: sales, actorId: actor?.id, type: 'handover_request', tone: 'amber',
    title: project.title, body: 'Teslim talebi, onayınızı bekliyor',
    projectId: project.id, link: '/teslim-onaylari',
  })
}

/** Sales confirmed receipt → tell the matbaa who raised it + leaders + designers. */
export async function notifyHandoverConfirmed(client, { project, actor, raisedBy, assignees }) {
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  return emit(client, {
    recipientIds: [raisedBy, ...leaders, ...designers], actorId: actor?.id,
    type: 'handover_confirmed', tone: 'pink',
    title: project.title, body: 'Teslim onaylandı, satışa çıktı 🎉',
    projectId: project.id, link: `/projects/${project.id}`,
  })
}

/* ------------------------------- queries --------------------------------- */

export const FEED_PAGE_SIZE = 50
export const FEED_MAX_PAGE_SIZE = 100

/**
 * Normalise a caller-supplied page size.
 *
 * Anything that isn't a positive number falls back to the DEFAULT, not to the
 * floor: clamping a bogus `limit=-10` to 1 would hand back a one-item feed and
 * look like a data bug rather than a bad request. Exported so the route can
 * derive `nextCursor` from the same number the query actually used — computing
 * it twice with different rules is how a "load more" button ends up either
 * skipping rows or looping on the last page forever.
 */
export function clampPageSize(limit) {
  const n = Number(limit)
  if (!Number.isFinite(n) || n < 1) return FEED_PAGE_SIZE
  return Math.min(Math.trunc(n), FEED_MAX_PAGE_SIZE)
}

/**
 * One page of a user's feed, newest first.
 *
 * Keyset-paginated on `(created_at, id)` rather than OFFSET: the feed is
 * append-at-the-top, so an OFFSET page shifts under the reader every time a
 * new notification lands and they'd see duplicates while scrolling. The
 * compound cursor is required because `created_at` is not unique — a single
 * `emit` writes every recipient's row in one statement, and a user with two
 * rows sharing a timestamp would lose one at a page boundary under a
 * timestamp-only cursor.
 *
 * The tuple comparison `(created_at, id) < ($3, $4)` matches the
 * `(user_id, created_at DESC)` index directly, so paging stays an index scan.
 */
export async function listForUser(client, userId, { limit = FEED_PAGE_SIZE, cursor = null } = {}) {
  const size = clampPageSize(limit)
  const { rows } = await client.query(
    `SELECT id, type, title, body, tone, project_id, order_id, link,
            is_read, read_at, seen, seen_at, created_at
       FROM notifications
      WHERE user_id = $1
        AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::text))
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [userId, size, cursor?.createdAt ?? null, cursor?.id ?? null],
  )
  return rows
}

/**
 * Real unread / unseen totals for the badge.
 *
 * These used to be derived by looping the 50-row page the feed had just
 * fetched, which silently capped both counts: a user with 60 unseen rows saw a
 * number computed from 50 of them, and there was no way to reach the rest. The
 * aggregate below scans only this user's rows via
 * `idx_notifications_user_created` and is exact regardless of page size.
 */
export async function countsForUser(client, userId) {
  const { rows } = await client.query(
    `SELECT COUNT(*) FILTER (WHERE is_read = FALSE) AS unread,
            COUNT(*) FILTER (WHERE seen    = FALSE) AS unseen
       FROM notifications
      WHERE user_id = $1`,
    [userId],
  )
  return {
    // pg returns bigint aggregates as strings — Number() or the SPA compares
    // "0" > 0 and shows a badge on an empty feed.
    unread: Number(rows[0]?.unread ?? 0),
    unseen: Number(rows[0]?.unseen ?? 0),
  }
}

/**
 * Retention. Nothing deleted notification rows before this, so the table grew
 * monotonically: every pipeline transition fans out to 2–6 recipients, forever,
 * while the feed only ever renders the newest page.
 *
 * Two windows, because "old" means different things for done and not-done work:
 *   • readAfterDays — a notification the user has actioned is history. 30 days
 *     is long enough to answer "when did that book go to production?" from the
 *     feed rather than from stage_history, which is the real audit log.
 *   • maxAgeDays    — a hard ceiling that also catches rows nobody ever read,
 *     so an inactive account can't pin its backlog indefinitely.
 */
export async function pruneOldNotifications(
  client,
  { readAfterDays = 30, maxAgeDays = 90 } = {},
) {
  const { rowCount } = await client.query(
    `DELETE FROM notifications
      WHERE (is_read = TRUE AND created_at < NOW() - make_interval(days => $1::int))
         OR created_at < NOW() - make_interval(days => $2::int)`,
    [readAfterDays, maxAgeDays],
  )
  return rowCount
}

/**
 * Mark one notification read — scoped to the owner. Reading implies seeing,
 * so we set `seen` too (keeps the is_read ⇒ seen invariant).
 */
export async function markRead(client, userId, id) {
  const { rowCount } = await client.query(
    `UPDATE notifications
        SET is_read = TRUE, read_at = NOW(),
            seen = TRUE, seen_at = COALESCE(seen_at, NOW())
      WHERE id = $1 AND user_id = $2 AND is_read = FALSE`,
    [id, userId],
  )
  return rowCount > 0
}

/** Mark every row read (and therefore seen). Returns rows affected. */
export async function markAllRead(client, userId) {
  const { rowCount } = await client.query(
    `UPDATE notifications
        SET is_read = TRUE, read_at = NOW(),
            seen = TRUE, seen_at = COALESCE(seen_at, NOW())
      WHERE user_id = $1 AND is_read = FALSE`,
    [userId],
  )
  return rowCount
}

/**
 * Mark every unseen row seen — called when the user OPENS the bell. Clears
 * the badge WITHOUT touching is_read, so items stay bold/to-do until acted on.
 */
export async function markAllSeen(client, userId) {
  const { rowCount } = await client.query(
    `UPDATE notifications SET seen = TRUE, seen_at = NOW()
      WHERE user_id = $1 AND seen = FALSE`,
    [userId],
  )
  return rowCount
}
