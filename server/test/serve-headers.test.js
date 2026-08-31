import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import cp from 'node:child_process'
import http from 'node:http'
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'yz-serve-'))
fs.mkdirSync(`${dist}/assets`, { recursive: true })
for (const [p, body] of [
  ['index.html', '<!doctype html><html><body></body></html>'],
  ['sw.js', '// stub'],
  ['assets/index-X.js', 'console.log(1)'],
]) fs.writeFileSync(`${dist}/${p}`, body)
const PORT = 39393
const child = cp.spawn(process.execPath, [`${import.meta.dirname}/../../serve.cjs`], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', SERVE_DIST: dist },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const ready = new Promise((r) => child.stdout.once('data', () => r()))
const get = (p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, resolve).on('error', reject)
})
test.after(() => {
  try { child.kill() } catch {}
  fs.rmSync(dist, { recursive: true, force: true })
})
test('serve.cjs emits CSP + defense headers on every static response', async () => {
  await ready
  const root = await get('/')
  assert.match(root.headers['content-security-policy'], /default-src 'self'/)
  assert.match(root.headers['content-security-policy'], /https:\/\/fonts\.gstatic\.com/)
  assert.match(root.headers['content-security-policy'], /frame-ancestors 'none'/)
  assert.equal(root.headers['x-frame-options'], 'DENY')
  assert.equal(root.headers['x-content-type-options'], 'nosniff')
  assert.equal(root.headers['referrer-policy'], 'strict-origin-when-cross-origin')
  assert.equal(root.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()')
  const asset = await get('/assets/index-X.js')
  assert.match(asset.headers['content-security-policy'], /script-src 'self'/)
  assert.match(asset.headers['cache-control'], /max-age=3600/)
  const sw = await get('/sw.js')
  assert.equal(sw.headers['service-worker-allowed'], '/')
  assert.match(sw.headers['cache-control'], /no-cache/)
  const notFound = await get('/missing.png')
  assert.equal(notFound.statusCode, 404)
  assert.match(notFound.headers['content-security-policy'], /frame-ancestors 'none'/)
})
