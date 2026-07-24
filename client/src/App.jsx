import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'

import { useAuth } from './hooks/useAuth.js'
import { ProjectModalProvider } from './hooks/useProjectModal.jsx'
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
const Kanban              = lazy(() => import('./pages/Kanban.jsx'))
const Approvals           = lazy(() => import('./pages/Approvals.jsx'))
const AcceptInvite        = lazy(() => import('./pages/AcceptInvite.jsx'))
const ForgotPassword      = lazy(() => import('./pages/ForgotPassword.jsx'))
const ResetPassword       = lazy(() => import('./pages/ResetPassword.jsx'))
const MyProjects          = lazy(() => import('./pages/MyProjects.jsx'))
const Documents           = lazy(() => import('./pages/Documents.jsx'))
const BaskiListesi        = lazy(() => import('./pages/BaskiListesi.jsx'))
const UrunBilgileri       = lazy(() => import('./pages/UrunBilgileri.jsx'))
const Urunler             = lazy(() => import('./pages/Urunler.jsx'))
const SiparisListesi      = lazy(() => import('./pages/SiparisListesi.jsx'))
const SiparisTalepleri    = lazy(() => import('./pages/SiparisTalepleri.jsx'))
const SiparisOnay         = lazy(() => import('./pages/SiparisOnay.jsx'))
const TeslimTalepleri     = lazy(() => import('./pages/TeslimTalepleri.jsx'))
const TeslimOnaylari      = lazy(() => import('./pages/TeslimOnaylari.jsx'))
const UretimeHazir        = lazy(() => import('./pages/UretimeHazir.jsx'))
const Settings            = lazy(() => import('./pages/Settings.jsx'))
import NotificationSync from './components/NotificationSync.jsx'
import { CelebrationProvider } from './hooks/useCelebration.jsx'
/* RouteFallback lives in its own module to avoid the AppShell↔App.jsx
   circular import (AppShell wraps <Outlet /> in <Suspense fallback=…>,
   and the fallback component itself must not live in either file). */

function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
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
        <ProjectModalProvider>
          <NotificationSync />
          <Routes>


          <Route path="/login" element={<Login />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

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
              path="/approvals"
              element={<Navigate to="/approvals/demo" replace />}
            />
            <Route
              path="/approvals/demo"
              element={
                <RoleGuard allow={['printer', 'team_leader', 'designer']}>
                  <Approvals tab="demo" />
                </RoleGuard>
              }
            />
            <Route
              path="/approvals/ozalit"
              element={
                <RoleGuard allow={['printer', 'team_leader', 'designer']}>
                  <Approvals tab="ozalit" />
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
              path="/my-projects"
              element={
                <RoleGuard allow={['designer']}>
                  <MyProjects />
                </RoleGuard>
              }
            />
            <Route path="/documents" element={<Documents />} />
            <Route path="/baski-listesi" element={<BaskiListesi />} />
            <Route path="/urunler" element={<Urunler />} />
            <Route
              path="/urun-bilgileri"
              element={
                <RoleGuard allow={['team_leader', 'designer']}>
                  <UrunBilgileri />
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
              path="/uretime-hazir"
              element={
                <RoleGuard allow={['printer']}>
                  <UretimeHazir />
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
          </ProjectModalProvider>
      </CelebrationProvider>
    </TooltipProvider>
  )
}
