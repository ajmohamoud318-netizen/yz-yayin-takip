import {
  CheckCircle2,
  ChevronRight,
  ClipboardEdit,
  ClipboardList,
  MessageSquarePlus,
  Package,
  Plus,
  RotateCcw,
  Send,
  ShoppingCart,
  ThumbsDown,
  ThumbsUp,
  Truck,
} from 'lucide-react'

/**
 * Taxonomy for the project history timeline.
 *
 * The old inline version dispatched on `event` and `action` in four separate
 * places (icon, colour, ring colour, label) using eight competing pastel
 * hues — indigo, violet, slate, emerald, amber, red, sky, primary — none of
 * which came from DESIGN.md. That made every row shout equally loudly: a
 * ticked subtask looked exactly as important as a rejected ozalit.
 *
 * This table is the single dispatch point, and it decides three things per
 * row:
 *
 *   tone    one of six SEMANTIC roles (not decorative colours). A hue here
 *           always means the same thing, so a red dot is only ever a
 *           rejection. `order` keeps its own hue because the sipariş
 *           workflow is a genuinely parallel lane, not a pipeline stage.
 *   weight  'major' rows are pipeline moments and get the full treatment;
 *           'minor' rows are bookkeeping and collapse to a single line.
 *           This is the hierarchy the flat list never had.
 *   group   which filter chip the row belongs to.
 */

// Semantic tones. Colours resolve to the warm-paper tokens in index.css
// wherever one exists; the three that don't map to a token (emerald / amber
// / violet) are held to a single stop each so the timeline never drifts into
// a gradient of near-identical pastels.
export const TONES = {
  pipeline: {
    dot: 'bg-primary',
    icon: 'text-primary',
    surface: 'bg-primary/10',
  },
  positive: {
    dot: 'bg-emerald-600',
    icon: 'text-emerald-700 dark:text-emerald-400',
    surface: 'bg-emerald-600/10',
  },
  negative: {
    dot: 'bg-destructive',
    icon: 'text-destructive',
    surface: 'bg-destructive/10',
  },
  pending: {
    dot: 'bg-amber-500',
    icon: 'text-amber-700 dark:text-amber-400',
    surface: 'bg-amber-500/10',
  },
  order: {
    dot: 'bg-violet-500',
    icon: 'text-violet-700 dark:text-violet-400',
    surface: 'bg-violet-500/10',
  },
  neutral: {
    dot: 'bg-muted-foreground/50',
    icon: 'text-muted-foreground',
    surface: 'bg-muted',
  },
}

/** Filter chips, in display order. `match` is the group key on each entry. */
export const HISTORY_FILTERS = [
  { value: 'all', label: 'Tümü' },
  { value: 'stage', label: 'Aşamalar' },
  { value: 'approval', label: 'Onaylar' },
  { value: 'subtask', label: 'Alt Görevler' },
  { value: 'order', label: 'Sipariş' },
]

const EVENTS = {
  project_created: { icon: Plus, tone: 'pipeline', weight: 'major', group: 'stage', label: 'Proje Oluşturuldu' },
  project_edit: { icon: ClipboardEdit, tone: 'neutral', weight: 'minor', group: 'stage', label: 'Proje Düzenlendi' },

  subtask_done: { icon: CheckCircle2, tone: 'positive', weight: 'minor', group: 'subtask', label: 'Alt Görev Tamamlandı' },
  subtask_undone: { icon: RotateCcw, tone: 'pending', weight: 'minor', group: 'subtask', label: 'Alt Görev Geri Alındı' },
  subtask_revize: { icon: RotateCcw, tone: 'pending', weight: 'minor', group: 'subtask', label: 'Alt Görev Revize Edildi' },
  subtask_progress: { icon: ClipboardList, tone: 'neutral', weight: 'minor', group: 'subtask', label: 'Alt Görev İlerlemesi' },
  subtask_note: { icon: MessageSquarePlus, tone: 'neutral', weight: 'minor', group: 'subtask', label: 'Alt Görev Notu' },
  subtask_list_update: { icon: ClipboardList, tone: 'neutral', weight: 'minor', group: 'subtask', label: 'Alt Görev Listesi Güncellendi' },

  demo_form: { icon: Send, tone: 'pipeline', weight: 'major', group: 'approval', label: 'Demo Formu Gönderildi' },
  ozalit_form: { icon: Send, tone: 'pipeline', weight: 'major', group: 'approval', label: 'Ozalit Formu Gönderildi' },

  handover_request: { icon: Truck, tone: 'pending', weight: 'major', group: 'order', label: 'Teslim Talebi Oluşturuldu' },
  handover_confirm: { icon: Package, tone: 'positive', weight: 'major', group: 'order', label: 'Teslim Onaylandı' },

  order_request: { icon: ShoppingCart, tone: 'order', weight: 'major', group: 'order', label: 'Sipariş Talebi Oluşturuldu' },
  order_transfer: { icon: ShoppingCart, tone: 'order', weight: 'major', group: 'order', label: 'Tasarımcı Atandı' },
  order_advance: { icon: ShoppingCart, tone: 'order', weight: 'major', group: 'order', label: 'Sipariş İlerletildi' },
  order_final: { icon: ShoppingCart, tone: 'order', weight: 'major', group: 'order', label: 'Sipariş Onaylandı' },
  order_reject: { icon: ShoppingCart, tone: 'negative', weight: 'major', group: 'order', label: 'Sipariş Reddedildi' },
}

// Coarse fallback for legacy rows written before `event` existed (migration
// 014). Keep in sync with EVENTS above.
const ACTIONS = {
  create: { icon: Plus, tone: 'pipeline', weight: 'major', group: 'stage' },
  advance: { icon: ChevronRight, tone: 'pipeline', weight: 'major', group: 'stage' },
  approve: { icon: ThumbsUp, tone: 'positive', weight: 'major', group: 'approval' },
  reject: { icon: ThumbsDown, tone: 'negative', weight: 'major', group: 'approval' },
  order: { icon: ShoppingCart, tone: 'order', weight: 'major', group: 'order' },
  system: { icon: Package, tone: 'neutral', weight: 'minor', group: 'subtask' },
}

const ADVANCE_LABELS = {
  demo_teslim: 'Demoya Gönderildi',
  cin_demo_teslim: 'Demoya Gönderildi',
  demo_onay: 'Demo Teslim Edildi',
  cin_demo_onay: 'Demo Teslim Edildi',
  ozalit_teslim: "Ozalit'e Gönderildi",
  ozalit_onay: 'Ozalit',
  uretime_hazir: 'Üretime Hazır',
  uretimde: 'Üretime Alındı (Sipariş)',
  gumruk: 'Gümrüğe Gönderildi',
  satista: 'Satışa Çıkarıldı',
}

const APPROVE_LABELS = {
  demo_onay: 'Demo Onaylandı',
  cin_demo_onay: 'Demo Onaylandı',
  ozalit_onay: 'Ozalit Onaylandı',
}

const REJECT_LABELS = {
  demo_onay: 'Demo Reddedildi',
  cin_demo_onay: 'Demo Reddedildi',
  ozalit_onay: 'Ozalit Reddedildi',
}

/** True for the rows the sipariş form viewer can open. */
export function isOrderEntry(h) {
  return h.action === 'order' || String(h.event ?? '').startsWith('order_')
}

/**
 * Resolve one history row to { icon, tone, weight, group, label }.
 * Never returns undefined — an unrecognised row degrades to a neutral,
 * minor 'İlerletildi' rather than crashing the timeline on `meta.icon`.
 */
export function historyMeta(h) {
  const base = (h.event && EVENTS[h.event]) || ACTIONS[h.action] || ACTIONS.advance

  // Order rows carry their step label from the server; it's more specific
  // than anything this table could reconstruct.
  if (isOrderEntry(h) && h.order_step_label) {
    return { ...base, label: `Sipariş — ${h.order_step_label}` }
  }
  if (base.label) return base

  // Legacy rows: derive the label from the stage transition.
  if (h.action === 'create') return { ...base, label: 'Proje Oluşturuldu' }
  if (h.action === 'advance') return { ...base, label: ADVANCE_LABELS[h.to_stage] ?? 'İlerletildi' }
  if (h.action === 'approve') return { ...base, label: APPROVE_LABELS[h.from_stage] ?? 'Onaylandı' }
  if (h.action === 'reject') return { ...base, label: REJECT_LABELS[h.from_stage] ?? 'Reddedildi' }
  if (h.action === 'order') return { ...base, label: 'Sipariş' }
  return { ...base, label: 'İlerletildi' }
}

/** Local-time YYYY-MM-DD. Not `toISOString` — that shifts the day after 21:00 in TR. */
function dayKey(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'bilinmeyen'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Bugün" / "Dün" / "23 Temmuz 2026" for the sticky day headings. */
export function dayLabel(key) {
  if (key === 'bilinmeyen') return 'Tarihsiz'
  const now = new Date()
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (key === iso(now)) return 'Bugün'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (key === iso(yesterday)) return 'Dün'
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Turn the flat ascending list into what the timeline actually renders:
 * newest-first day buckets whose runs of consecutive low-signal rows are
 * folded into one collapsible node.
 *
 * The folding threshold is 3. Below it, collapsing costs the reader a click
 * to see no more than two lines they'd have skimmed anyway; at 3+ the run is
 * genuinely burying the pipeline moments around it.
 */
export const FOLD_THRESHOLD = 3

export function buildTimeline(entries, filter = 'all') {
  const filtered =
    filter === 'all' ? entries : entries.filter((h) => historyMeta(h).group === filter)

  // Newest first: paired with the "daha fazla" cut-off, chronological order
  // would hide the most recent activity behind the cut, which is backwards
  // for a log people open to answer "what just happened?".
  const ordered = [...filtered].reverse()

  const days = []
  let currentDay = null
  for (const entry of ordered) {
    const key = dayKey(entry.created_at)
    if (!currentDay || currentDay.key !== key) {
      currentDay = { key, label: dayLabel(key), nodes: [] }
      days.push(currentDay)
    }
    const meta = historyMeta(entry)
    const last = currentDay.nodes[currentDay.nodes.length - 1]
    // Extend the open run of minor rows, or start a new one.
    if (meta.weight === 'minor') {
      if (last?.type === 'run') last.entries.push(entry)
      else currentDay.nodes.push({ type: 'run', id: `run-${key}-${currentDay.nodes.length}`, entries: [entry] })
    } else {
      currentDay.nodes.push({ type: 'entry', id: entry.id ?? `${key}-${currentDay.nodes.length}`, entry, meta })
    }
  }

  // A run that never reached the threshold isn't worth hiding — unfold it
  // back into individual rows so the reader doesn't click to reveal one line.
  for (const day of days) {
    day.nodes = day.nodes.flatMap((node) => {
      if (node.type !== 'run' || node.entries.length >= FOLD_THRESHOLD) return node
      return node.entries.map((entry, i) => ({
        type: 'entry',
        id: entry.id ?? `${day.key}-mini-${i}`,
        entry,
        meta: historyMeta(entry),
      }))
    })
  }

  return days
}

/** Live counts for the filter chips, so a chip never leads to an empty list. */
export function filterCounts(entries) {
  const counts = { all: entries.length, stage: 0, approval: 0, subtask: 0, order: 0 }
  for (const h of entries) counts[historyMeta(h).group] += 1
  return counts
}

/**
 * Cut the timeline to roughly `limit` nodes without orphaning a day heading.
 * A day is kept whole once it starts, so the cut lands on a day boundary and
 * the reader never sees "23 Temmuz" followed by two of its nine rows.
 */
export function truncateTimeline(days, limit) {
  let shown = 0
  const kept = []
  let hidden = 0
  for (const day of days) {
    if (shown >= limit) {
      hidden += day.nodes.length
      continue
    }
    kept.push(day)
    shown += day.nodes.length
  }
  return { days: kept, hidden }
}

// ── Attached-form availability ────────────────────────────────────────
//
// Which rows get a "Demo Formu" / "Ozalit Formu" button. These predicates
// are deliberately narrow: subtask changes are logged with `from_stage` set
// to whatever stage the project happened to be sitting at, so a subtask
// ticked while the project waited at demo_onay produced a row with
// from_stage='demo_onay' — and the old broad check put a Demo Formu button
// on it. Only real demo/ozalit lifecycle rows qualify.

const DEMO_TESLIM_STAGES = ['demo_teslim', 'cin_demo_teslim']
const DEMO_ONAY_STAGES = ['demo_onay', 'cin_demo_onay']

export function hasDemoForm(h) {
  if (h.event === 'demo_form') return true
  if (h.action === 'advance') {
    return DEMO_TESLIM_STAGES.includes(h.to_stage) || DEMO_TESLIM_STAGES.includes(h.from_stage)
  }
  if (h.action === 'approve' || h.action === 'reject') {
    return DEMO_ONAY_STAGES.includes(h.from_stage)
  }
  return false
}

export function hasOzalitForm(h, projectType) {
  if (projectType !== 'TR') return false
  if (h.event === 'ozalit_form') return true
  if (h.action === 'advance') {
    return h.to_stage === 'ozalit_teslim' || h.from_stage === 'ozalit_teslim'
  }
  if (h.action === 'approve' || h.action === 'reject') {
    return h.from_stage === 'ozalit_onay'
  }
  return false
}
