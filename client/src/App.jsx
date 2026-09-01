import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { useAuth } from './hooks/useAuth.js'
import { TooltipProvider } from './components/ui/tooltip.jsx'
import AppShell from './components/AppShell.jsx'
// Above-the-fold routes stay eager; the rest are code-split.
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
const ProjectDetail       = lazy(() => import('./pages/ProjectDetail.jsx'))
const AllProjects         = lazy(() => import('./pages/AllProjects.jsx'))
const YearPlan            = lazy(() => import('./pages/YearPlan.jsx'))
const DemoRequests        = lazy(() => import('./pages/DemoRequests.jsx'))
const Team                = lazy(() => import('./pages/Team.jsx'))
const DeletedProjects     = lazy(() => import('./pages/DeletedProjects.jsx'))
const Kanban              = lazy(() => import('./pages/Kanban.jsx'))
const Approvals           = lazy(() => import('./pages/Approvals.jsx'))
const AcceptInvite        = lazy(() => import('./pages/AcceptInvite.jsx'))
const ForgotPassword      = lazy(() => import('./pages/ForgotPassword.jsx'))
const ResetPassword       = lazy(() => import('./pages/ResetPassword.jsx'))
const MyProjects          = lazy(() => import('./pages/MyProjects.jsx'))
const Documents           = lazy(() => import('./pages/Documents.jsx'))
const BaskiListesi        = lazy(() => import('./pages/BaskiListesi.jsx'))
const HedefProjeler       = lazy(() => import('./pages/HedefProjeler.jsx'))
const Toplanti            = lazy(() => import('./pages/Toplanti.jsx'))
const UrunBilgileri       = lazy(() => import('./pages/UrunBilgileri.jsx'))
const BaskiReceteleri     = lazy(() => import('./pages/BaskiReceteleri.jsx'))
const Urunler             = lazy(() => import('./pages/Urunler.jsx'))
const SiparisListesi      = lazy(() => import('./pages/SiparisListesi.jsx'))
const SiparisTalepleri    = lazy(() => import('./pages/SiparisTalepleri.jsx'))
const SiparisOnay         = lazy(() => import('./pages/SiparisOnay.jsx'))
const TeslimTalepleri     = lazy(() => import('./pages/TeslimTalepleri.jsx'))
const TeslimOnaylari      = lazy(() => import('./pages/TeslimOnaylari.jsx'))
const Settings            = lazy(() => import('./pages/Settings.jsx'))
const MatbaaIsleri        = lazy(() => import('./pages/MatbaaIsleri.jsx'))
import NotificationSync from './components/NotificationSync.jsx'
import PushBridge from './components/PushBridge.jsx'
import { CelebrationProvider } from './hooks/useCelebration.jsx'
import RouteFallback from './components/RouteFallback.jsx'
/* RouteFallback lives in its own module to avoid the AppShell↔App.jsx
   circular import (AppShell wraps <Outlet /> in <Suspense fallback=…>,
   and the fallback component itself must not live in either file). */

/**
 * Shown only while the cookie session is being checked and there's nothing
 * cached to render optimistically. This used to be a bare `null`, which on a
 * warm reload is invisible — but a cold launch from the Home Screen goes
 * straight from the iOS splash into a white void for as long as `/auth/me`
 * takes, and a white void reads as a crashed app. A spinner on the app's own
 * background says "connecting", which is the truth.
 */
function AuthSplash() {
  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center bg-background"
      role="status"
      aria-live="polite"
      aria-label="Oturum kontrol ediliyor"
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
    </div>
  )
}

function RequireAuth({ children }) {
  const { isAuthenticated, bootstrapping } = useAuth()
  const location = useLocation()
  // While the initial cookie-session check is in flight and we have no
  // cached user yet, hold rather than bouncing to /login — a valid httpOnly
  // session may be about to rehydrate us.
  if (!isAuthenticated && bootstrapping) return <AuthSplash />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  return children
}

function RoleGuard({ allow, children }) {
  const { user } = useAuth()
  if (allow && !allow.includes(user?.role)) {
    return <Navigate to="/" replace />
  }
  return children
}

function HomeRedirect() {
  const { user } = useAuth()
  if (user?.role === 'satis') return <Navigate to="/urunler" replace />
  return <Dashboard />
}

export default function App() {
  return (
    <TooltipProvider delayDuration={150}>
      <CelebrationProvider>
          <NotificationSync />
          <PushBridge />
          <Routes>


          <Route path="/login" element={<Login />} />
          <Route
            path="/accept-invite"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AcceptInvite />
              </Suspense>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <Suspense fallback={<RouteFallback />}>
                <ForgotPassword />
              </Suspense>
            }
          />
          <Route
            path="/reset-password"
            element={
              <Suspense fallback={<RouteFallback />}>
                <ResetPassword />
              </Suspense>
            }
          />

          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/projects" element={<AllProjects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/plan" element={<YearPlan />} />
            <Route
              path="/demo"
              element={
                <RoleGuard allow={['designer', 'team_leader']}>
                  <DemoRequests />
                </RoleGuard>
              }
            />
            <Route path="/kanban" element={<Kanban />} />
            <Route
              path="/team"
              element={
                <RoleGuard allow={['team_leader']}>
                  <Team />
                </RoleGuard>
              }
            />
            <Route
              path="/deleted-projects"
              element={
                <RoleGuard allow={['team_leader']}>
                  <DeletedProjects />
                </RoleGuard>
              }
            />
            <Route
              path="/approvals"
              element={<Navigate to="/approvals/demo" replace />}
            />
            <Route
              path="/approvals/demo"
              element={
                <RoleGuard allow={['printer', 'team_leader']}>
                  <Approvals tab="demo" />
                </RoleGuard>
              }
            />
            <Route
              path="/approvals/ozalit"
              element={
                <RoleGuard allow={['printer', 'team_leader']}>
                  <Approvals tab="ozalit" />
                </RoleGuard>
              }
            />
            <Route
              path="/approvals/baski-onay"
              element={
                <RoleGuard allow={['team_leader']}>
                  <Approvals tab="baski-onay" />
                </RoleGuard>
              }
            />
            <Route
              path="/approvals/siparis"
              element={
                <RoleGuard allow={['printer']}>
                  <Approvals tab="siparis" />
                </RoleGuard>
              }
            />
            <Route
              path="/matbaa-isleri"
              element={
                <RoleGuard allow={['printer']}>
                  <Suspense fallback={<RouteFallback />}>
                    <MatbaaIsleri />
                  </Suspense>
                </RoleGuard>
              }
            />
            <Route
              path="/my-projects"
              element={
                <RoleGuard allow={['designer']}>
                  <MyProjects />
                </RoleGuard>
              }
            />
            <Route path="/documents" element={<Documents />} />
            <Route path="/baski-listesi" element={<BaskiListesi />} />
            <Route
              path="/hedef-projeler"
              element={
                <RoleGuard allow={['team_leader', 'designer']}>
                  <HedefProjeler />
                </RoleGuard>
              }
            />
            <Route
              path="/toplanti"
              element={
                <RoleGuard allow={['team_leader', 'designer', 'printer']}>
                  <Toplanti />
                </RoleGuard>
              }
            />
            <Route
              path="/urunler"
              element={
                <RoleGuard allow={['satis', 'team_leader']}>
                  <Urunler />
                </RoleGuard>
              }
            />
            <Route
              path="/urun-bilgileri"
              element={
                <RoleGuard allow={['team_leader']}>
                  <UrunBilgileri />
                </RoleGuard>
              }
            />
            <Route
              path="/baski-receteleri"
              element={
                <RoleGuard allow={['team_leader', 'designer']}>
                  <BaskiReceteleri />
                </RoleGuard>
              }
            />
            <Route
              path="/siparis-talebi"
              element={
                <RoleGuard allow={['satis']}>
                  <SiparisListesi />
                </RoleGuard>
              }
            />
            <Route
              path="/siparis-talepleri"
              element={
                <RoleGuard allow={['team_leader']}>
                  <SiparisTalepleri />
                </RoleGuard>
              }
            />
            <Route
              path="/siparis-onay"
              element={
                <RoleGuard allow={['designer']}>
                  <SiparisOnay />
                </RoleGuard>
              }
            />
            <Route
              path="/teslim-talepleri"
              element={
                <RoleGuard allow={['printer']}>
                  <TeslimTalepleri />
                </RoleGuard>
              }
            />
            <Route
              path="/teslim-onaylari"
              element={
                <RoleGuard allow={['satis']}>
                  <TeslimOnaylari />
                </RoleGuard>
              }
            />
            <Route path="/settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />

            </Routes>
      </CelebrationProvider>
    </TooltipProvider>
  )
}
