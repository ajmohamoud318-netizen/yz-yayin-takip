// ParcaJobBoard opens the sheet the matbaa was actually asked to produce.
//
// The regression: the board built the dialog's `project` from the queue row
// ({ id, title } and nothing else) and never passed the order. SpecFormDialog
// picks the snapshot slot from the round counter and the round's owner from
// `order`, so every job opened slot 1 of the PROJECT's sheet — round 1's spec
// on a later round, and the title's own ozalit on a sipariş.
//
// Same no-react-testing-library approach as __parca_change_request_ui.test.jsx.
// The dialogs are stubbed to record their props: what they do with a project
// and an order is SpecFormDialog's business; this file is about what the board
// hands them.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

import ParcaJobBoard from './ParcaJobBoard.jsx'

const h = vi.hoisted(() => ({
  api: { getProject: vi.fn(), listOrderRequests: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  demo: [],
  ozalit: [],
}))

vi.mock('@/api', () => ({ default: h.api }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/DemoFormDialog', () => ({
  default: (props) => { h.demo.push(props); return null },
}))
vi.mock('@/components/OzalitFormDialog', () => ({
  default: (props) => { h.ozalit.push(props); return null },
}))
// One button per group, acting on its first row — a card's own button.
vi.mock('@/components/ParcaJobGroup', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ rows, onAct, busy }) => createElement(
      'button',
      { type: 'button', disabled: busy, onClick: () => onAct(rows[0]) },
      rows[0].parca,
    ),
  }
})

let container = null
let root = null
beforeEach(() => {
  h.demo.length = 0
  h.ozalit.length = 0
  h.api.getProject.mockReset()
  h.api.listOrderRequests.mockReset()
  h.toast.error.mockReset()
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
  act(() => { root.render(<MemoryRouter>{node}</MemoryRouter>) })
}
async function tap(label) {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  // Let the fetches behind the tap settle and the dialog state land.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const last = (calls) => calls[calls.length - 1]

const row = (parca, over = {}) => ({
  project_id: 'p-1', project_title: 'Bilsem 3', order_id: null,
  parca, gate: 'demo', state: 'with_matbaa', owner_role: 'printer', attempt: 1,
  ...over,
})

describe('ParcaJobBoard — the sheet behind a job', () => {
  it('opens a project job on the full project, so the dialog reads the live round', async () => {
    h.api.getProject.mockResolvedValue({ id: 'p-1', title: 'Bilsem 3', stage: 'demo_teslim', demo_attempt: 2 })
    render(<ParcaJobBoard rows={[row('KUTU')]} />)
    await tap('KUTU')

    const props = last(h.demo)
    expect(props.open).toBe(true)
    // The round counter picks the snapshot slot — the queue row never had it.
    expect(props.project.demo_attempt).toBe(2)
    expect(props.parcaScope).toEqual(['KUTU'])
    expect(h.api.listOrderRequests).not.toHaveBeenCalled()
  })

  it("opens a sipariş job on the order's own sheet, not the project's", async () => {
    h.api.getProject.mockResolvedValue({ id: 'p-1', title: 'Bilsem 3', stage: 'satista', ozalit_attempt: 4 })
    h.api.listOrderRequests.mockResolvedValue([
      { id: 'o-other', project_id: 'p-1', status: 'matbaa_ozalit_yapiyor', ozalit_attempt: 0 },
      { id: 'o-1', project_id: 'p-1', status: 'matbaa_ozalit_yapiyor', ozalit_attempt: 1 },
    ])
    render(<ParcaJobBoard rows={[row('KİTAP', { order_id: 'o-1', gate: 'ozalit' })]} />)
    await tap('KİTAP')

    const props = last(h.ozalit)
    expect(props.open).toBe(true)
    expect(props.order?.id).toBe('o-1')
    expect(props.project.id).toBe('p-1')
  })

  it("passes no order on the project's own ozalit round", async () => {
    h.api.getProject.mockResolvedValue({ id: 'p-1', stage: 'ozalit_teslim', ozalit_attempt: 1 })
    render(<ParcaJobBoard rows={[row('KUTU', { gate: 'ozalit' })]} />)
    await tap('KUTU')

    const props = last(h.ozalit)
    expect(props.open).toBe(true)
    expect(props.order).toBeNull()
  })

  it("does not fall back to the project's sheet when the sipariş is gone", async () => {
    const onChanged = vi.fn()
    h.api.getProject.mockResolvedValue({ id: 'p-1', ozalit_attempt: 4 })
    h.api.listOrderRequests.mockResolvedValue([])
    render(<ParcaJobBoard rows={[row('KİTAP', { order_id: 'o-1', gate: 'ozalit' })]} onChanged={onChanged} />)
    await tap('KİTAP')

    expect(last(h.ozalit).open).toBe(false)
    expect(h.toast.error).toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalled()
  })

  it('does not open a stub sheet when the project cannot be loaded', async () => {
    h.api.getProject.mockRejectedValue(new Error('Ağ hatası'))
    render(<ParcaJobBoard rows={[row('KUTU')]} />)
    await tap('KUTU')

    expect(last(h.demo).open).toBe(false)
    expect(h.toast.error).toHaveBeenCalledWith('Ağ hatası')
  })
})
