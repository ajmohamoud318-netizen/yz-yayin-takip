import { useState, useEffect, useCallback } from 'react'
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

  return { projects, loading, error, refetch: fetchProjects }
}
