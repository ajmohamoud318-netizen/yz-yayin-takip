import { Suspense, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Menu } from 'lucide-react'

import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import RouteFallback from '@/components/RouteFallback'
import { Button } from '@/components/ui/button'
import Sidebar from '@/components/Sidebar'
import TopbarSearch from '@/components/TopbarSearch'
import RolePrimaryCta from '@/components/RolePrimaryCta'
import NotificationBell from '@/components/NotificationBell'
import UserMenu from '@/components/UserMenu'
import Breadcrumb from '@/components/Breadcrumb'
import { navGroups } from '@/components/navGroups'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import api, { canRequestHandover, ozalitLeaderApproved } from '@/api'
import { cn } from '@/lib/utils'
import NewProjectDialog from '@/components/NewProjectDialog'
import SetupSheet from '@/components/SetupSheet.jsx'
import CommandPalette from '@/components/CommandPalette.jsx'
import { isOrderAssignedToDesigner, ORDER_LEADER_ACTION_STEPS } from '@/domain/constants/orders'

const COLLAPSE_KEY = 'yz-sidebar-collapsed'

// Global ⌘K / Ctrl+K listener that pops the command palette. Bound once at
// module scope (rather than in AppShell's useEffect) because there's exactly
// one chrome in the app, the handler never needs to update, and we want it
// to fire even when no page has mounted yet — e.g. on the Login screen
// transition into the shell. The handler ignores keystrokes while the user
// is already typing in another input/textarea/contentEditable, so a real
// "Cmd+K inside a textarea" still pastes / cuts as the OS expects.
function useCommandPaletteHotkey(open) {
  useEffect(() => {
    function isTypingTarget(el) {
      if (!el) return false
      const tag = el.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
      )
    }
    function onKey(e) {
      const k = e.key?.toLowerCase()
      const mod = e.metaKey || e.ctrlKey
      if (mod && k === 'k') {
        if (isTypingTarget(e.target)) return
        e.preventDefault()
        open((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
}

/**
 * Layout used by every authenticated page. The sidebar can collapse to an
 * icon-only rail on desktop (state is remembered) and opens as a drawer on
 * mobile. Badges, pinned projects and the period widget use live data.
 */
export default function AppShell() {
  const { user, logout } = useAuth()
  const { projects } = useProjects()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false) // mobile drawer
  const [pendingOrders, setPendingOrders] = useState(0)    // team_leader: ORDER_LEADER_ACTION_STEPS
  const [printerOrders, setPrinterOrders] = useState(0)   // printer: matbaa_ozalit_yapiyor
  const [designerOrders, setDesignerOrders] = useState(0) // designer: tasarimciya_atandi + kontroller_tamam (for their projects)
  const [pendingHandovers, setPendingHandovers] = useState(0) // satis: teslim onay bekleyen
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const location = useLocation()
  useCommandPaletteHotkey(setPaletteOpen)

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const counts = useMemo(() => {
    const role = user?.role
    let active = 0
    let demoApprovals = 0
    let ozalitApprovals = 0
    let production = 0
    let satista = 0
    let myProjects = 0
    let urgent = 0
    let handoverEligible = 0
    let designerOzalitApprovals = 0
    let baskiOnayApprovals = 0
    for (const p of projects) {
      if (p.stage !== 'satista') active++
      else satista++
      // Printer queue = incoming teslim; leader queue = pending onay.
      if (role === 'printer') {
        if (p.type === 'TR' && p.stage === 'demo_teslim') demoApprovals++
        if (p.type === 'TR' && p.stage === 'ozalit_teslim' && (p.ozalit_requested || p.reject_target === 'matbaa')) ozalitApprovals++
      } else if (role === 'team_leader') {
        // A held demo has no pending approval action — exclude it from the count.
        if ((p.stage === 'demo_onay' || p.stage === 'cin_demo_onay') && p.demo_held !== true) demoApprovals++
        if (p.stage === 'ozalit_onay') ozalitApprovals++
        if (p.stage === 'baski_onay' || p.stage === 'cin_baski_onay') baskiOnayApprovals++
      }
      if (p.stage === 'baskida' || p.stage === 'gumruk') production++
      if (role === 'printer' && canRequestHandover(p)) handoverEligible++
      if (role === 'designer' && (p.assignees ?? []).some((a) => a.id === user?.id)) myProjects++
      // Designer's pending ozalit approvals: assigned, at ozalit_onay, a team
      // leader has already signed off (approval is leader-first, so before that
      // there is nothing they can do), and they haven't approved yet.
      if (role === 'designer' && p.stage === 'ozalit_onay' &&
          (p.assignees ?? []).some((a) => a.id === user?.id) &&
          ozalitLeaderApproved(p) &&
          !(p.ozalit_approvals ?? []).some((a) => a.id === user?.id)) {
        designerOzalitApprovals++
      }
      if ((p.demo_attempt ?? 0) >= 2 || (p.ozalit_attempt ?? 0) >= 2) urgent++
    }
    return { active, demoApprovals, ozalitApprovals, baskiOnayApprovals, production, satista, total: projects.length, myProjects, urgent, handoverEligible, designerOzalitApprovals }
  }, [projects, user?.role, user?.id])

  const pinned = useMemo(
    () =>
      [...projects]
        .filter((p) => p.stage !== 'satista')
        .sort((a, b) => (b.demo_attempt ?? 0) - (a.demo_attempt ?? 0))
        .slice(0, 3),
    [projects],
  )

  const groups = navGroups(user?.role, counts, pendingOrders, printerOrders, designerOrders, pendingHandovers)

  useEffect(() => {
    const role = user?.role
    if (!role) return
    api.listOrderRequests().then((orders) => {
      // Sidebar badge counts. (The notification bell no longer derives from
      // this list — it reads the server-backed feed via useNotifications.)
      if (role === 'team_leader') {
        setPendingOrders(orders.filter((o) => ORDER_LEADER_ACTION_STEPS.has(o.status)).length)
      } else if (role === 'printer') {
        setPrinterOrders(orders.filter((o) => o.status === 'matbaa_ozalit_yapiyor').length)
      } else if (role === 'designer') {
        // Orders assigned to this designer. Must match /siparis-onay's filter
        // exactly — a badge counting differently than the page it points at is
        // how "3 bekliyor" ends up opening an empty list (or vice versa).
        const myIds = new Set(projects.filter((p) => (p.assignees ?? []).some((a) => a.id === user.id)).map((p) => p.id))
        setDesignerOrders(orders.filter((o) => {
          if (!isOrderAssignedToDesigner(o, user.id, myIds)) return false
          if (o.status === 'tasarimciya_atandi' || o.status === 'kontroller_tamam') return true
          if (o.status === 'imza_bekleniyor') {
            return !(o.matbaa_approvals ?? []).some((a) => a.id === user.id)
          }
          return false
        }).length)
      }
    }).catch(() => {})

    if (role === 'satis') {
      api.listHandovers()
        .then((hs) => setPendingHandovers(hs.filter((h) => h.status === 'atama_bekleniyor').length))
        .catch(() => {})
    }
  }, [user?.role, user?.id, projects])

  // Apply Utter Butter font for designer + team_leader roles.
  useEffect(() => {
    const creative = user?.role === 'designer' || user?.role === 'team_leader'
    document.documentElement.classList.toggle('font-creative', creative)
    return () => document.documentElement.classList.remove('font-creative')
  }, [user?.role])

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Skip link — keyboard/screen-reader users skip the entire sidebar */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
      >
        İçeriğe atla
      </a>

      {/* Desktop sidebar — wider on huge screens so the rail doesn't feel cramped */}
      <aside
        className={cn(
          // `md:` (not `lg:`) closes the 768–1023 px dead zone where the
          // sidebar was hidden but the topbar menu button (also `lg:hidden`)
          // was hidden too — leaving the user with zero nav on tablets.
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-background transition-[width] duration-200 ease-out md:flex print:hidden',
          collapsed
            ? 'w-[4.25rem]'
            : 'w-64 2xl:w-72 3xl:w-80',
        )}
      >
        <Sidebar
          collapsed={collapsed}
          groups={groups}
          pinned={pinned}
          counts={counts}
          user={user}
          onLogout={handleLogout}
          onToggleCollapsed={toggleCollapsed}
          onOpenProject={(id) => navigate(`/projects/${id}`)}
        />
      </aside>

      {/* Mobile drawer (always expanded). showCloseButton={false} hides the
          shadcn default X — the drawer already closes via backdrop tap, the
          <Menu /> button toggle, and the onNavigate handler on every link. */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-[min(20rem,calc(100vw-3rem))] p-0 sm:w-72">
          {/* The drawer spans the full screen height, so on a notched iPhone
              the logo would sit under the status bar and the user/logout row
              under the home indicator. Only visible once installed to the Home
              Screen — in a browser tab the chrome covers those bands. */}
          <div
            className="flex h-full flex-col"
            style={{ paddingTop: 'var(--safe-top, 0px)', paddingBottom: 'var(--safe-bottom, 0px)' }}
          >
            <Sidebar
              collapsed={false}
              groups={groups}
              pinned={pinned}
              counts={counts}
              user={user}
              onLogout={handleLogout}
              onNavigate={() => setOpen(false)}
              onToggleCollapsed={() => setOpen(false)}
              onOpenProject={(id) => navigate(`/projects/${id}`)}
            />
          </div>
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — wider gutters on huge screens to keep the search/CTA from feeling stranded.
            min-h, NOT h: with border-box sizing a fixed `h-14` is the whole box,
            so the safe-area padding below would eat the content band instead of
            growing the bar — the menu button and search then render *inside* the
            iOS status bar once installed to the Home Screen. min-height lets the
            inset add to the 3.5rem instead of carving it up. */}
        <header
          className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur sm:px-4 lg:px-6 2xl:px-8 3xl:px-12 print:hidden"
          style={{ paddingTop: 'max(0px, var(--safe-top, 0px))' }}
        >
          {/* Left — mobile menu + greeting */}
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              // Same `md:` swap as the desktop sidebar: keep the drawer
              // trigger visible on the tablet range so users always have
              // exactly one of {sidebar, drawer} open.
              className="md:hidden"
              onClick={() => setOpen(true)}
              aria-label="Menüyü açın"
            >
              <Menu className="h-5 w-5" />
            </Button>
            {/* Greeting + page breadcrumb. The greeting is the warm tone, the
                breadcrumb is the navigation anchor — keeping them next to each
                other in one flex row reads as one "you-are-here" signal. */}
            <span className="hidden text-base sm:block">
              Merhaba, <strong>{user?.name?.split(' ')[0]}</strong>!
            </span>
            <span className="hidden text-sm text-muted-foreground sm:inline">·</span>
            <Breadcrumb pathname={location.pathname} />
          </div>

          {/* Center — search */}
          <div className="flex flex-1 justify-center px-2">
            <TopbarSearch onOpen={() => setPaletteOpen(true)} />
          </div>

          {/* Right — actions */}
          <div className="flex shrink-0 items-center gap-2">
            <RolePrimaryCta role={user?.role} onNewProject={() => setNewProjectOpen(true)} />
            <NotificationBell />
            <UserMenu user={user} onLogout={handleLogout} />
          </div>
        </header>

        {/* The bottom padding carries the safe-area inset: without it the last
            row of every list sits under the iPhone's home indicator once the
            app is installed to the Home Screen (there is no browser chrome
            below the page to absorb it). The header does the same for the
            notch at the top. */}
        <main
          key={location.pathname}
          id="main-content"
          tabIndex={-1}
          className="page-enter min-w-0 flex-1 px-3 py-4 pb-[calc(1rem+var(--safe-bottom,0px))] sm:px-4 sm:py-6 sm:pb-[calc(1.5rem+var(--safe-bottom,0px))] lg:px-8 2xl:px-10 3xl:px-16 print:p-0"
        >
          {/* Suspense wraps the matched route so the AppShell chrome
              (sidebar + topbar + skip link) stays visible while the
              lazy-loaded chunk fetches. The fallback mimics the page's
              own shape (eyebrow + h1 + content card) so the swap from
              skeleton to real content doesn't shift the layout. */}
          <Suspense fallback={<RouteFallback />} key={location.pathname}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        // Drop the leader straight onto the project they just created —
        // their first job is to fill in the spec (Ürün Bilgileri) and
        // assign work, and that's where ProjectDetail lands them. Without
        // this they would stay on whichever page the + button was pressed
        // on (usually the dashboard or year-plan) and have to hunt the new
        // row down in the list.
        onCreated={(project) => navigate(`/projects/${project.id}`)}
      />

      {/* Install + notification opt-in, offered on open instead of hidden in
          the bell dropdown. Self-hiding once both are done — see SetupSheet. */}
      <SetupSheet />

      {/* ⌘K command palette — filters in-memory projects and offers quick
          nav. Mounted last so its dialog portal sits above every other
          overlay (SetupSheet, NewProjectDialog, bell dropdown). */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}