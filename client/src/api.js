/**
 * Composition root (facade).
 *
 * Presentation layer imports from here — never from infrastructure directly.
 * Domain constants/helpers are re-exported for convenience.
 */
export * from './domain/index.js'
export { setAuthToken } from './infrastructure/http/client.js'
export { resetMockState } from './infrastructure/mock/store.js'

import { createApi } from './application/create-api.js'

const api = createApi()
export { api }
export default api
