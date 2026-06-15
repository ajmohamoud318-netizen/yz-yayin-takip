import ProjectCard from './ProjectCard.jsx'

const TR_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

function monthLabel(isoDate) {
  if (!isoDate) return 'Tarih atanmamış'
  const d = new Date(isoDate)
  return `${TR_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

function monthKey(isoDate) {
  if (!isoDate) return 'none'
  return isoDate.slice(0, 7) // YYYY-MM
}

/**
 * Monthly timeline view: projects grouped into columns by target month,
 * ordered chronologically. Each column is a vertical stack of cards.
 */
export default function MonthTimeline({ projects, onSelect }) {
  // Group by month key.
  const groups = new Map()
  for (const p of projects) {
    const key = monthKey(p.target_month)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }

  // Sort month keys chronologically ('none' last).
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === 'none') return 1
    if (b === 'none') return -1
    return a < b ? -1 : 1
  })

  const nowKey = new Date().toISOString().slice(0, 7)

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {keys.map((key) => {
        const items = groups.get(key)
        const isCurrent = key === nowKey
        return (
          <section key={key} className="flex w-72 shrink-0 flex-col">
            <header className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  {monthLabel(items[0].target_month)}
                </h2>
                {isCurrent && (
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                    Bu ay
                  </span>
                )}
              </div>
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-500">
                {items.length}
              </span>
            </header>
            <div className="flex flex-col gap-3 rounded-xl bg-slate-100/60 p-3">
              {items.map((p) => (
                <ProjectCard key={p.id} project={p} onClick={onSelect} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
