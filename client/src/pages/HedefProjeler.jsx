import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight, ImagePlus, Link as LinkIcon, Plus, Target, Trash2, X,
} from 'lucide-react'
import { toast } from 'sonner'

import { API_ORIGIN } from '@/api'
import { useTargetProjectIdeas } from '@/hooks/useTargetProjectIdeas'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { LinksListInput } from '@/components/LinksListInput'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn, formatDateTr } from '@/lib/utils'

/**
 * Hedef Projeler — paylaşılan fikir defteri. Henüz projeye dönüşmemiş
 * kitap fikirleri: bir isim, birkaç bağlantı (çoğunlukla Instagram'dan
 * görülen bir şey), bir kapak görseli; detay sayfasına girildiğinde ise
 * ek bir foto galerisi ve zaman damgalı not defteri. Tasarımcılar ve
 * ekip lideri fikir ekleyebilir; lider (ya da fikri ekleyen kişi) detay
 * sayfasından silebilir, düzenleyebilir veya kapak/galeri görselini
 * ekleyip değiştirebilir. İlgili sunucu migration'ları: 036, 037 ve 042.
 */
export default function HedefProjeler() {
  const {
    ideas, loading, busy, add, remove, canAdd, canRemove, uploadImage,
  } = useTargetProjectIdeas()
  const [dialogOpen, setDialogOpen] = useState(false)

  function openAddDialog() {
    setDialogOpen(true)
  }

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
            Ekleyin
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
              onRemove={() => handleRemove(idea)}
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

/** `image_url` kararlı bir yol — `image_updated_at` yeniden yüklemede önbelleği kırar. */
function ideaImageSrc(idea) {
  if (!idea?.image_url) return null
  const stamp = idea.image_updated_at ? Date.parse(idea.image_updated_at) : null
  const v = Number.isFinite(stamp) ? `?v=${stamp}` : ''
  return `${API_ORIGIN}${idea.image_url}${v}`
}

function TargetIdeaCard({ idea, canRemove, onRemove }) {
  const [removing, setRemoving] = useState(false)

  async function handleRemove(e) {
    e.preventDefault()
    e.stopPropagation()
    setRemoving(true)
    try {
      await onRemove()
    } finally {
      setRemoving(false)
    }
  }

  const imgSrc = ideaImageSrc(idea)
  const active = canRemove && !idea.pending
  const links = idea.links ?? []

  return (
    <Link
      to={`/hedef-projeler/${idea.id}`}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-all duration-200',
        (idea.pending || removing) ? 'opacity-50 pointer-events-none' : 'hover:-translate-y-px hover:border-primary/30 hover:shadow-md',
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
          <Target className="h-9 w-9" />
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
          <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{idea.name}</p>
          {active && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              aria-label="Fikri silin"
              title="Fikri silin"
              className="relative z-10 -mr-1.5 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {links.length > 0 && (
          <span className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary">
            <LinkIcon className="h-3 w-3" />
            {links.length === 1 ? '1 bağlantı' : `${links.length} bağlantı`}
          </span>
        )}

        <p className="mt-auto border-t border-dashed pt-2 text-[11px] text-muted-foreground">
          {idea.created_by_name ?? 'Ekipten biri'} · {formatDateTr(idea.created_at)}
        </p>
      </div>
    </Link>
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
            Hedef Proje Ekleyin
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
              {busy ? 'Kaydediliyor…' : 'Ekleyin'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
