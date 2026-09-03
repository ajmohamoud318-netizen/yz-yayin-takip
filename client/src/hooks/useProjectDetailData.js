import { useEffect, useState } from 'react'

import { useNotifications } from './useNotifications'
import api from '@/api'

/**
 * Owns orders/handovers/users data fetching + SSE subscription for the
 * project detail hook.  Also owns the sipariş-order mutation handlers and
 * their dialog targets (`signOrder`, `siparisBaskiOnayOrder`,
 * `ozalitRequestOrder`).
 *
 * Returns the fetched lists, their setters, and the order handlers.
 */
export function useProjectDetailData(id) {
  const { subscribe } = useNotifications()

  // ---------------------------------------------------------------------------
  // Local data state
  // ---------------------------------------------------------------------------

  const [projectOrders, setProjectOrders] = useState([])
  const [projectHandover, setProjectHandover] = useState(null)
  // Full active designer roster — the leader's assign popover on every chip
  // needs every assignable face, not just the ones already on this project
  // (the leader may be onboarding a designer mid-revision). Pulled once on
  // mount via `api.listUsers()`, which is already cached in the user repo
  // so a hot reload hits the cache instead of the network.
  const [allUsers, setAllUsers] = useState([])

  // Order-specific dialog targets
  const [signOrder, setSignOrder] = useState(null)
  // Distinct from baskiOnayFormOpen — that's the final production-gate
  // "Baskı Onayı" (BaskiOnayFormDialog), unrelated to a sipariş order's own
  // "Baskı Onayı" step (baski_onayi_bekleniyor), which needs its own form dialog
  // (SiparisBaskiOnayFormDialog) before it can advance — see canActOnOrder.
  const [siparisBaskiOnayOrder, setSiparisBaskiOnayOrder] = useState(null)
  // The designer's ozalit-request step — this page already holds the project,
  // so only the order is needed (see orderOzalitFormMode for the mode).
  const [ozalitRequestOrder, setOzalitRequestOrder] = useState(null)

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!id) return
    api.listOrderRequests()
      .then((reqs) => setProjectOrders(reqs.filter((r) => r.project_id === id)))
      .catch(() => {})
    api.listHandovers()
      .then((rows) => {
        const mine = rows
          .filter((h) => h.project_id === id)
          .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        setProjectHandover(mine[0] ?? null)
      })
      .catch(() => {})
    // Designer roster for the chip-grid assign popover. `listUsers()` is
    // also used by the header assignee list and the NewProjectDialog — it's
    // the same cache, so the second mount on the same session is free.
    api.listUsers().then(setAllUsers).catch(() => {})
  }, [id])

  // ---------------------------------------------------------------------------
  // Order mutation handlers
  // ---------------------------------------------------------------------------

  function handleOrderSigned(updated) {
    setProjectOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)))
    setSignOrder(null)
  }

  // "Teslim Alındı" doesn't remove the order from the queue — it just
  // updates the held order in place (see TalepSignDialog's onUpdated contract).
  function handleOrderUpdated(updated) {
    setProjectOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)))
    setSignOrder((prev) => (prev ? { ...prev, ...updated } : updated))
  }

  // The ozalit request moves the order off the designer's desk — merge the
  // fresh row into the trackers and close.
  function handleOrderOzalitRequested(updated) {
    setProjectOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)))
    setOzalitRequestOrder(null)
  }

  function handleSiparisBaskiOnayApproved(updated) {
    setProjectOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)))
    if (updated.status !== 'baski_onayi_bekleniyor') setSiparisBaskiOnayOrder(null)
  }

  function openOrderAction(order) {
    if (order.status === 'baski_onayi_bekleniyor') setSiparisBaskiOnayOrder(order)
    // "Ozalit İsteyin" (migration 054) opens the order's own Ozalit Üretim
    // Formu — sending that sheet IS the request, so there's no sign dialog.
    else if (order.status === 'kontroller_tamam') setOzalitRequestOrder(order)
    else setSignOrder(order)
  }

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    // Data
    projectOrders, setProjectOrders,
    projectHandover,
    allUsers,

    // Order dialog state
    signOrder, setSignOrder,
    siparisBaskiOnayOrder, setSiparisBaskiOnayOrder,
    ozalitRequestOrder, setOzalitRequestOrder,

    // Order handlers
    handleOrderSigned, handleOrderUpdated, handleOrderOzalitRequested,
    handleSiparisBaskiOnayApproved, openOrderAction,

    // For SSE subscription at the parent level
    subscribe,
  }
}

/**
 * Subscribes to notification events for this project and calls `onEvent`
 * when a relevant event arrives.  Extracted so the parent hook can wire
 * `refetch` without this hook needing to know about project state.
 */
export function useProjectDetailSSE(id, projectOrders, subscribe, onEvent) {
  useEffect(() => {
    if (!id) return undefined
    const unsubscribe = subscribe((event) => {
      if (event.projectId !== id && !projectOrders.some((o) => o.id === event.orderId)) return
      onEvent(event)
    })
    return unsubscribe
  }, [id, subscribe, onEvent, projectOrders])
}
