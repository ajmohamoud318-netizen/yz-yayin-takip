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
import { loadProjectAssignees, assignSubtaskPage, resyncSubtaskPageAssignments } from './project-repository.js'

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
// ---------------------------------------------------------------------------
// `demo_delivered_by_name` is resolved live from `users` (see
// `deliveredByNameSql`) rather than read back from the snapshot the delivery
// step stamped, so renaming a user updates it the way it already updates the
// history timeline. That only holds if EVERY query returning a project row
// carries the derived expression — a `SELECT`/`RETURNING` that lists
// PROJECT_COLUMNS alone silently drops the field to null instead of failing,
// which is exactly the kind of omission that survives a green test run.
//
// So this is a source-level check: it reads the module text and asserts the
// pairing directly. Cheaper and more reliable than trying to exercise seven
// query paths through a fake client that cannot parse SQL anyway.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('project row queries', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./project-repository.js', import.meta.url)),
    'utf8',
  )

  it('pairs every PROJECT_COLUMNS query with the derived delivered-by name', () => {
    // Statement-ish slices: each place the constant is interpolated, plus the
    // ~200 chars after it, which is where the derived column would be added.
    const uses = [...source.matchAll(/\$\{PROJECT_COLUMNS[^}]*\}/g)]
    assert.ok(uses.length >= 6, `expected several query sites, found ${uses.length}`)

    const missing = uses
      .map((m) => ({ at: m.index, tail: source.slice(m.index, m.index + 220) }))
      .filter((u) => !u.tail.includes('deliveredByNameSql'))
      .map((u) => `line ${source.slice(0, u.at).split('\n').length}`)

    assert.deepEqual(
      missing, [],
      `PROJECT_COLUMNS used without deliveredByNameSql at: ${missing.join(', ')}`,
    )
  })

  it('keeps PROJECT_COLUMNS a flat list of bare column names', () => {
    // listProjects prefixes every entry with `p.` by splitting on commas, so a
    // derived expression added to the constant (COALESCE(a, b), a CASE, a
    // subquery) would be shredded into invalid SQL at that one call site only.
    const cols = source.match(/const PROJECT_COLUMNS = `([\s\S]*?)`/)[1]
    for (const col of cols.split(',')) {
      assert.match(
        col.trim(), /^[a-z_][a-z0-9_]*$/,
        `"${col.trim()}" is not a bare column name — it would break the p. prefixing in listProjects`,
      )
    }
  })

  it('resolves the live user name but falls back to the stored snapshot', () => {
    const fn = source.match(/const deliveredByNameSql = \(table\) => `([\s\S]*?)`/)[1]
    const sql = fn.replace(/\$\{table\}/g, 'projects').replace(/\s+/g, ' ').trim()
    assert.equal(
      sql,
      'COALESCE( (SELECT u.name FROM users u WHERE u.id = projects.demo_delivered_by), '
        + 'projects.demo_delivered_by_name ) AS demo_delivered_by_name',
    )
  })
})

// Regression test for the `could not determine data type of parameter $3`
// 500 that surfaced once the route actually hit PostgreSQL.
//
// assignSubtaskPage uses the same `$3` parameter in three places: an INSERT
// value, a CASE WHEN comparator, and an UPDATE assignment. pg's query
// planner can't infer the type when the same parameter appears in a
// CASE comparison to NULL and a bare column assignment, and the resulting
// error code is `42P08` from parse_param.c. Casting the parameter to
// `::text` explicitly (in every reference) keeps the planner happy.
//
// Without the cast, the route looks fine in the schema-validation test
// (that one uses a Fastify in-memory client and never parses SQL) but
// 500s in production the first time the leader clicks the assign popover.
describe('assignSubtaskPage — parameter type cast', () => {
  const src = readFileSync(
    fileURLToPath(new URL('./project-repository.js', import.meta.url)),
    'utf8',
  )

  it('casts $3 to text in the INSERT, the UPDATE, and the CASE branches', () => {
    const fn = src.match(/export async function assignSubtaskPage\([\s\S]*?\n\}/)
    assert.ok(fn, 'assignSubtaskPage not found in source')
    const body = fn[0]
    // Every reference to the assigned_to parameter has to be ::text — three
    // uses in the body (INSERT value, CASE NULL check, UPDATE assignment).
    // Two bare `$3` references would trip the parser; with the cast, the
    // parameter is unambiguous and pg accepts the plan.
    assert.equal(
      (body.match(/\$3::text/g) ?? []).length,
      4,
      'expected four $3::text casts in assignSubtaskPage (INSERT x2, CASE x2)',
    )
    assert.ok(
      !body.match(/\$3(?![:\d])/),
      'assignSubtaskPage still has a bare $3 reference — pg will throw 42P08',
    )
  })

  it('returns { error: "out_of_range" } without throwing on bad pageIndex', async () => {
    // Belt-and-braces check: when the route's downstream check rejects the
    // pageIndex, assignSubtaskPage must propagate the error code, not crash.
    // The fake client only answers the initial SELECT; we never reach the
    // INSERT/UPDATE because pageIndex=999 is > total_pages=2.
    const client = {
      async query(sql, params) {
        if (/FROM subtasks WHERE id = \$1/.test(sql)) {
          return { rows: [{ id: params[0], project_id: 'p-1', kind: 'pages', total_pages: 2 }] }
        }
        return { rows: [] }
      },
    }
    const result = await assignSubtaskPage(client, {
      subtaskId: 's-1', pageIndex: 999, assignedTo: 'u-aylin', actorId: 'u-leader',
    })
    assert.deepEqual(result, { error: 'out_of_range' })
  })
})

// ---------------------------------------------------------------------------
// `resyncSubtaskPageAssignments` — bulk re-stamp `assigned_to` for the
// per-page grid when the team leader reassigns a `kind='pages'` subtask
// mid-flight. The whole point of this helper is to keep the chip-grid
// owner pip in sync with the subtask-level owner; without it, every
// pending chip stayed on the original designer's colour forever after a
// single reassignment.
//
// We test the SQL contract the route relies on:
//   • `IS DISTINCT FROM` guard — no UPDATE issued for the same value
//   • `status <> 'done'` — done rows are never touched (audit trail)
//   • `CASE WHEN ... THEN NULL ELSE NOW()` — assigned_at mirrors the
//     assignSubtaskPage convention
//   • `$2::text` cast — prevents the 42P08 ambiguity regression assignSubtaskPage
//     already locks in (cheap to assert here too; same nullable TEXT column).
function makeSweepClient() {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.trim().replace(/\s+/g, ' '), params })
      return { rows: [] }
    },
  }
}

describe('resyncSubtaskPageAssignments', () => {
  it('issues an UPDATE filtered to the given subtask and the new owner', async () => {
    const client = makeSweepClient()
    await resyncSubtaskPageAssignments(client, 's-1', 'u-rahsan')
    assert.equal(client.calls.length, 1)
    const { sql, params } = client.calls[0]
    assert.match(sql, /UPDATE subtask_pages/)
    assert.match(sql, /WHERE subtask_id = \$1/)
    assert.match(sql, /status <> 'done'/)
    assert.match(sql, /assigned_to IS DISTINCT FROM \$2::text/)
    assert.deepEqual(params, ['s-1', 'u-rahsan'])
  })

  it('casts the new value to text so pg can plan the query', async () => {
    // Same nullability trap assignSubtaskPage tests for: a bare $2 in
    // SET assigned_to = $2 plus WHERE assigned_to IS DISTINCT FROM $2 plus
    // CASE WHEN $2::text IS NULL lets pg throw 42P08 because the
    // parameter appears in three type contexts. The implementation casts
    // every reference to $2::text — the SET, the WHERE guard, and the
    // CASE used to clear `assigned_at` when the new owner is null.
    const client = makeSweepClient()
    await resyncSubtaskPageAssignments(client, 's-1', 'u-rahsan')
    const body = client.calls[0].sql
    const textCasts = (body.match(/\$2::text/g) ?? []).length
    assert.equal(
      textCasts, 3,
      `expected three $2::text casts in resyncSubtaskPageAssignments (SET + WHERE + CASE), got ${textCasts}`,
    )
    assert.ok(
      !body.match(/\$2(?![:\d])/),
      'resyncSubtaskPageAssignments still has a bare $2 reference — pg will throw 42P08',
    )
  })

  it('stamps assigned_at to NOW() when an owner is provided, NULL when clearing', async () => {
    // Two calls in sequence: one to set a new owner, one to clear it. The
    // CASE expression must produce a timestamp on the first and NULL on
    // the second so the chip-grid tooltip's "X tarafından atandı" stays
    // honest.
    const client = makeSweepClient()
    await resyncSubtaskPageAssignments(client, 's-1', 'u-rahsan')
    await resyncSubtaskPageAssignments(client, 's-1', null)
    assert.match(
      client.calls[0].sql,
      /assigned_at = CASE WHEN \$2::text IS NULL THEN NULL ELSE NOW\(\) END/,
    )
    assert.match(
      client.calls[1].sql,
      /assigned_at = CASE WHEN \$2::text IS NULL THEN NULL ELSE NOW\(\) END/,
    )
    // And the second call's params carry the null the route layer is
    // expected to pass when the leader clears the subtask's assignment.
    assert.deepEqual(client.calls[1].params, ['s-1', null])
  })

  it('treats the IS DISTINCT FROM guard as the second line of defence against no-op writes', async () => {
    // The route layer already short-circuits with
    // `previousAssignedTo !== row.assigned_to` before calling this helper,
    // but the SQL guard is what protects against future callers (a
    // refactor that loses the JS check, a bulk import that passes the
    // existing value, …) silently re-stamping 200 rows on a no-op save.
    // The presence of the guard in the SQL is the contract we depend on.
    const client = makeSweepClient()
    await resyncSubtaskPageAssignments(client, 's-1', 'u-rahsan')
    assert.match(
      client.calls[0].sql,
      /AND assigned_to IS DISTINCT FROM \$2::text/,
    )
  })
})

// ---------------------------------------------------------------------------
// PUT /projects/:id/subtasks — source-level contract that the bulk reconcile
// route never overwrites the designer's work state (is_done / done_at).
//
// Background: the NewProjectDialog's mapper in
// client/src/application/mappers/project-mapper.js fills the body's
// `is_done` from the project repo's in-memory cache, which is NOT refreshed
// on every subtask mutation (toggleSubtask / setSubtaskPage return without
// touching the cache). When the leader opens the edit dialog on a project
// whose cache predates the designer's work, every subtask is sent back as
// is_done=false, and the route's old UPDATE wrote that value back. The
// project reset to 0% on save — the "project starts from zero" bug.
//
// The fix is route-level: drop `is_done` and `done_at` from the SET clause
// and treat them as designer-owned columns. We lock the contract here as a
// source-level test (cheaper and more reliable than running the route
// through a fake client that cannot parse SQL) so a future refactor that
// reintroduces either column will fail loudly.
const subtasksRouteSrc = readFileSync(
  fileURLToPath(new URL('../routes/subtasks.js', import.meta.url)),
  'utf8',
)

function extractUpdateBlock(src) {
  // Pull just the UPDATE subtasks statement — the one inside the
  // `if (existing) { ... }` branch of the bulk-reconcile loop. There are
  // other UPDATEs in this file (e.g. on the per-page PATCH), so we
  // anchor on the unique "SET title = $2" prefix that only this statement
  // has, plus the WHERE id = $1 / RETURNING * tail.
  const re = /`UPDATE subtasks\s+SET title = \$2[\s\S]*?RETURNING \*`/
  const m = src.match(re)
  assert.ok(m, 'expected the bulk-reconcile UPDATE in routes/subtasks.js to be findable')
  return m[0]
}

// Strip SQL line comments (--…) before running a regex against the
// captured block. Without this, prose in the in-template SQL comments
// like "is_done=" would trip the `is_done\s*=` check even when the
// executable SQL doesn't reference the column. Only the code lines
// matter for the contract we're locking in.
function stripSqlComments(block) {
  return block
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

describe('PUT /projects/:id/subtasks — designer work state is preserved', () => {
  it('UPDATE on existing subtasks does NOT set is_done', () => {
    // The designer's `is_done` is owned by PATCH /subtasks/:id and
    // PATCH /subtasks/:id/pages/:pageIndex. The bulk-reconcile route
    // can change the SHAPE of the subtask list (titles, kinds, totals,
    // assignment) but must never silently rewind a project back to 0%
    // because the SPA mapper sent a stale `is_done` from the cache.
    const update = stripSqlComments(extractUpdateBlock(subtasksRouteSrc))
    assert.ok(
      !/\bis_done\s*=/.test(update),
      'PUT /projects/:id/subtasks UPDATE must not set is_done; '
        + 're-add it only via PATCH /subtasks/:id or the per-page endpoint',
    )
  })

  it('UPDATE on existing subtasks follows is_done for done_at, not a client param', () => {
    // done_at must mirror the column value (is_done), not a `$6` from
    // the client — the same reasoning as the is_done check. A client
    // param would let a stale cache reset done_at to NOW() (claiming
    // the wrong completion time) or to NULL (dropping the original
    // completion time) on a save.
    const update = stripSqlComments(extractUpdateBlock(subtasksRouteSrc))
    assert.match(
      update,
      /done_at = CASE WHEN is_done THEN done_at ELSE NULL END/,
      'done_at should be a function of the existing is_done column, not a client param',
    )
  })

  it('param list for the UPDATE is 7 elements: id + 6 settable columns', () => {
    // Param count: $1 = existing.id, $2 = title, $3 = kind, $4 = total_pages,
    // $5 = total_stickers, $6 = subAssignee, $7 = index. `is_done` MUST NOT
    // be in this list — that's the contract. An extra param would let the
    // client side push a value into $6, but the SQL no longer references
    // it; the assertion below is on the route source so a future
    // refactor that re-introduces the value also re-introduces the bug.
    const paramsMatch = subtasksRouteSrc.match(
      /const params = \[\s*([\s\S]*?)\]\s*\n\s*if \(existing\)/,
    )
    assert.ok(paramsMatch, 'expected to find the bulk-reconcile params array')
    const items = paramsMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    assert.equal(
      items.length, 6,
      `expected 6 params (no is_done); got ${items.length}: ${items.join(', ')}`,
    )
  })

  it('INSERT for new subtasks does not include is_done either', () => {
    // Brand-new subtasks have no designer work to credit, so the column
    // is correctly absent from the INSERT (migration 003 defaults it to
    // FALSE). What we're locking in is that the column isn't added to
    // the INSERT VALUES list as a placeholder for "false" — that would
    // be a no-op for new rows, but it'd advertise to future readers
    // that the route is allowed to write is_done, which it isn't.
    const insertMatch = subtasksRouteSrc.match(
      /INSERT INTO subtasks[\s\S]*?VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,\$7\) RETURNING \*/,
    )
    assert.ok(
      insertMatch,
      'expected the bulk-reconcile INSERT to omit is_done from both columns and VALUES',
    )
    const insert = stripSqlComments(insertMatch[0])
    assert.ok(
      !insert.includes('is_done'),
      'INSERT statement should not list is_done — column defaults to FALSE in migration 003',
    )
  })
})
