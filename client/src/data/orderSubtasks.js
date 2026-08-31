import api from '@/api'

/**
 * The designer's Revize flags on a sipariş's own alt görevler — split out of
 * TalepSignDialog.jsx (slice: client god-components).
 */

// Per-subtask fields PATCH /api/order-requests/:orderId/subtasks/:id accepts
// from the designer.
const SUBTASK_PATCH_FIELDS = ['needs_revize', 'is_done', 'pages_done', 'stickers_done']

/**
 * Persist the designer's Revize flags by PATCHing only the rows that actually
 * changed.
 *
 * These are `order_subtasks` rows — this order's own snapshot of the
 * project's alt görevler (migration 039), not the shared `subtasks` table —
 * so two concurrent orders on the same project never see or overwrite each
 * other's rework tracking.
 *
 * This deliberately does NOT use `PUT /projects/:id/subtasks`. That endpoint
 * replaces the whole list and belongs to the team leader, who owns the list's
 * SHAPE (titles, kinds, totals, assignment). Sending this dialog's rows there
 * failed three ways: the rows carry server-side fields (`id`, `position`,
 * `assigned_name`, timestamps) that its additionalProperties:false schema
 * rejects with a 400; the route is team_leader-only, so a designer got a 403;
 * and it never persisted `needs_revize` anyway — the one field this editor
 * exists to set. The net effect was that a designer who touched alt görevler
 * could not sign at all, while their ürün bilgileri edit (saved just above)
 * had already gone through.
 */
export async function saveSubtaskFlags(orderId, subtasks, originalJson) {
  const before = new Map(JSON.parse(originalJson).map((s) => [s.id, s]))
  for (const s of subtasks) {
    const prev = before.get(s.id)
    // Rows with no id were never persisted; the list shape is the leader's to
    // change, so this dialog only ever updates existing subtasks.
    if (!s.id || !prev) continue
    const patch = {}
    for (const f of SUBTASK_PATCH_FIELDS) {
      if (s[f] === prev[f]) continue
      // `pages_done`/`stickers_done` are integers server-side; a null (a
      // counter that was never started) is not a value the schema accepts.
      if (f === 'pages_done' || f === 'stickers_done') {
        if (!Number.isFinite(s[f])) continue
      }
      patch[f] = s[f]
    }
    if (Object.keys(patch).length > 0) await api.updateOrderSubtask(orderId, s.id, patch)
  }
}
