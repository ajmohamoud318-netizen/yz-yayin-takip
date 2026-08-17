import { useEffect, useRef, useState } from 'react'
import { Target, Trash2, Link as LinkIcon, Plus, ImagePlus, X } from 'lucide-react'
import { toast } from 'sonner'

import { API_ORIGIN } from '@/api'
import { useTargetProjectIdeas } from '@/hooks/useTargetProjectIdeas'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
 * projects yet, often just a link (and now optionally a photo) someone
 * spotted on Instagram. Designers and the team leader can add; the leader
 * (or an idea's own author) can remove, or attach/replace/remove the image.
 * See server migration 036__target_project_ideas.sql and
 * 037__target_project_idea_image.sql.
 */
export default function HedefProjeler() {
  const {
    ideas, loading, busy, add, remove, canAdd, canRemove, uploadImage, removeImage,
  } = useTargetProjectIdeas()
  const [dialogOpen, setDialogOpen] = useState(false)

  async function handleRemove(idea) {
    try {
      await remove(idea.id)
    } catch (err) {
      toast.error(err?.message || 'Silinemedi.')
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Target className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Hedef Projeler</h1>
            <p className="text-xs text-muted-foreground">
              Henüz proje olmamış fikirler.
            </p>
          </div>
        </div>
        {canAdd && (
          <Button size="sm" className="shrink-0 gap-1.5" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Ekle
          </Button>
        )}
      </header>

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : ideas.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Target className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Henüz hedef proje eklenmedi.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {ideas.map((idea) => (
            <TargetIdeaRow
              key={idea.id}
              idea={idea}
              canRemove={canRemove(idea)}
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

function TargetIdeaRow({ idea, canRemove, onRemove, onUploadImage, onRemoveImage }) {
  const [removing, setRemoving] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const fileInputRef = useRef(null)

  async function handleRemove() {
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

  async function handleRemoveImage() {
    setImageBusy(true)
    try {
      await onRemoveImage()
    } catch (err) {
      toast.error(err?.message || 'Görsel kaldırılamadı.')
    } finally {
      setImageBusy(false)
    }
  }

  const href = idea.link && (/^https?:\/\//i.test(idea.link) ? idea.link : `https://${idea.link}`)
  const imgSrc = ideaImageSrc(idea)

  return (
    <Card className={cn('transition-colors', (idea.pending || removing) && 'opacity-50')}>
      <CardContent className="flex items-start gap-3 p-4">
        {imgSrc ? (
          <a href={imgSrc} target="_blank" rel="noopener noreferrer" className="shrink-0">
            <img
              src={imgSrc}
              alt=""
              className="h-14 w-14 rounded-md object-cover ring-1 ring-border"
            />
          </a>
        ) : (
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Target className="h-6 w-6" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{idea.name}</p>
          {idea.notes && (
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{idea.notes}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <LinkIcon className="h-3 w-3" />
                Bağlantı
              </a>
            )}
            {canRemove && !idea.pending && (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
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
                  onChange={handlePickImage}
                />
              </>
            )}
          </div>

          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {idea.created_by_name ?? 'Ekipten biri'} · {formatDateTr(idea.created_at)}
          </p>
        </div>

        {canRemove && !idea.pending && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={removing}
            aria-label="Fikri sil"
            className="grid h-8 w-8 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </CardContent>
    </Card>
  )
}

function AddTargetIdeaDialog({ open, onOpenChange, onAdd, onUploadImage, busy }) {
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [link, setLink] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const fileInputRef = useRef(null)

  // Reset the form each time the dialog opens rather than on close, so the
  // fields don't visibly blank out while the closing animation is playing.
  useEffect(() => {
    if (!open) return
    setName('')
    setNotes('')
    setLink('')
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
    try {
      const saved = await onAdd({ name: trimmed, notes, link })
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
            <Label htmlFor="tpi-link">Bağlantı</Label>
            <Input
              id="tpi-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              maxLength={2000}
              placeholder="instagram.com/…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpi-notes">Not</Label>
            <Textarea
              id="tpi-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
              rows={3}
            />
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
              {busy ? 'Ekleniyor…' : 'Ekle'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
