/**
 * Per-parça payload diff (migration 077) — what makes a partial edit safe.
 *
 * The edit guard's first cut refused the whole sheet whenever ANY parça was on
 * the press. That took away the free edit the leader still has on every parça
 * the matbaa has NOT started, which is the point of splitting a round. These
 * pin the narrower question that replaced it: did this save touch anything
 * locked?
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { changedParcaBlocks, lockedParcalarTouched } from './spec-parca-diff.js'

const sheet = (blocks) => ({
  isinAdi: 'Zeka Küpü',
  _selectedComponents: Object.entries(blocks).map(([component, rows], i) => ({
    id: `c${i}`, component, rows,
  })),
})
const row = (id, label, value) => ({ id, label, value })

describe('changedParcaBlocks', () => {
  const base = sheet({
    KUTU: [row('r1', 'EBAT', '20x28'), row('r2', 'KAĞIT', '350gr')],
    KİTAP: [row('r3', 'EBAT', '19x27')],
  })

  it('reports nothing when the sheet is identical', () => {
    assert.deepEqual(changedParcaBlocks(base, sheet({
      KUTU: [row('r1', 'EBAT', '20x28'), row('r2', 'KAĞIT', '350gr')],
      KİTAP: [row('r3', 'EBAT', '19x27')],
    })), [])
  })

  it('names only the parça whose value changed', () => {
    assert.deepEqual(changedParcaBlocks(base, sheet({
      KUTU: [row('r1', 'EBAT', '20x28'), row('r2', 'KAĞIT', '350gr')],
      KİTAP: [row('r3', 'EBAT', '21x30')],
    })), ['KİTAP'])
  })

  it('catches a renamed row label, not just a value', () => {
    assert.deepEqual(changedParcaBlocks(base, sheet({
      KUTU: [row('r1', 'EBAT', '20x28'), row('r2', 'KUŞE', '350gr')],
      KİTAP: [row('r3', 'EBAT', '19x27')],
    })), ['KUTU'])
  })

  it('ignores a row id that changed but says the same thing', () => {
    // Ids are client-side handles and can churn on a retype; reporting them
    // would refuse an edit nobody made.
    assert.deepEqual(changedParcaBlocks(base, sheet({
      KUTU: [row('X', 'EBAT', '20x28'), row('Y', 'KAĞIT', '350gr')],
      KİTAP: [row('Z', 'EBAT', '19x27')],
    })), [])
  })

  it('treats a reordered block as changed — the sheet prints in this order', () => {
    assert.deepEqual(changedParcaBlocks(base, sheet({
      KUTU: [row('r2', 'KAĞIT', '350gr'), row('r1', 'EBAT', '20x28')],
      KİTAP: [row('r3', 'EBAT', '19x27')],
    })), ['KUTU'])
  })

  it('counts an added and a removed parça', () => {
    const added = changedParcaBlocks(base, sheet({
      KUTU: [row('r1', 'EBAT', '20x28'), row('r2', 'KAĞIT', '350gr')],
      KİTAP: [row('r3', 'EBAT', '19x27')],
      KILAVUZ: [row('r4', 'EBAT', '10x10')],
    }))
    assert.deepEqual(added, ['KILAVUZ'])

    const removed = changedParcaBlocks(base, sheet({
      KUTU: [row('r1', 'EBAT', '20x28'), row('r2', 'KAĞIT', '350gr')],
    }))
    assert.deepEqual(removed, ['KİTAP'])
  })

  it('ignores sheet-level fields — they belong to the round, not a parça', () => {
    const next = sheet({
      KUTU: [row('r1', 'EBAT', '20x28'), row('r2', 'KAĞIT', '350gr')],
      KİTAP: [row('r3', 'EBAT', '19x27')],
    })
    next.isinAdi = 'Bambaşka bir ad'
    next.teslimTarihi = '2026-09-09'
    assert.deepEqual(changedParcaBlocks(base, next), [])
  })

  it('matches parça names the Turkish way', () => {
    // 'i'/'İ' and 'ı'/'I' pair the other way round than in en-US: a KİTAP
    // stored lower-case must still find its own block, not read as a new one.
    assert.deepEqual(changedParcaBlocks(base, sheet({
      KUTU: [row('r1', 'EBAT', '20x28'), row('r2', 'KAĞIT', '350gr')],
      kitap: [row('r3', 'EBAT', '19x27')],
    })), [])
  })

  it('returns null with no baseline — "unknown", not "unchanged"', () => {
    assert.equal(changedParcaBlocks(null, sheet({ KUTU: [] })), null)
    assert.equal(changedParcaBlocks(undefined, sheet({ KUTU: [] })), null)
  })

  it('normalises a legacy names-only sheet instead of dropping it', () => {
    const legacy = { _selectedComponents: ['KUTU', 'KİTAP'] }
    // Rows appearing where there were none is a real change, not a no-op.
    assert.deepEqual(changedParcaBlocks(legacy, base), ['KUTU', 'KİTAP'])
  })
})

describe('lockedParcalarTouched', () => {
  it('is empty when nothing is locked, whatever changed', () => {
    assert.deepEqual(lockedParcalarTouched([], ['KUTU']), [])
  })

  it('is empty when the save left every locked parça alone', () => {
    assert.deepEqual(lockedParcalarTouched(['KUTU'], ['KİTAP', 'KILAVUZ']), [])
  })

  it('names the locked parçalar the save would rewrite', () => {
    assert.deepEqual(lockedParcalarTouched(['KUTU', 'KİTAP'], ['KİTAP']), ['KİTAP'])
  })

  it('falls back to every locked parça when there is no baseline', () => {
    // A save that cannot be shown to be safe is not one to wave through on a
    // round the matbaa is mid-way into producing.
    assert.deepEqual(lockedParcalarTouched(['KUTU'], null), ['KUTU'])
    assert.deepEqual(lockedParcalarTouched(['KUTU'], undefined), ['KUTU'])
  })

  it('matches names the Turkish way', () => {
    assert.deepEqual(lockedParcalarTouched(['KİTAP'], ['kitap']), ['KİTAP'])
  })
})
