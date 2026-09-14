// What a spec sheet actually opens on — exercised through the real hook.
//
// The regression this exists for: the line that reads the round's own parçalar
// (`const baseComponents = savedComponents ?? catalogComponents`) was dropped,
// and the re-send narrowing that replaced it read `baseComponents` inside its
// own initializer. That throws "Cannot access 'baseComponents' before
// initialization" inside `load()`, which nothing catches — so every open of
// every sheet died between setting the künye fields and setting the parça
// blocks, and the catalog-default effect then filled the sheet with the blank
// Ürün Bilgileri template. The matbaa was handed an empty form instead of the
// spec that had been requested from them, and nothing on screen said so.
//
// `narrowToApproved` had unit tests and they all passed: the helper was never
// the broken part. Only mounting the hook catches this, so these tests mount
// it — mocking the two modules that reach the network, and nothing else.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import { useSpecSheet } from './useSpecSheet.js'
import { VARIANTS } from '@/lib/spec-form-variants'

const h = vi.hoisted(() => ({
  api: { getProductInfo: vi.fn(), listDemos: vi.fn() },
  catalog: { components: [] },
}))

vi.mock('@/api', () => ({ default: h.api }))
vi.mock('@/data/productCatalog', async (importOriginal) => ({
  ...(await importOriginal()),
  getComponentsForProject: () => h.catalog.components,
  getComponentRows: (c) => c.rows ?? [],
  primeProductInfoCache: () => {},
}))

// The blank shell a project is seeded with — what the sheet fell back to.
const BLANK_CATALOG = [
  { component: 'AGUMİNO', rows: [{ id: 'c1', label: 'SAYFA SAYISI', value: 'auto' }] },
  { component: 'KUTU', rows: [{ id: 'c2', label: 'ÜST KAĞIT CİNSİ', value: '' }] },
]

// …and what the designer actually sent, recorded on the round.
const sentSheet = (components) => ({
  id: 'd-1', project_id: 'p-1', order_id: null, kind: 'demo', attempt: 1,
  payload: {
    isinAdi: 'AGUMİNO',
    demoIstemTarihi: '11 Eylül 2026',
    demoIsteyenKisi: 'Aylin Ulu',
    _customRows: [],
    _selectedComponents: components,
  },
})

const KUTU_AS_SENT = {
  id: 'KUTU',
  component: 'KUTU',
  rows: [{ id: 'r1', label: 'ÜST KAĞIT CİNSİ', value: '300gr bristol' }],
}
const KITAP_AS_SENT = {
  id: 'KİTAP',
  component: 'KİTAP',
  rows: [{ id: 'r2', label: 'CİLT', value: 'amerikan cilt' }],
}

const baseArgs = (over = {}) => ({
  open: true,
  variant: VARIANTS.demo,
  project: { id: 'p-1', title: 'AGUMİNO', stage: 'demo_teslim', demo_attempt: 0, subtasks: [] },
  order: null,
  // The matbaa, opening the sheet behind "İşlemi Başlatın".
  user: { id: 'u-mat', name: 'yukselen zeka', role: 'printer' },
  mode: 'view',
  scopeId: 'p-1',
  orderId: null,
  orderScoped: false,
  viewAttempt: undefined,
  viewDemoId: null,
  notifyOnSave: false,
  rejectContext: null,
  readOnly: true,
  viewingSentSheet: true,
  showsLiveTeslimat: true,
  attemptNo: 1,
  liveAttempts: [1, 2],
  preselectParcalar: null,
  resendApprovedParcalar: null,
  ...over,
})

function Probe({ args, sink }) {
  const sheet = useSpecSheet(args)
  sink.current = sheet
  return null
}

let container = null
let root = null
let sink = null
beforeEach(() => {
  localStorage.clear()
  h.api.getProductInfo.mockResolvedValue([])
  h.api.listDemos.mockResolvedValue([])
  h.catalog.components = BLANK_CATALOG
  sink = { current: null }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  container = null
  root = null
})

async function mount(args) {
  await act(async () => { root.render(<Probe args={args} sink={sink} />) })
  // Let the snapshot fetch behind the load settle.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const shown = () => (sink.current?.selectedComponents ?? []).map((c) => c.component)

describe('useSpecSheet — which parçalar the sheet opens on', () => {
  it('shows the parçalar the round recorded, with the values that were sent', async () => {
    h.api.listDemos.mockResolvedValue([sentSheet([KUTU_AS_SENT])])
    await mount(baseArgs())

    expect(shown()).toEqual(['KUTU'])
    // The spec itself, not the catalog's empty shell — this is the whole
    // point of the sheet for the matbaa.
    expect(sink.current.selectedComponents[0].rows[0].value).toBe('300gr bristol')
  })

  it('carries the round even when the catalog would offer a different set', async () => {
    h.api.listDemos.mockResolvedValue([sentSheet([KUTU_AS_SENT, KITAP_AS_SENT])])
    await mount(baseArgs())

    // BLANK_CATALOG lists AGUMİNO + KUTU; the round is what decides.
    expect(shown()).toEqual(['KUTU', 'KİTAP'])
  })

  it('falls back to the catalog default when the round recorded none', async () => {
    h.api.listDemos.mockResolvedValue([])
    await mount(baseArgs())

    expect(shown()).toEqual(['AGUMİNO', 'KUTU'])
  })

  it('narrows a re-send to the parçalar the prior round approved', async () => {
    h.api.listDemos.mockResolvedValue([sentSheet([KUTU_AS_SENT, KITAP_AS_SENT])])
    await mount(baseArgs({
      mode: 'advance',
      user: { id: 'u-lead', name: 'Aylin Ulu', role: 'team_leader' },
      readOnly: false,
      viewingSentSheet: false,
      resendApprovedParcalar: ['KUTU'],
    }))

    expect(shown()).toEqual(['KUTU'])
  })

  it('loads the künye fields and the parça blocks together, not one without the other', async () => {
    h.api.listDemos.mockResolvedValue([sentSheet([KUTU_AS_SENT])])
    await mount(baseArgs())

    // The broken load set these and then threw before the blocks, which is
    // exactly what made the empty sheet look like a real one.
    expect(sink.current.form.demoIsteyenKisi).toBe('Aylin Ulu')
    expect(shown()).toEqual(['KUTU'])
  })
})
