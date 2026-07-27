import { httpClient } from '../client.js'

/**
 * Work log repo — "Çalışma Defteri" (see server migration 026__work_log.sql).
 *
 * Owner-scoped by the server: none of these calls carry a user id, the
 * backend resolves it from the session. `listTeamWorkLog` is the one
 * cross-user read and 403s for anyone who isn't a team_leader.
 */
export function createHttpWorkLogRepository() {
  return {
    async listWorkLog(days) {
      const { data } = await httpClient.get('/work-log', {
        params: days ? { days } : undefined,
      })
      return Array.isArray(data?.entries) ? data.entries : []
    },
    async addWorkLogEntry({ kind, body, minutes }) {
      const { data } = await httpClient.post('/work-log', {
        kind,
        body,
        // Omit rather than send null so the schema's `minProperties`/enum
        // checks stay meaningful and the column keeps its default.
        ...(minutes == null ? {} : { minutes }),
      })
      return data
    },
    async updateWorkLogEntry(id, patch) {
      const { data } = await httpClient.patch(`/work-log/${id}`, patch)
      return data
    },
    async deleteWorkLogEntry(id) {
      await httpClient.delete(`/work-log/${id}`)
    },
    async listTeamWorkLog(date) {
      const { data } = await httpClient.get('/work-log/team', {
        params: date ? { date } : undefined,
      })
      return {
        date: data?.date ?? null,
        entries: Array.isArray(data?.entries) ? data.entries : [],
      }
    },
  }
}
