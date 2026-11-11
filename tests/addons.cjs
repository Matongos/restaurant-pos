const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL = 'http://localhost:8765/'; const OUT = require('os').tmpdir() + '/pos-addons/'; require('fs').mkdirSync(OUT, { recursive: true });
const out = {}; const check = (n, c, d) => (out[n] = c ? 'ok' : `FAIL ${d ?? ''}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const pin = async (p) => { await page.waitForSelector('.keypad'); for (const d of p) await page.click(`.keypad button:text-is("${d}")`); };
  const logout = async () => { await page.click('.user-btn'); await page.click('.user-pop button:has-text("Log out")'); };
  await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.reload();
  await pin('1111'); await page.waitForSelector('.items');
  // 3 × Sadza & Beef, then Extra meat on 2 of them.
  for (let i = 0; i < 3; i++) await page.click('.item:has-text("Sadza & Beef")');
  await page.click('.ticket-panel .line-row:has-text("Sadza & Beef") .addon-chip:has-text("Extra")');
  await page.waitForSelector('.addon-pick');
  const pick = await page.locator('.addon-pick button').allTextContents();
  check('picker lists add-ons', pick.join('|').includes('Extra meat') && pick.join('|').includes('free'), pick.join('|'));
  await page.screenshot({ path: OUT + 'd1-picker.png' });
  await page.click('.addon-pick button:has-text("Extra meat")');
  await page.waitForSelector('.split-pick'); await page.click('.split-pick button:text-is("2")');
  const rows = await page.locator('.ticket-panel .lines .line-row').count();
  check('split into 2 lines', rows === 2, rows);
  const total = await page.locator('.pay-btn').first().textContent();
  check('total 3×4 + 2×1.50 = $15.00', total.includes('$15.00'), total);
  // Free extra gravy on the 2 plates with meat, Fried egg not offered with sadza.
  await page.locator('.ticket-panel .line-row').nth(1).locator('.addon-chip:has-text("Extra")').last().click();
  const pick2 = await page.locator('.addon-pick button').allTextContents();
  check('egg not offered with sadza', !pick2.join('|').includes('egg'), pick2.join('|'));
  await page.click('.addon-pick button:has-text("Extra gravy")'); await page.click('.split-pick button.all');
  const t2 = await page.locator('.pay-btn').first().textContent();
  check('free gravy keeps total', t2.includes('$15.00'), t2);
  await page.screenshot({ path: OUT + 'd2-lines.png' });
  // Customer display shows the extras.
  const p2 = await ctx.newPage(); await p2.goto(URL + '#/display?till=till-1'); await p2.waitForTimeout(600);
  check('display shows extra', (await p2.textContent('.clines')).includes('+ Extra meat'));
  await p2.screenshot({ path: OUT + 'd3-display.png' }); await p2.close();
  // Take meat off one of the 2 → lines merge back.
  await page.locator('.ticket-panel .line-row').nth(1).locator('.addon-chip.on:has-text("Extra meat")').click();
  await page.click('.split-pick button:text-is("1")');
  const lbl = await page.locator('.ticket-panel .lines .line-row').allTextContents();
  check('remove from one plate', (await page.locator('.pay-btn').first().textContent()).includes('$13.50'), lbl.join(' / '));
  // Pay exact.
  await page.locator('button:has-text("Pay $")').last().click();
  await page.click('.dialog button:text-is("Exact")');
  await page.locator('.dialog footer button').last().click();
  await page.waitForSelector('.done-number'); await page.waitForTimeout(500);
  const tickets = await page.locator('.dialog').textContent();
  check('kitchen ticket prints + EXTRA MEAT', tickets.includes('+ EXTRA MEAT') && tickets.includes('+ EXTRA GRAVY'), '');
  await page.screenshot({ path: OUT + 'd4-done.png' });
  await page.click('text=Next customer');
  await logout();
  // Kitchen screen.
  await pin('3333'); await page.waitForSelector('.k-extra');
  check('kitchen shows extras', (await page.locator('.k-extra').allTextContents()).join('|').includes('EXTRA MEAT'));
  await page.screenshot({ path: OUT + 'd5-kitchen.png' });
  // Kitchen marks extra meat finished on Sold out.
  await page.goto(URL + '#/todays-menu'); await page.click('.toggle:has-text("Extra meat")');
  check('extra meat finished', (await page.locator('.toggle:has-text("Extra meat") .st').textContent()) === 'FINISHED');
  await logout();
  // Manager: till shows finished, menu editor, price change.
  await pin('2222'); await page.waitForSelector('.items');
  await page.click('.item:has-text("Rice & Beef")');
  await page.click('.ticket-panel .addon-chip:has-text("Extra")');
  check('finished disabled', await page.locator('.addon-pick button:has-text("Extra meat")').isDisabled());
  await page.keyboard.press('Escape');
  await page.click('[aria-label="Clear order"]');
  await page.goto(URL + '#/menu'); await page.waitForSelector('.addon-row');
  await page.screenshot({ path: OUT + 'd6-menu.png', fullPage: true });
  await page.click('button:has-text("Add add-on")');
  await page.fill('#addon-name', 'Cheese'); await page.fill('#addon-price', '0.75');
  await page.click('.dialog .seg button:has-text("Chips & Chicken")');
  await page.screenshot({ path: OUT + 'd7-new-addon.png' });
  await page.click('.dialog footer button:has-text("Save")');
  check('cheese added', (await page.locator('.addon-row:has-text("Cheese")').textContent()).includes('Chips & Chicken'));
  await page.goto(URL + '#/till'); await page.waitForSelector('.items');
  await page.click('.item:has-text("Chips & Chicken")');
  await page.click('.ticket-panel .addon-chip:has-text("Extra")'); await page.click('.addon-pick button:has-text("Cheese")');
  check('cheese priced', (await page.locator('.pay-btn').first().textContent()).includes('$5.25'));
  await page.click('[aria-label="Clear order"]');
  // Reports > Money: add-ons sold.
  await page.goto(URL + '#/reports'); await page.waitForSelector('.an-tabs');
  await page.click('.an-tabs button:has-text("Money")');
  check('add-ons in report', (await page.textContent('body')).includes('Add-ons sold'));
  await page.locator('.section-title:has-text("Add-ons sold")').scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + 'd8-report.png' });
  await logout();
  // Phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await pin('1111'); await page.waitForSelector('.items');
  await page.click('.item:has-text("Rice & Chicken")'); await page.click('.item:has-text("Rice & Chicken")');
  await page.click('.phone-total');
  await page.click('.order-sheet .addon-chip:has-text("Extra")');
  await page.screenshot({ path: OUT + 'm1-picker.png' });
  await page.click('.addon-pick button:has-text("Fried egg")'); await page.click('.split-pick button.all');
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + 'm2-sheet.png' });
  await page.click('.order-sheet .sheet-head button'); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + 'm3-strip.png' });
  check('phone total $9.00', (await page.locator('.pay-btn').first().textContent()).includes('$9.00'));
  check('no horizontal scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  out.errors = errors; console.log(JSON.stringify(out, null, 1)); await b.close();
})().catch((e) => { console.log(JSON.stringify(out, null, 1)); console.error(e.message); process.exit(1); });
