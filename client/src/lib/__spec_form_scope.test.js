/**
 * Narrowing a spec sheet to the parça its reader was handed (migration 074).
 *
 * The matbaa's queue is per-parça while the sheet is per-round, so "KUTU ·
 * İşlemi Başlatın" used to open a three-parça document and leave the printer to
 * work out which page the button meant. These are the rules that stop the
 * narrowing from doing damage of its own: it never invents an empty sheet, and
 * it never quietly drops a parça without the dialog being able to name it.
 */
import { describe, expect, it } from 'vitest'

import { hiddenParcaNames, scopeComponents } from '@/lib/spec-form-scope'

const comp = (component) => ({ id: component, component, rows: [] })
const sheet = [comp('KİTAP'), comp('KUTU'), comp('KILAVUZ')]

describe('scopeComponents', () => {
  it('keeps only the parçalar the caller asked for', () => {
    expect(scopeComponents(sheet, ['KUTU']).map((c) => c.component)).toEqual(['KUTU'])
  })

  it('keeps them in the sheet order, not the order they were clicked', () => {
    // The sheet's order is the catalog's (lib/spec-form-selection.js) and it is
    // also the page order on paper — a bulk stamp must not reshuffle it.
    expect(scopeComponents(sheet, ['KILAVUZ', 'KİTAP']).map((c) => c.component))
      .toEqual(['KİTAP', 'KILAVUZ'])
  })

  it('shows the whole sheet when there is no scope', () => {
    expect(scopeComponents(sheet, null)).toHaveLength(3)
    expect(scopeComponents(sheet, [])).toHaveLength(3)
    expect(scopeComponents(sheet, [null, ''])).toHaveLength(3)
  })

  it('matches names the way parça names actually vary', () => {
    // Queue rows and sheet blocks come from the same string, but a rename in
    // Ürün Bilgileri or a stray space must not blank the document.
    expect(scopeComponents(sheet, ['  kutu  ']).map((c) => c.component)).toEqual(['KUTU'])
    expect(scopeComponents([comp('Kılavuz')], ['KILAVUZ']).map((c) => c.component))
      .toEqual(['Kılavuz'])
  })

  it('falls back to the whole sheet when the scope matches nothing', () => {
    // A routing row from a previous round, or a parça since renamed. Showing
    // everything is what the printer had before per-parça routing; showing an
    // empty sheet tells them nothing and hides the job.
    expect(scopeComponents(sheet, ['POSTER'])).toHaveLength(3)
  })

  it('survives a sheet with no parçalar at all', () => {
    expect(scopeComponents([], ['KUTU'])).toEqual([])
    expect(scopeComponents(null, ['KUTU'])).toEqual([])
    expect(scopeComponents([null, comp('KUTU')], ['KUTU'])).toHaveLength(1)
  })
})

describe('hiddenParcaNames', () => {
  it('names what the narrowed sheet is not showing', () => {
    const shown = scopeComponents(sheet, ['KUTU'])
    expect(hiddenParcaNames(sheet, shown)).toEqual(['KİTAP', 'KILAVUZ'])
  })

  it('is empty when nothing is hidden', () => {
    expect(hiddenParcaNames(sheet, sheet)).toEqual([])
    expect(hiddenParcaNames(sheet, scopeComponents(sheet, null))).toEqual([])
  })
})
