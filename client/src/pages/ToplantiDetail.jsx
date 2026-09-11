import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, CalendarDays, ExternalLink, FolderKanban, ImagePlus, Images,
  Link as LinkIcon, MessageSquare, Pencil, Send, X,
} from 'lucide-react'
import { toast } from 'sonner'

import api from '@/api'
import { API_ORIGIN } from '@/api'
import { useAuth } from '@/hooks/useAuth.js'
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
import { Dialog, DialogContent } from '@/components/ui/dialog'
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
 * Toplantı detayı — cover (icon-overlay buttons on hover), düzenlenebilir
 * başlık/tarih/proje/bağlantılar, foto galerisi ve zaman damgalı not
 * defteri. Liste sayfasından kart tıklanınca buraya gelinir
 * (URL: /toplanti/:id). Veriler: toplantının temel satırı `useMeetings`
 * listesinden (yoksa doğrudan `api.getMeetingDetail` ile); galeri + notlar
 * ayrıca `useMeetingDetail` ile canlı tutulur. See migration
 * 040__meetings.sql, 041__meeting_image.sql, 043__meeting_details.sql.
 */
export default function ToplantiDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const {
    meetings, loading: listLoading, busy, update, uploadImage, removeImage, canModify,
  } = useMeetings()
  const { projects } = useProjectsStore()

  const projectsById = useMemo(() => {
    const map = new Map()
    projects.forEach((p) => map.set(p.id, p))
    return map
  }, [projects])

  // Eğer liste henüz yüklenmediyse veya toplantı listede yoksa (soğuk
  // yükleme / derin link) doğrudan detay uç noktasından çekiyoruz. Bu
  // uç nokta `{ ...meeting, images, notes }` döndürüyor, dolayısıyla
  // tek başına meeting olarak da kullanılabilir.
  const [directMeeting, setDirectMeeting] = useState(null)
  const [directLoading, setDirectLoading] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (!id) return undefined
    if (meetings.find((m) => m.id === id)) {
      setDirectMeeting(null)
      return undefined
    }
    setDirectLoading(true)
    api.getMeetingDetail(id)
      .then((data) => {
        if (cancelled) return
        setDirectMeeting(data)
      })
      .catch(() => {
        /* fallback: "bulunamadı" durumunu aşağıda ele alıyoruz */
      })
      .finally(() => {
        if (!cancelled) setDirectLoading(false)
      })
    return () => { cancelled = true }
  }, [id, meetings])

  const listMeeting = id ? (meetings.find((m) => m.id === id) ?? null) : null
  const meeting = listMeeting ?? (directMeeting
    ? {
      id: directMeeting.id,
      title: directMeeting.title,
      meeting_at: directMeeting.meeting_at,
      links: directMeeting.links ?? [],
      project_id: directMeeting.project_id ?? null,
      image_url: directMeeting.image_url,
      image_updated_at: directMeeting.image_updated_at,
      created_by: directMeeting.created_by,
      created_by_name: directMeeting.created_by_name,
      created_at: directMeeting.created_at,
    }
    : null)

  const project = meeting?.project_id ? (projectsById.get(meeting.project_id) ?? null) : null

  // Liste hook'undaki `canModify` ile aynı mantık — bu sayfada list hook'u
  // bağımlılıklarından bağımsız çalışabilmek için yerel olarak hesaplıyoruz.
  const canModifyMeeting = !!user && (
    user.role === 'team_leader' || meeting?.created_by === user.id
  )

  const {
    detail, loading: detailLoading, busy: detailBusy,
    addGalleryImage, removeGalleryImage, addNote, updateNote, removeNote, canModifyNote,
  } = useMeetingDetail(id)

  const [noteText, setNoteText] = useState('')
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editMeetingAt, setEditMeetingAt] = useState('')
  const [editLinks, setEditLinks] = useState([])
  const [editProjectId, setEditProjectId] = useState(NO_PROJECT)
  const [savingMeeting, setSavingMeeting] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)
  const [previewSrc, setPreviewSrc] = useState(null)
  const coverInputRef = useRef(null)
  const galleryInputRef = useRef(null)

  useEffect(() => {
    if (!meeting) return
    setEditing(false)
    setEditTitle(meeting.title ?? '')
    setEditMeetingAt(toDateInputValue(meeting.meeting_at))
    setEditLinks(meeting.links?.length ? meeting.links : [])
    setEditProjectId(meeting.project_id ?? NO_PROJECT)
    setEditingNoteId(null)
    setNoteText('')
  }, [meeting?.id])

  async function handleSaveMeeting(e) {
    e.preventDefault()
    if (!meeting) return
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
      await update(meeting.id, {
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

  async function handlePickCoverImage(e) {
    if (!meeting) return
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setCoverBusy(true)
    try {
      await uploadImage(meeting.id, file)
    } catch (err) {
      toast.error(err?.message || 'Görsel yüklenemedi.')
    } finally {
      setCoverBusy(false)
    }
  }

  async function handleRemoveCoverImage() {
    if (!meeting) return
    setCoverBusy(true)
    try {
      await removeImage(meeting.id)
    } catch (err) {
      toast.error(err?.message || 'Görsel kaldırılamadı.')
    } finally {
      setCoverBusy(false)
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

  // Liste hook'undaki canModify hook referansıyla aynı sonucu vermek
  // için burada yeniden türetiyoruz (sayfa ilk açılışında liste henüz
  // boşken doğrudan API'den gelen toplantıyla da çalışabilsin).
  const listCanModify = meeting ? canModify(meeting) : false
  const effectiveCanModify = canModifyMeeting || listCanModify

  const loading = listLoading || directLoading
  const notFound = !loading && !meeting

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <button
          type="button"
          onClick={() => navigate('/toplanti')}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Toplantılara Dönün
        </button>
      </div>

      {loading && !meeting ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      ) : notFound ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <CalendarDays className="h-6 w-6" />
          </span>
          <p className="text-sm text-muted-foreground">Toplantı bulunamadı.</p>
          <Link
            to="/toplanti"
            className="text-sm font-medium text-primary hover:underline"
          >
            Listeye dönün
          </Link>
        </div>
      ) : (
        <>
          <header className="flex items-center justify-between gap-3">
            <div className="inline-flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <CalendarDays className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {editing ? 'Toplantıyı Düzenleyin' : meeting.title}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {editing ? 'Tarih, bağlı proje ve bağlantılar.' : formatDateTr(meeting.meeting_at)}
                </p>
              </div>
            </div>
            {effectiveCanModify && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Düzenleyin"
                title="Düzenleyin"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </header>

          <div className="space-y-5">
            <CoverSection
              meeting={meeting}
              canModify={effectiveCanModify}
              coverBusy={coverBusy}
              onPick={handlePickCoverImage}
              onRemove={handleRemoveCoverImage}
              coverInputRef={coverInputRef}
              onPreview={setPreviewSrc}
            />

            {editing ? (
              <form
                onSubmit={handleSaveMeeting}
                className="space-y-3 rounded-lg border bg-muted/30 p-3"
              >
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(false)}
                  >
                    İptal
                  </Button>
                  <Button type="submit" size="sm" disabled={savingMeeting}>
                    {savingMeeting ? 'Kaydediliyor…' : 'Kaydedin'}
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

                {(meeting.links?.length ?? 0) > 0 && (
                  <div className="space-y-1.5">
                    <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <LinkIcon className="h-3.5 w-3.5" />
                      Bağlantılar
                    </p>
                    <ul className="space-y-1">
                      {meeting.links.map((link, i) => (
                        // eslint-disable-next-line react/no-array-index-key -- bağlantılar sırasız, kimliksiz bir düz string listesi
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

            <GallerySection
              canModify={effectiveCanModify}
              detail={detail}
              loading={detailLoading}
              busy={detailBusy || busy}
              galleryInputRef={galleryInputRef}
              onPickGallery={handlePickGalleryImage}
              onRemoveGallery={handleRemoveGalleryImage}
              onPreview={setPreviewSrc}
            />

            <NotesSection
              canAdd={effectiveCanModify}
              detail={detail}
              loading={detailLoading}
              busy={detailBusy || busy}
              noteText={noteText}
              setNoteText={setNoteText}
              editingNoteId={editingNoteId}
              editingNoteText={editingNoteText}
              setEditingNoteText={setEditingNoteText}
              onStartEditNote={handleStartEditNote}
              onSaveNote={handleSaveNote}
              onAddNote={handleAddNote}
              onRemoveNote={handleRemoveNote}
              canModifyNote={canModifyNote}
              setEditingNoteId={setEditingNoteId}
            />

            <p className="border-t border-dashed pt-2 text-[11px] text-muted-foreground">
              {meeting.created_by_name ?? 'Ekipten biri'} · {formatDateTr(meeting.created_at)}
            </p>
          </div>
        </>
      )}

      <Dialog open={!!previewSrc} onOpenChange={(open) => { if (!open) setPreviewSrc(null) }}>
        <DialogContent
          className="max-w-4xl border-0 bg-transparent p-0 shadow-none sm:max-w-4xl print:hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {previewSrc && (
            <img
              src={previewSrc}
              alt=""
              className="mx-auto max-h-[85vh] w-auto rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CoverSection({
  meeting, canModify, coverBusy, onPick, onRemove, coverInputRef, onPreview,
}) {
  const coverSrc = meetingImageSrc(meeting)
  return (
    <div className="group/cover relative">
      {coverSrc ? (
        <button
          type="button"
          onClick={() => coverSrc && onPreview(coverSrc)}
          className="block w-full max-h-64 overflow-hidden rounded-xl bg-muted transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Görseli büyütün"
        >
          <img src={coverSrc} alt="" className="mx-auto max-h-64 w-full object-contain" />
        </button>
      ) : canModify ? (
        <button
          type="button"
          onClick={() => coverInputRef.current?.click()}
          disabled={coverBusy}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed bg-muted/40 px-4 py-10 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <ImagePlus className="h-4 w-4" />
          Görsel ekleyin
        </button>
      ) : null}
      {canModify && coverSrc && (
        <>
          <div className="absolute right-2 top-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              disabled={coverBusy}
              aria-label="Görseli değiştirin"
              title="Görseli değiştirin"
              className="grid h-7 w-7 place-items-center rounded-full bg-background/90 text-muted-foreground opacity-0 ring-1 ring-border transition-opacity group-hover/cover:opacity-100 focus-visible:opacity-100 hover:text-foreground disabled:opacity-50"
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={coverBusy}
              aria-label="Görseli kaldırın"
              title="Görseli kaldırın"
              className="grid h-7 w-7 place-items-center rounded-full bg-background/90 text-muted-foreground opacity-0 ring-1 ring-border transition-opacity group-hover/cover:opacity-100 focus-visible:opacity-100 hover:text-destructive disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPick}
      />
    </div>
  )
}

function GallerySection({
  canModify, detail, loading, busy, galleryInputRef, onPickGallery, onRemoveGallery, onPreview,
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Images className="h-3.5 w-3.5" />
          Galeri
        </p>
        {canModify && (
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs text-primary transition-colors hover:underline disabled:opacity-50"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            Ekleyin
          </button>
        )}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPickGallery}
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
              <div
                key={img.id}
                className="group/gal relative aspect-square overflow-hidden rounded-lg bg-muted"
              >
                <button
                  type="button"
                  onClick={() => onPreview(src)}
                  className="block h-full w-full"
                  aria-label="Görseli büyütün"
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
                {canModify && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemoveGallery(img.id) }}
                    aria-label="Görseli kaldırın"
                    className="absolute right-1 top-1 z-10 grid h-6 w-6 place-items-center rounded-full bg-background/90 text-muted-foreground opacity-0 ring-1 ring-border transition-opacity group-hover/gal:opacity-100 hover:text-destructive"
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
  )
}

function NotesSection({
  canAdd, detail, loading, busy, noteText, setNoteText,
  editingNoteId, editingNoteText, setEditingNoteText,
  onStartEditNote, onSaveNote, onAddNote, onRemoveNote, canModifyNote, setEditingNoteId,
}) {
  return (
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
            <div key={note.id} className={cn('group/note rounded-md bg-card p-2 shadow-sm')}>
              {editingNoteId === note.id ? (
                <form onSubmit={onSaveNote} className="space-y-1.5">
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
                      Kaydedin
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
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onStartEditNote(note)}
                          aria-label="Düzenleyin"
                          title="Düzenleyin"
                          className="grid h-6 w-6 place-items-center rounded-full bg-background/90 text-muted-foreground opacity-0 ring-1 ring-border transition-opacity group-hover/note:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveNote(note.id)}
                          aria-label="Silin"
                          title="Silin"
                          className="grid h-6 w-6 place-items-center rounded-full bg-background/90 text-muted-foreground opacity-0 ring-1 ring-border transition-opacity group-hover/note:opacity-100 focus-visible:opacity-100 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
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
      {canAdd && (
        <form onSubmit={onAddNote} className="flex items-start gap-2">
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value.slice(0, 2000))}
            placeholder="Not ekleyin…"
            rows={2}
            className="flex-1"
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy || !noteText.trim()}
            className="shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>
      )}
    </div>
  )
}