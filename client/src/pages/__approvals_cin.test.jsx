// ÇİN demo forwarding in the leader's Approvals queue.
//
// The leader's demo queue was wired for demo_onay / cin_demo_onay only —
// both approval gates. ÇİN's "leader incelemesinde" stage (cin_demo_teslim)
// is not an approval gate; it is the round coming back from China that the
// leader forwards to cin_demo_onay (server computeDemoTeslimAdvance). The
// queue page therefore never listed the project, and the only way in was
// the project page directly or the notification deep link.
//
// This test pins:
//   1. The leader's demo queue surfaces a ÇİN project sitting at
//      cin_demo_teslim.
//   2. The row's affordance is the ÇİN forward (button labelled
//      "Onaya Gönderin" → DemoFormDialog with mode='advance'), not a
//      (non-existent) approve or a wrong "Demoyu Teslim Alın".
//   3. Non-leaders do not see cin_demo_teslim in their demo queue — the
//      ÇİN forward is the leader's act alone.
//
// Mounting the full Approvals page would pull in the entire project/store
// scaffold, so we replace every hook it depends on with the smallest stub
// that exercises the filterQueue + Actions paths the change touches.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Dialogs pulled in by Approvals reach `useProjectsStore` / `useAuth` /
// `useNotifications` and a stack of components the page never renders in
// these tests. Stub them all to a no-op render — we only assert on the
// queue row, never on what the dialog does after a click.
vi.mock('@/components/ApprovalDialog', () => ({
  default: () => null,
}))
vi.mock('@/components/DemoFormDialog', () => ({
  default: () => null,
}))
vi.mock('@/components/OzalitFormDialog', () => ({
  default: () => null,
}))
vi.mock('@/components/BaskiOnayFormDialog', () => ({
  default: () => null,
}))
vi.mock('@/components/EkranDemoRejectDialog', () => ({
  default: () => null,
}))
vi.mock('@/components/ParcaRejectDialog', () => ({
  default: () => null,
}))
vi.mock('@/components/ParcaJobBoard', () => ({
  default: () => null,
}))
vi.mock('@/components/ParcaApprovalGrid', () => ({
  default: () => null,
}))
vi.mock('@/components/TalepSignDialog', () => ({
  default: () => null,
}))
vi.mock('@/components/OrderNoBadge', () => ({
  default: () => null,
}))

// — Stubs —————————————————————————————————————————————————————————————————

let mockUser = null

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser }),
}))

// The store is the single source of truth the page reads. Tests inject
// projects via the closure-scoped `mockProjects` below.
let mockProjects = []
let mockUpdateOne = vi.fn()
vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({
    projects: mockProjects,
    loading: false,
    updateOne: mockUpdateOne,
  }),
}))

// Parça queue is additive to the stage queue. Empty by default — the ÇİN
// demo at cin_demo_teslim has no split round; the demo leg is whole-sheet.
vi.mock('@/hooks/useParcaQueue', () => ({
  useParcaQueue: () => ({ rows: [], refetch: () => {}, loading: false }),
}))

// All API calls are stubbed to no-ops. The queue loads listDemos to resolve
// the per-parça snapshot for any project at a *_teslim/*_onay gate; for
// cin_demo_teslim projects the snapshot is irrelevant, so the empty array
// is fine. The rest of the calls (advance / approve / reject) only fire on
// click and the tests never click.
vi.mock('@/api', () => {
  const stub = () => Promise.resolve([])
  return {
    default: {
      listDemos: stub,
      listOrderRequests: stub,
      listParcaQueue: stub,
    },
    listDemos: stub,
    listOrderRequests: stub,
    STAGE_LABELS: {
      tasarim: 'Tasarım',
      demo_teslim: 'Demo Teslim',
      demo_onay: 'Demo Onay',
      cin_demo_teslim: 'ÇİN Demo Teslim',
      cin_demo_onay: 'ÇİN Demo Onay',
      ozalit_teslim: 'Ozalit Teslim',
      ozalit_onay: 'Ozalit Onay',
      baski_onay: 'Baskı Onay',
      cin_baski_onay: 'ÇİN Baskı Onay',
      baskida: 'Baskıda',
      gumruk: 'Gümrük',
      satista: 'Satışta',
    },
    TYPE_LABELS: { TR: 'TR', CIN: 'ÇİN' },
  }
})

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ subscribe: () => () => {} }),
}))

vi.mock('sonner', () => ({
  toast: { success: () => {}, error: () => {}, info: () => {} },
}))

// — DOM harness ————————————————————————————————————————————————————————

let container = null
let root = null
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockUser = null
  mockProjects = []
  mockUpdateOne = vi.fn()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  container = null
  root = null
})

function render(node) {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/approvals/demo']}>
        <Routes>
          <Route path="/approvals/:tab" element={node} />
          <Route path="/approvals" element={node} />
        </Routes>
      </MemoryRouter>,
    )
  })
}

function $$(selector) {
  return Array.from(container.querySelectorAll(selector))
}

// Approvals imports the default export — import after the mocks so the
// stubs are in place when its module graph evaluates.
import Approvals from './Approvals.jsx'

const leader = { id: 'u-l', name: 'Ayşenur', role: 'team_leader' }
const designer = { id: 'u-d', name: 'Aylin', role: 'designer' }
const printer = { id: 'u-p', name: 'Matbaa', role: 'printer' }

const cinProject = {
  id: 'p-cin',
  type: 'CIN',
  stage: 'cin_demo_teslim',
  title: 'Çin Ansiklopedisi',
  assigned_name: 'Aylin Ulu',
  target_month: '2026-10',
  assignees: [{ id: 'u-d', name: 'Aylin' }],
  demo_received: false,
  progress: 40,
}
const trProject = {
  id: 'p-tr',
  type: 'TR',
  stage: 'demo_teslim',
  title: 'Yerli Kitap',
  assigned_name: 'Aylin Ulu',
  target_month: '2026-10',
  assignees: [{ id: 'u-d', name: 'Aylin' }],
  demo_received: false,
  demo_started: false,
  progress: 60,
}

describe("Approvals — ÇİN demo forwarding for the leader", () => {
  it('surfaces a cin_demo_teslim project to the leader\'s demo queue', () => {
    mockUser = leader
    mockProjects = [cinProject]
    render(<Approvals />)
    // Title appears in the queue row.
    expect(container.textContent).toContain('Çin Ansiklopedisi')
    // The ÇİN forward button (Onaya Gönderin) is offered. The TR-style
    // "Demoyu Teslim Alın" must NOT show up — there is no receipt to take
    // at this stage, the leader is forwarding the round.
    expect(container.textContent).toContain('Onaya Gönderin')
    expect(container.textContent).not.toContain('Demoyu Teslim Alın')
    expect(container.textContent).not.toContain('Demoyu Onaylayın')
  })

  it('still surfaces TR demo_onay projects alongside ÇİN demos', () => {
    // A leader with both: both rows visible, each with the affordance that
    // belongs to its stage. The PR for this fix must not regress the
    // existing TR queue path.
    mockUser = leader
    mockProjects = [
      cinProject,
      { ...trProject, id: 'p-tr-onay', stage: 'demo_onay', demo_received: true },
    ]
    render(<Approvals />)
    expect(container.textContent).toContain('Çin Ansiklopedisi')
    expect(container.textContent).toContain('Yerli Kitap')
    // ÇİN row has the ÇİN forward button.
    expect(container.textContent).toContain('Onaya Gönderin')
  })

  it('hides cin_demo_teslim from non-leaders', () => {
    // The ÇİN forward is the leader's act — the matbaa is not in the loop,
    // and the designer's desk is the pre-teslim round, not this approval
    // step. Neither role should see the row.
    for (const u of [designer, printer]) {
      mockUser = u
      mockProjects = [cinProject]
      // Reset the DOM between role flips.
      act(() => root.unmount())
      container.remove()
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      render(<Approvals />)
      expect(container.textContent ?? '').not.toContain('Çin Ansiklopedisi')
    }
  })

  it('still hides a TR demo at demo_teslim from the leader', () => {
    // TR demo_teslim is the matbaa's stage — the matbaa delivers, the
    // leader does not. The ÇİN branch must not be so loose that it pulls
    // TR projects at the wrong stage into the leader's queue.
    mockUser = leader
    mockProjects = [{ ...trProject, stage: 'demo_teslim' }]
    render(<Approvals />)
    expect(container.textContent ?? '').not.toContain('Yerli Kitap')
    expect(container.textContent ?? '').not.toContain('Onaya Gönderin')
  })

  it('does not show the ÇİN forward button for a leader at cin_demo_onay', () => {
    // cin_demo_onay is the actual approval gate — the leader's act there
    // is a real Onayla/Reddet, not a forward. The new branch is strictly
    // gated on cin_demo_teslim.
    mockUser = leader
    mockProjects = [{ ...cinProject, stage: 'cin_demo_onay', demo_received: true }]
    render(<Approvals />)
    // Title appears (it is a leader demo queue row), but the ÇİN forward
    // button does not — the existing approve path owns this stage.
    expect(container.textContent).toContain('Çin Ansiklopedisi')
    expect(container.textContent).not.toContain('Onaya Gönderin')
  })
})
