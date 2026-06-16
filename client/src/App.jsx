import { Toaster } from 'sonner'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'

import { useAuth } from './hooks/useAuth.js'
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
import NotificationSync from './components/NotificationSync.jsx'

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

export default function App() {
  return (
    <TooltipProvider delayDuration={150}>
      <Toaster richColors position="top-right" closeButton />
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
          <Route path="/" element={<Dashboard />} />
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
            element={
              <RoleGuard allow={['printer', 'team_leader']}>
                <Approvals />
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
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </TooltipProvider>
  )
}
