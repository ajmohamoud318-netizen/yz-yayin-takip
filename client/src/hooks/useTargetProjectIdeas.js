import { useCallback, useEffect, useState } from 'react'
import api from '@/api'
import { useAuth } from '@/hooks/useAuth.js'

/**
 * Hedef Projeler — the idea board on Baskı Listesi (see server migration
 * 036__target_project_ideas.sql). Unlike useWorkLog this list is shared
 * across the whole team, not per-user, so it fetches once on mount rather
 * than re-keying off the signed-in user.
 *
 * Mutations are optimistic, same shape as useWorkLog: the previous array is
 * kept in a closure and restored if the request fails.
 */
export function useTargetProjectIdeas() {
  const { user } = useAuth()
  const [ideas, setIdeas] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refetch = useCallback(async () => {
    try {
      const next = await api.listTargetProjectIdeas()
      setIdeas(next)
    } catch {
      /* transient — the section keeps showing what it had */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    refetch()
  }, [user, refetch])

  const add = useCallback(
    async ({ name, notes, link }) => {
      const trimmed = name.trim()
      if (!trimmed) return null
      const optimistic = {
        id: `tmp-${Date.now()}`,
        name: trimmed,
        notes: notes?.trim() || null,
        link: link?.trim() || null,
        created_by: user?.id ?? null,
        created_by_name: user?.name ?? null,
        created_at: new Date().toISOString(),
        pending: true,
      }
      const prev = ideas
      setIdeas([optimistic, ...ideas])
      setBusy(true)
      try {
        const saved = await api.addTargetProjectIdea({ name: trimmed, notes, link })
        setIdeas((cur) => cur.map((i) => (i.id === optimistic.id ? saved : i)))
        return saved
      } catch (err) {
        setIdeas(prev)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [ideas, user],
  )

  const remove = useCallback(
    async (id) => {
      const prev = ideas
      setIdeas(ideas.filter((i) => i.id !== id))
      setBusy(true)
      try {
        await api.deleteTargetProjectIdea(id)
      } catch (err) {
        setIdeas(prev)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [ideas],
  )

  // Designers and the team leader can add; the leader (or the idea's own
  // author) can remove. Mirrors the server's requireRole / owner check in
  // routes/target-project-ideas.js — this only hides the controls, the API
  // is the real gate.
  const canAdd = user?.role === 'designer' || user?.role === 'team_leader'
  const canRemove = useCallback(
    (idea) => user?.role === 'team_leader' || idea.created_by === user?.id,
    [user],
  )

  return { ideas, loading, busy, add, remove, refetch, canAdd, canRemove }
}
