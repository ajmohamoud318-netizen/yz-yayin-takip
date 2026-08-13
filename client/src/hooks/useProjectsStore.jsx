import { createContext, useContext, useState, useCallback, useEffect, useMemo, createElement } from 'react'
import api from '@/api'
import { useAuth } from './useAuth.js'
import { hydrateProductInfo } from '@/data/productCatalog'

const ProjectsContext = createContext(null)

export function ProjectsProvider({ children }) {
  // ProjectsProvider is mounted INSIDE AuthProvider (see main.jsx), so this
  // is safe — and it is what lets the fetch wait on the real session check
  // instead of guessing from localStorage.
  const { bootstrapping, isAuthenticated } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refetch = useCallback(async () => {
    setError(null)
    try {
      const data = await api.listProjects()
      setProjects(data)
      // Prime the product-info cache (and one-time-backfill any legacy
      // localStorage specs) so the Demo/Ozalit forms and Ürün Bilgileri read
      // the shared, server-side spec rather than a per-browser override.
      hydrateProductInfo(data.map((p) => p.id))
    } catch (e) {
      setError(e.message || 'Projeler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  const updateOne = useCallback((updated) => {
    if (!updated?.id) return
    setProjects((prev) =>
      prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
    )
  }, [])

  const addOne = useCallback((created) => {
    if (!created?.id) return
    setProjects((prev) => (prev.some((p) => p.id === created.id) ? prev : [...prev, created]))
  }, [])

  // Gate the first fetch on AUTH STATE, not on a token in localStorage.
  //
  // The previous version polled `getAuthToken()` — the legacy `X-User-Id`
  // mirror — for ~1 s and gave up if nothing showed up. But the session is
  // an httpOnly cookie now, and `persistAuth()` only writes that mirror when
  // "30 gün hatırla" is ticked. So for every non-remembered session a cold
  // start found no token, gave up, and set loading=false with an EMPTY list:
  // `GET /auth/me` succeeded on the cookie, the user was plainly logged in,
  // and the dashboard still showed nothing until they hit "Yenile" (which
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

    refetch()
    const t = setInterval(refetch, 30_000)

    // Subscribe to cross-aggregate mutations (order reassignment,
    // handover confirm, etc.) so the bell red-dots and project cards
    // update without waiting for the next 30 s tick.
    const unsubscribe = api.subscribeProjects?.(updateOne)
    return () => {
      clearInterval(t)
      unsubscribe?.()
    }
  }, [bootstrapping, isAuthenticated, refetch, updateOne])

  // Imported backlist products (`origin: 'legacy'` — see migration 031 and
  // AGENTS.md → "Arşiv (legacy) products") are real projects sitting at a
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
