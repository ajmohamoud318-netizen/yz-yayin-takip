import { createContext, useContext, useState, useCallback, createElement } from 'react'
import api, { setAuthToken } from '../api.js'

/**
 * Auth state for the whole app. Token + user are kept in memory only
 * (no localStorage — matches the httpOnly-cookie plan in CLAUDE.md).
 */
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)

  const login = useCallback(async (email, password) => {
    setLoading(true)
    try {
      const { token, user: u } = await api.login(email, password)
      setAuthToken(token)
      setUser(u)
      return u
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    setAuthToken(null)
    setUser(null)
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
