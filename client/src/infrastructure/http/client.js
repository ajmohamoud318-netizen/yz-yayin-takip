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

// Eagerly seed the module mirror from localStorage at module-load time.
// Without this, the first api call after a hard refresh races against
// AuthProvider's mount-effect (which calls setAuthToken later) — every
// child refetch in the same tick can fire with no header, the server
// rejects with 401 "X-User-Id header is required", and the dashboard
// flashes the red "Tekrar Dene" error card even though the session was
// sitting in localStorage the whole time. Reading localStorage here is
// synchronous and cheap; if nothing is stored yet, authToken stays null
// and the next request still goes through (which is correct for the
// unauthenticated login screen).
authToken = readStoredToken()

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
    const status = err?.response?.status
    const message = err?.response?.data?.error ?? err?.response?.data?.message ?? err.message

    // A 401 from the API means the session/header is no longer accepted.
    // The right UX is to drop the cached credentials and bounce to the
    // login screen — NOT to render a red "Tekrar Dene" card and let the
    // user sit there wondering why every tile says "X-User-Id header is
    // required". The earlier bug was an interaction between polling
    // ticks and a stale module-mirror token; this guard handles any
    // future race the same way: if the server says we're unauthenticated,
    // trust it and reauth.
    if (status === 401 && typeof window !== 'undefined') {
      try {
        const hadStored = !!readStoredToken()
        // Don't tear down a freshly-loaded session on a single 401 — that
        // tends to be a transient race during startup. Only force logout
        // when a 401 arrives after the user was actively using the app.
        if (authToken || hadStored) {
          setAuthToken(null)
          try { localStorage.removeItem(AUTH_KEY) } catch { /* ignore */ }
          // Defer to the next tick so the rejection still reaches any
          // inline catch blocks (toast.error, etc) before navigation.
          queueMicrotask(() => {
            try {
              const next = window.location.pathname + window.location.search
              window.location.assign(
                next !== '/login' && next !== '/accept-invite' && !next.startsWith('/forgot-password') && !next.startsWith('/reset-password')
                  ? `/login?next=${encodeURIComponent(next)}`
                  : '/login',
              )
            } catch { /* ignore navigation errors */ }
          })
        }
      } catch { /* ignore */ }
    }

    return Promise.reject(Object.assign(new Error(message), {
      status,
      code: err?.response?.data?.code,
      cause: err,
    }))
  },
)

export { client as httpClient }
