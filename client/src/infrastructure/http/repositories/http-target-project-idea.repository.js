import { httpClient } from '../client.js'

/**
 * Hedef Projeler repo — idea board on Baskı Listesi (see server migration
 * 036__target_project_ideas.sql).
 */
export function createHttpTargetProjectIdeaRepository() {
  return {
    async listTargetProjectIdeas() {
      const { data } = await httpClient.get('/target-project-ideas')
      return Array.isArray(data?.ideas) ? data.ideas : []
    },
    async addTargetProjectIdea({ name, notes, link }) {
      const { data } = await httpClient.post('/target-project-ideas', {
        name,
        // Omit rather than send empty strings so the schema's maxLength
        // checks stay meaningful and blank fields store as NULL server-side.
        ...(notes?.trim() ? { notes: notes.trim() } : {}),
        ...(link?.trim() ? { link: link.trim() } : {}),
      })
      return data
    },
    async deleteTargetProjectIdea(id) {
      await httpClient.delete(`/target-project-ideas/${id}`)
    },
    /**
     * Upload / replace an idea's photo. Same multipart shape as
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
  }
}
