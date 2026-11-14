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

  // ---- 4. Branches: add a branch with the same menu, connect its till, see both branches' sales
  {
    await fetch(MOCK + '/__reset');
    const dev = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 860 } }); await c.addInitScript((m) => localStorage.setItem('restaurant-pos.cloud-url', m), MOCK); const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message)); return { c, p }; };
    const pin = async (p, code) => { for (const d of code) await p.click(`.keypad button:text-is("${d}")`); await p.waitForTimeout(300); };
    const sell = async (page, items) => {
      await page.goto(URL + '#/till'); await page.waitForSelector('.items');
      for (const m of items) await page.click(`.item:has-text("${m}")`);
      await page.locator('button:has-text("Pay $")').last().click(); await page.click('.dialog button:text-is("Exact")');
      await page.locator('.dialog footer button').last().click(); await page.waitForSelector('.done-number'); await page.click('text=Next customer');
    };
    const A = await dev();
    await A.p.goto(URL); await A.p.waitForSelector('.keypad'); await pin(A.p, '1234');
    await A.p.evaluate(() => window.__pos.put({ ...window.__pos.state(), settings: { ...window.__pos.state().settings, trainingMode: false } }));
    await A.p.goto(URL + '#/settings'); await A.p.click('.tabs button:has-text("Online account")');
    const f = A.p.locator('.cloud-form');
    await f.locator('label:has-text("Restaurant name") input').fill('Tete Foods');
    await A.p.waitForSelector('.slug-state.good');
    await f.locator('label:has-text("Your email") input').fill('tete@example.com');
    await f.locator('label:has-text("password") input').fill('tete-pass-12');
    await f.locator('button:has-text("Create account")').click();
    await A.p.waitForSelector('.cloud-state:has-text("Up to date")', { timeout: 20000 });
    await A.p.goto(URL + '#/branches'); await A.p.waitForSelector('.branch-table');
    check('branches nav for owner', await A.p.isVisible('.nav-item:has-text("Branches")'));
    check('one branch at first', (await A.p.locator('.branch-table tbody tr').count()) === 1);
    await A.p.click('button:has-text("Add a branch")');
    await A.p.locator('.branch-add label:has-text("Branch name") input').fill('Tete Foods Mbare');
    await A.p.locator('.branch-add label:has-text("Town") input').fill('Mbare');
    await A.p.waitForSelector('.branch-add .slug-state.good');
    await A.p.click('.branch-add button:has-text("Add branch")');
    await A.p.waitForSelector('.branch-add', { state: 'detached', timeout: 15000 });
    await A.p.waitForFunction(() => document.querySelectorAll('.branch-table tbody tr').length === 2);
    check('branch added and listed', /Tete Foods Mbare/.test(await A.p.textContent('.branch-table')) && /Main/.test(await A.p.textContent('.branch-table')));
    // the branch's till
    const B = await dev();
    await B.p.goto(URL); await B.p.waitForSelector('.keypad');
    await B.p.click('a:has-text("Connect to my restaurant")');
    await B.p.locator('label:has-text("Email") input').fill('tete@example.com');
    await B.p.locator('label:has-text("Password") input').fill('tete-pass-12');
    await B.p.click('button:has-text("Sign in")');
    await B.p.waitForSelector('.cloud-item');
    check('both branches offered when connecting', (await B.p.locator('.cloud-item').count()) === 2);
    await B.p.click('.cloud-item:has-text("Mbare") button:has-text("Connect")');
    await B.p.click('.cloud-warn button:has-text("Yes, download")');
    await B.p.waitForSelector('button:has-text("Go to sign in"), button:has-text("Done")', { timeout: 20000 }).catch(async () => { await B.p.screenshot({ path: '/tmp/claude-0/-home-claude/12c690c4-35da-5133-8bd0-05d676f81acb/scratchpad/bfail.png' }); throw new Error('connect stuck: ' + (await B.p.textContent('body')).slice(0, 400)); });
    const bs = await B.p.evaluate(() => window.__pos.state());
    const as = await A.p.evaluate(() => window.__pos.state());
    check('branch got the same menu and owner, no sales', bs.menu.length === as.menu.length && bs.staff.length === 1 && bs.staff[0].pin === '1234' && bs.orders.length === 0 && bs.settings.restaurantName === 'Tete Foods Mbare', `${bs.menu.length}/${as.menu.length} staff ${bs.staff.length} orders ${bs.orders.length} ${bs.settings.restaurantName}`);
    await B.p.goto(URL); await B.p.waitForSelector('.keypad'); await pin(B.p, '1234');
    await sell(B.p, ['Sadza & Beef']); await sell(B.p, ['Rice & Chicken']);
    await sell(A.p, ['Water 500ml']);
    await B.p.waitForTimeout(2500); await A.p.waitForTimeout(1500);
    await A.p.goto(URL + '#/branches'); await A.p.waitForSelector('.branch-table');
    await A.p.click('button:has-text("Refresh")'); await A.p.waitForTimeout(800);
    const mb = await A.p.textContent('.branch-table tr:has-text("Mbare")');
    const tot = await A.p.textContent('.branch-totals');
    check('owner sees the branch\'s sales', /2 sales/.test(mb), mb);
    check('totals add up all branches', /3 sales/.test(tot), tot);
    await A.p.screenshot({ path: process.env.SHOT_BRANCHES || '/tmp/claude-0/-home-claude/12c690c4-35da-5133-8bd0-05d676f81acb/scratchpad/branches.png' });
    // single-restaurant plan: no adding
    await fetch(MOCK + '/__plan?slug=tete-foods&plan=restaurant');
    await A.p.evaluate(() => localStorage.removeItem('restaurant-pos.restaurant-info'));
    await A.p.reload(); await A.p.waitForSelector('.keypad').catch(() => {});
    if (await A.p.isVisible('.keypad')) await pin(A.p, '1234');
    await A.p.goto(URL + '#/branches'); await A.p.waitForSelector('.branch-table'); await A.p.waitForTimeout(1500);
    check('single plan: no add button, plan explained', !(await A.p.isVisible('button:has-text("Add a branch")')) && /Group plan/.test(await A.p.textContent('.branch-page')));
    // Switch restaurant from the PIN screen (owner only)
    await B.p.evaluate(() => sessionStorage.clear()); await B.p.goto(URL); await B.p.reload(); await B.p.waitForSelector('.keypad');
    check('switch link on a connected till', await B.p.isVisible('button:has-text("Switch restaurant")') && !(await B.p.isVisible('a:has-text("Connect to my restaurant")')));
    await B.p.click('button:has-text("Switch restaurant")');
    await B.p.locator('.dialog label:has-text("Owner\'s PIN") input').fill('1111');
    await B.p.click('.dialog button:has-text("Continue")');
    check('cashier PIN refused', /not the owner's PIN/.test(await B.p.textContent('.dialog .error')));
    await B.p.locator('.dialog label:has-text("Owner\'s PIN") input').fill('1234');
    await B.p.click('.dialog button:has-text("Continue")');
    await B.p.click('.dialog button:has-text("Switch restaurant")');
    await B.p.waitForSelector('text=Connect this device to your restaurant', { timeout: 15000 });
    check('switched: signed out, ready to connect', (await B.p.evaluate(() => localStorage.getItem('restaurant-pos.cloud'))) === null);
    await A.c.close(); await B.c.close();
  }

  // ---- 5. Trial over: selling pauses (after the grace days); unpaused as soon as the plan is switched on
  {
    await fetch(MOCK + '/__reset');
    const c = await b.newContext({ viewport: { width: 1280, height: 860 } }); await c.addInitScript((m) => localStorage.setItem('restaurant-pos.cloud-url', m), MOCK);
    const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(URL); await p.waitForSelector('.keypad');
    await p.click('a:has-text("New restaurant? Set it up")');
    await p.locator('label:has-text("Restaurant name") input').fill('Paused Place');
    await p.waitForSelector('.slug-state.good');
    await p.click('.setup-nav button:has-text("Next")');
    await p.locator('label:has-text("Your name") input').fill('Farai Dube');
    await p.locator('label:has-text("Choose your 4-digit PIN") input').fill('2580');
    await p.locator('label:has-text("Type it again") input').fill('2580');
    await p.click('.setup-nav button:has-text("Next")');
    await p.locator('label:has-text("Email") input').fill('farai@example.com');
    await p.locator('label:has-text("password") input').fill('farai-pass-1');
    await p.click('button:has-text("Create my restaurant")');
    await p.waitForSelector('.topbar', { timeout: 20000 });
    await p.goto(URL + '#/till'); await p.waitForSelector('.items');
    check('selling works during the trial', true);
    await fetch(MOCK + '/__plan?slug=paused-place&plan=trial&ended=1');
    // The till re-reads its plan every 5 minutes; a restart reads it at once.
    await p.reload(); await p.waitForTimeout(1000);
    if (await p.isVisible('.keypad')) for (const d of '2580') await p.click(`.keypad button:text-is("${d}")`);
    await p.goto(URL + '#/till');
    await p.waitForSelector('.paused-card', { timeout: 30000 });
    check('trial over: Sell shows paused', /New sales are paused/.test(await p.textContent('.paused-card')) && /free trial has ended/.test(await p.textContent('.paused-card')));
    await p.goto(URL + '#/reports'); await p.waitForTimeout(500);
    check('reports still open while paused', !(await p.isVisible('.paused-card')));
    await fetch(MOCK + '/__plan?slug=paused-place&plan=restaurant');
    await p.goto(URL + '#/till'); await p.waitForSelector('.items', { timeout: 30000 });
    check('plan switched on: selling back by itself', !(await p.isVisible('.paused-card')));
    await c.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify(out, null, 1));
  console.log('fails:', Object.values(out).filter((v) => v !== 'ok').length);
  await b.close();
})();
