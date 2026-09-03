// Regression tests for the chip-grid assign popover (migration 056).
//
// These tests use the same React-DOM act/createRoot harness as
// `__history_fold.test.jsx` rather than testing-library (the project
// doesn't carry that dep). Radix Popover needs a real ResizeObserver on
// jsdom; the stub below keeps the popover happy without bringing in a
// polyfill the production code never asks for.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import PageChipGrid from './PageChipGrid.jsx'

// Radix's popover schedules state updates via setTimeout under the hood.
// Mark the testing env so the act() wrapping we already do is the one
// React trusts and the "not configured to support act(...)" warnings
// stay out of the run output.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  // Radix Popover measures the trigger + content with ResizeObserver to
  // decide where to place the floating panel. jsdom doesn't ship it, so
  // the popover would otherwise throw on first open.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  // Radix reads matchMedia for the reduced-motion path.
  if (typeof window.matchMedia === 'undefined') {
    window.matchMedia = () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })
  }
})

function buildSubtask(over = {}) {
  return {
    id: 'sub-1',
    title: 'İç Sayfalar',
    kind: 'pages',
    total_pages: 3,
    pages: [
      { i: 1, status: 'done', done_by: 'u-aylin', done_by_name: 'Aylin', done_at: '2026-08-25T08:00:00Z', rework_count: 0, assigned_to: 'u-aylin', assigned_to_name: 'Aylin' },
      { i: 2, status: 'pending', done_by: null, done_by_name: null, done_at: null, rework_count: 0, assigned_to: 'u-busra', assigned_to_name: 'Büşra' },
      { i: 3, status: 'pending', done_by: null, done_by_name: null, done_at: null, rework_count: 0, assigned_to: null, assigned_to_name: null },
    ],
    ...over,
  }
}

const DESIGNERS = [
  { id: 'u-aylin', name: 'Aylin', role: 'designer', is_active: true, avatar_url: null, avatar_updated_at: null },
  { id: 'u-busra', name: 'Büşra', role: 'designer', is_active: true, avatar_url: null, avatar_updated_at: null },
  { id: 'u-cem', name: 'Cem', role: 'designer', is_active: false, avatar_url: null, avatar_updated_at: null },
  { id: 'u-mat', name: 'Matbaa', role: 'matbaa', is_active: true, avatar_url: null, avatar_updated_at: null },
]

function render(props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<PageChipGrid {...props} />))
  return { host, root }
}

async function unmount({ root, host }) {
  await act(async () => { root.unmount() })
  host.remove()
}

async function fireClick(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
  await act(async () => { el.click() })
}

describe('PageChipGrid — owner pip + assign affordance', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('renders one chip per page', async () => {
    const onPageClick = vi.fn()
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      user: { id: 'u-aylin' },
      isLeader: false,
      designers: DESIGNERS,
      onPageClick,
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
    })
    // Each chip is the only button with the numeric label inside an
    // aria-pressed container; the "Benim sayfalarım" toggle and the
    // ↻ rework overlay also render <button>s but carry different
    // aria labels — keep the assertion tight.
    const chipButtons = [...host.querySelectorAll('button[aria-pressed]')]
      .filter((b) => /^\d+$/.test(b.textContent.trim()))
    expect(chipButtons).toHaveLength(3)
    expect(chipButtons[0].textContent).toBe('1')
    expect(chipButtons[1].textContent).toBe('2')
    expect(chipButtons[2].textContent).toBe('3')
    await unmount({ root, host })
  })

  it('renders the owner legend when there are owners', async () => {
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      user: { id: 'u-aylin' },
      isLeader: false,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
    })
    expect(host.textContent).toContain('Aylin')
    expect(host.textContent).toContain('Büşra')
    await unmount({ root, host })
  })

  it('does NOT render an assign trigger for non-leaders', async () => {
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      user: { id: 'u-aylin', role: 'designer' },
      isLeader: false,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
    })
    const triggers = host.querySelectorAll('[data-testid^="page-assign-trigger-"]')
    expect(triggers).toHaveLength(0)
    await unmount({ root, host })
  })

  it('renders an assign trigger per non-done chip for team leaders', async () => {
    // The trigger is gated on `status !== 'done'` — reassigning a
    // shipped page silently changes `assigned_to` without moving the
    // chip's colour, which is a footgun for the leader. So out of the
    // three pages in the fixture (1 done, 2 pending, 3 pending), only
    // the two pending ones expose a popover trigger.
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      user: { id: 'u-leader', role: 'team_leader' },
      isLeader: true,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
    })
    const triggers = host.querySelectorAll('[data-testid^="page-assign-trigger-"]')
    expect(triggers).toHaveLength(2)
    await unmount({ root, host })
  })
})

describe('PageChipGrid — leader assign popover', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('opens the popover when the leader clicks the trigger', async () => {
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      user: { id: 'u-leader', role: 'team_leader' },
      isLeader: true,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
    })
    // No popover yet.
    expect(host.querySelector('[data-testid="page-assign-popover-2"]')).toBeNull()
    // Page 1 is done and intentionally has no popover trigger (gated by
    // the "no silent reassign" fix). Click page 2's trigger instead —
    // it's the first chip in the grid that exposes a popover.
    const trigger = host.querySelector('[data-testid="page-assign-trigger-sub-1-2"]')
    await fireClick(trigger)
    // Radix renders into a Portal — query document.body for the panel.
    const panel = document.body.querySelector('[data-testid="page-assign-popover-2"]')
    expect(panel).not.toBeNull()
    expect(panel.textContent).toContain('İç Sayfalar')
    expect(panel.textContent).toContain('Sayfa 2')
    await unmount({ root, host })
  })

  it('shows the current owner in the callout', async () => {
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      user: { id: 'u-leader', role: 'team_leader' },
      isLeader: true,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
    })
    const trigger = host.querySelector('[data-testid="page-assign-trigger-sub-1-2"]')
    await fireClick(trigger)
    const panel = document.body.querySelector('[data-testid="page-assign-popover-2"]')
    expect(panel.textContent).toContain('Büşra')
    await unmount({ root, host })
  })

  it('falls back to "Atanmamış" when the page has no owner', async () => {
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      user: { id: 'u-leader', role: 'team_leader' },
      isLeader: true,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
    })
    const trigger = host.querySelector('[data-testid="page-assign-trigger-sub-1-3"]')
    await fireClick(trigger)
    const panel = document.body.querySelector('[data-testid="page-assign-popover-3"]')
    expect(panel.textContent).toContain('Atanmamış')
    await unmount({ root, host })
  })

  it('lists only active designers in the picker', async () => {
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      user: { id: 'u-leader', role: 'team_leader' },
      isLeader: true,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
    })
    const trigger = host.querySelector('[data-testid="page-assign-trigger-sub-1-3"]')
    await fireClick(trigger)
    const panel = document.body.querySelector('[data-testid="page-assign-popover-3"]')
    // Cem (is_active=false) and Matbaa (role=matbaa) must NOT be in the list.
    expect(panel.textContent).toContain('Aylin')
    expect(panel.textContent).toContain('Büşra')
    expect(panel.textContent).not.toContain('Cem')
    expect(panel.textContent).not.toContain('Matbaa')
    expect(panel.textContent).toContain('2 tasarımcı')
    await unmount({ root, host })
  })

  it('fires onAssign(pageIndex, designerId) when a row is picked', async () => {
    const onAssign = vi.fn()
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      user: { id: 'u-leader', role: 'team_leader' },
      isLeader: true,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign,
    })
    const trigger = host.querySelector('[data-testid="page-assign-trigger-sub-1-3"]')
    await fireClick(trigger)
    const pick = document.body.querySelector('[data-testid="page-assign-pick-3-u-aylin"]')
    await fireClick(pick)
    expect(onAssign).toHaveBeenCalledWith(3, 'u-aylin')
    await unmount({ root, host })
  })

  it('fires onAssign(pageIndex, null) on the unassign row', async () => {
    const onAssign = vi.fn()
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      user: { id: 'u-leader', role: 'team_leader' },
      isLeader: true,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign,
    })
    // Open on a page that already has an owner so the unassign row is enabled.
    const trigger = host.querySelector('[data-testid="page-assign-trigger-sub-1-2"]')
    await fireClick(trigger)
    const unassign = document.body.querySelector('[data-testid="page-assign-unassign-2"]')
    await fireClick(unassign)
    expect(onAssign).toHaveBeenCalledWith(2, null)
    await unmount({ root, host })
  })

  it('disables the unassign row when the page has no current owner', async () => {
    const onAssign = vi.fn()
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      user: { id: 'u-leader', role: 'team_leader' },
      isLeader: true,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign,
    })
    const trigger = host.querySelector('[data-testid="page-assign-trigger-sub-1-3"]')
    await fireClick(trigger)
    const unassign = document.body.querySelector('[data-testid="page-assign-unassign-3"]')
    expect(unassign.disabled).toBe(true)
    await unmount({ root, host })
  })

  it('marks the current owner with a check icon', async () => {
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      user: { id: 'u-leader', role: 'team_leader' },
      isLeader: true,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
    })
    const trigger = host.querySelector('[data-testid="page-assign-trigger-sub-1-2"]')
    await fireClick(trigger)
    // Büşra is the current owner — her row carries the "Tasarımcı" suffix
    // replaced by a Check icon. Without the check, every row would say
    // "Tasarımcı", which the assertion below catches.
    const panel = document.body.querySelector('[data-testid="page-assign-popover-2"]')
    const busraRow = document.body.querySelector('[data-testid="page-assign-pick-2-u-busra"]')
    const aylinRow = document.body.querySelector('[data-testid="page-assign-pick-2-u-aylin"]')
    expect(busraRow.querySelector('svg')).not.toBeNull() // Check icon
    expect(aylinRow.querySelector('svg')).toBeNull()
    expect(panel).not.toBeNull()
    await unmount({ root, host })
  })
})

// ---------------------------------------------------------------------------
// Regression: "Revize Edin" button on a pages subtask in revision
// ---------------------------------------------------------------------------
//
// A team leader can flag a pages ("İç Sayfalar") subtask for revision when
// rejecting a demo. Until this fix, PageChipGrid rendered the warning banner
// but no way for the designer to clear `needs_revize`, so the project sat
// at tasarim with the resubmit button permanently disabled. The button now
// lives next to the banner and is wired to the parent's onRevize callback
// — the same callback SubtaskCard already threads through to the
// non-pages branch.
describe('PageChipGrid — pages subtask revize affordance', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  function flaggedSubtask(over = {}) {
    return buildSubtask({ needs_revize: true, is_done: true, ...over })
  }

  it('renders the "Revize Edin" button when flagged and editable', async () => {
    const onRevize = vi.fn()
    const { root, host } = render({
      subtask: flaggedSubtask(),
      canEdit: true,
      flagged: true,
      user: { id: 'u-aylin', role: 'designer' },
      isLeader: false,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
      onRevize,
    })
    const btn = host.querySelector('[data-testid="pages-subtask-revize"]')
    expect(btn).not.toBeNull()
    expect(btn.textContent.trim()).toBe('Revize Edin')
    expect(btn.disabled).toBe(false)
    await unmount({ root, host })
  })

  it('calls onRevize with the subtask when the button is clicked', async () => {
    const onRevize = vi.fn()
    const sub = flaggedSubtask()
    const { root, host } = render({
      subtask: sub,
      canEdit: true,
      flagged: true,
      user: { id: 'u-aylin', role: 'designer' },
      isLeader: false,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
      onRevize,
    })
    const btn = host.querySelector('[data-testid="pages-subtask-revize"]')
    await fireClick(btn)
    expect(onRevize).toHaveBeenCalledTimes(1)
    expect(onRevize).toHaveBeenCalledWith(sub)
    await unmount({ root, host })
  })

  it('shows "Kaydediliyor…" and disables the button while revizing', async () => {
    const onRevize = vi.fn()
    const { root, host } = render({
      subtask: flaggedSubtask(),
      canEdit: true,
      flagged: true,
      revizing: true,
      user: { id: 'u-aylin', role: 'designer' },
      isLeader: false,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
      onRevize,
    })
    const btn = host.querySelector('[data-testid="pages-subtask-revize"]')
    expect(btn.textContent.trim()).toBe('Kaydediliyor…')
    expect(btn.disabled).toBe(true)
    await unmount({ root, host })
  })

  it('hides the button when canEdit is false', async () => {
    const onRevize = vi.fn()
    const { root, host } = render({
      subtask: flaggedSubtask(),
      canEdit: false,
      flagged: true,
      user: { id: 'u-aylin', role: 'designer' },
      isLeader: false,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
      onRevize,
    })
    expect(host.querySelector('[data-testid="pages-subtask-revize"]')).toBeNull()
    await unmount({ root, host })
  })

  it('hides the button when the parent did not provide onRevize', async () => {
    const { root, host } = render({
      subtask: flaggedSubtask(),
      canEdit: true,
      flagged: true,
      user: { id: 'u-aylin', role: 'designer' },
      isLeader: false,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
      // no onRevize → button must NOT render so legacy callers keep their
      // pre-fix behaviour (banner-only, no action affordance)
    })
    expect(host.querySelector('[data-testid="pages-subtask-revize"]')).toBeNull()
    await unmount({ root, host })
  })

  it('hides the button when the subtask is not flagged', async () => {
    const onRevize = vi.fn()
    const { root, host } = render({
      subtask: buildSubtask(),
      canEdit: true,
      flagged: false,
      user: { id: 'u-aylin', role: 'designer' },
      isLeader: false,
      designers: DESIGNERS,
      onPageClick: vi.fn(),
      onPageRework: vi.fn(),
      onAssign: vi.fn(),
      onRevize,
    })
    expect(host.querySelector('[data-testid="pages-subtask-revize"]')).toBeNull()
    await unmount({ root, host })
  })
})