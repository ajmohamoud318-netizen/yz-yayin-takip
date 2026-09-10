// The sipariş sign dialog's parça panel, and the form it is drawn inside.
//
// Two things pinned here:
//
//   1. A round of ONE parça is decided in the grid, as the whole order. Its
//      thumbs-up is the footer's old Onaylayın (advanceOrderRequest) and its
//      thumbs-down opens the whole-order reject form — never the per-parça
//      endpoints: a round of one has no parça routing, and the whole-order
//      reject does not clear the per-parça ledger.
//
//   2. The grid sits inside <form onSubmit={handleSign}>, and `Button` sets no
//      `type` of its own. So a per-parça thumbs-up on a split round used to
//      submit the form as well — the whole-order approve, on top of its own.
//
// Same no-react-testing-library approach as __talep_sign_dialog_hook_order.test.jsx.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const auth = vi.hoisted(() => ({ user: null }))
const calls = vi.hoisted(() => ({ advance: [], approveParcalar: [], rejectParcalar: [], parcaRows: [] }))

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, info: () => {} } }))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ subscribe: () => () => {} }),
}))

// The round's printer-side actions are their own feature; stubbed flat.
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

// Synchronous: the leader's spec editor deep-clones this straight into state.
vi.mock('@/data/productCatalog', () => ({
  getComponentsForProject: () => [],
  saveComponentsForProject: () => Promise.resolve([]),
  primeProductInfoCache: () => {},
}))

vi.mock('@/data/orderSubtasks', () => ({ saveSubtaskFlags: () => Promise.resolve() }))

vi.mock('@/api', async () => {
  const actual = await vi.importActual('@/api')
  return {
    ...actual,
    default: {
      ...actual.default,
      listUsers: () => Promise.resolve([]),
      getProject: () => Promise.resolve({ id: 'p1', assignees: [] }),
      getProductInfo: () => Promise.resolve([]),
      listOrderParcaState: () => Promise.resolve(calls.parcaRows),
      advanceOrderRequest: (id, body) => {
        calls.advance.push({ id, body })
        return Promise.resolve({ id, status: 'imza_bekleniyor' })
      },
      approveOrderParcalar: (id, parcalar) => {
        calls.approveParcalar.push({ id, parcalar })
        return Promise.resolve({ id, status: 'imza_bekleniyor' })
      },
      rejectOrderParcalar: (id, parcalar) => {
        calls.rejectParcalar.push({ id, parcalar })
        return Promise.resolve({ id, status: 'imza_bekleniyor' })
      },
    },
  }
})

const { default: TalepSignDialog } = await import('./TalepSignDialog.jsx')

const LEADER = { id: 'u-l', name: 'Lider', role: 'team_leader' }
const DESIGNER = { id: 'u-d', name: 'Tasarımcı', role: 'designer' }
const LEADER_SIGNED = [{ id: 'u-l', role: 'team_leader', name: 'Lider', at: '2026-09-10T09:00:00Z' }]

const ORDER = {
  id: 'o1',
  project_id: 'p1',
  project_title: 'Deneme Kitabı',
  status: 'imza_bekleniyor',
  quantity: 100,
  items: [],
  assignee_ids: ['u-d'],
  matbaa_received: true,
  matbaa_approvals: [],
  ozalit_parcalar: ['ANA PARÇA'],
  ozalit_parca_approvals: {},
  ozalit_parca_rejections: [],
  version: 3,
}

let container = null
let root = null
beforeEach(() => {
  auth.user = LEADER
  calls.advance.length = 0
  calls.approveParcalar.length = 0
  calls.rejectParcalar.length = 0
  calls.parcaRows = []
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

async function render(order) {
  await act(async () => {
    root.render(
      <TalepSignDialog order={order} open onOpenChange={() => {}} onSigned={() => {}} onUpdated={() => {}} />,
    )
  })
}

// The dialog portals into document.body, not into the container.
const byLabel = (label) => document.body.querySelector(`button[aria-label="${label}"]`)
const buttonsReading = (text) =>
  [...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === text)
const click = (button) => act(async () => { button.click() })

describe('a sipariş round of one parça', () => {
  it('is decided in the parça panel', async () => {
    await render(ORDER)
    expect(document.body.textContent).toContain('1 parça')
    expect(byLabel('ANA PARÇA parçasını onayla')).toBeTruthy()
    expect(byLabel('ANA PARÇA parçasını reddet')).toBeTruthy()
  })

  it('takes the footer’s Onaylayın and Reddedin into the panel', async () => {
    await render(ORDER)
    expect(document.body.querySelector('button[type="submit"]')).toBe(null)
    expect(buttonsReading('Reddedin')).toHaveLength(0)
  })

  it('approves the WHOLE order from the row — never the per-parça endpoint', async () => {
    await render(ORDER)
    await click(byLabel('ANA PARÇA parçasını onayla'))
    expect(calls.advance).toHaveLength(1)
    expect(calls.advance[0].id).toBe('o1')
    expect(calls.advance[0].body.expectedVersion).toBe(3)
    expect(calls.approveParcalar).toHaveLength(0)
  })

  it('opens the whole-order reject form from the row, and approves nothing', async () => {
    await render(ORDER)
    await click(byLabel('ANA PARÇA parçasını reddet'))
    expect(calls.advance).toHaveLength(0)
    expect(calls.rejectParcalar).toHaveLength(0)
    // The reject form's own confirm takes the panel's place.
    expect(buttonsReading('Reddi Onaylayın')).toHaveLength(1)
    expect(byLabel('ANA PARÇA parçasını onayla')).toBe(null)
  })

  it('reads the order’s own approval ledger — a leader who signed sees it signed', async () => {
    await render({ ...ORDER, matbaa_approvals: LEADER_SIGNED })
    expect(byLabel('ANA PARÇA parçasını onayla')).toBe(null)
    expect(document.body.textContent).toContain('Onaylandı')
  })

  it('gives the assigned designer a thumb only once a leader has signed, and no reject', async () => {
    auth.user = DESIGNER
    await render(ORDER)
    expect(byLabel('ANA PARÇA parçasını onayla')).toBe(null)

    await render({ ...ORDER, matbaa_approvals: LEADER_SIGNED })
    expect(byLabel('ANA PARÇA parçasını onayla')).toBeTruthy()
    expect(byLabel('ANA PARÇA parçasını reddet')).toBe(null)
  })
})

describe('a split sipariş round', () => {
  const received = (parca) => ({
    parca, state: 'pending', owner_role: null,
    delivered_at: '2026-09-10T08:00:00Z', received_at: '2026-09-10T08:30:00Z',
  })
  const SPLIT = { ...ORDER, ozalit_parcalar: ['KAPAK', 'KUTU'] }

  it('signs one parça without also submitting the whole order', async () => {
    calls.parcaRows = [received('KAPAK'), received('KUTU')]
    await render(SPLIT)
    // The routing rows arrive from an effect; let it land.
    await render(SPLIT)
    const thumb = byLabel('KAPAK parçasını onayla')
    expect(thumb).toBeTruthy()
    await click(thumb)
    expect(calls.approveParcalar).toEqual([{ id: 'o1', parcalar: ['KAPAK'] }])
    expect(calls.advance).toHaveLength(0)
  })
})
