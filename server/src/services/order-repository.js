/**
 * Pure SQL access for the sipariş (order) aggregate.
 *
 * Every function here does exactly one thing to the database and returns
 * rows. No domain rules, no notifications, no transaction management —
 * those belong to `services/orders-service.js` and `domain/entities/Order.js`.
 *
 * Callers that mutate always pass a tx `client` (from `withTx`); the only
 * pool-level entry point is the read-side `listOrders`.
 */

import { nanoid } from 'nanoid'
import { getPool } from '../db/pool.js'
import { conflict, HttpError } from '../domain/errors.js'

/**
 * Every column of `order_requests`, in the order the HTTP responses have
 * always carried them. Used as the RETURNING list on every write so the
 * shape the SPA receives never depends on which route produced it.
 */
export const ORDER_COLUMNS = `id, project_id, status, requested_by, payload, assignee_ids,
  matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
  ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
  ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
  ozalit_change_requested_note, ozalit_fix_pending,
  last_reject_type, baski_onay_form, ozalit_attempt, version, created_at, updated_at`

/**
 * Columns `updateOrder` is allowed to write. `version` and `updated_at` are
 * deliberately absent — they are bumped by the UPDATE itself so the row the
 * client gets back always reflects the database's own counter, never an
 * in-memory guess.
 */
const ORDER_WRITABLE_COLUMNS = new Set([
  'status', 'assignee_ids',
  'matbaa_received', 'matbaa_received_by', 'matbaa_received_at', 'matbaa_approvals',
  'ozalit_started', 'ozalit_started_by', 'ozalit_started_by_name', 'ozalit_started_at',
  'ozalit_change_requested_at', 'ozalit_change_requested_by', 'ozalit_change_requested_by_name',
  'ozalit_change_requested_note', 'ozalit_fix_pending',
  'last_reject_type', 'baski_onay_form', 'ozalit_attempt',
])

// JSONB columns must be stringified and cast explicitly: node-pg renders a
// bare JS array as a Postgres array literal (`{a,b}`), which a jsonb column
// rejects.
const ORDER_JSONB_COLUMNS = new Set(['assignee_ids', 'matbaa_approvals', 'baski_onay_form'])

/**
 * The full order list, hydrated with each order's history and its own
 * alt görev snapshot. N+1 by design — the list is small and the per-order
 * queries keep the shape trivial to read.
 */
export async function listOrders(db = getPool()) {
  const { rows } = await db.query(
    `SELECT o.id, o.project_id, o.status, o.requested_by, o.payload, o.assignee_ids,
            o.matbaa_received, o.matbaa_received_by, o.matbaa_received_at, o.matbaa_approvals,
            o.ozalit_started, o.ozalit_started_by, o.ozalit_started_by_name, o.ozalit_started_at,
            o.ozalit_change_requested_at, o.ozalit_change_requested_by, o.ozalit_change_requested_by_name,
            o.ozalit_change_requested_note, o.ozalit_fix_pending,
            o.last_reject_type, o.baski_onay_form, o.ozalit_attempt,
            o.version, o.created_at, o.updated_at, p.title AS project_title,
            u.name AS requested_by_name
       FROM order_requests o
       JOIN projects p ON p.id = o.project_id AND p.deleted_at IS NULL
       LEFT JOIN users u ON u.id = o.requested_by
       ORDER BY o.created_at DESC`,
  )
  const out = []
  for (const row of rows) {
    out.push({
      row,
      history: await listOrderHistory(row.id, db),
      subtasks: await listOrderSubtasks(row.id, db),
    })
  }
  return out
}

/**
 * One order's signature trail. `demo_id` (migration 053) points a row at the
 * exact ozalit sheet it produced; `signed_by_role` is the signer's CURRENT
 * role, the same approximation the approval gate itself uses.
 */
export async function listOrderHistory(orderId, db = getPool()) {
  const { rows } = await db.query(
    `SELECT oh.step, oh.notes, oh.signed_by_id, oh.created_at, oh.demo_id,
            u.name AS signed_by_name, u.role AS signed_by_role
       FROM order_history oh
       LEFT JOIN users u ON u.id = oh.signed_by_id
      WHERE oh.order_id = $1 ORDER BY oh.created_at`,
    [orderId],
  )
  return rows
}

/**
 * The order's own copy of the project's alt görevler (migration 039), so two
 * concurrent orders on one project never share rework tracking.
 */
export async function listOrderSubtasks(orderId, db = getPool()) {
  const { rows } = await db.query(
    `SELECT id, order_id, source_subtask_id, title, kind, is_done, total_pages,
            pages_done, total_stickers, stickers_done, done_at, needs_revize,
            position, created_at, updated_at
       FROM order_subtasks
      WHERE order_id = $1
      ORDER BY position, created_at`,
    [orderId],
  )
  return rows
}

/** Lock one order for the duration of the transaction. */
export async function lockOrder(client, orderId) {
  const { rows } = await client.query(
    'SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId],
  )
  return rows[0] ?? null
}

/**
 * Lock an order, reading only what the subtask-patch path needs
 * (`assignee_ids` gates the revize flag).
 */
export async function lockOrderForSubtaskPatch(client, orderId) {
  const { rows } = await client.query(
    'SELECT id, assignee_ids FROM order_requests WHERE id = $1 FOR UPDATE', [orderId],
  )
  return rows[0] ?? null
}

/**
 * Create the order row. `order_requests.id` is TEXT PRIMARY KEY with no
 * default, so an `o-<nanoid>` is minted here — the id shape is a persistence
 * concern, not a domain one.
 *
 * The RETURNING list is deliberately the narrow original set: this is the
 * body POST /order-requests has always answered with.
 */
export async function insertOrder(client, { projectId, requestedBy, payload }) {
  const { rows } = await client.query(
    `INSERT INTO order_requests (id, project_id, status, requested_by, payload)
     VALUES ($1,$2,'pending',$3,$4)
     RETURNING id, project_id, status, requested_by, payload, version, created_at, updated_at`,
    [`o-${nanoid(16)}`, projectId, requestedBy, payload],
  )
  return rows[0]
}

/**
 * Copy the project's live alt görevler onto the new order (migration 039).
 */
export async function snapshotProjectSubtasks(client, orderId, projectId) {
  await client.query(
    `INSERT INTO order_subtasks
       (order_id, source_subtask_id, title, kind, is_done, total_pages, pages_done,
        total_stickers, stickers_done, done_at, needs_revize, position)
     SELECT $1, s.id, s.title, s.kind, s.is_done, s.total_pages, s.pages_done,
            s.total_stickers, s.stickers_done, s.done_at, s.needs_revize, s.position
       FROM subtasks s
      WHERE s.project_id = $2`,
    [orderId, projectId],
  )
}

/**
 * Apply a field patch to an order.
 *
 * Always bumps `version` and `updated_at`, even when `fields` is empty — a
 * click that legitimately changes no column (re-approving an already-signed
 * matbaa_onay round) still has to move the optimistic-concurrency counter,
 * which is what the pre-refactor UPDATE did unconditionally.
 *
 * Optimistic-concurrency backstop. When `expectedVersion` is supplied, the
 * WHERE clause gains `AND version = $expectedVersion` so a click made against
 * a stale lock (or, more importantly, a concurrent writer that slipped past
 * the entity's `_assertExpectedVersion` check) hits zero rows and the SQL
 * refuses the write. The entity's check is the API-level guard the SPA sees
 * (`409 Bu kayıt başka biri …`); this is the DB-level guard that catches the
 * race even when no SPA `expectedVersion` is sent.
 */
export async function updateOrder(client, orderId, fields = {}, expectedVersion = null) {
  const cols = Object.keys(fields).filter((c) => ORDER_WRITABLE_COLUMNS.has(c))
  const assignments = [
    ...cols.map((c, i) => `${c} = $${i + 2}${ORDER_JSONB_COLUMNS.has(c) ? '::jsonb' : ''}`),
    'version = version + 1',
    'updated_at = NOW()',
  ].join(', ')
  const values = cols.map((c) => (
    ORDER_JSONB_COLUMNS.has(c) ? JSON.stringify(fields[c]) : fields[c]
  ))
  // The version guard sits at the tail of the WHERE clause so the entity
  // (which already owns the "version bumps in memory" contract) and the SQL
  // agree on what the new row looks like.
  let sql = `UPDATE order_requests
        SET ${assignments}
      WHERE id = $1`
  const params = [orderId, ...values]
  if (expectedVersion !== null && expectedVersion !== undefined) {
    sql += ` AND version = $${params.length + 1}`
    params.push(expectedVersion)
  }
  sql += ` RETURNING ${ORDER_COLUMNS}`
  const { rows } = await client.query(sql, params)
  if (expectedVersion !== null && expectedVersion !== undefined && rows.length === 0) {
    throw new HttpError(
      409,
      'Bu kayıt başka biri tarafından güncellendi. Sayfayı yenileyin.',
      'conflict',
    )
  }
  return rows[0]
}

/** Append one row to the order's signature trail. */
export async function insertOrderHistory(client, { orderId, step, signedById, note = '', demoId = null }) {
  await client.query(
    `INSERT INTO order_history (order_id, step, signed_by_id, notes, demo_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [orderId, step, signedById, note, demoId],
  )
}

/** Active team leader ids — the leader half of the matbaa_onay approver set. */
export async function activeTeamLeaderIds(client) {
  const { rows } = await client.query(
    "SELECT id FROM users WHERE role = 'team_leader' AND is_active = TRUE",
  )
  return rows.map((r) => r.id)
}

/** One user, for validating a designer assignment. */
export async function findUser(client, id) {
  const { rows } = await client.query(
    'SELECT id, role, is_active FROM users WHERE id = $1', [id],
  )
  return rows[0] ?? null
}

/**
 * Flag the alt görevler a rejection named, returning their titles for the
 * timeline note. Scoped by `order_id` so an id belonging to another order —
 * or to the live `subtasks` table — can't be flagged.
 */
export async function flagSubtasksForRevize(client, orderId, subtaskIds) {
  const { rows } = await client.query(
    `UPDATE order_subtasks SET needs_revize = TRUE, updated_at = NOW()
      WHERE order_id = $1 AND id = ANY($2::text[])
      RETURNING title`,
    [orderId, subtaskIds],
  )
  return rows.map((r) => r.title)
}

/** Lock one row of an order's alt görev snapshot. */
export async function lockOrderSubtask(client, orderId, subtaskId) {
  const { rows } = await client.query(
    'SELECT * FROM order_subtasks WHERE id = $1 AND order_id = $2 FOR UPDATE',
    [subtaskId, orderId],
  )
  return rows[0] ?? null
}

/** Apply a validated field patch to one alt görev row. */
export async function updateOrderSubtask(client, subtaskId, fields) {
  const cols = Object.keys(fields)
  const setSql = cols.map((c, i) => `${c} = $${i + 2}`).join(', ')
  const { rows } = await client.query(
    `UPDATE order_subtasks SET ${setSql}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [subtaskId, ...cols.map((c) => fields[c])],
  )
  return rows[0]
}
