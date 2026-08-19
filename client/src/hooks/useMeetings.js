import { useCallback, useEffect, useState } from 'react'
import api from '@/api'
import { useAuth } from '@/hooks/useAuth.js'
import { MAX_SOURCE_BYTES, prepareIdeaImageFile } from '@/lib/image'

/**
 * Toplantılar — the meeting log at /toplanti (see server migration
 * 040__meetings.sql). Shared across the whole team, not per-user, so it
 * fetches once on mount rather than re-keying off the signed-in user, same
 * as useTargetProjectIdeas.
 *
 * Mutations are optimistic: the previous array is kept in a closure and
 * restored if the request fails.
 */
export function useMeetings() {
  const { user } = useAuth()
  const [meetings, setMeetings] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refetch = useCallback(async () => {
    try {
      const next = await api.listMeetings()
      setMeetings(next)
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
    async ({ title, meetingAt, links, projectId }) => {
      const trimmed = title.trim()
      if (!trimmed || !meetingAt) return null
      const cleanLinks = (links ?? []).map((l) => l.trim()).filter(Boolean)
      const optimistic = {
        id: `tmp-${Date.now()}`,
        title: trimmed,
        meeting_at: meetingAt,
        links: cleanLinks,
        project_id: projectId || null,
        created_by: user?.id ?? null,
        created_by_name: user?.name ?? null,
        created_at: new Date().toISOString(),
        pending: true,
      }
      const prev = meetings
      setMeetings([optimistic, ...meetings])
      setBusy(true)
      try {
        const saved = await api.addMeeting({ title: trimmed, meetingAt, links: cleanLinks, projectId })
        setMeetings((cur) => cur.map((m) => (m.id === optimistic.id ? saved : m)))
        return saved
      } catch (err) {
        setMeetings(prev)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [meetings, user],
  )

  const update = useCallback(
    async (id, { title, meetingAt, links, projectId }) => {
      const cleanLinks = links !== undefined ? links.map((l) => l.trim()).filter(Boolean) : undefined
      const prev = meetings
      setMeetings((cur) => cur.map((m) => (m.id === id
        ? {
          ...m,
          title: title?.trim() || m.title,
          meeting_at: meetingAt ?? m.meeting_at,
          links: cleanLinks ?? m.links,
          project_id: projectId ?? null,
        }
        : m)))
      setBusy(true)
      try {
        const saved = await api.updateMeeting(id, { title, meetingAt, links: cleanLinks, projectId })
        setMeetings((cur) => cur.map((m) => (m.id === id ? saved : m)))
        return saved
      } catch (err) {
        setMeetings(prev)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [meetings],
  )

  const remove = useCallback(
    async (id) => {
      const prev = meetings
      setMeetings(meetings.filter((m) => m.id !== id))
      setBusy(true)
      try {
        await api.deleteMeeting(id)
      } catch (err) {
        setMeetings(prev)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [meetings],
  )

  /** Downscale in-browser, upload, and splice the returned row into state. */
  const uploadImage = useCallback(
    async (id, file) => {
      if (file.size > MAX_SOURCE_BYTES) throw new Error('Dosya çok büyük (25 MB üzeri).')
      setBusy(true)
      try {
        const prepared = await prepareIdeaImageFile(file)
        const saved = await api.uploadMeetingImage(id, prepared)
        setMeetings((cur) => cur.map((m) => (m.id === id ? saved : m)))
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
      const saved = await api.deleteMeetingImage(id)
      setMeetings((cur) => cur.map((m) => (m.id === id ? saved : m)))
      return saved
    } finally {
      setBusy(false)
    }
  }, [])

  // Team leader, designers and the printer can add; the leader (or a
  // meeting's own author) can edit or remove it. Mirrors the server's
  // requireRole / assertCanModify checks in routes/meetings.js — this only
  // hides the controls, the API is the real gate.
  const canAdd = user?.role === 'team_leader' || user?.role === 'designer' || user?.role === 'printer'
  const canModify = useCallback(
    (meeting) => user?.role === 'team_leader' || meeting.created_by === user?.id,
    [user],
  )

  return {
    meetings, loading, busy, add, update, remove, refetch, canAdd, canModify, uploadImage, removeImage,
  }
}
