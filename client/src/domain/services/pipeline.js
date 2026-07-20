import { STAGE_PIPELINE, ORDERABLE_STAGES, HANDOVER_ELIGIBLE_STAGE } from '../constants/stages.js'

/** @param {'TR'|'CIN'} type */
export function getPipeline(type) {
  return STAGE_PIPELINE[type] ?? STAGE_PIPELINE.TR
}

/**
 * Business rule: a sipariş (order) request can only be raised for a project that
 * has reached the Satışta stage.
 * @param {{ stage: string }} project
 */
export function canRequestOrder(project) {
  return ORDERABLE_STAGES.has(project?.stage)
}

/**
 * Guard for the create-order use case. Throws a 400 when a request targets a
 * project that isn't in an orderable (Satışta) stage.
 * @param {{ stage: string }} project
 */
export function assertOrderable(project) {
  if (!project || !ORDERABLE_STAGES.has(project.stage)) {
    const err = new Error('Sipariş talebi yalnızca satışta olan ürünler için oluşturulabilir.')
    err.status = 400
    throw err
  }
}

/**
 * The stage a project must be in for Matbaa to raise a handover ("teslim")
 * request, based on project type.
 * @param {'TR'|'CIN'} type
 */
export function handoverStageFor(type) {
  return HANDOVER_ELIGIBLE_STAGE[type] ?? HANDOVER_ELIGIBLE_STAGE.TR
}

/**
 * Business rule: Matbaa can only raise a handover request once the project has
 * reached its final production stage (TR: Üretimde, ÇİN: Gümrük).
 * @param {{ type: string, stage: string }} project
 */
export function canRequestHandover(project) {
  return !!project && project.stage === handoverStageFor(project.type)
}

/**
 * Guard for the create-handover use case.
 * @param {{ type: string, stage: string }} project
 */
export function assertHandoverEligible(project) {
  if (!canRequestHandover(project)) {
    const err = new Error('Teslim talebi yalnızca üretimi tamamlanan projeler için oluşturulabilir.')
    err.status = 400
    throw err
  }
}

/** @param {{ type: string, stage: string }} project */
export function getNextStage(project) {
  const pipeline = getPipeline(project.type)
  const i = pipeline.indexOf(project.stage)
  if (i === -1 || i === pipeline.length - 1) return null
  return pipeline[i + 1]
}

/**
 * Stages a project may only enter once its design is 100% complete. Everything
 * from the demo stages onward — demo review, approval, the print proof and
 * all production stages — requires a finished design. Designers no longer
 * submit partial designs for review; a demo is the polish check before print.
 */
export const STAGES_REQUIRING_FULL_PROGRESS = new Set([
  'demo_teslim',
  'cin_demo_teslim',
  'demo_onay',
  'cin_demo_onay',
  'ozalit_teslim',
  'ozalit_onay',
  'uretime_hazir',
  'uretimde',
  'gumruk',
  'satista',
])

/**
 * Business rule: a project cannot reach Demo (or any later stage) until its
 * design is 100% complete.
 * @param {string} nextStage
 * @param {number} progress
 */
export function assertCanEnterProduction(nextStage, progress) {
  if (STAGES_REQUIRING_FULL_PROGRESS.has(nextStage) && (progress ?? 0) < 100) {
    const err = new Error('Proje %100 tamamlanmadan Demo, Ozalit ve üretim aşamasına geçemez.')
    err.status = 400
    throw err
  }
}

/**
 * Capability helpers — these answer "is THIS user allowed to do X?" given
 * the per-user `can_approve_ozalit` flag (set by the team leader when
 * inviting a designer; colloquially "special designer").
 *
 *   canApproveOzalit   — advance `ozalit_onay → uretime_hazir`
 *                        owner: team_leader  OR  designer with flag
 *                        rule: AND-of-two (leader + special-designer) is
 *                              enforced at the route layer, not here
 *   canApproveDemo     — advance `demo_onay | cin_demo_onay → ozalit_teslim |
 *                              uretime_hazir`
 *                        owner: team_leader  OR  printer  OR  designer with flag
 *                        rule: any one of the three approves
 *   canRejectAtStage   — reject at any stage (reason + reject_target where
 *                        applicable)
 *                        owner: team_leader only. Designers never reject.
 *   canEditProductInfo — edit Ürün Bilgileri
 *                        owner: team_leader  OR  designer with flag
 *                        rule: assignment to a project does NOT grant this
 *
 * The flag column lives on `users` (server: `can_approve_ozalit`); the mock
 * layer keeps the camelCase alias `canApproveOzalit` on the user object.
 */

/**
 * @param {{ role: string, canApproveOzalit?: boolean }} user
 */
export function isOzalitApprover(user) {
  if (!user) return false
  if (user.role === 'team_leader') return true
  if (user.role === 'designer' && user.canApproveOzalit === true) return true
  return false
}

/**
 * @param {{ role: string, canApproveOzalit?: boolean }} user
 */
export function isDemoApprover(user) {
  if (!user) return false
  if (user.role === 'team_leader') return true
  if (user.role === 'printer') return true
  if (user.role === 'designer' && user.canApproveOzalit === true) return true
  return false
}

/**
 * Rejection rights. Two roles can reject:
 *   - `team_leader`              — at ANY stage, unconditionally
 *   - `designer` with the flag   — at Demo + Özalit only (their domain)
 *
 * The plain `designer` (assigned to the project) and `printer` cannot reject.
 *
 * @param {{ role: string, canApproveOzalit?: boolean }} user
 * @param {string} stage
 */
export function canRejectAtStage(user, stage) {
  if (!user) return false
  if (user.role === 'team_leader') return true
  if (user.role === 'designer' && user.canApproveOzalit === true) {
    return (
      stage === 'demo_onay' ||
      stage === 'cin_demo_onay' ||
      stage === 'ozalit_onay'
    )
  }
  return false
}

/**
 * Ürün Bilgileri edit rights. team_leader OR designer with the flag.
 * Mere project assignment does NOT grant this.
 *
 * @param {{ role: string, canApproveOzalit?: boolean }} user
 */
export function canEditProductInfo(user) {
  if (!user) return false
  if (user.role === 'team_leader') return true
  if (user.role === 'designer' && user.canApproveOzalit === true) return true
  return false
}
