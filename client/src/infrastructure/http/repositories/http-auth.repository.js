import { httpClient } from '../client.js'

/**
 * Auth repo when the real backend is wired in.
 *
 * Server returns { token, user } where `token` is the user's UUID — we
 * stash it client-side as an `X-User-Id` header. Real OAuth is the
 * next pass; this swap keeps every existing UI hook working.
 */
export function createHttpAuthRepository() {
  return {
    async login(email, password) {
      const { data } = await httpClient.post('/auth/login', { email, password })
      return data
    },
    /**
     * Dev-only "log in as <user>" path. The backend exposes /auth/dev-login
     * so the SPA can drive the real API without bcrypt-hashed seed passwords.
     * Returns the same { token, user } shape as login().
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
     * Set the user's password via an invitation token. Returns the same
     * { token, user } shape as login() so the caller can sign the user in
     * straight away.
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
     * Set a new password via a reset token. Returns { token, user } so
     * the SPA can log the user straight in.
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
  }
}
