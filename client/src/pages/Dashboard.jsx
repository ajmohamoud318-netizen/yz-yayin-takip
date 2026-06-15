import { useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { useProjects } from '../hooks/useProjects.js'
import {
  STATUS_STYLES,
  ROLE_LABELS,
  TYPE_LABELS,
  groupKeyForProject,
  statusKeyForProject,
} from '../api.js'
import MonthTimeline from '../components/MonthTimeline.jsx'

function initials(name = '') {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}

// The six status colors, in dashboard legend order (from CLAUDE.md).
const LEGEND_KEYS = ['orange', 'purple', 'green', 'blue', 'pink', 'yellow']

export default function Dashboard() {
  const { user, logout } = useAuth()
  const { projects, loading, error, refetch } = useProjects()

  const [typeFilter, setTypeFilter] = useState('all') // all | TR | CIN
  const [groupFilter, setGroupFilter] = useState('all') // all | yeni_proje | devam_eden

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false
      if (groupFilter !== 'all' && groupKeyForProject(p) !== groupFilter) return false
      return true
    })
  }, [projects, typeFilter, groupFilter])

  // Counts for the summary tiles.
  const counts = useMemo(() => {
    const c = { total: projects.length, yeni: 0, devam: 0, satista: 0 }
    for (const p of projects) {
      const g = groupKeyForProject(p)
      if (g === 'yeni_proje') c.yeni++
      else c.devam++
      if (statusKeyForProject(p) === 'yellow') c.satista++
    }
    return c
  }, [projects])

  return (
    <div className="min-h-full">
      <Header user={user} onLogout={logout} />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Title row */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Panel</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Tüm yayın projeleri, aylara göre zaman çizelgesinde.
            </p>
          </div>
          <button
            onClick={refetch}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 11-2.64-6.36M21 3v6h-6" />
            </svg>
            Yenile
          </button>
        </div>

        {/* Summary tiles */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label="Toplam Proje" value={counts.total} accent="bg-brand-500" />
          <SummaryTile label="Yeni Proje" value={counts.yeni} accent="bg-orange-500" />
          <SummaryTile label="Devam Eden" value={counts.devam} accent="bg-purple-500" />
          <SummaryTile label="Satışta" value={counts.satista} accent="bg-amber-400" />
        </div>

        {/* Filters + legend */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SegBtn active={groupFilter === 'all'} onClick={() => setGroupFilter('all')}>
              Tümü
            </SegBtn>
            <SegBtn active={groupFilter === 'yeni_proje'} onClick={() => setGroupFilter('yeni_proje')}>
              Yeni Proje
            </SegBtn>
            <SegBtn active={groupFilter === 'devam_eden'} onClick={() => setGroupFilter('devam_eden')}>
              Devam Eden
            </SegBtn>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <SegBtn active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>
              Tüm Türler
            </SegBtn>
            <SegBtn active={typeFilter === 'TR'} onClick={() => setTypeFilter('TR')}>
              {TYPE_LABELS.TR}
            </SegBtn>
            <SegBtn active={typeFilter === 'CIN'} onClick={() => setTypeFilter('CIN')}>
              {TYPE_LABELS.CIN}
            </SegBtn>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {LEGEND_KEYS.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLES[k].dot}`} />
                {STATUS_STYLES[k].label}
              </span>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="mt-6">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} onRetry={refetch} />
          ) : filtered.length === 0 ? (
            <EmptyState />
          ) : (
            <MonthTimeline projects={filtered} onSelect={() => {}} />
          )}
        </div>
      </main>
    </div>
  )
}

/* ----------------------------- header ----------------------------- */
function Header({ user, onLogout }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <svg className="h-8 w-8" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect width="32" height="32" rx="8" className="fill-brand-600" />
            <path d="M9 22V10h3l4 6 4-6h3v12h-3v-7l-4 6-4-6v7H9z" fill="white" />
          </svg>
          <span className="text-base font-semibold tracking-tight text-slate-900">
            YZ Yayın Takip
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-slate-800">{user?.name}</p>
            <p className="text-xs text-slate-500">{ROLE_LABELS[user?.role] ?? user?.role}</p>
          </div>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
            {initials(user?.name)}
          </span>
          <button
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title="Çıkış Yap"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            <span className="hidden sm:inline">Çıkış</span>
          </button>
        </div>
      </div>
    </header>
  )
}

/* ----------------------------- bits ------------------------------- */
function SummaryTile({ label, value, accent }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${accent}`} />
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  )
}

function SegBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'bg-brand-600 text-white shadow-sm'
          : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

function LoadingState() {
  return (
    <div className="flex gap-4 overflow-hidden">
      {[0, 1, 2].map((c) => (
        <div key={c} className="w-72 shrink-0">
          <div className="mb-3 h-4 w-24 animate-pulse rounded bg-slate-200" />
          <div className="space-y-3 rounded-xl bg-slate-100/60 p-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl bg-white" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="text-sm font-medium text-red-700">{message}</p>
      <button
        onClick={onRetry}
        className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
      >
        Tekrar Dene
      </button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
      <p className="text-sm font-medium text-slate-600">Bu filtreye uygun proje bulunamadı.</p>
      <p className="mt-1 text-xs text-slate-400">Filtreleri değiştirip tekrar deneyin.</p>
    </div>
  )
}
