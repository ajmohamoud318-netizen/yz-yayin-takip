/**
 * Deterministic UUID-shaped id from a string. The DB columns are real
 * `uuid` type, so non-UUID slugs like `u-ayse` no longer fit — this
 * hashes the slug into a UUID-shaped constant. Stable across runs.
 *
 * Not RFC 4122 (we don't ship a sha1 dep). Good enough for seed data.
 */
export function slugUuid(slug) {
  let h = 0x811c9dc5
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0')
  return `${hex}-0000-0000-0000-000000000000`
}