import { useCallback, useEffect, useState } from 'react'
import api from '@/api'
import { useAuth } from '@/hooks/useAuth.js'
import { MAX_SOURCE_BYTES, prepareIdeaImageFile } from '@/lib/image'

/**
 * Backs the Toplantı detail dialog: fetches the meeting's gallery (extra
 * photos beyond the cover) and its notes log, and exposes mutations for
 * both. Separate from useMeetings because the card grid never needs this
 * data — it's only fetched once someone opens a meeting's detail view.
 * Mirrors useTargetProjectIdeaDetail. See migration
 * 043__meeting_details.sql.
 */
export function useMeetingDetail(meetingId) {
  const { user } = useAuth()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refetch = useCallback(async () => {
    if (!meetingId) return
    try {
      const next = await api.getMeetingDetail(meetingId)
      setDetail(next)
    } catch {
      /* transient — the dialog keeps showing what it had, or stays loading */
    } finally {
      setLoading(false)
    }
  }, [meetingId])

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
        const image = await api.addMeetingGalleryImage(meetingId, prepared)
        setDetail((cur) => (cur ? { ...cur, images: [...cur.images, image] } : cur))
        return image
      } finally {
        setBusy(false)
      }
    },
    [meetingId],
  )

  const removeGalleryImage = useCallback(
    async (imageId) => {
      setBusy(true)
      try {
        await api.deleteMeetingGalleryImage(meetingId, imageId)
        setDetail((cur) => (cur ? { ...cur, images: cur.images.filter((img) => img.id !== imageId) } : cur))
      } finally {
        setBusy(false)
      }
    },
    [meetingId],
  )

  const addNote = useCallback(
    async (body) => {
      const trimmed = body.trim()
      if (!trimmed) return null
      setBusy(true)
      try {
        const note = await api.addMeetingNote(meetingId, trimmed)
        setDetail((cur) => (cur ? { ...cur, notes: [...cur.notes, note] } : cur))
        return note
      } finally {
        setBusy(false)
      }
    },
    [meetingId],
  )

  const updateNote = useCallback(
    async (noteId, body) => {
      const trimmed = body.trim()
      if (!trimmed) return null
      setBusy(true)
      try {
        const note = await api.updateMeetingNote(meetingId, noteId, trimmed)
        setDetail((cur) => (cur ? { ...cur, notes: cur.notes.map((n) => (n.id === noteId ? note : n)) } : cur))
        return note
      } finally {
        setBusy(false)
      }
    },
    [meetingId],
  )

  const removeNote = useCallback(
    async (noteId) => {
      setBusy(true)
      try {
        await api.deleteMeetingNote(meetingId, noteId)
        setDetail((cur) => (cur ? { ...cur, notes: cur.notes.filter((n) => n.id !== noteId) } : cur))
      } finally {
        setBusy(false)
      }
    },
    [meetingId],
  )

  const canModifyNote = useCallback(
    (note) => user?.role === 'team_leader' || note.created_by === user?.id,
    [user],
  )

  return {
    detail, loading, busy, refetch, addGalleryImage, removeGalleryImage, addNote, updateNote, removeNote, canModifyNote,
  }
}
