import { nanoid } from 'nanoid'
import { attachUser, requireRole } from '../middleware/auth.js'
import { withTx, getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'
import {
  list, create, update, remove, assertCanModify, setImage, clearImage,
  getDetail, addImage, removeImage, addNote, removeNote,
} from '../services/target-project-ideas.js'
import { notifyTargetProjectIdeaCreated } from '../services/notifications.js'
import { extForMime, isAllowedMime, sniffImageMime } from '../services/avatars.js'
import {
  MAX_IDEA_IMAGE_BYTES, saveIdeaImage, deleteIdeaImage, readIdeaImage, ideaImageCacheHeaders,
} from '../services/idea-images.js'
import {
  MAX_GALLERY_IMAGE_BYTES, saveGalleryImage, deleteGalleryImage, readGalleryImage, deleteIdeaGalleryDir,
} from '../services/idea-gallery-images.js'
import { badRequest, notFound, HttpError } from '../domain/errors.js'

/**
 * Hedef Projeler — idea board. See migration 036__target_project_ideas.sql,
 * 037__target_project_idea_image.sql, and the multi-link / gallery /
 * notes-log detail view in 042__target_project_idea_details.sql.
 *
 *  GET    /api/target-project-ideas                  → anyone signed in
 *  POST   /api/target-project-ideas                  → designer + team_leader
 *  GET    /api/target-project-ideas/:id               → detail (idea + gallery + notes)
 *  PATCH  /api/target-project-ideas/:id               → team_leader, or the idea's own author
 *  DELETE /api/target-project-ideas/:id               → team_leader, or the idea's own author
 *  PUT    /api/target-project-ideas/:id/image          → cover image; team_leader, or the idea's own author
 *  DELETE /api/target-project-ideas/:id/image          → team_leader, or the idea's own author
 *  GET    /api/target-project-ideas/:id/image          → public file stream (cover)
 *  POST   /api/target-project-ideas/:id/images         → gallery add; team_leader, or the idea's own author
 *  DELETE /api/target-project-ideas/:id/images/:imageId → team_leader, or the idea's own author
 *  GET    /api/target-project-ideas/:id/images/:imageId → public file stream (gallery)
 *  POST   /api/target-project-ideas/:id/notes          → anyone who can add an idea
 *  DELETE /api/target-project-ideas/:id/notes/:noteId  → team_leader, or the note's own author
 */
export async function targetProjectIdeaRoutes(fastify) {
  fastify.get('/target-project-ideas', async (request) => {
    await attachUser(request)
    const ideas = await list(getPool())
    return { ideas }
  })

  fastify.post(
    '/target-project-ideas',
    { schema: schemas.targetProjectIdeaCreate },
    async (request, reply) => {
      await attachUser(request)
      requireRole(request, 'team_leader', 'designer')
      const idea = await withTx(async (client) => {
        const row = await create(client, request.body, request.user)
        await notifyTargetProjectIdeaCreated(client, { idea: row, actor: request.user })
        return row
      })
      reply.code(201)
      return idea
    },
  )

  fastify.get(
    '/target-project-ideas/:id',
    { schema: schemas.targetProjectIdeaIdParams },
    async (request) => {
      await attachUser(request)
      return getDetail(getPool(), request.params.id)
    },
  )

  fastify.patch(
    '/target-project-ideas/:id',
    { schema: schemas.targetProjectIdeaUpdate },
    async (request) => {
      await attachUser(request)
      return update(getPool(), request.params.id, request.user, request.body)
    },
  )

  fastify.delete(
    '/target-project-ideas/:id',
    { schema: schemas.targetProjectIdeaIdParams },
    async (request, reply) => {
      await attachUser(request)
      await remove(getPool(), request.params.id, request.user)
      await deleteIdeaImage(request.params.id)
      await deleteIdeaGalleryDir(request.params.id)
      reply.code(204)
      return null
    },
  )

  // Body limit for this route is enforced per-upload via
  // MAX_IDEA_IMAGE_BYTES; the multipart plugin's fileSize is the outer
  // ceiling (see index.js). Ownership is checked BEFORE the file is read
  // off the wire, so an unauthorized upload never touches disk.
  fastify.put(
    '/target-project-ideas/:id/image',
    { schema: schemas.targetProjectIdeaIdParams },
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
        if (total > MAX_IDEA_IMAGE_BYTES) badRequest('Dosya 5 MB sınırını aşıyor.')
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
        url = await saveIdeaImage(request.params.id, ext, buffer)
      } catch (err) {
        request.log.error({ err }, 'idea image save failed')
        throw new HttpError(500, `Görsel yüklenemedi: ${err.message}`, 'idea_image_save_failed')
      }
      return setImage(getPool(), request.params.id, url)
    },
  )

  fastify.delete(
    '/target-project-ideas/:id/image',
    { schema: schemas.targetProjectIdeaIdParams },
    async (request) => {
      await attachUser(request)
      await assertCanModify(getPool(), request.params.id, request.user)
      const idea = await clearImage(getPool(), request.params.id)
      await deleteIdeaImage(request.params.id)
      return idea
    },
  )

  // Public file stream — no auth, same reasoning as GET /users/:id/avatar/file:
  // an <img src> can't carry the X-User-Id header (or reliably a cookie
  // cross-context), and this is internal, low-sensitivity content anyway.
  fastify.get('/target-project-ideas/:id/image', async (request, reply) => {
    const { rows } = await getPool().query(
      `SELECT image_url, image_updated_at FROM target_project_ideas WHERE id = $1 LIMIT 1`,
      [request.params.id],
    )
    if (!rows[0]?.image_url) return notFound('Görsel bulunamadı.')

    const { cacheControl, etag } = ideaImageCacheHeaders({
      versioned: !!request.query?.v,
      ideaId: request.params.id,
      updatedAt: rows[0].image_updated_at,
    })
    if (request.headers['if-none-match'] === etag) {
      return reply.header('Cache-Control', cacheControl).header('ETag', etag).code(304).send()
    }

    const file = await readIdeaImage(request.params.id)
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
    '/target-project-ideas/:id/images',
    { schema: schemas.targetProjectIdeaIdParams },
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
      const imageId = `tpimg-${nanoid(16)}`
      let url
      try {
        url = await saveGalleryImage(request.params.id, imageId, ext, buffer)
      } catch (err) {
        request.log.error({ err }, 'idea gallery image save failed')
        throw new HttpError(500, `Görsel yüklenemedi: ${err.message}`, 'idea_gallery_image_save_failed')
      }
      const image = await addImage(getPool(), request.params.id, imageId, url, request.user)
      reply.code(201)
      return image
    },
  )

  fastify.delete(
    '/target-project-ideas/:id/images/:imageId',
    { schema: schemas.targetProjectIdeaImageIdParams },
    async (request, reply) => {
      await attachUser(request)
      await assertCanModify(getPool(), request.params.id, request.user)
      await removeImage(getPool(), request.params.id, request.params.imageId)
      await deleteGalleryImage(request.params.id, request.params.imageId)
      reply.code(204)
      return null
    },
  )

  fastify.get('/target-project-ideas/:id/images/:imageId', async (request, reply) => {
    const file = await readGalleryImage(request.params.id, request.params.imageId)
    if (!file) return notFound('Görsel bulunamadı.')
    reply
      .header('Content-Type', file.mime)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(file.buffer)
  })

  // ─── notes log — a timestamped, multi-author log shown in the detail view ─

  fastify.post(
    '/target-project-ideas/:id/notes',
    { schema: schemas.targetProjectIdeaNoteCreate },
    async (request, reply) => {
      await attachUser(request)
      requireRole(request, 'team_leader', 'designer')
      const note = await addNote(getPool(), request.params.id, request.body.body, request.user)
      reply.code(201)
      return note
    },
  )

  fastify.delete(
    '/target-project-ideas/:id/notes/:noteId',
    { schema: schemas.targetProjectIdeaNoteIdParams },
    async (request, reply) => {
      await attachUser(request)
      await removeNote(getPool(), request.params.id, request.params.noteId, request.user)
      reply.code(204)
      return null
    },
  )
}
