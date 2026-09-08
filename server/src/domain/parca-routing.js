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
    // A new round owes no correction: whatever an accepted change request
    // left behind died with the round it belonged to.
    fix_pending: false,
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
      fix_pending: false,
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
    // See parcaRejectPatch — a fresh round carries no correction debt.
    fix_pending: false,
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

/* ============================================================================
 *  The change-request handshake, per parça (migration 077)
 *
 *  Correcting a sheet the matbaa holds has two modes, and `started_at` picks
 *  which: an unstarted parça is edited outright, a started one has to be ASKED
 *  for. These are that ask, scoped to one parça — the exact shape of
 *  computeDemoChangeRequest / Accept / Decline in domain/transitions.js, which
 *  own the same handshake for a round that was never split.
 *
 *      started_at set ──ask──► change_requested_at set
 *                                    │
 *                    ┌──accept───────┴──────decline──┐
 *                    ▼                               ▼
 *        fix_pending, started_at cleared      still in_round,
 *        (leader owes the correction;         leader waits for delivery
 *         matbaa may not re-start)
 * ========================================================================== */

/**
 * Is this parça locked against a silent edit?
 *
 * The matbaa is producing it right now, and nobody accepted a change. A row
 * that does not exist is NOT locked: rows are materialised on first action
 * (`loadParcaForUpdate`), so "no row" means the matbaa has not touched this
 * parça at all — the free-edit window the leader has always had.
 *
 * `fix_pending` unlocks deliberately. An accepted request un-starts the parça
 * precisely so the correction can land; that is the whole point of accepting.
 */
export function parcaEditLocked(row) {
  if (!row) return false
  return !!row.started_at && !row.fix_pending
}

/**
 * May the leader ask the matbaa to release this parça?
 *
 * Only one pending ask at a time (no stacking — same rule as the project-level
 * request), and there is nothing to ask for on a parça that is already unlocked:
 * unstarted means edit it, `fix_pending` means the release already happened.
 */
export function parcaChangeRequestable(row) {
  return parcaEditLocked(row) && !row.change_requested_at
}

/** The parça names in `rows` that a sheet-wide edit would be rewriting behind the matbaa's back. */
export function lockedParcaNames(rows) {
  return (rows ?? []).filter(parcaEditLocked).map((r) => r.parca).filter(Boolean)
}

/**
 * The leader asked. The parça does not move — the matbaa keeps it and keeps
 * working; this only records the question, exactly as the project-level
 * request leaves `demo_started` alone.
 *
 * `started_at` is restated because `upsertParcaState` writes it verbatim: a
 * patch that omitted it would clear the very "they have started" fact the
 * request exists because of.
 */
export function parcaChangeRequestPatch({ note, actor, actorName, now, startedAt = null }) {
  return {
    // Restated for the same reason `started_at` is, and it bites harder:
    // `upsertParcaState` writes owner_role and route VERBATIM (a parça
    // returning to the gate has to be able to clear them), so a patch that
    // omits them hands the row to nobody. That drops it out of
    // `listParcaStateByOwner('printer')` — and `deriveTeslimParcalar` then
    // rebuilds a synthetic card from the round's snapshot with no
    // change-request fields on it, so the matbaa is shown an ordinary
    // "Teslim Edin" and never sees the question at all.
    owner_role: 'printer',
    route: 'physical',
    started_at: startedAt,
    change_requested_at: now,
    change_requested_by: actor?.id ?? null,
    change_requested_by_name: actorName ?? null,
    change_requested_note: note?.trim() || null,
  }
}

/**
 * The matbaa accepted. This un-starts the parça — back to `with_matbaa`, the
 * state it held before "İşlemi Başlatın" — which is what reopens the free-edit
 * path for the leader.
 *
 * `fix_pending` is the debt that comes with it: the matbaa may not re-start
 * until the correction lands (`startParca`'s guard), so an accept cannot be
 * quietly undone by pressing the button again.
 */
export function parcaChangeAcceptPatch() {
  return {
    state: 'with_matbaa',
    owner_role: 'printer',
    route: 'physical',
    started_at: null,
    delivered_at: null,
    fix_pending: true,
    change_requested_at: null,
    change_requested_by: null,
    change_requested_by_name: null,
    change_requested_note: null,
  }
}

/**
 * The matbaa declined. Only the question is cleared: the parça stays started,
 * stays theirs, and the leader waits for the delivery and decides at the gate —
 * the same dead end `computeDemoChangeDecline` leaves.
 *
 * `startedAt` is passed back for the verbatim-write reason above.
 */
export function parcaChangeDeclinePatch({ startedAt }) {
  return {
    // See parcaChangeRequestPatch — declining leaves the parça exactly where
    // it was, so the owner has to be restated or the row leaves their queue.
    owner_role: 'printer',
    route: 'physical',
    started_at: startedAt,
    change_requested_at: null,
    change_requested_by: null,
    change_requested_by_name: null,
    change_requested_note: null,
  }
}

/**
 * The leader's correction landed — the debt an accept created is settled.
 *
 * Applied to every parça on the edited sheet, not just the ones that owed a
 * fix: a no-op on a row that was already false, exactly as computeDemoEdit
 * always includes `demo_fix_pending: false`.
 *
 * It takes the row because it is a pure flag-clear, and `upsertParcaState`
 * writes the round stamps verbatim — a patch carrying only the flag would
 * erase the very round it is settling. Restating them keeps the clear surgical.
 */
export function parcaFixSettledPatch(row) {
  return {
    fix_pending: false,
    // Echoed for the same reason the stamps below are, and it is the same trap
    // parcaChangeRequestPatch documents: owner_role and route are written
    // VERBATIM, so a pure flag-clear that omits them hands the parça to nobody
    // — and the matbaa's very next "İşlemi Başlatın" is refused with "Bu parça
    // sizde değil" on a parça that is unmistakably theirs.
    owner_role: row?.owner_role ?? null,
    route: row?.route ?? null,
    started_at: row?.started_at ?? null,
    delivered_at: row?.delivered_at ?? null,
    received_at: row?.received_at ?? null,
    received_by: row?.received_by ?? null,
    received_by_name: row?.received_by_name ?? null,
  }
}

/**
 * The leader took delivery of this parça (migration 076).
 *
 * The per-parça twin of `computeDemoReceive` / `computeOzalitReceive`: nothing
 * may be approved or rejected until somebody confirms the proof physically
 * arrived, and with parçalar delivered one at a time that confirmation has to
 * be per parça too.
 *
 * The parça does not move — it was already at the gate and it stays there;
 * this only records the receipt. `deliveredAt` is passed back in because
 * `upsertParcaState` writes the two delivery stamps verbatim, so a patch that
 * omitted it would erase the very delivery being acknowledged.
 */
export function parcaReceivePatch({ actor, actorName, now, deliveredAt = null }) {
  return {
    state: 'pending',
    owner_role: null,
    route: null,
    started_at: null,
    delivered_at: deliveredAt,
    received_at: now,
    received_by: actor?.id ?? null,
    received_by_name: actorName ?? null,
  }
}

/**
 * Has this parça already been handed back this round?
 *
 * The idempotency test for "Teslim Edin", and it cannot be asked of
 * `canActOnParca`: delivering CLEARS `owner_role` (the parça is at the gate,
 * on nobody's desk), so a repeat of the same click reads as "not yours" —
 * which is how a printer who tapped twice, or tapped once against a queue that
 * had not refetched, was told "Bu parça sizde değil." about a parça they had
 * just delivered successfully.
 *
 * `delivered_at` alone is not enough: a reject clears it (`parcaRejectPatch`)
 * precisely so the next round can be delivered again, and a parça back with
 * the matbaa on a new round must NOT short-circuit. Both halves together mean
 * "at the gate, already arrived".
 */
export function parcaAlreadyDelivered(row) {
  return !!row && row.state === 'pending' && !!row.delivered_at
}

/**
 * Is this parça waiting for the leader's "Teslim Alın"?
 *
 * Delivered by the matbaa, sitting at the gate, nobody has acknowledged it yet.
 * An ekran round never satisfies this: it has no physical proof to receive
 * (`delivered_at` stays null), and the server refuses the acknowledgment for
 * the same reason the project-level one does.
 */
export function parcaAwaitsReceipt(row) {
  return !!row && row.state === 'pending' && !!row.delivered_at && !row.received_at
}

/**
 * May this parça be signed off on its own, before the round is complete?
 *
 * The receipt is the whole gate: it says a real proof is in the leader's hands.
 * A parça still with the matbaa or the designer is not theirs to decide, and an
 * unreceived delivery is the same refusal `computeApproval` makes at the *_onay
 * gate — you cannot approve what you have not taken delivery of.
 */
export function parcaDecidable(row) {
  return !!row && row.state === 'pending' && !!row.delivered_at && !!row.received_at
}

/** The leader signed this parça off. Terminal until a new round reopens it. */
export function parcaApprovePatch() {
  return {
    state: 'approved',
    owner_role: null,
    route: null,
    started_at: null,
    delivered_at: null,
    // See parcaRejectPatch — the round is over either way, and a signed-off
    // parça that still owed a correction would block its next start.
    fix_pending: false,
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
