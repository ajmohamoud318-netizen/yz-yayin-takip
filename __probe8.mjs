import { chromium, devices } from 'playwright'
import fs from 'node:fs'
const OUT = '/private/tmp/claude-501/-Users-m7-Desktop-yz-yayin-takip-main/26ec5c9f-f3cf-43bd-9dc5-8eba44a25018/scratchpad/verify'
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
await page.waitForTimeout(3000)
const id = await page.evaluate(async () => (await (await fetch('/api/projects')).json())?.[0]?.id)
await page.goto('http://localhost:5173/projects/' + id, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
await page.screenshot({ path: OUT + '/project-detail.png' })
console.log('stage bar scroll:', await page.evaluate(() => {
  const ol = document.querySelector('ol.min-w-max')
  const sc = ol?.parentElement
  return sc ? { scrollLeft: Math.round(sc.scrollLeft), scrollW: sc.scrollWidth, clientW: sc.clientWidth } : 'not found'
}))
await browser.close()
