import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cropIdeaImageFile } from '@/lib/image'
import { cn } from '@/lib/utils'

const MIN_CROP = 0.08
const DRAG_THRESHOLD_PX = 6
const HANDLES = ['nw', 'ne', 'se', 'sw']

function containedRect(frameW, frameH, natW, natH) {
  if (!frameW || !frameH || !natW || !natH) return { x: 0, y: 0, w: 0, h: 0 }
  const scale = Math.min(frameW / natW, frameH / natH)
  const w = natW * scale
  const h = natH * scale
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h }
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function clampCrop(next) {
  let { x, y, w, h } = next
  w = Math.max(MIN_CROP, Math.min(1, w))
  h = Math.max(MIN_CROP, Math.min(1, h))
  x = Math.max(0, Math.min(1 - w, x))
  y = Math.max(0, Math.min(1 - h, y))
  return { x, y, w, h }
}

function pointOnImage(clientX, clientY, frameEl, imgBox) {
  const box = frameEl.getBoundingClientRect()
  return {
    px: (clientX - box.left - imgBox.x) / imgBox.w,
    py: (clientY - box.top - imgBox.y) / imgBox.h,
  }
}

/**
 * Crop a picked photo before upload. Portal overlay (not a nested Dialog)
 * so it can sit on top of the note sheet.
 */
export default function ImageAdjustDialog({ file, open, onOpenChange, onConfirm }) {
  const frameRef = useRef(null)
  const dragRef = useRef(null)
  const [url, setUrl] = useState('')
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [frame, setFrame] = useState({ w: 0, h: 0 })
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 1, h: 1 })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!file || !open) {
      setUrl('')
      return undefined
    }
    const next = URL.createObjectURL(file)
    setUrl(next)
    setCrop({ x: 0, y: 0, w: 1, h: 1 })
    setNatural({ w: 0, h: 0 })
    return () => URL.revokeObjectURL(next)
  }, [file, open])

  useEffect(() => {
    const el = frameRef.current
    if (!el || !open) return undefined
    function measure() {
      const box = el.getBoundingClientRect()
      setFrame({ w: box.width, h: box.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, url])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key !== 'Escape' || busy) return
      e.preventDefault()
      e.stopPropagation()
      onOpenChange(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, busy, onOpenChange])

  if (!open || !file || typeof document === 'undefined') return null

  const imgBox = containedRect(frame.w, frame.h, natural.w, natural.h)
  const cropBox = {
    left: imgBox.x + crop.x * imgBox.w,
    top: imgBox.y + crop.y * imgBox.h,
    width: crop.w * imgBox.w,
    height: crop.h * imgBox.h,
  }

  function cropFromPoint(clientX, clientY, drag) {
    const el = frameRef.current
    if (!el || !imgBox.w) return crop
    const { px, py } = pointOnImage(clientX, clientY, el, imgBox)
    if (drag.handle === 'draw') {
      const x0 = clamp01(drag.ox)
      const y0 = clamp01(drag.oy)
      const x1 = clamp01(px)
      const y1 = clamp01(py)
      return clampCrop({
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
      })
    }
    let next = { x: drag.x, y: drag.y, w: drag.w, h: drag.h }
    if (drag.handle === 'move') {
      next.x = drag.x + (px - drag.px)
      next.y = drag.y + (py - drag.py)
    } else {
      const right = drag.x + drag.w
      const bottom = drag.y + drag.h
      if (drag.handle.includes('w')) {
        next.x = Math.min(px, right - MIN_CROP)
        next.w = right - next.x
      }
      if (drag.handle.includes('e')) next.w = Math.max(MIN_CROP, px - drag.x)
      if (drag.handle.includes('n')) {
        next.y = Math.min(py, bottom - MIN_CROP)
        next.h = bottom - next.y
      }
      if (drag.handle.includes('s')) next.h = Math.max(MIN_CROP, py - drag.y)
    }
    return clampCrop(next)
  }

  function beginDrag(e, handle) {
    const el = frameRef.current
    if (!el || !imgBox.w) return
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    el.setPointerCapture(e.pointerId)
    const { px, py } = pointOnImage(e.clientX, e.clientY, el, imgBox)
    dragRef.current = {
      handle,
      ox: px,
      oy: py,
      px,
      py,
      x: crop.x,
      y: crop.y,
      w: crop.w,
      h: crop.h,
      startX: e.clientX,
      startY: e.clientY,
      moved: handle !== 'draw',
    }
  }

  function onPointerMove(e) {
    const drag = dragRef.current
    if (!drag) return
    if (!drag.moved) {
      const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY)
      if (dist < DRAG_THRESHOLD_PX) return
      drag.moved = true
    }
    setCrop(cropFromPoint(e.clientX, e.clientY, drag))
  }

  function onPointerUp(e) {
    if (!dragRef.current) return
    frameRef.current?.releasePointerCapture(e.pointerId)
    dragRef.current = null
  }

  async function confirm() {
    if (!file || busy) return
    setBusy(true)
    try {
      const cropped = await cropIdeaImageFile(file, {
        x: crop.x * natural.w,
        y: crop.y * natural.h,
        width: crop.w * natural.w,
        height: crop.h * natural.h,
      })
      await onConfirm(cropped, {
        widthPx: Math.round(Math.max(80, Math.min(1600, crop.w * natural.w))),
      })
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onOpenChange(false)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-adjust-title"
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <h2 id="image-adjust-title" className="text-base font-semibold">Kırpın</h2>
            <p className="text-xs text-muted-foreground">Sürükleyerek alanı seçin, köşelerden ayarlayın.</p>
          </div>
          <button
            type="button"
            aria-label="Kapatın"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div
          ref={frameRef}
          className="relative mx-3 h-[min(24rem,56vh)] cursor-crosshair touch-none overflow-hidden rounded-xl bg-neutral-900"
          onPointerDown={(e) => beginDrag(e, 'draw')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {url && (
            <img
              src={url}
              alt=""
              draggable={false}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain select-none"
            />
          )}
          {imgBox.w > 0 && (
            <div
              data-crop-box=""
              className="absolute cursor-move"
              style={{
                left: cropBox.left,
                top: cropBox.top,
                width: cropBox.width,
                height: cropBox.height,
                boxShadow: '0 0 0 1px rgba(255,255,255,0.95), 0 0 0 9999px rgba(0,0,0,0.55)',
              }}
              onPointerDown={(e) => beginDrag(e, 'move')}
            >
              {HANDLES.map((handle) => (
                <button
                  key={handle}
                  type="button"
                  tabIndex={-1}
                  aria-label="Kırpma tutamacı"
                  className={cn(
                    'absolute z-10 flex h-11 w-11 items-center justify-center',
                    handle.includes('n') && '-top-2',
                    handle.includes('s') && '-bottom-2',
                    handle.includes('w') && '-left-2',
                    handle.includes('e') && '-right-2',
                    handle === 'nw' && 'cursor-nwse-resize',
                    handle === 'se' && 'cursor-nwse-resize',
                    handle === 'ne' && 'cursor-nesw-resize',
                    handle === 'sw' && 'cursor-nesw-resize',
                  )}
                  onPointerDown={(e) => beginDrag(e, handle)}
                >
                  <span className="pointer-events-none h-3 w-3 rounded-[1px] border border-neutral-900/30 bg-white shadow" />
                </button>
              ))}
            </div>
          )}
        </div>

        <footer className="mt-3 flex justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            Vazgeçin
          </Button>
          <Button type="button" size="sm" disabled={busy || !natural.w} onClick={confirm}>
            {busy ? 'Hazırlanıyor…' : 'Ekleyin'}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
