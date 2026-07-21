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

const client = axios.create({
  baseURL,
  withCredentials: false,
})

// Token storage. We keep both a module-level mirror (for the fast path
// inside interceptors) AND read from localStorage on every request — so a
// hard reload, a second tab, or a race between login and submit can't
// drop the header (the previous behaviour silently returned 401 "X-User-Id
// header is required" once `authToken` was ever reset to null).
const AUTH_KEY = 'yz_auth_v1'

function readStoredToken() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.token ?? null
  } catch {
    return null
  }
}

let authToken = null

export function setAuthToken(token) {
  authToken = token
}

export function getAuthToken() {
  // Module var is authoritative if explicitly set; otherwise fall back to
  // localStorage so we never silently send no header.
  return authToken ?? readStoredToken()
}

/**
 * Request interceptor. Auth is currently a trusted `X-User-Id` header;
 * real OAuth+cookie sessions arrive next pass.
 *
 * Reads from `getAuthToken()` (not the local `authToken` directly) so a
 * missing module mirror falls back to localStorage. This makes the SPA
 * resilient to:
 *   - the user logging in on a different tab and switching back
 *   - a hard reload that re-evaluates this module before `useAuth.js`'s
 *     mount-effect has run `setAuthToken(...)`
 *   - any future code path that clears the module mirror but leaves the
 *     session in storage
 */
client.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) config.headers['X-User-Id'] = token
  return config
})

// Surface backend errors uniformly.
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
