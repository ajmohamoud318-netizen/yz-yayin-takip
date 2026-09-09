/**
 * Keeping the matbaa's queue honest about what the round still contains.
 *
 * `listParcaStateByOwner` joins only `parca_state × projects` — it never
 * consults the round's snapshot, because the queue spans every project and a
 * snapshot per row would be a query per row. So a parça dropped from a round
 * kept sitting in the printer's queue as live work, while `allParcalarDelivered`
 * — which IS snapshot-driven — had already stopped waiting for it. The printer
 * could start and deliver a parça that was no longer part of the round.
 *
 * `dropOrphanedRouted` is the filter that closes that, and these pin how NARROW
 * it has to be. Every early return in it protects a row that looks orphaned from
 * one angle and is real work from another; the whole risk of this fix is a
 * filter that reaches too far and deletes live parçalar off the queue.
 *
 * Its neighbours (`loadLiveTeslimRounds`, `deriveTeslimParcalar`) reach for
 * `getPool()` and cannot be stubbed under ESM — the same limitation
 * project-service.test.js records for the repo's `listXxx` functions — which is
 * why the decision lives in one pure function.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { dropOrphanedRouted } from './parca-service.js'

/** A routed row as `listParcaStateByOwner('printer')` hands it over. */
const routedRow = (project_id, parca, gate = 'demo') => ({
  project_id, parca, gate, state: 'with_matbaa', owner_role: 'printer',
})

/** The live-round map `loadLiveTeslimRounds` builds. */
const rounds = (entries) => new Map(
  Object.entries(entries).map(([id, [gate, parcalar]]) => [
    id, { project: { id }, gate, parcalar },
  ]),
)

const names = (rows) => rows.map((r) => r.parca)

describe('dropOrphanedRouted', () => {
  it('keeps a parça the round still carries', () => {
    const kept = dropOrphanedRouted(
      [routedRow('p-1', 'KUTU')],
      rounds({ 'p-1': ['demo', ['KUTU', 'KİTAP']] }),
    )
    assert.deepEqual(names(kept), ['KUTU'])
  })

  it('drops one the round no longer carries', () => {
    // The bug: a re-send composed a round without KİTAP, and the matbaa kept
    // being shown KİTAP as work they owed.
    const kept = dropOrphanedRouted(
      [routedRow('p-1', 'KUTU'), routedRow('p-1', 'KİTAP')],
      rounds({ 'p-1': ['demo', ['KUTU']] }),
    )
    assert.deepEqual(names(kept), ['KUTU'])
  })

  it('drops it on a one-parça round too', () => {
    // `deriveTeslimParcalar` skips rounds of fewer than two parçalar — that is a
    // rule about DERIVING, and this filter must not inherit it. A one-parça
    // round can strand a routed row just as easily.
    const kept = dropOrphanedRouted(
      [routedRow('p-1', 'KİTAP')],
      rounds({ 'p-1': ['demo', ['KUTU']] }),
    )
    assert.deepEqual(names(kept), [])
  })

  it('leaves a row alone when its project is not on a live round', () => {
    // The reject-to-matbaa flow: a parça is legitimately `with_matbaa` while the
    // project sits at an *_onay stage, where there is no round snapshot to check
    // it against. Filtering here would delete real rework off the queue.
    const kept = dropOrphanedRouted(
      [routedRow('p-9', 'KUTU')],
      rounds({ 'p-1': ['demo', ['KUTU']] }),
    )
    assert.deepEqual(names(kept), ['KUTU'])
  })

  it('leaves a row alone when the round is running the other gate', () => {
    // A project carries both legs. An ozalit round says nothing about whether a
    // demo parça belongs, so it must not be judged against it.
    const kept = dropOrphanedRouted(
      [routedRow('p-1', 'KUTU', 'demo')],
      rounds({ 'p-1': ['ozalit', ['KAPAK']] }),
    )
    assert.deepEqual(names(kept), ['KUTU'])
  })

  it('leaves every row alone when the round has no parça list yet', () => {
    // The SPA writes the snapshot AFTER the advance that starts the round, so an
    // empty list means "not written yet" — unknown, not "nothing belongs". This
    // is the case that would empty the whole queue if it were read the other way.
    const kept = dropOrphanedRouted(
      [routedRow('p-1', 'KUTU'), routedRow('p-1', 'KİTAP')],
      rounds({ 'p-1': ['demo', []] }),
    )
    assert.deepEqual(names(kept), ['KUTU', 'KİTAP'])
  })

  it('judges each project against its own round', () => {
    const kept = dropOrphanedRouted(
      [
        routedRow('p-1', 'KUTU'),
        routedRow('p-1', 'KİTAP'),
        routedRow('p-2', 'KAPAK', 'ozalit'),
      ],
      rounds({
        'p-1': ['demo', ['KUTU']],
        'p-2': ['ozalit', ['KAPAK', 'SIRT']],
      }),
    )
    assert.deepEqual(names(kept), ['KUTU', 'KAPAK'])
  })

  it('survives an empty or missing queue', () => {
    assert.deepEqual(dropOrphanedRouted([], rounds({})), [])
    assert.deepEqual(dropOrphanedRouted(null, rounds({})), [])
    assert.deepEqual(dropOrphanedRouted(undefined, rounds({})), [])
  })
})
