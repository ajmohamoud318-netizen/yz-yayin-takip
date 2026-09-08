// The per-parça grid on a round that is still out at the matbaa (migration 076).
//
// The grid was built for an approval gate, where every un-signed parça is one
// the leader could sign. On an unfinished round that is false in two different
// ways: a parça may be back but unacknowledged (nothing may be signed off
// before a "Teslim Alındı"), or still in the press (nobody's decision to make).
// Rendering the same thumbs-up on all three offered clicks the server refuses.
//
// Passing `parcaRows` is what tells the grid which is which. Without them —
// at the *_onay gates — it must behave exactly as it always has.
//
// Same no-react-testing-library approach as __parca_routing_ui.test.jsx.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import ParcaApprovalGrid from './ParcaApprovalGrid.jsx'

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }))

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

const SNAPSHOT = ['KAPAK', 'KUTU', 'KILAVUZ']
const project = (extra = {}) => ({
  id: 'p1', stage: 'demo_teslim',
  demo_parca_approvals: [], demo_parca_rejections: [],
  ...extra,
})
const row = (parca, extra = {}) => ({
  parca, state: 'pending', owner_role: null,
  delivered_at: '2026-09-08T09:00:00Z', received_at: null, ...extra,
})
const receivedRow = (parca) => row(parca, { received_at: '2026-09-08T10:00:00Z' })
const outRow = (parca) => row(parca, { state: 'with_matbaa', owner_role: 'printer', delivered_at: null })

function render(props) {
  act(() => {
    root.render(
      <ParcaApprovalGrid
        project={project()}
        kind="demo"
        snapshotParcalar={SNAPSHOT}
        onApproveParcalar={() => {}}
        onRejectParcalar={() => {}}
        {...props}
      />,
    )
  })
  return container
}

const buttons = () => [...container.querySelectorAll('button')]
const labelled = (fragment) =>
  buttons().filter((b) => (b.getAttribute('aria-label') ?? '').includes(fragment))

describe('the grid on an unfinished round', () => {
  it('offers Teslim Alın — and nothing else — on a parça that is back but unacknowledged', () => {
    render({
      parcaRows: [row('KUTU'), outRow('KAPAK'), outRow('KILAVUZ')],
      onReceiveParca: () => {},
    })
    expect(labelled('KUTU parçasını teslim alın')).toHaveLength(1)
    expect(labelled('KUTU parçasını onayla')).toHaveLength(0)
    expect(labelled('KUTU parçasını reddet')).toHaveLength(0)
  })

  it('offers Onayla/Reddedin once the parça has been received', () => {
    render({
      parcaRows: [receivedRow('KUTU'), outRow('KAPAK'), outRow('KILAVUZ')],
      onReceiveParca: () => {},
    })
    expect(labelled('KUTU parçasını onayla')).toHaveLength(1)
    expect(labelled('KUTU parçasını reddet')).toHaveLength(1)
    expect(labelled('KUTU parçasını teslim alın')).toHaveLength(0)
  })

  it('shows the parçalar still in the press, without offering a decision', () => {
    const el = render({
      parcaRows: [receivedRow('KUTU'), outRow('KAPAK'), outRow('KILAVUZ')],
      onReceiveParca: () => {},
    })
    // Present — a leader who can only see their own parça cannot tell whether
    // the round is waiting on them or on the matbaa.
    expect(el.textContent).toContain('KAPAK')
    expect(el.textContent).toContain('Matbaada')
    expect(labelled('KAPAK parçasını onayla')).toHaveLength(0)
  })

  it('names the desk a parça is actually on', () => {
    const el = render({
      parcaRows: [
        receivedRow('KUTU'),
        row('KAPAK', { state: 'with_designer', owner_role: 'designer', delivered_at: null }),
        outRow('KILAVUZ'),
      ],
      onReceiveParca: () => {},
    })
    expect(el.textContent).toContain('Tasarımcıda')
  })

  it('scopes the bulk button to what is actually decidable, and names those parçalar', () => {
    const seen = []
    render({
      parcaRows: [receivedRow('KUTU'), receivedRow('KAPAK'), outRow('KILAVUZ')],
      onReceiveParca: () => {},
      onApproveParcalar: (parcalar) => seen.push(parcalar),
    })
    const bulk = buttons().find((b) => (b.getAttribute('aria-label') ?? '').includes('Tüm parçaları'))
    expect(bulk.textContent).toContain('(2)')
    act(() => { bulk.click() })
    // Never null here: to the server null means "everything still pending",
    // which on this round includes the parça still in the press.
    expect(seen).toEqual([['KAPAK', 'KUTU']])
  })

  it('hides the bulk button when nothing has been received yet', () => {
    render({ parcaRows: [row('KUTU'), outRow('KAPAK'), outRow('KILAVUZ')], onReceiveParca: () => {} })
    expect(buttons().filter((b) => (b.getAttribute('aria-label') ?? '').includes('Tüm parçaları')))
      .toHaveLength(0)
  })
})

describe('the grid at the approval gate is untouched', () => {
  it('keeps offering every pending parça when no routing rows are passed', () => {
    render({ project: project({ stage: 'demo_onay' }) })
    for (const parca of SNAPSHOT) {
      expect(labelled(`${parca} parçasını onayla`)).toHaveLength(1)
    }
  })

  it('still sends null for the bulk shortcut there', () => {
    const seen = []
    render({ project: project({ stage: 'demo_onay' }), onApproveParcalar: (p) => seen.push(p) })
    const bulk = buttons().find((b) => (b.getAttribute('aria-label') ?? '').includes('Tüm parçaları'))
    act(() => { bulk.click() })
    expect(seen).toEqual([null])
  })
})
