import { useEffect, useRef, useState } from 'react'
import {
  Target, Trash2, Pencil, Link as LinkIcon, ExternalLink, Images, MessageSquare, Send,
  Plus, ImagePlus, X,
} from 'lucide-react'
import { toast } from 'sonner'

import { API_ORIGIN } from '@/api'
import { useTargetProjectIdeas } from '@/hooks/useTargetProjectIdeas'
import { useTargetProjectIdeaDetail } from '@/hooks/useTargetProjectIdeaDetail'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LinksListInput } from '@/components/LinksListInput'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn, formatDateTr } from '@/lib/utils'

/**
 * Hedef Projeler — a shared scratchpad for book ideas that aren't real
 * projects yet: a name, any number of links (often something spotted on
 * Instagram), a cover image, and — once opened in detail — a photo
 * gallery and a timestamped notes log. Designers and the team leader can
 * add; the leader (or an idea's own author) can remove, edit, or
 * attach/replace/remove the cover image. See server migration
 * 036__target_project_ideas.sql, 037__target_project_idea_image.sql, and
 * the detail view in 042__target_project_idea_details.sql.
 */
export default function HedefProjeler() {
  const {
    ideas, loading, busy, add, update, remove, canAdd, canRemove, uploadImage, removeImage,
  } = useTargetProjectIdeas()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detailIdeaId, setDetailIdeaId] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailStartEditing, setDetailStartEditing] = useState(false)

  function openAddDialog() {
    setDialogOpen(true)
  }

  function openDetail(idea, startEditing = false) {
    setDetailIdeaId(idea.id)
    setDetailStartEditing(startEditing)
    setDetailOpen(true)
  }

  // Kept live by id rather than snapshotted at click time, so an edit saved
  // inside the detail dialog is reflected in its own title/links immediately.
  const detailIdea = detailIdeaId ? (ideas.find((i) => i.id === detailIdeaId) ?? null) : null

  async function handleRemove(idea) {
    try {
      await remove(idea.id)
    } catch (err) {
      toast.error(err?.message || 'Silinemedi.')
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Target className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Hedef Projeler</h1>
            <p className="text-xs text-muted-foreground">
              Henüz proje olmamış fikirler.
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
      ) : ideas.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Target className="h-6 w-6" />
          </span>
          <p className="text-sm text-muted-foreground">Henüz hedef proje eklenmedi.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ideas.map((idea) => (
            <TargetIdeaCard
              key={idea.id}
              idea={idea}
              canRemove={canRemove(idea)}
              onOpenDetail={() => openDetail(idea)}
              onEdit={() => openDetail(idea, true)}
              onRemove={() => handleRemove(idea)}
              onUploadImage={(file) => uploadImage(idea.id, file)}
              onRemoveImage={() => removeImage(idea.id)}
            />
          ))}
        </div>
      )}

      <AddTargetIdeaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdd={add}
        onUploadImage={uploadImage}
        busy={busy}
      />

      <IdeaDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        idea={detailIdea}
        startEditing={detailStartEditing}
        canModifyIdea={detailIdea ? canRemove(detailIdea) : false}
        canAddNote={canAdd}
        onUpdate={update}
      />
    </div>
  )
}

/** `image_url` is a stable path — `image_updated_at` busts the cache on re-upload. */
function ideaImageSrc(idea) {
  if (!idea?.image_url) return null
  const stamp = idea.image_updated_at ? Date.parse(idea.image_updated_at) : null
  const v = Number.isFinite(stamp) ? `?v=${stamp}` : ''
  return `${API_ORIGIN}${idea.image_url}${v}`
}

function normalizeHref(link) {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`
}

function TargetIdeaCard({
  idea, canRemove, onOpenDetail, onEdit, onRemove, onUploadImage, onRemoveImage,
}) {
  const [removing, setRemoving] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const fileInputRef = useRef(null)

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

  const imgSrc = ideaImageSrc(idea)
  const active = canRemove && !idea.pending
  const links = idea.links ?? []

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpenDetail() }}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-all duration-200',
        (idea.pending || removing) ? 'opacity-50' : 'hover:-translate-y-px hover:border-primary/30 hover:shadow-md',
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
          <Target className="h-9 w-9" />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{idea.name}</p>
          {active && (
            <div className="-mr-1.5 -mt-1 flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEdit() }}
                aria-label="Fikri düzenle"
                title="Fikri düzenle"
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={removing}
                aria-label="Fikri sil"
                title="Fikri sil"
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {links.length > 0 && (
          <span className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary">
            <LinkIcon className="h-3 w-3" />
            {links.length === 1 ? '1 bağlantı' : `${links.length} bağlantı`}
          </span>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
          {active && (
            <>
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
            </>
          )}
        </div>

        <p className="border-t border-dashed pt-2 text-[11px] text-muted-foreground">
          {idea.created_by_name ?? 'Ekipten biri'} · {formatDateTr(idea.created_at)}
        </p>
      </div>
    </div>
  )
}

function AddTargetIdeaDialog({
  open, onOpenChange, onAdd, onUploadImage, busy,
}) {
  const [name, setName] = useState('')
  const [links, setLinks] = useState([])
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const fileInputRef = useRef(null)

  // Reset each time the dialog opens rather than on close, so the fields
  // don't visibly blank out while the closing animation is playing.
  useEffect(() => {
    if (!open) return
    setName('')
    setLinks([])
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
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('İsim zorunludur.')
      return
    }
    const cleanLinks = links.map((l) => l.trim()).filter(Boolean)
    try {
      const saved = await onAdd({ name: trimmed, links: cleanLinks })
      if (imageFile && saved?.id) {
        try {
          await onUploadImage(saved.id, imageFile)
        } catch (err) {
          toast.error(err?.message || 'Fikir eklendi ama görsel yüklenemedi.')
        }
      }
      toast.success('Hedef proje eklendi.')
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
            <Target className="h-4 w-4" />
            Hedef Proje Ekle
          </DialogTitle>
          <DialogDescription>
            İleride proje olabilecek bir fikir.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpi-name">Proje adı</Label>
            <Input
              id="tpi-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              autoFocus
              required
            />
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
 * on the card), the name/links (editable in place here — this replaced the
 * old separate "edit" dialog), a photo gallery beyond the cover, and a
 * timestamped notes log whose own entries can each be edited or removed.
 * Gallery/notes are fetched fresh each time this opens via
 * useTargetProjectIdeaDetail, since the card grid never carries them.
 */
function IdeaDetailDialog({
  open, onOpenChange, idea, startEditing, canModifyIdea, canAddNote, onUpdate,
}) {
  const ideaId = open ? idea?.id : null
  const {
    detail, loading, busy, addGalleryImage, removeGalleryImage, addNote, updateNote, removeNote, canModifyNote,
  } = useTargetProjectIdeaDetail(ideaId)
  const [noteText, setNoteText] = useState('')
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editLinks, setEditLinks] = useState([])
  const [savingIdea, setSavingIdea] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setNoteText('')
    setEditingNoteId(null)
    setEditing(!!startEditing)
    setEditName(idea?.name ?? '')
    setEditLinks(idea?.links?.length ? idea.links : [])
  }, [open, idea?.id])

  async function handleSaveIdea(e) {
    e.preventDefault()
    const trimmed = editName.trim()
    if (!trimmed) {
      toast.error('İsim zorunludur.')
      return
    }
    setSavingIdea(true)
    try {
      await onUpdate(idea.id, { name: trimmed, links: editLinks.map((l) => l.trim()).filter(Boolean) })
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

  if (!idea) return null
  const coverSrc = ideaImageSrc(idea)
  const links = idea.links ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-2">
              <Target className="h-4 w-4 shrink-0" />
              <span className="truncate">{editing ? 'Hedef Projeyi Düzenle' : idea.name}</span>
            </span>
            {canModifyIdea && !editing && (
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
            <form onSubmit={handleSaveIdea} className="space-y-3 rounded-lg border bg-muted/30 p-3">
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
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  İptal
                </Button>
                <Button type="submit" size="sm" disabled={savingIdea}>
                  {savingIdea ? 'Kaydediliyor…' : 'Kaydet'}
                </Button>
              </div>
            </form>
          ) : links.length > 0 && (
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Images className="h-3.5 w-3.5" />
                Galeri
              </p>
              {canModifyIdea && (
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
                      {canModifyIdea && (
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
            {idea.created_by_name ?? 'Ekipten biri'} · {formatDateTr(idea.created_at)}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
