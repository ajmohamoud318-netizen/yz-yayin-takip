import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './hooks/useAuth.js'
import { ProjectsProvider } from './hooks/useProjectsStore.jsx'
import { NotificationsProvider } from './hooks/useNotifications.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initPwaInstall } from './hooks/usePwaInstall.js'
import './index.css'

/**
 * Capture the install prompt before React mounts. Chrome fires
 * `beforeinstallprompt` once, very early, and only a preventDefault()'d event
 * can be replayed later from our own UI (see SetupSheet).
 */
initPwaInstall()

/**
 * Register the push service worker.
 *
 * Registered unconditionally at boot (not on the permission toggle) because
 * `navigator.serviceWorker.ready` must already resolve by the time the user
 * clicks — and on iOS the registration has to predate the permission prompt
 * or subscribe() throws.
 *
 * Dev is excluded: Vite serves modules unbundled and a stale worker from a
 * previous session interferes with HMR. Push is verified against a real build.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      // Non-fatal: the SPA works fine without push, notifications just stay
      // in-app. Logged rather than surfaced so it doesn't alarm users.
      // eslint-disable-next-line no-console
      console.warn('[push] service worker registration failed:', err?.message)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <NotificationsProvider>
            <ProjectsProvider>
              <App />
            </ProjectsProvider>
          </NotificationsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
