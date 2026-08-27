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
 * Recover from a stale chunk reference after a deploy.
 *
 * Every deploy rebuilds the client with fresh content-hashed filenames and
 * replaces the previous build's files outright (see DEPLOY.md — single
 * container swap, no overlap window for the old assets). A tab that loaded
 * index.html moments before a new deploy landed can still hold references to
 * chunk files that no longer exist on the server; the next React.lazy()
 * route the user opens then 404s instead of rendering. Vite fires
 * `vite:preloadError` for exactly this case in production builds, so we
 * recover by reloading once — that re-fetches the current index.html and a
 * chunk set that's internally consistent again. Guarded with sessionStorage
 * so a genuinely broken deploy causes one reload, not a refresh loop.
 */
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const key = 'yz:preload-reload-at'
  const last = Number(sessionStorage.getItem(key) || 0)
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem(key, String(Date.now()))
    window.location.reload()
  }
})

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
