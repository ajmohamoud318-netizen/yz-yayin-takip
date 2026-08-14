/**
 * `prepareAvatarFile` sits directly in front of the upload button, so its
 * contract is "always hand back something uploadable". A phone photo is
 * 3–5 MB and slow to push over mobile data; downscaling it to a 512×512
 * JPEG is what makes changing your photo feel instant. But if the canvas
 * path is unavailable or the file can't be decoded, the right outcome is
 * the ORIGINAL file (a slow upload) — never a thrown error, which would
 * leave the user with a dead button.
 *
 * jsdom has no canvas backend (`getContext('2d')` returns null), so this
 * suite exercises exactly that fallback.
 */
import { describe, expect, it } from 'vitest'
import { MAX_SOURCE_BYTES, prepareAvatarFile } from '@/lib/image.js'

function fakeFile(name = 'photo.jpg', type = 'image/jpeg', bytes = 1024) {
  return new File([new Uint8Array(bytes)], name, { type })
}

describe('prepareAvatarFile()', () => {
  it('falls back to the original file when the image cannot be processed', async () => {
    const original = fakeFile()
    const out = await prepareAvatarFile(original)
    expect(out).toBe(original)
  })

  it('never rejects on an undecodable file', async () => {
    await expect(prepareAvatarFile(fakeFile('junk.png', 'image/png'))).resolves.toBeInstanceOf(File)
  })

  it('rejects a missing file explicitly', async () => {
    await expect(prepareAvatarFile(null)).rejects.toThrow()
  })

  it('allows sources far larger than the 2 MB server cap', () => {
    // The point of downscaling: a normal camera photo must no longer be
    // turned away before it is even resized.
    expect(MAX_SOURCE_BYTES).toBeGreaterThan(2 * 1024 * 1024)
  })
})
