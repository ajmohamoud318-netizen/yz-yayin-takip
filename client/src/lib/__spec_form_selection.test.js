/**
 * Regression tests for "ticking a parça box rewrote the sheet".
 *
 * Two failures, one root: the picker rebuilt a parça from the CATALOG every
 * time it was (re)selected, and appended it in tick order.
 *
 *  - A project's Baskı Reçeteleri is usually an empty shell — the picker
 *    itself prints "0 satır" — while the rows on screen came from the saved
 *    snapshot, from this session's typing, or from the live SAYFA SAYISI
 *    resolution. Unticking a parça and ticking it again replaced all of that
 *    with nothing, and the next Kaydet/Gönder wrote the emptied parça back
 *    into Ürün Bilgileri (saveEditedComponents rebuilds `fields` from these
 *    rows), so the reçete was gone for good.
 *  - Each parça prints on its own page, so tick order decided the page order:
 *    the same sheet printed differently depending on which box was clicked
 *    first, and an untick/re-tick moved that parça to the last page.
 */
import { describe, expect, it } from 'vitest'

import { hydrateComponent, inCatalogOrder } from '@/lib/spec-form-selection'

const comp = (id, rows = []) => ({ id, component: id, rows })
const row = (label, value) => ({ id: `${label}-${value}`, label, value })

describe('hydrateComponent', () => {
  it('keeps the rows the sheet knew over the catalog shell', () => {
    const remembered = new Map([['NEW PROJECT', [row('SAYFA SAYISI', '10')]]])
    const out = hydrateComponent(comp('NEW PROJECT'), { remembered })
    expect(out.rows).toEqual([row('SAYFA SAYISI', '10')])
  })

  it('resolves the catalog rows for a parça the sheet has never carried', () => {
    const out = hydrateComponent(comp('KUTU REÇETESİ', [row('SAYFA SAYISI', 'auto')]), {
      remembered: new Map(),
      resolveRows: (rows) => rows.map((r) => ({ ...r, value: '10' })),
    })
    expect(out.rows).toEqual([row('SAYFA SAYISI', 'auto')].map((r) => ({ ...r, value: '10' })))
  })

  it('remembers an emptied parça as empty — the user deleted those rows', () => {
    const remembered = new Map([['KUTU REÇETESİ', []]])
    const out = hydrateComponent(comp('KUTU REÇETESİ', [row('CİLT', 'Amerikan')]), { remembered })
    expect(out.rows).toEqual([])
  })

  it('leaves the rest of the parça untouched', () => {
    const out = hydrateComponent(comp('KILAVUZ REÇETESİ'), { remembered: new Map() })
    expect(out.component).toBe('KILAVUZ REÇETESİ')
    expect(out.id).toBe('KILAVUZ REÇETESİ')
  })
})

describe('inCatalogOrder', () => {
  const catalog = [comp('NEW PROJECT'), comp('KUTU REÇETESİ'), comp('KILAVUZ REÇETESİ')]

  it('prints in catalog order however the boxes were ticked', () => {
    const ticked = [comp('KUTU REÇETESİ'), comp('KILAVUZ REÇETESİ'), comp('NEW PROJECT')]
    expect(inCatalogOrder(ticked, catalog).map((c) => c.id)).toEqual([
      'NEW PROJECT', 'KUTU REÇETESİ', 'KILAVUZ REÇETESİ',
    ])
  })

  it('puts a parça back where it belongs after an untick/re-tick', () => {
    const afterRetick = [comp('KUTU REÇETESİ'), comp('KILAVUZ REÇETESİ'), comp('NEW PROJECT')]
    expect(inCatalogOrder(afterRetick, catalog)[0].id).toBe('NEW PROJECT')
  })

  it('keeps a parça the catalog no longer lists, at the end, in order', () => {
    const selection = [comp('ESKİ REÇETE'), comp('KUTU REÇETESİ'), comp('SİLİNMİŞ REÇETE')]
    expect(inCatalogOrder(selection, catalog).map((c) => c.id)).toEqual([
      'KUTU REÇETESİ', 'ESKİ REÇETE', 'SİLİNMİŞ REÇETE',
    ])
  })

  it('does not mutate the selection it was given', () => {
    const selection = [comp('KUTU REÇETESİ'), comp('NEW PROJECT')]
    inCatalogOrder(selection, catalog)
    expect(selection.map((c) => c.id)).toEqual(['KUTU REÇETESİ', 'NEW PROJECT'])
  })
})
