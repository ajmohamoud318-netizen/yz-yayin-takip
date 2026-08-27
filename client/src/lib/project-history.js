import {
  CheckCircle2,
  ChevronRight,
  ClipboardEdit,
  ClipboardList,
  EyeOff,
  MessageSquarePlus,
  MessageSquareWarning,
  Monitor,
  Package,
  PackageCheck,
  PackageX,
  Play,
  Plus,
  RotateCcw,
  Send,
  ShoppingCart,
  ThumbsDown,
  ThumbsUp,
  Truck,
  Undo2,
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
 *   noteMode what to do with the server's free-text note, which is written
 *           without knowing what label the row will get:
 *             'echo'    the note only restates the label in different words
 *                       ('Matbaa değişiklik talebini kabul etti' under
 *                       "Değişiklik Kabul Edildi") — drop it.
 *             'detail'  the note IS the fact and the label would only repeat
 *                       it ('Kapak, sayfa 12/40' under "Alt Görev
 *                       İlerlemesi") — in a dense row, print the note alone.
 *             (default) the note carries something the label doesn't (a
 *                       change request's reason) — print label, then note.
 *           Exact echoes are already handled by `dedupeNote`; 'echo' is only
 *           for the ones whose wording differs from the heading.
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
  { value: 'order', label: 'Baskı' },
]

const EVENTS = {
  project_created: { icon: Plus, tone: 'pipeline', weight: 'major', group: 'stage', label: 'Proje Oluşturuldu' },
  project_edit: { icon: ClipboardEdit, tone: 'neutral', weight: 'minor', group: 'stage', label: 'Proje Düzenlendi' },
  // Backlist product promoted out of Ürün Bilgileri into a real orderable
  // product (POST /api/projects/import). Its timeline starts here — there is no
  // tasarım/demo/ozalit history to show, because the book predates the system.
  legacy_import: { icon: Package, tone: 'neutral', weight: 'major', group: 'stage', label: 'Kayıttan Ürün Olarak Eklendi' },
  // "Kaldır" / "Geri Al" on the Ürünler page (migration 033). Grouped under
  // 'order' rather than 'stage': the stage never moves, what changes is whether
  // Sales can order the product.
  catalog_delist: { icon: EyeOff, tone: 'pending', weight: 'major', group: 'order', label: 'Katalogdan Kaldırıldı' },
  catalog_relist: { icon: PackageCheck, tone: 'positive', weight: 'major', group: 'order', label: 'Katalogda Tekrar Yayında' },

  // Every subtask note is written as '<alt görev>, <ne oldu>' — 'Kapak,
  // sayfa 12/40' — so it already carries the label's information plus the
  // one thing the label can't know. Hence noteMode 'detail': a folded run
  // prints the note alone rather than six identical headings.
  subtask_done: { icon: CheckCircle2, tone: 'positive', weight: 'minor', group: 'subtask', label: 'Alt Görev Tamamlandı', noteMode: 'detail' },
  subtask_undone: { icon: RotateCcw, tone: 'pending', weight: 'minor', group: 'subtask', label: 'Alt Görev Geri Alındı', noteMode: 'detail' },
  subtask_revize: { icon: RotateCcw, tone: 'pending', weight: 'minor', group: 'subtask', label: 'Alt Görev Revize Edildi', noteMode: 'detail' },
  subtask_progress: { icon: ClipboardList, tone: 'neutral', weight: 'minor', group: 'subtask', label: 'Alt Görev İlerlemesi', noteMode: 'detail' },
  subtask_note: { icon: MessageSquarePlus, tone: 'neutral', weight: 'minor', group: 'subtask', label: 'Alt Görev Notu', noteMode: 'detail' },
  subtask_list_update: { icon: ClipboardList, tone: 'neutral', weight: 'minor', group: 'subtask', label: 'Alt Görev Listesi Güncellendi', noteMode: 'detail' },

  demo_form: { icon: Send, tone: 'pipeline', weight: 'major', group: 'approval', label: 'Demo Formu Gönderildi' },
  ozalit_form: { icon: Send, tone: 'pipeline', weight: 'major', group: 'approval', label: 'Ozalit Formu Gönderildi' },
  // "Formu Düzenleyin" (ProjectDetail.jsx) — a correction to an already-sent
  // demo/ozalit while it's still with the matbaa, before demo_form/ozalit_form
  // above ever fires again. Without an entry here `action: 'system'` fell
  // through to the generic 'İlerletildi' label, which reads as a stage
  // advance that never happened.
  demo_form_edited: { icon: ClipboardEdit, tone: 'neutral', weight: 'minor', group: 'approval', label: 'Demo Formu Güncellendi' },
  ozalit_form_edited: { icon: ClipboardEdit, tone: 'neutral', weight: 'minor', group: 'approval', label: 'Ozalit Formu Güncellendi' },

  // ── The demo/ozalit round's own lifecycle ───────────────────────────
  // Every row below is written server-side as `action: 'system'` with no
  // matching entry here, so all of them fell through to ACTIONS.system:
  // no label (→ the generic 'İlerletildi', which is why the timeline printed
  // the raw note instead — 'kaaa' as a heading), no icon of their own, and
  // group 'subtask', which filed a matbaa change request under "Alt Görevler"
  // and inflated that chip's count with rows that are not subtasks at all.
  //
  // Labels follow ORDER_STEP_LABELS (domain/constants/orders.js) so the same
  // moment reads identically whether it happened in the sipariş lane or here.
  //
  // 'major', despite repeating once per round: this is the matbaa physically
  // picking the job up, and it is the anchor every change request that
  // follows hangs off. As 'minor' it also left a whole day of demo
  // negotiation with no major row to break the run, so buildDays folded the
  // entire day behind one summary line — a rejected change is not the kind
  // of thing a fold is allowed to swallow.
  // noteMode 'echo': the note under these is a fixed server string that only
  // restates the heading, and rows written before the label was reworded carry
  // the older 'Matbaa demoya başladı' phrasing — neither says anything the
  // heading doesn't, so an echo beats a grey second line that repeats it.
  demo_started: { icon: Play, tone: 'pipeline', weight: 'major', group: 'approval', label: 'Demo Çalışması Başlatıldı', noteMode: 'echo' },
  ozalit_started: { icon: Play, tone: 'pipeline', weight: 'major', group: 'approval', label: 'Ozalit Çalışması Başlatıldı', noteMode: 'echo' },
  // A cancel moves the project back to tasarım, so it is a pipeline moment,
  // not bookkeeping. dedupeNote trims its note down to 'Tasarıma geri döndü'.
  demo_cancelled: { icon: Undo2, tone: 'pending', weight: 'major', group: 'approval', label: 'Demo Talebi İptal Edildi' },
  ozalit_cancelled: { icon: Undo2, tone: 'pending', weight: 'major', group: 'approval', label: 'Ozalit Talebi İptal Edildi' },
  // The change-request negotiation. 'requested' keeps its note — that note is
  // the reason the leader typed; the answers only restate their own heading.
  //
  // Weights follow what the row costs the reader, not how often it fires:
  //   requested — carries the typed reason ("sayfa sayısı yanlış girildi").
  //               Dense-folded, that reason shrank to a grey second line.
  //   declined  — the change did NOT happen and the designer has to know.
  //               A row whose tone is 'negative' cannot be folded behind a
  //               neutral summary; the two contradicted each other.
  //   accepted  — stays 'minor'. It is the "evet" half of a pair whose
  //               question is already a major row above it. A lone accepted
  //               row still unfolds back to full width (see buildDays), so
  //               this only folds when it is part of a real run.
  demo_change_requested: { icon: MessageSquareWarning, tone: 'pending', weight: 'major', group: 'approval', label: 'Değişiklik İstendi' },
  ozalit_change_requested: { icon: MessageSquareWarning, tone: 'pending', weight: 'major', group: 'approval', label: 'Değişiklik İstendi' },
  demo_change_accepted: { icon: ThumbsUp, tone: 'positive', weight: 'minor', group: 'approval', label: 'Değişiklik Kabul Edildi', noteMode: 'echo' },
  ozalit_change_accepted: { icon: ThumbsUp, tone: 'positive', weight: 'minor', group: 'approval', label: 'Değişiklik Kabul Edildi', noteMode: 'echo' },
  demo_change_declined: { icon: ThumbsDown, tone: 'negative', weight: 'major', group: 'approval', label: 'Değişiklik Reddedildi', noteMode: 'echo' },
  ozalit_change_declined: { icon: ThumbsDown, tone: 'negative', weight: 'major', group: 'approval', label: 'Değişiklik Reddedildi', noteMode: 'echo' },

  // Ekran demo (ÇİN): an on-screen approval round with no physical delivery.
  // 'major' for the same reason as demo_change_requested: a round whose two
  // possible answers below are both major cannot itself be bookkeeping, and
  // on the ÇİN lane it is often the only thing that happens all day.
  ekran_demo_requested: { icon: Monitor, tone: 'pending', weight: 'major', group: 'approval', label: 'Ekran Demo Onayı İstendi' },
  ekran_demo_approved: { icon: ThumbsUp, tone: 'positive', weight: 'major', group: 'approval', label: 'Ekran Demo Onaylandı' },
  ekran_demo_rejected: { icon: ThumbsDown, tone: 'negative', weight: 'major', group: 'approval', label: 'Ekran Demo Reddedildi' },
  // Maker half of the baskı-onay maker/checker pair (migration 045). Its note
  // dedupes down to the part the label doesn't say: 'Onay bekleniyor'.
  baski_onay_prepared: { icon: ClipboardEdit, tone: 'pipeline', weight: 'major', group: 'approval', label: 'Baskı Onay Formu Hazırlandı' },

  // The receipt gates. These are `action: 'advance'` rows that don't move the
  // stage, so without an entry here they fell through to ADVANCE_LABELS and
  // rendered as the delivery they acknowledge ("Demo Teslim Edildi") — two
  // different moments wearing the same label.
  demo_received: { icon: PackageCheck, tone: 'positive', weight: 'major', group: 'approval', label: 'Demo Teslim Alındı' },
  demo_not_received: { icon: PackageX, tone: 'negative', weight: 'major', group: 'approval', label: 'Demo Teslim Alınamadı' },
  ozalit_received: { icon: PackageCheck, tone: 'positive', weight: 'major', group: 'approval', label: 'Ozalit Teslim Alındı' },
  ozalit_not_received: { icon: PackageX, tone: 'negative', weight: 'major', group: 'approval', label: 'Ozalit Teslim Alınamadı' },
  // Written by the server when a project lands on Baskıda and its approved
  // baski_onay/ozalit/demo sheet is copied into Ürün Bilgileri
  // (services/product-info-capture.js). 'minor' because nobody performed it —
  // it's bookkeeping that explains where a spec the leader never typed came from.
  product_info_auto: { icon: Package, tone: 'neutral', weight: 'minor', group: 'order', label: 'Ürün Bilgileri Otomatik Kaydedildi' },
  // One-time bookkeeping row from migration 047: a project sitting at
  // uretime_hazir/uretimde got collapsed into baskida. 'minor' since nobody
  // performed it — it's the migration explaining the stage jump.
  stage_rename: { icon: Package, tone: 'neutral', weight: 'minor', group: 'stage', label: 'Aşama Yeniden Adlandırıldı' },

  handover_request: { icon: Truck, tone: 'pending', weight: 'major', group: 'order', label: 'Teslim Talebi Oluşturuldu' },
  handover_confirm: { icon: Package, tone: 'positive', weight: 'major', group: 'order', label: 'Teslim Onaylandı' },

  order_request: { icon: ShoppingCart, tone: 'order', weight: 'major', group: 'order', label: 'Baskı Talebi Oluşturuldu' },
  order_transfer: { icon: ShoppingCart, tone: 'order', weight: 'major', group: 'order', label: 'Tasarımcı Atandı' },
  order_advance: { icon: ShoppingCart, tone: 'order', weight: 'major', group: 'order', label: 'Baskı İlerletildi' },
  order_final: { icon: ShoppingCart, tone: 'order', weight: 'major', group: 'order', label: 'Baskı Onaylandı' },
  order_reject: { icon: ShoppingCart, tone: 'negative', weight: 'major', group: 'order', label: 'Baskı Reddedildi' },
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
  // uretime_hazir/uretimde are retired (migration 047, collapsed into
  // baskida) but kept so historical rows predating the rename still label
  // correctly.
  uretime_hazir: 'Üretime Hazır',
  uretimde: 'Üretime Alındı (Baskı)',
  baskida: 'Baskıya Alındı',
  gumruk: 'Gümrüğe Gönderildi',
  satista: 'Satışa Çıkarıldı',
}

const APPROVE_LABELS = {
  demo_onay: 'Demo Onaylandı',
  cin_demo_onay: 'Demo Onaylandı',
  ozalit_onay: 'Ozalit Onaylandı',
  baski_onay: 'Baskı Onaylandı',
  cin_baski_onay: 'Baskı Onaylandı',
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
    return { ...base, label: `Baskı, ${h.order_step_label}` }
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
  if (h.action === 'order') return { ...base, label: 'Baskı' }
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
  let seq = 0
  let lastRow = null // the row a consecutive repeat would extend
  for (const entry of ordered) {
    const key = dayKey(entry.created_at)
    if (!currentDay || currentDay.key !== key) {
      currentDay = { key, label: dayLabel(key), nodes: [] }
      days.push(currentDay)
      seq = 0
      // Never merge across midnight: a merged row prints one clock span, and
      // a span cannot straddle two day headings.
      lastRow = null
    }
    const meta = historyMeta(entry)

    // Same thing, said again, back to back. Seven identical rows are one fact
    // with a count — printing them seven times buried the round they belong
    // to. The merged row keeps the NEWEST entry, whose attempt slot is the
    // one a form button must open, and both clock times.
    //
    // Two "Demo Formu Güncellendi" rows are NOT that case any more: since
    // migration 052 each correction records the snapshot it wrote (demo_id),
    // so each row opens a different sheet — the one sent before the matbaa
    // started and the one an accepted change request allowed afterwards.
    // repeatKey carries demo_id for exactly that reason, so they stay two
    // rows; only rows that truly print the same thing still merge.
    if (lastRow && repeatKey(lastRow.entry) === repeatKey(entry)) {
      lastRow.entries.push(entry)
      lastRow.entry = entry
      lastRow.count += 1
      lastRow.lastAt = entry.created_at
      continue
    }

    const row = {
      type: 'entry',
      id: entry.id ?? `${key}-${seq++}`,
      entry, // the newest of the merged events — the one the row speaks as
      entries: [entry], // every one of them, oldest first: each owns a snapshot
      meta,
      count: 1,
      firstAt: entry.created_at,
      lastAt: entry.created_at,
    }
    const last = currentDay.nodes[currentDay.nodes.length - 1]
    // Extend the open run of minor rows, or start a new one.
    if (meta.weight === 'minor') {
      if (last?.type === 'run') last.rows.push(row)
      else currentDay.nodes.push({ type: 'run', id: `run-${key}-${seq}`, rows: [row] })
    } else {
      currentDay.nodes.push(row)
    }
    lastRow = row
  }

  // A run that never reached the threshold isn't worth hiding — unfold it
  // back into individual rows so the reader doesn't click to reveal one line.
  // `total` is the count of underlying EVENTS, not of rows: the summary has to
  // stay truthful about how much it is hiding after the merge above.
  for (const day of days) {
    day.nodes = day.nodes.flatMap((node) => {
      if (node.type !== 'run') return node
      if (node.rows.length < FOLD_THRESHOLD) return node.rows
      return { ...node, total: node.rows.reduce((n, r) => n + r.count, 0) }
    })
  }

  return days
}

/**
 * Identity of a row for the consecutive-repeat merge. Everything the timeline
 * can print has to be in here, or the merge would hide a difference the
 * reader would have seen: a different note, a different actor, a different
 * rejection reason, or a form button pointing at a different attempt slot.
 *
 * `demo_id` is deliberately absent even though two corrections of one round
 * write different snapshots (migration 052): the merged row keeps every entry
 * and offers one numbered link per version, so no sheet becomes unreachable.
 * Splitting on it instead would put the seven identical headings back, which
 * is the thing this merge exists to remove.
 */
function repeatKey(h) {
  return [
    h.event ?? h.action ?? '',
    h.from_stage ?? '',
    h.to_stage ?? '',
    (h.note ?? '').trim(),
    (h.reason ?? '').trim(),
    h.done_by_name ?? '',
    h.demoAttemptAt ?? '',
    h.ozalitAttemptAt ?? '',
    h.order_id ?? '',
    h.order_step ?? '',
  ].join('\u0000')
}

/** Live counts for the filter chips, so a chip never leads to an empty list. */
export function filterCounts(entries) {
  const counts = { all: entries.length, stage: 0, approval: 0, subtask: 0, order: 0 }
  for (const h of entries) counts[historyMeta(h).group] += 1
  return counts
}

/**
 * Buckets the fold-summary breakdown reads from. A fold can hold rows from
 * many `event` types at once; instead of telling the reader "N küçük
 * güncelleme" and forcing a click to find out what happened, the summary
 * shows the count per bucket — "4 alt görev, 2 form düzenleme" — so the
 * activity is legible before the fold is opened.
 *
 * Each bucket maps an event name to the noun the summary uses. The noun is
 * already plural-safe in Turkish ("1 alt görev" and "5 alt görev" read the
 * same), so no suffix dance is needed.
 */
const FOLD_BUCKETS = [
  { events: ['subtask_done', 'subtask_undone', 'subtask_revize', 'subtask_progress', 'subtask_note', 'subtask_list_update'], label: 'alt görev' },
  { events: ['demo_form_edited', 'ozalit_form_edited'], label: 'form düzenleme' },
  { events: ['demo_change_accepted', 'ozalit_change_accepted'], label: 'kabul' },
  { events: ['product_info_auto'], label: 'ürün bilgisi' },
  { events: ['project_edit'], label: 'proje düzenleme' },
  { events: ['stage_rename'], label: 'aşama adı' },
]

function bucketOf(event) {
  if (!event) return null
  for (const bucket of FOLD_BUCKETS) {
    if (bucket.events.includes(event)) return bucket
  }
  return null
}

/**
 * Count rows per bucket, in display order. Returns `[{ count, label }, …]`
 * with every bucket that has at least one row. Order matches FOLD_BUCKETS
 * so a fold of "alt görev + form düzenleme" reads as the activity the
 * project spent its time on first, then the next.
 */
export function foldBreakdown(rows) {
  const counts = new Map()
  for (const row of rows) {
    const bucket = bucketOf(row.meta.event)
    if (!bucket) continue
    counts.set(bucket, (counts.get(bucket) ?? 0) + row.count)
  }
  const out = []
  for (const bucket of FOLD_BUCKETS) {
    const count = counts.get(bucket)
    if (count) out.push({ count, label: bucket.label })
  }
  return out
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
 * is a dead line, and 'Demo teslim edildi, onaya gönderildi' spends half its
 * width repeating the heading above it. Drop the echo, keep the remainder.
 *
 * The dash separators stay in the list even though new notes are written with
 * a comma: `stage_history` is append-only, so every row logged before the copy
 * switch still reads 'Demo teslim edildi — onaya gönderildi' and would start
 * echoing its own heading the moment ' — ' left this list.
 */
export function dedupeNote(note, label) {
  if (!note) return null
  const n = note.trim()
  const lower = n.toLocaleLowerCase('tr')
  const head = label.toLocaleLowerCase('tr')
  if (lower === head) return null
  for (const sep of [', ', ' — ', ' – ', ' - ', ': ']) {
    if (lower.startsWith(head + sep)) {
      const rest = n.slice(head.length + sep.length).trim()
      if (!rest) return null
      return rest.charAt(0).toLocaleUpperCase('tr') + rest.slice(1)
    }
  }
  return n
}

/**
 * What a row actually prints: a heading, and the note under it when the note
 * says something the heading doesn't.
 *
 * The timeline used to print `entry.note || label` for its dense rows, so the
 * note always won — and a note is free text somebody typed in a hurry. A
 * change request reasoned "sayfa sayisi yanlis girildi" became the heading,
 * and one typed "kaaa" became a row that said nothing at all. The heading now
 * leads; see `noteMode` on the EVENTS table for the two exceptions.
 *
 * `dense` marks the one-line rows inside a folded run, which are the only
 * place a 'detail' note stands in for its heading — a full-width row has the
 * space for both.
 */
export function rowText(entry, meta, { dense = false } = {}) {
  const note = isOrderEntry(entry) ? null : dedupeNote(entry.note, meta.label)
  if (!note || meta.noteMode === 'echo') return { title: meta.label, detail: null }
  if (dense && meta.noteMode === 'detail') return { title: note, detail: null }
  return { title: meta.label, detail: note }
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

/**
 * Attempt slot a row's form button should open — the fallback for rows older
 * than migration 052, which now also carry `demo_id`: the exact snapshot the
 * row wrote, the only thing that tells two corrections of one round apart.
 * An edit's snapshot is staged
 * one slot PAST the round's own so the as-first-sent sheet stays intact and
 * reopenable (see `attemptNo` / `liveAttempts` in SpecFormDialog.jsx), so the
 * two "Demo Formu" buttons on one round point at different slots: the major
 * row opens what was sent, the edit row opens the correction.
 */
export const demoFormAttempt = (h) =>
  h.demoAttemptAt + (h.event === 'demo_form_edited' ? 1 : 0)
export const ozalitFormAttempt = (h) =>
  h.ozalitAttemptAt + (h.event === 'ozalit_form_edited' ? 1 : 0)

export function hasDemoForm(h) {
  if (h.event === 'demo_form') return true
  // A correction to an already-sent demo. Its own snapshot is the ONLY place
  // the updated sheet can be reopened from the timeline — the major
  // "Demoya Gönderildi" row above it still shows the sheet as first sent.
  // MinorRow offers this button, but a lone edit row never reaches MinorRow:
  // a run of fewer than FOLD_THRESHOLD minors is unfolded back into MajorRow
  // (see buildDays), which asks this function — so in the common case, one
  // edit, the updated form had no way in at all.
  if (h.event === 'demo_form_edited') return true
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
  if (h.event === 'ozalit_form_edited') return true
  if (h.action === 'advance') {
    return h.to_stage === 'ozalit_teslim' || h.from_stage === 'ozalit_teslim'
  }
  if (h.action === 'approve' || h.action === 'reject') {
    return h.from_stage === 'ozalit_onay'
  }
  return false
}
