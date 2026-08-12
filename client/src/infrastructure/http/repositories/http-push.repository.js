import { httpClient } from '../client.js'

/**
 * Web push repo. Registers/removes THIS browser-on-this-device as a push
 * target for the signed-in user.
 *
 * The server binds every subscription to the authenticated user, so nothing
 * here sends a user id — the session decides ownership.
 */
export function createHttpPushRepository() {
  return {
    // { enabled, key }. `enabled: false` means the server has no VAPID keys
    // configured; the UI should hide the toggle rather than prompt for a
    // permission it cannot act on.
    async getPushPublicKey() {
      const { data } = await httpClient.get('/push/public-key')
      return { enabled: Boolean(data?.enabled), key: data?.key ?? '' }
    },
    async savePushSubscription(subscription) {
      const { data } = await httpClient.post('/push/subscribe', { subscription })
      return data?.ok ?? false
    },
    async deletePushSubscription(endpoint) {
      const { data } = await httpClient.delete('/push/subscribe', { data: { endpoint } })
      return data?.ok ?? false
    },
    // Returns { sent, pruned } — `sent: 0` is the diagnostic that tells a
    // user "permission is granted but no device is registered".
    async sendTestPush() {
      const { data } = await httpClient.post('/push/test', {})
      return { sent: data?.sent ?? 0, pruned: data?.pruned ?? 0 }
    },
  }
}
