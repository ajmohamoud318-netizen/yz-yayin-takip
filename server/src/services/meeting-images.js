/**
 * Meeting image storage — an optional photo attached to a Toplantı record
 * (see migration 041__meeting_image.sql). Mirrors services/idea-images.js
 * exactly, just rooted at a different upload directory / URL prefix.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { ALLOWED_IMAGE_EXTENSIONS } from './avatars.js'

export const MAX_MEETING_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB

function resolveMeetingImageDir() {
  if (process.env.MEETING_IMAGE_DIR) return path.resolve(process.env.MEETING_IMAGE_DIR)
  if (process.env.NODE_ENV === 'production') return '/app/.yz-uploads/meeting-images'
  return path.resolve(process.cwd(), 'server/uploads/meeting-images')
}

export const MEETING_IMAGE_DIR = resolveMeetingImageDir()

function pathFor(meetingId, ext) {
  return path.join(MEETING_IMAGE_DIR, meetingId, `image.${ext}`)
}

/** Persist a meeting image, replacing any previous one under a different extension. */
export async function saveMeetingImage(meetingId, ext, buffer) {
  const dir = path.join(MEETING_IMAGE_DIR, meetingId)
  await fs.mkdir(dir, { recursive: true })
  for (const e of ALLOWED_IMAGE_EXTENSIONS) {
    if (e === ext) continue
    try { await fs.unlink(pathFor(meetingId, e)) } catch { /* missing */ }
  }
  await fs.writeFile(pathFor(meetingId, ext), buffer)
  return `/api/meetings/${encodeURIComponent(meetingId)}/image`
}

/** Remove the on-disk image (and its now-empty directory), if any. */
export async function deleteMeetingImage(meetingId) {
  for (const e of ALLOWED_IMAGE_EXTENSIONS) {
    try { await fs.unlink(pathFor(meetingId, e)) } catch { /* missing */ }
  }
  try { await fs.rmdir(path.join(MEETING_IMAGE_DIR, meetingId)) } catch { /* not empty, or missing */ }
}

/** Read the raw bytes off disk for the streaming response. */
export async function readMeetingImage(meetingId) {
  for (const ext of ALLOWED_IMAGE_EXTENSIONS) {
    try {
      const buffer = await fs.readFile(pathFor(meetingId, ext))
      const mime =
        ext === 'jpg' ? 'image/jpeg' :
        ext === 'png' ? 'image/png' : 'image/webp'
      return { buffer, mime }
    } catch { /* try next extension */ }
  }
  return null
}

/** Cache headers for the meeting image file route — same contract as ideaImageCacheHeaders. */
export function meetingImageCacheHeaders({ versioned, meetingId, updatedAt }) {
  const stamp = updatedAt ? new Date(updatedAt).getTime() : 0
  return {
    cacheControl: versioned
      ? 'private, max-age=31536000, immutable'
      : 'private, no-cache',
    etag: `"mtg-${meetingId}-${Number.isFinite(stamp) ? stamp : 0}"`,
  }
}
