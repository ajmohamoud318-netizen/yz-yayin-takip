import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, FileText, LayoutDashboard, LayoutGrid, Columns3, CalendarDays, UsersRound, Package, Target, Files, Boxes, ClipboardPlus, ClipboardCheck, ClipboardList, PackageCheck, Truck, Factory, Briefcase, BadgeCheck } from 'lucide-react'

import { useProjects } from '@/hooks/useProjects'
import { useAuth } from '@/hooks/useAuth'
import { ROLE_LABELS } from '@/api'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn, initials } from '@/lib/utils'

// Quick navigation targets. Mirrors the sidebar nav but flattened and
// role-gated — keeps the palette useful even when projects is empty.
const NAV_TARGETS = [
  { to: '/', label: 'Genel Bakış', icon: LayoutDashboard, roles: ['team_leader', 'designer', 'printer'] },
  { to: '/projects', label: 'Tüm Projeler', icon: LayoutGrid, roles: ['team_leader', 'designer', 'printer'] },
  { to: '/kanban', label: 'İş Akışı', icon: Columns3, roles: ['team_leader', 'designer', 'printer'] },
  { to: '/my-projects', label: 'Projelerim', icon: Briefcase, roles: ['designer'] },
  { to: '/team', label: 'Ekip', icon: UsersRound, roles: ['team_leader'] },
  { to: '/toplanti', label: 'Toplantılar', icon: CalendarDays, roles: ['team_leader', 'designer', 'printer'] },
  { to: '/hedef-projeler', label: 'Hedef Projeler', icon: Target, roles: ['team_leader', 'designer'] },
  { to: '/urunler', label: 'Ürünler', icon: Package, roles: ['satis', 'team_leader'] },
  { to: '/urun-bilgileri', label: 'Ürün Bilgileri', icon: Boxes, roles: ['team_leader', 'designer'] },
  { to: '/documents', label: 'Dökümanlar', icon: Files, roles: ['team_leader', 'designer', 'printer'] },
  { to: '/baski-receteleri', label: 'Baskı Reçeteleri', icon: FileText, roles: ['team_leader', 'designer'] },
  { to: '/approvals/demo', label: 'Onaylar', icon: BadgeCheck, roles: ['printer', 'team_leader', 'designer'] },
  { to: '/matbaa-isleri', label: 'Matbaa İşleri', icon: Factory, roles: ['printer'] },
  { to: '/baski-listesi', label: 'Baskı Listesi', icon: Factory, roles: ['printer'] },
  { to: '/teslim-talepleri', label: 'Teslim Talepleri', icon: Truck, roles: ['printer'] },
  { to: '/teslim-onaylari', label: 'Teslim Onayları', icon: PackageCheck, roles: ['satis'] },
  { to: '/siparis-talebi', label: 'Taleplerim', icon: ClipboardPlus, roles: ['satis'] },
  { to: '/siparis-talepleri', label: 'Baskı Talepleri', icon: ClipboardList, roles: ['team_leader'] },
  { to: '/siparis-onay', label: 'Baskı Onayları', icon: ClipboardCheck, roles: ['designer'] },
]

/**
 * ⌘K command palette.
 *
 * Replaces the old toast-placeholder search button. Two result groups:
 *   • Projeler — filters the in-memory projects list (title + assigned_name)
 *   • Sayfalar  — quick nav to any role-visible route
 *
 * Keyboard:
 *   • ⌘K / Ctrl+K → open (global, never while typing in another input)
 *   • Esc → close
 *   • ↑/↓ → move highlight
 *   • Enter → select highlighted result
 *
 * The visible label for a project is title + (designer name in muted text).
 * No fuzzy matching yet — straightforward `includes()` keeps it predictable
 * and matches the existing AllProjects filter behavior.
 */
export default function CommandPalette({ open, onOpenChange }) {
  const navigate = useNavigate()
  const { projects } = useProjects()
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  // Reset state every time the palette opens so a stale query from the
  // previous session never greets the user.
  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlight(0)
      // Focus is handled by DialogContent's onOpenAutoFocus below, so this
      // effect is now state-only.
    }
    return undefined
  }, [open])

  const navTargets = useMemo(
    () => NAV_TARGETS.filter((n) => !n.roles || n.roles.includes(user?.role)),
    [user?.role],
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const projectsGroup = !q
      ? projects.slice(0, 8)
      : projects.filter((p) =>
          p.title.toLowerCase().includes(q) ||
          (p.assigned_name ?? '').toLowerCase().includes(q),
        ).slice(0, 8)
    const navGroup = !q
      ? navTargets.slice(0, 6)
      : navTargets.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 6)
    return { projects: projectsGroup, nav: navGroup }
  }, [query, projects, navTargets])

  const flat = useMemo(
    () => [
      ...results.projects.map((p) => ({ kind: 'project', id: p.id, project: p })),
      ...results.nav.map((n) => ({ kind: 'nav', id: n.to, nav: n })),
    ],
    [results],
  )

  // Clamp the highlight when results shrink (typing).
  useEffect(() => {
    if (highlight >= flat.length) setHighlight(0)
  }, [flat.length, highlight])

  // Scroll the highlighted row into view as the user navigates with arrows.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const el = list.querySelector(`[data-row-index="${highlight}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  function selectAt(i) {
    const item = flat[i]
    if (!item) return
    if (item.kind === 'project') navigate(`/projects/${item.project.id}`)
    else navigate(item.nav.to)
    onOpenChange(false)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => (h + 1) % Math.max(flat.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => (h - 1 + flat.length) % Math.max(flat.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      selectAt(highlight)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="motion-pop left-[50%] top-[20%] max-w-xl translate-x-[-50] gap-0 overflow-hidden p-0 sm:top-[25%]"
        onOpenAutoFocus={(e) => {
          // Focus the input SYNCHRONOUSLY here instead of via rAF.
          // Radix applies aria-hidden="true" to siblings BEFORE firing
          // onOpenAutoFocus, so the previously-focused page element (e.g.
          // the "Yeni Proje" topbar button) sat inside an aria-hidden
          // subtree for one frame — Chrome logged a "focused descendant of
          // aria-hidden" warning for it. preventDefault keeps Radix from
          // racing us with its own auto-focus.
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Proje, tasarımcı veya sayfa arayın…"
            aria-label="Arama"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">Esc</kbd>
        </div>
        <div ref={listRef} className="scrollbar-thin max-h-[60vh] overflow-y-auto p-1">
          {flat.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Sonuç bulunamadı.</p>
          ) : (
            <>
              {results.projects.length > 0 && (
                <SectionLabel>Projeler</SectionLabel>
              )}
              {results.projects.map((p, idx) => (
                <ResultRow
                  key={p.id}
                  index={idx}
                  active={highlight === idx}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => selectAt(idx)}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-[10px] font-semibold text-primary">
                    {initials(p.assigned_name) || '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {p.assigned_name || 'Atanmamış'}
                    </span>
                  </span>
                </ResultRow>
              ))}
              {results.nav.length > 0 && (
                <SectionLabel>Sayfalar</SectionLabel>
              )}
              {results.nav.map((n, idx) => {
                const i = results.projects.length + idx
                const Icon = n.icon
                return (
                  <ResultRow
                    key={n.to}
                    index={i}
                    active={highlight === i}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => selectAt(i)}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm font-medium">{n.label}</span>
                  </ResultRow>
                )
              })}
            </>
          )}
        </div>
        <div className="flex items-center justify-between border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>{user ? `${ROLE_LABELS[user.role] ?? user.role} olarak arıyorsunuz` : ''}</span>
          <span className="flex items-center gap-2">
            <kbd className="rounded border bg-muted px-1 py-0.5 font-medium">↑↓</kbd>
            <span>hareket</span>
            <kbd className="rounded border bg-muted px-1 py-0.5 font-medium">↵</kbd>
            <span>aç</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SectionLabel({ children }) {
  return (
    <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
      {children}
    </p>
  )
}

function ResultRow({ index, active, onMouseEnter, onClick, children }) {
  return (
    <button
      type="button"
      data-row-index={index}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
        active ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}