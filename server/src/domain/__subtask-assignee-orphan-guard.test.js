/**
 * Source-level regression tests for the orphan-designer guard and the
 * project-scoped designer-batches gate. Pulls the actual source of
 * `subtask-assignee.js`, `services/project-service/admin.js`, and
 * `routes/subtasks.js` and asserts the wiring is intact — same pattern
 * the existing project-repository.test.js uses for the PUT orphan
 * guard. Source-level (no DB) keeps this cheap and deterministic.
 *
 * Two fixes are locked in here:
 *
 *   1. POST /api/projects runs the same orphan-designer check as
 *      PUT /projects/:id/subtasks. Before this, a leader could add
 *      2+ designers to a project, drop only one onto a subtask, and
 *      the project would land with a designer on no work — invisible
 *      to the chip grid, no notifications fired.
 *
 *   2. POST /api/subtasks/:id/designer-batches refuses a designer who
 *      isn't on the project from logging onto a "Tüm Tasarımcılar"
 *      (assigned_to IS NULL) subtask. Before this, any active system
 *      designer could inflate the shared counter — "Tüm Tasarımcılar"
 *      means every PROJECT designer, not every SYSTEM designer.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const subtaskAssigneeSrc = readFileSync(
  fileURLToPath(new URL('./subtask-assignee.js', import.meta.url)),
  'utf8',
)
const createProjectSrc = readFileSync(
  fileURLToPath(new URL('../services/project-service/admin.js', import.meta.url)),
  'utf8',
)
const subtasksRouteSrc = readFileSync(
  fileURLToPath(new URL('../routes/subtasks.js', import.meta.url)),
  'utf8',
)

// ─── Fix 1a: shared helper exists in the domain module ────────────────

describe('Orphan-designer guard — shared helper', () => {
  it('exports assertNoOrphanDesigners and OrphanDesignerError', () => {
    assert.match(
      subtaskAssigneeSrc,
      /export function assertNoOrphanDesigners\(/,
      'helper must be exported from domain/subtask-assignee.js so create and edit share one source',
    )
    assert.match(
      subtaskAssigneeSrc,
      /export class OrphanDesignerError\b/,
      'OrphanDesignerError must be exported so route handlers can branch on it',
    )
  })

  it('throws with the leader-friendly Turkish message', () => {
    // Same wording the PUT route already speaks — a leader editing
    // a project shouldn't see two different errors for the same
    // mistake depending on which save button they hit.
    assert.match(
      subtaskAssigneeSrc,
      /Tasarımcı atanmamış:[\s\S]*?en az bir alt göreve atanmalı\./,
    )
  })

  it('treats the ALL_DESIGNERS_SENTINEL as a shared-access wildcard', () => {
    // The "Tüm Tasarımcılar" pass must short-circuit the loop so a
    // project whose İç Sayfalar carries the sentinel does not flag
    // any of its declared designers as orphans, even if some of them
    // aren't explicitly assigned to any other subtask.
    assert.match(
      subtaskAssigneeSrc,
      /ALL_DESIGNERS_SENTINEL/,
      'helper must reference the sentinel constant',
    )
    // The early-return / continue branch is the only legitimate way to
    // exit the per-id loop without raising.
    assert.match(
      subtaskAssigneeSrc,
      /if \(sentinels\.size > 0\) return/,
      'helper must early-return when any subtask carries the sentinel',
    )
  })

  it('skips the primary (first id) and accepts any id present in the subtask-assignee set', () => {
    // Pull just the loop body so a future edit that adds a third
    // branch doesn't quietly regress the rule.
    const loopMatch = subtaskAssigneeSrc.match(
      /for \(const id of declaredAssignees\)\s*\{[\s\S]*?\n\s{2}\}/,
    )
    assert.ok(loopMatch, 'orphan-guard for-loop not found in helper')
    const body = loopMatch[0]
    assert.match(body, /if \(id === primary\) continue/)
    assert.match(body, /if \(subAssigneeIds\.has\(id\)\) continue/)
  })
})

// ─── Fix 1b: createProject wires the helper in ────────────────────────

describe('createProject — orphan-designer check wired in', () => {
  it('calls assertNoOrphanDesigners before any inserts', () => {
    // The check has to run BEFORE the withTx block — surfacing a
    // 400 from inside the transaction would still abort, but it would
    // also acquire a row lock + open a tx for nothing.
    assert.match(
      createProjectSrc,
      /assertNoOrphanDesigners\(\s*assignees,\s*subtasks,\s*subtaskAssignees\s*\)/,
      'createProject must call assertNoOrphanDesigners with the wire payload',
    )
  })

  it('translates OrphanDesignerError into a 400 with the same Turkish message', () => {
    // The translation has to happen at the createProject boundary so
    // the transaction stays out of the picture for a malformed save.
    const createBlock = createProjectSrc.match(
      /try\s*\{\s*assertNoOrphanDesigners[\s\S]*?catch \([\s\S]*?\n\s{2}\}/,
    )
    assert.ok(createBlock, 'try/catch around assertNoOrphanDesigners not found')
    assert.match(createBlock[0], /instanceof OrphanDesignerError/)
    assert.match(createBlock[0], /badRequest\(err\.message\)/)
  })
})

// ─── Fix 1c: PUT route now uses the shared helper ─────────────────────

describe('PUT /projects/:id/subtasks — orphan-designer check uses shared helper', () => {
  it('calls assertNoOrphanDesigners with request.body.assignees', () => {
    assert.match(
      subtasksRouteSrc,
      /assertNoOrphanDesigners\(\s*request\.body\.assignees,\s*subtasks,\s*\{\s*\}\s*\)/,
      'PUT route must call the shared helper (the empty {} is fine — PUT-shape payloads carry assigned_to on each subtask, not in a side map)',
    )
  })

  it('translates OrphanDesignerError into a 400 with the same Turkish message', () => {
    // The catch has to translate the helper's typed error so the
    // client sees the same wording the helper produced — without the
    // translation the catch would rethrow a domain error the global
    // mapper turns into a 500.
    assert.match(
      subtasksRouteSrc,
      /if \(err instanceof OrphanDesignerError\) badRequest\(err\.message\)/,
    )
  })
})

// ─── Fix 2: project-scoped designer-batches gate ──────────────────────

describe('POST /subtasks/:id/designer-batches — project-scoped gate', () => {
  it('loads sub.assigned_to into the SELECT so the gate can read it', () => {
    // Before this fix the SELECT omitted `assigned_to`, so the
    // sub.assigned_to === null branch couldn't run. The route now
    // needs the column to tell a single-owner subtask apart from a
    // Tüm-Tasarımcılar (assigned_to IS NULL) subtask.
    const selectMatch = subtasksRouteSrc.match(
      /SELECT id, project_id, title, kind,[^\n]*FROM subtasks[\s\S]*?WHERE id = \$1 FOR UPDATE/,
    )
    assert.ok(selectMatch, 'designer-batches SELECT not found')
    assert.match(
      selectMatch[0],
      /assigned_to/,
      'designer-batches SELECT must include assigned_to so the project-scope gate can read it',
    )
  })

  it('rejects a designer who is not on the project when sub.assigned_to IS NULL', () => {
    // The gate must (1) only apply when sub.assigned_to IS NULL
    // (i.e. Tüm Tasarımcılar — the only path that lets multiple
    // designers write), and (2) check the designer's project
    // membership via loadProjectAssignees. The single-owner case
    // (sub.assigned_to set) is already gated by the subtask row's
    // own assigned_to FK + the existing ownership check.
    const gateBlock = subtasksRouteSrc.match(
      /sub\.assigned_to === null[\s\S]*?projectDesignerIds\.has\(designerId\)[\s\S]*?badRequest\([\s\S]*?\)/,
    )
    assert.ok(gateBlock, 'project-scoped gate block not found in designer-batches handler')
    assert.match(gateBlock[0], /loadProjectAssignees\(/)
    assert.match(
      gateBlock[0],
      /yalnızca projedeki tasarımcılar/i,
      'gate must speak the leader-friendly Turkish wording',
    )
  })

  it('skips the gate for team leaders (they can log on behalf of any designer)', () => {
    // The leader override is by design — they manage the team's
    // pages and need to be able to log on someone's behalf when a
    // designer is sick or stuck. The gate must early-return for
    // isLeader.
    const gateMatch = subtasksRouteSrc.match(
      /if \(!isLeader && sub\.assigned_to === null\)/,
    )
    assert.ok(gateMatch, 'gate must be wrapped in !isLeader so leaders always pass')
  })
})
