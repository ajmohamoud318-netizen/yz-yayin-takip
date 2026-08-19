/**
 * Idea gallery storage — the extra photos attached to a Hedef Proje idea,
 * beyond its single cover image (see migration
 * 042__target_project_idea_details.sql and services/idea-images.js for the
 * cover). Unlike the cover, each gallery entry is its own file keyed by a
 * generated image id, so the served URL never changes underneath a given
 * id — no cache-busting `?v=` needed, just a long-lived immutable header.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { ALLOWED_IMAGE_EXTENSIONS } from './avatars.js'

export const MAX_GALLERY_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB

function resolveGalleryDir() {
  if (process.env.IDEA_GALLERY_DIR) return path.resolve(process.env.IDEA_GALLERY_DIR)
  if (process.env.NODE_ENV === 'production') return '/app/.yz-uploads/idea-gallery'
  return path.resolve(process.cwd(), 'server/uploads/idea-gallery')
}

export const IDEA_GALLERY_DIR = resolveGalleryDir()

function pathFor(ideaId, imageId, ext) {
  return path.join(IDEA_GALLERY_DIR, ideaId, `${imageId}.${ext}`)
}

/** Persist a new gallery image under its own generated id. */
export async function saveGalleryImage(ideaId, imageId, ext, buffer) {
  const dir = path.join(IDEA_GALLERY_DIR, ideaId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(pathFor(ideaId, imageId, ext), buffer)
  return `/api/target-project-ideas/${encodeURIComponent(ideaId)}/images/${encodeURIComponent(imageId)}`
}

/** Remove a single gallery image's on-disk file, if any. */
export async function deleteGalleryImage(ideaId, imageId) {
  for (const e of ALLOWED_IMAGE_EXTENSIONS) {
    try { await fs.unlink(pathFor(ideaId, imageId, e)) } catch { /* missing */ }
  }
}

/** Remove an idea's whole gallery directory — used when the idea itself is deleted. */
export async function deleteIdeaGalleryDir(ideaId) {
  try {
    await fs.rm(path.join(IDEA_GALLERY_DIR, ideaId), { recursive: true, force: true })
  } catch { /* missing */ }
}

/** Read the raw bytes off disk for the streaming response. */
export async function readGalleryImage(ideaId, imageId) {
  for (const ext of ALLOWED_IMAGE_EXTENSIONS) {
    try {
      const buffer = await fs.readFile(pathFor(ideaId, imageId, ext))
      const mime =
        ext === 'jpg' ? 'image/jpeg' :
        ext === 'png' ? 'image/png' : 'image/webp'
      return { buffer, mime }
    } catch { /* try next extension */ }
  }
  return null
}
