import { useEffect, useLayoutEffect, useRef, useState, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlignCenter, AlignLeft, AlignRight, ArrowLeft, Bold, CalendarDays, ChevronDown, ChevronLeft,
  ExternalLink, Highlighter, ImagePlus, Italic, List, ListOrdered, ListTodo,
  Pencil, Plus, Strikethrough, Target, Trash2, Underline, X,
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
import { LinksListInput } from '@/components/LinksListInput'
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DIALOG_MOBILE_SHEET,
} from '@/components/ui/dialog'
import ConfirmDialog from '@/components/ConfirmDialog'
import DateWithBoldMonth from '@/components/DateWithBoldMonth'
import ImageAdjustDialog from '@/components/ImageAdjustDialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn, formatDateTr } from '@/lib/utils'
import {
  NOTE_BODY_MAX, NOTE_HIGHLIGHT_COLORS, NOTE_HIGHLIGHT_DEFAULT, NOTE_TITLE_MAX, NOTE_UL_STYLES,
  bodyToEditorHtml, escapeHtml, htmlToText, isEmptyNoteBody, isEmptyNoteTitle,
  normalizeHighlightHex, noteUlClassName, sanitizeNoteHtml, sanitizeNoteTitleHtml,
  selectionBulletStyle, selectionIn, selectionInChecklist, selectionMarkColor,
  stripNoteImageOrigin, withNoteImageOrigin,
} from '@/lib/note-format'

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

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editLinks, setEditLinks] = useState([])
  const [savingIdea, setSavingIdea] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)
  const [previewSrc, setPreviewSrc] = useState(null)
  const [adjustFile, setAdjustFile] = useState(null)
  const adjustDone = useRef(null)
  const coverInputRef = useRef(null)
  const galleryInputRef = useRef(null)

  useEffect(() => {
    if (!idea) return
    setEditing(false)
    setEditName(idea.name ?? '')
    setEditLinks(idea.links?.length ? idea.links : [])
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

  function prepareImage(file) {
    return new Promise((resolve) => {
      adjustDone.current = resolve
      setAdjustFile(file)
    })
  }

  function finishAdjust(result) {
    adjustDone.current?.(result)
    adjustDone.current = null
    setAdjustFile(null)
  }

  async function handleSaveNote(e, text, noteId) {
    e?.preventDefault?.()
    const trimmed = (text ?? '').trim()
    if (!trimmed || !noteId) return
    try {
      await updateNote(noteId, trimmed)
    } catch (err) {
      toast.error(err?.message || 'Not güncellenemedi.')
    }
  }

  async function handlePickGalleryImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const prepared = await prepareImage(file)
    if (!prepared?.file) return
    try {
      await addGalleryImage(prepared.file)
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
    const prepared = await prepareImage(file)
    if (!prepared?.file) return
    setCoverBusy(true)
    try {
      await uploadImage(idea.id, prepared.file)
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

  async function handleAddNote(e, text) {
    e?.preventDefault?.()
    const trimmed = (text ?? '').trim()
    if (!trimmed) return null
    try {
      return await addNote(trimmed)
    } catch (err) {
      toast.error(err?.message || 'Not eklenemedi.')
      return null
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
    <div className="flex w-full flex-col gap-4">
      {loading && !idea ? (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <Skeleton className="min-h-[28rem] rounded-2xl" />
          <Skeleton className="min-h-[28rem] rounded-2xl" />
        </div>
      ) : notFound ? (
        <div className="grid flex-1 place-items-center gap-3 rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center">
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
          <header className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => navigate('/hedef-projeler')}
              aria-label="Hedef Projelere Dönün"
              title="Hedef Projelere Dönün"
              className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-[0.97]"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                {idea.name}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {idea.created_by_name ?? 'Ekipten biri'} · <DateWithBoldMonth iso={idea.created_at} />
              </p>
            </div>
            {effectiveCanModify && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Düzenleyin"
                title="Düzenleyin"
                className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground active:scale-[0.97]"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </header>

          <div className="grid min-h-0 flex-1 gap-x-5 gap-y-3 md:grid-cols-[minmax(0,1.4fr)_minmax(16rem,22rem)] md:grid-rows-[auto_auto] md:items-start md:gap-x-6 md:gap-y-3">
            {editing ? (
              <form
                onSubmit={handleSaveIdea}
                className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm md:col-span-2"
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
            ) : (
              <CoverPanel
                idea={idea}
                canModify={effectiveCanModify}
                coverBusy={coverBusy}
                coverInputRef={coverInputRef}
                onPickCover={handlePickCoverImage}
                onRemoveCover={handleRemoveCoverImage}
                onPreview={setPreviewSrc}
              />
            )}

            {!editing && (
              <aside className="w-full md:col-start-2 md:row-start-1 md:row-span-2 md:sticky md:top-4">
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold tracking-tight">Bağlantılar</h2>
                  <LinkChips links={idea.links} />
                  <GalleryPanel
                    detail={detail}
                    detailLoading={detailLoading}
                    canModify={effectiveCanModify}
                    busy={detailBusy || busy}
                    galleryInputRef={galleryInputRef}
                    onPickGallery={handlePickGalleryImage}
                    onRemoveGallery={handleRemoveGalleryImage}
                    onPreview={setPreviewSrc}
                  />
                </div>
              </aside>
            )}

            {!editing && (
              <div className="min-w-0 md:col-start-1 md:row-start-2">
                <NotesSection
                  canAdd={effectiveCanModify}
                  detail={detail}
                  loading={detailLoading}
                  onSaveNote={handleSaveNote}
                  onAddNote={handleAddNote}
                  onRemoveNote={handleRemoveNote}
                  canModifyNote={canModifyNote}
                  onUploadImage={addGalleryImage}
                  onPrepareImage={prepareImage}
                />
              </div>
            )}
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
      <ImageAdjustDialog
        file={adjustFile}
        open={!!adjustFile}
        onOpenChange={(next) => { if (!next) finishAdjust(null) }}
        onConfirm={(file, meta) => finishAdjust({ file, widthPx: meta?.widthPx })}
      />
    </div>
  )
}

function CoverPanel({
  idea, canModify, coverBusy, coverInputRef, onPickCover, onRemoveCover, onPreview,
}) {
  const coverSrc = ideaImageSrc(idea)

  return (
    <div className="group/cover relative overflow-hidden rounded-2xl bg-muted/30 ring-1 ring-border/50">
      {coverSrc ? (
        <button
          type="button"
          onClick={() => onPreview(coverSrc)}
          className="block w-full p-2 transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.995] sm:p-3"
          aria-label="Görseli büyütün"
        >
          <img
            src={coverSrc}
            alt=""
            className="mx-auto max-h-[min(22rem,42vh)] w-auto max-w-full rounded-xl object-contain"
          />
        </button>
      ) : canModify ? (
        <button
          type="button"
          onClick={() => coverInputRef.current?.click()}
          disabled={coverBusy}
          className="flex min-h-52 w-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
        >
          <ImagePlus className="h-5 w-5" />
          Kapak görseli ekleyin
        </button>
      ) : (
        <div className="grid h-full min-h-64 w-full place-items-center text-primary/25">
          <Target className="h-10 w-10" />
        </div>
      )}
      {canModify && coverSrc && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          <IconBtn
            label="Görseli değiştirin"
            onClick={() => coverInputRef.current?.click()}
            disabled={coverBusy}
            className="opacity-100 md:opacity-0 md:group-hover/cover:opacity-100"
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn
            label="Görseli kaldırın"
            onClick={onRemoveCover}
            disabled={coverBusy}
            danger
            className="opacity-100 md:opacity-0 md:group-hover/cover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      )}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickCover}
      />
    </div>
  )
}

function GalleryPanel({
  detail, detailLoading, canModify, busy, galleryInputRef, onPickGallery, onRemoveGallery, onPreview,
}) {
  const gallery = detail?.images ?? []

  return (
    <div className="grid shrink-0 grid-cols-2 gap-2">
      {detailLoading ? (
        [0, 1].map((i) => (
          <Skeleton key={i} className="aspect-square rounded-xl" />
        ))
      ) : (
        <>
          {gallery.map((img) => {
            const src = `${API_ORIGIN}${img.image_url}`
            return (
              <div
                key={img.id}
                className="group/gal relative aspect-square min-w-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border/50"
              >
                <button
                  type="button"
                  onClick={() => onPreview(src)}
                  className="block h-full w-full active:scale-[0.98]"
                  aria-label="Görseli büyütün"
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
                {canModify && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemoveGallery(img.id) }}
                    aria-label="Görseli kaldırın"
                    className="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full bg-background/90 text-muted-foreground ring-1 ring-border transition-colors hover:text-destructive md:opacity-0 md:group-hover/gal:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )
          })}
          {canModify && (
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              disabled={busy}
              className="col-span-2 grid min-h-[7.5rem] place-items-center rounded-xl border border-dashed text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
            >
              <ImagePlus className="h-4 w-4" />
              <span className="sr-only">Galeriye görsel ekleyin</span>
            </button>
          )}
        </>
      )}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickGallery}
      />
    </div>
  )
}

function LinkChips({ links }) {
  const list = (links ?? []).filter(Boolean)
  if (!list.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((link, i) => (
        // eslint-disable-next-line react/no-array-index-key -- bağlantılar sırasız, kimliksiz bir düz string listesi
        <a
          key={i}
          href={normalizeHref(link)}
          target="_blank"
          rel="noopener noreferrer"
          title={link}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-border/70 transition-colors hover:text-primary active:scale-[0.98]"
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{linkHost(link)}</span>
        </a>
      ))}
    </div>
  )
}

const STICKY_TONES = [
  {
    card: 'bg-[#B8E8F6]',
    fold: 'border-t-[#5FBFDE]',
    pinCircle: false,
  },
  {
    card: 'bg-[#C3F2C7]',
    fold: 'border-t-[#4DCC62]',
    pinCircle: false,
  },
  {
    card: 'bg-[#FFE39A]',
    fold: 'border-t-[#E8C04A]',
    pinCircle: true,
  },
  {
    card: 'bg-[#FFB6AE]',
    fold: 'border-t-[#F07870]',
    pinCircle: false,
  },
]

function encodeNote(title, body) {
  const t = isEmptyNoteTitle(title) ? '' : sanitizeNoteTitleHtml(title)
  const b = isEmptyNoteBody(body) ? '' : String(body ?? '').trim()
  if (t && b) return `${t}\n\n${b}`
  return t || b
}

function decodeNote(raw) {
  const text = (raw ?? '').trim()
  if (!text) return { title: '', body: '' }
  const blank = text.split(/\n\n+/)
  if (blank.length >= 2) return { title: blank[0], body: blank.slice(1).join('\n\n') }
  const nl = text.indexOf('\n')
  if (nl > 0) return { title: text.slice(0, nl).trim(), body: text.slice(nl + 1).trim() }
  if (/^<(p|div|ul|ol|h[23]|blockquote)\b/i.test(text)) return { title: '', body: text }
  const sentence = text.match(/^(.{1,80}?[.!?])\s+(.+)$/s)
  if (sentence) return { title: sentence[1], body: sentence[2] }
  return { title: text, body: '' }
}

const FORMAT_CMDS = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikeThrough',
  ul: 'insertUnorderedList',
  ol: 'insertOrderedList',
  left: 'justifyLeft',
  center: 'justifyCenter',
  right: 'justifyRight',
}

function closestFromSelection(selector) {
  const sel = document.getSelection()
  const node = sel?.anchorNode
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  return el?.closest?.(selector) ?? null
}

function readFormatState(editor) {
  const empty = {
    bold: false, italic: false, underline: false, strike: false,
    highlight: false, highlightHex: null, ul: false, ol: false, check: false,
    ulStyle: null, ulMarkColor: null, align: 'left',
  }
  if (!editor || typeof document.queryCommandState !== 'function' || !selectionIn(editor)) {
    return empty
  }
  const { highlight, highlightHex } = selectionHighlightInfo(editor)
  return {
    bold: document.queryCommandState(FORMAT_CMDS.bold),
    italic: document.queryCommandState(FORMAT_CMDS.italic),
    underline: document.queryCommandState(FORMAT_CMDS.underline),
    strike: document.queryCommandState(FORMAT_CMDS.strike),
    highlight,
    highlightHex,
    ul: document.queryCommandState(FORMAT_CMDS.ul),
    ol: document.queryCommandState(FORMAT_CMDS.ol),
    check: selectionInChecklist(editor),
    ulStyle: selectionBulletStyle(editor),
    ulMarkColor: selectionMarkColor(editor),
    align: document.queryCommandState(FORMAT_CMDS.center)
      ? 'center'
      : document.queryCommandState(FORMAT_CMDS.right) ? 'right' : 'left',
  }
}

function runFormat(editor, command, value = null) {
  if (!editor) return
  editor.focus()
  try { document.execCommand('styleWithCSS', false, false) } catch { /* older engines */ }
  document.execCommand(command, false, value)
}

function isHighlightElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false
  if (el.tagName === 'MARK') return true
  const bg = String(el.style?.backgroundColor || '').replace(/\s/g, '').toLowerCase()
  if (!bg || bg === 'transparent' || bg === 'rgba(0,0,0,0)') return false
  return true
}

function highlightSpanFrom(node, editor) {
  let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  while (el && editor?.contains(el) && el !== editor) {
    if (isHighlightElement(el) && highlightTextContent(el).trim()) return el
    el = el.parentElement
  }
  return null
}

function highlightHexOf(el) {
  return el ? normalizeHighlightHex(el.style?.backgroundColor) : null
}

/**
 * Whether the selection touches highlighted text at all — used to decide
 * which way the Vurgu button toggles. Same idea as Bold: if the current
 * selection is inside highlighted text, the button is pressed and the next
 * click turns it off. A range must scan for ANY intersecting highlight, not
 * just the anchor — queryCommandValue('backColor') only reflects the caret.
 */
function selectionHighlightInfo(editor) {
  const sel = document.getSelection()
  if (!editor || !sel || sel.rangeCount === 0) return { highlight: false, highlightHex: null }

  if (sel.isCollapsed) {
    const span = highlightSpanFrom(sel.anchorNode, editor)
    return { highlight: !!span, highlightHex: highlightHexOf(span) }
  }

  const range = sel.getRangeAt(0)
  let hex = null
  const highlight = [...editor.querySelectorAll('span, mark')].some((span) => {
    if (!isHighlightElement(span) || !highlightTextContent(span).trim()) return false
    if (!range.intersectsNode(span)) return false
    hex = hex ?? highlightHexOf(span)
    return true
  })
  return { highlight, highlightHex: hex }
}

function highlightTextContent(el) {
  return String(el.textContent || '').replace(/[\u00a0\u200b\ufeff]/g, ' ')
}

function unwrapHighlightSpan(span) {
  const parent = span.parentNode
  if (!parent) return
  while (span.firstChild) parent.insertBefore(span.firstChild, span)
  span.remove()
  parent.normalize()
}

function unwrapHighlightsInNode(root) {
  ;[...root.querySelectorAll?.('span, mark') || []].forEach((el) => {
    if (isHighlightElement(el)) unwrapHighlightSpan(el)
  })
}

function unwrapRedundantHighlightParents(span) {
  let parent = span.parentElement
  while (parent && isHighlightElement(parent)) {
    const extras = [...parent.childNodes].some((n) => {
      if (n === span) return false
      if (n.nodeType === Node.TEXT_NODE) return highlightTextContent(n).trim()
      return n.nodeType === Node.ELEMENT_NODE
    })
    if (extras) break
    const next = parent.parentElement
    unwrapHighlightSpan(parent)
    parent = next
  }
}

/** Wrap the selected letters in a highlight span. execCommand('hiliteColor')
 *  often paints empty edge spans instead of the words. */
function paintHighlight(editor, hex) {
  const sel = document.getSelection()
  if (!editor || !sel?.rangeCount) return
  sweepEmptyHighlights(editor)
  const range = sel.getRangeAt(0)
  trimRangeWhitespace(range)
  if (range.collapsed) return
  sel.removeAllRanges()
  sel.addRange(range)

  const contents = range.extractContents()
  unwrapHighlightsInNode(contents)
  const span = document.createElement('span')
  span.style.backgroundColor = hex
  span.appendChild(contents)
  range.insertNode(span)
  peelHighlightEdges(span)
  if (span.isConnected) unwrapRedundantHighlightParents(span)
  sweepEmptyHighlights(editor)
  editor.normalize()
  if (!span.isConnected) return
  const next = document.createRange()
  next.selectNodeContents(span)
  sel.removeAllRanges()
  sel.addRange(next)
}

function sweepEmptyHighlights(editor) {
  ;[...editor.querySelectorAll('span, mark')].forEach((el) => {
    if (!isHighlightElement(el)) return
    if (!highlightTextContent(el).trim()) unwrapHighlightSpan(el)
  })
}

function nudgeRangeStart(range) {
  const n = range.startContainer
  const o = range.startOffset
  if (n.nodeType === Node.TEXT_NODE) {
    if (o < n.length) { range.setStart(n, o + 1); return true }
    range.setStartAfter(n)
    return true
  }
  if (o < n.childNodes.length) {
    const child = n.childNodes[o]
    if (child.nodeType === Node.TEXT_NODE && child.length) {
      range.setStart(child, 1)
      return true
    }
    range.setStart(n, o + 1)
    return true
  }
  return false
}

function nudgeRangeEndBack(range) {
  const n = range.endContainer
  const o = range.endOffset
  if (n.nodeType === Node.TEXT_NODE) {
    if (o > 0) { range.setEnd(n, o - 1); return true }
    range.setEndBefore(n)
    return true
  }
  if (o > 0) {
    const child = n.childNodes[o - 1]
    if (child.nodeType === Node.TEXT_NODE && child.length) {
      range.setEnd(child, child.length - 1)
      return true
    }
    range.setEnd(n, o - 1)
    return true
  }
  return false
}

/** Don't paint the spaces on either side of a word — only the letters. */
function trimRangeWhitespace(range) {
  if (range.collapsed) return
  let guard = range.toString().length + 2
  while (!range.collapsed && guard-- && /^[\s\u00a0\u200b\ufeff]/.test(range.toString())) {
    if (!nudgeRangeStart(range)) break
  }
  guard = range.toString().length + 2
  while (!range.collapsed && guard-- && /[\s\u00a0\u200b\ufeff]$/.test(range.toString())) {
    if (!nudgeRangeEndBack(range)) break
  }
}

function peelHighlightEdges(span) {
  const parent = span.parentNode
  if (!parent) return

  const first = span.firstChild
  if (first?.nodeType === Node.TEXT_NODE) {
    const lead = first.data.match(/^[\s\u00a0\u200b\ufeff]+/)
    if (lead) {
      first.splitText(lead[0].length)
      parent.insertBefore(first, span)
    }
  }
  const last = span.lastChild
  if (last?.nodeType === Node.TEXT_NODE) {
    const trail = last.data.match(/[\s\u00a0\u200b\ufeff]+$/)
    if (trail) {
      if (trail[0].length === last.data.length) {
        parent.insertBefore(last, span.nextSibling)
      } else {
        last.splitText(last.data.length - trail[0].length)
        parent.insertBefore(last.nextSibling, span.nextSibling)
      }
    }
  }
}

/** True when `range` covers all of `el`'s text, even if the range lives
 *  inside a child text node (selectNodeContents comparison misses that). */
function rangeCoversElementText(range, el) {
  if (!el?.textContent) return true
  const elRange = document.createRange()
  elRange.selectNodeContents(el)
  const slice = range.cloneRange()
  try {
    if (slice.compareBoundaryPoints(Range.START_TO_START, elRange) < 0) {
      slice.setStart(elRange.startContainer, elRange.startOffset)
    }
    if (slice.compareBoundaryPoints(Range.END_TO_END, elRange) > 0) {
      slice.setEnd(elRange.endContainer, elRange.endOffset)
    }
  } catch {
    return false
  }
  return slice.toString() === el.textContent
}

/** Split `span` so everything from (container, offset) onward is a sibling. */
function splitHighlightSpanAt(span, container, offset) {
  if (!span.isConnected) return span
  if (container !== span && !span.contains(container)) return span

  const start = document.createRange()
  start.selectNodeContents(span)
  start.collapse(true)
  const point = document.createRange()
  try { point.setStart(container, offset) } catch { return span }
  point.collapse(true)

  if (point.compareBoundaryPoints(Range.START_TO_START, start) <= 0) return span

  const end = document.createRange()
  end.selectNodeContents(span)
  end.collapse(false)
  if (point.compareBoundaryPoints(Range.START_TO_START, end) >= 0) return null

  const rest = document.createRange()
  rest.selectNodeContents(span)
  rest.setStart(point.startContainer, point.startOffset)
  const restContents = rest.extractContents()
  if (!restContents.hasChildNodes()) return null
  const restSpan = span.cloneNode(false)
  restSpan.appendChild(restContents)
  span.after(restSpan)
  if (!span.hasChildNodes()) {
    span.remove()
    return restSpan
  }
  return restSpan
}

function unwrapHighlightIntersection(span, range) {
  if (rangeCoversElementText(range, span)) {
    unwrapHighlightSpan(span)
    return
  }

  const contents = document.createRange()
  contents.selectNodeContents(span)
  const clamp = range.cloneRange()
  try {
    if (clamp.compareBoundaryPoints(Range.START_TO_START, contents) < 0) {
      clamp.setStart(contents.startContainer, contents.startOffset)
    }
    if (clamp.compareBoundaryPoints(Range.END_TO_END, contents) > 0) {
      clamp.setEnd(contents.endContainer, contents.endOffset)
    }
  } catch {
    unwrapHighlightSpan(span)
    return
  }
  if (clamp.collapsed) return

  const endNode = clamp.endContainer
  const endOffset = clamp.endOffset
  const startNode = clamp.startContainer
  const startOffset = clamp.startOffset
  splitHighlightSpanAt(span, endNode, endOffset)
  const middle = splitHighlightSpanAt(span, startNode, startOffset)
  unwrapHighlightSpan(middle || span)
}

/**
 * Removing a highlight must only touch the selected slice, like Bold: the
 * rest of a partially-selected highlight keeps its color. A selection that
 * sits inside a highlight span still counts as covering that span's text.
 */
function unwrapHighlights(editor) {
  const sel = document.getSelection()
  if (!editor || !sel || sel.rangeCount === 0) return

  if (sel.isCollapsed) {
    const span = highlightSpanFrom(sel.anchorNode, editor)
    if (span) unwrapHighlightSpan(span)
    sweepEmptyHighlights(editor)
    return
  }

  const range = sel.getRangeAt(0)
  const spans = [...editor.querySelectorAll('span, mark')].filter((span) => {
    try { return isHighlightElement(span) && range.intersectsNode(span) } catch { return false }
  })
  for (const span of spans) {
    if (span.isConnected) unwrapHighlightIntersection(span, range)
  }
  sweepEmptyHighlights(editor)
  try {
    sel.removeAllRanges()
    sel.addRange(range)
  } catch { /* boundaries moved while splitting */ }
}

function FormatBar({ editorRef, blockEditorRef, onChange, onUploadImage, onPrepareImage, className, variant = 'compact' }) {
  const isDocument = variant === 'document'
  const fileRef = useRef(null)
  const savedRange = useRef(null)
  const highlightWrapRef = useRef(null)
  const highlightMenuRef = useRef(null)
  const [listOpen, setListOpen] = useState(false)
  const [highlightOpen, setHighlightOpen] = useState(false)
  const [highlightPos, setHighlightPos] = useState(null)
  const lastHighlightRef = useRef(NOTE_HIGHLIGHT_DEFAULT)
  const [uploading, setUploading] = useState(false)
  const [active, setActive] = useState(readFormatState(null))

  useEffect(() => {
    function sync() {
      const editor = editorRef.current
      if (!selectionIn(editor)) return
      const sel = document.getSelection()
      if (sel?.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange()
      setActive(readFormatState(editor))
    }
    document.addEventListener('selectionchange', sync)
    return () => {
      document.removeEventListener('selectionchange', sync)
    }
  }, [editorRef])

  useLayoutEffect(() => {
    if (!highlightOpen) {
      setHighlightPos(null)
      return
    }
    const el = highlightWrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setHighlightPos({ left: r.left + r.width / 2, top: r.top - 8 })
  }, [highlightOpen])

  useEffect(() => {
    if (!highlightOpen) return
    function onKey(e) {
      if (e.key === 'Escape') setHighlightOpen(false)
    }
    function onPointerDown(e) {
      if (highlightWrapRef.current?.contains(e.target)) return
      if (highlightMenuRef.current?.contains(e.target)) return
      setHighlightOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [highlightOpen])

  function emit() {
    const el = editorRef.current
    onChange?.(stripNoteImageOrigin(el?.innerHTML ?? '', API_ORIGIN))
    setActive(readFormatState(el))
  }

  function editorFor(kind = 'inline') {
    const current = editorRef.current
    const block = blockEditorRef?.current
    if (kind === 'block' && current?.dataset?.noteRole === 'title' && block) {
      block.focus()
      savedRange.current = null
      return block
    }
    return current
  }

  function apply(command, value, kind = 'inline') {
    runFormat(editorFor(kind), command, value)
    emit()
  }

  function applyHighlightColor(hex) {
    restoreSel()
    const el = editorRef.current
    if (!el) return
    el.focus()
    if (!hex) {
      unwrapHighlights(el)
    } else {
      lastHighlightRef.current = hex
      paintHighlight(el, hex)
    }
    const sel = document.getSelection()
    if (sel?.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange()
    // Keep the selection, like Bold: the button stays pressed on highlighted
    // text, and the next click toggles it off.
    emit()
    setHighlightOpen(false)
  }

  function toggleHighlight() {
    saveSel()
    restoreSel()
    const live = selectionHighlightInfo(editorRef.current)
    applyHighlightColor(live.highlight ? null : lastHighlightRef.current)
  }

  function saveSel() {
    const editor = editorRef.current
    if (!selectionIn(editor)) return
    const sel = document.getSelection()
    if (sel?.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange()
  }

  function restoreSel() {
    const el = editorRef.current
    el?.focus()
    if (!savedRange.current) return
    const sel = document.getSelection()
    sel.removeAllRanges()
    try { sel.addRange(savedRange.current) } catch { /* selection was invalidated */ }
  }

  function applyChecklist() {
    const el = editorFor('block')
    if (!el) return
    el.focus()
    if (active.check) {
      runFormat(el, FORMAT_CMDS.ul)
    } else {
      document.execCommand('insertHTML', false, '<ul class="note-check"><li>&nbsp;</li></ul>')
    }
    emit()
  }

  function paintUl(ul, style, markColor) {
    ul.removeAttribute('style')
    if (style === 'mark') {
      ul.className = 'note-ul-mark'
      ul.setAttribute('style', `--note-mark: ${markColor || NOTE_HIGHLIGHT_DEFAULT}`)
      return
    }
    const cls = noteUlClassName(style)
    if (cls) ul.className = cls
    else ul.removeAttribute('class')
  }

  function applyBullet(style, markColor) {
    const el = editorFor('block')
    if (!el) return
    el.focus()
    if (savedRange.current && el.contains(savedRange.current.commonAncestorContainer)) {
      restoreSel()
    }
    const nextMark = style === 'mark'
      ? (markColor || active.ulMarkColor || NOTE_HIGHLIGHT_DEFAULT)
      : null
    const ul = closestFromSelection('ul')
    if (ul?.classList.contains('note-check')) {
      paintUl(ul, style, nextMark)
      ul.querySelectorAll('li.checked').forEach((li) => li.removeAttribute('class'))
    } else if (ul) {
      const current = selectionBulletStyle(el)
      const same = current === style && (style !== 'mark' || active.ulMarkColor === nextMark)
      if (same) {
        document.execCommand('insertUnorderedList')
      } else {
        paintUl(ul, style, nextMark)
      }
    } else {
      document.execCommand('insertUnorderedList')
      const next = closestFromSelection('ul')
      if (next && !next.classList.contains('note-check')) paintUl(next, style, nextMark)
    }
    emit()
    setListOpen(false)
  }

  async function onPickImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !onUploadImage) return
    const prepared = onPrepareImage ? await onPrepareImage(file) : { file }
    if (!prepared?.file) return
    setUploading(true)
    try {
      const image = await onUploadImage(prepared.file)
      const src = `${API_ORIGIN}${image.image_url}`
      const width = Math.min(560, prepared.widthPx || 0)
      const widthStyle = width ? ` style="width: ${width}px"` : ''
      const el = editorFor('block')
      el?.focus()
      document.execCommand('insertHTML', false, `<img src="${src}" alt=""${widthStyle}>`)
      emit()
    } catch (err) {
      toast.error(err?.message || 'Görsel yüklenemedi.')
    } finally {
      setUploading(false)
    }
  }

  const icon = isDocument ? 'h-4 w-4' : 'h-3 w-3'
  return (
    <div
      className={cn(
        'flex w-fit items-center gap-0.5 rounded-full border border-black/10 bg-white/90 px-1 py-0.5 shadow-sm',
        isDocument && 'w-full flex-wrap justify-center gap-0.5 rounded-none border-0 bg-transparent px-0 py-0 shadow-none',
        className,
      )}
    >
      <FormatBtn document={isDocument} pressed={active.bold} label="Kalın" onClick={() => apply(FORMAT_CMDS.bold)}>
        <Bold className={icon} />
      </FormatBtn>
      <FormatBtn document={isDocument} pressed={active.italic} label="İtalik" onClick={() => apply(FORMAT_CMDS.italic)}>
        <Italic className={icon} />
      </FormatBtn>
      {isDocument && (
        <>
          <FormatBtn document pressed={active.underline} label="Altı çizili" onClick={() => apply(FORMAT_CMDS.underline)}>
            <Underline className={icon} />
          </FormatBtn>
          <FormatBtn document pressed={active.strike} label="Üstü çizili" onClick={() => apply(FORMAT_CMDS.strike)}>
            <Strikethrough className={icon} />
          </FormatBtn>
          <div className="relative" ref={highlightWrapRef}>
            <FormatBtn
              document
              pressed={active.highlight}
              label="Vurgu"
              onPointerDown={saveSel}
              onClick={toggleHighlight}
            >
              <span className="relative grid place-items-center">
                <Highlighter className={icon} />
                <span
                  className="absolute -bottom-0.5 left-1/2 h-1 w-3.5 -translate-x-1/2 rounded-full"
                  style={{ background: active.highlightHex || lastHighlightRef.current }}
                />
              </span>
            </FormatBtn>
            <button
              type="button"
              aria-label="Vurgu rengi"
              title="Vurgu rengi"
              aria-expanded={highlightOpen}
              aria-haspopup="dialog"
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={saveSel}
              onClick={() => setHighlightOpen((open) => !open)}
              className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full text-neutral-500 hover:text-neutral-900"
            >
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
            {highlightOpen && highlightPos && createPortal(
              <div
                ref={highlightMenuRef}
                role="dialog"
                aria-label="Vurgu rengi"
                className="pointer-events-auto fixed z-[80] -translate-x-1/2 -translate-y-full rounded-2xl border border-black/10 bg-[#F4F1E8] p-2 shadow-lg"
                style={{ left: highlightPos.left, top: highlightPos.top }}
              >
                <HighlightSwatches
                  value={active.highlightHex || lastHighlightRef.current}
                  onPick={applyHighlightColor}
                />
              </div>,
              document.body,
            )}
          </div>
        </>
      )}
      {isDocument && (
        <>
          <span className="mx-1 h-5 w-px bg-black/10" />
          <FormatBtn document pressed={active.align === 'left'} label="Sola hizala" onClick={() => apply(FORMAT_CMDS.left, null, 'block')}>
            <AlignLeft className={icon} />
          </FormatBtn>
          <FormatBtn document pressed={active.align === 'center'} label="Ortaya hizala" onClick={() => apply(FORMAT_CMDS.center, null, 'block')}>
            <AlignCenter className={icon} />
          </FormatBtn>
          <FormatBtn document pressed={active.align === 'right'} label="Sağa hizala" onClick={() => apply(FORMAT_CMDS.right, null, 'block')}>
            <AlignRight className={icon} />
          </FormatBtn>
        </>
      )}
      <span className={cn('mx-0.5 h-4 w-px bg-black/10', isDocument && 'mx-1 h-5 bg-black/10')} />
      <Popover
        modal={false}
        open={listOpen}
        onOpenChange={(open) => {
          if (open) saveSel()
          setListOpen(open)
        }}
      >
        <PopoverTrigger asChild>
          <FormatBtn document={isDocument} pressed={active.ul} label="Liste" onPointerDown={saveSel}>
            <span className="relative grid place-items-center">
              <List className={icon} />
              <ChevronDown className={cn(
                'absolute text-current opacity-70',
                isDocument ? '-bottom-1.5 h-2.5 w-2.5' : '-bottom-1 h-2 w-2',
              )} />
            </span>
          </FormatBtn>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          side="top"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-[80] w-[14.5rem] rounded-2xl border-black/10 bg-[#F4F1E8] p-1.5 shadow-lg"
        >
          <div className="grid grid-cols-3 gap-0.5">
            {NOTE_UL_STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyBullet(style.id)}
                aria-label={style.label}
                title={style.label}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-neutral-700 transition-colors hover:bg-white hover:text-neutral-900',
                  active.ul && active.ulStyle === style.id && 'bg-white text-neutral-900 shadow-sm',
                )}
              >
                {style.id === 'mark' ? (
                  <span
                    className="h-3 w-3.5 rounded-[0.2rem]"
                    style={{ background: active.ulMarkColor || NOTE_HIGHLIGHT_DEFAULT }}
                  />
                ) : (
                  <span className="text-lg leading-none">{style.preview}</span>
                )}
                <span className="text-[10px] font-medium tracking-wide">{style.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-1 border-t border-black/10 px-1 pt-1.5">
            <p className="mb-1.5 text-center text-[10px] font-medium text-neutral-500">Vurgu rengi</p>
            <HighlightSwatches
              value={active.ulStyle === 'mark' ? active.ulMarkColor : null}
              onPick={(hex) => applyBullet('mark', hex)}
            />
          </div>
        </PopoverContent>
      </Popover>
      {isDocument && (
        <>
          <FormatBtn document pressed={active.ol} label="Numaralı liste" onClick={() => apply(FORMAT_CMDS.ol, null, 'block')}>
            <ListOrdered className={icon} />
          </FormatBtn>
          <FormatBtn document pressed={active.check} label="Yapılacak listesi" onClick={applyChecklist}>
            <ListTodo className={icon} />
          </FormatBtn>
        </>
      )}
      {isDocument && onUploadImage && (
        <>
          <span className="mx-1 h-5 w-px bg-black/10" />
          <FormatBtn
            document
            label="Görsel ekleyin"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className={icon} />
          </FormatBtn>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickImage}
          />
        </>
      )}
    </div>
  )
}

function HighlightSwatches({ value, onPick }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {NOTE_HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color.id}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(color.hex)}
          aria-label={color.label}
          title={color.label}
          className={cn(
            'h-5 w-5 rounded-full ring-1 ring-black/15 transition-transform hover:scale-110',
            value === color.hex && 'ring-2 ring-neutral-800 ring-offset-1 ring-offset-[#F4F1E8]',
          )}
          style={{ background: color.hex }}
        />
      ))}
    </div>
  )
}

const FormatBtn = forwardRef(function FormatBtn(
  {
    label, title, onClick, children, document: isDocument, pressed, disabled, className,
    onMouseDown, onPointerDown, onDoubleClick, ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed ? 'true' : 'false'}
      title={title || label}
      {...props}
      onPointerDown={(e) => {
        onPointerDown?.(e)
      }}
      onMouseDown={(e) => {
        // Always keep the contenteditable caret — including on Vurgu / Liste.
        // Skipping this for aria-haspopup used to steal the selection, so the
        // popover applied highlight/list to nothing.
        e.preventDefault()
        onMouseDown?.(e)
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        'grid place-items-center text-neutral-500 transition-[background-color,color,box-shadow,transform] duration-150 ease-out',
        'hover:bg-white hover:text-neutral-900 hover:shadow-md hover:-translate-y-px',
        'active:scale-[0.96] active:shadow-sm disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none',
        isDocument ? 'h-10 w-10 overflow-visible rounded-xl' : 'h-7 w-7 overflow-visible rounded-full',
        pressed && 'bg-white text-neutral-900 shadow-sm',
        className,
      )}
    >
      {children}
    </button>
  )
})

function NoteTitleEditor({ initialHtml, onChange, editorRef, onFocus, onEnter }) {
  const seeded = useRef(false)

  function setRefs(node) {
    if (editorRef) editorRef.current = node
    if (!node || seeded.current) return
    node.innerHTML = sanitizeNoteTitleHtml(initialHtml || '')
    sweepEmptyHighlights(node)
    node.dataset.empty = isEmptyNoteTitle(node.innerHTML) ? 'true' : 'false'
    seeded.current = true
  }

  function emit(el) {
    const html = sanitizeNoteTitleHtml(el.innerHTML)
    el.dataset.empty = isEmptyNoteTitle(html) ? 'true' : 'false'
    onChange(isEmptyNoteTitle(html) ? '' : html)
  }

  return (
    <div
      ref={setRefs}
      role="textbox"
      aria-multiline="false"
      aria-label="Başlık"
      contentEditable
      suppressContentEditableWarning
      data-note-role="title"
      data-placeholder="Başlık"
      data-empty="true"
      className={cn(
        'note-editor w-full bg-transparent text-[28px] font-bold leading-tight tracking-tight text-[#1C1C1E] outline-none',
        '[&[data-empty=true]]:before:pointer-events-none [&[data-empty=true]]:before:text-[#C7C7CC] [&[data-empty=true]]:before:content-[attr(data-placeholder)]',
      )}
      onFocus={() => onFocus?.()}
      onPointerDown={() => onFocus?.()}
      onInput={(e) => {
        const el = e.currentTarget
        if ((el.textContent || '').length > NOTE_TITLE_MAX) {
          document.execCommand('undo')
        }
        emit(el)
      }}
      onBlur={(e) => emit(e.currentTarget)}
      onPaste={(e) => {
        e.preventDefault()
        const html = e.clipboardData.getData('text/html')
        const text = e.clipboardData.getData('text/plain')
        if (html) document.execCommand('insertHTML', false, sanitizeNoteTitleHtml(html))
        else document.execCommand('insertHTML', false, sanitizeNoteTitleHtml(escapeHtml(text)))
        emit(e.currentTarget)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onEnter?.()
          return
        }
        const mod = e.metaKey || e.ctrlKey
        if (!mod) return
        const k = e.key.toLowerCase()
        const cmd = k === 'b' ? FORMAT_CMDS.bold : k === 'i' ? FORMAT_CMDS.italic : k === 'u' ? FORMAT_CMDS.underline : null
        if (!cmd) return
        e.preventDefault()
        runFormat(e.currentTarget, cmd)
        emit(e.currentTarget)
      }}
    />
  )
}

function NoteBodyEditor({ initialHtml, onChange, editorRef, className, placeholder, onFocus }) {
  const seeded = useRef(false)
  const imgDrag = useRef(null)

  function setRefs(node) {
    if (editorRef) editorRef.current = node
    if (!node || seeded.current) return
    node.innerHTML = withNoteImageOrigin(initialHtml || '', API_ORIGIN)
    sweepEmptyHighlights(node)
    node.dataset.empty = (!node.textContent.trim() && !node.querySelector('img')) ? 'true' : 'false'
    seeded.current = true
    try { document.execCommand('defaultParagraphSeparator', false, 'p') } catch { /* ignore */ }
  }

  function emit(el) {
    el.dataset.empty = (!el.textContent.trim() && !el.querySelector('img')) ? 'true' : 'false'
    onChange(stripNoteImageOrigin(el.innerHTML, API_ORIGIN))
  }

  function selectImage(root, img) {
    root.querySelectorAll('img[data-note-selected]').forEach((el) => el.removeAttribute('data-note-selected'))
    if (img) img.setAttribute('data-note-selected', '')
  }

  return (
    <div
      ref={setRefs}
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      data-empty="true"
      className={cn(
        'note-editor mt-5 min-h-[22rem] w-full flex-1 resize-none bg-transparent text-[17px] leading-[1.55] text-[#1C1C1E] outline-none',
        '[&[data-empty=true]]:before:pointer-events-none [&[data-empty=true]]:before:text-[#C7C7CC] [&[data-empty=true]]:before:content-[attr(data-placeholder)]',
        '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-6',
        '[&_p]:my-0 [&_a]:underline [&_img]:my-3 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-xl [&_img]:object-contain',
        className,
      )}
      onFocus={() => onFocus?.()}
      onPointerDown={(e) => {
        onFocus?.()
        const img = e.target.closest?.('img')
        if (!img || !e.currentTarget.contains(img)) {
          selectImage(e.currentTarget, null)
          return
        }
        selectImage(e.currentTarget, img)
        const rect = img.getBoundingClientRect()
        const onHandle = e.clientX >= rect.right - 22 && e.clientY >= rect.bottom - 22
        if (!onHandle) return
        e.preventDefault()
        const root = e.currentTarget
        imgDrag.current = { img, startX: e.clientX, startW: rect.width, root }
        function move(ev) {
          const drag = imgDrag.current
          if (!drag) return
          const next = Math.round(Math.min(1600, Math.max(80, drag.startW + (ev.clientX - drag.startX))))
          drag.img.style.width = `${next}px`
          drag.img.style.height = 'auto'
        }
        function up() {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          if (imgDrag.current) emit(imgDrag.current.root)
          imgDrag.current = null
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      onClick={(e) => {
        const li = e.target.closest('ul.note-check li')
        if (!li || !e.currentTarget.contains(li)) return
        const box = li.getBoundingClientRect()
        if (e.clientX - box.left > 28) return
        e.preventDefault()
        li.classList.toggle('checked')
        emit(e.currentTarget)
      }}
      onInput={(e) => emit(e.currentTarget)}
      onBlur={(e) => emit(e.currentTarget)}
      onPaste={(e) => {
        e.preventDefault()
        const html = e.clipboardData.getData('text/html')
        const text = e.clipboardData.getData('text/plain')
        if (html) document.execCommand('insertHTML', false, sanitizeNoteHtml(html))
        else document.execCommand('insertText', false, text)
        emit(e.currentTarget)
      }}
      onKeyDown={(e) => {
        const mod = e.metaKey || e.ctrlKey
        if (!mod) return
        const k = e.key.toLowerCase()
        const cmd = k === 'b' ? FORMAT_CMDS.bold : k === 'i' ? FORMAT_CMDS.italic : k === 'u' ? FORMAT_CMDS.underline : null
        if (!cmd) return
        e.preventDefault()
        runFormat(e.currentTarget, cmd)
        emit(e.currentTarget)
      }}
    />
  )
}

function NoteProse({ text, className }) {
  if (!text || isEmptyNoteBody(text)) return null
  const html = bodyToEditorHtml(text)
  if (!html) return null
  return (
    <div
      className={cn(
        'text-[13px] leading-relaxed note-prose [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_img]:my-2 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:object-contain',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: withNoteImageOrigin(html, API_ORIGIN) }}
    />
  )
}

function NotesSection({
  canAdd, detail, loading,
  onSaveNote, onAddNote, onRemoveNote, canModifyNote, onUploadImage, onPrepareImage,
}) {
  const notes = detail?.notes ?? []
  const [openNote, setOpenNote] = useState(null)
  const [composing, setComposing] = useState(false)

  useEffect(() => {
    if (!openNote) return
    if (!notes.some((n) => n.id === openNote.id)) setOpenNote(null)
  }, [notes, openNote])

  const draftNoteRef = useRef({
    id: '__draft__',
    body: '',
    created_at: new Date().toISOString(),
    created_by_name: null,
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <h2 className="text-[1.35rem] font-bold tracking-tight text-neutral-900">
          Notlar
        </h2>
        {canAdd && (
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 gap-1.5 px-3 active:scale-[0.97]"
            onClick={() => { setOpenNote(null); setComposing(true) }}
          >
            <Plus className="h-3.5 w-3.5" />
            Not ekleyin
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-[15.5rem] rounded-[1.75rem]" />
          <Skeleton className="h-[15.5rem] rounded-[1.75rem]" />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {notes.map((note, index) => {
            const tone = STICKY_TONES[index % STICKY_TONES.length]
            const { title, body } = decodeNote(note.body)
            const preview = htmlToText(body)
            return (
              <li key={note.id}>
                <article
                  className={cn(
                    'group/note relative flex h-[15.5rem] flex-col overflow-hidden rounded-[1.75rem] px-5 pb-5 pt-4 text-neutral-900',
                    tone.card,
                  )}
                >
                  {tone.fold && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'pointer-events-none absolute left-0 top-0 z-[1] size-0 border-r-[26px] border-t-[26px] border-r-transparent',
                        tone.fold,
                      )}
                    />
                  )}
                  <div className="pointer-events-none relative flex shrink-0 items-center justify-between gap-2 border-b border-dashed border-white/80 pb-3">
                    <p className="inline-flex items-center gap-2 text-[13px] font-medium text-neutral-800">
                      <CalendarDays className="h-4 w-4" strokeWidth={1.75} />
                      <DateWithBoldMonth iso={note.created_at} />
                    </p>
                    <span
                      className={cn(
                        'grid h-8 w-8 place-items-center',
                        tone.pinCircle && 'rounded-full bg-white',
                      )}
                    >
                      <Pencil className="h-3.5 w-3.5 text-neutral-900" strokeWidth={1.75} />
                    </span>
                  </div>

                  <div className="pointer-events-none relative mt-4 min-h-0">
                    {!isEmptyNoteTitle(title) && (
                      <h3
                        className="note-prose line-clamp-2 text-[1.35rem] font-bold leading-snug tracking-tight text-neutral-900"
                        dangerouslySetInnerHTML={{ __html: sanitizeNoteTitleHtml(title) }}
                      />
                    )}
                    {preview ? (
                      <p className="mt-3 line-clamp-2 text-[15px] leading-[1.65] text-neutral-800">
                        {preview}
                      </p>
                    ) : /<img\b/i.test(body) ? (
                      <p className="mt-3 text-[15px] leading-[1.65] text-neutral-700/70">
                        Görsel
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setComposing(false); setOpenNote(note) }}
                    aria-label={`${htmlToText(title) || 'Notu'} açın`}
                    className="absolute inset-0 z-10 cursor-pointer"
                  />
                </article>
              </li>
            )
          })}
        </ul>
      )}

      <NoteDocumentDialog
        note={composing ? draftNoteRef.current : openNote}
        open={composing || !!openNote}
        isNew={composing}
        onOpenChange={(next) => {
          if (!next) {
            setOpenNote(null)
            setComposing(false)
          }
        }}
        canEdit={composing || (openNote ? canModifyNote(openNote) : false)}
        onSave={onSaveNote}
        onAdd={onAddNote}
        onRemove={onRemoveNote}
        onUploadImage={onUploadImage}
        onPrepareImage={onPrepareImage}
      />
    </div>
  )
}

function NoteDocumentDialog({ note, open, onOpenChange, canEdit, onSave, onAdd, onRemove, isNew, onUploadImage, onPrepareImage }) {
  const parsed = decodeNote(note?.body)
  const [title, setTitle] = useState(parsed.title)
  const [body, setBody] = useState(parsed.body)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [savedId, setSavedId] = useState(null)
  const bodyRef = useRef(null)
  const titleRef = useRef(null)
  const activeEditorRef = useRef(null)
  const skipPersistRef = useRef(false)
  const draftRef = useRef({ title: parsed.title, body: parsed.body })
  const savedIdRef = useRef(null)
  const lastWrittenRef = useRef(encodeNote(parsed.title, parsed.body))
  draftRef.current = { title, body }
  savedIdRef.current = savedId

  useEffect(() => {
    if (!open || !note) return
    const next = decodeNote(note.body)
    const htmlBody = bodyToEditorHtml(next.body)
    setTitle(next.title)
    setBody(htmlBody)
    setConfirmDelete(false)
    setSavedId(null)
    savedIdRef.current = null
    lastWrittenRef.current = encodeNote(next.title, htmlBody)
    skipPersistRef.current = false
    setSaveState('idle')
    requestAnimationFrame(() => {
      activeEditorRef.current = titleRef.current
    })
  }, [open, note])

  async function persist() {
    if (skipPersistRef.current || !canEdit) return
    let encoded = encodeNote(draftRef.current.title, sanitizeNoteHtml(draftRef.current.body) || draftRef.current.body)
    if (encoded.length > NOTE_BODY_MAX) encoded = encoded.slice(0, NOTE_BODY_MAX)
    if (!encoded || encoded === lastWrittenRef.current) return
    const existingId = isNew ? savedIdRef.current : note?.id
    setSaveState('saving')
    try {
      if (!existingId) {
        const created = await onAdd({ preventDefault() {} }, encoded)
        if (created?.id) {
          savedIdRef.current = created.id
          setSavedId(created.id)
          lastWrittenRef.current = encoded
        }
      } else {
        await onSave({ preventDefault() {} }, encoded, existingId)
        lastWrittenRef.current = encoded
      }
      setSaveState('saved')
    } catch {
      setSaveState('idle')
    }
  }

  useEffect(() => {
    if (!open || !canEdit) return
    const encoded = encodeNote(title, body)
    if (!encoded || encoded === lastWrittenRef.current) return
    const timer = setTimeout(() => { persist() }, 650)
    return () => clearTimeout(timer)
  }, [title, body, open, canEdit, isNew, note?.id])

  async function confirmRemove() {
    const id = isNew ? savedIdRef.current : note?.id
    setDeleting(true)
    skipPersistRef.current = true
    try {
      if (id && id !== '__draft__') await onRemove(id)
      setConfirmDelete(false)
      onOpenChange(false)
    } finally {
      setDeleting(false)
    }
  }

  if (!note) return null

  const noteDate = formatDateTr(note.created_at, {
    hour: '2-digit',
    minute: '2-digit',
  })
  const saveLabel = saveState === 'saving' ? 'Kaydediliyor…' : saveState === 'saved' ? 'Kaydedildi' : ''

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) persist()
          onOpenChange(next)
        }}
      >
        <DialogContent
          className={cn(
            'flex h-[min(44rem,calc(100dvh-1.5rem))] max-h-[calc(100dvh-1.5rem)] w-full max-w-[40rem] flex-col gap-0 overflow-hidden border-0 bg-[#FFFEF8] p-0 shadow-2xl sm:rounded-[1.35rem] sm:border sm:border-black/[0.06]',
            DIALOG_MOBILE_SHEET,
            'max-sm:p-0',
            '[&_[data-dialog-close]]:hidden',
          )}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            titleRef.current?.focus()
          }}
        >
          <header className="flex shrink-0 items-center gap-2 px-1.5 pb-1 pt-[max(0.35rem,var(--safe-top))] sm:px-2 sm:pt-2">
            <DialogClose
              className="inline-flex h-10 items-center gap-0.5 rounded-lg px-1.5 text-[17px] font-medium text-[#C5920B] transition-colors hover:bg-black/[0.04] active:scale-[0.98]"
            >
              <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
              Notlar
            </DialogClose>
            <p className="min-w-0 flex-1 truncate text-center text-[12px] text-[#8E8E93]">
              {saveLabel || (note.created_at
                ? <DateWithBoldMonth iso={note.created_at} options={{ hour: '2-digit', minute: '2-digit' }} />
                : '\u00a0')}
            </p>
            {canEdit ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label="Silin"
                title="Silin"
                className="grid h-10 w-10 place-items-center rounded-lg text-[#C5920B] transition-colors hover:bg-black/[0.04] active:scale-[0.97]"
              >
                <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </button>
            ) : (
              <span className="w-10" aria-hidden="true" />
            )}
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-4 sm:px-10">
            {canEdit ? (
              <>
                <DialogTitle className="sr-only">{htmlToText(title) || 'Not'}</DialogTitle>
                <NoteTitleEditor
                  key={`${note.id}-${open}-title`}
                  initialHtml={sanitizeNoteTitleHtml(decodeNote(note.body).title)}
                  onChange={setTitle}
                  editorRef={titleRef}
                  onFocus={() => {
                    activeEditorRef.current = titleRef.current
                  }}
                  onEnter={() => bodyRef.current?.focus()}
                />
              </>
            ) : isEmptyNoteTitle(title) ? (
              <DialogTitle className="pr-0 text-[28px] font-bold leading-tight tracking-tight text-[#1C1C1E]">
                Başlıksız not
              </DialogTitle>
            ) : (
              <DialogTitle
                className="note-prose pr-0 text-[28px] font-bold leading-tight tracking-tight text-[#1C1C1E]"
                aria-label={htmlToText(title)}
                dangerouslySetInnerHTML={{ __html: sanitizeNoteTitleHtml(title) }}
              />
            )}
            <DialogDescription className="sr-only">
              {noteDate}
            </DialogDescription>

            {canEdit ? (
              <NoteBodyEditor
                key={`${note.id}-${open}`}
                initialHtml={bodyToEditorHtml(decodeNote(note.body).body)}
                onChange={setBody}
                editorRef={bodyRef}
                onFocus={() => {
                  activeEditorRef.current = bodyRef.current
                }}
                placeholder="Notunuzu yazın…"
              />
            ) : (
              <NoteProse text={body} className="mt-5 text-[17px] leading-[1.55] text-[#1C1C1E]" />
            )}
          </div>

          {canEdit && (
            <footer className="relative z-10 shrink-0 border-t border-black/[0.06] px-2 py-1.5 pb-[max(0.4rem,var(--safe-bottom))]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[#F4F1E8]/90 backdrop-blur-md"
              />
              <div className="relative">
                <FormatBar
                  editorRef={activeEditorRef}
                  blockEditorRef={bodyRef}
                  onChange={(html) => {
                    const el = activeEditorRef.current
                    if (el?.dataset?.noteRole === 'title') setTitle(sanitizeNoteTitleHtml(html))
                    else setBody(html)
                  }}
                  onUploadImage={onUploadImage}
                  onPrepareImage={onPrepareImage}
                  variant="document"
                />
              </div>
            </footer>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Notu silin"
        description="Bu not silinecek. Bu işlem geri alınamaz."
        confirmLabel="Silin"
        cancelLabel="Vazgeçin"
        variant="destructive"
        busy={deleting}
        busyLabel="Siliniyor…"
        onConfirm={confirmRemove}
      />
    </>
  )
}

function IconBtn({ label, onClick, disabled, danger, className, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-8 w-8 place-items-center rounded-full bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border transition-all hover:text-foreground disabled:opacity-50',
        danger && 'hover:text-destructive',
        className,
      )}
    >
      {children}
    </button>
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

function linkHost(link) {
  try {
    return new URL(normalizeHref(link)).hostname.replace(/^www\./, '')
  } catch {
    return link
  }
}
