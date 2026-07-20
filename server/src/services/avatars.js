/**
 * Avatar upload storage.
 *
 * Files land on local disk under `server/uploads/avatars/<userId>.<ext>`.
 * Each user has at most one file; re-uploading replaces the previous one.
 * The public URL the SPA embeds is `/api/users/me/avatar/file` — see the
 * matching `GET` route in `routes/users.js`.
 *
 * For a single-tenant internal tool this is plenty (no need for S3 +
 * signed URLs). The migration to object storage is a one-function swap.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const AVATAR_DIR = path.resolve(__dirname, '../../uploads/avatars')

const ALLOWED_MIME = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png',  'png'],
  ['image/webp', 'webp'],
])
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024  // 2 MB

export function extForMime(mime) {
  return ALLOWED_MIME.get(String(mime || '').toLowerCase()) ?? null
}

export function isAllowedMime(mime) {
  return ALLOWED_MIME.has(String(mime || '').toLowerCase())
}

function pathFor(userId, ext) {
  return path.join(AVATAR_DIR, `${userId}.${ext}`)
}

/** Ensure the on-disk directory exists. Safe to call repeatedly. */
export async function ensureAvatarDir() {
  await fs.mkdir(AVATAR_DIR, { recursive: true })
}

/**
 * Persist an avatar. Removes any previous file for the user so we don't
 * leak disk space after an upload replace / delete.
 *
 * @returns the public URL the SPA should embed.
 */
export async function saveAvatar(userId, ext, buffer) {
  if (!userId) throw new Error('userId is required')
  await ensureAvatarDir()
  // Clear stale files for this user (different extensions, e.g. png → webp).
  for (const e of ALLOWED_MIME.values()) {
    if (e === ext) continue
    try { await fs.unlink(pathFor(userId, e)) } catch { /* missing is fine */ }
  }
  await fs.writeFile(pathFor(userId, ext), buffer)
  // Embed a *resolved* UUID path so the SPA can load the file with a
  // static <img src>. The owner-only `/users/me/avatar/file` alias exists
  // too but uses the X-User-Id header — <img> can't carry custom headers.
  return `/api/users/${encodeURIComponent(userId)}/avatar/file`
}

/** Remove the avatar file for a user, if any. */
export async function deleteAvatar(userId) {
  if (!userId) return
  for (const e of ALLOWED_MIME.values()) {
    try { await fs.unlink(pathFor(userId, e)) } catch { /* missing is fine */ }
  }
}

/** Resolve the on-disk path for a stored avatar, or null if none. */
export async function resolveAvatarPath(userId, avatarUrl) {
  if (!userId || !avatarUrl) return null
  await ensureAvatarDir()
  for (const ext of ALLOWED_MIME.values()) {
    const candidate = pathFor(userId, ext)
    try {
      await fs.access(candidate)
      return candidate
    } catch { /* try next */ }
  }
  return null
}

/** Read the raw bytes off disk for the streaming response. */
export async function readAvatar(userId, avatarUrl) {
  const p = await resolveAvatarPath(userId, avatarUrl)
  if (!p) return null
  const buf = await fs.readFile(p)
  const ext = path.extname(p).slice(1).toLowerCase()
  const mime =
    ext === 'jpg' ? 'image/jpeg' :
    ext === 'png' ? 'image/png'  :
    ext === 'webp' ? 'image/webp' : 'application/octet-stream'
  return { buffer: buf, mime, ext }
}
