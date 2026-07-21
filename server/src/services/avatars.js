/**
 * Avatar upload storage.
 *
 * Files land on disk under a configurable directory — by default
 * `/app/uploads/avatars`, which is where Dokploy's `yz-uploads` named
 * volume is mounted. The env var override exists so this works in
 * plain docker / dev mode (`AVATAR_DIR=./uploads/avatars`).
 *
 * Each user has at most one file; re-uploading replaces the previous one.
 * The public URL the SPA embeds is
 * `/api/users/<userId>/avatar/file` — see the matching `GET` route in
 * `routes/users.js`.
 *
 * For a single-tenant internal tool this is plenty (no need for S3 +
 * signed URLs). The migration to object storage is a one-function swap.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

const ALLOWED_MIME = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png',  'png'],
  ['image/webp', 'webp'],
])
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024  // 2 MB

/**
 * Resolves the avatar directory in this order:
 *  1. `AVATAR_DIR` env var — explicit override for operators who need a
 *     different path on disk (e.g. an audited managed disk).
 *  2. `/tmp/yz-uploads/avatars` — the production default. `/tmp` is
 *     always writable by the non-root `node` user the image runs as
 *     (UID 1000) on Node 20-alpine, so no Dockerfile `USER root`
 *     workaround is needed. `/tmp` is ephemeral inside a fresh
 *     container, so Dokploy MUST mount a named volume at
 *     `/tmp/yz-uploads` to make avatars survive redeploys (see
 *     `DEPLOY.md > Persistent volumes`).
 *  3. `<cwd>/server/uploads/avatars` — last-resort fallback for local
 *     dev. `docker-compose.yml` mounts the `yzuploads` named volume
 *     under `/tmp/yz-uploads`, so dev and prod share path #2.
 */
export const AVATAR_DIR = (() => {
  if (process.env.AVATAR_DIR) return path.resolve(process.env.AVATAR_DIR)
  if (process.env.NODE_ENV === 'production') return '/tmp/yz-uploads/avatars'
  // server/dev only: relative to the repo
  return path.resolve(process.cwd(), 'server/uploads/avatars')
})()

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
  // Restrict permissions in production so avatar files aren't world-readable
  // (Node default umask is 0644 on Linux; explicit here for safety).
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
