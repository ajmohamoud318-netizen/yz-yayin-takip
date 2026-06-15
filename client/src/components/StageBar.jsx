import { STAGE_LABELS } from '../api.js'

// Pipeline stage order per project type (from CLAUDE.md workflows).
const TR_STAGES = [
  'tasarim',
  'demo_teslim',
  'demo_onay',
  'ozalit_teslim',
  'ozalit_onay',
  'uretimde',
  'satista',
]
const CIN_STAGES = [
  'tasarim',
  'cin_demo_teslim',
  'cin_demo_onay',
  'uretimde',
  'gumruk',
  'satista',
]

export function stagesForType(type) {
  return type === 'CIN' ? CIN_STAGES : TR_STAGES
}

/**
 * Compact horizontal stage indicator for a project card.
 * Highlights completed + current stages along the pipeline.
 */
export default function StageBar({ type, stage, compact = false }) {
  const stages = stagesForType(type)
  const currentIndex = Math.max(0, stages.indexOf(stage))

  if (compact) {
    return (
      <div className="flex items-center gap-1" aria-hidden="true">
        {stages.map((s, i) => (
          <span
            key={s}
            className={`h-1.5 flex-1 rounded-full ${
              i <= currentIndex ? 'bg-brand-500' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
    )
  }

  return (
    <ol className="flex items-center">
      {stages.map((s, i) => {
        const done = i < currentIndex
        const current = i === currentIndex
        return (
          <li key={s} className="flex items-center">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                  done
                    ? 'bg-brand-500 text-white'
                    : current
                      ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                className={`mt-1 max-w-[64px] text-center text-[10px] leading-tight ${
                  current ? 'font-semibold text-brand-700' : 'text-slate-400'
                }`}
              >
                {STAGE_LABELS[s]}
              </span>
            </div>
            {i < stages.length - 1 && (
              <span
                className={`mx-1 h-0.5 w-6 ${
                  i < currentIndex ? 'bg-brand-500' : 'bg-slate-200'
                }`}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
