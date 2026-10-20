const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async()=>{const b=await chromium.launch(); const out={}; const errors=[];
for (const [n,vp] of [['p',{width:390,height:844}],['s',{width:360,height:740}],['t',{width:820,height:1180}]]){
const page=await b.newPage({viewport:vp}); page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:8765/');await page.evaluate(()=>localStorage.clear());await page.reload();
for(const d of '1111') await page.click(`.keypad button:text-is("${d}")`);
await page.waitForSelector('.items');
await page.screenshot({path:`look/${n}-20-sell-empty.png`});
for (const m of ['Sadza & Beef','Sadza & Beef','Rice & Chicken','Chips & Chicken']) await page.click(`.item:has-text("${m}")`);
await page.click('.chip:has-text("Drinks")'); await page.click('.item:has-text("Water 500ml")'); await page.click('.item:has-text("Soft Drink")');
await page.waitForTimeout(100);
await page.screenshot({path:`look/${n}-21-sell-order.png`});
const lastVisible=await page.evaluate(()=>{const l=document.querySelector('.lines');const r=[...l.querySelectorAll('.line-row')].pop().getBoundingClientRect();const c=l.getBoundingClientRect();return r.bottom<=c.bottom+1&&r.top>=c.top-1;});
const catRows=await page.evaluate(()=>{const ys=new Set([...document.querySelectorAll('.cat-bar .chip, .cat-bar .search-open')].map(e=>Math.round(e.getBoundingClientRect().top)));return ys.size;});
const fits=await page.evaluate(()=>[...document.querySelectorAll('.cat-bar .chip')].every(e=>e.getBoundingClientRect().right<=innerWidth));
const hs=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
out[n]={lastVisible,catRows,fits,hscroll:hs,cols:await page.evaluate(()=>getComputedStyle(document.querySelector('.items')).gridTemplateColumns.split(' ').length)};
if(n==='p'){await page.click('.search-open');await page.fill('#menu-search','rice');await page.screenshot({path:`look/p-22-search.png`});await page.click('.search-close');}
await page.close();}
console.log(JSON.stringify(out),errors);await b.close();})();
