/**
 * Tests for the assignee-loading helpers in project-repository.js.
 *
 * Locks in the fix for the "edit dialog only shows the project primary"
 * bug: loadProjectAssignees now returns the union of `assigned_to` plus
 * every distinct per-subtask `assigned_to`, in stable order. The list
 * endpoint already does this merge; the detail endpoint (which feeds
 * the edit dialog's prefill) used to drop the subtask designers.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loadProjectAssignees } from './project-repository.js'

// Minimal in-memory pg client: each query() is matched on the WHERE clause
// fragment so the same client can serve both the primary lookup and the
// subtask scan. Order of expected calls isn't asserted — only that the
// final returned `assignees` array is correct.
function makeFakeClient({ primaryUser, subtaskUsers }) {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.trim(), params })
      if (/FROM users WHERE id = \$1/.test(sql)) {
        return primaryUser ? { rows: [primaryUser] } : { rows: [] }
      }
      if (/FROM subtasks s/.test(sql)) {
        return { rows: subtaskUsers }
      }
      return { rows: [] }
    },
  }
}

const rahsan = { id: 'u-rahsan', name: 'Rahşan Tuncer' }
const aylin = { id: 'u-aylin', name: 'Aylin Ulu' }
const abdijibar = { id: 'u-abdijibar', name: 'Abdijibar Abdiaziiz' }

describe('loadProjectAssignees', () => {
  it('returns the project primary plus every distinct subtask designer (merged)', async () => {
    const project = { id: 'p-1', assigned_to: abdijibar.id }
    const client = makeFakeClient({
      primaryUser: abdijibar,
      subtaskUsers: [
        { assigned_to: rahsan.id, assignee_name: rahsan.name },
        { assigned_to: aylin.id, assignee_name: aylin.name },
        { assigned_to: abdijibar.id, assignee_name: abdijibar.name }, // duplicate of primary
      ],
    })
    const assignees = await loadProjectAssignees(client, project)
    assert.deepEqual(
      assignees.map((a) => a.id),
      [abdijibar.id, rahsan.id, aylin.id],
      'primary first, then per-subtask designers, deduped',
    )
    assert.deepEqual(
      assignees.map((a) => a.name),
      [abdijibar.name, rahsan.name, aylin.name],
    )
  })

  it('returns just the primary when no subtask has a designer override', async () => {
    const project = { id: 'p-2', assigned_to: rahsan.id }
    const client = makeFakeClient({
      primaryUser: rahsan,
      subtaskUsers: [],
    })
    const assignees = await loadProjectAssignees(client, project)
    assert.deepEqual(assignees, [{ id: rahsan.id, name: rahsan.name }])
  })

  it('returns per-subtask designers even when the project has no primary', async () => {
    // Edge case: project was created without a primary `assigned_to` but
    // per-subtask designers still exist. The detail endpoint must surface
    // them so the edit dialog can pre-fill.
    const project = { id: 'p-3', assigned_to: null }
    const client = makeFakeClient({
      primaryUser: null,
      subtaskUsers: [
        { assigned_to: aylin.id, assignee_name: aylin.name },
      ],
    })
    const assignees = await loadProjectAssignees(client, project)
    assert.deepEqual(assignees, [{ id: aylin.id, name: aylin.name }])
  })

  it('returns [] when there is no primary and no subtask designers', async () => {
    const project = { id: 'p-4', assigned_to: null }
    const client = makeFakeClient({ primaryUser: null, subtaskUsers: [] })
    const assignees = await loadProjectAssignees(client, project)
    assert.deepEqual(assignees, [])
  })

  it('returns [] when the project row has no id (defensive)', async () => {
    // Some legacy callers may hand in a row without an id. We should
    // return an empty list rather than crashing on a missing projectId.
    const project = { assigned_to: rahsan.id } // no id, no project_id
    const client = makeFakeClient({ primaryUser: rahsan, subtaskUsers: [] })
    // The function should still resolve the primary but skip the subtask
    // scan — and importantly, must not throw a TypeError on null params.
    const assignees = await loadProjectAssignees(client, project)
    assert.deepEqual(assignees, [{ id: rahsan.id, name: rahsan.name }])
  })
})

// Locks in the fix for the "history shows the user icon but no name"
// bug. Before 014, `listProjectHistory` only SELECTed `done_by` (the FK
// id) and the frontend rendered `h.done_by_name` as null. The new query
// LEFT JOINs `users` so every row carries the actor's name. We also
// check the new `event` column is selected so the React timeline can
// switch on it instead of the coarser `action`.
import { listProjectHistory } from './project-repository.js'

// The real `listProjectHistory` runs a single LEFT JOIN against users and
// the DB returns rows already containing `done_by_name`. The fake client
// simulates that by mapping `done_by` → `users.name` on the way out and
// applying the same `ORDER BY created_at, id` the production query uses.
function makeHistoryClient({ historyRows, usersById }) {
  return {
    async query(sql, params) {
      if (/FROM stage_history h/.test(sql)) {
        const rows = historyRows
          .filter((r) => r.project_id === params[0])
          .map((r) => ({
            ...r,
            done_by_name: r.done_by ? usersById[r.done_by]?.name ?? null : null,
          }))
          .sort((a, b) => {
            const ta = new Date(a.created_at).getTime()
            const tb = new Date(b.created_at).getTime()
            if (ta !== tb) return ta - tb
            return (a.id ?? '').localeCompare(b.id ?? '')
          })
        return { rows }
      }
      return { rows: [] }
    },
  }
}

describe('listProjectHistory', () => {
  it('returns rows with join-resolved done_by_name and event column', async () => {
    // Realistic feed: create + advance + system(subtask) entries.
    const historyRows = [
      {
        id: 'h-1',
        project_id: 'p-1',
        from_stage: null,
        to_stage: 'tasarim',
        action: 'create',
        event: 'project_created',
        reason: null,
        reject_target: null,
        pass_number: 1,
        done_by: abdijibar.id,
        note: 'Proje oluşturuldu',
        created_at: new Date('2025-01-01T10:00:00Z'),
      },
      {
        id: 'h-2',
        project_id: 'p-1',
        from_stage: 'tasarim',
        to_stage: 'tasarim',
        action: 'system',
        event: 'subtask_done',
        reason: null,
        reject_target: null,
        pass_number: 1,
        done_by: rahsan.id,
        note: 'Kapak — tamamlandı',
        created_at: new Date('2025-01-02T11:00:00Z'),
      },
      {
        id: 'h-3',
        project_id: 'p-1',
        from_stage: 'tasarim',
        to_stage: 'tasarim',
        action: 'system',
        event: 'handover_request',
        reason: null,
        reject_target: null,
        pass_number: 1,
        done_by: null, // User-initiated system event with no actor
        note: 'Teslim talebi oluşturuldu',
        created_at: new Date('2025-01-03T12:00:00Z'),
      },
    ]
    const usersById = {
      [abdijibar.id]: abdijibar,
      [rahsan.id]: rahsan,
    }
    const client = makeHistoryClient({ historyRows, usersById })
    const rows = await listProjectHistory(client, 'p-1')
    assert.equal(rows.length, 3)
    assert.equal(rows[0].event, 'project_created')
    assert.equal(rows[0].done_by_name, abdijibar.name)
    assert.equal(rows[1].event, 'subtask_done')
    assert.equal(rows[1].done_by_name, rahsan.name)
    // rows with done_by=null should still come back (LEFT JOIN) with
    // done_by_name = null — the frontend shows 'Bilinmeyen' for those.
    assert.equal(rows[2].done_by, null)
    assert.equal(rows[2].done_by_name, null)
  })

  it('orders by created_at ascending so the timeline reads top-to-bottom', async () => {
    const historyRows = [
      { id: 'h-2', project_id: 'p-1', from_stage: 'tasarim', to_stage: 'demo_teslim',
        action: 'advance', event: 'general', reason: null, reject_target: null,
        pass_number: 1, done_by: abdijibar.id, note: null,
        created_at: new Date('2025-01-02T10:00:00Z') },
      { id: 'h-1', project_id: 'p-1', from_stage: null, to_stage: 'tasarim',
        action: 'create', event: 'project_created', reason: null, reject_target: null,
        pass_number: 1, done_by: abdijibar.id, note: null,
        created_at: new Date('2025-01-01T10:00:00Z') },
    ]
    const usersById = { [abdijibar.id]: abdijibar }
    const client = makeHistoryClient({ historyRows, usersById })
    const rows = await listProjectHistory(client, 'p-1')
    assert.equal(rows[0].id, 'h-1', 'older entry first')
    assert.equal(rows[1].id, 'h-2', 'newer entry second')
  })
})