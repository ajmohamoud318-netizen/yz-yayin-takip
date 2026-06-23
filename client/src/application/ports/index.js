/**
 * @typedef {Object} ProjectRepository
 * @property {(filters?: object) => Promise<object[]>} list
 * @property {(id: string) => Promise<object>} getById
 * @property {(payload: object) => Promise<object>} create
 * @property {(id: string, patch: object) => Promise<object>} update
 * @property {(id: string) => Promise<void>} delete
 * @property {(id: string) => Promise<object>} advance
 * @property {(id: string) => Promise<object>} approve
 * @property {(id: string, reason: string, revizeIds?: string[]) => Promise<object>} reject
 */

/**
 * @typedef {Object} AuthRepository
 * @property {(email: string, password: string) => Promise<{ token: string, user: object }>} login
 * @property {() => Promise<void>} logout
 */

/**
 * @typedef {Object} UserRepository
 * @property {() => Promise<object[]>} list
 * @property {(payload: object) => Promise<object>} invite
 * @property {(id: string, isActive: boolean) => Promise<object>} setActive
 */

/**
 * @typedef {Object} OrderRequestRepository
 * @property {() => Promise<object[]>} list
 * @property {(payload: object) => Promise<object>} create
 * @property {(id: string, status: string) => Promise<object>} updateStatus
 * @property {(id: string, ctx: object) => Promise<object>} advance
 */

export {}
