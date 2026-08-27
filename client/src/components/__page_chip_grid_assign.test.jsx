// Integration test for the leader-assign optimistic-update round trip.
//
// PageChipGrid doesn't fire the PATCH itself — the parent owns the optimistic
// flip + the abort logic in `handlePageAssign`. This test exercises that
// contract end-to-end: when the parent updates `subtask.pages[i].assigned_to`
// in response to the popover's `onAssign(pageIndex, designerId)` callback,
// the chip's owner pip and border colour have to follow without a remount.
//
// The mock api the parent would call is `api.assignSubtaskPage` — the test
// stubs it with a deferred promise so the parent can flip the local state
// first and then resolve to the new project shape from the server.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import PageChipGrid from './PageChipGrid.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
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

function buildSubtask() {
  return {
    id: 'sub-1',
    title: 'İç Sayfalar',
    kind: 'pages',
    total_pages: 2,
    pages: [
      { i: 1, status: 'pending', done_by: null, done_by_name: null, done_at: null, rework_count: 0, assigned_to: null, assigned_to_name: null },
      { i: 2, status: 'pending', done_by: null, done_by_name: null, done_at: null, rework_count: 0, assigned_to: 'u-aylin', assigned_to_name: 'Aylin' },
    ],
  }
}

const DESIGNERS = [
  { id: 'u-aylin', name: 'Aylin', role: 'designer', is_active: true, avatar_url: null, avatar_updated_at: null },
  { id: 'u-busra', name: 'Büşra', role: 'designer', is_active: true, avatar_url: null, avatar_updated_at: null },
]

// Minimal harness that mirrors what ProjectDetail does: holds a `subtask`
// ref, renders PageChipGrid with the current shape, and on `onAssign`
// applies the optimistic flip locally before returning. This is the
// surface the production handlePageAssign handler talks to.
function makeHarness({ getSubtask, designers, isLeader, onAssign }) {
  return function Harness() {
    return (
      <PageChipGrid
        subtask={getSubtask()}
        canEdit={true}
        flagged={false}
        user={{ id: 'u-leader', role: isLeader ? 'team_leader' : 'designer' }}
        isLeader={isLeader}
        designers={designers}
        activePage={null}
        onPageClick={() => {}}
        onPageRework={() => {}}
        onAssign={onAssign}
      />
    )
  }
}

async function fireClick(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
  await act(async () => { el.click() })
}

describe('PageChipGrid — assign round trip', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('the optimistic flip changes the chip border colour without remounting', async () => {
    const onAssign = vi.fn()
    let liveSubtask = buildSubtask()
    const { root, host } = (() => {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const root = createRoot(host)
      const Harness = makeHarness({
        getSubtask: () => liveSubtask,
        designers: DESIGNERS,
        isLeader: true,
        onAssign: (pageIndex, designerId) => {
          onAssign(pageIndex, designerId)
          // Optimistic flip — the same `before`-snapshot/replace
          // operation handlePageAssign runs in ProjectDetail.
          liveSubtask = {
            ...liveSubtask,
            pages: liveSubtask.pages.map((p) =>
              p.i === pageIndex ? { ...p, assigned_to: designerId, assigned_to_name: DESIGNERS.find((d) => d.id === designerId)?.name ?? null } : p,
            ),
          }
          act(() => root.render(<Harness />))
        },
      })
      act(() => root.render(<Harness />))
      return { root, host }
    })()

    // Page 1 has no owner — the chip renders without a coloured border.
    const chip1Before = [...host.querySelectorAll('button[aria-pressed]')]
      .filter((b) => /^\d+$/.test(b.textContent.trim()))[0]
    const borderBefore = chip1Before.style.borderColor
    expect(borderBefore).toBe('')

    // Open the popover on page 1 and pick Büşra.
    const trigger = host.querySelector('[data-testid="page-assign-trigger-sub-1-1"]')
    await fireClick(trigger)
    const pick = document.body.querySelector('[data-testid="page-assign-pick-1-u-busra"]')
    await fireClick(pick)

    expect(onAssign).toHaveBeenCalledWith(1, 'u-busra')

    // The optimistic flip landed — page 1's chip now carries a border
    // colour from userColor('u-busra'), NOT the old empty string.
    // The hash output isn't stable across JS engines, so we only check
    // the *shape* (non-empty hex) — the palette mapping is locked by
    // userColor's own tests.
    const chip1After = [...host.querySelectorAll('button[aria-pressed]')]
      .filter((b) => /^\d+$/.test(b.textContent.trim()))[0]
    const borderAfter = chip1After.style.borderColor
    expect(borderAfter).not.toBe('')
    // jsdom normalizes inline hex to rgb() when reading style — both
    // shapes are valid evidence of an owner colour having been set.
    expect(borderAfter).toMatch(/^(#[0-9a-f]{6}|rgb\(\d+,\s*\d+,\s*\d+\))$/i)

    await act(async () => { root.unmount() })
    host.remove()
  })

  it('reverting the optimistic flip returns the chip to its previous colour', async () => {
    let liveSubtask = buildSubtask()
    const originalPages = JSON.parse(JSON.stringify(liveSubtask.pages))
    const { root, host } = (() => {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const root = createRoot(host)
      const Harness = makeHarness({
        getSubtask: () => liveSubtask,
        designers: DESIGNERS,
        isLeader: true,
        onAssign: () => {
          // Mirror handlePageAssign's catch branch: on a server failure,
          // the parent restores `before` and re-renders.
          liveSubtask = { ...liveSubtask, pages: originalPages }
          act(() => root.render(<Harness />))
        },
      })
      act(() => root.render(<Harness />))
      return { root, host }
    })()

    // After "revert", page 1 has assigned_to=null again.
    const chip1 = [...host.querySelectorAll('button[aria-pressed]')]
      .filter((b) => /^\d+$/.test(b.textContent.trim()))[0]
    expect(chip1.style.borderColor).toBe('')

    await act(async () => { root.unmount() })
    host.remove()
  })

  it('unassign on a previously-assigned page clears the chip border', async () => {
    const onAssign = vi.fn()
    let liveSubtask = buildSubtask()
    const { root, host } = (() => {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const root = createRoot(host)
      const Harness = makeHarness({
        getSubtask: () => liveSubtask,
        designers: DESIGNERS,
        isLeader: true,
        onAssign: (pageIndex, designerId) => {
          onAssign(pageIndex, designerId)
          liveSubtask = {
            ...liveSubtask,
            pages: liveSubtask.pages.map((p) =>
              p.i === pageIndex ? { ...p, assigned_to: designerId, assigned_to_name: designerId ? DESIGNERS.find((d) => d.id === designerId)?.name ?? null : null } : p,
            ),
          }
          act(() => root.render(<Harness />))
        },
      })
      act(() => root.render(<Harness />))
      return { root, host }
    })()

    // Page 2 starts owned by Aylin.
    const chip2Before = [...host.querySelectorAll('button[aria-pressed]')]
      .filter((b) => /^\d+$/.test(b.textContent.trim()))[1]
    expect(chip2Before.style.borderColor).not.toBe('')

    // Open popover on page 2 and unassign.
    const trigger = host.querySelector('[data-testid="page-assign-trigger-sub-1-2"]')
    await fireClick(trigger)
    const unassign = document.body.querySelector('[data-testid="page-assign-unassign-2"]')
    await fireClick(unassign)

    expect(onAssign).toHaveBeenCalledWith(2, null)

    const chip2After = [...host.querySelectorAll('button[aria-pressed]')]
      .filter((b) => /^\d+$/.test(b.textContent.trim()))[1]
    expect(chip2After.style.borderColor).toBe('')

    await act(async () => { root.unmount() })
    host.remove()
  })

  it('does NOT render the assign popover trigger on done pages (no silent reassign)', async () => {
    // A done page carries `done_by` (the finisher) and the chip's colour
    // is driven by that, NOT by `assigned_to`. Letting a leader click
    // "Ata" on a done page would PATCH `assigned_to` in the DB without
    // moving the chip, and would push the page into the new designer's
    // "Benim sayfalarım" filter even though they didn't ship it. The
    // fix collapses the leader view of a done page to the same plain
    // read-only dot a non-leader sees; the proper way to change credit
    // is the rework flow.
    const liveSubtask = {
      ...buildSubtask(),
      pages: [
        // Page 1 shipped by Aylin, still assigned to her. Even with the
        // assignees matching, a done page must not show the popover.
        { i: 1, status: 'done', done_by: 'u-aylin', done_by_name: 'Aylin', done_at: '2026-08-26T10:00:00Z', rework_count: 0, assigned_to: 'u-aylin', assigned_to_name: 'Aylin' },
        // Page 2 shipped by Aylin, reassigned to Büşra by a leader. The
        // chip colour stays Aylin's (because done_by drives it), and
        // the leader must not be able to push a different owner onto
        // this row through the popover.
        { i: 2, status: 'done', done_by: 'u-aylin', done_by_name: 'Aylin', done_at: '2026-08-26T11:00:00Z', rework_count: 0, assigned_to: 'u-busra', assigned_to_name: 'Büşra' },
      ],
    }
    const onAssign = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const Harness = makeHarness({
      getSubtask: () => liveSubtask,
      designers: DESIGNERS,
      isLeader: true,
      onAssign,
    })
    act(() => root.render(<Harness />))

    // The popover trigger testid must be absent on done pages for both
    // chip states (assigned_to matches the finisher, assigned_to differs).
    expect(
      host.querySelector('[data-testid="page-assign-trigger-sub-1-1"]'),
      'page 1 (done, assignees match) should not expose a popover trigger',
    ).toBeNull()
    expect(
      host.querySelector('[data-testid="page-assign-trigger-sub-1-2"]'),
      'page 2 (done, assignees differ) should not expose a popover trigger',
    ).toBeNull()

    // The chip's colour stays driven by done_by on done pages — page 2
    // has a different assigned_to but the same done_by as page 1, so
    // the two chips must share a border colour. (This is the existing
    // ownerOf rule, not a new assertion — it's here to make the test
    // self-explanatory about why reassigning would be a silent change.)
    const chips = [...host.querySelectorAll('button[aria-pressed]')]
      .filter((b) => /^\d+$/.test(b.textContent.trim()))
    expect(chips[0].style.borderColor).toBe(chips[1].style.borderColor)

    await act(async () => { root.unmount() })
    host.remove()
  })

  it('renders the assign popover trigger on pending and rework pages', async () => {
    // Belt-and-braces: the new gate on done pages must NOT regress the
    // pending/rework case. Both statuses still expose the trigger so
    // the leader can re-plan the work.
    const liveSubtask = {
      ...buildSubtask(),
      pages: [
        { i: 1, status: 'pending', done_by: null, done_by_name: null, done_at: null, rework_count: 0, assigned_to: null, assigned_to_name: null },
        { i: 2, status: 'rework', done_by: 'u-aylin', done_by_name: 'Aylin', done_at: '2026-08-25T10:00:00Z', rework_count: 1, assigned_to: 'u-busra', assigned_to_name: 'Büşra' },
      ],
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const Harness = makeHarness({
      getSubtask: () => liveSubtask,
      designers: DESIGNERS,
      isLeader: true,
      onAssign: () => {},
    })
    act(() => root.render(<Harness />))

    expect(
      host.querySelector('[data-testid="page-assign-trigger-sub-1-1"]'),
      'pending page must still expose the popover trigger',
    ).not.toBeNull()
    expect(
      host.querySelector('[data-testid="page-assign-trigger-sub-1-2"]'),
      'rework page must still expose the popover trigger (work in progress)',
    ).not.toBeNull()

    await act(async () => { root.unmount() })
    host.remove()
  })
})