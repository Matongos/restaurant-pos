const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async()=>{const b=await chromium.launch(); const errors=[];
for (const [n,vp] of [['p',{width:390,height:844}],['d',{width:1366,height:768}]]){
const page=await b.newPage({viewport:vp}); page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:8765/');await page.evaluate(()=>localStorage.clear());await page.reload();
for(const d of '1111') await page.click(`.keypad button:text-is("${d}")`);
await page.waitForSelector('.items');
for (const m of ['Sadza & Beef','Sadza & Beef','Rice & Chicken','Chips & Chicken','Sadza & Chicken']) await page.click(`.item:has-text("${m}")`);
await page.click('.ticket-panel button:has-text("Pay")');
await page.waitForSelector('#pay-amount'); await page.screenshot({path:`look/${n}-30-pay-wait.png`});
await page.fill('#pay-amount','13.5'); await page.screenshot({path:`look/${n}-31-pay-short.png`});
await page.fill('#pay-amount','30'); await page.fill('#hand-over','2'); await page.fill('#cust-name','Lucy Moyo');
await page.screenshot({path:`look/${n}-32-pay-keep.png`});
if(n==='p'){ await page.evaluate(()=>document.querySelector('.pay-dialog .body').scrollTo(0,9999)); await page.screenshot({path:`look/p-33-pay-keep-bottom.png`});}
await page.click('.method-grid button:has-text("Their change")'); await page.screenshot({path:`look/${n}-34-pay-theirchange.png`});
console.log(n, await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth || document.querySelector('.pay-dialog').scrollWidth>document.querySelector('.pay-dialog').clientWidth));
await page.close();}
console.log(errors); await b.close();})();
