/**
 * Tests for `db/seed/users.js`.
 *
 * The interesting bit is the cost factor on `DEMO_PASSWORD_HASH`. The login
 * path in `src/routes/auth.js` hashes new passwords at cost 12; the seed
 * has to match so a freshly seeded account can authenticate through the
 * normal bcrypt.compareSync path at the same strength. A regression here
 * (someone bumping the cost back down for a "faster seed" without
 * realising the login path already runs at 12) would silently weaken
 * seeded credentials while leaving the login check happy.
 *
 * Note on the prefix: bcryptjs@2.4.3 emits `$2a$`, not `$2b$` — the two
 * are algorithmically interchangeable but the literal prefix differs.
 * The assertion below matches what the library actually produces.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'

import { DEMO_PASSWORD_HASH, SEED_USERS } from './users.js'
import { slugUuid } from './slug-uuid.js'

describe('seed users — DEMO_PASSWORD_HASH', () => {
  it('is hashed at bcrypt cost 12, matching the login path', () => {
    // The cost is the 4th and 5th characters of the prefix: `$2a$12$…`.
    assert.equal(DEMO_PASSWORD_HASH.slice(0, 7), '$2a$12$')
  })

  it('verifies against the demo password `123456`', () => {
    // Defence in depth: even if the prefix were ever spoofed, the hash
    // still has to round-trip through bcrypt.compareSync for the seed to
    // be usable.
    assert.equal(bcrypt.compareSync('123456', DEMO_PASSWORD_HASH), true)
  })
})

describe('seed users — SEED_USERS', () => {
  it('ships at least one user for each role the demo exercises', () => {
    // Roles aren't asserted strictly (the set may grow), but each of the
    // three non-leader roles must be represented so the demo isn't a
    // team_leader-only shell.
    const roles = new Set(SEED_USERS.map((u) => u.role))
    assert.ok(roles.has('team_leader'))
    assert.ok(roles.has('designer'))
    assert.ok(roles.has('printer'))
    assert.ok(roles.has('satis'))
  })

  it('uses stable, deterministic ids derived from slug-uuid', () => {
    // Re-importing slug-uuid and re-deriving ensures the seed file
    // hasn't accidentally drifted to a hand-typed uuid that won't match
    // other fixtures (test data, exported demo state, etc.).
    const expected = slugUuid('u-ayse')
    assert.equal(SEED_USERS[0].id, expected)
  })
})
