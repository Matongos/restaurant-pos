const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL='http://localhost:8765/'; const out={};
const check=(n,c,d)=>out[n]=c?'ok':`FAIL ${d??''}`;
(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1366,height:768}});
const page=await ctx.newPage(); const till2=await ctx.newPage(); const errors=[];
for (const p of [page,till2]) { p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>m.type()==='error'&&errors.push(m.text())); }
const pin=async(p,code)=>{await p.waitForSelector('.keypad'); for(const d of code) await p.click(`.keypad button:text-is("${d}")`);};
const logout=async(p)=>{await p.click('.user-btn'); await p.click('.user-pop button:has-text("Log out")'); await p.waitForSelector('.keypad');};
const footerBtn=()=>page.locator('.dialog footer button').last();
const row=(name)=>page.locator('.staff-row',{hasText:name});
const canLogin=async(p,code)=>{await pin(p,code); await p.waitForTimeout(300); return (await p.locator('.keypad').count())===0;};

await page.goto(URL); await page.evaluate(()=>localStorage.clear()); await page.reload();
// Owner adds a cashier.
await pin(page,'1234'); await page.waitForSelector('.metric-grid');
await page.click('.nav-item:has-text("Staff")'); await page.waitForSelector('.staff-list');
check('owner sees 5 active', (await page.locator('.staff-row').count())===5);
await page.click('button:has-text("Add person")');
check('blocker name', (await footerBtn().textContent())==='Type their name');
await page.fill('#staff-name','chipo moyo');
check('blocker role', (await footerBtn().textContent())==='Choose what they do');
check('owner sees 5 roles', (await page.locator('.role-pick button').count())===5);
await page.click('.role-pick button:has-text("Cashier")');
await page.fill('#staff-pin','1234'); await page.fill('#staff-pin2','1234');
check('duplicate pin', (await footerBtn().textContent()).includes('already uses'));
await page.fill('#staff-pin','5555'); await page.fill('#staff-pin2','5555');
check('weak pin', (await footerBtn().textContent()).includes('Too easy'));
await page.fill('#staff-pin','5821'); await page.fill('#staff-pin2','5812');
check('mismatch', (await footerBtn().textContent()).includes("don't match"));
await page.fill('#staff-pin2','5821'); await page.fill('#staff-phone','0771 234 567');
await footerBtn().click();
check('added', (await row('Chipo Moyo').count())===1);
await page.screenshot({path:'look/d-18-staff.png'});
await logout(page);

// New person logs in on till 2.
await till2.goto(URL);
check('chipo logs in', await canLogin(till2,'5821'));
check('chipo lands on Sell', (await till2.evaluate(()=>location.hash))==='#/till');
check('cashier has no Staff', (await till2.locator('.nav-item:has-text("Staff")').count())===0);

// Manager: limited rights.
await pin(page,'2222'); await page.waitForSelector('.items');
await page.click('.nav-item:has-text("Staff")'); await page.waitForSelector('.staff-list');
check('owner row locked', (await row('Owner').locator('.staff-locked').count())===1);
check('own row has no More', (await row('Tendai').locator('.menu-wrap').count())===0);
await page.click('button:has-text("Add person")');
check('manager sees 3 roles', (await page.locator('.role-pick button').count())===3);
await page.click('.dialog footer button:has-text("Cancel")');

// Suspend Chipo while she is logged in on till 2.
await row('Chipo').locator('.menu-wrap button').click();
await page.click('.menu-pop button:has-text("Suspend")');
await page.fill('#staff-reason','On leave'); await footerBtn().click();
await till2.waitForTimeout(400);
check('chipo kicked out', (await till2.locator('.keypad').count())===1);
check('suspended login refused', !(await canLogin(till2,'5821')));
await page.click('.tabs button:has-text("Suspended")');
await row('Chipo').locator('button:has-text("Reactivate")').click();
await till2.reload();
check('reactivated login', await canLogin(till2,'5821')); await logout(till2);

// Change PIN.
await page.click('.tabs button:has-text("Active")');
await row('Chipo').locator('button:has-text("PIN")').click();
await page.fill('#staff-pin','7319'); await page.fill('#staff-pin2','7319'); await footerBtn().click();
check('old pin dead', !(await canLogin(till2,'5821')));
await till2.reload();
check('new pin works', await canLogin(till2,'7319'));
// Make a sale as Chipo so her name is on a record.
await till2.click('.item:has-text("Water 500ml")'); await till2.click('button:has-text("Pay $1.00")'); await till2.fill('#pay-amount','1');
await till2.locator('.dialog footer button').last().click(); await till2.waitForSelector('.done-number'); await till2.click('text=Next customer');
await logout(till2);

// Edit details.
await row('Chipo').locator('button:has-text("Edit")').click();
await page.fill('#staff-name','Chipo Moyo-Banda'); await page.click('.role-pick button:has-text("Attendant")'); await footerBtn().click();
check('edited', (await row('Chipo Moyo-Banda').locator('.tag:has-text("Attendant")').count())===1);

// Remove.
await row('Chipo').locator('.menu-wrap button').click();
await page.click('.menu-pop button:has-text("Remove")');
await page.fill('#staff-reason','Resigned'); await footerBtn().click();
check('removed from active', (await row('Chipo').count())===0);
check('removed login refused', !(await canLogin(till2,'7319')));
await page.click('.tabs button:has-text("Removed")');
check('in removed tab', (await row('Chipo').count())===1);
check('history rows', (await page.locator('table.list tbody tr').count())===6, await page.locator('table.list tbody tr').count());
await page.screenshot({path:'look/d-19-staff-history.png', fullPage:true});

// Her name stays on her sale.
await page.click('.nav-item:has-text("Books")'); await page.click('.an-tabs button:has-text("Sales journal")');
await page.waitForTimeout(300);
check('name kept on sale', (await page.locator('table.list tbody tr:has-text("Chipo Moyo-Banda")').count())>=1);

// Phone view.
await page.setViewportSize({width:390,height:844});
await page.goto(URL+'#/staff'); await page.waitForSelector('.staff-list');
await page.screenshot({path:'look/p-18-staff.png'});
await page.click('button:has-text("Add person")'); await page.screenshot({path:'look/p-19-add.png'});
check('no hscroll', !(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
out.errors=errors; console.log(JSON.stringify(out,null,1)); await b.close();
})().catch(e=>{console.log(JSON.stringify(out,null,1)); console.error(e); process.exit(1);});
