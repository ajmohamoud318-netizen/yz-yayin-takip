/**
 * Meeting gallery storage — the extra photos attached to a Toplantı,
 * beyond its single cover image (see migration 043__meeting_details.sql
 * and services/meeting-images.js for the cover). Mirrors
 * idea-gallery-images.js exactly, just rooted at a different upload
 * directory / URL prefix.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { ALLOWED_IMAGE_EXTENSIONS } from './avatars.js'

export const MAX_GALLERY_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB

function resolveGalleryDir() {
  if (process.env.MEETING_GALLERY_DIR) return path.resolve(process.env.MEETING_GALLERY_DIR)
  if (process.env.NODE_ENV === 'production') return '/app/.yz-uploads/meeting-gallery'
  return path.resolve(process.cwd(), 'server/uploads/meeting-gallery')
}

export const MEETING_GALLERY_DIR = resolveGalleryDir()

function pathFor(meetingId, imageId, ext) {
  return path.join(MEETING_GALLERY_DIR, meetingId, `${imageId}.${ext}`)
}

/** Persist a new gallery image under its own generated id. */
export async function saveGalleryImage(meetingId, imageId, ext, buffer) {
  const dir = path.join(MEETING_GALLERY_DIR, meetingId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(pathFor(meetingId, imageId, ext), buffer)
  return `/api/meetings/${encodeURIComponent(meetingId)}/images/${encodeURIComponent(imageId)}`
}

/** Remove a single gallery image's on-disk file, if any. */
export async function deleteGalleryImage(meetingId, imageId) {
  for (const e of ALLOWED_IMAGE_EXTENSIONS) {
    try { await fs.unlink(pathFor(meetingId, imageId, e)) } catch { /* missing */ }
  }
}

/** Remove a meeting's whole gallery directory — used when the meeting itself is deleted. */
export async function deleteMeetingGalleryDir(meetingId) {
  try {
    await fs.rm(path.join(MEETING_GALLERY_DIR, meetingId), { recursive: true, force: true })
  } catch { /* missing */ }
}

/** Read the raw bytes off disk for the streaming response. */
export async function readGalleryImage(meetingId, imageId) {
  for (const ext of ALLOWED_IMAGE_EXTENSIONS) {
    try {
      const buffer = await fs.readFile(pathFor(meetingId, imageId, ext))
      const mime =
        ext === 'jpg' ? 'image/jpeg' :
        ext === 'png' ? 'image/png' : 'image/webp'
      return { buffer, mime }
    } catch { /* try next extension */ }
  }
  return null
}
