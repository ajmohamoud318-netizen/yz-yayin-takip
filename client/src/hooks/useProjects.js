import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../api.js'

/**
 * Loads the project list for the dashboard. Returns the raw list plus
 * loading/error state and a refetch helper. Grouping/coloring is derived
 * in the components via the helpers exported from api.js.
 */
export function useProjects() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listProjects()
      setProjects(data)
    } catch (e) {
      setError(e.message || 'Projeler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Replace or insert a single project (used after mutations like advance).
  const updateOne = useCallback((updated) => {
    setProjects((prev) => {
      const idx = prev.findIndex((p) => p.id === updated.id)
      if (idx === -1) return [...prev, updated]
      const next = prev.slice()
      next[idx] = updated
      return next
    })
  }, [])

  return { projects, loading, error, refetch: fetchProjects, updateOne }
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
