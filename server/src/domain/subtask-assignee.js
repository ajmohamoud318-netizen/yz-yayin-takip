/**
 * Shared contract for the SPA's "Tüm Tasarımcılar" option on the İç Sayfalar
 * subtask picker.
 *
 * The SPA sends this sentinel across the wire (in `subtaskAssignees[key]`
 * for POST /projects, and in each subtask's `assigned_to` field for
 * PUT /projects/:id/subtasks) whenever the team leader picks "Tüm
 * Tasarımcılar" for the İç Sayfalar row. Both server paths call
 * `unwrapAssignee` before writing to the database so the sentinel is
 * converted to a real NULL `assigned_to`, which is what the schema and
 * the rest of the domain treat as "no primary owner — any project
 * designer can log pages via subtask_designer_batches".
 *
 * The sentinel is a plain string ("__all__") on purpose: it survives the
 * SPA's http-project.repository filter (which strips empty / non-string
 * values), and it passes the projectsCreate schema's minLength: 1
 * constraint without needing an extra `type: 'null'` allowance. The only
 * place that MUST know to convert it back to null is the server, because
 * inserting the literal string would fail the users(id) FK constraint.
 *
 * Kept in the domain layer (not services) because both the createProject
 * service and the PUT /projects/:id/subtasks route are consumers, and a
 * neutral module avoids a service-to-route import.
 */
export const ALL_DESIGNERS_SENTINEL = '__all__'

/**
 * Convert the SPA's "Tüm Tasarımcılar" sentinel to a real null, otherwise
 * return the input unchanged. Safe to call with `undefined` (returns
 * `undefined`) so callers can chain it into their existing `??` fallback
 * pipelines without adding a null check.
 *
 * @param {string|null|undefined} value
 * @returns {string|null|undefined}
 */
export function unwrapAssignee(value) {
  return value === ALL_DESIGNERS_SENTINEL ? null : value
}
