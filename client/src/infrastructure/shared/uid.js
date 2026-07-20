// Collision-safe id generator for client-side history entries the server
// doesn't assign ids for (order history rows, optimistic-concurrency
// caches, etc.).
//
// Bare `Date.now()` collides when two records are created within the same
// millisecond — easy to hit with rapid actions (e.g. approving/rejecting or
// appending several history entries back-to-back). Appending a per-process
// monotonic sequence to the timestamp guarantees uniqueness while keeping the
// caller's prefix intact so any prefix-based conventions still hold.
let __seq = 0

export function uid(prefix = '') {
  __seq = (__seq + 1) % 0xffffff
  return `${prefix}${Date.now().toString(36)}-${__seq.toString(36)}`
}
