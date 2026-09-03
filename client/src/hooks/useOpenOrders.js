import { useEffect, useState } from 'react'
import api from '@/api'

/**
 * Open sipariş (order) requests, keyed by project_id. "Open" mirrors
 * http-order.repository.js's findOpenByProject: not yet at a terminal step
 * (onaylandi/rejected). Used to badge a project row/bar when it has a
 * sipariş in flight, without pulling order_requests into the projects list
 * itself (orders are a separate entity — see AGENTS.md).
 */
export function useOpenOrdersByProject() {
  const [byProject, setByProject] = useState(new Map())

  useEffect(() => {
    let cancelled = false
    api.listOrderRequests().then((reqs) => {
      if (cancelled) return
      const map = new Map()
      for (const r of reqs) {
        if (r.status === 'baskida' || r.status === 'rejected') continue
        map.set(r.project_id, r)
      }
      setByProject(map)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return byProject
}
