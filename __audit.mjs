import { chromium, devices } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const OUT = process.env.OUT || '/private/tmp/claude-501/-Users-m7-Desktop-yz-yayin-takip-main/26ec5c9f-f3cf-43bd-9dc5-8eba44a25018/scratchpad/shots'
fs.mkdirSync(OUT, { recursive: true })

const ROLES = {
  team_leader: 'aysenur.kanak@yukselenzeka.com',
  designer: 'aylin@yukselenzeka.com',
  printer: 'oktay@yukselenzeka.com',
  satis: 'esra@yukselenzeka.com',
}

const only = process.env.ONLY_ROLE
const ROUTES = {
  team_leader: ['/', '/kanban', '/projects', '/urunler', '/baski-listesi', '/approvals/demo', '/siparis-talepleri', '/team', '/documents', '/urun-bilgileri', '/plan', '/settings', 'PROJECT'],
  designer: ['/', '/my-projects', '/kanban', '/approvals/ozalit', '/siparis-onay', '/documents', 'PROJECT'],
  printer: ['/', '/kanban', '/uretime-hazir', '/teslim-talepleri', '/approvals/siparis', 'PROJECT'],
  satis: ['/urunler', '/siparis-talebi', '/teslim-onaylari'],
}

const iPhone = devices['iPhone 13']

const DIAG = () => {
  const de = document.documentElement
  // NB: innerWidth is NOT the device width — when content overflows, the
  // engine widens the layout viewport (and iOS Safari zooms the page out to
  // fit). Measure against the real device width so that widening shows up as
  // the bug it is.
  const vw = 390
  const overflow = Math.max(de.scrollWidth, document.body.scrollWidth, window.innerWidth) - vw
  const offenders = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + 2 || r.left < -2) {
      let p = el.parentElement, inScroller = false
      while (p && p !== document.body) {
        const ps = getComputedStyle(p)
        if ((ps.overflowX === 'auto' || ps.overflowX === 'scroll' || ps.overflowX === 'hidden') && p.scrollWidth > p.clientWidth) { inScroller = true; break }
        p = p.parentElement
      }
      if (inScroller) continue
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || '')).slice(0, 150),
        right: Math.round(r.right), left: Math.round(r.left), w: Math.round(r.width),
        text: (el.textContent || '').trim().slice(0, 40),
      })
    }
  }
  const small = []
  for (const el of document.querySelectorAll('button, a[href], [role=button], input, select, [role=tab]')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.height < 32 || r.width < 24) {
      small.push({ tag: el.tagName.toLowerCase(), h: Math.round(r.height), w: Math.round(r.width), cls: String(el.className || '').slice(0, 70), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28) })
    }
  }
  // inputs whose font-size < 16px cause iOS Safari to zoom on focus
  const zoomers = []
  for (const el of document.querySelectorAll('input, select, textarea')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (fs < 16 && el.type !== 'checkbox' && el.type !== 'radio') zoomers.push({ tag: el.tagName.toLowerCase(), fs, ph: el.placeholder || el.name || '' })
  }
  return { coarse: matchMedia('(pointer: coarse)').matches, overflow, offenders: offenders.slice(0, 10), small: small.slice(0, 10), zoomers: zoomers.slice(0, 6) }
}

const results = []
const browser = await chromium.launch()
for (const [role, email] of Object.entries(ROLES)) {
  if (only && only !== role) continue
  const ctx = await browser.newContext({ ...iPhone, locale: 'tr-TR' })
  const page = await ctx.newPage()
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', '123456')
  await page.check('#remember')
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1800)

  // capture a project id for the detail page
  let projectId = null
  try {
    projectId = await page.evaluate(async () => {
      const r = await fetch('/api/projects', { credentials: 'include' })
      const j = await r.json()
      return j?.[0]?.id ?? null
    })
  } catch {}

  for (const routeRaw of ROUTES[role]) {
    const route = routeRaw === 'PROJECT' ? (projectId ? `/projects/${projectId}` : null) : routeRaw
    if (!route) continue
    try {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
      const diag = await page.evaluate(DIAG)
      const name = role + '_' + route.replace(/\//g, '_')
      await page.screenshot({ path: `${OUT}/${name}.png` })
      results.push({ role, route, ...diag })
      console.log(`\n### ${role} ${route}  overflow=${diag.overflow}px coarse=${diag.coarse}`)
      if (diag.offenders.length) console.log('  OVERFLOW:', JSON.stringify(diag.offenders, null, 1))
      if (diag.small.length) console.log('  SMALL:', JSON.stringify(diag.small))
      if (diag.zoomers.length) console.log('  IOS-ZOOM-INPUTS:', JSON.stringify(diag.zoomers))
    } catch (e) {
      console.log(`!! ${role} ${route}: ${e.message}`)
    }
  }
  await ctx.close()
}
await browser.close()
fs.writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 2))
console.log('\nDONE ->', OUT)
