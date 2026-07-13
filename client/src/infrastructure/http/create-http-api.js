/**
 * HTTP composition root. Returns the exact same `api` surface as the
 * mock composition root, so the application / presentation layers are
 * transport-agnostic.
 *
 * Wires:
 *   auth       → /api/auth (X-User-Id header)
 *   users      → /api/users
 *   projects   → /api/projects (+ advance/approve/reject)
 *   subtasks   → /api/subtasks
 *   demos      → /api/demos
 *   orders     → /api/order-requests
 *   handovers  → /api/handovers
 *
 * After this returns, `mockOrHttp` dispatches to HTTP branches because
 * `setTransport('http')` was called.
 */

import { setAuthToken } from './client.js'
import { setTransport } from '../mock/helpers/mock-handler.js'
import { createHttpAuthRepository } from './repositories/http-auth.repository.js'
import { createHttpUserRepository } from './repositories/http-user.repository.js'
import { createHttpProjectRepository } from './repositories/http-project.repository.js'
import { createHttpSubtaskRepository } from './repositories/http-subtask.repository.js'
import { createHttpDemoRepository } from './repositories/http-demo.repository.js'
import { createHttpOrderRepository } from './repositories/http-order.repository.js'
import { createHttpHandoverRepository } from './repositories/http-handover.repository.js'
import { makeAdvanceOrderRequest } from '../../application/use-cases/orders/advance-order-request.js'
import { makeCreateOrderRequest } from '../../application/use-cases/orders/create-order-request.js'
import { makeRejectOrderRequest } from '../../application/use-cases/orders/reject-order-request.js'
import { makeCreateHandover } from '../../application/use-cases/handovers/create-handover.js'
import { makeConfirmHandover } from '../../application/use-cases/handovers/confirm-handover.js'

export function createHttpApi() {
  setTransport('http')

  const authRepo = createHttpAuthRepository()
  const userRepo = createHttpUserRepository()
  const projectRepo = createHttpProjectRepository(userRepo)
  const subtaskRepo = createHttpSubtaskRepository()
  const demoRepo = createHttpDemoRepository()
  const orderRepo = createHttpOrderRepository()
  const handoverRepo = createHttpHandoverRepository()

  // Bridge shared store listeners to the project repo. Cross-aggregate
  // use cases call this so the dashboard updates without waiting for a
  // 30 s refetch.
  const projectStoreListeners = new Set()
  function bridgeProjects(project) {
    if (!project?.id) return
    for (const fn of projectStoreListeners) {
      try { fn(project) } catch { /* swallow */ }
    }
  }

  const advanceOrderRequest = makeAdvanceOrderRequest({ orderRepo, projectRepo, userRepo })
  const createOrderRequest = makeCreateOrderRequest({ orderRepo, projectRepo })
  const rejectOrderRequest = makeRejectOrderRequest({ orderRepo, projectRepo })
  const createHandover = makeCreateHandover({ handoverRepo, projectRepo, onProjectChanged: bridgeProjects })
  const confirmHandover = makeConfirmHandover({ handoverRepo, projectRepo, onProjectChanged: bridgeProjects })

  return {
    // Auth
    login: (email, password) => authRepo.login(email, password).then((res) => {
      // Persist the returned token so subsequent requests carry it.
      if (res?.token) setAuthToken(res.token)
      return res
    }),
    logout: () => authRepo.logout().then(() => { setAuthToken(null) }),

    // Users (need a warm cache before the dashboard loads)
    bootstrapUsers: () => userRepo.listUsers(),
    listUsers: () => userRepo.listUsers(),
    inviteUser: (payload) => userRepo.inviteUser(payload),
    setUserActive: (id, isActive) => userRepo.setUserActive(id, isActive),

    // Projects
    listProjects: () => projectRepo.listProjects(),
    getProject: (id) => projectRepo.getProject(id),
    createProject: (payload) => projectRepo.createProject(payload),
    updateProject: (id, patch) => projectRepo.updateProject(id, patch),
    deleteProject: (id) => projectRepo.deleteProject(id),
    advanceProject: (id) => projectRepo.advanceProject(id),
    approveProject: (id) => projectRepo.approveProject(id),
    rejectProject: (id, reason, revizeIds, target) => projectRepo.rejectProject(id, reason, revizeIds, target),

    // Subtasks
    toggleSubtask: (projectId, subtaskId, isDone) => subtaskRepo.toggleSubtask(projectId, subtaskId, isDone),
    setSubtaskDone: (subtaskId, isDone) => subtaskRepo.setSubtaskDone(subtaskId, isDone),
    setSubtaskPages: (subtaskId, pagesDone) => subtaskRepo.setSubtaskPages(subtaskId, pagesDone),
    addSubtaskUpdate: (subtaskId, payload) => subtaskRepo.addSubtaskUpdate(subtaskId, payload),
    updateSubtask: (subtaskId, patch) => subtaskRepo.updateSubtask(subtaskId, patch),
    saveProjectSubtasks: (projectId, subtasks) => subtaskRepo.saveProjectSubtasks(projectId, subtasks),

    // Demos
    listDemos: () => demoRepo.listDemos(),
    createDemo: (payload) => demoRepo.createDemo(payload),

    // Orders
    listOrderRequests: () => orderRepo.listOrderRequests(),
    createOrderRequest,
    updateOrderRequest: (id, status) => orderRepo.updateOrderRequest(id, status),
    advanceOrderRequest,
    rejectOrderRequest,

    // Handovers
    listHandovers: () => handoverRepo.listHandovers(),
    createHandover,
    confirmHandover,

    subscribeProjects(fn) {
      projectStoreListeners.add(fn)
      return () => projectStoreListeners.delete(fn)
    },
  }
}
