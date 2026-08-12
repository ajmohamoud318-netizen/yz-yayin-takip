import { chromium, devices } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const OUT = '/private/tmp/claude-501/-Users-m7-Desktop-yz-yayin-takip-main/26ec5c9f-f3cf-43bd-9dc5-8eba44a25018/scratchpad/shots2'
fs.mkdirSync(OUT, { recursive: true })

const role = process.env.ROLE || 'team_leader'
const EMAILS = {
  team_leader: 'aysenur.kanak@yukselenzeka.com',
  designer: 'aylin@yukselenzeka.com',
  printer: 'oktay@yukselenzeka.com',
  satis: 'esra@yukselenzeka.com',
}
const routes = (process.env.ROUTES || '/urun-bilgileri').split(',')

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'tr-TR' })
const page = await ctx.newPage()
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
await page.fill('input[type=email]', EMAILS[role])
await page.fill('input[type=password]', '123456')
await page.check('#remember')
await page.click('button[type=submit]')
await page.waitForTimeout(3000)

for (const route of routes) {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const info = await page.evaluate(() => {
    const vw = window.innerWidth
    const wide = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right > vw + 1 || r.left < -1) {
        let p = el.parentElement, scroller = null
        while (p && p !== document.body) {
          const s = getComputedStyle(p)
          if (s.overflowX === 'auto' || s.overflowX === 'scroll') { scroller = String(p.className).slice(0, 50); break }
          p = p.parentElement
        }
        wide.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className?.baseVal ?? el.className ?? '').slice(0, 120),
          l: Math.round(r.left), rr: Math.round(r.right), w: Math.round(r.width),
          scroller,
          txt: (el.textContent || '').trim().slice(0, 30),
        })
      }
    }
    return { vw, docScroll: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth, wide: wide.slice(0, 15) }
  })
  console.log('\n###', route, JSON.stringify({ vw: info.vw, docScroll: info.docScroll, bodyScroll: info.bodyScroll }))
  for (const w of info.wide) console.log('   ', JSON.stringify(w))
  const nm = route.replace(/\//g, '_')
  await page.screenshot({ path: `${OUT}/${role}${nm}_viewport.png` })
  await page.evaluate(() => window.scrollBy(0, 700))
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${role}${nm}_scrolled.png` })
}
await browser.close()
