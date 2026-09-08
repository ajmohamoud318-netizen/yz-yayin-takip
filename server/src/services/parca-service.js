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
} from './parca-state-repository.js'
import {
  getProjectForUpdate,
  loadProjectAssignees,
  loadLatestDemoSnapshot,
  patchProject,
} from './project-repository.js'
import { advanceProject } from './project-service/transitions.js'
import { emit, activeUserIdsByRole } from './notifications.js'

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
  if (actor?.role === 'printer') {
    const routed = await listParcaStateByOwner(null, 'printer', ['with_matbaa', 'in_round'])
    const fresh = await deriveTeslimParcalar(routed)
    return [...routed, ...fresh]
  }
  if (actor?.role === 'designer') {
    return listParcaStateByOwner(null, 'designer', ['with_designer'])
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
    return rows.filter((row) => {
      const signed = row.gate === 'ozalit'
        ? Array.isArray(row.ozalit_parca_approvals?.[row.parca])
          && row.ozalit_parca_approvals[row.parca].length > 0
        : (row.demo_parca_approvals ?? []).some((a) => a?.parca === row.parca)
      return !signed
    }).map(({ demo_parca_approvals, ozalit_parca_approvals, ...row }) => row)
  }
  return []
}

/** Stages where the matbaa owes a whole round, and the sheet each reads from. */
const TESLIM_GATES = {
  demo_teslim: 'demo',
  cin_demo_teslim: 'demo',
  ozalit_teslim: 'ozalit',
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
 */
async function deriveTeslimParcalar(routed) {
  const pool = getPool()
  const stages = Object.keys(TESLIM_GATES)
  const { rows: projects } = await pool.query(
    `SELECT id, title, stage, type, ozalit_requested, reject_target
       FROM projects
      WHERE stage = ANY($1) AND deleted_at IS NULL`,
    [stages],
  )
  const seen = new Set(routed.map((r) => `${r.project_id}|${r.parca}`))
  const out = []
  for (const p of projects) {
    // An ozalit round only belongs to the matbaa once it has been requested,
    // or bounced back to them. Same rule as `isOzalitRoundLive`.
    if (p.stage === 'ozalit_teslim' && !p.ozalit_requested && p.reject_target !== 'matbaa') continue
    const gate = TESLIM_GATES[p.stage]
    const snapshot = await loadLatestDemoSnapshot(pool, p.id, gate)
    const parcalar = snapshot?.selectedComponents ?? []
    // Single-parça (or snapshot-less) rounds keep the whole-project card they
    // have always had — splitting a one-parça sheet into a "parça queue" of
    // one is noise, and the project row already says everything.
    if (parcalar.length < 2) continue
    const { rows: existing } = await pool.query(
      'SELECT parca, state, started_at FROM parca_state WHERE project_id = $1',
      [p.id],
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
        attempt: snapshot?.attempt ?? 1,
        started_at: row?.started_at ?? null,
        delivered_at: null,
        reason: null,
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
  const { rows } = await client.query(
    'SELECT * FROM parca_state WHERE project_id = $1 AND parca = $2 FOR UPDATE',
    [projectId, parca],
  )
  if (rows[0]) return { project, row: rows[0] }

  // No row yet. On a teslim round that is normal rather than an error: the
  // parçalar are derived from the round's sheet (see deriveTeslimParcalar) and
  // a row is only written the moment someone actually acts on one. Materialise
  // it here, on the first action, so the matbaa can work a fresh round
  // parça-by-parça without anything having been seeded up front.
  const gate = TESLIM_GATES[project.stage]
  if (!gate) notFound('Parça bulunamadı.')
  const snapshot = await loadLatestDemoSnapshot(client, projectId, gate)
  if (!(snapshot?.selectedComponents ?? []).includes(parca)) {
    notFound('Parça bu turda yok.')
  }
  const created = await upsertParcaState(client, projectId, parca, {
    gate,
    state: 'with_matbaa',
    owner_role: 'printer',
    route: 'physical',
    attempt: snapshot?.attempt ?? 1,
  })
  return { project, row: created }
}

/**
 * Is every parça of this round now off the matbaa's desk?
 *
 * Only then does the PROJECT move — a partial delivery leaves it at its teslim
 * stage, which is the whole point: the parçalar the matbaa hasn't done stay
 * theirs until they do.
 */
async function allParcalarDelivered(client, project, gate) {
  const snapshot = await loadLatestDemoSnapshot(client, project.id, gate)
  const parcalar = snapshot?.selectedComponents ?? []
  if (parcalar.length < 2) return true // single-parça round: the old whole-sheet behaviour
  const { rows } = await client.query(
    'SELECT parca, state FROM parca_state WHERE project_id = $1',
    [project.id],
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
    if (!canActOnParca(actor, row)) {
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
 * the race migration 049's follow-up removed rather than narrowed.
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
