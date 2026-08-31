/**
 * Service tests for the sipariş orchestration layer.
 *
 * These drive the REAL `orders-service.js` functions — entity, repository
 * SQL, project timeline and notification fan-out all included — against an
 * in-memory pg client. Each command takes an optional trailing `client`
 * (the transaction to run inside), which is the seam used here; the routes
 * never pass one, so production still opens a transaction per request.
 *
 * What's asserted is the orchestration the entity can't do for itself:
 *   - only the columns the entity actually changed get written,
 *   - `version` / `updated_at` are always bumped by SQL, never by the entity,
 *   - the order_history row, project timeline rows and notifications fire in
 *     the right shape, and are skipped entirely on an idempotent no-op,
 *   - cross-aggregate work — revize flags feeding the timeline note, the
 *     forward-only project stage flip — lands correctly.
 *
 * `createOrder` is not covered here: its only pre-transaction step is a
 * pool-level `getProject` + `assertOrderable`, which `domain/pipeline.test.js`
 * already covers.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import * as service from './orders-service.js'

const L1 = { id: 'L1', role: 'team_leader', name: 'Ayşenur' }
const L2 = { id: 'L2', role: 'team_leader', name: 'İkinci Lider' }
const D1 = { id: 'D1', role: 'designer', name: 'Abdijibar' }
const printer = { id: 'P1', role: 'printer', name: 'Oktay' }

function orderRow(overrides = {}) {
  return {
    id: 'o-1',
    project_id: 'p-1',
    status: 'pending',
    requested_by: 'S1',
    payload: { items: [{ name: 'Kapak' }], quantity: 500, notes: 'acele' },
    assignee_ids: [],
    matbaa_received: false,
    matbaa_received_by: null,
    matbaa_received_at: null,
    matbaa_approvals: [],
    ozalit_started: false,
    ozalit_started_by: null,
    ozalit_started_by_name: null,
    ozalit_started_at: null,
    ozalit_change_requested_at: null,
    ozalit_change_requested_by: null,
    ozalit_change_requested_by_name: null,
    ozalit_change_requested_note: null,
    ozalit_fix_pending: false,
    last_reject_type: null,
    baski_onay_form: {},
    ozalit_attempt: 0,
    version: 3,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * In-memory pg client. Queries are matched on a distinctive fragment of the
 * SQL, so the same fake serves the order lock, the update, the history
 * inserts and every notification lookup. Everything it sees is recorded on
 * `calls` for assertions; anything unmatched answers with no rows, which is
 * what makes the notification fan-out a harmless no-op (emit() bails when
 * the recipient set is empty).
 */
function makeClient({ order, project = { id: 'p-1', stage: 'satista', type: 'TR', title: 'Kitap' },
  subtask = null, leaders = [], users = {}, revizeTitles = [] } = {}) {
  const calls = []
  const client = {
    calls,
    afterCommit() {},
    /** Every recorded query whose SQL matches `re`. */
    matching(re) {
      return calls.filter((c) => re.test(c.sql))
    },
    /** The single recorded query matching `re` — asserts there is exactly one. */
    one(re) {
      const found = client.matching(re)
      assert.equal(found.length, 1, `expected exactly 1 query matching ${re}, got ${found.length}`)
      return found[0]
    },
    async query(sql, params = []) {
      calls.push({ sql, params })

      if (/FROM order_requests WHERE id = \$1 FOR UPDATE/.test(sql)) {
        return { rows: order ? [order] : [] }
      }
      if (/UPDATE order_requests/.test(sql)) {
        // Mirror the real UPDATE: apply the SET values, bump version.
        const next = { ...order, version: order.version + 1, updated_at: 'NOW()' }
        const cols = [...sql.slice(sql.indexOf(' SET '), sql.indexOf(' WHERE ')).matchAll(/(\w+) = \$(\d+)/g)]
        for (const [, col, idx] of cols) {
          const value = params[Number(idx) - 1]
          next[col] = typeof value === 'string' && /^[[{]/.test(value) ? JSON.parse(value) : value
        }
        return { rows: [next] }
      }
      if (/INTO order_history/.test(sql)) return { rows: [] }
      if (/UPDATE order_subtasks SET needs_revize/.test(sql)) {
        return { rows: revizeTitles.map((title) => ({ title })) }
      }
      if (/FROM order_subtasks WHERE id = \$1/.test(sql)) {
        return { rows: subtask ? [subtask] : [] }
      }
      if (/UPDATE order_subtasks SET/.test(sql)) {
        const next = { ...subtask }
        const cols = [...sql.matchAll(/(\w+) = \$(\d+)/g)]
        for (const [, col, idx] of cols) next[col] = params[Number(idx) - 1]
        return { rows: [next] }
      }
      if (/role = 'team_leader' AND is_active = TRUE/.test(sql)) {
        return { rows: leaders.map((id) => ({ id })) }
      }
      if (/SELECT id, role, is_active FROM users WHERE id = \$1/.test(sql)) {
        const u = users[params[0]]
        return { rows: u ? [u] : [] }
      }
      if (/FROM projects WHERE id = \$1 AND deleted_at IS NULL FOR UPDATE/.test(sql)) {
        return { rows: project ? [project] : [] }
      }
      if (/UPDATE projects SET/.test(sql)) return { rows: [{ ...project, stage: params[1] }] }
      if (/INTO stage_history/.test(sql)) return { rows: [] }
      return { rows: [] }
    },
  }
  return client
}

/**
 * The field patch a command sent to `order_requests`, as {column: value}.
 * Only the SET clause is parsed — `WHERE id = $1` is not a written column.
 */
function setClauseOf(sql) {
  return sql.slice(sql.indexOf(' SET '), sql.indexOf(' WHERE '))
}

function updatePatch(client) {
  const call = client.one(/UPDATE order_requests/)
  const patch = {}
  for (const [, col, idx] of setClauseOf(call.sql).matchAll(/(\w+) = \$(\d+)/g)) {
    patch[col] = call.params[Number(idx) - 1]
  }
  return { patch, sql: call.sql }
}

/** Every stage_history row a command wrote, as {event, note, to_stage}. */
function timeline(client) {
  return client.matching(/INTO stage_history/).map((c) => ({
    project_id: c.params[0],
    from_stage: c.params[1],
    to_stage: c.params[2],
    action: c.params[3],
    event: c.params[4],
    reason: c.params[5],
    reject_target: c.params[6],
    note: c.params[9],
    demo_id: c.params[10],
  }))
}

describe('orders-service — persistence diffing', () => {
  it('writes only the columns the entity changed, and lets SQL own version/updated_at', async () => {
    const order = orderRow({ status: 'matbaa_onay', assignee_ids: ['D1'] })
    const client = makeClient({ order })

    await service.receiveMatbaaOzalit('o-1', L1, client)

    const { patch, sql } = updatePatch(client)
    assert.deepEqual(Object.keys(patch).sort(), [
      'matbaa_received', 'matbaa_received_at', 'matbaa_received_by',
    ], 'only the receipt columns are touched')
    assert.equal(patch.matbaa_received, true)
    assert.equal(patch.matbaa_received_by, 'Ayşenur')
    assert.match(sql, /version = version \+ 1/)
    assert.match(sql, /updated_at = NOW\(\)/)
    // `version` lives in the SET clause only as the SQL-side increment
    // (`version = version + 1`); the WHERE clause carries the optimistic-
    // concurrency guard (`version = $N`) which is a parameter, not the
    // entity writing back. Assert the SET specifically so the two stay
    // distinct — a future change that parameterises the SET would
    // silently break optimistic concurrency otherwise.
    const setClause = sql.match(/SET\s+(.*?)\s+WHERE/s)?.[1] ?? ''
    assert.doesNotMatch(setClause, /version = \$/, 'version is never written from memory in SET')
  })

  it('still bumps version when a command changes no column at all', async () => {
    // Re-approving an already-signed matbaa_onay round: the ledger is
    // unchanged, but the optimistic-concurrency counter must still move.
    const order = orderRow({
      status: 'matbaa_onay',
      matbaa_received: true,
      assignee_ids: ['D1'],
      matbaa_approvals: [{ id: 'L1', role: 'team_leader', name: 'Ayşenur', at: '2026-08-01T00:00:00.000Z' }],
    })
    const client = makeClient({ order, leaders: ['L1', 'L2'] })

    await service.advanceOrder('o-1', L1, {}, client)

    const { sql } = updatePatch(client)
    assert.doesNotMatch(sql, /matbaa_approvals = \$/, 'identical ledger is not rewritten')
    assert.match(sql, /SET version = version \+ 1/)
  })

  it('stringifies jsonb columns and casts them', async () => {
    const order = orderRow({ status: 'pending' })
    const client = makeClient({ order, users: { D1: { id: 'D1', role: 'designer', is_active: true } } })

    await service.advanceOrder('o-1', L1, { assignees: ['D1'] }, client)

    const { patch, sql } = updatePatch(client)
    assert.match(sql, /assignee_ids = \$\d+::jsonb/)
    assert.equal(patch.assignee_ids, '["D1"]', 'passed as a JSON string, not a pg array literal')
  })
})

describe('orders-service — idempotent no-ops', () => {
  it('short-circuits a repeat "Teslim Alındı" with no write, no history, no notify', async () => {
    const order = orderRow({ status: 'matbaa_onay', matbaa_received: true, assignee_ids: ['D1'] })
    const client = makeClient({ order })

    const result = await service.receiveMatbaaOzalit('o-1', L1, client)

    assert.equal(client.matching(/UPDATE order_requests/).length, 0)
    assert.equal(client.matching(/INTO order_history/).length, 0)
    assert.equal(client.matching(/INTO stage_history/).length, 0)
    assert.equal(client.matching(/INTO notifications/).length, 0)
    assert.equal(result.payload, undefined, 'payload is stripped from the echoed row')
    assert.equal(result.id, 'o-1')
    assert.equal(result.version, 3, 'version is untouched')
  })

  it('short-circuits a repeat "Başladım"', async () => {
    const order = orderRow({ status: 'tasarimci_onay', ozalit_started: true })
    const client = makeClient({ order })

    const result = await service.startOzalit('o-1', printer, client)

    assert.equal(client.matching(/UPDATE order_requests/).length, 0)
    assert.equal(result.payload, undefined)
  })
})

describe('orders-service — advance', () => {
  it('validates assignees against the DB on the pending handoff', async () => {
    const client = makeClient({
      order: orderRow({ status: 'pending' }),
      users: { D1: { id: 'D1', role: 'designer', is_active: true } },
    })
    await service.advanceOrder('o-1', L1, { assignees: ['D1'] }, client)
    assert.equal(client.matching(/SELECT id, role, is_active FROM users/).length, 1)
  })

  it('rejects a non-designer assignee', async () => {
    const client = makeClient({
      order: orderRow({ status: 'pending' }),
      users: { L2: { id: 'L2', role: 'team_leader', is_active: true } },
    })
    await assert.rejects(
      () => service.advanceOrder('o-1', L1, { assignees: ['L2'] }, client),
      /tasarımcı değil/,
    )
  })

  it('rejects a passive designer', async () => {
    const client = makeClient({
      order: orderRow({ status: 'pending' }),
      users: { D1: { id: 'D1', role: 'designer', is_active: false } },
    })
    await assert.rejects(
      () => service.advanceOrder('o-1', L1, { assignees: ['D1'] }, client),
      /pasif durumda/,
    )
  })

  it('rejects an unknown assignee id', async () => {
    const client = makeClient({ order: orderRow({ status: 'pending' }), users: {} })
    await assert.rejects(
      () => service.advanceOrder('o-1', L1, { assignees: ['nope'] }, client),
      /Tasarımcı bulunamadı: nope/,
    )
  })

  it('logs the transfer then the advance on the project timeline', async () => {
    const client = makeClient({
      order: orderRow({ status: 'pending' }),
      users: { D1: { id: 'D1', role: 'designer', is_active: true } },
    })
    await service.advanceOrder('o-1', L1, { assignees: ['D1'] }, client)

    const rows = timeline(client)
    assert.deepEqual(rows.map((r) => r.event), ['order_transfer', 'order_advance'])
    assert.equal(rows[0].note, 'Baskı aktarımı: tasarımcı atandı')
    assert.equal(rows[1].note, 'Baskı tasarımcıya aktarıldı')
    assert.equal(rows[1].from_stage, 'satista')
    assert.equal(rows[1].to_stage, 'satista', 'an order advance never moves the project')
  })

  it('does not consult the active leader set outside matbaa_onay', async () => {
    const client = makeClient({ order: orderRow({ status: 'goruldu' }) })
    await service.advanceOrder('o-1', D1, {}, client)
    assert.equal(client.matching(/role = 'team_leader' AND is_active = TRUE/).length, 0)
  })

  it('loads active leaders for a matbaa_onay round and logs a partial approval', async () => {
    const order = orderRow({
      status: 'matbaa_onay', matbaa_received: true, assignee_ids: ['D1'],
    })
    const client = makeClient({ order, leaders: ['L1', 'L2'] })

    const result = await service.advanceOrder('o-1', L1, {}, client)

    assert.equal(client.matching(/role = 'team_leader' AND is_active = TRUE/).length, 1)
    assert.equal(result.status, 'matbaa_onay', 'a partial approval does not advance')
    const rows = timeline(client)
    assert.deepEqual(rows.map((r) => r.event), ['order_matbaa_approve'])
    assert.match(rows[0].note, /2 onay daha bekleniyor/)
  })

  it('advances and clears the ledger once every approver has signed', async () => {
    // L1 already signed; L2's click completes the round.
    const order = orderRow({
      status: 'matbaa_onay',
      matbaa_received: true,
      assignee_ids: [],
      matbaa_approvals: [{ id: 'L1', role: 'team_leader', name: 'Ayşenur', at: '2026-08-01T00:00:00.000Z' }],
    })
    const client = makeClient({ order, leaders: ['L1', 'L2'] })

    const result = await service.advanceOrder('o-1', L2, {}, client)

    assert.equal(result.status, 'siparis_baski_onay')
    const { patch } = updatePatch(client)
    assert.equal(patch.matbaa_approvals, '[]', 'ledger reset for the next round')
    assert.deepEqual(timeline(client).map((r) => r.event), ['order_advance'])
    assert.equal(timeline(client)[0].note, 'Baskı onay formuna gönderildi')
  })

  it('surfaces the version conflict as a 409 before touching anything', async () => {
    const client = makeClient({ order: orderRow({ status: 'goruldu', version: 7 }) })
    await assert.rejects(
      () => service.advanceOrder('o-1', D1, { expectedVersion: 3 }, client),
      (err) => {
        assert.equal(err.status, 409)
        assert.match(err.message, /başka biri tarafından güncellendi/)
        return true
      },
    )
    assert.equal(client.matching(/UPDATE order_requests/).length, 0)
  })

  it('refuses a bare advance at siparis_baski_onay', async () => {
    const client = makeClient({ order: orderRow({ status: 'siparis_baski_onay' }) })
    await assert.rejects(
      () => service.advanceOrder('o-1', L1, {}, client),
      /baskı onay formunu doldurup onaylamalısınız/,
    )
  })

  it('404s an unknown order', async () => {
    const client = makeClient({ order: null })
    await assert.rejects(
      () => service.advanceOrder('o-nope', L1, {}, client),
      (err) => { assert.equal(err.status, 404); return true },
    )
  })
})

describe('orders-service — reject', () => {
  it('names the flagged alt görev TITLES in the timeline note, not their ids', async () => {
    const order = orderRow({ status: 'matbaa_onay', assignee_ids: ['D1'] })
    const client = makeClient({ order, revizeTitles: ['Kapak', 'İç Sayfalar'] })

    await service.rejectOrder('o-1', L1, {
      reason: 'renk hatası', rejectTarget: 'designer', revizeIds: ['s-1', 's-2'],
    }, client)

    const flag = client.one(/UPDATE order_subtasks SET needs_revize/)
    assert.deepEqual(flag.params, ['o-1', ['s-1', 's-2']], 'scoped to this order')

    const rows = timeline(client)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].note, 'Baskı reddedildi (designer), revize: Kapak, İç Sayfalar')
    assert.equal(rows[0].reason, 'renk hatası')
    assert.equal(rows[0].reject_target, 'designer')
  })

  it('does not flag subtasks on a matbaa-target rejection', async () => {
    const order = orderRow({ status: 'matbaa_onay' })
    const client = makeClient({ order })

    await service.rejectOrder('o-1', L1, {
      reason: 'baskı kalitesi', rejectTarget: 'matbaa', revizeIds: ['s-1'],
    }, client)

    assert.equal(client.matching(/UPDATE order_subtasks SET needs_revize/).length, 0)
    assert.equal(timeline(client)[0].note, 'Baskı reddedildi (matbaa)')
  })

  it('wipes the receipt gate and bumps the ozalit round', async () => {
    const order = orderRow({
      status: 'matbaa_onay',
      matbaa_received: true,
      matbaa_received_by: 'Ayşenur',
      matbaa_approvals: [{ id: 'L1' }],
      ozalit_started: true,
      ozalit_attempt: 2,
    })
    const client = makeClient({ order })

    const result = await service.rejectOrder('o-1', L1, {
      reason: 'yanlış', rejectTarget: 'matbaa',
    }, client)

    const { patch } = updatePatch(client)
    assert.equal(result.status, 'tasarimci_onay')
    assert.equal(patch.matbaa_received, false)
    assert.equal(patch.matbaa_approvals, '[]')
    assert.equal(patch.ozalit_started, false)
    assert.equal(patch.ozalit_attempt, 3, "the order's own counter, never the project's")
  })
})

describe('orders-service — baskı onay', () => {
  const approvedForm = {
    components: [], adet: '500', tarih: '2026-09-01', basimYeri: 'İstanbul', hazirlayan: 'Ayşenur',
  }

  it('flips the project to baskida when it has not reached it yet', async () => {
    const order = orderRow({ status: 'siparis_baski_onay' })
    // 'baski_onay' sits one step before 'baskida' in the TR pipeline.
    const client = makeClient({ order, project: { id: 'p-1', stage: 'baski_onay', type: 'TR', title: 'Kitap' } })

    const result = await service.approveBaskiOnayForm('o-1', L1, approvedForm, client)

    assert.equal(result.status, 'onaylandi')
    const stageWrite = client.one(/UPDATE projects SET/)
    assert.equal(stageWrite.params[1], 'baskida')
    const rows = timeline(client)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].event, 'order_final')
    assert.equal(rows[0].to_stage, 'baskida')
    assert.equal(rows[0].note, 'Baskı onaylandı, baskıya alındı')
  })

  it('never regresses a project that already moved past baskida', async () => {
    const order = orderRow({ status: 'siparis_baski_onay' })
    // 'satista' sits after 'baskida': a second concurrent order finishing
    // late must record the approval without dragging the project back.
    const client = makeClient({ order, project: { id: 'p-1', stage: 'satista', type: 'TR', title: 'Kitap' } })

    const result = await service.approveBaskiOnayForm('o-1', L1, approvedForm, client)

    assert.equal(result.status, 'onaylandi')
    assert.equal(client.matching(/UPDATE projects SET/).length, 0, 'stage left alone')
    const rows = timeline(client)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].to_stage, 'satista', 'timeline records the stage it stayed at')
    assert.equal(rows[0].note, 'Baskı onaylandı (proje zaten baskıda veya sonrasında)')
  })

  it('requires the mandatory fields', async () => {
    const client = makeClient({ order: orderRow({ status: 'siparis_baski_onay' }) })
    await assert.rejects(
      () => service.approveBaskiOnayForm('o-1', L1, {
        components: [], adet: '', tarih: '2026-09-01', basimYeri: 'İstanbul', hazirlayan: 'Ayşenur',
      }, client),
      /zorunludur/,
    )
    assert.equal(client.matching(/UPDATE order_requests/).length, 0)
  })

  it('saves a draft quietly — no history row, no timeline, no notification', async () => {
    const order = orderRow({ status: 'siparis_baski_onay' })
    const client = makeClient({ order })

    await service.saveBaskiOnayForm('o-1', L1, {
      components: [], adet: '500', tarih: '', basimYeri: '', hazirlayan: '', notes: 'taslak',
    }, client)

    assert.equal(client.matching(/UPDATE order_requests/).length, 1)
    assert.equal(client.matching(/INTO order_history/).length, 0)
    assert.equal(client.matching(/INTO stage_history/).length, 0)
    assert.equal(client.matching(/FOR UPDATE/).filter((c) => /projects/.test(c.sql)).length, 0,
      'a quiet draft never even locks the project row')
  })

  it('refuses a draft save from anyone but a team leader', async () => {
    const client = makeClient({ order: orderRow({ status: 'siparis_baski_onay' }) })
    await assert.rejects(
      () => service.saveBaskiOnayForm('o-1', D1, { components: [] }, client),
      (err) => { assert.equal(err.status, 403); return true },
    )
  })
})

describe('orders-service — ozalit round', () => {
  it('writes the sheet snapshot and tags the history row with its demo id', async () => {
    const order = orderRow({ status: 'tasarimci_onay', ozalit_attempt: 1 })
    const client = makeClient({ order })
    // insertDemoSnapshot RETURNINGs the inserted row.
    const baseQuery = client.query
    client.query = async (sql, params) => {
      if (/INSERT INTO demos/.test(sql)) {
        client.calls.push({ sql, params })
        return { rows: [{ id: 'd-99' }] }
      }
      return baseQuery(sql, params)
    }

    await service.editOzalit('o-1', L1, { payload: { components: [] } }, client)

    const snap = client.one(/INSERT INTO demos/)
    assert.equal(snap.params[2], 'o-1', 'scoped to the order')
    assert.equal(snap.params[5], 2, 'defaults to the next attempt slot')
    const hist = client.one(/INTO order_history/)
    assert.equal(hist.params[4], 'd-99', 'history points at the exact sheet')
    assert.equal(timeline(client)[0].demo_id, 'd-99')
  })

  it('rolls the snapshot back by refusing before any write when the round has started', async () => {
    const order = orderRow({ status: 'tasarimci_onay', ozalit_started: true })
    const client = makeClient({ order })
    await assert.rejects(
      () => service.editOzalit('o-1', L1, { payload: { components: [] } }, client),
      /değişiklik isteyin/,
    )
    assert.equal(client.matching(/UPDATE order_requests/).length, 0)
  })

  it('clears the change request on accept and marks a fix owed', async () => {
    const order = orderRow({
      status: 'tasarimci_onay',
      ozalit_started: true,
      ozalit_change_requested_at: '2026-08-02T00:00:00.000Z',
      ozalit_change_requested_by: 'L1',
    })
    const client = makeClient({ order })

    await service.acceptOzalitChange('o-1', printer, client)

    const { patch } = updatePatch(client)
    assert.equal(patch.ozalit_started, false)
    assert.equal(patch.ozalit_change_requested_at, null)
    assert.equal(patch.ozalit_fix_pending, true)
  })

  it('leaves the round started when the change is declined', async () => {
    const order = orderRow({
      status: 'tasarimci_onay',
      ozalit_started: true,
      ozalit_change_requested_at: '2026-08-02T00:00:00.000Z',
    })
    const client = makeClient({ order })

    await service.declineOzalitChange('o-1', printer, client)

    const { patch } = updatePatch(client)
    assert.equal(patch.ozalit_change_requested_at, null)
    assert.equal(patch.ozalit_started, undefined, 'the started flag is left alone')
  })

  it('sends a lost proof back to the matbaa with a fresh round', async () => {
    const order = orderRow({
      status: 'matbaa_onay',
      assignee_ids: ['D1'],
      matbaa_approvals: [{ id: 'L1' }],
      ozalit_started: true,
      ozalit_attempt: 1,
    })
    const client = makeClient({ order })

    const result = await service.markMatbaaNotReceived('o-1', L1, client)

    assert.equal(result.status, 'tasarimci_onay')
    const { patch } = updatePatch(client)
    assert.equal(patch.ozalit_attempt, 2)
    assert.equal(patch.matbaa_approvals, '[]')
    assert.equal(patch.ozalit_started, false)
    assert.equal(timeline(client)[0].event, 'order_matbaa_not_received')
  })
})

describe('orders-service — subtask patch', () => {
  const subtask = {
    id: 's-1', order_id: 'o-1', title: 'İç Sayfalar', is_done: false,
    total_pages: 100, pages_done: 0, total_stickers: null, stickers_done: 0,
    needs_revize: true,
  }

  it('applies a whitelisted patch', async () => {
    const client = makeClient({ order: orderRow({ assignee_ids: ['D1'] }), subtask })
    const result = await service.patchOrderSubtask('o-1', 's-1', D1, { pages_done: 40 }, client)
    assert.equal(result.pages_done, 40)
  })

  it('refuses more pages than the subtask has', async () => {
    const client = makeClient({ order: orderRow({ assignee_ids: ['D1'] }), subtask })
    await assert.rejects(
      () => service.patchOrderSubtask('o-1', 's-1', D1, { pages_done: 500 }, client),
      /toplam iç sayfa sayısını \(100\) aşamaz/,
    )
  })

  it('only lets an assigned designer clear a revize flag', async () => {
    const client = makeClient({ order: orderRow({ assignee_ids: ['D1'] }), subtask })
    await assert.rejects(
      () => service.patchOrderSubtask('o-1', 's-1', L1, { needs_revize: false }, client),
      /yalnızca tasarımcı/,
    )
    const other = makeClient({ order: orderRow({ assignee_ids: ['D-other'] }), subtask })
    await assert.rejects(
      () => service.patchOrderSubtask('o-1', 's-1', D1, { needs_revize: false }, other),
      /size atanmadı/,
    )
  })

  it('404s a subtask belonging to another order', async () => {
    const client = makeClient({ order: orderRow(), subtask: null })
    await assert.rejects(
      () => service.patchOrderSubtask('o-1', 's-999', D1, { pages_done: 1 }, client),
      (err) => { assert.equal(err.status, 404); return true },
    )
  })
})

describe('orders-service — list', () => {
  it('flattens payload and hydrates history + subtasks', async () => {
    const row = orderRow({ status: 'goruldu' })
    const db = {
      async query(sql) {
        if (/FROM order_requests o/.test(sql)) {
          return { rows: [{ ...row, project_title: 'Kitap', requested_by_name: 'Esra' }] }
        }
        if (/FROM order_history oh/.test(sql)) {
          return {
            rows: [{
              step: 'pending', notes: 'acele', signed_by_id: 'S1', demo_id: null,
              signed_by_name: 'Esra', signed_by_role: 'satis', created_at: 'T0',
            }],
          }
        }
        if (/FROM order_subtasks/.test(sql)) return { rows: [{ id: 's-1', title: 'Kapak' }] }
        return { rows: [] }
      },
    }

    const [out] = await service.listOrders(db)

    assert.equal(out.payload, undefined, 'payload is never exposed raw')
    assert.deepEqual(out.items, [{ name: 'Kapak' }])
    assert.equal(out.quantity, 500)
    assert.equal(out.notes, 'acele')
    assert.equal(out.project_title, 'Kitap')
    assert.deepEqual(out.subtasks, [{ id: 's-1', title: 'Kapak' }])
    assert.equal(out.order_history.length, 1)
    assert.equal(out.order_history[0].signed_at, 'T0', 'created_at is mirrored as signed_at')
    assert.equal(out.order_history[0].signed_by_role, 'satis')
  })

  it('defaults the flattened fields when the payload is empty', async () => {
    const db = {
      async query(sql) {
        if (/FROM order_requests o/.test(sql)) return { rows: [{ ...orderRow({ payload: {} }) }] }
        return { rows: [] }
      },
    }
    const [out] = await service.listOrders(db)
    assert.deepEqual(out.items, [])
    assert.equal(out.quantity, null)
    assert.equal(out.notes, '')
  })
})
