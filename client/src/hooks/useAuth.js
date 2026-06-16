import { createContext, useContext, useState, useCallback, useEffect, createElement } from 'react'
import api, { setAuthToken } from '../api.js'

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
  useEffect(() => {
    const saved = loadAuth()
    if (saved?.token) setAuthToken(saved.token)
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

  const value = { user, loading, login, logout, isAuthenticated: !!user }

  // JSX is avoided here so the file can stay .js; createElement keeps it simple.
  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
