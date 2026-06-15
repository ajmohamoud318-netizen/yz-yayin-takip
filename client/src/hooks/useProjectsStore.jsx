import { createContext, useContext, useState, useCallback, useEffect, createElement } from 'react'
import api from '@/api'

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
    } catch (e) {
      setError(e.message || 'Projeler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()
    const t = setInterval(refetch, 30_000)
    return () => clearInterval(t)
  }, [refetch])

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

  return createElement(
    ProjectsContext.Provider,
    { value: { projects, loading, error, refetch, setProjects, updateOne, addOne } },
    children,
  )
}

export function useProjectsStore() {
  const ctx = useContext(ProjectsContext)
  if (!ctx) throw new Error('useProjectsStore must be used inside ProjectsProvider')
  return ctx
}
