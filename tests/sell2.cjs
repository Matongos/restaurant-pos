const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async()=>{const b=await chromium.launch(); const errors=[];
for (const [n,vp] of [['p',{width:390,height:844}],['d',{width:1366,height:768}]]){
const page=await b.newPage({viewport:vp}); page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:8765/');await page.evaluate(()=>localStorage.clear());await page.reload();
for(const d of '1111') await page.click(`.keypad button:text-is("${d}")`);
await page.waitForSelector('.items');
// stand-in photos on three meals
await page.evaluate(()=>{const k='restaurant-pos.state.v1';const st=JSON.parse(localStorage.getItem(k));
 const pic=(a,b)=>{const c=document.createElement('canvas');c.width=320;c.height=240;const x=c.getContext('2d');const g=x.createRadialGradient(160,130,20,160,130,150);g.addColorStop(0,a);g.addColorStop(1,b);x.fillStyle='#f3efe8';x.fillRect(0,0,320,240);x.fillStyle=g;x.beginPath();x.ellipse(160,130,130,90,0,0,7);x.fill();return c.toDataURL('image/jpeg',0.7);};
 const ph={'Sadza & Beef':pic('#f5f1e6','#7a3e1d'),'Sadza & Chicken':pic('#f7f2e2','#c56a2a'),'Rice & Beef':pic('#e9d9b0','#6b3a1f')};
 st.menu.forEach(m=>{if(ph[m.name])m.photo=ph[m.name];});localStorage.setItem(k,JSON.stringify(st));});
await page.reload(); await page.waitForSelector('.items');
await page.click('.item:has-text("Sadza & Beef")'); await page.click('.item:has-text("Rice & Chicken")');
await page.screenshot({path:`look/${n}-40-sell.png`});
await page.click('.items-head .link-btn'); await page.waitForTimeout(100);
const cnt=await page.locator('.item').count(); console.log(n,'view all items',cnt, await page.textContent('.items-head'));
await page.close();}
console.log(errors); await b.close();})();
