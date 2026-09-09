/**
 * One row per parça, not one per gate — and what that costs when nobody asks
 * which gate a row belongs to.
 *
 * `parca_state` is keyed `(project_id, parca)` (migration 074). A row carries
 * the gate it last cycled on; it is not one row per parça per gate. So when a
 * project finishes its demo leg and the leader requests an ozalit, every
 * parça's row is still sitting there saying `gate: 'demo'`, `state: 'approved'`,
 * with `delivered_at` and `received_at` stamped by a delivery that happened on a
 * different round.
 *
 * Reported from a live ozalit round, as two symptoms of exactly this:
 *
 *   • the matbaa saw the talep, pressed "İşlemi Başlatın", and got
 *     "Bu parça sizde değil" — `loadParcaForUpdate` handed the finished demo row
 *     to `canActOnParca`, which wants `owner_role: 'printer'` and found NULL
 *   • the leader, at the same moment, saw a full PARÇA ONAYI panel — three rows,
 *     a thumbs-up on each, "Tüm parçaları onaylayın (3)" — because
 *     `parcaDecidable` reads "delivered and received" as ready to decide, and
 *     the demo round's rows are exactly that shape forever
 *
 * These pin the domain half: the round's gate is what makes a row the round's.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeApproval, computeRejection } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const PARCALAR = ['Bilsem', 'Bilsem KUTU', 'Bilsem KILAVUZ']

/** How a parça looks after the demo round signed it off and moved on. */
const demoDone = (parca) => ({
  parca,
  gate: 'demo',
  state: 'approved',
  owner_role: null,
  attempt: 1,
  delivered_at: '2026-09-01T09:00:00.000Z',
  received_at: '2026-09-01T10:00:00.000Z',
})

/** A parça of the OZALIT round that has genuinely come back and been received. */
const ozalitReceived = (parca) => ({
  parca,
  gate: 'ozalit',
  state: 'pending',
  owner_role: null,
  attempt: 1,
  delivered_at: '2026-09-09T09:00:00.000Z',
  received_at: '2026-09-09T10:00:00.000Z',
})

/** The reported project: a demo round behind it, an ozalit round just requested. */
function ozalitRequested(overrides = {}) {
  return {
    id: 'p-1',
    type: 'TR',
    stage: 'ozalit_teslim',
    progress: 100,
    ozalit_requested: true,
    ozalit_attempt: 1,
    ozalit_received: false,
    demo_parca_approvals: PARCALAR.map((parca) => ({ parca, by: 'u-l', by_name: 'Ayşenur' })),
    demo_parca_rejections: [],
    ozalit_parca_approvals: {},
    ozalit_parca_rejections: [],
    assignees: [{ id: 'u-d', name: 'Aylin' }],
    subtasks: [{ id: 's1', kind: 'check', is_done: true }],
    parca_state: PARCALAR.map(demoDone),
    ...overrides,
  }
}

const ctx = (extra = {}) => ({
  actorName: leader.name,
  snapshot: { selectedComponents: PARCALAR },
  ...extra,
})

describe('a finished demo round does not make the ozalit round decidable', () => {
  it('refuses an early sign-off resting on the demo round’s rows', () => {
    // The leader's panel offered this. Every row it offered was a demo row.
    assert.throws(
      () => computeApproval(
        ozalitRequested(),
        leader,
        '2026-09-09T11:00:00.000Z',
        leader.name,
        ctx({ parcalar: ['Bilsem'] }),
      ),
      // Refused before it can name a parça: nothing on the OZALIT round has
      // been delivered, so there is no decidable set at all.
      /teslim alınmış parça yok/i,
    )
  })

  it('refuses the bulk form of the same click', () => {
    assert.throws(
      () => computeApproval(
        ozalitRequested(),
        leader,
        '2026-09-09T11:00:00.000Z',
        leader.name,
        ctx(),
      ),
      /./,
    )
  })

  it('allows it once a parça of the OZALIT round is genuinely back', () => {
    const project = ozalitRequested({
      parca_state: [
        demoDone('Bilsem KUTU'),
        demoDone('Bilsem KILAVUZ'),
        ozalitReceived('Bilsem'),
      ],
    })
    const result = computeApproval(
      project,
      leader,
      '2026-09-09T11:00:00.000Z',
      leader.name,
      ctx({ parcalar: ['Bilsem'] }),
    )
    // The round does not move — this is an early sign-off, recorded and held.
    assert.equal(result.project.stage, 'ozalit_teslim')
    const signed = Object.keys(result.project.ozalit_parca_approvals ?? {})
    assert.deepEqual(signed, ['Bilsem'])
  })

  it('does not let a demo row explain an ozalit refusal', () => {
    // The message a leader gets has to be about the round they are on. A stale
    // row would answer "teslim alınmadı" citing a delivery from the demo leg.
    assert.throws(
      () => computeRejection(
        ozalitRequested(),
        'yanlış renk',
        [],
        'matbaa',
        { actor: leader, actorName: leader.name, parcalar: ['Bilsem'] },
      ),
      /karar verilebilecek durumda değil/i,
    )
  })
})

describe('the demo leg itself is unchanged', () => {
  it('still decides on its own rows', () => {
    const project = {
      ...ozalitRequested(),
      stage: 'demo_teslim',
      demo_parca_approvals: [],
      demo_received: false,
      parca_state: [
        { ...demoDone('Bilsem'), state: 'pending' },
        { parca: 'Bilsem KUTU', gate: 'demo', state: 'with_matbaa', owner_role: 'printer', attempt: 1, delivered_at: null, received_at: null },
        { parca: 'Bilsem KILAVUZ', gate: 'demo', state: 'with_matbaa', owner_role: 'printer', attempt: 1, delivered_at: null, received_at: null },
      ],
    }
    const result = computeApproval(
      project,
      leader,
      '2026-09-09T11:00:00.000Z',
      leader.name,
      ctx({ parcalar: ['Bilsem'] }),
    )
    assert.equal(result.project.stage, 'demo_teslim')
    assert.deepEqual(
      (result.project.demo_parca_approvals ?? []).map((a) => a.parca),
      ['Bilsem'],
    )
  })
})
