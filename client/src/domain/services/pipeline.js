import { STAGE_PIPELINE, ORDERABLE_STAGES, HANDOVER_ELIGIBLE_STAGE } from '../constants/stages.js'

/** @param {'TR'|'CIN'} type */
export function getPipeline(type) {
  return STAGE_PIPELINE[type] ?? STAGE_PIPELINE.TR
}

/**
 * True when a product belongs in the Ürünler catalog: it reached an orderable
 * stage AND the team leader hasn't delisted it ("kaldır", `catalog_hidden` —
 * migration 033). Delisting leaves the project untouched everywhere else; it
 * only takes the product away from Sales.
 *
 * Mirrors `isCatalogListed` in server/src/domain/pipeline.js.
 * @param {{ stage: string, catalog_hidden?: boolean }} project
 */
export function isCatalogListed(project) {
  return !!project && ORDERABLE_STAGES.has(project.stage) && !project.catalog_hidden
}

/**
 * Business rule: a sipariş (order) request can only be raised for a product
 * that is listed in the catalog (see `isCatalogListed`) AND has a Ürün
 * Bilgileri (product_info) entry — the spec sheet the order's items/quantities
 * are checked against.
 * @param {{ stage: string, has_product_info?: boolean, catalog_hidden?: boolean }} project
 */
export function canRequestOrder(project) {
  return isCatalogListed(project) && !!project.has_product_info
}

/**
 * Guard for the create-order use case. Throws a 400 when a request targets a
 * project that hasn't reached an orderable stage yet, has been delisted from
 * the catalog, or has no Ürün Bilgileri entry yet.
 * @param {{ stage: string, has_product_info?: boolean, catalog_hidden?: boolean }} project
 */
export function assertOrderable(project) {
  // Delisted gets its own message: such a product looks perfectly orderable
  // (finished stage, spec filled in), so the generic text would mislead.
  if (project && project.catalog_hidden) {
    const err = new Error('Bu ürün katalogdan kaldırıldı; baskı talebi oluşturulamaz.')
    err.status = 400
    throw err
  }
  if (!project || !ORDERABLE_STAGES.has(project.stage) || !project.has_product_info) {
    const err = new Error('Baskı talebi yalnızca üretime hazır aşamasına ulaşmış ve Ürün Bilgileri girilmiş ürünler için oluşturulabilir.')
    err.status = 400
    throw err
  }
}

/**
 * True for an imported backlist product (`origin: 'legacy'`, migration 031).
 * These are books published before this system existed: created directly at a
 * finished stage so Sales can order them, with no subtasks, no designer and no
 * demo/ozalit history.
 *
 * Mirrors `isLegacyProject` in server/src/domain/pipeline.js — the server
 * enforces it, this copy exists so the UI doesn't offer actions that would 400.
 * @param {{ origin?: string }} project
 */
export function isLegacyProject(project) {
  return project?.origin === 'legacy'
}

/**
 * Guard mirroring the server's `assertNotLegacy`. Advancing a legacy product
 * moves it out of ORDERABLE_STAGES, which silently removes it from the Ürünler
 * catalog and takes away Sales' ability to order it.
 *
 * Sipariş and teslim are deliberately NOT guarded — putting backlist books into
 * those flows is the reason for importing them.
 * @param {{ origin?: string }} project
 */
export function assertNotLegacy(project) {
  if (isLegacyProject(project)) {
    const err = new Error('Kayıtlı ürün pipeline üzerinde ilerletilemez. Yeni bir baskı talebi oluşturun.')
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
  'baski_onay',
  'cin_baski_onay',
  'baskida',
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
 *   isOzalitApprover  — advance `ozalit_onay → baski_onay`
 *                       owner: team_leader only
 *   ozalitLeaderApproved / canApproveOzalitNow
 *                     — sign off at `ozalit_onay` (multi-party, leader-first)
 *                       owner: team_leader, then the assigned designers
 *   isDemoApprover    — advance `demo_onay → ozalit_teslim` |
 *                              `cin_demo_onay → cin_baski_onay`
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
 * Ozalit onay is multi-party AND leader-first: every active team leader and
 * every assigned designer must sign off, but a designer may only counter-sign
 * a proof a team leader has already approved. The server enforces this in
 * `computeOzalitOnayApproval`; this is the UI's copy of the rule, so the
 * designer sees "ekip lideri onayı bekleniyor" instead of an Onayla button
 * that errors.
 *
 * The client can't see the active-leader list, so it reads the ledger's own
 * recorded roles — which is what the server writes on every approval.
 *
 * @param {{ ozalit_approvals?: Array<{ role?: string }> }} project
 */
export function ozalitLeaderApproved(project) {
  return (project?.ozalit_approvals ?? []).some((a) => a.role === 'team_leader')
}

/**
 * Can this user approve THIS project's ozalit right now? Combines the role
 * check (leader or assigned designer), the receipt gate (migration 035) and
 * the leader-first order above. Does not consider whether they already
 * approved — callers hide the button on that separately.
 *
 * @param {{ id: string, role: string }} user
 * @param {{ ozalit_received?: boolean, assignees?: Array<{ id: string }> }} project
 */
export function canApproveOzalitNow(user, project) {
  if (!user || !project) return false
  if (!project.ozalit_received) return false
  if (user.role === 'team_leader') return true
  const isAssignedDesigner =
    user.role === 'designer' && (project.assignees ?? []).some((a) => a.id === user.id)
  return isAssignedDesigner && ozalitLeaderApproved(project)
}

/**
 * Baskı Onay Formu — the final print approval, gated at `baski_onay`
 * (between ozalit_onay and baskida) for TR, and its mirror `cin_baski_onay`
 * (between cin_demo_onay and baskida, migration 047) for ÇİN. team_leader
 * only, both halves: this is the same set of people ("Serpil Hanım",
 * Ayşenur, …) who may edit the form itself — see the `baski_onay` variant in
 * SpecFormDialog. Approval is dual-signature (migration 045: one leader
 * prepares, a DIFFERENT one approves) — this helper only answers the role
 * question; the "different person" rule is enforced server-side
 * (computeApproval's baski_onay branch) and surfaced via SpecFormDialog's
 * prepare/approve button switch.
 *
 * @param {{ role: string }} user
 */
export function isBaskiOnayApprover(user) {
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
