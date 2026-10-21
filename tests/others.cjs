const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async()=>{const b=await chromium.launch(); const errors=[];
for (const [n,w,h] of [['d',1366,768],['p',390,844]]){
const page=await b.newPage({viewport:{width:w,height:h}}); page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:8765/');await page.evaluate(()=>localStorage.clear());await page.reload();
for(const d of '1234') await page.click(`.keypad button:text-is("${d}")`);
await page.waitForSelector('.metric-grid'); await page.screenshot({path:`look/o-${n}-reports.png`});
await page.goto('http://localhost:8765/#/orders'); await page.waitForTimeout(400); await page.screenshot({path:`look/o-${n}-orders.png`});
await page.goto('http://localhost:8765/#/staff'); await page.waitForSelector('.staff-list'); await page.screenshot({path:`look/o-${n}-staff.png`});
if(n==='p'){ await page.click('.hamburger'); await page.waitForTimeout(300); await page.screenshot({path:`look/o-p-drawer.png`}); }
console.log(n, await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
await page.close();}
console.log(errors); await b.close();})();
