/**
 * Sanity tests for the Ürün Bilgileri component helpers used by the
 * Demo / Ozalit forms.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Product specs are now persisted server-side; stub the api so these unit
// tests stay hermetic (no network). The localStorage mirror the assertions
// check is written synchronously by saveComponentsForProject before the
// (stubbed) server call, so the behaviour under test is unchanged.
vi.mock('@/api', () => ({
  default: {
    saveProductInfo: vi.fn().mockResolvedValue({}),
    listProductInfo: vi.fn().mockResolvedValue([]),
    getProductInfo: vi.fn().mockResolvedValue([]),
  },
}))

import {
  getComponentRows,
  saveEditedComponents,
  saveComponentsForProject,
  getComponentsForProject,
} from './productCatalog'
import {
  KILAVUZ_TEMPLATE_LABELS,
  KUTU_TEMPLATE_LABELS,
  MAIN_TEMPLATE_LABELS,
  mainTemplateFields,
  kilavuzComponentName,
  kilavuzTemplateFields,
  kutuComponentName,
  kutuTemplateFields,
  missingTemplateLabels,
  parcaKind,
  templateLabelsForKind,
} from './parcaTemplates'

const LS_KEY = 'yz_product_info_overrides_v1'

function clearOverrides() {
  localStorage.removeItem(LS_KEY)
}

describe('getComponentRows', () => {
  it('omits the İŞİN ADI field (rendered as the header, not a spec row)', () => {
    const rows = getComponentRows({
      component: 'X',
      fields: [
        { k: 'İŞİN ADI', v: 'X' },
        { k: 'SAYFA SAYISI', v: '80' },
        { k: 'CİLT', v: 'Amerikan' },
      ],
    })
    expect(rows.map((r) => r.label)).toEqual(['SAYFA SAYISI', 'CİLT'])
  })

  it('keeps a row that has a label but no value yet — the template is the point', () => {
    const rows = getComponentRows({
      component: 'X KUTU',
      fields: kutuTemplateFields('X'),
    })
    expect(rows.map((r) => r.label)).toEqual(KUTU_TEMPLATE_LABELS)
    expect(rows.every((r) => r.value === '')).toBe(true)
  })

  it('still drops a row with neither half (an untouched "Satır Ekle")', () => {
    const rows = getComponentRows({
      component: 'X',
      fields: [{ k: 'EBAT', v: '' }, { k: '', v: '' }, { k: '   ', v: '  ' }],
    })
    expect(rows.map((r) => r.label)).toEqual(['EBAT'])
  })
})

describe('parcaKind', () => {
  it('trusts the component\'s own tag over its name', () => {
    // A leader who tags a sticker sheet as a kılavuz in Ürün Bilgileri means it.
    expect(parcaKind({ component: 'STICKER', kind: 'kilavuz' })).toBe('kilavuz')
    expect(parcaKind({ component: 'Ringoo KUTU', kind: 'main' })).toBe('main')
  })

  it('falls back to the name for a row saved before the field existed', () => {
    expect(parcaKind({ component: 'Ringoo KUTU' })).toBe('kutu')
    expect(parcaKind({ component: 'Ringoo KILAVUZ' })).toBe('kilavuz')
    expect(parcaKind({ component: 'Ringoo' })).toBe('main')
    expect(parcaKind({ component: 'STICKER', kind: 'nonsense' })).toBe('main')
    expect(parcaKind(null)).toBe('main')
  })
})

describe('missingTemplateLabels', () => {
  // Deleting a template line is how the author clears the send gate for a
  // field this job doesn't have (lib/spec-form-completeness.js), so putting
  // one back has to cost a tap rather than the retyping of "SETTEKİ KİTAP
  // SAYISI" into a textarea on a phone.
  const rows = (...labels) => labels.map((label) => ({ label, value: '' }))

  it('offers what the parça is missing, in template order', () => {
    expect(missingTemplateLabels('kutu', rows('ÜST KAĞIT CİNSİ')))
      .toEqual(['KUTU AÇIK EBAT', 'ALT KAĞIT', 'LAMİNASYON'])
  })

  it('offers nothing once every template line is on the block', () => {
    expect(missingTemplateLabels('kutu', rows(...KUTU_TEMPLATE_LABELS))).toEqual([])
  })

  it('offers the whole template to a block stripped bare', () => {
    expect(missingTemplateLabels('kilavuz', [])).toEqual(KILAVUZ_TEMPLATE_LABELS)
    expect(missingTemplateLabels('main', null)).toEqual(MAIN_TEMPLATE_LABELS)
  })

  it('ignores case and stray spacing when deciding what is already there', () => {
    expect(missingTemplateLabels('kutu', rows('  alt kağıt  ')))
      .not.toContain('ALT KAĞIT')
  })

  it('has nothing to offer a parça with no template of its own', () => {
    expect(templateLabelsForKind('other')).toEqual([])
    expect(missingTemplateLabels('other', [])).toEqual([])
  })
})

describe('ANA PARÇA template', () => {
  it('leads with SAYFA SAYISI and carries no ADET', () => {
    // ADET is one print run's quantity, and product-info-capture strips it
    // back out of the catalog — a seeded ADET row only ever vanished later.
    expect(MAIN_TEMPLATE_LABELS[0]).toBe('SAYFA SAYISI')
    expect(MAIN_TEMPLATE_LABELS).not.toContain('ADET')
    expect(MAIN_TEMPLATE_LABELS).toEqual([
      'SAYFA SAYISI',
      'SETTEKİ KİTAP SAYISI',
      'SAYFA EBAT',
      'İÇ KAĞIT CİNSİ',
      'KAPAK KAĞIT CİNSİ',
      'CİLT',
      'LAMİNASYON',
    ])
  })

  it('takes the job title as-is — only the siblings name their part', () => {
    expect(mainTemplateFields('  Ringoo ')[0]).toEqual({ k: 'İŞİN ADI', v: 'Ringoo' })
  })

  it('seeds every value blank when the project has no İç Sayfalar subtask', () => {
    const fields = mainTemplateFields('Ringoo')
    expect(fields.slice(1).every((f) => f.v === '')).toBe(true)
  })

  it("seeds the 'auto' placeholder into SAYFA SAYISI, and only there", () => {
    const fields = mainTemplateFields('Ringoo', { pageCountValue: 'auto' })
    expect(fields.find((f) => f.k === 'SAYFA SAYISI')).toEqual({ k: 'SAYFA SAYISI', v: 'auto' })
    expect(fields.filter((f) => f.v === 'auto')).toHaveLength(1)
  })

  it('reaches the form as seven rows, İŞİN ADI rendered as the header instead', () => {
    const rows = getComponentRows({ component: 'Ringoo', fields: mainTemplateFields('Ringoo') })
    expect(rows.map((r) => r.label)).toEqual(MAIN_TEMPLATE_LABELS)
  })
})

describe('KUTU template', () => {
  it('names the parça after the job, with the part in caps', () => {
    expect(kutuComponentName('  Ringoo ')).toBe('Ringoo KUTU')
  })

  it('seeds İŞİN ADI filled and every other value blank', () => {
    const fields = kutuTemplateFields('5-8 YAŞ ZEKA VE DİKKAT GELİŞTİRME SETİ')
    expect(fields[0]).toEqual({ k: 'İŞİN ADI', v: '5-8 YAŞ ZEKA VE DİKKAT GELİŞTİRME SETİ KUTU' })
    expect(fields.slice(1)).toEqual([
      { k: 'KUTU AÇIK EBAT', v: '' },
      { k: 'ÜST KAĞIT CİNSİ', v: '' },
      { k: 'ALT KAĞIT', v: '' },
      { k: 'LAMİNASYON', v: '' },
    ])
  })

  it('survives a round trip through the demo/ozalit form with its values still blank', async () => {
    clearOverrides()
    const fields = kutuTemplateFields('Ringoo')
    await saveComponentsForProject('p-kutu', [{ component: 'Ringoo KUTU', kind: 'kutu', date: '', fields }])
    const rows = getComponentRows(getComponentsForProject('p-kutu')[0])
    // The leader fills one row on the sheet and saves; the rest must stay.
    await saveEditedComponents('p-kutu', [{
      component: 'Ringoo KUTU',
      rows: rows.map((r) => (r.label === 'ALT KAĞIT' ? { ...r, value: 'E dalga' } : r)),
    }])
    expect(getComponentsForProject('p-kutu')[0].fields).toEqual([
      { k: 'İŞİN ADI', v: 'Ringoo KUTU' },
      { k: 'KUTU AÇIK EBAT', v: '' },
      { k: 'ÜST KAĞIT CİNSİ', v: '' },
      { k: 'ALT KAĞIT', v: 'E dalga' },
      { k: 'LAMİNASYON', v: '' },
    ])
  })
})

describe('KILAVUZ template', () => {
  it('names the parça after the job, with the part in caps', () => {
    expect(kilavuzComponentName('  RAPİDOO AİLE (3-99 YAŞ) ')).toBe('RAPİDOO AİLE (3-99 YAŞ) KILAVUZ')
  })

  it('seeds İŞİN ADI filled and every other value blank', () => {
    const fields = kilavuzTemplateFields('RAPİDOO AİLE (3-99 YAŞ)')
    expect(fields[0]).toEqual({ k: 'İŞİN ADI', v: 'RAPİDOO AİLE (3-99 YAŞ) KILAVUZ' })
    expect(fields.slice(1)).toEqual([
      { k: 'SETTEKİ KİTAP SAYISI', v: '' },
      { k: 'SAYFA EBAT', v: '' },
      { k: 'SAYFA SAYISI', v: '' },
      { k: 'İÇ KAĞIT CİNSİ', v: '' },
      { k: 'CİLT', v: '' },
    ])
  })

  it('reaches the form as five label-only rows, its own SAYFA SAYISI among them', () => {
    const rows = getComponentRows({ component: 'X KILAVUZ', fields: kilavuzTemplateFields('X') })
    expect(rows.map((r) => r.label)).toEqual(KILAVUZ_TEMPLATE_LABELS)
    expect(rows.every((r) => r.value === '')).toBe(true)
  })
})

describe('saveEditedComponents', () => {
  beforeEach(() => {
    clearOverrides()
  })

  it('merges edited rows back into the full spec, preserving unselected parçalar', async () => {
    // Seed a two-parça product for a real project.
    await saveComponentsForProject('p-real', [
      { component: 'KİTAP', date: '', fields: [{ k: 'İŞİN ADI', v: 'KİTAP' }, { k: 'SAYFA SAYISI', v: '80' }] },
      { component: 'KUTU', date: '', fields: [{ k: 'İŞİN ADI', v: 'KUTU' }, { k: 'EBAT', v: '20x20' }] },
    ])
    // The form edits only the KİTAP parça (rows are the {label,value} form shape).
    await saveEditedComponents('p-real', [
      { component: 'KİTAP', rows: [{ label: 'SAYFA SAYISI', value: '96' }] },
    ])
    const full = getComponentsForProject('p-real')
    const kitap = full.find((c) => c.component === 'KİTAP')
    const kutu = full.find((c) => c.component === 'KUTU')
    // KİTAP's edit is applied, İŞİN ADI kept as the title field.
    expect(kitap.fields).toEqual([
      { k: 'İŞİN ADI', v: 'KİTAP' },
      { k: 'SAYFA SAYISI', v: '96' },
    ])
    // KUTU is untouched.
    expect(kutu.fields).toEqual([{ k: 'İŞİN ADI', v: 'KUTU' }, { k: 'EBAT', v: '20x20' }])
  })
})
