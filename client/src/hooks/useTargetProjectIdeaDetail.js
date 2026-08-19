import { useCallback, useEffect, useState } from 'react'
import api from '@/api'
import { useAuth } from '@/hooks/useAuth.js'
import { MAX_SOURCE_BYTES, prepareIdeaImageFile } from '@/lib/image'

/**
 * Backs the Hedef Proje detail dialog: fetches the idea's gallery (extra
 * photos beyond the cover) and its notes log, and exposes mutations for
 * both. Separate from useTargetProjectIdeas because the card grid never
 * needs this data — it's only fetched once someone opens an idea's detail
 * view. See migration 042__target_project_idea_details.sql.
 */
export function useTargetProjectIdeaDetail(ideaId) {
  const { user } = useAuth()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refetch = useCallback(async () => {
    if (!ideaId) return
    try {
      const next = await api.getTargetProjectIdeaDetail(ideaId)
      setDetail(next)
    } catch {
      /* transient — the dialog keeps showing what it had, or stays loading */
    } finally {
      setLoading(false)
    }
  }, [ideaId])

  useEffect(() => {
    setLoading(true)
    setDetail(null)
    refetch()
  }, [refetch])

  const addGalleryImage = useCallback(
    async (file) => {
      if (file.size > MAX_SOURCE_BYTES) throw new Error('Dosya çok büyük (25 MB üzeri).')
      setBusy(true)
      try {
        const prepared = await prepareIdeaImageFile(file)
        const image = await api.addTargetProjectIdeaGalleryImage(ideaId, prepared)
        setDetail((cur) => (cur ? { ...cur, images: [...cur.images, image] } : cur))
        return image
      } finally {
        setBusy(false)
      }
    },
    [ideaId],
  )

  const removeGalleryImage = useCallback(
    async (imageId) => {
      setBusy(true)
      try {
        await api.deleteTargetProjectIdeaGalleryImage(ideaId, imageId)
        setDetail((cur) => (cur ? { ...cur, images: cur.images.filter((img) => img.id !== imageId) } : cur))
      } finally {
        setBusy(false)
      }
    },
    [ideaId],
  )

  const addNote = useCallback(
    async (body) => {
      const trimmed = body.trim()
      if (!trimmed) return null
      setBusy(true)
      try {
        const note = await api.addTargetProjectIdeaNote(ideaId, trimmed)
        setDetail((cur) => (cur ? { ...cur, notes: [...cur.notes, note] } : cur))
        return note
      } finally {
        setBusy(false)
      }
    },
    [ideaId],
  )

  const removeNote = useCallback(
    async (noteId) => {
      setBusy(true)
      try {
        await api.deleteTargetProjectIdeaNote(ideaId, noteId)
        setDetail((cur) => (cur ? { ...cur, notes: cur.notes.filter((n) => n.id !== noteId) } : cur))
      } finally {
        setBusy(false)
      }
    },
    [ideaId],
  )

  const canModifyNote = useCallback(
    (note) => user?.role === 'team_leader' || note.created_by === user?.id,
    [user],
  )

  return {
    detail, loading, busy, refetch, addGalleryImage, removeGalleryImage, addNote, removeNote, canModifyNote,
  }
}
