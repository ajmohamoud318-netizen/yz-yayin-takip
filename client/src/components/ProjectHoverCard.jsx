import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import OrderBadge from '@/components/OrderBadge'
import { STATUS_META, statusKeyForProject, TYPE_LABELS } from '@/api'
import { cn, initials, formatRelativeTr, daysUntilTargetEnd } from '@/lib/utils'

// Hover-open delays. 200ms in to keep quick passes from flashing the
// popover; 120ms out to let the cursor reach the popover content without
// it dismissing mid-move. Tuned to feel like a real hover-card, not a
// click-to-open modal. Same numbers the previous Yıllık Plan bar used,
// so the affordance feels identical for anyone who already learned it.
const OPEN_DELAY_MS = 200
const CLOSE_DELAY_MS = 120

/**
 * Generic hover-card wrapper for a project.
 *
 * Wraps any `children` in a Radix Popover that opens on hover (200ms in,
 * 120ms out) and renders the rich body the Yıllık Plan bars used to show:
 * status badge + market tag, full title, assignee avatar stack, 3-cell
 * stat row (İlerleme / Kalan / Son aktivite), optional "Baskı bekliyor"
 * pill, and a "Projeyi aç" CTA.
 *
 * Click on the trigger is *not* intercepted — it bubbles up to whatever
 * click target the parent set up (e.g. the row's navigate handler). The
 * body handles its own CTA click via `onOpenProject`.
 */
export default function ProjectHoverCard({
  project,
  order,
  children,
  side = 'top',
  align = 'center',
  sideOffset = 10,
  className,
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const openTimer = useRef(null)
  const closeTimer = useRef(null)

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
        <div
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
          onFocus={openNow}
          onBlur={closeNow}
          // Block-level wrapper so the trigger fills its container
          // (table cell, card body). Consumers that need a different
          // shape can pass `className` and override.
          className={cn('block w-full', className)}
        >
          {children}
        </div>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        onPointerEnter={clearTimers}
        onPointerLeave={scheduleClose}
        // Stop clicks inside the popover from propagating to the trigger
        // underneath (the row still navigates on click when the popover
        // is closed).
        onClick={(e) => e.stopPropagation()}
        className="w-72 p-0"
      >
        <HoverCardBody
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
 * Pure presentational body for the hover card. Extracted from the wrapper
 * so the trigger / hover-state machinery above doesn't re-render the
 * (read-only) body on every state toggle.
 */
function HoverCardBody({
  project,
  meta,
  order,
  key_,
  assignees,
  days,
  lastActivityIso,
  onOpenProject,
}) {
  const visible = assignees.slice(0, 2)
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
                    ? 'bg-blue-200 text-blue-800'
                    : 'bg-amber-200 text-amber-800',
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
        <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 ring-1 ring-amber-200">
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