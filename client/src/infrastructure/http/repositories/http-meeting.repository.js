import { httpClient } from '../client.js'

/**
 * Toplantılar repo — meeting log activated in the sidebar (see server
 * migration 040__meetings.sql, and the multi-link / gallery / notes-log
 * detail view in 043__meeting_details.sql).
 */
export function createHttpMeetingRepository() {
  return {
    async listMeetings() {
      const { data } = await httpClient.get('/meetings')
      return Array.isArray(data?.meetings) ? data.meetings : []
    },
    async getMeetingDetail(id) {
      const { data } = await httpClient.get(`/meetings/${id}`)
      return data
    },
    async addMeeting({ title, meetingAt, links, projectId }) {
      const { data } = await httpClient.post('/meetings', {
        title,
        meeting_at: meetingAt,
        links: (links ?? []).map((l) => l.trim()).filter(Boolean),
        ...(projectId ? { project_id: projectId } : {}),
      })
      return data
    },
    async updateMeeting(id, { title, meetingAt, links, projectId }) {
      const { data } = await httpClient.patch(`/meetings/${id}`, {
        ...(title !== undefined ? { title } : {}),
        ...(meetingAt !== undefined ? { meeting_at: meetingAt } : {}),
        ...(links !== undefined ? { links: links.map((l) => l.trim()).filter(Boolean) } : {}),
        ...(projectId !== undefined ? { project_id: projectId || null } : {}),
      })
      return data
    },
    async deleteMeeting(id) {
      await httpClient.delete(`/meetings/${id}`)
    },
    /**
     * Upload / replace a meeting's cover photo. Same multipart shape as
     * uploadTargetProjectIdeaImage — see that method for why `timeout: 0`.
     */
    async uploadMeetingImage(id, file) {
      if (!file) throw new Error('Dosya bulunamadı.')
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await httpClient.put(`/meetings/${id}/image`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
      })
      return data
    },
    async deleteMeetingImage(id) {
      const { data } = await httpClient.delete(`/meetings/${id}/image`)
      return data
    },
    /** Add a photo to the meeting's gallery (beyond the single cover). */
    async addMeetingGalleryImage(id, file) {
      if (!file) throw new Error('Dosya bulunamadı.')
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await httpClient.post(`/meetings/${id}/images`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
      })
      return data
    },
    async deleteMeetingGalleryImage(id, imageId) {
      await httpClient.delete(`/meetings/${id}/images/${imageId}`)
    },
    async addMeetingNote(id, body) {
      const { data } = await httpClient.post(`/meetings/${id}/notes`, { body })
      return data
    },
    async deleteMeetingNote(id, noteId) {
      await httpClient.delete(`/meetings/${id}/notes/${noteId}`)
    },
  }
}
