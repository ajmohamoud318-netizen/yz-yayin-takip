import axios from 'axios'
import { USE_MOCK } from '../config.js'

const client = axios.create({
  baseURL: '/api',
  withCredentials: false,
})

let authToken = null

export function setAuthToken(token) {
  authToken = token
}

export function getAuthToken() {
  return authToken
}

export function getCurrentUserId() {
  if (!authToken) return null
  // Mock tokens look like `mock-<id>`; HTTP tokens are bare UUIDs.
  return authToken.startsWith('mock-') ? authToken.slice(5) : authToken
}

/**
 * Request interceptor. In mock mode we keep the legacy `Bearer mock-…`
 * header (no backend). In HTTP mode we attach `X-User-Id` because auth
 * is currently a trusted header — the real OAuth+cookie session arrives
 * next pass.
 */
client.interceptors.request.use((config) => {
  if (!authToken) return config
  if (USE_MOCK) {
    config.headers.Authorization = `Bearer ${authToken}`
  } else {
    config.headers['X-User-Id'] = getCurrentUserId()
  }
  return config
})

// Optional response hook: surface backend errors uniformly.
client.interceptors.response.use(
  (resp) => resp,
  (err) => {
    const message = err?.response?.data?.error ?? err?.response?.data?.message ?? err.message
    return Promise.reject(Object.assign(new Error(message), {
      status: err?.response?.status,
      code: err?.response?.data?.code,
      cause: err,
    }))
  },
)

export { client as httpClient }
