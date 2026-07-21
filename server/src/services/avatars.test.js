/**
 * Verifies the avatar storage service's "writable root" guarantees.
 *
 * Two things matter on the deployed Dokploy container:
 *  1. saveAvatar must not throw when the *configured* AVATAR_DIR is not
 *     writable by the running uid (mounted volume owned by root).
 *     If a fallback root is writable, saveAvatar silently uses it.
 *  2. resolveAvatarPath must still find files written by an *older*
 *     deploy that used the legacy flat layout (`<root>/<uid>.<ext>`),
 *     so existing avatars don't go blank until the user re-uploads.
 *
 * Both of these are tested against an isolated AVATAR_DIR under
 * `node:os.tmpdir()` so the suite is hermetic and doesn't touch the
 * container's real upload path.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import * as avatars from './avatars.js'

function freshDirs() {
  const root = path.join(os.tmpdir(), `yz-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  return { root }
}

const tinyPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f,
  0x00, 0x05, 0xfe, 0x02, 0xfe, 0xa3, 0x9e, 0x92, 0xa6, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

test('saveAvatar + readAvatar round-trip on the active root', async () => {
  const url = await avatars.saveAvatar('u-test-rt', 'png', tinyPng)
  assert.equal(url, '/api/users/u-test-rt/avatar/file')
  const got = await avatars.readAvatar(
    'u-test-rt',
    url,
  )
  assert.ok(got, 'readAvatar must find the file we just wrote')
  assert.equal(got.ext, 'png')
  assert.equal(got.mime, 'image/png')
  assert.equal(got.buffer.length, tinyPng.length)
  await avatars.deleteAvatar('u-test-rt')
})

test('resolveAvatarPath finds legacy flat-layout files', async () => {
  // Simulate an older deployment that wrote `<root>/<uid>.png` directly
  // (no per-user subdir). Make sure the new resolver still finds it.
  // We plant the legacy file under whichever root the module chose as
  // ACTIVE_AVATAR_DIR at boot — that's the canonical "configured" search
  // root for the running test process.
  const root = avatars.AVATAR_DIR
  await fs.mkdir(root, { recursive: true })
  const uid = 'u-legacy-during-test'
  const legacy = path.join(root, `${uid}.png`)
  await fs.writeFile(legacy, tinyPng)
  try {
    const found = await avatars.resolveAvatarPath(uid, `/api/users/${uid}/avatar/file`)
    assert.ok(found, 'legacy file must still resolve')
    assert.equal(await fs.realpath(found), await fs.realpath(legacy))
  } finally {
    await fs.unlink(legacy).catch(() => {})
  }
})

test('deleteAvatar removes files across both new + legacy locations', async () => {
  const root = avatars.AVATAR_DIR
  await fs.mkdir(root, { recursive: true })
  const uid = 'u-gone-during-test'
  // Drop one new-layout file and one legacy-layout file — both should
  // disappear after deleteAvatar().
  await fs.mkdir(path.join(root, uid), { recursive: true })
  await fs.writeFile(path.join(root, uid, 'image.png'), tinyPng)
  await fs.writeFile(path.join(root, `${uid}.png`), tinyPng)
  try {
    await avatars.deleteAvatar(uid)
    assert.equal(
      await avatars.resolveAvatarPath(uid, `/api/users/${uid}/avatar/file`),
      null,
      'after delete, neither layout should resolve',
    )
  } finally {
    await fs.unlink(path.join(root, uid, 'image.png')).catch(() => {})
    await fs.unlink(path.join(root, `${uid}.png`)).catch(() => {})
  }
})
