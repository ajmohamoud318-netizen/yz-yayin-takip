// Regression coverage for cross-tab BroadcastChannel sync.
//
// The projects store keeps its list of projects in module-scoped state, so
// two tabs of the same user — same cookie session, same origin — only
// refreshed independently. Tab A approving a project would leave tab B
// showing the old stage until the next 30 s tick. The fix posts a small
// 'projects-changed' message on `yz:projects` whenever the list mutates
// (refetch, optimistic updateOne, optimistic addOne) and listens for the
// same message on mount, refetching on receipt.
//
// Three things need to be true:
//
//   1. Two BroadcastChannel instances with the same name deliver messages
//      to each other (jsdom 22+ supports BroadcastChannel natively).
//   2. When the provider mutates the list, the channel posts a message —
//      sibling tabs receive it and react.
//   3. When a sibling tab posts, the provider's listener refetches.
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
// return values it cares about via `mockResolvedValueOnce`. We stub
// `subscribeProjects` (which the real api doesn't expose — used with
// optional chaining in the provider) as a no-op so the mount effect's
// subscribe call doesn't blow up.
vi.mock('@/api', () => ({
  default: {
    listProjects: vi.fn(async () => []),
    subscribeProjects: vi.fn(() => () => {}),
  },
}))

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
