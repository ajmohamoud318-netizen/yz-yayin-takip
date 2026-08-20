import { nanoid } from 'nanoid'
import { attachUser, requireRole } from '../middleware/auth.js'
import { withTx, getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'
import {
  list, create, update, remove, assertCanModify, setImage, clearImage,
  getDetail, addImage, removeImage, addNote, updateNote, removeNote,
} from '../services/meetings.js'
import { notifyMeetingCreated } from '../services/notifications.js'
import { extForMime, isAllowedMime, sniffImageMime } from '../services/avatars.js'
import {
  MAX_MEETING_IMAGE_BYTES, saveMeetingImage, deleteMeetingImage, readMeetingImage, meetingImageCacheHeaders,
} from '../services/meeting-images.js'
import {
  MAX_GALLERY_IMAGE_BYTES, saveGalleryImage, deleteGalleryImage, readGalleryImage, deleteMeetingGalleryDir,
} from '../services/meeting-gallery-images.js'
import { badRequest, notFound, HttpError } from '../domain/errors.js'

/**
 * Toplantılar — meeting log. See migration 040__meetings.sql,
 * 041__meeting_image.sql, and the multi-link / gallery / notes-log detail
 * view in 043__meeting_details.sql.
 *
 *  GET    /api/meetings                    → anyone signed in
 *  POST   /api/meetings                    → team_leader, designer, printer
 *  GET    /api/meetings/:id                 → detail (meeting + gallery + notes)
 *  PATCH  /api/meetings/:id                 → team_leader, or the meeting's own author
 *  DELETE /api/meetings/:id                 → team_leader, or the meeting's own author
 *  PUT    /api/meetings/:id/image           → cover image; team_leader, or the meeting's own author
 *  DELETE /api/meetings/:id/image           → team_leader, or the meeting's own author
 *  GET    /api/meetings/:id/image           → public file stream (cover)
 *  POST   /api/meetings/:id/images          → gallery add; team_leader, or the meeting's own author
 *  DELETE /api/meetings/:id/images/:imageId → team_leader, or the meeting's own author
 *  GET    /api/meetings/:id/images/:imageId → public file stream (gallery)
 *  POST   /api/meetings/:id/notes           → anyone who can add a meeting
 *  PATCH  /api/meetings/:id/notes/:noteId   → team_leader, or the note's own author
 *  DELETE /api/meetings/:id/notes/:noteId   → team_leader, or the note's own author
 */
export async function meetingRoutes(fastify) {
  fastify.get('/meetings', async (request) => {
    await attachUser(request)
    const meetings = await list(getPool())
    return { meetings }
  })

  fastify.post(
    '/meetings',
    { schema: schemas.meetingCreate },
    async (request, reply) => {
      await attachUser(request)
      requireRole(request, 'team_leader', 'designer', 'printer')
      const meeting = await withTx(async (client) => {
        const row = await create(client, request.body, request.user)
        await notifyMeetingCreated(client, { meeting: row, actor: request.user })
        return row
      })
      reply.code(201)
      return meeting
    },
  )

  fastify.get(
    '/meetings/:id',
    { schema: schemas.meetingIdParams },
    async (request) => {
      await attachUser(request)
      return getDetail(getPool(), request.params.id)
    },
  )

  fastify.patch(
    '/meetings/:id',
    { schema: schemas.meetingUpdate },
    async (request) => {
      await attachUser(request)
      return update(getPool(), request.params.id, request.user, request.body)
    },
  )

  fastify.delete(
    '/meetings/:id',
    { schema: schemas.meetingIdParams },
    async (request, reply) => {
      await attachUser(request)
      await remove(getPool(), request.params.id, request.user)
      await deleteMeetingImage(request.params.id)
      await deleteMeetingGalleryDir(request.params.id)
      reply.code(204)
      return null
    },
  )

  // Body limit for this route is enforced per-upload via
  // MAX_MEETING_IMAGE_BYTES; the multipart plugin's fileSize is the outer
  // ceiling (see index.js). Ownership is checked BEFORE the file is read
  // off the wire, so an unauthorized upload never touches disk.
  fastify.put(
    '/meetings/:id/image',
    { schema: schemas.meetingIdParams },
    async (request) => {
      await attachUser(request)
      await assertCanModify(getPool(), request.params.id, request.user)

      const file = await request.file()
      if (!file) badRequest('Dosya bulunamadı.')
      if (!isAllowedMime(file.mimetype)) badRequest('Desteklenen formatlar: JPEG, PNG, WebP.')

      const chunks = []
      let total = 0
      for await (const chunk of file.file) {
        total += chunk.length
        if (total > MAX_MEETING_IMAGE_BYTES) badRequest('Dosya 5 MB sınırını aşıyor.')
        chunks.push(chunk)
      }
      const buffer = Buffer.concat(chunks, total)

      // Content sniff — the declared multipart mimetype is attacker-controlled,
      // so verify the actual bytes are a real image matching what was declared.
      const sniffed = sniffImageMime(buffer)
      if (!sniffed || sniffed !== file.mimetype) {
        badRequest('Dosya içeriği geçerli bir görüntü değil (JPEG, PNG veya WebP).')
      }

      const ext = extForMime(file.mimetype)
      let url
      try {
        url = await saveMeetingImage(request.params.id, ext, buffer)
      } catch (err) {
        request.log.error({ err }, 'meeting image save failed')
        throw new HttpError(500, `Görsel yüklenemedi: ${err.message}`, 'meeting_image_save_failed')
      }
      return setImage(getPool(), request.params.id, url)
    },
  )

  fastify.delete(
    '/meetings/:id/image',
    { schema: schemas.meetingIdParams },
    async (request) => {
      await attachUser(request)
      await assertCanModify(getPool(), request.params.id, request.user)
      const meeting = await clearImage(getPool(), request.params.id)
      await deleteMeetingImage(request.params.id)
      return meeting
    },
  )

  // Public file stream — no auth, same reasoning as GET /users/:id/avatar/file:
  // an <img src> can't carry the X-User-Id header (or reliably a cookie
  // cross-context), and this is internal, low-sensitivity content anyway.
  fastify.get('/meetings/:id/image', async (request, reply) => {
    const { rows } = await getPool().query(
      `SELECT image_url, image_updated_at FROM meetings WHERE id = $1 LIMIT 1`,
      [request.params.id],
    )
    if (!rows[0]?.image_url) return notFound('Görsel bulunamadı.')

    const { cacheControl, etag } = meetingImageCacheHeaders({
      versioned: !!request.query?.v,
      meetingId: request.params.id,
      updatedAt: rows[0].image_updated_at,
    })
    if (request.headers['if-none-match'] === etag) {
      return reply.header('Cache-Control', cacheControl).header('ETag', etag).code(304).send()
    }

    const file = await readMeetingImage(request.params.id)
    if (!file) return notFound('Görsel dosyası eksik.')
    reply
      .header('Content-Type', file.mime)
      .header('Cache-Control', cacheControl)
      .header('ETag', etag)
      .send(file.buffer)
  })

  // ─── gallery — extra photos beyond the cover, only shown in the detail
  // view. Same ownership gate and upload contract as the cover image ────

  fastify.post(
    '/meetings/:id/images',
    { schema: schemas.meetingIdParams },
    async (request, reply) => {
      await attachUser(request)
      await assertCanModify(getPool(), request.params.id, request.user)

      const file = await request.file()
      if (!file) badRequest('Dosya bulunamadı.')
      if (!isAllowedMime(file.mimetype)) badRequest('Desteklenen formatlar: JPEG, PNG, WebP.')

      const chunks = []
      let total = 0
      for await (const chunk of file.file) {
        total += chunk.length
        if (total > MAX_GALLERY_IMAGE_BYTES) badRequest('Dosya 5 MB sınırını aşıyor.')
        chunks.push(chunk)
      }
      const buffer = Buffer.concat(chunks, total)

      const sniffed = sniffImageMime(buffer)
      if (!sniffed || sniffed !== file.mimetype) {
        badRequest('Dosya içeriği geçerli bir görüntü değil (JPEG, PNG veya WebP).')
      }

      const ext = extForMime(file.mimetype)
      const imageId = `mtgimg-${nanoid(16)}`
      let url
      try {
        url = await saveGalleryImage(request.params.id, imageId, ext, buffer)
      } catch (err) {
        request.log.error({ err }, 'meeting gallery image save failed')
        throw new HttpError(500, `Görsel yüklenemedi: ${err.message}`, 'meeting_gallery_image_save_failed')
      }
      const image = await addImage(getPool(), request.params.id, imageId, url, request.user)
      reply.code(201)
      return image
    },
  )

  fastify.delete(
    '/meetings/:id/images/:imageId',
    { schema: schemas.meetingImageIdParams },
    async (request, reply) => {
      await attachUser(request)
      await assertCanModify(getPool(), request.params.id, request.user)
      await removeImage(getPool(), request.params.id, request.params.imageId)
      await deleteGalleryImage(request.params.id, request.params.imageId)
      reply.code(204)
      return null
    },
  )

  fastify.get('/meetings/:id/images/:imageId', async (request, reply) => {
    const file = await readGalleryImage(request.params.id, request.params.imageId)
    if (!file) return notFound('Görsel bulunamadı.')
    reply
      .header('Content-Type', file.mime)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(file.buffer)
  })

  // ─── notes log — a timestamped, multi-author log shown in the detail view ─

  fastify.post(
    '/meetings/:id/notes',
    { schema: schemas.meetingNoteCreate },
    async (request, reply) => {
      await attachUser(request)
      requireRole(request, 'team_leader', 'designer', 'printer')
      const note = await addNote(getPool(), request.params.id, request.body.body, request.user)
      reply.code(201)
      return note
    },
  )

  fastify.patch(
    '/meetings/:id/notes/:noteId',
    { schema: schemas.meetingNoteUpdate },
    async (request) => {
      await attachUser(request)
      return updateNote(getPool(), request.params.id, request.params.noteId, request.body.body, request.user)
    },
  )

  fastify.delete(
    '/meetings/:id/notes/:noteId',
    { schema: schemas.meetingNoteIdParams },
    async (request, reply) => {
      await attachUser(request)
      await removeNote(getPool(), request.params.id, request.params.noteId, request.user)
      reply.code(204)
      return null
    },
  )
}
