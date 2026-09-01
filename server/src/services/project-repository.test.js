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
import { loadProjectAssignees, assignSubtaskPage, resyncSubtaskPageAssignments, patchProject, findProjectByTitle } from './project-repository.js'

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
  // Slice 3 moved assignSubtaskPage into subtask-repository.js; this test
  // still inspects its source for the `$3::text` cast, so it reads from
  // the new home.
  const src = readFileSync(
    fileURLToPath(new URL('./subtask-repository.js', import.meta.url)),
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

// ---------------------------------------------------------------------------
// PUT /projects/:id/subtasks — source-level contract for "reopen done
// work on reassign."
//
// When the team leader changes the `assigned_to` of an alt görev whose
// `is_done` is currently true, the work is reopened so the new owner
// has to redo it. Without this branch, the leader's reassignment of a
// completed Kapak (or a completed İç Sayfalar) would silently strand
// the credit with the old finisher while the new designer is on the
// hook for delivery they never had a chance to do.
//
// Locked-in contracts (all on the route source, because the reopen
// logic is route-internal and the SQL is best read directly):
//   • kind='check' reopen — `is_done = false, done_at = NULL` on the
//     subtask row.
//   • kind='pages' reopen — `status = 'rework'` on every done page
//     with `rework_count` incremented, AND `is_done` recomputed
//     (otherwise the parent flag would lie and progressFor would
//     count a fully-reworked subtask as "done").
//   • The detection uses the previous snapshot (previous.assigned_to
//     !== new.assigned_to AND previous.is_done === true) so a save
//     that only renames or re-totals doesn't accidentally reopen.
//   • The describeSubtaskListChange timeline bit for a reassign of
//     a done subtask says "atama değişti, yeniden yapılacak" so the
//     team can see why a finished alt görev is back in the queue.

describe('PUT /projects/:id/subtasks — reopen on reassign of done work', () => {
  it('reopens a kind=check alt görev that was is_done=true', () => {
    // Pull the check-kind reopen block. Anchored on the unique UPDATE
    // that writes is_done = false, done_at = NULL with no $params in
    // sight (the values are literals, not bound parameters) — the
    // kind='check' branch never needs to know which row, just that the
    // SET clause flips both columns.
    const re = /UPDATE subtasks\s+SET is_done = false,\s*done_at = NULL/
    assert.ok(
      re.test(subtasksRouteSrc),
      'expected a kind=check reopen UPDATE in the bulk-reconcile route',
    )
  })

  it('flips done pages to rework on kind=pages reopen, with rework_count++', () => {
    // The pages-kind reopen must (1) touch only the rows that are
    // currently 'done' (the WHERE guard) and (2) increment rework_count
    // so the team can see how many times a page has bounced, and
    // (3) NOT touch done_by / done_at — the audit trail of who last
    // shipped the page stays.
    assert.match(
      subtasksRouteSrc,
      /UPDATE subtask_pages\s+SET status = 'rework',\s*rework_count = rework_count \+ 1/,
      'pages-kind reopen should set status=rework and bump rework_count',
    )
    // The WHERE clause must filter to status='done' so a page already
    // in 'pending' or 'rework' isn't double-counted.
    assert.match(
      subtasksRouteSrc,
      /status = 'rework'[\s\S]{0,200}WHERE subtask_id = \$1\s+AND status = 'done'/,
      'pages-kind reopen WHERE must scope to status=done rows',
    )
  })

  it('recomputes is_done + pages_done after the pages-kind reopen', () => {
    // After flipping 50 done pages to rework, the subtask's is_done
    // flag is stale (still true from before) and pages_done is stale
    // (still 50, but zero pages are actually 'done' now). Without this
    // recompute, progressFor would count the subtask as done and the
    // project progress bar would lie.
    assert.match(
      subtasksRouteSrc,
      /pages_done = COALESCE\(\(\s*SELECT COUNT\(\*\)::int\s+FROM subtask_pages/,
      'pages_done should be recomputed from the chip-grid state',
    )
    assert.match(
      subtasksRouteSrc,
      /is_done = COALESCE\(\(\s*SELECT \(COUNT\(\*\) FILTER \(WHERE status = 'done'\)\s*=\s*COUNT\(\*\)\)/,
      'is_done should be recomputed from the chip-grid state too',
    )
  })

  it('detects the reopen only when the assignee actually changed AND is_done was true', () => {
    // The branch gates on `prev.assigned_to !== row.assigned_to` AND
    // `prev.is_done === true`. Both must hold — a save that only
    // renames a subtask, or one where the leader didn't touch the
    // assignee on a not-done subtask, must not trigger a reopen.
    assert.match(
      subtasksRouteSrc,
      /if \(prev\.assigned_to === row\.assigned_to\) continue\s+\/\/ assignee didn't move/,
      'reopen should short-circuit when assigned_to did not change',
    )
    assert.match(
      subtasksRouteSrc,
      /if \(!prev\.is_done\) continue\s+\/\/ wasn't done, no work to reopen/,
      'reopen should short-circuit when the previous row was not is_done',
    )
  })

  it('describeSubtaskListChange flags a reopen as "atama değişti, yeniden yapılacak"', () => {
    // The timeline bit is the only place the team sees WHY a finished
    // alt görev is suddenly back in the queue. A plain "atama değişti"
    // would leave everyone guessing. Pull the function source and
    // assert the conditional bit is present.
    const fnMatch = subtasksRouteSrc.match(
      /export function describeSubtaskListChange\([\s\S]*?\n\}/,
    )
    assert.ok(fnMatch, 'describeSubtaskListChange not found in source')
    const body = fnMatch[0]
    assert.match(
      body,
      /old\.is_done\s*&&\s*!s\.is_done/,
      'describeSubtaskListChange must detect the done→not-done transition',
    )
    assert.match(
      body,
      /atama değişti, yeniden yapılacak/,
      'describeSubtaskListChange must emit a dedicated "yeniden yapılacak" bit on reopen',
    )
  })
})

// ---------------------------------------------------------------------------
// PUT /projects/:id/subtasks — orphan-designer guard.
//
// The leader's chip-grid assignee picker lets them add a designer to the
// project without explicitly dropping them onto a subtask. Without a
// guard, the save would leave that designer in `projects.assignees` (via
// the PATCH that sets the primary from assignees[0]) but on no subtask
// — invisible to the chip grid, no work queued for them, notifications
// still going out as if they were an active contributor. The guard runs
// at the top of the PUT route (before the withTx block) so the
// transaction is aborted on failure.
//
// Contract:
//   • `assignees` in the body is OPTIONAL — callers that only edit
//     subtask titles / totals don't have to re-send it.
//   • When present, the first id is the project primary; every other
//     id must be on at least one subtask in the same payload.
//   • Subtasks with assigned_to=null fall back to the project primary
//     in the route's write path, so a subtask with no assigned_to does
//     NOT cover any extra designer — the only designer it covers is
//     the primary.
describe('PUT /projects/:id/subtasks — orphan-designer guard', () => {
  it('reads assignees off the body and runs the loop', () => {
    // The guard must (1) pull declaredAssignees from request.body
    // and (2) iterate over every id, skipping the primary and
    // accepting any id present in the subtask-assignee set. We assert
    // the loop body is wired so a future refactor that strips the
    // guard can't quietly regress the behaviour.
    assert.match(
      subtasksRouteSrc,
      /declaredAssignees = Array\.isArray\(request\.body\.assignees\)/,
      'guard must pull declaredAssignees from request.body.assignees',
    )
    assert.match(
      subtasksRouteSrc,
      /for \(const id of declaredAssignees\)/,
      'guard must iterate every id in declaredAssignees',
    )
  })

  it('skips the first id (the project primary) and any id that is in a subtask', () => {
    // The two `continue` branches are the only legal ways out of the
    // loop without raising a 400. Anything else means the guard is
    // short-circuiting a legitimate case.
    const guardMatch = subtasksRouteSrc.match(
      /for \(const id of declaredAssignees\)\s*\{[\s\S]*?\n\s{6}\}/,
    )
    assert.ok(guardMatch, 'orphan-guard for-loop not found in source')
    const body = guardMatch[0]
    assert.match(body, /if \(id === primaryAssignee\) continue/)
    assert.match(body, /if \(subAssigneeIds\.has\(id\)\) continue/)
  })

  it('rejects orphan designers with a 400 mentioning the missing id', () => {
    // The error message has to (1) name the offending designer so the
    // leader can fix it without hunting through the picker, and
    // (2) explain the rule so a future change to the project policy
    // is at least locatable in the message.
    assert.match(
      subtasksRouteSrc,
      /badRequest\([\s\S]*?Listeye eklediğiniz her tasarımcı en az bir alt göreve atanmalı\./,
    )
  })
})

// ---------------------------------------------------------------------------
// POST /api/subtasks/:id/pages/bulk-assign — distribute mode targets the
// project's actual assignees, not the global active designer roster.
//
// Background: the leader's "Tüm tasarımcılara dağıt" popover shows the
// designers who are actually working on this project (project primary UNION
// per-subtask assignees). If the distribute used the global active roster
// the round-robin could include designers who aren't even on the project —
// they'd suddenly get pages with no prior context, and the leader
// couldn't see that designer in the popover. The distribute must use the
// same set the popover shows, and the SQL contract is: WHERE
// role='designer' AND is_active=true AND (id = project primary OR
// assigned_to some subtask on this project).
describe('POST /api/subtasks/:id/pages/bulk-assign — distribute targets project assignees', () => {
  it('filters the rotation to designers actively on this project', () => {
    // Anchor on the WHERE clause of the distribute query and assert it
    // scopes the rotation to "is_active=true AND role=designer AND
    // (project primary OR subtask owner)". A regression to the global
    // roster would have a bare `role='designer' AND is_active=true`
    // without the project-scope subqueries.
    assert.match(
      subtasksRouteSrc,
      /SELECT DISTINCT u\.id, u\.name\s+FROM users u\s+WHERE u\.is_active = true\s+AND u\.role = 'designer'/,
      'distribute query should filter to role=designer AND is_active=true',
    )
    // Project primary check: the rotation must include the project
    // primary when they're a designer. Without this, designers who are
    // only the primary (and not on any subtask) get silently dropped
    // from the rotation.
    assert.match(
      subtasksRouteSrc,
      /u\.id = \(SELECT assigned_to FROM projects WHERE id = \$2\)/,
      'distribute must include the project primary in the rotation',
    )
    // Subtask owner check: the rotation must include every designer
    // assigned to any subtask on this project. Without this, the
    // distribute ignores designers who only appear on other subtasks
    // (Kapak, Kutu) — exactly the "active in the project" set.
    assert.match(
      subtasksRouteSrc,
      /EXISTS \(\s*SELECT 1 FROM subtasks s\s+WHERE s\.project_id = \$2\s+AND s\.assigned_to = u\.id\s*\)/,
      'distribute must include designers assigned to any subtask on the project',
    )
  })

  it('refuses with 400 when the project has no active assignees', () => {
    // A project with no designers at all (or all inactive) can't be
    // distributed to. The error message names the project, not the
    // designer list, because the leader can't act on it.
    assert.match(
      subtasksRouteSrc,
      /badRequest\('Bu projede atanmış aktif tasarımcı yok\.'\)/,
    )
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/subtasks/:id/pages/:pageIndex — any project assignee can
// mark a pending or rework page done, regardless of who the leader
// assigned the page to.
//
// The per-page `assigned_to` is a planning signal (drives the chip
// colour, the "Benim sayfalarım" filter, the legend) but is NOT a
// permission gate. If the leader assigns page 47 to Aylin, Cem (also a
// project assignee) can still mark page 47 done — Cem's click
// updates `done_by = cem` and `done_at = NOW()`, so the chip flips
// from Aylin's planned colour to Cem's "shipped it" colour. That's the
// right behaviour: the leader's plan was a hint, and the audit trail
// still credits whoever actually did the work.
//
// The one place per-page ownership DOES gate is re-marking an
// already-done page (the `not_yours` check). That stays — the
// designer who finished the work is the one who can undo or rework it
// (the leader has the override). Without that, Cem could "fix" Aylin's
// work without ever telling Aylin, and the audit trail would say
// Aylin shipped something Cem actually undid — bug #6 territory.
describe('PATCH /api/subtasks/:id/pages/:pageIndex — per-page assignment is not a permission gate', () => {
  // Slice 3 moved setSubtaskPage into subtask-repository.js; the source
  // check below reads from the new home.
  const subtaskSrc = readFileSync(
    fileURLToPath(new URL('./subtask-repository.js', import.meta.url)),
    'utf8',
  )

  it('the route gates on project membership, NOT on per-page assigned_to', () => {
    // Anchor on the route's isAssignedDesigner check. It compares the
    // requester against `assigneeIds` (the union of project primary and
    // per-subtask owners), NOT against the per-page assigned_to. A
    // regression that added a per-page check would break the
    // "Cem can do Aylin's assigned page" rule.
    assert.match(
      subtasksRouteSrc,
      /assigneeIds\.has\(request\.user\.id\)/,
      'route should check project membership via assigneeIds, not per-page assigned_to',
    )
    // And the isAssignedDesigner check should require the user to be
    // a designer (not just any role) so non-designer roles can't sneak
    // in via a different membership list.
    assert.match(
      subtasksRouteSrc,
      /request\.user\.role === 'designer' && assigneeIds\.has\(request\.user\.id\)/,
      'isAssignedDesigner must require the designer role',
    )
  })

  it('setSubtaskPage allows status=done on a pending or rework page without an ownership check', () => {
    // Pull the not-yours check. The first arm of the OR (`page.status
    // === 'pending'` etc.) is what the test cares about: the helper
    // doesn't compare `page.assigned_to` to the actor, only
    // `page.done_by`. A page in pending/rework has no done_by yet, so
    // any project assignee who reaches the helper can flip it to done.
    //
    // Pull the body of the done-status branch and assert it only checks
    // `page.status` and `page.done_by`, not `page.assigned_to`.
    const fn = subtaskSrc.match(/export async function setSubtaskPage\([\s\S]*?\n\}/)
    assert.ok(fn, 'setSubtaskPage not found in source')
    const body = fn[0]
    assert.match(
      body,
      /if \(page && page\.status === 'done' && page\.done_by && page\.done_by !== actorId\)/,
      'not_yours should fire on done-by-someone-else, not on assigned_to mismatch',
    )
    // Negative assertion: assigned_to must not appear in the not_yours
    // check. A regression that added `page.assigned_to !== actorId`
    // here would silently lock pages to their planned owner.
    const notYoursMatch = body.match(
      /if \(page && page\.status === 'done' && page\.done_by && page\.done_by !== actorId\)\s*\{[\s\S]*?\n\s+\}/,
    )
    assert.ok(notYoursMatch, 'expected to find the not_yours check block')
    assert.ok(
      !notYoursMatch[0].includes('assigned_to'),
      'not_yours check must NOT reference assigned_to — only done_by',
    )
  })
})

/**
 * patchProject's JSONB binding.
 *
 * `ozalit_approvals` / `ozalit_designer_approvals` are JSONB columns.
 * node-postgres encodes a raw JS array as a Postgres ARRAY LITERAL, so
 * binding one without an explicit `::jsonb` cast sent
 * `{"{\"id\":\"u-lead\",...}"}` to the jsonb parser — `22P02 invalid input
 * syntax for type json`, surfacing as a 500 from POST /projects/:id/approve
 * on the very first ozalit sign-off. `[]` was worse: it encodes to `{}`,
 * which Postgres accepts, so the column silently held an empty JSON object
 * and `jsonb_array_length` later raised 22023 on that row.
 */
describe('patchProject JSONB columns', () => {
  function capturingClient() {
    const calls = []
    return {
      calls,
      async query(sql, params) {
        calls.push({ sql, params })
        return { rows: [{ id: 'p-1', ozalit_approvals: [] }] }
      },
    }
  }

  it('binds ozalit approval arrays as JSON text through an explicit ::jsonb cast', async () => {
    const client = capturingClient()
    const approvals = [{ id: 'u-lead', role: 'team_leader', name: 'Ayşenur', at: '2026-08-31T00:00:00.000Z' }]
    await patchProject(client, 'p-1', { ozalit_approvals: approvals })

    const update = client.calls.find((c) => /^UPDATE projects/.test(c.sql.trim()))
    assert.ok(update, 'expected an UPDATE projects query')
    assert.match(update.sql, /ozalit_approvals = \$2::jsonb/, 'must carry the ::jsonb cast')
    assert.equal(
      update.params[1],
      JSON.stringify(approvals),
      'the value must go to the wire as JSON text, never as a raw JS array',
    )
  })

  it('sends the empty reset as the JSON array [] and not the object {}', async () => {
    const client = capturingClient()
    await patchProject(client, 'p-1', { ozalit_approvals: [], ozalit_designer_approvals: [] })

    const update = client.calls.find((c) => /^UPDATE projects/.test(c.sql.trim()))
    assert.match(update.sql, /ozalit_approvals = \$2::jsonb/)
    assert.match(update.sql, /ozalit_designer_approvals = \$3::jsonb/)
    assert.equal(update.params[1], '[]')
    assert.equal(update.params[2], '[]')
  })

  it('leaves non-JSONB columns bound as plain values', async () => {
    const client = capturingClient()
    await patchProject(client, 'p-1', { stage: 'baski_onay', progress: 100 })

    const update = client.calls.find((c) => /^UPDATE projects/.test(c.sql.trim()))
    assert.doesNotMatch(update.sql, /::jsonb/, 'no cast belongs on scalar columns')
    assert.deepEqual(update.params, ['p-1', 'baski_onay', 100])
  })
})

/**
 * findProjectByTitle — the lookup behind the "no two projects with the same
 * name" rule. It does the comparison in JS (Turkish-locale lowercase), so
 * these assert the matching itself, not the SQL.
 */
function titleClient(rows) {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.trim(), params })
      return { rows }
    },
  }
}

const LIVE = [
  { id: 'p-1', title: 'Zeka Küpü', stage: 'tasarim' },
  { id: 'p-2', title: '  IŞIK   Serisi ', stage: 'ozalit_onay' },
  { id: 'p-3', title: 'Matematik 5', stage: 'tasarim' },
]

describe('findProjectByTitle', () => {
  it('matches ignoring case, padding and repeated whitespace', async () => {
    const hit = await findProjectByTitle(titleClient(LIVE), 'ışık serisi')
    assert.equal(hit?.id, 'p-2')
  })

  it('matches a caps title typed without a Turkish keyboard', async () => {
    const hit = await findProjectByTitle(titleClient(LIVE), 'MATEMATIK 5')
    assert.equal(hit?.id, 'p-3', 'ASCII I must still find "Matematik 5"')
  })

  it('returns the stored row so the 409 can quote the real title', async () => {
    const hit = await findProjectByTitle(titleClient(LIVE), 'zeka küpü')
    assert.equal(hit.title, 'Zeka Küpü', 'the caller shows this, not what was typed')
    assert.equal(hit.stage, 'tasarim')
  })

  it('returns null when nothing matches', async () => {
    assert.equal(await findProjectByTitle(titleClient(LIVE), 'Matematik 6'), null)
  })

  it('skips the SQL entirely for a blank title', async () => {
    // The schema already rejects '', and matching every untitled row
    // against every other would be worse than useless.
    const client = titleClient(LIVE)
    assert.equal(await findProjectByTitle(client, '   '), null)
    assert.equal(client.calls.length, 0)
  })

  it('excludes the row being renamed so a casing fix is not self-blocking', async () => {
    const client = titleClient([])
    await findProjectByTitle(client, 'Zeka Küpü', { excludeId: 'p-1' })
    assert.equal(client.calls[0].params[0], 'p-1')
    assert.match(client.calls[0].sql, /id <> \$1/)
  })

  it('scans only live rows — a soft-deleted project releases its title', async () => {
    const client = titleClient([])
    await findProjectByTitle(client, 'Zeka Küpü')
    assert.match(client.calls[0].sql, /deleted_at IS NULL/)
    assert.equal(client.calls[0].params[0], null, 'no exclusion on create')
  })
})
