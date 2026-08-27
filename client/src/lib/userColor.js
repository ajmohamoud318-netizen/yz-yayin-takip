/**
 * Deterministic color per user id. The same designer always gets the same
 * color across every page and every project, so the team leader learns
 * "blue = Aylin" once and reads every chip grid the same way.
 *
 * Two outputs:
 *   userColor(id)         → hex string, for borders / dots / solid fills
 *   colorTint(hex, alpha) → rgba(), for chip backgrounds (text stays
 *                           legible on the tinted background)
 *
 * 8-color palette because the team rarely runs more designers than that
 * on one project at a time; cycles beyond that, which the legend on the
 * chip grid handles ("● X (4)" makes the duplicate obvious).
 *
 * Hash is a tiny djb2-style loop — collision-free for short user ids,
 * deterministic across browsers (no Math.random), zero deps.
 */

const PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
]

function hashId(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function userColor(userId) {
  if (!userId) return null
  return PALETTE[hashId(userId) % PALETTE.length]
}

export function colorTint(hex, alpha = 0.14) {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return null
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Resolve a designer id into a tiny descriptor the chip-grid popover needs:
 *   { name, color, colorTint }
 *
 * `designers` is the in-memory roster from `api.listUsers()` — `{ id, name,
 * role, is_active, avatar_url, avatar_updated_at }` per row. We look up by id
 * so the popover can render the designer's name + colored ring without a
 * second round trip, and so the avatar ring colour matches the chip border
 * the assignment will produce (`userColor(id)` is the same function either
 * side, by construction).
 *
 * Returns null for an unknown id — the popover treats that as "this is who
 * the chip currently points at but they're not in the active roster any
 * more" and renders the row as muted without crashing the picker.
 */
export function designerColor(designerId, designers = []) {
  if (!designerId) return null
  const d = designers.find((x) => x.id === designerId)
  if (!d) return null
  const color = userColor(designerId)
  return {
    id: designerId,
    name: d.name ?? null,
    role: d.role ?? 'designer',
    avatar_url: d.avatar_url ?? null,
    avatar_updated_at: d.avatar_updated_at ?? null,
    color,
    colorTint: colorTint(color),
  }
}
