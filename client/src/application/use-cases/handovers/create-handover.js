import { assertHandoverEligible } from '../../../domain/index.js'
import { httpClient } from '../../../infrastructure/http/client.js'
import { badRequest } from '../../../infrastructure/mock/helpers/errors.js'
import { mockOrHttp } from '../../../infrastructure/mock/helpers/mock-handler.js'

/**
 * Matbaa raises a handover ("teslim") request for a project whose production is
 * finished (TR: Üretimde, ÇİN: Gümrük). One pending request per project.
 */
export function makeCreateHandover({ handoverRepo, projectRepo, onProjectChanged = null }) {
  return function createHandover({ projectId, creator }) {
    return mockOrHttp(
      () => {
        // Only the matbaa (printer) raises a handover request. Data-layer gate —
        // the UI restricts this too, but the backend must be the source of truth.
        if (creator?.role !== 'printer') {
          badRequest('Teslim talebini yalnızca matbaa oluşturabilir.')
        }
        const project = projectId ? projectRepo.findProjectById(projectId) : null
        if (!project) badRequest('Proje bulunamadı.')
        assertHandoverEligible(project)
        if (handoverRepo.findPendingByProject(projectId)) {
          badRequest('Bu proje için zaten bekleyen bir teslim talebi var.')
        }
        return handoverRepo.createHandover({ project, creator })
      },
      async () => {
        const { data } = await httpClient.post('/handovers', { projectId })
        return data
      },
    )
  }
}
