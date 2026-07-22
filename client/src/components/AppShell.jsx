import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Columns3,
  UsersRound,
  Plus,
  LogOut,
  ChevronDown,
  Search,
  Bell, BellRing,
  Menu,
  LayoutGrid,
  CalendarDays,
  BadgeCheck,
  Printer,
  Briefcase,
  MoreVertical,
  Settings,
  Files,
  Boxes,
  Flame,
  ClipboardPlus,
  ClipboardCheck,
  ClipboardList,
  PackageCheck,
  Truck,
  Factory,

} from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import { useProjectModal } from '@/hooks/useProjectModal'
import ProjectDetail from '@/pages/ProjectDetail'
import RouteFallback from '@/components/RouteFallback'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import UserAvatar from '@/components/UserAvatar.jsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import api, { ROLE_LABELS, STATUS_META, statusKeyForProject, canRequestHandover } from '@/api'
import { cn, initials } from '@/lib/utils'
import NewProjectDialog from '@/components/NewProjectDialog'
import { loadSeen, addSeen } from '@/components/notification-seen'

const COLLAPSE_KEY = 'yz-sidebar-collapsed'
const YZ_LOGO_WHITE = '/yz_whitelogo.svg'
const YZ_LOGO_BLACK = '/yz_blacklogo.svg'

/**
 * Layout used by every authenticated page. The sidebar can collapse to an
 * icon-only rail on desktop (state is remembered) and opens as a drawer on
 * mobile. Badges, pinned projects and the period widget use live data.
 */
export default function AppShell() {
  const { user, logout } = useAuth()
  const { projects } = useProjects()
  const navigate = useNavigate()
  const { projectId: modalProjectId, openProject, closeProject } = useProjectModal()
  const [open, setOpen] = useState(false) // mobile drawer
  const [pendingOrders, setPendingOrders] = useState(0)    // team_leader: pending + matbaa_onay
  const [printerOrders, setPrinterOrders] = useState(0)   // printer: tasarimci_onay
  const [designerOrders, setDesignerOrders] = useState(0) // designer: goruldu (for their projects)
  const [pendingHandovers, setPendingHandovers] = useState(0) // satis: teslim onay bekleyen
  const [orders, setOrders] = useState([])                // full talep list, fed to the bell
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const location = useLocation()

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
    let productionReady = 0
    for (const p of projects) {
      if (p.stage !== 'satista') active++
      else satista++
      // Printer queue = incoming teslim; leader queue = pending onay.
      if (role === 'printer') {
        if (p.type === 'TR' && p.stage === 'demo_teslim') demoApprovals++
        if (p.type === 'TR' && p.stage === 'ozalit_teslim' && (p.ozalit_requested || p.reject_target === 'matbaa')) ozalitApprovals++
      } else if (role === 'team_leader') {
        if (p.stage === 'demo_onay' || p.stage === 'cin_demo_onay') demoApprovals++
        if (p.stage === 'ozalit_onay') ozalitApprovals++
      }
      if (p.stage === 'uretimde' || p.stage === 'gumruk') production++
      if (role === 'printer' && p.stage === 'uretime_hazir') productionReady++
      if (role === 'printer' && canRequestHandover(p)) handoverEligible++
      if (role === 'designer' && (p.assignees ?? []).some((a) => a.id === user?.id)) myProjects++
      if ((p.demo_attempt ?? 0) >= 2 || (p.ozalit_attempt ?? 0) >= 2) urgent++
    }
    return { active, demoApprovals, ozalitApprovals, production, satista, total: projects.length, myProjects, urgent, handoverEligible, productionReady }
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
      setOrders(orders) // full list — the bell derives per-role notifications from it
      if (role === 'team_leader') {
        setPendingOrders(orders.filter((o) => o.status === 'pending' || o.status === 'matbaa_onay').length)
      } else if (role === 'printer') {
        setPrinterOrders(orders.filter((o) => o.status === 'tasarimci_onay').length)
      } else if (role === 'designer') {
        // Only orders where the project is assigned to this designer
        const myIds = new Set(projects.filter((p) => (p.assignees ?? []).some((a) => a.id === user.id)).map((p) => p.id))
        setDesignerOrders(orders.filter((o) => o.status === 'goruldu' && myIds.has(o.project_id)).length)
      }
    }).catch(() => {})

    if (role === 'satis') {
      api.listHandovers()
        .then((hs) => setPendingHandovers(hs.filter((h) => h.status === 'pending').length))
        .catch(() => {})
    }
  }, [user?.role, user?.id, projects])

  // Apply Utter Butter font for designer + team_leader roles.
  useEffect(() => {
    const creative = user?.role === 'designer' || user?.role === 'team_leader'
    document.documentElement.classList.toggle('font-creative', creative)
    return () => document.documentElement.classList.remove('font-creative')
  }, [user?.role])

  // Safety net: when the project detail Sheet closes, make sure Radix hasn't
  // left `pointer-events: none` stuck on <body>. Overlapping Radix overlays
  // (e.g. the notification dropdown handing off to this Sheet) can otherwise
  // leave the page unclickable until a full refresh.
  useEffect(() => {
    if (!modalProjectId) {
      const id = requestAnimationFrame(() => {
        if (document.body.style.pointerEvents === 'none') {
          document.body.style.pointerEvents = ''
        }
      })
      return () => cancelAnimationFrame(id)
    }
  }, [modalProjectId])

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
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-background transition-[width] duration-200 ease-out lg:flex',
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
          onOpenProject={openProject}
        />
      </aside>

      {/* Mobile drawer (always expanded). showCloseButton={false} hides the
          shadcn default X — the drawer already closes via backdrop tap, the
          <Menu /> button toggle, and the onNavigate handler on every link. */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-[min(20rem,calc(100vw-3rem))] p-0 sm:w-72">
          <div className="flex h-full flex-col">
            <Sidebar
              collapsed={false}
              groups={groups}
              pinned={pinned}
              counts={counts}
              user={user}
              onLogout={handleLogout}
              onNavigate={() => setOpen(false)}
              onToggleCollapsed={() => setOpen(false)}
              onOpenProject={openProject}
            />
          </div>
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — wider gutters on huge screens to keep the search/CTA from feeling stranded */}
        <header
          className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur sm:px-4 lg:px-6 2xl:px-8 3xl:px-12"
          style={{ paddingTop: 'max(0px, var(--safe-top, 0px))' }}
        >
          {/* Left — mobile menu + greeting */}
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Menüyü aç"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <span className="hidden text-base sm:block">
              Merhaba, <strong>{user?.name?.split(' ')[0]}</strong>!
            </span>
          </div>

          {/* Center — search */}
          <div className="flex flex-1 justify-center px-2">
            <TopbarSearch />
          </div>

          {/* Right — actions */}
          <div className="flex shrink-0 items-center gap-2">
            {user?.role === 'team_leader' && (
              <Button size="sm" onClick={() => setNewProjectOpen(true)} className="hidden sm:inline-flex">
                <Plus className="h-4 w-4" />
                Yeni Proje
              </Button>
            )}
            {user?.role === 'team_leader' && (
              <Button
                size="icon"
                variant="outline"
                onClick={() => setNewProjectOpen(true)}
                className="sm:hidden"
                aria-label="Yeni proje"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
                        <NotificationBell
              projects={projects}
              user={user}
              orders={orders}
              onOpenProject={openProject}
            />
            <UserMenu user={user} onLogout={handleLogout} />
          </div>
        </header>

        <main
          key={location.pathname}
          id="main-content"
          tabIndex={-1}
          className="page-enter min-w-0 flex-1 px-3 py-4 sm:px-4 sm:py-6 lg:px-8 2xl:px-10 3xl:px-16"
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

      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      <Sheet open={!!modalProjectId} onOpenChange={(v) => !v && closeProject()}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto p-4 sm:max-w-3xl 2xl:max-w-4xl 3xl:max-w-5xl"
        >
          {modalProjectId && <ProjectDetail projectId={modalProjectId} isModal />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

/* ----------------------------- sidebar ----------------------------- */

function Sidebar({ collapsed, groups, pinned, counts, user, onLogout, onNavigate, onToggleCollapsed, onOpenProject }) {
  return (
    <>
      <SidebarBrand collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
      <div className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden py-4">
        {groups.map((group) => (
          <SidebarSection key={group.id} collapsed={collapsed} label={group.label}>
            {group.items.map((item) => (
              <SidebarNavItem
                key={item.label}
                item={item}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </SidebarSection>
        ))}

        {!collapsed && pinned.length > 0 && (
          <SidebarSection collapsed={collapsed}>
            {pinned.map((p) => {
              const meta = STATUS_META[statusKeyForProject(p)]
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onNavigate?.(); onOpenProject?.(p.id) }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />
                  <span className="flex-1 truncate text-left">{p.title}</span>
                  {p.demo_attempt >= 2 && (
                    <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive">
                      Acil
                    </span>
                  )}
                </button>
              )
            })}
          </SidebarSection>
        )}

        {!collapsed && (
          <div className="px-3 pt-4">
            <PeriodWidget satista={counts.satista} total={counts.total} />
          </div>
        )}
      </div>
      <SidebarFooter user={user} onLogout={onLogout} collapsed={collapsed} />
    </>
  )
}

function SidebarBrand({ collapsed, onToggleCollapsed }) {
  return (
    <div
      className={cn(
        'flex h-14 shrink-0 items-center border-b',
        collapsed ? 'justify-between gap-1 px-2' : 'gap-2.5 px-4',
      )}
    >
      {!collapsed && (
        <Link
          to="/"
          aria-label="Ana sayfa"
          className="flex h-8 min-w-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img src={YZ_LOGO_BLACK} alt="Yükselen Zeka" className="block h-7 w-auto max-w-full object-contain dark:hidden" />
          <img src={YZ_LOGO_WHITE} alt="Yükselen Zeka" className="hidden h-7 w-auto max-w-full object-contain dark:block" />
        </Link>
      )}
      <button
        type="button"
        aria-label={collapsed ? 'Kenar çubuğunu aç' : 'Kenar çubuğunu kapat'}
        aria-pressed={!collapsed}
        onClick={onToggleCollapsed}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          collapsed ? 'ml-1' : 'ml-auto',
        )}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
    </div>
  )
}

function TopbarSearch() {
  return (
    <button
      type="button"
      onClick={() => toast.message('Arama yakında eklenecek.')}
      className="flex w-full max-w-sm items-center gap-2 rounded-full border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">Ara…</span>
    </button>
  )
}

function SearchButton({ collapsed }) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => toast.message('Arama yakında eklenecek.')}
        aria-label="Hızlı ara"
        className="flex h-9 w-full items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground transition-colors hover:border-input hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="h-5 w-5" />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => toast.message('Arama yakında eklenecek.')}
      className="flex w-full items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Search className="h-5 w-5" />
      <span className="flex-1 text-left">Hızlı ara…</span>
    </button>
  )
}

function SidebarSection({ collapsed, label, children }) {
  return (
    <div className={cn('mt-4', collapsed ? 'px-2' : 'px-3')}>
      {collapsed ? (
        <div className="mx-2 mb-1.5 border-t" />
      ) : label ? (
        <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </p>
      ) : (
        <div className="mx-2.5 mb-2 border-t" />
      )}
      <nav className="space-y-0.5">{children}</nav>
    </div>
  )
}

function NavBadge({ count, tone = 'default', active }) {
  if (!count) return null
  const tones = {
    default: active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
    amber: 'bg-amber-100 text-amber-700',
    pink: 'bg-fuchsia-100 text-fuchsia-700',
  }
  return (
    <span className={cn('ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold', tones[tone])}>
      {count}
    </span>
  )
}

function SidebarNavItem({ item, collapsed, onNavigate }) {
  const { icon: Icon, label, badge, badgeTone = 'default', soon, highlight } = item

  // Collapsed: icon-only.
  if (collapsed) {
    if (soon) {
      return (
        <div
          aria-label={label}
          className="relative flex h-9 w-full items-center justify-center rounded-md text-muted-foreground/60"
        >
          <Icon className="h-5 w-5" />
        </div>
      )
    }

    return (
      <NavLink
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        aria-label={label}
        title={label}
        className={({ isActive }) =>
          cn(
            'relative flex h-9 w-full items-center justify-center rounded-md transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isActive
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            highlight && !isActive && 'nav-pulse-glow nav-bounce text-foreground',
          )
        }
      >
        <Icon className="h-5 w-5" />
      </NavLink>
    )
  }

  if (soon) {
    return (
      <div className="flex w-full cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground/50">
        <Icon className="h-5 w-5" />
        <span className="flex-1 text-left">{label}</span>
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60">
          yakında
        </span>
      </div>
    )
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          highlight && !isActive && 'nav-pulse-glow nav-bounce text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="h-5 w-5" />
          <span className="flex-1">{label}</span>
          <NavBadge count={badge} tone={badgeTone} active={isActive} />
        </>
      )}
    </NavLink>
  )
}

function PeriodWidget({ satista, total }) {
  const pct = total ? Math.round((satista / total) * 100) : 0
  const now = new Date()
  const deadline = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(
    new Date(now.getFullYear(), now.getMonth() + 1, 0),
  )
  return (
    <div className="rounded-lg border border-primary/15 bg-primary/5 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Bu Dönem</div>
        <div className="font-mono text-[10px] font-medium tabular-nums text-primary">{pct}%</div>
      </div>
      <div className="mt-1.5 text-xs font-medium text-foreground">Hedef: projeleri satışa çıkar</div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 text-[10px] text-muted-foreground">
        {satista} / {total} satışta · {deadline} sonu
      </div>
    </div>
  )
}

function SidebarFooter({ user, onLogout, collapsed }) {
  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1 border-t p-2">
        <UserAvatar user={user} size="md" />
        <Button
          variant="ghost"
          size="icon"
          onClick={onLogout}
          aria-label="Çıkış yap"
          className="h-8 w-8 text-muted-foreground"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    )
  }
  return (
    <div className="shrink-0 border-t p-2">
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted">
        <UserAvatar user={user} size="md" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium">{user?.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{ROLE_LABELS[user?.role]}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onLogout}
          aria-label="Çıkış yap"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

/* ----------------------------- notifications ----------------------------- */

const TONE_DOT = {
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
  rose: 'bg-rose-500',
  blue: 'bg-blue-500',
  pink: 'bg-pink-500',
}

/**
 * Derive the notification list from the live project state, tailored to the
 * current user's role. Team leaders see what needs their approval / attention,
 * the printer sees incoming teslim items, designers see their rejected work.
 */
const ORDER_STEP_TEXT = {
  pending: 'Yeni sipariş talebi — onayınızı bekliyor',
  goruldu: 'Sipariş kontrolünüzü bekliyor',
  tasarimci_onay: 'Sipariş ozalit isteniyor',
  matbaa_onay: 'Sipariş ozalit onayınızı bekliyor',
}

/**
 * Talep (order) notifications, layered on top of the project ones. Each role
 * is alerted about the step it must act on; the sales requester (Esra) is
 * alerted when her talep is finally approved and sent to production.
 */
function buildOrderNotifications(orders, projects, user) {
  if (!user || !Array.isArray(orders)) return []
  const role = user.role
  const items = []
  const cleanTitle = (t) => String(t ?? '').replace(/ \/ /g, ' ')
  const myProjectIds = new Set(
    projects.filter((p) => (p.assignees ?? []).some((a) => a.id === user.id)).map((p) => p.id),
  )

  for (const o of orders) {
    const ts = o.updated_at ? new Date(o.updated_at).getTime() : 0
    const base = { projectId: o.project_id, title: cleanTitle(o.project_title), _updatedAt: ts, kind: 'order' }

    // Sales requester — her own talep was approved → production.
    if (role === 'satis' && o.requested_by === user.id && o.status === 'onaylandi') {
      items.push({ ...base, id: `ord-${o.id}-onaylandi`, tone: 'green', text: 'Talebiniz onaylandı — üretime alındı', to: '/siparis-talebi' })
      continue
    }
    // Staff — alert on the step this role must advance.
    if (role === 'team_leader' && (o.status === 'pending' || o.status === 'matbaa_onay')) {
      items.push({ ...base, id: `ord-${o.id}-${o.status}`, tone: 'amber', text: ORDER_STEP_TEXT[o.status], to: '/siparis-onay' })
    } else if (role === 'printer' && o.status === 'tasarimci_onay') {
      items.push({ ...base, id: `ord-${o.id}-${o.status}`, tone: 'blue', text: ORDER_STEP_TEXT[o.status], to: '/approvals/siparis' })
    } else if (role === 'designer' && o.status === 'goruldu' && myProjectIds.has(o.project_id)) {
      items.push({ ...base, id: `ord-${o.id}-${o.status}`, tone: 'green', text: ORDER_STEP_TEXT[o.status], to: '/siparis-onay' })
    }
  }
  return items
}

function buildNotifications(projects, user, orders = []) {
  if (!user) return []
  const role = user.role
  const items = buildOrderNotifications(orders, projects, user)

  for (const p of projects) {
    const ts = p.updated_at ? new Date(p.updated_at).getTime() : 0
    if (role === 'team_leader') {
      if (p.stage === 'demo_onay' || p.stage === 'ozalit_onay' || p.stage === 'cin_demo_onay') {
        const attempt = p.stage === 'ozalit_onay' ? (p.ozalit_attempt ?? 0) : (p.demo_attempt ?? 0)
        items.push({ id: `${p.id}-onay-${p.stage}-${attempt}`, projectId: p.id, tone: 'amber', title: p.title, text: 'Onayınızı bekliyor', _updatedAt: ts })
      }
      if (p.stage === 'tasarim' && p.progress === 100) {
        items.push({ id: `${p.id}-ready-${p.demo_attempt ?? 0}`, projectId: p.id, tone: 'green', title: p.title, text: 'Tasarım tamamlandı, demoya hazır', _updatedAt: ts })
      }
      if ((p.demo_attempt ?? 0) >= 1) {
        items.push({ id: `${p.id}-att-${p.demo_attempt}`, projectId: p.id, tone: 'rose', title: p.title, text: `${p.demo_attempt + 1}. demo denemesinde`, _updatedAt: ts })
      }
      if ((p.ozalit_attempt ?? 0) >= 1) {
        items.push({ id: `${p.id}-oatt-${p.ozalit_attempt}`, projectId: p.id, tone: 'blue', title: p.title, text: `${p.ozalit_attempt + 1}. ozalit denemesinde`, _updatedAt: ts })
      }
    } else if (role === 'printer') {
      if (p.type === 'TR' && p.stage === 'demo_teslim') {
        const attempt = (p.demo_attempt ?? 0) + 1
        items.push({ id: `${p.id}-teslim-demo-${p.demo_attempt}`, projectId: p.id, tone: 'blue', title: p.title, text: `${attempt}. Demo isteniyor`, _updatedAt: ts })
      } else if (p.type === 'TR' && p.stage === 'ozalit_teslim' && (p.ozalit_requested || p.reject_target === 'matbaa')) {
        const attempt = (p.ozalit_attempt ?? 0) + 1
        items.push({ id: `${p.id}-teslim-ozalit-${p.ozalit_attempt}`, projectId: p.id, tone: 'blue', title: p.title, text: `${attempt}. Ozalit isteniyor`, _updatedAt: ts })
      }
    } else if (role === 'designer') {
      const mine = (p.assignees ?? []).some((a) => a.id === user.id)
      if (mine) {
        items.push({ id: `${p.id}-assigned`, kind: 'assignment', projectId: p.id, tone: 'green', title: p.title, text: 'Bu projeye eklendiniz', _updatedAt: ts })
      }
      if (mine && p.stage === 'tasarim' && ((p.demo_attempt ?? 0) > 0 || (p.ozalit_attempt ?? 0) > 0)) {
        items.push({ id: `${p.id}-rej-${p.demo_attempt ?? 0}-${p.ozalit_attempt ?? 0}`, projectId: p.id, tone: 'rose', title: p.title, text: 'Revizyon gerekiyor — tasarıma geri döndü', _updatedAt: ts })
      }
    }
  }
  return items.sort((a, b) => {
    // Sort newest first using the stored updatedAt on each item (falls back to 0).
    return (b._updatedAt ?? 0) - (a._updatedAt ?? 0)
  })
}

// Persistent notification log — newest entry first, capped at 50.
const MAX_NOTIF_LOG = 50

function loadNotifLog(userId) {
  if (!userId || typeof localStorage === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(`yz_notif_log_${userId}`)) ?? []
  } catch {
    return []
  }
}

function saveNotifLog(userId, log) {
  if (!userId || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(`yz_notif_log_${userId}`, JSON.stringify(log.slice(0, MAX_NOTIF_LOG)))
  } catch {
    /* ignore */
  }
}

function NotificationBell({ projects, user, orders, onOpenProject }) {
  const navigate = useNavigate()
  const allItems = useMemo(() => buildNotifications(projects, user, orders), [projects, user, orders])
  const [log, setLog] = useState(() => loadNotifLog(user?.id))
  const [menuOpen, setMenuOpen] = useState(false)

  // Designer "unread assignments" — projects assigned to this designer that
  // haven't been acknowledged via the bell card yet. Drives the auto-open
  // effect and the rose-tinted panel at the top of the dropdown.
  const unreadAssignments = useMemo(() => {
    if (!user || user.role !== 'designer' || !Array.isArray(projects)) return []
    const seen = loadSeen(user.id)
    return projects
      .filter((p) => (p.assignees ?? []).some((a) => a.id === user.id))
      .filter((p) => !seen.has(p.id))
  }, [projects, user])

  // One-shot auto-open for the designer backlog. Tracks the last key we
  // surfaced so polling / store ticks don't re-open the dropdown on every
  // refresh. User-scoped: logging in as a different user resets the ref.
  const lastBellOpenRef = useRef({ userId: null, key: '' })
  useEffect(() => {
    if (!user || user.role !== 'designer') return
    if (lastBellOpenRef.current.userId !== user.id) {
      lastBellOpenRef.current = { userId: user.id, key: '' }
    }
    const nextKey = unreadAssignments.map((p) => p.id).sort().join(',')
    if (unreadAssignments.length === 0) {
      lastBellOpenRef.current.key = nextKey
      return
    }
    if (lastBellOpenRef.current.key === nextKey) return
    lastBellOpenRef.current.key = nextKey
    setMenuOpen(true)
  }, [unreadAssignments, user])

  // Whenever the derived item list changes, prepend any genuinely new IDs to
  // the top of the persistent log. Existing entries are never removed so old
  // notifications stay visible even after the project moves to another stage.
  useEffect(() => {
    if (!allItems.length) return
    setLog((prev) => {
      const existingIds = new Set(prev.map((n) => n.id))
      const incoming = allItems.filter((n) => !existingIds.has(n.id))
      if (!incoming.length) return prev
      const stamped = incoming.map((n) => ({ ...n, createdAt: Date.now(), isRead: false }))
      const next = [...stamped, ...prev]
      saveNotifLog(user?.id, next)
      return next
    })
  }, [allItems, user?.id])

  const unreadCount = log.filter((n) => !n.isRead).length

  function markRead(id) {
    setLog((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      saveNotifLog(user?.id, next)
      return next
    })
  }

  function markAllRead() {
    setLog((prev) => {
      const next = prev.map((n) => ({ ...n, isRead: true }))
      saveNotifLog(user?.id, next)
      return next
    })
  }

  // Drop the badge for the bell-log entries that mirror the dismissed
  // assignments so the red unread counter reflects the designer's "Tamam".
  function markAssignedReadInLog(projectIds) {
    if (!projectIds.length) return
    const idSet = new Set(projectIds)
    setLog((prev) => {
      const next = prev.map((n) =>
        n.projectId && idSet.has(n.projectId) && String(n.id).endsWith('-assigned')
          ? { ...n, isRead: true }
          : n,
      )
      saveNotifLog(user?.id, next)
      return next
    })
  }

  function dismissAssignmentBacklog() {
    if (!user || !unreadAssignments.length) return
    const ids = unreadAssignments.map((p) => p.id)
    addSeen(user.id, ids)
    markAssignedReadInLog(ids)
    // Avoid re-opening on the next store tick by recording the dismissed key.
    lastBellOpenRef.current.key = ids.slice().sort().join(',')
    setMenuOpen(false)
  }

  function openMyProjectsFromBell() {
    if (!user || !unreadAssignments.length) return
    const ids = unreadAssignments.map((p) => p.id)
    addSeen(user.id, ids)
    markAssignedReadInLog(ids)
    lastBellOpenRef.current.key = ids.slice().sort().join(',')
    // Close the dropdown first, then navigate on the next tick so Radix's
    // pointer-events lock is gone before the route changes.
    setMenuOpen(false)
    setTimeout(() => navigate('/my-projects'), 0)
  }

  // Close dropdown FIRST, then open the Sheet on the next tick.
  // Both are Radix overlays that lock pointer-events on <body>; overlapping
  // them leaves the page unclickable until a refresh.
  function handleItemClick(n) {
    markRead(n.id)
    setMenuOpen(false)
    // Order notifications route to a page; project ones open the detail sheet.
    setTimeout(() => {
      if (n.to) navigate(n.to)
      else onOpenProject(n.projectId)
    }, 0)
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Bildirimler"
          className={cn(
            'relative',
            unreadAssignments.length > 0 && !menuOpen && 'bell-pulse',
          )}
        >
          <BellRing className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 grid h-4 min-w-[1rem] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-semibold">Bildirimler</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Tümünü okundu say
            </button>
          )}
        </div>
        {unreadAssignments.length > 0 && (
          <AssignAlertCard
            items={unreadAssignments}
            onDismiss={dismissAssignmentBacklog}
            onOpenAll={openMyProjectsFromBell}
          />
        )}
        <DropdownMenuSeparator className="my-0" />
        {log.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <BellRing className="mx-auto mb-2 h-5 w-5 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Henüz bildirim yok</p>
          </div>
        ) : (
          <div className="scrollbar-thin max-h-80 overflow-y-auto py-1">
            {log.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleItemClick(n)}
                className={cn(
                  'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted focus:outline-none focus-visible:bg-muted',
                  n.isRead && 'opacity-50',
                )}
              >
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', TONE_DOT[n.tone])} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm', n.isRead ? 'font-normal text-foreground' : 'font-semibold text-foreground')}>{n.title}</span>
                  <span className="block text-xs text-muted-foreground">{n.text}</span>
                </span>
                {!n.isRead && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                )}
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const MAX_ALERT_TITLES = 3

/**
 * Inline card at the top of the bell dropdown for designers with unread
 * project assignments. Replaces the old floating sonner toast so the
 * acknowledgement lives inside the bell itself. The bell auto-opens on
 * login when this card has content (see NotificationBell auto-open effect).
 */
function AssignAlertCard({ items, onDismiss, onOpenAll }) {
  if (!items || !items.length) return null
  const titles = items.slice(0, MAX_ALERT_TITLES).map((p) => p.title)
  const overflow = items.length - titles.length
  const titleList = titles.join(', ') + (overflow > 0 ? ` ve ${overflow} daha` : '')

  return (
    <div
      data-testid="unread-assignments-card"
      className="border-b border-rose-200/40 bg-rose-50 px-3 py-3"
    >
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">
            {items.length} okunmamış proje atamanız var
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{titleList}</div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={onOpenAll}
          className="h-7 px-2.5 text-xs"
        >
          Projeleri Gör
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onDismiss}
          className="h-7 px-2.5 text-xs"
        >
          Tamam
        </Button>
      </div>
    </div>
  )
}


function UserMenu({ user, onLogout }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-1.5">
          <UserAvatar user={user} size="sm" />
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="text-sm font-semibold">{user?.name}</span>
            <span className="text-xs text-muted-foreground">{user?.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/team">
            <UsersRound className="h-4 w-4" />
            Ekip
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings className="h-4 w-4" />
            Ayarlar
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} className="text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" />
          Çıkış Yap
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ----------------------------- breadcrumb ----------------------------- */

const PAGE_TITLES = [
  { match: (p) => p === '/', label: 'Genel Bakış' },
  { match: (p) => p.startsWith('/kanban'), label: 'İş Akışı' },
  { match: (p) => p.startsWith('/approvals/siparis'), label: 'Sipariş Onayı' },
  { match: (p) => p.startsWith('/approvals'), label: 'Onaylar' },
  { match: (p) => p.startsWith('/team'), label: 'Ekip' },
  { match: (p) => p.startsWith('/plan'), label: 'Yıllık Plan' },
  { match: (p) => p.startsWith('/demo'), label: 'Demo' },
  { match: (p) => p.startsWith('/my-projects'), label: 'Projelerim' },
  { match: (p) => p.startsWith('/documents'), label: 'Dökümanlar' },
  { match: (p) => p.startsWith('/urun-bilgileri'), label: 'Ürün Bilgileri' },
  { match: (p) => p.startsWith('/siparis-talebi'), label: 'Sipariş Talebi' },
  { match: (p) => p.startsWith('/siparis-talepleri'), label: 'Sipariş Talepleri' },
  { match: (p) => p.startsWith('/siparis-onay'), label: 'Sipariş Onayları' },
  { match: (p) => p.startsWith('/uretime-hazir'), label: 'Üretime Hazır' },
  { match: (p) => p.startsWith('/teslim-talepleri'), label: 'Teslim Talepleri' },
  { match: (p) => p.startsWith('/teslim-onaylari'), label: 'Teslim Onayları' },
  { match: (p) => p.startsWith('/projects/'), label: 'Proje Detayı' },
  { match: (p) => p === '/projects', label: 'Tüm Projeler' },
]

function Breadcrumb({ pathname }) {
  const page = PAGE_TITLES.find((x) => x.match(pathname))?.label ?? 'Panel'
  return (
    <nav aria-label="Breadcrumb" className="hidden text-sm sm:block">
      <span className="font-medium text-foreground">{page}</span>
    </nav>
  )
}

/* ----------------------------- role nav ----------------------------- */

function navGroups(role, counts, pendingOrders = 0, printerOrders = 0, designerOrders = 0, pendingHandovers = 0) {
  // ── Grup 1: Ana menü ──────────────────────────────────────────
  const mainItems = [
    { to: '/', label: 'Genel Bakış', icon: LayoutDashboard, end: true, roles: ['team_leader', 'designer', 'printer'] },
    { to: '/my-projects', label: 'Projelerim', icon: Briefcase, badge: counts.myProjects || designerOrders || undefined, badgeTone: designerOrders > 0 ? 'amber' : 'default', roles: ['designer'] },
    { to: '/kanban', label: 'İş Akışı', icon: Columns3, badge: counts.active, roles: ['team_leader', 'designer', 'printer'] },
    { to: '/projects', label: 'Tüm Projeler', icon: LayoutGrid, end: true, badge: counts.total, roles: ['team_leader', 'designer', 'printer'] },
    {
      to: '/baski-listesi',
      label: 'Baskı Listesi',
      icon: Printer,
      badge: counts.production,
      badgeTone: 'pink',
      roles: ['team_leader', 'designer', 'printer'],
    },
    { label: 'Toplantılar', icon: CalendarDays, soon: true, roles: ['team_leader', 'designer', 'printer'] },
    // Sales-only items
    { to: '/siparis-talebi', label: 'Sipariş Talebi', icon: ClipboardPlus, roles: ['satis'] },
    { to: '/projects', label: 'Tüm Ürünler', icon: LayoutGrid, end: true, roles: ['satis'] },
  ].filter((i) => !i.roles || i.roles.includes(role))

  // ── Grup 2: Onaylar (sadece printer + team_leader) ────────────
  const approvalItems = [
    {
      to: '/approvals/demo',
      label: 'Onaylar',
      icon: BadgeCheck,
      badge: counts.demoApprovals + counts.ozalitApprovals,
      badgeTone: 'amber',
      highlight: counts.demoApprovals + counts.ozalitApprovals > 0,
      roles: ['printer', 'team_leader'],
    },
    {
      to: '/approvals/siparis',
      label: 'Sipariş Teslimi',
      icon: PackageCheck,
      badge: printerOrders,
      badgeTone: 'amber',
      highlight: printerOrders > 0,
      roles: ['printer'],
    },
    {
      to: '/siparis-onay',
      label: 'Sipariş Onayları',
      icon: ClipboardCheck,
      badge: designerOrders || undefined,
      badgeTone: 'amber',
      highlight: designerOrders > 0,
      roles: ['designer'],
    },
    {
      to: '/siparis-talepleri',
      label: 'Sipariş Talepleri',
      icon: ClipboardList,
      badge: pendingOrders,
      badgeTone: 'amber',
      highlight: pendingOrders > 0,
      roles: ['team_leader'],
    },
    {
      to: '/uretime-hazir',
      label: 'Üretime Hazır',
      icon: Factory,
      badge: counts.productionReady || undefined,
      badgeTone: 'amber',
      highlight: counts.productionReady > 0,
      roles: ['printer'],
    },
    {
      to: '/teslim-talepleri',
      label: 'Teslim Talepleri',
      icon: Truck,
      badge: counts.handoverEligible || undefined,
      badgeTone: 'pink',
      highlight: counts.handoverEligible > 0,
      roles: ['printer'],
    },
    {
      to: '/teslim-onaylari',
      label: 'Teslim Onayları',
      icon: PackageCheck,
      badge: pendingHandovers || undefined,
      badgeTone: 'amber',
      highlight: pendingHandovers > 0,
      roles: ['satis'],
    },
  ].filter((i) => !i.roles || i.roles.includes(role))

  // ── Grup 3: Yönetim / kaynaklar ──────────────────────────────
  const resourceItems = [
    { to: '/team', label: 'Ekip', icon: UsersRound, roles: ['team_leader'] },
    { to: '/documents', label: 'Dökümanlar', icon: Files, roles: ['team_leader', 'designer', 'printer'] },
    { to: '/urun-bilgileri', label: 'Ürün Bilgileri', icon: Boxes, roles: ['team_leader', 'designer'] },
  ].filter((i) => !i.roles || i.roles.includes(role))

  // ── Grup 4: Acil işler (kişiye göre) ─────────────────────────
  const urgentItems = [
    {
      label: 'Acil İşler',
      icon: Flame,
      soon: true,
      badge: counts.urgent,
      badgeTone: 'amber',
      highlight: counts.urgent > 0,
    },
  ]

  const groups = [{ id: 'main', label: null, items: mainItems }]
  if (approvalItems.length > 0) groups.push({ id: 'approvals', label: role === 'satis' ? null : 'Onaylar', items: approvalItems })
  if (resourceItems.length > 0) groups.push({ id: 'resources', label: null, items: resourceItems })
  if (role !== 'satis') groups.push({ id: 'urgent', label: null, items: urgentItems })
  return groups
}
