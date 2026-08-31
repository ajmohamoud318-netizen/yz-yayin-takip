import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BadgeCheck,
  Bell,
  BellRing,
  CheckCircle2,
  ClipboardList,
  EyeOff,
  Factory,
  FileText,
  PackageCheck,
  RotateCcw,
  Send,
  Ship,
  Tag,
  Trash2,
  Truck,
  UserPlus,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useNotifications } from '@/hooks/useNotifications'
import { cn } from '@/lib/utils'
import PushToggle from '@/components/PushToggle.jsx'

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
  demo_edited: FileText,
  ozalit_edited: FileText,
  ozalit_delivery_pending: Send,
  ozalit_receipt_pending: Truck,
  ozalit_received: PackageCheck,
  ozalit_approval_pending: BadgeCheck,
  baski_onay_pending: BadgeCheck,
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
export default function NotificationBell() {
  const navigate = useNavigate()
  const { items, unseen, markRead, markAllRead, markSeen } = useNotifications()
  const [menuOpen, setMenuOpen] = useState(false)

  // Radix's dismissable-layer close can leave `pointer-events: none` stuck on
  // <body> when the menu closes right before a route change — hit this exact
  // bug before with the old project-detail Sheet. The setTimeout below defers
  // navigation, but doesn't guarantee Radix's own teardown has finished, so
  // reset the lock once the menu is actually closed rather than relying on
  // that race.
  useEffect(() => {
    if (menuOpen) return undefined
    const id = requestAnimationFrame(() => {
      if (document.body.style.pointerEvents === 'none') {
        document.body.style.pointerEvents = ''
      }
    })
    return () => cancelAnimationFrame(id)
  }, [menuOpen])

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
          size="sm"
          aria-label="Bildirimler"
          className={cn(
            'relative h-9 w-9 rounded-full p-0',
            unseen > 0 && !menuOpen && 'bell-pulse',
          )}
        >
          <BellRing className="h-9 w-9" />
          {unseen > 0 && (
            <span className="absolute right-0.5 top-0.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold leading-none text-white ring-2 ring-background">
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
          // 28rem (~448 px) instead of the old 20rem (320 px) so a full screen
          // of unread items doesn't shove the "Tümünü okundu say" / PushToggle
          // actions off-screen. Scrolling still kicks in once you exceed it.
          <div className="scrollbar-thin max-h-[28rem] overflow-y-auto py-1">
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
                  <span className="mt-0.5 block text-[10px] font-medium text-muted-foreground/80 tabular-nums">{relativeTime(n.created_at)}</span>
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