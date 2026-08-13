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
    /**
     * One page of the feed. `cursor` is the opaque `nextCursor` string from a
     * previous call — pass it to fetch older items.
     *
     * `unread` / `unseen` are whole-feed totals computed server-side, NOT
     * counts of `items`: the badge has to be right even when the unread set is
     * larger than a page (it used to be derived from the page, and silently
     * capped at 50).
     */
    async listNotifications({ cursor = null, limit = null } = {}) {
      const params = {}
      if (cursor) params.cursor = cursor
      if (limit) params.limit = String(limit)
      const { data } = await httpClient.get('/notifications', { params })
      return {
        items: Array.isArray(data?.items) ? data.items : [],
        unread: typeof data?.unread === 'number' ? data.unread : 0,
        unseen: typeof data?.unseen === 'number' ? data.unseen : 0,
        nextCursor: typeof data?.nextCursor === 'string' ? data.nextCursor : null,
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
