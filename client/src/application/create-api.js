/**
 * Composition root — wires HTTP repositories + cross-aggregate use
 * cases into the `api` surface consumed by React hooks and pages.
 *
 * The HTTP repositories (`infrastructure/http/repositories/*`) are the
 * single source of truth for backend interaction. Cross-aggregate use
 * cases (orders, handovers) live here so they can compose repos
 * without the presentation layer having to know about them.
 */
import { createHttpAuthRepository } from '../infrastructure/http/repositories/http-auth.repository.js'
import { createHttpUserRepository } from '../infrastructure/http/repositories/http-user.repository.js'
import { createHttpProjectRepository } from '../infrastructure/http/repositories/http-project.repository.js'
import { createHttpSubtaskRepository } from '../infrastructure/http/repositories/http-subtask.repository.js'
import { createHttpDemoRepository } from '../infrastructure/http/repositories/http-demo.repository.js'
import { createHttpOrderRepository } from '../infrastructure/http/repositories/http-order.repository.js'
import { createHttpHandoverRepository } from '../infrastructure/http/repositories/http-handover.repository.js'
import { makeAdvanceOrderRequest } from './use-cases/orders/advance-order-request.js'
import { makeCreateOrderRequest } from './use-cases/orders/create-order-request.js'
import { makeRejectOrderRequest } from './use-cases/orders/reject-order-request.js'
import { makeCreateHandover } from './use-cases/handovers/create-handover.js'
import { makeConfirmHandover } from './use-cases/handovers/confirm-handover.js'

export function createApi() {
  const authRepo = createHttpAuthRepository()
  const userRepo = createHttpUserRepository()
  const projectRepo = createHttpProjectRepository(userRepo)
  const subtaskRepo = createHttpSubtaskRepository()
  const demoRepo = createHttpDemoRepository()
  const orderRepo = createHttpOrderRepository()
  const handoverRepo = createHttpHandoverRepository()

  return {
    // Auth
    login: (email, password) => authRepo.login(email, password),
    loginAsUser: (userId) => authRepo.loginAsUser(userId),
    logout: () => authRepo.logout(),
    previewInvite: (token) => authRepo.previewInvite(token),
    acceptInvite: (token, password) => authRepo.acceptInvite(token, password),
    forgotPassword: (email) => authRepo.forgotPassword(email),
    resetPassword: (token, password) => authRepo.resetPassword(token, password),
    changePassword: (currentPassword, newPassword) =>
      authRepo.changePassword(currentPassword, newPassword),
    uploadAvatar: (file) => authRepo.uploadAvatar(file),
    deleteAvatar: () => authRepo.deleteAvatar(),

    // Users
    listUsers: () => userRepo.listUsers(),
    inviteUser: (payload) => userRepo.inviteUser(payload),
    setUserActive: (id, isActive) => userRepo.setUserActive(id, isActive),
    setUserCapability: (id, capability, value) =>
      userRepo.setUserCapability(id, capability, value),
    // Hard delete — backend enforces team_leader-only + no-self-delete.
    deleteUser: (id) => userRepo.deleteUser(id),

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
    reviseSubtask: (subtaskId) => subtaskRepo.reviseSubtask(subtaskId),
    addSubtaskUpdate: (subtaskId, payload) => subtaskRepo.addSubtaskUpdate(subtaskId, payload),
    updateSubtask: (subtaskId, patch) => subtaskRepo.updateSubtask(subtaskId, patch),
    saveProjectSubtasks: (projectId, subtasks) =>
      subtaskRepo.saveProjectSubtasks(projectId, subtasks),

    // Demos
    listDemos: () => demoRepo.listDemos(),
    createDemo: (payload) => demoRepo.createDemo(payload),

    // Orders
    listOrderRequests: () => orderRepo.listOrderRequests(),
    createOrderRequest: makeCreateOrderRequest(),
    advanceOrderRequest: makeAdvanceOrderRequest(),
    rejectOrderRequest: makeRejectOrderRequest(),

    // Handovers (Matbaa → Sales "teslim")
    listHandovers: () => handoverRepo.listHandovers(),
    createHandover: makeCreateHandover(),
    confirmHandover: makeConfirmHandover(),
  }
}
