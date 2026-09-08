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
 */

import { getPool } from '../db/pool.js'

const COLUMNS = `
  project_id, parca, gate, state, owner_role, route, attempt,
  started_at, delivered_at, reason,
  rejected_by, rejected_by_name, rejected_at,
  created_at, updated_at
`

function rowToParcaState(r) {
  return {
    project_id: r.project_id,
    parca: r.parca,
    gate: r.gate,
    state: r.state,
    owner_role: r.owner_role ?? null,
    route: r.route ?? null,
    attempt: r.attempt ?? 1,
    started_at: r.started_at ?? null,
    delivered_at: r.delivered_at ?? null,
    reason: r.reason ?? null,
    rejected_by: r.rejected_by ?? null,
    rejected_by_name: r.rejected_by_name ?? null,
    rejected_at: r.rejected_at ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

/** Every parça row for one project, stable-ordered so the UI doesn't reshuffle. */
export async function listParcaState(client, projectId) {
  const q = client ?? getPool()
  const { rows } = await q.query(
    `SELECT ${COLUMNS} FROM parca_state WHERE project_id = $1 ORDER BY parca`,
    [projectId],
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
    `SELECT ps.project_id, ps.parca, ps.gate, ps.state, ps.owner_role, ps.route,
            ps.attempt, ps.started_at, ps.delivered_at, ps.reason,
            ps.rejected_by, ps.rejected_by_name, ps.rejected_at,
            ps.created_at, ps.updated_at,
            p.title AS project_title, p.stage AS project_stage, p.type AS project_type
       FROM parca_state ps
       JOIN projects p ON p.id = ps.project_id
      WHERE ps.owner_role = $1${stateFilter}
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
export async function upsertParcaState(client, projectId, parca, patch = {}) {
  const q = client ?? getPool()
  const { rows } = await q.query(
    `INSERT INTO parca_state
       (project_id, parca, gate, state, owner_role, route, attempt,
        started_at, delivered_at, reason, rejected_by, rejected_by_name, rejected_at)
     VALUES ($1,$2,
       -- Most patches are state-only (approve, deliver, start) and carry no
       -- gate — they update a row that already has one. Fall back to the
       -- stored value so those don't have to restate it. If there is no row
       -- AND no gate, the NOT NULL fires, which is the correct signal: you
       -- cannot create a parça without saying which gate it is cycling on.
       COALESCE($3, (SELECT ps2.gate FROM parca_state ps2
                      WHERE ps2.project_id = $1 AND ps2.parca = $2)),
       -- Fall through to the stored value before the literal: see the note
       -- above on EXCLUDED. A patch that omits state or attempt must leave the
       -- row's own value in place; only a first insert gets the default.
       COALESCE($4, (SELECT ps3.state FROM parca_state ps3
                      WHERE ps3.project_id = $1 AND ps3.parca = $2), 'pending'),
       $5,$6,
       COALESCE($7, (SELECT ps4.attempt FROM parca_state ps4
                      WHERE ps4.project_id = $1 AND ps4.parca = $2), 1),
       $8,$9,$10,$11,$12,$13)
     ON CONFLICT (project_id, parca) DO UPDATE SET
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
       reason           = COALESCE(EXCLUDED.reason,           parca_state.reason),
       rejected_by      = COALESCE(EXCLUDED.rejected_by,      parca_state.rejected_by),
       rejected_by_name = COALESCE(EXCLUDED.rejected_by_name, parca_state.rejected_by_name),
       rejected_at      = COALESCE(EXCLUDED.rejected_at,      parca_state.rejected_at),
       updated_at       = NOW()
     RETURNING ${COLUMNS}`,
    [
      projectId, parca,
      patch.gate ?? null,
      patch.state ?? null,
      patch.owner_role ?? null,
      patch.route ?? null,
      patch.attempt ?? null,
      patch.started_at ?? null,
      patch.delivered_at ?? null,
      patch.reason ?? null,
      patch.rejected_by ?? null,
      patch.rejected_by_name ?? null,
      patch.rejected_at ?? null,
    ],
  )
  return rowToParcaState(rows[0])
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
    `INSERT INTO parca_state (project_id, parca, gate, state)
     SELECT $1, unnest($2::text[]), $3, 'pending'
     ON CONFLICT (project_id, parca) DO NOTHING
     RETURNING ${COLUMNS}`,
    [projectId, parcalar, gate],
  )
  return rows.map(rowToParcaState)
}

/**
 * Retire a parça. Used when a leader removes it from Ürün Bilgileri — the one
 * case where a parça genuinely stops existing, as opposed to merely being
 * absent from a round.
 */
export async function deleteParcaState(client, projectId, parca) {
  const q = client ?? getPool()
  await q.query(
    'DELETE FROM parca_state WHERE project_id = $1 AND parca = $2',
    [projectId, parca],
  )
}
