// Per-user "seen assignment" tracking.
//
// Backed by localStorage so that:
//   - once a designer acknowledges their backlog, refreshing doesn't re-show it
//   - mid-session store ticks (polling, project updates) don't re-fire toasts
//   - cross-tab / cross-session behaviour is stable: dismissed = dismissed
//
// Previously lived inside UnreadAssignmentsToast.jsx; moved here so both the
// toast (if reintroduced) and the bell's inline "unread assignments" card can
// share the same seen-set. All access goes through these helpers so the
// storage key is in exactly one place.

export const SEEN_ASSIGNMENTS_KEY = (userId) => `yz_seen_assignments_${userId}`

export function loadSeen(userId) {
  if (!userId || typeof localStorage === 'undefined') return new Set()
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_ASSIGNMENTS_KEY(userId)) || '[]'))
  } catch {
    return new Set()
  }
}

export function persistSeen(userId, ids) {
  if (!userId || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SEEN_ASSIGNMENTS_KEY(userId), JSON.stringify([...ids]))
  } catch {
    /* storage unavailable — fail silently */
  }
}

export function addSeen(userId, ids) {
  if (!userId || typeof localStorage === 'undefined') return new Set()
  const fresh = loadSeen(userId)
  for (const id of ids) fresh.add(id)
  persistSeen(userId, fresh)
  return fresh
}