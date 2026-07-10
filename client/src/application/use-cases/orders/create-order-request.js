import { assertOrderable } from '../../../domain/index.js'
import { httpClient } from '../../../infrastructure/http/client.js'
import { badRequest } from '../../../infrastructure/mock/helpers/errors.js'
import { mockOrHttp } from '../../../infrastructure/mock/helpers/mock-handler.js'

/**
 * Cross-aggregate use case: Sales orders are raised ONLY against a finished
 * (satışta) book — see ORDERABLE_STAGES. Each such order opens a NEW pass on the
 * book before the order is recorded, which is what turns a project into a
 * repeatable loop (Pass 2+ — reprint / resell).
 *
 * First editions do NOT enter through here: a fresh book reaches production via
 * the printer's "Üretime Al" and becomes satışta through the handover (teslim)
 * flow. It only becomes orderable once it's actually selling. (Earlier notes
 * suggested a book could be ordered at uretime_hazir — that path never existed;
 * assertOrderable gates on satışta. See PASSES.md "Pass 1 vs the app".)
 */
export function makeCreateOrderRequest({ orderRepo, projectRepo }) {
  return function createOrderRequest(payload) {
    return mockOrHttp(
      () => {
        const { projectId, requester, kind = PASS_KIND.REPRINT } = payload
        const project = projectId ? projectRepo.findProjectById(projectId) : null

        // Rule: only Satışta-stage products are orderable.
        assertOrderable(project)

        // One open order per project — mirrors the handover pending-duplicate
        // guard. Without this, ordering the same finished book twice would reopen
        // two passes and double-archive the completed one.
        if (projectId && orderRepo.findOpenByProject(projectId)) {
          badRequest('Bu proje için zaten açık bir sipariş talebi var.')
        }

        // assertOrderable already guarantees satışta; this stays as a defensive
        // guard. Opening the new pass moves the book satışta → uretime_hazir so
        // the order workflow can drive it back through production.
        if (project && project.stage === 'satista') {
          projectRepo.reopenForNewPass(projectId, {
            kind,
            trigger: {
              by_id: requester?.id,
              by_name: requester?.name,
              by_role: requester?.role,
            },
          })
        }

        return orderRepo.createOrderRequest(payload)
      },
      async () => {
        const { data } = await httpClient.post('/order-requests', payload)
        return data
      },
    )
  }
}
