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

// Pipeline stage -> Turkish label
export const STAGE_LABELS = {
  tasarim: 'Tasarım',
  demo_teslim: 'Demo Teslim',
  demo_onay: 'Demo Onay',
  ozalit_teslim: 'Özalit Teslim',
  ozalit_onay: 'Özalit Onay',
  cin_demo_teslim: 'Çin Demo Teslim',
  cin_demo_onay: 'Çin Demo Onay',
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
    badge: 'bg-orange-50 text-orange-700 ring-orange-600/20',
    bar: 'bg-orange-500',
  },
  purple: {
    label: 'Devam Eden',
    dot: 'bg-purple-500',
    badge: 'bg-purple-50 text-purple-700 ring-purple-600/20',
    bar: 'bg-purple-500',
  },
  green: {
    label: 'Demo aşamasında',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    bar: 'bg-emerald-500',
  },
  blue: {
    label: 'Özalit aşamasında',
    dot: 'bg-blue-500',
    badge: 'bg-blue-50 text-blue-700 ring-blue-600/20',
    bar: 'bg-blue-500',
  },
  pink: {
    // "Üretimde" — fuchsia, distinct from the green/blue stages.
    label: 'Üretimde',
    dot: 'bg-fuchsia-500',
    badge: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20',
    bar: 'bg-fuchsia-500',
  },
  yellow: {
    label: 'Satışta',
    dot: 'bg-amber-400',
    badge: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    bar: 'bg-amber-400',
  },
}

// Alias used by Kanban, AllProjects, YearPlan, DemoRequests, etc.
// Same shape as STATUS_STYLES — just a friendlier name in the page code.
export const STATUS_META = STATUS_STYLES

// Pipeline definitions for the Kanban board.
// Each project type follows a different sequence of stages (see CLAUDE.md).
export const STAGE_PIPELINE = {
  TR: ['tasarim', 'demo_teslim', 'demo_onay', 'ozalit_teslim', 'ozalit_onay', 'uretimde', 'satista'],
  CIN: ['tasarim', 'cin_demo_teslim', 'cin_demo_onay', 'uretimde', 'gumruk', 'satista'],
}

// Subtask catalog used by NewProjectDialog. Each item has a stable key
// (used in the project's subtasks array) and a human label.
export const SUBTASK_LIBRARY = [
  { key: 'kapak', label: 'Kapak' },
  { key: 'kutu', label: 'Kutu' },
  { key: 'ses', label: 'Ses' },
  { key: 'video', label: 'Video / Animasyon' },
  { key: 'yazilim', label: 'Yazılım' },
  { key: 'icerik', label: 'İçerik / Görsel' },
]

// Project type -> Turkish badge
export const TYPE_LABELS = { TR: 'TR', CIN: 'ÇİN' }

// Role -> Turkish label
export const ROLE_LABELS = {
  team_leader: 'Takım Lideri',
  designer: 'Tasarımcı',
  printer: 'Matbaa',
}

/**
 * Maps a project (stage + progress) to one of the status color keys.
 * Mirrors the CLAUDE.md color rules:
 *   orange  Yeni Proje / just started
 *   purple  Devam Eden / in progress
 *   green   Demo aşamasında
 *   blue    Özalit aşamasında
 *   pink    Üretimde
 *   yellow  Satışta
 */
export function statusKeyForProject(p) {
  switch (p.stage) {
    case 'satista':
      return 'yellow'
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
  const { assignees, subtasks, pageCount, ...rest } = payload
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
      if (key === 'sayfa') continue // page count handled below
      const lib = SUBTASK_LIBRARY.find((s) => s.key === key)
      const title = lib ? lib.label : key
      const old = prev.find((s) => s.title === title && s.kind !== 'pages')
      subs.push({
        id: old?.id ?? `st-${Date.now()}-${key}`,
        title,
        kind: 'check',
        is_done: old?.is_done ?? false,
        done_at: old?.done_at ?? null,
      })
    }
    if (subtasks.includes('sayfa') && pageCount) {
      const old = prev.find((s) => s.kind === 'pages')
      subs.push({
        id: old?.id ?? `st-${Date.now()}-sayfa`,
        title: 'Sayfa Sayısı',
        kind: 'pages',
        total_pages: Number(pageCount),
        pages_done: old?.pages_done ?? 0,
        is_done: (old?.pages_done ?? 0) >= Number(pageCount),
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
      .filter((key) => key !== 'sayfa')
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

  // A minimal history. Rejections (demo_attempt > 0) are surfaced with a reason.
  let history = p.history
  if (!history) {
    history = [
      {
        id: `${p.id}-h0`,
        action: 'advance',
        to_stage: 'tasarim',
        done_by_name: 'Ayşenur Kanak',
        created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
      },
    ]
    if ((p.demo_attempt ?? 0) > 0) {
      history.push({
        id: `${p.id}-hr`,
        action: 'reject',
        to_stage: 'tasarim',
        reason: 'Kapak renkleri marka kılavuzuna uymuyor, lütfen revize edin.',
        done_by_name: 'Ayşenur Kanak',
        created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      })
    }
  }

  return { ...p, assignees, subtasks, history }
}

// Standalone demos created from loose files (not part of the pipeline).
const mockDemos = []

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
    name: 'Aylin',
    email: 'aylin@yukselenzeka.com',
    password: '123456',
    role: 'designer',
    is_active: true,
  },
  {
    id: 'u-mert',
    name: 'Mert Kaya',
    email: 'mert@yukselenzeka.com',
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
    id: 'p-1',
    title: 'Minik Kaşif – Uzay Serisi',
    type: 'TR',
    stage: 'tasarim',
    assigned_to: 'u-elif',
    assigned_name: 'Aylin',
    created_by: 'u-ayse',
    target_month: monthOffset(0),
    demo_attempt: 0,
    progress: 0,
  },
  {
    id: 'p-2',
    title: 'Renkli Hayvanlar Kutu Seti',
    type: 'TR',
    stage: 'tasarim',
    assigned_to: 'u-mert',
    assigned_name: 'Mert Kaya',
    created_by: 'u-ayse',
    target_month: monthOffset(0),
    demo_attempt: 1,
    progress: 60,
  },
  {
    id: 'p-3',
    title: 'Masal Bahçesi – Sesli Kitap',
    type: 'TR',
    stage: 'demo_onay',
    assigned_to: 'u-elif',
    assigned_name: 'Aylin',
    created_by: 'u-ayse',
    target_month: monthOffset(1),
    demo_attempt: 1,
    progress: 100,
  },
  {
    id: 'p-4',
    title: 'Sayılarla Oyun – Çin Baskı',
    type: 'CIN',
    stage: 'cin_demo_teslim',
    assigned_to: 'u-mert',
    assigned_name: 'Mert Kaya',
    created_by: 'u-ayse',
    target_month: monthOffset(1),
    demo_attempt: 0,
    progress: 100,
  },
  {
    id: 'p-5',
    title: 'Doğa Dostları Boyama Kitabı',
    type: 'TR',
    stage: 'ozalit_teslim',
    assigned_to: 'u-elif',
    assigned_name: 'Aylin',
    created_by: 'u-ayse',
    target_month: monthOffset(2),
    demo_attempt: 2,
    progress: 100,
  },
  {
    id: 'p-6',
    title: 'Küçük Mucitler – Yazılım Eki',
    type: 'CIN',
    stage: 'uretimde',
    assigned_to: 'u-mert',
    assigned_name: 'Mert Kaya',
    created_by: 'u-ayse',
    target_month: monthOffset(2),
    demo_attempt: 1,
    progress: 100,
  },
  {
    id: 'p-7',
    title: 'Alfabe Treni',
    type: 'TR',
    stage: 'satista',
    assigned_to: 'u-elif',
    assigned_name: 'Aylin',
    created_by: 'u-ayse',
    target_month: monthOffset(-1),
    demo_attempt: 1,
    progress: 100,
  },
  {
    id: 'p-8',
    title: 'Gökkuşağı Hikâyeleri',
    type: 'TR',
    stage: 'tasarim',
    assigned_to: 'u-mert',
    assigned_name: 'Mert Kaya',
    created_by: 'u-ayse',
    target_month: monthOffset(3),
    demo_attempt: 0,
    progress: 25,
  },
]

function delay(ms = 350) {
  return new Promise((r) => setTimeout(r, ms))
}

/* ------------------------------------------------------------------ */
/*  localStorage persistence (mock layer only)                         */
/*  Keeps projects/users/demos across refreshes on the same browser.   */
/* ------------------------------------------------------------------ */
const LS_KEY = 'yz_mock_state_v1'

function saveState() {
  if (!USE_MOCK || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ users: mockUsers, projects: mockProjects, demos: mockDemos }),
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
      mockUsers.length = 0
      mockUsers.push(...saved.users)
    }
    if (Array.isArray(saved.projects)) {
      mockProjects.length = 0
      mockProjects.push(...saved.projects)
    }
    if (Array.isArray(saved.demos)) {
      mockDemos.length = 0
      mockDemos.push(...saved.demos)
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
      return mockProjects.map((p) => ({ ...p }))
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
      // Persist the resolved subtasks/assignees so later edits (e.g. a designer
      // checking a subtask) can find them on the stored project.
      mockProjects[idx] = {
        ...mockProjects[idx],
        assignees: detail.assignees,
        assigned_name: detail.assigned_name ?? mockProjects[idx].assigned_name,
        subtasks: detail.subtasks,
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
      const created = {
        id: `p-${Date.now()}`,
        stage: 'tasarim',
        demo_attempt: 0,
        ...normalized,
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
      mockProjects[idx] = { ...p, stage: pipeline[i + 1] }
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
        mockProjects[idx] = { ...mockProjects[idx], stage }
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
        mockProjects[idx] = {
          ...p,
          stage: 'tasarim',
          demo_attempt: (p.demo_attempt ?? 0) + 1,
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
      mockProjects[idx] = { ...p, stage: pipeline[i + 1] }
      saveState()
      return { ...mockProjects[idx] }
    }
    const { data } = await client.post(`/projects/${id}/approve`)
    return data
  },

  // Reject the current stage → back to Tasarım, attempt counter +1, store reason.
  async rejectProject(id, reason) {
    if (USE_MOCK) {
      await delay()
      const idx = mockProjects.findIndex((p) => p.id === id)
      if (idx === -1) {
        const err = new Error('Proje bulunamadı.')
        err.status = 404
        throw err
      }
      const p = mockProjects[idx]
      mockProjects[idx] = {
        ...p,
        stage: 'tasarim',
        demo_attempt: (p.demo_attempt ?? 0) + 1,
        last_reject_reason: reason,
      }
      saveState()
      return { ...mockProjects[idx] }
    }
    const { data } = await client.post(`/projects/${id}/reject`, { reason })
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
}

export default api
