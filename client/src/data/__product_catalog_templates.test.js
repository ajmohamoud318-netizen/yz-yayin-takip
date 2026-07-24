/**
 * Sanity tests for the Ürün Bilgileri → Yeni Proje template helpers.
 * Locks in the inference rules so future PRODUCT_INFO edits don't silently
 * regress the auto-fill behaviour.
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
  inferSubtasksFromTemplate,
  inferTitleFromTemplate,
  listOrphanTemplates,
  seedProjectFromTemplate,
} from './productCatalog'

const LS_KEY = 'yz_product_info_overrides_v1'

function setOverrides(obj) {
  localStorage.setItem(LS_KEY, JSON.stringify(obj))
}
function clearOverrides() {
  localStorage.removeItem(LS_KEY)
}

describe('inferSubtasksFromTemplate', () => {
  it('checks kapak + sayfalar for a single book with no special keywords', () => {
    const components = [
      {
        component: '30 GÜNDE DİKKATİNİ GELİŞTİR',
        date: '',
        fields: [
          { k: 'İŞİN ADI', v: '30 GÜNDE DİKKATİNİ GELİŞTİR' },
          { k: 'SAYFA SAYISI', v: '80 sayfa + kapak' },
        ],
      },
    ]
    const out = inferSubtasksFromTemplate(components)
    expect(out.subtasks.kapak).toBe(true)
    expect(out.subtasks.kutu).toBe(false)
    expect(out.subtasks.ses).toBe(false)
    expect(out.subtasks.sayfalar).toBe(true)
    expect(out.pageCount).toBe(80)
  })

  it('checks kutu when a component name contains KUTU', () => {
    const components = [
      {
        component: 'PARMAK BOYAMA - KUTU',
        date: '',
        fields: [{ k: 'İŞİN ADI', v: 'PARMAK BOYAMA - KUTU' }],
      },
    ]
    const out = inferSubtasksFromTemplate(components)
    expect(out.subtasks.kutu).toBe(true)
    expect(out.subtasks.kapak).toBe(true)
  })

  it('checks sticker from a sticker count field', () => {
    const components = [
      {
        component: 'STICKERLI ALBÜM',
        date: '',
        fields: [
          { k: 'İŞİN ADI', v: 'STICKERLI ALBÜM' },
          { k: 'STICKER ADET', v: '24 adet' },
        ],
      },
    ]
    const out = inferSubtasksFromTemplate(components)
    expect(out.subtasks.sticker).toBe(true)
    expect(out.stickerCount).toBe(24)
  })

  it('detects ses from a SES keyword in component name', () => {
    const components = [
      {
        component: 'SESLİ MASAL KİTABI',
        date: '',
        fields: [{ k: 'İŞİN ADI', v: 'SESLİ MASAL KİTABI' }],
      },
    ]
    const out = inferSubtasksFromTemplate(components)
    expect(out.subtasks.ses).toBe(true)
  })

  it('detects yazilim from a YAZILIM keyword in component name', () => {
    const components = [
      {
        component: 'YAZILIM DESTEKLİ ETKİNLİK',
        date: '',
        fields: [{ k: 'İŞİN ADI', v: 'YAZILIM DESTEKLİ ETKİNLİK' }],
      },
    ]
    const out = inferSubtasksFromTemplate(components)
    expect(out.subtasks.yazilim).toBe(true)
  })

  it('detects media from a VIDEO keyword in component name', () => {
    const components = [
      {
        component: 'VİDEOLU ANİMASYON KİTABI',
        date: '',
        fields: [{ k: 'İŞİN ADI', v: 'VİDEOLU ANİMASYON KİTABI' }],
      },
    ]
    const out = inferSubtasksFromTemplate(components)
    expect(out.subtasks.media).toBe(true)
  })

  it('returns an all-false subtasks map for empty components', () => {
    const out = inferSubtasksFromTemplate([])
    expect(out.subtasks.kapak).toBe(false)
    expect(out.subtasks.kutu).toBe(false)
    expect(out.pageCount).toBeUndefined()
    expect(out.stickerCount).toBeUndefined()
  })
})

describe('inferTitleFromTemplate', () => {
  it('prefers İŞİN ADI field', () => {
    const t = inferTitleFromTemplate(
      [
        {
          component: 'GENERIC',
          date: '',
          fields: [
            { k: 'İŞİN ADI', v: 'BENİM KİTABIM' },
            { k: 'SAYFA SAYISI', v: '32' },
          ],
        },
      ],
      'fallback',
    )
    expect(t).toBe('BENİM KİTABIM')
  })

  it('falls back to component name when İŞİN ADI missing', () => {
    const t = inferTitleFromTemplate(
      [{ component: 'COMPONENT ONLY', date: '', fields: [] }],
      'fallback',
    )
    expect(t).toBe('COMPONENT ONLY')
  })
})

describe('listOrphanTemplates', () => {
  beforeEach(() => {
    clearOverrides()
  })

  it('excludes templates that match a real project id', () => {
    const orphans = listOrphanTemplates(['p-x1'])
    expect(orphans.find((t) => t.id === 'p-x1')).toBeUndefined()
    // Other seeds are still surfaced.
    expect(orphans.length).toBeGreaterThan(0)
  })

  it('surfaces override-only entries not linked to a real project', () => {
    setOverrides({
      'orphan-override-1': [
        { component: 'TEST', date: '', fields: [{ k: 'İŞİN ADI', v: 'TEST' }] },
      ],
    })
    const orphans = listOrphanTemplates([])
    expect(orphans.find((t) => t.id === 'orphan-override-1')).toBeDefined()
  })

  it('skips overrides that match a real project', () => {
    setOverrides({
      'real-pid': [
        { component: 'REAL', date: '', fields: [{ k: 'İŞİN ADI', v: 'REAL' }] },
      ],
    })
    const orphans = listOrphanTemplates(['real-pid'])
    expect(orphans.find((t) => t.id === 'real-pid')).toBeUndefined()
  })
})

describe('seedProjectFromTemplate', () => {
  beforeEach(() => {
    clearOverrides()
  })

  it('copies the components into overrides under the new project id', async () => {
    const components = [
      {
        component: 'X',
        date: '',
        fields: [{ k: 'İŞİN ADI', v: 'X' }],
      },
    ]
    await seedProjectFromTemplate('new-project-id', components)
    const overrides = JSON.parse(localStorage.getItem(LS_KEY))
    expect(overrides['new-project-id']).toEqual(components)
  })

  it('clones components so future edits to the template do not mutate the seed', async () => {
    const components = [
      {
        component: 'X',
        date: '',
        fields: [{ k: 'İŞİN ADI', v: 'X' }],
      },
    ]
    await seedProjectFromTemplate('new-project-id', components)
    // Mutate the seed in place — overrides should not change.
    components[0].component = 'MUTATED'
    const overrides = JSON.parse(localStorage.getItem(LS_KEY))
    expect(overrides['new-project-id'][0].component).toBe('X')
  })

  it('is a no-op when components is empty', async () => {
    await seedProjectFromTemplate('new-project-id', [])
    expect(localStorage.getItem(LS_KEY)).toBeNull()
  })
})