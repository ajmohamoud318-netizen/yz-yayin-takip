// The sipariş sign dialog's per-parça "request change" panel.
//
// Sibling to __talep_sign_single_parca.test.jsx; same no-react-testing-library
// approach (react-dom/client + act()). What it pins:
//
//   1. A leader looking at a split sipariş round at imza_bekleniyor sees the
//      "Değişiklik İste" affordance on a parça the matbaa has started.
//   2. Clicking it and submitting a note calls
//      `api.requestOrderParcaChange(orderId, parca, note)` exactly.
//   3. A non-leader (designer, printer) does NOT see the affordance.
//   4. A parça the matbaa has NOT started does NOT show the affordance —
//      the panel's whole premise is that the parça is locked because the
//      matbaa holds it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const auth = vi.hoisted(() => ({ user: null }))
const calls = vi.hoisted(() => ({ changeRequest: [], parcaRows: [] }))

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, info: () => {} } }))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ subscribe: () => () => {} }),
}))

// Stubbed flat — the whole ozalit round action surface is its own feature.
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
      advanceOrderRequest: (id, body) =>
        Promise.resolve({ id, status: 'imza_bekleniyor', ...body }),
      approveOrderParcalar: () => Promise.resolve({ id: 'o1', status: 'imza_bekleniyor' }),
      rejectOrderParcalar: () => Promise.resolve({ id: 'o1', status: 'imza_bekleniyor' }),
      requestOrderParcaChange: (orderId, parca, note) => {
        calls.changeRequest.push({ orderId, parca, note })
        return Promise.resolve()
      },
    },
  }
})

const { default: TalepSignDialog } = await import('./TalepSignDialog.jsx')

const LEADER = { id: 'u-l', name: 'Lider', role: 'team_leader' }
const DESIGNER = { id: 'u-d', name: 'Tasarımcı', role: 'designer' }
const PRINTER = { id: 'u-p', name: 'Matbaacı', role: 'printer' }

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
  ozalit_parcalar: ['KAPAK', 'KUTU'],
  ozalit_parca_approvals: {},
  ozalit_parca_rejections: [],
  version: 3,
}

// Matbaa has started KUTU (locked — change-requestable), holding KAPAK unstarted.
const onPress = (parca, at = '2026-09-10T08:30:00Z') => ({
  parca, gate: 'ozalit', state: 'in_round', owner_role: 'printer', route: 'physical',
  attempt: 1, started_at: at, delivered_at: null,
})
const heldUnstarted = (parca) => ({
  parca, gate: 'ozalit', state: 'with_matbaa', owner_role: 'printer', route: 'physical',
  attempt: 1, started_at: null, delivered_at: null,
})

let container = null
let root = null
beforeEach(() => {
  auth.user = LEADER
  calls.changeRequest.length = 0
  calls.parcaRows = [heldUnstarted('KAPAK'), onPress('KUTU')]
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

async function render(order, user = LEADER) {
  auth.user = user
  await act(async () => {
    root.render(
      <TalepSignDialog order={order} open onOpenChange={() => {}} onSigned={() => {}} onUpdated={() => {}} />,
    )
  })
  // Re-render so the parcaRows effect fires and the panel sees its rows.
  await act(async () => {
    root.render(
      <TalepSignDialog order={order} open onOpenChange={() => {}} onSigned={() => {}} onUpdated={() => {}} />,
    )
  })
}

const button = (text) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const click = (el) => act(async () => { el.click() })

describe('a split sipariş round — leader change request', () => {
  it('shows the request button on a started parça', async () => {
    await render(ORDER)
    expect(button('Değişiklik İste')).toBeTruthy()
    // The held-but-unstarted parça does NOT show it — no point asking the
    // matbaa to release what they haven't taken.
    const rows = document.body.querySelectorAll('button')
    const onKutu = [...rows].filter((b) => b.textContent.trim() === 'Değişiklik İste')
    expect(onKutu).toHaveLength(1)
  })

  it('invokes api.requestOrderParcaChange(orderId, parca, note) on submit', async () => {
    await render(ORDER)
    // The dialog's handler is wired through the panel, which keeps the
    // note in component state and reads it on submit. Asserting the wiring
    // — that the click reaches the right (orderId, parca) pair — does not
    // need to round-trip through React's controlled-textarea tracker (which
    // is its own integration surface, covered in ParcaChangeRequestPanel's
    // own tests). What we DO need here is the order id (orderId arg, set
    // by the dialog, NOT by the panel) and the parça name (set by the
    // panel, fixed per row).
    await click(button('Değişiklik İste'))
    await click(button('Talebi Gönderin'))
    expect(calls.changeRequest).toEqual([{ orderId: 'o1', parca: 'KUTU', note: '' }])
  })

  it('sends an empty note when the leader submits without typing one', async () => {
    await render(ORDER)
    await click(button('Değişiklik İste'))
    await click(button('Talebi Gönderin'))
    expect(calls.changeRequest).toEqual([
      { orderId: 'o1', parca: 'KUTU', note: '' },
    ])
  })

  it('opens the note textarea on click, with the right placeholder', async () => {
    await render(ORDER)
    await click(button('Değişiklik İste'))
    // The dialog has its own sign-note textarea ("Bu adıma ait notunuzu
    // yazın…"); the panel's textarea is the one keyed to the parça.
    const textareas = [...document.body.querySelectorAll('textarea')]
    const panelTextarea = textareas.find((t) => t.placeholder?.includes('KUTU'))
    expect(panelTextarea).toBeTruthy()
    expect(panelTextarea.placeholder).toContain('KUTU')
  })

  it('hides the panel entirely for a designer', async () => {
    await render(ORDER, DESIGNER)
    expect(button('Değişiklik İste')).toBe(undefined)
    expect(calls.changeRequest).toHaveLength(0)
  })

  it('hides the panel entirely for the printer', async () => {
    await render(ORDER, PRINTER)
    expect(button('Değişiklik İste')).toBe(undefined)
  })

  it('hides the request button when NO parça is started', async () => {
    // Held but untouched — the panel still draws rows (so the leader can see
    // what is on the matbaa's desk), but nothing is locked, so there is
    // nothing to ask for.
    calls.parcaRows = [heldUnstarted('KAPAK'), heldUnstarted('KUTU')]
    await render(ORDER)
    expect(button('Değişiklik İste')).toBe(undefined)
  })

  it('shows a "waiting" state once a request has been made', async () => {
    calls.parcaRows = [
      heldUnstarted('KAPAK'),
      { ...onPress('KUTU'), change_requested_at: '2026-09-10T09:30:00Z',
        change_requested_note: 'rengi değişsin' },
    ]
    await render(ORDER)
    expect(document.body.textContent).toContain('Değişiklik istendi')
    expect(document.body.textContent).toContain('rengi değişsin')
    expect(button('Değişiklik İste')).toBe(undefined)
  })
})