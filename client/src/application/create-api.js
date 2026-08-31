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
import { createHttpProductInfoRepository } from '../infrastructure/http/repositories/http-product-info.repository.js'
import { createHttpOrderRepository } from '../infrastructure/http/repositories/http-order.repository.js'
import { createHttpHandoverRepository } from '../infrastructure/http/repositories/http-handover.repository.js'
import { createHttpNotificationRepository } from '../infrastructure/http/repositories/http-notification.repository.js'
import { createHttpPushRepository } from '../infrastructure/http/repositories/http-push.repository.js'
import { createHttpWorkLogRepository } from '../infrastructure/http/repositories/http-work-log.repository.js'
import { createHttpTargetProjectIdeaRepository } from '../infrastructure/http/repositories/http-target-project-idea.repository.js'
import { createHttpMeetingRepository } from '../infrastructure/http/repositories/http-meeting.repository.js'
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
  const productInfoRepo = createHttpProductInfoRepository()
  const orderRepo = createHttpOrderRepository()
  const handoverRepo = createHttpHandoverRepository()
  const notificationRepo = createHttpNotificationRepository()
  const pushRepo = createHttpPushRepository()
  const workLogRepo = createHttpWorkLogRepository()
  const targetProjectIdeaRepo = createHttpTargetProjectIdeaRepository()
  const meetingRepo = createHttpMeetingRepository()

  return {
    // Auth
    login: (email, password) => authRepo.login(email, password),
    loginAsUser: (userId) => authRepo.loginAsUser(userId),
    logout: () => authRepo.logout(),
    me: () => authRepo.me(),
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
    // Hard delete — backend enforces team_leader-only + no-self-delete.
    deleteUser: (id) => userRepo.deleteUser(id),
    // Work log ("Çalışma Defteri") — replaces the old single-line
    // setMyStatus note. Entries are typed, timed and kept as history.
    listWorkLog: (days) => workLogRepo.listWorkLog(days),
    addWorkLogEntry: (entry) => workLogRepo.addWorkLogEntry(entry),
    updateWorkLogEntry: (id, patch) => workLogRepo.updateWorkLogEntry(id, patch),
    deleteWorkLogEntry: (id) => workLogRepo.deleteWorkLogEntry(id),

    // Hedef Projeler — idea board on Baskı Listesi.
    listTargetProjectIdeas: () => targetProjectIdeaRepo.listTargetProjectIdeas(),
    getTargetProjectIdeaDetail: (id) => targetProjectIdeaRepo.getTargetProjectIdeaDetail(id),
    addTargetProjectIdea: (payload) => targetProjectIdeaRepo.addTargetProjectIdea(payload),
    updateTargetProjectIdea: (id, patch) => targetProjectIdeaRepo.updateTargetProjectIdea(id, patch),
    deleteTargetProjectIdea: (id) => targetProjectIdeaRepo.deleteTargetProjectIdea(id),
    uploadTargetProjectIdeaImage: (id, file) =>
      targetProjectIdeaRepo.uploadTargetProjectIdeaImage(id, file),
    deleteTargetProjectIdeaImage: (id) => targetProjectIdeaRepo.deleteTargetProjectIdeaImage(id),
    addTargetProjectIdeaGalleryImage: (id, file) =>
      targetProjectIdeaRepo.addTargetProjectIdeaGalleryImage(id, file),
    deleteTargetProjectIdeaGalleryImage: (id, imageId) =>
      targetProjectIdeaRepo.deleteTargetProjectIdeaGalleryImage(id, imageId),
    addTargetProjectIdeaNote: (id, body) => targetProjectIdeaRepo.addTargetProjectIdeaNote(id, body),
    updateTargetProjectIdeaNote: (id, noteId, body) =>
      targetProjectIdeaRepo.updateTargetProjectIdeaNote(id, noteId, body),
    deleteTargetProjectIdeaNote: (id, noteId) => targetProjectIdeaRepo.deleteTargetProjectIdeaNote(id, noteId),

    // Toplantılar — meeting log.
    listMeetings: () => meetingRepo.listMeetings(),
    getMeetingDetail: (id) => meetingRepo.getMeetingDetail(id),
    addMeeting: (payload) => meetingRepo.addMeeting(payload),
    updateMeeting: (id, patch) => meetingRepo.updateMeeting(id, patch),
    deleteMeeting: (id) => meetingRepo.deleteMeeting(id),
    uploadMeetingImage: (id, file) => meetingRepo.uploadMeetingImage(id, file),
    deleteMeetingImage: (id) => meetingRepo.deleteMeetingImage(id),
    addMeetingGalleryImage: (id, file) => meetingRepo.addMeetingGalleryImage(id, file),
    deleteMeetingGalleryImage: (id, imageId) => meetingRepo.deleteMeetingGalleryImage(id, imageId),
    addMeetingNote: (id, body) => meetingRepo.addMeetingNote(id, body),
    updateMeetingNote: (id, noteId, body) => meetingRepo.updateMeetingNote(id, noteId, body),
    deleteMeetingNote: (id, noteId) => meetingRepo.deleteMeetingNote(id, noteId),

    // Projects
    listProjects: () => projectRepo.listProjects(),
    getProject: (id) => projectRepo.getProject(id),
    createProject: (payload) => projectRepo.createProject(payload),
    // Backlist/kayıt import — promotes Ürün Bilgileri seed entries into real
    // orderable products. See AGENTS.md → "Kayıtlı ürünler (legacy)".
    importProjects: (items, opts) => projectRepo.importProjects(items, opts),
    updateProject: (id, patch) => projectRepo.updateProject(id, patch),
    deleteProject: (id) => projectRepo.deleteProject(id),
    listDeletedProjects: () => projectRepo.listDeletedProjects(),
    restoreProject: (id) => projectRepo.restoreProject(id),
    // Ürünler catalog "kaldır" / "geri al" — hides a finished product from
    // Sales without touching the project itself. See AGENTS.md → "Ürünler".
    setProductCatalogHidden: (id, hidden) => projectRepo.setProductCatalogHidden(id, hidden),
    advanceProject: (id, route = null) => projectRepo.advanceProject(id, route),
    approveProject: (id) => projectRepo.approveProject(id),
    receiveDemo: (id) => projectRepo.receiveDemo(id),
    reportDemoNotReceived: (id) => projectRepo.reportDemoNotReceived(id),
    receiveOzalit: (id) => projectRepo.receiveOzalit(id),
    reportOzalitNotReceived: (id) => projectRepo.reportOzalitNotReceived(id),
    // Matbaa "Başladım" gate + cancel + change-request (migration 048).
    markDemoStarted: (id) => projectRepo.markDemoStarted(id),
    markOzalitStarted: (id) => projectRepo.markOzalitStarted(id),
    cancelDemoRequest: (id) => projectRepo.cancelDemoRequest(id),
    cancelOzalitRequest: (id) => projectRepo.cancelOzalitRequest(id),
    notifyDemoEdit: (id, sheet) => projectRepo.notifyDemoEdit(id, sheet),
    notifyOzalitEdit: (id, sheet) => projectRepo.notifyOzalitEdit(id, sheet),
    requestDemoChange: (id, note) => projectRepo.requestDemoChange(id, note),
    requestOzalitChange: (id, note) => projectRepo.requestOzalitChange(id, note),
    acceptDemoChangeRequest: (id) => projectRepo.acceptDemoChangeRequest(id),
    declineDemoChangeRequest: (id) => projectRepo.declineDemoChangeRequest(id),
    acceptOzalitChangeRequest: (id) => projectRepo.acceptOzalitChangeRequest(id),
    declineOzalitChangeRequest: (id) => projectRepo.declineOzalitChangeRequest(id),
    prepareBaskiOnay: (id) => projectRepo.prepareBaskiOnay(id),
    // Ekran Demo Onayı — lightweight digital alternative to a physical
    // re-demo for a held demo at 100% progress (migration 050).
    requestEkranDemoOnay: (id) => projectRepo.requestEkranDemoOnay(id),
    approveEkranDemo: (id) => projectRepo.approveEkranDemo(id),
    rejectEkranDemo: (id, reason) => projectRepo.rejectEkranDemo(id, reason),
    rejectProject: (id, reason, revizeIds, target) => projectRepo.rejectProject(id, reason, revizeIds, target),

    // Subtasks
    toggleSubtask: (projectId, subtaskId, isDone) =>
      subtaskRepo.toggleSubtask(projectId, subtaskId, isDone),
    setSubtaskDone: (subtaskId, isDone) => subtaskRepo.setSubtaskDone(subtaskId, isDone),
    setSubtaskPages: (subtaskId, pagesDone) => subtaskRepo.setSubtaskPages(subtaskId, pagesDone),
    setSubtaskStickers: (subtaskId, stickersDone) =>
      subtaskRepo.setSubtaskStickers(subtaskId, stickersDone),
    setSubtaskPage: (subtaskId, pageIndex, status) =>
      subtaskRepo.setSubtaskPage(subtaskId, pageIndex, status),
    // migration 056 — leader-side gesture for splitting pages between
    // designers (pre-allocation) or moving a page to a different designer
    // mid-revision. The chip grid's "atama" affordance is the caller;
    // passing null un-assigns.
    assignSubtaskPage: (subtaskId, pageIndex, assignedTo) =>
      subtaskRepo.assignSubtaskPage(subtaskId, pageIndex, assignedTo),
    // Bulk-assign every page in an İç Sayfalar subtask. Two gestures:
    // pass `{ assignedTo }` for a single-designer overwrite, or
    // `{ distribute: true }` to round-robin across the active roster.
    // Replaces 200 per-chip popovers with one click.
    bulkAssignSubtaskPages: (subtaskId, opts) =>
      subtaskRepo.bulkAssignSubtaskPages(subtaskId, opts),
    reviseSubtask: (subtaskId) => subtaskRepo.reviseSubtask(subtaskId),
    addSubtaskUpdate: (subtaskId, payload) => subtaskRepo.addSubtaskUpdate(subtaskId, payload),
    updateSubtask: (subtaskId, patch) => subtaskRepo.updateSubtask(subtaskId, patch),
    saveProjectSubtasks: (projectId, subtasks) =>
      subtaskRepo.saveProjectSubtasks(projectId, subtasks),

    // Demos
    listDemos: () => demoRepo.listDemos(),
    createDemo: (payload) => demoRepo.createDemo(payload),

    // Product info (ürün bilgileri / parçalar)
    listProductInfo: () => productInfoRepo.listProductInfo(),
    getProductInfo: (projectId) => productInfoRepo.getProductInfo(projectId),
    saveProductInfo: (projectId, components) =>
      productInfoRepo.saveProductInfo(projectId, components),

    // Orders
    listOrderRequests: () => orderRepo.listOrderRequests(),
    createOrderRequest: makeCreateOrderRequest(),
    advanceOrderRequest: makeAdvanceOrderRequest(),
    rejectOrderRequest: makeRejectOrderRequest(),
    matbaaReceiveOrder: (id) => orderRepo.matbaaReceiveOrder(id),
    matbaaNotReceivedOrder: (id) => orderRepo.matbaaNotReceivedOrder(id),
    updateOrderSubtask: (orderId, subtaskId, patch) => orderRepo.updateOrderSubtask(orderId, subtaskId, patch),
    saveOrderBaskiOnayForm: (id, body) => orderRepo.saveOrderBaskiOnayForm(id, body),
    prepareOrderBaskiOnayForm: (id, body) => orderRepo.prepareOrderBaskiOnayForm(id, body),
    approveOrderBaskiOnayForm: (id, body) => orderRepo.approveOrderBaskiOnayForm(id, body),
    startOrderOzalit: (id) => orderRepo.startOrderOzalit(id),
    cancelOrderOzalit: (id) => orderRepo.cancelOrderOzalit(id),
    notifyOrderOzalitEdit: (id, sheet) => orderRepo.notifyOrderOzalitEdit(id, sheet),
    requestOrderOzalitChange: (id, note) => orderRepo.requestOrderOzalitChange(id, note),
    acceptOrderOzalitChange: (id) => orderRepo.acceptOrderOzalitChange(id),
    declineOrderOzalitChange: (id) => orderRepo.declineOrderOzalitChange(id),

    // Handovers (Matbaa → Sales "teslim")
    listHandovers: () => handoverRepo.listHandovers(),
    createHandover: makeCreateHandover(),
    confirmHandover: makeConfirmHandover(),

    // Notifications (server-backed feed)
    listNotifications: (opts) => notificationRepo.listNotifications(opts),
    markNotificationRead: (id) => notificationRepo.markNotificationRead(id),
    markAllNotificationsRead: () => notificationRepo.markAllNotificationsRead(),
    markNotificationsSeen: () => notificationRepo.markNotificationsSeen(),

    // Web push (device registration for the same feed)
    getPushPublicKey: () => pushRepo.getPushPublicKey(),
    savePushSubscription: (sub) => pushRepo.savePushSubscription(sub),
    deletePushSubscription: (endpoint) => pushRepo.deletePushSubscription(endpoint),
    sendTestPush: () => pushRepo.sendTestPush(),
  }
}
