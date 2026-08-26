import axios from 'axios'

// API base URL resolution — SAME-ORIGIN BY DEFAULT.
//
// Both runtimes proxy `/api/*` to the Fastify backend, so a relative
// base works everywhere and is the preferred configuration:
//   - dev:  Vite's proxy (client/vite.config.js) → http://localhost:4000
//   - prod: serve.cjs's reverse proxy            → API_UPSTREAM (internal net)
//
// Same-origin matters for more than tidiness: the session lives in an
// httpOnly cookie with SameSite=lax. If the SPA and the API sit on
// different registrable domains (e.g. yt.mucitkarinca.com → *.sslip.io)
// the browser will neither store the cookie from /auth/login nor send it
// on /auth/me, and every request 401s. Leave VITE_API_BASE_URL unset and
// this problem cannot occur.
//
// VITE_API_BASE_URL remains an escape hatch for pointing the SPA at a
// backend on another host. Only use it when that host is same-site with
// the SPA (a sibling subdomain); otherwise the backend must also run
// SESSION_COOKIE_SAMESITE=none + SESSION_COOKIE_SECURE=true.
const envBase = import.meta.env?.VITE_API_BASE_URL?.trim()
const baseURL = envBase ? `${envBase.replace(/\/$/, '')}/api` : '/api'

/**
 * Origin of the backend, suitable for <img src> URLs. Strips the trailing
 * `/api` so callers can prepend their own path segments.
 *
 * In the default same-origin setup this is the EMPTY STRING, which is
 * correct and intentional: `${API_ORIGIN}/api/users/…` then yields a
 * root-relative URL the browser resolves against the SPA's own origin,
 * and the serve.cjs proxy forwards it. Consumers (UserAvatar) already
 * concatenate rather than parse, so no call site needs to change.
 */
export const API_ORIGIN = baseURL.replace(/\/api\/?$/, '')

const client = axios.create({
  baseURL,
  // A request that never settles is worse than one that fails outright.
  // Axios waits FOREVER by default, and an installed PWA relaunched from the
  // Home Screen routinely fires its first request while the radio is still
  // waking up — iOS neither completes nor rejects that connection. Without a
  // ceiling, `GET /auth/me` hangs, `bootstrapping` never flips false,
  // <RequireAuth> keeps rendering null, and the user stares at a blank screen
  // until they force-quit the app and reopen it (the exact "I have to close
  // it and come back" report). 20 s clears a slow-but-working mobile round
  // trip and still fails fast enough to show a real error.
  //
  // Long uploads opt out per-request (see uploadAvatar's `timeout: 0`).
  timeout: 20_000,
  // Send the httpOnly session cookie on every request. A no-op for the
  // default same-origin setup (where cookies are sent anyway), but kept
  // so the VITE_API_BASE_URL escape hatch still works cross-origin — the
  // API echoes Access-Control-Allow-Credentials: true for allowlisted
  // origins.
  withCredentials: true,
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
    // An AbortController-triggered cancel (the chip grid uses this to drop a
    // stale PATCH when the user clicks again before the first answer lands)
    // has no server-side meaning — it isn't an offline event, isn't a 401,
    // and isn't a toast-worthy failure. Pass it through untouched so the
    // caller's catch can branch on `err.name === 'CanceledError'` without
    // first having to undo the wrapping below.
    if (err?.name === 'CanceledError' || axios.isCancel(err)) {
      return Promise.reject(err)
    }
    const status = err?.response?.status
    // No `response` at all means the request never reached the API: timed out,
    // offline, radio still waking after a PWA relaunch, proxy down. Axios's own
    // wording for these ("timeout of 20000ms exceeded", "Network Error") is
    // English and reads like a crash, so it gets replaced before it can reach a
    // toast or an error card.
    const offline = !err?.response
    const message = offline
      ? 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.'
      : err?.response?.data?.error ?? err?.response?.data?.message ?? err.message

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
      // `offline: true` = the API never answered, so nothing about the
      // session can be inferred. Callers that would otherwise treat a
      // failure as "signed out" (AuthProvider) check this before tearing
      // anything down.
      offline,
      code: err?.response?.data?.code,
      cause: err,
    }))
  },
)

export { client as httpClient }
