/**
 * Find — and optionally repair — projects that reached `baskida` through a
 * sipariş before the matbaa was ever told.
 *
 * THE BUG THIS CLEANS UP AFTER
 * ---------------------------
 * A sipariş's final approval changes two aggregates. `approveBaskiOnayForm`
 * flips the ORDER to `baskida` and, in its `after` hook, flips the PROJECT to
 * `baskida` too. That project stage is what puts a book on the matbaa's
 * /baski-listesi queue — the page filters projects by stage, not orders.
 *
 * The dispatcher only ever announced the order half. `notifyOrderTransition`'s
 * `baskida` branch emits to the sales requester alone (on the order side
 * baskida is terminal, so there is no next owner to hand work to), and nothing
 * announced the PROJECT flip. The main pipeline's own baski_onay → baskida
 * advance has always sent printers "Proje baskıda alındı"; the sipariş path
 * made the identical stage change in silence.
 *
 * The code is fixed. Rows written before the fix are not: the projects sit on
 * the queue correctly, but nobody was ever told they arrived.
 *
 * WHY THIS IS A SCRIPT AND NOT A REPAIR MIGRATION
 * ----------------------------------------------
 * Migrations 078 and 079 repaired data in SQL, and the principle they state is
 * the right test: "the repair is derivable, which is why it is safe to do in
 * SQL." This repair is not, for two reasons.
 *
 *   1. `emit` stamps `pushed_at` at insert time based on whether web push is
 *      configured — a RUNTIME check (`isPushEnabled()`, VAPID keys) that SQL
 *      cannot see. Insert the rows with `pushed_at` NULL on a deploy with push
 *      disabled and they sit owed forever, growing the partial index the
 *      sweeper reads and giving it a backlog it can never drain. That exact
 *      hazard is called out in `emit`'s own comments.
 *
 *   2. A migration runs itself on the next boot. Sending notifications is not
 *      a schema change — it puts a banner on somebody's phone — and it should
 *      be a thing a person decides to do after reading the list, not a side
 *      effect of a deploy.
 *
 * USAGE
 * -----
 *   node scripts/stuck-baskida.mjs            # dry run: report only, no writes
 *   node scripts/stuck-baskida.mjs --apply    # emit the missing notifications
 *
 * The dry run is the default on purpose, and it is worth doing first: the
 * queue itself was never broken, so the honest answer may be "these are
 * visible, they just need someone to look" rather than a round of pings about
 * work that is weeks old.
 */

import { pathToFileURL } from 'node:url'

import { getPool, closePool, withTx } from '../src/db/pool.js'
import { emit, activeUserIdsByRole } from '../src/services/notifications.js'

const APPLY = process.argv.includes('--apply')

/**
 * Projects that reached `baskida` via an order and were never announced.
 *
 * Three conditions, and each one narrows for a reason:
 *
 *   stage = 'baskida'
 *     Still in production. A project that has moved on to gumruk or satista is
 *     not stuck — the printers evidently picked it up regardless.
 *
 *   an 'order_final' stage_history row landing on baskida
 *     This is what says the flip came from a sipariş rather than from the main
 *     pipeline's own advance. Written by approveBaskiOnayForm's after hook.
 *
 *   no 'production_ready' notification for the project
 *     The announcement that should have gone to the printers. Its absence is
 *     the bug's fingerprint: the main pipeline always emits one, so a project
 *     at baskida without it never had its arrival announced.
 *
 * NOTE the third condition also catches a rarer case worth repairing anyway —
 * a main-pipeline project that reached baskida at a moment when no printer
 * account was active, so `emit` had an empty recipient set and wrote nothing.
 * The `order_final` condition excludes those; drop it if you want them too.
 */
export const FIND_SQL = `
  SELECT p.id, p.title, p.type, p.stage,
         h.created_at AS entered_baskida_at,
         h.note       AS entered_note
    FROM projects p
    JOIN LATERAL (
      SELECT sh.created_at, sh.note
        FROM stage_history sh
       WHERE sh.project_id = p.id
         AND sh.event = 'order_final'
         AND sh.to_stage = 'baskida'
       ORDER BY sh.created_at DESC
       LIMIT 1
    ) h ON TRUE
   WHERE p.stage = 'baskida'
     AND p.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM notifications n
        WHERE n.project_id = p.id
          AND n.type = 'production_ready'
     )
   ORDER BY h.created_at ASC
`

function days(since) {
  return Math.floor((Date.now() - new Date(since).getTime()) / 86400000)
}

async function main() {
  const { rows } = await getPool().query(FIND_SQL)

  if (rows.length === 0) {
    console.log('Nothing stuck: every sipariş-driven baskıda project was announced to the matbaa.')
    return
  }

  const printers = await activeUserIdsByRole(getPool(), 'printer')

  console.log(`\n${rows.length} project(s) reached baskıda via a sipariş and were never announced:\n`)
  for (const r of rows) {
    console.log(`  ${r.title}`)
    console.log(`    id ${r.id} · ${r.type} · entered baskıda ${days(r.entered_baskida_at)} gün önce`)
  }

  console.log(`\nActive printers who would be notified: ${printers.length || 'NONE'}`)
  if (printers.length === 0) {
    console.log('  No active printer accounts — there is nobody to notify. Fix that first.')
    return
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written.')
    console.log('These projects ARE already on /baski-listesi (it filters by stage, so the queue')
    console.log('was never wrong) — they were just never flagged as new arrivals. If the matbaa')
    console.log('has since picked them up, you may not want to ping about weeks-old work.')
    console.log('\nTo send the missing notifications: node scripts/stuck-baskida.mjs --apply')
    return
  }

  // One transaction per project rather than one for all of them: a failure
  // halfway through leaves the projects it already announced announced, and
  // the query above is the resume point — re-running skips them, because they
  // now have the notification it looks for.
  let sent = 0
  for (const r of rows) {
    try {
      await withTx(async (client) => {
        // Printers only. The leaders and designers who would also have heard
        // ('in_production') already know — they are the ones who approved the
        // sheet that moved it. Re-announcing to them now, weeks later, is
        // noise; the matbaa never hearing is the actual harm.
        //
        // actorId null: there is no actor for a repair, and passing one would
        // filter that person out of their own catch-up notification.
        const n = await emit(client, {
          recipientIds: printers,
          actorId: null,
          type: 'production_ready',
          title: r.title,
          body: 'Proje baskıda alındı',
          tone: 'green',
          projectId: r.id,
          link: '/baski-listesi',
          // No domain event: this announces a transition that already happened
          // and was already recorded. Appending one now would put a fresh
          // `project.transition` in the event log at today's timestamp for a
          // flip that happened weeks ago, which is worse than a gap.
          event: null,
        })
        sent += n
        console.log(`  notified ${n} printer(s) about ${r.title}`)
      })
    } catch (err) {
      console.error(`  FAILED for ${r.title} (${r.id}): ${err.message}`)
    }
  }
  console.log(`\nDone — ${sent} notification row(s) written.`)
  if (sent > 0) {
    console.log('Web push (if configured) is delivered by the maintenance sweep shortly after,')
    console.log('so the phones may lag the in-app bell by a minute or two.')
  }
}

// Only run when invoked directly. Importing this module (the test does, to
// exercise FIND_SQL against a real schema) must not open a pool, talk to a
// database, or send anybody a notification.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((err) => { console.error('FATAL:', err); process.exitCode = 1 })
    .finally(() => closePool())
}
