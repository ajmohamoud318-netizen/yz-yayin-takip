import {
  STAGE_LABELS,
  STATUS_STYLES,
  TYPE_LABELS,
  statusKeyForProject,
} from '../api.js'
import { cn } from '../lib/utils.js'
import StageBar from './StageBar.jsx'

function initials(name = '') {
  // Null-safe — the server's list endpoint can return `assigned_name: null`
  // for unassigned projects. Without this guard `project.assigned_name`
  // of `null` would throw on the dashboard and tank the whole page.
  if (!name) return ''
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/**
 * Single project card for the dashboard. Shows title, type, current stage,
 * assigned designer, progress %, demo attempt and a status color accent.
 * Status color is expressed as a top border — no side-stripe.
 */
export default function ProjectCard({ project, onClick }) {
  const statusKey = statusKeyForProject(project)
  const style = STATUS_STYLES[statusKey]

  return (
    <button
      type="button"
      onClick={() => onClick?.(project)}
      className={cn(
        'group flex w-full flex-col gap-3 rounded-lg border bg-card p-4 text-left',
        'transition-[transform,border-color] duration-200 ease-out',
        'hover:-translate-y-0.5 hover:border-primary/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        style.topBorder,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {project.title}
          </h3>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {TYPE_LABELS[project.type]}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${style.badge}`}
            >
              {STAGE_LABELS[project.stage]}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {project.demo_attempt > 0 && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border">
              Demo {project.demo_attempt + 1}
            </span>
          )}
          {project.ozalit_attempt > 0 && (
            <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 ring-1 ring-inset ring-blue-200">
              Ozalit {project.ozalit_attempt + 1}
            </span>
          )}
        </div>
      </div>

      {/* progress */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>İlerleme</span>
          <span className="font-mono font-semibold tabular-nums text-foreground">{project.progress}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none', style.bar)}
            style={{ width: `${project.progress}%` }}
          />
        </div>
      </div>

      {/* mini pipeline */}
      <StageBar type={project.type} stage={project.stage} compact />

      {/* assigned designer */}
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
          {initials(project.assigned_name)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{project.assigned_name}</span>
      </div>
    </button>
  )
}
