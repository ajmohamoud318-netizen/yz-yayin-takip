import { Routes, Route, Navigate, useLocation } from 'react-router-dom'

import { useAuth } from './hooks/useAuth.js'
import { ProjectModalProvider } from './hooks/useProjectModal.jsx'
import { TooltipProvider } from './components/ui/tooltip.jsx'
import AppShell from './components/AppShell.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import ProjectDetail from './pages/ProjectDetail.jsx'
import AllProjects from './pages/AllProjects.jsx'
import YearPlan from './pages/YearPlan.jsx'
import DemoRequests from './pages/DemoRequests.jsx'
import Team from './pages/Team.jsx'
import Kanban from './pages/Kanban.jsx'
import Approvals from './pages/Approvals.jsx'
import AcceptInvite from './pages/AcceptInvite.jsx'
import MyProjects from './pages/MyProjects.jsx'
import Documents from './pages/Documents.jsx'
import BaskiListesi from './pages/BaskiListesi.jsx'
import UrunBilgileri from './pages/UrunBilgileri.jsx'
import SiparisListesi from './pages/SiparisListesi.jsx'
import SiparisTalepleri from './pages/SiparisTalepleri.jsx'
import SiparisOnay from './pages/SiparisOnay.jsx'
import NotificationSync from './components/NotificationSync.jsx'
import { CelebrationProvider } from './hooks/useCelebration.jsx'

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
  if (user?.role === 'satis') return <Navigate to="/siparis-talebi" replace />
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
          <Route
            path="/urun-bilgileri"
            element={
              <RoleGuard allow={['team_leader']}>
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
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ProjectModalProvider>
      </CelebrationProvider>
    </TooltipProvider>
  )
}
