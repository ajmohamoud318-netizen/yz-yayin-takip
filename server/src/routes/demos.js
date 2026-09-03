import { attachUser } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { getPool, withTx } from '../db/pool.js'
import { getProjectForUpdate, insertDemoSnapshot, logHistory } from '../services/project-repository.js'
import { schemas } from '../schemas/index.js'

/**
 * Demos API (demo + ozalit form submissions).
 *
 * GET  /api/demos
 * POST /api/demos   — body { project_id, kind, payload }
 *
 * Each submission also writes a `stage_history` row tagged with the
 * matching event (`demo_form` / `ozalit_form`) so the project timeline
 * can show who submitted what and when.
 */
export async function demoRoutes(fastify) {
  fastify.get('/demos', async (request) => {
    await attachUser(request)
    const { rows } = await getPool().query(
      // order_id (migration 053) rides along so the client can tell a
      // sipariş's ozalit sheet apart from the project's own — both carry the
      // same project_id and kind.
      'SELECT id, project_id, order_id, kind, payload, attempt, created_by, created_at FROM demos ORDER BY created_at DESC',
    )
    return rows
  })

  fastify.post('/demos', { schema: schemas.demosCreate }, async (request) => {
    await attachUser(request)
    const { project_id, order_id = null, kind = 'demo', payload = {}, attempt, silent = false } = request.body
    const result = await withTx(async (client) => {
      // Read the project INSIDE the transaction, with the same SELECT … FOR
      // UPDATE every route in projects.js uses.
      //
      // This used to read through the pool, outside any transaction, and then
      // insert in a separate one — a check-then-act race with no lock between
      // the two halves. The matbaa's own /demo-start / /ozalit-start commits
      // between them and the guard below has already passed on stale rows, so
      // the correction lands on a round that IS started: the very outcome the
      // guard exists to prevent, narrowed from "her page was minutes old" to
      // "two queries apart" but not closed.
      //
      // FOR UPDATE serialises the two against each other on the project row.
      // Either the start commits first and we read demo_started=true and
      // refuse, or we hold the lock and the start waits until this snapshot
      // is committed — and then sees it. No interleaving is left.
      const project = await getProjectForUpdate(client, project_id)
      if (!project) notFound('Proje bulunamadı.')
      // A sipariş's ozalit sheet (migration 053). Locked with the same
      // SELECT … FOR UPDATE the project gets above, and for the same reason:
      // the printer's own /ozalit-start commits between a check and an insert
      // otherwise, and the started-gate below would pass on a stale row.
      let order = null
      if (order_id) {
        const { rows: orderRows } = await client.query(
          'SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [order_id],
        )
        order = orderRows[0]
        if (!order) notFound('Talep bulunamadı.')
        if (order.project_id !== project_id) {
          badRequest('Talep bu projeye ait değil.')
        }
      }
      // Imported backlist products (origin='legacy', migration 031) have no
      // design phase to demo — they were inserted straight at a finished stage.
      // See assertNotLegacy in routes/projects.js for the full rationale.
      if (project.origin === 'legacy') {
        badRequest('Kayıtlı ürün için demo/ozalit formu oluşturulamaz.')
      }
      // Matbaa "Başladım" gate (migration 048), enforced on the WRITE.
      //
      // A snapshot is the sheet the matbaa works from, so changing one is a
      // change to their in-progress job and answers to the same gate as
      // computeDemoEdit/computeOzalitEdit. That guard used to live only on
      // /projects/:id/demo-edit-notify, which the client called *after* this
      // route had already committed the row — so a refused edit still landed:
      // the printer kept cutting from the sheet they started while the app
      // served the edited one, with no history row and no ping, because the
      // call that produces both is exactly the one that got refused.
      //
      // The matbaa is exempt: their own teslim stamps (handleAdvance) are
      // written while started is true by definition. Everyone else must go
      // through "Değişiklik İsteyin" and wait for the accept, which un-starts
      // the round and reopens this path.
      if (request.user.role !== 'printer') {
        if (order) {
          // The sipariş's own round lives at matbaa_ozalit_yapiyor (migration 051),
          // with the same flag under a different name.
          if (order.ozalit_started && order.status === 'matbaa_ozalit_yapiyor') {
            badRequest('Matbaa ozalit çalışmasına başladı, değişiklik isteyin.')
          }
        } else {
          const stage = project.stage
          if (kind === 'demo' && project.demo_started && (stage === 'demo_teslim' || stage === 'cin_demo_teslim')) {
            badRequest('Matbaa demo çalışmasına başladı, değişiklik isteyin.')
          }
          if (kind === 'ozalit' && project.ozalit_started && stage === 'ozalit_teslim') {
            badRequest('Matbaa ozalit çalışmasına başladı, değişiklik isteyin.')
          }
        }
      }
      // The attempt stamps which demo/ozalit round this form belongs to, so
      // the history timeline can reopen the exact sheet later — from any
      // browser (the SPA used to keep these only in localStorage). When the
      // client doesn't send one, derive it from the project's counter.
      const fallbackAttempt = (order
        ? order.ozalit_attempt
        : (kind === 'ozalit' ? project.ozalit_attempt : project.demo_attempt)) ?? 0
      const attemptNo = attempt ?? fallbackAttempt + 1
      const row = await insertDemoSnapshot(client, {
        project_id, order_id, kind, payload, attempt: attemptNo, created_by: request.user.id,
      })
      // Surface this in the project history list so the timeline isn't
      // missing designer submissions — unless the caller marks the save
      // `silent` (the spec-form dialog does: its advance/approve call
      // already produces the meaningful "Demoya Gönderildi" entry, and a
      // second "Demo formu gönderildi" row would just be noise).
      if (!silent && order) {
        // A sipariş round's timeline is order_history, not stage_history —
        // the project timeline already carries its own `order_*` events for
        // the steps themselves.
        await client.query(
          `INSERT INTO order_history (order_id, step, signed_by_id, notes, demo_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [order_id, 'ozalit_form', request.user.id, 'Ozalit formu gönderildi', row.id],
        )
      } else if (!silent) {
        // `project` is the row this transaction already holds a lock on, so
        // its stage is current — no second read (the old one went through the
        // pool, unlocked, and could disagree with the row being written).
        const stage = project.stage ?? 'tasarim'
        const event = kind === 'ozalit' ? 'ozalit_form' : 'demo_form'
        const label = kind === 'ozalit' ? 'Ozalit formu gönderildi' : 'Demo formu gönderildi'
        await logHistory(
          client,
          {
            project_id,
            from_stage: stage,
            to_stage: stage,
            action: 'system',
            event,
            note: label,
          },
          request.user,
        )
      }
      return row
    })
    return result
  })
}
