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

// True once a project has reached `stage` or moved past it in its own
// pipeline. Used to make a sipariş's final approval forward-only: two
// concurrent orders on the same project both flip it to 'baskida' on
// approval, and without this guard the second approval would regress a
// project that another order (or the main pipeline) already advanced past
// that point (e.g. all the way to 'satista').
export function isAtOrPastStage(project, stage) {
  const pipeline = getPipeline(project.type)
  const currentIdx = pipeline.indexOf(project.stage)
  const targetIdx = pipeline.indexOf(stage)
  return targetIdx !== -1 && currentIdx !== -1 && currentIdx >= targetIdx
}

/**
 * True when a product is listed in the Ürünler catalog at all.
 *
 * `catalog_hidden` is the team leader's "kaldır" (migration 033): the project
 * stays exactly as it is everywhere else, it just leaves the sipariş catalog.
 */
export function isCatalogListed(project) {
  return !!project && ORDERABLE_STAGES.has(project.stage) && !project.catalog_hidden
}

export function canRequestOrder(project) {
  return isCatalogListed(project) && !!project.has_product_info
}

export function assertOrderable(project) {
  // Separate branch from the generic message below: a delisted product looks
  // perfectly orderable to Sales (finished stage, spec filled in), so the
  // generic "üretime hazır olmalı" text would be actively misleading.
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
    const err = new Error('Kayıtlı ürün pipeline üzerinde ilerletilemez. Yeni bir baskı talebi oluşturun.')
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

/**
 * May the matbaa raise a teslim for THIS sipariş's print run (migration 081)?
 *
 * One condition, and the simplicity is the point: the run cleared baskı onayı,
 * so there are copies to hand over. `teslim_edildi` is terminal, so an order
 * that has already been delivered answers false without a second lookup.
 *
 * Deliberately NOT conditioned on the project's stage. An order is always an
 * ADDITIONAL print run — `assertOrderable` only lets one be raised against a
 * title that already reached baskıda — so a sipariş's copies are never the
 * same copies the project's own teslim delivers, and one teslim can never
 * stand in for the other.
 *
 * Making it stage-dependent was the tempting mistake: "hide the reprint while
 * the project's own teslim is available" reads as de-duplication, but the
 * project's stage moves underneath it. Confirming the project's teslim pushes
 * it to `satista`, and at that instant every order still at `baskida` — the
 * ones physically handed over in that very delivery included — would start
 * demanding a teslim of their own. A rule that changes its answer because a
 * different aggregate moved is not a rule about this order.
 */
export function canRequestOrderHandover(order) {
  return order?.status === 'baskida'
}

export function assertOrderHandoverEligible(order) {
  if (order?.status === 'teslim_edildi') {
    const err = new Error('Bu baskı zaten teslim edildi.')
    err.status = 400
    throw err
  }
  if (!canRequestOrderHandover(order)) {
    const err = new Error('Teslim talebi yalnızca baskısı onaylanmış siparişler için oluşturulabilir.')
    err.status = 400
    throw err
  }
}
