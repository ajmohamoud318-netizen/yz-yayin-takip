/**
 * Server-side pure transition helpers — the project state machine.
 *
 * Mirrors `client/src/infrastructure/mock/helpers/project-transitions.js`
 * exactly so the SPA and the API agree on every advance / approve / reject
 * decision. Kept as a separate copy (rather than importing from the client)
 * because:
 *
 *   • The Dokploy / Nixpacks build image ships `server/` only — `client/`
 *     files aren't on disk at runtime, so a relative import into the client
 *     tree resolves to `/client/...` and Node ESM throws ERR_MODULE_NOT_FOUND
 *     on boot. That was the root cause of the 502 we just hit.
 *   • ESM resolves bare relative paths to file-system root unless they're
 *     written as `./` (relative) — and even then, the client tree isn't
 *     part of the server's deployment artefact.
 *
 * Sync rule: when the client helpers change, mirror the change here in
 * the same PR. The two files are kept in lock-step via code review; the
 * server's own Vitest suite (`pipeline.test.js`) covers the same cases
 * the client test does.
 */

import { randomUUID } from 'node:crypto'

import { STAGE_PIPELINE, STAGES_REQUIRING_FULL_PROGRESS } from './stages.js'
import { subtaskProgress } from './progress.js'
import { HttpError } from './errors.js'

/** Match the client's badRequest semantics — throw a 400. */
function badRequest(message) {
  throw new HttpError(400, message, 'bad_request')
}

/** UUID for new history rows. */
function uid(prefix = '') {
  return prefix ? `${prefix}-${randomUUID()}` : randomUUID()
}

/** Get the pipeline for a project (TR or ÇİN). */
function pipelineFor(project) {
  return project.type === 'CIN' ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR
}

/** Build a canonical stage_history entry. */
function makeEntry(project, partial) {
  return {
    id: uid(`${project.id}-h`),
    project_id: project.id,
    created_at: new Date().toISOString(),
    ...partial,
  }
}

/**
 * Only the team_leader or the *assigned* designer may initiate an ozalit
 * request. A designer must be in project.assignees — this matches the SPA's
 * `isAssignedDesigner` gate (ProjectDetail.jsx). The advance route hydrates
 * project.assignees via loadProjectAssignees before calling into here, so an
 * unassigned designer no longer slips past a role-only check.
 */
function canRequestOzalit(actor, project) {
  if (actor?.role === 'team_leader') return true
  if (actor?.role === 'designer') {
    return (project?.assignees ?? []).some((a) => a.id === actor?.id)
  }
  return false
}

/**
 * Who may approve at the given stage?
 *   demo_onay | cin_demo_onay → team_leader, printer
 *   ozalit_onay               → team_leader (single-step)
 *   other approval stages     → team_leader (default, single-step)
 */
function canApproveAt(stage, actor) {
  if (!actor) return false
  if (actor.role === 'team_leader') return true
  if (stage === 'demo_onay' || stage === 'cin_demo_onay') {
    return actor.role === 'printer'
  }
  return false
}

/**
 * Who may reject at the given stage?
 *   team_leader          → at ANY stage
 *   everyone else        → 403
 */
function canRejectAt(stage, actor) {
  if (!actor) return false
  if (actor.role === 'team_leader') return true
  return false
}

/* ============================================================================
 *  Per-parça approval helpers (migrations 068/069/070)
 *
 *  Every proof gate — demo_onay, ozalit_onay, baski_onay, ekran-demo,
 *  ekran-ozalit — refuses to advance until every parça the designer put
 *  on the latest snapshot's `_selectedComponents` has the required party
 *  sign-off recorded in the matching per-parça ledger. The FSM never
 *  trusts project-level approval to mean per-parça approval: a leader
 *  click on the project card without the matching per-parça row just
 *  adds an entry to the ledger, the stage stays put until the set is
 *  full.
 * ========================================================================== */

/** Derive the parça list for the latest snapshot of the given kind. */
function snapshotParcalar(ctx, kind) {
  if (!ctx || !ctx.snapshot) return []
  return Array.isArray(ctx.snapshot.selectedComponents) ? ctx.snapshot.selectedComponents : []
}

/** Demo (TR + ÇİN): which parçalar are still owed on the demo round. */
function demoPendingParcalar(project, ctx) {
  const set = new Set(snapshotParcalar(ctx, 'demo'))
  const approved = new Set(
    (project.demo_parca_approvals ?? []).map((a) => a?.parca).filter(Boolean),
  )
  return [...set].filter((p) => !approved.has(p))
}

/** Ozalit: which parçalar haven't yet collected every required party. */
function ozalitParcaApprovedBy(project, parca) {
  const ledger = project.ozalit_parca_approvals ?? {}
  return Array.isArray(ledger[parca]) ? ledger[parca] : []
}

function ozalitPendingParcalar(project, ctx) {
  const parcalar = snapshotParcalar(ctx, 'ozalit')
  const required = ctx?.required ?? { leaderIds: [], designerIds: [] }
  const requiredIds = new Set([...(required.leaderIds ?? []), ...(required.designerIds ?? [])])
  return parcalar.filter((parca) => {
    if (requiredIds.size === 0) return true
    const got = new Set(ozalitParcaApprovedBy(project, parca).map((a) => a?.id))
    for (const id of requiredIds) if (!got.has(id)) return true
    return false
  })
}

/** Baski: which parçalar are missing the approver (preparer-only is OK). */
function baskiPendingParcalar(project, ctx) {
  const parcalar = snapshotParcalar(ctx, 'baski_onay')
  const preparers = project.baski_parca_preparers ?? {}
  const approvals = project.baski_parca_approvals ?? {}
  return parcalar.filter((parca) => {
    if (!preparers[parca]) return true // preparer missing → not ready
    if (!approvals[parca]) return true // approver missing → not ready
    return approvals[parca].by === preparers[parca].by // same leader → not ready
  })
}

/** Cin mirror of baski — same dual-leader rule. */
function cinBaskiPendingParcalar(project, ctx) {
  const parcalar = snapshotParcalar(ctx, 'baski_onay')
  const preparers = project.cin_baski_parca_preparers ?? {}
  const approvals = project.cin_baski_parca_approvals ?? {}
  return parcalar.filter((parca) => {
    if (!preparers[parca]) return true
    if (!approvals[parca]) return true
    return approvals[parca].by === preparers[parca].by
  })
}

/** Ekran demo: which parçalar haven't been approved yet (leader only). */
function ekranDemoPendingParcalar(project, ctx) {
  const set = new Set(snapshotParcalar(ctx, 'demo'))
  const approved = new Set(
    (project.demo_parca_approvals ?? [])
      .filter((a) => a?.via === 'ekran')
      .map((a) => a?.parca)
      .filter(Boolean),
  )
  return [...set].filter((p) => !approved.has(p))
}

/** Ekran ozalit: which parçalar haven't been ekran-approved yet. */
function ekranOzalitPendingParcalar(project, ctx) {
  const set = new Set(snapshotParcalar(ctx, 'ozalit'))
  const approved = new Set(
    (project.ozalit_parca_approvals ?? {})
      ? Object.entries(project.ozalit_parca_approvals)
          .filter(([, ledger]) => Array.isArray(ledger) && ledger.some((a) => a?.via === 'ekran'))
          .map(([parca]) => parca)
      : [],
  )
  return [...set].filter((p) => !approved.has(p))
}

/** Validate the per-parça payload: array of non-empty strings. */
function sanitiseParcalar(parcalar, fallback = []) {
  if (parcalar == null) return fallback
  if (!Array.isArray(parcalar)) badRequest('Parça listesi geçersiz.')
  const out = []
  for (const p of parcalar) {
    if (typeof p !== 'string' || !p.trim()) badRequest('Parça adı boş olamaz.')
    out.push(p.trim())
  }
  return [...new Set(out)]
}

/** Approve a set of parçalar in a demo-shaped ledger (list of { parca, by, by_name, at, via? }). */
function appendParcaApprovals(ledger, parcalar, actor, actorName, now, via = null) {
  const list = Array.isArray(ledger) ? [...ledger] : []
  for (const parca of parcalar) {
    // Skip if this exact approver already signed this parça (no double-stamping).
    if (list.some((a) => a?.parca === parca && a?.by === actor?.id && a?.via === via)) continue
    list.push({
      parca,
      by: actor?.id ?? null,
      by_name: actorName,
      at: now,
      via,
    })
  }
  return list
}

/** Approve a per-parça row in an ozalit-shaped ledger (`{ '<parca>': [{id, role, name, at}] }`). */
function appendOzalitParcaApprovals(ledger, parcalar, actor, actorName, now, via = null) {
  const next = ledger && typeof ledger === 'object' ? { ...ledger } : {}
  for (const parca of parcalar) {
    const list = Array.isArray(next[parca]) ? [...next[parca]] : []
    if (list.some((a) => a?.id === actor?.id && a?.via === via)) continue
    list.push({ id: actor?.id ?? null, role: actor?.role ?? null, name: actorName, at: now, via })
    next[parca] = list
  }
  return next
}

/** Record a single leader-side per-parça row (preparer OR approver). */
function appendBaskiParcaRow(ledger, parcalar, actor, actorName, now) {
  const next = ledger && typeof ledger === 'object' ? { ...ledger } : {}
  for (const parca of parcalar) {
    next[parca] = { by: actor?.id ?? null, by_name: actorName, at: now }
  }
  return next
}

/** Record per-parça rejections (list of { parca, by, by_name, at, reason, target }). */
function appendParcaRejections(ledger, parcalar, actor, actorName, now, reason, target) {
  const list = Array.isArray(ledger) ? [...ledger] : []
  for (const parca of parcalar) {
    list.push({
      parca,
      by: actor?.id ?? null,
      by_name: actorName,
      at: now,
      reason: reason ?? null,
      target: target ?? null,
    })
  }
  return list
}

/**
 * Drop parça rows that are no longer on the snapshot. Called when a
 * designer re-sends a demo with a different `_selectedComponents` so an
 * approval from a parça that was unselected doesn't carry over into a
 * round that no longer includes it.
 */
function pruneApprovalsToSnapshot(ledger, snapshotParcalar, isObject = false) {
  const keep = new Set(snapshotParcalar)
  if (isObject) {
    const next = {}
    for (const [parca, value] of Object.entries(ledger ?? {})) {
      if (keep.has(parca)) next[parca] = value
    }
    return next
  }
  return (ledger ?? []).filter((row) => row && keep.has(row.parca))
}

function pruneRejectionsToSnapshot(ledger, snapshotParcalar) {
  const keep = new Set(snapshotParcalar)
  return (ledger ?? []).filter((row) => row && keep.has(row.parca))
}

/** Drop a parça's row from a ledger (used by per-parça rejection). */
function dropParcaFromList(ledger, parcalar) {
  const drop = new Set(parcalar)
  return (ledger ?? []).filter((row) => !drop.has(row?.parca))
}

function dropParcaFromObject(ledger, parcalar) {
  const drop = new Set(parcalar)
  const next = {}
  for (const [parca, value] of Object.entries(ledger ?? {})) {
    if (!drop.has(parca)) next[parca] = value
  }
  return next
}

/* ============================================================================
 *  advance(project, actor) → next project state
 * ========================================================================== */

export function computeAdvance(project, actor, { route = null } = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'

  // Resubmit gate: a project after a reject-to-designer can't move forward
  // until the designer has revized every flagged subtask. The flagged
  // subtasks stay complete (progress unchanged); each must be cleared via
  // the Revize action first. (The advance route loads subtasks so this
  // guard can see them; a first submission has no needs_revize flags.)
  //
  // Two shapes: a generic forward advance from tasarim checks the revize
  // pile directly (older demo-redo leg); the in-place ozalit redo leg
  // stays on ozalit_onay with last_reject_type='ozalit' and is gated by
  // the same pile when those two conditions are both true. The split
  // matches the upstream stages the rest of computeAdvance branches on.
  const pendingRevize = (project.subtasks ?? []).some((s) => s.needs_revize)
  const tasarimLeg = project.stage === 'tasarim' && pendingRevize
  const ozalitRedoLeg =
    project.stage === 'ozalit_onay' &&
    project.last_reject_type === 'ozalit' &&
    pendingRevize
  if (tasarimLeg || ozalitRedoLeg) {
    badRequest('Revize bekleyen alt görevler var, hepsini revize etmeden gönderemezsiniz.')
  }

  // 1) Ozalit revision resubmit — designer finished a redesign after a
  // previous ozalit rejection. The designer chooses how the fix gets checked:
  //
  //   'ozalit' → another PHYSICAL round: ozalit_teslim, matbaa delivers a
  //              proof, then the full multi-party ozalit_onay sign-off.
  //   'ekran'  → an EKRAN OZALIT (migration 061): straight to ozalit_onay
  //              with no matbaa leg and no receipt gate, signed off by a
  //              single team leader.
  //
  // The choice is mandatory, mirroring the sipariş pipeline's equivalent
  // moment (`_resolveAdvanceTarget`, domain/entities/Order.js): the person who
  // did the revision is the one who knows whether it needs ink on paper, so
  // defaulting it silently would put that call back on whoever clicks first.
  //
  // Trigger stage is ozalit_onay (not tasarim): an ozalit rejection leaves the
  // project on ozalit_onay with last_reject_type='ozalit' rather than bouncing
  // it all the way back to tasarim — the designer revizes in-place and then
  // picks the route here. Demo rejections still bounce to tasarim and route
  // through the generic forward-advance below, so this branch only fires on
  // the ozalit redo cycle.
  if (project.stage === 'ozalit_onay' && project.last_reject_type === 'ozalit') {
    if (!route) {
      badRequest('Revize sonrası Ozalit mi yoksa Ekran Ozalit mi isteneceğini seçmelisiniz.')
    }
    if (route !== 'ozalit' && route !== 'ekran') {
      badRequest('Geçersiz ozalit seçimi.')
    }
    const cleared = {
      last_reject_type: null,
      last_reject_reason: null,
      last_reject_target: null,
      reject_target: null,
      updated_at: now,
    }
    if (route === 'ekran') {
      assertCanEnterProductionLocal('ozalit_onay', project.progress)
      return {
        project: {
          ...project,
          ...cleared,
          stage: 'ozalit_onay',
          ekran_ozalit: true,
          ozalit_requested: false,
          // Nothing physical arrives, so nothing can be "Teslim Alındı" —
          // the receipt gate is skipped for this round rather than faked,
          // and the flag stays honest about what was actually received.
          ozalit_received: false,
          ozalit_received_by: null,
          ozalit_received_at: null,
          ozalit_approvals: [],
          // ozalit_attempt is deliberately NOT bumped: computeRejection
          // already counted this round when it bounced the ozalit back, and
          // the physical route below doesn't bump it either. Counting here
          // would number a screen round one higher than the physical round
          // it replaced.
        },
        history: makeEntry(project, {
          action: 'advance',
          event: 'ekran_ozalit_requested',
          from_stage: 'ozalit_onay',
          to_stage: 'ozalit_onay',
          done_by_name: actorName,
          note: 'Ozalit revizyonu tamamlandı, ekran ozalit onayına gönderildi',
        }),
      }
    }
    assertCanEnterProductionLocal('ozalit_teslim', project.progress)
    return {
      project: {
        ...project,
        ...cleared,
        stage: 'ozalit_teslim',
        ekran_ozalit: false,
        ozalit_requested: true,
      },
      history: makeEntry(project, {
        action: 'advance',
        from_stage: 'ozalit_onay',
        to_stage: 'ozalit_teslim',
        done_by_name: actorName,
        note: 'Ozalit revizyonu tamamlandı, matbaaya gönderildi',
      }),
    }
  }

  // A route is only ever meaningful on that one resubmit click. Refusing it
  // everywhere else stops a stale picker from silently no-op'ing (same rule
  // the sipariş pipeline states as "Onay seçimi yalnızca ozalit isteme
  // adımında yapılabilir").
  if (route != null) {
    badRequest('Ozalit seçimi yalnızca revize sonrası gönderimde yapılabilir.')
  }

  // 2) Re-send a demo at a demo stage. The matbaa delivers at
  // {demo_teslim, cin_demo_teslim}. A re-send by the team leader or
  // assigned designer is only valid on a HELD demo (approved at <100%
  // — the designer has since finished and is sending the next round).
  // A demo still with the matbaa (demo_teslim / cin_demo_teslim) or one
  // freshly delivered and awaiting the leader's decision (demo_onay,
  // demo_held falsey) is "in progress" and must be delivered / approved /
  // rejected first — you can't spawn a duplicate demo alongside it.
  if (
    project.stage === 'demo_teslim' ||
    project.stage === 'demo_onay' ||
    project.stage === 'cin_demo_teslim' ||
    project.stage === 'cin_demo_onay'
  ) {
    const role = actor?.role
    const isAssigned = (project.assignees ?? []).some((a) => a.id === actor?.id)
    // The matbaa delivers at demo_teslim → demo_onay.
    if (role === 'printer') {
      if (project.stage === 'demo_teslim' || project.stage === 'cin_demo_teslim') {
        const approvalStage =
          project.stage === 'cin_demo_teslim' ? 'cin_demo_onay' : 'demo_onay'
        return computeDemoTeslimAdvance(project, actor, now, approvalStage)
      }
      badRequest('Matbaa yalnızca demo teslim aşamasında ilerletebilir.')
    }
    if (role !== 'team_leader' && !isAssigned) {
      badRequest('Tekrar demo göndermek için ekip lideri veya atanmış tasarımcı olmalısınız.')
    }
    // Only a held demo may be re-sent. Otherwise a demo is already in
    // progress (with the matbaa, or awaiting the leader's approve/reject).
    if (project.demo_held !== true) {
      badRequest('Devam eden bir demo var, yeni demo istemeden önce mevcut demo teslim edilmeli, onaylanmalı veya reddedilmelidir.')
    }
    // Re-send starts a new demo round at the *_teslim stage so the
    // matbaa (TR) / leader (ÇİN) immediately receives the new demo —
    // per AGENTS.md the loop re-runs demo_onay → demo_teslim →
    // demo_onay. demo_attempt is bumped so the 'Demo N' badge and the
    // form snapshot reflect the iteration. (Previously this reverted
    // to tasarim, which silently dropped the project out of the
    // matbaa's queue and never logged a "Demoya Gönderildi" entry.)
    const resendStage = project.type === 'CIN' ? 'cin_demo_teslim' : 'demo_teslim'
    return {
      project: {
        ...project,
        stage: resendStage,
        demo_attempt: (project.demo_attempt ?? 0) + 1,
        demo_held: false,
        demo_held_at: null,
        demo_held_by_name: null,
        demo_delivered_at: null,
        demo_delivered_by: null,
        demo_delivered_by_name: null,
        // New round starts fresh — see the matching comment in computeDemoTeslimAdvance.
        demo_started: false,
        demo_started_at: null,
        demo_started_by: null,
        demo_started_by_name: null,
        demo_change_requested_at: null,
        demo_change_requested_by: null,
        demo_change_requested_by_name: null,
        demo_change_requested_note: null,
        demo_fix_pending: false,
        // A pending Ekran Demo Onayı request belonged to the round that just
        // ended — carrying it into the new round would permanently block a
        // future ekran-demo request (computeEkranDemoRequest refuses while
        // ekran_demo_requested_at is set) with no way to clear it, since
        // approve/reject both require the demo_onay stage this round just left.
        ekran_demo_requested_at: null,
        ekran_demo_requested_by: null,
        ekran_demo_requested_by_name: null,
        reject_target: null,
        last_reject_reason: null,
        last_reject_type: null,
        last_reject_target: null,
        updated_at: now,
      },
      history: makeEntry(project, {
        action: 'advance',
        from_stage: project.stage,
        to_stage: resendStage,
        done_by_name: actorName,
        note: project.type === 'CIN'
          ? 'Yeni demo gönderildi'
          : 'Yeni demo matbaaya gönderildi',
      }),
    }
  }

  // 3) Ozalit Teslim dual-step.
  if (project.stage === 'ozalit_teslim') {
    return computeOzalitTeslimAdvance(project, actor, now)
  }

  // 4) Generic forward advance.
  const pipeline = pipelineFor(project)
  const i = pipeline.indexOf(project.stage)
  if (i === -1 || i === pipeline.length - 1) {
    return { project, history: null }
  }
  const next = pipeline[i + 1]
  if (next === 'satista') {
    badRequest('Satışta aşamasına yalnızca Satış ekibi teslimi onayladığında geçilir.')
  }
  assertCanEnterProductionLocal(next, project.progress)
  return {
    project: {
      ...project,
      stage: next,
      reject_target: null,
      last_reject_reason: null,
      last_reject_type: null,
      last_reject_target: null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'advance',
      from_stage: project.stage,
      to_stage: next,
      done_by_name: actorName,
    }),
  }
}

function computeDemoTeslimAdvance(project, actor, now, approvalStage) {
  if (actor?.role !== 'printer') {
    badRequest('Demo teslimini yalnızca matbaa yapabilir.')
  }
  // A pending change-request must be accepted or declined before the matbaa
  // can deliver past it — otherwise the leader/designer's ask silently
  // vanishes the moment delivery happens.
  if (project.demo_change_requested_at != null) {
    badRequest('Bekleyen bir değişiklik talebi var, önce kabul veya reddedin.')
  }
  assertCanEnterProductionLocal(approvalStage, project.progress)
  return {
    project: {
      ...project,
      stage: approvalStage,
      demo_delivered_by: actor?.id ?? null,
      demo_delivered_by_name: actor?.name ?? 'Bilinmeyen',
      demo_delivered_at: now,
      // Fresh delivery → clear any prior "received" ack; a designer/leader must
      // acknowledge this delivery before it can be approved.
      demo_received: false,
      demo_received_by: null,
      demo_received_at: null,
      // A new round starts fresh — the "Başladım" gate and any leftover
      // change-request ledger from the round that just ended don't carry over.
      demo_started: false,
      demo_started_at: null,
      demo_started_by: null,
      demo_started_by_name: null,
      demo_change_requested_at: null,
      demo_change_requested_by: null,
      demo_change_requested_by_name: null,
      demo_change_requested_note: null,
      demo_fix_pending: false,
      ekran_demo_requested_at: null,
      ekran_demo_requested_by: null,
      ekran_demo_requested_by_name: null,
      reject_target: null,
      last_reject_reason: null,
      last_reject_type: null,
      last_reject_target: null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'advance',
      from_stage: project.stage,
      to_stage: approvalStage,
      done_by_name: actor?.name ?? 'Bilinmeyen',
      note: 'Demo teslim edildi, onaya gönderildi',
    }),
  }
}

function computeOzalitTeslimAdvance(project, actor, now) {
  const isPrinter = actor?.role === 'printer'
  const matbaaLock = project.reject_target === 'matbaa'

  if (!isPrinter) {
    if (!canRequestOzalit(actor, project)) {
      badRequest('Yalnızca ekip lideri veya atanmış tasarımcı ozalit isteyebilir.')
    }
    if (project.ozalit_requested) {
      badRequest('Ozalit zaten istendi, matbaa teslimi bekleniyor.')
    }
    return {
      project: { ...project, ozalit_requested: true, updated_at: now },
      history: makeEntry(project, {
        action: 'advance',
        from_stage: 'ozalit_teslim',
        to_stage: 'ozalit_teslim',
        done_by_name: actor?.name ?? 'Bilinmeyen',
        note: 'Ozalit istendi, matbaa teslimi bekleniyor',
      }),
    }
  }

  if (!project.ozalit_requested && !matbaaLock) {
    badRequest('Önce ekip lideri veya tasarımcı ozalit istemelidir.')
  }
  // Same pending-change-request guard as the demo leg — see computeDemoTeslimAdvance.
  if (project.ozalit_change_requested_at != null) {
    badRequest('Bekleyen bir değişiklik talebi var, önce kabul veya reddedin.')
  }
  assertCanEnterProductionLocal('ozalit_onay', project.progress)
  return {
    project: {
      ...project,
      stage: 'ozalit_onay',
      ozalit_requested: false,
      // Fresh delivery → clear any prior "received" ack; a designer/leader must
      // acknowledge this proof before it can be approved (mirrors the demo).
      ozalit_received: false,
      ozalit_received_by: null,
      ozalit_received_at: null,
      // New round starts fresh — see the matching comment in computeDemoTeslimAdvance.
      ozalit_started: false,
      ozalit_started_at: null,
      ozalit_started_by: null,
      ozalit_started_by_name: null,
      ozalit_change_requested_at: null,
      ozalit_change_requested_by: null,
      ozalit_change_requested_by_name: null,
      ozalit_change_requested_note: null,
      ozalit_fix_pending: false,
      reject_target: null,
      last_reject_reason: null,
      last_reject_type: null,
      last_reject_target: null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'advance',
      from_stage: 'ozalit_teslim',
      to_stage: 'ozalit_onay',
      done_by_name: actor?.name ?? 'Bilinmeyen',
      note: 'Ozalit teslim edildi, onaya gönderildi',
    }),
  }
}

/* ============================================================================
 *  approve(project, actor) → next project state
 * ========================================================================== */

export function computeApproval(project, actor, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'

  if (project.stage === 'ozalit_onay') {
    return computeOzalitOnayApproval(project, actor, now, actorName, ctx)
  }

  // Baskı Onayı: dual-approval (migration 045), also used by ÇİN's mirror
  // gate `cin_baski_onay` (migration 047) — same rule, same
  // baski_onay_prepared* columns, since a project only ever visits one
  // pipeline. One team leader PREPARES the form (computeBaskiOnayPrepare,
  // below) — that alone doesn't advance the stage. Only once prepared can
  // this approve fire, and it must come from a DIFFERENT team leader than
  // the preparer, unless the preparer is the only active team leader there
  // is (ctx.teamLeaderIds) — enforcing "different person" there would
  // strand the project with nobody left who could ever approve it.
  // canApproveAt already restricts this to team_leader for any stage other
  // than demo_onay/cin_demo_onay, but the explicit check gives a clear
  // Turkish error instead of falling through to the generic 400 below.
  if (project.stage === 'baski_onay' || project.stage === 'cin_baski_onay') {
    if (!canApproveAt(project.stage, actor)) {
      badRequest('Baskı onayını yalnızca ekip lideri yapabilir.')
    }
    if (!project.baski_onay_prepared) {
      badRequest('Önce baskı onay formu hazırlanmalıdır.')
    }
    const teamLeaderIds = ctx.teamLeaderIds ?? []
    const otherActiveLeaders = teamLeaderIds.filter((id) => id !== project.baski_onay_prepared_by)
    if (actor?.id === project.baski_onay_prepared_by && otherActiveLeaders.length > 0) {
      badRequest('Baskı onay formunu hazırlayan kişi kendi onayını veremez, başka bir ekip lideri onaylamalıdır.')
    }
    const pipeline = pipelineFor(project)
    const i = pipeline.indexOf(project.stage)
    const next = pipeline[i + 1]
    assertCanEnterProductionLocal(next, project.progress)
    return {
      project: {
        ...project,
        stage: next,
        baski_onay_prepared: false,
        baski_onay_prepared_by: null,
        baski_onay_prepared_by_name: null,
        baski_onay_prepared_at: null,
        updated_at: now,
      },
      history: makeEntry(project, {
        action: 'approve',
        from_stage: project.stage,
        to_stage: next,
        done_by_name: actorName,
        note: 'Baskı onaylandı, baskıya alındı',
      }),
    }
  }

  // Demo approval: leader OR printer can advance it.
  // New demo rule (see client pipeline.js#assertDemoCanAdvance): an approve
  // at <100% progress is recorded as a hold — the project stays at
  // `demo_onay` and a second demo is required after the designer finishes.
  // Per-parça gate (migrations 068/069/070): the project only moves past
  // demo_onay once every parça in the latest demo snapshot's
  // `_selectedComponents` has the leader's sign-off in the per-parça ledger.
  if (project.stage === 'demo_onay' || project.stage === 'cin_demo_onay') {
    if (!canApproveAt(project.stage, actor)) {
      badRequest('Demo onayını yalnızca ekip lideri veya matbaa yapabilir.')
    }
    // Gate: the delivered demo must be marked "Teslim Alındı" (received) by an
    // assigned designer or the team leader before it can be approved.
    if (!project.demo_received) {
      badRequest('Önce demo "Teslim Alındı" olarak işaretlenmelidir.')
    }
    // Per-parça gate: derive the parça list from the latest demo snapshot
    // the route passed through (ctx.snapshot). Empty list falls through to
    // the legacy single-parça shortcut so projects without a snapshot still
    // advance on a leader click.
    const snapshotParcalar = Array.isArray(ctx?.snapshot?.selectedComponents)
      ? ctx.snapshot.selectedComponents
      : []
    const ctxForGate = { snapshot: { selectedComponents: snapshotParcalar } }
    const pending = demoPendingParcalar(project, ctxForGate)
    // At <100% progress: hold the demo and record the per-parça sign-off so
    // the next round knows what's done. If the leader picked specific
    // parçalar (ctx.parcalar), only approve those — the rest stay pending.
    if ((project.progress ?? 0) < 100) {
      const requested = sanitiseParcalar(ctx?.parcalar, snapshotParcalar)
      const target = requested.length === 0
        ? pending
        : requested.filter((p) => pending.includes(p))
      if (pending.length > 0 && target.length === 0) {
        badRequest('Onaylanacak parça bulunamadı.')
      }
      const nextApprovals = appendParcaApprovals(
        project.demo_parca_approvals ?? [],
        target,
        actor,
        actorName,
        now,
      )
      return {
        project: {
          ...project,
          demo_parca_approvals: pruneApprovalsToSnapshot(nextApprovals, snapshotParcalar, false),
          demo_held: true,
          demo_held_at: now,
          demo_held_by_name: actorName,
          updated_at: now,
        },
        history: makeEntry(project, {
          action: 'approve',
          from_stage: project.stage,
          to_stage: project.stage,
          done_by_name: actorName,
          note: target.length > 0
            ? `Demo parçaları onaylandı: ${target.join(', ')} — tasarım tamamlanmadığı için Ozalit bekleniyor`
            : 'Demo onaylandı, tasarım tamamlanmadığı için Ozalit bekleniyor',
        }),
      }
    }
    // At 100% progress with at least one pending parça: bulk-approve the
    // remaining ones and advance. A leader who already inspected every
    // parça on this round may click once to clear the gate.
    if (pending.length > 0) {
      const nextApprovals = appendParcaApprovals(
        project.demo_parca_approvals ?? [],
        pending,
        actor,
        actorName,
        now,
      )
      const pipeline = pipelineFor(project)
      const stageIdx = pipeline.indexOf(project.stage)
      const next = pipeline[stageIdx + 1]
      if (!next) return { project, history: null }
      assertCanEnterProductionLocal(next, project.progress)
      return {
        project: {
          ...project,
          stage: next,
          demo_held: false,
          demo_parca_approvals: pruneApprovalsToSnapshot(nextApprovals, snapshotParcalar, false),
          updated_at: now,
        },
        history: makeEntry(project, {
          action: 'approve',
          from_stage: project.stage,
          to_stage: next,
          done_by_name: actorName,
          note: `Demo onaylandı: ${pending.join(', ')} dahil tüm parçalar`,
        }),
      }
    }
    // No parça on the snapshot (legacy single-parça shortcut) — advance.
    const pipeline = pipelineFor(project)
    const stageIdx = pipeline.indexOf(project.stage)
    const next = pipeline[stageIdx + 1]
    if (!next) return { project, history: null }
    assertCanEnterProductionLocal(next, project.progress)
    return {
      project: {
        ...project,
        stage: next,
        demo_held: false,
        updated_at: now,
      },
      history: makeEntry(project, {
        action: 'approve',
        from_stage: project.stage,
        to_stage: next,
        done_by_name: actorName,
      }),
    }
  }

  const pipeline = pipelineFor(project)
  const i = pipeline.indexOf(project.stage)
  if (i === -1 || i === pipeline.length - 1) return { project, history: null }
  const next = pipeline[i + 1]
  assertCanEnterProductionLocal(next, project.progress)
  return {
    project: { ...project, stage: next, updated_at: now },
    history: makeEntry(project, {
      action: 'approve',
      from_stage: project.stage,
      to_stage: next,
      done_by_name: actorName,
    }),
  }
}

/* ============================================================================
 *  ekranDemoRequest / ekranDemoApprove / ekranDemoReject(project, actor, ...)
 *    → next project state
 *
 *  Ekran Demo Onayı — a lightweight alternative to the physical re-demo for
 *  a HELD demo (approved at <100%, see the demo_onay branch of
 *  computeApproval) once the design reaches 100%. Mirrors the sipariş
 *  pipeline's `ekran_onay` (migration 046): a single team-leader digital
 *  click, no matbaa involvement, no receipt gate, no multi-party ledger.
 *  Presence of ekran_demo_requested_at IS the pending flag (migration 050).
 * ========================================================================== */
export function computeEkranDemoRequest(project, actor) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'demo_onay' && project.stage !== 'cin_demo_onay') {
    badRequest('Bu işlem yalnızca demo onay aşamasında yapılabilir.')
  }
  if (project.demo_held !== true) {
    badRequest('Ekran demo onayı yalnızca askıda kalan bir demo için istenebilir.')
  }
  if ((project.progress ?? 0) < 100) {
    badRequest('Ekran demo onayı yalnızca tasarım %100 tamamlandığında istenebilir.')
  }
  // Requesting is the DESIGNER's call, never the leader's. The whole point of
  // the gate is that the person who finished the work asks to skip the second
  // physical demo, and a leader then decides — letting a leader request it too
  // would leave them approving their own request with no second party, the
  // same self-serve loop the baskı onayı maker-checker exists to prevent.
  // A leader who wants the physical round instead still has computeAdvance's
  // demo re-send, so nothing is stranded when no designer is assigned.
  //
  // Note this checks the ROLE as well as the assignment: `assignees` is a
  // membership list, and matching an id alone would let any non-designer who
  // ever landed in it through.
  const isAssignedDesigner = actor?.role === 'designer'
    && (project.assignees ?? []).some((a) => a.id === actor?.id)
  if (!isAssignedDesigner) {
    badRequest('Ekran demo onayını yalnızca atanmış tasarımcı isteyebilir.')
  }
  if (project.ekran_demo_requested_at != null) {
    badRequest('Zaten bekleyen bir ekran demo onayı talebi var.')
  }
  return {
    project: {
      ...project,
      ekran_demo_requested_at: now,
      ekran_demo_requested_by: actor?.id ?? null,
      ekran_demo_requested_by_name: actorName,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'system',
      event: 'ekran_demo_requested',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: 'Ekran demo onayı istendi',
    }),
  }
}

export function computeEkranDemoApprove(project, actor) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'demo_onay' && project.stage !== 'cin_demo_onay') {
    badRequest('Bu işlem yalnızca demo onay aşamasında yapılabilir.')
  }
  if (actor?.role !== 'team_leader') {
    badRequest('Ekran demo onayını yalnızca ekip lideri verebilir.')
  }
  if (project.ekran_demo_requested_at == null) {
    badRequest('Bekleyen bir ekran demo onayı talebi yok.')
  }
  // Per-parça gate (migrations 068/069/070): the leader approving the
  // ekran-demo request must also sign off every parça on the latest
  // snapshot. Default to "approve all pending parçalar" (the UX
  // shortcut). The route passes ctx.snapshot + ctx.parcalar.
  const snapshotParcalar = Array.isArray(actor?._parcaSnapshot)
    ? actor._parcaSnapshot
    : []
  const ctxForGate = { snapshot: { selectedComponents: snapshotParcalar } }
  const pending = ekranDemoPendingParcalar(project, ctxForGate)
  const requested = Array.isArray(actor?._parcalar) ? actor._parcalar : null
  const target = !requested || requested.length === 0
    ? pending
    : requested.filter((p) => pending.includes(p))
  if (pending.length > 0 && target.length === 0) {
    badRequest('Onaylanacak parça bulunamadı.')
  }
  if (pending.length > 0) {
    const nextApprovals = appendParcaApprovals(
      project.demo_parca_approvals ?? [],
      target,
      actor,
      actorName,
      now,
      'ekran',
    )
    return {
      project: {
        ...project,
        demo_parca_approvals: pruneApprovalsToSnapshot(nextApprovals, snapshotParcalar, false),
        updated_at: now,
      },
      history: makeEntry(project, {
        action: 'approve',
        from_stage: project.stage,
        to_stage: project.stage,
        done_by_name: actorName,
        note: pending.length > target.length
          ? `Ekran demo parçaları onaylandı: ${target.join(', ')} — bekleyen: ${pending.filter((p) => !target.includes(p)).join(', ') || '—'}`
          : `Ekran demo parçaları onaylandı: ${target.join(', ')}`,
      }),
    }
  }
  const pipeline = pipelineFor(project)
  const stageIdx = pipeline.indexOf(project.stage)
  const next = pipeline[stageIdx + 1]
  assertCanEnterProductionLocal(next, project.progress)
  return {
    project: {
      ...project,
      stage: next,
      demo_held: false,
      demo_parca_approvals: pruneApprovalsToSnapshot(project.demo_parca_approvals ?? [], snapshotParcalar, false),
      ekran_demo_requested_at: null,
      ekran_demo_requested_by: null,
      ekran_demo_requested_by_name: null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'approve',
      event: 'ekran_demo_approved',
      from_stage: project.stage,
      to_stage: next,
      done_by_name: actorName,
      note: 'Ekran demo onaylandı',
    }),
  }
}

export function computeEkranDemoReject(project, actor, { reason } = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'demo_onay' && project.stage !== 'cin_demo_onay') {
    badRequest('Bu işlem yalnızca demo onay aşamasında yapılabilir.')
  }
  if (actor?.role !== 'team_leader') {
    badRequest('Ekran demo onayını yalnızca ekip lideri reddedebilir.')
  }
  if (project.ekran_demo_requested_at == null) {
    badRequest('Bekleyen bir ekran demo onayı talebi yok.')
  }
  if (!reason?.trim()) {
    badRequest('Red sebebi zorunludur.')
  }
  return {
    project: {
      ...project,
      ekran_demo_requested_at: null,
      ekran_demo_requested_by: null,
      ekran_demo_requested_by_name: null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'reject',
      event: 'ekran_demo_rejected',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      reason: reason.trim(),
      note: 'Ekran demo onayı reddedildi, fiziksel demo süreci devam ediyor',
    }),
  }
}

/* ============================================================================
 *  receiveDemo(project, actor, ctx) → next project state
 *
 *  Marks a delivered demo as "Teslim Alındı" (received). Allowed only at
 *  demo_onay / cin_demo_onay, and only by the team leader or an assigned
 *  designer. Idempotent — acknowledging twice is a no-op. This is the gate the
 *  demo approve checks (computeApproval).
 * ========================================================================== */
export function computeDemoReceive(project, actor, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'demo_onay' && project.stage !== 'cin_demo_onay') {
    badRequest('Teslim alma yalnızca demo onay aşamasında yapılabilir.')
  }
  const designerIds = ctx.designerIds ?? []
  const isLeader = actor?.role === 'team_leader'
  const isAssignedDesigner = actor?.role === 'designer' && designerIds.includes(actor?.id)
  if (!isLeader && !isAssignedDesigner) {
    badRequest('Teslim almayı yalnızca ekip lideri veya atanmış tasarımcı yapabilir.')
  }
  if (project.demo_received) {
    return { project, history: null } // already acknowledged
  }
  return {
    project: {
      ...project,
      demo_received: true,
      demo_received_by: actorName,
      demo_received_at: now,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'advance',
      event: 'demo_received',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: 'Demo teslim alındı',
    }),
  }
}

/* ============================================================================
 *  demoNotReceived(project, actor, ctx) → next project state
 *
 *  The counterpart to computeDemoReceive: the leader or an assigned designer
 *  reports that a delivered demo never actually reached them (lost, wrong
 *  address, matbaa mix-up, …). Only valid before it's been acknowledged —
 *  once demo_received is true there's nothing to report. Sends the project
 *  back to the matbaa's teslim stage so it can be redelivered; bumps
 *  demo_attempt like every other "back to teslim" transition (re-send,
 *  reject) so the 'Demo N' badge and form snapshot stay in sync.
 * ========================================================================== */
export function computeDemoNotReceived(project, actor, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'demo_onay' && project.stage !== 'cin_demo_onay') {
    badRequest('Bu işlem yalnızca demo onay aşamasında yapılabilir.')
  }
  const designerIds = ctx.designerIds ?? []
  const isLeader = actor?.role === 'team_leader'
  const isAssignedDesigner = actor?.role === 'designer' && designerIds.includes(actor?.id)
  if (!isLeader && !isAssignedDesigner) {
    badRequest('Bu işlemi yalnızca ekip lideri veya atanmış tasarımcı yapabilir.')
  }
  if (project.demo_received) {
    badRequest('Demo zaten teslim alındı olarak işaretlenmiş.')
  }
  const resendStage = project.type === 'CIN' ? 'cin_demo_teslim' : 'demo_teslim'
  return {
    project: {
      ...project,
      stage: resendStage,
      demo_attempt: (project.demo_attempt ?? 0) + 1,
      demo_held: false,
      demo_held_at: null,
      demo_held_by_name: null,
      demo_delivered_at: null,
      demo_delivered_by: null,
      demo_delivered_by_name: null,
      demo_received: false,
      demo_received_by: null,
      demo_received_at: null,
      // The "Başladım" gate deliberately does NOT reset here, unlike a resend
      // or computeDemoTeslimAdvance. The matbaa's physical work still exists —
      // only the handover failed — so the printer's next action is "Teslim
      // Edin", not "İşlemi Başlatın" again, and the leader keeps "Değişiklik
      // İste" instead of dropping back to free cancel/edit.
      demo_change_requested_at: null,
      demo_change_requested_by: null,
      demo_change_requested_by_name: null,
      demo_change_requested_note: null,
      demo_fix_pending: false,
      ekran_demo_requested_at: null,
      ekran_demo_requested_by: null,
      ekran_demo_requested_by_name: null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'advance',
      event: 'demo_not_received',
      from_stage: project.stage,
      to_stage: resendStage,
      done_by_name: actorName,
      note: 'Demo teslim alınamadı, matbaaya geri gönderildi',
    }),
  }
}

/* ============================================================================
 *  ozalitReceive(project, actor, ctx) → next project state
 *
 *  Marks a delivered ozalit as "Teslim Alındı" (received) — the ozalit twin of
 *  computeDemoReceive (migration 035). Allowed only at ozalit_onay, and only by
 *  the team leader or an assigned designer. Idempotent. This is the gate the
 *  ozalit approve checks (computeOzalitOnayApproval): one acknowledgment
 *  unblocks the whole multi-party round, because there is only one physical
 *  proof to take delivery of.
 * ========================================================================== */
export function computeOzalitReceive(project, actor, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'ozalit_onay') {
    badRequest('Teslim alma yalnızca ozalit onay aşamasında yapılabilir.')
  }
  if (project.ekran_ozalit === true) {
    badRequest('Ekran ozalitte teslim alma yapılmaz, doğrudan onaylayın.')
  }
  const designerIds = ctx.designerIds ?? []
  const isLeader = actor?.role === 'team_leader'
  const isAssignedDesigner = actor?.role === 'designer' && designerIds.includes(actor?.id)
  if (!isLeader && !isAssignedDesigner) {
    badRequest('Teslim almayı yalnızca ekip lideri veya atanmış tasarımcı yapabilir.')
  }
  if (project.ozalit_received) {
    return { project, history: null } // already acknowledged
  }
  return {
    project: {
      ...project,
      ozalit_received: true,
      ozalit_received_by: actorName,
      ozalit_received_at: now,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'advance',
      event: 'ozalit_received',
      from_stage: 'ozalit_onay',
      to_stage: 'ozalit_onay',
      done_by_name: actorName,
      note: 'Ozalit teslim alındı',
    }),
  }
}

/* ============================================================================
 *  ozalitNotReceived(project, actor, ctx) → next project state
 *
 *  The counterpart to computeOzalitReceive: a leader or assigned designer says
 *  "the physical proof never reached me" instead of being stuck with only
 *  Onayla/Reddet. Only valid before it's been acknowledged — once
 *  ozalit_received is true there's nothing to report. Sends the project back to
 *  ozalit_teslim with the matbaa re-delivery lock (matching a reject-to-matbaa),
 *  wipes any partial approval ledger (a new physical proof needs everyone's
 *  sign-off again), and bumps ozalit_attempt.
 * ========================================================================== */
export function computeOzalitNotReceived(project, actor, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'ozalit_onay') {
    badRequest('Bu işlem yalnızca ozalit onay aşamasında yapılabilir.')
  }
  // No matbaa delivery was ever made on a screen round, so there is nothing
  // that could have failed to arrive — and the fallback this reports to
  // (ozalit_teslim with the matbaa lock) would strand a round the matbaa
  // was never part of.
  if (project.ekran_ozalit === true) {
    badRequest('Ekran ozalitte matbaa teslimi yoktur.')
  }
  const designerIds = ctx.designerIds ?? []
  const isLeader = actor?.role === 'team_leader'
  const isAssignedDesigner = actor?.role === 'designer' && designerIds.includes(actor?.id)
  if (!isLeader && !isAssignedDesigner) {
    badRequest('Bu işlemi yalnızca ekip lideri veya atanmış tasarımcı yapabilir.')
  }
  if (project.ozalit_received) {
    badRequest('Ozalit zaten teslim alındı olarak işaretlenmiş.')
  }
  return {
    project: {
      ...project,
      stage: 'ozalit_teslim',
      ozalit_attempt: (project.ozalit_attempt ?? 0) + 1,
      ozalit_requested: false,
      ozalit_received: false,
      ozalit_received_by: null,
      ozalit_received_at: null,
      reject_target: 'matbaa',
      ozalit_leader_approved: false,
      ozalit_leader_approved_by: null,
      ozalit_leader_approved_at: null,
      ozalit_designer_approvals: [],
      ozalit_approvals: [],
      // Started stays set — see computeDemoNotReceived. The proof was made,
      // it just never arrived, so the matbaa owes a re-delivery, not a restart.
      ozalit_change_requested_at: null,
      ozalit_change_requested_by: null,
      ozalit_change_requested_by_name: null,
      ozalit_change_requested_note: null,
      ozalit_fix_pending: false,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'advance',
      event: 'ozalit_not_received',
      from_stage: 'ozalit_onay',
      to_stage: 'ozalit_teslim',
      done_by_name: actorName,
      note: 'Ozalit teslim alınamadı, matbaaya geri gönderildi',
    }),
  }
}

/* ============================================================================
 *  demoStart(project, actor) / ozalitStart(project, actor) → next project state
 *
 *  Flag-only marker (no stage change, mirrors computeBaskiOnayPrepare's
 *  shape) the printer sets once physical work on the demo/ozalit has begun.
 *  While false, the leader/assigned designer can cancel or edit the request
 *  freely (computeDemoCancel/computeOzalitCancel, or the existing spec-form
 *  save path). Once true, a cancel/edit must go through the change-request
 *  flow below — the printer already has work in progress.
 * ========================================================================== */
export function computeDemoStart(project, actor) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (actor?.role !== 'printer') {
    badRequest('Bu işlemi yalnızca matbaa yapabilir.')
  }
  if (project.stage !== 'demo_teslim' && project.stage !== 'cin_demo_teslim') {
    badRequest('Bu işlem yalnızca demo matbaa aşamasında yapılabilir.')
  }
  if (project.demo_started) {
    return { project, history: null } // already marked — idempotent
  }
  // An accepted change request owes a fix before work can (re)start —
  // otherwise the matbaa could re-lock the round the moment the leader/
  // designer's window reopens, with nothing actually having changed.
  if (project.demo_fix_pending) {
    badRequest('Kabul edilen değişiklik talebi için düzeltme bekleniyor, önce form güncellenmelidir.')
  }
  return {
    project: {
      ...project,
      demo_started: true,
      demo_started_by: actor?.id ?? null,
      demo_started_by_name: actorName,
      demo_started_at: now,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'system',
      event: 'demo_started',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: 'Matbaa demo çalışmasına başladı',
    }),
  }
}

/**
 * Is the ozalit round actually sitting with the matbaa right now?
 *
 * `ozalit_requested` alone is NOT the answer, and treating it as one is a
 * lockout. Unlike demo — where reaching demo_teslim IS the request — ozalit
 * has a two-step (migration 016): the project lands on ozalit_teslim first,
 * and the leader/designer then asks with "Ozalit İste". But a reject-to-
 * matbaa re-delivery (computeRejection → reject_target='matbaa') ALSO parks
 * the project on ozalit_teslim, deliberately with ozalit_requested=false,
 * and the matbaa owes a delivery there just the same.
 *
 * This is the exact condition computeOzalitTeslimAdvance already uses to
 * decide whether the printer may deliver — the leader-facing actions have to
 * agree with it, or a live round exists that only one side can act on.
 */
export function isOzalitRoundLive(project) {
  return !!project?.ozalit_requested || project?.reject_target === 'matbaa'
}

export function computeOzalitStart(project, actor) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (actor?.role !== 'printer') {
    badRequest('Bu işlemi yalnızca matbaa yapabilir.')
  }
  if (project.stage !== 'ozalit_teslim') {
    badRequest('Bu işlem yalnızca ozalit matbaa aşamasında yapılabilir.')
  }
  // Nothing to start until the round is actually live. Reaching ozalit_teslim
  // is not itself a request (see isOzalitRoundLive), so without this the
  // matbaa could mark "başladım" on an ozalit nobody had asked for — which
  // then left the leader with no edit, no cancel and no change-request,
  // because all three key off the same liveness the start never required.
  if (!isOzalitRoundLive(project)) {
    badRequest('Henüz ozalit istenmedi, başlatılacak bir çalışma yok.')
  }
  if (project.ozalit_started) {
    return { project, history: null } // already marked — idempotent
  }
  // Same "fix owed" guard as computeDemoStart — see its comment.
  if (project.ozalit_fix_pending) {
    badRequest('Kabul edilen değişiklik talebi için düzeltme bekleniyor, önce form güncellenmelidir.')
  }
  return {
    project: {
      ...project,
      ozalit_started: true,
      ozalit_started_by: actor?.id ?? null,
      ozalit_started_by_name: actorName,
      ozalit_started_at: now,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'system',
      event: 'ozalit_started',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: 'Matbaa ozalit çalışmasına başladı',
    }),
  }
}

/* ============================================================================
 *  demoCancel(project, actor, ctx) / ozalitCancel(project, actor, ctx)
 *    → next project state
 *
 *  A mistaken demo/ozalit request, undone. Unlike Reddet (computeRejection)
 *  or "Teslim Alınamadı" (computeDemoNotReceived/computeOzalitNotReceived),
 *  this deliberately does NOT bump demo_attempt/ozalit_attempt — nothing was
 *  ever delivered, so there's no round to count. Only valid before the
 *  matbaa has started (demo_started/ozalit_started false); once started, use
 *  the change-request flow instead. Subtasks/progress are untouched.
 * ========================================================================== */
export function computeDemoCancel(project, actor, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'demo_teslim' && project.stage !== 'cin_demo_teslim') {
    badRequest('İptal yalnızca demo matbaa sürecindeyken yapılabilir.')
  }
  // Team-leader-only — see canCancelDemoRequest's comment (client-side twin).
  if (actor?.role !== 'team_leader') {
    badRequest('Bu işlemi yalnızca ekip lideri yapabilir.')
  }
  if (project.demo_started) {
    badRequest('Matbaa demo çalışmasına başladı, doğrudan iptal edilemez, değişiklik isteyin.')
  }
  return {
    project: {
      ...project,
      stage: 'tasarim',
      // Deliberately NOT touching demo_attempt — nothing was delivered.
      demo_held: false,
      demo_held_at: null,
      demo_held_by_name: null,
      demo_delivered_at: null,
      demo_delivered_by: null,
      demo_delivered_by_name: null,
      demo_received: false,
      demo_received_by: null,
      demo_received_at: null,
      demo_started: false,
      demo_started_at: null,
      demo_started_by: null,
      demo_started_by_name: null,
      demo_change_requested_at: null,
      demo_change_requested_by: null,
      demo_change_requested_by_name: null,
      demo_change_requested_note: null,
      demo_fix_pending: false,
      reject_target: null,
      last_reject_reason: null,
      last_reject_type: null,
      last_reject_target: null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'system',
      event: 'demo_cancelled',
      from_stage: project.stage,
      to_stage: 'tasarim',
      done_by_name: actorName,
      note: 'Demo talebi iptal edildi, tasarıma geri döndü',
    }),
  }
}

export function computeOzalitCancel(project, actor, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'ozalit_teslim') {
    badRequest('İptal yalnızca ozalit matbaa sürecindeyken yapılabilir.')
  }
  // Scoped to an actual pending request — a reject-to-matbaa re-delivery
  // lock (reject_target === 'matbaa') already went through a real
  // rejection, so cancel semantics ("nothing was delivered") don't apply.
  if (!project.ozalit_requested) {
    badRequest('Bekleyen bir ozalit talebi yok.')
  }
  // Team-leader-only — see canCancelDemoRequest's comment (client-side twin).
  if (actor?.role !== 'team_leader') {
    badRequest('Bu işlemi yalnızca ekip lideri yapabilir.')
  }
  if (project.ozalit_started) {
    badRequest('Matbaa ozalit çalışmasına başladı, doğrudan iptal edilemez, değişiklik isteyin.')
  }
  return {
    project: {
      ...project,
      stage: 'tasarim',
      // Deliberately NOT touching ozalit_attempt — nothing was delivered.
      ozalit_requested: false,
      ozalit_received: false,
      ozalit_received_by: null,
      ozalit_received_at: null,
      ozalit_started: false,
      ozalit_started_at: null,
      ozalit_started_by: null,
      ozalit_started_by_name: null,
      ozalit_change_requested_at: null,
      ozalit_change_requested_by: null,
      ozalit_change_requested_by_name: null,
      ozalit_change_requested_note: null,
      ozalit_fix_pending: false,
      reject_target: null,
      last_reject_reason: null,
      last_reject_type: null,
      last_reject_target: null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'system',
      event: 'ozalit_cancelled',
      from_stage: project.stage,
      to_stage: 'tasarim',
      done_by_name: actorName,
      note: 'Ozalit talebi iptal edildi, tasarıma geri döndü',
    }),
  }
}

/* ============================================================================
 *  demoEdit / ozalitEdit(project, actor, ctx) → history only
 *
 *  The leader/assigned designer edited the demo/ozalit form's saved values
 *  (SpecFormDialog mode='view', see handleSave) while it's still sitting with
 *  the matbaa. The edit itself is free — same window as cancel — but unlike
 *  every other save in that dialog, this one is NOT silent: it exists purely
 *  to log a history entry and notify the printer their sheet changed. No
 *  project column is touched, so there's no `project` key in the return —
 *  only `history`. Same guard as computeDemoCancel/computeOzalitCancel:
 *  once the matbaa has started, this is refused and the change-request flow
 *  must be used instead.
 * ========================================================================== */
export function computeDemoEdit(project, actor, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'demo_teslim' && project.stage !== 'cin_demo_teslim') {
    badRequest('Bildirim yalnızca demo matbaa sürecindeyken yapılabilir.')
  }
  // Team-leader-only, unlike computeDemoCancel — two people (leader +
  // assigned designer) both able to edit-and-notify the same sent demo meant
  // whoever saved second silently overwrote the other's edit, with the
  // matbaa getting two separate "changed" pings for what looked like one
  // event. There is exactly one team_leader account in practice, so this
  // removes the race rather than narrowing it (migration 049 follow-up).
  if (actor?.role !== 'team_leader') {
    badRequest('Bu işlemi yalnızca ekip lideri yapabilir.')
  }
  if (project.demo_started) {
    badRequest('Matbaa demo çalışmasına başladı, değişiklik isteyin.')
  }
  // Reject-to-matbaa created this round automatically — the design is
  // unchanged, the matbaa gets the file exactly as they had it when they
  // pressed "İşlemi Başlatın", and the leader has no business silently
  // editing it. Want a change? Cancel the request, or reject-to-designer
  // with revize — both are explicit, not silent. Mirrors canEditSentDemo-
  // Request's client gate.
  if (project.last_reject_target === 'matbaa') {
    badRequest('Red sonrası otomatik istenen demo üzerinde düzenleme yapılamaz; iptal edin veya tasarımcıya reddedin.')
  }
  return {
    // Clears the "fix owed" flag an accepted change request may have set
    // (computeDemoChangeAccept) — this submission IS the fix. A no-op patch
    // when there was nothing pending (already false), so it's safe to always
    // include.
    project: { ...project, demo_fix_pending: false, updated_at: now },
    history: makeEntry(project, {
      action: 'system',
      event: 'demo_form_edited',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: 'Demo formu güncellendi',
      // Which snapshot this correction wrote (migration 052). Two
      // corrections of one round share an attempt slot, so without this the
      // older row's "Demo Formu" button resolves to the newer sheet.
      demo_id: ctx.demoId ?? null,
    }),
  }
}

export function computeOzalitEdit(project, actor, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'ozalit_teslim') {
    badRequest('Bildirim yalnızca ozalit matbaa sürecindeyken yapılabilir.')
  }
  // Liveness, not `ozalit_requested`. Correcting the sheet the matbaa works
  // from applies to a reject-to-matbaa re-delivery every bit as much as to a
  // fresh request — the printer is holding a sheet either way. (Cancel is the
  // one action that genuinely needs `ozalit_requested`; see
  // computeOzalitCancel, where "nothing was delivered" is the whole premise.)
  if (!isOzalitRoundLive(project)) {
    badRequest('Matbaada bekleyen bir ozalit yok.')
  }
  // Team-leader-only — see computeDemoEdit's comment.
  if (actor?.role !== 'team_leader') {
    badRequest('Bu işlemi yalnızca ekip lideri yapabilir.')
  }
  if (project.ozalit_started) {
    badRequest('Matbaa ozalit çalışmasına başladı, değişiklik isteyin.')
  }
  // Same auto-reject lock as the demo twin — see computeDemoEdit's comment.
  // canEditSentOzalitRequest gates the client button; this guard closes the
  // stale-client / hand-crafted-API hole.
  if (project.last_reject_target === 'matbaa') {
    badRequest('Red sonrası otomatik istenen ozalit üzerinde düzenleme yapılamaz; iptal edin veya tasarımcıya reddedin.')
  }
  return {
    // See computeDemoEdit's comment — this submission is the fix.
    project: { ...project, ozalit_fix_pending: false, updated_at: now },
    history: makeEntry(project, {
      action: 'system',
      event: 'ozalit_form_edited',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: 'Ozalit formu güncellendi',
      demo_id: ctx.demoId ?? null,
    }),
  }
}

/* ============================================================================
 *  demoChangeRequest / ozalitChangeRequest(project, actor, { note }, ctx)
 *    → next project state
 *
 *  Once the matbaa has started, a cancel/edit is no longer free — the
 *  leader/assigned designer instead asks, and the printer accepts or
 *  declines below. No stacking: only one pending request at a time.
 * ========================================================================== */
export function computeDemoChangeRequest(project, actor, { note } = {}, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'demo_teslim' && project.stage !== 'cin_demo_teslim') {
    badRequest('Bu işlem yalnızca demo matbaa aşamasında yapılabilir.')
  }
  // Team-leader-only — see canCancelDemoRequest's comment (client-side twin).
  if (actor?.role !== 'team_leader') {
    badRequest('Bu işlemi yalnızca ekip lideri yapabilir.')
  }
  if (!project.demo_started) {
    badRequest('Matbaa henüz başlamadı, doğrudan iptal veya düzenleme yapabilirsiniz.')
  }
  if (project.demo_change_requested_at != null) {
    badRequest('Zaten bekleyen bir değişiklik talebi var.')
  }
  return {
    project: {
      ...project,
      demo_change_requested_at: now,
      demo_change_requested_by: actor?.id ?? null,
      demo_change_requested_by_name: actorName,
      demo_change_requested_note: note?.trim() || null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'system',
      event: 'demo_change_requested',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: note?.trim() || 'Değişiklik istendi',
    }),
  }
}

export function computeOzalitChangeRequest(project, actor, { note } = {}, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'ozalit_teslim') {
    badRequest('Bu işlem yalnızca ozalit matbaa aşamasında yapılabilir.')
  }
  // See computeOzalitEdit — a re-delivery round is just as live, and this is
  // the ONLY action left to the leader once the matbaa has started.
  if (!isOzalitRoundLive(project)) {
    badRequest('Matbaada bekleyen bir ozalit yok.')
  }
  // Team-leader-only — see canCancelDemoRequest's comment (client-side twin).
  if (actor?.role !== 'team_leader') {
    badRequest('Bu işlemi yalnızca ekip lideri yapabilir.')
  }
  if (!project.ozalit_started) {
    badRequest('Matbaa henüz başlamadı, doğrudan iptal veya düzenleme yapabilirsiniz.')
  }
  if (project.ozalit_change_requested_at != null) {
    badRequest('Zaten bekleyen bir değişiklik talebi var.')
  }
  return {
    project: {
      ...project,
      ozalit_change_requested_at: now,
      ozalit_change_requested_by: actor?.id ?? null,
      ozalit_change_requested_by_name: actorName,
      ozalit_change_requested_note: note?.trim() || null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'system',
      event: 'ozalit_change_requested',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: note?.trim() || 'Değişiklik istendi',
    }),
  }
}

/* ============================================================================
 *  demoChangeAccept / demoChangeDecline / ozalitChangeAccept /
 *  ozalitChangeDecline(project, actor) → next project state
 *
 *  The matbaa's answer to a pending change-request. Accept "un-starts" the
 *  round (demo_started/ozalit_started back to false), reopening the free
 *  cancel/edit path above for the leader/designer to actually act on.
 *  Decline just clears the request — started stays true, and the
 *  leader/designer has to wait for normal delivery + Reddet.
 * ========================================================================== */
export function computeDemoChangeAccept(project, actor) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (actor?.role !== 'printer') {
    badRequest('Bu işlemi yalnızca matbaa yapabilir.')
  }
  if (project.demo_change_requested_at == null) {
    badRequest('Bekleyen bir değişiklik talebi yok.')
  }
  return {
    project: {
      ...project,
      demo_started: false,
      demo_started_at: null,
      demo_started_by: null,
      demo_started_by_name: null,
      demo_change_requested_at: null,
      demo_change_requested_by: null,
      demo_change_requested_by_name: null,
      demo_change_requested_note: null,
      // The accept reopens the free-edit window, but owes a fix before the
      // matbaa may re-lock it — see computeDemoStart's guard. Cleared by
      // computeDemoEdit (the fix landed) or computeDemoCancel (withdrawn).
      demo_fix_pending: true,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'system',
      event: 'demo_change_accepted',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: 'Matbaa değişiklik talebini kabul etti',
    }),
  }
}

export function computeDemoChangeDecline(project, actor) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (actor?.role !== 'printer') {
    badRequest('Bu işlemi yalnızca matbaa yapabilir.')
  }
  if (project.demo_change_requested_at == null) {
    badRequest('Bekleyen bir değişiklik talebi yok.')
  }
  return {
    project: {
      ...project,
      demo_change_requested_at: null,
      demo_change_requested_by: null,
      demo_change_requested_by_name: null,
      demo_change_requested_note: null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'system',
      event: 'demo_change_declined',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: 'Matbaa değişiklik talebini reddetti',
    }),
  }
}

export function computeOzalitChangeAccept(project, actor) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (actor?.role !== 'printer') {
    badRequest('Bu işlemi yalnızca matbaa yapabilir.')
  }
  if (project.ozalit_change_requested_at == null) {
    badRequest('Bekleyen bir değişiklik talebi yok.')
  }
  return {
    project: {
      ...project,
      ozalit_started: false,
      ozalit_started_at: null,
      ozalit_started_by: null,
      ozalit_started_by_name: null,
      ozalit_change_requested_at: null,
      ozalit_change_requested_by: null,
      ozalit_change_requested_by_name: null,
      ozalit_change_requested_note: null,
      // See computeDemoChangeAccept's comment.
      ozalit_fix_pending: true,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'system',
      event: 'ozalit_change_accepted',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: 'Matbaa değişiklik talebini kabul etti',
    }),
  }
}

export function computeOzalitChangeDecline(project, actor) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (actor?.role !== 'printer') {
    badRequest('Bu işlemi yalnızca matbaa yapabilir.')
  }
  if (project.ozalit_change_requested_at == null) {
    badRequest('Bekleyen bir değişiklik talebi yok.')
  }
  return {
    project: {
      ...project,
      ozalit_change_requested_at: null,
      ozalit_change_requested_by: null,
      ozalit_change_requested_by_name: null,
      ozalit_change_requested_note: null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'system',
      event: 'ozalit_change_declined',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: 'Matbaa değişiklik talebini reddetti',
    }),
  }
}

/* ============================================================================
 *  baskiOnayPrepare(project, actor) → next project state
 *
 *  Marks the Baskı Onay Formu "hazırlandı" (prepared) — the maker half of the
 *  maker-checker pair migration 045 introduced. Allowed only at baski_onay,
 *  and only by a team leader (any active one — Serpil Hanım, Ayşenur, …).
 *  Does NOT advance the stage; it only unlocks the approve branch in
 *  computeApproval, which additionally requires a DIFFERENT team leader.
 *  Re-preparing (e.g. after further edits) simply re-stamps who/when —
 *  idempotent in the sense that it never errors, it just updates the ledger.
 * ========================================================================== */
export function computeBaskiOnayPrepare(project, actor, ctx = {}) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  if (project.stage !== 'baski_onay' && project.stage !== 'cin_baski_onay') {
    badRequest('Bu işlem yalnızca baskı onay aşamasında yapılabilir.')
  }
  if (actor?.role !== 'team_leader') {
    badRequest('Baskı onay formunu yalnızca ekip lideri hazırlayabilir.')
  }
  // Per-parça preparer ledger (migrations 068/069/070): the leader records
  // which parça they prepared so the approving leader has to be a DIFFERENT
  // person per parça. Default `parcalar` to "all parçalar on the snapshot"
  // — same UX shortcut as the approve path.
  const snapshotParcalar = Array.isArray(ctx?.snapshot?.selectedComponents)
    ? ctx.snapshot.selectedComponents
    : []
  const requested = sanitiseParcalar(ctx?.parcalar, snapshotParcalar)
  const target = requested.length === 0 ? snapshotParcalar : requested
  const isCin = project.stage === 'cin_baski_onay'
  const nextPreparers = appendBaskiParcaRow(
    isCin ? project.cin_baski_parca_preparers : project.baski_parca_preparers,
    target,
    actor,
    actorName,
    now,
  )
  return {
    project: {
      ...project,
      baski_onay_prepared: true,
      baski_onay_prepared_by: actor?.id ?? null,
      baski_onay_prepared_by_name: actorName,
      baski_onay_prepared_at: now,
      [isCin ? 'cin_baski_parca_preparers' : 'baski_parca_preparers']: nextPreparers,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'advance',
      event: 'baski_onay_prepared',
      from_stage: project.stage,
      to_stage: project.stage,
      done_by_name: actorName,
      note: target.length > 0
        ? `Baskı onay formu hazırlandı: ${target.join(', ')} — onay bekleniyor`
        : 'Baskı onay formu hazırlandı, onay bekleniyor',
    }),
  }
}

function computeOzalitOnayApproval(project, actor, now, actorName, ctx = {}) {
  // Ekran Ozalit (migration 061): the designer chose a screen check instead of
  // a physical proof, so this is a flat single-leader sign-off — no receipt
  // gate (nothing arrived), no multi-party ledger, no designer counter-sign.
  // Same shape as the sipariş pipeline's `ekran_onay` step and the project's
  // own Ekran Demo Onayı.
  if (project.ekran_ozalit === true) {
    if (actor?.role !== 'team_leader') {
      badRequest('Ekran ozalit onayını yalnızca ekip lideri verebilir.')
    }
    assertCanEnterProductionLocal('baski_onay', project.progress)
    return {
      project: {
        ...project,
        stage: 'baski_onay',
        // Consumed with the round — a later ozalit must declare its own route.
        ekran_ozalit: false,
        ozalit_approvals: [],
        ozalit_leader_approved: false,
        ozalit_leader_approved_by: null,
        ozalit_leader_approved_at: null,
        ozalit_designer_approvals: [],
        updated_at: now,
      },
      history: makeEntry(project, {
        action: 'approve',
        event: 'ekran_ozalit_approved',
        from_stage: 'ozalit_onay',
        to_stage: 'baski_onay',
        done_by_name: actorName,
        note: 'Ekran ozalit onaylandı',
      }),
    }
  }

  // Multi-party approval: EVERY active team leader AND every assigned designer
  // must approve before the project advances to Üretime Hazır, and a team
  // leader has to go FIRST (see the leader-first gate below). ctx carries the
  // required approver ids (the approve route loads them). Each approval is
  // recorded; the project stays at ozalit_onay until the set is complete.
  const teamLeaderIds = ctx.teamLeaderIds ?? []
  const designerIds = ctx.designerIds ?? []

  const isLeader = actor?.role === 'team_leader'
  const isAssignedDesigner = actor?.role === 'designer' && designerIds.includes(actor?.id)
  if (!isLeader && !isAssignedDesigner) {
    badRequest('Ozalit onayını yalnızca ekip lideri veya atanmış tasarımcı yapabilir.')
  }
  // Gate: the delivered ozalit must be marked "Teslim Alındı" (received) by an
  // assigned designer or the team leader before anyone can sign off on it —
  // same rule as the demo (migration 035). One acknowledgment covers the whole
  // multi-party round; the physical proof arrives once.
  if (!project.ozalit_received) {
    badRequest('Önce ozalit "Teslim Alındı" olarak işaretlenmelidir.')
  }

  const approvals = Array.isArray(project.ozalit_approvals) ? project.ozalit_approvals : []

  // Leader-first: the ozalit is the leadership's call, and a designer only
  // counter-signs a proof a team leader has already accepted. Until one leader
  // has approved, a designer's Onayla is refused — the required set is
  // unchanged (everyone still signs), this only fixes the ORDER, so the ledger
  // can never show designer sign-offs on a proof no leader has looked at.
  // Any one leader opens the gate; the rest can approve in any order after.
  //
  // Skipped when there is no active team leader at all: none would be in the
  // required set either, so enforcing it would strand the project at
  // ozalit_onay with nobody able to open the gate.
  const leaderApproved = approvals.some(
    (a) => a.role === 'team_leader' || teamLeaderIds.includes(a.id),
  )
  if (isAssignedDesigner && teamLeaderIds.length > 0 && !leaderApproved) {
    badRequest('Önce ekip lideri onaylamalıdır, tasarımcı onayı ondan sonra verilebilir.')
  }

  // Record this approver (idempotent — approving twice is a no-op).
  const already = approvals.some((a) => a.id === actor?.id)
  const nextApprovals = already
    ? approvals
    : [...approvals, { id: actor?.id, role: actor?.role, name: actorName, at: now }]

  // Required = every active team leader + every assigned designer.
  const required = [...new Set([...teamLeaderIds, ...designerIds])]
  const approvedIds = new Set(nextApprovals.map((a) => a.id))
  const allApproved = required.length > 0 && required.every((id) => approvedIds.has(id))

  if (!allApproved) {
    // Not everyone has signed off yet — stay at ozalit_onay, record the approval.
    const remaining = required.filter((id) => !approvedIds.has(id)).length
    return {
      project: { ...project, ozalit_approvals: nextApprovals, updated_at: now },
      history: makeEntry(project, {
        action: 'approve',
        from_stage: 'ozalit_onay',
        to_stage: 'ozalit_onay',
        done_by_name: actorName,
        note: `Ozalit onayı verildi, ${remaining} onay daha bekleniyor`,
      }),
    }
  }

  // Everyone approved → the print proof itself is settled, but production
  // doesn't start yet: the project lands on baski_onay first, where a team
  // leader (Serpil Hanım / Ayşenur — see computeApproval's baski_onay branch)
  // gives the final, single-signature "Baskı Onayı" before Üretime Hazır.
  assertCanEnterProductionLocal('baski_onay', project.progress)
  return {
    project: {
      ...project,
      stage: 'baski_onay',
      ozalit_approvals: [],
      ozalit_leader_approved: false,
      ozalit_leader_approved_by: null,
      ozalit_leader_approved_at: null,
      ozalit_designer_approvals: [],
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'approve',
      from_stage: 'ozalit_onay',
      to_stage: 'baski_onay',
      done_by_name: actorName,
      note: 'Ozalit onaylandı, baskı onayına gönderildi',
    }),
  }
}

/* ============================================================================
 *  reject(project, reason, revizeIds, target, ctx) → next project state
 * ========================================================================== */

export function computeRejection(project, reason, revizeIds, target, { actorName, actor = null }) {
  // Role guard: only team_leader may reject.
  if (!canRejectAt(project.stage, actor)) {
    badRequest('Reddi yalnızca ekip lideri yapabilir.')
  }

  // Receipt gate: mirror the demo/ozalit approval rule — you can't reject a
  // proof you haven't acknowledged receiving yet. Approve already enforces
  // this on the same stages; reject used to skip it, which let a leader
  // bounce a demo/ozalit they hadn't taken delivery of (visible in the
  // Onaylar queue: the "Demoyu Reddedin" button used to render next to
  // "Demoyu Teslim Alın"). Wipe *_received* alongside the leg-reset below
  // so a fresh round starts with the receipt field unset, same as approve.
  // An ekran ozalit has no physical proof, so there is no receipt to gate on.
  if (project.stage === 'ozalit_onay' && !project.ozalit_received && !project.ekran_ozalit) {
    badRequest('Önce ozalit "Teslim Alındı" olarak işaretlenmelidir.')
  }
  if (
    (project.stage === 'demo_onay' || project.stage === 'cin_demo_onay') &&
    !project.demo_received
  ) {
    badRequest('Önce demo "Teslim Alındı" olarak işaretlenmelidir.')
  }

  const isOzalit = project.stage === 'ozalit_onay'
  const nowIso = new Date().toISOString()

  const pipeline = pipelineFor(project)
  const stageIdx = pipeline.indexOf(project.stage)
  const teslimStage = stageIdx > 0 ? pipeline[stageIdx - 1] : 'tasarim'
  const toMatbaa =
    target === 'matbaa' && project.type === 'TR' && teslimStage.endsWith('_teslim')
  // Ozalit-onay rejections to the designer stay on ozalit_onay (no longer
  // bounce all the way to tasarım) — the designer revizes flagged subtasks
  // in-place and then resubmits via the post-revize ozalit route picker
  // (computeAdvance below), so the visual stage stays anchored to the Ozalit
  // half of the pipeline throughout the redo cycle. Demo and matbaa-re-delivery
  // branches keep their old behaviour: only the ozalit→designer leg changes.
  const toStage = toMatbaa
    ? teslimStage
    : isOzalit
      ? 'ozalit_onay'
      : 'tasarim'

  // A reject — to either the designer (fresh redesign) or the matbaa
  // (re-delivery of the same, unchanged design) — starts a new round for
  // whichever leg was actually rejected, exactly like a "Teslim Alınamadı"
  // or a fresh delivery does (see computeDemoNotReceived /
  // computeOzalitTeslimAdvance). Without this reset, demo_started/
  // ozalit_started stayed stuck true from the PREVIOUS round: the matbaa's
  // "İşlemi Başlatın" button never reappeared (canMarkDemoStarted requires
  // !demo_started) while the leader/designer instead saw "Değişiklik İste"
  // (canRequestDemoChange requires demo_started) for a round that hadn't
  // even been redelivered yet.
  const legReset = isOzalit
    ? {
        // The rejected round is over; the next one declares its own route.
        ekran_ozalit: false,
        ozalit_received: false,
        ozalit_received_by: null,
        ozalit_received_at: null,
        ozalit_started: false,
        ozalit_started_at: null,
        ozalit_started_by: null,
        ozalit_started_by_name: null,
        ozalit_change_requested_at: null,
        ozalit_change_requested_by: null,
        ozalit_change_requested_by_name: null,
        ozalit_change_requested_note: null,
        ozalit_fix_pending: false,
      }
    : {
        demo_held: false,
        demo_held_at: null,
        demo_held_by_name: null,
        demo_delivered_at: null,
        demo_delivered_by: null,
        demo_delivered_by_name: null,
        demo_received: false,
        demo_received_by: null,
        demo_received_at: null,
        demo_started: false,
        demo_started_at: null,
        demo_started_by: null,
        demo_started_by_name: null,
        demo_change_requested_at: null,
        demo_change_requested_by: null,
        demo_change_requested_by_name: null,
        demo_change_requested_note: null,
        demo_fix_pending: false,
        ekran_demo_requested_at: null,
        ekran_demo_requested_by: null,
        ekran_demo_requested_by_name: null,
      }

  const base = {
    ...project,
    stage: toStage,
    last_reject_reason: reason,
    last_reject_type: isOzalit ? 'ozalit' : 'demo',
    last_reject_target: target,
    reject_target: toMatbaa ? 'matbaa' : null,
    ozalit_requested: false,
    updated_at: nowIso,
    ...legReset,
    ...(isOzalit
      ? {
          ozalit_leader_approved: false,
          ozalit_leader_approved_by: null,
          ozalit_leader_approved_at: null,
          ozalit_designer_approvals: [],
          // Multi-party ledger: a rejection wipes any partial approvals so the
          // next ozalit round starts fresh.
          ozalit_approvals: [],
        }
      : {}),
  }

  const counter = isOzalit
    ? { ozalit_attempt: (project.ozalit_attempt ?? 0) + 1 }
    : { demo_attempt: (project.demo_attempt ?? 0) + 1 }

  const history = makeEntry(project, {
    action: 'reject',
    from_stage: project.stage,
    to_stage: toStage,
    done_by_name: actorName,
    reason,
    reject_target: target,
  })

  if (toMatbaa) {
    // Re-delivery to the matbaa. The design is unchanged, so subtasks/progress
    // are left untouched — but the attempt counter advances just like a
    // reject-to-designer, so the re-delivered demo/ozalit carries its own
    // number (matching the project timeline, which already counts it).
    return { project: { ...base, ...counter }, history }
  }

  const selected = new Set(revizeIds ?? [])
  const baseSubs = (project.subtasks ?? []).filter((s) => s.kind !== 'revize')
  const updatedSubs = baseSubs.map((s) => applyRevize(s, selected))
  return {
    project: { ...base, ...counter, subtasks: updatedSubs, progress: subtaskProgress(updatedSubs) },
    history,
  }
}

function applyRevize(subtask, selected) {
  // Flag the leader-selected subtasks for revision but KEEP them complete —
  // progress is NOT reduced (the design work was done; it just needs a
  // touch-up). Only completed subtasks are ever offered for revision. The
  // designer clears the flag via the "Revize" action once reworked, which is
  // logged in the project history. Un-flagged subtasks are untouched.
  if (!selected.has(subtask.id)) return subtask
  return { ...subtask, needs_revize: true }
}

/* ============================================================================
 *  Local helper — the production gate lives in pipeline.js but we keep a
 *  private mirror here to avoid a circular import via services/project-
 *  repository.js.
 * ========================================================================== */

function assertCanEnterProductionLocal(nextStage, progress) {
  if (STAGES_REQUIRING_FULL_PROGRESS.has(nextStage) && (progress ?? 0) < 100) {
    badRequest('Proje %100 tamamlanmadan Ozalit ve üretim aşamasına geçemez.')
  }
}
