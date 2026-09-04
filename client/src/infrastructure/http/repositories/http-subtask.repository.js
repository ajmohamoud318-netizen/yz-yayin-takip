import { httpClient } from '../client.js'

/**
 * Subtask repository.
 *
 * `setSubtaskDone` is the tap-to-toggle path for non-pages subtasks
 * (kapak, kutu, sticker-count, etc.); it goes through PATCH /subtasks/:id
 * with `{ is_done }`. The toggle stays here forever — it's the same UX
 * designers have used for everything except "İç Sayfalar".
 *
 * `setSubtaskDesignerCounts` is the migration 067 replacement for the
 * per-chip PATCH /subtasks/:id/pages/:pageIndex round-trip the chip
 * grid used to make. Designers enter the page count they shipped into
 * a number input; one save per blur/Enter; the response is a slim
 * shape that the SPA merges into state without a follow-up GET.
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
     * `{ counts: [{ designer_id, pages_done }, ...] }`. The route
     * resolves every `(designer_id, pages_done)` pair into the right
     * row of `subtask_designer_counts`, recomputes the parent subtask's
     * `pages_done` / `is_done` via the migration 067 trigger, and
     * returns the slim shape that `useProjectSubtasks.handleDesignerCountChange`
     * needs to update the header bar / designer input row without a
     * follow-up GET.
     *
     * The server gates the body:
     *   • team_leader role may update any slots;
     *   • designer role may update only their own slot (the body must
     *     include exactly their `designer_id`).
     *
     * Returns the full `data` shape:
     *   { subtask_id, project_id, total_pages, pages_done, is_done,
     *     designer_counts: [{ designer_id, designer_name, pages_done }],
     *     project_progress, project: { id, progress, version } }
     */
    async setSubtaskDesignerCounts(subtaskId, counts, { signal } = {}) {
      const { data } = await httpClient.patch(
        `/subtasks/${subtaskId}/designer-counts`,
        { counts },
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
