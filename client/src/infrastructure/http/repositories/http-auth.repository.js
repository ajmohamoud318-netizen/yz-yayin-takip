import { httpClient } from '../client.js'

/**
 * Auth repo when the real backend is wired in.
 *
 * Server uses signed httpOnly cookies (yz_sid) backed by Redis sessions.
 * The browser sends the cookie automatically on every request; we never
 * touch the cookie from JS. The shape of the public methods is the same
 * as before so the SPA's auth hook didn't have to change.
 *
 * Sign-in flow:
 *   1. POST /api/auth/magic         — user enters email → server emails link
 *   2. User clicks the link in the email → browser hits the SPA
 *      `/auth/magic?token=...` route → which calls the magic-callback
 *      endpoint server-side? No — the callback is `/api/auth/magic/callback`
 *      and the server's redirect lands the user on the SPA dashboard.
 *   3. SPA then calls GET /api/auth/me to confirm the session is live.
 */
export function createHttpAuthRepository() {
  return {
    /**
     * Request a magic-link email. Returns immediately with `{ ok: true }`
     * whether or not the email matched a user (server returns 200 for
     * both cases so attackers can't enumerate accounts).
     */
    async login(email) {
      const { data } = await httpClient.post('/auth/magic', { email })
      return data
    },
    /**
     * Dev-only "log in as <user>" path. The backend's /auth/dev-login
     * endpoint mints a real session + sets the cookie without going
     * through email. Useful when SMTP isn't configured locally.
     * Gated by NODE_ENV !== 'production' on the server.
     */
    async loginAsUser(userId) {
      const { data } = await httpClient.post('/auth/dev-login', { user_id: userId })
      return data
    },
    async logout() {
      try {
        await httpClient.post('/auth/logout')
      } catch {
        /* ignore network failures on logout */
      }
      return { ok: true }
    },
    /**
     * Look up the current session's user. Throws 401 if no cookie is
     * present. Used on app boot to restore the session after a reload.
     */
    async me() {
      const { data } = await httpClient.get('/auth/me')
      return data
    },
    /**
     * Look up an invitation by token so the AcceptInvite page can show the
     * invitee's name without consuming the token. Returns
     * { name, email, role, expiresAt }.
     */
    async previewInvite(token) {
      const { data } = await httpClient.get('/auth/invite-preview', {
        params: { token },
      })
      return data
    },
    /**
     * Set the user's password via an invitation token. Server signs the
     * user in immediately (sets the yz_sid cookie) and returns { user }.
     * The caller can navigate straight to the dashboard.
     */
    async acceptInvite(token, password) {
      const { data } = await httpClient.post('/auth/accept-invite', {
        token,
        password,
      })
      return data
    },
    /**
     * Ask the server to email a password-reset link. Always resolves;
     * the server returns 200 even when the email is unknown so we don't
     * leak which addresses are in the system.
     */
    async forgotPassword(email) {
      const { data } = await httpClient.post('/auth/forgot-password', {
        email,
      })
      return data
    },
    /**
     * Set a new password via a reset token. Server signs the user in
     * immediately and returns { user }.
     */
    async resetPassword(token, password) {
      const { data } = await httpClient.post('/auth/reset-password', {
        token,
        password,
      })
      return data
    },
    /**
     * Rotate the caller's own password. Requires the current password
     * as proof (skipped only when the account has never set one).
     */
    async changePassword(currentPassword, newPassword) {
      const { data } = await httpClient.patch('/auth/change-password', {
        currentPassword,
        newPassword,
      })
      return data
    },
    /**
     * Upload / replace the caller's avatar. Sends the file as
     * multipart/form-data to PUT /users/me/avatar; the server writes it
     * to disk, updates `users.avatar_url` + `avatar_updated_at`, and
     * returns `{ avatarUrl }` (the relative URL the <img> tag should
     * fetch).
     */
    async uploadAvatar(file) {
      if (!file) throw new Error('Dosya bulunamadı.')
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await httpClient.put('/users/me/avatar', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data
    },
    /**
     * Remove the caller's stored avatar. Server nulls the columns and
     * unlinks the on-disk file. Resolves with `{ ok: true }`.
     */
    async deleteAvatar() {
      const { data } = await httpClient.delete('/users/me/avatar')
      return data
    },
  }
}