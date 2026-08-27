const { chromium } = require('./node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  await page.goto('http://localhost:8765/yearplan-proposals.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const tiers = [
    { name: 'yearplan-tier1.png', header: 'TIER 1' },
    { name: 'yearplan-tier2.png', header: 'TIER 2' },
    { name: 'yearplan-tier3.png', header: 'TIER 3' },
  ];

  for (const t of tiers) {
    // Wait until the header text is actually rendered.
    await page.waitForFunction(
      (needle) => Array.from(document.querySelectorAll('span')).some((s) => s.textContent.trim() === needle),
      t.header,
      { timeout: 5000 },
    );
    const y = await page.evaluate((needle) => {
      const all = Array.from(document.querySelectorAll('span, h2'));
      const target = all.find((el) => el.textContent.includes(needle));
      const section = target?.closest('section');
      const rect = (section || target).getBoundingClientRect();
      return rect.top + window.scrollY - 16;
    }, t.header);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(400);
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
