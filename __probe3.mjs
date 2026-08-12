import { chromium, devices } from 'playwright'

const BASE = 'http://localhost:5173'
const route = process.env.ROUTE || '/documents'
const EMAILS = {
  team_leader: 'aysenur.kanak@yukselenzeka.com',
  designer: 'aylin@yukselenzeka.com',
  printer: 'oktay@yukselenzeka.com',
  satis: 'esra@yukselenzeka.com',
}
const role = process.env.ROLE || 'team_leader'

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'tr-TR' })
const page = await ctx.newPage()
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
await page.fill('input[type=email]', EMAILS[role])
await page.fill('input[type=password]', '123456')
await page.check('#remember')
await page.click('button[type=submit]')
await page.waitForTimeout(3000)
await page.goto(BASE + route, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

const out = await page.evaluate(() => {
  const lines = []
  // Find the deepest elements that are wider than 390 and report the chain
  const LIMIT = Number(window.__limit ?? 390)
  const wide = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.right > LIMIT + 1 && r.height > 0
  })
  // deepest = has no wide descendant
  const deepest = wide.filter((el) => !wide.some((o) => o !== el && el.contains(o)))
  for (const el of deepest.slice(0, 6)) {
    const chain = []
    let cur = el
    while (cur && cur !== document.body) {
      const r = cur.getBoundingClientRect()
      const cs = getComputedStyle(cur)
      chain.push(`${cur.tagName.toLowerCase()}.${String(cur.className).slice(0, 70)} | w=${Math.round(r.width)} scrollW=${cur.scrollWidth} clientW=${cur.clientWidth} disp=${cs.display} minW=${cs.minWidth} ws=${cs.whiteSpace}`)
      cur = cur.parentElement
    }
    lines.push('DEEPEST-WIDE:\n  ' + chain.join('\n  '))
  }
  return lines.join('\n\n')
})
console.log(out)
await browser.close()
