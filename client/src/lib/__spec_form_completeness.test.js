/**
 * The Demo / Ozalit send gate.
 *
 * Parçalar arrive templated — field names down the left, values empty — which
 * made a sheet of pure "Değer" placeholders perfectly sendable: three pages of
 * nothing, addressed to the matbaa. The rule these tests pin: a block goes out
 * with at least MIN_SPEC_ROWS rows that say something, and no half-filled ones
 * left behind. İŞİN ADI is the block's title, not one of these rows, and is
 * never counted.
 */
import { describe, expect, it } from 'vitest'

import {
  MIN_SPEC_ROWS,
  blockReadiness,
  incompleteSpecBlocks,
  isCompleteRow,
} from '@/lib/spec-form-completeness'

const row = (label, value = '') => ({ id: `${label}-${value}`, label, value })
const block = (component, rows) => ({ component, rows })

const FILLED = [row('SAYFA SAYISI', '32'), row('CİLT', 'Amerikan')]
const TEMPLATE = [row('KUTU AÇIK EBAT'), row('ÜST KAĞIT CİNSİ'), row('ALT KAĞIT'), row('LAMİNASYON')]

describe('isCompleteRow', () => {
  it('needs a field name AND a value', () => {
    expect(isCompleteRow(row('CİLT', 'Amerikan'))).toBe(true)
    expect(isCompleteRow(row('CİLT', ''))).toBe(false)
    expect(isCompleteRow(row('', 'Amerikan'))).toBe(false)
    expect(isCompleteRow(row('  ', '  '))).toBe(false)
    expect(isCompleteRow(null)).toBe(false)
  })
})

describe('blockReadiness', () => {
  it('counts what says something against what is still hanging', () => {
    expect(blockReadiness(block('XYZ', [...FILLED, row('LAMİNASYON')])))
      .toEqual({ complete: 2, partial: 1, ready: false })
  })

  it('is ready at exactly the minimum with nothing left over', () => {
    expect(blockReadiness(block('XYZ', FILLED))).toEqual({ complete: 2, partial: 0, ready: true })
  })

  it('treats a block with no rows at all as not ready', () => {
    expect(blockReadiness(block('XYZ', []))).toEqual({ complete: 0, partial: 0, ready: false })
    expect(blockReadiness({ component: 'XYZ' })).toEqual({ complete: 0, partial: 0, ready: false })
  })
})

describe('incompleteSpecBlocks', () => {
  it('lets a fully filled sheet through', () => {
    expect(incompleteSpecBlocks([block('XYZ', FILLED), block('XYZ KUTU', FILLED)])).toEqual([])
  })

  it('stops the sheet from the screenshot — every parça still the bare template', () => {
    const out = incompleteSpecBlocks([
      block('XYZ', [row('SAYFA SAYISI', '1'), row('SAYFA EBAT'), row('CİLT')]),
      block('XYZ KUTU', TEMPLATE),
    ])
    expect(out).toEqual([
      `XYZ: en az ${MIN_SPEC_ROWS} satır doldurun, kalan boş satırları silin`,
      `XYZ KUTU: en az ${MIN_SPEC_ROWS} satır doldurun, kalan boş satırları silin`,
    ])
  })

  it('asks for the leftovers to be dealt with once the minimum is met', () => {
    expect(incompleteSpecBlocks([block('XYZ', [...FILLED, row('LAMİNASYON')])]))
      .toEqual(['XYZ: boş satırları doldurun veya silin'])
  })

  it('asks for more rows when the ones present are all filled but too few', () => {
    expect(incompleteSpecBlocks([block('XYZ', [row('CİLT', 'Amerikan')])]))
      .toEqual([`XYZ: en az ${MIN_SPEC_ROWS} satır doldurun`])
  })

  it('names only the parça that needs work', () => {
    expect(incompleteSpecBlocks([block('XYZ', FILLED), block('XYZ KUTU', TEMPLATE)]))
      .toEqual([`XYZ KUTU: en az ${MIN_SPEC_ROWS} satır doldurun, kalan boş satırları silin`])
  })

  it('deleting the leftover rows is a way out, not only filling them', () => {
    // Four template rows, two filled in and the other two removed.
    expect(incompleteSpecBlocks([block('XYZ KUTU', [row('KUTU AÇIK EBAT', '20x28'), row('ALT KAĞIT', 'E dalga')])]))
      .toEqual([])
  })

  it('falls back to the bare reason for the unnamed custom-row body', () => {
    expect(incompleteSpecBlocks([block('', TEMPLATE)]))
      .toEqual([`en az ${MIN_SPEC_ROWS} satır doldurun, kalan boş satırları silin`])
  })

  it('requires nothing of a sheet with no blocks', () => {
    expect(incompleteSpecBlocks([])).toEqual([])
    expect(incompleteSpecBlocks(null)).toEqual([])
  })
})
