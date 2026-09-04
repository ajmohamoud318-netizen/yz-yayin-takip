import { httpClient } from '../client.js'

/**
 * Subtask repository.
 *
 * The non-pages subtasks (kapak, kutu, sticker-count, …) still go through
 * `setSubtaskDone` / `setSubtaskStickers` / `toggleSubtask`. Designers
 * click a checkbox and one row updates.
 *
 * The "İç Sayfalar" (pages) subtask took a different shape with the
 * chip-by-chip UX gone (migration 067). The "+N ekledim" UI sends one
 * `addSubtaskDesignerBatch` per save, creating an append-only row in
 * `subtask_designer_batches` whose `pages` contributes to the running
 * subtask total via the migration 067 trigger. Each batch is
 * independently re-touchable: `markSubtaskDesignerBatchRedone` stamps
 * the "Yeniden Çalıştım" affordance on one specific saved batch.
 *
 * `saveProjectSubtasks` (PUT /projects/:id/subtasks) and
 * `updateSubtask` (PATCH /subtasks/:id) stay leader-driven and remain
 * the canonical way to mutate the SHAPE of the alt-görev list (kind,
 * totals, assignment).
 */
export function createHttpSubtaskRepository() {
  return {
    async toggleSubtask(projectId, subtaskId, isDone) {
      const { data } = await httpClient.patch(`/subtasks/${subtaskId}`, { is_done: isDone })
      return data
    },
    async setSubtaskDone(subtaskId, isDone) {
      const { data } = await httpClient.patch(`/subtasks/${subtaskId}`, { is_done: isDone })
      return { project: data }
    },
    async setSubtaskStickers(subtaskId, stickersDone) {
      const { data } = await httpClient.patch(`/subtasks/${subtaskId}`, { stickers_done: stickersDone })
      return { project: data }
    },
    /**
     * migration 067 — designer pages-done input. Body is
     * `{ designer_id, pages }`. Server enforces ownership:
     *   • team_leader may add a batch for any active designer;
     *   • designer may add only for themselves.
     *
     * Slim response shape:
     *   { subtask_id, project_id, total_pages, pages_done, is_done,
     *     batch: { id, designer_id, designer_name, pages, created_at,
     *              redone_at, redone_by, redone_by_name },
     *     project_progress, project: { id, progress, version } }
     */
    async addSubtaskDesignerBatch(subtaskId, { designerId, pages }, { signal } = {}) {
      const { data } = await httpClient.post(
        `/subtasks/${subtaskId}/designer-batches`,
        { designer_id: designerId, pages },
        signal ? { signal } : undefined,
      )
      return data
    },
    /**
     * migration 067 — stamp "Yeniden Çalıştım" on a single batch.
     * Idempotent on the server side, so the SPA can call it freely
     * (re-click, retry, optimistic UI rebind) without double-stamping
     * the audit row.
     */
    async markSubtaskDesignerBatchRedone(subtaskId, batchId, { signal } = {}) {
      const { data } = await httpClient.post(
        `/subtasks/${subtaskId}/designer-batches/${batchId}/redone`,
        {},
        signal ? { signal } : undefined,
      )
      return data
    },
    async reviseSubtask(subtaskId) {
      const { data } = await httpClient.post(`/subtasks/${subtaskId}/revize`)
      return { project: data }
    },
    async addSubtaskUpdate(subtaskId, payload) {
      const { data } = await httpClient.post(`/subtasks/${subtaskId}/updates`, payload)
      return data
    },
    async updateSubtask(subtaskId, patch) {
      const { data } = await httpClient.patch(`/subtasks/${subtaskId}`, patch)
      return { project: data }
    },
    async saveProjectSubtasks(projectId, subtasks) {
      const { data } = await httpClient.put(`/projects/${projectId}/subtasks`, { subtasks })
      return { project: data, subtasks: data.subtasks ?? [] }
    },
  }
}
