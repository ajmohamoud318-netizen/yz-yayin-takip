import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil } from 'lucide-react'

import api, { TYPE_LABELS, SUBTASK_LIBRARY } from '@/api'
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
import { cn, initials, monthOffset } from '@/lib/utils'

const emptySubtasks = () => SUBTASK_LIBRARY.reduce((acc, s) => ({ ...acc, [s.key]: false }), {})
const emptySubtaskAssignees = () => SUBTASK_LIBRARY.reduce((acc, s) => ({ ...acc, [s.key]: '' }), {})

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
  const [targetMonth, setTargetMonth] = useState(monthOffset(1).slice(0, 7))
  const [designers, setDesigners] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    api.listUsers().then((users) => {
      setDesigners(users.filter((u) => u.role === 'designer' && u.is_active))
    })
    if (isEdit) {
      setTitle(project.title)
      setType(project.type)
      setAssignedIds((project.assignees ?? []).map((a) => a.id))
      setTargetMonth((project.target_month ?? monthOffset(1)).slice(0, 7))
      const map = emptySubtasks()
      const assigneeMap = emptySubtaskAssignees()
      let pc = 32
      for (const s of project.subtasks ?? []) {
        const key = SUBTASK_LIBRARY.find((l) => l.label === s.title)?.key
        if (key) {
          map[key] = true
          if (s.assigned_to) assigneeMap[key] = s.assigned_to
        }
        if (s.kind === 'pages' && s.total_pages) pc = s.total_pages
        if (s.kind === 'sticker-count' && s.total_stickers) setStickerCount(s.total_stickers)
      }
      setSubtasks(map)
      setSubtaskAssignees(assigneeMap)
      setPageCount(pc)
    } else {
      setTargetMonth(monthOffset(1).slice(0, 7))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function reset() {
    setTitle('')
    setType('TR')
    setAssignedIds([])
    setTargetMonth(monthOffset(1).slice(0, 7))
    setSubtasks(emptySubtasks())
    setSubtaskAssignees(emptySubtaskAssignees())
    setPageCount(32)
    setStickerCount(1)
  }

  function toggleDesigner(id) {
    setAssignedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
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
    if (subtasks.sayfalar && (!pageCount || Number(pageCount) < 1)) {
      toast.error('Lütfen toplam sayfa sayısını girin.')
      return
    }
    if (subtasks.sticker && (!stickerCount || Number(stickerCount) < 1)) {
      toast.error('Lütfen sticker adedini girin.')
      return
    }
    setSaving(true)
    try {
      const selected = Object.entries(subtasks)
        .filter(([, v]) => v)
        .map(([k]) => k)
      const payload = {
        title: title.trim(),
        type,
        assignees: assignedIds,
        subtasks: selected,
        pageCount: subtasks.sayfalar ? Number(pageCount) : undefined,
        stickerCount: subtasks.sticker ? Number(stickerCount) : undefined,
        subtaskAssignees,
        target_month: targetMonth ? `${targetMonth}-01` : monthOffset(1),
      }
      if (isEdit) {
        const updated = await api.updateProject(project.id, payload)
        updateOne(updated)
        toast.success('Proje güncellendi.')
        onUpdated?.(updated)
      } else {
        const created = await api.createProject(payload)
        addOne(created)
        toast.success('Proje oluşturuldu.')
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
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
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
              <Label htmlFor="np-month">Hedef Tarih</Label>
              <Input
                id="np-month"
                type="month"
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
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
            <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
              {SUBTASK_LIBRARY.map((s) => {
                const isChecked = !!subtasks[s.key]
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
                    {isChecked && assignedIds.length > 1 && (
                      <Select
                        value={subtaskAssignees[s.key] || ''}
                        onValueChange={(v) =>
                          setSubtaskAssignees((prev) => ({ ...prev, [s.key]: v }))
                        }
                      >
                        <SelectTrigger className="h-7 w-36 text-xs">
                          <SelectValue placeholder="Tasarımcı seç…" />
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
                  value={pageCount}
                  onChange={(e) => setPageCount(e.target.value)}
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
                  value={stickerCount}
                  onChange={(e) => setStickerCount(e.target.value)}
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
