import { httpClient } from '../client.js'

/**
 * Hedef Projeler repo — idea board on Baskı Listesi (see server migration
 * 036__target_project_ideas.sql, and the multi-link / gallery / notes-log
 * detail view in 042__target_project_idea_details.sql).
 */
export function createHttpTargetProjectIdeaRepository() {
  return {
    async listTargetProjectIdeas() {
      const { data } = await httpClient.get('/target-project-ideas')
      return Array.isArray(data?.ideas) ? data.ideas : []
    },
    async getTargetProjectIdeaDetail(id) {
      const { data } = await httpClient.get(`/target-project-ideas/${id}`)
      return data
    },
    async addTargetProjectIdea({ name, links }) {
      const { data } = await httpClient.post('/target-project-ideas', {
        name,
        links: (links ?? []).map((l) => l.trim()).filter(Boolean),
      })
      return data
    },
    async updateTargetProjectIdea(id, { name, links }) {
      const { data } = await httpClient.patch(`/target-project-ideas/${id}`, {
        ...(name !== undefined ? { name } : {}),
        ...(links !== undefined ? { links: links.map((l) => l.trim()).filter(Boolean) } : {}),
      })
      return data
    },
    async deleteTargetProjectIdea(id) {
      await httpClient.delete(`/target-project-ideas/${id}`)
    },
    /**
     * Upload / replace an idea's cover photo. Same multipart shape as
     * uploadAvatar — see that method for why `timeout: 0`.
     */
    async uploadTargetProjectIdeaImage(id, file) {
      if (!file) throw new Error('Dosya bulunamadı.')
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await httpClient.put(`/target-project-ideas/${id}/image`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
      })
      return data
    },
    async deleteTargetProjectIdeaImage(id) {
      const { data } = await httpClient.delete(`/target-project-ideas/${id}/image`)
      return data
    },
    /** Add a photo to the idea's gallery (beyond the single cover). */
    async addTargetProjectIdeaGalleryImage(id, file) {
      if (!file) throw new Error('Dosya bulunamadı.')
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await httpClient.post(`/target-project-ideas/${id}/images`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
      })
      return data
    },
    async deleteTargetProjectIdeaGalleryImage(id, imageId) {
      await httpClient.delete(`/target-project-ideas/${id}/images/${imageId}`)
    },
    async addTargetProjectIdeaNote(id, body) {
      const { data } = await httpClient.post(`/target-project-ideas/${id}/notes`, { body })
      return data
    },
    async deleteTargetProjectIdeaNote(id, noteId) {
      await httpClient.delete(`/target-project-ideas/${id}/notes/${noteId}`)
    },
  }
}
