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
