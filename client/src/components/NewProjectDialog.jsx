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
  const [subtasks, setSubtasks] = useState(emptySubtasks)
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
      const map = emptySubtasks()
      let pc = 32
      for (const s of project.subtasks ?? []) {
        const key = SUBTASK_LIBRARY.find((l) => l.label === s.title)?.key
        if (key) map[key] = true
        if (s.kind === 'pages' && s.total_pages) pc = s.total_pages
      }
      setSubtasks(map)
      setPageCount(pc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function reset() {
    setTitle('')
    setType('TR')
    setAssignedIds([])
    setSubtasks(emptySubtasks())
    setPageCount(32)
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
    if (subtasks.sayfa && (!pageCount || Number(pageCount) < 1)) {
      toast.error('Lütfen toplam sayfa sayısını girin.')
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
        pageCount: subtasks.sayfa ? Number(pageCount) : undefined,
      }
      if (isEdit) {
        const updated = await api.updateProject(project.id, payload)
        updateOne(updated)
        toast.success('Proje güncellendi.')
        onUpdated?.(updated)
      } else {
        const created = await api.createProject({ ...payload, target_month: monthOffset(1) })
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
          <DialogDescription>
            {isEdit
              ? 'Proje bilgilerini, tasarımcıları ve içerikleri güncelleyin.'
              : 'Yeni bir yayın projesi başlatın ve tasarımcılara atayın.'}
          </DialogDescription>
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

          <div className="space-y-1.5 sm:max-w-[12rem]">
            <Label>Tür</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TR">{TYPE_LABELS.TR}</SelectItem>
                <SelectItem value="CIN">{TYPE_LABELS.CIN}</SelectItem>
              </SelectContent>
            </Select>
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
            <Label>Alt Görevler</Label>
            <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
              {SUBTASK_LIBRARY.map((s) => (
                <label
                  key={s.key}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-background"
                >
                  <Checkbox
                    checked={!!subtasks[s.key]}
                    onCheckedChange={(v) => setSubtasks((prev) => ({ ...prev, [s.key]: !!v }))}
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>

            {subtasks.sayfa && (
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
