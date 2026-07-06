import { httpClient } from '../../http/client.js'
import { mockDemos, saveState } from '../store.js'
import { mockOrHttp } from '../helpers/mock-handler.js'
import { uid } from '../helpers/id.js'

export function createMockDemoRepository() {
  return {
    listDemos() {
      return mockOrHttp(
        () => mockDemos.map((d) => ({ ...d })),
        async () => {
          const { data } = await httpClient.get('/demos')
          return data
        },
      )
    },

    createDemo({ title, files = [], items = [] }) {
      return mockOrHttp(
        () => {
          const demo = {
            id: uid('demo-'),
            title,
            items: items.map((t) => ({ id: uid('di-'), title: t })),
            files: files.map((f) => ({ name: f.name, size: f.size })),
            created_at: new Date().toISOString(),
          }
          mockDemos.unshift(demo)
          saveState()
          return { ...demo }
        },
        async () => {
          const { data } = await httpClient.post('/demos', { title, files, items })
          return data
        },
      )
    },
  }
}
