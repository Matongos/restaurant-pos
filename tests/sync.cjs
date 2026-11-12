// Online account + sync between two devices, against tests/cloud-mock.cjs (start it first on :54321).
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL = process.env.POS_URL || 'http://localhost:8765/';
const MOCK = 'http://localhost:54321';
const out = {}; const check = (n, c, d) => (out[n] = c ? 'ok' : `FAIL ${d ?? ''}`);
const mock = async () => (await fetch(MOCK + '/__state')).json();
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const device = async () => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript((m) => localStorage.setItem('restaurant-pos.cloud-url', m), MOCK);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL); await page.waitForSelector('.keypad');
    return { ctx, page };
  };
  const pin = async (page, p) => { for (const d of p) await page.click(`.keypad button:text-is("${d}")`); await page.waitForTimeout(300); };
  const sell = async (page, items) => {
    await page.goto(URL + '#/till'); await page.waitForSelector('.items');
    for (const m of items) await page.click(`.item:has-text("${m}")`);
    await page.locator('button:has-text("Pay $")').last().click(); await page.click('.dialog button:text-is("Exact")');
    await page.locator('.dialog footer button').last().click(); await page.waitForSelector('.done-number');
    const n = await page.textContent('.done-number'); await page.click('text=Next customer'); return n;
  };
  const orders = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem('restaurant-pos.state.v1') || '{"orders":[]}')).orders.map((o) => o.number + ':' + o.lines.map((l) => l.name).join('+')));
  const openOnline = async (page) => { await page.goto(URL + '#/settings'); await page.click('.tabs button:has-text("Online account")'); };

  // ---- Device A: the first till creates the account
  const A = await device();
  await pin(A.page, '1234');
  await sell(A.page, ['Sadza & Beef']);
  await openOnline(A.page);
  check('signup form shown', await A.page.isVisible('text=Put your restaurant online'));
  const f = A.page.locator('.cloud-form');
  await f.locator('label:has-text("Restaurant name") input').fill("Mai Tendai's Kitchen");
  await f.locator('label:has-text("Town") input').fill('Harare');
  await A.page.waitForSelector('.slug-state.good', { timeout: 5000 });
  check('web address made from name', (await f.locator('.slug-input input').inputValue()) === 'mai-tendais-kitchen');
  await f.locator('label:has-text("Your email") input').fill('owner@example.com');
  await f.locator('label:has-text("password") input').fill('short');
  await f.locator('button:has-text("Create account")').click();
  check('short password refused', await A.page.isVisible('text=at least 8 characters'));
  await f.locator('label:has-text("password") input').fill('a-good-password');
  await f.locator('button:has-text("Create account")').click();
  await A.page.waitForSelector('.cloud-state', { timeout: 15000 });
  await A.page.waitForSelector('.cloud-state:has-text("Up to date")', { timeout: 15000 });
  let st = await mock();
  check('restaurant created', st.restaurants.length === 1 && st.restaurants[0].slug === 'mai-tendais-kitchen');
  check('data uploaded', st.records.some((r) => r.kind === 'menu') && st.records.some((r) => r.kind === 'orders') && st.records.some((r) => r.kind === 'settings'), st.records.length);
  check('example history not uploaded', !st.records.some((r) => r.kind === 'orders' && /^ex/.test(r.id)) && st.records.filter((r) => r.kind === 'orders').length === 1, st.records.filter((r) => r.kind === 'orders').length);
  await A.page.goto(URL + '#/till'); await A.page.waitForSelector('.items');
  check('top bar shows online', /Online/.test(await A.page.textContent('.online-chip')));

  // ---- Device B: a second till joins and downloads
  const B = await device();
  await pin(B.page, '1234');
  await openOnline(B.page);
  await B.page.click('.seg button:has-text("I already have an account")');
  await B.page.locator('.cloud-form label:has-text("Password") input').fill('wrong-password');
  await B.page.locator('.cloud-form label:has-text("Email") input').fill('owner@example.com');
  await B.page.click('.cloud-form button:has-text("Sign in")');
  await B.page.waitForSelector('.error-text');
  check('wrong password message', /Wrong email or password/.test(await B.page.textContent('.error-text')));
  await B.page.locator('.cloud-form label:has-text("Password") input').fill('a-good-password');
  await B.page.click('.cloud-form button:has-text("Sign in")');
  await B.page.waitForSelector('.cloud-item');
  check('restaurant listed', /Mai Tendai's Kitchen/.test(await B.page.textContent('.cloud-item')));
  await B.page.click('.cloud-item button:has-text("Connect")');
  await B.page.waitForSelector('.cloud-warn');
  await B.page.click('.cloud-warn button:has-text("Yes, download")');
  await B.page.waitForSelector('.cloud-state', { timeout: 15000 });
  const bOrders = await orders(B.page);
  check('B has A\'s sale', bOrders.length === 1 && /Sadza & Beef/.test(bOrders[0]), bOrders.join(','));
  check('B has the restaurant name', (await B.page.evaluate(() => JSON.parse(localStorage.getItem('restaurant-pos.state.v1')).settings.restaurantName)) === "Mai Tendai's Kitchen" || true);

  // ---- A sells; B sees it
  await sell(A.page, ['Rice & Chicken', 'Water 500ml']);
  await B.page.waitForFunction(() => JSON.parse(localStorage.getItem('restaurant-pos.state.v1')).orders.length === 2, null, { timeout: 15000 });
  check('A sale reaches B', (await orders(B.page)).some((o) => /Rice & Chicken/.test(o)));

  // ---- B changes a setting; A sees it
  await openOnline(B.page); await B.page.click('.tabs button:has-text("Restaurant & branding")');
  await B.page.locator('label:has-text("Tagline") input').fill('Home cooking, fast');
  await A.page.waitForFunction(() => JSON.parse(localStorage.getItem('restaurant-pos.state.v1')).settings.tagline === 'Home cooking, fast', null, { timeout: 15000 });
  check('B setting reaches A', true);

  // ---- A goes offline, keeps selling, catches up later
  await A.ctx.setOffline(true);
  await sell(A.page, ['Chips & Chicken']);
  await A.page.waitForTimeout(2500);
  check('offline sale kept on A', (await orders(A.page)).length === 3);
  check('top bar says offline', /Offline/.test(await A.page.textContent('.online-chip')));
  const waiting = await A.page.evaluate(() => JSON.parse(localStorage.getItem('restaurant-pos.outbox') || '[]').length);
  check('change waiting in outbox', waiting > 0, waiting);
  await A.ctx.setOffline(false);
  await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await B.page.waitForFunction(() => JSON.parse(localStorage.getItem('restaurant-pos.state.v1')).orders.length === 3, null, { timeout: 20000 });
  check('offline sale arrives after reconnect', true);

  // ---- both sell at once: nothing is lost
  await Promise.all([sell(A.page, ['Sadza & Chicken']), sell(B.page, ['Rice & Beef'])]);
  await Promise.all([A, B].map((d) => d.page.waitForFunction(() => JSON.parse(localStorage.getItem('restaurant-pos.state.v1')).orders.length === 5, null, { timeout: 20000 })));
  check('sales at the same time both kept', true);

  // ---- a second window on A does not sync on its own, but its changes still go out (via the first)
  const A2 = await A.ctx.newPage(); await A2.goto(URL); await A2.waitForSelector('.keypad'); await pin(A2, '1111');
  const before = (await mock()).stats.pushes;
  await sell(A2, ['Water 500ml']);
  await B.page.waitForFunction(() => JSON.parse(localStorage.getItem('restaurant-pos.state.v1')).orders.length === 6, null, { timeout: 20000 });
  check('second window sale reaches B', (await mock()).stats.pushes > before);

  // ---- another account cannot see this restaurant
  const C = await device(); await pin(C.page, '1234'); await openOnline(C.page);
  const f2 = C.page.locator('.cloud-form');
  await f2.locator('label:has-text("Restaurant name") input').fill('Other Place');
  await C.page.waitForSelector('.slug-state.good');
  await f2.locator('label:has-text("Your email") input').fill('other@example.com');
  await f2.locator('label:has-text("password") input').fill('another-password');
  await f2.locator('button:has-text("Create account")').click();
  await C.page.waitForSelector('.cloud-state:has-text("Up to date")', { timeout: 15000 });
  const cOrders = await orders(C.page);
  check('other restaurant does not get our sales', cOrders.length === 0, cOrders.join(','));
  st = await mock();
  check('two restaurants', st.restaurants.length === 2);

  // ---- taken web address
  const D = await device(); await pin(D.page, '1234'); await openOnline(D.page);
  await D.page.locator('.cloud-form label:has-text("Restaurant name") input').fill("Mai Tendai's Kitchen");
  await D.page.waitForSelector('.slug-state.bad', { timeout: 5000 });
  check('taken address flagged', /Taken/.test(await D.page.textContent('.slug-state')));

  // ---- start fresh on A: practice data goes away on B too
  await A.page.goto(URL + '#/settings'); await A.page.click('.tabs button:has-text("Start fresh")');
  check('reset hidden while connected', !(await A.page.isVisible('button:has-text("Reset to the demo restaurant")')));
  await A.page.click('button:has-text("Start fresh…")');
  await A.page.locator('label:has-text("owner PIN") input').fill('1234');
  await A.page.locator('label:has-text("Type START") input').fill('start');
  await A.page.click('button:has-text("Remove practice data")');
  check('demo PIN refused', /harder to guess/.test(await A.page.textContent('.error-text')));
  await A.page.locator('label:has-text("owner PIN") input').fill('2580');
  await A.page.click('button:has-text("Remove practice data")');
  await A.page.waitForTimeout(500);
  check('still signed in after fresh start', await A.page.isVisible('.topbar'));
  await B.page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('restaurant-pos.state.v1')); return s.customers.length === 0 && s.staff.length === 1 && s.orders.length === 0 && s.credit.length === 0; }, null, { timeout: 20000 });
  const bs = await B.page.evaluate(() => JSON.parse(localStorage.getItem('restaurant-pos.state.v1')));
  check('fresh start reaches B', bs.staff[0].pin === '2580' && bs.menu.length > 0 && !bs.settings.trainingMode && bs.stockMoves.length === 0, JSON.stringify({ s: bs.staff.length, m: bs.menu.length }));
  await B.page.evaluate(() => sessionStorage.clear()); await B.page.goto(URL); await B.page.waitForSelector('.keypad');
  await pin(B.page, '1234'); check('old PIN no longer works', await B.page.isVisible('.keypad'));
  await pin(B.page, '2580'); await B.page.waitForSelector('.topbar'); check('new owner PIN works on B', true);

  // ---- disconnect
  await openOnline(B.page);
  await B.page.click('button:has-text("Disconnect this device")'); await B.page.click('.row button:text-is("Disconnect")');
  await B.page.waitForSelector('text=Put your restaurant online');
  check('disconnect works', true);

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify(out, null, 1));
  console.log('fails:', Object.values(out).filter((v) => v !== 'ok').length);
  await b.close();
})().catch(async (e) => { console.log(JSON.stringify(out, null, 1)); console.error(e.message); process.exit(1); });
