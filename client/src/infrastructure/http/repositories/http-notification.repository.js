import { httpClient } from '../client.js'

/**
 * Notifications repo. Thin wrapper over the server feed
 * (GET /notifications, PATCH /notifications/:id/read, POST /read-all).
 *
 * The server is the single source of truth: read-state, ordering and the
 * unread count all live there, so the feed is durable and consistent across
 * devices/browsers (unlike the old localStorage-derived log).
 */
export function createHttpNotificationRepository() {
  return {
    async listNotifications() {
      const { data } = await httpClient.get('/notifications')
      // { items: [...], unread, unseen }. `unseen` drives the bell badge;
      // `unread` (per-item is_read) drives the bold styling.
      return {
        items: Array.isArray(data?.items) ? data.items : [],
        unread: typeof data?.unread === 'number' ? data.unread : 0,
        unseen: typeof data?.unseen === 'number' ? data.unseen : 0,
      }
    },
    async markNotificationRead(id) {
      const { data } = await httpClient.patch(`/notifications/${id}/read`, {})
      return data?.ok ?? false
    },
    async markAllNotificationsRead() {
      const { data } = await httpClient.post('/notifications/read-all', {})
      return data?.count ?? 0
    },
    // Mark all seen (badge clear on bell open) — leaves is_read untouched.
    async markNotificationsSeen() {
      const { data } = await httpClient.post('/notifications/seen', {})
      return data?.count ?? 0
    },
  }
}
