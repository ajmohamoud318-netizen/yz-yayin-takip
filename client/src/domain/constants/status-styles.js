// Status visual language. Keys are app status groups (not Tailwind names):
//   orange→orange  purple→purple  green→emerald  blue→blue
//   teal→teal      pink→fuchsia   yellow→amber
//
// Token roles:
//   dot/topBorder/bar — saturated -500 accents (read fine on light + dark).
//   badge            — soft tinted chip, contrast-safe in light AND dark.
//   surface/onSurface/border — tinted stat cards (Dashboard SummaryCard).
//   barFill          — darker fill for the timeline gantt bars so white
//                      label text clears WCAG AA 4.5:1 (verified).
export const STATUS_STYLES = {
  orange: {
    label: 'Yeni Proje',
    dot: 'bg-orange-500',
    topBorder: 'border-t-[3px] border-t-orange-500',
    badge: 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950/50 dark:text-orange-300 dark:ring-orange-400/25',
    bar: 'bg-orange-500',
    text: 'text-orange-600 dark:text-orange-400',
    surface: 'bg-orange-50 dark:bg-orange-950/50',
    border: 'border-orange-200 dark:border-orange-900',
    onSurface: 'text-orange-700 dark:text-orange-300',
    barFill: 'bg-orange-700',
  },
  purple: {
    label: 'Devam Eden',
    dot: 'bg-purple-500',
    topBorder: 'border-t-[3px] border-t-purple-500',
    badge: 'bg-purple-50 text-purple-700 ring-purple-600/20 dark:bg-purple-950/50 dark:text-purple-300 dark:ring-purple-400/25',
    bar: 'bg-purple-500',
    text: 'text-purple-600 dark:text-purple-400',
    surface: 'bg-purple-50 dark:bg-purple-950/50',
    border: 'border-purple-200 dark:border-purple-900',
    onSurface: 'text-purple-700 dark:text-purple-300',
    barFill: 'bg-purple-600',
  },
  green: {
    label: 'Demo aşamasında',
    dot: 'bg-emerald-500',
    topBorder: 'border-t-[3px] border-t-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-400/25',
    bar: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    surface: 'bg-emerald-50 dark:bg-emerald-950/50',
    border: 'border-emerald-200 dark:border-emerald-900',
    onSurface: 'text-emerald-700 dark:text-emerald-300',
    barFill: 'bg-emerald-700',
  },
  blue: {
    label: 'Ozalit aşamasında',
    dot: 'bg-blue-500',
    topBorder: 'border-t-[3px] border-t-blue-500',
    badge: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-400/25',
    bar: 'bg-blue-500',
    text: 'text-blue-600 dark:text-blue-400',
    surface: 'bg-blue-50 dark:bg-blue-950/50',
    border: 'border-blue-200 dark:border-blue-900',
    onSurface: 'text-blue-700 dark:text-blue-300',
    barFill: 'bg-blue-600',
  },
  teal: {
    // "Üretime Hazır" — approved & queued, waiting for an order.
    label: 'Üretime Hazır',
    dot: 'bg-teal-500',
    topBorder: 'border-t-[3px] border-t-teal-500',
    badge: 'bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-950/50 dark:text-teal-300 dark:ring-teal-400/25',
    bar: 'bg-teal-500',
    text: 'text-teal-600 dark:text-teal-400',
    surface: 'bg-teal-50 dark:bg-teal-950/50',
    border: 'border-teal-200 dark:border-teal-900',
    onSurface: 'text-teal-700 dark:text-teal-300',
    barFill: 'bg-teal-700',
  },
  pink: {
    // "Üretimde" — fuchsia, distinct from the green/blue stages.
    label: 'Üretimde',
    dot: 'bg-fuchsia-500',
    topBorder: 'border-t-[3px] border-t-fuchsia-500',
    badge: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20 dark:bg-fuchsia-950/50 dark:text-fuchsia-300 dark:ring-fuchsia-400/25',
    bar: 'bg-fuchsia-500',
    text: 'text-fuchsia-600 dark:text-fuchsia-400',
    surface: 'bg-fuchsia-50 dark:bg-fuchsia-950/50',
    border: 'border-fuchsia-200 dark:border-fuchsia-900',
    onSurface: 'text-fuchsia-700 dark:text-fuchsia-300',
    barFill: 'bg-fuchsia-600',
  },
  yellow: {
    label: 'Satışta',
    dot: 'bg-amber-400',
    topBorder: 'border-t-[3px] border-t-amber-400',
    badge: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-400/25',
    bar: 'bg-amber-400',
    text: 'text-amber-700 dark:text-amber-400',
    surface: 'bg-amber-50 dark:bg-amber-950/50',
    border: 'border-amber-200 dark:border-amber-900',
    onSurface: 'text-amber-700 dark:text-amber-300',
    barFill: 'bg-amber-700',
  },
}
export const STATUS_META = STATUS_STYLES
