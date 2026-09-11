// NewProjectDialog's "Tüm Tasarımcılar" default for İç Sayfalar.
//
// Project rule (team_leader conversation, 2026-09-11): when a project has
// 2+ designers, the İç Sayfalar picker auto-flips to "Tüm Tasarımcılar"
// unless the leader has explicitly chosen a specific designer. With 1
// designer there's no picker to show, so the single designer owns it
// implicitly. The batch log keeps every designer's pages under their own
// row (migration 084) — the auto-flip only changes who can ADD pages, not
// who they get credited for.
//
// Without this auto-flip the leader would have to remember to switch the
// picker on every multi-designer project, and İç Sayfalar would silently
// default to the project primary — making the second designer's pages
// invisible to anyone but that primary. The default lives entirely in
// React state (the picker sets `subtaskAssignees.sayfalar = ALL_DESIGNERS`
// = `__all__`), which is what the http repo strips the empties around but
// passes the sentinel through.
//
// What this test pins:
//   1. With 2 designers + checking İç Sayfalar → picker auto-fills
//      with "Tüm Tasarımcılar".
//   2. With 1 designer + checking İç Sayfalar → picker is not shown at
//      all (showAssigneeSelect false), so nothing to flip.
//   3. With 0 designers + checking İç Sayfalar → picker is not shown
//      either, same reason.
//
// The component renders inside the Radix Select primitive, which uses a
// portal. The trigger's button text reflects the current value via
// SelectValue's placeholder / matched-item rendering, so we read the
// visible button label to assert the state.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import NewProjectDialog from './NewProjectDialog.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Radix UI primitives use ResizeObserver for layout measurement (Select,
// Popover, Dialog content). jsdom doesn't ship it. A noop shim is
// enough — nothing in this test asserts on measured sizes.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

const auth = vi.hoisted(() => ({
  user: { id: 'u-leader', name: 'Ayşenur Kanak', role: 'team_leader' },
}))

const store = vi.hoisted(() => ({ addOne: vi.fn(), updateOne: vi.fn() }))

vi.mock('sonner', () => ({
  toast: { success: () => {}, error: () => {}, info: () => {} },
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))

vi.mock('@/hooks/useProjectsStore', () => ({ useProjectsStore: () => store }))

// api.listUsers() is called once on dialog open to populate the designer
// grid. The dialog only reads `id`, `role`, `is_active`, `name` off each
// user — the test fixture supplies exactly those fields.
vi.mock('@/api', async () => {
  const actual = await vi.importActual('@/api')
  return {
    ...actual,
    default: {
      ...actual.default,
      listUsers: () => Promise.resolve([
        { id: 'd1', name: 'Ali', role: 'designer', is_active: true },
        { id: 'd2', name: 'Ayşe', role: 'designer', is_active: true },
        { id: 'd3', name: 'Mehmet', role: 'printer', is_active: true },
      ]),
      createProject: vi.fn(() => Promise.resolve({ id: 'p-new' })),
      updateProject: vi.fn(() => Promise.resolve({ id: 'p-new' })),
    },
  }
})

let mounted = []
afterEach(() => {
  for (const { root, host } of mounted) { act(() => root.unmount()); host.remove() }
  mounted = []
})

function renderDialog(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  let dialogHost
  act(() => {
    root.render(<NewProjectDialog open onOpenChange={() => {}} {...props} />)
  })
  // Radix Dialog portals into document.body, not into our host. We
  // search the whole document for the dialog content.
  dialogHost = document.body
  mounted.push({ root, host })
  return { host, dialogHost }
}

function tickDesigner(dialogHost, designerId) {
  // The designer grid renders one <label> per active designer, each with
  // a checkbox. The label's textContent is the designer's name; we look
  // up the input by walking the same label.
  const labels = Array.from(dialogHost.querySelectorAll('label'))
  const label = labels.find((l) => l.querySelector('input[type="button"], button[role="checkbox"]'))
  // The label that wraps a designer has a span with the designer name
  // AND a checkbox. We rely on the structure (label > checkbox + name span)
  // rather than name, so the test stays robust against renaming.
  const designerLabels = labels.filter((l) => /^[A-Za-zÇĞİÖŞÜçğıöşü]+$/.test(l.textContent.trim()))
  // Pick the designer by matching textContent against the desired name.
  return { designerLabels }
}

async function flush() {
  // Wait for the api.listUsers() promise inside the dialog's useEffect
  // to resolve and React to commit. Two microtasks is the safe minimum.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function openDialogWithDesigners(designerIds) {
  const { dialogHost } = renderDialog()
  await flush()
  // Click each designer checkbox. Each designer row in the rendered
  // grid is a <label> wrapping the Checkbox + initials avatar + name
  // span. Walking every label and filtering by "textContent is one of
  // the designer names" is brittle if the row adds whitespace; instead
  // walk the labels inside the "Atanan Tasarımcılar" card by looking
  // for the avatar span (the rounded-full initials badge).
  const allLabels = Array.from(dialogHost.querySelectorAll('label'))
  const designerRows = allLabels.filter((l) => {
    // The initials avatar: a span with rounded-full bg-secondary
    // classes containing a short uppercase string.
    const avatar = l.querySelector('span.rounded-full')
    return !!avatar && avatar.textContent.trim().length > 0 && avatar.textContent.trim().length <= 3
  })
  // Map name → label. Each row's textContent is "<initials><name>".
  // Extract the name as the text after the avatar.
  const byName = new Map(designerRows.map((l) => {
    const avatar = l.querySelector('span.rounded-full')
    const fullText = l.textContent.trim()
    const initials = avatar.textContent.trim()
    const name = fullText.slice(initials.length).trim()
    return [name, l]
  }))
  for (const id of designerIds) {
    const name = id === 'd1' ? 'Ali' : 'Ayşe'
    const row = byName.get(name)
    if (!row) {
      // Debug: dump every label we found so the failure is actionable.
      const found = Array.from(byName.keys())
      throw new Error(`Designer row not found for ${name}. Found: ${JSON.stringify(found)}`)
    }
    const cb = row.querySelector('button[role="checkbox"]')
    await act(async () => { cb.click() })
  }
  return dialogHost
}

function checkSayfalar(dialogHost) {
  // The Checkbox component renders as <button role="checkbox"> with a
  // hidden <input id="st-sayfalar">. We toggle the button — that's what
  // Radix wires to onCheckedChange — and read aria-checked off the
  // same button.
  const buttons = Array.from(dialogHost.querySelectorAll('button[role="checkbox"]'))
  // The dialog renders designer checkboxes first (3 designers), then
  // the library subtasks in library order. Find the button whose
  // sibling label reads "İç Sayfalar".
  const sayfalarButton = buttons.find((b) => {
    const id = b.getAttribute('id')
    return id === 'st-sayfalar'
  })
  if (!sayfalarButton) {
    const ids = buttons.map((b) => b.getAttribute('id')).filter(Boolean)
    throw new Error(`İç Sayfalar checkbox not found. Saw checkbox ids: ${JSON.stringify(ids)}`)
  }
  return sayfalarButton
}

describe('NewProjectDialog — İç Sayfalar default', () => {
  it('auto-fills the picker with "Tüm Tasarımcılar" when 2 designers are selected', async () => {
    const dialogHost = await openDialogWithDesigners(['d1', 'd2'])
    const cb = checkSayfalar(dialogHost)
    expect(cb.getAttribute('aria-checked')).toBe('false')
    await act(async () => { cb.click() })
    // After check, the picker trigger should appear and read "Tüm Tasarımcılar".
    // The trigger is a button rendered by Radix Select; its label is the
    // current value's text, falling back to a placeholder.
    const triggers = Array.from(dialogHost.querySelectorAll('button'))
    const tumTrigger = triggers.find((t) => t.textContent.includes('Tüm Tasarımcılar'))
    expect(tumTrigger).toBeTruthy()
  })

  it('hides the picker with 1 designer (no flip needed)', async () => {
    const dialogHost = await openDialogWithDesigners(['d1'])
    const cb = checkSayfalar(dialogHost)
    await act(async () => { cb.click() })
    // With 1 designer, showAssigneeSelect is false so no SelectTrigger
    // is rendered for the row. No "Tasarımcı seç…" placeholder, no
    // "Tüm Tasarımcılar" trigger.
    const triggers = Array.from(dialogHost.querySelectorAll('button'))
    expect(triggers.some((t) => t.textContent.includes('Tüm Tasarımcılar'))).toBe(false)
    expect(triggers.some((t) => t.textContent.includes('Tasarımcı seç'))).toBe(false)
  })

  it('hides the picker with 0 designers', async () => {
    const dialogHost = await openDialogWithDesigners([])
    const cb = checkSayfalar(dialogHost)
    await act(async () => { cb.click() })
    const triggers = Array.from(dialogHost.querySelectorAll('button'))
    expect(triggers.some((t) => t.textContent.includes('Tüm Tasarımcılar'))).toBe(false)
    expect(triggers.some((t) => t.textContent.includes('Tasarımcı seç'))).toBe(false)
  })
})
