import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Sparkles, Wand2, X } from 'lucide-react'

import api, { TYPE_LABELS, SUBTASK_LIBRARY } from '@/api'
import {
  inferSubtasksFromTemplate,
  inferTitleFromTemplate,
  listOrphanTemplates,
  seedProjectFromTemplate,
} from '@/data/productCatalog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'
import { useProjectsStore } from '@/hooks/useProjectsStore'
import { cn, initials } from '@/lib/utils'

// Default target date for new projects: today + 1 month, snapped to the 1st.
// (When the user picks a more specific day in the date picker, the value is
// stored verbatim — but the default stays month-aligned.)
function defaultTargetDate() {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

// Today as an ISO YYYY-MM-DD string. Used as the date picker's `min` value so
// the target date can never land in the past.
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

const emptySubtasks = () => SUBTASK_LIBRARY.reduce((acc, s) => ({ ...acc, [s.key]: false }), {})
const emptySubtaskAssignees = () => SUBTASK_LIBRARY.reduce((acc, s) => ({ ...acc, [s.key]: '' }), {})

// Build a stable, collision-free key for a custom (ad-hoc) subtask label.
// We never put customs into SUBTASK_LIBRARY, so a synthetic key keeps them
// out of the library's namespace while still being unique per dialog session.
function customSubtaskKey(label) {
  const slug =
    label
      .toLowerCase('tr-TR')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'item'
  return `custom-${slug}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Create / edit a publication project. Team leader only.
 * Pass a `project` to open in edit mode (prefilled); otherwise it creates.
 */
export default function NewProjectDialog({ open, onOpenChange, onCreated, onUpdated, project }) {
  const { user } = useAuth()
  const { addOne, updateOne } = useProjectsStore()
  const isEdit = !!project
  const [title, setTitle] = useState('')
  const [type, setType] = useState('TR')
  const [assignedIds, setAssignedIds] = useState([])
  const [pageCount, setPageCount] = useState(32)
  const [stickerCount, setStickerCount] = useState(1)
  const [subtasks, setSubtasks] = useState(emptySubtasks)
  // Per-subtask designer assignment: { [subtaskKey]: userId | '' }
  const [subtaskAssignees, setSubtaskAssignees] = useState(emptySubtaskAssignees)
  // Custom (ad-hoc) subtasks added by the team leader for this project.
  // Shape: { id: string, label: string }[]
  const [customSubtasks, setCustomSubtasks] = useState([])
  // Which custom subtasks are currently checked on. Custom items are
  // opt-in (the leader chose to add them) so they default to checked; the
  // leader can still uncheck a custom row to skip it for this project.
  // Shape: { [customId]: boolean }
  const [customChecked, setCustomChecked] = useState({})
  const [customDraft, setCustomDraft] = useState('')
  const [targetDate, setTargetDate] = useState(defaultTargetDate())
  const [designers, setDesigners] = useState([])
  const [saving, setSaving] = useState(false)
  // Product template picked from Ürün Bilgileri. Empty string = "start from
  // scratch". The selected template's components are copied into the new
  // project's localStorage entry on create, so Ürün Bilgileri picks the
  // project up immediately — the leader can refine the data from the
  // catalog without re-typing it. Template state is meaningless in edit
  // mode (the project already has its own product info) so the UI hides
  // the picker entirely when `isEdit`.
  const [templateId, setTemplateId] = useState('')
  const [templates, setTemplates] = useState([])
  // Snapshot of the currently selected template (null when none / edit
  // mode). Drives the "auto-filled" hint pill and the live subtask list.
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  )

  useEffect(() => {
    if (!open) return
    api.listUsers().then((users) => {
      setDesigners(users.filter((u) => u.role === 'designer' && u.is_active))
    })
    if (isEdit) {
      setTitle(project.title)
      setType(project.type)
      // Merge project-level assignees with per-subtask designers so the
      // picker pre-fills with everyone who actually owns a piece of this
      // project. The server's detail endpoint should already return the
      // union — this is a defensive client-side fallback in case it
      // returns only the project primary (e.g. after a stale cache hit
      // or while the server fix is rolling out). Mirrors the allDesigners
      // pattern in ProjectDetail.jsx so the two views stay in lock-step.
      const designerMap = new Map()
      for (const a of project.assignees ?? []) designerMap.set(a.id, a)
      for (const s of project.subtasks ?? []) {
        if (s.assigned_to && !designerMap.has(s.assigned_to)) {
          designerMap.set(s.assigned_to, {
            id: s.assigned_to,
            name: s.assigned_name ?? null,
          })
        }
      }
      setAssignedIds(Array.from(designerMap.keys()))
      setTargetDate(((project.target_month ?? defaultTargetDate()).slice(0, 10) < todayISO())
        ? todayISO()
        : (project.target_month ?? defaultTargetDate()).slice(0, 10))
      const map = emptySubtasks()
      const assigneeMap = emptySubtaskAssignees()
      const customs = []
      let pc = 32
      for (const s of project.subtasks ?? []) {
        const libMatch = SUBTASK_LIBRARY.find((l) => l.label === s.title)
        if (libMatch) {
          map[libMatch.key] = true
          if (s.assigned_to) assigneeMap[libMatch.key] = s.assigned_to
        } else if (s.kind !== 'pages' && s.kind !== 'sticker-count' && s.title) {
          // Anything in the project's saved subtasks that isn't a library
          // item or a numeric counter is a custom one — rehydrate it so the
          // team leader can edit / remove it.
          const id = customSubtaskKey(s.title)
          customs.push({ id, label: s.title })
          if (s.assigned_to) assigneeMap[id] = s.assigned_to
        }
        if (s.kind === 'pages' && s.total_pages) pc = s.total_pages
        if (s.kind === 'sticker-count' && s.total_stickers) setStickerCount(s.total_stickers)
      }
      setSubtasks(map)
      setSubtaskAssignees(assigneeMap)
      setCustomSubtasks(customs)
      // Custom subtasks are always treated as checked on rehydration — the
      // server only persists items the leader opted into (customs have no
      // unchecked representation on the server side).
      const checkedMap = {}
      for (const c of customs) checkedMap[c.id] = true
      setCustomChecked(checkedMap)
      setCustomDraft('')
      setPageCount(pc)
    } else {
      setTargetDate(defaultTargetDate())
      // In create mode, surface the orphan Ürün Bilgileri templates so the
      // leader can pick one and have subtasks auto-fill. We refetch every
      // time the dialog opens so the list stays in lock-step with anything
      // the leader added/edited in Ürün Bilgileri between dialog sessions.
      api.listProjects()
        .then((real) => listOrphanTemplates(real.map((p) => p.id)))
        .then(setTemplates)
        .catch(() => setTemplates([]))
    }
    // Always start with no template chosen. The "Ürün Bilgileri şablonu"
    // picker is only meaningful in create mode; in edit mode the project
    // already owns its product info and the picker is hidden anyway.
    setTemplateId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function reset() {
    setTitle('')
    setType('TR')
    setAssignedIds([])
    setTargetDate(defaultTargetDate())
    setSubtasks(emptySubtasks())
    setSubtaskAssignees(emptySubtaskAssignees())
    setCustomSubtasks([])
    setCustomChecked({})
    setCustomDraft('')
    setPageCount(32)
    setStickerCount(1)
    setTemplateId('')
  }

  function addCustomSubtask() {
    const label = customDraft.trim()
    if (!label) return
    const id = customSubtaskKey(label)
    setCustomSubtasks((prev) => [...prev, { id, label }])
    // Custom subtasks are opt-in — the team leader just chose to add them,
    // so they default to checked. This matches how the predefined library
    // behaves once the box is ticked, and avoids the surprise of adding
    // "Öğretmen Kılavuzu" and seeing it sit there greyed out.
    setSubtaskAssignees((prev) => ({ ...prev, [id]: '' }))
    setCustomChecked((prev) => ({ ...prev, [id]: true }))
    setCustomDraft('')
  }

  function removeCustomSubtask(id) {
    setCustomSubtasks((prev) => prev.filter((c) => c.id !== id))
    setSubtaskAssignees((prev) => {
      if (!(id in prev)) return prev
      const { [id]: _drop, ...rest } = prev
      return rest
    })
    setCustomChecked((prev) => {
      if (!(id in prev)) return prev
      const { [id]: _drop, ...rest } = prev
      return rest
    })
  }

  function toggleCustomChecked(id, value) {
    setCustomChecked((prev) => ({ ...prev, [id]: !!value }))
    if (!value) {
      setSubtaskAssignees((prev) => ({ ...prev, [id]: '' }))
    }
  }

  // Force the page/sticker count to stay at >= 1. The HTML `min="1"` only
  // validates on form submit; clamping on every change keeps the UI honest
  // even if the user clears the field, pastes "0", or types 0.
  function clampPositiveInt(value) {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 1) return 1
    return Math.floor(n)
  }

  function toggleDesigner(id) {
    setAssignedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // Apply a Ürün Bilgileri template: pre-fill the title (only if the leader
  // hasn't typed one yet), check the subtasks the template suggests, and
  // copy any page / sticker counts the template carries. The leader can
  // still fine-tune every field afterwards — auto-fill is a starting
  // point, not a commitment. Designers are NOT assigned here: they stay
  // project-specific and the leader picks them explicitly below.
  function applyTemplate(id) {
    setTemplateId(id)
    const tpl = templates.find((t) => t.id === id)
    if (!tpl) return
    const { subtasks: suggested, pageCount: pc, stickerCount: sc } = inferSubtasksFromTemplate(tpl.components)
    setSubtasks((prev) => ({ ...prev, ...suggested }))
    if (typeof pc === 'number') setPageCount(pc)
    if (typeof sc === 'number') setStickerCount(sc)
    setTitle((prev) => (prev.trim() ? prev : inferTitleFromTemplate(tpl.components, prev)))
  }

  // Drop the template — clears the picked id but keeps whatever the leader
  // already typed/checked. The leader may want to keep some auto-filled
  // values (e.g. "Kapak") while deselecting the template itself.
  function clearTemplate() {
    setTemplateId('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Lütfen proje başlığı girin.')
      return
    }
    if (assignedIds.length === 0) {
      toast.error('Lütfen en az bir tasarımcı seçin.')
      return
    }
    if (subtasks.sayfalar && (pageCount === '' || pageCount === null || Number(pageCount) < 1)) {
      toast.error('Sayfa sayısı en az 1 olmalıdır (0 girilemez).')
      return
    }
    if (subtasks.sticker && (stickerCount === '' || stickerCount === null || Number(stickerCount) < 1)) {
      toast.error('Sticker adedi en az 1 olmalıdır (0 girilemez).')
      return
    }
    const trimmedCustoms = customSubtasks
      .map((c) => c.label.trim())
      .filter(Boolean)
    const dup = trimmedCustoms.find((l, i) => trimmedCustoms.indexOf(l) !== i)
    if (dup) {
      toast.error(`"${dup}" alt görevi zaten eklenmiş.`)
      return
    }
    const labelClash = trimmedCustoms.find((l) =>
      SUBTASK_LIBRARY.some((s) => s.label.toLowerCase() === l.toLowerCase()),
    )
    if (labelClash) {
      toast.error(`"${labelClash}" listede zaten var, tekrar eklemeye gerek yok.`)
      return
    }
    setSaving(true)
    try {
      const selected = Object.entries(subtasks)
        .filter(([, v]) => v)
        .map(([k]) => k)
      // Custom subtasks are sent alongside the library keys. The mapper
      // recognises unknown keys and stores them verbatim as `kind: 'check'`.
      // Only checked customs go to the server — an unchecked custom is
      // effectively deleted from this project's perspective.
      const visibleCustoms = customSubtasks.filter((c) => customChecked[c.id])
      const customSelected = visibleCustoms.map((c) => c.label)
      const mergedSubtasks = [...selected, ...customSelected]
      const customAssignees = visibleCustoms.reduce((acc, c) => {
        const v = subtaskAssignees[c.id]
        if (v) acc[c.label] = v
        return acc
      }, {})
      const payload = {
        title: title.trim(),
        type,
        assignees: assignedIds,
        subtasks: mergedSubtasks,
        pageCount: subtasks.sayfalar ? Number(pageCount) : undefined,
        stickerCount: subtasks.sticker ? Number(stickerCount) : undefined,
        subtaskAssignees: { ...subtaskAssignees, ...customAssignees },
        target_month: targetDate || defaultTargetDate(),
      }
      if (isEdit) {
        const updated = await api.updateProject(project.id, payload)
        updateOne(updated)
        toast.success('Proje güncellendi.')
        onUpdated?.(updated)
      } else {
        const created = await api.createProject(payload)
        addOne(created)
        // When the leader started from a Ürün Bilgileri template, copy its
        // components into localStorage overrides keyed by the new project
        // id. The catalog's read order (overrides → PRODUCT_INFO seed)
        // means the template "claims" the new project immediately and any
        // edits the leader makes in Ürün Bilgileri flow through.
        if (selectedTemplate) {
          await seedProjectFromTemplate(created.id, selectedTemplate.components)
        }
        toast.success(
          selectedTemplate
            ? `Proje oluşturuldu · "${selectedTemplate.title}" şablonundan dolduruldu.`
            : 'Proje oluşturuldu.',
        )
        onCreated?.(created)
        reset()
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setSaving(false)
    }
  }

  if (user?.role !== 'team_leader') return null

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !isEdit) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto max-sm:left-0 max-sm:top-0 max-sm:h-screen max-sm:max-h-screen max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {isEdit ? 'Projeyi Düzenle' : 'Yeni Proje Oluştur'}
          </DialogTitle>
          {isEdit ? (
            <DialogDescription>
              Proje bilgilerini, tasarımcıları ve içerikleri güncelleyin.
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Template picker — only meaningful in create mode. The team leader
              can pick an existing Ürün Bilgileri product to seed the title,
              subtasks, page count and sticker count. Picking nothing is
              still a valid choice; the rest of the form keeps behaving the
              way it always did. */}
          {!isEdit && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="np-template" className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Ürün Bilgileri Şablonu
                  <span className="font-normal text-muted-foreground">(opsiyonel)</span>
                </Label>
                {selectedTemplate && (
                  <button
                    type="button"
                    onClick={clearTemplate}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground transition active:scale-95 hover:text-foreground"
                  >
                    <X className="h-3 w-3" /> Şablonu temizle
                  </button>
                )}
              </div>
              <Select value={templateId} onValueChange={applyTemplate}>
                <SelectTrigger
                  id="np-template"
                  className={cn(
                    'w-full',
                    selectedTemplate && 'border-primary/50 bg-primary/[0.04]',
                  )}
                >
                  <SelectValue placeholder="Boş başla veya bir şablon seç…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— Boş başla —</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="inline-flex items-center gap-2">
                        <Wand2 className="h-3.5 w-3.5 text-primary" />
                        <span className="truncate">{t.title}</span>
                        {t.parcaCount > 1 && (
                          <span className="rounded-full bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-600/20">
                            {t.parcaCount} parça
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                  {templates.length === 0 && (
                    <div className="px-2 py-2 text-xs text-muted-foreground">
                      Ürün Bilgileri'nde henüz şablon yok — yine de boş başlayabilirsiniz.
                    </div>
                  )}
                </SelectContent>
              </Select>
              {selectedTemplate && (
                <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles className="mt-px h-3 w-3 shrink-0 text-primary" />
                  <span>
                    <span className="font-semibold text-foreground">{selectedTemplate.title}</span>{' '}
                    şablonundan otomatik dolduruldu. Alt görevleri, sayfa ve sticker sayılarını
                    isterseniz değiştirebilirsiniz.
                  </span>
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="np-title">Proje Başlığı</Label>
            <Input
              id="np-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn. Minik Kaşif – Uzay Serisi"
              required
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5">
              <Label>Tür</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-[12rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TR">{TYPE_LABELS.TR}</SelectItem>
                  <SelectItem value="CIN">{TYPE_LABELS.CIN}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="np-date">Hedef Tarih</Label>
              <Input
                id="np-date"
                type="date"
                value={targetDate}
                min={todayISO()}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-[12rem]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Atanan Tasarımcılar</Label>
            <div className="grid grid-cols-1 gap-1.5 rounded-lg border bg-muted/30 p-2 sm:grid-cols-2">
              {designers.map((d) => {
                const checked = assignedIds.includes(d.id)
                return (
                  <label
                    key={d.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-background',
                      checked && 'bg-background',
                    )}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggleDesigner(d.id)} />
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground">
                      {initials(d.name)}
                    </span>
                    <span className="flex-1 truncate">{d.name}</span>
                  </label>
                )
              })}
              {designers.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Aktif tasarımcı bulunamadı.</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Alt Görevler</Label>
              {assignedIds.length > 1 && (
                <span className="text-[11px] text-muted-foreground">Seçili alt göreve farklı tasarımcı atayabilirsiniz</span>
              )}
            </div>

            {/* Custom subtask entry. The "+ Yeni alt görev ekle…" row lives
                at the bottom of the same card as the predefined library, so
                the visual rhythm stays constant and there's no portal /
                popover to lose clicks into. Pressing Enter or clicking the
                plus button appends a new row right above it — already
                checked, because the leader just opted into it. */}
            <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
              {SUBTASK_LIBRARY.map((s) => {
                const isChecked = !!subtasks[s.key]
                // The assignee dropdown is rendered for every row so the
                // visual rhythm stays constant. It's disabled until the
                // subtask is checked (and hidden entirely when the project
                // has only one assigned designer — no choice to make).
                const showAssigneeSelect = assignedIds.length > 1
                return (
                  <div key={s.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-background">
                    <Checkbox
                      id={`st-${s.key}`}
                      checked={isChecked}
                      onCheckedChange={(v) => {
                        setSubtasks((prev) => ({ ...prev, [s.key]: !!v }))
                        if (!v) setSubtaskAssignees((prev) => ({ ...prev, [s.key]: '' }))
                      }}
                    />
                    <label
                      htmlFor={`st-${s.key}`}
                      className="flex-1 cursor-pointer text-sm select-none"
                    >
                      {s.label}
                    </label>
                    {showAssigneeSelect && (
                      <Select
                        value={subtaskAssignees[s.key] || ''}
                        onValueChange={(v) =>
                          setSubtaskAssignees((prev) => ({ ...prev, [s.key]: v }))
                        }
                        disabled={!isChecked}
                      >
                        <SelectTrigger
                          className={cn(
                            'h-7 w-36 text-xs',
                            !isChecked && 'opacity-50',
                          )}
                          aria-disabled={!isChecked}
                        >
                          <SelectValue placeholder={isChecked ? 'Tasarımcı seç…' : '—'} />
                        </SelectTrigger>
                        <SelectContent>
                          {designers
                            .filter((d) => assignedIds.includes(d.id))
                            .map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )
              })}
              {customSubtasks.length > 0 && (
                <div className="mt-2 space-y-1">
                  {customSubtasks.map((c) => {
                    const isCustomChecked = !!customChecked[c.id]
                    const showAssigneeSelect = assignedIds.length > 1
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5"
                      >
                        <Checkbox
                          id={`st-custom-${c.id}`}
                          checked={isCustomChecked}
                          onCheckedChange={(v) => toggleCustomChecked(c.id, v)}
                        />
                        <label
                          htmlFor={`st-custom-${c.id}`}
                          className="flex-1 cursor-pointer text-sm select-none"
                        >
                          {c.label}
                        </label>
                        {showAssigneeSelect && (
                          <Select
                            value={subtaskAssignees[c.id] || ''}
                            onValueChange={(v) =>
                              setSubtaskAssignees((prev) => ({ ...prev, [c.id]: v }))
                            }
                            disabled={!isCustomChecked}
                          >
                            <SelectTrigger
                              className={cn(
                                'h-7 w-36 text-xs',
                                !isCustomChecked && 'opacity-50',
                              )}
                              aria-disabled={!isCustomChecked}
                            >
                              <SelectValue placeholder={isCustomChecked ? 'Tasarımcı seç…' : '—'} />
                            </SelectTrigger>
                            <SelectContent>
                              {designers
                                .filter((d) => assignedIds.includes(d.id))
                                .map((d) => (
                                  <SelectItem key={d.id} value={d.id}>
                                    {d.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeCustomSubtask(c.id)}
                          aria-label={`${c.label} alt görevini kaldır`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Inline add-row. Sits at the bottom of the same card so the
                  visual rhythm stays constant. Type a name, press Enter or
                  click "Ekle" to push the new subtask onto the list above —
                  already checked. No popover, no portal — clicks can't be
                  lost. */}
              <div className="mt-2 flex items-center gap-2 border-t pt-2">
                <Input
                  value={customDraft}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addCustomSubtask()
                    }
                  }}
                  placeholder="Yeni alt görev ekle…"
                  className="h-9 flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-9 shrink-0"
                  onClick={addCustomSubtask}
                  disabled={!customDraft.trim()}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Ekle
                </Button>
              </div>
            </div>

            {subtasks.sayfalar && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <Label htmlFor="np-pages" className="text-sm">
                  Toplam sayfa sayısı
                </Label>
                <Input
                  id="np-pages"
                  type="number"
                  min="1"
                  step="1"
                  value={pageCount}
                  onChange={(e) => setPageCount(clampPositiveInt(e.target.value))}
                  onBlur={(e) => setPageCount(clampPositiveInt(e.target.value))}
                  onKeyDown={(e) => {
                    // Block "-" / "e" / "+" and a leading "0" so the field
                    // can never land on 0 via keystroke, paste, or arrow keys.
                    if (e.key === '-' || e.key === 'e' || e.key === 'E' || e.key === '+') {
                      e.preventDefault()
                      return
                    }
                    if (e.key === '0' && (e.currentTarget.value === '' || e.currentTarget.value === '0')) {
                      e.preventDefault()
                    }
                  }}
                  className="h-9 w-28"
                />
                <span className="text-xs text-muted-foreground">
                  Tasarımcı bittikçe sayfa ekleyip ilerlemeyi günceller.
                </span>
              </div>
            )}

            {subtasks.sticker && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <Label htmlFor="np-stickers" className="text-sm">
                  Toplam sticker adedi
                </Label>
                <Input
                  id="np-stickers"
                  type="number"
                  min="1"
                  step="1"
                  value={stickerCount}
                  onChange={(e) => setStickerCount(clampPositiveInt(e.target.value))}
                  onBlur={(e) => setStickerCount(clampPositiveInt(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === '-' || e.key === 'e' || e.key === 'E' || e.key === '+') {
                      e.preventDefault()
                      return
                    }
                    if (e.key === '0' && (e.currentTarget.value === '' || e.currentTarget.value === '0')) {
                      e.preventDefault()
                    }
                  }}
                  className="h-9 w-28"
                />
                <span className="text-xs text-muted-foreground">
                  Tasarımcı bittikçe sticker ekleyip ilerlemeyi günceller.
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Kaydediliyor…' : isEdit ? 'Kaydet' : 'Proje Oluştur'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
