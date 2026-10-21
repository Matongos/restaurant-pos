const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async()=>{const b=await chromium.launch(); const r={};
for (const [n,w,h] of [['d',1536,730],['p',390,844]]){
const page=await b.newPage({viewport:{width:w,height:h}});
await page.goto('http://localhost:8765/');await page.evaluate(()=>localStorage.clear());await page.reload();
for(const d of '1111') await page.click(`.keypad button:text-is("${d}")`); await page.waitForSelector('.items');
await page.click('.item:has-text("Rice & Beef")');
if(n==='p') await page.click('.phone-total');
const scope = n==='p' ? '.order-sheet' : '.ticket-panel';
await page.click(`${scope} .note-btn`); await page.click('.dialog .seg button:has-text("Extra gravy")'); await page.click('.dialog footer button:has-text("Save note")');
r[n]=(await page.locator(`${scope} .line-opts .nt`).textContent())==='Extra gravy' && await page.locator(`${scope} .note-btn.has`).count()===1;
if(n==='p'){ await page.screenshot({path:'look/c-ph-sheet.png'}); await page.click('.sheet-head button'); r.summary=(await page.textContent('.phone-summary')).includes('1× Rice & Beef'); }
await page.close();}
console.log(JSON.stringify(r)); await b.close();})();
