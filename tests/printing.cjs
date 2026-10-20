const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL='http://localhost:8765/'; const out={}; const check=(n,c,d)=>out[n]=c?'ok':`FAIL ${d??''}`;
(async()=>{const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1366,height:768}});
await ctx.addInitScript(()=>{window.__prints=0; new MutationObserver(m=>m.forEach(r=>r.addedNodes.forEach(n=>{if(n.tagName==='IFRAME')window.__prints++;}))).observe(document,{childList:true,subtree:true});});
const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const prints=()=>page.evaluate(()=>window.__prints);
const pin=async(c)=>{await page.waitForSelector('.keypad'); for(const d of c) await page.click(`.keypad button:text-is("${d}")`);};
const sale=async()=>{await page.goto(URL+'#/till'); await page.waitForSelector('.items'); await page.evaluate(()=>window.__prints=0);
  await page.click('.item:has-text("Rice & Beef")'); await page.click('button:has-text("Pay $4.00")'); await page.fill('#pay-amount','4');
  await page.locator('.dialog footer button').last().click(); await page.waitForSelector('.done-number'); await page.waitForTimeout(300);};
const foot=async()=>(await page.locator('.dialog footer button').allTextContents()).map(t=>t.trim()).join('|');
const setts=async()=>{await page.goto(URL+'#/settings'); await page.waitForSelector('.tabs');};
await page.goto(URL); await page.evaluate(()=>localStorage.clear()); await page.reload();
await pin('1111'); await page.waitForSelector('.items');
check('cashier no settings', (await page.locator('.nav-item:has-text("Settings")').count())===0);
// 1. default: print straight away
await sale();
check('on_pay printed once', (await prints())===1, await prints());
check('on_pay status', (await page.textContent('.print-status')).includes('Printed: kitchen ticket'));
check('on_pay buttons', (await foot())==='Print again|Next customer', await foot());
await page.click('text=Next customer');
await page.click('.user-btn'); await page.click('.user-pop button:has-text("Log out")');
// manager settings
await pin('2222'); await page.waitForSelector('.items');
check('manager has settings', (await page.locator('.nav-item:has-text("Settings")').count())===1);
await setts();
const tabs=(await page.locator('.tabs button').allTextContents()).join('|');
check('manager tabs', tabs==='Numbers & printing|Serving times', tabs);
await page.screenshot({path:'look/d-24-printing.png',fullPage:true});
// 2. print & next
await page.click('.toggle:has-text("Print & next customer")');
await sale();
check('on_next not yet', (await prints())===0);
check('on_next buttons', (await foot())==="Next, don't print|Print & next customer", await foot());
await page.screenshot({path:'look/d-25-done-onnext.png'});
await page.click('button:has-text("Print & next customer")');
check('on_next printed+closed', (await prints())===1 && (await page.locator('.done-number').count())===0);
await sale(); await page.waitForTimeout(500); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
check('enter prints+next', (await prints())===1 && (await page.locator('.done-number').count())===0);
await sale(); await page.click("button:has-text(\"Next, don't print\")");
check('skip print', (await prints())===0);
// 3. button only
await setts(); await page.click('.toggle:has-text("Only when Print is pressed")');
await sale();
check('button mode no auto', (await prints())===0 && (await foot())==='Print|Next customer', await foot());
await page.click('.dialog footer button:has-text("Print")');
check('button print', (await prints())===1 && (await foot())==='Print again|Next customer');
await page.click('text=Next customer');
// 4. kitchen ticket off, card mode -> nothing to print
await setts(); await page.click('button[aria-label="Print kitchen ticket"]');
await sale();
check('nothing to print', (await page.textContent('.print-status')).includes('Nothing is set to print') && (await foot())==='Next customer', await foot());
await page.click('text=Next customer');
// 5. auto next after 3s (back to print straight away, kitchen on)
await setts(); await page.click('button[aria-label="Print kitchen ticket"]'); await page.click('.toggle:has-text("Print straight away")');
await page.click('.seg button:has-text("After 3 seconds")');
await sale();
check('countdown label', /Next customer \(\d\)/.test(await foot()), await foot());
await page.waitForTimeout(3300);
check('auto closed', (await page.locator('.done-number').count())===0);
await sale(); await page.mouse.click(683,200); await page.waitForTimeout(3500);
check('touch stops countdown', (await page.locator('.done-number').count())===1);
out.errors=errors; console.log(JSON.stringify(out,null,1)); await b.close();})().catch(e=>{console.log(JSON.stringify(out,null,1));console.error(e);process.exit(1)});
