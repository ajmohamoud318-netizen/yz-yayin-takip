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
await page.goto('http://localhost:5173/kanban', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
console.log(await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Tümü')
  const cs = getComputedStyle(b)
  return { minH: cs.minHeight, h: b.getBoundingClientRect().height, cls: b.className }
}))
await browser.close()
