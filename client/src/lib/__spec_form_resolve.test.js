/**
 * Regression test for "the spec sheet shows 'auto' instead of the live
 * İç Sayfalar total".
 *
 * NewProjectDialog.deriveInitialProductInfo seeds the SAYFA SAYISI row with
 * the string 'auto' at create time, on the rationale that the page count
 * isn't fixed until designers start working. The spec form has to resolve
 * that placeholder to the project's current total_pages when the sheet is
 * composed — without that, the matbaa gets a sheet with the literal word
 * 'auto' where the print run's page count is supposed to be.
 *
 * The rule these tests pin: the page count is owned by project düzenleme
 * (the "Toplam iç sayfa" input under the İç Sayfalar subtask), so the spec
 * form is read-only for this row — whenever the project has a live count,
 * the resolver returns it (overriding 'auto' and any stale value alike);
 * without a live count the row is user-owned and passed through verbatim.
 */
import { describe, expect, it } from 'vitest'

import { projectHasLivePageCount, resolveSayfaSayisiRows } from '@/lib/spec-form-resolve'

const row = (label, value) => ({ id: `${label}-${value}`, label, value })
const projectWith = (total) => ({ subtasks: [{ kind: 'pages', total_pages: total }] })

describe('resolveSayfaSayisiRows', () => {
  it('rewrites the seeded "auto" placeholder to the live total_pages', () => {
    const rows = [row('İŞİN ADI', 'Minik Kaşif'), row('SAYFA SAYISI', 'auto'), row('CİLT', 'Amerikan')]
    const out = resolveSayfaSayisiRows(rows, projectWith(48))
    expect(out[1].value).toBe('48')
    expect(out[0]).toEqual(rows[0])
    expect(out[2]).toEqual(rows[2])
  })

  it('rewrites an empty value too — "not yet" should not print as blank', () => {
    const rows = [row('SAYFA SAYISI', '')]
    expect(resolveSayfaSayisiRows(rows, projectWith(32))[0].value).toBe('32')
  })

  it('overrides a stale value that an earlier save round-tripped in', () => {
    // product_info / snapshots may carry a stale value from a previous round
    // where the live count was different. The resolver trusts the subtask,
    // not the row.
    const rows = [row('SAYFA SAYISI', '48')]
    expect(resolveSayfaSayisiRows(rows, projectWith(60))[0].value).toBe('60')
  })

  it('formats numbers with the tr-TR thousand separator', () => {
    const rows = [row('SAYFA SAYISI', 'auto')]
    expect(resolveSayfaSayisiRows(rows, projectWith(1234))[0].value).toBe('1.234')
  })

  it('is case-insensitive on the label', () => {
    const rows = [row('sayfa sayısı', 'auto')]
    expect(resolveSayfaSayisiRows(rows, projectWith(40))[0].value).toBe('40')
  })

  it('leaves non-SAYFA-SAYISI rows alone, even with placeholder-shaped values', () => {
    const rows = [row('EBAT', 'auto'), row('ADET', ''), row('CİLT', 'Amerikan')]
    expect(resolveSayfaSayisiRows(rows, projectWith(32))).toEqual(rows)
  })

  it('passes the row through verbatim when the project has no pages subtask', () => {
    const rows = [row('SAYFA SAYISI', 'auto'), row('SAYFA SAYISI', '96')]
    expect(resolveSayfaSayisiRows(rows, { subtasks: [{ kind: 'check' }] })).toEqual(rows)
    expect(resolveSayfaSayisiRows(rows, null)).toEqual(rows)
  })

  it('passes the row through verbatim when the pages subtask has no positive total', () => {
    const rows = [row('SAYFA SAYISI', 'auto')]
    expect(resolveSayfaSayisiRows(rows, { subtasks: [{ kind: 'pages', total_pages: 0 }] })).toEqual(rows)
    expect(resolveSayfaSayisiRows(rows, { subtasks: [{ kind: 'pages' }] })).toEqual(rows)
  })

  it('returns a new array — never mutates the caller\'s rows', () => {
    const rows = [row('SAYFA SAYISI', 'auto')]
    const out = resolveSayfaSayisiRows(rows, projectWith(32))
    expect(out).not.toBe(rows)
    expect(rows[0].value).toBe('auto')
  })

  it('tolerates null / undefined / empty inputs', () => {
    expect(resolveSayfaSayisiRows(null, projectWith(32))).toEqual([])
    expect(resolveSayfaSayisiRows(undefined, projectWith(32))).toEqual([])
    expect(resolveSayfaSayisiRows([], projectWith(32))).toEqual([])
  })

  it('leaves a manual value alone on a project without İç Sayfalar — the row is user-owned', () => {
    const rows = [row('SAYFA SAYISI', '96')]
    expect(resolveSayfaSayisiRows(rows, { subtasks: [] })).toEqual(rows)
  })
})

describe('resolveSayfaSayisiRows — parça scoping', () => {
  // The KILAVUZ template ships a SAYFA SAYISI row that counts the GUIDE's
  // pages. Substituting the set's İç Sayfalar total into it (and locking the
  // row, see SpecSheetBody) left a two-page guide claiming to be 32 pages.
  const rows = [row('SETTEKİ KİTAP SAYISI', '1'), row('SAYFA SAYISI', '2')]

  it('leaves a kılavuz parça to count its own pages', () => {
    expect(resolveSayfaSayisiRows(rows, projectWith(32), 'kilavuz')).toEqual(rows)
  })

  it('leaves kutu and other siblings alone too', () => {
    expect(resolveSayfaSayisiRows(rows, projectWith(32), 'kutu')).toEqual(rows)
    expect(resolveSayfaSayisiRows(rows, projectWith(32), 'other')).toEqual(rows)
  })

  it('still substitutes on the main parça, and on a caller that names no kind', () => {
    expect(resolveSayfaSayisiRows(rows, projectWith(32), 'main')[1].value).toBe('32')
    expect(resolveSayfaSayisiRows(rows, projectWith(32))[1].value).toBe('32')
  })

  it('normalises a null row list for a sibling the same way it does for main', () => {
    expect(resolveSayfaSayisiRows(null, projectWith(32), 'kilavuz')).toEqual([])
  })
})

describe('projectHasLivePageCount', () => {
  it('is true when a pages subtask carries a positive total_pages', () => {
    expect(projectHasLivePageCount({ subtasks: [{ kind: 'pages', total_pages: 48 }] })).toBe(true)
  })

  it('is false when total_pages is zero or missing', () => {
    expect(projectHasLivePageCount({ subtasks: [{ kind: 'pages', total_pages: 0 }] })).toBe(false)
    expect(projectHasLivePageCount({ subtasks: [{ kind: 'pages' }] })).toBe(false)
  })

  it('is false when there is no pages subtask at all', () => {
    expect(projectHasLivePageCount({ subtasks: [{ kind: 'check' }] })).toBe(false)
    expect(projectHasLivePageCount({ subtasks: [] })).toBe(false)
  })

  it('tolerates null / undefined project', () => {
    expect(projectHasLivePageCount(null)).toBe(false)
    expect(projectHasLivePageCount(undefined)).toBe(false)
  })
})
