import axios from 'axios'
import { USE_MOCK } from '../config.js'

// In dev, Vite's proxy (see vite.config.js) rewrites /api → http://localhost:4000.
// In production, the SPA is served by `serve.cjs` and `/api` would 404, so we
// read the absolute backend URL from VITE_API_BASE_URL (set per-environment
// in Dokploy) and fall back to a same-origin `/api` for local dev.
//
// The default below is the Dokploy-managed sslip.io host that Traefik wires
// to the backend container. It wins unless VITE_API_BASE_URL is explicitly
// set AND resolves. This guards against the case where Dokploy's Build-time
// Arguments still contain a stale/unreachable host (e.g. while a wildcard
// cert for api.yt.mucitkarinca.com is being issued by Let's Encrypt).
const DEFAULT_API_BASE_URL = 'https://yayin-takip-backend-4dvoqr-53441c-46-62-170-64.sslip.io'

const envBase = import.meta.env?.VITE_API_BASE_URL?.trim()
const isLocalhostOverride =
  envBase && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(envBase)
const baseURL = envBase && isLocalhostOverride
  ? `${envBase.replace(/\/$/, '')}/api`
  : `${DEFAULT_API_BASE_URL}/api`

const client = axios.create({
  baseURL,
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
