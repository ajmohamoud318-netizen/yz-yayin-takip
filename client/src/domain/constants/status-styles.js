// Status visual language. Keys are app status groups (not Tailwind names):
//   orange→orange  purple→purple  green→emerald  blue→blue
//   teal→teal      pink→fuchsia   yellow→amber
//
// Token roles:
//   dot/topBorder/bar — saturated -500 accents (read fine on light).
//   badge            — soft tinted chip, contrast-safe in light.
//   surface/onSurface/border — tinted stat cards (Dashboard SummaryCard).
//   surfaceBar       — slightly stronger tinted chip used as the YearPlan
//                      bar background (-100); lets the saturated progress
//                      track underneath carry the colour weight.
//   barFill          — heavier fill (-600/-700) used as the saturated
//                      progress track on YearPlan compact bars (small,
//                      white-on-fill label clears WCAG AA).
//   barSoft          — softer fill (-400/-500) used as the full bar body
//                      on Dashboard comfortable bars — the bar is large
//                      enough that the heavier shade felt visually heavy.
//                      Label colour is dark on these to keep contrast.
export const STATUS_STYLES = {
  orange: {
    label: 'Yeni Proje',
    dot: 'bg-orange-400',
    topBorder: 'border-t-[3px] border-t-orange-400',
    badge: 'bg-orange-50 text-orange-700 ring-orange-600/20',
    bar: 'bg-orange-400',
    text: 'text-orange-600',
    surface: 'bg-orange-50',
    surfaceBar: 'bg-orange-100',
    border: 'border-orange-200',
    onSurface: 'text-orange-700',
    barFill: 'bg-orange-700',
    barSoft: 'bg-orange-400',
  },
  purple: {
    label: 'Devam Eden',
    dot: 'bg-purple-400',
    topBorder: 'border-t-[3px] border-t-purple-400',
    badge: 'bg-purple-50 text-purple-700 ring-purple-600/20',
    bar: 'bg-purple-400',
    text: 'text-purple-600',
    surface: 'bg-purple-50',
    surfaceBar: 'bg-purple-100',
    border: 'border-purple-200',
    onSurface: 'text-purple-700',
    barFill: 'bg-purple-600',
    barSoft: 'bg-purple-400',
  },
  green: {
    label: 'Demo aşamasında',
    dot: 'bg-emerald-400',
    topBorder: 'border-t-[3px] border-t-emerald-400',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    bar: 'bg-emerald-400',
    text: 'text-emerald-600',
    surface: 'bg-emerald-50',
    surfaceBar: 'bg-emerald-100',
    border: 'border-emerald-200',
    onSurface: 'text-emerald-700',
    barFill: 'bg-emerald-700',
    barSoft: 'bg-emerald-400',
  },
  blue: {
    label: 'Ozalit aşamasında',
    dot: 'bg-blue-400',
    topBorder: 'border-t-[3px] border-t-blue-400',
    badge: 'bg-blue-50 text-blue-700 ring-blue-600/20',
    bar: 'bg-blue-400',
    text: 'text-blue-600',
    surface: 'bg-blue-50',
    surfaceBar: 'bg-blue-100',
    border: 'border-blue-200',
    onSurface: 'text-blue-700',
    barFill: 'bg-blue-600',
    barSoft: 'bg-blue-400',
  },
  teal: {
    // "Üretime Hazır" — approved & queued, waiting for an order.
    label: 'Üretime Hazır',
    dot: 'bg-teal-400',
    topBorder: 'border-t-[3px] border-t-teal-400',
    badge: 'bg-teal-50 text-teal-700 ring-teal-600/20',
    bar: 'bg-teal-400',
    text: 'text-teal-600',
    surface: 'bg-teal-50',
    surfaceBar: 'bg-teal-100',
    border: 'border-teal-200',
    onSurface: 'text-teal-700',
    barFill: 'bg-teal-700',
    barSoft: 'bg-teal-400',
  },
  pink: {
    // "Üretimde" — fuchsia, distinct from the green/blue stages.
    label: 'Üretimde',
    dot: 'bg-fuchsia-400',
    topBorder: 'border-t-[3px] border-t-fuchsia-400',
    badge: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20',
    bar: 'bg-fuchsia-400',
    text: 'text-fuchsia-600',
    surface: 'bg-fuchsia-50',
    surfaceBar: 'bg-fuchsia-100',
    border: 'border-fuchsia-200',
    onSurface: 'text-fuchsia-700',
    barFill: 'bg-fuchsia-600',
    barSoft: 'bg-fuchsia-400',
  },
  yellow: {
    // "Satışta" — only the soft tail of the palette. -300 keeps it light
    // enough to match the rest; text on the bar uses the dark variant
    // for contrast (see YearPlanBar.barText).
    label: 'Satışta',
    dot: 'bg-amber-300',
    topBorder: 'border-t-[3px] border-t-amber-300',
    badge: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    bar: 'bg-amber-300',
    text: 'text-amber-700',
    surface: 'bg-amber-50',
    surfaceBar: 'bg-amber-100',
    border: 'border-amber-200',
    onSurface: 'text-amber-700',
    barFill: 'bg-amber-700',
    barSoft: 'bg-amber-300',
  },
}
export const STATUS_META = STATUS_STYLES
