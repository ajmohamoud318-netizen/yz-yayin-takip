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

/** Only team_leader or designer may initiate an ozalit request. */
function canRequestOzalit(actor) {
  return actor?.role === 'team_leader' || actor?.role === 'designer'
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
 *  advance(project, actor) → next project state
 * ========================================================================== */

export function computeAdvance(project, actor) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'

  // 1) Ozalit revision resubmit — designer finished a redesign after a
  // previous ozalit rejection → jump straight to ozalit_teslim.
  if (project.stage === 'tasarim' && project.last_reject_type === 'ozalit') {
    assertCanEnterProductionLocal('ozalit_teslim', project.progress)
    return {
      project: {
        ...project,
        stage: 'ozalit_teslim',
        last_reject_type: null,
        last_reject_reason: null,
        reject_target: null,
        ozalit_requested: true,
        updated_at: now,
      },
      history: makeEntry(project, {
        action: 'advance',
        from_stage: 'tasarim',
        to_stage: 'ozalit_teslim',
        done_by_name: actorName,
        note: 'Ozalit revizyonu tamamlandı — matbaaya gönderildi',
      }),
    }
  }

  // 2) Re-send a demo at any demo stage. The team leader or the
  // assigned designer can advance any of {demo_teslim, demo_onay,
  // cin_demo_teslim, cin_demo_onay} back to the corresponding
  // _teslim stage to start the demo cycle over. Allowed at any
  // progress and any held-state — once the leader has approved a
  // demo, the team may iterate again.
  if (
    project.stage === 'demo_teslim' ||
    project.stage === 'demo_onay' ||
    project.stage === 'cin_demo_teslim' ||
    project.stage === 'cin_demo_onay'
  ) {
    const role = actor?.role
    const isAssigned = (project.assignees ?? []).some((a) => a.id === actor?.id)
    // The matbaa delivers at demo_teslim → demo_onay. Other roles
    // can re-send / cancel the cycle back to demo_teslim.
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
    // Re-send always reverts to tasarim so the designer can fill a
    // fresh demo form. demo_teslim → tasarim + demo_onay → tasarim.
    // demo_attempt is bumped so the 'Demo N' badge reflects the
    // iteration.
    return {
      project: {
        ...project,
        stage: 'tasarim',
        demo_attempt: (project.demo_attempt ?? 0) + 1,
        demo_held: false,
        demo_held_at: null,
        demo_held_by_name: null,
        demo_delivered_at: null,
        demo_delivered_by: null,
        demo_delivered_by_name: null,
        reject_target: null,
        last_reject_reason: null,
        last_reject_type: null,
        updated_at: now,
      },
      history: makeEntry(project, {
        action: 'advance',
        from_stage: project.stage,
        to_stage: targetStage,
        done_by_name: actorName,
        note: 'Tasarım tamamlandı — yeniden demo gönderildi',
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
  assertCanEnterProductionLocal(approvalStage, project.progress)
  return {
    project: {
      ...project,
      stage: approvalStage,
      demo_delivered_by: actor?.id ?? null,
      demo_delivered_by_name: actor?.name ?? 'Bilinmeyen',
      demo_delivered_at: now,
      reject_target: null,
      last_reject_reason: null,
      last_reject_type: null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'advance',
      from_stage: project.stage,
      to_stage: approvalStage,
      done_by_name: actor?.name ?? 'Bilinmeyen',
      note: 'Demo teslim edildi — onaya gönderildi',
    }),
  }
}

function computeOzalitTeslimAdvance(project, actor, now) {
  const isPrinter = actor?.role === 'printer'
  const matbaaLock = project.reject_target === 'matbaa'

  if (!isPrinter) {
    if (!canRequestOzalit(actor)) {
      badRequest('Yalnızca ekip lideri veya tasarımcı ozalit isteyebilir.')
    }
    if (project.ozalit_requested) {
      badRequest('Ozalit zaten istendi — matbaa teslimi bekleniyor.')
    }
    return {
      project: { ...project, ozalit_requested: true, updated_at: now },
      history: makeEntry(project, {
        action: 'advance',
        from_stage: 'ozalit_teslim',
        to_stage: 'ozalit_teslim',
        done_by_name: actor?.name ?? 'Bilinmeyen',
        note: 'Ozalit istendi — matbaa teslimi bekleniyor',
      }),
    }
  }

  if (!project.ozalit_requested && !matbaaLock) {
    badRequest('Önce ekip lideri veya tasarımcı ozalit istemelidir.')
  }
  assertCanEnterProductionLocal('ozalit_onay', project.progress)
  return {
    project: {
      ...project,
      stage: 'ozalit_onay',
      ozalit_requested: false,
      reject_target: null,
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'advance',
      from_stage: 'ozalit_teslim',
      to_stage: 'ozalit_onay',
      done_by_name: actor?.name ?? 'Bilinmeyen',
      note: 'Ozalit teslim edildi — onaya gönderildi',
    }),
  }
}

/* ============================================================================
 *  approve(project, actor) → next project state
 * ========================================================================== */

export function computeApproval(project, actor) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'

  if (project.stage === 'ozalit_onay') {
    return computeOzalitOnayApproval(project, actor, now, actorName)
  }

  // Demo approval: leader OR printer can advance it.
  // New demo rule (see client pipeline.js#assertDemoCanAdvance): an approve
  // at <100% progress is recorded as a hold — the project stays at
  // `demo_onay` and a second demo is required after the designer finishes.
  if (project.stage === 'demo_onay' || project.stage === 'cin_demo_onay') {
    if (!canApproveAt(project.stage, actor)) {
      badRequest('Demo onayını yalnızca ekip lideri veya matbaa yapabilir.')
    }
    if ((project.progress ?? 0) < 100) {
      // Approve but don't advance. Designer keeps working; once they hit
      // 100% they (or the leader) send a second demo via /advance.
      return {
        project: {
          ...project,
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
          note: 'Demo onaylandı — tasarım tamamlanmadığı için Ozalit bekleniyor',
        }),
      }
    }
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

function computeOzalitOnayApproval(project, actor, now, actorName) {
  // Single-step approval: team_leader only. Approval advances directly
  // from ozalit_onay → uretime_hazir (no separate designer/special-designer
  // step). The leader fields stay in the schema for backward compatibility
  // but are no longer required.
  if (actor?.role !== 'team_leader') {
    badRequest('Ozalit onayını yalnızca ekip lideri yapabilir.')
  }
  assertCanEnterProductionLocal('uretime_hazir', project.progress)
  return {
    project: {
      ...project,
      stage: 'uretime_hazir',
      ozalit_leader_approved: false,
      ozalit_leader_approved_by: null,
      ozalit_leader_approved_at: null,
      ozalit_designer_approvals: [],
      updated_at: now,
    },
    history: makeEntry(project, {
      action: 'approve',
      from_stage: 'ozalit_onay',
      to_stage: 'uretime_hazir',
      done_by_name: actorName,
      note: 'Ozalit onaylandı, üretime alındı',
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

  const isOzalit = project.stage === 'ozalit_onay'
  const nowIso = new Date().toISOString()

  const pipeline = pipelineFor(project)
  const stageIdx = pipeline.indexOf(project.stage)
  const teslimStage = stageIdx > 0 ? pipeline[stageIdx - 1] : 'tasarim'
  const toMatbaa =
    target === 'matbaa' && project.type === 'TR' && teslimStage.endsWith('_teslim')
  const toStage = toMatbaa ? teslimStage : 'tasarim'

  const base = {
    ...project,
    stage: toStage,
    last_reject_reason: reason,
    last_reject_type: isOzalit ? 'ozalit' : 'demo',
    last_reject_target: target,
    reject_target: toMatbaa ? 'matbaa' : null,
    ozalit_requested: false,
    updated_at: nowIso,
    ...(isOzalit
      ? {
          ozalit_leader_approved: false,
          ozalit_leader_approved_by: null,
          ozalit_leader_approved_at: null,
          ozalit_designer_approvals: [],
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
    return { project: { ...base, ...counter }, history }
  }

  const selected = new Set(revizeIds ?? [])
  const baseSubs = (project.subtasks ?? []).filter((s) => s.kind !== 'revize')
  const updatedSubs = baseSubs.map((s) => applyRevize(s, selected, nowIso))
  return {
    project: { ...base, ...counter, subtasks: updatedSubs, progress: subtaskProgress(updatedSubs) },
    history,
  }
}

function applyRevize(subtask, selected, nowIso) {
  const needs = selected.has(subtask.id)
  if (subtask.kind === 'pages') {
    return needs
      ? { ...subtask, needs_revize: true, pages_done: 0, is_done: false }
      : {
          ...subtask,
          needs_revize: false,
          pages_done: subtask.total_pages ?? subtask.pages_done ?? 0,
          is_done: true,
        }
  }
  return needs
    ? { ...subtask, needs_revize: true, is_done: false, done_at: null }
    : { ...subtask, needs_revize: false, is_done: true, done_at: subtask.done_at ?? nowIso }
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
