import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'tr-TR' })
const page = await ctx.newPage()
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
await page.fill('input[type=email]', 'aysenur.kanak@yukselenzeka.com')
await page.fill('input[type=password]', '123456')
await page.check('#remember')
await page.click('button[type=submit]')
await page.waitForTimeout(3000)
await page.goto('http://localhost:5173/settings', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
console.log(await page.evaluate(() => {
  const out = []
  for (const b of document.querySelectorAll('button, [role=button], a[href], input:not([type=hidden])')) {
    const r = b.getBoundingClientRect()
    if (!r.width || !r.height) continue
    if (r.height < 36 || r.width < 36) {
      const cs = getComputedStyle(b)
      out.push({ t: (b.textContent || b.getAttribute('aria-label') || b.type || '').trim().slice(0, 24), h: Math.round(r.height), w: Math.round(r.width), minH: cs.minHeight, fs: cs.fontSize })
    }
  }
  return out
}))
await browser.close()
