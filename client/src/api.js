import axios from 'axios'

/**
 * Central API client. Every network call in the app goes through here.
 *
 * NOTE: The backend (Node/Express) is not built yet. To keep the UI fully
 * clickable, this module ships with a MOCK layer that mimics the REST
 * responses defined in CLAUDE.md. When the real API is ready, set
 * USE_MOCK = false and the same function signatures hit `/api/*` unchanged.
 */
const USE_MOCK = true

const client = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

// Attach auth header on every request (token kept in memory by useAuth).
let authToken = null
export function setAuthToken(token) {
  authToken = token
}
client.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`
  return config
})

/* ------------------------------------------------------------------ */
/*  Shared UI constants (Turkish labels + status colors from CLAUDE.md) */
/* ------------------------------------------------------------------ */

// ── Sipariş Talep mini-workflow ──────────────────────────────────────────────
// Each order goes through its own 5-step sign-off cycle, completely separate
// from the project's main pipeline. The project stays at its current stage
// until the last step ('onaylandi'), at which point uretime_hazir → uretimde.

export const ORDER_STEPS = ['pending', 'goruldu', 'tasarimci_onay', 'matbaa_onay', 'onaylandi']

export const ORDER_STEP_LABELS = {
  pending:       'Talep Gönderildi',
  goruldu:       'Tasarımcıya Aktarıldı',
  tasarimci_onay:'Tasarımcı Onayı',
  matbaa_onay:   'Matbaa Teslimi',
  onaylandi:     'Üretime Alındı',
}

// Which role must act to advance FROM each step
export const ORDER_STEP_OWNER = {
  pending:       'team_leader',
  goruldu:       'designer',
  tasarimci_onay:'printer',
  matbaa_onay:   'team_leader',
}

export const ORDER_STEP_NEXT = {
  pending:       'goruldu',
  goruldu:       'tasarimci_onay',
  tasarimci_onay:'matbaa_onay',
  matbaa_onay:   'onaylandi',
}

// Pipeline stage -> Turkish label
export const STAGE_LABELS = {
  tasarim: 'Tasarım',
  demo_teslim: 'Demo Teslim',
  demo_onay: 'Demo Onay',
  ozalit_teslim: 'Ozalit Teslim',
  ozalit_onay: 'Ozalit Onay',
  cin_demo_teslim: 'Çin Demo Teslim',
  cin_demo_onay: 'Çin Demo Onay',
  uretime_hazir: 'Üretime Hazır',
  uretimde: 'Üretimde',
  gumruk: 'Gümrük',
  satista: 'Satışta',
}

// Dashboard grouping labels (not pipeline stages — see CLAUDE.md)
export const GROUP_LABELS = {
  yeni_proje: 'Yeni Proje',
  devam_eden: 'Devam Eden Proje',
}

// Status color system from CLAUDE.md, expressed as Tailwind classes.
// key -> { dot, badge, ring } so cards stay consistent.
export const STATUS_STYLES = {
  orange: {
    label: 'Yeni Proje',
    dot: 'bg-orange-500',
    topBorder: 'border-t-[3px] border-t-orange-500',
    badge: 'bg-orange-50 text-orange-700 ring-orange-600/20',
    bar: 'bg-orange-500',
    text: 'text-orange-600',
    surface: 'bg-orange-500',
    border: 'border-orange-600',
    onSurface: 'text-white',
  },
  purple: {
    label: 'Devam Eden',
    dot: 'bg-purple-500',
    topBorder: 'border-t-[3px] border-t-purple-500',
    badge: 'bg-purple-50 text-purple-700 ring-purple-600/20',
    bar: 'bg-purple-500',
    text: 'text-purple-600',
    surface: 'bg-purple-500',
    border: 'border-purple-600',
    onSurface: 'text-white',
  },
  green: {
    label: 'Demo aşamasında',
    dot: 'bg-emerald-500',
    topBorder: 'border-t-[3px] border-t-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    bar: 'bg-emerald-500',
    text: 'text-emerald-600',
    surface: 'bg-emerald-500',
    border: 'border-emerald-600',
    onSurface: 'text-white',
  },
  blue: {
    label: 'Ozalit aşamasında',
    dot: 'bg-blue-500',
    topBorder: 'border-t-[3px] border-t-blue-500',
    badge: 'bg-blue-50 text-blue-700 ring-blue-600/20',
    bar: 'bg-blue-500',
    text: 'text-blue-600',
    surface: 'bg-blue-500',
    border: 'border-blue-600',
    onSurface: 'text-white',
  },
  teal: {
    // "Üretime Hazır" — approved & queued, waiting for an order.
    label: 'Üretime Hazır',
    dot: 'bg-teal-500',
    topBorder: 'border-t-[3px] border-t-teal-500',
    badge: 'bg-teal-50 text-teal-700 ring-teal-600/20',
    bar: 'bg-teal-500',
    text: 'text-teal-600',
    surface: 'bg-teal-500',
    border: 'border-teal-600',
    onSurface: 'text-white',
  },
  pink: {
    // "Üretimde" — fuchsia, distinct from the green/blue stages.
    label: 'Üretimde',
    dot: 'bg-fuchsia-500',
    topBorder: 'border-t-[3px] border-t-fuchsia-500',
    badge: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20',
    bar: 'bg-fuchsia-500',
    text: 'text-fuchsia-600',
    surface: 'bg-fuchsia-500',
    border: 'border-fuchsia-600',
    onSurface: 'text-white',
  },
  yellow: {
    label: 'Satışta',
    dot: 'bg-amber-400',
    topBorder: 'border-t-[3px] border-t-amber-400',
    badge: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    bar: 'bg-amber-400',
    // Satışta's amber is too pale for white text — use a deep brown shade.
    text: 'text-amber-700',
    surface: 'bg-amber-400',
    border: 'border-amber-500',
    onSurface: 'text-[#5A3017]',
  },
}

// Alias used by Kanban, AllProjects, YearPlan, DemoRequests, etc.
// Same shape as STATUS_STYLES — just a friendlier name in the page code.
export const STATUS_META = STATUS_STYLES

// Pipeline definitions for the Kanban board.
// Each project type follows a different sequence of stages (see CLAUDE.md).
export const STAGE_PIPELINE = {
  TR: ['tasarim', 'demo_teslim', 'demo_onay', 'ozalit_teslim', 'ozalit_onay', 'uretime_hazir', 'uretimde', 'satista'],
  CIN: ['tasarim', 'cin_demo_teslim', 'cin_demo_onay', 'uretime_hazir', 'uretimde', 'gumruk', 'satista'],
}

// Subtask catalog used by NewProjectDialog. Each item has a stable key
// (used in the project's subtasks array) and a human label.
export const SUBTASK_LIBRARY = [
  { key: 'kapak', label: 'Kapak' },
  { key: 'kutu', label: 'Kutu' },
  { key: 'ses', label: 'Ses' },
  { key: 'sayfalar', label: 'Sayfa', kind: 'pages' },
  { key: 'sticker', label: 'Sticker' },
  { key: 'yazilim', label: 'Yazılım' },
  { key: 'media', label: 'Media' },
]

// Project type -> Turkish badge
export const TYPE_LABELS = { TR: 'TR', CIN: 'ÇİN' }

// Role -> Turkish label
export const ROLE_LABELS = {
  team_leader: 'Takım Lideri',
  designer: 'Tasarımcı',
  printer: 'Matbaa',
  satis: 'Satış Ekibi',
}

/**
 * Maps a project (stage + progress) to one of the status color keys.
 * Mirrors the CLAUDE.md color rules:
 *   orange  Yeni Proje / just started
 *   purple  Devam Eden / in progress
 *   green   Demo aşamasında
 *   blue    Ozalit aşamasında
 *   pink    Üretimde
 *   yellow  Satışta
 */
export function statusKeyForProject(p) {
  switch (p.stage) {
    case 'satista':
      return 'yellow'
    case 'uretime_hazir':
      return 'teal'
    case 'uretimde':
    case 'gumruk':
      return 'pink'
    case 'ozalit_teslim':
    case 'ozalit_onay':
      return 'blue'
    case 'demo_teslim':
    case 'demo_onay':
    case 'cin_demo_teslim':
    case 'cin_demo_onay':
      return 'green'
    case 'tasarim':
    default:
      // Not started yet (no subtasks done) = Yeni Proje (orange),
      // otherwise Devam Eden (purple).
      return p.progress > 0 ? 'purple' : 'orange'
  }
}

/** Dashboard grouping: which bucket a project falls into. */
export function groupKeyForProject(p) {
  if (p.stage === 'tasarim' && p.progress === 0) return 'yeni_proje'
  return 'devam_eden'
}

/**
 * Normalizes a create/update payload coming from NewProjectDialog into the
 * shape the rest of the app expects. The dialog sends `assignees` as an array
 * of user ids and `subtasks` as an array of library keys; here we turn those
 * into {id,name} assignee objects and real subtask objects, and recompute
 * progress. `existing` (on edit) lets us preserve already-completed work.
 */
function normalizeProjectPayload(payload, existing = null) {
  const { assignees, subtasks, pageCount, stickerCount, subtaskAssignees = {}, ...rest } = payload
  const out = { ...rest }

  // assignees: [id, ...] -> [{id, name}, ...] + assigned_to / assigned_name
  if (Array.isArray(assignees)) {
    const objs = assignees
      .map((id) => mockUsers.find((u) => u.id === id))
      .filter(Boolean)
      .map((u) => ({ id: u.id, name: u.name }))
    out.assignees = objs
    out.assigned_to = objs[0]?.id ?? null
    out.assigned_name = objs.map((a) => a.name).join(', ') || '—'
  }

  // subtasks: ['kapak', ...] -> [{id, title, kind, is_done, ...}]
  if (Array.isArray(subtasks)) {
    const prev = existing?.subtasks ?? []
    const subs = []
    for (const key of subtasks) {
      if (key === 'sayfalar') continue // page count handled below
      if (key === 'sticker') continue  // sticker count handled below
      const lib = SUBTASK_LIBRARY.find((s) => s.key === key)
      const title = lib ? lib.label : key
      const old = prev.find((s) => s.title === title && s.kind !== 'pages' && s.kind !== 'sticker-count')
      // Per-subtask designer assignment ('' means "inherit from project")
      const assignedTo = subtaskAssignees[key] || null
      const assignedUser = assignedTo ? mockUsers.find((u) => u.id === assignedTo) : null
      subs.push({
        id: old?.id ?? `st-${Date.now()}-${key}`,
        title,
        kind: 'check',
        is_done: old?.is_done ?? false,
        done_at: old?.done_at ?? null,
        assigned_to: assignedTo,
        assigned_name: assignedUser?.name ?? null,
      })
    }
    if (subtasks.includes('sayfalar') && pageCount) {
      const old = prev.find((s) => s.kind === 'pages')
      subs.push({
        id: old?.id ?? `st-${Date.now()}-sayfalar`,
        title: 'Sayfa Sayısı',
        kind: 'pages',
        total_pages: Number(pageCount),
        pages_done: old?.pages_done ?? 0,
        is_done: (old?.pages_done ?? 0) >= Number(pageCount),
      })
    }
    if (subtasks.includes('sticker') && stickerCount) {
      const old = prev.find((s) => s.kind === 'sticker-count')
      subs.push({
        id: old?.id ?? `st-${Date.now()}-sticker`,
        title: 'Sticker',
        kind: 'sticker-count',
        total_stickers: Number(stickerCount),
        stickers_done: old?.stickers_done ?? 0,
        is_done: (old?.stickers_done ?? 0) >= Number(stickerCount),
      })
    }
    out.subtasks = subs
    const total = subs.length || 1
    const done = subs.filter((s) => s.is_done).length
    out.progress = subs.length === 0 ? 0 : Math.round((done / total) * 100)
  } else if (!existing) {
    out.progress = 0
  }

  return out
}

/**
 * Builds the full detail shape ProjectDetail expects (subtasks, assignees,
 * history) from a flat mock project. If the project already carries these
 * arrays (e.g. after a subtask toggle), they are reused.
 */
// Progress % = completed subtasks / total subtasks × 100.
function subtaskProgress(subs) {
  if (!Array.isArray(subs) || subs.length === 0) return 0
  const done = subs.filter((s) => s.is_done).length
  return Math.round((done / subs.length) * 100)
}

/**
 * Reconstruct a plausible project timeline from current state alone.
 * Walks the pipeline in order and emits entries for every stage the
 * project has been through, including rejection / revision cycles.
 */
function generateHistory(p, assignees, subtasksDone, subtasksTotal) {
  const isCin = p.type === 'CIN'
  const pipeline = isCin ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR
  const demoAttempt = p.demo_attempt ?? 0
  const ozalitAttempt = p.ozalit_attempt ?? 0
  const designer = assignees[0]?.name ?? p.assigned_name ?? 'Tasarımcı'
  const demoStage = isCin ? 'cin_demo_teslim' : 'demo_teslim'
  const demoOnayStage = isCin ? 'cin_demo_onay' : 'demo_onay'
  const currentIdx = pipeline.indexOf(p.stage)

  // Space events evenly — older projects have more history
  const totalEvents = 2 + currentIdx * 2 + demoAttempt * 5 + ozalitAttempt * 4
  let t = Date.now() - totalEvents * 1.8 * 86400000
  const tick = (days = 1) => {
    t += days * 86400000
    return new Date(t).toISOString()
  }

  const h = []

  // ── Project created & designer assigned ────────────────────────────────────
  h.push({
    id: `${p.id}-hc`,
    action: 'create',
    from_stage: null,
    to_stage: 'tasarim',
    done_by_name: 'Ayşenur Kanak',
    created_at: tick(0),
    note: `${designer} atandı`,
  })

  // Nothing more for a brand-new project still in design
  if (currentIdx === 0 && demoAttempt === 0) return h

  // ── Demo rejection cycles ──────────────────────────────────────────────────
  for (let i = 0; i < demoAttempt; i++) {
    const attemptLabel = i === 0
      ? `Tasarım tamamlandı${subtasksTotal > 0 ? ` — ${subtasksDone}/${subtasksTotal} alt görev` : ''}`
      : `${i + 1}. demo — revizyon tamamlandı`
    h.push({
      id: `${p.id}-hd${i}`,
      action: 'advance',
      from_stage: 'tasarim',
      to_stage: demoStage,
      done_by_name: designer,
      created_at: tick(i === 0 ? 3 : 2),
      note: attemptLabel,
    })
    if (!isCin) {
      h.push({
        id: `${p.id}-ht${i}`,
        action: 'advance',
        from_stage: demoStage,
        to_stage: demoOnayStage,
        done_by_name: 'Oktay Şahin',
        created_at: tick(0.5),
        note: `${i + 1}. demo teslim alındı`,
      })
    }
    h.push({
      id: `${p.id}-hr${i}`,
      action: 'reject',
      from_stage: demoOnayStage,
      to_stage: 'tasarim',
      done_by_name: 'Ayşenur Kanak',
      reason: i === demoAttempt - 1
        ? (p.last_reject_reason ?? 'Kapak renkleri marka kılavuzuna uymuyor, lütfen revize edin.')
        : 'Görsel düzenlemeler gerekiyor.',
      created_at: tick(1),
    })
  }

  // Still in revision after last rejection — stop here
  if (p.stage === 'tasarim') return h

  // ── Current demo submission ────────────────────────────────────────────────
  const finalDemoLabel = demoAttempt === 0
    ? `Tasarım tamamlandı${subtasksTotal > 0 ? ` — ${subtasksDone}/${subtasksTotal} alt görev` : ''}`
    : `${demoAttempt + 1}. demo — revizyon tamamlandı`
  h.push({
    id: `${p.id}-hdf`,
    action: 'advance',
    from_stage: 'tasarim',
    to_stage: demoStage,
    done_by_name: designer,
    created_at: tick(demoAttempt === 0 ? 3 : 2),
    note: finalDemoLabel,
  })
  if (p.stage === demoStage) return h

  // ── Printer teslim (TR) ────────────────────────────────────────────────────
  if (!isCin) {
    h.push({
      id: `${p.id}-htf`,
      action: 'advance',
      from_stage: demoStage,
      to_stage: demoOnayStage,
      done_by_name: 'Oktay Şahin',
      created_at: tick(0.5),
      note: `${demoAttempt + 1}. demo teslim alındı`,
    })
  }
  if (p.stage === demoOnayStage) return h

  // ── Demo approved ──────────────────────────────────────────────────────────
  const afterDemoOnay = pipeline[pipeline.indexOf(demoOnayStage) + 1]
  h.push({
    id: `${p.id}-hda`,
    action: 'approve',
    from_stage: demoOnayStage,
    to_stage: afterDemoOnay,
    done_by_name: 'Ayşenur Kanak',
    created_at: tick(0.5),
  })

  if (isCin) {
    // approve landed on 'uretime_hazir' (afterDemoOnay). Order pushes to üretim.
    if (p.stage === 'uretime_hazir') return h
    h.push({ id: `${p.id}-hoh`, action: 'advance', from_stage: 'uretime_hazir', to_stage: 'uretimde', done_by_name: 'Esra Kılıçkan', created_at: tick(2), note: 'Sipariş alındı' })
    if (p.stage === 'uretimde') return h
    h.push({ id: `${p.id}-hug`, action: 'advance', from_stage: 'uretimde', to_stage: 'gumruk', done_by_name: 'Ayşenur Kanak', created_at: tick(7) })
    if (p.stage === 'gumruk') return h
    h.push({ id: `${p.id}-hgs`, action: 'advance', from_stage: 'gumruk', to_stage: 'satista', done_by_name: 'Ayşenur Kanak', created_at: tick(4) })
    return h
  }

  // ── TR — ozalit cycles ─────────────────────────────────────────────────────
  for (let i = 0; i < ozalitAttempt; i++) {
    h.push({
      id: `${p.id}-hot${i}`,
      action: 'advance',
      from_stage: 'ozalit_teslim',
      to_stage: 'ozalit_onay',
      done_by_name: 'Oktay Şahin',
      created_at: tick(1),
      note: `${i + 1}. Ozalit teslim alındı`,
    })
    h.push({
      id: `${p.id}-hor${i}`,
      action: 'reject',
      from_stage: 'ozalit_onay',
      to_stage: 'ozalit_teslim',
      done_by_name: 'Ayşenur Kanak',
      reason: i === ozalitAttempt - 1
        ? (p.last_reject_reason ?? 'Ozalit baskısında renk düzeltmesi gerekiyor.')
        : 'Baskı ayarları hatalı.',
      created_at: tick(1),
    })
  }

  // ── Current ozalit printer teslim ──────────────────────────────────────────
  h.push({
    id: `${p.id}-hotf`,
    action: 'advance',
    from_stage: 'ozalit_teslim',
    to_stage: 'ozalit_onay',
    done_by_name: 'Oktay Şahin',
    created_at: tick(1),
    note: `${ozalitAttempt + 1}. Ozalit teslim alındı`,
  })
  if (p.stage === 'ozalit_teslim' || p.stage === 'ozalit_onay') return h

  // ── Ozalit approved → üretime hazır ───────────────────────────────────────
  h.push({ id: `${p.id}-hoa`, action: 'approve', from_stage: 'ozalit_onay', to_stage: 'uretime_hazir', done_by_name: 'Ayşenur Kanak', created_at: tick(0.5) })
  if (p.stage === 'uretime_hazir') return h

  // ── Sipariş alındı → üretimde ─────────────────────────────────────────────
  h.push({ id: `${p.id}-hoh`, action: 'advance', from_stage: 'uretime_hazir', to_stage: 'uretimde', done_by_name: 'Esra Kılıçkan', created_at: tick(2), note: 'Sipariş alındı' })
  if (p.stage === 'uretimde') return h

  h.push({ id: `${p.id}-hus`, action: 'advance', from_stage: 'uretimde', to_stage: 'satista', done_by_name: 'Ayşenur Kanak', created_at: tick(10) })
  return h
}

function buildProjectDetail(p) {
  // Designers assigned to the project. Tolerate legacy data where assignees
  // were stored as bare user-id strings instead of {id,name} objects.
  let assignees
  if (Array.isArray(p.assignees) && p.assignees.length > 0) {
    assignees = p.assignees.map((a) => {
      if (a && typeof a === 'object') return a
      const u = mockUsers.find((x) => x.id === a)
      return { id: a, name: u?.name ?? String(a) }
    })
  } else {
    assignees = mockUsers
      .filter((u) => u.id === p.assigned_to)
      .map((u) => ({ id: u.id, name: u.name }))
  }

  // Subtasks. Three cases:
  //   - missing            -> synthesize from progress (seed projects)
  //   - array of strings   -> legacy keys, convert to objects
  //   - array of objects   -> use as-is
  let subtasks = p.subtasks
  if (!Array.isArray(subtasks)) {
    const total = SUBTASK_LIBRARY.length
    const doneCount = Math.round((p.progress / 100) * total)
    subtasks = SUBTASK_LIBRARY.map((s, i) => ({
      id: `${p.id}-${s.key}`,
      project_id: p.id,
      title: s.label,
      kind: 'check',
      is_done: i < doneCount,
      done_at: i < doneCount ? new Date().toISOString() : null,
    }))
    const totalPages = 48
    const pagesDone = Math.round((p.progress / 100) * totalPages)
    subtasks.push({
      id: `${p.id}-sayfa`,
      project_id: p.id,
      title: 'Sayfa Sayısı',
      kind: 'pages',
      total_pages: totalPages,
      pages_done: pagesDone,
      is_done: pagesDone >= totalPages,
    })
  } else if (subtasks.some((s) => typeof s === 'string')) {
    subtasks = subtasks
      .filter((key) => key !== 'sayfalar' && key !== 'sticker')
      .map((key) => {
        const lib = SUBTASK_LIBRARY.find((l) => l.key === key)
        return {
          id: `${p.id}-${key}`,
          project_id: p.id,
          title: lib ? lib.label : key,
          kind: 'check',
          is_done: false,
          done_at: null,
        }
      })
  }

  const subtasksDone = subtasks.filter((s) => s.is_done).length
  const subtasksTotal = subtasks.length

  // Build a full project timeline from stage + attempt counters.
  // Real history is stored server-side; in mock we reconstruct it deterministically.
  const history = p.history ?? generateHistory(p, assignees, subtasksDone, subtasksTotal)

  return { ...p, assignees, subtasks, history }
}

// Standalone demos created from loose files (not part of the pipeline).
const mockDemos = []

// Order requests submitted by the sales team (satis role).
// Each has an `order_history` array recording every signed step.
const mockOrderRequests = [
  {
    id: 'or-demo-1',
    project_id: 'p-s1',
    project_title: 'POFİDİK OYUN SETİ',
    requested_by: 'u-esra',
    requested_by_name: 'Esra Kılıçkan',
    items: [{ name: 'Kutu', quantity: 500 }, { name: 'Sticker', quantity: 500 }],
    quantity: 500,
    notes: 'Okul dönemine hazırlık için acil gerekiyor.',
    status: 'pending',
    created_at: '2026-06-18T08:00:00.000Z',
    updated_at: '2026-06-18T08:00:00.000Z',
    order_history: [
      {
        id: 'oh-d1-1',
        step: 'pending',
        step_label: 'Talep Gönderildi',
        signed_by_id: 'u-esra',
        signed_by_name: 'Esra Kılıçkan',
        signed_by_role: 'satis',
        signed_at: '2026-06-18T08:00:00.000Z',
        notes: 'Okul dönemine hazırlık için acil gerekiyor.',
      },
    ],
  },
  {
    id: 'or-demo-2',
    project_id: 'p-x1',
    project_title: 'CIRT / CIRTLI / OKUMAYI / ÖĞRETEN / KİTAP',
    requested_by: 'u-esra',
    requested_by_name: 'Esra Kılıçkan',
    items: [{ name: 'Kitap', quantity: 10000 }],
    quantity: 10000,
    notes: 'Temmuz sezonu öncesi hazır olmalı.',
    status: 'goruldu',
    created_at: '2026-06-17T09:00:00.000Z',
    updated_at: '2026-06-17T11:00:00.000Z',
    order_history: [
      {
        id: 'oh-d2-1',
        step: 'pending',
        step_label: 'Talep Gönderildi',
        signed_by_id: 'u-esra',
        signed_by_name: 'Esra Kılıçkan',
        signed_by_role: 'satis',
        signed_at: '2026-06-17T09:00:00.000Z',
        notes: 'Temmuz sezonu öncesi hazır olmalı.',
      },
      {
        id: 'oh-d2-2',
        step: 'goruldu',
        step_label: 'Görüldü',
        signed_by_id: 'u-ayse',
        signed_by_name: 'Ayşenur Kanak',
        signed_by_role: 'team_leader',
        signed_at: '2026-06-17T11:00:00.000Z',
        notes: 'Tasarım ekibine iletildi.',
      },
    ],
  },
]

/* ------------------------------------------------------------------ */
/*  MOCK DATA (stands in for the API until the backend is built)       */
/* ------------------------------------------------------------------ */

const mockUsers = [
  {
    id: 'u-ayse',
    name: 'Ayşenur Kanak',
    email: 'aysenur@yukselenzeka.com',
    password: '123456',
    role: 'team_leader',
    is_active: true,
  },
  {
    id: 'u-elif',
    name: 'Aylin Ulu',
    email: 'aylin@yukselenzeka.com',
    password: '123456',
    role: 'designer',
    is_active: true,
  },
  {
    id: 'u-feyza',
    name: 'Feyza Küçükkurt',
    email: 'feyza@yukselenzeka.com',
    password: '123456',
    role: 'designer',
    is_active: true,
  },
  {
    id: 'u-nur',
    name: 'Nur Ekincioğlu',
    email: 'nur@yukselenzeka.com',
    password: '123456',
    role: 'designer',
    is_active: true,
  },
  {
    id: 'u-sumeyye-a',
    name: 'Sümeyye Arslantürk',
    email: 'sumeyye.arslanturk@yukselenzeka.com',
    password: '123456',
    role: 'designer',
    is_active: true,
  },
  {
    id: 'u-oktay',
    name: 'Oktay Şahin',
    email: 'oktay@yukselenzeka.com',
    password: '123456',
    role: 'printer',
    is_active: true,
  },
  {
    id: 'u-esra',
    name: 'Esra Kılıçkan',
    email: 'esra@yukselenzeka.com',
    password: '123456',
    role: 'satis',
    is_active: true,
    joined_at: '2026-06-19T00:00:00.000Z',
  },
]

// Helper: first day of a month, N months from now.
function monthOffset(n) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 10)
}

const mockProjects = [
  {
    id: "p-x1",
    title: "CIRT / CIRTLI / OKUMAYI / ÖĞRETEN / KİTAP",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-feyza",
    assigned_name: "Feyza / Küçükkurt",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-16T00:00:00",
    updated_at: "2026-06-17T00:00:00",
  },
  {
    id: "p-x2",
    title: "Konuşturan / Kitap",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-03T00:00:00",
    updated_at: "2026-06-09T00:00:00",
  },
  {
    id: "p-x3",
    title: "İLKOKULA / HAZIRLIK / SETİ / KİTAPLARI",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-feyza",
    assigned_name: "Feyza / Küçükkurt",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-17T00:00:00",
    updated_at: "2026-06-18T00:00:00",
  },
  {
    id: "p-x4",
    title: "Konuşturan / oyuncak",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-feyza",
    assigned_name: "Feyza / Küçükkurt",
    created_by: "u-ayse",
    target_month: "2026-05-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-05-20T00:00:00",
    updated_at: "2026-05-22T00:00:00",
  },
  {
    id: "p-x5",
    title: "Mim / reklam",
    type: "TR",
    stage: "ozalit_teslim",
    assigned_to: "u-feyza",
    assigned_name: "Feyza / Küçükkurt",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-05T00:00:00",
    updated_at: "2026-06-09T00:00:00",
  },
  {
    id: "p-x6",
    title: "Konuşmayı / Geliştiren / Şarkılı / Masallar",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-03T00:00:00",
    updated_at: "2026-06-08T00:00:00",
  },
  {
    id: "p-x7",
    title: "Melodiko / - / İlk / Piyano / Kitabım",
    type: "TR",
    stage: "ozalit_teslim",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-05T00:00:00",
    updated_at: "2026-06-05T00:00:00",
  },
  {
    id: "p-x8",
    title: "Keçemino / Çiftlik / Kutu",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-feyza",
    assigned_name: "Feyza / Küçükkurt",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-04T00:00:00",
    updated_at: "2026-06-04T00:00:00",
  },
  {
    id: "p-x9",
    title: "PARMAK / BOYAMA",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-feyza",
    assigned_name: "Feyza / Küçükkurt",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-04T00:00:00",
    updated_at: "2026-06-09T00:00:00",
  },
  {
    id: "p-x10",
    title: "PUZZLELAB / MAGNETLİ / RENK / EŞLEŞTİRME / ( / YZ07PZL / )",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-05-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-05-06T00:00:00",
    updated_at: "2026-05-11T00:00:00",
  },
  {
    id: "p-x11",
    title: "YZ03STC / - / İLK / STİCKER / KİTABIM",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-elif",
    assigned_name: "Aylin / Ulu",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-03T00:00:00",
    updated_at: "2026-06-17T00:00:00",
  },
  {
    id: "p-x12",
    title: "Pofidik / Puzzle / Çiftlik / Kutu",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-01T00:00:00",
    updated_at: "2026-06-03T00:00:00",
  },
  {
    id: "p-x13",
    title: "Pofidik / Puzzle / Orman / Hayvanları / Kutu",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-04T00:00:00",
    updated_at: "2026-06-09T00:00:00",
  },
  {
    id: "p-x15",
    title: "2-4 / YAŞ / ZEKA / KARTLARI",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-05-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-05-20T00:00:00",
    updated_at: "2026-05-22T00:00:00",
  },
  {
    id: "p-x16",
    title: "Sulu / Kalem / Kitabım",
    type: "TR",
    stage: "tasarim",
    assigned_to: "u-feyza",
    assigned_name: "Feyza / Küçükkurt",
    created_by: "u-ayse",
    target_month: "2024-05-01",
    demo_attempt: 0,
    progress: 0,
    created_at: "2024-05-14T00:00:00",
    updated_at: "2024-05-14T00:00:00",
  },
  {
    id: "p-x17",
    title: "Pıt / Pıt / Parmak / Boyama",
    type: "TR",
    stage: "ozalit_teslim",
    assigned_to: "u-elif",
    assigned_name: "Aylin / Ulu",
    created_by: "u-ayse",
    target_month: "2026-05-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-05-15T00:00:00",
    updated_at: "2026-05-15T00:00:00",
  },
  {
    id: "p-x18",
    title: "MİNDOO / KİTAPLAR",
    type: "TR",
    stage: "ozalit_teslim",
    assigned_to: "u-feyza",
    assigned_name: "Feyza / Küçükkurt",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-02T00:00:00",
    updated_at: "2026-06-02T00:00:00",
  },
  {
    id: "p-x19",
    title: "2 / YAŞ / ETKİNLİK / SETİ",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-05-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-05-12T00:00:00",
    updated_at: "2026-05-22T00:00:00",
  },
  {
    id: "p-x20",
    title: "3 / YAŞ / ETKİNLİK / SETİ",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-05-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-05-12T00:00:00",
    updated_at: "2026-05-22T00:00:00",
  },
  {
    id: "p-x21",
    title: "4 / YAŞ / ETKİNLİK / SETİ",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-05-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-05-12T00:00:00",
    updated_at: "2026-05-22T00:00:00",
  },
  {
    id: "p-x24",
    title: "FENERLİ / BUL / BAKALIM / İÇ / SAYFALAR",
    type: "TR",
    stage: "ozalit_teslim",
    assigned_to: "u-feyza",
    assigned_name: "Feyza / Küçükkurt",
    created_by: "u-ayse",
    target_month: "2026-04-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-04-17T00:00:00",
    updated_at: "2026-04-17T00:00:00",
  },
  {
    id: "p-x25",
    title: "POFİDİK / KİTAP",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-05-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-04-24T00:00:00",
    updated_at: "2026-05-13T00:00:00",
  },
  {
    id: "p-x26",
    title: "ZEKA / PARKURU",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-sumeyye-a",
    assigned_name: "Sümeyye / Arslantürk",
    created_by: "u-ayse",
    target_month: "2026-04-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-04-28T00:00:00",
    updated_at: "2026-04-30T00:00:00",
  },
  {
    id: "p-x27",
    title: "ZEKA / PARKURU / BEBEK",
    type: "TR",
    stage: "ozalit_teslim",
    assigned_to: "u-sumeyye-a",
    assigned_name: "Sümeyye / Arslantürk",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-06-18T00:00:00",
    updated_at: "2026-06-18T00:00:00",
  },
  {
    id: "p-x29",
    title: "FENERLİ / KİTAP / - / BUL / BAKALIM",
    type: "TR",
    stage: "uretime_hazir",
    assigned_to: "u-feyza",
    assigned_name: "Feyza / Küçükkurt",
    created_by: "u-ayse",
    target_month: "2026-06-01",
    demo_attempt: 0,
    progress: 100,
    created_at: null,
    updated_at: null,
  },
  {
    id: "p-x30",
    title: "ÇANTA / EVA / KİTAP",
    type: "TR",
    stage: "ozalit_teslim",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-04-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-04-10T00:00:00",
    updated_at: "2026-04-10T00:00:00",
  },
  {
    id: "p-s1",
    title: "POFİDİK OYUN SETİ",
    type: "TR",
    stage: "satista",
    assigned_to: "u-nur",
    assigned_name: "Nur / Ekincioğlu",
    created_by: "u-ayse",
    target_month: "2026-04-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-03-01T00:00:00",
    updated_at: "2026-04-10T00:00:00",
    subtasks: [
      { id: "p-s1-kapak", title: "Kapak", kind: "check", is_done: true },
      { id: "p-s1-kutu", title: "Kutu", kind: "check", is_done: true },
      { id: "p-s1-sticker", title: "Sticker", kind: "check", is_done: true },
    ],
  },
  {
    id: "p-s2",
    title: "RENKLER VE ŞEKİLLER KİTABI",
    type: "TR",
    stage: "satista",
    assigned_to: "u-feyza",
    assigned_name: "Feyza / Küçükkurt",
    created_by: "u-ayse",
    target_month: "2026-03-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-02-01T00:00:00",
    updated_at: "2026-03-15T00:00:00",
    subtasks: [
      { id: "p-s2-kapak", title: "Kapak", kind: "check", is_done: true },
      { id: "p-s2-ses", title: "Ses", kind: "check", is_done: true },
    ],
  },
  {
    id: "p-s3",
    title: "HAYVANLAR DÜNYASI ETKİNLİK SETİ",
    type: "TR",
    stage: "satista",
    assigned_to: "u-elif",
    assigned_name: "Aylin / Ulu",
    created_by: "u-ayse",
    target_month: "2026-05-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-04-01T00:00:00",
    updated_at: "2026-05-05T00:00:00",
    subtasks: [
      { id: "p-s3-kapak", title: "Kapak", kind: "check", is_done: true },
      { id: "p-s3-kutu", title: "Kutu", kind: "check", is_done: true },
      { id: "p-s3-sticker", title: "Sticker", kind: "check", is_done: true },
      { id: "p-s3-ses", title: "Ses", kind: "check", is_done: true },
    ],
  },
  {
    id: "p-s4",
    title: "MATEMATİK OYUN KARTLARI",
    type: "CIN",
    stage: "satista",
    assigned_to: "u-sumeyye-a",
    assigned_name: "Sümeyye / Arslantürk",
    created_by: "u-ayse",
    target_month: "2026-04-01",
    demo_attempt: 0,
    progress: 100,
    created_at: "2026-03-10T00:00:00",
    updated_at: "2026-04-20T00:00:00",
    subtasks: [
      { id: "p-s4-kapak", title: "Kapak", kind: "check", is_done: true },
      { id: "p-s4-kutu", title: "Kutu", kind: "check", is_done: true },
    ],
  },
]

function delay(ms = 350) {
  return new Promise((r) => setTimeout(r, ms))
}

/* ------------------------------------------------------------------ */
/*  localStorage persistence (mock layer only)                         */
/*  Keeps projects/users/demos across refreshes on the same browser.   */
/* ------------------------------------------------------------------ */
const LS_KEY = 'yz_mock_state_v6'

function saveState() {
  if (!USE_MOCK || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ users: mockUsers, projects: mockProjects, demos: mockDemos, orderRequests: mockOrderRequests }),
    )
  } catch {
    /* ignore quota / private-mode errors */
  }
}

function hydrateState() {
  if (!USE_MOCK || typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (Array.isArray(saved.users)) {
      // Start from the saved users (preserves invites/deactivations), then
      // append any seed users that aren't already present (matched by email).
      // This lets newly-added designers in the seed list show up for people
      // who already have an older mock state cached in their browser.
      const seedUsers = [...mockUsers]
      const byEmail = new Set(saved.users.map((u) => u.email?.toLowerCase()))
      const merged = [...saved.users]
      for (const u of seedUsers) {
        if (!byEmail.has(u.email?.toLowerCase())) merged.push(u)
      }
      mockUsers.length = 0
      mockUsers.push(...merged)
    }
    if (Array.isArray(saved.projects)) {
      mockProjects.length = 0
      mockProjects.push(...saved.projects)
    }
    if (Array.isArray(saved.demos)) {
      mockDemos.length = 0
      mockDemos.push(...saved.demos)
    }
    if (Array.isArray(saved.orderRequests)) {
      mockOrderRequests.length = 0
      mockOrderRequests.push(...saved.orderRequests)
    }
  } catch {
    /* corrupt state — fall back to the seed data */
  }
}

// Reset the mock store back to the original seed (exposed for debugging).
export function resetMockState() {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(LS_KEY)
    } catch {
      /* ignore */
    }
  }
}

hydrateState()

/**
 * Pre-populate localStorage with realistic demo/ozalit form data for the seed
 * projects. Only writes when no existing data is present so user edits are
 * never overwritten.
 */
function hydrateMockForms() {
  if (!USE_MOCK || typeof localStorage === 'undefined') return

  function daysBack(n) {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  const demoForms = {
    "p-x1": {
      isinAdi: "CIRT / CIRTLI / OKUMAYI / ÖĞRETEN / KİTAP",
      settekiKitapSayisi: "1.0",
      adet: "10000.0",
      ebat: "20 / x / 28,5 / cm",
      sayfaSayisi: "Kapak / dahil / 8 / yaprak / (16 / sayfa)",
      icKagitCinsi: "400 / gr / mat / kuşe",
      kapakKagitCinsi: "İç / kağıtla / aynı",
      cilt: "Mavi / spiral / 18 / mm / 44 / loop",
      laminasyon: "Tüm / sayfalar / arkalı / önlü / parlak / selofon",
      basimYeri: "Emsal / Matbaası",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "17 / Haziran / 2026",
      demoIsteyenKisi: "Feyza / KÜÇÜKKURT",
    },
    "p-x2": {
      isinAdi: "Konuşturan / Kitap",
      settekiKitapSayisi: "3.0",
      adet: "10.000 / takım",
      ebat: "24 / cm / x / 22 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "130 / gr / Mat / Kuşe",
      kapakKagitCinsi: "250 / gr / mat / kuşe",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / ve / sayfaların / tümü / parlak / selefon",
      basimYeri: "SAYFA / BASIM(REPRO / BİR)",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "9 / Haziran / 2026",
      demoIsteyenKisi: "Nur / Ekincioğlu",
    },
    "p-x3": {
      isinAdi: "İLKOKULA / HAZIRLIK / SETİ / KİTAPLARI",
      settekiKitapSayisi: "3.0",
      adet: "10.000 / takım",
      ebat: "24 / cm / x / 32 / cm / yükseklik",
      sayfaSayisi: "32 / sayfa / + / kapak",
      icKagitCinsi: "80 / gr / 1. / hamur",
      kapakKagitCinsi: "250 / gr / Bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dışı / parlak / selofon",
      basimYeri: "SAYFA / BASIM / (REPRO / BİR)",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "18 / Haziran / 2026",
      demoIsteyenKisi: "Feyza / KÜÇÜKKURT",
    },
    "p-x4": {
      isinAdi: "Konuşturan / oyuncak",
      settekiKitapSayisi: "",
      adet: "30.000 / takım",
      ebat: "Kartların / tümü / 70 / x / 100 / tabakaya / arkalı / önlü / basılmaktadır.",
      sayfaSayisi: "",
      icKagitCinsi: "350 / gr / mat / kuşe",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "arkalı / önlü / parlak / selefon",
      basimYeri: "Sayfa / Basım",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "22 / Mayıs / 2026",
      demoIsteyenKisi: "Feyza / KÜÇÜKKURT",
    },
    "p-x6": {
      isinAdi: "Konuşmayı / Geliştiren / Şarkılı / Masallar",
      settekiKitapSayisi: "4.0",
      adet: "25.000 / adet",
      ebat: "20 / cm / x / 20 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "115 / gr / Mat / Kuşe",
      kapakKagitCinsi: "250 / gr / Mat / Kuşe",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / parlak / selefon",
      basimYeri: "SAYFA / BASIM(REPRO / BİR)",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "8 / Haziran / 2026",
      demoIsteyenKisi: "Nur / Ekincioğlu",
    },
    "p-x8": {
      isinAdi: "Keçemino / Çiftlik / Kutu",
      settekiKitapSayisi: "",
      adet: "20000.0",
      ebat: "533 / mm / x / 647 / mm",
      sayfaSayisi: "",
      icKagitCinsi: "",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "Dış / parlak / selefon",
      basimYeri: "Çankutsan",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "4 / Haziran / 2026",
      demoIsteyenKisi: "Feyza / KÜÇÜKKURT",
    },
    "p-x9": {
      isinAdi: "PARMAK / BOYAMA",
      settekiKitapSayisi: "3 / çeşit / kitap",
      adet: "25.000 / takım",
      ebat: "22 / cm / genişlik / X / 30,5 / cm / yükseklik",
      sayfaSayisi: "24.0",
      icKagitCinsi: "90 / gr / birinci / hamur",
      kapakKagitCinsi: "250 / gr / Amerikan / bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dış / parlak / selefon",
      basimYeri: "Sayfa / Matbaası",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "9 / Haziran / 2026",
      demoIsteyenKisi: "Feyza / KÜÇÜKKURT",
    },
    "p-x10": {
      isinAdi: "PUZZLELAB / MAGNETLİ / RENK / EŞLEŞTİRME / ( / YZ07PZL / )",
      settekiKitapSayisi: "10 / ADET / RENK / TOPLAM / 50 / PARÇALI",
      adet: "10.000 / takım",
      ebat: "Her / biri / 12 / cm / genişlik / 16 / cm / yükseklik / 10 / plaka",
      sayfaSayisi: "",
      icKagitCinsi: "",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "Parlak / selofon",
      basimYeri: "Emsal / Matbaası",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "11 / Mayıs / 2026",
      demoIsteyenKisi: "Nur / EKİNCİOĞLU",
    },
    "p-x11": {
      isinAdi: "YZ03STC / - / İLK / STİCKER / KİTABIM",
      settekiKitapSayisi: "3.0",
      adet: "10000 / takım",
      ebat: "21 / cm / x / 30 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "80 / gr / 1. / Hamur",
      kapakKagitCinsi: "250 / gr / Amerikan / Bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dış / yüzey / parlak / selefon",
      basimYeri: "Sayfa / Basım",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "17 / Haziran / 2026",
      demoIsteyenKisi: "Aylin / ULU",
    },
    "p-x12": {
      isinAdi: "Pofidik / Puzzle / Çiftlik / Kutu",
      settekiKitapSayisi: "",
      adet: "25.000 / adet",
      ebat: "243 / x / 202 / mm / ön / yüz / / / toplam / ebat / 433 / x / 532 / mm",
      sayfaSayisi: "",
      icKagitCinsi: "250 / gr / bristol / / / E / dalga",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "dış / yüzey / parlak / selefon",
      basimYeri: "Özkutsan / Basım",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "3 / Haziran / 2026",
      demoIsteyenKisi: "Nur / Ekincioğlu",
    },
    "p-x13": {
      isinAdi: "Pofidik / Puzzle / Orman / Hayvanları / Kutu",
      settekiKitapSayisi: "",
      adet: "10000.0",
      ebat: "243 / x / 202 / mm / ön / yüz / / / toplam / ebat / 433 / x / 532 / mm",
      sayfaSayisi: "",
      icKagitCinsi: "250 / gr / bristol / / / E / dalga",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "Dış / yüzey / parlak / selefon",
      basimYeri: "Çankutsan / Basım",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "9 / Haziran / 2026",
      demoIsteyenKisi: "Nur / Ekincioğlu",
    },
    "p-x15": {
      isinAdi: "2-4 / YAŞ / ZEKA / KARTLARI",
      settekiKitapSayisi: "",
      adet: "10.000 / takım",
      ebat: "Kartların / tümü / 70 / x / 100 / tabakaya / arkalı / önlü / basılmaktadır.",
      sayfaSayisi: "",
      icKagitCinsi: "350 / gr / mat / kuşe",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "arkalı / önlü / parlak / selefon",
      basimYeri: "Sayfa / Basım",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "22 / Mayıs / 2026",
      demoIsteyenKisi: "Nur / EKİNCİOĞLU",
    },
    "p-x19": {
      isinAdi: "2 / YAŞ / ETKİNLİK / SETİ",
      settekiKitapSayisi: "3.0",
      adet: "10.000 / takım",
      ebat: "19 / cm / x / 27 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "80 / gr / 1. / hamur",
      kapakKagitCinsi: "250 / gr / Hi / Bulk / Bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dış / parlak / selefon",
      basimYeri: "Kalkan / Matbaası",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "22 / Mayıs / 2026",
      demoIsteyenKisi: "Nur / EKİNCİOĞLU",
    },
    "p-x20": {
      isinAdi: "3 / YAŞ / ETKİNLİK / SETİ",
      settekiKitapSayisi: "3.0",
      adet: "10.000 / takım",
      ebat: "19 / cm / x / 27 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "80 / gr / 1. / hamur",
      kapakKagitCinsi: "250 / gr / Hi / Bulk / Bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dış / parlak / selefon",
      basimYeri: "Kalkan / Matbaası",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "22 / Mayıs / 2026",
      demoIsteyenKisi: "Nur / EKİNCİOĞLU",
    },
    "p-x21": {
      isinAdi: "4 / YAŞ / ETKİNLİK / SETİ",
      settekiKitapSayisi: "3.0",
      adet: "10.000 / takım",
      ebat: "19 / cm / x / 27 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "80 / gr / 1. / hamur",
      kapakKagitCinsi: "250 / gr / Hi / Bulk / Bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dış / parlak / selefon",
      basimYeri: "Kalkan / Matbaası",
      onaylayanKisi: "Serpil / KANTARCI",
      demoIstemTarihi: "22 / Mayıs / 2026",
      demoIsteyenKisi: "Nur / EKİNCİOĞLU",
    },
    "p-x25": {
      isinAdi: "POFİDİK / KİTAP",
      settekiKitapSayisi: "1.0",
      adet: "10000.0",
      ebat: "Kapak: / 480 / mm / x / 220 / mm / Kapak / cep: / 244 / mm / x / 98 / mm / (Açık / hali) / Kapak / cep: / 9 / mm / sırt / / / 225 / mm / x / 80 / mm / katlanmış / hali / Sayfa: / 240 / mm / x / 220 / mm / 1- / Sarı / eva: / 217 / mm / x / 192 / mm / 2- / Mavi / eva: / 224 / mm / x / 199 / mm / 3- / Kırmızı / eva: / 231 / mm / x / 206 / mm / 4- / Yeşil / eva: / 238 / mm / 213 / mm",
      sayfaSayisi: "12 / sayfa",
      icKagitCinsi: "250 / gr / 1. / hamur",
      kapakKagitCinsi: "345 / gr / hi-bulk / bristol",
      cilt: "Tel / dikiş / / / sırt / kırımlı",
      laminasyon: "Ön / arka / kapak / dışı / mat / selofon / Cep / dışı / mat / selefon",
      basimYeri: "Emsal / Matbaası",
      onaylayanKisi: "Serpil / Kantarcı",
      demoIstemTarihi: "13 / Mayıs / 2026",
      demoIsteyenKisi: "Nur / Ekincioğlu",
    },
    "p-x26": {
      isinAdi: "ZEKA / PARKURU",
      settekiKitapSayisi: "1.0",
      adet: "10000.0",
      ebat: "43 / cm / genişlik / 30 / cm / yükseklik",
      sayfaSayisi: "56.0",
      icKagitCinsi: "90 / gr / 1. / hamur",
      kapakKagitCinsi: "345 / Hi / Bulk",
      cilt: "18 / mm / spiral / (1 / e / 4)",
      laminasyon: "Ön / ve / arka / kapak / dışı / parlak / selofon. / Kulp / parlak / selofon.",
      basimYeri: "Sayfa / Basım",
      onaylayanKisi: "Serpil / Kantarcı",
      demoIstemTarihi: "30 / Nisan / 2026",
      demoIsteyenKisi: "Sümeyye / Hacıoğlu",
    },
    "p-x29": {
      isinAdi: "FENERLİ / KİTAP / - / BUL / BAKALIM",
      settekiKitapSayisi: "1.0",
      adet: "10000.0",
      ebat: "23 / cm / genişlik / 16,5 / cm / yükseklik",
      sayfaSayisi: "12 / adet / 200 / mikron / kristal / PVC",
      icKagitCinsi: "",
      kapakKagitCinsi: "345 / Hi / Bulk. / Dışı / parlak / selofon",
      cilt: "10 / mm / sarı / spiral",
      laminasyon: "Ön / ve / arka / kapak / dışı / parlak / selofon / / / fener / parlak / selofon / / / cep / parlak / selofon",
      basimYeri: "Bakoğlu / / / Sayfa / Basım",
      onaylayanKisi: "Serpil / Kantarcı",
      demoIstemTarihi: "",
      demoIsteyenKisi: "Feyza / Küçükkurt",
    },
  }

  const ozalitForms = {
    "p-x1": {
      isinAdi: "CIRT / CIRTLI / OKUMAYI / ÖĞRETEN / KİTAP",
      settekiKitapSayisi: "1.0",
      adet: "10000.0",
      ebat: "20 / x / 28,5 / cm",
      sayfaSayisi: "Kapak / dahil / 8 / yaprak / (16 / sayfa)",
      icKagitCinsi: "400 / gr / mat / kuşe",
      kapakKagitCinsi: "İç / kağıtla / aynı",
      cilt: "Mavi / spiral / 18 / mm / 44 / loop",
      laminasyon: "Tüm / sayfalar / arkalı / önlü / parlak / selofon",
      basimYeri: "Emsal / Matbaası",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "16 / Haziran / 2026",
      ozalitIsteyenKisi: "Feyza / KÜÇÜKKURT",
    },
    "p-x2": {
      isinAdi: "Konuşturan / Kitap",
      settekiKitapSayisi: "3.0",
      adet: "10.000 / takım",
      ebat: "24 / cm / x / 22 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "130 / gr / Mat / Kuşe",
      kapakKagitCinsi: "250 / gr / mat / kuşe",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / ve / sayfaların / tümü / parlak / selefon",
      basimYeri: "SAYFA / BASIM(REPRO / BİR)",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "3 / Haziran / 2026",
      ozalitIsteyenKisi: "Nur / Ekincioğlu",
    },
    "p-x3": {
      isinAdi: "İLKOKULA / HAZIRLIK / SETİ / KİTAPLARI",
      settekiKitapSayisi: "3.0",
      adet: "10.000 / takım",
      ebat: "24 / cm / x / 32 / cm / yükseklik",
      sayfaSayisi: "32 / sayfa / + / kapak",
      icKagitCinsi: "80 / gr / 1. / hamur",
      kapakKagitCinsi: "250 / gr / Bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dışı / parlak / selofon",
      basimYeri: "SAYFA / BASIM / (REPRO / BİR)",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "17 / Haziran / 2026",
      ozalitIsteyenKisi: "Feyza / KÜÇÜKKURT",
    },
    "p-x4": {
      isinAdi: "Konuşturan / oyuncak",
      settekiKitapSayisi: "",
      adet: "30.000 / takım",
      ebat: "Kartların / tümü / 70 / x / 100 / tabakaya / arkalı / önlü / basılmaktadır.",
      sayfaSayisi: "",
      icKagitCinsi: "350 / gr / mat / kuşe",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "arkalı / önlü / parlak / selefon",
      basimYeri: "Sayfa / Basım",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "20 / Mayıs / 2026",
      ozalitIsteyenKisi: "Feyza / KÜÇÜKKURT",
    },
    "p-x5": {
      isinAdi: "Mim / reklam",
      settekiKitapSayisi: "",
      adet: "4.0",
      ebat: "50x70",
      sayfaSayisi: "",
      icKagitCinsi: "250 / gr / bristol",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "Tek / yön / mat / selofon / sıvanacak",
      basimYeri: "MİM / REKLAM",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "5 / Haziran / 2026",
      ozalitIsteyenKisi: "Feyza / KÜÇÜKKURT",
    },
    "p-x6": {
      isinAdi: "Konuşmayı / Geliştiren / Şarkılı / Masallar",
      settekiKitapSayisi: "4.0",
      adet: "25.000 / adet",
      ebat: "20 / cm / x / 20 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "115 / gr / Mat / Kuşe",
      kapakKagitCinsi: "250 / gr / Mat / Kuşe",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / parlak / selefon",
      basimYeri: "SAYFA / BASIM(REPRO / BİR)",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "3 / Haziran / 2026",
      ozalitIsteyenKisi: "Nur / Ekincioğlu",
    },
    "p-x7": {
      isinAdi: "Melodiko / - / İlk / Piyano / Kitabım",
      settekiKitapSayisi: "1.0",
      adet: "1 / ADET",
      ebat: "30 / cm / genişlik / x / 17,6 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "140 / gr / 1. / Hamur",
      kapakKagitCinsi: "250 / gr / Amerikan / Bristol",
      cilt: "",
      laminasyon: "Kapak / mat / selefon",
      basimYeri: "KAPAK / MİM / REKLAM / - / KİTAPİÇİ / TİRAJ / BASIM",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "5 / Haziran / 2026",
      ozalitIsteyenKisi: "Nur / EKİNCİOĞLU",
    },
    "p-x8": {
      isinAdi: "Keçemino / Çiftlik / Kutu",
      settekiKitapSayisi: "",
      adet: "20000.0",
      ebat: "533 / mm / x / 647 / mm",
      sayfaSayisi: "",
      icKagitCinsi: "",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "Dış / parlak / selefon",
      basimYeri: "Çankutsan",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "4 / Haziran / 2026",
      ozalitIsteyenKisi: "Feyza / KÜÇÜKKURT",
    },
    "p-x9": {
      isinAdi: "PARMAK / BOYAMA",
      settekiKitapSayisi: "3 / çeşit / kitap",
      adet: "25.000 / takım",
      ebat: "22 / cm / genişlik / X / 30,5 / cm / yükseklik",
      sayfaSayisi: "24.0",
      icKagitCinsi: "90 / gr / birinci / hamur",
      kapakKagitCinsi: "250 / gr / Amerikan / bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dış / parlak / selefon",
      basimYeri: "Sayfa / Matbaası",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "",
      ozalitIsteyenKisi: "Feyza / KÜÇÜKKURT",
    },
    "p-x10": {
      isinAdi: "PUZZLELAB / MAGNETLİ / RENK / EŞLEŞTİRME / ( / YZ07PZL / )",
      settekiKitapSayisi: "10 / ADET / RENK / TOPLAM / 50 / PARÇALI",
      adet: "10.000 / takım",
      ebat: "Her / biri / 12 / cm / genişlik / 16 / cm / yükseklik / 10 / plaka",
      sayfaSayisi: "",
      icKagitCinsi: "",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "Parlak / selofon",
      basimYeri: "Emsal / Matbaası",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "",
      ozalitIsteyenKisi: "Nur / EKİNCİOĞLU",
    },
    "p-x11": {
      isinAdi: "YZ03STC / - / İLK / STİCKER / KİTABIM",
      settekiKitapSayisi: "3.0",
      adet: "10000 / takım",
      ebat: "21 / cm / x / 30 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "80 / gr / 1. / Hamur",
      kapakKagitCinsi: "250 / gr / Amerikan / Bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dış / yüzey / parlak / selefon",
      basimYeri: "Sayfa / Basım",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "3 / Haziran / 2026",
      ozalitIsteyenKisi: "Aylin / ULU",
    },
    "p-x12": {
      isinAdi: "Pofidik / Puzzle / Çiftlik / Kutu",
      settekiKitapSayisi: "",
      adet: "25.000 / adet",
      ebat: "243 / x / 202 / mm / ön / yüz / / / toplam / ebat / 433 / x / 532 / mm",
      sayfaSayisi: "",
      icKagitCinsi: "250 / gr / bristol / / / E / dalga",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "dış / yüzey / parlak / selefon",
      basimYeri: "Özkutsan / Basım",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "1 / Haziran / 2026",
      ozalitIsteyenKisi: "Nur / Ekincioğlu",
    },
    "p-x13": {
      isinAdi: "Pofidik / Puzzle / Orman / Hayvanları / Kutu",
      settekiKitapSayisi: "",
      adet: "10000.0",
      ebat: "243 / x / 202 / mm / ön / yüz / / / toplam / ebat / 433 / x / 532 / mm",
      sayfaSayisi: "",
      icKagitCinsi: "250 / gr / bristol / / / E / dalga",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "Dış / yüzey / parlak / selefon",
      basimYeri: "Çankutsan / Basım",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "4 / Haziran / 2026",
      ozalitIsteyenKisi: "Nur / Ekincioğlu",
    },
    "p-x15": {
      isinAdi: "2-4 / YAŞ / ZEKA / KARTLARI",
      settekiKitapSayisi: "",
      adet: "10.000 / takım",
      ebat: "Kartların / tümü / 70 / x / 100 / tabakaya / arkalı / önlü / basılmaktadır.",
      sayfaSayisi: "",
      icKagitCinsi: "350 / gr / mat / kuşe",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "arkalı / önlü / parlak / selefon",
      basimYeri: "Sayfa / Basım",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "20 / Mayıs / 2026",
      ozalitIsteyenKisi: "Nur / EKİNCİOĞLU",
    },
    "p-x17": {
      isinAdi: "Pıt / Pıt / Parmak / Boyama",
      settekiKitapSayisi: "1.0",
      adet: "10000.0",
      ebat: "18 / cm / x / 22,2 / cm",
      sayfaSayisi: "60 / sayfa / + / kapak",
      icKagitCinsi: "150 / gr / 1. / hamur",
      kapakKagitCinsi: "250 / gr / bristol",
      cilt: "spiralli",
      laminasyon: "",
      basimYeri: "",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "15 / Mayıs / 2026",
      ozalitIsteyenKisi: "Aylin / ULU",
    },
    "p-x18": {
      isinAdi: "MİNDOO / KİTAPLAR",
      settekiKitapSayisi: "5.0",
      adet: "",
      ebat: "24 / cm / x / 16 / cm / yükseklik",
      sayfaSayisi: "32 / sayfa / + / kapak",
      icKagitCinsi: "90 / gr / mat / kuşe",
      kapakKagitCinsi: "250 / gr / bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dışı / parlak / selefon",
      basimYeri: "",
      onaylayanKisi: "Ayşenur / KANAK",
      ozalitIstemTarihi: "2 / Haziran / 2026",
      ozalitIsteyenKisi: "Feyza / KÜÇÜKKURT",
    },
    "p-x19": {
      isinAdi: "2 / YAŞ / ETKİNLİK / SETİ",
      settekiKitapSayisi: "3.0",
      adet: "10.000 / takım",
      ebat: "19 / cm / x / 27 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "80 / gr / 1. / hamur",
      kapakKagitCinsi: "250 / gr / Hi / Bulk / Bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dış / parlak / selefon",
      basimYeri: "Kalkan / Matbaası",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "",
      ozalitIsteyenKisi: "Nur / EKİNCİOĞLU",
    },
    "p-x20": {
      isinAdi: "3 / YAŞ / ETKİNLİK / SETİ",
      settekiKitapSayisi: "3.0",
      adet: "10.000 / takım",
      ebat: "19 / cm / x / 27 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "80 / gr / 1. / hamur",
      kapakKagitCinsi: "250 / gr / Hi / Bulk / Bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dış / parlak / selefon",
      basimYeri: "Kalkan / Matbaası",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "",
      ozalitIsteyenKisi: "Nur / EKİNCİOĞLU",
    },
    "p-x21": {
      isinAdi: "4 / YAŞ / ETKİNLİK / SETİ",
      settekiKitapSayisi: "3.0",
      adet: "10.000 / takım",
      ebat: "19 / cm / x / 27 / cm / yükseklik",
      sayfaSayisi: "24 / sayfa / + / kapak",
      icKagitCinsi: "80 / gr / 1. / hamur",
      kapakKagitCinsi: "250 / gr / Hi / Bulk / Bristol",
      cilt: "Tel / dikiş",
      laminasyon: "Kapak / dış / parlak / selefon",
      basimYeri: "Kalkan / Matbaası",
      onaylayanKisi: "Serpil / KANTARCI",
      ozalitIstemTarihi: "",
      ozalitIsteyenKisi: "Nur / EKİNCİOĞLU",
    },
    "p-x24": {
      isinAdi: "FENERLİ / BUL / BAKALIM / İÇ / SAYFALAR",
      settekiKitapSayisi: "",
      adet: "",
      ebat: "23 / cm / genişlik / 16,5 / cm / yükseklik",
      sayfaSayisi: "12 / sayfa / tek / yüz",
      icKagitCinsi: "pvc",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "",
      basimYeri: "",
      onaylayanKisi: "Serpil / Kantarcı",
      ozalitIstemTarihi: "17 / Nisan / 2026",
      ozalitIsteyenKisi: "Feyza / Küçükkurt",
    },
    "p-x25": {
      isinAdi: "POFİDİK / KİTAP",
      settekiKitapSayisi: "1.0",
      adet: "10000.0",
      ebat: "Kapak: / 480 / mm / x / 220 / mm / Kapak / cep: / 244 / mm / x / 98 / mm / (Açık / hali) / Kapak / cep: / 9 / mm / sırt / / / 225 / mm / x / 80 / mm / katlanmış / hali / Sayfa: / 240 / mm / x / 220 / mm / 1- / Sarı / eva: / 217 / mm / x / 192 / mm / 2- / Mavi / eva: / 224 / mm / x / 199 / mm / 3- / Kırmızı / eva: / 231 / mm / x / 206 / mm / 4- / Yeşil / eva: / 238 / mm / 213 / mm",
      sayfaSayisi: "12 / sayfa",
      icKagitCinsi: "250 / gr / 1. / hamur",
      kapakKagitCinsi: "345 / gr / hi-bulk / bristol",
      cilt: "Tel / dikiş / / / sırt / kırımlı",
      laminasyon: "Ön / arka / kapak / dışı / mat / selofon / Cep / dışı / mat / selefon",
      basimYeri: "Emsal / Matbaası",
      onaylayanKisi: "Serpil / Kantarcı",
      ozalitIstemTarihi: "",
      ozalitIsteyenKisi: "Nur / Ekincioğlu",
    },
    "p-x26": {
      isinAdi: "ZEKA / PARKURU",
      settekiKitapSayisi: "1.0",
      adet: "10000.0",
      ebat: "43 / cm / genişlik / 30 / cm / yükseklik",
      sayfaSayisi: "56.0",
      icKagitCinsi: "90 / gr / 1. / hamur",
      kapakKagitCinsi: "345 / Hi / Bulk",
      cilt: "18 / mm / spiral / (1 / e / 4)",
      laminasyon: "Ön / ve / arka / kapak / dışı / parlak / selofon. / Kulp / parlak / selofon.",
      basimYeri: "Sayfa / Basım",
      onaylayanKisi: "Serpil / Kantarcı",
      ozalitIstemTarihi: "",
      ozalitIsteyenKisi: "Sümeyye / Hacıoğlu",
    },
    "p-x27": {
      isinAdi: "ZEKA / PARKURU / BEBEK",
      settekiKitapSayisi: "1.0",
      adet: "10000.0",
      ebat: "43 / cm / genişlik / 30 / cm / yükseklik",
      sayfaSayisi: "56.0",
      icKagitCinsi: "90 / gr / 1. / hamur",
      kapakKagitCinsi: "345 / Hi / Bulk",
      cilt: "18 / mm / spiral / (1 / e / 4)",
      laminasyon: "Ön / ve / arka / kapak / dışı / parlak / selofon. / Kulp / parlak / selofon.",
      basimYeri: "Sayfa / Basım",
      onaylayanKisi: "Serpil / Kantarcı",
      ozalitIstemTarihi: "",
      ozalitIsteyenKisi: "Sümeyye / Arslantürk",
    },
    "p-x30": {
      isinAdi: "ÇANTA / EVA / KİTAP",
      settekiKitapSayisi: "1.0",
      adet: "",
      ebat: "26,7 / cm / genişlik / 21,5 / cm / yükseklik",
      sayfaSayisi: "",
      icKagitCinsi: "",
      kapakKagitCinsi: "",
      cilt: "",
      laminasyon: "Tüm / basılı / malzeme / tek / yüz / parlak / selofon",
      basimYeri: "",
      onaylayanKisi: "Serpil / Kantarcı",
      ozalitIstemTarihi: "10 / Nisan / 2026",
      ozalitIsteyenKisi: "Nur / Ekincioğlu",
    },
  }

  for (const [id, form] of Object.entries(demoForms)) {
    const key = `yz_demo_form_${id}`
    if (!localStorage.getItem(key)) {
      try { localStorage.setItem(key, JSON.stringify(form)) } catch { /* quota */ }
    }
  }

  for (const [id, form] of Object.entries(ozalitForms)) {
    const key = `yz_ozalit_form_${id}`
    if (!localStorage.getItem(key)) {
      try { localStorage.setItem(key, JSON.stringify(form)) } catch { /* quota */ }
    }
  }
}

hydrateMockForms()

/* ------------------------------------------------------------------ */
/*  API surface (mock-backed, real-API-ready)                          */
/* ------------------------------------------------------------------ */

export const api = {
  async login(email, password) {
    if (USE_MOCK) {
      await delay()
      const user = mockUsers.find(
        (u) => u.email.toLowerCase() === String(email).toLowerCase().trim(),
      )
      if (!user || user.password !== password) {
        const err = new Error('E-posta veya şifre hatalı.')
        err.status = 401
        throw err
      }
      if (!user.is_active) {
        const err = new Error('Hesabınız devre dışı bırakılmış.')
        err.status = 403
        throw err
      }
      const { password: _pw, ...safe } = user
      return { token: `mock-${user.id}`, user: safe }
    }
    const { data } = await client.post('/auth/login', { email, password })
    return data
  },

  async logout() {
    if (USE_MOCK) {
      await delay(150)
      return { ok: true }
    }
    await client.post('/auth/logout')
  },

  async listProjects() {
    if (USE_MOCK) {
      await delay()
      return mockProjects.map((p) => {
        if (Array.isArray(p.assignees) && p.assignees.length > 0) return { ...p }
        const resolved = mockUsers
          .filter((u) => u.id === p.assigned_to)
          .map((u) => ({ id: u.id, name: u.name }))
        return { ...p, assignees: resolved }
      })
    }
    const { data } = await client.get('/projects')
    return data
  },

  async listUsers() {
    if (USE_MOCK) {
      await delay()
      return mockUsers.map(({ password: _pw, ...u }) => u)
    }
    const { data } = await client.get('/users')
    return data
  },

  async getProject(id) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => p.id === id)
      if (idx === -1) {
        const err = new Error('Proje bulunamadı.')
        err.status = 404
        throw err
      }
      const detail = buildProjectDetail(mockProjects[idx])
      // Persist resolved subtasks/assignees/history so later edits (subtask
      // toggles, order step entries) operate on the stored project correctly.
      mockProjects[idx] = {
        ...mockProjects[idx],
        assignees: detail.assignees,
        assigned_name: detail.assigned_name ?? mockProjects[idx].assigned_name,
        subtasks: detail.subtasks,
        // Preserve any order-step entries already appended; only initialise from
        // the generated history when none is stored yet.
        history: mockProjects[idx].history ?? detail.history,
      }
      saveState()
      return detail
    }
    const { data } = await client.get(`/projects/${id}`)
    return data
  },

  async createProject(payload) {
    if (USE_MOCK) {
      await delay()
      const normalized = normalizeProjectPayload(payload)
      const projectId = `p-${Date.now()}`
      const now = new Date().toISOString()
      const created = {
        id: projectId,
        stage: 'tasarim',
        demo_attempt: 0,
        created_at: now,
        updated_at: now,
        ...normalized,
        history: [
          {
            id: `${projectId}-hc`,
            action: 'create',
            from_stage: null,
            to_stage: 'tasarim',
            done_by_name: 'Ayşenur Kanak',
            created_at: now,
            note: `${normalized.assigned_name} atandı`,
          },
        ],
      }
      mockProjects.push(created)
      saveState()
      return created
    }
    const { data } = await client.post('/projects', payload)
    return data
  },

  async updateProject(id, patch) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => p.id === id)
      if (idx === -1) {
        const err = new Error('Proje bulunamadı.')
        err.status = 404
        throw err
      }
      const normalized = normalizeProjectPayload(patch, mockProjects[idx])
      mockProjects[idx] = { ...mockProjects[idx], ...normalized }
      saveState()
      return { ...mockProjects[idx] }
    }
    const { data } = await client.patch(`/projects/${id}`, patch)
    return data
  },

  async deleteProject(id) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => p.id === id)
      if (idx >= 0) {
        mockProjects.splice(idx, 1)
        saveState()
      }
      return { ok: true }
    }
    await client.delete(`/projects/${id}`)
  },

  async advanceProject(id) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => p.id === id)
      if (idx === -1) {
        const err = new Error('Proje bulunamadı.')
        err.status = 404
        throw err
      }
      const p = mockProjects[idx]
      const pipeline = p.type === 'CIN' ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR
      const i = pipeline.indexOf(p.stage)
      if (i === -1 || i === pipeline.length - 1) return { ...p }
      const next = pipeline[i + 1]
      if (next === 'uretime_hazir' && (p.progress ?? 0) < 100) {
        const err = new Error('Proje %100 tamamlanmadan üretime hazır olamaz.')
        err.status = 400
        throw err
      }
      const now = new Date().toISOString()
      const currentUserId = authToken?.replace('mock-', '')
      const currentUser = mockUsers.find((u) => u.id === currentUserId)
      const entry = {
        id: `${p.id}-h${Date.now()}`,
        action: 'advance',
        from_stage: p.stage,
        to_stage: next,
        done_by_name: currentUser?.name ?? 'Bilinmeyen',
        created_at: now,
      }
      const history = [...(p.history ?? []), entry]
      mockProjects[idx] = { ...p, stage: next, updated_at: now, history }
      saveState()
      return { ...mockProjects[idx] }
    }
    const { data } = await client.post(`/projects/${id}/advance`)
    return data
  },

  async approveStage(id, stage) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => p.id === id)
      if (idx >= 0) {
        const p = mockProjects[idx]
        const now = new Date().toISOString()
        const currentUserId = authToken?.replace('mock-', '')
        const currentUser = mockUsers.find((u) => u.id === currentUserId)
        const entry = {
          id: `${p.id}-h${Date.now()}`,
          action: 'approve',
          from_stage: p.stage,
          to_stage: stage,
          done_by_name: currentUser?.name ?? 'Bilinmeyen',
          created_at: now,
        }
        const history = [...(p.history ?? []), entry]
        mockProjects[idx] = { ...p, stage, updated_at: now, history }
        saveState()
      }
      return { ...mockProjects[idx] }
    }
    const { data } = await client.post(`/projects/${id}/approve`, { stage })
    return data
  },

  async rejectStage(id, stage, reason) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => p.id === id)
      if (idx >= 0) {
        const p = mockProjects[idx]
        const now = new Date().toISOString()
        const currentUserId = authToken?.replace('mock-', '')
        const currentUser = mockUsers.find((u) => u.id === currentUserId)
        const entry = {
          id: `${p.id}-h${Date.now()}`,
          action: 'reject',
          from_stage: p.stage,
          to_stage: 'tasarim',
          done_by_name: currentUser?.name ?? 'Bilinmeyen',
          reason,
          created_at: now,
        }
        const history = [...(p.history ?? []), entry]
        mockProjects[idx] = {
          ...p,
          stage: 'tasarim',
          demo_attempt: (p.demo_attempt ?? 0) + 1,
          updated_at: now,
          history,
        }
        saveState()
      }
      return { ...mockProjects[idx] }
    }
    const { data } = await client.post(`/projects/${id}/reject`, { stage, reason })
    return data
  },

  // Approve the current stage → advance to the next stage in the pipeline.
  async approveProject(id) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => p.id === id)
      if (idx === -1) {
        const err = new Error('Proje bulunamadı.')
        err.status = 404
        throw err
      }
      const p = mockProjects[idx]
      const pipeline = p.type === 'CIN' ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR
      const i = pipeline.indexOf(p.stage)
      if (i === -1 || i === pipeline.length - 1) return { ...p }
      const next = pipeline[i + 1]
      // A project can't go into production until its design is fully complete.
      if (next === 'uretime_hazir' && (p.progress ?? 0) < 100) {
        const err = new Error('Proje %100 tamamlanmadan üretime hazır olamaz.')
        err.status = 400
        throw err
      }
      const now = new Date().toISOString()
      const currentUserId = authToken?.replace('mock-', '')
      const currentUser = mockUsers.find((u) => u.id === currentUserId)
      const entry = {
        id: `${p.id}-h${Date.now()}`,
        action: 'approve',
        from_stage: p.stage,
        to_stage: next,
        done_by_name: currentUser?.name ?? 'Bilinmeyen',
        created_at: now,
      }
      const history = [...(p.history ?? []), entry]
      mockProjects[idx] = { ...p, stage: next, updated_at: now, history }
      saveState()
      return { ...mockProjects[idx] }
    }
    const { data } = await client.post(`/projects/${id}/approve`)
    return data
  },

  // Reject the current stage. Both DEMO and ÖZALİT rejections send the project
  // back to Tasarım where the designer revises. When rejecting, the leader picks
  // which of the project's own subtasks need revision (`revizeIds`). Those are
  // reopened (is_done:false, needs_revize:true); every other subtask is left
  // completed so the designer only re-works what was flagged.
  async rejectProject(id, reason, revizeIds = []) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => p.id === id)
      if (idx === -1) {
        const err = new Error('Proje bulunamadı.')
        err.status = 404
        throw err
      }
      const p = mockProjects[idx]
      const isOzalit = p.stage === 'ozalit_onay'
      const nowIso = new Date().toISOString()
      const selected = new Set(revizeIds)

      // Drop any legacy revize-kind subtasks from older cycles; operate on the
      // project's real subtasks only.
      const baseSubs = (p.subtasks ?? []).filter((s) => s.kind !== 'revize')

      const updatedSubs = baseSubs.map((s) => {
        const needs = selected.has(s.id)
        if (s.kind === 'pages') {
          // Selected page tasks reopen at 0; otherwise they count as complete.
          return needs
            ? { ...s, needs_revize: true, pages_done: 0, is_done: false }
            : { ...s, needs_revize: false, pages_done: s.total_pages ?? s.pages_done ?? 0, is_done: true }
        }
        return needs
          ? { ...s, needs_revize: true, is_done: false, done_at: null }
          : { ...s, needs_revize: false, is_done: true, done_at: s.done_at ?? nowIso }
      })

      const currentUserId = authToken?.replace('mock-', '')
      const currentUser = mockUsers.find((u) => u.id === currentUserId)
      const entry = {
        id: `${p.id}-h${Date.now()}`,
        action: 'reject',
        from_stage: p.stage,
        to_stage: 'tasarim',
        done_by_name: currentUser?.name ?? 'Bilinmeyen',
        reason,
        created_at: nowIso,
      }
      const history = [...(p.history ?? []), entry]

      mockProjects[idx] = {
        ...p,
        stage: 'tasarim',
        demo_attempt: isOzalit ? (p.demo_attempt ?? 0) : (p.demo_attempt ?? 0) + 1,
        ozalit_attempt: isOzalit ? (p.ozalit_attempt ?? 0) + 1 : (p.ozalit_attempt ?? 0),
        last_reject_reason: reason,
        last_reject_type: isOzalit ? 'ozalit' : 'demo',
        subtasks: updatedSubs,
        progress: subtaskProgress(updatedSubs),
        updated_at: nowIso,
        history,
      }
      saveState()
      return { ...mockProjects[idx] }
    }
    const { data } = await client.post(`/projects/${id}/reject`, { reason, revize_ids: revizeIds })
    return data
  },

  async toggleSubtask(projectId, subtaskId, isDone) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => p.id === projectId)
      if (idx === -1) {
        const err = new Error('Proje bulunamadı.')
        err.status = 404
        throw err
      }
      const p = mockProjects[idx]
      const subs = (p.subtasks ?? []).map((s) =>
        s.id === subtaskId ? { ...s, is_done: isDone, done_at: isDone ? new Date().toISOString() : null } : s,
      )
      const total = subs.length || 1
      const done = subs.filter((s) => s.is_done).length
      const progress = Math.round((done / total) * 100)
      mockProjects[idx] = { ...p, subtasks: subs, progress }
      saveState()
      return { ...mockProjects[idx] }
    }
    const { data } = await client.patch(`/subtasks/${subtaskId}`, { is_done: isDone })
    return data
  },

  // Check / uncheck a subtask by its id (ProjectDetail passes only the subtask
  // id). Finds the owning project, updates it, recomputes progress, and returns
  // { project } so the page can patch its local state.
  async setSubtaskDone(subtaskId, isDone) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) =>
        (p.subtasks ?? []).some((s) => s.id === subtaskId),
      )
      if (idx === -1) {
        const err = new Error('Alt görev bulunamadı.')
        err.status = 404
        throw err
      }
      const p = mockProjects[idx]
      const subs = p.subtasks.map((s) =>
        s.id === subtaskId
          ? { ...s, is_done: isDone, done_at: isDone ? new Date().toISOString() : null }
          : s,
      )
      mockProjects[idx] = { ...p, subtasks: subs, progress: subtaskProgress(subs) }
      saveState()
      return { project: { ...mockProjects[idx] } }
    }
    const { data } = await client.patch(`/subtasks/${subtaskId}`, { is_done: isDone })
    return data
  },

  // Update the completed page count on a "pages" subtask.
  async setSubtaskPages(subtaskId, pagesDone) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) =>
        (p.subtasks ?? []).some((s) => s.id === subtaskId),
      )
      if (idx === -1) {
        const err = new Error('Alt görev bulunamadı.')
        err.status = 404
        throw err
      }
      const p = mockProjects[idx]
      const subs = p.subtasks.map((s) =>
        s.id === subtaskId
          ? { ...s, pages_done: pagesDone, is_done: pagesDone >= (s.total_pages ?? 0) }
          : s,
      )
      mockProjects[idx] = { ...p, subtasks: subs, progress: subtaskProgress(subs) }
      saveState()
      return { project: { ...mockProjects[idx] } }
    }
    const { data } = await client.patch(`/subtasks/${subtaskId}`, { pages_done: pagesDone })
    return data
  },

  // Append a locked "what changed" update entry to a subtask. Each update is
  // immutable history — the designer records what they revised on this görev.
  async addSubtaskUpdate(subtaskId, { note, by = null, by_name = '—' }) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => (p.subtasks ?? []).some((s) => s.id === subtaskId))
      if (idx === -1) {
        const err = new Error('Alt görev bulunamadı.')
        err.status = 404
        throw err
      }
      const entry = { id: `su-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, note, by, by_name, at: new Date().toISOString() }
      const p = mockProjects[idx]
      const subs = p.subtasks.map((s) => (s.id === subtaskId ? { ...s, updates: [...(s.updates ?? []), entry] } : s))
      mockProjects[idx] = { ...p, subtasks: subs }
      saveState()
      return { project: { ...mockProjects[idx] }, entry }
    }
    const { data } = await client.post(`/subtasks/${subtaskId}/updates`, { note })
    return data
  },

  // Update a single subtask (title or any field) and recompute progress.
  async updateSubtask(subtaskId, patch) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => (p.subtasks ?? []).some((s) => s.id === subtaskId))
      if (idx === -1) {
        const err = new Error('Alt görev bulunamadı.')
        err.status = 404
        throw err
      }
      const p = mockProjects[idx]
      const subs = p.subtasks.map((s) => (s.id === subtaskId ? { ...s, ...patch } : s))
      mockProjects[idx] = { ...p, subtasks: subs, progress: subtaskProgress(subs) }
      saveState()
      return { project: { ...mockProjects[idx] } }
    }
    const { data } = await client.patch(`/subtasks/${subtaskId}`, patch)
    return data
  },

  // Replace a project's whole subtask (alt görev) list and recompute progress.
  // Used by the designer when revising a project during a sipariş talep.
  async saveProjectSubtasks(projectId, subtasks) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => p.id === projectId)
      if (idx === -1) {
        const err = new Error('Proje bulunamadı.')
        err.status = 404
        throw err
      }
      const subs = Array.isArray(subtasks) ? subtasks : []
      mockProjects[idx] = { ...mockProjects[idx], subtasks: subs, progress: subtaskProgress(subs) }
      saveState()
      return { project: { ...mockProjects[idx] } }
    }
    const { data } = await client.put(`/projects/${projectId}/subtasks`, { subtasks })
    return data
  },

  // Record a demo request against a project (does not change the stage).
  async requestDemo(projectId) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => p.id === projectId)
      if (idx === -1) {
        const err = new Error('Proje bulunamadı.')
        err.status = 404
        throw err
      }
      mockProjects[idx] = {
        ...mockProjects[idx],
        demo_requested: true,
        demo_requested_at: new Date().toISOString(),
      }
      saveState()
      return { ...mockProjects[idx] }
    }
    const { data } = await client.post(`/projects/${projectId}/request-demo`)
    return data
  },

  // Standalone demos: created from loose files, not tied to the pipeline.
  async listDemos() {
    if (USE_MOCK) {
      await delay()
      return mockDemos.map((d) => ({ ...d }))
    }
    const { data } = await client.get('/demos')
    return data
  },

  async inviteUser({ name, email, role }) {
    if (USE_MOCK) {
      await delay()
      const existing = mockUsers.find((u) => u.email.toLowerCase() === email.toLowerCase().trim())
      if (existing) {
        const err = new Error('Bu e-posta zaten kayıtlı.')
        err.status = 409
        throw err
      }
      const created = {
        id: `u-${Date.now()}`,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: '123456',
        role,
        is_active: true,
        invited_at: new Date().toISOString(),
        joined_at: null,
      }
      mockUsers.push(created)
      saveState()
      const { password: _pw, ...safe } = created
      return safe
    }
    const { data } = await client.post('/users/invite', { name, email, role })
    return data
  },

  async setUserActive(id, isActive) {
    if (USE_MOCK) {
      await delay()
      const idx = mockUsers.findIndex((u) => u.id === id)
      if (idx === -1) {
        const err = new Error('Kullanıcı bulunamadı.')
        err.status = 404
        throw err
      }
      mockUsers[idx] = { ...mockUsers[idx], is_active: isActive }
      saveState()
      const { password: _pw, ...safe } = mockUsers[idx]
      return safe
    }
    const path = isActive ? `/users/${id}/reactivate` : `/users/${id}/deactivate`
    const { data } = await client.patch(path)
    return data
  },

  async createDemo({ title, files = [], items = [] }) {
    if (USE_MOCK) {
      await delay()
      const demo = {
        id: `demo-${Date.now()}`,
        title,
        items: items.map((t, i) => ({ id: `di-${Date.now()}-${i}`, title: t })),
        files: files.map((f) => ({ name: f.name, size: f.size })),
        created_at: new Date().toISOString(),
      }
      mockDemos.unshift(demo)
      saveState()
      return { ...demo }
    }
    const { data } = await client.post('/demos', { title, files, items })
    return data
  },

  async listOrderRequests() {
    if (USE_MOCK) {
      await delay()
      return mockOrderRequests.map((r) => ({ ...r }))
    }
    const { data } = await client.get('/order-requests')
    return data
  },

  async createOrderRequest({ projectId, projectTitle, items = [], quantity, notes, requester }) {
    if (USE_MOCK) {
      await delay()
      const now = new Date().toISOString()
      // Resolve to the currently logged-in user or fall back to Esra.
      const actor = requester ?? mockUsers.find((u) => u.id === 'u-esra')
      const req = {
        id: `or-${Date.now()}`,
        project_id: projectId,
        project_title: projectTitle,
        requested_by: actor?.id ?? 'u-esra',
        requested_by_name: actor?.name ?? 'Esra Kılıçkan',
        items,
        quantity,
        notes: notes ?? '',
        status: 'pending',
        created_at: now,
        updated_at: now,
        // Talep mini-workflow: the project stage does NOT change here.
        // It stays at its current stage until the final 'onaylandi' step.
        order_history: [
          {
            id: `oh-${Date.now()}-1`,
            step: 'pending',
            step_label: ORDER_STEP_LABELS.pending,
            signed_by_id: actor?.id ?? 'u-esra',
            signed_by_name: actor?.name ?? 'Esra Kılıçkan',
            signed_by_role: actor?.role ?? 'satis',
            signed_at: now,
            notes: notes ?? '',
          },
        ],
      }
      mockOrderRequests.unshift(req)
      saveState()
      return { ...req }
    }
    const { data } = await client.post('/order-requests', { projectId, projectTitle, items, quantity, notes })
    return data
  },

  async updateOrderRequest(id, status) {
    if (USE_MOCK) {
      await delay()
      const idx = mockOrderRequests.findIndex((r) => r.id === id)
      if (idx === -1) {
        const err = new Error('Talep bulunamadı.')
        err.status = 404
        throw err
      }
      mockOrderRequests[idx] = { ...mockOrderRequests[idx], status, updated_at: new Date().toISOString() }
      saveState()
      return { ...mockOrderRequests[idx] }
    }
    const { data } = await client.patch(`/order-requests/${id}`, { status })
    return data
  },

  // Advance a talep one step through its mini approval cycle.
  // `actor` = { id, name, role } of the person signing off.
  // `notes` = optional free-text from the sign-off dialog.
  // Returns the updated order (with order_history appended).
  async advanceOrderRequest(id, { actor, notes = '' }) {
    if (USE_MOCK) {
      await delay()
      const idx = mockOrderRequests.findIndex((r) => r.id === id)
      if (idx === -1) {
        const err = new Error('Talep bulunamadı.')
        err.status = 404
        throw err
      }
      const order = mockOrderRequests[idx]
      const nextStatus = ORDER_STEP_NEXT[order.status]
      if (!nextStatus) {
        const err = new Error('Bu talep zaten tamamlandı.')
        err.status = 400
        throw err
      }

      const now = new Date().toISOString()
      const historyEntry = {
        id: `oh-${Date.now()}`,
        step: nextStatus,
        step_label: ORDER_STEP_LABELS[nextStatus],
        signed_by_id: actor.id,
        signed_by_name: actor.name,
        signed_by_role: actor.role,
        signed_at: now,
        notes,
      }

      mockOrderRequests[idx] = {
        ...order,
        status: nextStatus,
        updated_at: now,
        order_history: [...(order.order_history ?? []), historyEntry],
      }

      // Final approval: flip uretime_hazir project to uretimde and record it
      // in the project's own history timeline.
      if (nextStatus === 'onaylandi') {
        const pidx = mockProjects.findIndex((p) => p.id === order.project_id)
        if (pidx !== -1) {
          const p = mockProjects[pidx]
          const stageFlipped = p.stage === 'uretime_hazir'
          // Ensure the project has a persisted history to append to.
          if (!p.history) {
            const detail = buildProjectDetail(p)
            mockProjects[pidx] = { ...mockProjects[pidx], history: detail.history }
          }
          const orderNote = `Sipariş onaylandı — ${order.requested_by_name} tarafından ${order.quantity.toLocaleString('tr-TR')} adet talep edildi`
          mockProjects[pidx] = {
            ...mockProjects[pidx],
            ...(stageFlipped ? { stage: 'uretimde' } : {}),
            history: [
              ...(mockProjects[pidx].history ?? []),
              {
                id: `oh-proj-${Date.now()}`,
                action: 'order',
                order_id: order.id,
                from_stage: p.stage,
                to_stage: stageFlipped ? 'uretimde' : p.stage,
                done_by_name: actor.name,
                created_at: now,
                note: orderNote,
              },
            ],
          }
        }
      } else {
        // All intermediate steps also appear in project history.
        const pidx = mockProjects.findIndex((p) => p.id === order.project_id)
        if (pidx !== -1) {
          const p = mockProjects[pidx]
          if (!p.history) {
            const detail = buildProjectDetail(p)
            mockProjects[pidx] = { ...mockProjects[pidx], history: detail.history }
          }
          mockProjects[pidx] = {
            ...mockProjects[pidx],
            history: [
              ...(mockProjects[pidx].history ?? []),
              {
                id: `oh-proj-${Date.now()}`,
                action: 'order',
                order_id: order.id,
                from_stage: p.stage,
                to_stage: p.stage,
                done_by_name: actor.name,
                created_at: now,
                note: `${ORDER_STEP_LABELS[nextStatus]} — ${actor.name}`,
              },
            ],
          }
        }
      }

      saveState()
      return { ...mockOrderRequests[idx] }
    }
    const { data } = await client.patch(`/order-requests/${id}/advance`, { notes })
    return data
  },
}

export default api
