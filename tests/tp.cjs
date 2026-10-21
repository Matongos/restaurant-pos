const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const sizes=[['xl',1866,843],['lg',1366,768],['md',1024,768],['tab',820,1180],['ph',390,844],['xs',320,640]];
const photos = process.argv[2]==='photos';
(async()=>{const b=await chromium.launch(); const errors=[]; const out={};
for (const [n,w,h] of sizes){
const page=await b.newPage({viewport:{width:w,height:h}}); page.on('pageerror',e=>errors.push(n+': '+e.message));
await page.goto('http://localhost:8765/');await page.evaluate(()=>localStorage.clear());await page.reload();
for(const d of '1111') await page.click(`.keypad button:text-is("${d}")`);
await page.waitForSelector('.items');
if(photos){ await page.evaluate(()=>{const k='restaurant-pos.state.v1';const st=JSON.parse(localStorage.getItem(k)||'null'); if(!st) return;
 const pic=(a,b2,bg)=>{const c=document.createElement('canvas');c.width=360;c.height=240;const x=c.getContext('2d');x.fillStyle=bg;x.fillRect(0,0,360,240);const g=x.createRadialGradient(180,130,10,180,130,140);g.addColorStop(0,a);g.addColorStop(1,b2);x.fillStyle=g;x.beginPath();x.ellipse(180,135,140,85,0,0,7);x.fill();return c.toDataURL('image/jpeg',0.7);};
 const ph={'Sadza & Beef':pic('#f6f1e7','#6d2f14','#b5461f'),'Sadza & Chicken':pic('#f7efe0','#c7752e','#c4532a'),'Rice & Beef':pic('#efd9a8','#6b3a1f','#c98a2a'),'Rice & Chicken':pic('#f0d59a','#c66a24','#d9962c'),'Chips & Chicken':pic('#f7d774','#b9662a','#bcd6ea'),'Water 500ml':pic('#ffffff','#bfe0f5','#8fbde4'),'Soft Drink 500ml':pic('#5a2a10','#1d0b04','#a7cdee')};
 st.menu.forEach(m=>{if(ph[m.name])m.photo=ph[m.name];});localStorage.setItem(k,JSON.stringify(st));}); }
if(photos){ await page.reload(); await page.waitForSelector('.items'); }
await page.screenshot({path:`look/tp-${n}-empty${photos?'-ph':''}.png`});
await page.click('.item:has-text("Sadza & Beef")'); await page.click('.item:has-text("Soft Drink")');
await page.waitForTimeout(700);
await page.screenshot({path:`look/tp-${n}-order${photos?'-ph':''}.png`});
out[n]={hscroll: await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth), payVisible: await page.locator('.pay-btn').isVisible(), clipped: await page.evaluate(()=>[...document.querySelectorAll('.item')].filter(e=>e.scrollHeight>e.clientHeight+1).length)};
if(n==='ph'||n==='xs'){ await page.click('.phone-total'); await page.waitForTimeout(250); await page.screenshot({path:`look/tp-${n}-sheet.png`}); await page.click('.sheet-head button'); await page.click('.hamburger'); await page.waitForTimeout(250); await page.screenshot({path:`look/tp-${n}-drawer.png`}); }
await page.close();}
console.log(JSON.stringify(out), errors); await b.close();})();
