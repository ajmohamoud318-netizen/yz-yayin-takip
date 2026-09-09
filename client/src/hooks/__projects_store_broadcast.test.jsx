// Regression coverage for cross-tab BroadcastChannel sync, and for the SSE
// live-push path that keeps the list current across DIFFERENT signed-in
// users (not just tabs of the same session).
//
// The projects store keeps its list of projects in module-scoped state, so
// two tabs of the same user — same cookie session, same origin — only
// refreshed independently. Tab A approving a project would leave tab B
// showing the old stage until the next 30 s tick. The fix posts a small
// 'projects-changed' message on `yz:projects` whenever the list mutates
// (refetch, optimistic updateOne, optimistic addOne) and listens for the
// same message on mount, refetching on receipt.
//
// BroadcastChannel only reaches the SAME origin's OTHER tabs — it says
// nothing about a DIFFERENT user's browser. That cross-user path used to be
// `api.subscribeProjects?.(updateOne)`, an API method that was never
// implemented; the optional chain silently no-op'd and the list only ever
// caught up on the next 30 s tick. The fix reuses the notification SSE
// stream instead (the same one that drives the bell): any event carrying a
// `projectId` means a pipeline action touched that project, so the list
// refetches.
//
// Things this file pins down:
//
//   1. Two BroadcastChannel instances with the same name deliver messages
//      to each other (jsdom 22+ supports BroadcastChannel natively).
//   2. When the provider mutates the list, the channel posts a message —
//      sibling tabs receive it and react.
//   3. When a sibling tab posts, the provider's listener refetches.
//   4. An SSE notification event carrying a projectId refetches the list
//      (the cross-user path); one with no projectId does not.
//
// The "sibling tab" is modelled in tests as a second BroadcastChannel
// instance the test owns — jsdom's BroadcastChannel impl routes by name,
// so a separately-constructed instance behaves exactly like a separate
// tab from the same origin.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'

// React 18.3+ requires this flag so `act` from `react` actually wraps
// state updates; without it, updates queue in a separate channel and
// never flush, hanging the test.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Stub the api surface the provider touches. Each test sets the specific
// return values it cares about via `mockResolvedValueOnce`.
vi.mock('@/api', () => ({
  default: {
    listProjects: vi.fn(async () => []),
  },
}))

// Stub the notification SSE subscription. `useNotifications.jsx` is mocked
// (not just its `subscribe` return value) because the provider is mounted
// standalone here, with no NotificationsProvider above it. The factory
// keeps its own subscriber set and exposes `__emitNotification` so tests can
// simulate a server-pushed event without spinning up a real EventSource.
//
// `subscribe` MUST be a single stable reference, exactly like the real hook's
// `useCallback(..., [])` — the provider's effect lists it as a dependency, so
// a mock that handed back a fresh function on every call to `useNotifications()`
// would make that effect think its deps changed on every render and re-run
// (which calls `refetch()` again) forever.
vi.mock('@/hooks/useNotifications.jsx', () => {
  const subscribers = new Set()
  const subscribe = (cb) => {
    subscribers.add(cb)
    return () => subscribers.delete(cb)
  }
  return {
    useNotifications: () => ({ subscribe }),
    __emitNotification: (event) => {
      for (const cb of subscribers) cb(event)
    },
  }
})

// Pretend auth has already settled: bootstrapped, signed in. The provider
// gates its fetch on these flags; we don't want the test to depend on the
// real AuthProvider's GET /auth/me.
vi.mock('@/hooks/useAuth.js', () => ({
  useAuth: () => ({ bootstrapping: false, isAuthenticated: true }),
}))

// useOnResume fires on visibilitychange in the real app. The provider
// passes a refetch callback into it; for the unit we don't care about the
// resume hook's internals — only that mounting doesn't blow up.
vi.mock('@/hooks/useOnResume.js', () => ({
  useOnResume: vi.fn(),
}))

// productCatalog.hydrateProductInfo is called inside refetch. Stub it so
// the test doesn't reach the JSON seed file the real implementation lazily
// fetches at /data/product-info.json.
vi.mock('@/data/productCatalog', () => ({
  hydrateProductInfo: vi.fn(),
}))

import api from '@/api'
import { __emitNotification } from '@/hooks/useNotifications.jsx'
import { ProjectsProvider, useProjectsStore } from './useProjectsStore.jsx'

// Captures the store handle from inside the Provider. Tests that don't
// need the store ignore it; tests that do read it after `mount()`.
let store
function Probe() {
  store = useProjectsStore()
  return null
}

describe('useProjectsStore cross-tab BroadcastChannel sync', () => {
  let container
  let root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    api.listProjects.mockReset()
    api.listProjects.mockResolvedValue([])
    store = null
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
    vi.clearAllMocks()
  })

  function mount() {
    act(() => {
      root = createRoot(container)
      root.render(createElement(ProjectsProvider, null, createElement(Probe)))
    })
  }

  it('two BroadcastChannel instances with the same name deliver messages to each other', async () => {
    // Pinned-down contract: the cross-tab sync rests on the assumption
    // that two BroadcastChannel instances constructed independently with
    // the same name route messages to each other. jsdom 22+ implements
    // this; if a future test environment doesn't, every other assertion
    // here would silently pass for the wrong reason.
    const a = new BroadcastChannel('yz:test-delivery')
    const b = new BroadcastChannel('yz:test-delivery')
    const received = []
    b.onmessage = (e) => received.push(e.data)

    a.postMessage({ kind: 'projects-changed' })
    // BroadcastChannel.postMessage is asynchronous — give the queue a
    // tick to deliver before asserting.
    await new Promise((r) => setTimeout(r, 20))

    expect(received).toEqual([{ kind: 'projects-changed' }])
    a.close()
    b.close()
  })

  it('posts a message on the channel when the provider mutates the list (updateOne path)', async () => {
    // A sibling "tab": a separate BroadcastChannel with the same name as
    // the provider opens. Because BroadcastChannel routes by name, this
    // is exactly what another tab of the same origin would look like.
    const peer = new BroadcastChannel('yz:projects')
    const received = []
    peer.onmessage = (e) => received.push(e.data)

    // Mount wires up a Probe inside the Provider so `store` is populated
    // for the assertion below. updateOne is the optimistic merge path
    // the provider uses for approve / advance / assign, and the one the
    // spec specifically calls out as a post site.
    mount()

    await act(async () => {
      store.updateOne({ id: 'p-1', stage: 'baskida' })
    })

    // Drain the postMessage queue before asserting on what the peer saw.
    await new Promise((r) => setTimeout(r, 20))
    expect(received.some((m) => m?.kind === 'projects-changed')).toBe(true)

    peer.close()
  })

  it('refetches when a sibling tab posts projects-changed', async () => {
    // Two distinct responses so we can tell the mount-time fetch from the
    // listener-triggered fetch by the call count.
    api.listProjects.mockResolvedValueOnce([])
    api.listProjects.mockResolvedValueOnce([{ id: 'p-1', stage: 'baskida' }])

    mount()
    // Mount triggers the initial fetch.
    await act(async () => {})
    expect(api.listProjects).toHaveBeenCalledTimes(1)

    // A sibling tab posts. The provider's listener should react by
    // calling listProjects again — that's the whole point of the wiring.
    const peer = new BroadcastChannel('yz:projects')
    peer.postMessage({ kind: 'projects-changed' })

    // Listener fires synchronously on the next microtask; the refetch it
    // triggers is async. Wait for the postMessage delivery AND the fetch.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(api.listProjects).toHaveBeenCalledTimes(2)
    peer.close()
  })

  it('refetches when an SSE notification event carries a projectId (cross-user live update)', async () => {
    // Regression: a matbaa action notifies whoever the pipeline cares about
    // (team leader, assigned designer) over the SSE stream the bell already
    // uses, but the shared list never listened to it — `api.subscribeProjects`
    // was never implemented, so the old optional-chain subscribe silently did
    // nothing. Dashboard/Kanban/Tüm Projeler stayed on the pre-action stage
    // for every OTHER signed-in user until the next 30 s tick.
    api.listProjects.mockResolvedValueOnce([{ id: 'p-1', stage: 'demo_teslim' }])
    api.listProjects.mockResolvedValueOnce([{ id: 'p-1', stage: 'demo_onay' }])

    mount()
    await act(async () => {})
    expect(api.listProjects).toHaveBeenCalledTimes(1)

    await act(async () => {
      __emitNotification({ userId: 'u-1', projectId: 'p-1', type: 'demo_advance' })
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(api.listProjects).toHaveBeenCalledTimes(2)
    expect(store.projects.find((p) => p.id === 'p-1')?.stage).toBe('demo_onay')
  })

  it('ignores SSE events with no projectId', async () => {
    // Not every notification is about a project (meeting reminders, etc.);
    // those shouldn't spend an extra /api/projects round-trip.
    mount()
    await act(async () => {})
    expect(api.listProjects).toHaveBeenCalledTimes(1)

    await act(async () => {
      __emitNotification({ userId: 'u-1', type: 'meeting_reminder' })
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(api.listProjects).toHaveBeenCalledTimes(1)
  })

  it('removeOne drops the project from the list and tells sibling tabs', async () => {
    // Regression: deleting a project only called DELETE /api/projects/:id and
    // navigated home. The store had no remove path — updateOne/addOne both
    // keep the row — so the dashboard kept rendering the deleted project
    // until the 30 s tick, and the user had to reload the page by hand.
    api.listProjects.mockResolvedValueOnce([
      { id: 'p-1', stage: 'baskida' },
      { id: 'p-2', stage: 'tasarim' },
    ])
    const peer = new BroadcastChannel('yz:projects')
    const received = []
    peer.onmessage = (e) => received.push(e.data)

    mount()
    await act(async () => {})
    expect(store.projects.map((p) => p.id)).toEqual(['p-1', 'p-2'])

    await act(async () => {
      store.removeOne('p-1')
    })

    // Gone from the shared list immediately — no refetch, no tick.
    expect(store.projects.map((p) => p.id)).toEqual(['p-2'])

    await new Promise((r) => setTimeout(r, 20))
    expect(received.some((m) => m?.kind === 'projects-changed')).toBe(true)
    peer.close()
  })

  it('tears the channel down on unmount (no message after unmount)', async () => {
    mount()
    await act(async () => {})

    // Unmount closes the channel; further posts from peers should NOT
    // reach a listProjects listener. Verify by posting after unmount and
    // asserting the call count is unchanged.
    act(() => root.unmount())
    root = null
    const callsBefore = api.listProjects.mock.calls.length

    const peer = new BroadcastChannel('yz:projects')
    peer.postMessage({ kind: 'projects-changed' })
    await new Promise((r) => setTimeout(r, 20))

    expect(api.listProjects.mock.calls.length).toBe(callsBefore)
    peer.close()
  })
})
