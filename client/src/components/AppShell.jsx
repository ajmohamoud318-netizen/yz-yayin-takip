import { useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Kanban,
  Users,
  Plus,
  LogOut,
  BookOpen,
  ChevronDown,
  Search,
  Bell,
  Menu,
  Sparkles,
  List,
  CalendarRange,
  CalendarClock,
  CheckCircle2,
  Printer,
  PanelLeft,
  Presentation,
  FolderKanban,
} from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ROLE_LABELS, STATUS_META, statusKeyForProject } from '@/api'
import { cn, initials } from '@/lib/utils'
import NewProjectDialog from '@/components/NewProjectDialog'

const COLLAPSE_KEY = 'yz-sidebar-collapsed'

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
    let approvals = 0
    let production = 0
    let satista = 0
    let myProjects = 0
    for (const p of projects) {
      if (p.stage !== 'satista') active++
      else satista++
      // Printer queue = incoming teslim; leader queue = pending onay.
      if (role === 'printer') {
        if (p.type === 'TR' && (p.stage === 'demo_teslim' || p.stage === 'ozalit_teslim')) approvals++
      } else if (role === 'team_leader') {
        if (p.stage === 'demo_onay' || p.stage === 'ozalit_onay' || p.stage === 'cin_demo_onay') approvals++
      }
      if (p.stage === 'uretimde' || p.stage === 'gumruk') production++
      if (role === 'designer' && (p.assignees ?? []).some((a) => a.id === user?.id)) myProjects++
    }
    return { active, approvals, production, satista, total: projects.length, myProjects }
  }, [projects, user?.role, user?.id])

  const pinned = useMemo(
    () =>
      [...projects]
        .filter((p) => p.stage !== 'satista')
        .sort((a, b) => (b.demo_attempt ?? 0) - (a.demo_attempt ?? 0))
        .slice(0, 3),
    [projects],
  )

  const groups = navGroups(user?.role, counts)

  async function handleLogout() {
    await logout()
    toast.success('Çıkış yapıldı.')
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 ease-out lg:flex',
          collapsed ? 'w-[4.25rem]' : 'w-64',
        )}
      >
        <Sidebar
          collapsed={collapsed}
          groups={groups}
          pinned={pinned}
          counts={counts}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      {/* Mobile drawer (always expanded) */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <div className="flex h-full flex-col">
            <Sidebar
              collapsed={false}
              groups={groups}
              pinned={pinned}
              counts={counts}
              user={user}
              onLogout={handleLogout}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Menüyü aç"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Kenar çubuğunu aç' : 'Kenar çubuğunu kapat'}
            aria-pressed={!collapsed}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>

          <Breadcrumb pathname={location.pathname} />

          <div className="ml-auto flex items-center gap-2">
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
              onOpenProject={(id) => navigate(`/projects/${id}`)}
            />
            <UserMenu user={user} onLogout={handleLogout} />
          </div>
        </header>

        <main key={location.pathname} className="page-enter min-w-0 flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
    </div>
  )
}

/* ----------------------------- sidebar ----------------------------- */

function Sidebar({ collapsed, groups, pinned, counts, user, onLogout, onNavigate }) {
  return (
    <>
      <SidebarBrand collapsed={collapsed} />
      <div className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden py-4">
        <div className={cn(collapsed ? 'px-2' : 'px-3')}>
          <SearchButton collapsed={collapsed} />
        </div>

        {groups.map((group) => (
          <SidebarSection key={group.title} title={group.title} collapsed={collapsed}>
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
          <SidebarSection title="Sabitlenmiş" collapsed={collapsed}>
            {pinned.map((p) => {
              const meta = STATUS_META[statusKeyForProject(p)]
              return (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  onClick={onNavigate}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />
                  <span className="flex-1 truncate">{p.title}</span>
                  {p.demo_attempt >= 2 && (
                    <span className="shrink-0 text-[10px] font-bold text-destructive">!</span>
                  )}
                </Link>
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

function SidebarBrand({ collapsed }) {
  return (
    <div className={cn('flex h-14 shrink-0 items-center border-b', collapsed ? 'justify-center px-2' : 'gap-2.5 px-4')}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
        <BookOpen className="h-4 w-4" />
      </span>
      {!collapsed && (
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">YZ Yayın Takip</p>
          <p className="-mt-0.5 text-[10px] text-muted-foreground">Yükselen Zeka</p>
        </div>
      )}
    </div>
  )
}

function SearchButton({ collapsed }) {
  if (collapsed) {
    return (
      <SidebarTooltip label="Hızlı ara">
        <button
          type="button"
          onClick={() => toast.message('Arama yakında eklenecek.')}
          aria-label="Hızlı ara"
          className="flex h-9 w-full items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground transition-colors hover:border-input hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="h-4 w-4" />
        </button>
      </SidebarTooltip>
    )
  }
  return (
    <button
      type="button"
      onClick={() => toast.message('Arama yakında eklenecek.')}
      className="flex w-full items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Search className="h-3.5 w-3.5" />
      <span className="flex-1 text-left">Hızlı ara…</span>
      <kbd className="rounded border bg-background px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
        ⌘K
      </kbd>
    </button>
  )
}

function SidebarSection({ title, collapsed, children }) {
  return (
    <div className={cn('mt-4', collapsed ? 'px-2' : 'px-3')}>
      {collapsed ? (
        <div className="mx-2 mb-1.5 border-t" />
      ) : (
        <div className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
      )}
      <nav className="space-y-0.5">{children}</nav>
    </div>
  )
}

const BADGE_DOT = {
  default: 'bg-muted-foreground',
  amber: 'bg-amber-500',
  pink: 'bg-pink-500',
}

function NavBadge({ count, tone = 'default', active }) {
  if (!count) return null
  const tones = {
    default: active
      ? 'bg-primary-foreground/20 text-primary-foreground'
      : 'bg-muted text-muted-foreground',
    amber: 'bg-amber-100 text-amber-700',
    pink: 'bg-pink-100 text-pink-700',
  }
  return (
    <span className={cn('ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold', tones[tone])}>
      {count}
    </span>
  )
}

function SidebarTooltip({ label, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function SidebarNavItem({ item, collapsed, onNavigate }) {
  const { icon: Icon, label, badge, badgeTone = 'default', soon } = item

  // Collapsed: icon-only with a tooltip and a small badge dot.
  if (collapsed) {
    const dot = badge ? (
      <span
        className={cn(
          'absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-card',
          BADGE_DOT[badgeTone],
        )}
      />
    ) : null

    if (soon) {
      return (
        <SidebarTooltip label={`${label} · yakında`}>
          <button
            type="button"
            onClick={() => toast.message(`${label} yakında eklenecek.`)}
            aria-label={label}
            className="relative flex h-9 w-full items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="h-4 w-4" />
            {dot}
          </button>
        </SidebarTooltip>
      )
    }

    return (
      <SidebarTooltip label={label}>
        <NavLink
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          aria-label={label}
          className={({ isActive }) =>
            cn(
              'relative flex h-9 w-full items-center justify-center rounded-md transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          <Icon className="h-4 w-4" />
          {dot}
        </NavLink>
      </SidebarTooltip>
    )
  }

  if (soon) {
    return (
      <button
        type="button"
        onClick={() => toast.message(`${label} yakında eklenecek.`)}
        className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-left">{label}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          Yakında
        </span>
      </button>
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
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="h-4 w-4" />
          <span className="flex-1">{label}</span>
          <NavBadge count={badge} tone={badgeTone} active={isActive} />
        </>
      )}
    </NavLink>
  )
}

function PeriodWidget({ satista, total }) {
  const pct = total ? Math.round((satista / total) * 100) : 0
  return (
    <div className="rounded-lg border border-primary/15 bg-primary/5 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
          Bu Dönem
        </div>
        <div className="text-[10px] text-muted-foreground">{pct}%</div>
      </div>
      <div className="mt-2 text-xs font-medium text-foreground">Hedef: projeleri satışa çıkar</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 text-[10px] text-muted-foreground">
        {satista} / {total} satışta
      </div>
    </div>
  )
}

function SidebarFooter({ user, onLogout, collapsed }) {
  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1 border-t p-2">
        <SidebarTooltip label={user?.name ?? 'Hesap'}>
          <Avatar className="h-8 w-8">
            <AvatarFallback>{initials(user?.name)}</AvatarFallback>
          </Avatar>
        </SidebarTooltip>
        <SidebarTooltip label="Çıkış yap">
          <Button
            variant="ghost"
            size="icon"
            onClick={onLogout}
            aria-label="Çıkış yap"
            className="h-8 w-8 text-muted-foreground"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </SidebarTooltip>
      </div>
    )
  }
  return (
    <div className="shrink-0 border-t p-2">
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
        <Avatar className="h-8 w-8">
          <AvatarFallback>{initials(user?.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium">{user?.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{ROLE_LABELS[user?.role]}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onLogout}
          aria-label="Çıkış yap"
          className="text-muted-foreground"
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
function buildNotifications(projects, user) {
  if (!user) return []
  const role = user.role
  const items = []

  for (const p of projects) {
    if (role === 'team_leader') {
      if (p.stage === 'demo_onay' || p.stage === 'ozalit_onay' || p.stage === 'cin_demo_onay') {
        items.push({ id: `${p.id}-onay`, projectId: p.id, tone: 'amber', title: p.title, text: 'Onayınızı bekliyor' })
      }
      if (p.stage === 'tasarim' && p.progress === 100) {
        items.push({ id: `${p.id}-ready`, projectId: p.id, tone: 'green', title: p.title, text: 'Tasarım tamamlandı, demoya hazır' })
      }
      if ((p.demo_attempt ?? 0) >= 2) {
        items.push({ id: `${p.id}-att`, projectId: p.id, tone: 'rose', title: p.title, text: `${p.demo_attempt}. demo denemesinde` })
      }
    } else if (role === 'printer') {
      if (p.type === 'TR' && (p.stage === 'demo_teslim' || p.stage === 'ozalit_teslim')) {
        const what = p.stage === 'demo_teslim' ? 'Demo teslim' : 'Özalit teslim'
        items.push({ id: `${p.id}-teslim`, projectId: p.id, tone: 'blue', title: p.title, text: `${what} — incelemenizi bekliyor` })
      }
    } else if (role === 'designer') {
      const mine = (p.assignees ?? []).some((a) => a.id === user.id)
      if (mine && p.stage === 'tasarim' && (p.demo_attempt ?? 0) > 0) {
        items.push({ id: `${p.id}-rej`, projectId: p.id, tone: 'rose', title: p.title, text: 'Revizyon gerekiyor — tasarıma geri döndü' })
      }
    }
  }
  return items
}

function NotificationBell({ projects, user, onOpenProject }) {
  const items = useMemo(() => buildNotifications(projects, user), [projects, user])
  const count = items.length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Bildirimler" className="relative">
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute right-1 top-1 grid h-4 min-w-[1rem] place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-background">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-semibold">Bildirimler</span>
          {count > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {count} yeni
            </span>
          )}
        </div>
        <DropdownMenuSeparator className="my-0" />
        {count === 0 ? (
          <div className="px-3 py-8 text-center">
            <Bell className="mx-auto mb-2 h-5 w-5 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Yeni bildirim yok</p>
          </div>
        ) : (
          <div className="scrollbar-thin max-h-80 overflow-y-auto py-1">
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onOpenProject(n.projectId)}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted focus:outline-none focus-visible:bg-muted"
              >
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', TONE_DOT[n.tone])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{n.title}</span>
                  <span className="block text-xs text-muted-foreground">{n.text}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu({ user, onLogout }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-1.5">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-[11px]">{initials(user?.name)}</AvatarFallback>
          </Avatar>
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
          <Link to="/team">Takım</Link>
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Sparkles className="h-4 w-4" />
          Ayarlar (yakında)
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
  { match: (p) => p.startsWith('/approvals'), label: 'Onay Kuyruğu' },
  { match: (p) => p.startsWith('/team'), label: 'Ekip' },
  { match: (p) => p.startsWith('/plan'), label: 'Yıllık Plan' },
  { match: (p) => p.startsWith('/demo'), label: 'Demo' },
  { match: (p) => p.startsWith('/my-projects'), label: 'Projelerim' },
  { match: (p) => p.startsWith('/projects/'), label: 'Proje Detayı' },
  { match: (p) => p === '/projects', label: 'Tüm Projeler' },
]

function Breadcrumb({ pathname }) {
  const page = PAGE_TITLES.find((x) => x.match(pathname))?.label ?? 'Panel'
  return (
    <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-sm sm:flex">
      <span className="text-muted-foreground">Çalışma Alanı</span>
      <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground/60" />
      <span className="font-medium text-foreground">{page}</span>
    </nav>
  )
}

/* ----------------------------- role nav ----------------------------- */

function navGroups(role, counts) {
  const genelItems = [
    { to: '/', label: 'Genel Bakış', icon: LayoutDashboard, end: true },
    { to: '/my-projects', label: 'Projelerim', icon: FolderKanban, badge: counts.myProjects, roles: ['designer'] },
    { to: '/kanban', label: 'İş Akışı', icon: Kanban, badge: counts.active },
    { to: '/projects', label: 'Tüm Projeler', icon: List, end: true, badge: counts.total },
    { to: '/plan', label: 'Yıllık Plan', icon: CalendarRange },
    { to: '/demo', label: 'Demo', icon: Presentation, roles: ['designer', 'team_leader'] },
  ].filter((i) => !i.roles || i.roles.includes(role))
  const genel = { title: 'Genel', items: genelItems }

  const yonetimAll = [
    {
      to: '/approvals',
      label: 'Onay Kuyruğu',
      icon: CheckCircle2,
      badge: counts.approvals,
      badgeTone: 'amber',
      roles: ['printer', 'team_leader'],
    },
    {
      label: 'Baskı Takip',
      icon: Printer,
      soon: true,
      badge: counts.production,
      badgeTone: 'pink',
      roles: ['printer', 'team_leader'],
    },
    { to: '/team', label: 'Ekip', icon: Users, roles: ['team_leader'] },
    { label: 'Toplantılar', icon: CalendarClock, soon: true },
  ]

  const yonetimItems = yonetimAll.filter((i) => !i.roles || i.roles.includes(role))
  const groups = [genel]
  if (yonetimItems.length > 0) groups.push({ title: 'Yönetim', items: yonetimItems })
  return groups
}
