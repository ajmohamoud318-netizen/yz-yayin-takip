/**
 * The per-parça approval LEDGER — pure, pipeline-agnostic.
 *
 * Migrations 068/069/070 gave the project's demo, ozalit and baskı gates a
 * per-parça ledger each. Migration 080 gave the sipariş its own copies of the
 * ozalit and baskı ones, because a reprint runs the same gates: the matbaa
 * produces a proof per parça, the leader signs each one off, a designer
 * counter-signs the physical ones, and baskı onayı is a maker-checker per
 * parça.
 *
 * Every function here was lifted verbatim out of `transitions.js`, where it
 * was module-private and implicitly about `projects`. Nothing about the rules
 * is project-specific — they operate on a ledger, a parça list and a required
 * set — so both pipelines now call the SAME code rather than each holding a
 * copy.
 *
 * That is not tidiness. The sipariş is meant to behave exactly as the project
 * does, and "exactly" written as two copies is a promise that decays: this
 * codebase has already paid for that twice, once when the order notification
 * tables kept pre-rename status keys after the FSM moved on, and once when the
 * matbaa's sipariş queue kept a flat label after the project queue learned four
 * states. A shared function cannot drift from itself.
 *
 * LEDGER SHAPES — two, and they are not interchangeable:
 *
 *   ozalit-shaped   { '<parca>': [ { id, role, name, at, via }, ... ] }
 *                   Multi-party: a parça is done when every required party
 *                   appears. Used by ozalit on both pipelines.
 *
 *   demo-shaped     [ { parca, by, by_name, at, via }, ... ]
 *                   A flat list. Used by the demo gate, which the sipariş has
 *                   no equivalent of — kept here because the ekran helpers
 *                   below are shared with it.
 *
 *   baskı-shaped    { '<parca>': { by, by_name, at } }
 *                   One row per parça per side (preparer / approver). Not
 *                   multi-party: the rule is that the two rows must name
 *                   DIFFERENT people.
 *
 * `via` marks HOW a sign-off happened, and it carries real weight: an Ekran
 * round has no physical proof and no matbaa leg, so the designer who asked for
 * it does not also counter-sign it — their request IS their sign-off. The
 * completion check for an ekran parça therefore looks for `via: 'ekran'`
 * specifically, not for the full required set. See `ekranPendingParcalar`.
 */

/** The rows recorded against one parça in an ozalit-shaped ledger. */
export function parcaApprovedBy(ledger, parca) {
  const rows = (ledger ?? {})[parca]
  return Array.isArray(rows) ? rows : []
}

/**
 * Which parçalar haven't yet collected EVERY required party (ozalit-shaped).
 *
 * An empty required set means nothing can be satisfied, so everything is
 * pending — the caller is expected to have loaded the active leader/designer
 * sets before asking.
 */
export function pendingParcalar(ledger, parcalar, requiredIds) {
  const required = new Set(requiredIds ?? [])
  return (parcalar ?? []).filter((parca) => {
    if (required.size === 0) return true
    const got = new Set(parcaApprovedBy(ledger, parca).map((a) => a?.id))
    for (const id of required) if (!got.has(id)) return true
    return false
  })
}

/**
 * Which parçalar haven't been EKRAN-approved yet (ozalit-shaped).
 *
 * Deliberately not `pendingParcalar` with a one-element required set. An ekran
 * round is leader-only by rule, and the leader who signs it may be any of
 * several — so the question is "has anyone signed this via ekran", not "has
 * this specific set signed". Matching on `via` is what encodes "the designer's
 * approval is not required for a parça they sent to screen".
 */
export function ekranPendingParcalar(ledger, parcalar) {
  const approved = new Set(
    Object.entries(ledger ?? {})
      .filter(([, rows]) => Array.isArray(rows) && rows.some((a) => a?.via === 'ekran'))
      .map(([parca]) => parca),
  )
  return (parcalar ?? []).filter((p) => !approved.has(p))
}

/**
 * Which parçalar are not yet cleared through a baskı-shaped maker-checker
 * ledger — missing a preparer, missing an approver, or carrying the same
 * person on both sides.
 *
 * The "same person" case is the whole point of the gate, and it is a PENDING
 * state rather than an error: the sheet is prepared and simply awaits a
 * different leader. The lone-active-leader escape hatch lives at the call
 * site, not here — this function answers what the ledger says, not who is
 * available to change it.
 */
export function baskiPendingParcalar(preparers, approvals, parcalar) {
  const prep = preparers ?? {}
  const appr = approvals ?? {}
  return (parcalar ?? []).filter((parca) => {
    if (!prep[parca]) return true
    if (!appr[parca]) return true
    return appr[parca].by === prep[parca].by
  })
}

/** Approve parçalar in an ozalit-shaped ledger. */
export function appendOzalitParcaApprovals(ledger, parcalar, actor, actorName, now, via = null) {
  const next = ledger && typeof ledger === 'object' ? { ...ledger } : {}
  for (const parca of parcalar) {
    const list = Array.isArray(next[parca]) ? [...next[parca]] : []
    // Same approver, same route → already counted. `via` is part of the
    // identity: a leader who signed a parça on screen and later signs the
    // physical reprint of it has genuinely done two different things.
    if (list.some((a) => a?.id === actor?.id && a?.via === via)) continue
    list.push({ id: actor?.id ?? null, role: actor?.role ?? null, name: actorName, at: now, via })
    next[parca] = list
  }
  return next
}

/** Approve parçalar in a demo-shaped (flat list) ledger. */
export function appendParcaApprovals(ledger, parcalar, actor, actorName, now, via = null) {
  const list = Array.isArray(ledger) ? [...ledger] : []
  for (const parca of parcalar) {
    // Skip if this exact approver already signed this parça (no double-stamping).
    if (list.some((a) => a?.parca === parca && a?.by === actor?.id && a?.via === via)) continue
    list.push({ parca, by: actor?.id ?? null, by_name: actorName, at: now, via })
  }
  return list
}

/** Record a single leader-side per-parça row (preparer OR approver). */
export function appendBaskiParcaRow(ledger, parcalar, actor, actorName, now) {
  const next = ledger && typeof ledger === 'object' ? { ...ledger } : {}
  for (const parca of parcalar) {
    next[parca] = { by: actor?.id ?? null, by_name: actorName, at: now }
  }
  return next
}

/** Record per-parça rejections (list of { parca, by, by_name, at, reason, target }). */
export function appendParcaRejections(ledger, parcalar, actor, actorName, now, reason, target) {
  const list = Array.isArray(ledger) ? [...ledger] : []
  for (const parca of parcalar) {
    list.push({
      parca,
      by: actor?.id ?? null,
      by_name: actorName,
      at: now,
      reason: reason ?? null,
      target: target ?? null,
    })
  }
  return list
}

/**
 * Is a designer allowed to sign yet? Leader-first, per parça.
 *
 * The ozalit is the leadership's call and a designer only counter-signs a
 * proof a team leader has already accepted. Scoped to the round rather than to
 * one parça on purpose: the project-side rule asks whether SOME parça has a
 * leader sign-off, which is what lets a leader work down a multi-parça sheet
 * while the designer follows behind.
 */
export function anyLeaderSigned(ledger, parcalar, teamLeaderIds) {
  const leaders = new Set(teamLeaderIds ?? [])
  return (parcalar ?? []).some((parca) =>
    parcaApprovedBy(ledger, parca).some(
      (a) => a?.role === 'team_leader' || leaders.has(a?.id),
    ),
  )
}
