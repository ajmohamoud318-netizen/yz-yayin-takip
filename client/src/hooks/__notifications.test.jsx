import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'

// Required by React 18.3+ so the `act` from `react` actually wraps state
// updates; without this it logs a deprecation warning and queues the
// updates in a separate channel that never flushes.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Stub the api so the effect's initial refetch() doesn't reach the network.
vi.mock('@/api', () => ({
  default: {
    listNotifications: vi.fn(async () => ({ items: [], unread: 0, unseen: 0 })),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    markNotificationsSeen: vi.fn(),
  },
}))

// Pretend a user is signed in; useAuth's real boot does /auth/me + localStorage
// rehydration, neither of which we want the test to depend on.
vi.mock('@/hooks/useAuth.js', () => ({
  useAuth: () => ({ user: { id: 'u-test' } }),
}))

import { NotificationsProvider } from './useNotifications.jsx'

/**
 * Tiny EventSource stub (~25 lines). Mirrors only the surface the hook
 * touches: onopen/onerror slots, addEventListener, close, readyState.
 *
 * Why a hand-rolled stub: jsdom doesn't ship EventSource (it's omitted from
 * the spec coverage) and there isn't a standard one in this stack. The real
 * EventSource auto-reconnects on transient network blips; this stub leaves
 * readyState where the test puts it, so we can model "intermediaries timed
 * out the socket while the tab was backgrounded" by writing CLOSED before
 * firing visibilitychange.
 */
class FakeEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  static instances = []
  constructor(url, init) {
    this.url = url
    this.withCredentials = init?.withCredentials
    this.readyState = FakeEventSource.CONNECTING
    this.onopen = null
    this.onerror = null
    this._listeners = {}
    FakeEventSource.instances.push(this)
  }
  addEventListener(type, cb) {
    ;(this._listeners[type] ||= []).push(cb)
  }
  _emit(type, ev = new Event(type)) {
    if (type === 'open') this.readyState = FakeEventSource.OPEN
    if (type === 'error') this.readyState = FakeEventSource.CLOSED
    for (const cb of this._listeners[type] || []) cb(ev)
    if (type === 'open' && this.onopen) this.onopen(ev)
    if (type === 'error' && this.onerror) this.onerror(ev)
  }
  close() {
    this.readyState = FakeEventSource.CLOSED
  }
}

describe('useNotifications SSE effect', () => {
  let container
  let root

  beforeEach(() => {
    FakeEventSource.instances = []
    globalThis.EventSource = FakeEventSource
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    delete globalThis.EventSource
    container.remove()
  })

  function mount() {
    act(() => {
      root = createRoot(container)
      root.render(createElement(NotificationsProvider))
    })
  }

  it('does not recreate the EventSource after an error (no recreate loop)', async () => {
    mount()

    // Open the socket so sseConnected transitions true. The recreate-loop
    // bug only manifests when the value changes — pre-fix, putting
    // sseConnected in the dep array made every error trigger a fresh
    // EventSource, which errored again, ad infinitum.
    await act(async () => {
      FakeEventSource.instances[0]._emit('open')
    })
    expect(FakeEventSource.instances.length).toBe(1)

    await act(async () => {
      FakeEventSource.instances[0]._emit('error')
    })
    // Flush any re-renders scheduled by the error handler.
    await act(async () => {})

    expect(FakeEventSource.instances.length).toBe(1)
  })

  it('recreates the EventSource on visibility→visible when the socket was closed', async () => {
    mount()
    await act(async () => {
      FakeEventSource.instances[0]._emit('open')
    })
    expect(FakeEventSource.instances.length).toBe(1)

    // Backgrounding the tab drops SSE at intermediaries. We model the
    // post-background state by writing readyState=CLOSED — that's where
    // the real EventSource lands after a fatal response (401, 404) or
    // after exhausting native retries.
    FakeEventSource.instances[0].readyState = FakeEventSource.CLOSED

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(FakeEventSource.instances.length).toBe(2)
  })

  it('does NOT recreate the EventSource on visibility→visible when the socket is healthy', async () => {
    mount()
    await act(async () => {
      FakeEventSource.instances[0]._emit('open')
    })
    // readyState is now OPEN — the visibility handler must leave it alone.
    expect(FakeEventSource.instances.length).toBe(1)

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(FakeEventSource.instances.length).toBe(1)
  })
})