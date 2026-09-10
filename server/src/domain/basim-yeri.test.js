/**
 * BASIM YERİ as a per-parça requirement (see domain/basim-yeri.js).
 *
 * It moved off the künye for the same reason ADET did: parçalar of one product
 * go to different publishers, so a single field could only ever describe some
 * of the sheet. These pin the two things the server uses it for — the capture
 * strip and the sipariş form's completeness gate.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { isBasimYeriLabel, everyBlockHasBasimYeri } from './basim-yeri.js'

const row = (label, value) => ({ label, value })
const block = (component, rows) => ({ component, rows })

describe('isBasimYeriLabel', () => {
  it('matches the label whichever way the İ was folded', () => {
    // 'BASIM YERİ'.toUpperCase() differs between en-US and tr-TR, and sheets
    // written before the move carry both shapes.
    assert.equal(isBasimYeriLabel('BASIM YERİ'), true)
    assert.equal(isBasimYeriLabel('BASIM YERI'), true)
    assert.equal(isBasimYeriLabel('Basım Yeri'), true)
    assert.equal(isBasimYeriLabel('  basım yeri  '), true)
  })

  it('leaves every other row alone', () => {
    assert.equal(isBasimYeriLabel('ADET'), false)
    assert.equal(isBasimYeriLabel('EBAT'), false)
    assert.equal(isBasimYeriLabel(''), false)
    assert.equal(isBasimYeriLabel(null), false)
  })
})

describe('everyBlockHasBasimYeri', () => {
  it('is true when each parça names its own press', () => {
    assert.equal(everyBlockHasBasimYeri([
      block('KİTAP', [row('BASIM YERİ', 'İstanbul')]),
      block('KUTU', [row('BASIM YERİ', 'Ankara')]),
    ]), true)
  })

  it('is false when one of them is blank', () => {
    assert.equal(everyBlockHasBasimYeri([
      block('KİTAP', [row('BASIM YERİ', 'İstanbul')]),
      block('KUTU', [row('BASIM YERİ', '   ')]),
    ]), false)
  })

  it('is false when a block carries no such row at all', () => {
    assert.equal(everyBlockHasBasimYeri([
      block('KİTAP', [row('BASIM YERİ', 'İstanbul')]),
      block('KUTU', [row('ADET', '2.500')]),
    ]), false)
  })

  it('is false for a sheet with no blocks — it names a press nowhere', () => {
    // The caller decides what to do about it: Order falls back to the legacy
    // top-level `basimYeri` for forms saved before the move.
    assert.equal(everyBlockHasBasimYeri([]), false)
    assert.equal(everyBlockHasBasimYeri(null), false)
  })
})
