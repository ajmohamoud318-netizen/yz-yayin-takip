import { Suspense, useEffect, useMemo, useState } from 'react'
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
  Target,
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
  Package,
  UserPlus,
  RotateCcw,
  Send,
  FileText,
  CheckCircle2,
  Tag,
  Ship,
  Trash2,
  EyeOff,
} from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
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
import api, { ROLE_LABELS, STATUS_META, statusKeyForProject, canRequestHandover, ozalitLeaderApproved } from '@/api'
import { cn, initials } from '@/lib/utils'
import NewProjectDialog from '@/components/NewProjectDialog'
import WorkLogPill from '@/components/WorkLogPill'
import { WORK_LOG_ENABLED } from '@/lib/work-log.js'
import PushToggle from '@/components/PushToggle.jsx'
import SetupSheet from '@/components/SetupSheet.jsx'
import { useNotifications } from '@/hooks/useNotifications'
import { isOrderAssignedToDesigner } from '@/domain/constants/orders'

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
  const [open, setOpen] = useState(false) // mobile drawer
  const [pendingOrders, setPendingOrders] = useState(0)    // team_leader: pending + matbaa_onay
  const [printerOrders, setPrinterOrders] = useState(0)   // printer: tasarimci_onay
  const [designerOrders, setDesignerOrders] = useState(0) // designer: goruldu (for their projects)
  const [pendingHandovers, setPendingHandovers] = useState(0) // satis: teslim onay bekleyen
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
    let designerOzalitApprovals = 0
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
      }
      if (p.stage === 'uretimde' || p.stage === 'gumruk') production++
      if (role === 'printer' && p.stage === 'uretime_hazir') productionReady++
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
    return { active, demoApprovals, ozalitApprovals, production, satista, total: projects.length, myProjects, urgent, handoverEligible, productionReady, designerOzalitApprovals }
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
        setPendingOrders(orders.filter((o) => o.status === 'pending' || o.status === 'matbaa_onay').length)
      } else if (role === 'printer') {
        setPrinterOrders(orders.filter((o) => o.status === 'tasarimci_onay').length)
      } else if (role === 'designer') {
        // Orders assigned to this designer. Must match /siparis-onay's filter
        // exactly — a badge counting differently than the page it points at is
        // how "3 bekliyor" ends up opening an empty list (or vice versa).
        const myIds = new Set(projects.filter((p) => (p.assignees ?? []).some((a) => a.id === user.id)).map((p) => p.id))
        setDesignerOrders(orders.filter((o) => {
          if (!isOrderAssignedToDesigner(o, user.id, myIds)) return false
          if (o.status === 'goruldu') return true
          if (o.status === 'matbaa_onay') {
            return !(o.matbaa_approvals ?? []).some((a) => a.id === user.id)
          }
          return false
        }).length)
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
          className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur sm:px-4 lg:px-6 2xl:px-8 3xl:px-12"
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
          className="page-enter min-w-0 flex-1 px-3 py-4 pb-[calc(1rem+var(--safe-bottom,0px))] sm:px-4 sm:py-6 sm:pb-[calc(1.5rem+var(--safe-bottom,0px))] lg:px-8 2xl:px-10 3xl:px-16"
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

      {/* Install + notification opt-in, offered on open instead of hidden in
          the bell dropdown. Self-hiding once both are done — see SetupSheet. */}
      <SetupSheet />
    </div>
  )
}

/* ----------------------------- sidebar ----------------------------- */

function Sidebar({ collapsed, groups, pinned, counts, user, onLogout, onNavigate, onToggleCollapsed, onOpenProject }) {
  // Same rule as the "Acil İşler" group in navGroups(): the pinned re-send
  // list and the period goal are leader/designer context. Matbaa gets the
  // nav and its own queues, nothing else.
  const showOverview = user?.role !== 'printer'
  return (
    <>
      <SidebarBrand collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
      <div className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden py-4">
        {groups.map((group) => (
          <SidebarSection key={group.id} collapsed={collapsed} label={group.label}>
            {group.items.map((item) =>
              item.type === 'worklog' ? (
                <WorkLogPill key={item.label} collapsed={collapsed} />
              ) : (
                <SidebarNavItem
                  key={item.label}
                  item={item}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              ),
            )}
          </SidebarSection>
        ))}

        {!collapsed && showOverview && pinned.length > 0 && (
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

        {!collapsed && showOverview && (
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

// Tone → tinted circle behind the per-type icon. Keeps the colour semantics
// of the old dot while adding a glanceable icon.
const TONE_ICON_STYLE = {
  amber: 'bg-amber-100 text-amber-600',
  green: 'bg-emerald-100 text-emerald-600',
  rose: 'bg-rose-100 text-rose-600',
  blue: 'bg-blue-100 text-blue-600',
  pink: 'bg-pink-100 text-pink-600',
}

// Notification type → icon. Types come from server/services/notifications.js.
// Falls back to a bell for anything unmapped so a new type never breaks render.
const TYPE_ICON = {
  assignment: UserPlus,
  rejection: RotateCcw,
  demo_delivery_pending: Send,
  demo_receipt_pending: Truck,
  demo_received: PackageCheck,
  demo_held: CheckCircle2,
  demo_approval_pending: BadgeCheck,
  ozalit_requestable: FileText,
  ozalit_delivery_pending: Send,
  ozalit_receipt_pending: Truck,
  ozalit_received: PackageCheck,
  ozalit_approval_pending: BadgeCheck,
  production_ready: Factory,
  in_production: Factory,
  in_customs: Ship,
  on_sale: Tag,
  order_step: ClipboardList,
  order_approved: CheckCircle2,
  order_rejected: RotateCcw,
  handover_request: Truck,
  handover_confirmed: PackageCheck,
  project_deleted: Trash2,
  product_delisted: EyeOff,
  product_relisted: PackageCheck,
}

function NotifIcon({ type, tone }) {
  const Icon = TYPE_ICON[type] ?? Bell
  return (
    <span
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-full',
        TONE_ICON_STYLE[tone] ?? TONE_ICON_STYLE.blue,
      )}
    >
      <Icon className="h-4 w-4" />
    </span>
  )
}

// Compact Turkish relative time for the bell ("az önce", "5 dk", "3 sa", "2 gün").
function relativeTime(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 45) return 'az önce'
  const mins = Math.round(secs / 60)
  if (mins < 60) return mins + ' dk'
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return hrs + ' sa'
  const days = Math.round(hrs / 24)
  if (days < 7) return days + ' gün'
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
}

/**
 * Notification bell — reads the shared, server-backed feed (useNotifications).
 *
 * Two states, deliberately split (see migration 024):
 *   • unseen  → the red BADGE. Cleared the moment the dropdown OPENS (a glance
 *               counts) so the bell doesn't nag.
 *   • is_read → per-item BOLD / to-do styling. Only cleared when the item is
 *               clicked (or "Tümünü okundu say"). Peeking never marks it read,
 *               so the list stays a real to-do queue.
 */
function NotificationBell() {
  const navigate = useNavigate()
  const { items, unseen, markRead, markAllRead, markSeen } = useNotifications()
  const [menuOpen, setMenuOpen] = useState(false)

  function handleOpenChange(open) {
    setMenuOpen(open)
    // Opening the bell clears the badge (seen) but not the bold (is_read).
    if (open && unseen > 0) markSeen()
  }

  function handleItemClick(n) {
    if (!n.is_read) markRead(n.id)
    setMenuOpen(false)
    const to = n.link || (n.project_id ? `/projects/${n.project_id}` : null)
    // Defer navigation one tick so Radix's pointer-events lock is released
    // before the route changes.
    if (to) setTimeout(() => navigate(to), 0)
  }

  // Per-item bold counts as the to-do total for the "mark all read" affordance.
  const unreadInView = items.reduce((n, it) => n + (it.is_read ? 0 : 1), 0)

  return (
    <DropdownMenu open={menuOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Bildirimler"
          className={cn('relative', unseen > 0 && !menuOpen && 'bell-pulse')}
        >
          <BellRing className="h-4 w-4" />
          {unseen > 0 && (
            <span className="absolute right-1 top-1 grid h-4 min-w-[1rem] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
              {unseen > 9 ? '9+' : unseen}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-semibold">Bildirimler</span>
          {unreadInView > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Tümünü okundu say
            </button>
          )}
        </div>
        <DropdownMenuSeparator className="my-0" />
        {items.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <BellRing className="mx-auto mb-2 h-5 w-5 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Henüz bildirim yok</p>
          </div>
        ) : (
          <div className="scrollbar-thin max-h-80 overflow-y-auto py-1">
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleItemClick(n)}
                className={cn(
                  'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted focus:outline-none focus-visible:bg-muted',
                  n.is_read && 'opacity-60',
                )}
              >
                <NotifIcon type={n.type} tone={n.tone} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm', n.is_read ? 'font-normal text-foreground' : 'font-semibold text-foreground')}>{n.title}</span>
                  <span className="block text-xs text-muted-foreground">{n.body}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground/70">{relativeTime(n.created_at)}</span>
                </span>
                {!n.is_read && (
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                )}
              </button>
            ))}
          </div>
        )}
        {/* Device push opt-in. Self-hiding when unavailable — see PushToggle. */}
        <PushToggle />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}


// Identity + navigation only. The "what else am I on today" note that used
// to live in here as a hidden dropdown item is now the Çalışma Defteri entry
// in the sidebar's resources group, under Ürün Bilgileri
// (components/WorkLogPill.jsx) — it was a feature nobody could find two
// levels deep in an avatar menu.
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
        {user?.role === 'team_leader' && (
          <DropdownMenuItem asChild>
            <Link to="/team">
              <UsersRound className="h-4 w-4" />
              Ekip
            </Link>
          </DropdownMenuItem>
        )}
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
  { match: (p) => p.startsWith('/approvals/siparis'), label: 'Baskı Teslimi' },
  { match: (p) => p.startsWith('/approvals'), label: 'Onaylar' },
  { match: (p) => p.startsWith('/team'), label: 'Ekip' },
  { match: (p) => p.startsWith('/deleted-projects'), label: 'Silinen Projeler' },
  { match: (p) => p.startsWith('/plan'), label: 'Yıllık Plan' },
  { match: (p) => p.startsWith('/demo'), label: 'Demo' },
  { match: (p) => p.startsWith('/my-projects'), label: 'Projelerim' },
  { match: (p) => p.startsWith('/documents'), label: 'Dökümanlar' },
  { match: (p) => p.startsWith('/urun-bilgileri'), label: 'Ürün Bilgileri' },
  { match: (p) => p.startsWith('/urunler'), label: 'Ürünler' },
  { match: (p) => p.startsWith('/siparis-talebi'), label: 'Taleplerim' },
  { match: (p) => p.startsWith('/siparis-talepleri'), label: 'Baskı Talepleri' },
  { match: (p) => p.startsWith('/siparis-onay'), label: 'Baskı Onayları' },
  { match: (p) => p.startsWith('/uretime-hazir'), label: 'Üretime Hazır' },
  { match: (p) => p.startsWith('/hedef-projeler'), label: 'Hedef Projeler' },
  { match: (p) => p.startsWith('/toplanti'), label: 'Toplantılar' },
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
    { to: '/urunler', label: 'Ürünler', icon: Package, roles: ['satis', 'team_leader'] },
    {
      to: '/hedef-projeler',
      label: 'Hedef Projeler',
      icon: Target,
      roles: ['team_leader', 'designer'],
    },
    { to: '/toplanti', label: 'Toplantılar', icon: CalendarDays, roles: ['team_leader', 'designer', 'printer'] },
    // Sales-only items
    { to: '/siparis-talebi', label: 'Taleplerim', icon: ClipboardPlus, roles: ['satis'] },
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
      label: 'Baskı Teslimi',
      icon: PackageCheck,
      badge: printerOrders,
      badgeTone: 'amber',
      highlight: printerOrders > 0,
      roles: ['printer'],
    },
    {
      to: '/approvals/ozalit',
      label: 'Ozalit Onayı',
      icon: BadgeCheck,
      badge: counts.designerOzalitApprovals || undefined,
      badgeTone: 'amber',
      highlight: counts.designerOzalitApprovals > 0,
      roles: ['designer'],
    },
    {
      to: '/siparis-onay',
      label: 'Baskı Onayları',
      icon: ClipboardCheck,
      badge: designerOrders || undefined,
      badgeTone: 'amber',
      highlight: designerOrders > 0,
      roles: ['designer'],
    },
    {
      to: '/siparis-talepleri',
      label: 'Baskı Talepleri',
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
    { to: '/deleted-projects', label: 'Silinen Projeler', icon: Trash2, roles: ['team_leader'] },
    // Çalışma Defteri — behind WORK_LOG_ENABLED (client/src/lib/work-log.js).
    // Dropping the item is what keeps the feature off: WorkLogPill is the only
    // caller of useWorkLog, so with no pill there is no GET /work-log either.
    ...(WORK_LOG_ENABLED ? [{ type: 'worklog', label: 'Çalışma Defteri' }] : []),
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
  // Matbaa's sidebar stays a work queue — "Acil İşler" tracks demo/özalit
  // re-send pressure, which is the leader's and the designers' problem.
  if (role !== 'satis' && role !== 'printer') groups.push({ id: 'urgent', label: null, items: urgentItems })
  return groups
}
