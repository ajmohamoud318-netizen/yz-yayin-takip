// DesignerPagesInput drives both "İç Sayfalar" and "Sticker" (migration 082).
// Migration 084 dropped `start_page` and the range parser: each save is a
// simple "+N" contribution to a shared subtask counter, and each row grows
// a "Sil" button gated on ownership (or team leader). These lock:
//
//   • the counter it reads (`total_pages`/`pages_done` vs
//     `total_stickers`/`stickers_done`),
//   • the word it speaks ("sayfa" vs "sticker"),
//   • the "+N" wire contract for onAddBatch,
//   • the overshoot guard's Turkish error text,
//   • the Sil affordance's ownership/leader gating and its wire contract.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import DesignerPagesInput from './DesignerPagesInput.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const batch = (over) => ({
  id: 'b1', designer_id: 'd1', designer_name: 'Ayşe', pages: 10,
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

function render(subtask, overrides = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const {
    onAddBatch = vi.fn(() => Promise.resolve()),
    onRedoneBatch = vi.fn(() => Promise.resolve()),
    onRemoveBatch = vi.fn(() => Promise.resolve()),
    currentUserId = 'd1',
    isLeader = false,
    allUsers = [
      { id: 'd1', name: 'Ayşe' },
      { id: 'd2', name: 'Mehmet' },
    ],
    canEdit = true,
  } = overrides
  act(() => root.render(
    <DesignerPagesInput
      subtask={subtask}
      canEdit={canEdit}
      currentUserId={currentUserId}
      isLeader={isLeader}
      allUsers={allUsers}
      onAddBatch={onAddBatch}
      onRedoneBatch={onRedoneBatch}
      onRemoveBatch={onRemoveBatch}
    />,
  ))
  mounted.push({ root, host })
  return { host, onAddBatch, onRedoneBatch, onRemoveBatch }
}

function typeAndSubmit(host, text) {
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

describe('DesignerPagesInput on İç Sayfalar', () => {
  it('reads total_pages / pages_done and speaks in "sayfa"', () => {
    const { host } = render(pages)
    expect(host.textContent).toContain('İç Sayfalar')
    expect(host.textContent).toContain('8 / 32 tamamlandı')
    expect(host.textContent).toContain('+8 sayfa')
    expect(host.textContent).not.toMatch(/sticker/i)
  })
})

describe('DesignerPagesInput on Sticker', () => {
  it('reads total_stickers / stickers_done and speaks in "sticker"', () => {
    const { host } = render(sticker)
    expect(host.textContent).toContain('Sticker')
    expect(host.textContent).toContain('10 / 24 tamamlandı')
    expect(host.textContent).toContain('+10 sticker')
    expect(host.textContent).not.toMatch(/sayfa/i)
  })
})

describe('DesignerPagesInput add flow', () => {
  it('submits the typed number as an integer via onAddBatch(designerId, pages)', () => {
    const { host, onAddBatch } = render(sticker)
    typeAndSubmit(host, '5')
    expect(onAddBatch).toHaveBeenCalledTimes(1)
    expect(onAddBatch).toHaveBeenCalledWith('d1', 5)
  })

  it('refuses a submission that would overshoot the total and shows the Turkish error', () => {
    const { host, onAddBatch } = render(sticker)
    typeAndSubmit(host, '25')
    expect(onAddBatch).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Sticker 35 toplam sticker sayısını (24) aşamaz.')
  })

  it('refuses an empty submission with a Turkish "sayısı girin" message', () => {
    const { host, onAddBatch } = render(pages)
    // The Ekle button is disabled while the draft is empty, so submit via
    // the form directly (as if a keyboard event triggered it).
    act(() => {
      host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onAddBatch).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Sayfa sayısı girin')
  })

  it('refuses a "0" submission with a Turkish "sayısı girin" message', () => {
    const { host, onAddBatch } = render(pages)
    typeAndSubmit(host, '0')
    expect(onAddBatch).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Sayfa sayısı girin')
  })
})

describe('DesignerPagesInput Sil affordance', () => {
  const twoBatches = {
    ...pages,
    designer_batches: [
      batch({ id: 'mine', designer_id: 'd1', designer_name: 'Ayşe', pages: 5 }),
      batch({ id: 'theirs', designer_id: 'd2', designer_name: 'Mehmet', pages: 3 }),
    ],
  }

  it('shows Sil only on the current user\'s row for a plain designer', () => {
    const { host } = render(twoBatches, { currentUserId: 'd1', isLeader: false })
    const rows = host.querySelectorAll('ul > li')
    // First row is `mine` (Ayşe), second is `theirs` (Mehmet).
    const mine = rows[0]
    const theirs = rows[1]
    expect(mine.querySelector('button[title="Sil"]')).not.toBeNull()
    expect(theirs.querySelector('button[title="Sil"]')).toBeNull()
  })

  it('shows Sil on every row when the viewer is the team leader', () => {
    const { host } = render(twoBatches, { currentUserId: 'lead', isLeader: true })
    const rows = host.querySelectorAll('ul > li')
    for (const row of rows) {
      expect(row.querySelector('button[title="Sil"]')).not.toBeNull()
    }
  })

  it('calls onRemoveBatch(batchId) when Sil is clicked', () => {
    const { host, onRemoveBatch } = render(twoBatches, { currentUserId: 'd1', isLeader: false })
    const mineRow = host.querySelectorAll('ul > li')[0]
    const silButton = mineRow.querySelector('button[title="Sil"]')
    act(() => {
      silButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(onRemoveBatch).toHaveBeenCalledTimes(1)
    expect(onRemoveBatch).toHaveBeenCalledWith('mine')
  })
})
