import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import OrderBadge from '@/components/OrderBadge'
import { STATUS_META, statusKeyForProject, STAGE_LABELS, TYPE_LABELS } from '@/api'
import { cn, initials, formatRelativeTr, daysUntilTargetEnd } from '@/lib/utils'

// Yellow (Satışta) and peach (Üretimde) bars need dark text for AA contrast.
function barText(key) {
  return key === 'yellow' || key === 'pink' ? 'text-[#5A3017]' : 'text-white'
}

// Bar visual variants. The popover content is shared; only the bar
// surface (height, padding, hover affordance) differs between the
// compact YearPlan page and the roomier Dashboard embed.
const VARIANT_STYLES = {
  // YearPlan — dense 36px bar, brightness on hover, order badge inline.
  // The progress fill flips to dark amber on yellow/pink bars so it stays
  // visible against the lighter -500 bar background.
  compact: {
    bar: 'h-9 px-1.5',
    avatar: 'h-[18px] w-[18px] text-[9px]',
    title: 'text-[11px]',
    chip: 'text-[10px] opacity-90',
    progressTrack: 'inset-x-1.5 bottom-1 h-1',
    progressBar: 'h-full',
    hover: 'hover:shadow-md hover:brightness-105',
    showOrderBadge: true,
  },
  // Dashboard — taller 48px bar, lifts on hover, no in-bar order badge
  // (Dashboard doesn't fetch open orders, so the badge would always
  // be absent and the popover handles the order state instead).
  comfortable: {
    bar: 'h-12 px-3',
    avatar: 'h-6 w-6 text-[10px]',
    title: 'text-xs',
    chip: 'rounded bg-white/20 px-1.5 py-0.5 text-[10px]',
    progressTrack: 'inset-x-3 bottom-1.5 h-1',
    progressBar: 'h-full rounded-full bg-white/95',
    hover: 'hover:-translate-y-[54%] hover:shadow-lg hover:brightness-105',
    showOrderBadge: false,
  },
}

// Hover-open delays. 200ms in to keep quick passes from flashing the
// popover; 100ms out to let the cursor reach the popover content without
// it dismissing mid-move. Tuned to feel like a real hover-card, not a
// click-to-open modal.
const OPEN_DELAY_MS = 200
const CLOSE_DELAY_MS = 120

/**
 * Yıllık Plan bar + rich hover popover.
 *
 * The bar is the same colored chip it's always been (status color +
 * avatar + title + order badge + progress fill), but the native
 * `title=""` tooltip is replaced by a shadcn/Radix Popover that shows
 * on hover with a 200ms delay. The popover surfaces information the
 * bar itself can't carry without truncating:
 *   - full project title
 *   - status badge + market tag
 *   - assignee avatar stack (first two + "N atanmış" count)
 *   - 3-cell stat row: İlerleme, Kalan, Son aktivite
 *   - explicit "Projeyi aç" CTA
 *
 * The popover is portal'd so it escapes the chart's `overflow-x-auto`
 * container, and Radix's collision-aware placement keeps it on-screen
 * for bars near either edge of the year.
 */
export default function YearPlanBarPopover({
  project,
  order,
  leftPct,
  widthPct,
  animationDelay,
  variant = 'compact',
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const openTimer = useRef(null)
  const closeTimer = useRef(null)
  const v = VARIANT_STYLES[variant] ?? VARIANT_STYLES.compact

  function clearTimers() {
    if (openTimer.current) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  function scheduleOpen() {
    clearTimers()
    openTimer.current = setTimeout(() => {
      openTimer.current = null
      setOpen(true)
    }, OPEN_DELAY_MS)
  }

  function scheduleClose() {
    clearTimers()
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
    }, CLOSE_DELAY_MS)
  }

  function openNow() {
    clearTimers()
    setOpen(true)
  }

  function closeNow() {
    clearTimers()
    setOpen(false)
  }

  const key = statusKeyForProject(project)
  const meta = STATUS_META[key]
  const days = daysUntilTargetEnd(project.target_month)
  const lastActivityIso = project.updated_at || project.created_at
  // Build the assignee list. `assignees` (the merged per-subtask array
  // built in project-repository.js) is the source of truth; fall back
  // to the single primary for projects that don't carry the array.
  const assignees =
    project.assignees?.length > 0
      ? project.assignees
      : project.assigned_name
        ? [{ id: project.assigned_to, name: project.assigned_name }]
        : []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={() => navigate(`/projects/${project.id}`)}
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
          onFocus={openNow}
          onBlur={closeNow}
          aria-label={`${project.title} — detayları göster`}
          style={{
            left: `calc(${leftPct}% + 4px)`,
            width: `calc(${widthPct}% - 8px)`,
            animationDelay: `${animationDelay}ms`,
          }}
          className={cn(
            'yp-bar-draw group absolute top-1/2 -translate-y-1/2 flex-col justify-center overflow-hidden rounded-md shadow-sm',
            v.bar,
            // The comfortable variant lifts the bar; the compact variant
            // just brightens. Both keep the bar's resting position
            // stable so the schedule read isn't disturbed on hover.
            v.hover,
            'transition-[box-shadow,filter] duration-200 ease-out',
            variant === 'comfortable' && 'transition-[transform,box-shadow,filter] duration-150 ease-out',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            'motion-reduce:transition-none',
            // YearPlan page used the -500 shade (meta.dot), Dashboard
            // used the darker -600/-700 shade (meta.barFill) for visual
            // prominence. The comfortable variant follows Dashboard's
            // convention; the compact variant follows YearPlan's.
            variant === 'comfortable' ? meta.barFill : meta.dot,
            barText(key),
          )}
        >
          <div className="flex items-center gap-1.5 pb-1">
            <span
              className={cn(
                'grid shrink-0 place-items-center rounded-full bg-white/25 font-semibold ring-1 ring-white/40',
                v.avatar,
              )}
              title={project.assigned_name}
            >
              {initials(project.assignees?.[0]?.name ?? project.assigned_name)}
            </span>
            <span className={cn('truncate font-semibold leading-none', v.title)}>
              {project.title}
            </span>
            {v.showOrderBadge && (
              <OrderBadge order={order} className="h-3 w-3 shrink-0 opacity-90" />
            )}
            <span className={cn('ml-auto shrink-0 font-semibold tabular-nums', v.chip)}>
              %{project.progress}
            </span>
          </div>
          {/* progress bar — animates width via the same clip-path technique.
              Without the wrapper, the bar's own width would jump. */}
          <div className={cn('absolute overflow-hidden rounded-full bg-black/20', v.progressTrack)}>
            <div
              className={cn(
                'yp-bar-draw',
                v.progressBar,
                // Compact variant inverts on the two light-bar colors
                // (yellow/pink) so the fill is still readable.
                variant === 'compact' &&
                  (key === 'yellow' || key === 'pink'
                    ? 'bg-[#5A3017] rounded-full'
                    : 'bg-white rounded-full'),
              )}
              style={{
                width: `${project.progress}%`,
                animationDelay: `${animationDelay + 200}ms`,
              }}
            />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        side="top"
        sideOffset={10}
        onPointerEnter={clearTimers}
        onPointerLeave={scheduleClose}
        // Stop clicks inside the popover from propagating to the bar
        // button underneath (the bar still navigates on click when the
        // popover is closed).
        onClick={(e) => e.stopPropagation()}
        className="w-72 p-0"
      >
        <BarPopoverBody
          project={project}
          meta={meta}
          order={order}
          key_={key}
          assignees={assignees}
          days={days}
          lastActivityIso={lastActivityIso}
          onOpenProject={() => {
            closeNow()
            navigate(`/projects/${project.id}`)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Pure presentational body for the popover. Extracted from the wrapper
 * so the bar-trigger / hover-state machinery above doesn't re-render the
 * (read-only) body on every state toggle.
 */
function BarPopoverBody({
  project,
  meta,
  order,
  key_,
  assignees,
  days,
  lastActivityIso,
  onOpenProject,
}) {
  const primary = assignees[0]
  const visible = assignees.slice(0, 2)
  const more = assignees.length - visible.length
  return (
    <div className="space-y-3">
      {/* Status + market */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1',
            meta.badge,
          )}
        >
          {meta.label}
        </span>
        {project.type && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border">
            {TYPE_LABELS[project.type] ?? project.type}
          </span>
        )}
      </div>

      {/* Title — full, wraps, no truncation */}
      <h3 className="text-[13px] font-semibold leading-snug text-foreground">
        {project.title}
      </h3>

      {/* Assignee stack — first two avatars + "N atanmış" count */}
      {assignees.length > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="flex -space-x-1.5">
            {visible.map((a, i) => (
              <span
                key={a.id ?? i}
                title={a.name}
                className={cn(
                  'grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold ring-2 ring-popover',
                  // Mirror the per-user hue convention used by the
                  // AssigneeAvatars component so the popover matches
                  // the rest of the app.
                  i === 0
                    ? 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-100'
                    : 'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-100',
                )}
              >
                {initials(a.name)}
              </span>
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {assignees.length} atanmış
          </span>
        </div>
      )}

      {/* Stat row */}
      <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-center">
        <div>
          <div className="text-[10px] text-muted-foreground">İlerleme</div>
          <div className="text-[12px] font-bold tabular-nums">
            {project.progress}%
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Kalan</div>
          <div className="text-[12px] font-bold tabular-nums">
            {days == null ? '—' : days > 0 ? `${days}g` : '—'}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Son aktivite</div>
          <div className="text-[12px] font-bold">
            {formatRelativeTr(lastActivityIso)}
          </div>
        </div>
      </div>

      {/* Order state — only when there's an open sipariş in flight */}
      {order && (
        <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900">
          <OrderBadge order={order} className="h-3.5 w-3.5 text-amber-600" />
          <span>Baskı bekliyor</span>
        </div>
      )}

      {/* Open CTA */}
      <button
        type="button"
        onClick={onOpenProject}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground py-1.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        Projeyi aç
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
