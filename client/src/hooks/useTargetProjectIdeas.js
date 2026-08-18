import { useCallback, useEffect, useState } from 'react'
import api from '@/api'
import { useAuth } from '@/hooks/useAuth.js'
import { MAX_SOURCE_BYTES, prepareIdeaImageFile } from '@/lib/image'

/**
 * Hedef Projeler — the idea board at /hedef-projeler (see server migration
 * 036__target_project_ideas.sql, image support in 037). Unlike useWorkLog
 * this list is shared across the whole team, not per-user, so it fetches
 * once on mount rather than re-keying off the signed-in user.
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

  const update = useCallback(
    async (id, { name, notes, link }) => {
      const prev = ideas
      setIdeas((cur) => cur.map((i) => (i.id === id
        ? { ...i, name: name?.trim() || i.name, notes: notes?.trim() || null, link: link?.trim() || null }
        : i)))
      setBusy(true)
      try {
        const saved = await api.updateTargetProjectIdea(id, { name, notes, link })
        setIdeas((cur) => cur.map((i) => (i.id === id ? saved : i)))
        return saved
      } catch (err) {
        setIdeas(prev)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [ideas],
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

  /** Downscale in-browser, upload, and splice the returned row into state. */
  const uploadImage = useCallback(
    async (id, file) => {
      if (file.size > MAX_SOURCE_BYTES) throw new Error('Dosya çok büyük (25 MB üzeri).')
      setBusy(true)
      try {
        const prepared = await prepareIdeaImageFile(file)
        const saved = await api.uploadTargetProjectIdeaImage(id, prepared)
        setIdeas((cur) => cur.map((i) => (i.id === id ? saved : i)))
        return saved
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const removeImage = useCallback(async (id) => {
    setBusy(true)
    try {
      const saved = await api.deleteTargetProjectIdeaImage(id)
      setIdeas((cur) => cur.map((i) => (i.id === id ? saved : i)))
      return saved
    } finally {
      setBusy(false)
    }
  }, [])

  // Designers and the team leader can add; the leader (or the idea's own
  // author) can remove or change the image. Mirrors the server's
  // requireRole / assertCanModify checks in routes/target-project-ideas.js
  // — this only hides the controls, the API is the real gate.
  const canAdd = user?.role === 'designer' || user?.role === 'team_leader'
  const canRemove = useCallback(
    (idea) => user?.role === 'team_leader' || idea.created_by === user?.id,
    [user],
  )

  return {
    ideas, loading, busy, add, update, remove, refetch, canAdd, canRemove, uploadImage, removeImage,
  }
}
