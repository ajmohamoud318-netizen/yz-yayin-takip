/**
 * Order-insensitive equality for JSON-shaped values.
 *
 * The orchestrators in `project-service.js` and `orders-service.js` use
 * `changedFields(before, entity)` to decide which columns need writing. The
 * equality check used `JSON.stringify(prev) === JSON.stringify(next)`, which
 * is order-sensitive on both axes — object key insertion order and array
 * element order. So `[{id:'L1'}, {id:'D1'}]` and `[{id:'D1'}, {id:'L1'}]`
 * stringified differently, and an entity call that walked an approval ledger
 * in a different order than the DB had it produced a phantom diff.
 *
 * The phantom diff was harmless before the optimistic-concurrency SQL guard
 * landed: a `WHERE version = $expectedVersion` matched the unchanged row,
 * the write went through, the next read saw the same data, nobody noticed.
 * After the guard, the SAME phantom diff writes back an unchanged column,
 * any concurrent writer that bumped the row in the gap trips the guard with
 * a 409, and the SPA surfaces "Bu kayıt başka biri tarafından güncellendi.
 * Sayfayı yenileyin." for a no-op approve. The fix is to compare
 * semantically, not by stringification order.
 *
 * `canonicalise` produces a deterministic, order-insensitive representation:
 *   - plain object keys are sorted alphabetically (recursively),
 *   - arrays are sorted before their entries are canonicalised:
 *       * by `.id` if every entry is a plain object with an `id` key,
 *       * else by their `JSON.stringify` (so `['D1', 'D2']` and `['D2', 'D1']`
 *         compare equal, and nested arrays of objects without `id` still
 *         canonicalise).
 *   - everything else (numbers, strings, booleans, null) is left untouched.
 *
 * Two values are deep-equal when `JSON.stringify(canonicalise(a)) === JSON.stringify(canonicalise(b))`.
 * The helper stays under 12 lines by design — `lodash.isEqual` etc. would do
 * the same job but a one-off canonicalise is easier to audit and avoids a
 * third-party dep just for the diff's edge case.
 */
export function canonicalise(value) {
  if (Array.isArray(value)) {
    const idKey = (item) => (
      item && typeof item === 'object' && 'id' in item ? item.id : JSON.stringify(item)
    )
    return value.slice().sort((a, b) => {
      const ak = String(idKey(a))
      const bk = String(idKey(b))
      return ak < bk ? -1 : ak > bk ? 1 : 0
    }).map(canonicalise)
  }
  if (value && typeof value === 'object') {
    const sorted = {}
    for (const k of Object.keys(value).sort()) sorted[k] = canonicalise(value[k])
    return sorted
  }
  return value
}