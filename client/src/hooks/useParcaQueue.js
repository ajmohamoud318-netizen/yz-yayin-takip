import { useCallback, useEffect, useState } from 'react'

import api from '@/api'
import { useNotifications } from './useNotifications.jsx'

/**
 * The parçalar sitting on the signed-in user's own desk, across every project
 * (migration 074).
 *
 * This is what makes the matbaa's queue per-parça rather than per-project.
 * Every other queue in the app derives from `project.stage` — one row per
 * project, because a project was only ever in one place at a time. Per-parça
 * routing breaks that: a project at `demo_onay` can owe KUTU to the matbaa
 * while KİTAP is with the designer, and its stage says nothing about either.
 * So this asks the server directly: what is mine?
 *
 * The server decides what "mine" means from the caller's role — the matbaa
 * gets parçalar `with_matbaa` or `in_round`, the designer gets `with_designer`,
 * a leader gets none (their work is the approval gate, which the parça grid on
 * the project already shows).
 *
 * Rows carry `project_title` / `project_stage` so the queue can render a row
 * without a second fetch per project.
 *
 * @returns {{ rows: object[], loading: boolean, refetch: () => void }}
 */
export function useParcaQueue(enabled = true) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const { subscribe } = useNotifications()

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!enabled) { setRows([]); return undefined }
    let cancelled = false
    setLoading(true)
    api.listParcaQueue()
      .then((data) => { if (!cancelled) setRows(Array.isArray(data) ? data : []) })
      // Transient by design: this queue is additive to the stage-driven one,
      // so a failed load hides the parça rows rather than breaking the page.
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled, tick])

  // Live refresh: this queue never polled and never listened for anything —
  // it only ever (re)loaded on mount or when a caller's own action called
  // `refetch()`. So when a DIFFERENT printer (or a leader routing a parça)
  // moved something onto or off of this desk, this queue kept showing the
  // stale snapshot until the page was reloaded by hand. Any project-pipeline
  // notification might be the one that moved a parça, and there's no cheap
  // local filter for that, so — same trade-off `useProjectsStore` makes —
  // just refetch on any signal while this queue is in use.
  useEffect(() => {
    if (!enabled) return undefined
    return subscribe(() => refetch())
  }, [enabled, subscribe, refetch])

  return { rows, loading, refetch }
}

/**
 * One project's parça routing rows (migration 074).
 *
 * Separate from `useParcaQueue` because the question is different: that one
 * asks "what is on my desk, anywhere", this one asks "where does every parça of
 * THIS project stand" — which is what the project page needs to show a designer
 * their returned parçalar, or a leader who is holding what.
 *
 * `refetch` matters here: acting on a parça changes a row this hook owns, and
 * nothing else will tell it.
 *
 * @returns {{ rows: object[], loading: boolean, refetch: () => void }}
 */
export function useProjectParcaState(projectId) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!projectId) { setRows([]); return undefined }
    let cancelled = false
    setLoading(true)
    api.listParcaState(projectId)
      .then((data) => { if (!cancelled) setRows(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, tick])

  return { rows, loading, refetch }
}
