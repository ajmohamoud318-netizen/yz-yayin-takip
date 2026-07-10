import { USE_MOCK } from '../config.js'
import { SEED_USERS } from './seed/users.js'
import { SEED_PROJECTS } from './seed/projects.js'
import { SEED_ORDER_REQUESTS } from './seed/order-requests.js'

// Bumped to v8 so the new demo/ozalit form fields (teslimEdenKisi,
// teslimTarihi) and role-aware labels are present from the first render of
// any seeded demo/ozalit form. Older v7 state is left untouched — users can
// clear it manually if they want a clean seed.
const LS_KEY = 'yz_mock_state_v8'

export const mockUsers = [...SEED_USERS]
export const mockProjects = [...SEED_PROJECTS]
export const mockDemos = []
export const mockOrderRequests = [...SEED_ORDER_REQUESTS]
export const mockHandovers = []

export function saveState() {
  if (!USE_MOCK || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        users: mockUsers,
        projects: mockProjects,
        demos: mockDemos,
        orderRequests: mockOrderRequests,
        handovers: mockHandovers,
      }),
    )
  } catch {
    /* ignore quota / private-mode errors */
  }
}

// Demo/Ozalit form snapshots live under two localStorage namespaces, one
// per project id. Demo forms use the "demo" keys, ozalit forms the
// "ozalit" ones — both follow the same shape (see DemoFormDialog.jsx /
// OzalitFormDialog.jsx). Seeded projects that already passed the delivery
// step need a sensible default form so the printer's "TESLİM EDEN KİŞİ"
// row shows a real name instead of falling back to the designer's stamp.
const FORM_LS_PREFIX = (kind, id) => `yz_${kind}_form_${id}`
const FORM_SNAPSHOT_PREFIX = (kind, id, attempt) => `yz_${kind}_form_${id}_snap_${attempt}`
const FORM_PROVISION_FLAG = 'yz_form_provisioned_v8'

// Stages in which the demo/ozalit must already have been delivered.
const POST_DEMO_STAGES    = new Set(['demo_teslim','cin_demo_teslim','demo_onay','cin_demo_onay','ozalit_teslim','ozalit_onay','uretime_hazir','uretimde','gumruk','satista'])
const POST_OZALIT_STAGES  = new Set(['ozalit_teslim','ozalit_onay','uretime_hazir','uretimde','gumruk','satista'])

function provisionFormSnapshots() {
  if (typeof localStorage === 'undefined') return
  if (localStorage.getItem(FORM_PROVISION_FLAG) === '1') return
  const projects = JSON.parse(JSON.stringify(mockProjects))
  const users    = JSON.parse(JSON.stringify(mockUsers))
  const printer  = users.find((u) => u.id === 'u-oktay') || users.find((u) => u.role === 'printer')
  const designerByKey = new Map(users.map((u) => [u.id, u]))
  const trDate = (iso) => iso
    ? new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
    : ''
  for (const p of projects) {
    const designer = designerByKey.get(p.assigned_to)
    const designerName = designer?.name ?? ''
    const baseDemo = {
      isinAdi: p.title,
      demoIstemTarihi: trDate(p.updated_at),
      demoIsteyenKisi: designerName,
      matbaaYetkilisi: printer?.name ?? '',
      onaylayanKisi: '',
    }
    const baseOzalit = {
      isinAdi: p.title,
      ozalitIstemTarihi: trDate(p.updated_at),
      ozalitIsteyenKisi: designerName,
      matbaaYetkilisi: printer?.name ?? '',
      onaylayanKisi: '',
    }
    // Provision demo form for any project past tasarim.
    if (POST_DEMO_STAGES.has(p.stage)) {
      const payload = { ...baseDemo,
        teslimEdenKisi: printer?.name ?? '',
        teslimTarihi:   trDate(p.updated_at),
      }
      const existingRaw = localStorage.getItem(FORM_LS_PREFIX('demo', p.id))
      const existing = existingRaw ? safeJson(existingRaw) : null
      const merged = { ...payload, ...(existing ?? {}) }
      localStorage.setItem(FORM_LS_PREFIX('demo', p.id), JSON.stringify({
        ...merged, _customRows: existing?._customRows ?? [], _selectedComponents: existing?._selectedComponents ?? null,
      }))
      // Seed a snapshot too so the printer's "view attempt" history shows it.
      localStorage.setItem(FORM_SNAPSHOT_PREFIX('demo', p.id, 1), JSON.stringify({
        ...merged, _customRows: existing?._customRows ?? [], _selectedComponents: existing?._selectedComponents ?? null,
      }))
    }
    // Provision ozalit form for any project past ozalit_teslim.
    if (POST_OZALIT_STAGES.has(p.stage)) {
      const payload = { ...baseOzalit,
        teslimEdenKisi: printer?.name ?? '',
        teslimTarihi:   trDate(p.updated_at),
      }
      const existingRaw = localStorage.getItem(FORM_LS_PREFIX('ozalit', p.id))
      const existing = existingRaw ? safeJson(existingRaw) : null
      const merged = { ...payload, ...(existing ?? {}) }
      localStorage.setItem(FORM_LS_PREFIX('ozalit', p.id), JSON.stringify({
        ...merged, _customRows: existing?._customRows ?? [], _selectedComponents: existing?._selectedComponents ?? null,
      }))
      localStorage.setItem(FORM_SNAPSHOT_PREFIX('ozalit', p.id, 1), JSON.stringify({
        ...merged, _customRows: existing?._customRows ?? [], _selectedComponents: existing?._selectedComponents ?? null,
      }))
    }
  }
  localStorage.setItem(FORM_PROVISION_FLAG, '1')
}

function safeJson(raw) {
  try { return JSON.parse(raw) } catch { return null }
}

export function hydrateState() {
  if (!USE_MOCK || typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (Array.isArray(saved.users)) {
      const seedUsers = [...SEED_USERS]
      const byEmail = new Set(saved.users.map((u) => u.email?.toLowerCase()))
      const merged = [...saved.users]
      for (const u of seedUsers) {
        if (!byEmail.has(u.email?.toLowerCase())) merged.push(u)
      }
      mockUsers.length = 0
      mockUsers.push(...merged)
    }
    if (Array.isArray(saved.projects)) {
      mockProjects.length = 0
      mockProjects.push(...saved.projects)
    }
    if (Array.isArray(saved.demos)) {
      mockDemos.length = 0
      mockDemos.push(...saved.demos)
    }
    if (Array.isArray(saved.orderRequests)) {
      mockOrderRequests.length = 0
      mockOrderRequests.push(...saved.orderRequests)
    }
    if (Array.isArray(saved.handovers)) {
      mockHandovers.length = 0
      mockHandovers.push(...saved.handovers)
    }
    // Now that mockProjects is populated, make sure every seeded (or hydrated)
    // project past tasarim has a demo/ozalit form snapshot with the
    // teslimEdenKisi / teslimTarihi pair set. Runs once per browser (flagged
    // by FORM_PROVISION_FLAG).
    provisionFormSnapshots()
  } catch {
    /* corrupt state — fall back to seed data */
  }
}

export function resetMockState() {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(LS_KEY)
    } catch {
      /* ignore */
    }
  }
  mockUsers.length = 0
  mockUsers.push(...SEED_USERS)
  mockProjects.length = 0
  mockProjects.push(...SEED_PROJECTS)
  mockDemos.length = 0
  mockOrderRequests.length = 0
  mockOrderRequests.push(...SEED_ORDER_REQUESTS)
  mockHandovers.length = 0
}

export function delay(ms = 350) {
  return new Promise((r) => setTimeout(r, ms))
}

hydrateState()
// Also provision form snapshots on a brand-new install (when hydrateState
// found nothing under LS_KEY and exited early). The flag inside
// provisionFormSnapshots makes this a one-shot regardless.
provisionFormSnapshots()
