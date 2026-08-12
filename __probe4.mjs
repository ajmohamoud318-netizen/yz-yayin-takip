import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'tr-TR' })
const page = await ctx.newPage()
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
console.log(await page.evaluate(() => ({
  coarse: matchMedia('(pointer: coarse)').matches,
  anyCoarse: matchMedia('(any-pointer: coarse)').matches,
  hover: matchMedia('(hover: hover)').matches,
  dpr: devicePixelRatio,
  innerW: innerWidth,
})))
await browser.close()
