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
import { loadProjectAssignees, patchProject, findProjectByTitle } from './project-repository.js'

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

// migration 067 — designer pages-done input. Replaces the per-chip
// PATCH /subtasks/:id/pages/:pageIndex route that the chip grid used
// to make. Tests for the chip-grid helpers (`assignSubtaskPage`,
// `resyncSubtaskPageAssignments`, `setSubtaskPage`) and the
// chip-grid routes (PATCH /subtasks/:id/pages/:pageIndex, PATCH
// /subtasks/:id/pages/:pageIndex/assign, POST /subtasks/:id/pages/bulk-assign)
// are gone with the route removals.

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

  it('the UPDATE param list carries only settable shape columns, never is_done', () => {
    // Param order: $1 = existing.id, $2 = title, $3 = kind, $4 = total_pages,
    // $5 = total_stickers, $6 = subAssignee, $7 = index, $8 = parca
    // (migration 075). `is_done` MUST NOT be in this list — that is the
    // contract, and the assertion is on the route SOURCE so a future refactor
    // that re-introduces the value also re-introduces the bug.
    //
    // The count is asserted alongside the real rule rather than instead of it:
    // a bare "must be N" fails on every legitimate column addition (as it did
    // when `parca` landed) while saying nothing about the thing that matters.
    const paramsMatch = subtasksRouteSrc.match(
      /const params = \[\s*([\s\S]*?)\]\s*\n\s*if \(existing\)/,
    )
    assert.ok(paramsMatch, 'expected to find the bulk-reconcile params array')
    // Strip JS comments first — they contain commas and would otherwise be
    // counted as parameters.
    const items = paramsMatch[1]
      .replace(/\/\/[^\n]*/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    assert.ok(
      !items.some((i) => /\bis_done\b/.test(i)),
      `is_done must never be a bulk-reconcile param; got: ${items.join(', ')}`,
    )
    assert.deepEqual(
      items,
      [
        's.title',
        "s.kind ?? 'check'",
        's.total_pages ?? null',
        's.total_stickers ?? null',
        'subAssignee',
        'index',
        's.parca ?? null',
      ],
      'the settable set changed — confirm the new column is shape, not designer work state',
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
      /INSERT INTO subtasks[\s\S]*?VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8\) RETURNING \*/,
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
//   • kind='check' reopen — stamps `needs_redo = TRUE` on the subtask
//     row (migration 085). `is_done` is left alone so the previous
//     designer's completion credit survives; the new owner clears
//     the flag via `POST /subtasks/:id/redo-ack`.
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
  it('reopens a kind=check alt görev by stamping needs_redo (migration 085)', () => {
    // The kind=check reopen path no longer flips is_done back to false
    // (migration 085). It instead stamps the `needs_redo` flag so the
    // previous owner's completion credit survives and the new owner
    // sees a redo pill to acknowledge. The anchor is the literal
    // UPDATE statement inside the `if (row.kind === 'check')` branch
    // — the SET clause must write needs_redo, NOT is_done/done_at.
    const re = /UPDATE subtasks\s+SET needs_redo = TRUE/
    assert.ok(
      re.test(subtasksRouteSrc),
      'expected a kind=check reopen UPDATE that sets needs_redo = TRUE (migration 085)',
    )
  })

  it('the kind=check reopen branch does NOT flip is_done/done_at', () => {
    // Defensive assertion: the previous (pre-085) reopen literal
    // `SET is_done = false, done_at = NULL` must be gone from the
    // route. There's still an UPDATE that touches is_done elsewhere
    // (the per-subtask PATCH route for normal toggle), so the test
    // scopes by the reopen-loop comment header above the loop —
    // anything inside that block must not write is_done/done_at.
    const block = subtasksRouteSrc.match(
      /\/\/ ── Reopen done work when the leader reassigns the owner[\s\S]*?Re-SELECT the rows so `inserted` carries/,
    )
    assert.ok(block, 'could not locate the reopen-on-reassign block')
    const body = block[0]
    assert.doesNotMatch(
      body,
      /SET is_done\s*=\s*false/,
      'kind=check reopen branch must not flip is_done back to false anymore',
    )
    assert.doesNotMatch(
      body,
      /done_at\s*=\s*NULL/,
      'kind=check reopen branch must not clear done_at anymore',
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
// POST /subtasks/:id/updates — designer's "Yeniden Çalıştım" note
// piggybacks the handover-redo ack (migration 085).
//
// The original design had a dedicated POST /subtasks/:id/redo-ack
// route + sky-500 ack button. That gave the row two "Yeniden
// Çalıştım" buttons sitting next to each other — confusing. The
// simpler shape is for the designer's existing note endpoint to
// check `needs_redo` and clear it in the same transaction when the
// caller is the assigned designer. One button per row, two outcomes
// surfaced via the `redoCleared` response flag.
//
// All assertions here are on the route source because the handler
// is a closure inside `subtaskRoutes`. The companion PGlite
// integration test in routes/__tests__/subtasks-redo-on-note.js
// exercises the happy path against a real DB.
describe('POST /subtasks/:id/updates — handover redo piggyback (migration 085)', () => {
  it('reads needs_redo + assigned_to off the SELECT so it can branch on the flag', () => {
    // The piggyback branch needs the flag AND the assignee to make
    // its gating decision. If the SELECT ever shrinks back to just
    // (id, project_id, title), the owner gate loses its input and
    // either becomes a no-op or starts misfiring on the wrong rows.
    // Scoped to the /updates handler block to avoid matching other
    // SELECTs earlier in the file (PATCH /subtasks/:id uses SELECT *).
    const updatesBlock = subtasksRouteSrc.match(
      /fastify\.post\(\s*'\/subtasks\/:id\/updates'[\s\S]*?redoCleared:\s*redoCleared|fastify\.post\(\s*'\/subtasks\/:id\/updates'[\s\S]*?redoCleared,?\s*\n/,
    )
    assert.ok(updatesBlock, 'could not locate the /updates handler block')
    assert.match(
      updatesBlock[0],
      /SELECT id, project_id, title, kind, needs_redo, assigned_to FROM subtasks WHERE id = \$1/,
      'subtask note SELECT must include needs_redo and assigned_to for the piggyback branch',
    )
  })

  it('gates the flag-clear on the caller being the assigned designer', () => {
    // The leader is the one who STAMPED the flag — letting the same
    // leader clear it via a note click would strip the new owner of
    // the explicit ack step the flag exists to enforce. A
    // non-assigned designer must also not be able to flip the flag
    // for a row that wasn't handed to them. The gate is: caller.id
    // === row.assigned_to (and assigned_to must be set; the flag is
    // only meaningful when the row has an owner).
    assert.match(
      subtasksRouteSrc,
      /if \(\s*sub\.needs_redo\s*\n?\s*&&\s*sub\.assigned_to\s*\n?\s*&&\s*sub\.assigned_to\s*===\s*request\.user\.id\s*\)/,
      'flag-clear must be gated on needs_redo AND assigned_to === caller',
    )
  })

  it('clears needs_redo with a single-column UPDATE (is_done survives)', () => {
    // The point of the flag is that is_done stays as-is. If this
    // UPDATE ever flipped is_done/done_at, the previous owner's
    // credit would vanish — the very bug migration 085 was designed
    // to retire. The single-column UPDATE inside the piggyback
    // branch must only touch needs_redo.
    const piggybackBlock = subtasksRouteSrc.match(
      /sub\.needs_redo[\s\S]*?sub\.assigned_to\s*===\s*request\.user\.id[\s\S]*?redoCleared\s*=\s*true/,
    )
    assert.ok(piggybackBlock, 'could not locate the piggyback flag-clear branch')
    assert.match(
      piggybackBlock[0],
      /UPDATE subtasks SET needs_redo = FALSE, updated_at = NOW\(\) WHERE id = \$1/,
      'piggyback branch must clear needs_redo with a single-column UPDATE',
    )
    assert.doesNotMatch(
      piggybackBlock[0],
      /SET\s+is_done\s*=\s*false/,
      'piggyback branch must not flip is_done back to false',
    )
    assert.doesNotMatch(
      piggybackBlock[0],
      /done_at\s*=\s*NULL/,
      'piggyback branch must not clear done_at',
    )
  })

  it('writes the subtask_redo_acked history row inside the piggyback branch', () => {
    // The timeline is the only audit trail the team has for "the redo
    // was explicitly acked" — without the separate history row the
    // fold bucket in project-history.js would have nothing to
    // distinguish a redo-ack from a plain note drop. The note copy
    // appends the caller's own note after the friendly prefix so the
    // timeline reads "KAPAK, yeniden çalışıldı olarak işaretlendi ·
    // Yeniden çalışıldı." instead of dropping the button's intent.
    const piggybackBlock = subtasksRouteSrc.match(
      /sub\.needs_redo[\s\S]*?sub\.assigned_to\s*===\s*request\.user\.id[\s\S]*?redoCleared\s*=\s*true/,
    )
    assert.ok(piggybackBlock, 'could not locate the piggyback flag-clear branch')
    assert.match(
      piggybackBlock[0],
      /event:\s*['"]subtask_redo_acked['"]/,
      'piggyback branch must log a history row tagged subtask_redo_acked',
    )
    assert.match(
      piggybackBlock[0],
      /yeniden çalışıldı olarak işaretlendi/,
      'piggyback branch must include the friendly "yeniden çalışıldı olarak işaretlendi" note',
    )
  })

  it('surfaces redoCleared on the response so the client toast can branch', () => {
    // The client toasts off `redoCleared` — `true` shows "yeniden
    // çalışıldı olarak işaretlendi", `false` shows "yeniden çalışıldı
    // olarak kaydedildi". If the response field ever disappears, the
    // toast reverts to the plain-note copy and the user gets no
    // feedback that the flag also flipped. Accepts both the explicit
    // `redoCleared: redoCleared` form and the modern shorthand
    // `redoCleared,` shape — what's locked in is the wire field name.
    assert.match(
      subtasksRouteSrc,
      /redoCleared(:\s*redoCleared)?,?\s*\n\s*\}/,
      'response payload must surface redoCleared so the client can branch the toast',
    )
  })

  it('route-table comment documents the piggyback under /updates, not a separate /redo-ack route', () => {
    // The dedicated /subtasks/:id/redo-ack route was deliberately
    // collapsed into /updates — the table-of-contents comment must
    // not advertise a removed endpoint, and must mention migration
    // 085 under the /updates line so future readers know where the
    // ack lives.
    assert.doesNotMatch(
      subtasksRouteSrc,
      /fastify\.post\(\s*'\/subtasks\/:id\/redo-ack'/,
      'the dedicated /redo-ack route must be gone (collapsed into /updates)',
    )
    assert.match(
      subtasksRouteSrc,
      /POST\s+\/api\/subtasks\/:id\/updates[\s\S]*?migration 085[\s\S]*?POST\s+\/api\/subtasks\/:id\/revize/,
      'route-table comment must mention migration 085 inside the /updates entry',
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
  it('calls the shared helper with request.body.assignees', () => {
    // The PUT route delegates the orphan-designer check to the shared
    // helper in domain/subtask-assignee.js. The helper's own contract
    // is locked in by __subtask-assignee-orphan-guard.test.js; this
    // test pins the call-site wiring so a future refactor that drops
    // the helper call from the route will fail loudly.
    assert.match(
      subtasksRouteSrc,
      /assertNoOrphanDesigners\(\s*request\.body\.assignees,\s*subtasks,\s*\{\s*\}\s*\)/,
      'PUT route must call the shared helper (the empty {} is fine — PUT-shape payloads carry assigned_to on each subtask)',
    )
  })

  it('rejects orphan designers with a 400 mentioning the missing id', () => {
    // The error message has to (1) name the offending designer so the
    // leader can fix it without hunting through the picker, and
    // (2) explain the rule so a future change to the project policy
    // is at least locatable in the message.
    assert.match(
      subtasksRouteSrc,
      /if \(err instanceof OrphanDesignerError\) badRequest\(err\.message\)/,
      'PUT route must translate OrphanDesignerError into a 400',
    )
    // The wording lives in the helper now — re-assert it there so the
    // leader-facing message stays stable.
    const helperSrc = readFileSync(
      fileURLToPath(new URL('../domain/subtask-assignee.js', import.meta.url)),
      'utf8',
    )
    assert.match(
      helperSrc,
      /Listeye eklediğiniz her tasarımcı en az bir alt göreve atanmalı\./,
      'helper must keep the leader-friendly Turkish wording',
    )
  })
})

// migration 067 — leader's "Tüm tasarımcılara dağıt" popover removed
// with the chip grid; designers enter their own page count via a
// per-designer input now. POST /api/subtasks/:id/pages/bulk-assign is
// gone.

// migration 067 — PATCH /api/subtasks/:id/pages/:pageIndex is gone.
// The per-page chip-grid click flow is replaced by the per-designer
// number-input save on PATCH /api/subtasks/:id/designer-counts.
// Tests for the chip-grid route's permissions live where the new
// route's permissions live (future).

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
