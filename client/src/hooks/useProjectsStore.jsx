import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, createElement } from 'react'
import api from '@/api'
import { useAuth } from './useAuth.js'
import { useOnResume } from './useOnResume.js'
import { hydrateProductInfo } from '@/data/productCatalog'

// Channel name for cross-tab sync. Other tabs of the same origin (and same
// user, by way of the cookie session) listen here; when one tab mutates the
// project list, the others refetch. MUST match the name the listener opens,
// or the broadcast silently lands on a different channel and is dropped.
const PROJECTS_CHANNEL = 'yz:projects'

const ProjectsContext = createContext(null)

export function ProjectsProvider({ children }) {
  // ProjectsProvider is mounted INSIDE AuthProvider (see main.jsx), so this
  // is safe — and it is what lets the fetch wait on the real session check
  // instead of guessing from localStorage.
  const { bootstrapping, isAuthenticated } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Cross-tab BroadcastChannel. Created inside the mount effect (so it is
  // torn down on unmount / logout) but referenced through a ref so the
  // post helpers below — which are defined outside that effect — can fire
  // messages without prop-drilling the channel instance. `supportsBroadcast`
  // is captured at module load: jsdom pre-22 and iOS Safari < 15.4 lack
  // the API entirely, and we fall back to the existing 30 s interval.
  const channelRef = useRef(null)
  const supportsBroadcast = typeof BroadcastChannel !== 'undefined'

  const postProjectsChanged = useCallback(() => {
    // Coarse-grained "something changed" — refetching /api/projects is
    // cheap, and refining by projectId/subtaskId is a follow-up if
    // profiling ever says the saving is worth the branching. See the
    // spec's note on case-by-case judgement.
    channelRef.current?.postMessage({ kind: 'projects-changed' })
  }, [])

  const refetch = useCallback(async () => {
    setError(null)
    try {
      const data = await api.listProjects()
      setProjects(data)
      // Prime the product-info cache (and one-time-backfill any legacy
      // localStorage specs) so the Demo/Ozalit forms and Ürün Bilgileri read
      // the shared, server-side spec rather than a per-browser override.
      hydrateProductInfo(data.map((p) => p.id))
      // Tell sibling tabs the list is stale so they refetch too. Called
      // only on success — a transient 5xx should not make other tabs
      // hammer the same broken endpoint.
      postProjectsChanged()
    } catch (e) {
      setError(e.message || 'Projeler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [postProjectsChanged])

  const updateOne = useCallback((updated) => {
    if (!updated?.id) return
    setProjects((prev) =>
      prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
    )
    // Optimistic merge path (advance, approve, assign, etc.). The mutation
    // already happened locally; sibling tabs need the same nudge to fetch.
    postProjectsChanged()
  }, [postProjectsChanged])

  const addOne = useCallback((created) => {
    if (!created?.id) return
    setProjects((prev) => (prev.some((p) => p.id === created.id) ? prev : [...prev, created]))
    postProjectsChanged()
  }, [postProjectsChanged])

  // Gate the first fetch on AUTH STATE, not on a token in localStorage.
  //
  // The previous version polled `getAuthToken()` — the legacy `X-User-Id`
  // mirror — for ~1 s and gave up if nothing showed up. But the session is
  // an httpOnly cookie now, and `persistAuth()` only writes that mirror when
  // "30 gün hatırla" is ticked. So for every non-remembered session a cold
  // start found no token, gave up, and set loading=false with an EMPTY list:
  // `GET /auth/me` succeeded on the cookie, the user was plainly logged in,
  // and the dashboard still showed nothing until they hit "Yenileyin" (which
  // calls refetch() directly, bypassing the gate — hence "refresh fixes it").
  // The same gate also killed the 30 s auto-refresh for those sessions.
  //
  // `bootstrapping` is exactly the signal we actually wanted: it flips false
  // once AuthProvider's `GET /auth/me` resolves, so the cookie is known-good
  // (or known-absent) before we ask for projects. No polling, no race.
  useEffect(() => {
    // Still asking the server who we are — projects would 401.
    if (bootstrapping) return

    // Genuinely unauthenticated. Drop the spinner so child pages render
    // their empty state; <RequireAuth> handles the redirect to /login.
    if (!isAuthenticated) {
      setLoading(false)
      return
    }

    // Cross-tab sync via BroadcastChannel. Opened AND listened on the same
    // effect so the listener is removed in lockstep with `channel.close()`
    // on unmount — a stale listener that kept a closure over a previous
    // refetch would otherwise still call setState on an unmounted tree.
    // The channel name MUST match `PROJECTS_CHANNEL` on both ends; a typo
    // here silently routes messages to a channel no listener is on.
    let channel = null
    if (supportsBroadcast) {
      channel = new BroadcastChannel(PROJECTS_CHANNEL)
      channelRef.current = channel
      // The message carries no payload yet: coarse-grained "something
      // changed" → refetch the canonical /api/projects. Refining by
      // projectId/subtaskId is a follow-up if profiling says the saving
      // is worth the branching.
      channel.addEventListener('message', () => {
        refetch()
      })
    }

    refetch()
    // Skip ticks while the app is in the background. On iOS the timer is
    // frozen there anyway; on Android it just burns the phone's data plan
    // polling a dashboard nobody is looking at. Coming back to the
    // foreground refetches immediately (see useOnResume below), so nothing
    // is lost by staying quiet.
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      refetch()
    }, 30_000)

    // Subscribe to cross-aggregate mutations (order reassignment,
    // handover confirm, etc.) so the bell red-dots and project cards
    // update without waiting for the next 30 s tick.
    const unsubscribe = api.subscribeProjects?.(updateOne)
    return () => {
      clearInterval(t)
      unsubscribe?.()
      if (channel) {
        channel.close()
        channelRef.current = null
      }
    }
  }, [bootstrapping, isAuthenticated, refetch, updateOne, supportsBroadcast])

  // Refresh the moment the app is foregrounded.
  //
  // The 30 s interval alone is not a refresh strategy for an installed PWA.
  // iOS suspends the page when the app is backgrounded: the timer stops, and
  // any request that was in flight is killed — which lands in refetch()'s
  // catch and leaves `error` set. Resume an hour later and the app shows
  // either an hour-old pipeline or the red "Projeler yüklenemedi" card, with
  // no way out until a tick lands. That is the "I have to close it and open
  // it again" symptom: force-quitting was just the user's way of forcing a
  // refetch. refetch() clears `error` on entry, so this recovers both.
  useOnResume(() => {
    if (bootstrapping || !isAuthenticated) return
    refetch()
  })

  // Imported backlist products (`origin: 'legacy'` — see migration 031 and
  // AGENTS.md → "Kayıtlı ürünler (legacy)") are real projects sitting at a
  // finished stage so Sales can order them, but they are NOT live pipeline
  // work: no subtasks, no designer, no demo/ozalit history.
  //
  // Filtering here — at the single store every page reads through — is what
  // keeps them out of İş Akışı, Tüm Projeler, Yıllık Plan, Projelerim and the
  // AppShell counts without touching any of those pages. In particular
  // PeriodWidget renders `satista / total`: unfiltered, importing ~90 backlist
  // titles would make it read "180/200 satışta" on day one and stop describing
  // the current period at all.
  //
  // Callers that genuinely want everything (Ürün Bilgileri, which lists the
  // catalog) opt in via `allProjects`. Ürünler needs neither — it calls
  // api.listProjects() directly and so keeps seeing the full set.
  const pipelineProjects = useMemo(
    () => projects.filter((p) => p.origin !== 'legacy'),
    [projects],
  )

  return createElement(
    ProjectsContext.Provider,
    {
      value: {
        projects: pipelineProjects,
        allProjects: projects,
        loading,
        error,
        refetch,
        setProjects,
        updateOne,
        addOne,
      },
    },
    children,
  )
}

export function useProjectsStore() {
  const ctx = useContext(ProjectsContext)
  if (!ctx) throw new Error('useProjectsStore must be used inside ProjectsProvider')
  return ctx
}
