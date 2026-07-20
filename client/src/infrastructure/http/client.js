import axios from 'axios'

// In dev, Vite's proxy (see vite.config.js) rewrites /api → http://localhost:4000.
// In production, the SPA is served by `serve.cjs` and `/api` would 404, so we
// read the absolute backend URL from VITE_API_BASE_URL (set per-environment
// in Dokploy) and fall back to a same-origin `/api` for local dev.
//
// The default below is the canonical Cloudflare-fronted host
// (api.yt.mucitkarinca.com).
const DEFAULT_API_BASE_URL = 'https://api.yt.mucitkarinca.com'

const envBase = import.meta.env?.VITE_API_BASE_URL?.trim()
const baseURL = envBase
  ? `${envBase.replace(/\/$/, '')}/api`
  : `${DEFAULT_API_BASE_URL}/api`

/**
 * Absolute origin of the backend, suitable for absolute <img src> URLs.
 * Strips the trailing `/api` so callers can prepend their own path
 * segments.
 */
export const API_ORIGIN = baseURL.replace(/\/api\/?$/, '')

// withCredentials: true is what makes the browser send the yz_sid cookie
// to the API. The cookie is httpOnly + SameSite=Lax (set by the server)
// so JS can't read it — the browser sends it automatically.
const client = axios.create({
  baseURL,
  withCredentials: true,
})

export function setAuthToken(_token) {
  // No-op: auth is now a cookie. Kept as an export because the SPA
  // import surface (api.js → useAuth) still calls it on the magic-link
  // callback path. We swallow the value here so the call site stays
  // forward-compatible if we ever reintroduce a token-shaped identity.
}

export function getAuthToken() {
  return null
}

export function getCurrentUserId() {
  return null
}

// Response interceptor: surface backend errors uniformly. Cookies travel
// with the request automatically — no per-request header wiring needed.
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