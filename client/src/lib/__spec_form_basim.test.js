/**
 * BASIM YERİ as a per-parça row (see lib/spec-form-basim.js).
 *
 * It moved off the künye because parçalar of one product go to different
 * publishers: a book printed in İstanbul with its box made in Ankara has two
 * answers and the old single field could hold one. The künye field survives as
 * a DEFAULT, which is what most of these pin — a default is only worth keeping
 * if an override survives it.
 */
import { describe, expect, it } from 'vitest'

import {
  BASIM_YERI_LABEL,
  isBasimYeriLabel,
  withoutBasimYeriRows,
  withBasimYeriRow,
  applyBasimYeriToBlocks,
  applyBasimYeriToRows,
  missingBasimYeriLabel,
} from './spec-form-basim.js'

const row = (label, value = '') => ({ id: `${label}-${value}`, label, value })
const block = (component, rows) => ({ component, rows })
const valueOf = (rows) => rows.find((r) => isBasimYeriLabel(r.label))?.value

describe('isBasimYeriLabel', () => {
  it('matches the label whichever way the İ was folded', () => {
    // 'BASIM YERİ'.toUpperCase() differs between en-US and tr-TR, and old
    // sheets carry both shapes.
    expect(isBasimYeriLabel('BASIM YERİ')).toBe(true)
    expect(isBasimYeriLabel('BASIM YERI')).toBe(true)
    expect(isBasimYeriLabel('Basım Yeri')).toBe(true)
    expect(isBasimYeriLabel('  basım yeri  ')).toBe(true)
  })

  it('does not match other rows', () => {
    expect(isBasimYeriLabel('ADET')).toBe(false)
    expect(isBasimYeriLabel('SAYFA SAYISI')).toBe(false)
    expect(isBasimYeriLabel('')).toBe(false)
    expect(isBasimYeriLabel(null)).toBe(false)
  })
})

describe('withBasimYeriRow', () => {
  it('places the row directly under ADET', () => {
    const rows = [row('SAYFA SAYISI', '128'), row('ADET', '5.000'), row('CİLT', 'Amerikan')]
    const next = withBasimYeriRow(rows, 'İstanbul')
    expect(next.map((r) => r.label)).toEqual(
      ['SAYFA SAYISI', 'ADET', BASIM_YERI_LABEL, 'CİLT'],
    )
    expect(valueOf(next)).toBe('İstanbul')
  })

  it('falls to the end of the block when there is no ADET row', () => {
    const next = withBasimYeriRow([row('EBAT', '13x19')], 'İstanbul')
    expect(next.map((r) => r.label)).toEqual(['EBAT', BASIM_YERI_LABEL])
  })

  it('never overwrites a press somebody chose', () => {
    const rows = [row('ADET', '2.500'), row(BASIM_YERI_LABEL, 'Ankara')]
    expect(valueOf(withBasimYeriRow(rows, 'İstanbul'))).toBe('Ankara')
  })

  it('fills an existing but empty row', () => {
    const rows = [row('ADET', '2.500'), row(BASIM_YERI_LABEL, '')]
    expect(valueOf(withBasimYeriRow(rows, 'İstanbul'))).toBe('İstanbul')
  })

  it('adds an empty row when there is no value yet', () => {
    const next = withBasimYeriRow([row('ADET', '1')], '')
    expect(valueOf(next)).toBe('')
  })
})

describe('applyBasimYeriToBlocks — the künye as a default, not as the value', () => {
  const sheet = () => [
    block('KİTAP', [row('ADET', '5.000')]),
    block('KUTU', [row('ADET', '2.500')]),
  ]

  it('fills every block on first entry', () => {
    const next = applyBasimYeriToBlocks(sheet(), '', 'İstanbul')
    expect(next.map((b) => valueOf(b.rows))).toEqual(['İstanbul', 'İstanbul'])
  })

  it('leaves a block that was pointed at another publisher', () => {
    const filled = applyBasimYeriToBlocks(sheet(), '', 'İstanbul')
    // KUTU goes to a different press.
    filled[1].rows = filled[1].rows.map(
      (r) => (isBasimYeriLabel(r.label) ? { ...r, value: 'Ankara' } : r),
    )
    // …and a later correction to the künye must not drag it back.
    const next = applyBasimYeriToBlocks(filled, 'İstanbul', 'İzmir')
    expect(next.map((b) => valueOf(b.rows))).toEqual(['İzmir', 'Ankara'])
  })

  it('keeps following on a block that never diverged', () => {
    const filled = applyBasimYeriToBlocks(sheet(), '', 'İstanbul')
    const next = applyBasimYeriToBlocks(filled, 'İstanbul', 'İzmir')
    expect(next.map((b) => valueOf(b.rows))).toEqual(['İzmir', 'İzmir'])
  })

  it('adopts a blank block even after it has diverged elsewhere', () => {
    const blocks = [
      block('KİTAP', [row(BASIM_YERI_LABEL, 'Ankara')]),
      block('KUTU', [row(BASIM_YERI_LABEL, '')]),
    ]
    const next = applyBasimYeriToBlocks(blocks, '', 'İstanbul')
    expect(next.map((b) => valueOf(b.rows))).toEqual(['Ankara', 'İstanbul'])
  })

  it('gives a block with no row one', () => {
    const next = applyBasimYeriToBlocks([block('KİTAP', [row('ADET', '1')])], '', 'İstanbul')
    expect(next[0].rows.map((r) => r.label)).toEqual(['ADET', BASIM_YERI_LABEL])
  })

  it('does the same for a catalog-less sheet’s custom rows', () => {
    const rows = applyBasimYeriToRows([row('ADET', '500')], '', 'İstanbul')
    expect(valueOf(rows)).toBe('İstanbul')
  })
})

describe('missingBasimYeriLabel', () => {
  it('is null once every block has a press', () => {
    const blocks = [
      block('KİTAP', [row(BASIM_YERI_LABEL, 'İstanbul')]),
      block('KUTU', [row(BASIM_YERI_LABEL, 'Ankara')]),
    ]
    expect(missingBasimYeriLabel(blocks)).toBe(null)
  })

  it('names the bare label when all of them are blank', () => {
    const blocks = [block('KİTAP', []), block('KUTU', [])]
    expect(missingBasimYeriLabel(blocks)).toBe(BASIM_YERI_LABEL)
  })

  it('names the offenders when only some are', () => {
    const blocks = [
      block('KİTAP', [row(BASIM_YERI_LABEL, 'İstanbul')]),
      block('KUTU', [row(BASIM_YERI_LABEL, '  ')]),
      block('KILAVUZ', []),
    ]
    expect(missingBasimYeriLabel(blocks)).toBe(`${BASIM_YERI_LABEL} (KUTU, KILAVUZ)`)
  })

  it('stays quiet when there are no blocks at all', () => {
    expect(missingBasimYeriLabel([])).toBe(null)
    expect(missingBasimYeriLabel(null)).toBe(null)
  })
})

describe('withoutBasimYeriRows', () => {
  it('strips the row — where a run was printed is not a fact about the product', () => {
    const rows = [row('EBAT', '13x19'), row(BASIM_YERI_LABEL, 'İstanbul')]
    expect(withoutBasimYeriRows(rows).map((r) => r.label)).toEqual(['EBAT'])
  })
})
