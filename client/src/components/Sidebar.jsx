import { Link, NavLink, useNavigate } from 'react-router-dom'
import { LogOut, MoreVertical } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import UserAvatar from '@/components/UserAvatar.jsx'
import { ROLE_LABELS } from '@/api'
import { cn } from '@/lib/utils'
import WorkLogPill from '@/components/WorkLogPill'

/**
 * Sidebar used by AppShell on wide screens (collapsible rail) and inside the
 * mobile drawer (always expanded). The same component is rendered in both
 * places — the `collapsed` prop is the only difference. Caller is responsible
 * for the wrapping <aside> / <Sheet> + safe-area padding.
 *
 * Split into SidebarBrand + SidebarSection + SidebarNavItem + PeriodWidget +
 * SidebarFooter so each piece can be tweaked without touching the others —
 * e.g. "change the bell" never needs to scroll past the rail's body.
 */
export default function Sidebar({ collapsed, groups, counts, user, onLogout, onNavigate, onToggleCollapsed, onOpenProject }) {
  // Same rule as the "Acil İşler" group in navGroups(): the period goal is
  // leader/designer context. Matbaa gets the nav and its own queues, nothing
  // else.
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

        {!collapsed && showOverview && (
          // Sticky to the bottom of the scroll container so the goal widget
          // stays in view no matter how tall the nav above it gets. The
          // shadow + border-top only render when the section above is
          // actually scrolling under it (via `data-stuck` toggled by a tiny
          // IntersectionObserver in a follow-up — for now the shadow is
          // always on so the visual separation is reliable regardless of
          // scroll position).
          <div className="sticky bottom-0 mt-4 border-t border-border bg-background px-3 pb-2 pt-3 shadow-[0_-4px_8px_-4px_rgba(0,0,0,0.06)]">
            <PeriodWidget satista={counts.satista} total={counts.total} />
          </div>
        )}
      </div>
      <SidebarFooter user={user} onLogout={onLogout} collapsed={collapsed} />
    </>
  )
}

const YZ_LOGO_BLACK = '/yz_blacklogo.svg'

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
          <img src={YZ_LOGO_BLACK} alt="Yükselen Zeka" className="block h-7 w-auto max-w-full object-contain" />
        </Link>
      )}
      <button
        type="button"
        aria-label={collapsed ? 'Kenar çubuğunu açın' : 'Kenar çubuğunu kapatın'}
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
  // "Look here" treatment (amber + pink tones in navGroups) → solid brand
  // pill. Stays rose-burgundy (bg-primary) instead of an off-palette
  // rose-500 so the badge colour always matches the rest of the chrome.
  if (tone === 'amber' || tone === 'pink') {
    return (
      <span className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary-foreground">
        {count}
      </span>
    )
  }
  // Context badge (default tone) → quiet cream pill, vivid rose-tinted
  // when its row is active. `tabular-nums` keeps widths steady between
  // 1- and 2-digit counts so the layout never twitches when a count
  // bumps from 9 → 10.
  return (
    <span
      className={cn(
        'ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
        active ? 'bg-rose-100 text-primary' : 'bg-muted text-muted-foreground',
      )}
    >
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
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              aria-label={label}
              className="relative flex h-9 w-full items-center justify-center rounded-md text-muted-foreground/60"
            >
              <Icon className="h-5 w-5" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                'relative flex h-9 w-full items-center justify-center rounded-md transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                // In collapsed (icon-only) mode there is no horizontal
                // room for the left bar — fall back to a filled brand
                // square with a white icon so the active item is still
                // unambiguous at a glance.
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                highlight && !isActive && 'nav-pulse-glow nav-bounce text-foreground',
              )
            }
          >
            <Icon className="h-5 w-5" />
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
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
          // The 3px left accent bar uses `before:` (absolute + inset of
          // 4px/8px so it sits inside the rounded-md corner) so the row's
          // text never shifts when the active state toggles.
          'group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive
            ? 'bg-rose-50 font-semibold text-primary before:pointer-events-none before:absolute before:left-1 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-primary before:content-[""]'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          highlight && !isActive && 'nav-pulse-glow nav-bounce text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn('h-5 w-5 shrink-0', isActive && 'text-primary')} />
          <span className="flex-1">{label}</span>
          <NavBadge count={badge} tone={badgeTone} active={isActive} />
        </>
      )}
    </NavLink>
  )
}

// Season model — mirrors Dashboard.jsx so the sidebar and the Yıllık Plan
// chart describe the same periods. Two seasons a year:
//
//   • "Yaza Hazırlık" (Temmuz–Ağustos) — short 2-month wrap-up before the
//     new school year starts in September.
//   • "BİLSEM Yılı"    (Eylül–Haziran) — the long active school year.
//
// Months are 0-indexed. The season that owns a given month is whichever
// `seasons[].months` array contains it. Since Eylül belongs to BİLSEM Yılı
// in the chart (SCHOOL_YEAR_MONTHS includes 8 = Eylül), the Eylül–Haziran
// set matches here too.
const SEASONS = [
  { id: 'bilsem', label: 'BİLSEM Yılı', months: [8, 9, 10, 11, 0, 1, 2, 3, 4, 5] },
  { id: 'yaza',   label: 'Yaza Hazırlık', months: [6, 7] },
]

function currentSeason(now = new Date()) {
  const m = now.getMonth()
  return SEASONS.find((s) => s.months.includes(m)) ?? SEASONS[0]
}

// Returns the first-day Date of the next season boundary strictly after
// `now`. Each season has a "first month" (the smallest index in its months
// array): yaza-hazırlık → 6 (Temmuz), school-year → 8 (Eylül). The next
// season is whichever of those first-of-month dates lands earliest at-or-
// after the current instant; if both have passed in the current calendar
// year, the next one is in the next calendar year.
//
// Worked examples:
//   • 15 Eylül 2026 → next m=6 is Temmuz 2026 (past), next m=8 is Eylül
//     2026 (present/just passed), so the earliest future date is Temmuz
//     2027 → "Yaza Hazırlık, 10 ay kaldı".
//   • 20 Temmuz 2026 → next m=6 is Temmuz 2026 (today, but the season
//     just started, so the strict-after rule uses 1 Ağustos 2026? — see
//     note below). We use "first-of-month strictly after now's first-of-
//     month" so the season-switch countdown is anchored to month starts,
//     which is what users actually plan against.
function nextSeasonStart(now) {
  const year = now.getFullYear()
  const month = now.getMonth()
  // First-of-month of the current month. The next-season boundary must be
  // strictly after THIS date so the countdown never lands on "0 ay kaldı"
  // on the first day of a fresh season.
  const cursor = new Date(year, month, 1).getTime()
  const candidates = [
    new Date(year, 6, 1).getTime(),     // Temmuz this year
    new Date(year, 8, 1).getTime(),     // Eylül this year
    new Date(year + 1, 6, 1).getTime(), // Temmuz next year
    new Date(year + 1, 8, 1).getTime(), // Eylül next year
  ]
  const next = candidates.find((t) => t > cursor)
  return new Date(next)
}

function monthsBetween(from, to) {
  // Whole months between two dates, rounded down. From the first day of one
  // month to the first day of another, the count is exact (no day-of-month
  // drift). E.g. 1 Eylül → 1 Temmuz = 10 months.
  return (
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth())
  )
}

const TR_MONTHS_FULL = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

function formatMonthYear(d) {
  const m = TR_MONTHS_FULL[d.getMonth()]
  return `${m} ${d.getFullYear()}`
}

function PeriodWidget({ satista, total }) {
  const pct = total ? Math.round((satista / total) * 100) : 0
  const now = new Date()
  const season = currentSeason(now)
  const start = nextSeasonStart(now)
  const monthsLeft = monthsBetween(now, start)

  // Click-through to the pipeline filtered to "Satışta" so the bar reads as
  // an actionable KPI rather than a static label.
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate('/kanban?stage=satista')}
      className="group block w-full rounded-lg border border-rose-200 bg-rose-50 p-3 text-left transition-colors hover:border-rose-300 hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Bu Sezon</div>
        <div className="font-mono text-[10px] font-semibold tabular-nums text-primary transition-transform group-hover:translate-x-0.5">{pct}%</div>
      </div>
      {/* Current season name in display type, plus a countdown to the next
          season switch so the user knows how much runway they have in this
          period. The season label is the headline; the months-left chip
          and start date are the supporting line. */}
      <div className="mt-1.5 text-xs font-medium text-foreground">{season.label}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 font-semibold text-primary">
          {monthsLeft} ay kaldı
        </span>
        <span>· {formatMonthYear(start)} başlar</span>
      </div>
      {/* Slightly thicker track that lives one step darker than the card
          itself (rose-100 on rose-50) so the whole card reads as a single
          monochromatic rose surface, and the percentage gets bolder so
          the 67% lands as the eye-catch instead of the eyebrow. */}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rose-100/70">
        <div
          className="h-full rounded-full bg-primary transition-[width,filter] duration-500 ease-out group-hover:brightness-110"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 text-[10px] text-muted-foreground">
        {satista} / {total} satışta
      </div>
    </button>
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
          aria-label="Çıkış yapın"
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
          aria-label="Çıkış yapın"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}