// Sticker is logged the way İç Sayfalar is (migration 082).
//
// DesignerPagesInput used to be the İç Sayfalar card and nothing else: it read
// total_pages / pages_done and said "sayfa" everywhere. Handed a Sticker row it
// would have come up "0 / —" — a sticker row has no total_pages — and let any
// number through, since the bounds check skips a zero total. These lock that it
// reads the sticker counter and speaks in stickers, and that the pages card it
// grew out of is unchanged.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import DesignerPagesInput from './DesignerPagesInput.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const batch = (over) => ({
  id: 'b1', designer_id: 'd1', designer_name: 'Ayşe', pages: 10, start_page: 1,
  created_at: '2026-09-10T09:00:00Z', redone_at: null, redone_by: null, redone_by_name: null,
  ...over,
})

const sticker = {
  id: 's1', kind: 'sticker-count', title: 'Sticker', assigned_to: 'd1',
  total_stickers: 24, stickers_done: 10, total_pages: null, pages_done: 0, is_done: false,
  designer_batches: [batch()],
}

const pages = {
  id: 's2', kind: 'pages', title: 'İç Sayfalar', assigned_to: 'd1',
  total_pages: 32, pages_done: 8, total_stickers: null, stickers_done: 0, is_done: false,
  designer_batches: [batch({ pages: 8 })],
}

let mounted = []
afterEach(() => {
  for (const { root, host } of mounted) { act(() => root.unmount()); host.remove() }
  mounted = []
})

function render(subtask, onAddBatch = vi.fn()) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(
    <DesignerPagesInput
      subtask={subtask}
      canEdit
      currentUserId="d1"
      allUsers={[{ id: 'd1', name: 'Ayşe' }]}
      onAddBatch={onAddBatch}
      onRedoneBatch={vi.fn()}
    />,
  ))
  mounted.push({ root, host })
  return host
}

function submit(host, text) {
  const input = host.querySelector('input')
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  act(() => {
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('DesignerPagesInput on a Sticker', () => {
  it('reads the sticker counter and speaks in stickers', () => {
    const host = render(sticker)
    expect(host.textContent).toContain('Sticker')
    expect(host.textContent).toContain('10 / 24 tamamlandı')
    expect(host.textContent).toContain('1-10 sticker')
    expect(host.textContent).not.toMatch(/sayfa/i)
  })

  it('holds a sticker past the total back before it reaches the server', () => {
    const onAddBatch = vi.fn()
    const host = render(sticker, onAddBatch)
    submit(host, '25')
    expect(onAddBatch).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Sticker 25 toplam sticker sayısını (24) aşamaz.')
  })

  it('logs a range of stickers as one batch', () => {
    const onAddBatch = vi.fn(() => Promise.resolve())
    const host = render(sticker, onAddBatch)
    submit(host, '11-24')
    expect(onAddBatch).toHaveBeenCalledWith('d1', [{ start: 11, pages: 14 }])
  })
})

describe('DesignerPagesInput on İç Sayfalar', () => {
  it('still counts pages', () => {
    const host = render(pages)
    expect(host.textContent).toContain('İç Sayfalar')
    expect(host.textContent).toContain('8 / 32 tamamlandı')
    expect(host.textContent).toContain('1-8 sayfa')
  })
})
