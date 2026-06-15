import {
  STAGE_LABELS,
  STATUS_STYLES,
  TYPE_LABELS,
  statusKeyForProject,
} from '../api.js'
import StageBar from './StageBar.jsx'

function initials(name = '') {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/**
 * Single project card for the dashboard. Shows title, type, current stage,
 * assigned designer, progress %, demo attempt and a status color accent.
 */
export default function ProjectCard({ project, onClick }) {
  const statusKey = statusKeyForProject(project)
  const style = STATUS_STYLES[statusKey]

  return (
    <button
      type="button"
      onClick={() => onClick?.(project)}
      className="group relative flex w-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500/30"
    >
      {/* color accent strip */}
      <span className={`absolute inset-y-0 left-0 w-1 rounded-l-xl ${style.dot}`} />

      <div className="flex items-start justify-between gap-2 pl-1.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-900">
            {project.title}
          </h3>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
              {TYPE_LABELS[project.type]}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${style.badge}`}
            >
              {STAGE_LABELS[project.stage]}
            </span>
          </div>
        </div>
        {project.demo_attempt > 0 && (
          <span className="shrink-0 rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
            Demo {project.demo_attempt}
          </span>
        )}
      </div>

      {/* progress */}
      <div className="pl-1.5">
        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
          <span>İlerleme</span>
          <span className="font-semibold text-slate-700">{project.progress}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${style.bar}`}
            style={{ width: `${project.progress}%` }}
          />
        </div>
      </div>

      {/* mini pipeline */}
      <div className="pl-1.5">
        <StageBar type={project.type} stage={project.stage} compact />
      </div>

      {/* assigned designer */}
      <div className="flex items-center gap-2 pl-1.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700">
          {initials(project.assigned_name)}
        </span>
        <span className="truncate text-xs text-slate-500">{project.assigned_name}</span>
      </div>
    </button>
  )
}
