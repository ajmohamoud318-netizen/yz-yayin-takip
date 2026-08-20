import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays, Trash2, Pencil, Plus, FolderKanban, ImagePlus, X,
  Link as LinkIcon, ExternalLink, Images, MessageSquare, Send,
} from 'lucide-react'
import { toast } from 'sonner'

import { API_ORIGIN } from '@/api'
import { useMeetings } from '@/hooks/useMeetings'
import { useMeetingDetail } from '@/hooks/useMeetingDetail'
import { useProjectsStore } from '@/hooks/useProjectsStore.jsx'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LinksListInput } from '@/components/LinksListInput'
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

/** ISO string → value an `<input type="date">` accepts, in local time. */
function toDateInputValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `<input type="date">` value → ISO string for the API (local midnight). */
function fromDateInputValue(value) {
  if (!value) return null
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function formatMeetingAt(iso) {
  return formatDateTr(iso)
}

/** `image_url` is a stable path — `image_updated_at` busts the cache on re-upload. */
function meetingImageSrc(meeting) {
  if (!meeting?.image_url) return null
  const stamp = meeting.image_updated_at ? Date.parse(meeting.image_updated_at) : null
  const v = Number.isFinite(stamp) ? `?v=${stamp}` : ''
  return `${API_ORIGIN}${meeting.image_url}${v}`
}

function normalizeHref(link) {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`
}

/**
 * Toplantılar — a shared meeting log, activated in the sidebar next to
 * Hedef Projeler. Team leader, designers and the printer can add a
 * meeting's title, date, any number of links, an optional linked project,
 * and a cover photo; the leader (or a meeting's own author) can edit,
 * remove it, or attach/replace/remove the image. Opening a meeting shows
 * a photo gallery beyond the cover and a timestamped notes log. See
 * server migration 040__meetings.sql, 041__meeting_image.sql, and the
 * detail view in 043__meeting_details.sql.
 */
export default function Toplanti() {
  const {
    meetings, loading, busy, add, update, remove, canAdd, canModify, uploadImage, removeImage,
  } = useMeetings()
  const { projects } = useProjectsStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detailMeetingId, setDetailMeetingId] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailStartEditing, setDetailStartEditing] = useState(false)

  const projectsById = useMemo(() => {
    const map = new Map()
    projects.forEach((p) => map.set(p.id, p))
    return map
  }, [projects])

  function openAddDialog() {
    setDialogOpen(true)
  }

  function openDetail(meeting, startEditing = false) {
    setDetailMeetingId(meeting.id)
    setDetailStartEditing(startEditing)
    setDetailOpen(true)
  }

  // Kept live by id rather than snapshotted at click time, so an edit saved
  // inside the detail dialog is reflected in its own title/links immediately.
  const detailMeeting = detailMeetingId ? (meetings.find((m) => m.id === detailMeetingId) ?? null) : null

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
          {[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />)}
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
              onOpenDetail={() => openDetail(meeting)}
              onEdit={() => openDetail(meeting, true)}
              onRemove={() => handleRemove(meeting)}
              onUploadImage={(file) => uploadImage(meeting.id, file)}
              onRemoveImage={() => removeImage(meeting.id)}
            />
          ))}
        </div>
      )}

      <MeetingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projects={projects}
        onAdd={add}
        onUploadImage={uploadImage}
        busy={busy}
      />

      <MeetingDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        meeting={detailMeeting}
        startEditing={detailStartEditing}
        project={detailMeeting?.project_id ? projectsById.get(detailMeeting.project_id) : null}
        projects={projects}
        canModifyMeeting={detailMeeting ? canModify(detailMeeting) : false}
        canAddNote={canAdd}
        onUpdate={update}
      />
    </div>
  )
}

function MeetingCard({
  meeting, project, canModify, onOpenDetail, onEdit, onRemove, onUploadImage, onRemoveImage,
}) {
  const [removing, setRemoving] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const fileInputRef = useRef(null)
  const active = canModify && !meeting.pending
  const imgSrc = meetingImageSrc(meeting)
  const links = meeting.links ?? []

  async function handleRemove(e) {
    e.stopPropagation()
    setRemoving(true)
    try {
      await onRemove()
    } finally {
      setRemoving(false)
    }
  }

  async function handlePickImage(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again later
    if (!file) return
    setImageBusy(true)
    try {
      await onUploadImage(file)
    } catch (err) {
      toast.error(err?.message || 'Görsel yüklenemedi.')
    } finally {
      setImageBusy(false)
    }
  }

  async function handleRemoveImage(e) {
    e.stopPropagation()
    setImageBusy(true)
    try {
      await onRemoveImage()
    } catch (err) {
      toast.error(err?.message || 'Görsel kaldırılamadı.')
    } finally {
      setImageBusy(false)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpenDetail() }}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-all duration-200',
        (meeting.pending || removing) ? 'opacity-50' : 'hover:-translate-y-px hover:border-primary/30 hover:shadow-md',
      )}
    >
      {imgSrc ? (
        <div className="aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted">
          <img
            src={imgSrc}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        </div>
      ) : (
        <div className="grid aspect-[4/3] w-full shrink-0 place-items-center bg-primary/[0.05] text-primary/30">
          <CalendarDays className="h-9 w-9" />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{meeting.title}</p>
          {active && (
            <div className="-mr-1.5 -mt-1 flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEdit() }}
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

        {links.length > 0 && (
          <span className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground">
            <LinkIcon className="h-3 w-3" />
            {links.length === 1 ? '1 bağlantı' : `${links.length} bağlantı`}
          </span>
        )}

        {project && (
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            <FolderKanban className="h-3 w-3" />
            {project.title}
          </span>
        )}

        {active && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
              disabled={imageBusy}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <ImagePlus className="h-3 w-3" />
              {imgSrc ? 'Görseli değiştir' : 'Görsel ekle'}
            </button>
            {imgSrc && (
              <button
                type="button"
                onClick={handleRemoveImage}
                disabled={imageBusy}
                className="text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                Görseli kaldır
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onClick={(e) => e.stopPropagation()}
              onChange={handlePickImage}
            />
          </div>
        )}

        <p className="mt-auto border-t border-dashed pt-2 text-[11px] text-muted-foreground">
          {meeting.created_by_name ?? 'Ekipten biri'} · {formatDateTr(meeting.created_at)}
        </p>
      </div>
    </div>
  )
}

function MeetingDialog({
  open, onOpenChange, projects, onAdd, onUploadImage, busy,
}) {
  const [title, setTitle] = useState('')
  const [meetingAt, setMeetingAt] = useState('')
  const [links, setLinks] = useState([])
  const [projectId, setProjectId] = useState(NO_PROJECT)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const fileInputRef = useRef(null)

  // Reset each time the dialog opens rather than on close, so the fields
  // don't visibly blank out while the closing animation is playing.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setMeetingAt('')
    setLinks([])
    setProjectId(NO_PROJECT)
    setImageFile(null)
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [open])

  function handlePickImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImageFile(file)
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  function clearImage() {
    setImageFile(null)
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error('Başlık zorunludur.')
      return
    }
    const meetingAtIso = fromDateInputValue(meetingAt)
    if (!meetingAtIso) {
      toast.error('Tarih zorunludur.')
      return
    }
    const cleanLinks = links.map((l) => l.trim()).filter(Boolean)
    const resolvedProjectId = projectId === NO_PROJECT ? null : projectId
    try {
      const saved = await onAdd({
        title: trimmed, meetingAt: meetingAtIso, links: cleanLinks, projectId: resolvedProjectId,
      })
      if (imageFile && saved?.id) {
        try {
          await onUploadImage(saved.id, imageFile)
        } catch (err) {
          toast.error(err?.message || 'Toplantı eklendi ama görsel yüklenemedi.')
        }
      }
      toast.success('Toplantı eklendi.')
      onOpenChange(false)
    } catch (err) {
      toast.error(err?.message || 'Eklenemedi.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Toplantı Ekle
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
            <Label htmlFor="mtg-at">Tarih</Label>
            <Input
              id="mtg-at"
              type="date"
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
            <Label>Bağlantılar</Label>
            <LinksListInput links={links} onChange={setLinks} />
          </div>
          <div className="space-y-1.5">
            <Label>Görsel</Label>
            {imagePreview ? (
              <div className="relative w-fit">
                <img
                  src={imagePreview}
                  alt=""
                  className="h-24 w-24 rounded-md object-cover ring-1 ring-border"
                />
                <button
                  type="button"
                  onClick={clearImage}
                  aria-label="Görseli kaldır"
                  className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-background text-muted-foreground ring-1 ring-border transition-colors hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus className="h-3.5 w-3.5" />
                Görsel seç
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePickImage}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Kaydediliyor…' : 'Ekle'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Opened by clicking a card: the cover (view-only here — editing it stays
 * on the card), the title/date/project/links (editable in place here — this
 * replaced the old separate "edit" dialog), a photo gallery beyond the
 * cover, and a timestamped notes log whose own entries can each be edited
 * or removed. Gallery/notes are fetched fresh each time this opens via
 * useMeetingDetail, since the card grid never carries them.
 */
function MeetingDetailDialog({
  open, onOpenChange, meeting, startEditing, project, projects, canModifyMeeting, canAddNote, onUpdate,
}) {
  const meetingId = open ? meeting?.id : null
  const {
    detail, loading, busy, addGalleryImage, removeGalleryImage, addNote, updateNote, removeNote, canModifyNote,
  } = useMeetingDetail(meetingId)
  const [noteText, setNoteText] = useState('')
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editMeetingAt, setEditMeetingAt] = useState('')
  const [editLinks, setEditLinks] = useState([])
  const [editProjectId, setEditProjectId] = useState(NO_PROJECT)
  const [savingMeeting, setSavingMeeting] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setNoteText('')
    setEditingNoteId(null)
    setEditing(!!startEditing)
    setEditTitle(meeting?.title ?? '')
    setEditMeetingAt(toDateInputValue(meeting?.meeting_at))
    setEditLinks(meeting?.links?.length ? meeting.links : [])
    setEditProjectId(meeting?.project_id ?? NO_PROJECT)
  }, [open, meeting?.id])

  async function handleSaveMeeting(e) {
    e.preventDefault()
    const trimmed = editTitle.trim()
    if (!trimmed) {
      toast.error('Başlık zorunludur.')
      return
    }
    const meetingAtIso = fromDateInputValue(editMeetingAt)
    if (!meetingAtIso) {
      toast.error('Tarih zorunludur.')
      return
    }
    setSavingMeeting(true)
    try {
      await onUpdate(meeting.id, {
        title: trimmed,
        meetingAt: meetingAtIso,
        links: editLinks.map((l) => l.trim()).filter(Boolean),
        projectId: editProjectId === NO_PROJECT ? null : editProjectId,
      })
      toast.success('Toplantı güncellendi.')
      setEditing(false)
    } catch (err) {
      toast.error(err?.message || 'Güncellenemedi.')
    } finally {
      setSavingMeeting(false)
    }
  }

  function handleStartEditNote(note) {
    setEditingNoteId(note.id)
    setEditingNoteText(note.body)
  }

  async function handleSaveNote(e) {
    e.preventDefault()
    const trimmed = editingNoteText.trim()
    if (!trimmed) return
    try {
      await updateNote(editingNoteId, trimmed)
      setEditingNoteId(null)
    } catch (err) {
      toast.error(err?.message || 'Not güncellenemedi.')
    }
  }

  async function handlePickGalleryImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      await addGalleryImage(file)
    } catch (err) {
      toast.error(err?.message || 'Görsel yüklenemedi.')
    }
  }

  async function handleRemoveGalleryImage(imageId) {
    try {
      await removeGalleryImage(imageId)
    } catch (err) {
      toast.error(err?.message || 'Görsel kaldırılamadı.')
    }
  }

  async function handleAddNote(e) {
    e.preventDefault()
    const trimmed = noteText.trim()
    if (!trimmed) return
    try {
      await addNote(trimmed)
      setNoteText('')
    } catch (err) {
      toast.error(err?.message || 'Not eklenemedi.')
    }
  }

  async function handleRemoveNote(noteId) {
    try {
      await removeNote(noteId)
    } catch (err) {
      toast.error(err?.message || 'Not silinemedi.')
    }
  }

  if (!meeting) return null
  const coverSrc = meetingImageSrc(meeting)
  const links = meeting.links ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-2">
              <CalendarDays className="h-4 w-4 shrink-0" />
              <span className="truncate">{editing ? 'Toplantıyı Düzenle' : meeting.title}</span>
            </span>
            {canModifyMeeting && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Düzenle"
                title="Düzenle"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </DialogTitle>
          {!editing && <DialogDescription>{formatMeetingAt(meeting.meeting_at)}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-5">
          {coverSrc && (
            <a
              href={coverSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="block max-h-64 overflow-hidden rounded-xl bg-muted"
            >
              <img src={coverSrc} alt="" className="mx-auto max-h-64 w-full object-contain" />
            </a>
          )}

          {editing ? (
            <form onSubmit={handleSaveMeeting} className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="mtg-detail-title">Başlık</Label>
                <Input
                  id="mtg-detail-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  maxLength={200}
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mtg-detail-at">Tarih</Label>
                <Input
                  id="mtg-detail-at"
                  type="date"
                  value={editMeetingAt}
                  onChange={(e) => setEditMeetingAt(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mtg-detail-project">Proje (opsiyonel)</Label>
                <Select value={editProjectId} onValueChange={setEditProjectId}>
                  <SelectTrigger id="mtg-detail-project">
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
                <Label>Bağlantılar</Label>
                <LinksListInput links={editLinks} onChange={setEditLinks} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  İptal
                </Button>
                <Button type="submit" size="sm" disabled={savingMeeting}>
                  {savingMeeting ? 'Kaydediliyor…' : 'Kaydet'}
                </Button>
              </div>
            </form>
          ) : (
            <>
              {project && (
                <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <FolderKanban className="h-3 w-3" />
                  {project.title}
                </span>
              )}

              {links.length > 0 && (
                <div className="space-y-1.5">
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <LinkIcon className="h-3.5 w-3.5" />
                    Bağlantılar
                  </p>
                  <ul className="space-y-1">
                    {links.map((link, i) => (
                      // eslint-disable-next-line react/no-array-index-key -- links are a flat, unordered-by-id string list
                      <li key={i}>
                        <a
                          href={normalizeHref(link)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 break-all text-sm text-primary hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          {link}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Images className="h-3.5 w-3.5" />
                Galeri
              </p>
              {canModifyMeeting && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-xs text-primary transition-colors hover:underline disabled:opacity-50"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  Ekle
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePickGalleryImage}
              />
            </div>
            {loading ? (
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
              </div>
            ) : detail?.images?.length ? (
              <div className="grid grid-cols-4 gap-2">
                {detail.images.map((img) => {
                  const src = `${API_ORIGIN}${img.image_url}`
                  return (
                    <div key={img.id} className="group/gal relative aspect-square overflow-hidden rounded-lg bg-muted">
                      <a href={src} target="_blank" rel="noopener noreferrer">
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      </a>
                      {canModifyMeeting && (
                        <button
                          type="button"
                          onClick={() => handleRemoveGalleryImage(img.id)}
                          aria-label="Görseli kaldır"
                          className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-background/90 text-muted-foreground opacity-0 ring-1 ring-border transition-opacity group-hover/gal:opacity-100 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Henüz galeri görseli yok.</p>
            )}
          </div>

          <div className="space-y-2">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" />
              Notlar
            </p>
            <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border bg-muted/30 p-2">
              {loading ? (
                <Skeleton className="h-16 rounded-md" />
              ) : detail?.notes?.length ? (
                detail.notes.map((note) => (
                  <div key={note.id} className="rounded-md bg-card p-2 shadow-sm">
                    {editingNoteId === note.id ? (
                      <form onSubmit={handleSaveNote} className="space-y-1.5">
                        <Textarea
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value.slice(0, 2000))}
                          rows={2}
                          autoFocus
                          className="text-sm"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingNoteId(null)}
                            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                          >
                            İptal
                          </button>
                          <button
                            type="submit"
                            disabled={busy || !editingNoteText.trim()}
                            className="text-[11px] font-medium text-primary transition-colors hover:underline disabled:opacity-50"
                          >
                            Kaydet
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="text-[11px] text-muted-foreground">
                            {note.created_by_name ?? 'Ekipten biri'} · {formatDateTr(note.created_at)}
                          </p>
                          {canModifyNote(note) && (
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleStartEditNote(note)}
                                className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                              >
                                Düzenle
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveNote(note.id)}
                                className="text-[11px] text-muted-foreground transition-colors hover:text-destructive"
                              >
                                Sil
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))
              ) : (
                <p className="px-1 py-2 text-xs text-muted-foreground">Henüz not yok.</p>
              )}
            </div>
            {canAddNote && (
              <form onSubmit={handleAddNote} className="flex items-start gap-2">
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value.slice(0, 2000))}
                  placeholder="Not ekle…"
                  rows={2}
                  className="flex-1"
                />
                <Button type="submit" size="icon" disabled={busy || !noteText.trim()} className="shrink-0">
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </form>
            )}
          </div>

          <p className="border-t border-dashed pt-2 text-[11px] text-muted-foreground">
            {meeting.created_by_name ?? 'Ekipten biri'} · {formatDateTr(meeting.created_at)}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
