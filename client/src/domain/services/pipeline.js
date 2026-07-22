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
 * Stages a project may only enter once its design is 100% complete. The gate
 * starts at the print proof (ozalit) — that's where the matbaa actually runs
 * paper through a press and a half-finished design is expensive to recall.
 *
 * Demos are deliberately allowed below 100%: a designer (or the team leader)
 * can request a demo at any progress, the matbaa prints the proof, and the
 * team leader approves. If the design was complete the project advances to
 * ozalit. If it wasn't, the project stays at `demo_onay` (the leader can't
 * approve-and-advance an incomplete design — see `assertDemoCanAdvance`),
 * the designer keeps working, and a second demo is sent once the design
 * reaches 100%.
 */
export const STAGES_REQUIRING_FULL_PROGRESS = new Set([
  'ozalit_teslim',
  'ozalit_onay',
  'uretime_hazir',
  'uretimde',
  'gumruk',
  'satista',
])

/**
 * Business rule: a project cannot enter any post-design stage (ozalit and
 * beyond) until the design is 100% complete. Demo stages may be entered at
 * any progress — see the rule explanation above.
 * @param {string} nextStage
 * @param {number} progress
 */
export function assertCanEnterProduction(nextStage, progress) {
  if (STAGES_REQUIRING_FULL_PROGRESS.has(nextStage) && (progress ?? 0) < 100) {
    const err = new Error('Proje %100 tamamlanmadan Ozalit ve üretim aşamasına geçemez.')
    err.status = 400
    throw err
  }
}

/**
 * Business rule: a demo can be approved at any progress, but the project
 * can only advance out of `demo_onay` once the design is fully complete.
 * Approval at <100% is a "hold" — the leader's approve is recorded, the
 * project stays at `demo_onay`, and a second demo is required after the
 * designer finishes.
 *
 * Returns `null` when the project may advance. Returns a string explaining
 * why it's held when progress < 100% (caller surfaces this to the leader).
 *
 * @param {number} progress
 * @returns {string | null}
 */
export function assertDemoCanAdvance(progress) {
  if ((progress ?? 0) < 100) {
    return 'Tasarım tamamlanmadan demo onayı sonraki aşamaya geçiremez. Tasarımcı kalan görevleri bitirip yeni bir demo gönderecek.'
  }
  return null
}

/**
 * Capability helpers — these answer "is THIS user allowed to do X?"
 *
 *   isOzalitApprover  — advance `ozalit_onay → uretime_hazir`
 *                       owner: team_leader only
 *   isDemoApprover    — advance `demo_onay | cin_demo_onay → ozalit_teslim |
 *                              uretime_hazir`
 *                       owner: team_leader  OR  printer
 *   canRejectAtStage  — reject at any stage (reason + reject_target where
 *                       applicable)
 *                       owner: team_leader only
 *   canEditProductInfo — edit Ürün Bilgileri
 *                       owner: team_leader only
 */

/**
 * @param {{ role: string }} user
 */
export function isOzalitApprover(user) {
  if (!user) return false
  if (user.role === 'team_leader') return true
  return false
}

/**
 * @param {{ role: string }} user
 */
export function isDemoApprover(user) {
  if (!user) return false
  if (user.role === 'team_leader') return true
  if (user.role === 'printer') return true
  return false
}

/**
 * Rejection rights. Only `team_leader` can reject — at any stage.
 *
 * @param {{ role: string }} user
 * @param {string} stage
 */
export function canRejectAtStage(user, stage) {
  if (!user) return false
  if (user.role === 'team_leader') return true
  return false
}

/**
 * Ürün Bilgileri edit rights. team_leader only.
 *
 * @param {{ role: string }} user
 */
export function canEditProductInfo(user) {
  if (!user) return false
  if (user.role === 'team_leader') return true
  return false
}
