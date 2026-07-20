import { createContext, useContext, useState, useCallback, useEffect, createElement } from 'react'
import api from '../api.js'

/**
 * Auth state for the whole app.
 *
 * Auth lives in an httpOnly cookie set by the server. The browser sends
 * the cookie automatically on every /api/* request; we never see the
 * cookie value in JS. What we DO cache in localStorage is the user
 * object — purely a UX hint so the SPA can render the avatar / role
 * before the /auth/me round-trip completes on cold load. It is wiped
 * on logout and on a 401 response.
 */
const AuthContext = createContext(null)
const AUTH_CACHE_KEY = 'yz_user_cache_v1'

function loadUserCache() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveUserCache(user) {
  if (typeof localStorage === 'undefined') return
  try {
    if (user) localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(user))
    else localStorage.removeItem(AUTH_CACHE_KEY)
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => loadUserCache())
  const [loading, setLoading] = useState(true)

  // On first mount, ask the server "who am I?". If the yz_sid cookie
  // is present and valid, we get the user back. Otherwise the request
  // 401s and we stay signed-out. The cached user from localStorage is
  // shown optimistically while this resolves — and replaced when the
  // server response comes back, so a stale cache can't keep us signed
  // in past session expiry.
  useEffect(() => {
    let cancelled = false
    api.me()
      .then(({ user: u }) => {
        if (cancelled) return
        setUser(u)
        saveUserCache(u)
      })
      .catch(() => {
        if (cancelled) return
        setUser(null)
        saveUserCache(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  /**
   * Request a magic-link email. Resolves with `{ ok: true }` whether
   * or not the email matched — the server intentionally swallows that
   * distinction so attackers can't enumerate accounts. The caller (the
   * Login page) tells the user to check their inbox regardless.
   */
  const login = useCallback(async (email) => {
    setLoading(true)
    try {
      await api.login(email)
      return { ok: true }
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Dev-only "log in as". Uses the backend's /auth/dev-login endpoint,
   * which creates a real session + cookie so the rest of the app is
   * indistinguishable from a magic-link sign-in. Gated by
   * NODE_ENV !== 'production' on the server.
   */
  const loginAsUser = useCallback(async (userId) => {
    setLoading(true)
    try {
      const { user: u } = await api.loginAsUser(userId)
      setUser(u)
      saveUserCache(u)
      return u
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Logout — destroys the server session + clears the cookie. The
   * user-cache key in localStorage also goes away so a hot reload
   * doesn't re-render the dashboard for a logged-out user.
   */
  const logout = useCallback(async () => {
    await api.logout()
    setUser(null)
    saveUserCache(null)
  }, [])

  /**
   * Patch the cached user object (no server round-trip). Used by
   * Settings after an avatar upload / delete so the new photo shows
   * up everywhere in the same session.
   */
  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      if (!prev) return prev
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
      saveUserCache(next)
      return next
    })
  }, [])

  /**
   * Force-set the user (used by /auth/magic after the server has set
   * the session cookie via its 302 redirect). Lets the dashboard
   * render immediately without waiting for a second /me round-trip.
   */
  const refresh = useCallback((u) => {
    setUser(u ?? null)
    saveUserCache(u ?? null)
  }, [])

  const value = { user, loading, login, loginAsUser, logout, updateUser, isAuthenticated: !!user, refresh }

  // JSX is avoided here so the file can stay .js; createElement keeps it simple.
  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}