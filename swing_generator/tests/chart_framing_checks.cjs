const assert = require('node:assert/strict');

module.exports = async function checkChartFraming(page, name = 'TEST') {
  const read = async host => {
    // Full-screen layout and its ResizeObserver repaint finish on animation
    // frames; a just-inserted SVG can still describe the previous plot height.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    return host.evaluate(h => {
    const c = h._reelCtx, last = c.bundle.c.filter(v => v > 0).at(-1);
    const lows = (c.b.l || []).filter(v => v != null), highs = (c.b.h || []).filter(v => v != null);
    return {lo:c.sc.lo, hi:c.sc.hi, px:c.plotPx, last, n:c.b.c.length, slots:(c.L.x1-c.L.x0)/c.bw,
      pctPerPx:c.sc.span/last/c.plotPx, mid:((c.sc.hi+c.sc.lo)/2-last)/last,
      barLo:Math.min(...lows), barHi:Math.max(...highs)};
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
    if (tf === 'D' || tf === '4H') {
      // 4H (quarters) and Daily (years) on every market are priced 'all'
      // (REEL_FRAME_VIEW, 2026-10-22): every candle in view fits, with a
      // margin either side.
      // 1H ('centre') falls through to the centred check below.
      assert.ok(opened.lo < opened.barLo && opened.hi > opened.barHi,
        tf+' fits every candle in view: '+JSON.stringify([opened.lo, opened.barLo, opened.barHi, opened.hi]));
    } else if (opened.lo === 0) {
      assert.ok(opened.hi >= 2*opened.last,tf+' large positive-price swings trim only the empty space below zero');
    } else {
      near((opened.hi+opened.lo)/2,opened.last,tf+' opening price stays central');
    }

    // A real axis gesture and Save, followed by a timeframe round trip.
    // The grips are rebuilt with the chart on every repaint, so a box read
    // straight after a drag can land on the swap and come back null — the
    // race that failed deploys on 2026-10-19/20. Retry until it is back.
    const boxOf=async loc=>{for(let i=0;i<40;i++){const b=await loc.boundingBox();if(b)return b;await page.waitForTimeout(50);}
      throw new Error(tf+' grip never became visible');};
    const grip=await boxOf(host.locator('.reel-ygrip'));
    const x=grip.x+grip.width/2, y=grip.y+grip.height*.45;
    await page.mouse.move(x,y); await page.mouse.down();
    await page.mouse.move(x,y+80,{steps:8}); await page.mouse.up();
    // And a time-scale drag (zoom in), so Save holds both halves.
    const tg=await boxOf(host.locator('.reel-tgrip'));
    const tx=tg.x+tg.width*.5, ty=tg.y+tg.height/2;
    await page.mouse.move(tx,ty); await page.mouse.down();
    await page.mouse.move(tx-60,ty,{steps:8}); await page.mouse.up();
    const adjusted=await read(host);
    assert.ok(adjusted.slots < opened.slots - 1,tf+' time drag zooms in: '+adjusted.slots+' vs '+opened.slots);
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
    near(restored.slots,adjusted.slots,tf+' saved time window restores');
    near(restored.pctPerPx,saved.pctPerPx,tf+' saved zoom restores');
    near(restored.mid,saved.mid,tf+' saved vertical placement restores');
    assert.equal(await page.evaluate(()=>localStorage.getItem('sp-views')),stored,'Viewing never rewrites saved frames');
    await page.locator('#chartFull [data-act="chart-full-close"]').click();
  }
  console.log('PASS: 1H/4H/Daily default full-screen framing and saved-frame restoration');
};
