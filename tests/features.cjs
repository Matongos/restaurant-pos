// Website for first-time visitors, moving old saved data to IndexedDB, and the other November features.
// Needs the app on :8765 (with the short-link rewrite) and tests/cloud-mock.cjs on :54321.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL = process.env.POS_URL || 'http://localhost:8765/';
const MOCK = 'http://localhost:54321';
const out = {}; const check = (n, c, d) => (out[n] = c ? 'ok' : `FAIL ${d ?? ''}`);
(async () => {
  // pos.techplug.co.zw is pointed at this computer so the public-address rules can be tried.
  const b = await chromium.launch({ args: ['--host-resolver-rules=MAP pos.techplug.co.zw 127.0.0.1:8765'] });
  const errors = [];
  const fresh = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 860 } }); const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message)); return { c, p }; };

  // ---- 1. Website for first-time visitors on the public address
  {
    const { c, p } = await fresh();
    await p.goto('http://pos.techplug.co.zw/'); await p.waitForLoadState('load'); await p.waitForTimeout(800);
    check('new visitor sees the website', p.url().includes('/site/') && /Run your whole restaurant/.test(await p.textContent('body')), p.url());
    const appLink = await p.getAttribute('a[data-app]', 'href');
    check('website "Log in" opens the app', appLink === 'https://pos.techplug.co.zw/#/', appLink);
    await p.goto('http://pos.techplug.co.zw/#/'); await p.waitForSelector('.keypad');
    await p.goto('http://pos.techplug.co.zw/'); await p.waitForSelector('.keypad');
    check('after opening the app once, the address opens the app', !p.url().includes('/site/'), p.url());
    await p.goto('http://pos.techplug.co.zw/some-place?t=T2'); await p.waitForTimeout(800);
    check('restaurant short link not sent to website', p.url().includes('#/r/some-place?t=T2'), p.url());
    await c.close();
    const o = await fresh();
    await o.p.goto(URL); await o.p.waitForSelector('.keypad');
    check('other addresses (tills, Windows app) go straight to the app', true);
    await o.c.close();
  }

  // ---- 2. Data saved by an older version (localStorage) moves to IndexedDB and is kept
  {
    const { c, p } = await fresh();
    await p.goto(URL); await p.waitForSelector('.keypad');
    const st = await p.evaluate(() => window.__pos.state());
    st.settings.restaurantName = 'Old Version Diner';
    st.orders = st.orders.slice(0, 0);
    await p.evaluate((s) => { indexedDB.deleteDatabase('restaurant-pos'); localStorage.setItem('restaurant-pos.state.v1', JSON.stringify(s)); }, st);
    await p.reload(); await p.waitForSelector('.keypad');
    await p.waitForTimeout(500);
    const name = await p.evaluate(() => window.__pos.state().settings.restaurantName);
    const left = await p.evaluate(() => localStorage.getItem('restaurant-pos.state.v1'));
    check('old data moved to IndexedDB', name === 'Old Version Diner' && left === null, `${name} / ${left && left.length}`);
    await p.reload(); await p.waitForSelector('.keypad');
    check('still there after reload', (await p.evaluate(() => window.__pos.state().settings.restaurantName)) === 'Old Version Diner');
    // Lots of sales: more than the old 5 MB limit
    const big = await p.evaluate(async () => {
      const s = window.__pos.state();
      const o = s.orders[0] || null;
      const proto = { id: '', branchId: s.settings.branchId, tillId: 't1', number: 1, numberMode: 'card', orderTypeId: s.orderTypes[0].id, lines: [{ menuItemId: s.menu[0].id, name: s.menu[0].name, qty: 1, unitPrice: 4 }], total: 4, payments: [{ methodId: 'cash', currency: 'USD', amount: 4, amountBase: 4 }], changeGiven: 0, changeCurrency: 'USD', status: 'served', history: [{ status: 'placed', at: new Date().toISOString(), by: s.staff[0].id }], cashierId: s.staff[0].id, createdAt: new Date(Date.now() - 400 * 864e5).toISOString(), note: 'x'.repeat(400) };
      s.orders = Array.from({ length: 15000 }, (_, i) => ({ ...proto, id: 'big-' + i, number: (i % 99) + 1 }));
      void o;
      await window.__pos.put(s);
      return JSON.stringify(s).length;
    });
    await p.reload(); await p.waitForSelector('.keypad');
    const n = await p.evaluate(() => window.__pos.state().orders.length);
    check('saves far more than the old limit', n === 15000 && big > 6e6, `${n} orders, ${(big / 1e6).toFixed(1)} MB`);
    await c.close();
  }

  // ---- 3. Archiving: a new device gets the last 6 months; older sales stay online and can be loaded
  {
    await fetch(MOCK + '/__reset');
    const dev = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 860 } }); await c.addInitScript((m) => localStorage.setItem('restaurant-pos.cloud-url', m), MOCK); const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message)); return { c, p }; };
    const pin = async (p, code) => { for (const d of code) await p.click(`.keypad button:text-is("${d}")`); await p.waitForTimeout(300); };
    const A = await dev();
    await A.p.goto(URL); await A.p.waitForSelector('.keypad'); await pin(A.p, '1234');
    await A.p.evaluate(async () => {
      const s = window.__pos.state();
      const mk = (id, daysAgo) => ({ id, branchId: s.settings.branchId, tillId: 't1', number: 7, numberMode: 'card', orderTypeId: s.orderTypes[0].id, lines: [{ menuItemId: s.menu[0].id, name: s.menu[0].name, qty: 1, unitPrice: 4 }], total: 4, payments: [{ methodId: 'cash', currency: 'USD', amount: 4, amountBase: 4 }], changeGiven: 0, changeCurrency: 'USD', status: 'served', history: [], cashierId: s.staff[0].id, createdAt: new Date(Date.now() - daysAgo * 864e5).toISOString() });
      s.orders = [mk('old-1', 300), mk('old-2', 250), mk('new-1', 20)];
      await window.__pos.put(s);
    });
    await A.p.goto(URL + '#/settings'); await A.p.click('.tabs button:has-text("Online account")');
    const f = A.p.locator('.cloud-form');
    await f.locator('label:has-text("Restaurant name") input').fill('Archive Cafe');
    await A.p.waitForSelector('.slug-state.good');
    await f.locator('label:has-text("Your email") input').fill('arch@example.com');
    await f.locator('label:has-text("password") input').fill('archive-pass-1');
    await f.locator('button:has-text("Create account")').click();
    await A.p.waitForSelector('.cloud-state:has-text("Up to date")', { timeout: 20000 });
    const bd = await (await fetch(MOCK + '/__backdate')).json();
    check('old sales are old online', bd.n === 2, JSON.stringify(bd));
    const B = await dev();
    await B.p.goto(URL); await B.p.waitForSelector('.keypad'); await pin(B.p, '1234');
    await B.p.goto(URL + '#/settings'); await B.p.click('.tabs button:has-text("Online account")');
    await B.p.click('.seg button:has-text("I already have an account")');
    await B.p.locator('.cloud-form label:has-text("Email") input').fill('arch@example.com');
    await B.p.locator('.cloud-form label:has-text("Password") input').fill('archive-pass-1');
    await B.p.click('.cloud-form button:has-text("Sign in")');
    await B.p.click('.cloud-item button:has-text("Connect")');
    await B.p.click('.cloud-warn button:has-text("Yes, download")');
    await B.p.waitForSelector('.cloud-state', { timeout: 20000 });
    let ids = await B.p.evaluate(() => window.__pos.state().orders.map((o) => o.id).sort().join(','));
    check('new device: recent sales only', ids === 'new-1', ids);
    await B.p.goto(URL + '#/settings?tab=online'); await B.p.waitForSelector('.cloud-history');
    check('older sales offered', /Older sales are kept safely online/.test(await B.p.textContent('.cloud-history')));
    await B.p.goto(URL + '#/settings?tab=online'); await B.p.click('.cloud-history button:has-text("Load older sales")');
    await B.p.waitForSelector('.cloud-history', { state: 'detached', timeout: 15000 });
    ids = await B.p.evaluate(() => window.__pos.state().orders.map((o) => o.id).sort().join(','));
    check('older sales loaded', ids === 'new-1,old-1,old-2', ids);
    await A.c.close(); await B.c.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify(out, null, 1));
  console.log('fails:', Object.values(out).filter((v) => v !== 'ok').length);
  await b.close();
})();
