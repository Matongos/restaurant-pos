const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async()=>{const b=await chromium.launch(); const out={}; const errors=[];
for (const [n,w,h] of [['lap',1536,730],['xl',1866,843],['md',1024,768],['tab',820,1180],['ph',390,844],['s360',360,740],['xs',320,640]]){
const page=await b.newPage({viewport:{width:w,height:h}}); page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:8765/');await page.evaluate(()=>localStorage.clear());await page.reload();
for(const d of '1111') await page.click(`.keypad button:text-is("${d}")`); await page.waitForSelector('.items');
await page.click('.chip:has-text("Meals")');
for (const m of ['Sadza & Beef','Sadza & Chicken','Rice & Beef','Rice & Chicken','Chips & Chicken','Sadza & Oxtail']) await page.click(`.item:has-text("${m}")`);
await page.waitForTimeout(700);
await page.evaluate(()=>{const l=document.querySelector('.ticket-panel .lines'); if(l) l.scrollTop=0; const i=document.querySelector('.items'); i.scrollTop=0;});
await page.screenshot({path:`look/c-${n}.png`});
out[n]=await page.evaluate(()=>{const l=document.querySelector('.ticket-panel .lines');const box=l.getBoundingClientRect();const vis=[...l.querySelectorAll('.line-row')].filter(r=>{const b=r.getBoundingClientRect();return b.height>0&&b.top>=box.top-1&&b.bottom<=box.bottom+1;}).length;
 const ib=document.querySelector('.items').getBoundingClientRect(); const cards=[...document.querySelectorAll('.item')].filter(c=>{const b=c.getBoundingClientRect();return b.top>=ib.top-1&&b.bottom<=ib.bottom+1;}).length;
 return {linesVisible:vis, cardsVisible:cards, hscroll:document.documentElement.scrollWidth>innerWidth};});
await page.close();}
console.log(JSON.stringify(out), errors); await b.close();})();
