import OrderBadge from '@/components/OrderBadge'
import { STATUS_META, statusKeyForProject } from '@/api'
import { cn, initials } from '@/lib/utils'

// YearPlan compact uses `surfaceBar` (-100, very pale) → foreground text
// reads fine. Dashboard comfortable uses `barSoft` (-300/-400) → dark
// stone text keeps contrast without the muddy chocolate fill we used to
// paint the progress track with.
function barText(variant) {
  return variant === 'comfortable' ? 'text-stone-800' : 'text-foreground/80'
}

// Bar visual variants. The compact variant matches YearPlan page density;
// comfortable matches the Dashboard's 48px embed.
const VARIANT_STYLES = {
  // YearPlan — dense 36px bar, two-tone (tinted background + saturated
  // progress track), brightness on hover, order badge inline.
  compact: {
    bar: 'h-9 px-1.5 rounded-md',
    avatar: 'h-[18px] w-[18px] text-[9px]',
    title: 'text-[11px]',
    chip: 'rounded bg-white/70 px-1 text-[10px] text-foreground/70',
    progressTrack: 'inset-x-1.5 bottom-1 h-1',
    progressBar: 'h-full rounded-full',
    hover: 'hover:shadow-md hover:brightness-105',
    showOrderBadge: true,
  },
  // Dashboard — taller 48px bar, lifts on hover. Pastel fill so the row
  // of large bars doesn't read as a wall of saturated colour; the
  // Dashboard has its own hover card so the bar doesn't need to be the
  // colour carrier.
  comfortable: {
    bar: 'h-12 px-3 rounded-full',
    avatar: 'h-6 w-6 text-[10px]',
    title: 'text-xs',
    chip: 'rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]',
    progressTrack: 'inset-x-3 bottom-1.5 h-1',
    progressBar: 'h-full rounded-full',
    hover: 'hover:-translate-y-[54%] hover:shadow-lg hover:brightness-105',
    showOrderBadge: true,
  },
}

/**
 * Yıllık Plan bar (no popover).
 *
 * The colored chip — status color + avatar + title + optional order badge +
 * progress fill — that anchors a project to its date range on the timeline.
 * Clicking the bar calls the `onClick` prop (callers pass a navigation handler).
 * Hover does nothing.
 */
export default function YearPlanBar({
  project,
  orders,
  leftPct,
  widthPct,
  animationDelay,
  variant = 'compact',
  onClick,
}) {
  const v = VARIANT_STYLES[variant] ?? VARIANT_STYLES.compact
  const key = statusKeyForProject(project)
  const meta = STATUS_META[key]

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${project.title} — projeyi aç`}
      style={{
        left: `calc(${leftPct}% + 4px)`,
        width: `calc(${widthPct}% - 8px)`,
        animationDelay: `${animationDelay}ms`,
      }}
      className={cn(
        'yp-bar-draw group absolute top-1/2 -translate-y-1/2 flex-col justify-center overflow-hidden shadow-sm',
        v.bar,
        // The comfortable variant lifts the bar; the compact variant
        // just brightens. Both keep the bar's resting position
        // stable so the schedule read isn't disturbed on hover.
        v.hover,
        'transition-[box-shadow,filter] duration-200 ease-out',
        variant === 'comfortable' && 'transition-[transform,box-shadow,filter] duration-150 ease-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'motion-reduce:transition-none',
        // Two-tone: YearPlan compact = tinted surface (-100) so the
        // saturated progress track at the bottom carries the colour.
        // Dashboard comfortable uses the softer -300/-400 fill (barSoft)
        // so the bar reads as gentle, not heavy — a previous -600/-700
        // barFill here was visually loud.
        variant === 'comfortable' ? meta.barSoft : meta.surfaceBar,
        barText(variant),
      )}
    >
      <div className="flex items-center gap-1.5 pb-1">
        <span
          className={cn(
            // Saturated avatar circle on the tinted compact bar so the
            // initials read; on comfortable (softer fill) the dark
            // ring-around-text variant reads better than the white ghost.
            'grid shrink-0 place-items-center rounded-full font-semibold ring-1',
            variant === 'comfortable'
              ? 'bg-white/70 ring-black/10 text-stone-800'
              : cn(meta.barFill, 'text-white ring-white/50'),
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
          <OrderBadge orders={orders} className="text-current opacity-90" iconClassName="h-3 w-3" />
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
            // Compact: saturated barFill against the pale -100 chip.
            // Comfortable: same-family barProgress so a full yellow
            // pill gets a gold track, not a chocolate underline.
            variant === 'comfortable' ? meta.barProgress : meta.barFill,
          )}
          style={{
            width: `${project.progress}%`,
            animationDelay: `${animationDelay + 200}ms`,
          }}
        />
      </div>
    </button>
  )
}