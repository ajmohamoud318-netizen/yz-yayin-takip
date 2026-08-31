import { attachUser, requireRole } from '../middleware/auth.js'
import { schemas } from '../schemas/index.js'
import * as projectService from '../services/project-service.js'

/**
 * Projects + stage transition API.
 *
 * Thin HTTP handlers — every state change is delegated to
 * `services/project-service.js`, which owns transactions, persistence, and
 * notifications. Routes only handle auth, schema validation, and
 * request-to-service argument translation.
 *
 * GET    /api/projects
 * GET    /api/projects/:id           — returns project + subtasks + history
 * POST   /api/projects
 * POST   /api/projects/import        — legacy/backlist products (team_leader only)
 * PATCH  /api/projects/:id
 * DELETE /api/projects/:id           — soft delete (team_leader only)
 * GET    /api/projects/deleted       — list soft-deleted projects (team_leader only)
 * POST   /api/projects/:id/restore   — undo a soft delete (team_leader only)
 * POST   /api/projects/:id/catalog   — kaldır / geri al in Ürünler (team_leader only)
 * POST   /api/projects/:id/advance
 * POST   /api/projects/:id/approve
 * POST   /api/projects/:id/reject
 */

export async function projectRoutes(fastify) {
  fastify.get('/projects', async (request) => {
    await attachUser(request)
    return projectService.listProjects()
  })

  fastify.get('/projects/deleted', async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    return projectService.listDeletedProjectsOnly()
  })

  fastify.get('/projects/:id', async (request) => {
    await attachUser(request)
    return projectService.getProjectDetail(request.params.id)
  })

  fastify.post('/projects', { schema: schemas.projectsCreate }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    return projectService.createProject(request.user, request.body)
  })

  fastify.post('/projects/import', { schema: schemas.projectsImport }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { items, dryRun = false } = request.body
    return projectService.importLegacyProjects(request.user, items, dryRun)
  })

  fastify.patch('/projects/:id', { schema: schemas.projectsPatch }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    return projectService.patchProjectFields(request.params.id, request.user, request.body)
  })

  fastify.delete('/projects/:id', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    return projectService.deleteProjectSoft(request.params.id, request.user)
  })

  fastify.post('/projects/:id/restore', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    return projectService.restoreProjectSoft(request.params.id)
  })

  fastify.post('/projects/:id/catalog', { schema: schemas.projectsCatalog }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    return projectService.setCatalogHidden(
      request.params.id,
      request.user,
      request.body.hidden,
      request.body.note,
    )
  })

  fastify.post('/projects/:id/advance', { schema: schemas.projectsAdvance }, async (request) => {
    await attachUser(request)
    return projectService.advanceProject(request.params.id, request.user, {
      note: request.body?.note ?? '',
      route: request.body?.route ?? null,
    })
  })

  fastify.post('/projects/:id/approve', { schema: schemas.projectsApprove }, async (request) => {
    await attachUser(request)
    return projectService.approveProject(request.params.id, request.user, {
      stage: request.body.stage,
      note: request.body.note,
    })
  })

  fastify.post('/projects/:id/receive', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.receiveDemo(request.params.id, request.user)
  })

  fastify.post('/projects/:id/demo-not-received', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.demoNotReceived(request.params.id, request.user)
  })

  fastify.post('/projects/:id/ozalit-receive', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.ozalitReceive(request.params.id, request.user)
  })

  fastify.post('/projects/:id/ozalit-not-received', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.ozalitNotReceived(request.params.id, request.user)
  })

  fastify.post('/projects/:id/baski-onay-prepare', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.baskiOnayPrepare(request.params.id, request.user)
  })

  fastify.post('/projects/:id/demo-start', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.demoStart(request.params.id, request.user)
  })

  fastify.post('/projects/:id/ozalit-start', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.ozalitStart(request.params.id, request.user)
  })

  fastify.post('/projects/:id/demo-cancel', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.demoCancel(request.params.id, request.user)
  })

  fastify.post('/projects/:id/ozalit-cancel', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.ozalitCancel(request.params.id, request.user)
  })

  fastify.post('/projects/:id/demo-edit-notify', { schema: schemas.projectsFormEditNotify }, async (request) => {
    await attachUser(request)
    return projectService.demoEditNotify(request.params.id, request.user, request.body ?? {})
  })

  fastify.post('/projects/:id/ozalit-edit-notify', { schema: schemas.projectsFormEditNotify }, async (request) => {
    await attachUser(request)
    return projectService.ozalitEditNotify(request.params.id, request.user, request.body ?? {})
  })

  fastify.post('/projects/:id/demo-change-request', { schema: schemas.projectsChangeRequest }, async (request) => {
    await attachUser(request)
    return projectService.demoChangeRequest(request.params.id, request.user, {
      note: request.body?.note,
    })
  })

  fastify.post('/projects/:id/ozalit-change-request', { schema: schemas.projectsChangeRequest }, async (request) => {
    await attachUser(request)
    return projectService.ozalitChangeRequest(request.params.id, request.user, {
      note: request.body?.note,
    })
  })

  fastify.post('/projects/:id/demo-change-accept', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.demoChangeAccept(request.params.id, request.user)
  })

  fastify.post('/projects/:id/demo-change-decline', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.demoChangeDecline(request.params.id, request.user)
  })

  fastify.post('/projects/:id/ozalit-change-accept', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.ozalitChangeAccept(request.params.id, request.user)
  })

  fastify.post('/projects/:id/ozalit-change-decline', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.ozalitChangeDecline(request.params.id, request.user)
  })

  fastify.post('/projects/:id/ekran-demo-request', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.ekranDemoRequest(request.params.id, request.user)
  })

  fastify.post('/projects/:id/ekran-demo-approve', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    return projectService.ekranDemoApprove(request.params.id, request.user)
  })

  fastify.post('/projects/:id/ekran-demo-reject', { schema: schemas.projectsEkranDemoReject }, async (request) => {
    await attachUser(request)
    return projectService.ekranDemoReject(request.params.id, request.user, {
      reason: request.body.reason,
    })
  })

  fastify.post('/projects/:id/reject', { schema: schemas.projectsReject }, async (request) => {
    await attachUser(request)
    return projectService.rejectProject(request.params.id, request.user, {
      stage: request.body.stage,
      reason: request.body.reason,
      rejectTarget: request.body.reject_target,
      revizeIds: request.body.revizeIds,
      note: request.body.note,
    })
  })
}