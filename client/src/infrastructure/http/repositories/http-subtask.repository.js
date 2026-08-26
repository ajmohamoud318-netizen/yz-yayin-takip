import { httpClient } from '../client.js'

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
    async setSubtaskPages(subtaskId, pagesDone) {
      const { data } = await httpClient.patch(`/subtasks/${subtaskId}`, { pages_done: pagesDone })
      return { project: data }
    },
    async setSubtaskStickers(subtaskId, stickersDone) {
      const { data } = await httpClient.patch(`/subtasks/${subtaskId}`, { stickers_done: stickersDone })
      return { project: data }
    },
    // migration 055 — flip a single page's status on the "İç Sayfalar"
    // subtask. The server recomputes pages_done / is_done on the parent
    // subtask and returns the full project shape so the SPA's
    // `setProject` can drop it in without a follow-up GET.
    //
    // Accepts an optional AbortController `signal` so the chip grid can
    // cancel an in-flight PATCH when the user clicks the same chip again
    // (or a different one) before the server has answered — without it, two
    // near-simultaneous requests land on the client and the slower one wins
    // the final setProject merge.
    async setSubtaskPage(subtaskId, pageIndex, status, { signal } = {}) {
      const { data } = await httpClient.patch(
        `/subtasks/${subtaskId}/pages/${pageIndex}`,
        { status },
        signal ? { signal } : undefined,
      )
      return { project: data.project, page: data.page }
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
