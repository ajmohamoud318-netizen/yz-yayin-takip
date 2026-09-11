/**
 * "Create now, assign later" — designers added after creation get the
 * assignment ping createProject would have sent them.
 *
 * notifyDesignersAssigned runs against a fake pg client; its two call sites
 * (PUT /projects/:id/subtasks and PATCH /projects/:id) are pinned at the
 * source level, same as the orphan-guard wiring tests.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { ASSIGNMENT_GREETINGS, notifyDesignersAssigned } from './notifications.js'

const subtasksRouteSrc = readFileSync(
  fileURLToPath(new URL('../routes/subtasks.js', import.meta.url)),
  'utf8',
)
const adminSrc = readFileSync(
  fileURLToPath(new URL('./project-service/admin.js', import.meta.url)),
  'utf8',
)

/** Minimal pg-client stand-in: records emitted rows and domain events. */
function fakeClient() {
  const rows = []
  const events = []
  return {
    rows,
    events,
    async query(sql, params) {
      if (sql.includes('INTO domain_events')) {
        events.push(params[0])
        return { rows: [{ id: 'ev-1', created_at: new Date() }] }
      }
      // emit()'s multi-row INSERT: 10 bound params per recipient.
      const prevCount = rows.length
      for (let i = 0; i < params.length; i += 10) {
        rows.push({ userId: params[i], type: params[i + 1], title: params[i + 2], body: params[i + 3] })
      }
      return { rows: rows.slice(prevCount).map((r, i) => ({ id: `n-${prevCount + i}`, user_id: r.userId })) }
    },
  }
}

describe('notifyDesignersAssigned', () => {
  it('greets each added designer with an assignment notification', async () => {
    const client = fakeClient()
    await notifyDesignersAssigned(client, {
      project: { id: 'p-1', title: 'KEÇEMİNO ÇİFTLİK' },
      actor: { id: 'u-ayse' },
      assignees: [{ id: 'u-aylin' }, { id: 'u-feyza' }],
    })
    assert.deepEqual(client.rows.map((r) => r.userId).sort(), ['u-aylin', 'u-feyza'])
    for (const r of client.rows) {
      assert.equal(r.type, 'assignment')
      assert.equal(r.title, 'KEÇEMİNO ÇİFTLİK')
      assert.ok(ASSIGNMENT_GREETINGS.includes(r.body), `not an assignment greeting: ${r.body}`)
    }
    assert.deepEqual(client.events, ['project.designers_assigned'])
  })

  it('writes nothing when nobody was added', async () => {
    const client = fakeClient()
    const written = await notifyDesignersAssigned(client, {
      project: { id: 'p-1', title: 'KEÇEMİNO ÇİFTLİK' },
      actor: { id: 'u-ayse' },
      assignees: [],
    })
    assert.equal(written, 0)
    assert.equal(client.rows.length, 0)
  })
})

describe('PUT /projects/:id/subtasks — greets designers the save adds', () => {
  it('diffs the roster from before the writes against the roster after them', () => {
    assert.match(
      subtasksRouteSrc,
      /const designersBefore = await loadProjectAssignees\(client, lockedProject\)/,
      'the pre-save roster must be read inside the tx, before the reconcile writes',
    )
    assert.match(
      subtasksRouteSrc,
      /loadProjectAssignees\(client, updated\)\)\s*\.filter\(\(a\) => !beforeIds\.has\(a\.id\)\)/,
      'only designers missing from the pre-save roster count as added',
    )
    assert.match(
      subtasksRouteSrc,
      /notifyDesignersAssigned\(client, \{\s*project: updated, actor: request\.user, assignees: addedDesigners,/,
    )
  })
})

describe('PATCH /projects/:id — greets a primary who is new to the project', () => {
  it('checks the pre-write roster and notifies only a newcomer', () => {
    const block = adminSrc.match(/export async function patchProjectFields[\s\S]*?\n\}/)
    assert.ok(block, 'patchProjectFields not found in admin.js')
    assert.match(block[0], /loadProjectAssignees\(client, before\)/)
    assert.match(block[0], /!rosterBefore\.some\(\(a\) => a\.id === newPrimary\)/)
    assert.match(block[0], /notifyDesignersAssigned\(client, \{ project: updated, actor, assignees: \[\{ id: newPrimary \}\] \}\)/)
  })
})
