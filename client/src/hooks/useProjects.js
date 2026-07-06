import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../api.js'
import { useProjectsStore } from './useProjectsStore.jsx'

/**
 * Project list for the pages. Delegates to the shared ProjectsProvider store so
 * every page and dialog reads/writes the SAME list — otherwise a mutation made
 * in a dialog (approve/reject/advance) wouldn't show up on the page that opened
 * it (e.g. the approval queue would keep showing an already-approved project).
 */
export function useProjects() {
  return useProjectsStore()
}

/**
 * Loads a single project by id. Used by ProjectDetail.
 *
 * The detail view used to keep a completely independent fetched copy, so it
 * could drift from the shared list: an approval done elsewhere (e.g. the
 * Onaylar screen) updated the store, but reopening the same project — whose id
 * hadn't changed — wouldn't refetch, leaving the detail showing an older stage
 * than "Tüm Projeler". To guarantee the data is the SAME everywhere we:
 *   1. overlay the live store entry on top of the fetched detail, so the detail
 *      can never display fields older than the rest of the app,
 *   2. push every detail-side mutation back into the store via setProject,
 *   3. refresh the store with the freshly fetched detail on every load.
 *
 * Returns the project, loading/error state, and a refetch helper.
 */
export function useProject(id) {
  const { projects, updateOne } = useProjectsStore()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchProject = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.getProject(id)
      setDetail(data)
      updateOne(data) // keep the shared list in sync with the full detail
    } catch (e) {
      setError(e.message || 'Proje yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [id, updateOne])

  useEffect(() => {
    fetchProject()
  }, [fetchProject])

  // The shared store is the single source of truth for pipeline state. Overlay
  // its live fields on top of the locally-fetched detail so the detail view can
  // never show data older than the list (e.g. right after an approval made from
  // another screen). Only defined keys are copied, so a bare seed entry never
  // wipes the detail's richer fields (subtasks/history/assignees).
  const storeEntry = projects.find((p) => p.id === id)
  const project = useMemo(() => {
    if (!detail) return null
    if (!storeEntry) return detail
    const overlay = {}
    for (const key of Object.keys(storeEntry)) {
      if (storeEntry[key] !== undefined) overlay[key] = storeEntry[key]
    }
    return { ...detail, ...overlay }
  }, [detail, storeEntry])

  // setProject keeps the detail's local copy AND the shared store in lockstep,
  // so subtask/page/update edits made in the detail show up immediately on the
  // list and anywhere else the project is rendered.
  const setProject = useCallback(
    (updater) => {
      setDetail((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        if (next?.id) updateOne(next)
        return next
      })
    },
    [updateOne],
  )

  return { project, loading, error, refetch: fetchProject, setProject }
}
