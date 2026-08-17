/**
 * Idea image storage — the photo/screenshot attached to a Hedef Proje idea
 * (see migration 037__target_project_idea_image.sql).
 *
 * Deliberately simpler than services/avatars.js: it shares the same
 * persistent-volume convention (`/app/.yz-uploads/...`, the directory
 * Dokploy already mounts and proves writable for avatars in production) but
 * skips avatars.js's dual-root fallback probing and legacy flat-layout
 * lookup — those exist to fix a specific past incident (avatars silently
 * wiped on deploy) and to keep serving files an older deploy wrote before
 * the per-user-subdir migration. This table has no such history yet.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { ALLOWED_IMAGE_EXTENSIONS } from './avatars.js'

// Phone photos and Instagram screenshots run bigger than an avatar crop.
export const MAX_IDEA_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB

function resolveIdeaImageDir() {
  if (process.env.IDEA_IMAGE_DIR) return path.resolve(process.env.IDEA_IMAGE_DIR)
  if (process.env.NODE_ENV === 'production') return '/app/.yz-uploads/idea-images'
  return path.resolve(process.cwd(), 'server/uploads/idea-images')
}

export const IDEA_IMAGE_DIR = resolveIdeaImageDir()

function pathFor(ideaId, ext) {
  return path.join(IDEA_IMAGE_DIR, ideaId, `image.${ext}`)
}

/** Persist an idea image, replacing any previous one under a different extension. */
export async function saveIdeaImage(ideaId, ext, buffer) {
  const dir = path.join(IDEA_IMAGE_DIR, ideaId)
  await fs.mkdir(dir, { recursive: true })
  for (const e of ALLOWED_IMAGE_EXTENSIONS) {
    if (e === ext) continue
    try { await fs.unlink(pathFor(ideaId, e)) } catch { /* missing */ }
  }
  await fs.writeFile(pathFor(ideaId, ext), buffer)
  return `/api/target-project-ideas/${encodeURIComponent(ideaId)}/image`
}

/** Remove the on-disk image (and its now-empty directory), if any. */
export async function deleteIdeaImage(ideaId) {
  for (const e of ALLOWED_IMAGE_EXTENSIONS) {
    try { await fs.unlink(pathFor(ideaId, e)) } catch { /* missing */ }
  }
  try { await fs.rmdir(path.join(IDEA_IMAGE_DIR, ideaId)) } catch { /* not empty, or missing */ }
}

/** Read the raw bytes off disk for the streaming response. */
export async function readIdeaImage(ideaId) {
  for (const ext of ALLOWED_IMAGE_EXTENSIONS) {
    try {
      const buffer = await fs.readFile(pathFor(ideaId, ext))
      const mime =
        ext === 'jpg' ? 'image/jpeg' :
        ext === 'png' ? 'image/png' : 'image/webp'
      return { buffer, mime }
    } catch { /* try next extension */ }
  }
  return null
}

/** Cache headers for the idea image file route — same contract as avatarCacheHeaders. */
export function ideaImageCacheHeaders({ versioned, ideaId, updatedAt }) {
  const stamp = updatedAt ? new Date(updatedAt).getTime() : 0
  return {
    cacheControl: versioned
      ? 'private, max-age=31536000, immutable'
      : 'private, no-cache',
    etag: `"tpi-${ideaId}-${Number.isFinite(stamp) ? stamp : 0}"`,
  }
}
