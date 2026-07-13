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
    const err = new Error('Proje %100 tamamlanmadan Demo, Ozalit ve üretim aşamasına geçemez.')
    err.status = 400
    throw err
  }
}

export function canRequestOrder(project) {
  return !!project && ORDERABLE_STAGES.has(project.stage)
}

export function assertOrderable(project) {
  if (!project || !ORDERABLE_STAGES.has(project.stage)) {
    const err = new Error('Sipariş talebi yalnızca satışta olan ürünler için oluşturulabilir.')
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
