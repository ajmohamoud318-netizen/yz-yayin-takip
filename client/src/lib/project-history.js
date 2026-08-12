import {
  CheckCircle2,
  ChevronRight,
  ClipboardEdit,
  ClipboardList,
  EyeOff,
  MessageSquarePlus,
  Package,
  PackageCheck,
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
  // Ink, not rose. `--primary` is documented in index.css as "primary actions
  // only", and at /10 its 345° rose sits ~15° from `--destructive`'s 0° red —
  // on warm paper the two tints were indistinguishable, so a rejected demo
  // wore the same disc as the advance that produced it. Ink keeps forward
  // motion legible as structure and leaves red to mean exactly one thing.
  pipeline: {
    dot: 'bg-foreground/70',
    icon: 'text-foreground',
    surface: 'bg-foreground/[0.06]',
  },
  positive: {
    dot: 'bg-emerald-600',
    icon: 'text-emerald-700 dark:text-emerald-400',
    surface: 'bg-emerald-600/10',
  },
  // The only filled disc in the table. A rejection is what people open this
  // panel to find; a tint among tints made it something you had to hunt for.
  negative: {
    dot: 'bg-destructive',
    icon: 'text-destructive-foreground',
    surface: 'bg-destructive',
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
  // Backlist product promoted out of Ürün Bilgileri into a real orderable
  // product (POST /api/projects/import). Its timeline starts here — there is no
  // tasarım/demo/ozalit history to show, because the book predates the system.
  legacy_import: { icon: Package, tone: 'neutral', weight: 'major', group: 'stage', label: 'Arşivden Ürün Olarak Eklendi' },
  // "Kaldır" / "Geri Al" on the Ürünler page (migration 033). Grouped under
  // 'order' rather than 'stage': the stage never moves, what changes is whether
  // Sales can order the product.
  catalog_delist: { icon: EyeOff, tone: 'pending', weight: 'major', group: 'order', label: 'Katalogdan Kaldırıldı' },
  catalog_relist: { icon: PackageCheck, tone: 'positive', weight: 'major', group: 'order', label: 'Katalogda Tekrar Yayında' },

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

// The two halves of a demo/ozalit handoff travel in opposite directions, but
// both are `action: 'advance'` and so both fell through to ACTIONS.advance's
// generic ChevronRight — "Demoya Gönderildi" and "Demo Teslim Edildi" rendered
// as the same glyph. Keyed by destination stage; anything unlisted keeps the
// chevron, which is honest for a step with no better symbol.
const ADVANCE_ICONS = {
  demo_teslim: Send,
  cin_demo_teslim: Send,
  ozalit_teslim: Send,
  demo_onay: PackageCheck,
  cin_demo_onay: PackageCheck,
  ozalit_onay: PackageCheck,
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
  if (h.action === 'advance') {
    return {
      ...base,
      icon: ADVANCE_ICONS[h.to_stage] ?? base.icon,
      label: ADVANCE_LABELS[h.to_stage] ?? 'İlerletildi',
    }
  }
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
 * chronological day buckets whose runs of consecutive low-signal rows are
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

  // Chronological: "Proje Oluşturuldu" at the top, the newest row at the
  // bottom, so the timeline reads as the story of the project in the order it
  // happened. `entries` already arrives ascending from ProjectDetail.
  //
  // This puts the cut-off on the OTHER end from where it used to be — see
  // truncateTimeline, which now drops the oldest days and parks its expander
  // above the list rather than below it.
  const ordered = filtered

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
 *
 * `days` is chronological, so the cut has to run backwards: we keep the most
 * RECENT days and hide the oldest. Taking the first `limit` here would collapse
 * a busy project down to the day it was created and hide everything since.
 */
export function truncateTimeline(days, limit) {
  let shown = 0
  const kept = []
  let hidden = 0
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i]
    if (shown >= limit) {
      hidden += day.nodes.length
      continue
    }
    kept.push(day)
    shown += day.nodes.length
  }
  kept.reverse() // back into chronological order for rendering
  return { days: kept, hidden }
}

/**
 * Notes are written server-side without knowing what label the row will get,
 * so several of them restate it: 'Proje oluşturuldu' under "Proje Oluşturuldu"
 * is a dead line, and 'Demo teslim edildi — onaya gönderildi' spends half its
 * width repeating the heading above it. Drop the echo, keep the remainder.
 */
export function dedupeNote(note, label) {
  if (!note) return null
  const n = note.trim()
  const lower = n.toLocaleLowerCase('tr')
  const head = label.toLocaleLowerCase('tr')
  if (lower === head) return null
  for (const sep of [' — ', ' – ', ' - ', ': ']) {
    if (lower.startsWith(head + sep)) {
      const rest = n.slice(head.length + sep.length).trim()
      if (!rest) return null
      return rest.charAt(0).toLocaleUpperCase('tr') + rest.slice(1)
    }
  }
  return n
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
