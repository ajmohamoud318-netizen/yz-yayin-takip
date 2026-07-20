import { createContext, useContext, useState, useCallback, useEffect, createElement } from 'react'
import api, { setAuthToken } from '../api.js'
import { USE_MOCK } from '../infrastructure/config.js'

/**
 * Auth state for the whole app. While the backend is mocked, the session is
 * persisted to localStorage so a page refresh keeps the user signed in.
 * (When the real httpOnly-cookie backend lands, this can drop back to memory.)
 */
const AuthContext = createContext(null)
const AUTH_KEY = 'yz_auth_v1'

function loadAuth() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => loadAuth()?.user ?? null)
  const [loading, setLoading] = useState(false)

  // Restore the auth header on first load if a session was saved.
  //
  // Defensive guard: if the SPA was booted in mock mode previously, the
  // cached token has the form `mock-<id>` which the real Fastify backend
  // rejects as "Unknown user" — leaving the UI silently signed-in-but-
  // unable-to-talk. Drop those tokens here so the user is forced to log
  // in once against the live backend and gets a real `u-…` token back.
  useEffect(() => {
    const saved = loadAuth()
    if (!saved?.token) return
    if (!USE_MOCK && saved.token.startsWith('mock-')) {
      try { localStorage.removeItem(AUTH_KEY) } catch { /* ignore */ }
      return
    }
    setAuthToken(saved.token)
  }, [])

  const login = useCallback(async (email, password) => {
    setLoading(true)
    try {
      const { token, user: u } = await api.login(email, password)
      setAuthToken(token)
      setUser(u)
      try {
        localStorage.setItem(AUTH_KEY, JSON.stringify({ token, user: u }))
      } catch {
        /* ignore storage errors */
      }
      return u
    } finally {
      setLoading(false)
    }
  }, [])

  // Dev-only "log in as" — uses the backend's /auth/dev-login endpoint
  // so the SPA can drive the real backend without going through bcrypt.
  const loginAsUser = useCallback(async (userId) => {
    setLoading(true)
    try {
      const { token, user: u } = await api.loginAsUser(userId)
      setAuthToken(token)
      setUser(u)
      try {
        localStorage.setItem(AUTH_KEY, JSON.stringify({ token, user: u }))
      } catch {
        /* ignore storage errors */
      }
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
          localStorage.setItem(AUTH_KEY, JSON.stringify({ token: saved.token, user: next }))
        }
      } catch {
        /* ignore storage errors */
      }
      return next
    })
  }, [])

  const value = { user, loading, login, loginAsUser, logout, updateUser, isAuthenticated: !!user }

  // JSX is avoided here so the file can stay .js; createElement keeps it simple.
  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
