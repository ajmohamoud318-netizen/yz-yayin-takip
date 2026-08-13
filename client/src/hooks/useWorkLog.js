import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '@/api'
import { useAuth } from '@/hooks/useAuth.js'
import { groupByDay, todayKey } from '@/lib/work-log.js'

/**
 * The signed-in user's own work log ("Çalışma Defteri").
 *
 * Deliberately a plain hook, not a provider: unlike notifications there's
 * exactly one live consumer (the header pill), the data only changes when
 * *this* user types something, and it needs no poll loop — so a context
 * would buy nothing and cost a re-render on every app-wide subscriber.
 *
 * `enabled` gates the fetch so the panel's history isn't loaded until the
 * pill is first opened. Today's entries come down eagerly (the pill's label
 * depends on them), history follows on demand.
 *
 * Mutations are optimistic. Every one of them keeps the previous array in a
 * closure and restores it if the request fails, so a dropped connection
 * leaves the list exactly as the user last saw it rather than half-applied.
 */
export function useWorkLog({ days = 14 } = {}) {
  const { user, updateUser } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const userId = user?.id ?? null

  // `daily_status` on the auth user is derived server-side from the newest
  // entry of today. Mirror that locally after every mutation so anything
  // still reading user.daily_status doesn't lag a page-load behind.
  const syncAuthStatus = useCallback(
    (list) => {
      const key = todayKey()
      const todays = list.filter((e) => String(e.entry_date).slice(0, 10) === key)
      const latest = todays[todays.length - 1] ?? null
      updateUser?.({ daily_status: latest?.body ?? null })
    },
    [updateUser],
  )

  const refetch = useCallback(async () => {
    try {
      const next = await api.listWorkLog(days)
      setEntries(next)
      syncAuthStatus(next)
    } catch {
      /* transient — the panel keeps showing what it had */
    } finally {
      setLoading(false)
    }
  }, [days, syncAuthStatus])

  // Refetch on sign-in / account switch. A non-null `userId` already means
  // AuthProvider's GET /auth/me came back OK, so the cookie session is live —
  // the old extra wait on the legacy localStorage token just left the pill
  // empty for sessions that never wrote one ("30 gün hatırla" unticked).
  const lastUserRef = useRef(null)
  useEffect(() => {
    if (lastUserRef.current !== userId) {
      lastUserRef.current = userId
      setEntries([])
      setLoading(!!userId)
    }
    if (!userId) return
    refetch()
  }, [userId, refetch])

  const add = useCallback(
    async ({ kind, body, minutes }) => {
      const text = body.trim()
      if (!text) return null
      // Optimistic row. The temp id is namespaced so a render can tell a
      // pending entry from a persisted one (used to disable its delete).
      const optimistic = {
        id: `tmp-${Date.now()}`,
        entry_date: todayKey(),
        kind,
        body: text,
        minutes: minutes ?? null,
        created_at: new Date().toISOString(),
        pending: true,
      }
      const prev = entries
      const next = [optimistic, ...entries]
      setEntries(next)
      syncAuthStatus(next)
      setBusy(true)
      try {
        const saved = await api.addWorkLogEntry({ kind, body: text, minutes })
        setEntries((cur) => {
          const merged = cur.map((e) => (e.id === optimistic.id ? saved : e))
          syncAuthStatus(merged)
          return merged
        })
        return saved
      } catch (err) {
        setEntries(prev)
        syncAuthStatus(prev)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [entries, syncAuthStatus],
  )

  const edit = useCallback(
    async (id, patch) => {
      const prev = entries
      setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, ...patch } : e)))
      setBusy(true)
      try {
        const saved = await api.updateWorkLogEntry(id, patch)
        setEntries((cur) => {
          const merged = cur.map((e) => (e.id === id ? saved : e))
          syncAuthStatus(merged)
          return merged
        })
        return saved
      } catch (err) {
        setEntries(prev)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [entries, syncAuthStatus],
  )

  const remove = useCallback(
    async (id) => {
      const prev = entries
      const next = entries.filter((e) => e.id !== id)
      setEntries(next)
      syncAuthStatus(next)
      setBusy(true)
      try {
        await api.deleteWorkLogEntry(id)
      } catch (err) {
        setEntries(prev)
        syncAuthStatus(prev)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [entries, syncAuthStatus],
  )

  // Today vs. the rest, computed once per entries change. Today is rendered
  // newest-first in the composer's timeline; history keeps its day buckets.
  const { today, history } = useMemo(() => {
    const key = todayKey()
    const todays = []
    const older = []
    for (const e of entries) {
      if (String(e.entry_date).slice(0, 10) === key) todays.push(e)
      else older.push(e)
    }
    return { today: todays, history: groupByDay(older) }
  }, [entries])

  return { entries, today, history, loading, busy, add, edit, remove, refetch }
}
