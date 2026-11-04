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
  for (const tf of ['1H','D']) {   // 4H removed 2026-11-04
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
    // A saved view is the exact frame (app.js v553): same first candle, same
    // window and the same price window, on full screen and on the card.
    assert.equal(saved.v,2,tf+' saves the exact frame');
    near(restored.slots,adjusted.slots,tf+' saved time window restores');
    assert.equal(await host.evaluate(h=>h._reelCtx.b.t[0]),saved.start,tf+' saved first candle restores');
    near(restored.lo,saved.lo,tf+' saved price floor restores');
    near(restored.hi,saved.hi,tf+' saved price top restores');
    assert.equal(await page.evaluate(()=>localStorage.getItem('sp-views')),stored,'Viewing never rewrites saved frames');
    await page.locator('#chartFull [data-act="chart-full-close"]').click();
    const onCard=await read(card.locator('.reel-chart'));
    near(onCard.lo,saved.lo,tf+' card shows the saved price floor');
    near(onCard.hi,saved.hi,tf+' card shows the saved price top');
    // Save is a press / unpress switch (user, 2026-11-01): a second tap
    // forgets the view, a third saves it again. No long press.
    const saveBtn=card.locator('[data-act="chart-view-save"]');
    await saveBtn.click();
    assert.equal(await saveBtn.getAttribute('aria-pressed'),'false',tf+' a second tap unsaves');
    assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('sp-views'))||'{}')[name+'|'+tf],undefined,tf+' …and forgets the stored view');
    assert.equal((await saveBtn.innerText()).trim(),'Save');
    await saveBtn.click();
    assert.equal(await saveBtn.getAttribute('aria-pressed'),'true',tf+' a third tap saves again');
    assert.equal((await saveBtn.innerText()).trim(),'Saved');
  }
  // Coming back to a saved chart shows its saved view, even after the reader
  // dragged it this session (user, 2026-11-03: "the chart never stay on the
  // saved view"). It used to be applied only the first time a chart opened.
  {
    const card=page.locator('.reel-card[data-name="'+name+'"]'), host=card.locator('.reel-chart');
    const saved=JSON.parse(await page.evaluate(()=>localStorage.getItem('sp-views')))[name+'|D'];
    const first=()=>host.evaluate(h=>h._reelCtx.b.t[0]);
    const drag=async dx=>{const b=await host.boundingBox(), x=b.x+b.width*.5, y=b.y+b.height*.4;
      await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+dx,y,{steps:10}); await page.mouse.up();
      await page.waitForTimeout(200);};
    assert.equal(await first(),saved.start,'Daily card is on its saved view');
    await drag(-200);
    assert.notEqual(await first(),saved.start,'a drag moves the saved chart');
    await page.locator('.nav-tab[data-tab="watchlist"]').click();
    await page.locator('.nav-tab[data-tab="charts"]').click();
    await host.locator('svg').waitFor();
    assert.equal(await first(),saved.start,'back on Charts, the dragged chart is on its saved view');
    await drag(-200);
    await card.locator('[data-act="chart-expand"]').click();
    const full=page.locator('#chartFull .reel-chart');
    await full.locator('svg').waitFor();
    assert.equal(await full.evaluate(h=>h._reelCtx.b.t[0]),saved.start,'full screen opens a dragged chart on its saved view');
    await page.locator('#chartFull [data-act="chart-full-close"]').click();
    assert.equal(await first(),saved.start,'closing full screen leaves the card on its saved view');
  }
  // A background data refresh must not change what the next drag starts from
  // (user, 2026-11-03: a saved GOLD 1H / Daily view "opened up" to the default
  // window the moment it was moved). The refresh rebuilt the reel and reset the
  // chart behind full screen without repainting it; the drag then grew from
  // the DEFAULT window with the saved prices.
  {
    const card=page.locator('.reel-card[data-name="'+name+'"]');
    await card.locator('[data-act="chart-expand"]').click();
    const full=page.locator('#chartFull .reel-chart');
    await full.locator('svg').waitFor();
    const slots=()=>full.evaluate(h=>Math.round((h._reelCtx.L.x1-h._reelCtx.L.x0)/h._reelCtx.bw));
    const saveBtn=page.locator('#chartFull [data-act="chart-view-save"]');
    if (await saveBtn.getAttribute('aria-pressed')==='true') await saveBtn.click();
    const tg=await full.locator('.reel-tgrip').boundingBox();
    await page.mouse.move(tg.x+tg.width*.5,tg.y+tg.height/2); await page.mouse.down();
    await page.mouse.move(tg.x+tg.width*.5-70,tg.y+tg.height/2,{steps:8}); await page.mouse.up();
    await saveBtn.click();
    const before=await slots();
    await page.clock.fastForward(31*60*1000);
    await page.waitForTimeout(1500);
    const b=await full.boundingBox(), x=b.x+b.width*.5, y=b.y+b.height*.4;
    await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+60,y,{steps:10}); await page.mouse.up();
    await page.waitForTimeout(200);
    assert.equal(await slots(),before,'after a data refresh, a drag keeps the saved window width');
    await page.locator('#chartFull [data-act="chart-full-close"]').click();
  }
  console.log('PASS: 1H/4H/Daily default full-screen framing and saved-frame restoration');
};
