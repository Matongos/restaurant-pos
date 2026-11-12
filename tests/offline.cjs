// Installable app: manifest, service worker, and the app still opens and sells with the network cut.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL = (process.env.POS_URL || 'http://localhost:8765/') + '?sw=1';
const out = {}; const check = (n, c, d) => (out[n] = c ? 'ok' : `FAIL ${d ?? ''}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL); await page.waitForSelector('.keypad');
  const man = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  check('manifest name', man.short_name === 'TechPlug POS' && man.icons.length >= 4);
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true), null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  check('service worker active', await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active));
  const cached = await page.evaluate(async () => (await (await caches.open('techplug-pos-v1')).keys()).map((r) => new URL(r.url).pathname));
  check('app files saved', cached.includes('/') && cached.some((p) => p.endsWith('.js')), cached.join(','));

  // Cut the network and reload: the app must still open and take a sale.
  await ctx.setOffline(true);
  await page.reload(); await page.waitForSelector('.keypad', { timeout: 10000 });
  check('opens offline', true);
  for (const d of '1111') await page.click(`.keypad button:text-is("${d}")`);
  await page.waitForSelector('.items');
  await page.click('.item:has-text("Sadza & Beef")');
  await page.locator('button:has-text("Pay $")').last().click();
  await page.click('.dialog button:text-is("Exact")'); await page.locator('.dialog footer button').last().click();
  await page.waitForSelector('.done-number');
  check('sells offline', true);
  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify(out, null, 1));
  console.log('fails:', Object.values(out).filter((v) => v !== 'ok').length);
  await b.close();
})().catch((e) => { console.log(JSON.stringify(out, null, 1)); console.error(e.message); process.exit(1); });
