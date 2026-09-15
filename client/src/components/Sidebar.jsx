import { Link, NavLink } from 'react-router-dom'
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
          <div className="sticky bottom-0 mt-4 border-t border-border bg-background px-4 pb-3 pt-4 shadow-[0_-4px_8px_-4px_rgba(0,0,0,0.06)]">
            <PeriodWidget />
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
  {
    id: 'bilsem',
    label: 'BİLSEM Yılı',
    blurb: 'Yeni okul yılı başlıyor',
    // Eylül–Ekim, Aralık–Haziran (Kasım is its own season — see below).
    months: [8, 9, 11, 0, 1, 2, 3, 4, 5],
  },
  {
    id: 'kasim',
    label: 'Kasım Dönemi',
    blurb: 'BİLSEM sınav dönemi',
    months: [10],
  },
  {
    id: 'yaza',
    label: 'Yaza Hazırlık',
    blurb: 'Yaz dönemi öncesi son viraj',
    months: [6, 7],
  },
]

function nextSeasonAfter(now) {
  const m = now.getMonth()
  const currentIdx = SEASONS.findIndex((s) => s.months.includes(m))
  // Cycle order: BİLSEM Yılı → Kasım Dönemi → Yaza Hazırlık → BİLSEM Yılı.
  // Kasım is a featured month inside the broader school year but is
  // treated as its own season boundary so the widget can flag it
  // separately.
  const next = SEASONS[(currentIdx + 1) % SEASONS.length]
  // Pick the season's *first* month in calendar order, not the array
  // minimum. BİLSEM's months wrap across the year boundary (Sep..Dec,
  // Jan..Jun) so the array minimum is January — we want September
  // because that's the season's *start*. Find the smallest month in
  // `next.months` that is strictly greater than now's month; if none
  // exists (we're past the last one), the start is in the next year.
  const orderedMonths = [...next.months].sort((a, b) => a - b)
  const firstMonth =
    orderedMonths.find((mm) => mm > m) ??
    // None of next.months is strictly greater than now's month → the
    // season already wrapped past us in this calendar year. Its start
    // is the *first* month of next year.
    orderedMonths[0]
  const year = now.getFullYear() + (firstMonth <= m ? 1 : 0)
  return { ...next, start: new Date(year, firstMonth, 1) }
}

// Days between two dates, floored to the start of "from". Two Date objects
// at different times of day would otherwise drift; anchoring both at
// local midnight keeps the count stable for a given calendar day.
// `Math.round` is used (not `floor`) so a "23h59m" gap still counts as a
// full day rather than 0.
function daysBetween(from, to) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  const ms = b.getTime() - a.getTime()
  return Math.max(0, Math.round(ms / 86_400_000))
}

function PeriodWidget() {
  const now = new Date()
  // The widget only answers one question: when does the next season start?
  // `nextSeason` walks the SEASONS list in order from the current one and
  // picks the first boundary strictly after now.
  const nextSeason = nextSeasonAfter(now)
  // Always show days — the day count is more precise and never lies
  // ("47 gün kaldı" is more honest than "2 ay kaldı" when the season
  // is 7 weeks away). The user asked for days over months, so the
  // month-based unit switch is gone.
  const value = daysBetween(now, nextSeason.start)
  const unit = 'gün kaldı'

  // Same season palette as the Yıllık Plan tabs in Dashboard.jsx so this
  // widget reads as part of the same visual language.
  //   • Yaza Hazırlık  → orange (matches Jul/Aug tabs)
  //   • BİLSEM Yılı    → sky blue (matches Sep/Oct, Dec–Jun tabs)
  //   • Kasım Dönemi   → deep cobalt blue (matches the featured Kasım
  //                       tab — darker than the rest of school year on
  //                       purpose so it pops as the exam-cycle month)
  const BAND_CLASSES = {
    yaza:   'bg-orange-300 dark:bg-orange-700',
    bilsem: 'bg-sky-300 dark:bg-sky-800',
    kasim:  'bg-[#0B4ED2] dark:bg-blue-700',
  }
  const bandClass = BAND_CLASSES[nextSeason.id] ?? BAND_CLASSES.bilsem

  return (
    // Outer "tab" — same outline + corner treatment as a Yıllık Plan tab:
    // 1px black border, rounded top corners only, the season band fills
    // the whole upper portion so the rounded top corners show through.
    <div
      className={cn(
        'overflow-hidden rounded-t-md border border-b-0 border-black',
        bandClass,
      )}
    >
      {/* Season-tinted band — matches the tab's colored header bar,
          bumped from h-5 to h-6 so the colored top stripe carries more
          visual weight. */}
      <div className="h-6 w-full" />

      {/* White body — the tab's month-label surface, re-purposed for the
          widget content. Same rounded-t-md + bold black treatment, but
          with generous padding so the widget feels substantial in the
          sidebar instead of cramped against the user row below. */}
      <div className="rounded-t-md bg-white px-4 pb-4 pt-3 text-black">
        {/* Eyebrow — bold black, uppercase, tight tracking, mirroring the
            tab label's font weight. "Yaklaşan Sezon" reads more naturally
            than "Sıradaki Sezon" when the headline below already names
            the season. */}
        <div className="text-[11px] font-black uppercase leading-none tracking-[0.14em] text-black/70">
          Yaklaşan Sezon
        </div>

        {/* Hero — the season name as the editorial headline. Fraunces
            at maximum drama: heaviest weight (900), italic, and opened
            up via the variable font's opsz axis to 144 so the display
            serifs really bloom at this size. The italic + 900 combo
            gives the season name a magazine-cover feel rather than a
            plain tab label. */}
        <div
          className="mt-2 font-display text-[28px] leading-[1.0] text-black"
          style={{
            fontWeight: 900,
            fontStyle: 'italic',
            fontVariationSettings: '"opsz" 144, "SOFT" 100',
            letterSpacing: '-0.02em',
          }}
        >
          {nextSeason.label}
        </div>

        {/* Metric row — the countdown in a chunky numeric type so it
            reads at a glance. Bumped to text-3xl so it has real presence
            as the widget's anchor. Switches from "X ay kaldı" to "X gün
            kaldı" inside the final ~2 months so the user gets a precise
            countdown when it matters. Tabular-nums keeps digit widths
            stable across the unit switch. */}
        <div className="mt-3 flex items-baseline gap-1.5">
          <span className="font-mono text-3xl font-black leading-none tabular-nums text-black">
            {value}
          </span>
          <span className="text-[11px] font-bold uppercase leading-none tracking-wider text-black/70">
            {unit}
          </span>
        </div>
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