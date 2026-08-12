import { chromium, devices } from 'playwright'
import fs from 'node:fs'
const OUT = '/private/tmp/claude-501/-Users-m7-Desktop-yz-yayin-takip-main/26ec5c9f-f3cf-43bd-9dc5-8eba44a25018/scratchpad/shell'
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'tr-TR' })
const page = await ctx.newPage()
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('input[type=email]')
await page.fill('input[type=email]', 'aysenur.kanak@yukselenzeka.com')
await page.fill('input[type=password]', '123456')
await page.check('#remember')
await page.click('button[type=submit]')
await page.waitForTimeout(3500)
// drawer
await page.click('[aria-label="Menüyü aç"]')
await page.waitForTimeout(900)
await page.screenshot({ path: OUT + '/drawer.png' })
await page.keyboard.press('Escape')
await page.waitForTimeout(600)
// bell
await page.click('[aria-label="Bildirimler"]')
await page.waitForTimeout(900)
await page.screenshot({ path: OUT + '/bell.png' })
console.log(await page.evaluate(() => {
  const el = document.querySelector('[role=menu]') || document.querySelector('[data-radix-popper-content-wrapper]')
  if (!el) return 'no menu'
  const r = el.getBoundingClientRect()
  return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), vw: innerWidth }
}))
await browser.close()
