import { STAGE_PIPELINE, ORDERABLE_STAGES, HANDOVER_ELIGIBLE_STAGE, STAGES_REQUIRING_FULL_PROGRESS } from './stages.js'

export function getPipeline(type) {
  return STAGE_PIPELINE[type] ?? STAGE_PIPELINE.TR
}

export function getNextStage(project) {
  const pipeline = getPipeline(project.type)
  const i = pipeline.indexOf(project.stage)
  if (i === -1 || i === pipeline.length - 1) return null
  return pipeline[i + 1]
}

export function assertCanEnterProduction(nextStage, progress) {
  if (STAGES_REQUIRING_FULL_PROGRESS.has(nextStage) && (progress ?? 0) < 100) {
    const err = new Error('Proje %100 tamamlanmadan Ozalit ve üretim aşamasına geçemez.')
    err.status = 400
    throw err
  }
}

export function canRequestOrder(project) {
  return !!project && ORDERABLE_STAGES.has(project.stage) && !!project.has_product_info
}

export function assertOrderable(project) {
  if (!project || !ORDERABLE_STAGES.has(project.stage) || !project.has_product_info) {
    const err = new Error('Sipariş talebi yalnızca üretime hazır aşamasına ulaşmış ve Ürün Bilgileri girilmiş ürünler için oluşturulabilir.')
    err.status = 400
    throw err
  }
}

/**
 * True for an imported backlist product (migration 031). These rows were
 * inserted straight at a finished stage so Sales could order them; they have no
 * subtasks, no designer and no demo/ozalit history.
 */
export function isLegacyProject(project) {
  return project?.origin === 'legacy'
}

/**
 * Block main-pipeline transitions on an imported backlist product.
 *
 * Not merely meaningless — destructive: advancing a legacy project moves it out
 * of ORDERABLE_STAGES, which drops it from the Ürünler catalog, so Sales
 * silently loses the ability to order it with nothing to explain why.
 *
 * Sipariş (order) and teslim (handover) are deliberately NOT guarded — putting
 * backlist books into those flows is the reason for importing them. A new print
 * run re-enters the pipeline as an order, not as a stage transition.
 */
export function assertNotLegacy(project) {
  if (isLegacyProject(project)) {
    const err = new Error('Arşiv kaydı pipeline üzerinde ilerletilemez. Yeni bir baskı için sipariş talebi oluşturun.')
    err.status = 400
    throw err
  }
}

export function handoverStageFor(type) {
  return HANDOVER_ELIGIBLE_STAGE[type] ?? HANDOVER_ELIGIBLE_STAGE.TR
}

export function canRequestHandover(project) {
  return !!project && project.stage === handoverStageFor(project.type)
}

export function assertHandoverEligible(project) {
  if (!canRequestHandover(project)) {
    const err = new Error('Teslim talebi yalnızca üretimi tamamlanan projeler için oluşturulabilir.')
    err.status = 400
    throw err
  }
}
