import { createContext, useContext, useState, useCallback, useEffect, useMemo, createElement } from 'react'
import api from '@/api'
import { getAuthToken } from '@/infrastructure/http/client.js'
import { hydrateProductInfo } from '@/data/productCatalog'

const ProjectsContext = createContext(null)

export function ProjectsProvider({ children }) {
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

  // Wait until an auth token is present in the module mirror OR
  // localStorage before firing the first refetch. Otherwise the
  // ProjectsProvider's mount effect races AuthProvider's mount effect:
  // both are deferred effects, so whichever runs first wins. On a hard
  // refresh of a session where "30 gün hatırla" was NOT ticked, the
  // token is held only in memory — and `getAuthToken()` returns null
  // until AuthProvider's restore effect runs. Calling refetch() with
  // no token means the request leaves without X-User-Id, the backend
  // rejects with 401, and the dashboard flashes the red 'X-User-Id
  // header is required' error card.
  //
  // We poll for the token at 25 ms (4 ticks × 25 ms = 100 ms of slack,
  // well inside the React commit + effect microtask window). If a
  // token still hasn't shown up after ~1 s, give up silently — the user
  // is unauthenticated, the Login route will catch them at
  // <RequireAuth>.
  useEffect(() => {
    let cancelled = false
    let pollTimer = null
    let pollingAttempts = 0

    function tryRefetch() {
      if (cancelled) return
      const tok = getAuthToken()
      if (tok) {
        refetch()
      } else if (pollingAttempts++ < 40) {
        pollTimer = setTimeout(tryRefetch, 25)
      } else {
        // Give up: user isn't authenticated. Set loading=false so
        // child pages render their empty state instead of an error
        // card.
        setLoading(false)
      }
    }
    tryRefetch()

    const t = setInterval(() => {
      // Subsequent ticks only fire if we still have a token — never
      // re-introduce the cold-load 401 race.
      if (getAuthToken()) refetch()
    }, 30_000)

    // Subscribe to cross-aggregate mutations (order reassignment,
    // handover confirm, etc.) so the bell red-dots and project cards
    // update without waiting for the next 30 s tick.
    const unsubscribe = api.subscribeProjects?.(updateOne)
    return () => {
      cancelled = true
      if (pollTimer) clearTimeout(pollTimer)
      clearInterval(t)
      unsubscribe?.()
    }
  }, [refetch, updateOne])

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
