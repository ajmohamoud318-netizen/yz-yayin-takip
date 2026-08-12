import { chromium, devices } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const OUT = process.env.OUT || '/private/tmp/claude-501/-Users-m7-Desktop-yz-yayin-takip-main/26ec5c9f-f3cf-43bd-9dc5-8eba44a25018/scratchpad/dialogs'
fs.mkdirSync(OUT, { recursive: true })

const EMAILS = {
  team_leader: 'aysenur.kanak@yukselenzeka.com',
  designer: 'aylin@yukselenzeka.com',
  printer: 'oktay@yukselenzeka.com',
  satis: 'esra@yukselenzeka.com',
}

// [role, route, selector, label]
const CASES = [
  ['team_leader', '/', '[aria-label="Yeni proje"]', 'new-project'],
  ['team_leader', '/team', 'button:has-text("Üye Davet Et")', 'team-invite'],
  ['team_leader', '/urunler', 'button:has-text("Ürün Ekle")', 'promote-archive'],
  ['team_leader', '/urunler', 'button:has-text("Sipariş")', 'order-request'],
  ['team_leader', '/approvals/demo', 'button:has-text("Onayla")', 'approval'],
  ['team_leader', 'PROJECT', 'button:has-text("Demo Formu")', 'spec-form'],
]

const browser = await chromium.launch()
const ctxs = {}
for (const [role, routeRaw, click, label] of CASES) {
  if (!ctxs[role]) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'tr-TR' })
    const p = await ctx.newPage()
    await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
    await p.waitForSelector('input[type=email]', { timeout: 20000 })
    await p.fill('input[type=email]', EMAILS[role])
    await p.fill('input[type=password]', '123456')
    await p.check('#remember')
    await p.click('button[type=submit]')
    await p.waitForTimeout(3000)
    ctxs[role] = p
  }
  const page = ctxs[role]
  let route = routeRaw
  if (route === 'PROJECT') {
    const id = await page.evaluate(async () => (await (await fetch('/api/projects')).json())?.[0]?.id)
    route = `/projects/${id}`
  }
  try {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const target = page.locator(click).first()
    if (!(await target.count())) { console.log(`-- ${label}: trigger not found`); continue }
    await target.click({ timeout: 8000, force: true })
    await page.waitForTimeout(1500)
    const info = await page.evaluate(() => {
      const el = document.querySelector('[role=dialog]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      // is the last focusable control reachable?
      const controls = [...el.querySelectorAll('button, input, select, textarea')]
      const last = controls[controls.length - 1]
      const lr = last?.getBoundingClientRect()
      return {
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
        h: Math.round(r.height), w: Math.round(r.width),
        vp: [window.innerWidth, window.innerHeight],
        scrollH: el.scrollHeight, clientH: el.clientHeight,
        overflowY: cs.overflowY, pad: cs.padding,
        clipped: Math.round(r.bottom) > window.innerHeight + 1 || Math.round(r.top) < -1,
        lastControlBottom: lr ? Math.round(lr.bottom) : null,
        lastControlOffscreen: lr ? lr.bottom > window.innerHeight + 1 : null,
      }
    })
    console.log(`\n### ${label} (${role} ${route})\n   `, JSON.stringify(info))
    await page.screenshot({ path: `${OUT}/${label}.png` })
  } catch (e) {
    console.log(`!! ${label}: ${e.message.split('\n')[0]}`)
  }
}
await browser.close()
console.log('\nDONE ->', OUT)
