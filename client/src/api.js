/**
 * Composition root (facade).
 *
 * Presentation layer imports from here — never from infrastructure directly.
 * Domain constants/helpers are re-exported for convenience.
 *
 * Transport is selected by `infrastructure/config.js` → `USE_MOCK`:
 *   USE_MOCK = true  → createApi()        (in-memory mock + localStorage)
 *   USE_MOCK = false → createHttpApi()    (Fastify + Postgres server)
 *
 * The two factories return the exact same surface, so all the React
 * pages, hooks, and use cases run unchanged.
 */
export * from './domain/index.js'
export { setAuthToken } from './infrastructure/http/client.js'
export { resetMockState } from './infrastructure/mock/store.js'
export { USE_MOCK } from './infrastructure/config.js'

import { USE_MOCK } from './infrastructure/config.js'
import { createApi } from './application/create-api.js'
import { createHttpApi } from './infrastructure/http/create-http-api.js'

const api = USE_MOCK ? createApi() : createHttpApi()
export { api }
export default api
