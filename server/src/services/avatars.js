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
import fsSync from 'node:fs'
import os from 'node:os'
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
 *  2. `/app/.yz-uploads/avatars` — the production default. The image
 *     runs as the unprivileged `node` user (UID 1000) and `WORKDIR` is
 *     `/app`, so this path is created writable by the runtime without
 *     any Dockerfile `USER root` workaround. Dokploy mounts the
 *     persistent volume at `/app/.yz-uploads` (see `DEPLOY.md >
 *     Persistent volumes`) so avatars survive redeploys.
 *  3. `<cwd>/server/uploads/avatars` — last-resort fallback for local
 *     dev. `docker-compose.yml` mounts the `yzuploads` named volume
 *     under `/app/.yz-uploads`, so dev and prod share path #2.
 *
 * Note: `/tmp` is NOT a candidate — even though it's always writable,
 * it's wiped on every container restart, so any avatar landing there
 * disappears the next time Dokploy redeploys. The previous default of
 * `/tmp/yz-uploads/avatars` was the source of the "avatar deleted on
 * every deploy" bug; see git log for the fix.
 */
function resolveConfiguredAvatarDir() {
  if (process.env.AVATAR_DIR) return path.resolve(process.env.AVATAR_DIR)
  if (process.env.NODE_ENV === 'production') return '/app/.yz-uploads/avatars'
  // server/dev only: relative to the repo
  return path.resolve(process.cwd(), 'server/uploads/avatars')
}

function resolveFallbackAvatarDir() {
  // Last-resort fallback when the configured dir isn't writable (e.g.
  // an external managed disk that mounted read-only, or a Dokploy
  // volume that landed root-owned). The fallback intentionally lives
  // outside `/tmp` too — process.cwd() is `/app` in production, which
  // the `node` user owns and which is rewritten on every deploy BUT
  // any *sub-directory* of /app survives between deploys as long as it
  // isn't the WORKDIR itself. The `.data` prefix keeps it alphabetically
  // out of the way of the source tree.
  const base = process.env.NODE_ENV === 'production'
    ? '/app/.yz-fallback'
    : path.resolve(process.cwd(), 'server/.yz-fallback')
  return base
}

/**
 * Production default for the upload directory.
 *
 * Important: this constant reports the *configured* root only. If the
 * configured root turns out to be read-only / not-writable-by-our-uid at
 * boot, `pickWritableRoot()` falls back to a per-tmpdir location and the
 * module keeps that as the *active* write root. Lookups
 * (`resolveAvatarPath`) search BOTH roots so existing files still
 * resolve regardless of which root they live under.
 */
export const AVATAR_DIR = resolveConfiguredAvatarDir()

/**
 * Probe the candidate directories and remember the first one that's
 * actually writable by this process. Runs once at module-load; if neither
 * candidate is writable (very unusual) we surface the failure on the
 * first upload instead of crashing the server.
 */
function pickWritableRoot() {
  // Synchronous because the rest of the service is sync at module-load.
  const candidates = []
  const seen = new Set()
  for (const cand of [resolveConfiguredAvatarDir(), resolveFallbackAvatarDir()]) {
    if (seen.has(cand)) continue
    seen.add(cand)
    candidates.push(cand)
  }
  for (const root of candidates) {
    try {
      fsSync.mkdirSync(root, { recursive: true })
      // Probe write — `mkdir -p` succeeds even on read-only mounts.
      const probe = path.join(root, `.probe-${process.pid}`)
      fsSync.writeFileSync(probe, 'ok')
      fsSync.unlinkSync(probe)
      return root
    } catch (err) {
      // Continue to the next candidate.
      // eslint-disable-next-line no-console
      console.warn(`[avatars] ${root} not writable (${err.code || err.message}); trying next`)
    }
  }
  // Return the configured dir anyway — writeAvatar() will raise a real
  // error on upload instead of mysteriously 500-ing inside Fastify.
  return candidates[0]
}

export const ACTIVE_AVATAR_DIR = pickWritableRoot()

export function extForMime(mime) {
  return ALLOWED_MIME.get(String(mime || '').toLowerCase()) ?? null
}

export function isAllowedMime(mime) {
  return ALLOWED_MIME.has(String(mime || '').toLowerCase())
}

/**
 * Build a candidate on-disk path for this user/ext under the given root.
 * Migrated to a per-user subdir so the writable-root fallback can keep
 * files separate from files the operator intentionally placed under the
 * configured root (e.g. seeded via env).
 */
function pathFor(userId, ext, root = ACTIVE_AVATAR_DIR) {
  return path.join(root, userId, `image.${ext}`)
}

/** Ensure the on-disk directory exists for every candidate root. */
export async function ensureAvatarDir() {
  for (const root of allRoots()) {
    await fs.mkdir(root, { recursive: true })
  }
}

/** All roots we ever look under — configured + active. */
function allRoots() {
  const out = []
  const seen = new Set()
  for (const r of [AVATAR_DIR, ACTIVE_AVATAR_DIR]) {
    if (r && !seen.has(r)) { seen.add(r); out.push(r) }
  }
  return out
}

/**
 * Persist an avatar. Removes any previous file for the user so we don't
 * leak disk space after an upload replace / delete.
 *
 * @returns the public URL the SPA should embed.
 */
export async function saveAvatar(userId, ext, buffer) {
  if (!userId) throw new Error('userId is required')
  // Try every writable root in order. If a previous successful write
  // stored the file under the configured root, replacing it can succeed
  // there too; otherwise we land on the active fallback.
  let lastErr = null
  for (const root of allRoots()) {
    const userDir = path.join(root, userId)
    try {
      await fs.mkdir(userDir, { recursive: true })
      // Clear stale files for this user (different extensions).
      for (const e of ALLOWED_MIME.values()) {
        if (e === ext) continue
        try { await fs.unlink(pathFor(userId, e, root)) } catch { /* missing */ }
      }
      await fs.writeFile(pathFor(userId, ext, root), buffer)
      return `/api/users/${encodeURIComponent(userId)}/avatar/file`
    } catch (err) {
      lastErr = err
      // EACCES / EPERM / EROFS / ENOSPC — try the next root.
      // eslint-disable-next-line no-console
      console.warn(`[avatars] saveAvatar(${userId}) under ${root} failed: ${err.code || err.message}`)
    }
  }
  throw new Error(`avatar save failed under all roots: ${lastErr?.message || 'unknown'}`)
}

/** Remove the avatar file for a user, if any. */
export async function deleteAvatar(userId) {
  if (!userId) return
  for (const root of allRoots()) {
    // New per-user subdir layout.
    for (const e of ALLOWED_MIME.values()) {
      try { await fs.unlink(pathFor(userId, e, root)) } catch { /* missing */ }
    }
    // Legacy flat layout — already-uploaded files from older deploys.
    for (const e of ALLOWED_MIME.values()) {
      try { await fs.unlink(path.join(root, `${userId}.${e}`)) } catch { /* missing */ }
    }
  }
}

/** Resolve the on-disk path for a stored avatar, or null if none. */
export async function resolveAvatarPath(userId, avatarUrl) {
  if (!userId || !avatarUrl) return null
  await ensureAvatarDir()
  // Search every root so files written by an older deployment under the
  // configured dir still resolve after we fall back to a tmpdir root.
  for (const root of allRoots()) {
    for (const ext of ALLOWED_MIME.values()) {
      // New (per-user subdir) layout.
      const candidate = pathFor(userId, ext, root)
      try {
        await fs.access(candidate)
        return candidate
      } catch { /* try next */ }
      // Legacy flat layout: `<root>/<userId>.<ext>`. Older deployments
      // (pre-per-user-subdir migration) wrote files here. Quietly
      // resolve them so already-uploaded avatars don't disappear until
      // the user re-uploads.
      try {
        const legacy = path.join(root, `${userId}.${ext}`)
        await fs.access(legacy)
        return legacy
      } catch { /* try next */ }
    }
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
