import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowUpRight, CalendarDays, Trash2, Pencil, Plus, FolderKanban, ImagePlus, X,
  Link as LinkIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { API_ORIGIN } from '@/api'
import { useMeetings } from '@/hooks/useMeetings'
import { useProjectsStore } from '@/hooks/useProjectsStore.jsx'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

/** `<input type="date">` value → ISO string for the API (local midnight). */
function fromDateInputValue(value) {
  if (!value) return null
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** `image_url` is a stable path — `image_updated_at` busts the cache on re-upload. */
function meetingImageSrc(meeting) {
  if (!meeting?.image_url) return null
  const stamp = meeting.image_updated_at ? Date.parse(meeting.image_updated_at) : null
  const v = Number.isFinite(stamp) ? `?v=${stamp}` : ''
  return `${API_ORIGIN}${meeting.image_url}${v}`
}

/**
 * Toplantılar — paylaşılan toplantı kaydı. Henüz fikir/defter benzeri:
 * bir başlık, bir tarih, birkaç bağlantı, isteğe bağlı bağlı proje ve bir
 * kapak görseli; detay sayfasına girildiğinde ise ek bir foto galerisi
 * ve zaman damgalı not defteri. Lider, tasarımcılar ve matbaa ekleyebilir;
 * lider (ya da toplantıyı ekleyen kişi) detay sayfasından düzenleyebilir,
 * silebilir veya kapak/galeri görselini ekleyip değiştirebilir. İlgili
 * sunucu migration'ları: 040, 041 ve 043.
 */
export default function Toplanti() {
  const {
    meetings, loading, busy, add, remove, canAdd, canModify, uploadImage, removeImage,
  } = useMeetings()
  const { projects } = useProjectsStore()
  const [dialogOpen, setDialogOpen] = useState(false)

  const projectsById = useMemo(() => {
    const map = new Map()
    projects.forEach((p) => map.set(p.id, p))
    return map
  }, [projects])

  function openAddDialog() {
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
            Ekleyin
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
    </div>
  )
}

function MeetingCard({
  meeting, project, canModify, onRemove, onUploadImage, onRemoveImage,
}) {
  const navigate = useNavigate()
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
    <Link
      to={`/toplanti/${meeting.id}`}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-all duration-200',
        (meeting.pending || removing) ? 'opacity-50 pointer-events-none' : 'hover:-translate-y-px hover:border-primary/30 hover:shadow-md',
      )}
    >
      {imgSrc ? (
        <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted">
          <img
            src={imgSrc}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
          <span
            aria-hidden="true"
            className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-background/90 text-muted-foreground opacity-0 ring-1 ring-border transition-opacity group-hover:opacity-100"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </div>
      ) : (
        <div className="relative grid aspect-[4/3] w-full shrink-0 place-items-center bg-primary/[0.05] text-primary/30">
          <CalendarDays className="h-9 w-9" />
          <span
            aria-hidden="true"
            className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-background/90 text-muted-foreground opacity-0 ring-1 ring-border transition-opacity group-hover:opacity-100"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{meeting.title}</p>
          {active && (
            <div className="relative z-10 -mr-1.5 -mt-1 flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/toplanti/${meeting.id}`) }}
                aria-label="Toplantıyı düzenleyin"
                title="Toplantıyı düzenleyin"
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={removing}
                aria-label="Toplantıyı silin"
                title="Toplantıyı silin"
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
          <CalendarDays className="h-3.5 w-3.5" />
          {formatDateTr(meeting.meeting_at)}
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
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); fileInputRef.current?.click() }}
              disabled={imageBusy}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <ImagePlus className="h-3 w-3" />
              {imgSrc ? 'Görseli değiştirin' : 'Görsel ekleyin'}
            </button>
            {imgSrc && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemoveImage(e) }}
                disabled={imageBusy}
                className="text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                Görseli kaldırın
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
    </Link>
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
            Toplantı Ekleyin
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
                  aria-label="Görseli kaldırın"
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
              {busy ? 'Kaydediliyor…' : 'Ekleyin'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

