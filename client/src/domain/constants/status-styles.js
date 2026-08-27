// Status visual language. Keys are app status groups (not Tailwind names):
//   orange→orange  purple→purple  green→emerald  blue→blue
//   teal→teal      pink→fuchsia   yellow→amber
//
// Token roles:
//   dot/topBorder/bar — saturated -500 accents (read fine on light).
//   badge            — soft tinted chip, contrast-safe in light.
//   surface/onSurface/border — tinted stat cards (Dashboard SummaryCard).
//   barFill          — darker fill for the timeline gantt bars so white
//                      label text clears WCAG AA 4.5:1 (verified).
export const STATUS_STYLES = {
  orange: {
    label: 'Yeni Proje',
    dot: 'bg-orange-500',
    topBorder: 'border-t-[3px] border-t-orange-500',
    badge: 'bg-orange-50 text-orange-700 ring-orange-600/20',
    bar: 'bg-orange-500',
    text: 'text-orange-600',
    surface: 'bg-orange-50',
    border: 'border-orange-200',
    onSurface: 'text-orange-700',
    barFill: 'bg-orange-700',
  },
  purple: {
    label: 'Devam Eden',
    dot: 'bg-purple-500',
    topBorder: 'border-t-[3px] border-t-purple-500',
    badge: 'bg-purple-50 text-purple-700 ring-purple-600/20',
    bar: 'bg-purple-500',
    text: 'text-purple-600',
    surface: 'bg-purple-50',
    border: 'border-purple-200',
    onSurface: 'text-purple-700',
    barFill: 'bg-purple-600',
  },
  green: {
    label: 'Demo aşamasında',
    dot: 'bg-emerald-500',
    topBorder: 'border-t-[3px] border-t-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    bar: 'bg-emerald-500',
    text: 'text-emerald-600',
    surface: 'bg-emerald-50',
    border: 'border-emerald-200',
    onSurface: 'text-emerald-700',
    barFill: 'bg-emerald-700',
  },
  blue: {
    label: 'Ozalit aşamasında',
    dot: 'bg-blue-500',
    topBorder: 'border-t-[3px] border-t-blue-500',
    badge: 'bg-blue-50 text-blue-700 ring-blue-600/20',
    bar: 'bg-blue-500',
    text: 'text-blue-600',
    surface: 'bg-blue-50',
    border: 'border-blue-200',
    onSurface: 'text-blue-700',
    barFill: 'bg-blue-600',
  },
  teal: {
    // "Üretime Hazır" — approved & queued, waiting for an order.
    label: 'Üretime Hazır',
    dot: 'bg-teal-500',
    topBorder: 'border-t-[3px] border-t-teal-500',
    badge: 'bg-teal-50 text-teal-700 ring-teal-600/20',
    bar: 'bg-teal-500',
    text: 'text-teal-600',
    surface: 'bg-teal-50',
    border: 'border-teal-200',
    onSurface: 'text-teal-700',
    barFill: 'bg-teal-700',
  },
  pink: {
    // "Üretimde" — fuchsia, distinct from the green/blue stages.
    label: 'Üretimde',
    dot: 'bg-fuchsia-500',
    topBorder: 'border-t-[3px] border-t-fuchsia-500',
    badge: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20',
    bar: 'bg-fuchsia-500',
    text: 'text-fuchsia-600',
    surface: 'bg-fuchsia-50',
    border: 'border-fuchsia-200',
    onSurface: 'text-fuchsia-700',
    barFill: 'bg-fuchsia-600',
  },
  yellow: {
    label: 'Satışta',
    dot: 'bg-amber-400',
    topBorder: 'border-t-[3px] border-t-amber-400',
    badge: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    bar: 'bg-amber-400',
    text: 'text-amber-700',
    surface: 'bg-amber-50',
    border: 'border-amber-200',
    onSurface: 'text-amber-700',
    barFill: 'bg-amber-700',
  },
}
export const STATUS_META = STATUS_STYLES
