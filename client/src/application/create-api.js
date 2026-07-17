import { hydrateMockForms } from '../infrastructure/mock/helpers/hydrate-forms.js'
import { createMockAuthRepository } from '../infrastructure/mock/repositories/mock-auth.repository.js'
import { createMockUserRepository } from '../infrastructure/mock/repositories/mock-user.repository.js'
import { createMockProjectRepository } from '../infrastructure/mock/repositories/mock-project.repository.js'
import { createMockSubtaskRepository } from '../infrastructure/mock/repositories/mock-subtask.repository.js'
import { createMockDemoRepository } from '../infrastructure/mock/repositories/mock-demo.repository.js'
import { createMockOrderRepository } from '../infrastructure/mock/repositories/mock-order.repository.js'
import { createMockHandoverRepository } from '../infrastructure/mock/repositories/mock-handover.repository.js'
import { makeAdvanceOrderRequest } from './use-cases/orders/advance-order-request.js'
import { makeCreateOrderRequest } from './use-cases/orders/create-order-request.js'
import { makeRejectOrderRequest } from './use-cases/orders/reject-order-request.js'
import { makeCreateHandover } from './use-cases/handovers/create-handover.js'
import { makeConfirmHandover } from './use-cases/handovers/confirm-handover.js'

let hydrated = false

/**
 * Composition root — wires repositories and use cases into the API
 * surface consumed by React hooks and pages.
 */
export function createApi() {
  if (!hydrated) {
    hydrateMockForms()
    hydrated = true
  }

  const authRepo = createMockAuthRepository()
  const userRepo = createMockUserRepository()
  const projectRepo = createMockProjectRepository(userRepo)
  const subtaskRepo = createMockSubtaskRepository()
  const demoRepo = createMockDemoRepository()
  const orderRepo = createMockOrderRepository(userRepo)
  const handoverRepo = createMockHandoverRepository()

  // Freeze imported seed history into the store once, so it becomes canonical
  // append-only data instead of being re-fabricated on every render.
  projectRepo.backfillHistories()

  // Bridge: keep the shared project store in lockstep with mutations the use
  // cases perform on the project aggregate (reassignment, handover
  // confirmation, pass reopen). Pages read from useProjectsStore() — without
  // this push, they'd only see the change after the 30 s refetch tick.
  const projectStoreListeners = new Set()
  function bridgeProjects(project) {
    if (!project?.id) return
    for (const fn of projectStoreListeners) {
      try { fn(project) } catch { /* swallow subscriber errors */ }
    }
  }

  const advanceOrderRequest = makeAdvanceOrderRequest({ orderRepo, projectRepo, userRepo })
  const createOrderRequest = makeCreateOrderRequest({ orderRepo, projectRepo })
  const rejectOrderRequest = makeRejectOrderRequest({ orderRepo, projectRepo })
  const createHandover = makeCreateHandover({ handoverRepo, projectRepo, onProjectChanged: bridgeProjects })
  const confirmHandover = makeConfirmHandover({ handoverRepo, projectRepo, onProjectChanged: bridgeProjects })

  return {
    // Auth
    login: (email, password) => authRepo.login(email, password),
    loginAsUser: async (userId) => {
      const res = await authRepo.loginAsUser(userId)
      return res
    },
    logout: () => authRepo.logout(),
    previewInvite: (token) => authRepo.previewInvite(token),
    acceptInvite: (token, password) => authRepo.acceptInvite(token, password),
    forgotPassword: (email) => authRepo.forgotPassword(email),
    resetPassword: (token, password) => authRepo.resetPassword(token, password),

    // Users
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
    toggleSubtask: (projectId, subtaskId, isDone) =>
      subtaskRepo.toggleSubtask(projectId, subtaskId, isDone),
    setSubtaskDone: (subtaskId, isDone) => subtaskRepo.setSubtaskDone(subtaskId, isDone),
    setSubtaskPages: (subtaskId, pagesDone) => subtaskRepo.setSubtaskPages(subtaskId, pagesDone),
    addSubtaskUpdate: (subtaskId, payload) => subtaskRepo.addSubtaskUpdate(subtaskId, payload),
    updateSubtask: (subtaskId, patch) => subtaskRepo.updateSubtask(subtaskId, patch),
    saveProjectSubtasks: (projectId, subtasks) =>
      subtaskRepo.saveProjectSubtasks(projectId, subtasks),

    // Demos
    listDemos: () => demoRepo.listDemos(),
    createDemo: (payload) => demoRepo.createDemo(payload),

    // Orders
    listOrderRequests: () => orderRepo.listOrderRequests(),
    createOrderRequest,
    updateOrderRequest: (id, status) => orderRepo.updateOrderRequest(id, status),
    advanceOrderRequest,
    rejectOrderRequest,

    // Handovers (Matbaa → Sales "teslim")
    listHandovers: () => handoverRepo.listHandovers(),
    createHandover,
    confirmHandover,

    // Live-sync hook: subscribe to project mutations performed by the cross-
    // aggregate use cases (orders, handovers) so the shared store updates
    // immediately rather than waiting for the next 30 s refetch.
    subscribeProjects(fn) {
      projectStoreListeners.add(fn)
      return () => projectStoreListeners.delete(fn)
    },
  }
}