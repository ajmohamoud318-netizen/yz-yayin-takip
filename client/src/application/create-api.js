import { hydrateMockForms } from '../infrastructure/mock/helpers/hydrate-forms.js'
import { createMockAuthRepository } from '../infrastructure/mock/repositories/mock-auth.repository.js'
import { createMockUserRepository } from '../infrastructure/mock/repositories/mock-user.repository.js'
import { createMockProjectRepository } from '../infrastructure/mock/repositories/mock-project.repository.js'
import { createMockSubtaskRepository } from '../infrastructure/mock/repositories/mock-subtask.repository.js'
import { createMockDemoRepository } from '../infrastructure/mock/repositories/mock-demo.repository.js'
import { createMockOrderRepository } from '../infrastructure/mock/repositories/mock-order.repository.js'
import { makeAdvanceOrderRequest } from './use-cases/orders/advance-order-request.js'

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

  const advanceOrderRequest = makeAdvanceOrderRequest({ orderRepo, projectRepo })

  return {
    // Auth
    login: (email, password) => authRepo.login(email, password),
    logout: () => authRepo.logout(),

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
    approveStage: (id, stage) => projectRepo.approveStage(id, stage),
    rejectStage: (id, stage, reason) => projectRepo.rejectStage(id, stage, reason),
    approveProject: (id) => projectRepo.approveProject(id),
    rejectProject: (id, reason, revizeIds) => projectRepo.rejectProject(id, reason, revizeIds),
    requestDemo: (projectId) => projectRepo.requestDemo(projectId),

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
    createOrderRequest: (payload) => orderRepo.createOrderRequest(payload),
    updateOrderRequest: (id, status) => orderRepo.updateOrderRequest(id, status),
    advanceOrderRequest,
  }
}
