import { createContext, useContext, useState, useCallback, useEffect, useRef, createElement } from 'react'
import api, { setAuthToken } from '../api.js'
import { useOnResume } from './useOnResume.js'

/**
 * Auth state for the whole app. The session is persisted to
 * localStorage so a page refresh keeps the user signed in. When the
 * real httpOnly-cookie backend lands, this can drop back to memory.
 */
const AuthContext = createContext(null)
const AUTH_KEY = 'yz_auth_v1'
const REMEMBER_DAYS = 30
// Extra attempts at GET /auth/me when the API can't be reached at all, and the
// base gap between them (multiplied by the attempt number: ~1.2s, then ~2.4s).
// Sized to cover a phone radio waking up on launch without making a genuinely
// offline start sit on a blank screen.
const OFFLINE_RETRIES = 2
const OFFLINE_RETRY_MS = 1_200
// Hard ceiling on how long the app may withhold UI waiting for that check.
// The retries above assume the fast-failure case; if the requests HANG instead
// (each burning the client's full 20s timeout) the same loop would sit on a
// splash screen for a minute. Past this point the app renders with whatever it
// has — cached user, or the login screen — while the check keeps running in the
// background and rehydrates the session if it eventually lands.
const BOOTSTRAP_MAX_MS = 6_000

function loadAuth() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    const saved = raw ? JSON.parse(raw) : null
    // "30 gün hatırla" sessions carry an expiry stamp — honour it.
    // Legacy sessions without one stay valid (they predate the stamp).
    if (saved?.expires_at && Date.parse(saved.expires_at) < Date.now()) {
      localStorage.removeItem(AUTH_KEY)
      return null
    }
    return saved
  } catch {
    return null
  }
}

/** Persist the session for REMEMBER_DAYS ("30 gün hatırla" ticked). */
function persistAuth(token, user) {
  try {
    const expires_at = new Date(Date.now() + REMEMBER_DAYS * 86400000).toISOString()
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token, user, expires_at }))
  } catch {
    /* ignore storage errors */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => loadAuth()?.user ?? null)
  const [loading, setLoading] = useState(false)
  // True until the initial cookie-session check resolves. The session now
  // lives in an httpOnly cookie the JS can't read, so on load we ask the
  // server who we are via GET /auth/me. Guards wait on this to avoid a
  // flash to /login when a valid cookie session exists but nothing is
  // cached in localStorage.
  const [bootstrapping, setBootstrapping] = useState(true)
  // Set when the session check couldn't reach the API at all. Distinct from
  // "not signed in": it means we still don't know, and should ask again the
  // moment the app is back in the foreground.
  const [sessionUnverified, setSessionUnverified] = useState(false)

  /**
   * Ask the server who we are.
   *
   * Failure handling is the load-bearing part. This used to clear the session
   * on ANY rejection, which quietly logged people out for reasons that had
   * nothing to do with their session: an installed PWA cold-launched from the
   * Home Screen fires this request before the radio is up, the request fails,
   * and the app lands on /login. Close it, reopen it, network is warm now, and
   * it works — which is exactly how the bug was reported.
   *
   * So only an explicit 401/403 from the API ends the session. A request that
   * never got an answer leaves the cached user in place and arms a retry.
   */
  const inFlightRef = useRef(false)
  const checkSession = useCallback(async () => {
    // Resume events overlap with the mount check and with each other; one
    // outstanding /auth/me is always enough.
    if (inFlightRef.current) return
    inFlightRef.current = true

    const saved = loadAuth()
    // Legacy header mirror — harmless in prod (server ignores it) and keeps
    // dev header-auth working while TRUST_HEADER_AUTH is on.
    if (saved?.token) setAuthToken(saved.token)

    try {
      // A cold PWA launch fails FAST (connection refused / "Network Error"
      // while the radio wakes), not slowly — and nobody backgrounds the app in
      // that first second, so no resume event is coming to trigger the retry
      // below. Retrying here, in place, is what turns that failure into a
      // half-second stutter instead of a trip to the login screen.
      for (let attempt = 0; ; attempt += 1) {
        try {
          const { user: u } = await api.me()
          setSessionUnverified(false)
          if (!u) return
          setUser(u)
          // Refresh the cached user for a remembered session without touching
          // its original expiry.
          if (saved?.token) {
            try {
              localStorage.setItem(
                AUTH_KEY,
                JSON.stringify({ token: saved.token, user: u, expires_at: saved.expires_at }),
              )
            } catch { /* ignore storage errors */ }
          }
          return
        } catch (e) {
          // The API answered "you are not signed in" — that's authoritative,
          // and retrying it would only produce the same answer. Drop any stale
          // cached user so the app shows the login screen rather than a
          // phantom session.
          if (e?.status === 401 || e?.status === 403) {
            setSessionUnverified(false)
            setUser(null)
            setAuthToken(null)
            try { localStorage.removeItem(AUTH_KEY) } catch { /* ignore */ }
            return
          }
          // Anything else (timeout, offline, 502 from the proxy) says nothing
          // about the session, so the cached user stays exactly where it is.
          if (attempt >= OFFLINE_RETRIES) {
            // Out of attempts: mark it unverified so the next foreground
            // rehydrates it, and let the app render with what it has.
            setSessionUnverified(true)
            return
          }
          await new Promise((r) => setTimeout(r, OFFLINE_RETRY_MS * (attempt + 1)))
        }
      }
    } finally {
      inFlightRef.current = false
      // Always drop the gate. Guards and ProjectsProvider wait on this, and a
      // dead network must not leave them waiting forever.
      setBootstrapping(false)
    }
  }, [])

  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    checkSession()
    const watchdog = setTimeout(() => setBootstrapping(false), BOOTSTRAP_MAX_MS)
    return () => clearTimeout(watchdog)
  }, [checkSession])

  // Retry an unverified session whenever the app is foregrounded again. This
  // is the recovery path for the cold-launch failure above: by the time the
  // user has looked at the screen, the network is usually up, and this
  // rehydrates them without the force-quit.
  useOnResume(() => {
    if (sessionUnverified) checkSession()
  })

  const login = useCallback(async (email, password, { remember = false } = {}) => {
    setLoading(true)
    try {
      const { token, user: u } = await api.login(email, password)
      setAuthToken(token)
      setUser(u)
      if (remember) {
        // "30 gün hatırla" ticked → keep the session for 30 days.
        persistAuth(token, u)
      } else {
        // Not ticked → memory-only session; also drop any previously
        // remembered session so it can't outlive this explicit choice.
        try {
          localStorage.removeItem(AUTH_KEY)
        } catch {
          /* ignore storage errors */
        }
      }
      return u
    } finally {
      setLoading(false)
    }
  }, [])

  const loginAsUser = useCallback(async (userId) => {
    setLoading(true)
    try {
      const { token, user: u } = await api.loginAsUser(userId)
      setAuthToken(token)
      setUser(u)
      persistAuth(token, u)
      return u
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    setAuthToken(null)
    setUser(null)
    try {
      localStorage.removeItem(AUTH_KEY)
    } catch {
      /* ignore storage errors */
    }
  }, [])

  /**
   * Patch the cached auth user (and its localStorage mirror) so the
   * rest of the app re-renders without a hard reload. Used by Settings
   * after an avatar upload / delete so the new photo shows up
   * everywhere in the same session.
   */
  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      if (!prev) return prev
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
      try {
        const saved = loadAuth()
        if (saved?.token) {
          // Preserve the original expiry — updating the avatar or name must
          // not silently extend (or drop) the 30-day session window.
          localStorage.setItem(
            AUTH_KEY,
            JSON.stringify({ token: saved.token, user: next, expires_at: saved.expires_at }),
          )
        }
      } catch {
        /* ignore storage errors */
      }
      return next
    })
  }, [])

  const value = { user, loading, bootstrapping, login, loginAsUser, logout, updateUser, isAuthenticated: !!user }

  // JSX is avoided here so the file can stay .js; createElement keeps it simple.
  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
