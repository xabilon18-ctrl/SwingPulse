const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {chromium}=require('@playwright/test');
const live=process.env.DESKTOP_LIVE==='1',url=process.env.DESKTOP_URL||'http://127.0.0.1:8000',name=live?'GOLD':'TEST';
fs.mkdirSync('time-zoom-results',{recursive:true});
const settle=p=>p.waitForTimeout(160);
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-6*Math.max(1,Math.abs(b)),`${label}: ${a} vs ${b}`);
async function read(h){return h.evaluate(el=>{const c=el._reelCtx,b=c.b;return {n:c.bundle.c.length,first:c.bundle.t[0],last:c.bundle.t.at(-1),
 from:b._from||0,lead:b._lead||0,view:b._viewBars,bw:c.bw,lo:c.sc.lo,hi:c.sc.hi,shown:b.c.length,
 candles:JSON.stringify([c.bundle.t,c.bundle.o,c.bundle.h,c.bundle.l,c.bundle.c,c.bundle.m]),
 candleFirstX:c.L.x0+((b._lead||0)+.5)*c.bw,scale:visualViewport.scale,errors:[...el.querySelectorAll('svg [d],svg [points]')].some(e=>/NaN|Infinity/.test(e.getAttribute('d')||e.getAttribute('points')))};});}
async function axis(p,h,ratio){const g=await h.locator('.reel-tgrip').boundingBox();assert.ok(g);const x=g.x+g.width*.3,y=g.y+g.height*.5;
 await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+g.width*ratio,y,{steps:10});await p.mouse.up();await settle(p);}
async function touchPinch(p,h,session,compress=true){const r=await h.boundingBox(),y=r.y+r.height*.4,mid=r.x+r.width*.5;
 const spread=compress?[r.width*.7,r.width*.35]:[r.width*.35,r.width*.7];
 const points=d=>[{x:mid-d/2,y,id:1},{x:mid+d/2,y,id:2}];
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(spread[0])});
 for(let i=1;i<=6;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(spread[0]+(spread[1]-spread[0])*i/6)});
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(p);}
async function enter(p){await p.goto(url,{waitUntil:'domcontentloaded'});await p.locator('.up-skip').click({timeout:60000});await p.locator('.nav-tab[data-tab="charts"]').click();
 await p.locator('#reelSearch').fill(name);await p.locator('#tfBtnD').click();}
(async()=>{const browser=await chromium.launch();try{
 for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});
 const p=await context.newPage(),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!['GET','HEAD'].includes(r.method())&&new URL(r.url()).origin!==new URL(url).origin)writes.push(r.url());});
 if(!live)await p.route('**/ma500/**',async r=>{const rel=decodeURIComponent(new URL(r.request().url()).pathname.split('/ma500/')[1]);const f=path.join(__dirname,'../webapp/publish/browser-data',rel);let body=fs.existsSync(f)?fs.readFileSync(f):Buffer.from('null');if(body[0]===31&&body[1]===139)body=zlib.gunzipSync(body);await r.fulfill({contentType:'application/json',body});});
 await enter(p);let h=p.locator(mobile?'#chartReel .reel-chart':'#chartFullHost').first();
 await p.waitForFunction(({sel,name})=>document.querySelector(sel)?._reelCtx?.name===name,{sel:mobile?'#chartReel .reel-chart':'#chartFullHost',name},{timeout:60000});
 await h.locator('svg').waitFor({timeout:60000});await settle(p);
 const opened=await read(h),session=await context.newCDPSession(p);
 if(mobile)await h.scrollIntoViewIfNeeded();
 // Repeated real time-axis drags pass the old data-length ceiling on both devices.
 for(let i=0;i<12&&(await read(h)).view<opened.n*2;i++)await axis(p,h,.55);
 const compressed=await read(h);assert.ok(compressed.view>opened.n*1.5,`beyond history on ${mobile?'phone':'laptop'}: ${compressed.view}/${opened.n}`);
 assert.ok(compressed.lead>0,'empty slots before real candles');assert.equal(compressed.candles,opened.candles,'no data rewrite');assert.equal(compressed.errors,false);
 await axis(p,h,-.2);assert.ok((await read(h)).view<compressed.view,'reverse time-axis direction');
 if(mobile){
 const before=await read(h);await touchPinch(p,h,session);const after=await read(h);assert.ok(after.view>before.view,'actual phone pinch compresses');near(after.scale,before.scale,'phone pinch does not zoom browser');
 await touchPinch(p,h,session,false);assert.ok((await read(h)).view<after.view,'phone reverse pinch');
 }else{
 const r=await h.boundingBox();await p.mouse.move(r.x+r.width*.55,r.y+r.height*.4);const before=await read(h);
 await p.keyboard.down('Control');await p.mouse.wheel(0,70);await p.keyboard.up('Control');await settle(p);
 const after=await read(h);assert.ok(after.view>before.view,'real Ctrl-wheel trackpad route');near(after.scale,before.scale,'no browser page zoom');near(after.lo,before.lo,'trackpad keeps price floor');near(after.hi,before.hi,'trackpad keeps price ceiling');
 await p.keyboard.down('Control');await p.mouse.wheel(0,-70);await p.keyboard.up('Control');await settle(p);assert.ok((await read(h)).view<after.view);
 // Safari's distinct GestureEvent route (synthetic contract check; physical Mac remains manual).
 const safariBefore=await read(h);await h.evaluate(el=>{for(const [type,scale] of [['gesturestart',1],['gesturechange',.8],['gestureend',.8]]){const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'scale',{value:scale});el.dispatchEvent(e);}});await settle(p);assert.ok((await read(h)).view>safariBefore.view);
 }
 // Save an arranged view, then exercise Expand/Restore and a full reload.
 const panel=p.locator(mobile?'#chartReel .reel-card':'#chartFull').first();await panel.locator('[data-act="chart-view-save"]').click();await settle(p);
 const stored=await p.evaluate(()=>localStorage.getItem('sp-views')),saved=JSON.parse(stored)[name+'|D'];assert.ok(saved.slots>opened.n);assert.ok(saved.lead>0);
 const arranged=await read(h);
 await panel.locator(mobile?'[data-act="chart-expand"]':'[data-act="desktop-expand"]').click();h=p.locator('#chartFullHost');await h.locator('svg').waitFor();await settle(p);
 const full=await read(h);near(full.view,arranged.view,'expand keeps time extent');near(full.lo,arranged.lo,'expand keeps price floor');
 if(mobile)await touchPinch(p,h,session,false);else await axis(p,h,-.1);
 assert.ok((await read(h)).view<full.view,'expanded time zoom');
 await p.locator('#chartFull '+(mobile?'[data-act="chart-full-close"]':'[data-act="desktop-expand"]')).click();await settle(p);
 assert.equal(await p.evaluate(()=>localStorage.getItem('sp-views')),stored,'gestures do not overwrite explicit save');
 await enter(p);h=p.locator(mobile?'#chartReel .reel-chart':'#chartFullHost').first();await h.locator('svg').waitFor({timeout:60000});await settle(p);
 const restored=await read(h);near(restored.view,arranged.view,'reload restores slots');near(restored.lead,arranged.lead,'reload restores leading blank slots');near(restored.lo,saved.lo,'saved price floor');near(restored.hi,saved.hi,'saved price ceiling');
 // Panning an expanded time view can reposition the actual history.
 const r=await h.boundingBox();await p.mouse.move(r.x+r.width*.45,r.y+r.height*.45);await p.mouse.down();await p.mouse.move(r.x+r.width*.6,r.y+r.height*.45,{steps:8});await p.mouse.up();await settle(p);
 const moved=await read(h);assert.ok(moved.shown>=2);assert.notEqual(moved.from,restored.from,'pan repositions history');assert.equal(moved.candles,opened.candles);
 assert.equal(moved.errors,false);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 await p.screenshot({path:`time-zoom-results/${mobile?'phone':'laptop'}-${live?'live':'fixture'}.png`});
 console.log('TIME_ZOOM_IMAGE_'+(mobile?'PHONE':'LAPTOP')+'='+(await p.screenshot({type:'jpeg',quality:45})).toString('base64'));
 console.log('PASS time zoom '+JSON.stringify({mobile,live,name,loaded:opened.n,first:opened.first,last:opened.last,opening:opened.view,compressed:compressed.view,restored:restored.view,lead:restored.lead}));
 await context.close();
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
