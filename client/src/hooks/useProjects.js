import { useState, useEffect, useCallback } from 'react'
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
 * Returns the project, loading/error state, and a refetch helper.
 */
export function useProject(id) {
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchProject = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.getProject(id)
      setProject(data)
    } catch (e) {
      setError(e.message || 'Proje yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchProject()
  }, [fetchProject])

  return { project, loading, error, refetch: fetchProject, setProject }
}
