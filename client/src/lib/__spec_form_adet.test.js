/**
 * ADET on a spec sheet — placement, sourcing, and the Baskı Onay gate.
 *
 * The rule these tests pin: ADET is the quantity of ONE print run, so it sits
 * on the parça (under its SAYFA SAYISI, where the matbaa reads it), never in
 * the catalog, and never on a sheet earlier than Baskı Onayı. A sipariş fills
 * it from the order the sales team raised — per parça, since 5.000 books can
 * ship in 2.500 boxes.
 */
import { describe, expect, it } from 'vitest'

import {
  ADET_LABEL,
  adetForComponent,
  isAdetLabel,
  missingAdetLabel,
  withAdetRow,
  withoutAdetRows,
} from '@/lib/spec-form-adet'

const row = (label, value = '') => ({ id: `${label}-${value}`, label, value })
const labels = (rows) => rows.map((r) => r.label)

describe('isAdetLabel', () => {
  it('matches the row by prefix, so older "ADET (Kutu)" rows still count', () => {
    expect(isAdetLabel('ADET')).toBe(true)
    expect(isAdetLabel(' adet ')).toBe(true)
    expect(isAdetLabel('ADET (Kutu)')).toBe(true)
    expect(isAdetLabel('SAYFA SAYISI')).toBe(false)
    expect(isAdetLabel('')).toBe(false)
    expect(isAdetLabel(null)).toBe(false)
  })
})

describe('withAdetRow', () => {
  it('puts ADET directly under SAYFA SAYISI', () => {
    const rows = [row('SETTEKİ KİTAP SAYISI', '1'), row('SAYFA SAYISI', '32'), row('CİLT', 'Amerikan')]
    expect(labels(withAdetRow(rows, '5.000'))).toEqual([
      'SETTEKİ KİTAP SAYISI', 'SAYFA SAYISI', ADET_LABEL, 'CİLT',
    ])
  })

  it('leads with it on a parça that declares no page count — a box has none', () => {
    const rows = [row('KUTU AÇIK EBAT', ''), row('LAMİNASYON', '')]
    const out = withAdetRow(rows, '2.500')
    expect(labels(out)).toEqual([ADET_LABEL, 'KUTU AÇIK EBAT', 'LAMİNASYON'])
    expect(out[0].value).toBe('2.500')
  })

  it('never overwrites a filled row — the leader may have corrected the order', () => {
    const rows = [row('SAYFA SAYISI', '32'), row('ADET', '4.800')]
    expect(withAdetRow(rows, '5.000')).toEqual(rows)
  })

  it('fills an existing blank row in place rather than adding a second', () => {
    const rows = [row('SAYFA SAYISI', '32'), row('ADET', '')]
    const out = withAdetRow(rows, '5.000')
    expect(out).toHaveLength(2)
    expect(out[1].value).toBe('5.000')
  })

  it('adds the row blank when nothing knows the quantity yet', () => {
    const out = withAdetRow([row('SAYFA SAYISI', '32')], '')
    expect(labels(out)).toEqual(['SAYFA SAYISI', ADET_LABEL])
    expect(out[1].value).toBe('')
  })

  it('handles an empty or missing row list', () => {
    expect(labels(withAdetRow([], '10'))).toEqual([ADET_LABEL])
    expect(labels(withAdetRow(null, '10'))).toEqual([ADET_LABEL])
  })
})

describe('adetForComponent', () => {
  const order = {
    quantity: 5000,
    items: [{ name: 'Ringoo', quantity: 5000 }, { name: 'Ringoo KUTU', quantity: 2500 }],
  }

  it('gives each parça the number the sales team entered for it', () => {
    expect(adetForComponent('Ringoo', order)).toBe('5.000')
    expect(adetForComponent('Ringoo KUTU', order)).toBe('2.500')
  })

  it('matches the parça name case- and space-insensitively', () => {
    expect(adetForComponent('  ringoo kutu ', order)).toBe('2.500')
  })

  it('falls back to the order total for a parça the order never named', () => {
    expect(adetForComponent('Ringoo KILAVUZ', order)).toBe('5.000')
  })

  it('uses the total when the order carries no per-item quantities', () => {
    expect(adetForComponent('Ringoo', { quantity: 1200, items: [] })).toBe('1.200')
    expect(adetForComponent('Ringoo', { quantity: 1200, items: ['Ringoo'] })).toBe('1.200')
  })

  it('returns nothing when there is no order — the project pipeline before an order', () => {
    expect(adetForComponent('Ringoo', null)).toBe('')
    expect(adetForComponent('Ringoo', { items: [] })).toBe('')
  })
})

describe('withoutAdetRows', () => {
  it('strips every ADET row, so a run quantity never reaches the catalog', () => {
    const rows = [row('ADET', '5.000'), row('SAYFA SAYISI', '32'), row('ADET (Kutu)', '2.500')]
    expect(labels(withoutAdetRows(rows))).toEqual(['SAYFA SAYISI'])
  })
})

describe('missingAdetLabel', () => {
  const block = (component, adet) => ({ component, rows: [row('SAYFA SAYISI', '32'), row('ADET', adet)] })

  it('passes when every block has its quantity', () => {
    expect(missingAdetLabel([block('Ringoo', '5.000'), block('Ringoo KUTU', '2.500')])).toBe(null)
  })

  it('names the offender when only some blocks are blank', () => {
    expect(missingAdetLabel([block('Ringoo', '5.000'), block('Ringoo KUTU', '')]))
      .toBe('ADET (Ringoo KUTU)')
  })

  it('says just ADET when the whole sheet is blank, or there is one block', () => {
    expect(missingAdetLabel([block('Ringoo', ''), block('Ringoo KUTU', '')])).toBe(ADET_LABEL)
    expect(missingAdetLabel([block('Ringoo', '')])).toBe(ADET_LABEL)
  })

  it('treats a block with no ADET row at all as blank', () => {
    expect(missingAdetLabel([{ component: 'Ringoo', rows: [row('SAYFA SAYISI', '32')] }])).toBe(ADET_LABEL)
  })

  it('requires nothing of a sheet with no blocks', () => {
    expect(missingAdetLabel([])).toBe(null)
    expect(missingAdetLabel(null)).toBe(null)
  })
})

/**
 * The Baskı Onay Formu's gate, as the dialog assembles it: BASIM YERİ is still
 * a künye field, ADET is now read off the sheet's blocks.
 */
describe('missingRequiredFields', () => {
  const filled = (component) => ({ component, rows: [row('ADET', '5.000')] })
  const blank = (component) => ({ component, rows: [row('ADET', '')] })

  it('reports nothing for demo / ozalit — neither declares a required field', async () => {
    const { missingRequiredFields } = await import('@/lib/spec-form-storage')
    const { VARIANTS } = await import('@/lib/spec-form-variants')
    expect(missingRequiredFields(VARIANTS.demo, {}, [blank('Ringoo')])).toEqual([])
    expect(missingRequiredFields(VARIANTS.ozalit, {}, [blank('Ringoo')])).toEqual([])
  })

  it('demands both on an empty Baskı Onay Formu', async () => {
    const { missingRequiredFields } = await import('@/lib/spec-form-storage')
    const { VARIANTS } = await import('@/lib/spec-form-variants')
    expect(missingRequiredFields(VARIANTS.baski_onay, {}, [blank('Ringoo')]))
      .toEqual(['ADET', 'BASIM YERİ'])
  })

  it('clears once every block has a quantity and the press is named', async () => {
    const { missingRequiredFields } = await import('@/lib/spec-form-storage')
    const { VARIANTS } = await import('@/lib/spec-form-variants')
    expect(missingRequiredFields(
      VARIANTS.baski_onay,
      { basimYeri: 'İstanbul' },
      [filled('Ringoo'), filled('Ringoo KUTU')],
    )).toEqual([])
  })

  it('still catches one blank parça among several', async () => {
    const { missingRequiredFields } = await import('@/lib/spec-form-storage')
    const { VARIANTS } = await import('@/lib/spec-form-variants')
    expect(missingRequiredFields(
      VARIANTS.baski_onay,
      { basimYeri: 'İstanbul' },
      [filled('Ringoo'), blank('Ringoo KUTU')],
    )).toEqual(['ADET (Ringoo KUTU)'])
  })
})
