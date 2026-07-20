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

let authToken = null

export function setAuthToken(token) {
  authToken = token
}

export function getAuthToken() {
  return authToken
}

/**
 * Request interceptor. Auth is currently a trusted `X-User-Id` header;
 * real OAuth+cookie sessions arrive next pass.
 */
client.interceptors.request.use((config) => {
  if (!authToken) return config
  config.headers['X-User-Id'] = authToken
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
