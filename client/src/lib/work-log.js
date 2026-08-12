import { CircleDashed, ClipboardList, GraduationCap, Layers, Users } from 'lucide-react'

/**
 * Shared vocabulary for the work log ("Çalışma Defteri").
 *
 * The composer (WorkLogPill), the leader's read-only view (WorkLogNotes) and
 * anything added later all render from this one table, so a category can
 * never drift into two different colours or two different Turkish labels.
 * `value` matches the CHECK constraint in migration 026__work_log.sql — add
 * here and there together.
 *
 * Colour assignment follows the pipeline hues already in DESIGN.md rather
 * than inventing a second palette: violet/blue/amber/teal are the same
 * family the stage chips use, and 'diger' stays deliberately neutral so an
 * uncategorised note doesn't shout louder than a categorised one.
 */
/**
 * Master switch for the whole feature. Off = the sidebar entry disappears,
 * the /team cards drop the notes block and the avatar dot, and nothing ever
 * calls /api/work-log. The routes, the service and migration 026's data all
 * stay exactly as they are, so flipping this back to `true` restores the
 * feature with every past entry intact.
 */
export const WORK_LOG_ENABLED = false

export const WORK_LOG_KINDS = [
  {
    value: 'baska_proje',
    label: 'Başka Proje',
    short: 'Proje',
    icon: Layers,
    placeholder: 'Hangi proje ve ne yaptın?',
    dot: 'bg-violet-500',
    rule: 'bg-violet-500/40',
    chip: 'bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300',
    active: 'bg-violet-500/15 text-violet-700 ring-violet-500/40 dark:text-violet-200',
  },
  {
    value: 'toplanti',
    label: 'Toplantı',
    short: 'Toplantı',
    icon: Users,
    placeholder: 'Kiminle, ne konuşuldu?',
    dot: 'bg-sky-500',
    rule: 'bg-sky-500/40',
    chip: 'bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300',
    active: 'bg-sky-500/15 text-sky-700 ring-sky-500/40 dark:text-sky-200',
  },
  {
    value: 'idari',
    label: 'İdari İş',
    short: 'İdari',
    icon: ClipboardList,
    placeholder: 'Hangi idari iş?',
    dot: 'bg-amber-500',
    rule: 'bg-amber-500/40',
    chip: 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300',
    active: 'bg-amber-500/15 text-amber-700 ring-amber-500/40 dark:text-amber-200',
  },
  {
    value: 'egitim',
    label: 'Eğitim',
    short: 'Eğitim',
    icon: GraduationCap,
    placeholder: 'Ne öğrendin / ne anlattın?',
    dot: 'bg-teal-600',
    rule: 'bg-teal-600/40',
    chip: 'bg-teal-600/10 text-teal-700 ring-teal-600/20 dark:text-teal-300',
    active: 'bg-teal-600/15 text-teal-700 ring-teal-600/40 dark:text-teal-200',
  },
  {
    value: 'diger',
    label: 'Diğer',
    short: 'Diğer',
    icon: CircleDashed,
    placeholder: 'Bugün başka ne üzerinde çalıştın?',
    dot: 'bg-muted-foreground',
    rule: 'bg-muted-foreground/30',
    chip: 'bg-muted text-muted-foreground ring-border',
    active: 'bg-muted text-foreground ring-muted-foreground/40',
  },
]

const BY_VALUE = new Map(WORK_LOG_KINDS.map((k) => [k.value, k]))

/** Never returns undefined — an unknown kind from an older row falls back
 *  to 'diger' rather than crashing a render on `kind.icon`. */
export function kindMeta(value) {
  return BY_VALUE.get(value) ?? BY_VALUE.get('diger')
}

export const WORK_LOG_MAX_BODY = 280

/** Duration presets offered as one-tap chips. Tapping the active one clears it. */
export const MINUTE_PRESETS = [
  { minutes: 30, label: '30 dk' },
  { minutes: 60, label: '1 sa' },
  { minutes: 120, label: '2 sa' },
  { minutes: 240, label: 'Yarım gün' },
  { minutes: 480, label: 'Tam gün' },
]

/** 30 → "30 dk", 90 → "1 sa 30 dk", 240 → "yarım gün", 480 → "tam gün". */
export function formatMinutes(minutes) {
  if (!minutes) return null
  if (minutes === 480) return 'tam gün'
  if (minutes === 240) return 'yarım gün'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} dk`
  if (!m) return `${h} sa`
  return `${h} sa ${m} dk`
}

/** "14:05" in the user's locale-independent 24h form (Turkish office norm). */
export function formatClock(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * "Bugün" / "Dün" / "23 Temmuz Çarşamba" for the history day headings.
 * Takes a YYYY-MM-DD string (entry_date is a DATE, not a timestamp, so it
 * must not go through Date parsing that would shift it by a timezone).
 */
export function formatDayLabel(ymd) {
  if (!ymd) return ''
  const today = new Date()
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (ymd === iso(today)) return 'Bugün'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (ymd === iso(yesterday)) return 'Dün'
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  })
}

/** Today's date as YYYY-MM-DD in *local* time (not UTC — `toISOString`
 *  would roll the date over for anyone east of Greenwich after 21:00). */
export function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Group a flat, newest-first entry list into [{ date, entries }] day buckets. */
export function groupByDay(entries) {
  const out = []
  const index = new Map()
  for (const e of entries) {
    const key = typeof e.entry_date === 'string' ? e.entry_date.slice(0, 10) : todayKey()
    let bucket = index.get(key)
    if (!bucket) {
      bucket = { date: key, entries: [] }
      index.set(key, bucket)
      out.push(bucket)
    }
    bucket.entries.push(e)
  }
  return out
}
