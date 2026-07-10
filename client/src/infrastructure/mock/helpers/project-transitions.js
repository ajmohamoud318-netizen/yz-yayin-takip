/**
 * Pure transition helpers for the project state machine.
 *
 * These were extracted from `mock-project.repository.js` to keep the repo
 * focused on persistence (find + save + mockOrHttp wrapping) while the
 * branching logic — which is the bulk of the file — lives in testable
 * functions that take a project + actor and return the next state.
 *
 * Each function returns either:
 *   • { project, history } — caller's job to persist + append history
 *   • { project }          — no new history entry (e.g. terminal stage)
 *   • throws on invalid transitions (badRequest semantics live in the helpers)
 */

import {
  STAGE_PIPELINE,
  subtaskProgress,
  assertCanEnterProduction,
} from '../../../domain/index.js'
import { badRequest } from './errors.js'
import { uid } from './id.js'

/** Get the pipeline for a project (TR or ÇİN), used in every helper below. */
function pipelineFor(project) {
  return project.type === 'CIN' ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR
}

/** Helper: build a canonical history entry. */
function makeEntry(project, partial) {
  return {
    id: uid(`${project.id}-h`),
    created_at: new Date().toISOString(),
    ...partial,
  }
}

/** Returns true if the named role is allowed to *initiate* an ozalit request
 *  (anyone except the printer — printer delivers, not requests). */
function canRequestOzalit(actor) {
  return actor?.role === 'team_leader' || actor?.role === 'designer'
}

/* ============================================================================
 *  advance(project, actor) → next project state
 * ========================================================================== */

/**
 * Apply an advance transition. May return the same stage (e.g. "Ozalit İste"
 * stays at ozalit_teslim but sets ozalit_requested=true). Throws on illegal
 * transitions.
 *
 * Branches, in order:
 *   1. Ozalit revision resubmit — designer finished a redesign after a previous
 *      ozalit rejection → jump straight to ozalit_teslim.
 *   2. Ozalit Teslim dual-step:
 *      - non-printer "Ozalit İste"  → stays at ozalit_teslim, sets request flag
 *      - printer "Teslim Et"        → ozalit_teslim → ozalit_onay
 *   3. Generic forward advance through the pipeline, with two guards:
 *      - satista can only be reached via the handover confirmation flow
 *      - ozalit+ stages require progress === 100
 */
export function computeAdvance(project, actor) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'
  const appendHistory = (entry) => ({ project, history: entry })

  // 1) Ozalit revision resubmit
  if (project.stage === 'tasarim' && project.last_reject_type === 'ozalit') {
    assertCanEnterProduction('ozalit_teslim', project.progress)
    return {
      project: {
        ...project,
        stage: 'ozalit_teslim',
        last_reject_type: null,
        last_reject_reason: null,
        reject_target: null,
        ozalit_requested: true, // resubmit IS the request — hand to matbaa
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

  // 2) Ozalit Teslim dual-step
  if (project.stage === 'ozalit_teslim') {
    return computeOzalitTeslimAdvance(project, actor, now, appendHistory)
  }

  // 3) Generic forward advance
  const pipeline = pipelineFor(project)
  const i = pipeline.indexOf(project.stage)
  if (i === -1 || i === pipeline.length - 1) {
    return { project, history: null }
  }
  const next = pipeline[i + 1]
  // satista is only reachable via Sales confirming the handover.
  if (next === 'satista') {
    badRequest('Satışta aşamasına yalnızca Satış ekibi teslimi onayladığında geçilir.')
  }
  assertCanEnterProduction(next, project.progress)
  return {
    project: {
      ...project,
      stage: next,
      // Forward advance clears any stale reject banner + matbaa lock so the
      // UI doesn't keep showing the previous rejection's reason.
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

function computeOzalitTeslimAdvance(project, actor, now, appendHistory) {
  const isPrinter = actor?.role === 'printer'
  const matbaaLock = project.reject_target === 'matbaa'

  // Non-printer "Ozalit İste" — stays at ozalit_teslim with request flag.
  if (!isPrinter) {
    if (!canRequestOzalit(actor)) {
      badRequest('Yalnızca ekip lideri veya tasarımcı ozalit isteyebilir.')
    }
    if (project.ozalit_requested) {
      badRequest('Ozalit zaten istendi — matbaa teslimi bekleniyor.')
    }
    return {
      project: {
        ...project,
        ozalit_requested: true,
        updated_at: now,
      },
      history: makeEntry(project, {
        action: 'advance',
        from_stage: 'ozalit_teslim',
        to_stage: 'ozalit_teslim',
        done_by_name: actor?.name ?? 'Bilinmeyen',
        note: 'Ozalit istendi — matbaa teslimi bekleniyor',
      }),
    }
  }

  // Printer delivers → ozalit_teslim → ozalit_onay
  if (!project.ozalit_requested && !matbaaLock) {
    badRequest('Önce ekip lideri veya tasarımcı ozalit istemelidir.')
  }
  assertCanEnterProduction('ozalit_onay', project.progress)
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

/**
 * Apply an approval transition. Most stages do a simple "advance to next
 * pipeline stage", but ozalit_onay has a special dual sign-off:
 *   1. team_leader approves first (stays at ozalit_onay)
 *   2. each assigned designer approves; only the LAST one advances to
 *      uretime_hazir.
 */
export function computeApproval(project, actor) {
  const now = new Date().toISOString()
  const actorName = actor?.name ?? 'Bilinmeyen'

  if (project.stage === 'ozalit_onay') {
    return computeOzalitOnayApproval(project, actor, now, actorName)
  }

  // Generic approval: advance to the next pipeline stage.
  const pipeline = pipelineFor(project)
  const i = pipeline.indexOf(project.stage)
  if (i === -1 || i === pipeline.length - 1) return { project, history: null }
  const next = pipeline[i + 1]
  assertCanEnterProduction(next, project.progress)
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
  const role = actor?.role

  // First approval — team leader. Stays at ozalit_onay.
  if (!project.ozalit_leader_approved) {
    if (role !== 'team_leader') {
      badRequest('Ozalit önce ekip lideri tarafından onaylanmalıdır.')
    }
    return {
      project: {
        ...project,
        ozalit_leader_approved: true,
        ozalit_leader_approved_by: actor?.name ?? null,
        ozalit_leader_approved_at: now,
        updated_at: now,
      },
      history: makeEntry(project, {
        action: 'approve',
        from_stage: 'ozalit_onay',
        to_stage: 'ozalit_onay',
        done_by_name: actorName,
        note: 'Ozalit — ekip lideri onayladı, tasarımcı onayı bekleniyor',
      }),
    }
  }

  // Subsequent approvals — every assigned designer must sign.
  const assigneeIds = (project.assignees ?? []).map((a) => a.id)
  const isAssignedDesigner = role === 'designer' && assigneeIds.includes(actor.id)
  if (!isAssignedDesigner) {
    badRequest('Ekip lideri onayladı — sıradaki onay atanmış tasarımcı(lar)dan gelmelidir.')
  }
  const approvedSet = new Set(project.ozalit_designer_approvals ?? [])
  if (approvedSet.has(actor.id)) {
    badRequest('Bu ozaliti zaten onayladınız.')
  }
  approvedSet.add(actor.id)
  const approvals = [...approvedSet]
  const allApproved = assigneeIds.length > 0 && assigneeIds.every((did) => approvedSet.has(did))

  if (allApproved) {
    assertCanEnterProduction('uretime_hazir', project.progress)
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
        note: 'Ozalit — tüm tasarımcılar onayladı, üretime alındı',
      }),
    }
  }

  // Some designers still pending — record and stay put.
  const remaining = assigneeIds.length - approvals.length
  return {
    project: { ...project, ozalit_designer_approvals: approvals, updated_at: now },
    history: makeEntry(project, {
      action: 'approve',
      from_stage: 'ozalit_onay',
      to_stage: 'ozalit_onay',
      done_by_name: actorName,
      note: `Ozalit — ${actor?.name ?? 'tasarımcı'} onayladı, ${remaining} tasarımcı onayı bekleniyor`,
    }),
  }
}

/* ============================================================================
 *  reject(project, reason, revizeIds, target) → next project state
 * ========================================================================== */

/**
 * Apply a rejection. The leader chooses `target`:
 *   • 'designer' → back to Tasarım; revizeIds are flagged for revision
 *                  (progress drops for the chosen subtasks)
 *   • 'matbaa'   → back to the teslim step; design untouched (matbaa re-delivers)
 *
 * The teslim stage is derived from the project's pipeline so it can never
 * point at a stage that doesn't exist for its type. ÇİN projects have no
 * matbaa re-delivery step, so a matbaa reject on ÇİN collapses to a normal
 * designer reject → Tasarım.
 *
 * @param {object} project
 * @param {string} reason - required, written
 * @param {string[]} revizeIds - subtask ids to flag for revision
 * @param {'designer'|'matbaa'} target
 * @param {{ actorName: string }} ctx - actor info (caller already verified role)
 */
export function computeRejection(project, reason, revizeIds, target, { actorName }) {
  const isOzalit = project.stage === 'ozalit_onay'
  const nowIso = new Date().toISOString()

  // Derive the teslim step that feeds the current *_onay stage from the
  // project's own pipeline (TR or ÇİN), so this can never point at a stage
  // that doesn't exist for the type.
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
    // Void any pending ozalit sign-off on rejection.
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
    // Matbaa re-delivers — design/subtasks/progress untouched.
    return { project: { ...base, ...counter }, history }
  }

  // Designer redesign — flag the chosen subtasks, recompute progress.
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
