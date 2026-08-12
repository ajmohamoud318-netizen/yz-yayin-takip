import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPayload } from './push.js'

/**
 * Payload contract tests.
 *
 * These lock the shape sw.js reads. The service worker is deployed as a
 * separate static file with its own cache lifetime, so a payload field
 * renamed here but not there fails SILENTLY in production — the push
 * arrives, the worker reads `undefined`, and the user gets a generic
 * notification with no working link. Cheap tests, expensive bug.
 */

test('buildPayload: routes to the explicit link when present', () => {
  const p = JSON.parse(buildPayload({
    type: 'handover_requested',
    title: 'Matematik 8',
    body: 'Teslim onayı bekleniyor',
    tone: 'amber',
    link: '/approvals/teslim',
    projectId: 'p-abc',
  }))
  assert.equal(p.url, '/approvals/teslim')
  assert.equal(p.title, 'Matematik 8')
  assert.equal(p.tone, 'amber')
})

test('buildPayload: falls back to the project route, then home', () => {
  const withProject = JSON.parse(buildPayload({ type: 'assignment', projectId: 'p-abc' }))
  assert.equal(withProject.url, '/projects/p-abc')

  const bare = JSON.parse(buildPayload({ type: 'info' }))
  assert.equal(bare.url, '/')
})

test('buildPayload: never emits an empty title', () => {
  // An empty title renders as a blank notification banner on Android.
  const p = JSON.parse(buildPayload({ type: 'info', title: '' }))
  assert.equal(p.title, 'YZ Yayın Takip')
})

test('buildPayload: tags by project so repeat events collapse', () => {
  // Two events about the same book must share a tag — otherwise a busy
  // project stacks five separate banners on the printer's lock screen.
  const a = JSON.parse(buildPayload({ type: 'demo_ready', projectId: 'p-abc' }))
  const b = JSON.parse(buildPayload({ type: 'ozalit_requested', projectId: 'p-abc' }))
  assert.equal(a.tag, b.tag)
  assert.equal(a.tag, 'project-p-abc')

  const c = JSON.parse(buildPayload({ type: 'info', notificationId: 'n-1' }))
  assert.equal(c.tag, 'notif-n-1')
})

test('buildPayload: stays well inside the ~4KB push service limit', () => {
  // Push services reject oversized payloads outright. Body text comes from
  // project titles, which are user-supplied and unbounded.
  const payload = buildPayload({
    type: 'rejection',
    title: 'x'.repeat(300),
    body: 'y'.repeat(500),
    projectId: 'p-abc',
  })
  assert.ok(Buffer.byteLength(payload, 'utf8') < 4096, 'payload must fit in 4KB')
})
