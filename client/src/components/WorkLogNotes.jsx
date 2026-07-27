import { useState } from 'react'
import { cn } from '@/lib/utils'
import { formatClock, formatMinutes, kindMeta } from '@/lib/work-log.js'

/**
 * Read-only render of one person's Çalışma Defteri for today — used on the
 * /team cards so the leader can see *why* a project hasn't moved without
 * asking. Composer lives in WorkLogPill.jsx; this half never writes.
 *
 * Why it's a quoted block and not the one-line italic it replaced: the note
 * is the answer to a question the leader is actively asking, so it earns a
 * surface of its own. The kind's colour runs down the left edge as a 2px
 * rule, which lets a leader scanning a 3-column grid tell "toplantı" from
 * "başka proje" before reading a single word.
 *
 * Only the first two entries render; the rest sit behind a counter so one
 * chatty designer can't make their card three times the height of everyone
 * else's and break the grid rhythm.
 */

const PREVIEW_COUNT = 2

export default function WorkLogNotes({ entries, className }) {
  const [expanded, setExpanded] = useState(false)
  if (!entries?.length) return null

  const hidden = entries.length - PREVIEW_COUNT
  const visible = expanded ? entries : entries.slice(0, PREVIEW_COUNT)
  // The card's accent follows the FIRST entry of the day — it's the one that
  // set the tone for that person's morning.
  const lead = kindMeta(entries[0].kind)

  return (
    <div className={cn('relative rounded-md bg-muted/40 py-1.5 pl-3 pr-2', className)}>
      <span
        aria-hidden="true"
        className={cn('absolute bottom-1.5 left-0 top-1.5 w-[2px] rounded-full', lead.rule)}
      />
      <ul className="space-y-1.5">
        {visible.map((entry) => {
          const meta = kindMeta(entry.kind)
          const duration = formatMinutes(entry.minutes)
          return (
            <li key={entry.id}>
              <p className="line-clamp-2 text-[12px] leading-snug text-foreground" title={entry.body}>
                {entry.body}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">
                <span className={cn('rounded px-1 py-px font-medium ring-1', meta.chip)}>
                  {meta.short}
                </span>
                {duration && <span>{duration}</span>}
                <span className="tabular-nums opacity-70">{formatClock(entry.created_at)}</span>
              </p>
            </li>
          )
        })}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 text-[10px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          {expanded ? 'Daha az göster' : `+${hidden} kayıt daha`}
        </button>
      )}
    </div>
  )
}

/**
 * The small coloured dot on a user's avatar. Same colour language as the
 * notes block, so the dot is a legible preview of the block below rather
 * than a generic "has something" marker.
 */
export function WorkLogAvatarDot({ entries, className }) {
  if (!entries?.length) return null
  const meta = kindMeta(entries[0].kind)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card',
        meta.dot,
        className,
      )}
    />
  )
}
