const BLOCK_TAGS = /<\/?(p|div|ul|ol|li|strong|em|u|b|i|br|span|img|s|strike|mark|h2|h3|blockquote)\b/i
const ALLOWED = new Set([
  'P', 'BR', 'DIV', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI',
  'IMG', 'S', 'STRIKE', 'MARK', 'H2', 'H3', 'BLOCKQUOTE',
])
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'VIDEO', 'AUDIO', 'SOURCE'])

/** API note body cap (see targetProjectIdeaNoteCreate). */
export const NOTE_BODY_MAX = 20000
/** Plain-text cap for the note title (HTML wrappers do not count). */
export const NOTE_TITLE_MAX = 200

const NOTE_IMAGE_PATH = /^\/api\/target-project-ideas\/[^/]+\/images\/[^/?#]+$/i

export function looksLikeHtml(value) {
  return BLOCK_TAGS.test(value ?? '')
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function isSafeNoteImageSrc(src) {
  if (!src) return false
  const path = String(src).replace(/^https?:\/\/[^/]+/i, '').split('?')[0]
  return NOTE_IMAGE_PATH.test(path)
}

export function toRelativeNoteImageSrc(src) {
  return String(src).replace(/^https?:\/\/[^/]+/i, '').split('?')[0]
}

export function withNoteImageOrigin(html, origin) {
  if (!html || !origin) return html ?? ''
  return String(html).replace(/(src=")(\/api\/target-project-ideas\/)/gi, `$1${origin}$2`)
}

export function stripNoteImageOrigin(html, origin) {
  if (!html || !origin) return html ?? ''
  return String(html).replaceAll(origin, '')
}

function inlineMarkdown(text) {
  let s = escapeHtml(text)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<u>$1</u>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return s
}

/** Turn stored markdown (or HTML) into editor/card HTML. */
export function markdownToHtml(text) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n')
  if (!raw.trim()) return ''
  if (looksLikeHtml(raw)) return sanitizeNoteHtml(raw)

  const lines = raw.split('\n')
  const out = []
  let ul = []
  let ol = []
  const flush = () => {
    if (ul.length) {
      out.push(`<ul>${ul.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`)
      ul = []
    }
    if (ol.length) {
      out.push(`<ol>${ol.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</ol>`)
      ol = []
    }
  }
  for (const line of lines) {
    const bullet = line.match(/^\s*[-•*]\s+(.+)$/)
    if (bullet) {
      if (ol.length) flush()
      ul.push(bullet[1])
      continue
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (numbered) {
      if (ul.length) flush()
      ol.push(numbered[1])
      continue
    }
    flush()
    if (!line.trim()) continue
    out.push(`<p>${inlineMarkdown(line)}</p>`)
  }
  flush()
  return out.join('')
}

export const NOTE_HIGHLIGHT_COLORS = [
  { id: 'yellow', label: 'Sarı', hex: '#FFE58F' },
  { id: 'green', label: 'Yeşil', hex: '#BBF7D0' },
  { id: 'pink', label: 'Pembe', hex: '#FECDD3' },
  { id: 'blue', label: 'Mavi', hex: '#BFDBFE' },
  { id: 'orange', label: 'Turuncu', hex: '#FED7AA' },
  { id: 'purple', label: 'Mor', hex: '#E9D5FF' },
]

export const NOTE_HIGHLIGHT_DEFAULT = NOTE_HIGHLIGHT_COLORS[0].hex

const NOTE_HIGHLIGHT_HEX = new Map(
  NOTE_HIGHLIGHT_COLORS.map((c) => [c.hex.toLowerCase(), c.hex]),
)

export function normalizeHighlightHex(value) {
  const raw = String(value || '').replace(/\s/g, '').toLowerCase()
  if (!raw || raw === 'transparent' || raw === 'rgba(0,0,0,0)') return null
  let hex = ''
  const rgb = raw.match(/^rgba?\((\d+),(\d+),(\d+)/)
  if (rgb) {
    hex = `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
  } else if (/^#[0-9a-f]{6}$/.test(raw)) {
    hex = raw
  } else if (/^#[0-9a-f]{3}$/.test(raw)) {
    hex = `#${[...raw.slice(1)].map((ch) => ch + ch).join('')}`
  }
  return NOTE_HIGHLIGHT_HEX.get(hex) ?? null
}

export const NOTE_UL_STYLES = [
  { id: 'disc', label: 'Nokta', preview: '•' },
  { id: 'circle', label: 'Halka', preview: '○' },
  { id: 'square', label: 'Kare', preview: '■' },
  { id: 'dash', label: 'Tire', preview: '–' },
  { id: 'arrow', label: 'Ok', preview: '→' },
  { id: 'diamond', label: 'Elmas', preview: '◆' },
  { id: 'mark', label: 'Vurgu', preview: '▮' },
]

const NOTE_UL_STYLE_IDS = new Set(NOTE_UL_STYLES.map((s) => s.id))
const NOTE_UL_CLASS_RE = /\bnote-(?:check|ul-(?:disc|circle|square|dash|arrow|diamond|mark))\b/

export function noteUlClassName(styleId) {
  if (!styleId || styleId === 'disc' || !NOTE_UL_STYLE_IDS.has(styleId)) return ''
  return `note-ul-${styleId}`
}

export function noteUlStyleId(className) {
  const m = String(className || '').match(/\bnote-ul-(disc|circle|square|dash|arrow|diamond|mark)\b/)
  return m ? m[1] : 'disc'
}

function selectionListEl(editor) {
  if (!selectionIn(editor)) return null
  const sel = document.getSelection()
  const node = sel.anchorNode
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  const ul = el?.closest?.('ul')
  if (!ul || ul.classList.contains('note-check')) return null
  return ul
}

export function selectionBulletStyle(editor) {
  const ul = selectionListEl(editor)
  return ul ? noteUlStyleId(ul.getAttribute('class')) : null
}

export function selectionMarkColor(editor) {
  const ul = selectionListEl(editor)
  if (!ul?.classList.contains('note-ul-mark')) return null
  return normalizeHighlightHex(ul.style.getPropertyValue('--note-mark')) || NOTE_HIGHLIGHT_DEFAULT
}

const NOTE_IMG_WIDTH_MIN = 80
const NOTE_IMG_WIDTH_MAX = 1600

function readImgWidthPx(el) {
  const style = el.getAttribute('style') || ''
  const fromStyle = style.match(/(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px/i)
  const fromAttr = el.getAttribute('width')
  const raw = fromStyle ? Number(fromStyle[1]) : parseInt(fromAttr, 10)
  if (!Number.isFinite(raw)) return null
  const n = Math.round(raw)
  if (n < NOTE_IMG_WIDTH_MIN || n > NOTE_IMG_WIDTH_MAX) return null
  return n
}

function sanitizeStyle(style) {
  if (!style) return ''
  const parts = []
  const align = String(style).match(/text-align\s*:\s*(left|center|right)/i)
  if (align) parts.push(`text-align: ${align[1].toLowerCase()}`)
  const bg = String(style).match(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\)|transparent)/i)
  if (bg) parts.push(`background-color: ${bg[1]}`)
  const mark = String(style).match(/--note-mark\s*:\s*(#[0-9a-f]{3,8})/i)
  const markHex = mark ? normalizeHighlightHex(mark[1]) : null
  if (markHex) parts.push(`--note-mark: ${markHex}`)
  return parts.join('; ')
}

export function sanitizeNoteHtml(html) {
  if (!html) return ''
  if (typeof DOMParser === 'undefined') return String(html)
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return ''
  cleanNode(root)
  return root.innerHTML
}

const TITLE_UNWRAP = new Set(['P', 'DIV', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL', 'LI'])

function flattenTitleNode(node) {
  ;[...node.childNodes].forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE) return
    flattenTitleNode(child)
    if (child.tagName === 'IMG' || child.tagName === 'BR') {
      child.replaceWith(node.ownerDocument.createTextNode(child.tagName === 'BR' ? ' ' : ''))
      return
    }
    if (!TITLE_UNWRAP.has(child.tagName)) return
    const parent = child.parentNode
    while (child.firstChild) parent.insertBefore(child.firstChild, child)
    child.remove()
  })
}

function truncateHtmlByText(html, max) {
  if (typeof DOMParser === 'undefined') return htmlToText(html).slice(0, max)
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return ''
  let count = 0
  function walk(node) {
    ;[...node.childNodes].forEach((child) => {
      if (count >= max) {
        child.remove()
        return
      }
      if (child.nodeType === Node.TEXT_NODE) {
        const left = max - count
        if (child.nodeValue.length > left) child.nodeValue = child.nodeValue.slice(0, left)
        count += child.nodeValue.length
        return
      }
      if (child.nodeType === Node.ELEMENT_NODE) walk(child)
    })
  }
  walk(root)
  return root.innerHTML
}

/** Inline-only HTML for the note title — no lists, images, or paragraphs. */
export function sanitizeNoteTitleHtml(html) {
  const cleaned = sanitizeNoteHtml(html)
  if (!cleaned) return ''
  if (typeof DOMParser === 'undefined') return cleaned
  const doc = new DOMParser().parseFromString(`<div>${cleaned}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return ''
  flattenTitleNode(root)
  let out = root.innerHTML.replace(/&nbsp;/gi, ' ').trim()
  if (htmlToText(out).length > NOTE_TITLE_MAX) out = truncateHtmlByText(out, NOTE_TITLE_MAX)
  return out
}

export function isEmptyNoteTitle(html) {
  return !htmlToText(html).trim()
}

function cleanNode(node) {
  ;[...node.childNodes].forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) return
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove()
      return
    }
    if (DROP.has(child.tagName)) {
      child.remove()
      return
    }
    if (child.tagName === 'IMG') {
      const src = child.getAttribute('src') || ''
      if (!isSafeNoteImageSrc(src)) {
        child.remove()
        return
      }
      const path = toRelativeNoteImageSrc(src)
      const width = readImgWidthPx(child)
      while (child.attributes.length) child.removeAttribute(child.attributes[0].name)
      child.setAttribute('src', path)
      child.setAttribute('alt', '')
      if (width) child.setAttribute('style', `width: ${width}px`)
      return
    }
    if (!ALLOWED.has(child.tagName)) {
      while (child.firstChild) node.insertBefore(child.firstChild, child)
      child.remove()
      return
    }
    const style = sanitizeStyle(child.getAttribute('style') || '')
    const ulClass = child.tagName === 'UL'
      ? (child.getAttribute('class') || '').match(NOTE_UL_CLASS_RE)
      : null
    const isChecked = child.tagName === 'LI' && /\bchecked\b/.test(child.getAttribute('class') || '')
    while (child.attributes.length) child.removeAttribute(child.attributes[0].name)
    if (style) child.setAttribute('style', style)
    if (ulClass) child.setAttribute('class', ulClass[0])
    if (isChecked) child.setAttribute('class', 'checked')
    cleanNode(child)
  })
}

export function htmlToText(html) {
  const raw = String(html ?? '')
  if (!raw.trim()) return ''
  if (!looksLikeHtml(raw)) return raw.replace(/\s+/g, ' ').trim()
  if (typeof DOMParser === 'undefined') return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}

export function bodyToEditorHtml(body) {
  if (!body) return ''
  return looksLikeHtml(body) ? sanitizeNoteHtml(body) : markdownToHtml(body)
}

export function isEmptyNoteBody(body) {
  if (/<img\b/i.test(body ?? '')) return false
  return !htmlToText(body)
}

/** True when the current selection lives inside `el`. */
export function selectionIn(el) {
  if (!el || typeof document === 'undefined') return false
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const node = sel.anchorNode
  return !!node && (el === node || el.contains(node))
}

export function selectionInChecklist(editor) {
  if (!selectionIn(editor)) return false
  const sel = document.getSelection()
  const node = sel.anchorNode
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  return !!el?.closest?.('ul.note-check')
}
