import { httpClient } from '../client.js'

/**
 * Toplantılar repo — meeting log activated in the sidebar (see server
 * migration 040__meetings.sql).
 */
export function createHttpMeetingRepository() {
  return {
    async listMeetings() {
      const { data } = await httpClient.get('/meetings')
      return Array.isArray(data?.meetings) ? data.meetings : []
    },
    async addMeeting({ title, meetingAt, notes, projectId }) {
      const { data } = await httpClient.post('/meetings', {
        title,
        meeting_at: meetingAt,
        // Omit rather than send empty strings so the schema's maxLength
        // checks stay meaningful and blank fields store as NULL server-side.
        ...(notes?.trim() ? { notes: notes.trim() } : {}),
        ...(projectId ? { project_id: projectId } : {}),
      })
      return data
    },
    async updateMeeting(id, { title, meetingAt, notes, projectId }) {
      const { data } = await httpClient.patch(`/meetings/${id}`, {
        ...(title !== undefined ? { title } : {}),
        ...(meetingAt !== undefined ? { meeting_at: meetingAt } : {}),
        ...(notes !== undefined ? { notes: notes?.trim() || '' } : {}),
        ...(projectId !== undefined ? { project_id: projectId || null } : {}),
      })
      return data
    },
    async deleteMeeting(id) {
      await httpClient.delete(`/meetings/${id}`)
    },
  }
}
