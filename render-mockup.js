// One-shot Playwright render — drives Google Chrome to open the mockup
// at full page size and writes a PNG. Not part of the app; lives next
// to scenario1-mockup.html so the user can re-render after tweaks.

const path = require('node:path')
const { chromium } = require('playwright')

const HTML = path.resolve(__dirname, 'scenario1-mockup.html')
const OUT  = path.resolve(__dirname, 'scenario1-mockup.png')

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto('file://' + HTML)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: OUT, fullPage: true })
  await browser.close()
  console.log('wrote', OUT)
})().catch((e) => { console.error(e); process.exit(1) })
