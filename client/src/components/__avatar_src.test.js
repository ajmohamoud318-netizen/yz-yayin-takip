/**
 * Regression test for "I changed my profile photo and it took ages to
 * update".
 *
 * The stored avatar URL is `/api/users/<id>/avatar/file` — the same
 * string before and after a replacement. Nothing about it changes when
 * the bytes behind it change, so a browser holding a cached copy kept
 * painting the OLD photo (the file route used to answer with
 * `Cache-Control: private, max-age=300`, hence the ~5 minute wait), and
 * even a fresh render inside the same session handed <img> a src it
 * already had.
 *
 * The fix is a `?v=<avatar_updated_at epoch ms>` suffix: replacing the
 * photo bumps `avatar_updated_at`, which makes a genuinely different URL
 * and forces the refetch. These tests pin that behaviour plus the
 * pass-throughs it must not break.
 */
import { describe, expect, it } from 'vitest'
import { avatarSrc } from '@/components/UserAvatar.jsx'

const UPDATED = '2026-08-14T09:00:00.000Z'
const STAMP = String(Date.parse(UPDATED))

describe('avatarSrc() — cache busting', () => {
  it('appends the avatar_updated_at stamp to a relative URL', () => {
    const user = { id: 'u1', avatar_updated_at: UPDATED }
    expect(avatarSrc('/api/users/u1/avatar/file', user)).toBe(
      `/api/users/u1/avatar/file?v=${STAMP}`,
    )
  })

  it('yields a DIFFERENT url after a re-upload (the actual bug)', () => {
    const url = '/api/users/u1/avatar/file'
    const before = avatarSrc(url, { id: 'u1', avatar_updated_at: UPDATED })
    const after = avatarSrc(url, {
      id: 'u1',
      avatar_updated_at: '2026-08-14T09:05:00.000Z',
    })
    expect(after).not.toBe(before)
  })

  it('rewrites the legacy /me/ owner path and still versions it', () => {
    const user = { id: 'u1', avatar_updated_at: UPDATED }
    expect(avatarSrc('/api/users/me/avatar/file', user)).toBe(
      `/api/users/u1/avatar/file?v=${STAMP}`,
    )
  })

  it('leaves the url alone when there is no stamp to version with', () => {
    // Older cached user records (and any payload that omits the column)
    // must still render — they just fall back to revalidation.
    expect(avatarSrc('/api/users/u1/avatar/file', { id: 'u1' })).toBe(
      '/api/users/u1/avatar/file',
    )
  })

  it('passes data: and blob: sources through untouched', () => {
    const user = { id: 'u1', avatar_updated_at: UPDATED }
    expect(avatarSrc('data:image/png;base64,AAAA', user)).toBe('data:image/png;base64,AAAA')
    // The Settings page previews a just-picked photo from an object URL.
    expect(avatarSrc('blob:http://localhost/abc-123', user)).toBe('blob:http://localhost/abc-123')
  })

  it('returns falsy input unchanged', () => {
    expect(avatarSrc(null, { avatar_updated_at: UPDATED })).toBe(null)
    expect(avatarSrc(undefined, {})).toBe(undefined)
    expect(avatarSrc('', {})).toBe('')
  })

  it('ignores an unparseable stamp rather than emitting v=NaN', () => {
    expect(avatarSrc('/api/users/u1/avatar/file', { id: 'u1', avatar_updated_at: 'nope' })).toBe(
      '/api/users/u1/avatar/file',
    )
  })
})
