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
  canActOnParca,
} from '../domain/parca-routing.js'
import {
  listParcaState,
  listParcaStateByOwner,
  upsertParcaState,
} from './parca-state-repository.js'
import {
  getProjectForUpdate,
  loadProjectAssignees,
  loadLatestDemoSnapshot,
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
  // A leader has no per-parça queue of their own: their work is the approval
  // gate, which the parça grid on the project already shows.
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

/** Exposed for the queue badge counts, which only need a number. */
export async function countMyParcaQueue(actor) {
  const rows = await listMyParcaQueue(actor)
  return rows.length
}
