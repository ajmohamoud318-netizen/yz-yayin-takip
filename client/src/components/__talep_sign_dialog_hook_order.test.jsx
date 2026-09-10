// TalepSignDialog's hook order across a null → order transition.
//
// The dialog is rendered by the ledger page and stays MOUNTED while `order`
// goes null (nothing selected / just closed) and back to a row (next open).
// Its `if (!order) return null` guard therefore runs on some renders and not
// others — so every hook has to sit ABOVE it. When four of them (the parça
// routing state + its fetch effect) sat below, the first render registered
// fewer hooks than the second and React tore the tree down with error #310
// ("Rendered more hooks than during the previous render"), taking the whole
// Sipariş Talepleri page to the ErrorBoundary.
//
// This test is the guard on the guard: it does not care what the dialog
// renders, only that going null → order → null does not throw.
//
// Same no-react-testing-library approach as __parca_routing_ui.test.jsx.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, info: () => {} } }))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Lider', role: 'team_leader' } }),
}))

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ subscribe: () => () => {} }),
}))

// The round's actions are a whole feature of their own (and do their own
// fetching); this test is about hook COUNT, so they are stubbed flat.
vi.mock('@/hooks/useOrderOzalitRound', () => ({
  useOrderOzalitRound: () => ({
    ozalitBusy: false, changeNote: '', setChangeNote: () => {},
    matbaaBusy: false, confirmMatbaaNotReceived: false, setConfirmMatbaaNotReceived: () => {},
    handleStartOzalit: () => {}, handleSaveOzalitEdit: () => {}, handleCancelOzalit: () => {},
    handleRequestOzalitChange: () => {}, handleAcceptOzalitChange: () => {},
    handleDeclineOzalitChange: () => {}, handleMatbaaReceive: () => {},
    handleMatbaaNotReceived: () => {},
  }),
}))

vi.mock('@/data/productCatalog', () => ({
  getComponentsForProject: () => Promise.resolve([]),
  saveComponentsForProject: () => Promise.resolve([]),
  primeProductInfoCache: () => {},
}))

vi.mock('@/data/orderSubtasks', () => ({ saveSubtaskFlags: () => Promise.resolve() }))

// Constants stay real — the dialog's labels and step map drive what renders.
vi.mock('@/api', async () => {
  const actual = await vi.importActual('@/api')
  return {
    ...actual,
    default: {
      ...actual.default,
      listUsers: () => Promise.resolve([]),
      getProject: () => Promise.resolve({ id: 'p1', assignees: [] }),
      getProductInfo: () => Promise.resolve([]),
      listOrderParcaState: () => Promise.resolve([]),
    },
  }
})

const { default: TalepSignDialog } = await import('./TalepSignDialog.jsx')

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

const ORDER = {
  id: 'o1',
  project_id: 'p1',
  status: 'atama_bekleniyor',
  title: 'Deneme Talebi',
  quantity: 100,
  items: [],
  assignee_ids: [],
  ozalit_parcalar: [],
  ozalit_parca_approvals: [],
  ozalit_parca_rejections: [],
  matbaa_approvals: [],
}

function render(order) {
  act(() => {
    root.render(
      <TalepSignDialog order={order} open onOpenChange={() => {}} onSigned={() => {}} onUpdated={() => {}} />,
    )
  })
}

describe('TalepSignDialog hook order', () => {
  it('survives a null → order → null remount-free transition', () => {
    // Mounting with no selection is the render that used to register the
    // SHORTER hook list.
    expect(() => render(null)).not.toThrow()
    // …and this is the one that used to add four more and blow up.
    expect(() => render(ORDER)).not.toThrow()
    // The order's own body reached the DOM — proof the second render got past
    // the guard rather than bailing out to null some other way.
    expect(document.body.textContent).toContain('100 adet')
    // Back to nothing selected: the guard fires again, hook count unchanged.
    expect(() => render(null)).not.toThrow()
  })

  it('survives a split round arriving after an unsplit one', () => {
    // splitRound flips the parça effect between its two branches while the
    // dialog stays mounted — the same hook must run on both renders.
    render(ORDER)
    expect(() => render({ ...ORDER, ozalit_parcalar: ['KAPAK', 'KUTU'] })).not.toThrow()
    expect(() => render(ORDER)).not.toThrow()
  })
})
