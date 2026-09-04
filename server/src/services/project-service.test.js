/**
 * Service tests for the project pipeline orchestration layer.
 *
 * Drives the REAL `project-service.js` functions — entity, repository SQL,
 * stage_history and notification fan-out all included — against an
 * in-memory pg client. The client is passed in directly via the `runProjectCommand`
 * seam (mirrors the orders-service pattern: the orchestrator accepts an
 * optional pre-opened tx client, production never passes one).
 *
 * What this file asserts is what the entity can't do for itself:
 *   - lock acquisition via getProjectForUpdate,
 *   - prepare hook loading assignees / subtasks / team-leader set,
 *   - `changedFields` only writes columns the entity actually mutated,
 *   - idempotent no-ops return the row without writing, logging, or notifying,
 *   - the reject two-write path: project row via patchProject + subtask
 *     UPDATEs via the separate `after` hook,
 *   - history rows land with the right from_stage / to_stage / action.
 *
 * `createProject` and `importLegacyProjects` are not covered here — their
 * bespoke body parsing is tested by the integration smoke against a real
 * DB; unit-testing the heavy SQL composition adds little value.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import * as service from './project-service.js'

const L1 = { id: 'L1', role: 'team_leader', name: 'Ayşenur' }
const D1 = { id: 'D1', role: 'designer', name: 'Rahşan' }
const P1 = { id: 'P1', role: 'printer', name: 'Oktay' }

function projectRow(overrides = {}) {
  return {
    id: 'p-1',
    title: 'Test Book',
    type: 'TR',
    stage: 'tasarim',
    assigned_to: null,
    created_by: 'L1',
    target_month: null,
    demo_attempt: 0,
    ozalit_attempt: 0,
    pass_number: 1,
    pass_kind: 'first_edition',
    last_reject_reason: null,
    progress: 0,
    version: 1,
    ozalit_leader_approved: false,
    ozalit_leader_approved_by: null,
    ozalit_leader_approved_at: null,
    ozalit_designer_approvals: [],
    demo_held: false,
    demo_held_at: null,
    demo_held_by_name: null,
    demo_received: false,
    demo_received_by: null,
    demo_received_at: null,
    ozalit_received: false,
    ozalit_received_by: null,
    ozalit_received_at: null,
    baski_onay_prepared: false,
    baski_onay_prepared_by: null,
    baski_onay_prepared_by_name: null,
    baski_onay_prepared_at: null,
    demo_delivered_at: null,
    demo_delivered_by: null,
    ozalit_requested: false,
    reject_target: null,
    last_reject_type: null,
    last_reject_target: null,
    ozalit_approvals: [],
    demo_started: false,
    demo_started_at: null,
    demo_started_by: null,
    demo_started_by_name: null,
    demo_change_requested_at: null,
    demo_change_requested_by: null,
    demo_change_requested_by_name: null,
    demo_change_requested_note: null,
    demo_fix_pending: false,
    ozalit_started: false,
    ozalit_started_at: null,
    ozalit_started_by: null,
    ozalit_started_by_name: null,
    ozalit_change_requested_at: null,
    ozalit_change_requested_by: null,
    ozalit_change_requested_by_name: null,
    ozalit_change_requested_note: null,
    ozalit_fix_pending: false,
    ekran_demo_requested_at: null,
    ekran_demo_requested_by: null,
    ekran_demo_requested_by_name: null,
    catalog_hidden: false,
    origin: 'pipeline',
    has_product_info: false,
    assignees: [],
    subtasks: [],
    // Per-parça approval ledgers (migrations 068/069/070) — defaults
    // match rowToProject in project-repository so the diff in
    // changedFields() doesn't false-positive.
    demo_parca_approvals: [],
    demo_parca_rejections: [],
    ozalit_parca_approvals: {},
    ozalit_parca_rejections: [],
    baski_parca_preparers: {},
    baski_parca_approvals: {},
    cin_baski_parca_preparers: {},
    cin_baski_parca_approvals: {},
    ...overrides,
  }
}

/**
 * In-memory pg client. SQL matching is fragment-based so the same fake
 * serves the project lock, the UPDATE, the history insert, the assignees
 * + subtasks + leader loads, and the subtask UPDATEs on reject. Anything
 * unmatched returns no rows — which is what makes the notification fan-out
 * a harmless no-op (emit() bails when the recipient set is empty).
 */
function makeClient({ project, subtasks = [], assignees = [], leaders = [] } = {}) {
  const calls = []
  let currentProject = project ? { ...project } : null
  const client = {
    calls,
    afterCommit() {},
    matching(re) {
      return calls.filter((c) => re.test(c.sql))
    },
    one(re) {
      const found = client.matching(re)
      assert.equal(found.length, 1, `expected exactly 1 query matching ${re}, got ${found.length}`)
      return found[0]
    },
    async query(sql, params = []) {
      calls.push({ sql, params })

      if (/FROM projects WHERE id = \$1 AND deleted_at IS NULL FOR UPDATE/.test(sql)) {
        return { rows: currentProject ? [currentProject] : [] }
      }
      if (/UPDATE projects SET/.test(sql)) {
        // Apply SET columns to our in-memory copy, then RETURN it.
        const setClause = sql.slice(sql.indexOf(' SET ') + 5, sql.indexOf(' WHERE '))
        const updated = { ...currentProject, updated_at: 'NOW()' }
        for (const [, col, idx] of setClause.matchAll(/(\w+) = \$(\d+)/g)) {
          const v = params[Number(idx) - 1]
          updated[col] = typeof v === 'string' && /^[[{]/.test(v) ? JSON.parse(v) : v
        }
        // `updated_at = NOW()` is always appended; skip it in the patch map.
        delete updated.updated_at
        currentProject = updated
        return { rows: [updated] }
      }
      if (/INTO stage_history/.test(sql)) return { rows: [] }
      if (/FROM subtasks s[\s\S]*LEFT JOIN users u ON u\.id = s\.assigned_to/.test(sql)) {
        return { rows: subtasks.map((s) => ({ ...s, assigned_name: s.assigned_name ?? null })) }
      }
      if (/FROM stage_history h[\s\S]*LEFT JOIN users u ON u\.id = h\.done_by/.test(sql)) {
        return { rows: [] }
      }
      if (/FROM users u WHERE u\.id = \$\d+\s+ORDER BY s\.position/.test(sql)) {
        // loadProjectAssignees' subtask-owner scan
        return { rows: assignees.map((a) => ({ ...a, assignee_name: a.name })) }
      }
      if (/SELECT id, name FROM users WHERE id = \$1/.test(sql)) {
        const u = assignees.find((a) => a.id === params[0])
        return { rows: u ? [u] : [] }
      }
      if (/role = (?:'team_leader'|ANY\(\$1\)) AND is_active = TRUE/.test(sql)) {
        return { rows: leaders.map((id) => ({ id })) }
      }
      if (/UPDATE subtasks[\s\S]*SET is_done/.test(sql)) {
        return { rows: [] }
      }
      if (/INSERT INTO demos/.test(sql)) {
        return { rows: [{ id: 'd-test' }] }
      }
      return { rows: [] }
    },
  }
  return client
}

function historyRows(client) {
  return client.matching(/INTO stage_history/).map((c) => ({
    project_id: c.params[0],
    from_stage: c.params[1],
    to_stage: c.params[2],
    action: c.params[3],
    event: c.params[4],
    reason: c.params[5],
    reject_target: c.params[6],
    pass_number: c.params[7],
    done_by: c.params[8],
    note: c.params[9],
    demo_id: c.params[10],
  }))
}

function updatePatch(client) {
  const call = client.one(/UPDATE projects SET/)
  const patch = {}
  const setClause = call.sql.slice(call.sql.indexOf(' SET ') + 5, call.sql.indexOf(' WHERE '))
  for (const [, col, idx] of setClause.matchAll(/(\w+) = \$(\d+)/g)) {
    patch[col] = call.params[Number(idx) - 1]
  }
  return patch
}

describe('project-service — idempotent no-ops', () => {
  it('short-circuits a repeat "Teslim Alındı"', async () => {
    const project = projectRow({ stage: 'demo_onay', demo_received: true, assignees: [D1] })
    const client = makeClient({ project, assignees: [D1] })

    const result = await service.receiveDemo('p-1', L1, client)

    assert.equal(client.matching(/UPDATE projects SET/).length, 0)
    assert.equal(client.matching(/INTO stage_history/).length, 0)
    assert.equal(result.id, 'p-1')
  })

  it('short-circuits a repeat "Başladım"', async () => {
    const project = projectRow({ stage: 'demo_teslim', demo_started: true })
    const client = makeClient({ project })

    await service.demoStart('p-1', P1, client)

    assert.equal(client.matching(/UPDATE projects SET/).length, 0)
  })
})

describe('project-service — persistence diffing', () => {
  it('writes only the columns the entity changed (demoReceive)', async () => {
    const project = projectRow({ stage: 'demo_onay', demo_received: false, assignees: [D1] })
    const client = makeClient({ project, assignees: [D1] })

    await service.receiveDemo('p-1', L1, client)

    const patch = updatePatch(client)
    assert.deepEqual(Object.keys(patch).sort(), [
      'demo_received', 'demo_received_at', 'demo_received_by',
    ])
    assert.equal(patch.demo_received, true)
  })

  it('loads assignees via the prepare hook for verbs that need them', async () => {
    // demoStart's prepare hook calls loadProjectAssignees unconditionally.
    // With assigned_to set, the function issues a SELECT for the primary
    // designer; with subtask owners it issues a second one for them.
    const project = projectRow({ stage: 'demo_teslim', assigned_to: 'D1' })
    const client = makeClient({ project, assignees: [D1] })

    await service.demoStart('p-1', P1, client)

    // 1 from prepare + 0 from dispatch (entity carries assignees forward,
    // notifyDemoStarted uses the ones we pass instead of re-loading).
    assert.equal(client.matching(/SELECT id, name FROM users/).length, 1)
  })

  it('loads the active team-leader set for baski-onay-prepare', async () => {
    const project = projectRow({ stage: 'baski_onay', baski_onay_prepared: false })
    const client = makeClient({ project, leaders: ['L1', 'L2'] })

    await service.baskiOnayPrepare('p-1', L1, {}, client)

    // activeUserIdsByRole uses `role = ANY($1)` (not a literal match).
    assert.equal(client.matching(/role = ANY\(\$1\)/).length, 1)
  })

  it('the entity carries assignees forward, so the notification does not re-load them', async () => {
    // demoCancel fans out to printers only — no team_leader load is needed,
    // and the entity's assignees should satisfy the dispatch without a
    // second loadProjectAssignees call.
    const project = projectRow({ stage: 'demo_teslim', assigned_to: 'D1' })
    const client = makeClient({ project, assignees: [D1] })

    await service.demoCancel('p-1', L1, client)

    // demoCancel's prepare fires loadProjectAssignees once (1 SELECT).
    // The notification (notifyDemoCancelled → printers) does NOT re-load
    // assignees, so the total stays at 1.
    assert.equal(client.matching(/SELECT id, name FROM users/).length, 1)
  })
})

describe('project-service — advance', () => {
  it('writes the stage transition and emits the right history row', async () => {
    // Ozalit rejection leaves the project on ozalit_onay (not tasarim) so
    // the redo cycle stays anchored to the Ozalit half of the pipeline.
    const project = projectRow({ stage: 'ozalit_onay', last_reject_type: 'ozalit', progress: 100 })
    const client = makeClient({ project })

    await service.advanceProject('p-1', L1, { route: 'ozalit' }, client)

    const rows = historyRows(client)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].from_stage, 'ozalit_onay')
    assert.equal(rows[0].to_stage, 'ozalit_teslim')
    assert.equal(rows[0].action, 'advance')
    const patch = updatePatch(client)
    assert.equal(patch.stage, 'ozalit_teslim')
    assert.equal(patch.ozalit_requested, true)
  })

  it('404s an unknown project', async () => {
    const client = makeClient({ project: null })
    await assert.rejects(
      () => service.advanceProject('p-nope', L1, {}, client),
      (err) => { assert.equal(err.status, 404); return true },
    )
  })

  it('SQL guard: refuses a stale write the entity accepted (zero rows → 409)', async () => {
    // Defence-in-depth contract. The `runProjectCommand` orchestrator
    // always passes the locked row's version as `expectedVersion` to
    // patchProject; if a concurrent writer has bumped the row's version
    // past the orchestrator's snapshot, the UPDATE matches zero rows and
    // patchProject throws 409 with the same Turkish phrase the Order
    // entity uses. This test simulates the race by returning zero rows
    // from the UPDATE — exactly what the real DB does on a stale write.
    const project = projectRow({ stage: 'tasarim', progress: 100 })
    const client = makeClient({ project })
    const baseQuery = client.query
    client.query = async (sql, params = []) => {
      const result = await baseQuery(sql, params)
      if (/UPDATE projects SET/.test(sql)) {
        // Concurrent writer won — the WHERE version=$X matched nothing.
        return { rows: [] }
      }
      return result
    }

    await assert.rejects(
      () => service.advanceProject('p-1', L1, {}, client),
      (err) => {
        assert.equal(err.status, 409, 'http status must be 409')
        assert.equal(err.code, 'conflict', 'code must be "conflict"')
        assert.match(err.message, /Bu kayıt başka biri tarafından güncellendi\./)
        return true
      },
    )
    // No history / notification fan-out: the 409 aborts the tx before any
    // side effect runs.
    assert.equal(client.matching(/INTO stage_history/).length, 0)
  })

  it('SQL guard: the WHERE clause carries version = $expectedVersion alongside id = $1', async () => {
    // Source-level contract: the orchestrator always passes the locked
    // row's version as `expectedVersion`, so the WHERE version=$X guard
    // rides on every UPDATE the orchestrator emits. A refactor that drops
    // the expectedVersion argument silently re-introduces the race.
    const project = projectRow({ stage: 'tasarim', progress: 100, version: 11 })
    const client = makeClient({ project })

    await service.advanceProject('p-1', L1, {}, client)

    const call = client.one(/UPDATE projects SET/)
    assert.match(call.sql, /WHERE id = \$1\s+AND version = \$3/)
    // The third parameter is expectedVersion (params[0] = id, params[1..] = the
    // set fields — for an `advance` from `tasarim` those are `stage` and
    // `ozalit_requested`).
    assert.equal(call.params[2], 11)
    // SQL owns the version increment.
    assert.match(call.sql, /version = version \+ 1/)
  })
})

describe('project-service — reject', () => {
  it('flags the chosen subtasks via the separate UPDATE loop, in the same tx', async () => {
    const subtasks = [
      { id: 'sub-1', kind: 'check', is_done: true, done_at: 'x', pages_done: null, needs_revize: false },
      { id: 'sub-2', kind: 'check', is_done: true, done_at: 'x', pages_done: null, needs_revize: false },
    ]
    const project = projectRow({
      stage: 'demo_onay', demo_received: true,
      progress: 50,
      subtasks: undefined, // loaded by prepare hook via listProjectSubtasks
    })
    const client = makeClient({ project, subtasks })

    await service.rejectProject('p-1', L1, {
      reason: 'yanlış renk', rejectTarget: 'designer', revizeIds: ['sub-1'],
    }, client)

    // One UPDATE on projects, plus one UPDATE per subtask.
    assert.equal(client.matching(/UPDATE projects SET/).length, 1)
    const subUpdates = client.matching(/UPDATE subtasks[\s\S]*SET is_done/)
    assert.equal(subUpdates.length, 2, 'one UPDATE per subtask, all in-tx')
    assert.deepEqual(subUpdates[0].params, ['sub-1', true, 'x', null, true])
    assert.deepEqual(subUpdates[1].params, ['sub-2', true, 'x', null, false])
  })

  it('does NOT issue subtask UPDATEs on a reject-to-matbaa', async () => {
    const project = projectRow({
      stage: 'demo_onay', demo_received: true, type: 'TR', demo_attempt: 2,
    })
    const client = makeClient({ project })

    await service.rejectProject('p-1', L1, { reason: 'x', rejectTarget: 'matbaa' }, client)

    assert.equal(client.matching(/UPDATE subtasks/).length, 0)
    const patch = updatePatch(client)
    assert.equal(patch.reject_target, 'matbaa')
    assert.equal(patch.demo_attempt, 3)
  })

  it('writes the reject history row with reason and target', async () => {
    const project = projectRow({ stage: 'demo_onay', demo_received: true })
    const client = makeClient({ project })

    await service.rejectProject('p-1', L1, { reason: 'yanlış', rejectTarget: 'designer' }, client)

    const [hist] = historyRows(client)
    assert.equal(hist.action, 'reject')
    assert.equal(hist.reason, 'yanlış')
    assert.equal(hist.reject_target, 'designer')
  })
})

describe('project-service — baski_onay approve', () => {
  it('rejects non-leader', async () => {
    const project = projectRow({ stage: 'baski_onay', baski_onay_prepared: true, progress: 100 })
    const client = makeClient({ project })

    await assert.rejects(
      () => service.approveProject('p-1', D1, { stage: 'baski_onay' }, client),
      /Baskı onayını yalnızca ekip lideri/,
    )
  })
})

/* Regression tests for the prepared-ctx forwarding pattern.

   The bug class: a `run: (project) => project.X(actor)` arrow that drops
   the second arg from `runProjectCommand`. Without the prepared ctx
   (designerIds / teamLeaderIds / demoId), the FSM silently blocks
   designers from receipt/correction and the multi-party approval gates
   misfire. Each test below would have failed against the buggy service. */
describe('project-service — prepared-ctx forwarding', () => {
  // loadProjectAssignees's subtask-owner scan SQL isn't fully matched by
  // this mock, so each "designer is on the project" test sets
  // `assigned_to: 'D1'` to drive the single-user branch the mock DOES match.
  it('receiveDemo: an assigned designer can mark the demo "Teslim Alındı"', async () => {
    const project = projectRow({ stage: 'demo_onay', demo_received: false, assigned_to: 'D1', assignees: [D1] })
    const client = makeClient({ project, assignees: [D1] })

    const result = await service.receiveDemo('p-1', D1, client)

    assert.equal(result.demo_received, true)
    assert.equal(result.demo_received_by, 'Rahşan')
    const patch = updatePatch(client)
    assert.equal(patch.demo_received, true)
  })

  it('receiveDemo: an unassigned designer is still refused by the gate', async () => {
    const project = projectRow({ stage: 'demo_onay', demo_received: false })
    const client = makeClient({ project, assignees: [] })

    await assert.rejects(
      () => service.receiveDemo('p-1', D1, client),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('demoNotReceived: an assigned designer can report "Teslim Alınamadı"', async () => {
    const project = projectRow({
      stage: 'demo_onay', demo_received: false, type: 'TR', demo_attempt: 1,
      assigned_to: 'D1', assignees: [D1],
    })
    const client = makeClient({ project, assignees: [D1] })

    const result = await service.demoNotReceived('p-1', D1, client)

    assert.equal(result.stage, 'demo_teslim')
    assert.equal(result.demo_attempt, 2)
  })

  it('ozalitReceive: an assigned designer can mark the ozalit "Teslim Alındı"', async () => {
    const project = projectRow({ stage: 'ozalit_onay', ozalit_received: false, assigned_to: 'D1', assignees: [D1] })
    const client = makeClient({ project, assignees: [D1] })

    const result = await service.ozalitReceive('p-1', D1, client)

    assert.equal(result.ozalit_received, true)
    assert.equal(result.ozalit_received_by, 'Rahşan')
  })

  it('ozalitNotReceived: an assigned designer can report ozalit "Teslim Alınamadı"', async () => {
    const project = projectRow({
      stage: 'ozalit_onay', ozalit_received: false, ozalit_attempt: 1,
      assigned_to: 'D1', assignees: [D1],
    })
    const client = makeClient({ project, assignees: [D1] })

    const result = await service.ozalitNotReceived('p-1', D1, client)

    assert.equal(result.stage, 'ozalit_teslim')
    assert.equal(result.ozalit_attempt, 2)
    assert.equal(result.reject_target, 'matbaa')
    assert.deepEqual(result.ozalit_approvals, [])
  })

  it('approveProject at ozalit_onay: an assigned designer passes the role gate (then trips leader-first)', async () => {
    const project = projectRow({
      stage: 'ozalit_onay', ozalit_received: true,
      assigned_to: 'D1', assignees: [D1],
      ozalit_approvals: [], progress: 100,
    })
    const client = makeClient({ project, assignees: [D1], leaders: ['L1', 'L2'] })

    await assert.rejects(
      () => service.approveProject('p-1', D1, { stage: 'ozalit_onay' }, client),
      /Önce ekip lideri onaylamalıdır/,
    )
  })

  it('approveProject at baski_onay: the preparer cannot self-approve when another leader is active', async () => {
    const project = projectRow({
      stage: 'baski_onay',
      baski_onay_prepared: true,
      baski_onay_prepared_by: 'L1',
      progress: 100,
      assignees: [],
    })
    const client = makeClient({ project, leaders: ['L1', 'L2'] })

    await assert.rejects(
      () => service.approveProject('p-1', L1, { stage: 'baski_onay' }, client),
      /Baskı onay formunu hazırlayan kişi kendi onayını veremez/,
    )
  })

  it('demoEditNotify: the corrected sheet\'s id lands on the timeline row', async () => {
    const project = projectRow({ stage: 'demo_teslim', demo_started: false })
    const client = makeClient({ project })

    await service.demoEditNotify('p-1', L1, { payload: { items: [] }, attempt: 1 }, client)

    const [hist] = historyRows(client)
    assert.equal(hist.event, 'demo_form_edited')
    assert.equal(hist.demo_id, 'd-test')
  })

  it('ozalitEditNotify: the corrected sheet\'s id lands on the timeline row', async () => {
    const project = projectRow({
      stage: 'ozalit_teslim', ozalit_started: false, ozalit_requested: true,
    })
    const client = makeClient({ project })

    await service.ozalitEditNotify('p-1', L1, { payload: { items: [] }, attempt: 1 }, client)

    const [hist] = historyRows(client)
    assert.equal(hist.event, 'ozalit_form_edited')
    assert.equal(hist.demo_id, 'd-test')
  })
})

// getProjectDetail's unit coverage: skipped because the repo's listXxx
// functions all go through getPool(), and ESM imports are read-only, so
// we can't stub getPool from the test. The composition itself is
// trivial (four parallel reads + one shape merge), and the four repo
// functions it calls each have their own tests. The end-to-end shape is
// covered by the integration smoke against the dev DB.
