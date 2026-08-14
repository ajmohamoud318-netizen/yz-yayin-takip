/**
 * Regression test for "the ozalit form opens blank and the ürün bilgileri
 * never get saved".
 *
 * The ozalit sheet is a separate `kind` from the demo sheet, so the first
 * ozalit round has nothing of its own to restore. On a project that has no
 * Ürün Bilgileri catalog yet there was no second source either, so the dialog
 * opened completely empty — and the leader, who had already seen the spec on
 * the demo sheet, sent it to the matbaa as-is. The ozalit that was printed,
 * signed and approved carried no spec, and the auto-capture that copies the
 * approved sheet into Ürün Bilgileri on entering production (see
 * server/src/services/product-info-capture.js) had nothing to copy.
 *
 * The rule these tests pin: the last ozalit sheet wins whenever it says
 * anything; only a genuinely empty one borrows the demo sheet's spec, and it
 * borrows the spec ONLY — never the demo round's own header/stamp fields.
 */
import { describe, expect, it } from 'vitest'
import { hasSpecContent, specWithDemoFallback } from '@/lib/spec-seed'

const rows = (...labels) => labels.map((label, i) => ({ id: i, label, value: `${label} değeri` }))

const DEMO = {
  form: { demoIstemTarihi: '14 Ağustos 2026', demoIsteyenKisi: 'Aylin', matbaaYetkilisi: 'Oktay' },
  customRows: rows('EBAT', 'SAYFA SAYISI', 'CİLT'),
  selectedComponents: null,
}

describe('hasSpecContent', () => {
  it('is false for the shapes an untouched sheet actually takes', () => {
    expect(hasSpecContent(null)).toBe(false)
    expect(hasSpecContent(undefined)).toBe(false)
    expect(hasSpecContent({ form: { isinAdi: 'Kitap' } })).toBe(false)
    expect(hasSpecContent({ customRows: [], selectedComponents: [] })).toBe(false)
  })

  it('is true as soon as the sheet says anything about the product', () => {
    expect(hasSpecContent({ customRows: rows('EBAT') })).toBe(true)
    expect(hasSpecContent({ selectedComponents: [{ component: 'KİTAP', rows: [] }] })).toBe(true)
  })
})

describe('specWithDemoFallback', () => {
  it('fills an empty ozalit sheet from the demo sheet', () => {
    const seeded = specWithDemoFallback({ form: { isinAdi: 'Fen 7' } }, DEMO)
    expect(seeded.customRows.map((r) => r.label)).toEqual(['EBAT', 'SAYFA SAYISI', 'CİLT'])
  })

  it('carries the spec only — the demo round keeps its own header and stamps', () => {
    const seeded = specWithDemoFallback({ form: { ozalitIsteyenKisi: 'Ayşenur' } }, DEMO)
    expect(seeded.form).toEqual({ ozalitIsteyenKisi: 'Ayşenur' })
    expect(seeded.form.demoIsteyenKisi).toBeUndefined()
    expect(seeded.form.matbaaYetkilisi).toBeUndefined()
  })

  it('leaves an ozalit sheet that has its own spec completely alone', () => {
    const ownSpec = { form: {}, customRows: rows('EBAT (ozalit)'), selectedComponents: null }
    expect(specWithDemoFallback(ownSpec, DEMO)).toBe(ownSpec)
  })

  it('respects a parça selection as spec, even with no custom rows', () => {
    const ownSpec = { form: {}, customRows: [], selectedComponents: [{ component: 'KUTU', rows: [] }] }
    expect(specWithDemoFallback(ownSpec, DEMO)).toBe(ownSpec)
  })

  it('is a no-op when the demo sheet is empty too — nothing to borrow', () => {
    const empty = { form: {}, customRows: [], selectedComponents: [] }
    expect(specWithDemoFallback(empty, { form: {}, customRows: [] })).toBe(empty)
    expect(specWithDemoFallback(null, null)).toBe(null)
  })

  it('carries the parça selection when that is what the demo sheet had', () => {
    const fromDemo = { customRows: [], selectedComponents: [{ component: 'KİTAP', rows: rows('EBAT') }] }
    const seeded = specWithDemoFallback(null, fromDemo)
    expect(seeded.selectedComponents).toEqual(fromDemo.selectedComponents)
  })
})
