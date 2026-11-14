// "My account": the owner sees the account email, changes PIN, password and email; a cashier changes only their own PIN.
// Needs tests/cloud-mock.cjs running on :54321 and the app on :8765.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL = process.env.POS_URL || 'http://localhost:8765/';
const MOCK = 'http://localhost:54321';
const out = {}; const check = (n, c, d) => (out[n] = c ? 'ok' : `FAIL ${d ?? ''}`);
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript((m) => localStorage.setItem('restaurant-pos.cloud-url', m), MOCK);
  const a = await ctx.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  const pin = async (p) => { for (const d of p) await a.click(`.keypad button:text-is("${d}")`); await a.waitForTimeout(300); };
  const mockSignIn = async (email, password) => (await fetch(MOCK + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: 'x', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).status;
  const openAccount = async () => { await a.click('.user-btn'); await a.click('.user-pop button:has-text("My account")'); await a.waitForSelector('.acct-dialog'); };
  const closeDialog = async () => { await a.click('.acct-dialog header button[aria-label="Close"]'); };

  // A new restaurant through the wizard
  await a.goto(URL); await a.waitForSelector('.keypad');
  await a.click('a:has-text("New restaurant? Set it up")');
  await a.locator('label:has-text("Restaurant name") input').fill('Chipo Grill');
  await a.waitForSelector('.slug-state.good');
  await a.click('.setup-nav button:has-text("Next")');
  await a.locator('label:has-text("Your name") input').fill('Chipo Banda');
  await a.locator('label:has-text("Choose your 4-digit PIN") input').fill('2580');
  await a.locator('label:has-text("Type it again") input').fill('2580');
  await a.click('.setup-nav button:has-text("Next")');
  await a.locator('label:has-text("Email") input').fill('chipo@example.com');
  await a.locator('label:has-text("password") input').fill('chipo-pass-1');
  await a.click('button:has-text("Create my restaurant")');
  await a.waitForSelector('.topbar', { timeout: 20000 });

  // Email in the name menu and in My account
  await a.click('.user-btn');
  check('email in name menu', (await a.textContent('.user-pop .who-line')).includes('chipo@example.com'));
  await a.click('.user-pop button:has-text("My account")'); await a.waitForSelector('.acct-dialog');
  const txt = await a.textContent('.acct-dialog');
  check('my account shows email, restaurant, web address', txt.includes('chipo@example.com') && txt.includes('Chipo Grill') && txt.includes('/chipo-grill'));
  if (process.env.SHOT) await a.screenshot({ path: process.env.SHOT });

  // Change PIN: wrong current refused, right one works
  await a.click('button:has-text("Change my PIN")');
  await a.locator('label:has-text("Current PIN") input').fill('1111');
  await a.locator('label:has-text("New PIN") input >> nth=0').fill('3691');
  await a.locator('label:has-text("New PIN again") input').fill('3691');
  await a.click('.acct-form button:has-text("Change PIN")');
  check('wrong current PIN refused', /current PIN is not right/.test(await a.textContent('.acct-form .error')));
  await a.locator('label:has-text("Current PIN") input').fill('2580');
  await a.click('.acct-form button:has-text("Change PIN")');
  await a.waitForTimeout(300);
  let s = await a.evaluate(() => JSON.parse(localStorage.getItem('restaurant-pos.state.v1')));
  check('PIN changed', s.staff[0].pin === '3691');

  // Change password: wrong current refused; right one works on the server
  await a.click('button:has-text("Change password")');
  await a.locator('label:has-text("Current password") input').fill('nope-nope');
  await a.locator('label:has-text("New password") input >> nth=0').fill('chipo-new-pass');
  await a.locator('label:has-text("New password again") input').fill('chipo-new-pass');
  await a.click('.acct-form button:has-text("Change password")');
  await a.waitForSelector('.acct-form .error');
  check('wrong current password refused', /current password is not right/.test(await a.textContent('.acct-form .error')));
  await a.locator('label:has-text("Current password") input').fill('chipo-pass-1');
  await a.click('.acct-form button:has-text("Change password")');
  await a.waitForSelector('.acct-form', { state: 'detached' });
  check('password changed on server', (await mockSignIn('chipo@example.com', 'chipo-new-pass')) === 200 && (await mockSignIn('chipo@example.com', 'chipo-pass-1')) === 400);

  // Change email
  await a.click('button:has-text("Change email")');
  await a.locator('label:has-text("New email") input').fill('chipo.grill@example.com');
  await a.locator('label:has-text("Your password") input').fill('chipo-new-pass');
  await a.click('.acct-form button:has-text("Change email")');
  await a.waitForSelector('.acct-form', { state: 'detached' });
  check('email changed on server', (await mockSignIn('chipo.grill@example.com', 'chipo-new-pass')) === 200);
  check('new email shown', (await a.textContent('.acct-dialog .acct-email')).includes('chipo.grill@example.com'));
  await closeDialog();

  // Settings → Online account shows the same
  await a.goto(URL + '#/settings?tab=online'); await a.waitForSelector('.acct-card');
  check('settings shows email and change buttons', (await a.textContent('.acct-card')).includes('chipo.grill@example.com') && await a.isVisible('.acct-card button:has-text("Change password")'));
  await a.waitForTimeout(1500);
  const sync = await a.textContent('.cloud-state');
  check('still syncing after email change', !/Not syncing/.test(sync), sync);

  // A cashier: no email, own PIN only
  await a.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('restaurant-pos.state.v1'));
    const now = new Date().toISOString();
    st.staff.push({ id: 'u-cash1', name: 'Tendai Cashier', role: 'cashier', pin: '1357', active: true, createdAt: now, pinChangedAt: now });
    localStorage.setItem('restaurant-pos.state.v1', JSON.stringify(st));
    sessionStorage.clear();
  });
  await a.goto(URL); await a.reload(); await a.waitForSelector('.keypad');
  await pin('1357'); await a.waitForSelector('.topbar');
  await openAccount();
  const ct = await a.textContent('.acct-dialog');
  check('cashier: no email, no password change', !ct.includes('chipo.grill@example.com') && !(await a.isVisible('button:has-text("Change password")')) && /Only the owner/.test(ct));
  await a.click('button:has-text("Change my PIN")');
  await a.locator('label:has-text("Current PIN") input').fill('1357');
  await a.locator('label:has-text("New PIN") input >> nth=0').fill('3691');
  await a.locator('label:has-text("New PIN again") input').fill('3691');
  await a.click('.acct-form button:has-text("Change PIN")');
  check('cashier cannot take someone else\'s PIN', /already uses this PIN/.test(await a.textContent('.acct-form .error')));
  await a.locator('label:has-text("New PIN") input >> nth=0').fill('8024');
  await a.locator('label:has-text("New PIN again") input').fill('8024');
  await a.click('.acct-form button:has-text("Change PIN")');
  await a.waitForTimeout(300);
  s = await a.evaluate(() => JSON.parse(localStorage.getItem('restaurant-pos.state.v1')));
  check('cashier changed own PIN', s.staff.find((x) => x.id === 'u-cash1').pin === '8024');

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify(out, null, 1));
  console.log('fails:', Object.values(out).filter((v) => v !== 'ok').length);
  await b.close();
})();
