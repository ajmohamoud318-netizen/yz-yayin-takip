// Season model — two school-year "modes" plus a featured mid-fall month.
//
//   • "BİLSEM Yılı"      (Eylül, Kasım–Haziran) — the long active school
//                          year, minus the featured month below.
//   • "Bilsem Dönemi"     (Ekim)                 — featured mid-fall
//                          sprint, treated as its own season so the
//                          sidebar widget and Yıllık Plan tab can call it
//                          out separately with the cobalt tint.
//   • "Yaza Hazırlık"     (Temmuz–Ağustos)       — short 2-month
//                          wrap-up before the new school year starts.
//
// Months are 0-indexed. Ekim lives right after Eylül in calendar order
// so the season cycle is:
//   BİLSEM Yılı → Bilsem Dönemi → Yaza Hazırlık → BİLSEM Yılı (next year)
//
// This module is shared between Dashboard.jsx (for the year-plan chart
// tinting) and Sidebar.jsx / AppShell.jsx (for the season widgets).

export const SEASONS = [
  {
    id: 'bilsem',
    label: 'BİLSEM Yılı',
    blurb: 'Yeni okul yılı başlıyor',
    months: [8, 11, 0, 1, 2, 3, 4, 5],
  },
  {
    id: 'ekim',
    label: 'Bilsem Dönemi',
    blurb: 'BİLSEM sınav dönemi',
    months: [9],
  },
  {
    id: 'yaza',
    label: 'Yaza Hazırlık',
    blurb: 'Yaz dönemi öncesi son viraj',
    months: [6, 7],
  },
]

// The season `now` lives inside — the one whose `months` includes the
// current month. Every month of the year is covered by some season, so the
// `?? SEASONS[0]` is purely belt-and-braces.
export function currentSeason(now = new Date()) {
  const m = now.getMonth()
  return SEASONS.find((s) => s.months.includes(m)) ?? SEASONS[0]
}

// The next season in the cycle after `current`. The season's "first
// month" (smallest index in its months array) anchors the start date,
// with a year bump if that month has already passed in the current
// calendar year.
export function nextSeasonAfter(now = new Date()) {
  const m = now.getMonth()
  const currentIdx = SEASONS.findIndex((s) => s.months.includes(m))
  const next = SEASONS[(currentIdx + 1) % SEASONS.length]
  // Pick the season's *first* month in calendar order, not the array
  // minimum. BİLSEM's months wrap across the year boundary (Sep..Dec,
  // Jan..Jun) so the array minimum is January — we want September.
  const orderedMonths = [...next.months].sort((a, b) => a - b)
  const firstMonth =
    orderedMonths.find((mm) => mm > m) ?? orderedMonths[0]
  const year = now.getFullYear() + (firstMonth <= m ? 1 : 0)
  return { ...next, start: new Date(year, firstMonth, 1) }
}

// Days between two dates, floored to the start of "from". Two Date
// objects at different times of day would otherwise drift; anchoring
// both at local midnight keeps the count stable for a given calendar
// day. `Math.round` (not `floor`) so a 23h59m gap still counts as a
// full day rather than 0.
export function daysBetween(from, to) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  const ms = b.getTime() - a.getTime()
  return Math.max(0, Math.round(ms / 86_400_000))
}
