const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const url=process.env.DESKTOP_URL||'http://127.0.0.1:8000',live=process.env.DESKTOP_LIVE==='1';
const out='readability-review-results';fs.mkdirSync(out,{recursive:true});
async function ready(page){await page.waitForFunction(()=>document.querySelector('#chartFullHost')?._reelCtx&&document.querySelector('#chartFullHost .reel-native-ma'),{timeout:60000});}
async function open(page,width){
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.locator('.up-skip').waitFor({timeout:60000});await page.locator('.up-skip').click();
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#tfBtn1H').click();
  if(width<1024){await page.locator('#chartReel .reel-native-ma').first().waitFor({timeout:60000});await page.locator('#chartReel [data-act="chart-expand"]').first().click();}
  await ready(page);
}
async function menu(page,on=true){
  if(await page.locator('#chartFull .reel-tf-menu').count()!==Number(on))await page.locator('#chartFull [data-act="tf-menu"]').click();
}
async function frame(page){return page.locator('#chartFullHost').evaluate(h=>({lo:h._reelCtx.sc.lo,hi:h._reelCtx.sc.hi,t:h._reelCtx.b.t}));}
async function widthOf(page,selector){return page.locator('#chartFullHost '+selector).first().evaluate(e=>parseFloat(getComputedStyle(e).strokeWidth));}
async function axis(page){return page.locator('#chartFullHost').evaluate(h=>{
 const texts=[...h.querySelectorAll('.reel-price-tick,.reel-axis-last')].map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent,top:r.top,bottom:r.bottom};}).sort((a,b)=>a.top-b.top);
 const hrect=h.getBoundingClientRect();return {texts,height:hrect.height,plot:h._reelCtx.plotPx,lo:h._reelCtx.sc.lo,hi:h._reelCtx.sc.hi};
});}
function noOverlap(a){for(let i=1;i<a.texts.length;i++)assert.ok(a.texts[i].top>=a.texts[i-1].bottom+1,JSON.stringify(a));}
(async()=>{
 const browser=await chromium.launch(),report=[];
 try{
  for(const [w,h] of [[1366,900],[390,844],[320,640]]){
   const context=await browser.newContext({viewport:{width:w,height:h}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   if(!live)await page.route('**/ma500/**',async r=>{
    const relative=decodeURIComponent(new URL(r.request().url()).pathname.split('/ma500/')[1]);
    const f=path.join(__dirname,'../webapp/publish/browser-data',relative);
    let b=fs.existsSync(f)?fs.readFileSync(f):Buffer.from('null');if(b[0]===31&&b[1]===139)b=zlib.gunzipSync(b);
    await r.fulfill({contentType:'application/json',body:b});
   });
   await open(page,w);
   await page.locator('#chartFull [data-act="chart-view-save"]').click();
   const before=await frame(page),saved=await page.evaluate(()=>localStorage.getItem('sp-views'));
   const native=[];
   for(const n of [1,2,3]){
    await menu(page);await page.locator(`[data-act="chart-weight"][data-part="nativeW"][data-v="${n}"]`).click();
    native.push(await widthOf(page,'.reel-native-ma'));assert.deepEqual(await frame(page),before,'MA thickness cannot change scale or dates');
   }
   assert.ok(native[0]<native[1]&&native[1]<native[2]);assert.equal(native[2],7,'original native weight retained');
   await page.locator('[data-act="chart-weight"][data-part="nativeW"][data-v="1"]').click();
   for(const tf of ['D','W','M']){
    const button=page.locator(`[data-act="ov-htf"][data-tf="${tf}"]`);
    if(await button.count()&&await button.getAttribute('aria-checked')!=='true')await button.click();
   }
   await page.locator('#chartFullHost .reel-ov polyline').first().waitFor({timeout:60000});
   const overlay=[];
   for(const n of [.6,1,1.7]){
    await page.locator(`[data-act="ov-maw"][data-v="${n}"]`).click();
    overlay.push(await page.locator('#chartFullHost .reel-ov > polyline').evaluateAll(es=>es.map(e=>parseFloat(getComputedStyle(e).strokeWidth))));
   }
   assert.ok(overlay[0].length>0);for(let i=0;i<overlay[0].length;i++)assert.ok(overlay[0][i]<overlay[1][i]&&overlay[1][i]<overlay[2][i],'each overlay family changes width');
   const pj=page.locator('[data-act="ov-proj"]');if(await pj.getAttribute('aria-checked')!=='true')await pj.click();
   const projection=[];
   for(const n of [.6,1,1.7]){
    await page.locator(`[data-act="ov-pjw"][data-v="${n}"]`).click();
    projection.push(await widthOf(page,'.reel-ov-proj polyline'));
   }
   assert.ok(projection[0]<projection[1]&&projection[1]<projection[2]);
   await page.locator('[data-act="ov-pjw"][data-v="0.6"]').click();
   await page.locator('[data-act="ov-maw"][data-v="0.6"]').click();
   const grid=[];for(const n of [1,2,3]){
    await page.locator(`[data-act="chart-weight"][data-part="gridW"][data-v="${n}"]`).click();grid.push(await widthOf(page,'.reel-tgrid'));
   }assert.ok(grid[0]<grid[1]&&grid[1]<grid[2]);
   await page.locator('[data-act="chart-weight"][data-part="gridW"][data-v="1"]').click();await menu(page,false);
   const weights={};await page.locator('#chartFull [data-act="channel"]').click();
   const toolbar=page.locator('#chartFull .reel-toolbar');
   for(const [kind,selector] of Object.entries({channel:'.reel-ch-edge',trend:'.reel-ch-edge',hline:'.reel-ch-edge',vline:'.reel-ch-edge',circle:'.reel-circle',triangle:'.reel-tri',entry:'.reel-entry',buy:'.reel-entry',sell:'.reel-entry',ladder:'.reel-ladder:not(.reel-ladder-key)'})){
    if(await toolbar.evaluate(e=>e.classList.contains('is-collapsed')))await toolbar.locator('.reel-draw-fold').click();
    await toolbar.locator(`[data-kind="${kind}"]`).click();
    if(await toolbar.evaluate(e=>e.classList.contains('is-collapsed')))await toolbar.locator('.reel-draw-fold').click();
    assert.deepEqual(await toolbar.locator('[data-act="draw-weight"]').allTextContents(),['Thin','Medium','Thick']);
    const vals=[];for(const n of [1,2,3]){
     await toolbar.locator(`[data-act="draw-weight"][data-v="${n}"]`).click();
     vals.push(await widthOf(page,'.reel-draw.is-sel '+selector));
    }
    assert.ok(vals[0]<vals[1]&&vals[1]<vals[2],kind+' distinct visible widths');weights[kind]=vals;
    await toolbar.locator('[data-act="draw-weight"][data-v="1"]').click();
    assert.ok(await page.locator('#chartFull .reel-draw.is-sel .reel-ch-grab').count()>0,'Thin '+kind+' retains large drag targets');
    const hit=await page.locator('#chartFull .reel-draw.is-sel .reel-ch-grab').first().getAttribute('r');assert.equal(hit,'42');
    if(kind!=='ladder')await toolbar.locator('[data-act="draw-delete"]').click();
   }
   await toolbar.locator('[data-act="draw-done"]').click();
   const normalAxis=await axis(page);noOverlap(normalAxis);
   const channels=await page.evaluate(()=>localStorage.getItem('sp-channels'));
   const prefs=await page.evaluate(()=>JSON.parse(localStorage.getItem('sp-overlay')));
   assert.equal(prefs.nativeW['1H'],1);assert.equal(prefs.maW.D,.6);assert.equal(prefs.proj.w,.6);
   await page.screenshot({path:`${out}/${w}-thin.png`});
   console.log(`READABILITY_IMAGE_${w}=`+(await page.screenshot({type:'jpeg',quality:60})).toString('base64'));
   if(w>=1024){
    await page.locator('[data-act="desktop-expand"]').click();await ready(page);noOverlap(await axis(page));
    assert.equal(await widthOf(page,'.reel-native-ma'),native[0]);assert.equal(await widthOf(page,'.reel-ladder:not(.reel-ladder-key)'),weights.ladder[0]);
    await page.keyboard.press('Escape');await ready(page);
   }else{
    await page.locator('#chartFull [data-act="chart-full-close"]').click();
    assert.equal(await page.locator('#chartReel .reel-native-ma').first().evaluate(e=>parseFloat(getComputedStyle(e).strokeWidth)),native[0]);
    await page.locator('#chartReel [data-act="chart-expand"]').first().click();await ready(page);
   }
   assert.deepEqual(await frame(page),before,'saved price range and dates survive settings/expand');
   assert.equal(await page.evaluate(()=>localStorage.getItem('sp-views')),saved);
   await page.reload({waitUntil:'domcontentloaded'});
   if(await page.locator('.up-skip').isVisible())await page.locator('.up-skip').click();
   await page.locator('.nav-tab[data-tab="charts"]').click();
   if(w<1024){await page.locator('#chartReel [data-act="chart-expand"]').first().click();}
   await ready(page);
   assert.equal(await widthOf(page,'.reel-native-ma'),native[0],'native preference restored');
   assert.equal(await page.evaluate(()=>localStorage.getItem('sp-channels')),channels,'drawing weights restored without migration');
   noOverlap(await axis(page));
   assert.deepEqual(errors,[]);report.push({width:w,height:h,native,overlay,projection,grid,weights,axis:normalAxis});
   await context.close();
  }
  fs.writeFileSync(out+'/checks.json',JSON.stringify(report,null,2));
  console.log('PASS universal weights, native/overlay/projection, all 10 tools, hit targets, saved settings/drawings, price framing, expanded/card views and adaptive axis');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
