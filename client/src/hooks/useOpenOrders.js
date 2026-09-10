import { useEffect, useState } from 'react'
import api from '@/api'
import { isOrderOpen } from '@/domain/constants/orders'

/**
 * Open sipariş (order) requests, keyed by project_id. "Open" mirrors
 * http-order.repository.js's findOpenByProject: not yet at a terminal step.
 * Both read `ORDER_TERMINAL_STEPS`, which since migration 081 means
 * teslim_edildi/rejected — an order at `baskida` still owes its teslim, so it
 * is still in flight and the badge stays up until satış takes delivery.
 * Used to badge a project row/bar when it has a sipariş in flight, without
 * pulling order_requests into the projects list itself (orders are a separate
 * entity — see AGENTS.md).
 *
 * Each value is a LIST, oldest order first. Nothing stops satış raising a
 * second order while the first is printing, and a map of one order per project
 * kept whichever the loop saw last — the older, since the list arrives newest
 * first — so the newer order vanished from every badge.
 */
export function useOpenOrdersByProject() {
  const [byProject, setByProject] = useState(new Map())

  useEffect(() => {
    let cancelled = false
    api.listOrderRequests().then((reqs) => {
      if (cancelled) return
      const map = new Map()
      for (const r of reqs) {
        if (!isOrderOpen(r)) continue
        const list = map.get(r.project_id)
        if (list) list.push(r)
        else map.set(r.project_id, [r])
      }
      for (const list of map.values()) {
        list.sort((a, b) => (a.order_no ?? 0) - (b.order_no ?? 0))
      }
      setByProject(map)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return byProject
}
