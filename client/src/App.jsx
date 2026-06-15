import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth.js'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'

/** Redirects to /login when there is no authenticated user. */
function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const { isAuthenticated } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      {/* Unknown routes fall back to the dashboard (or login via guard). */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
