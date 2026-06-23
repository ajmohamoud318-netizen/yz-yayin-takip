/** Progress % = completed subtasks / total subtasks × 100. */
export function subtaskProgress(subs) {
  if (!Array.isArray(subs) || subs.length === 0) return 0
  const done = subs.filter((s) => s.is_done).length
  return Math.round((done / subs.length) * 100)
}
