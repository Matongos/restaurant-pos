// Full regression of the redesigned app: every critical flow, desktop and phone.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL = 'http://localhost:8765/';
const out = {};
const check = (name, cond, detail) => (out[name] = cond ? 'ok' : `FAIL ${detail ?? ''}`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const pin = async (p) => { await page.waitForSelector('.keypad'); for (const d of p) await page.click(`.keypad button:text-is("${d}")`); };
  const logout = async () => { await page.click('.user-btn'); await page.click('.user-pop button:has-text("Log out")'); };
  const confirmBtn = () => page.locator('.dialog footer button').last();
  const hash = () => page.evaluate(() => location.hash);

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Landing pages per role.
  for (const [p, want] of [['3333', '#/kitchen'], ['4444', '#/orders'], ['1234', '#/reports'], ['1111', '#/till']]) {
    await pin(p);
    await page.waitForFunction((w) => location.hash === w, want);
    check(`lands ${p}`, (await hash()) === want, await hash());
    if (p !== '1111') await logout();
  }

  // 1. Sale: short, then change with $1 kept for a new name.
  await page.waitForSelector('.items');
  await page.click('.item:has-text("Sadza & Beef")');
  await page.click('.item:has-text("Water 500ml")');
  check('qty badge', (await page.locator('.item:has-text("Sadza & Beef") .qty-badge').textContent()) === '1');
  await page.click('button:has-text("Pay $5.00")');
  await page.fill('#pay-amount', '3');
  check('short label', (await confirmBtn().textContent()).includes('Short by $2.00'));
  await page.fill('#pay-amount', '10');
  await page.fill('#hand-over', '4');
  await page.fill('#cust-name', 'Tatenda');
  check('confirm label', (await confirmBtn().textContent()).includes('give $4.00 change'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.done-number');
  await page.waitForTimeout(700);
  check('done shows kept', (await page.textContent('.done-number')).includes('$1.00 kept for Tatenda'));
  await page.click('text=Next customer');

  // 2. Pay with their change (Tendai $6) and collect change (Anashe Moyo via note).
  await page.click('.item:has-text("Rice & Chicken")');
  await page.click('button:has-text("Pay $4.00")');
  await page.click('button:has-text("Their change")');
  await page.click('.finder-row:has-text("Tendai")');
  check('paid by change', (await confirmBtn().textContent()).includes('Confirm'));
  await confirmBtn().click();
  await page.waitForSelector('.done-number');
  await page.click('text=Next customer');
  await page.click('button:has-text("Collect change")');
  await page.fill('#finder-search', 'mbare');
  await page.click('.finder-row:has-text("Anashe Moyo")');
  await page.click('.collect button.primary');
  check('collect toast', (await page.textContent('.toast')).includes('Gave $1.00'));

  // 3. Clear order button.
  await page.click('.item:has-text("Chips & Chicken")');
  await page.click('[aria-label="Clear order"]');
  check('cleared', (await page.locator('.line-row').count()) === 0);

  // 4. Orders: More → Mark ready isn't there for cashier; Served works; cancel with PIN.
  await page.click('.nav-item:has-text("Orders")');
  await page.waitForSelector('.ocard');
  await page.locator('.ocard').first().locator('.menu-wrap button').click();
  const moreItems = await page.locator('.menu-pop button').allTextContents();
  check('cashier more menu', moreItems.join('|') === 'Reprint ticket|Cancel sale', moreItems.join('|'));
  await page.click('.menu-pop button:has-text("Cancel sale")');
  await page.click('.dialog .seg button:has-text("Wrong item entered")');
  await page.fill('#manager-pin', '1111');
  await confirmBtn().click();
  check('wrong pin refused', (await page.textContent('.dialog .error')).includes('not a manager'));
  await page.fill('#manager-pin', '2222');
  await confirmBtn().click();
  check('cancel toast', (await page.textContent('.toast')).includes('cancelled'));
  await page.locator('.ocard button:has-text("Served")').first().click();
  check('served', (await page.locator('.ocard').count()) === 0);
  await logout();

  // 5. Manager: sold out hides beef meals; Books records and reverses.
  await pin('2222');
  await page.waitForSelector('.items');
  await page.click('.nav-item:has-text("Sold out")');
  await page.click('.toggle:has-text("Beef")');
  await page.click('.nav-item:has-text("Sell")');
  check('beef hidden', (await page.locator('.item:has-text("Beef")').count()) === 0);
  await page.click('.nav-item:has-text("Sold out")');
  await page.click('.toggle:has-text("Beef")');

  await page.click('.nav-item:has-text("Books")');
  await page.waitForSelector('.pl');
  await page.click('.an-tabs button:has-text("Expenses")');
  await page.click('button:has-text("Record an expense")');
  await page.click('.dialog .seg button:has-text("Water")');
  await page.fill('#exp-amount', '12');
  await page.click('.dialog footer button:has-text("Save expense")');
  await page.click('.an-controls button:has-text("Today")');
  await page.click('tr:has-text("Water · Water") button:has-text("Reverse")');
  await page.fill('#reverse-reason', 'Test');
  await page.click('.dialog footer button:has-text("Reverse it")');
  check('reversal row', (await page.locator('tr:has-text("reversal")').count()) === 1);
  await page.click('.an-tabs button:has-text("Cancellations")');
  check('cancellation logged', (await page.locator('table.list tbody tr:has-text("Wrong item entered")').count()) === 1);

  await page.click('.nav-item:has-text("Reports")');
  await page.waitForSelector('.metric-grid');
  for (const t of ['Busy times', 'What sells when', 'Serving speed', 'Money', 'Overview']) await page.click(`.an-tabs button:has-text("${t}")`);
  check('reports tabs', true);
  await logout();

  // 6. Owner: switch off EcoCash, InnBucks, Swipe → payment shows Cash + Their change.
  await pin('1234');
  await page.waitForSelector('.metric-grid');
  await page.goto(URL + '#/settings');
  await page.click('.tabs button:has-text("Payment methods")');
  for (const m of ['EcoCash', 'InnBucks', 'Swipe']) await page.click(`button[aria-label="Accept ${m}"]`);
  await page.click('.nav-item:has-text("Sell")');
  await page.click('.item:has-text("Water 500ml")');
  await page.click('button:has-text("Pay $1.00")');
  const methods = await page.locator('.pay-left .seg').first().locator('button').allTextContents();
  check('methods trimmed', methods.join('|') === 'Cash|Their change', methods.join('|'));
  await page.click('.dialog footer button:has-text("Back")');

  // 7. Phone layout: order bar, sheet, pay, More sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForSelector('.order-bar');
  check('order bar', (await page.textContent('.order-bar')).includes('$1.00'));
  await page.click('.order-bar');
  await page.waitForTimeout(250);
  await page.click('.ticket-panel button:has-text("Pay $1.00")');
  await page.fill('#pay-amount', '1');
  await confirmBtn().click();
  await page.waitForSelector('.done-number');
  await page.click('text=Next customer');
  await page.click('.rail-more');
  check('more has logout', (await page.locator('.more-sheet button:has-text("Log out")').count()) === 1);
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  check('no horizontal scroll (phone)', !overflowX);

  out.errors = errors;
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => {
  console.log(JSON.stringify(out, null, 2));
  console.error(e);
  process.exit(1);
});
