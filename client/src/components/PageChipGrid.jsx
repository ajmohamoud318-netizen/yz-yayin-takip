import { useState } from 'react'
import { AlertTriangle, Check, UserPlus, X } from 'lucide-react'

import {
  Popover, PopoverClose, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'
import UserAvatar from '@/components/UserAvatar.jsx'
import { cn, formatDateTr } from '@/lib/utils'
import { userColor, colorTint, designerColor } from '@/lib/userColor'

/**
 * migration 055 — per-page chip grid for the "İç Sayfalar" subtask.
 *
 * Each row of the project's alt görevler renders this component instead of a
 * single checkbox when kind === 'pages'. Three states per chip:
 *
 *   pending  → gray, click marks done (optimistic, PATCH /subtasks/:id/pages/N)
 *   done     → green, click clears back to pending (undo), small ↻ marks rework
 *   rework   → amber, click resolves back to done (the page shipped again)
 *
 * `rework_count` is rendered as a small badge on the chip — the team leader
 * uses it to spot pages that bounced more than once without having to scrape
 * stage_history. Auto-save keeps every click latency-free; no batched save
 * button for chips (see API user's earlier decision).
 *
 * migration 056 — per-page assignment. Every chip carries an owner pip
 * (top-left, colored circle when owned, muted "+" when not). For non-leaders
 * the pip is a read-only signal of who is supposed to do this page. For
 * team leaders an "Ata" button appears on hover to the right of the pip;
 * clicking it opens a Radix popover anchored to the chip with the full
 * active-designer list and an unassign row at the top. Picking a designer
 * (or unassigning) fires `onAssign(pageIndex, designerId | null)`, which the
 * page wires to PATCH /subtasks/:id/pages/:pageIndex/assign.
 *
 * Pages that haven't been seeded yet (a project created before migration 055
 * or a row dropped by a leader's edit) are rendered as pending placeholders
 * so the chip count still matches `total_pages`.
 */
export default function PageChipGrid({
  subtask,
  canEdit,
  flagged = false,
  activePage,
  user,
  isLeader = false,
  designers = [],
  onPageClick,
  onPageRework,
  onAssign,
}) {
  const [myPagesOnly, setMyPagesOnly] = useState(false)
  const total = Number(subtask.total_pages ?? 0)
  const pages = Array.isArray(subtask.pages) ? subtask.pages : []
  // Build a fully dense array so the chip count matches total_pages even if
  // the seed step missed a row (defensive; seedSubtaskPages is idempotent but
  // a brand-new request after the migration might race a refresh).
  const cells = Array.from({ length: total }, (_, idx) => {
    const i = idx + 1
    const found = pages.find((p) => p.i === i)
    return found ?? {
      i,
      status: 'pending',
      done_by_name: null,
      done_at: null,
      rework_count: 0,
      assigned_to: null,
      assigned_to_name: null,
    }
  })
  // The chip's "owner" is whoever should take credit for it visually. A
  // done chip belongs to whoever shipped it (done_by); a pending/rework
  // chip belongs to whoever is planned to do it (assigned_to). This is
  // the same distinction the data model carries (migration 056) — the
  // two can legitimately diverge when a leader reassigns mid-revision.
  function ownerOf(p) {
    return p.status === 'done' ? p.done_by : p.assigned_to
  }
  function ownerNameOf(p) {
    return p.status === 'done' ? p.done_by_name : p.assigned_to_name
  }
  const visibleCells = myPagesOnly && user
    ? cells.filter((c) => c.assigned_to === user.id || c.done_by === user.id)
    : cells
  const doneCount = visibleCells.filter((c) => c.status === 'done').length
  const reworkCount = visibleCells.filter((c) => c.status === 'rework').length
  const myCount = user
    ? cells.filter((c) => c.assigned_to === user.id || c.done_by === user.id).length
    : 0
  // Distinct owners visible in the current view, used to render the
  // color legend above the grid. Done by id (stable color) then resolved
  // to the most-recent name we have for them.
  const legend = (() => {
    const seen = new Map() // id -> name
    for (const c of visibleCells) {
      const id = ownerOf(c)
      if (!id) continue
      const name = ownerNameOf(c)
      if (!seen.has(id) || (seen.get(id) == null && name)) seen.set(id, name ?? null)
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name, color: userColor(id) }))
  })()
  // Filter the active designer roster to only those still actually usable
  // for assignment. `api.listUsers()` returns the full user list, including
  // deactivated accounts and non-designer roles — neither belongs in the
  // popover picker.
  const assignableDesigners = designers.filter((d) => d.role === 'designer' && d.is_active)
  return (
    <div className={cn(
      'rounded-lg border bg-background px-3 py-2.5 transition-colors',
      flagged && 'border-amber-300 bg-amber-50/50 ring-1 ring-inset ring-amber-300/60',
    )}>
      {flagged && (
        <div className="mb-2 flex items-center gap-1.5 rounded-md border border-amber-300/70 bg-amber-100/70 px-2 py-1 text-[11px] font-medium text-amber-800">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Demo revize edildi — sayfaları kontrol edin
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <span className="text-sm font-medium">{subtask.title}</span>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{doneCount} / {total} tamamlandı</span>
          {reworkCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              {reworkCount} revize
            </span>
          )}
          {user && myCount > 0 && (
            <button
              type="button"
              onClick={() => setMyPagesOnly((v) => !v)}
              aria-pressed={myPagesOnly}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold transition',
                myPagesOnly
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-primary',
              )}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: userColor(user.id) ?? '#888' }}
              />
              {myPagesOnly ? `Sadece benim (${myCount})` : `Benim sayfalarım (${myCount})`}
            </button>
          )}
        </div>
      </div>
      {/* Owner legend — same colour as the chips so the team leader learns
          "blue = Aylin" once and reads every chip grid the same way. Hidden
          when the filter is on (the only owner visible is the viewer). */}
      {!myPagesOnly && legend.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {legend.map(({ id, name, color }) => (
            <span key={id} className="inline-flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full ring-1 ring-inset ring-border/40"
                style={{ backgroundColor: color }}
              />
              {name ?? 'Bilinmeyen'}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {visibleCells.map((p) => (
          <PageChip
            key={p.i}
            subtaskId={subtask.id}
            subtaskTitle={subtask.title}
            cell={p}
            canEdit={canEdit}
            isLeader={isLeader}
            activePage={activePage}
            user={user}
            designers={assignableDesigners}
            onClick={() => onPageClick(p.i, p.status)}
            onRework={() => onPageRework(p.i)}
            onAssign={onAssign}
          />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  PageChip — one cell                                                */
/* ------------------------------------------------------------------ */

/**
 * Single chip + its corner affordances (owner pip, leader "Ata" button,
 * designer↻ rework). Pulling it out keeps the grid loop readable and lets
 * the assign popover sit next to the chip it belongs to without a portal
 * gymnastics problem.
 */
function PageChip({
  subtaskId,
  subtaskTitle,
  cell,
  canEdit,
  isLeader,
  activePage,
  user,
  designers,
  onClick,
  onRework,
  onAssign,
}) {
  const key = `${subtaskId}:${cell.i}`
  const isActive = activePage?.key === key
  // The owner colour drives both the chip border (and pending tint) and the
  // owner pip — sharing the helper guarantees the two stay in lock-step.
  const ownerId = cell.status === 'done' ? cell.done_by : cell.assigned_to
  const ownerColor = userColor(ownerId)
  const ownerTint = colorTint(ownerColor)
  const chipStyle = ownerColor
    ? {
        borderColor: ownerColor,
        backgroundColor: cell.status === 'pending' && ownerTint ? ownerTint : undefined,
      }
    : undefined
  const ownerName = cell.status === 'done' ? cell.done_by_name : cell.assigned_to_name
  const isAssigned = cell.status !== 'done' && cell.assigned_to
  // While an assign is inflight for THIS chip, the chip itself should
  // visually match the regular in-flight state (opacity-60) and the assign
  // popover should close so the user can't double-fire.
  const isAssignInFlight = activePage?.key === key && activePage?.status === 'assign'
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={!canEdit || isActive}
        aria-pressed={cell.status !== 'pending'}
        title={
          cell.status === 'done' && cell.done_by_name
            ? `${cell.done_by_name}${cell.done_at ? ` · ${formatDateTr(cell.done_at)}` : ''}${cell.rework_count > 0 ? ` · ${cell.rework_count}× revize` : ''}`
            : cell.status === 'rework'
              ? `Revize bekliyor${ownerName ? ` · ${ownerName}` : ''}${cell.rework_count > 0 ? ` · ${cell.rework_count}× revize` : ''}`
              : (ownerName ? `Atandı: ${ownerName}` : 'Bekliyor')
        }
        className={cn(
          'h-7 w-9 rounded-md border text-[11px] font-semibold transition',
          cell.status === 'pending' && !ownerColor && 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40',
          cell.status === 'pending' && ownerColor && 'text-foreground hover:brightness-95',
          cell.status === 'done' && !ownerColor && 'border-emerald-300 bg-emerald-100 text-emerald-700 hover:border-emerald-400',
          cell.status === 'done' && ownerColor && 'bg-emerald-100 text-emerald-800 hover:brightness-95',
          cell.status === 'rework' && !ownerColor && 'border-amber-300 bg-amber-100 text-amber-700 hover:border-amber-400',
          cell.status === 'rework' && ownerColor && 'bg-amber-100 text-amber-800 hover:brightness-95',
          isActive && 'opacity-60',
          !canEdit && 'cursor-default opacity-60',
        )}
        style={chipStyle}
      >
        {cell.i}
      </button>
      {/* Owner pip — top-left, mirrors the rework ↻ pip on top-right. For
          leaders it's the trigger that opens the assign popover (the "Ata"
          label appears next to it on hover). For non-leaders it's a
          plain span so the chip stays the same size for every viewer. */}
      <OwnerPip
        isLeader={isLeader}
        ownerColor={ownerColor}
        isAssigned={isAssigned}
        assignInFlight={isAssignInFlight}
        subtaskId={subtaskId}
        subtaskTitle={subtaskTitle}
        pageIndex={cell.i}
        currentAssigneeId={cell.assigned_to ?? null}
        currentAssigneeName={cell.assigned_to_name ?? null}
        designers={designers}
        onAssign={onAssign}
      />
      {canEdit && cell.status === 'done' && !isActive && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRework() }}
          title="Bu sayfayı revize et"
          aria-label={`Sayfa ${cell.i} revize`}
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white opacity-0 shadow ring-2 ring-background transition group-hover:opacity-100 focus:opacity-100"
        >
          ↻
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  OwnerPip — owner signal + leader "Ata" affordance                  */
/* ------------------------------------------------------------------ */

/**
 * Renders the colored owner dot on every chip (information layer for
 * everyone) and, for team leaders only, the hover-reveal "Ata" button that
 * opens the Radix popover anchored to the chip.
 *
 * The non-leader render path is a plain <span> — no click handler, no
 * popover wiring — so a designer viewing the page sees the same chip
 * footprint, with no spurious "Ata" button hint.
 */
function OwnerPip({
  isLeader,
  ownerColor,
  isAssigned,
  assignInFlight,
  subtaskId,
  subtaskTitle,
  pageIndex,
  currentAssigneeId,
  currentAssigneeName,
  designers,
  onAssign,
}) {
  const dot = (
    <span
      aria-hidden="true"
      title={
        currentAssigneeName
          ? `Atandı: ${currentAssigneeName}`
          : 'Atanmamış'
      }
      className={cn(
        'flex h-4 w-4 items-center justify-center rounded-full shadow ring-2 ring-background',
        ownerColor ? '' : 'bg-muted-foreground/30 text-background-foreground',
        !isLeader && 'cursor-default',
      )}
      style={ownerColor ? { backgroundColor: ownerColor } : undefined}
    >
      {ownerColor ? null : <UserPlus className="h-2.5 w-2.5" />}
    </span>
  )
  if (!isLeader) return (
    <span className="pointer-events-none absolute -left-1.5 -top-1.5">
      {dot}
    </span>
  )
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Sayfa ${pageIndex} — tasarımcı ata`}
          data-testid={`page-assign-trigger-${subtaskId}-${pageIndex}`}
          disabled={assignInFlight}
          className={cn(
            'group/pip absolute -left-1.5 -top-1.5 flex items-center gap-0 rounded-full ring-2 ring-background transition-all duration-150',
            'focus:outline-none focus-visible:ring-ring',
            'hover:gap-1 hover:pr-1.5',
            // Radix sets data-state="open" on the trigger when the popover
            // is showing — collapse the "Ata" label so the popover content
            // below is the only thing competing for the reader's eye.
            'data-[state=open]:gap-0 data-[state=open]:pr-0',
          )}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full shadow">
            {ownerColor ? (
              <span
                aria-hidden="true"
                className="h-4 w-4 rounded-full"
                style={{ backgroundColor: ownerColor }}
              />
            ) : (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted-foreground/30 text-background">
                <UserPlus className="h-2.5 w-2.5" />
              </span>
            )}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'h-4 max-w-0 overflow-hidden rounded-full bg-foreground/90 text-[9px] font-semibold uppercase tracking-wide text-background',
              'transition-[max-width,opacity] duration-150',
              'group-hover/pip:max-w-[3rem] group-hover/pip:opacity-100',
              'group-focus-visible/pip:max-w-[3rem] group-focus-visible/pip:opacity-100',
              'data-[state=open]:max-w-0 data-[state=open]:opacity-0',
            )}
          >
            <span className="block px-1 leading-4">Ata</span>
          </span>
        </button>
      </PopoverTrigger>
      <AssignPopoverContent
        subtaskTitle={subtaskTitle}
        pageIndex={pageIndex}
        currentAssigneeId={currentAssigneeId}
        currentAssigneeName={currentAssigneeName}
        designers={designers}
        onAssign={onAssign}
      />
    </Popover>
  )
}

/* ------------------------------------------------------------------ */
/*  AssignPopoverContent                                               */
/* ------------------------------------------------------------------ */

/**
 * Radix popover body. Header → current-owner callout → unassign row →
 * designer list. Anchored to the OwnerPip trigger; closes itself on row
 * click via the parent Popover's onOpenChange contract (Popover.Close is
 * used inside the row buttons).
 */
function AssignPopoverContent({
  subtaskTitle,
  pageIndex,
  currentAssigneeId,
  currentAssigneeName,
  designers,
  onAssign,
}) {
  const current = designerColor(currentAssigneeId, designers)
  return (
    <PopoverContent
      align="start"
      side="bottom"
      sideOffset={6}
      className="flex w-64 flex-col overflow-hidden p-0"
      data-testid={`page-assign-popover-${pageIndex}`}
    >
      <header className="border-b px-3 py-2">
        <p className="label-eyebrow">{subtaskTitle}</p>
        <h4 className="mt-0.5 text-sm leading-tight">
          <span className="font-mono tabular-nums">Sayfa {pageIndex}</span>
          <span className="ml-1 text-muted-foreground">— Tasarımcı ata</span>
        </h4>
      </header>

      <div className="border-b bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        {currentAssigneeId ? (
          <span>
            Şu anki:&nbsp;
            <span className="font-medium text-foreground">{current?.name ?? currentAssigneeName ?? 'Bilinmeyen'}</span>
          </span>
        ) : (
          <span className="italic">Atanmamış</span>
        )}
      </div>

      <div className="scrollbar-thin max-h-64 overflow-y-auto py-1">
        <UnassignRow
          pageIndex={pageIndex}
          disabled={!currentAssigneeId}
          onAssign={onAssign}
        />
        {designers.length === 0 ? (
          <p className="px-3 py-3 text-center text-[11px] italic text-muted-foreground">
            Aktif tasarımcı yok.
          </p>
        ) : (
          <ul>
            {designers.map((d) => (
              <AssigneeRow
                key={d.id}
                designer={d}
                isCurrent={d.id === currentAssigneeId}
                pageIndex={pageIndex}
                onAssign={onAssign}
              />
            ))}
          </ul>
        )}
      </div>

      {designers.length > 0 && (
        <footer className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          {designers.length} tasarımcı
        </footer>
      )}
    </PopoverContent>
  )
}

/**
 * Top-of-list action: clears the assignment (sends `null`). Disabled when
 * there's no current owner — clicking it would be a no-op anyway, and
 * disabling gives the user feedback that there's nothing to unassign.
 */
function UnassignRow({ pageIndex, disabled, onAssign }) {
  return (
    <div className="px-1.5 pt-1">
      <PopoverClose asChild>
        <button
          type="button"
          onClick={() => onAssign(pageIndex, null)}
          disabled={disabled}
          data-testid={`page-assign-unassign-${pageIndex}`}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition',
            disabled
              ? 'cursor-not-allowed text-muted-foreground/60'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground',
          )}
        >
          <X className="h-3.5 w-3.5" />
          <span>Atamayı kaldır</span>
        </button>
      </PopoverClose>
    </div>
  )
}

/**
 * One designer in the popover list. The avatar ring picks up the colour
 * that the chip border would produce if the leader picked this row, so
 * the picker doubles as a preview. Popover.Close on the wrapping button
 * ensures the popover dismisses after the click — the parent fires the
 * PATCH, optimistic update flips the chip colour, and the popover is
 * already out of the way.
 */
function AssigneeRow({ designer, isCurrent, pageIndex, onAssign }) {
  const color = userColor(designer.id)
  return (
    <li className="px-1.5">
      <PopoverClose asChild>
        <button
          type="button"
          onClick={() => onAssign(pageIndex, designer.id)}
          data-testid={`page-assign-pick-${pageIndex}-${designer.id}`}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition',
            isCurrent ? 'bg-muted' : 'hover:bg-muted focus-visible:bg-muted',
          )}
        >
          <span className="relative shrink-0">
            <span
              aria-hidden="true"
              className="absolute -inset-[2px] rounded-full"
              style={color ? { boxShadow: `0 0 0 2px ${color}, 0 0 0 4px hsl(var(--popover))` } : undefined}
            />
            <UserAvatar user={designer} size="xs" className="relative ring-0" />
          </span>
          <span className="min-w-0 flex-1 truncate">{designer.name ?? 'İsimsiz'}</span>
          {isCurrent ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Tasarımcı
            </span>
          )}
        </button>
      </PopoverClose>
    </li>
  )
}