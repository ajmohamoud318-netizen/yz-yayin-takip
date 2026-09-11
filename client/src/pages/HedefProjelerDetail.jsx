import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ExternalLink, ImagePlus, Images, Link as LinkIcon, MessageSquare,
  Pencil, Send, Target, X,
} from 'lucide-react'
import { toast } from 'sonner'

import api from '@/api'
import { API_ORIGIN } from '@/api'
import { useAuth } from '@/hooks/useAuth.js'
import { useTargetProjectIdeas } from '@/hooks/useTargetProjectIdeas'
import { useTargetProjectIdeaDetail } from '@/hooks/useTargetProjectIdeaDetail'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LinksListInput } from '@/components/LinksListInput'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { formatDateTr } from '@/lib/utils'

/**
 * Hedef Proje detayı — cover (icon-overlay buttons on hover), düzenlenebilir
 * isim/bağlantılar, foto galerisi ve zaman damgalı not defteri. Liste
 * sayfasından kart tıklanınca buraya gelinir (URL: /hedef-projeler/:id).
 * Veriler: fikrin temel satırı `useTargetProjectIdeas` listesinden (yoksa
 * doğrudan `api.getTargetProjectIdeaDetail` ile); galeri + notlar ayrıca
 * `useTargetProjectIdeaDetail` ile canlı tutulur.
 */
export default function HedefProjelerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const {
    ideas, loading: listLoading, busy, update, uploadImage, removeImage, canRemove,
  } = useTargetProjectIdeas()

  // Eğer liste henüz yüklenmediyse veya fikir listede yoksa (soğuk
  // yükleme / derin link) doğrudan detay uç noktasından çekiyoruz. Bu
  // uç nokta `{ ...idea, images, notes }` döndürüyor, dolayısıyla
  // tek başına idea olarak da kullanılabilir.
  const [directIdea, setDirectIdea] = useState(null)
  const [directLoading, setDirectLoading] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (!id) return undefined
    if (ideas.find((i) => i.id === id)) {
      setDirectIdea(null)
      return undefined
    }
    setDirectLoading(true)
    api.getTargetProjectIdeaDetail(id)
      .then((data) => {
        if (cancelled) return
        setDirectIdea(data)
      })
      .catch(() => {
        /* fallback: "bulunamadı" durumunu aşağıda ele alıyoruz */
      })
      .finally(() => {
        if (!cancelled) setDirectLoading(false)
      })
    return () => { cancelled = true }
  }, [id, ideas])

  const listIdea = id ? (ideas.find((i) => i.id === id) ?? null) : null
  const idea = listIdea ?? (directIdea
    ? {
        id: directIdea.id,
        name: directIdea.name,
        links: directIdea.links ?? [],
        image_url: directIdea.image_url,
        image_updated_at: directIdea.image_updated_at,
        created_by: directIdea.created_by,
        created_by_name: directIdea.created_by_name,
        created_at: directIdea.created_at,
      }
    : null)

  // Liste hook'undaki `canRemove` ile aynı mantık — bu sayfada list hook'u
  // bağımlılıklarından bağımsız çalışabilmek için yerel olarak hesaplıyoruz.
  const canModifyIdea = !!user && (
    user.role === 'team_leader' || idea?.created_by === user.id
  )

  const {
    detail, loading: detailLoading, busy: detailBusy,
    addGalleryImage, removeGalleryImage, addNote, updateNote, removeNote, canModifyNote,
  } = useTargetProjectIdeaDetail(id)

  const [noteText, setNoteText] = useState('')
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editLinks, setEditLinks] = useState([])
  const [savingIdea, setSavingIdea] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)
  const [previewSrc, setPreviewSrc] = useState(null)
  const coverInputRef = useRef(null)
  const galleryInputRef = useRef(null)

  useEffect(() => {
    if (!idea) return
    setEditing(false)
    setEditName(idea.name ?? '')
    setEditLinks(idea.links?.length ? idea.links : [])
    setEditingNoteId(null)
    setNoteText('')
  }, [idea?.id])

  async function handleSaveIdea(e) {
    e.preventDefault()
    if (!idea) return
    const trimmed = editName.trim()
    if (!trimmed) {
      toast.error('İsim zorunludur.')
      return
    }
    setSavingIdea(true)
    try {
      await update(idea.id, {
        name: trimmed,
        links: editLinks.map((l) => l.trim()).filter(Boolean),
      })
      toast.success('Hedef proje güncellendi.')
      setEditing(false)
    } catch (err) {
      toast.error(err?.message || 'Güncellenemedi.')
    } finally {
      setSavingIdea(false)
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
    if (!idea) return
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setCoverBusy(true)
    try {
      await uploadImage(idea.id, file)
    } catch (err) {
      toast.error(err?.message || 'Görsel yüklenemedi.')
    } finally {
      setCoverBusy(false)
    }
  }

  async function handleRemoveCoverImage() {
    if (!idea) return
    setCoverBusy(true)
    try {
      await removeImage(idea.id)
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

  // Liste hook'undaki canRemove hook referansıyla aynı sonucu vermek
  // için burada yeniden türetiyoruz (sayfa ilk açılışında liste henüz
  // boşken doğrudan API'den gelen fikirle de çalışabilsin).
  const listCanRemove = idea ? canRemove(idea) : false
  const effectiveCanModify = canModifyIdea || listCanRemove

  const loading = listLoading || directLoading
  const notFound = !loading && !idea

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <button
          type="button"
          onClick={() => navigate('/hedef-projeler')}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Hedef Projelere Dönün
        </button>
      </div>

      {loading && !idea ? (
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
            <Target className="h-6 w-6" />
          </span>
          <p className="text-sm text-muted-foreground">Hedef proje bulunamadı.</p>
          <Link
            to="/hedef-projeler"
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
                <Target className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {editing ? 'Hedef Projeyi Düzenleyin' : idea.name}
                </h1>
                <p className="text-xs text-muted-foreground">
                  Henüz proje olmamış fikirler.
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
              idea={idea}
              canModify={effectiveCanModify}
              coverBusy={coverBusy}
              onPick={handlePickCoverImage}
              onRemove={handleRemoveCoverImage}
              coverInputRef={coverInputRef}
              onPreview={setPreviewSrc}
            />

            {editing ? (
              <form
                onSubmit={handleSaveIdea}
                className="space-y-3 rounded-lg border bg-muted/30 p-3"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="tpi-detail-name">Proje adı</Label>
                  <Input
                    id="tpi-detail-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={200}
                    autoFocus
                    required
                  />
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
                  <Button type="submit" size="sm" disabled={savingIdea}>
                    {savingIdea ? 'Kaydediliyor…' : 'Kaydedin'}
                  </Button>
                </div>
              </form>
            ) : (idea.links?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <LinkIcon className="h-3.5 w-3.5" />
                  Bağlantılar
                </p>
                <ul className="space-y-1">
                  {idea.links.map((link, i) => (
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
              {idea.created_by_name ?? 'Ekipten biri'} · {formatDateTr(idea.created_at)}
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
  idea, canModify, coverBusy, onPick, onRemove, coverInputRef, onPreview,
}) {
  const coverSrc = ideaImageSrc(idea)
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
            <div key={note.id} className="group/note rounded-md bg-card p-2 shadow-sm">
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

/** `image_url` kararlı bir yol — `image_updated_at` yeniden yüklemede önbelleği kırar. */
function ideaImageSrc(idea) {
  if (!idea?.image_url) return null
  const stamp = idea.image_updated_at ? Date.parse(idea.image_updated_at) : null
  const v = Number.isFinite(stamp) ? `?v=${stamp}` : ''
  return `${API_ORIGIN}${idea.image_url}${v}`
}

function normalizeHref(link) {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`
}
