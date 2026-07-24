import { attachUser, requireRole } from '../middleware/auth.js'
import { notFound } from '../domain/errors.js'
import { getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'

/**
 * Product info API (ürün bilgileri / parçalar).
 *
 * The Demo/Ozalit forms and the Ürün Bilgileri catalog read a project's
 * component spec from here. This replaces the old browser-localStorage store
 * (`yz_product_info_overrides_v1`), so the spec is stable across users and
 * browsers and is always tied to the actual project rather than whatever
 * template happened to be selected in a dialog.
 *
 * GET  /api/product-info              — every project's components
 * GET  /api/product-info/:projectId   — one project's components
 * PUT  /api/product-info/:projectId   — upsert { components }
 */
export async function productInfoRoutes(fastify) {
  // Whole catalog in one shot — the SPA primes its cache with this on boot,
  // mirroring how it loads the project list.
  fastify.get('/product-info', async (request) => {
    await attachUser(request)
    const { rows } = await getPool().query(
      `SELECT pi.project_id, pi.components, pi.updated_by, u.name AS updated_by_name, pi.updated_at
         FROM product_info pi
         LEFT JOIN users u ON u.id = pi.updated_by
        ORDER BY pi.updated_at DESC`,
    )
    return rows
  })

  fastify.get('/product-info/:projectId', async (request) => {
    await attachUser(request)
    const { rows } = await getPool().query(
      `SELECT pi.project_id, pi.components, pi.updated_by, u.name AS updated_by_name, pi.updated_at
         FROM product_info pi
         LEFT JOIN users u ON u.id = pi.updated_by
        WHERE pi.project_id = $1`,
      [request.params.projectId],
    )
    // Absence is normal (a project may simply have no spec yet) — return an
    // empty component list instead of 404 so the client can treat "no spec"
    // and "empty spec" uniformly.
    if (rows.length === 0) {
      return { project_id: request.params.projectId, components: [], updated_by_name: null, updated_at: null }
    }
    return rows[0]
  })

  // Upsert. Only the roles that author a spec may write: the team leader
  // (project create + Ürün Bilgileri edits) and the designer (their step of
  // the sipariş workflow can refine the spec). Matbaa / Satış never edit it.
  fastify.put('/product-info/:projectId', { schema: schemas.productInfoUpsert }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader', 'designer')
    const { projectId } = request.params
    const { components } = request.body

    const proj = await getPool().query('SELECT id FROM projects WHERE id = $1', [projectId])
    if (proj.rowCount === 0) notFound('Proje bulunamadı.')

    const { rows } = await getPool().query(
      `INSERT INTO product_info (project_id, components, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (project_id)
       DO UPDATE SET components = EXCLUDED.components,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = NOW()
       RETURNING project_id, components, updated_by, updated_at`,
      [projectId, JSON.stringify(components ?? []), request.user.id],
    )
    // The updater is the caller — echo their name so the client can show
    // "last edited by …" without a second round-trip.
    return { ...rows[0], updated_by_name: request.user.name ?? null }
  })
}
