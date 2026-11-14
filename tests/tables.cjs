// Table service: switch on, seat, send rounds, kitchen, served, bill, split 3 ways, pay, close. Counter mode unchanged.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL = process.env.POS_URL || 'http://localhost:8765/';
const OUT = require('os').tmpdir() + '/pos-tables/'; require('fs').mkdirSync(OUT, { recursive: true });
const out = {}; const check = (n, c, d) => (out[n] = c ? 'ok' : `FAIL ${d ?? ''}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const pin = async (p) => { await page.waitForSelector('.keypad'); for (const d of p) await page.click(`.keypad button:text-is("${d}")`); };
  const logout = async () => { await page.click('.user-btn'); await page.click('.user-pop button:has-text("Log out")'); };
  const st = () => page.evaluate(() => (window.__pos ? window.__pos.state() : null));
  const payExact = async () => { await page.click('.dialog button:text-is("Exact")'); await page.locator('.dialog footer button').last().click(); await page.waitForTimeout(250); };
  await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.reload();

  // Counter mode by default: no Tables in the menu.
  await pin('1234'); await page.waitForTimeout(400);
  check('off by default: no Tables nav', (await page.locator('.nav-item:has-text("Tables")').count()) === 0);
  // Owner switches it on.
  await page.goto(URL + '#/settings'); await page.click('button:has-text("How you serve")');
  await page.click('.mode-card:has-text("Both")');
  check('mode saved', (await st()).settings.serviceMode === 'both');
  await page.screenshot({ path: OUT + 'd0-settings.png', fullPage: true });
  await page.click('button:has-text("Add table")');
  await page.click('button:has-text("Save tables")');
  check('table added', (await st()).settings.tables.length === 11);
  check('Tables nav shown', (await page.locator('.nav-item:has-text("Tables")').count()) > 0);
  await logout();

  // Waiter lands on Tables.
  await pin('4444'); await page.waitForSelector('.table-grid');
  check('waiter home = tables', page.url().includes('#/tables'));
  check('all free', (await page.locator('.tcard.free').count()) === 11);
  await page.click('.tcard:has(.tn:text-is("T4"))');
  await page.click('.split-pick button:text-is("3")');
  await page.waitForSelector('.table-bar');
  check('till in table mode', (await page.locator('.table-bar .big').textContent()) === 'T4');
  await page.click('.item:has-text("Sadza & Beef")'); await page.click('.item:has-text("Sadza & Beef")'); await page.click('.item:has-text("Rice & Chicken")');
  check('no pay button at table', (await page.locator('button:has-text("Pay $")').count()) === 0);
  await page.click('.send-btn');
  await page.waitForTimeout(300);
  let s = await st();
  const r1 = s.orders.find((o) => o.table && o.table.round === 1);
  check('round 1 created unpaid', r1 && r1.payments.length === 0 && r1.status === 'in_kitchen' && r1.table.guests === 3);
  check('sent rounds shown', (await page.locator('.sent-round').count()) === 1);
  // Round 2: a drink later.
  await page.click('.item:has-text("Coke")').catch(() => {});
  if ((await page.locator('.ticket-panel .line, .lines .line').count()) === 0) await page.locator('.item').nth(5).click();
  await page.click('.send-btn'); await page.waitForTimeout(300);
  s = await st();
  check('round 2 linked to round 1', s.orders.some((o) => o.table && o.table.round === 2 && o.parentOrderId === r1.id));
  await page.screenshot({ path: OUT + 'd1-table-till.png' });
  await page.goto(URL + '#/tables'); await page.waitForSelector('.table-grid');
  check('T4 busy', (await page.locator('.tcard.ordering:has(.tn:text-is("T4"))').count()) === 1);
  await logout();

  // Kitchen sees table and round, ticks both.
  await pin('3333'); await page.goto(URL + '#/kitchen'); await page.waitForSelector('.ocard');
  const ktext = await page.locator('.order-grid').textContent();
  check('kitchen shows T4 round 1 & 2', ktext.includes('T4') && ktext.includes('ROUND 1') && ktext.includes('ROUND 2'), ktext.slice(0, 200));
  await page.screenshot({ path: OUT + 'd2-kitchen.png' });
  while (await page.locator('.kitchen-tick').count()) { await page.locator('.kitchen-tick').first().click(); await page.waitForTimeout(150); }
  await logout();

  // Waiter: food ready → Served → Bill → split equally 3.
  await pin('4444'); await page.waitForSelector('.table-grid');
  check('T4 food ready', (await page.locator('.tcard.ready:has(.tn:text-is("T4"))').count()) === 1);
  await page.click('.tcard:has(.tn:text-is("T4"))'); await page.waitForSelector('.table-bar');
  await page.click('.tb-served'); await page.waitForTimeout(200);
  s = await st();
  check('rounds served', s.orders.filter((o) => o.table).every((o) => o.status === 'served'));
  await page.click('.bill-btn'); await page.waitForSelector('.bill-dialog');
  s = await st();
  const tab = s.orders.find((o) => o.table && o.table.round === 1);
  const total = s.orders.filter((o) => o.table).reduce((a, o) => a + o.total, 0);
  check('billed', tab.table.status === 'billed');
  await page.click('.split-modes button:has-text("Split equally")');
  check('3 people from guests', (await page.locator('.person').count()) === 3);
  await page.screenshot({ path: OUT + 'd3-bill-equal.png' });
  await page.locator('.person button:text-is("Pay")').first().click();
  await page.waitForSelector('.dialog:has-text("Payment · Person 1")');
  await payExact();
  s = await st();
  const share1 = s.orders.find((o) => o.id === tab.id).table.shares;
  check('share 1 paid', share1.length === 1 && Math.abs(share1[0].amount - Math.round((total / 3) * 100) / 100) < 0.02, JSON.stringify(share1));
  await page.waitForSelector('.bill-dialog');
  check('person 1 marked paid', (await page.locator('.person.paid').count()) === 1);
  // By amount for the next: pay $5, then the rest by item… just pay the rest.
  await page.click('.split-modes button:has-text("By amount")');
  await page.fill('.bill-dialog input.plain-input', '5');
  await page.click('.bill-dialog button:has-text("Pay $5")');
  await page.waitForSelector('.dialog:has-text("Payment · Part payment")'); await payExact();
  await page.waitForSelector('.bill-dialog');
  await page.click('.bill-dialog button:has-text("Pay the rest")');
  await page.waitForSelector('.dialog:has-text("Payment · Part payment")'); await payExact();
  await page.waitForTimeout(400);
  s = await st();
  const closed = s.orders.find((o) => o.id === tab.id);
  const paid = closed.table.shares.reduce((a, x) => a + x.amount, 0);
  check('table paid in full', closed.table.status === 'paid' && Math.abs(paid - total) < 0.005, `${closed.table.status} ${paid} ${total}`);
  check('back on tables, T4 free', page.url().includes('#/tables') && (await page.locator('.tcard.free:has(.tn:text-is("T4"))').count()) === 1);
  await logout();

  // Cashier in Both: starts on Sell; counter sale still works and still gets a number.
  await pin('1111'); await page.waitForSelector('.items');
  check('cashier home = till', page.url().includes('#/till'));
  check('Table button on till', (await page.locator('.type-toggle .to-tables').count()) === 1);
  await page.click('.item:has-text("Sadza & Beef")'); await page.click('.type-toggle button.take_away');
  await page.locator('button:has-text("Pay $")').last().click(); await payExact();
  check('counter sale done', (await page.locator('.done-number').count()) === 1);
  await page.click('text=Next customer');
  await logout();

  // Cancel an open table needs a manager PIN; Tables-only hides Sell.
  await pin('1234'); await page.goto(URL + '#/settings'); await page.click('button:has-text("How you serve")');
  await page.click('.mode-card:has-text("Tables only")');
  await page.waitForTimeout(200);
  check('tables only: Sell hidden', (await page.locator('.nav-item:text-is("Sell")').count()) === 0);
  await page.goto(URL + '#/tables'); await page.click('.tcard:has(.tn:text-is("T1"))'); await page.click('.split-pick button:text-is("2")');
  await page.click('.item:has-text("Sadza & Beef")'); await page.click('.send-btn'); await page.waitForTimeout(200);
  await page.goto(URL + '#/settings'); await page.click('button:has-text("How you serve")');
  await page.click('.mode-card:has-text("Counter only")');
  check('cannot switch off with open table', (await st()).settings.serviceMode === 'tables');

  // Phone layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL + '#/tables'); await page.waitForSelector('.table-grid');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('phone: no sideways scroll', !overflow);
  await page.screenshot({ path: OUT + 'm1-tables.png', fullPage: true });
  await page.click('.tcard:has(.tn:text-is("T1"))'); await page.waitForSelector('.table-bar');
  await page.screenshot({ path: OUT + 'm2-table-till.png' });
  check('phone till: no sideways scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify(out, null, 1));
  console.log('fails:', Object.values(out).filter((v) => v !== 'ok').length);
  await b.close();
})();
