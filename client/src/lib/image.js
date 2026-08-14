/**
 * Client-side image preparation for avatar uploads.
 *
 * Why this exists: the team is on phones, and a phone camera photo is
 * 3–5 MB of 4032×3024 pixels. Uploading that raw over mobile data is the
 * slow part of "changing my photo" — and it was ALSO the reason a normal
 * camera roll pick got rejected outright, since the server caps avatars
 * at 2 MB. Every one of those pixels is then thrown away at render time:
 * the largest avatar the UI draws is 48 CSS px (`2xl`), i.e. 96 px on a
 * 2× screen.
 *
 * So we downscale in the browser before the request goes out. A 512×512
 * JPEG is ~40–80 KB — small enough that the upload finishes in one round
 * trip, and small enough that everyone else's avatar fetches are cheap.
 *
 * The crop is a centred square because that is exactly what the circular
 * `object-cover` avatars already display; storing the rest is storing
 * pixels no one will ever see.
 */

/** Rendered avatars top out at 48 CSS px; 512 covers 3× and then some. */
export const AVATAR_MAX_PX = 512
export const AVATAR_QUALITY = 0.85

/**
 * Ceiling on what we're willing to hand to the decoder. Downscaling means
 * we no longer need to reject ordinary camera photos, but decoding an
 * arbitrarily huge file on a phone can still exhaust memory, so keep a
 * generous guard rail well above any real photo.
 */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024

/** Decode a File into something drawable, honouring EXIF orientation. */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // `from-image` applies the EXIF rotation phone cameras write, so a
      // portrait selfie doesn't land sideways in the circle.
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Older Safari rejects the options bag — fall through to <img>,
      // which applies EXIF orientation by default anyway.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Görüntü çözümlenemedi.'))
      img.src = url
    })
  } finally {
    // Safe once `onload` has fired: the element holds its own decoded copy.
    URL.revokeObjectURL(url)
  }
}

/** Centre-crop to a square and scale down to at most `size` px. */
function drawSquare(source, size) {
  const w = source.width
  const h = source.height
  if (!w || !h) throw new Error('Görüntü boyutu okunamadı.')
  const side = Math.min(w, h)
  const sx = Math.round((w - side) / 2)
  const sy = Math.round((h - side) / 2)
  // Never upscale — a 96 px source stays 96 px rather than being blown up
  // into a blurry 512.
  const target = Math.min(size, side)

  const canvas = document.createElement('canvas')
  canvas.width = target
  canvas.height = target
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas kullanılamıyor.')
  // JPEG has no alpha channel: without this, a transparent PNG's
  // background encodes as black instead of white.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, target, target)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, sx, sy, side, side, 0, 0, target, target)
  return canvas
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Görüntü kodlanamadı.'))),
      type,
      quality,
    )
  })
}

/**
 * Downscale a picked image into an upload-ready JPEG File.
 *
 * Always returns a File. If anything in the canvas path fails (an exotic
 * codec, a locked-down browser, a decode error) the ORIGINAL file comes
 * back untouched, so the worst case is the old slow-but-working upload
 * rather than a dead button. The caller still enforces the server's size
 * limit on whatever it gets back.
 */
export async function prepareAvatarFile(
  file,
  { size = AVATAR_MAX_PX, quality = AVATAR_QUALITY } = {},
) {
  if (!file) throw new Error('Dosya bulunamadı.')
  let source
  try {
    source = await decodeImage(file)
    const canvas = drawSquare(source, size)
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    // A file that's already tiny can come out of the encoder LARGER than
    // it went in. Keep whichever is smaller.
    if (blob.size >= file.size) return file
    // The declared type has to match the actual bytes — the server sniffs
    // the magic numbers and rejects a mismatch.
    return new File([blob], 'avatar.jpg', {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  } catch {
    return file
  } finally {
    // ImageBitmap holds decoded pixels until explicitly released.
    if (typeof source?.close === 'function') source.close()
  }
}
