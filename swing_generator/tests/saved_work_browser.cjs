// Two independent devices use the real app and authenticated sync handler.
// The portable preview is generated from the built app with offline fixtures.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const worker = (await import(pathToFileURL(path.resolve(__dirname, '../webapp/sync-worker/src/index.js')))).default;
  const disk = new Map(), env = {USER_DATA:{get:async k=>disk.get(k)??null,put:async(k,v)=>disk.set(k,v)}};
  let offline = false;
  const browser = await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox','--disable-crashpad-for-testing']});
  const errors=[];
  const html = process.env.SP_PREVIEW_HTML && fs.readFileSync(process.env.SP_PREVIEW_HTML,'utf8')
    .replace('window.fetch = async function(input) {','window.fetch = async function(input, options = {}) {')
    .replace("  const key = url.pathname.split('/ma500/')[1];", "  if (url.hostname === 'swingpulse-sync.xabilon18.workers.dev') { const reply = await window.__testSync(url.href, options); return new Response(reply.body, {status:reply.status,headers:{'content-type':'application/json'}}); }\n  const key = url.pathname.split('/ma500/')[1];");
  async function device() {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    page.setDefaultTimeout(10000);
    page.on('pageerror',e=>errors.push(e.message));
    async function syncRequest(url,options) {
      if(offline) throw new Error('Offline test');
      if(new URL(url).pathname.startsWith('/run')) return {status:200,body:JSON.stringify({ok:true,status:'none'})};
      const response=await worker.fetch(new Request(url,{method:options.method||'GET',headers:options.headers,body:options.body}),env);
      return {status:response.status,body:await response.text(),headers:Object.fromEntries(response.headers)};
    }
    const storageInit=()=>{
      if(location.protocol!=='about:') {
        localStorage.setItem('sp-user','zabs'); localStorage.setItem('sp-sync-token__zabs','test-token'); return;
      }
      const values=new Map([['sp-user','zabs'],['sp-sync-token__zabs','test-token']]);
      Object.defineProperty(window,'localStorage',{value:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)}});
    };
    if(html) {
      await page.route('**/*',r=>r.abort());
      await page.exposeFunction('__testSync',syncRequest);
      await page.evaluate(storageInit);
      await page.setContent(html,{waitUntil:'domcontentloaded'});
    } else {
      await page.addInitScript(storageInit);
      await page.route('**/swingpulse-sync.xabilon18.workers.dev/**',async route=>{
        try {
          const req=route.request(),reply=await syncRequest(req.url(),{method:req.method(),headers:req.headers(),body:req.postData()||undefined});
          await route.fulfill({status:reply.status,body:reply.body,contentType:'application/json',headers:{'access-control-allow-origin':'*',...reply.headers}});
        } catch (_) { await route.abort(); }
      });
      await page.route('**/ma500/**',async route=>{
        const relative=new URL(route.request().url()).pathname.split('/ma500/')[1];
        const file=path.resolve(__dirname,'../webapp/publish/browser-data',relative);
        let body=fs.existsSync(file)?fs.readFileSync(file):Buffer.from('null');
        if(body[0]===0x1f&&body[1]===0x8b)body=require('node:zlib').gunzipSync(body);
        await route.fulfill({body,contentType:'application/json'});
      });
      await page.goto(process.env.SMOKE_URL||'http://127.0.0.1:8000',{waitUntil:'networkidle'});
      await page.locator('.nav-tab[data-tab="charts"]').click();
    }
    await page.locator('#chartReel .reel-chart svg').first().waitFor();
    return page;
  }
  async function grid(page,tf,division) {
    await page.locator('#tfBtn'+tf).click();
    await page.locator('#chartReel .reel-chart svg').first().waitFor();
    await page.locator('#chartReel [data-act="grid-menu"]').first().click();
    await page.locator('.reel-grid-menu [data-division="'+division+'"]').click();
    await page.locator('#chartReel [data-act="grid-menu"]').first().click();
  }
  async function sync(page,fail=false) {
    await page.locator('#savedWorkBtn').click();
    await page.locator('[data-work-sync]').click();
    await page.waitForFunction(fail=>document.querySelector('[data-work-message]').textContent.includes(fail?'unavailable':'Synced'),fail);
    await page.locator('[data-work-close]').click();
  }
  const prefs=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('sp-chart-prefs__zabs')));
  try {
    const first=await device(),second=await device();
    await grid(first,'4H','H'); await sync(first); await sync(second);
    assert.equal((await prefs(second)).grids['4H'].division,'H','Second device receives first device grid');
    await grid(second,'1H','Y'); await sync(second); await sync(first);
    assert.equal((await prefs(first)).grids['1H'].division,'Y');
    assert.equal((await prefs(first)).grids['4H'].division,'H','Editing 1H preserves 4H');
    await first.locator('#chartReel [data-act="chart-expand"]').first().click();
    await first.locator('#chartFull [data-act="channel"]').click();
    await first.locator('#chartFull [data-act="channel-add"][data-kind="hline"]').click();
    await first.locator('#chartFull [data-act="draw-done"]').click();
    await first.waitForFunction(()=>localStorage.getItem('sp-draw-dirty__zabs')==null);
    await first.locator('#chartFull [data-act="chart-full-close"]').click();
    await sync(second);
    const drawings=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('sp-channels__zabs')));
    assert.deepEqual(await drawings(second),await drawings(first),'Done syncs drawings to another device');
    const saved=await drawings(first);
    offline=true; await sync(first,true);
    assert.deepEqual(await drawings(first),saved,'Offline sync keeps drawings');
    offline=false; await sync(first);
    assert.deepEqual(errors,[]);
    console.log('PASS: two-device grid isolation and merging, Done drawing sync, offline status and recovery');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
