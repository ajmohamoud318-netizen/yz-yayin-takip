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

/**
 * Reject a save that declares an assignee list with at least one designer
 * who isn't on any subtask in the same payload. Mirrors the rule the SPA
 * expects: "listeye eklediğiniz her tasarımcı en az bir alt göreve
 * atanmalı" — same wording on create and edit.
 *
 * The check is intentionally lenient on three shapes that are NOT orphans:
 *
 *   1. declaredAssignees is empty or has a single id (the primary).
 *      One-designer projects don't need a check; zero is the deferred-
 *      assignment flow (the leader can fill it in later).
 *   2. Any subtask in the payload carries the ALL_DESIGNERS_SENTINEL.
 *      İç Sayfalar = "Tüm Tasarımcılar" IS the assignment for every
 *      project designer (the per-designer batch log credits each designer
 *      under their own row, so "shared" doesn't mean "shared credit" —
 *      just shared write access).
 *   3. The designer is the project primary (first id in declaredAssignees)
 *      OR owns a subtask in the payload — its own `assigned_to`, or the
 *      `subtaskAssignees` entry under its title or key (the same lookup
 *      chain createProject uses to store the override).
 *
 * Shared between `createProject` (admin.js) and PUT /projects/:id/subtasks
 * (routes/subtasks.js) so the two paths cannot drift apart. Either caller
 * passes the raw `subtasks` array straight from the wire — `{ title, kind }`
 * objects plus the side map on create, full subtask objects on edit.
 *
 * @param {string[]|null|undefined} declaredAssignees
 *   The full assignee list the leader submitted. null/undefined = "the
 *   leader didn't restate the list this save" → no check.
 * @param {Array<{title?:string, key?:string, assigned_to?:string}>} subtasks
 *   The subtasks in the same payload (wire shape; we only need title / key /
 *   assigned_to).
 * @param {Record<string,string>} subtaskAssignees
 *   The { [keyOrTitle]: designerIdOrSentinel } map from the same payload.
 */
export function assertNoOrphanDesigners(declaredAssignees, subtasks, subtaskAssignees) {
  if (!Array.isArray(declaredAssignees) || declaredAssignees.length <= 1) return
  const subAssigneeIds = new Set()
  const sentinels = new Set()
  for (const s of subtasks ?? []) {
    // Resolve each subtask's owner the way the save will store it: its own
    // `assigned_to` on edit, else the side-map entry under its title (or
    // key) on create. Only picks that land on a subtask count — walking the
    // whole map let an entry no subtask answers to (library key "kapak"
    // against the stored title "Kapak") pass the guard while createProject
    // dropped it, and the designer fell off the project.
    const owner = s?.assigned_to ?? subtaskAssignees?.[s?.title] ?? subtaskAssignees?.[s?.key]
    if (owner === ALL_DESIGNERS_SENTINEL) sentinels.add(pickSubtaskKey(s))
    else if (owner) subAssigneeIds.add(owner)
  }
  if (sentinels.size > 0) return
  // The first id is the project primary (PUT route's behaviour, mirrored
  // for createProject — primaryAssignee = assignees[0]).
  const primary = declaredAssignees[0]
  for (const id of declaredAssignees) {
    if (id === primary) continue
    if (subAssigneeIds.has(id)) continue
    throw new OrphanDesignerError(id)
  }
}

/**
 * Throw this when assertNoOrphanDesigners finds an unassigned designer.
 * Routes catch it via the shared error mapper and surface it as a 400
 * with the leader-friendly Turkish wording that PUT /projects/:id/subtasks
 * already speaks.
 */
export class OrphanDesignerError extends Error {
  constructor(designerId) {
    super(
      `Tasarımcı atanmamış: ${designerId}. Listeye eklediğiniz her tasarımcı en az bir alt göreve atanmalı.`,
    )
    this.name = 'OrphanDesignerError'
    this.designerId = designerId
  }
}

/**
 * The subtask's lookup key for the subtaskAssignees map: prefer the
 * library key (e.g. "sayfalar") when present, else fall back to the
 * subtask's free-text title. createProject accepts both, so the orphan
 * helper has to walk both too — otherwise a leader who only sends
 * subtaskAssignees keyed by the library key would slip past the check
 * on edit-shaped payloads (where the subtask carries `key`).
 */
function pickSubtaskKey(s) {
  if (!s) return ''
  return s.key || s.title || ''
}
