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
    label: 'Üretimde',
    dot: 'bg-pink-500',
    badge: 'bg-pink-50 text-pink-700 ring-pink-600/20',
    bar: 'bg-pink-500',
  },
  yellow: {
    label: 'Satışta',
    dot: 'bg-amber-400',
    badge: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    bar: 'bg-amber-400',
  },
}

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

/* ------------------------------------------------------------------ */
/*  MOCK DATA (stands in for the API until the backend is built)       */
/* ------------------------------------------------------------------ */

const mockUsers = [
  {
    id: 'u-ayse',
    name: 'Ayşenur Yılmaz',
    email: 'aysenur@yukselenzeka.com',
    password: '123456',
    role: 'team_leader',
    is_active: true,
  },
  {
    id: 'u-elif',
    name: 'Elif Demir',
    email: 'elif@yukselenzeka.com',
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
    assigned_name: 'Elif Demir',
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
    assigned_name: 'Elif Demir',
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
    assigned_name: 'Elif Demir',
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
    assigned_name: 'Elif Demir',
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
}

export default api
