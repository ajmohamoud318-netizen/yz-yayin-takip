// Status visual language. Keys are app status groups (not Tailwind names):
//   gray→stone     purple→purple  orange→orange  cyan→cyan
//   lime→lime      teal→teal      blue→blue      pink→fuchsia  yellow→amber
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
//   barProgress      — one step darker than barSoft; Dashboard comfortable
//                      bars already carry the colour, so the track stays in
//                      the same family instead of dropping to a muddy dark.
//   barSoft          — softer fill (-400/-500) used as the full bar body
//                      on Dashboard comfortable bars — the bar is large
//                      enough that the heavier shade felt visually heavy.
//                      Label colour is dark on these to keep contrast.
//
// No status is green: emerald means "approved / done" across the rest of
// the app (success buttons, approved parça rows, positive history events).
export const STATUS_STYLES = {
  gray: {
    // "Yeni Proje" — %0, work not started yet. Stone (warm gray) to sit on
    // the ivory paper canvas; the tints are one step darker than the other
    // keys because stone-50 is indistinguishable from the page background.
    label: 'Yeni Proje',
    dot: 'bg-stone-400',
    topBorder: 'border-t-[3px] border-t-stone-400',
    badge: 'bg-stone-100 text-stone-700 ring-stone-600/20',
    bar: 'bg-stone-400',
    text: 'text-stone-600',
    surface: 'bg-stone-100',
    surfaceBar: 'bg-stone-200',
    border: 'border-stone-300',
    onSurface: 'text-stone-700',
    barFill: 'bg-stone-600',
    barProgress: 'bg-stone-500',
    barSoft: 'bg-stone-300',
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
    barProgress: 'bg-purple-500',
    barSoft: 'bg-purple-400',
  },
  orange: {
    // TR demo_teslim.
    label: 'Demo Teslim',
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
    barProgress: 'bg-orange-600',
    barSoft: 'bg-orange-400',
  },
  cyan: {
    // TR demo_onay. Text runs one step darker (-700) than the other keys:
    // cyan-600 misses AA as small text on the light surfaces.
    label: 'Demo Onay',
    dot: 'bg-cyan-400',
    topBorder: 'border-t-[3px] border-t-cyan-400',
    badge: 'bg-cyan-50 text-cyan-700 ring-cyan-600/20',
    bar: 'bg-cyan-400',
    text: 'text-cyan-700',
    surface: 'bg-cyan-50',
    surfaceBar: 'bg-cyan-100',
    border: 'border-cyan-200',
    onSurface: 'text-cyan-700',
    barFill: 'bg-cyan-700',
    barProgress: 'bg-cyan-600',
    barSoft: 'bg-cyan-400',
  },
  lime: {
    // ÇİN cin_demo_teslim. Lime is the lightest hue here, so its text sits
    // at -700/-800 to stay readable on the tinted surfaces.
    label: 'Çin Demo Teslim',
    dot: 'bg-lime-400',
    topBorder: 'border-t-[3px] border-t-lime-400',
    badge: 'bg-lime-50 text-lime-800 ring-lime-600/20',
    bar: 'bg-lime-400',
    text: 'text-lime-700',
    surface: 'bg-lime-50',
    surfaceBar: 'bg-lime-100',
    border: 'border-lime-200',
    onSurface: 'text-lime-800',
    barFill: 'bg-lime-700',
    barProgress: 'bg-lime-600',
    barSoft: 'bg-lime-400',
  },
  teal: {
    // ÇİN cin_demo_onay.
    label: 'Çin Demo Onay',
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
    barProgress: 'bg-teal-600',
    barSoft: 'bg-teal-400',
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
    barProgress: 'bg-blue-500',
    barSoft: 'bg-blue-400',
  },
  pink: {
    // "Üretimde" — fuchsia, distinct from the demo/ozalit stages.
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
    barProgress: 'bg-fuchsia-500',
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
    barFill: 'bg-amber-600',
    barProgress: 'bg-amber-500',
    barSoft: 'bg-amber-300',
  },
}
export const STATUS_META = STATUS_STYLES
