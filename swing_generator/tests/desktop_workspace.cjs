const {chromium} = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const url = process.env.DESKTOP_URL || 'http://127.0.0.1:8000';
const live = process.env.DESKTOP_LIVE === '1';
const output = 'desktop-review-results';
fs.mkdirSync(output, {recursive:true});
async function fixture(page) {
  if (live) return;
  await page.route('**/ma500/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    const file = path.join(__dirname, '../webapp/publish/browser-data', relative);
    let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
    if(body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    await route.fulfill({contentType:'application/json', body});
  });
}
async function enter(page, target=url) {
  await page.goto(target, {waitUntil:'domcontentloaded'});
  await page.locator('.up-skip').waitFor({timeout:60000});
  await page.locator('.up-skip').click();
  await page.locator('.nav-tab[data-tab="charts"]').click();
}
async function ready(page, desktop=true) {
  const selector = desktop ? '#chartFullHost' : '#chartReel .reel-chart';
  await page.waitForFunction(s => {
    const h=document.querySelector(s);
    return h?._reelCtx && h.querySelector('svg') && h.clientHeight > 100;
  }, selector, {timeout:60000});
  await page.waitForTimeout(250);
}
async function layout(page) {
  return page.evaluate(() => {
    const box = s => {const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
    const host=document.querySelector('#chartFullHost'), svg=host.querySelector('svg');
    return {chart:box('#chartFull'),host:box('#chartFullHost'), list:box('#desktopChartWatchlist'),
      footer:box('#chartFull .reel-foot'), header:box('#chartFull .cf-head'),
      background:getComputedStyle(document.querySelector('#chartFull')).backgroundColor,
      vb:{w:svg.viewBox.baseVal.width,h:svg.viewBox.baseVal.height},
      width:innerWidth,height:innerHeight, scroll:document.documentElement.scrollWidth,
      stageParent:document.querySelector('#chartFull').parentElement.id};
  });
}
(async () => {
  const browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:1366,height:768}});
  const page=await context.newPage(), errors=[], writes=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('request', r=>{if(!['GET','HEAD'].includes(r.method()) && new URL(r.url()).origin!==new URL(url).origin) writes.push(r.url());});
  await fixture(page);
  try {
    await enter(page); await ready(page);
    assert.equal(await page.locator('#desktopChartWorkspace').count(),1);
    assert.equal(await page.locator('.topbar-stack .logo').count(),1);
    assert.ok(await page.locator('#desktopChartList button').count()>0);
    if(live) {
      assert.ok(await page.locator('#desktopChartList button').count()>100,'real published instrument list');
      const metadata=await (await context.request.get(url+'/preview.json')).json();
      assert.equal(metadata.revision,process.env.REVIEW_SHA);
      for(const [asset,hash] of Object.entries(metadata.assets)) {
        const bytes=await (await context.request.get(url+'/'+asset)).body();
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),hash,asset+' matches reviewed package');
      }
      assert.equal(metadata.production,false);
      // Selecting a named profile and local save cannot reach production sync.
      const result=await page.evaluate(async()=>{
        await fetch('/__preview-sync/sync?user=review-check',{method:'PUT',body:JSON.stringify({lastModified:123,notes:{TEST:'local'}})});
        return (await fetch('/__preview-sync/sync?user=review-check')).json();
      });
      assert.equal(result.notes.TEST,'local');
    }
    const report=[];
    for(const [width,height] of [[1024,640],[1280,720],[1366,768],[1440,900],[1920,1080]]) {
      await page.setViewportSize({width,height}); await ready(page);
      const l=await layout(page);report.push(l);
      assert.equal(l.background,'rgb(255, 255, 255)');
      assert.equal(l.stageParent,'desktopChartStage');
      assert.ok(l.chart.right<=l.list.x,'chart left, watchlist right');
      assert.ok(l.chart.w>l.list.w && l.host.h>200,'chart is the main area');
      assert.ok(l.footer.bottom<=height && l.header.y>=0,'controls fit viewport');
      assert.ok(l.scroll<=width+1,'no horizontal overflow');
      assert.ok(Math.abs(l.vb.w/l.vb.h-l.host.w/l.host.h)<.015,'SVG keeps its aspect ratio');
      const controls=await page.locator('#chartFull .cf-main-row').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
      assert.ok(controls.scroll<=controls.width+1,'toolbar controls do not overflow at '+width);
    }
    await page.setViewportSize({width:1366,height:768});await ready(page);
    await page.screenshot({path:output+'/desktop-workspace.png'});
    console.log('REVIEW_IMAGE_WORKSPACE='+(await page.screenshot({type:'jpeg',quality:50})).toString('base64'));
    await page.locator('#chartFull [data-act="chart-view-save"]').click();
    const savedFrame=await page.evaluate(()=>localStorage.getItem('sp-views'));
    const priceFrame=()=>page.locator('#chartFullHost').evaluate(h=>({lo:h._reelCtx.sc.lo,hi:h._reelCtx.sc.hi}));
    const prices=await priceFrame();
    const before=await layout(page);
    await page.locator('[data-act="desktop-list-toggle"]').click(); await ready(page);
    assert.equal(await page.locator('#desktopChartWatchlist').isVisible(),false);
    assert.ok((await layout(page)).host.w>before.host.w+150,'collapse gives chart more room');
    await page.locator('[data-act="desktop-expand"]').click();await ready(page);
    assert.equal(await page.locator('.topbar-stack').isVisible(),false);
    assert.equal(await page.locator('#bottomNav').isVisible(),false);
    const expanded=await layout(page);
    assert.equal(expanded.chart.x,0);assert.equal(expanded.chart.y,0);
    assert.equal(expanded.chart.w,1366);assert.equal(expanded.chart.h,768);
    await page.screenshot({path:output+'/desktop-expanded.png'});
    console.log('REVIEW_IMAGE_EXPANDED='+(await page.screenshot({type:'jpeg',quality:45})).toString('base64'));
    await page.keyboard.press('Escape');await ready(page);
    assert.equal(await page.locator('.topbar-stack').isVisible(),true);
    assert.equal(await page.evaluate(()=>localStorage.getItem('sp-views')),savedFrame,'saved view survives expand/restore');
    assert.deepEqual(await priceFrame(),prices,'absolute saved prices survive resizing');
    assert.equal(await page.locator('#desktopChartWatchlist').isVisible(),false,'restore remembers collapsed list');
    await page.locator('[data-act="desktop-list-toggle"]').click();
    for(const tf of ['4H','D','1H']) {
      await page.locator('#tfBtn'+tf).click();await ready(page);
      assert.ok((await page.locator('#chartFull .cf-title').innerText()).includes(tf==='D'?'Daily':tf));
      assert.equal(await page.locator('#desktopChartWorkspace').count(),1);
    }
    if(live) {
      const first=await page.locator('#chartFull .reel-name').innerText();
      await page.locator('#desktopChartList button').nth(1).click();await ready(page);
      assert.notEqual(await page.locator('#chartFull .reel-name').innerText(),first);
      await page.locator('#chartFull [data-act="chart-full-step"][data-dir="-1"]').click();await ready(page);
      assert.equal(await page.locator('#chartFull .reel-name').innerText(),first);
    }
    await page.locator('#reelSearch').fill('NO_SUCH_INSTRUMENT_123');
    await page.locator('.dc-empty').waitFor();
    await page.locator('#reelSearch').fill('');await ready(page);
    // Existing save action and drawing gestures, including restored absolute scale.
    if(!live) {
      await page.locator('#tfBtn4H').click();await ready(page);
      const full=page.locator('#chartFull');
      await full.locator('[data-act="channel"]').click();
      await full.locator('.reel-toolbar [data-kind="ladder"]').click();
      assert.equal(await full.locator('.reel-draw.is-sel .reel-ladder').count(),11);
      const saved=()=>page.evaluate(()=>localStorage.getItem('sp-channels'));
      const beforeDraw=await saved();
      const lock=full.locator('.reel-draw-lock');
      await lock.click();
      assert.equal(await lock.getAttribute('aria-pressed'),'true');
      await full.locator('[data-act="draw-undo"]').click();
      assert.equal(await lock.getAttribute('aria-pressed'),'false');
      const handle=await full.locator('.reel-ch-grab').last().boundingBox();
      await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
      await page.mouse.down();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2-25,{steps:8});await page.mouse.up();
      assert.notEqual(await saved(),beforeDraw,'desktop drawing handles persist edits');
      const drawn=await saved();
      await full.locator('[data-act="desktop-expand"]').click();await ready(page);
      await full.locator('[data-act="desktop-expand"]').click();await ready(page);
      assert.equal(await saved(),drawn,'expand/restore preserves drawings');
      await full.locator('[data-act="channel"]').click();
    }
    for(const width of [1023,390,320]) {
      await page.setViewportSize({width,height:844});await ready(page,false);
      assert.equal(await page.locator('#desktopChartWorkspace').count(),0);
      assert.equal(await page.locator('#pane-charts > #reelFilterBar').count(),1);
      assert.equal(await page.locator('[data-act="desktop-expand"]').count(),0);
      assert.ok(await page.locator('#chartReel .reel-card').count()>0);
      if(width===390) {
        await page.locator('#chartReel [data-act="chart-expand"]').first().click();
        await page.locator('#chartFullHost svg').waitFor();
        assert.equal(await page.locator('#chartFull').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
        await page.screenshot({path:output+'/phone-unchanged.png'});
        await page.locator('#chartFull [data-act="chart-full-close"]').click();
      }
    }
    await page.setViewportSize({width:1366,height:768});await ready(page);
    await page.locator('.nav-tab[data-tab="watchlist"]').click();
    assert.equal(await page.locator('#desktopChartWorkspace').count(),0,'leave charts cleans up desktop workspace');
    await page.locator('.nav-tab[data-tab="charts"]').click();await ready(page);
    assert.equal(errors.length,0,errors.join('\n'));
    assert.deepEqual(writes,[],'no production user-data writes');
    fs.writeFileSync(output+'/layout.json',JSON.stringify(report,null,2));
    console.log('PASS desktop layout, sizes, collapse, expand/restore, timeframes, filters, phone transitions, production-write isolation');
  } catch(error) {
    await page.screenshot({path:output+'/failure.png'}).catch(()=>{});
    console.error('Page errors:', errors);
    console.log('REVIEW_IMAGE_FAILURE='+(await page.screenshot({type:'jpeg',quality:50})).toString('base64'));
    throw error;
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
