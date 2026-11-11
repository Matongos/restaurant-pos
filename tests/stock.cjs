// Stock counted down with sales: checks every way stock moves, on computer and phone.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL = 'http://localhost:8765/'; const OUT = require('os').tmpdir() + '/pos-stock/'; require('fs').mkdirSync(OUT, { recursive: true });
const out = {}; const check = (n, c, d) => (out[n] = c ? 'ok' : `FAIL ${d ?? ''}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const pin = async (p) => { await page.waitForSelector('.keypad'); for (const d of p) await page.click(`.keypad button:text-is("${d}")`); };
  const logout = async () => { await page.click('.user-btn'); await page.click('.user-pop button:has-text("Log out")'); };
  const amount = async (name) => (await page.locator(`.stock-row:has(.sr-name b:text-is("${name}")) .sr-amt b`).textContent()).trim();
  const goStock = async () => { await page.goto(URL + '#/stock'); await page.waitForSelector('.stock-row'); };
  const sell = async (items, type) => {
    await page.goto(URL + '#/till'); await page.waitForSelector('.items');
    for (const m of items) await page.click(`.item:has-text("${m}")`);
    if (type) await page.click(`.type-toggle button.${type}`);
    await page.locator('button:has-text("Pay $")').last().click();
    await page.click('.dialog button:text-is("Exact")');
    await page.locator('.dialog footer button').last().click();
    await page.waitForSelector('.done-number'); await page.click('text=Next customer');
  };
  await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.reload();

  // Opening stock (demo count)
  await pin('2222'); await page.waitForSelector('.items');
  await goStock();
  check('opening beef 8 kg', (await amount('Beef')) === '8 kg', await amount('Beef'));
  check('oxtail low', (await page.locator('.stock-row:has-text("Oxtail") .sr-pill').textContent()).includes('Running low'));
  check('nav badge', (await page.locator('.nav-item:has-text("Stock") .nav-badge').textContent()) === '1');
  await page.screenshot({ path: OUT + 'd1-stock.png', fullPage: true });

  // Sales take stock off: 2 Sadza & Beef (eat in), 1 Chips & Chicken take away.
  await sell(['Sadza & Beef', 'Sadza & Beef']);
  await sell(['Chips & Chicken'], 'take_away');
  await goStock();
  check('beef 8 − 2×0.2 = 7.6', (await amount('Beef')) === '7.6 kg', await amount('Beef'));
  check('mealie 30 − 0.36 = 29.64', (await amount('Mealie meal (roller meal)')) === '29.64 kg', await amount('Mealie meal (roller meal)'));
  check('container used for take away', (await amount('Take-away containers')) === '199 container', await amount('Take-away containers'));
  check('used today shown', (await page.locator('.stock-row:has-text("Beef") .sr-use').textContent()).includes('0.4 kg'));

  // Fried egg add-on uses an egg.
  await page.goto(URL + '#/till'); await page.waitForSelector('.items');
  await page.click('.item:has-text("Rice & Beef")');
  await page.click('.ticket-panel .addon-chip:has-text("Extra")'); await page.click('.addon-pick button:has-text("Fried egg")');
  await page.locator('button:has-text("Pay $")').last().click(); await page.click('.dialog button:text-is("Exact")');
  await page.locator('.dialog footer button').last().click(); await page.waitForSelector('.done-number'); await page.click('text=Next customer');
  await goStock();
  check('egg from add-on: 59', (await amount('Eggs')) === '59 egg', await amount('Eggs'));

  // Stock take: beef really 7 kg → difference −0.4 kept; Fish counted 0 → Sadza & Fish hidden.
  await page.click('button[aria-label="Stock take"]');
  await page.fill('#count-st-beef', '7');
  check('difference shown', (await page.locator('.take-row:has-text("Beef")').textContent()).includes('-0.4 kg'));
  await page.fill('#count-st-fish', '0');
  await page.screenshot({ path: OUT + 'd2-take.png' });
  await page.click('.dialog footer button:has-text("Save 2 counts")');
  await page.waitForTimeout(200);
  check('beef = 7 after count', (await amount('Beef')) === '7 kg', await amount('Beef'));
  check('fish out', (await page.locator('.stock-row:has-text("Bream fish") .sr-pill').textContent()).includes('Out'));
  await page.goto(URL + '#/till'); await page.waitForSelector('.items'); await page.click('.chip:has-text("Meals")');
  check('sadza & fish hidden', (await page.locator('.item:has-text("Sadza & Fish")').count()) === 0);
  await page.goto(URL + '#/todays-menu'); await page.waitForSelector('.toggle');
  check('sold out explains', (await page.locator('.toggle:has-text("Sadza & Fish")').textContent()).includes('out of stock'));

  // Waste: 1 kg chicken spoiled.
  await goStock();
  await page.click('button[aria-label="Record waste"]');
  await page.selectOption('#waste-item', 'st-chicken'); await page.fill('#waste-qty', '1'); await page.click('.dialog .seg button:has-text("Spoiled")');
  await page.click('.dialog footer button:has-text("Take it off stock")');
  check('chicken 10 − 0.25 − 1 = 8.75', (await amount('Chicken pieces')) === '8.75 kg', await amount('Chicken pieces'));

  // Purchase in Books adds: 5 kg beef, 2 × 10 kg bag mealie meal.
  await page.goto(URL + '#/accounts'); await page.waitForSelector('.an-tabs');
  await page.click('.an-tabs button:has-text("Purchases")'); await page.click('button:has-text("Record a purchase")');
  await page.fill('#pur-supplier', 'Butchery');
  await page.fill('#pl-name-0', 'Beef'); await page.fill('#pl-qty-0', '5'); await page.fill('#pl-unit-0', 'kg'); await page.fill('#pl-cost-0', '6');
  await page.fill('#pl-name-1', 'Mealie meal (roller meal)'); await page.fill('#pl-qty-1', '2'); await page.fill('#pl-unit-1', '10 kg bag'); await page.fill('#pl-cost-1', '7.5');
  await page.click('.dialog footer button:has-text("Save purchase")');
  await goStock();
  check('beef 7 + 5 = 12', (await amount('Beef')) === '12 kg', await amount('Beef'));
  check('mealie +20 kg', (await amount('Mealie meal (roller meal)')) === '49.64 kg', await amount('Mealie meal (roller meal)'));

  // Cancel the Sadza & Beef sale: beef goes back (+0.4) — it was sold after the count? No: before the count, so the count already includes it.
  // Item detail with history.
  await page.click('.stock-row:has(.sr-name b:text-is("Beef"))'); await page.waitForSelector('.stock-hist');
  const hist = await page.locator('.stock-hist').textContent();
  check('history has count, purchase, sales', hist.includes('Counted') && hist.includes('Bought') && hist.includes('Sales on'), hist.slice(0, 200));
  await page.screenshot({ path: OUT + 'd3-item.png' });
  await page.keyboard.press('Escape');

  // A sale after the count, then cancelled: stock comes back.
  await sell(['Rice & Beef']);
  await goStock();
  check('beef 12 − 0.2', (await amount('Beef')) === '11.8 kg', await amount('Beef'));
  await page.goto(URL + '#/orders'); await page.waitForSelector('.ocard');
  await page.locator('.ocard').last().locator('.menu-wrap button').click();
  await page.click('.menu-pop button:has-text("Cancel sale")');
  await page.click('.dialog .seg button:has-text("Wrong item entered")');
  await page.fill('#manager-pin', '2222'); await page.locator('.dialog footer button').last().click();
  await goStock();
  check('cancel returns beef', (await amount('Beef')) === '12 kg', await amount('Beef'));

  // Meal editor shows the recipe.
  await page.goto(URL + '#/menu'); await page.waitForSelector('table.list');
  await page.click('table.list tr:has-text("Sadza & Beef")');
  await page.locator('.dialog .section-title:has-text("Stock used per plate")').scrollIntoViewIfNeeded();
  check('recipe rows', (await page.locator('.dialog .recipe-row').count()) === 2);
  await page.screenshot({ path: OUT + 'd4-recipe.png' });
  await page.keyboard.press('Escape');
  await logout();

  // Kitchen can count but not edit items.
  await pin('3333'); await page.waitForSelector('.ocard, .empty');
  check('kitchen has Stock', (await page.locator('.nav-item:has-text("Stock")').count()) > 0);
  await goStock(); await page.click('.stock-row:has(.sr-name b:text-is("Beef"))');
  check('kitchen cannot edit', (await page.locator('#stock-name').count()) === 0);
  await page.keyboard.press('Escape');
  await logout();
  // Cashier has no Stock.
  await pin('1111'); await page.waitForSelector('.items');
  check('cashier no Stock', (await page.locator('.nav-item:has-text("Stock")').count()) === 0);
  await logout();

  // Phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await pin('2222'); await page.waitForSelector('.items');
  await goStock(); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + 'm1-stock.png' });
  check('no horizontal scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.click('button[aria-label="Stock take"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + 'm2-take.png' });
  check('no horizontal scroll (take)', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  out.errors = errors; console.log(JSON.stringify(out, null, 1)); await b.close();
})().catch((e) => { console.log(JSON.stringify(out, null, 1)); console.error(e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
