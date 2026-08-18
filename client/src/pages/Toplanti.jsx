import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Trash2, Pencil, Plus, FolderKanban } from 'lucide-react'
import { toast } from 'sonner'

import { useMeetings } from '@/hooks/useMeetings'
import { useProjectsStore } from '@/hooks/useProjectsStore.jsx'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn, formatDateTr } from '@/lib/utils'

const NO_PROJECT = '__none__'

/** ISO string → value an `<input type="datetime-local">` accepts, in local time. */
function toDatetimeLocalValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `<input type="datetime-local">` value → ISO string for the API. */
function fromDatetimeLocalValue(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function formatMeetingAt(iso) {
  return formatDateTr(iso, { hour: '2-digit', minute: '2-digit' })
}

/**
 * Toplantılar — a shared meeting log, activated in the sidebar next to
 * Hedef Projeler. Team leader, designers and the printer can add a
 * meeting's title, date/time, optional notes and an optional linked
 * project; the leader (or a meeting's own author) can edit or remove it.
 * See server migration 040__meetings.sql.
 */
export default function Toplanti() {
  const {
    meetings, loading, busy, add, update, remove, canAdd, canModify,
  } = useMeetings()
  const { projects } = useProjectsStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingMeeting, setEditingMeeting] = useState(null)

  const projectsById = useMemo(() => {
    const map = new Map()
    projects.forEach((p) => map.set(p.id, p))
    return map
  }, [projects])

  function openAddDialog() {
    setEditingMeeting(null)
    setDialogOpen(true)
  }

  function openEditDialog(meeting) {
    setEditingMeeting(meeting)
    setDialogOpen(true)
  }

  async function handleRemove(meeting) {
    try {
      await remove(meeting.id)
    } catch (err) {
      toast.error(err?.message || 'Silinemedi.')
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <CalendarDays className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Toplantılar</h1>
            <p className="text-xs text-muted-foreground">
              Ekip toplantılarının kaydı.
            </p>
          </div>
        </div>
        {canAdd && (
          <Button size="sm" className="shrink-0 gap-1.5" onClick={openAddDialog}>
            <Plus className="h-3.5 w-3.5" />
            Ekle
          </Button>
        )}
      </header>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      ) : meetings.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <CalendarDays className="h-6 w-6" />
          </span>
          <p className="text-sm text-muted-foreground">Henüz toplantı eklenmedi.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {meetings.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              project={meeting.project_id ? projectsById.get(meeting.project_id) : null}
              canModify={canModify(meeting)}
              onEdit={() => openEditDialog(meeting)}
              onRemove={() => handleRemove(meeting)}
            />
          ))}
        </div>
      )}

      <MeetingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingMeeting={editingMeeting}
        projects={projects}
        onAdd={add}
        onUpdate={update}
        busy={busy}
      />
    </div>
  )
}

function MeetingCard({ meeting, project, canModify, onEdit, onRemove }) {
  const [removing, setRemoving] = useState(false)
  const active = canModify && !meeting.pending

  async function handleRemove() {
    setRemoving(true)
    try {
      await onRemove()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div
      className={cn(
        'group flex flex-col gap-2.5 rounded-2xl border bg-card p-4 shadow-sm transition-all duration-200',
        (meeting.pending || removing) ? 'opacity-50' : 'hover:-translate-y-px hover:border-primary/30 hover:shadow-md',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{meeting.title}</p>
        {active && (
          <div className="-mr-1.5 -mt-1 flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onEdit}
              aria-label="Toplantıyı düzenle"
              title="Toplantıyı düzenle"
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              aria-label="Toplantıyı sil"
              title="Toplantıyı sil"
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
        <CalendarDays className="h-3.5 w-3.5" />
        {formatMeetingAt(meeting.meeting_at)}
      </p>

      {meeting.notes && (
        <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{meeting.notes}</p>
      )}

      {project && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          <FolderKanban className="h-3 w-3" />
          {project.title}
        </span>
      )}

      <p className="mt-auto border-t border-dashed pt-2 text-[11px] text-muted-foreground">
        {meeting.created_by_name ?? 'Ekipten biri'} · {formatDateTr(meeting.created_at)}
      </p>
    </div>
  )
}

function MeetingDialog({
  open, onOpenChange, editingMeeting, projects, onAdd, onUpdate, busy,
}) {
  const [title, setTitle] = useState('')
  const [meetingAt, setMeetingAt] = useState('')
  const [notes, setNotes] = useState('')
  const [projectId, setProjectId] = useState(NO_PROJECT)

  const isEditing = !!editingMeeting

  // Reset/prefill each time the dialog opens rather than on close, so the
  // fields don't visibly blank out while the closing animation is playing.
  useEffect(() => {
    if (!open) return
    setTitle(editingMeeting?.title ?? '')
    setMeetingAt(toDatetimeLocalValue(editingMeeting?.meeting_at))
    setNotes(editingMeeting?.notes ?? '')
    setProjectId(editingMeeting?.project_id ?? NO_PROJECT)
  }, [open, editingMeeting])

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error('Başlık zorunludur.')
      return
    }
    const meetingAtIso = fromDatetimeLocalValue(meetingAt)
    if (!meetingAtIso) {
      toast.error('Tarih/saat zorunludur.')
      return
    }
    const resolvedProjectId = projectId === NO_PROJECT ? null : projectId
    try {
      if (isEditing) {
        await onUpdate(editingMeeting.id, {
          title: trimmed, meetingAt: meetingAtIso, notes, projectId: resolvedProjectId,
        })
        toast.success('Toplantı güncellendi.')
      } else {
        await onAdd({
          title: trimmed, meetingAt: meetingAtIso, notes, projectId: resolvedProjectId,
        })
        toast.success('Toplantı eklendi.')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err?.message || (isEditing ? 'Güncellenemedi.' : 'Eklenemedi.'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            {isEditing ? 'Toplantıyı Düzenle' : 'Toplantı Ekle'}
          </DialogTitle>
          <DialogDescription>
            Toplantı başlığı, tarihi ve varsa bağlı olduğu proje.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mtg-title">Başlık</Label>
            <Input
              id="mtg-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mtg-at">Tarih / saat</Label>
            <Input
              id="mtg-at"
              type="datetime-local"
              value={meetingAt}
              onChange={(e) => setMeetingAt(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mtg-project">Proje (opsiyonel)</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="mtg-project">
                <SelectValue placeholder="Proje seçin…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>Yok</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mtg-notes">Not</Label>
            <Textarea
              id="mtg-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Kaydediliyor…' : isEditing ? 'Kaydet' : 'Ekle'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
