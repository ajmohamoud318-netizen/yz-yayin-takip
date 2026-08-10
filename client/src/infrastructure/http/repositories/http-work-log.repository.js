import { httpClient } from '../client.js'

/**
 * Work log repo — "Çalışma Defteri" (see server migration 026__work_log.sql).
 *
 * Owner-scoped by the server: none of these calls carry a user id, the
 * backend resolves it from the session. Cross-user reads don't live here —
 * the Ekip page gets each user's `work_log_today` inlined on `GET /users`.
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
  }
}
