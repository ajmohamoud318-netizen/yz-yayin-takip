// Capture screenshots of the mockup page at 1600px wide.
const { chromium } = require('./node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  await page.goto('http://localhost:8765/yearplan-proposals.html', {
    waitUntil: 'networkidle',
  });
  // Tailwind CDN needs a moment to apply generated styles after networkidle.
  await page.waitForTimeout(1500);

  await page.screenshot({
    path: './assets/mockups/yearplan-full.png',
    fullPage: true,
  });
  console.log('yearplan-full.png written');

  const tiers = [
    { name: 'yearplan-tier1.png', text: 'TIER 1' },
    { name: 'yearplan-tier2.png', text: 'TIER 2' },
    { name: 'yearplan-tier3.png', text: 'TIER 3' },
  ];

  for (const t of tiers) {
    const y = await page.evaluate((needle) => {
      const headers = Array.from(document.querySelectorAll('h2'));
      const target = headers.find((h) => h.textContent.includes(needle));
      return target ? target.getBoundingClientRect().top + window.scrollY - 16 : 0;
    }, t.text);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `./assets/mockups/${t.name}`,
      fullPage: false,
    });
    console.log(`${t.name} written (scrollY=${y})`);
  }

  await browser.close();
  console.log('done');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
