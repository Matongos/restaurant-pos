// New-restaurant wizard, web page + QR menu, online pick-up orders end to end, posters, console, connecting a device.
// Needs tests/cloud-mock.cjs running on :54321 and the app on :8765.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL = process.env.POS_URL || 'http://localhost:8765/';
const MOCK = 'http://localhost:54321';
const out = {}; const check = (n, c, d) => (out[n] = c ? 'ok' : `FAIL ${d ?? ''}`);
const j = async (p) => (await fetch(MOCK + p)).json();
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const ctxFor = async (opts = {}) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, ...opts });
    await ctx.addInitScript((m) => localStorage.setItem('restaurant-pos.cloud-url', m), MOCK);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page };
  };
  const pin = async (page, p) => { for (const d of p) await page.click(`.keypad button:text-is("${d}")`); await page.waitForTimeout(300); };
  const st = (page) => page.evaluate(() => (window.__pos ? window.__pos.state() : null));

  // ---- 1. New restaurant from the login screen (no demo PIN needed)
  const A = await ctxFor(); const a = A.page;
  await a.goto(URL); await a.waitForSelector('.keypad');
  check('setup links on login', await a.isVisible('a:has-text("New restaurant? Set it up")') && await a.isVisible('a:has-text("Connect to my restaurant")'));
  await a.click('a:has-text("New restaurant? Set it up")');
  await a.locator('label:has-text("Restaurant name") input').fill('Mama Rudo Eats');
  await a.locator('label:has-text("Town") input').fill('Kadoma');
  await a.waitForSelector('.slug-state.good');
  await a.click('.setup-nav button:has-text("Next")');
  await a.click('.setup-nav button:has-text("Next")');
  check('wizard asks for name', /Type your name/.test(await a.textContent('.error-text')));
  await a.locator('label:has-text("Your name") input').fill('rudo moyo');
  await a.locator('label:has-text("Choose your 4-digit PIN") input').fill('2468');
  await a.locator('label:has-text("Type it again") input').fill('2468');
  await a.click('.setup-nav button:has-text("Next")');
  await a.locator('label:has-text("Email") input').fill('rudo@example.com');
  await a.locator('label:has-text("password") input').fill('rudo-password-1');
  await a.click('button:has-text("Create my restaurant")');
  await a.waitForSelector('.topbar', { timeout: 20000 });
  let s = await st(a);
  check('wizard: owner signed in, no demo data', s.staff.length === 1 && s.staff[0].name === 'Rudo Moyo' && s.staff[0].pin === '2468' && s.customers.length === 0 && s.orders.length === 0 && !s.settings.trainingMode, JSON.stringify({ staff: s.staff.length, c: s.customers.length }));
  check('wizard: name set, sample menu kept', s.settings.restaurantName === 'Mama Rudo Eats' && s.menu.length > 5);
  let m = await j('/__state');
  check('wizard: restaurant online', m.restaurants.some((r) => r.slug === 'mama-rudo-eats') && m.records.some((r) => r.kind === 'menu'));

  // ---- 2. Website & QR menu settings
  await a.goto(URL + '#/settings'); await a.click('.tabs button:has-text("Website & QR menu")');
  await a.waitForSelector('.web-link');
  check('page link shown with QR', (await a.textContent('.web-url')).includes('#/r/mama-rudo-eats') && await a.isVisible('.web-link svg.qr'));
  await a.click('button[aria-label="Restaurant web page"]'); await a.waitForTimeout(300);
  await a.click('button[aria-label="QR menu"]'); await a.waitForTimeout(300);
  await a.click('button[aria-label="Online orders (pick-up)"]'); await a.waitForSelector('button[aria-label="Customers can order from their table"]');
  await a.locator('label:has-text("Phone") input').first().fill('0772 555 111');
  await a.locator('label:has-text("Opening hours") input').fill('Mon–Sat 7:00–20:00');
  await a.click('button:has-text("Save details")'); await a.waitForTimeout(600);
  m = await j('/__state');
  const r0 = m.restaurants.find((r) => r.slug === 'mama-rudo-eats');
  check('switches saved online', r0.web_page && r0.qr_menu && r0.online_orders && r0.public_info.phone === '0772 555 111');
  check('menu published', m.records.some((r) => r.kind === 'public' && r.id === 'menu'));
  check('nav shows Online orders', await a.isVisible('.nav-item:has-text("Online orders")'));

  // ---- 3. Customer opens the page on a phone
  const C = await ctxFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const c = C.page;
  await c.goto(URL + '#/r/mama-rudo-eats'); await c.waitForSelector('.pub-item');
  check('customer sees name and live menu', /Mama Rudo Eats/.test(await c.textContent('.pub-head')) && /menu is live/.test(await c.textContent('.pub-live')));
  check('customer sees opening hours', /Mon–Sat/.test(await c.textContent('.pub-info')));
  check('customer page has no PIN pad', !(await c.isVisible('.keypad')));
  // sold out on the till → shows on the page
  await a.goto(URL + '#/todays-menu'); await a.click('.toggle:has-text("Sadza & Fish")');
  await a.waitForTimeout(9500);
  await c.reload(); await c.waitForSelector('.pub-item');
  check('sold out shows on customer page', /Sold out today/.test(await c.textContent('.pub-item:has-text("Sadza & Fish")')));
  // order: 2 × Sadza & Beef (+ extra), 1 water
  await c.click('.pub-item:has-text("Sadza & Beef")');
  if (await c.isVisible('.pub-sheet .pub-check')) { await c.locator('.pub-check').first().click(); await c.click('.pub-sheet button:has-text("Add to order")'); }
  await c.click('.pub-item:has-text("Water 500ml")');
  await c.click('.pub-cartbar');
  await c.locator('.pub-field:has-text("Your name") input').fill('Tendai');
  await c.click('.pub-btn:has-text("Send order")');
  check('phone required', /phone number/.test(await c.textContent('.pub-error')));
  await c.locator('.pub-field:has-text("Phone") input').fill('0773 222 333');
  await c.click('.pub-btn:has-text("Send order")');
  await c.waitForSelector('.pub-status');
  check('customer sees waiting', /Waiting for the restaurant/.test(await c.textContent('.pub-status')));

  // ---- 4. The till gets it, accepts
  await a.goto(URL + '#/till'); await a.waitForSelector('.web-alert', { timeout: 15000 });
  check('till alert shows', /WEB 1/.test(await a.textContent('.web-alert')));
  await a.click('.web-alert button:has-text("Open")'); await a.waitForSelector('.web-card.new');
  check('order details on till', /Tendai/.test(await a.textContent('.web-card.new')) && /Water 500ml/.test(await a.textContent('.web-card.new')));
  await a.click('.web-card.new button:has-text("15 min")'); await a.waitForSelector('.web-card:not(.new)');
  s = await st(a);
  const local = s.orders.find((o) => o.online);
  check('accepted order in kitchen', local && local.status === 'in_kitchen' && local.table.name === 'WEB 1' && local.lines.length === 2);
  await c.waitForSelector('.pub-status.accepted', { timeout: 10000 });
  check('customer sees accepted + time', /Ready at about/.test(await c.textContent('.pub-status')));
  // kitchen marks it done → customer sees ready
  await a.goto(URL + '#/kitchen'); await a.waitForSelector('.ocard:has-text("WEB 1")');
  await a.locator('.ocard:has-text("WEB 1") .kitchen-tick').click();
  await c.waitForSelector('.pub-status.ready', { timeout: 20000 });
  check('customer sees ready', /Your food is ready/.test(await c.textContent('.pub-status')));
  // counter takes payment → collected
  await a.goto(URL + '#/online'); await a.waitForSelector('.web-card.ready');
  await a.click('.web-card.ready button:has-text("Take payment")');
  await a.click('.dialog button:text-is("Exact")'); await a.locator('.dialog footer button').last().click();
  await a.waitForTimeout(500);
  s = await st(a);
  check('paid on till', s.orders.find((o) => o.online).table.status === 'paid');
  await c.waitForSelector('.pub-status.collected', { timeout: 20000 });
  check('customer sees collected', true);
  const oo = (await j('/__online')).onlineOrders[0];
  check('server price used', Math.abs(oo.total - s.orders.find((o) => o.online).total) < 0.001, `${oo.total}`);

  // ---- 4b. Delivery: owner offers it, customer orders with an address, rider takes it, customer follows
  await a.goto(URL + '#/settings?tab=website'); await a.waitForSelector('button[aria-label="Deliver online orders"]');
  await a.click('button[aria-label="Deliver online orders"]');
  await a.locator('label:has-text("Delivery fee") input').fill('2');
  await a.locator('label:has-text("Where you deliver") input').fill('Kadoma town');
  await a.locator('label:has-text("Delivery fee") input').focus(); await a.locator('label:has-text("Where you deliver") input').focus(); await a.click('h3.cloud-h');
  await a.waitForTimeout(9500);
  m = await j('/__state');
  await c.goto(URL + '#/r/mama-rudo-eats'); await c.waitForSelector('.pub-item');
  await c.click('.pub-item:has-text("Water 500ml")'); await c.click('.pub-cartbar');
  check('customer can choose delivery', await c.isVisible('.pub-mode button:has-text("Delivery")') && /\$2\.00/.test(await c.textContent('.pub-mode')) && /Kadoma town/.test(await c.textContent('.pub-mode')));
  await c.click('.pub-mode button:has-text("Delivery")');
  check('total includes delivery', /Total \$3\.00/.test(await c.textContent('.pub-total')));
  await c.locator('.pub-field:has-text("Delivery address") textarea').fill('');
  await c.click('.pub-btn:has-text("Send order")');
  check('address required', /address/.test(await c.textContent('.pub-error')));
  await c.locator('.pub-field:has-text("Delivery address") textarea').fill('14 Moyo Street, near the clinic');
  await c.click('.pub-btn:has-text("Send order")');
  await c.waitForSelector('.pub-status');
  await a.goto(URL + '#/online'); await a.waitForSelector('.web-card.new', { timeout: 15000 });
  check('till sees delivery address and fee', /14 Moyo Street/.test(await a.textContent('.web-card.new')) && /includes delivery \$2\.00/.test(await a.textContent('.web-card.new')));
  await a.click('.web-card.new button:has-text("15 min")'); await a.waitForTimeout(500);
  s = await st(a);
  const dl = s.orders.find((o) => o.online && o.online.mode === 'delivery');
  check('accepted delivery: fee in total, address kept', dl && dl.total === 3 && dl.delivery && dl.delivery.address.includes('Moyo') && dl.delivery.fee === 2, JSON.stringify(dl && { t: dl.total, d: dl.delivery }));
  check('send out waits for the kitchen', await a.isDisabled('.web-card:has-text("Moyo") button:has-text("Send out")'));
  await a.goto(URL + '#/kitchen'); await a.waitForSelector('.ocard:has-text("WEB")');
  await a.locator(`.ocard:has-text("${dl.table.name}") .kitchen-tick`).click();
  await a.goto(URL + '#/online'); await a.waitForSelector('.web-card:has-text("Moyo")');
  await a.click('.web-card:has-text("Moyo") button:has-text("Send out")');
  await a.locator('.web-sendout input').fill('Blessing');
  await a.click('.web-sendout button:has-text("Rider has left")');
  await c.waitForSelector('.pub-status.out', { timeout: 20000 });
  check('customer sees on the way', /On the way/.test(await c.textContent('.pub-status')) && /14 Moyo Street/.test(await c.textContent('.pub')));
  check('till shows out with rider', /Out for delivery with Blessing/.test(await a.textContent('.web-card:has-text("Moyo")')));
  await a.click('.web-card:has-text("Moyo") button:has-text("Rider paid in")');
  await a.click('.dialog button:text-is("Exact")'); await a.locator('.dialog footer button').last().click();
  await c.waitForSelector('.pub-status.collected', { timeout: 20000 });
  check('customer sees delivered', /Delivered/.test(await c.textContent('.pub-status')));
  const od = (await j('/__online')).onlineOrders.find((x) => x.mode === 'delivery');
  check('server charged the delivery fee', od.total === 3 && od.delivery_fee === 2);

  // ---- 5. Decline + customer cancel
  await c.goto(URL + '#/r/mama-rudo-eats'); await c.waitForSelector('.pub-item');
  await c.click('.pub-item:has-text("Water 500ml")'); await c.click('.pub-cartbar'); await c.click('.pub-btn:has-text("Send order")');
  await c.waitForSelector('.pub-status');
  await a.goto(URL + '#/online'); await a.waitForSelector('.web-card.new', { timeout: 15000 });
  await a.click('.web-card.new button:has-text("Decline")');
  await c.waitForSelector('.pub-status.declined', { timeout: 10000 });
  check('customer sees declined', true);

  // ---- 6. Offline restaurant: QR menu not live, ordering refused
  await j('/__age');
  await c.goto(URL + '#/r/mama-rudo-eats'); await c.waitForSelector('.pub-off');
  check('offline: menu not live', /not live right now/.test(await c.textContent('.pub-off')) && !(await c.isVisible('.pub-item')));

  // ---- 7. Posters
  await a.goto(URL + '#/posters'); await a.waitForSelector('.poster');
  check('counter poster with QR', (await a.locator('.poster svg.qr').count()) >= 1 && /Scan to see the menu and order/.test(await a.textContent('.poster')));

  // ---- 8. Console
  await j('/__admin?email=rudo@example.com');
  const K = await ctxFor(); const k = K.page;
  await k.goto(URL + '#/console'); await k.locator('label:has-text("Email") input').fill('rudo@example.com');
  await k.locator('label:has-text("Password") input').fill('rudo-password-1'); await k.click('button:has-text("Sign in")');
  await k.waitForSelector('.console-table td');
  check('console lists restaurant', /Mama Rudo Eats/.test(await k.textContent('.console-table')) && /rudo@example.com/.test(await k.textContent('.console-table')));
  check('console tiles', (await k.locator('.console-tile').count()) === 8);
  await k.click('.console-table button:has-text("+30 days")'); await k.waitForTimeout(500);
  check('trial extended', /(5[89]|60) days left/.test(await k.textContent('.console-table')), await k.textContent('.console-table td:nth-child(3)'));
  const ev = (await j('/__online')).events;
  check('first opens counted (not customers or console)', ev.filter((e) => e.kind === 'first_open').length === 1, ev.length);

  // ---- 9. Connect a second device from the login screen
  const B = await ctxFor(); const bp = B.page;
  await bp.goto(URL); await bp.waitForSelector('.keypad');
  await bp.click('a:has-text("Connect to my restaurant")');
  await bp.locator('.cloud-form label:has-text("Email") input').fill('rudo@example.com');
  await bp.locator('.cloud-form label:has-text("Password") input').fill('rudo-password-1');
  await bp.click('.cloud-form button:has-text("Sign in")');
  await bp.click('.cloud-item button:has-text("Connect")');
  await bp.click('.cloud-warn button:has-text("Yes, download")');
  await bp.click('button:has-text("Go to sign in"), button:has-text("Done")');
  await bp.waitForSelector('.keypad');
  check('demo PINs hidden after connect', !(await bp.isVisible('text=Demo PINs')) && !(await bp.isVisible('a:has-text("New restaurant")')));
  await pin(bp, '2468'); await bp.waitForSelector('.topbar');
  check('owner PIN works on second device', true);

  // ---- 10. Owner cannot change the plan through the API
  const res = await a.evaluate(async (MOCK) => { const s = JSON.parse(localStorage.getItem('restaurant-pos.auth')); const r = await fetch(MOCK + '/rest/v1/restaurants?select=plan', { method: 'PATCH', headers: { apikey: 'x', Authorization: 'Bearer ' + s.accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'restaurant' }) }); return r.status; }, MOCK);
  check('owner cannot change plan (mock mirrors SQL)', res === 403);

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify(out, null, 1));
  console.log('fails:', Object.values(out).filter((v) => v !== 'ok').length);
  await b.close();
})().catch((e) => { console.log(JSON.stringify(out, null, 1)); console.error(e.message); process.exit(1); });
