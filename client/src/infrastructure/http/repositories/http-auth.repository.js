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
     * Return the currently-authenticated user based on the session cookie,
     * or throw 401 if there is no valid session. Used on app load to
     * rehydrate the session from the httpOnly cookie (which JS can't read).
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
    /**
     * Upload / replace the caller's avatar. Sends the file as
     * multipart/form-data to PUT /users/me/avatar; the server writes it
     * to disk, updates `users.avatar_url` + `avatar_updated_at`, and
     * returns `{ avatarUrl, avatarUpdatedAt }` — the relative URL the
     * <img> tag should fetch, plus the stamp the SPA appends as `?v=` so
     * a replaced photo isn't served from the browser cache.
     *
     * Callers downscale before handing the file over (see lib/image.js),
     * so this is tens of KB rather than a multi-MB camera photo.
     */
    async uploadAvatar(file) {
      if (!file) throw new Error('Dosya bulunamadı.')
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await httpClient.put('/users/me/avatar', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // Opt out of the client-wide 20 s ceiling: that budget is sized for
        // JSON round trips, and a phone photo on a weak connection can
        // legitimately take longer. An upload the user explicitly started is
        // also visibly in progress, so a hang here is not the silent
        // blank-screen failure the default timeout exists to prevent.
        timeout: 0,
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
