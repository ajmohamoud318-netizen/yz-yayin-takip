// Per-parça approval grid rendering (migrations 068/069/070).
//
// Three layers to cover:
//   1. ParcaApprovalRow renders the right status pill + buttons.
//   2. ParcaApprovalGrid shows one row per parça + the bulk button.
//   3. The bulk button is hidden on single-parça sheets (bulkApproveAvailable
//      returns false) and shown on multi-parça sheets.
//
// The tests skip react-testing-library to stay compatible with the
// project's existing jsdom setup; we render into a temporary container
// and assert against the resulting DOM directly.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

import ParcaApprovalRow from './ParcaApprovalRow.jsx'
import ParcaApprovalGrid from './ParcaApprovalGrid.jsx'

// Mock the toast hook so per-row clicks don't blow up in jsdom.
vi.mock('sonner', () => ({
  toast: { success: () => {}, error: () => {} },
}))

let container = null
let root = null
beforeEach(() => {
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

function render(node) {
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>)
  })
}

function $$(selector) {
  return Array.from(container.querySelectorAll(selector))
}

describe('ParcaApprovalRow', () => {
  it('renders the parça name and a "pending" status dot by default', () => {
    render(
      <ParcaApprovalRow
        parca="KAPAK"
        status="pending"
        onApprove={() => {}}
        onReject={() => {}}
      />,
    )
    expect(container.textContent).toContain('KAPAK')
    expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="KAPAK parçasını reddet"]')).toBeTruthy()
  })

  it('hides both buttons on an already-approved parça', () => {
    render(<ParcaApprovalRow parca="KAPAK" status="approved" />)
    expect(container.textContent).toContain('Onaylandı')
    expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBe(null)
    expect(container.querySelector('button[aria-label="KAPAK parçasını reddet"]')).toBe(null)
  })

  it('renders a "Reddedildi" badge on a rejected parça', () => {
    render(<ParcaApprovalRow parca="KUTU" status="rejected" />)
    expect(container.textContent).toContain('Reddedildi')
    expect(container.querySelector('button[aria-label="KUTU parçasını onayla"]')).toBe(null)
  })

  it('shows the signers list when provided', () => {
    render(
      <ParcaApprovalRow
        parca="KAPAK"
        status="approved"
        signers={[{ name: 'Ayşenur', at: '2026-01-01' }]}
      />,
    )
    expect(container.textContent).toContain('Ayşenur')
  })

  it('fires onApprove when the green button is clicked', () => {
    let approved = null
    render(
      <ParcaApprovalRow
        parca="KAPAK"
        status="pending"
        onApprove={() => { approved = 'KAPAK' }}
      />,
    )
    const btn = container.querySelector('button[aria-label="KAPAK parçasını onayla"]')
    act(() => btn.click())
    expect(approved).toBe('KAPAK')
  })

  it('fires onReject when the red ghost button is clicked', () => {
    let rejected = null
    render(
      <ParcaApprovalRow
        parca="KAPAK"
        status="pending"
        onReject={() => { rejected = 'KAPAK' }}
      />,
    )
    const btn = container.querySelector('button[aria-label="KAPAK parçasını reddet"]')
    act(() => btn.click())
    expect(rejected).toBe('KAPAK')
  })
})

describe('ParcaApprovalGrid', () => {
  const SNAPSHOT = ['KAPAK', 'KUTU', 'KILAVUZ']

  it('renders one row per parça on the snapshot', () => {
    const p = { demo_parca_approvals: [], demo_parca_rejections: [] }
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcalar={SNAPSHOT}
        onApproveParcalar={() => {}}
      />,
    )
    for (const name of SNAPSHOT) {
      expect(container.textContent).toContain(name)
    }
  })

  it('hides the bulk button on a single-parça sheet (no need to bulk-approve one row)', () => {
    const p = { demo_parca_approvals: [], demo_parca_rejections: [] }
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcalar={['KAPAK']}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBe(null)
  })

  it('shows the bulk button on a multi-parça sheet with ≥2 pending', () => {
    const p = { demo_parca_approvals: [], demo_parca_rejections: [] }
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcalar={SNAPSHOT}
        onApproveParcalar={() => {}}
      />,
    )
    const btn = container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')
    expect(btn).toBeTruthy()
    expect(btn.textContent).toContain('(3)') // count of pending parçalar
  })

  it('passes `null` (all pending) when the bulk button is clicked', () => {
    const p = { demo_parca_approvals: [], demo_parca_rejections: [] }
    let receivedParcalar = null
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcolar={SNAPSHOT}
        snapshotParcalar={SNAPSHOT}
        onApproveParcalar={(parcalar) => { receivedParcalar = parcalar }}
      />,
    )
    const btn = container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')
    act(() => btn.click())
    // null on the bulk shortcut — server defaults to "all still-pending".
    expect(receivedParcalar).toBe(null)
  })

  it('marks an already-approved parça as approved (read-only, no buttons)', () => {
    const p = {
      demo_parca_approvals: [{ parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur' }],
      demo_parca_rejections: [],
    }
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcalar={SNAPSHOT}
        onApproveParcalar={() => {}}
      />,
    )
    // KAPAK is approved → no approve/reject button for it.
    expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBe(null)
    // KUTU + KILAVUZ still pending → buttons present.
    expect(container.querySelector('button[aria-label="KUTU parçasını onayla"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="KILAVUZ parçasını onayla"]')).toBeTruthy()
  })

  it('hides the bulk button when 0 parçalar are pending (nothing to bulk-approve)', () => {
    const p = {
      demo_parca_approvals: SNAPSHOT.map((name) => ({ parca: name, by: 'u-l' })),
      demo_parca_rejections: [],
    }
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcalar={SNAPSHOT}
        onApproveParcalar={() => {}}
      />,
    )
    // When every parça is already approved, the grid shows NO bulk
    // button — nothing to approve, so the shortcut would be a no-op.
    expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBe(null)
    // The grid also drops the "X bekliyor" header chip.
    expect(container.textContent).not.toContain('bekliyor')
  })

  it('does NOT render anything when the snapshot has no parçalar', () => {
    const p = { demo_parca_approvals: [] }
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcalar={[]}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.textContent.trim()).toBe('')
  })
})
