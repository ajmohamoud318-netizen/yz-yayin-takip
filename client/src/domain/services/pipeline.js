import { STAGE_PIPELINE } from '../constants/stages.js'

/** @param {'TR'|'CIN'} type */
export function getPipeline(type) {
  return STAGE_PIPELINE[type] ?? STAGE_PIPELINE.TR
}

/** @param {{ type: string, stage: string }} project */
export function getNextStage(project) {
  const pipeline = getPipeline(project.type)
  const i = pipeline.indexOf(project.stage)
  if (i === -1 || i === pipeline.length - 1) return null
  return pipeline[i + 1]
}

/**
 * Business rule: a project cannot enter production until design is 100% complete.
 * @param {string} nextStage
 * @param {number} progress
 */
export function assertCanEnterProduction(nextStage, progress) {
  if (nextStage === 'uretime_hazir' && (progress ?? 0) < 100) {
    const err = new Error('Proje %100 tamamlanmadan üretime hazır olamaz.')
    err.status = 400
    throw err
  }
}
