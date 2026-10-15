const assert = require('node:assert/strict');

module.exports = async function checkChartFraming(page, name = 'TEST') {
  const read = async host => {
    // Full-screen layout and its ResizeObserver repaint finish on animation
    // frames; a just-inserted SVG can still describe the previous plot height.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    return host.evaluate(h => {
    const c = h._reelCtx, last = c.bundle.c.filter(v => v > 0).at(-1);
    return {lo:c.sc.lo, hi:c.sc.hi, px:c.plotPx, last, n:c.b.c.length,
      pctPerPx:c.sc.span/last/c.plotPx, mid:((c.sc.hi+c.sc.lo)/2-last)/last};
    });
  };
  const near = (a,b,label) => assert.ok(Math.abs(a-b) <= Math.max(Math.abs(b)*0.015,1e-9),label+': '+a+' vs '+b);
  await page.locator('.nav-tab[data-tab="charts"]').click();
  if (await page.locator('#reelReset').isVisible()) await page.locator('#reelReset').click();
  await page.locator('#reelSearch').fill(name);
  for (const tf of ['1H','4H','D']) {
    // Changing timeframe clears transient zoom/pan but restores saved views.
    await page.locator('#tfBtn'+(tf==='D'?'1H':'D')).click();
    await page.locator('#tfBtn'+tf).click();
    const card=page.locator('.reel-card[data-name="'+name+'"]');
    await card.locator('.reel-chart svg').waitFor();
    const before=await read(card.locator('.reel-chart'));
    await card.locator('[data-act="chart-expand"]').click();
    const host=page.locator('#chartFull .reel-chart');
    await host.locator('svg').waitFor();
    const opened=await read(host);
    near(opened.lo,before.lo,tf+' automatic frame does not zoom out on expand');
    near(opened.hi,before.hi,tf+' automatic frame does not zoom out on expand');
    near((opened.hi+opened.lo)/2,opened.last,tf+' opening price stays central');

    // A real axis gesture and Save, followed by a timeframe round trip.
    const grip=await host.locator('.reel-ygrip').boundingBox();
    const x=grip.x+grip.width/2, y=grip.y+grip.height*.45;
    await page.mouse.move(x,y); await page.mouse.down();
    await page.mouse.move(x,y+80,{steps:8}); await page.mouse.up();
    const adjusted=await read(host);
    assert.ok(Math.abs(adjusted.hi-adjusted.lo-(opened.hi-opened.lo))>1e-6,'Price drag changes scale');
    await page.locator('#chartFull [data-act="chart-view-save"]').click();
    assert.equal(await page.locator('#chartFull [data-act="chart-view-save"]').getAttribute('aria-pressed'),'true');
    const stored=await page.evaluate(()=>localStorage.getItem('sp-views'));
    const saved=JSON.parse(stored)[name+'|'+tf];
    await page.locator('#chartFull [data-act="chart-full-close"]').click();
    await page.locator('#tfBtn'+(tf==='D'?'1H':'D')).click();
    await page.locator('#tfBtn'+tf).click();
    await card.locator('.reel-chart svg').waitFor();
    await card.locator('[data-act="chart-expand"]').click();
    await host.locator('svg').waitFor();
    const restored=await read(host);
    near(restored.pctPerPx,saved.pctPerPx,tf+' saved zoom restores');
    near(restored.mid,saved.mid,tf+' saved vertical placement restores');
    assert.equal(await page.evaluate(()=>localStorage.getItem('sp-views')),stored,'Viewing never rewrites saved frames');
    await page.locator('#chartFull [data-act="chart-full-close"]').click();
  }
  console.log('PASS: 1H/4H/Daily default full-screen framing and saved-frame restoration');
};
