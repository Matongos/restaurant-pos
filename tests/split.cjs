const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const out={}; const check=(n,c,d)=>out[n]=c?'ok':`FAIL ${d??''}`;
(async()=>{const b=await chromium.launch(); const errors=[];
for (const [n,w,h] of [['d',1366,768],['p',390,844]]){
const page=await b.newPage({viewport:{width:w,height:h}}); page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:8765/');await page.evaluate(()=>localStorage.clear());await page.reload();
for(const d of '1111') await page.click(`.keypad button:text-is("${d}")`); await page.waitForSelector('.items');
for(let i=0;i<5;i++) await page.click('.item:has-text("Sadza & Beef")');
const scope = n==='p' ? '.order-sheet' : '.ticket-panel';
if(n==='p') await page.click('.mini-head');
const rows=async()=>(await page.locator(`${scope} .line-row`).evaluateAll(rs=>rs.map(r=>r.querySelector('.qty span').textContent+'×'+(r.querySelector('.opt-chip').textContent.trim()))));
check(n+' one line of 5', (await rows()).join('|')==='5×Greens', (await rows()).join('|'));
await page.click(`${scope} .line-row .opt-chip`);
check(n+' asks how many', (await page.textContent('.dialog h2'))==='No greens on how many?');
if(n==='d') await page.screenshot({path:'look/split-ask.png'});
await page.click('.split-pick button:text-is("1")');
check(n+' split 4 + 1', (await rows()).join('|')==='4×Greens|1×No greens', (await rows()).join('|'));
await page.locator(`${scope} .line-row`).first().locator('.opt-chip').click();
await page.click('.split-pick button:text-is("2")');
check(n+' merged 2 + 3', (await rows()).join('|')==='2×Greens|3×No greens', (await rows()).join('|'));
// single plate: no question
await page.locator(`${scope} .line-row`).first().locator('button[aria-label^="One less"]').click();
await page.locator(`${scope} .line-row`).first().locator('.opt-chip').click();
check(n+' single toggles directly', (await page.locator('.dialog').count())===0 && (await rows()).join('|')==='4×No greens', (await rows()).join('|'));
if(n==='p'){ await page.screenshot({path:'look/split-phone.png'}); await page.click('.order-sheet .sheet-foot .btn.primary'); }
else { await page.click('.pay-btn'); }
await page.click('.quick button:has-text("Exact")'); await page.locator('.dialog footer button').last().click(); await page.waitForSelector('.done-number');
const t=await page.textContent('.ticket-previews');
check(n+' ticket', (t.match(/NO GREENS/g)||[]).length===1 && t.includes('4 × Sadza & Beef'), t);
if(n==='d') await page.screenshot({path:'look/split-ticket.png'});
await page.close();}
out.errors=errors; console.log(JSON.stringify(out,null,1)); await b.close();})().catch(e=>{console.log(JSON.stringify(out,null,1));console.error(e);process.exit(1)});
