/**
 * Per-parça routing — the pure half of migration 074's `parca_state`.
 *
 * These functions decide what a parça's routing row should become. They never
 * touch SQL: each returns a patch object that `services/parca-state-repository.js`
 * upserts inside the caller's transaction, in the same shape as the rest of the
 * FSM in `domain/transitions.js` (compute a value, let the service persist it).
 *
 * The model in one paragraph: a parça sits at the approval gate (`pending`)
 * until a leader either approves it (`approved`, terminal for the round) or
 * rejects it to somebody. A reject names the responsible party, and that party
 * becomes the row's `owner_role`: the designer reworks it and sends it back
 * round, or the matbaa reprints it. Whoever holds it, the parça returns to
 * `pending` when their work lands, and the leader decides again. The project
 * advances only once every parça is `approved`.
 *
 *     pending ──approve──────────────────────► approved
 *        │
 *        ├──reject(designer)──► with_designer ──request round──┐
 *        │                                                     │
 *        └──reject(matbaa)────► with_matbaa ──başlat──► in_round┤
 *                                                              ▼
 *                                                           pending
 *
 * Why the project's `stage` no longer moves on a per-parça reject: with two
 * parties working different parçalar of one project at once, there is no single
 * stage that is true. The stage stays at the approval gate and this table
 * carries the detail — so Kanban, the project lists and StageBar keep meaning
 * what they always meant, and the parça grid answers "but what's actually
 * happening". A WHOLE-round reject still moves the stage exactly as before;
 * that split is the backward-compatibility contract.
 */

/** Roles that may be handed a parça. Mirrors the CHECK on parca_state.owner_role. */
export const PARCA_OWNERS = ['designer', 'printer', 'team_leader']

/** Every state a parça row can hold. Mirrors the CHECK on parca_state.state. */
export const PARCA_STATES = ['pending', 'approved', 'with_designer', 'with_matbaa', 'in_round']

/**
 * Which gate a stage's parçalar are cycling on, or null where per-parça routing
 * does not apply.
 *
 * Baskı onayı is deliberately absent: it is a leader-to-leader maker-checker
 * (migration 070) with no designer or matbaa leg, so there is no party to route
 * a parça to.
 *
 * @param {string | undefined} stage
 * @returns {'demo' | 'ozalit' | null}
 */
export function parcaGateForStage(stage) {
  if (stage === 'demo_onay' || stage === 'cin_demo_onay') return 'demo'
  if (stage === 'ozalit_onay') return 'ozalit'
  return null
}

/**
 * The patch for a parça the leader just rejected.
 *
 * `target` is the existing reject vocabulary ('designer' | 'matbaa') so the
 * per-parça path and the whole-round path stay one concept — see
 * `computeRejection` in transitions.js.
 *
 * `started_at` / `delivered_at` are cleared because the parça begins a fresh
 * round: leaving them set would make the matbaa's per-parça "İşlemi Başlatın"
 * button think work was already underway, the same stale-flag bug the
 * project-level `legReset` exists to prevent.
 */
export function parcaRejectPatch({
  target, reason, actor, actorName, now, gate, currentAttempt = 1,
}) {
  const toMatbaa = target === 'matbaa'
  return {
    gate,
    state: toMatbaa ? 'with_matbaa' : 'with_designer',
    owner_role: toMatbaa ? 'printer' : 'designer',
    // The route is the DESIGNER's choice, made when they send the parça back
    // round. A reject never presumes it — not even to the matbaa, whose round
    // is physical by definition but whose row is re-routed on delivery anyway.
    route: null,
    reason: reason ?? null,
    rejected_by: actor?.id ?? null,
    rejected_by_name: actorName ?? null,
    rejected_at: now,
    attempt: (currentAttempt ?? 1) + 1,
    started_at: null,
    delivered_at: null,
  }
}

/**
 * The patch for a parça the designer has revized and is sending back round.
 *
 * Mirrors the project-level post-revize route picker
 * (`computeAdvance`'s ozalit redo leg, transitions.js), scoped to one parça:
 *
 *   'physical' → the matbaa produces this parça again; it lands on their desk.
 *   'ekran'    → a screen check with no physical proof, so it skips the matbaa
 *                entirely and goes straight back to the leader.
 */
export function parcaRequestRoundPatch({ route, now }) {
  if (route !== 'physical' && route !== 'ekran') {
    throw new Error(`Geçersiz parça rotası: ${route}`)
  }
  if (route === 'ekran') {
    return {
      state: 'pending',
      owner_role: null,
      route: 'ekran',
      started_at: null,
      delivered_at: null,
    }
  }
  return {
    state: 'with_matbaa',
    owner_role: 'printer',
    route: 'physical',
    // Both null: the round has just been asked for. Stamping delivered_at here
    // would tell the matbaa's queue the parça was already handed back.
    started_at: null,
    delivered_at: null,
  }
}

/** The matbaa marked this parça started. Stage-less: a flag, like demo_started. */
export function parcaStartPatch({ now }) {
  return { state: 'in_round', owner_role: 'printer', route: 'physical', started_at: now, delivered_at: null }
}

/**
 * The matbaa delivered this parça. It goes back to the gate — owner cleared,
 * because from here it is the leader's call again.
 */
export function parcaDeliverPatch({ now }) {
  return {
    state: 'pending',
    owner_role: null,
    route: null,
    started_at: null,
    delivered_at: now,
  }
}

/** The leader signed this parça off. Terminal until a new round reopens it. */
export function parcaApprovePatch() {
  return {
    state: 'approved',
    owner_role: null,
    route: null,
    started_at: null,
    delivered_at: null,
  }
}

/**
 * Is every parça signed off?
 *
 * This is the advance gate, and it reads the routing table rather than the
 * round's snapshot on purpose. The snapshot only knows what THIS round carried;
 * once a re-round can carry a single parça, gating on it would advance a project
 * whose other parçalar are still out with the designer. An empty list is not
 * "all approved" — it means no parça routing exists, and the caller should fall
 * back to the pre-074 whole-round behaviour.
 */
export function allParcalarApproved(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false
  return rows.every((r) => r?.state === 'approved')
}

/** The parçalar currently on one role's desk, for that role's queue. */
export function parcalarOwnedBy(rows, ownerRole) {
  return (rows ?? []).filter((r) => r?.owner_role === ownerRole).map((r) => r.parca)
}

/**
 * May this actor act on this parça right now?
 *
 * The leader is deliberately not listed: their action is approve/reject, gated
 * by `canRejectAt` / `canApproveAt` in transitions.js, and they act on parçalar
 * sitting at the gate rather than on ones they've handed away.
 */
export function canActOnParca(actor, row) {
  if (!actor || !row) return false
  if (actor.role === 'printer') {
    return row.owner_role === 'printer' && (row.state === 'with_matbaa' || row.state === 'in_round')
  }
  if (actor.role === 'designer') {
    return row.owner_role === 'designer' && row.state === 'with_designer'
  }
  return false
}
