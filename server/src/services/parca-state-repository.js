/**
 * Per-parça workflow state: thin SQL wrapper for the `parca_state` table
 * (migration 074). Designed for use from route handlers and service entry
 * points inside `withTx`.
 *
 * Sibling to `project-repository.js` — that file owns `projects` /
 * `stage_history` / `demos`. This one owns the answer to a question the
 * projects table structurally cannot answer: *whose desk is each parça on?*
 *
 * The split matters. `projects` carries per-parça ledgers already
 * (migrations 068/069/070) but they record **who signed what** — an audit of
 * decisions taken. `parca_state` records **whose turn it is** — routing. A
 * project at `demo_onay` can have KUTU approved, KİTAP back with the designer
 * and KILAVUZ at the matbaa simultaneously; the ledgers describe the first,
 * this table the other two.
 *
 * Deliberately NOT a diffed project column set: these rows change on their own
 * cadence (a matbaa "başladım" touches one parça and no project field), so
 * routing them through `changedFields` / `patchProject` would mean a project
 * UPDATE per parça click. Writes here are plain upserts inside the caller's
 * transaction.
 *
 * TWO PIPELINES, ONE TABLE (migration 080)
 *
 * `order_id` follows migration 053's convention for `demos`: NULL means the
 * PROJECT's own round, non-NULL means a sipariş's. Every function below is
 * therefore explicit about which it means — the project-scoped ones carry
 * `order_id IS NULL` in their WHERE, and the order-scoped ones are separate
 * exports ending in `ForOrder`.
 *
 * That filter is not defensive tidiness. `listParcaState` feeds the PROJECT's
 * approval gate (project-service/transitions.js reads it to decide whether a
 * stage may advance) and `deleteParcaStateForGate` wipes a round. Without the
 * filter, the moment a title has one sipariş in flight its order's parçalar
 * would count toward the project's gate and be deleted by the project's round
 * reset — a stage advancing on parçalar nobody produced for it, which is the
 * exact failure mode migration 074's own header warns about from the other
 * direction.
 *
 * The two unique indexes (ux_parca_state_project / ux_parca_state_order) are
 * PARTIAL, so every upsert has to name the matching one as its ON CONFLICT
 * arbiter by restating the predicate. That is why the upsert is two exports
 * rather than one with a nullable argument: the arbiter clause is part of the
 * SQL, not a bound parameter.
 */

import { getPool } from '../db/pool.js'

const COLUMNS = `
  project_id, order_id, parca, gate, state, owner_role, route, attempt,
  started_at, delivered_at, received_at, received_by, received_by_name, reason,
  rejected_by, rejected_by_name, rejected_at,
  change_requested_at, change_requested_by, change_requested_by_name,
  change_requested_note, fix_pending,
  created_at, updated_at
`

function rowToParcaState(r) {
  return {
    project_id: r.project_id,
    // NULL for a project's own round, set for a sipariş's (migration 080).
    order_id: r.order_id ?? null,
    parca: r.parca,
    gate: r.gate,
    state: r.state,
    owner_role: r.owner_role ?? null,
    route: r.route ?? null,
    attempt: r.attempt ?? 1,
    started_at: r.started_at ?? null,
    delivered_at: r.delivered_at ?? null,
    received_at: r.received_at ?? null,
    received_by: r.received_by ?? null,
    received_by_name: r.received_by_name ?? null,
    reason: r.reason ?? null,
    rejected_by: r.rejected_by ?? null,
    rejected_by_name: r.rejected_by_name ?? null,
    rejected_at: r.rejected_at ?? null,
    change_requested_at: r.change_requested_at ?? null,
    change_requested_by: r.change_requested_by ?? null,
    change_requested_by_name: r.change_requested_by_name ?? null,
    change_requested_note: r.change_requested_note ?? null,
    fix_pending: r.fix_pending ?? false,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

/**
 * Every parça row for one project's OWN rounds, stable-ordered so the UI
 * doesn't reshuffle.
 *
 * `order_id IS NULL` is load-bearing: this is what the project's approval gate
 * reads (project-service/transitions.js), and a title with a sipariş in flight
 * would otherwise have that order's parçalar counted toward whether the
 * PROJECT may advance. Use `listParcaStateForOrder` for a sipariş's.
 */
export async function listParcaState(client, projectId) {
  const q = client ?? getPool()
  const { rows } = await q.query(
    `SELECT ${COLUMNS} FROM parca_state
      WHERE project_id = $1 AND order_id IS NULL
      ORDER BY parca`,
    [projectId],
  )
  return rows.map(rowToParcaState)
}

/** Every parça row for one sipariş's ozalit round (migration 080). */
export async function listParcaStateForOrder(client, orderId) {
  const q = client ?? getPool()
  const { rows } = await q.query(
    `SELECT ${COLUMNS} FROM parca_state
      WHERE order_id = $1
      ORDER BY parca`,
    [orderId],
  )
  return rows.map(rowToParcaState)
}

/**
 * Every parça currently sitting on one role's desk, across all live projects —
 * the query behind the matbaa's per-parça queue (one row per parça, not per
 * project). Joined to `projects` so the caller gets the title and stage in one
 * round-trip instead of N.
 *
 * Soft-deleted projects are excluded: a deleted project's parçalar are nobody's
 * work, and leaving them in would resurrect the job in the matbaa's list.
 */
export async function listParcaStateByOwner(client, ownerRole, states = null) {
  const q = client ?? getPool()
  const params = [ownerRole]
  let stateFilter = ''
  if (Array.isArray(states) && states.length > 0) {
    params.push(states)
    stateFilter = ' AND ps.state = ANY($2)'
  }
  const { rows } = await q.query(
    `SELECT ps.project_id, ps.order_id, ps.parca, ps.gate, ps.state, ps.owner_role, ps.route,
            ps.attempt, ps.started_at, ps.delivered_at,
            ps.received_at, ps.received_by, ps.received_by_name, ps.reason,
            ps.rejected_by, ps.rejected_by_name, ps.rejected_at,
            ps.change_requested_at, ps.change_requested_by,
            ps.change_requested_by_name, ps.change_requested_note, ps.fix_pending,
            ps.created_at, ps.updated_at,
            p.title AS project_title, p.stage AS project_stage, p.type AS project_type
       FROM parca_state ps
       JOIN projects p ON p.id = ps.project_id
      WHERE ps.owner_role = $1${stateFilter}
        AND ps.order_id IS NULL
        AND p.deleted_at IS NULL
      ORDER BY ps.updated_at DESC`,
    params,
  )
  return rows.map((r) => ({
    ...rowToParcaState(r),
    project_title: r.project_title,
    project_stage: r.project_stage,
    project_type: r.project_type,
  }))
}

/**
 * The sipariş half of `listParcaStateByOwner` — every parça of an ORDER's
 * ozalit round sitting on one role's desk (migration 080).
 *
 * A separate export rather than a flag on the function above, because the two
 * feed different derivations downstream: a project round's owed parçalar are
 * derived from its stage (`TESLIM_GATES`), a sipariş's from its order status,
 * and `listMyParcaQueue` has to run each through its own live-round pass
 * before the two lists can be concatenated.
 *
 * Joined to `order_requests` for the status the caller needs to know whether
 * the round is still live, and on to `projects` for the title the card shows —
 * a sipariş has no title of its own, it reprints the project's.
 *
 * Cancelled/rejected orders are excluded the same way soft-deleted projects
 * are above: their parçalar are nobody's work, and leaving them in resurrects
 * a job in the matbaa's list.
 */
export async function listOrderParcaStateByOwner(client, ownerRole, states = null) {
  const q = client ?? getPool()
  const params = [ownerRole]
  let stateFilter = ''
  if (Array.isArray(states) && states.length > 0) {
    params.push(states)
    stateFilter = ' AND ps.state = ANY($2)'
  }
  const { rows } = await q.query(
    `SELECT ps.project_id, ps.order_id, ps.parca, ps.gate, ps.state, ps.owner_role, ps.route,
            ps.attempt, ps.started_at, ps.delivered_at,
            ps.received_at, ps.received_by, ps.received_by_name, ps.reason,
            ps.rejected_by, ps.rejected_by_name, ps.rejected_at,
            ps.change_requested_at, ps.change_requested_by,
            ps.change_requested_by_name, ps.change_requested_note, ps.fix_pending,
            ps.created_at, ps.updated_at,
            p.title AS project_title, p.stage AS project_stage, p.type AS project_type,
            o.status AS order_status, o.assignee_ids AS order_assignee_ids, o.order_no
       FROM parca_state ps
       JOIN order_requests o ON o.id = ps.order_id
       JOIN projects p ON p.id = ps.project_id
      WHERE ps.owner_role = $1${stateFilter}
        AND ps.order_id IS NOT NULL
        AND o.status NOT IN ('baskida', 'rejected')
        AND p.deleted_at IS NULL
      ORDER BY ps.updated_at DESC`,
    params,
  )
  return rows.map((r) => ({
    ...rowToParcaState(r),
    project_title: r.project_title,
    project_stage: r.project_stage,
    project_type: r.project_type,
    order_status: r.order_status,
    order_assignee_ids: r.order_assignee_ids ?? [],
    order_no: r.order_no,
  }))
}

/**
 * Create or update one parça's row. `patch` carries only the fields the caller
 * means to change; everything else keeps its stored value.
 *
 * ON CONFLICT rather than a read-then-write: two parties can act on different
 * parçalar of the same project concurrently (that is the feature), and a
 * check-then-act here would be the same race `routes/demos.js` documents at
 * length. COALESCE on the update side means a patch that omits a field leaves
 * it alone instead of nulling it.
 *
 * That last promise only holds if the INSERT list hands the conflict branch a
 * NULL to fall through. `EXCLUDED.x` is the value this statement WOULD have
 * inserted — so a literal fallback in VALUES (`COALESCE($n, 1)`) makes
 * `EXCLUDED.x` permanently non-NULL and the guard on the update side can never
 * fire. `attempt` was written that way, and every state-only patch (start,
 * deliver, request-round) silently reset a parça's round counter to 1: a parça
 * on its fifth round still read "Tur 2". Both defaulted columns therefore fall
 * back through the STORED row first — the same shape `gate` already used —
 * and only reach the literal when there is no row to keep.
 */
/**
 * The upsert body, shared by both pipelines.
 *
 * Only the KEY differs between them, and it differs in two places SQL will not
 * let us parameterise: the correlated subqueries that fall back to the stored
 * row, and the ON CONFLICT arbiter. `ux_parca_state_project` and
 * `ux_parca_state_order` are PARTIAL indexes (migration 080), so naming one
 * means restating its predicate — `ON CONFLICT (project_id, parca) WHERE
 * order_id IS NULL` — which is SQL text, not a bound value.
 *
 * Building both from one template keeps every COALESCE decision below stated
 * once. Those decisions are the subtle part of this file (which fields survive
 * a patch that omits them and which are cleared by omission), and having them
 * diverge between a project's parça and a sipariş's would be a bug nobody
 * would find by reading either copy alone.
 *
 * Parameter binding is identical for both: $1 project_id, $2 order_id (NULL
 * for a project's own round), $3 parca, then the patch fields. The order
 * variant simply never reads $1 in its key predicate.
 */
function buildUpsertSql({ storedRow, conflictTarget }) {
  return `INSERT INTO parca_state
       (project_id, order_id, parca, gate, state, owner_role, route, attempt,
        started_at, delivered_at, received_at, received_by, received_by_name,
        reason, rejected_by, rejected_by_name, rejected_at,
        change_requested_at, change_requested_by, change_requested_by_name,
        change_requested_note, fix_pending)
     VALUES ($1,$2,$3,
       -- Most patches are state-only (approve, deliver, start) and carry no
       -- gate — they update a row that already has one. Fall back to the
       -- stored value so those don't have to restate it. If there is no row
       -- AND no gate, the NOT NULL fires, which is the correct signal: you
       -- cannot create a parça without saying which gate it is cycling on.
       COALESCE($4, (SELECT ps2.gate FROM parca_state ps2 WHERE ${storedRow('ps2')})),
       -- Fall through to the stored value before the literal: see the note
       -- above on EXCLUDED. A patch that omits state or attempt must leave the
       -- row's own value in place; only a first insert gets the default.
       COALESCE($5, (SELECT ps3.state FROM parca_state ps3 WHERE ${storedRow('ps3')}), 'pending'),
       $6,$7,
       COALESCE($8, (SELECT ps4.attempt FROM parca_state ps4 WHERE ${storedRow('ps4')}), 1),
       $9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,
       -- NOT NULL, so it needs the same stored-row fallback state and
       -- attempt use: a patch that omits the flag must leave the row's own
       -- value alone, and only a first insert may reach the literal.
       COALESCE($22, (SELECT ps5.fix_pending FROM parca_state ps5 WHERE ${storedRow('ps5')}), FALSE))
     ON CONFLICT ${conflictTarget} DO UPDATE SET
       gate             = COALESCE(EXCLUDED.gate,             parca_state.gate),
       state            = COALESCE(EXCLUDED.state,            parca_state.state),
       -- owner_role and route are cleared on purpose when a parça returns to
       -- the gate, so they take EXCLUDED verbatim rather than COALESCE-ing the
       -- old owner back in. The caller passes the value it means.
       owner_role       = EXCLUDED.owner_role,
       route            = EXCLUDED.route,
       attempt          = COALESCE(EXCLUDED.attempt,          parca_state.attempt),
       started_at       = EXCLUDED.started_at,
       delivered_at     = EXCLUDED.delivered_at,
       -- The receipt belongs to ONE delivery (migration 076), so it takes
       -- EXCLUDED verbatim alongside the two stamps above rather than being
       -- COALESCE'd: every leg that takes the parça off the gate — a fresh
       -- delivery, a reject, a new round — omits these and thereby clears
       -- them, which is exactly the "a new proof owes a new Teslim Alındı"
       -- rule the project-level columns follow.
       received_at      = EXCLUDED.received_at,
       received_by      = EXCLUDED.received_by,
       received_by_name = EXCLUDED.received_by_name,
       reason           = COALESCE(EXCLUDED.reason,           parca_state.reason),
       rejected_by      = COALESCE(EXCLUDED.rejected_by,      parca_state.rejected_by),
       rejected_by_name = COALESCE(EXCLUDED.rejected_by_name, parca_state.rejected_by_name),
       rejected_at      = COALESCE(EXCLUDED.rejected_at,      parca_state.rejected_at),
       -- The change-request handshake (migration 077) belongs to ONE round, so
       -- it takes EXCLUDED verbatim alongside the delivery stamps: accept and
       -- decline both clear it by passing nulls, and any other leg that moves
       -- the parça — a delivery, a reject, a new round — answers the question
       -- by omission, which is what should happen to a request nobody replied
       -- to before the parça left.
       change_requested_at      = EXCLUDED.change_requested_at,
       change_requested_by      = EXCLUDED.change_requested_by,
       change_requested_by_name = EXCLUDED.change_requested_by_name,
       change_requested_note    = EXCLUDED.change_requested_note,
       -- The correction debt is NOT of that kind: it outlives the accept that
       -- created it and is settled only by the leader's edit landing (or by a
       -- leg that explicitly ends the round). So it COALESCEs, and the patches
       -- that mean to clear it say fix_pending false out loud.
       fix_pending      = COALESCE(EXCLUDED.fix_pending,      parca_state.fix_pending),
       updated_at       = NOW()
     RETURNING ${COLUMNS}`
}

// A project's own round: keyed (project_id, parca) among the rows where
// order_id IS NULL. Restating that predicate is what lets Postgres infer the
// partial index ux_parca_state_project as the arbiter.
const UPSERT_PROJECT_SQL = buildUpsertSql({
  storedRow: (a) => `${a}.project_id = $1 AND ${a}.order_id IS NULL AND ${a}.parca = $3`,
  conflictTarget: '(project_id, parca) WHERE order_id IS NULL',
})

// A sipariş's round: keyed (order_id, parca). project_id rides along on the
// row — a sipariş parça still points at the product it reprints — but it is
// not part of the key, because an order belongs to exactly one project.
const UPSERT_ORDER_SQL = buildUpsertSql({
  storedRow: (a) => `${a}.order_id = $2 AND ${a}.parca = $3`,
  conflictTarget: '(order_id, parca) WHERE order_id IS NOT NULL',
})

/** The bound values, in the order both statements above declare them. */
function upsertParams(projectId, orderId, parca, patch) {
  return [
    projectId, orderId, parca,
    patch.gate ?? null,
    patch.state ?? null,
    patch.owner_role ?? null,
    patch.route ?? null,
    patch.attempt ?? null,
    patch.started_at ?? null,
    patch.delivered_at ?? null,
    patch.received_at ?? null,
    patch.received_by ?? null,
    patch.received_by_name ?? null,
    patch.reason ?? null,
    patch.rejected_by ?? null,
    patch.rejected_by_name ?? null,
    patch.rejected_at ?? null,
    patch.change_requested_at ?? null,
    patch.change_requested_by ?? null,
    patch.change_requested_by_name ?? null,
    patch.change_requested_note ?? null,
    patch.fix_pending ?? null,
  ]
}

/**
 * Create or update one parça's row on a PROJECT's own round. `patch` carries
 * only the fields the caller means to change; everything else keeps its stored
 * value.
 *
 * ON CONFLICT rather than a read-then-write: two parties can act on different
 * parçalar of the same project concurrently (that is the feature), and a
 * check-then-act here would be the same race `routes/demos.js` documents at
 * length. COALESCE on the update side means a patch that omits a field leaves
 * it alone instead of nulling it.
 *
 * That last promise only holds if the INSERT list hands the conflict branch a
 * NULL to fall through. `EXCLUDED.x` is the value this statement WOULD have
 * inserted — so a literal fallback in VALUES (`COALESCE($n, 1)`) makes
 * `EXCLUDED.x` permanently non-NULL and the guard on the update side can never
 * fire. `attempt` was written that way, and every state-only patch (start,
 * deliver, request-round) silently reset a parça's round counter to 1: a parça
 * on its fifth round still read "Tur 2". Both defaulted columns therefore fall
 * back through the STORED row first — the same shape `gate` already used —
 * and only reach the literal when there is no row to keep.
 */
export async function upsertParcaState(client, projectId, parca, patch = {}) {
  const q = client ?? getPool()
  const { rows } = await q.query(
    UPSERT_PROJECT_SQL,
    upsertParams(projectId, null, parca, patch),
  )
  return rowToParcaState(rows[0])
}

/**
 * The sipariş twin (migration 080). Same patch semantics in every respect —
 * they share `buildUpsertSql` precisely so they cannot drift — differing only
 * in which unique index arbitrates the conflict.
 *
 * `projectId` is still required: it is NOT NULL on the row, and it is what
 * lets a sipariş parça be shown against the product it reprints.
 */
export async function upsertOrderParcaState(client, projectId, orderId, parca, patch = {}) {
  const q = client ?? getPool()
  const { rows } = await q.query(
    UPSERT_ORDER_SQL,
    upsertParams(projectId, orderId, parca, patch),
  )
  return rowToParcaState(rows[0])
}

/**
 * Wipe one gate's routing rows for a project — what a genuinely NEW round owes
 * the old one before it starts.
 *
 * `upsertParcaState` above only ever touches the one parça it's told to; nothing
 * in this file (or in domain/transitions.js) ever cleared a round's rows
 * wholesale, so a parça's row from a FINISHED round silently outlived it. The
 * next round's queue derivation (`deriveTeslimParcalar`,
 * services/parca-service.js) and delivery gate (`allParcalarDelivered`,
 * `parcalarStillOwed`) all read this table unscoped by round — they see
 * "there's a row for KUTU, and it isn't with_matbaa/in_round" and conclude KUTU
 * is done, when the truth is KUTU has not been touched in the round that is
 * actually live. A fresh round's matbaa queue came up short a parça, and the
 * round could complete without it ever being reprinted.
 *
 * Scoped to `gate` because a project can hold both a demo round and an ozalit
 * round's history at once — resetting the wrong one would erase live routing on
 * the leg that isn't restarting.
 *
 * Callers: every transition in domain/transitions.js that begins a round the
 * old rows have nothing to say about — a demo/ozalit resend, the first send out
 * of `tasarim`, and a whole-round reject-to-matbaa. NOT a "not received"
 * redelivery of the SAME round (computeDemoNotReceived / computeOzalitNotReceived)
 * — there the physical work still exists, so the rows are still true.
 */
export async function deleteParcaStateForGate(client, projectId, gate) {
  const q = client ?? getPool()
  // `order_id IS NULL` (migration 080): a project's round reset must not wipe
  // the routing of a sipariş that is in flight on the same title. Both would
  // match `project_id = $1 AND gate = 'ozalit'` — a reprint's round IS an
  // ozalit round on that project — so without this the leader resending a
  // project ozalit would silently clear the matbaa's live sipariş parçalar,
  // and the order's own gate would then read them as never delivered.
  await q.query(
    'DELETE FROM parca_state WHERE project_id = $1 AND gate = $2 AND order_id IS NULL',
    [projectId, gate],
  )
}

/**
 * The sipariş twin: wipe one ORDER's routing rows, for the same reason —
 * a genuinely new round owes the old one nothing. Scoped by order alone; an
 * order has exactly one gate ('ozalit'), so there is nothing to disambiguate.
 */
export async function deleteParcaStateForOrder(client, orderId) {
  const q = client ?? getPool()
  await q.query('DELETE FROM parca_state WHERE order_id = $1', [orderId])
}

/**
 * Make sure every parça a round carries has a row, without disturbing the ones
 * it doesn't.
 *
 * This is the explicit replacement for `pruneApprovalsToSnapshot`
 * (domain/transitions.js). That helper deletes ledger entries for any parça
 * missing from the CURRENT round's snapshot — correct while every round covered
 * the whole sheet, and destructive the moment a re-round can carry only the
 * rejected parça: approving KİTAP on a KİTAP-only round would drop KUTU's
 * sign-off. Seeding by union means a parça is only ever removed when someone
 * removes it, never by being absent from one round.
 */
export async function ensureParcaRows(client, projectId, parcalar, gate) {
  if (!Array.isArray(parcalar) || parcalar.length === 0) return []
  const q = client ?? getPool()
  const { rows } = await q.query(
    `INSERT INTO parca_state (project_id, order_id, parca, gate, state)
     SELECT $1, NULL, unnest($2::text[]), $3, 'pending'
     ON CONFLICT (project_id, parca) WHERE order_id IS NULL DO NOTHING
     RETURNING ${COLUMNS}`,
    [projectId, parcalar, gate],
  )
  return rows.map(rowToParcaState)
}

/**
 * The sipariş twin (migration 080). Same union-seeding contract: a parça is
 * only ever removed when someone removes it, never by being absent from one
 * round.
 */
export async function ensureOrderParcaRows(client, projectId, orderId, parcalar) {
  if (!Array.isArray(parcalar) || parcalar.length === 0) return []
  const q = client ?? getPool()
  const { rows } = await q.query(
    `INSERT INTO parca_state (project_id, order_id, parca, gate, state)
     SELECT $1, $2, unnest($3::text[]), 'ozalit', 'pending'
     ON CONFLICT (order_id, parca) WHERE order_id IS NOT NULL DO NOTHING
     RETURNING ${COLUMNS}`,
    [projectId, orderId, parcalar],
  )
  return rows.map(rowToParcaState)
}

/**
 * Every parça standing at a gate on a round that is still out at the matbaa —
 * the leader's own per-parça queue (migration 076).
 *
 * Migration 074 said a leader has no per-parça queue because their work is the
 * approval gate. That stopped being true the moment the matbaa could deliver a
 * round in pieces: the project waits at its *_teslim stage for the last parça,
 * so the gate never opens, and a parça that came back early sat in nobody's
 * list at all. These are those parçalar — delivered, at the gate, waiting for a
 * receipt or a decision.
 *
 * `owner_role` is NULL for a row at the gate, which is exactly why
 * `listParcaStateByOwner` cannot answer this: the whole point of a parça at the
 * gate is that it is on no single person's desk.
 *
 * The round's ledgers come back on the row so the caller can drop parçalar it
 * has already signed off without a second query per project.
 */
export async function listGateParcalarAwaitingLeader(client) {
  const q = client ?? getPool()
  const { rows } = await q.query(
    `SELECT ps.project_id, ps.parca, ps.gate, ps.state, ps.owner_role, ps.route,
            ps.attempt, ps.started_at, ps.delivered_at,
            ps.received_at, ps.received_by, ps.received_by_name, ps.reason,
            ps.rejected_by, ps.rejected_by_name, ps.rejected_at,
            ps.change_requested_at, ps.change_requested_by,
            ps.change_requested_by_name, ps.change_requested_note, ps.fix_pending,
            ps.created_at, ps.updated_at,
            p.title AS project_title, p.stage AS project_stage, p.type AS project_type,
            p.demo_parca_approvals, p.ozalit_parca_approvals
       FROM parca_state ps
       JOIN projects p ON p.id = ps.project_id
      WHERE ps.state = 'pending'
        AND ps.delivered_at IS NOT NULL
        AND ps.order_id IS NULL
        AND p.deleted_at IS NULL
        AND p.stage IN ('demo_teslim', 'cin_demo_teslim', 'ozalit_teslim')
      ORDER BY ps.delivered_at ASC`,
  )
  return rows.map((r) => ({
    ...rowToParcaState(r),
    project_title: r.project_title,
    project_stage: r.project_stage,
    project_type: r.project_type,
    demo_parca_approvals: r.demo_parca_approvals ?? [],
    ozalit_parca_approvals: r.ozalit_parca_approvals ?? {},
  }))
}

/**
 * Retire a parça. Used when a leader removes it from Ürün Bilgileri — the one
 * case where a parça genuinely stops existing, as opposed to merely being
 * absent from a round.
 */
export async function deleteParcaState(client, projectId, parca) {
  const q = client ?? getPool()
  await q.query(
    'DELETE FROM parca_state WHERE project_id = $1 AND parca = $2 AND order_id IS NULL',
    [projectId, parca],
  )
}

/** The sipariş twin — retire one parça of one order's round. */
export async function deleteOrderParcaState(client, orderId, parca) {
  const q = client ?? getPool()
  await q.query(
    'DELETE FROM parca_state WHERE order_id = $1 AND parca = $2',
    [orderId, parca],
  )
}
