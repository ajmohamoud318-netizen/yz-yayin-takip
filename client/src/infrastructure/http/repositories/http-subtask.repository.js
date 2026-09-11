import { httpClient } from '../client.js'

/**
 * Subtask repository.
 *
 * The non-pages subtasks (kapak, kutu, sticker-count, …) still go through
 * `setSubtaskDone` / `setSubtaskStickers` / `toggleSubtask`. Designers
 * click a checkbox and one row updates.
 *
 * The "İç Sayfalar" (pages) and "Sticker" subtasks share a single
 * additive counter. The "+N ekledim" UI sends one
 * `addSubtaskDesignerBatch` per save, creating an append-only row in
 * `subtask_designer_batches` whose `pages` contributes to the running
 * subtask total via the migration 067 trigger. Migration 084 dropped
 * the per-row `start_page` slot — the running total is just the SUM
 * of every row's `pages` across every designer on the subtask.
 *
 * Each batch is independently mutable:
 *   • `removeSubtaskDesignerBatch` deletes one row (the server gates
 *     so a designer can only remove their own row; team_leader can
 *     remove any). The same trigger recomputes the counter.
 *   • `markSubtaskDesignerBatchRedone` stamps the "Yeniden Çalıştım"
 *     audit flag on one specific saved batch. Idempotent.
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
     * migration 067/084 — designer pages-done input. Body is now the
     * flat `{ designer_id, pages }` — one "+N today" row on a shared
     * subtask counter. Migration 084 dropped the per-row `start_page`
     * slot, so a comma list ("1,5,7") is no longer a single save —
     * designers type one number per save and the counter just adds up.
     *
     * Server enforces ownership:
     *   • team_leader may add a batch for any active designer;
     *   • designer may add only for themselves.
     *
     * Slim response shape:
     *   { subtask_id,
     *     batches: [{ id, subtask_id, designer_id, designer_name, pages,
     *                 created_at, redone_at, redone_by, redone_by_name }],
     *     batch: <batches[0]>,   // kept for older callers
     *     project_progress, project: { id, progress, version } }
     */
    async addSubtaskDesignerBatch(subtaskId, { designerId, pages }, { signal } = {}) {
      const { data } = await httpClient.post(
        `/subtasks/${subtaskId}/designer-batches`,
        { designer_id: designerId, pages: Number(pages) },
        signal ? { signal } : undefined,
      )
      return data
    },
    /**
     * migration 084 — drop a single saved batch row. The server gates
     * so a designer may only remove their OWN row (team_leader can
     * remove any), and the trigger recomputes `pages_done` /
     * `stickers_done` for us — same response shape as the add call so
     * the SPA can reconcile either side off the same envelope.
     *
     * Slim response shape:
     *   { subtask_id, removed_batch_id,
     *     batches: [{ id, subtask_id, designer_id, designer_name, pages,
     *                 created_at, redone_at, redone_by, redone_by_name }],
     *     project_progress, project: { id, progress, version } }
     */
    async removeSubtaskDesignerBatch(subtaskId, batchId, { signal } = {}) {
      const { data } = await httpClient.delete(
        `/subtasks/${subtaskId}/designer-batches/${batchId}`,
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
