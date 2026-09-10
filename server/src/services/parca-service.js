/**
 * Per-parça routing verbs (migration 074).
 *
 * These are the actions that move one parça between desks without moving the
 * project: the matbaa starts and delivers a single parça, the designer sends a
 * revized one back round. They live outside `runProjectCommand` on purpose —
 * that orchestrator exists to diff and patch the `projects` row, and none of
 * these change a project column. Routing them through it would mean a project
 * UPDATE (and a version bump, and a stage_history row) every time a printer
 * taps "İşlemi Başlatın" on one parça.
 *
 * What they do share with the project FSM is its shape: a pure function in
 * `domain/parca-routing.js` decides the patch, this layer owns the transaction,
 * the guard and the notification.
 */

import { withTx, getPool } from '../db/pool.js'
import { badRequest, notFound } from '../domain/errors.js'
import {
  parcaRequestRoundPatch,
  parcaStartPatch,
  parcaDeliverPatch,
  parcaReceivePatch,
  parcaAwaitsReceipt,
  parcaAlreadyDelivered,
  parcaChangeRequestable,
  parcaChangeRequestPatch,
  parcaChangeAcceptPatch,
  parcaChangeDeclinePatch,
  canActOnParca,
  parcaGateForStage,
} from '../domain/parca-routing.js'
import {
  listParcaState,
  listParcaStateByOwner,
  listGateParcalarAwaitingLeader,
  upsertParcaState,
  deleteParcaState,
} from './parca-state-repository.js'
import {
  getProjectForUpdate,
  loadProjectAssignees,
  loadLatestDemoSnapshot,
  patchProject,
} from './project-repository.js'
import { advanceProject } from './project-service/transitions.js'
import { emit, activeUserIdsByRole } from './notifications.js'
import { listMyOrderParcaQueue } from './order-parca-service.js'

/** GET /api/projects/:id/parca-state — one project's parça rows. */
export async function listProjectParcaState(projectId) {
  return listParcaState(null, projectId)
}

/**
 * GET /api/parca-queue — every parça currently on the caller's desk.
 *
 * This is what lets the matbaa's queue render one row per parça rather than
 * one per project: a project with KUTU at the matbaa and KİTAP with the
 * designer appears once in each queue, carrying only that party's parça.
 */
export async function listMyParcaQueue(actor) {
  // The sipariş half (migration 080). Concatenated rather than merged: a
  // reprint's parçalar are their own round with their own gate, and the two
  // halves derive their "still owed" sets from different places — a project's
  // from its stage, an order's from its status. Rows carry `order_id`, which
  // is what lets the client tell them apart and call the right endpoint.
  const orderRows = await listMyOrderParcaQueue(actor)

  if (actor?.role === 'printer') {
    const routed = await listParcaStateByOwner(null, 'printer', ['with_matbaa', 'in_round'])
    // One pass over the live rounds serves both halves: which routed rows still
    // belong to their round, and which of the round's parçalar have no row yet.
    const rounds = await loadLiveTeslimRounds()
    const live = dropOrphanedRouted(routed, rounds)
    const fresh = await deriveTeslimParcalar(live, rounds)
    return [...live, ...fresh, ...orderRows]
  }
  if (actor?.role === 'designer') {
    const projectRows = await listParcaStateByOwner(null, 'designer', ['with_designer'])
    return [...projectRows, ...orderRows]
  }
  // The leader's queue is the parçalar that came back on a round the matbaa is
  // still producing (migration 076). Their work IS the approval gate — but on a
  // split round the project never reaches it, so these parçalar would otherwise
  // appear in nobody's list: the leader saw a "KUTU teslim edildi" notification
  // and had no surface to act on it.
  //
  // A parça already signed off this round is dropped: it is standing at the gate
  // only because the project cannot move until its siblings arrive, and it needs
  // nothing further from anyone.
  if (actor?.role === 'team_leader') {
    const rows = await listGateParcalarAwaitingLeader(null)
    const gateRows = rows.filter((row) => {
      const signed = row.gate === 'ozalit'
        ? Array.isArray(row.ozalit_parca_approvals?.[row.parca])
          && row.ozalit_parca_approvals[row.parca].length > 0
        : (row.demo_parca_approvals ?? []).some((a) => a?.parca === row.parca)
      return !signed
    }).map(({ demo_parca_approvals, ozalit_parca_approvals, ...row }) => row)
    return [...gateRows, ...orderRows]
  }
  return orderRows
}

/** Stages where the matbaa owes a whole round, and the sheet each reads from. */
const TESLIM_GATES = {
  demo_teslim: 'demo',
  cin_demo_teslim: 'demo',
  ozalit_teslim: 'ozalit',
}

/**
 * Every live *_teslim round the matbaa is holding, keyed by project id.
 *
 * Loaded once and used twice — to derive the parçalar of rounds nobody has
 * touched yet (`deriveTeslimParcalar`) and to drop routed rows whose parça has
 * since left the round (`dropOrphanedRouted`). Both need the same
 * project + snapshot pair, and asking for it twice meant two queries per
 * project on a read path.
 *
 * "Live" excludes an ozalit round nobody has asked for: it only belongs to the
 * matbaa once requested, or bounced back to them. Same rule as
 * `isOzalitRoundLive`.
 */
async function loadLiveTeslimRounds() {
  const pool = getPool()
  const stages = Object.keys(TESLIM_GATES)
  const { rows: projects } = await pool.query(
    `SELECT id, title, stage, type, ozalit_requested, reject_target
       FROM projects
      WHERE stage = ANY($1) AND deleted_at IS NULL`,
    [stages],
  )
  const rounds = new Map()
  for (const p of projects) {
    if (p.stage === 'ozalit_teslim' && !p.ozalit_requested && p.reject_target !== 'matbaa') continue
    const gate = TESLIM_GATES[p.stage]
    const snapshot = await loadLatestDemoSnapshot(pool, p.id, gate)
    rounds.set(p.id, { project: p, gate, parcalar: snapshot?.selectedComponents ?? [] })
  }
  return rounds
}

/**
 * Drop routed rows for parçalar that are no longer part of their round.
 *
 * `listParcaStateByOwner` joins only `parca_state × projects` — it never
 * consults the round's snapshot, because the queue spans every project and
 * loading a snapshot per row would be a query per row. So a parça dropped from
 * a round (a re-send composing a different parça list) kept sitting in the
 * matbaa's queue as live work, while `allParcalarDelivered` — which IS
 * snapshot-driven — had already stopped waiting for it. The printer could start
 * and deliver a parça that was not part of the round at all.
 *
 * Deliberately narrow. A row is dropped ONLY when all of these hold:
 *
 *   • its project is on the map above, i.e. at a live *_teslim stage;
 *   • the row's gate is the gate that round is running;
 *   • the round has a parça list at all;
 *   • and the row's parça is absent from it.
 *
 * Every one of those is load-bearing. A row can legitimately be `with_matbaa`
 * while its project sits at a NON-teslim stage — that is the reject-to-matbaa
 * flow (`parcaRejectPatch`), where there is no round snapshot to check against —
 * and a project can carry a demo row while running an ozalit round. Dropping
 * either would delete real work from the queue. An empty parça list means the
 * snapshot has not been written yet (the SPA writes it AFTER the advance, see
 * `deriveTeslimParcalar`), which is "unknown", not "nothing belongs".
 *
 * A read-side filter rather than a delete: the row keeps its rework `attempt`
 * and rejection history, and comes back on its own if a later round carries the
 * parça again.
 *
 * Exported for its own tests: the two functions either side of it reach for
 * `getPool()`, which ESM leaves no way to stub (see the note at the foot of
 * project-service.test.js), so keeping the decision in one pure function is what
 * makes any of this testable at all.
 *
 * @param {Array<{ project_id: string, parca: string, gate: string }>} routed
 * @param {Map<string, { gate: string, parcalar: string[] }>} rounds
 */
export function dropOrphanedRouted(routed, rounds) {
  return (routed ?? []).filter((row) => {
    const round = rounds.get(row.project_id)
    if (!round) return true
    if (round.gate !== row.gate) return true
    if (round.parcalar.length === 0) return true
    return round.parcalar.includes(row.parca)
  })
}

/**
 * The parçalar a matbaa owes on rounds that were never split up.
 *
 * Explicitly routed rows only cover REWORK — a parça a leader bounced back, or
 * one a designer re-requested. A first round has no such rows, so without this
 * the matbaa would see one whole-sheet card for a fresh demo and per-parça
 * cards only after something went wrong. The parçalar are the same either way,
 * so the queue should be too.
 *
 * Derived rather than seeded at round-submission time, deliberately. The
 * round's parça list lives on its `demos` snapshot, which the SPA writes AFTER
 * the transition that starts the round (`persistAfterStep` in
 * SpecFormDialog) — so at advance time there is often nothing to seed from.
 * Reading it here asks the question at the only moment the answer is known,
 * and needs no write on a read path: a row is created the moment the matbaa
 * actually starts or delivers that parça.
 *
 * Rows already routed explicitly are skipped, so a parça never appears twice.
 *
 * The `existing` query below is scoped to THIS round's own `gate`, and that
 * scoping matters more here than almost anywhere else this table is read. A
 * project's demo round and its later ozalit round reuse the same parça names
 * (KUTU, KİTAP, …), and any per-parça activity during the demo leg — a reject,
 * an edit, a re-round — leaves a row behind in a resolved state (`'pending'`)
 * once that round finished. Read without the gate filter, that row satisfies
 * the skip condition below for the OZALİT round too: the leader ticks all of
 * KUTU/KİTAP/KILAVUZ for the ozalit sheet, sends it, and the matbaa's queue
 * derives zero cards — every one of them "already has a row that isn't
 * with_matbaa/in_round" — so `printerParcaJobs` comes back empty and the whole
 * split-round board never renders, silently falling back to the old
 * whole-sheet "İşlemi Başlatın" card despite a genuinely multi-parça round.
 *
 * Also carries `order_id IS NULL` — this queries `parca_state` directly
 * rather than through parca-state-repository.js's own project-scoped
 * helpers, which all carry the same filter (see that file's header). Without
 * it, a sipariş reprint sharing this project's title and `gate: 'ozalit'`
 * would count as "already routed" here, and its rows would silently answer
 * for the project's own round.
 */
async function deriveTeslimParcalar(routed, rounds) {
  const pool = getPool()
  const seen = new Set(routed.map((r) => `${r.project_id}|${r.parca}`))
  const out = []
  for (const { project: p, gate, parcalar } of rounds.values()) {
    // Single-parça (or snapshot-less) rounds keep the whole-project card they
    // have always had — splitting a one-parça sheet into a "parça queue" of
    // one is noise, and the project row already says everything. Note this is
    // a rule about DERIVING only: `dropOrphanedRouted` above deliberately does
    // not inherit it, because a one-parça round can still strand a routed row
    // for some other parça.
    if (parcalar.length < 2) continue
    const { rows: existing } = await pool.query(
      'SELECT parca, state, started_at, attempt FROM parca_state WHERE project_id = $1 AND gate = $2 AND order_id IS NULL',
      [p.id, gate],
    )
    const byParca = new Map(existing.map((r) => [r.parca, r]))
    for (const parca of parcalar) {
      if (seen.has(`${p.id}|${parca}`)) continue
      const row = byParca.get(parca)
      // Already handed back (delivered → 'pending') or signed off: not theirs.
      if (row && row.state !== 'with_matbaa' && row.state !== 'in_round') continue
      out.push({
        project_id: p.id,
        parca,
        gate,
        state: row?.started_at ? 'in_round' : 'with_matbaa',
        owner_role: 'printer',
        route: 'physical',
        // NOT `snapshot.attempt`. Two different counters live under that name:
        // `demos.attempt` is a storage SLOT, deliberately offset — +1 for a new
        // round and +2 for an edit-notify save, so history keeps the pristine
        // as-first-sent copy (SpecFormDialog's `willEditBump`). `parca_state.
        // attempt` is this parça's ROUND NUMBER, counted from 1 and raised only
        // by parcaRejectPatch. Seeding one from the other made a never-reworked
        // parça render "2. tur" on a first round, and "3. tur" after any
        // correction — see the badge in ParcaJobCard / ParcaChangeRequestPanel /
        // ParcaReturnedPanel, which shows whenever attempt > 1.
        attempt: row?.attempt ?? 1,
        started_at: row?.started_at ?? null,
        delivered_at: null,
        reason: null,
        // A derived row has no handshake on it by definition — a parça anybody
        // has asked about HAS a real row, because the ask materialises one.
        // Stated rather than left undefined so every row the queue hands the
        // client has the same shape, and ParcaJobCard does not have to tell a
        // missing field from a false one (migration 077).
        change_requested_at: null,
        change_requested_by: null,
        change_requested_by_name: null,
        change_requested_note: null,
        fix_pending: false,
        project_title: p.title,
        project_stage: p.stage,
        project_type: p.type,
      })
    }
  }
  return out
}

/**
 * Load one parça's row under a lock, with the project, or 404.
 *
 * `getProjectForUpdate` is the same SELECT … FOR UPDATE every project route
 * takes. It matters more here than usual: two parties act on one project
 * concurrently by design, so the lock is what stops a matbaa's delivery and a
 * leader's approval from interleaving on the same parça.
 */
async function loadParcaForUpdate(client, projectId, parca) {
  const project = await getProjectForUpdate(client, projectId)
  if (!project) notFound('Proje bulunamadı.')
  // `order_id IS NULL` — same invariant parca-state-repository.js's own
  // project-scoped helpers all carry (see that file's header). Without it, a
  // sipariş reprint sharing this project and parça name could be read back as
  // THIS round's row: `gate` matches ('ozalit' either way), so a project-side
  // start/deliver would land on the order's routing row instead of the
  // project's own — or materialise a duplicate the order's upsert can't see.
  const { rows } = await client.query(
    'SELECT * FROM parca_state WHERE project_id = $1 AND parca = $2 AND order_id IS NULL FOR UPDATE',
    [projectId, parca],
  )
  const existing = rows[0] ?? null
  const gate = TESLIM_GATES[project.stage]

  /* A row counts as this round's only when its gate is this round's gate.
   *
   * `parca_state` is keyed (project_id, parca) — ONE row per parça, carrying the
   * gate it last cycled on, not one row per parça per gate. So a project that
   * finished its demo leg still has every parça's row sitting there saying
   * `gate: 'demo'`, `state: 'approved'`, `owner_role: NULL`.
   *
   * Read as if it were the ozalit round's row, that is the matbaa being told the
   * parça is not theirs: `canActOnParca` wants `owner_role: 'printer'`, and the
   * finished demo row has no owner at all. The result was an ozalit round the
   * matbaa could see in their queue and could not start — "Bu parça sizde
   * değil." on every parça of a project that had ever run a demo.
   *
   * The derive path had it right all along (`deriveTeslimParcalar` scopes its
   * `existing` query by gate for exactly this reason); this lookup did not, so
   * the queue offered a card the action behind it refused. */
  if (existing && (!gate || existing.gate === gate)) return { project, row: existing }

  // No row for THIS round. On a teslim round that is normal rather than an
  // error: the parçalar are derived from the round's sheet (see
  // deriveTeslimParcalar) and a row is only written the moment someone actually
  // acts on one. Materialise it here, on the first action, so the matbaa can
  // work a fresh round parça-by-parça without anything seeded up front.
  if (!gate) notFound('Parça bulunamadı.')
  const snapshot = await loadLatestDemoSnapshot(client, projectId, gate)
  if (!(snapshot?.selectedComponents ?? []).includes(parca)) {
    notFound('Parça bu turda yok.')
  }
  /* Retire the previous leg's row before writing this one.
   *
   * `upsertParcaState` COALESCEs the fields that outlive a single hand-off —
   * `reason`, `rejected_by/_by_name/_at` and `fix_pending` — so an upsert onto
   * the stale row would carry the DEMO round's reject reason and, worse, its
   * `fix_pending` debt into the ozalit round. `startParca` refuses on
   * `fix_pending`, so the matbaa would trade one wrong 400 for another. The
   * delivery stamps take EXCLUDED verbatim and would clear on their own; these
   * do not, and there is no "explicit null" through that patch.
   *
   * Nothing is lost that this table is the record of: the ledgers and the
   * project timeline hold what happened on the finished leg, while these rows
   * only ever answer "where is this parça in THIS round". */
  if (existing) await deleteParcaState(client, projectId, parca)
  const created = await upsertParcaState(client, projectId, parca, {
    gate,
    state: 'with_matbaa',
    owner_role: 'printer',
    route: 'physical',
    // 1, not `snapshot.attempt` — see deriveTeslimParcalar's note. This is the
    // parça's FIRST time round by definition: we are here precisely because it
    // has no row on this gate, and only a reject raises the count from here.
    attempt: 1,
  })
  return { project, row: created }
}

/**
 * Is every parça of this round now off the matbaa's desk?
 *
 * Only then does the PROJECT move — a partial delivery leaves it at its teslim
 * stage, which is the whole point: the parçalar the matbaa hasn't done stay
 * theirs until they do.
 *
 * Scoped to `gate`, and it has to be: a project's demo round and ozalit round
 * reuse the same parça names, and a demo-gate row left over in a resolved
 * state (`'pending'`, once that round finished) is not "with_matbaa" or
 * "in_round" either. Without the filter it satisfies this check for the
 * ozalit round too — a same-named leftover from a round that is already over
 * could read the CURRENT round as fully delivered before the matbaa had
 * touched it, and silently advance the project on no real work at all.
 *
 * Exported for its own tests — it already takes `client` rather than reaching
 * for `getPool()` internally, so a fake client can drive it directly. See
 * `parca-service.test.js`.
 *
 * Also carries `order_id IS NULL`, the same reason as the gate filter above:
 * a sipariş reprint on this same project can carry rows for the same parça
 * names under `gate: 'ozalit'` too. Left unscoped, an order's already-signed
 * parçalar could read as this round's own delivery and advance the project
 * on matbaa work that was never done for it.
 */
export async function allParcalarDelivered(client, project, gate) {
  const snapshot = await loadLatestDemoSnapshot(client, project.id, gate)
  const parcalar = snapshot?.selectedComponents ?? []
  if (parcalar.length < 2) return true // single-parça round: the old whole-sheet behaviour
  const { rows } = await client.query(
    'SELECT parca, state FROM parca_state WHERE project_id = $1 AND gate = $2 AND order_id IS NULL',
    [project.id, gate],
  )
  const byParca = new Map(rows.map((r) => [r.parca, r.state]))
  return parcalar.every((p) => {
    const state = byParca.get(p)
    // Never touched, or still on their desk → the round is not finished.
    return state != null && state !== 'with_matbaa' && state !== 'in_round'
  })
}

/**
 * A parça has landed back at the approval gate — bring the PROJECT columns the
 * gate reads back in step with it.
 *
 * Two things go stale otherwise, and both were live bugs:
 *
 *   `*_received` — the receipt gate. The whole-round legs
 *   (`computeDemoTeslimAdvance` / `computeOzalitTeslimAdvance`) clear it on
 *   every fresh delivery, so "anything coming from the matbaa forces a Teslim
 *   Alındı step" held for round one and quietly stopped holding after that:
 *   the flag stayed true from the first acknowledgment, and every parça the
 *   matbaa reprinted could be approved without anyone confirming it arrived.
 *   Only a physical delivery clears it — an ekran round has nothing to receive.
 *
 *   `*_parca_rejections` — append-only, and read by the SPA to decide whether a
 *   parça still shows "Reddedildi". Leaving the row behind means a parça that
 *   was rejected, reworked and handed back reads as rejected for the life of
 *   the project. Dropping it here makes the ledger mean "rejected and not yet
 *   back", which is what both the badge and the client-side pending set want.
 *
 * This is the one place per-parça routing touches a project column, and it is
 * deliberate: these are not routing state, they are the gate's own inputs, and
 * nothing else is going to reset them on a leg that never moves the stage.
 */
async function settleParcaAtGate(client, project, parca, { received }) {
  const gate = parcaGateForStage(project.stage)
  if (!gate) return null
  const ledgerCol = gate === 'ozalit' ? 'ozalit_parca_rejections' : 'demo_parca_rejections'
  const rejections = (project[ledgerCol] ?? []).filter((r) => r?.parca !== parca)
  const fields = { [ledgerCol]: rejections }
  if (received) {
    if (gate === 'ozalit') {
      Object.assign(fields, {
        ozalit_received: false, ozalit_received_by: null, ozalit_received_at: null,
      })
    } else {
      Object.assign(fields, {
        demo_received: false, demo_received_by: null, demo_received_at: null,
      })
    }
  }
  return patchProject(client, project.id, fields, { expectedVersion: project.version })
}

/**
 * POST /api/projects/:id/parca/:parca/start — the matbaa began this parça.
 *
 * The per-parça counterpart of `computeDemoStart`. Note what it does NOT do:
 * touch `projects.demo_started`. That flag describes the whole sheet, and
 * setting it because one parça started would hide "İşlemi Başlatın" on every
 * other parça the matbaa still owes.
 */
export async function startParca(projectId, parca, actor) {
  return withTx(async (client) => {
    const { row } = await loadParcaForUpdate(client, projectId, parca)
    if (actor?.role !== 'printer') {
      badRequest('Parça çalışmasını yalnızca matbaa başlatabilir.')
    }
    if (!canActOnParca(actor, row)) {
      badRequest('Bu parça sizde değil.')
    }
    // The per-parça twin of computeDemoStart's `demo_fix_pending` guard
    // (migration 077). Accepting a change request un-started this parça so the
    // leader could correct the sheet; re-starting before the correction lands
    // would put the matbaa back to work on the version they just agreed was
    // wrong, and silently take the free-edit window away again.
    if (row.fix_pending) {
      badRequest('Kabul edilen değişiklik talebi için düzeltme bekleniyor, önce form güncellenmelidir.')
    }
    if (row.started_at) return row // idempotent — already started
    return upsertParcaState(client, projectId, parca, parcaStartPatch({ now: new Date().toISOString() }))
  })
}

/**
 * POST /api/projects/:id/parca/:parca/deliver — the matbaa handed this parça back.
 *
 * The parça returns to the gate with no owner: from here it is the leader's
 * call again, and they approve or reject it through the existing per-parça
 * approve/reject path.
 */
export async function deliverParca(projectId, parca, actor) {
  return withTx(async (client) => {
    const { project, row } = await loadParcaForUpdate(client, projectId, parca)
    if (actor?.role !== 'printer') {
      badRequest('Parça teslimini yalnızca matbaa yapabilir.')
    }
    // Idempotent, like `startParca` above and `receiveParca` below — and for a
    // sharper reason than symmetry. Delivering hands the parça back to the
    // gate, which CLEARS `owner_role` (see parcaDeliverPatch), so the second
    // arrival of the same click failed `canActOnParca` and came back as "Bu
    // parça sizde değil." on a parça the printer had just delivered
    // successfully. Two taps on a phone, or one tap against a queue that had
    // not refetched yet, was all it took. Delivering twice is not an error; it
    // is the same fact stated twice.
    if (parcaAlreadyDelivered(row)) return row
    if (!canActOnParca(actor, row)) {
      // Distinguish the ways to get here, as `receiveParca` does: the message
      // above was the same sentence for "somebody else has it" and "you just
      // delivered it", which is how the dead end went unrecognised for so long.
      if (row.state === 'approved') badRequest('Bu parça onaylandı, teslim edilecek bir şey yok.')
      if (row.state === 'with_designer') badRequest('Bu parça tasarımcıda, sizde değil.')
      badRequest('Bu parça sizde değil.')
    }
    if (!row.started_at) {
      badRequest('Önce "İşlemi Başlatın" ile çalışmayı işaretleyin.')
    }
    const updated = await upsertParcaState(
      client, projectId, parca, parcaDeliverPatch({ now: new Date().toISOString() }),
    )

    // Something physical just arrived from the matbaa: the leader owes a fresh
    // "Teslim Alındı" before they can sign it off, and this parça is no longer
    // a rejected one. No-op on a *_teslim round, where the whole-round advance
    // below owns both.
    await settleParcaAtGate(client, project, parca, { received: true })

    // The project only follows once the LAST parça is off their desk. Deliver
    // KUTU while KİTAP is still unstarted and the project stays at its teslim
    // stage with KİTAP still in the matbaa's queue — which is the point.
    const gate = TESLIM_GATES[project.stage]
    const roundFinished = gate ? await allParcalarDelivered(client, project, gate) : false
    if (roundFinished) {
      // Same transition the whole-sheet "Teslim Edin" performs, run inside this
      // transaction so the last parça's delivery and the stage move commit
      // together. It carries its own history row and notifications.
      await advanceProject(projectId, actor, {}, client)
      return updated
    }

    const assignees = await loadProjectAssignees(client, project)
    const leaders = await activeUserIdsByRole(client, 'team_leader')
    await emit(client, {
      recipientIds: [...leaders, ...assignees.map((a) => a.id)],
      actorId: actor?.id,
      type: 'parca_delivered',
      tone: 'amber',
      title: project.title,
      projectId: project.id,
      body: `${parca} teslim edildi, diğer parçalar bekleniyor`,
      link: `/projects/${project.id}`,
      event: { type: 'project.parca_delivered', aggregateId: project.id },
    })
    return updated
  })
}

/**
 * POST /api/projects/:id/parca/:parca/receive — the leader took delivery of one
 * parça (migration 076).
 *
 * The per-parça "Teslim Alındı". Until this exists nothing about a delivered
 * parça can happen before the whole round lands: the project deliberately stays
 * at its *_teslim stage while other parçalar are still being printed
 * (`allParcalarDelivered` below), and every approval path refuses without a
 * receipt. So a parça delivered on Monday sat untouchable until the last one
 * arrived — the leader's half of "both parties work at once" simply did not
 * exist.
 *
 * Who may: the same two parties the project-level receipt allows — a team
 * leader, or a designer assigned to this project. It is a statement about
 * physical possession, so it belongs to whoever is holding the thing.
 *
 * Idempotent: acknowledging twice is not an error, it is the same fact. Nobody
 * is notified — the receipt is the receiver's own act, and the parça does not
 * change hands.
 */
export async function receiveParca(projectId, parca, actor) {
  return withTx(async (client) => {
    const { project, row } = await loadParcaForUpdate(client, projectId, parca)
    if (row.received_at) return row // idempotent — already acknowledged

    const assignees = await loadProjectAssignees(client, project)
    const isAssignedDesigner =
      actor?.role === 'designer' && assignees.some((a) => a.id === actor?.id)
    if (actor?.role !== 'team_leader' && !isAssignedDesigner) {
      badRequest('Teslim almayı yalnızca ekip lideri veya atanmış tasarımcı yapabilir.')
    }
    if (!parcaAwaitsReceipt(row)) {
      // Three ways to get here, and the message has to tell them apart: the
      // parça is still on somebody's desk, it is an ekran round with no
      // physical proof to receive, or the matbaa hasn't handed it back yet.
      if (row.state !== 'pending') badRequest('Bu parça şu anda onay bekleyen bir parça değil.')
      if (row.route === 'ekran') badRequest('Ekran turunda teslim alma yapılmaz.')
      badRequest('Bu parça henüz teslim edilmedi.')
    }

    return upsertParcaState(client, projectId, parca, parcaReceivePatch({
      actor,
      actorName: actor?.name ?? 'Bilinmeyen',
      now: new Date().toISOString(),
      // Carried back in: the upsert writes the delivery stamps verbatim, so
      // omitting this would erase the delivery we are acknowledging.
      deliveredAt: row.delivered_at,
    }))
  })
}

/**
 * POST /api/projects/:id/parca/:parca/request-round — the designer revized this
 * parça and is sending it back round.
 *
 * `route` is required and mirrors the project-level post-revize picker: a
 * physical round goes to the matbaa, an Ekran round goes straight back to the
 * leader with no print at all.
 */
export async function requestParcaRound(projectId, parca, actor, { route } = {}) {
  return withTx(async (client) => {
    const { project, row } = await loadParcaForUpdate(client, projectId, parca)
    const assignees = await loadProjectAssignees(client, project)
    const isAssignedDesigner = actor?.role === 'designer'
      && assignees.some((a) => a.id === actor?.id)
    // A leader may send a parça back round on the designer's behalf — the same
    // latitude `canRequestOzalit` gives them on the project-level round.
    if (!isAssignedDesigner && actor?.role !== 'team_leader') {
      badRequest('Bu parçayı yalnızca atanmış tasarımcı veya ekip lideri gönderebilir.')
    }
    if (row.state !== 'with_designer') {
      badRequest('Bu parça revizede değil.')
    }
    const updated = await upsertParcaState(
      client, projectId, parca, parcaRequestRoundPatch({ route, now: new Date().toISOString() }),
    )
    // An ekran round skips the matbaa entirely, so the parça is back at the
    // gate the moment the designer sends it — clear its rejection row now. A
    // physical round keeps it: the parça is still out, just with the matbaa
    // instead of the designer, and `deliverParca` clears it on arrival. Neither
    // touches the receipt flag; nothing has been printed.
    if (route === 'ekran') {
      await settleParcaAtGate(client, project, parca, { received: false })
    }
    if (route === 'physical') {
      const printers = await activeUserIdsByRole(client, 'printer')
      await emit(client, {
        recipientIds: printers,
        actorId: actor?.id,
        type: 'parca_round_requested',
        tone: 'blue',
        title: project.title,
        projectId: project.id,
        body: `${parca} için yeni tur bekleniyor`,
        link: `/projects/${project.id}?action=teslim`,
        event: { type: 'project.parca_round_requested', aggregateId: project.id },
      })
    } else {
      const leaders = await activeUserIdsByRole(client, 'team_leader')
      await emit(client, {
        recipientIds: leaders,
        actorId: actor?.id,
        type: 'parca_ekran_pending',
        tone: 'amber',
        title: project.title,
        projectId: project.id,
        body: `${parca} ekran onayı bekleniyor`,
        link: `/projects/${project.id}`,
        event: { type: 'project.parca_ekran_pending', aggregateId: project.id },
      })
    }
    return updated
  })
}

/* ----------------------------------------------------------------------------
 * The change-request handshake, per parça (migration 077)
 *
 * The project-level trio (computeDemoChangeRequest / Accept / Decline) reads
 * `projects.demo_started`, which a split round never sets — `startParca` leaves
 * it alone on purpose. These are the same three verbs reading the parça's own
 * `started_at` instead, so the handshake works on exactly the rounds it could
 * not reach before.
 *
 * They stay out of `runProjectCommand` for the reason at the top of this file:
 * not one of them touches a project column.
 * -------------------------------------------------------------------------- */

/**
 * POST /api/projects/:id/parca/:parca/change-request — the leader asks the
 * matbaa to release a parça they have already started.
 *
 * Team-leader-only, matching `canEditSentDemoRequest` and the project-level
 * request: this reopens an edit window, and two people holding it at once is
 * the race migration 049's follow-up removed rather than narrowed. Keeps the
 * trio (cancel, edit-notify, change-request) consistently gated to the one
 * role per pipeline.js's `canRequestDemoChange` note.
 */
export async function requestParcaChange(projectId, parca, actor, { note } = {}) {
  return withTx(async (client) => {
    const { project, row } = await loadParcaForUpdate(client, projectId, parca)
    if (actor?.role !== 'team_leader') {
      badRequest('Değişiklik talebini yalnızca ekip lideri yapabilir.')
    }
    if (row.change_requested_at) {
      badRequest('Bu parça için zaten bekleyen bir değişiklik talebi var.')
    }
    if (!parcaChangeRequestable(row)) {
      // Two ways to be here and they mean opposite things to the leader: the
      // parça is still free to edit, or it was already released and the
      // correction is the thing that is missing.
      if (row.fix_pending) {
        badRequest('Talebiniz kabul edildi, formu güncelleyerek düzeltmeyi gönderin.')
      }
      badRequest('Matbaa bu parçaya henüz başlamadı, doğrudan düzenleyebilirsiniz.')
    }
    const updated = await upsertParcaState(client, projectId, parca, parcaChangeRequestPatch({
      note,
      actor,
      actorName: actor?.name ?? 'Bilinmeyen',
      now: new Date().toISOString(),
      // Restated because upsertParcaState writes the round stamps verbatim —
      // dropping it here would tell the matbaa's queue they never started.
      startedAt: row.started_at,
    }))

    const printers = await activeUserIdsByRole(client, 'printer')
    await emit(client, {
      recipientIds: printers,
      actorId: actor?.id,
      type: 'parca_change_requested',
      tone: 'amber',
      title: project.title,
      projectId: project.id,
      body: `${parca} için değişiklik istendi`,
      link: `/projects/${project.id}`,
      event: { type: 'project.parca_change_requested', aggregateId: project.id },
    })
    return updated
  })
}

/**
 * POST /api/projects/:id/parca/:parca/change-accept — the matbaa releases it.
 *
 * The parça goes back to `with_matbaa` (un-started) carrying `fix_pending`, so
 * the leader's edit is free again and `startParca` refuses until it lands. Same
 * two-step the project-level accept performs, and for the same reason: without
 * the debt, the matbaa could accept and immediately re-start, closing the
 * window they just opened.
 */
export async function acceptParcaChange(projectId, parca, actor) {
  return withTx(async (client) => {
    const { project, row } = await loadParcaForUpdate(client, projectId, parca)
    if (actor?.role !== 'printer') {
      badRequest('Bu işlemi yalnızca matbaa yapabilir.')
    }
    if (!row.change_requested_at) {
      badRequest('Bu parça için bekleyen bir değişiklik talebi yok.')
    }
    const updated = await upsertParcaState(client, projectId, parca, parcaChangeAcceptPatch())

    const leaders = await activeUserIdsByRole(client, 'team_leader')
    await emit(client, {
      recipientIds: leaders,
      actorId: actor?.id,
      type: 'parca_change_accepted',
      tone: 'blue',
      title: project.title,
      projectId: project.id,
      body: `${parca} için değişiklik kabul edildi, düzeltmeyi gönderin`,
      link: `/projects/${project.id}`,
      event: { type: 'project.parca_change_accepted', aggregateId: project.id },
    })
    return updated
  })
}

/**
 * POST /api/projects/:id/parca/:parca/change-decline — the matbaa says no.
 *
 * Only the question is cleared. The parça stays started and stays theirs, and
 * the leader's remaining move is the one they always had at the gate: take
 * delivery and reject it there.
 */
export async function declineParcaChange(projectId, parca, actor) {
  return withTx(async (client) => {
    const { project, row } = await loadParcaForUpdate(client, projectId, parca)
    if (actor?.role !== 'printer') {
      badRequest('Bu işlemi yalnızca matbaa yapabilir.')
    }
    if (!row.change_requested_at) {
      badRequest('Bu parça için bekleyen bir değişiklik talebi yok.')
    }
    const updated = await upsertParcaState(
      client, projectId, parca, parcaChangeDeclinePatch({ startedAt: row.started_at }),
    )

    const leaders = await activeUserIdsByRole(client, 'team_leader')
    await emit(client, {
      recipientIds: leaders,
      actorId: actor?.id,
      type: 'parca_change_declined',
      tone: 'amber',
      title: project.title,
      projectId: project.id,
      body: `${parca} için değişiklik talebi reddedildi, teslim bekleniyor`,
      link: `/projects/${project.id}`,
      event: { type: 'project.parca_change_declined', aggregateId: project.id },
    })
    return updated
  })
}

/** Exposed for the queue badge counts, which only need a number. */
export async function countMyParcaQueue(actor) {
  const rows = await listMyParcaQueue(actor)
  return rows.length
}
