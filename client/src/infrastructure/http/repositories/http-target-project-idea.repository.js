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
  }
}
