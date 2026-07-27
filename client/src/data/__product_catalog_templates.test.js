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
