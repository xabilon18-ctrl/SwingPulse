const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('node:assert/strict');

let debugPage;
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); debugPage=page;
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Chart range lives in the first chart's Grid menu, under Time grid
  // (2026-10-28). Each helper opens the menu and closes it again.
  const gridMenu = async fn => {
    const btn = page.locator('#chartReel [data-act="grid-menu"]').first();
    await btn.click();
    await page.locator('.reel-grid-menu').waitFor();
    try { return await fn(page.locator('.reel-grid-menu')); }
    finally { await btn.click(); }
  };
  const rangeOn = () => gridMenu(m => m.locator('[data-act="range-set"].on').getAttribute('data-range'));
  const setRange = bars => gridMenu(m => m.locator(`[data-act="range-set"][data-range="${bars}"]`).click());
  let summaries = 0, chunks = 0, revision = 0;
  const live = process.env.SMOKE_LIVE === '1';
  if (!live) {
    // Install before navigation so the app's interval is registered on this
    // clock; installing after load leaves already-created real timers intact.
    await page.clock.install();
    const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
    await page.route('**/ma500/**', async route => {
      const url = new URL(route.request().url());
      const relative = decodeURIComponent(url.pathname.split('/ma500/')[1]);
      const file = path.join(dataDir, relative);
      if (relative === 'summary.json') summaries++;
      if (relative.startsWith('chart/1H/') && relative.endsWith('.json')) chunks++;
      let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
      if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
      if (relative === 'summary.json') {
        const summary = JSON.parse(body);
        summary.fetched_at = new Date(Date.parse(summary.fetched_at) + revision * 60000).toISOString();
        body = JSON.stringify(summary);
      }
      await route.fulfill({ contentType: 'application/json', body });
    });
  }
  await page.addInitScript(() => {
    localStorage.setItem('swingpulse-chart-tf', '30m');
    localStorage.setItem('swingpulse-tf', '30m');
    localStorage.setItem('swingpulse-wl-ui', JSON.stringify({ ttf: '30m' }));
    localStorage.setItem('swingpulse-al-ui', JSON.stringify({ tf: '30m' }));
    localStorage.setItem('swingpulse-mk-ui', JSON.stringify({ ccyTf: '30m' }));
    // A Chart range stored by an older version must not survive the load: a set
    // range switches off every timeframe's opening frame (2026-10-27).
    localStorage.setItem('swingpulse-reel-range', '130');
  });
  await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  await page.locator('.up-skip').click();
  await page.locator('.nav-tab[data-tab="charts"]').click();
  assert.equal(await page.locator('[data-tf="30m"]').count(), 0, 'Removed timeframe has no global or chart control');
  assert.equal(await page.locator('#tfBtn1H').getAttribute('aria-selected'), 'true', 'Saved 30m chart selection opens on 1H');
  assert.equal(await page.evaluate(() => localStorage.getItem('swingpulse-chart-tf')), '1H');
  await page.locator('#tfBtn1H').click();
  await page.waitForFunction(() => document.querySelector('#tfBtn1H').getAttribute('aria-selected') === 'true');
  await page.locator('.reel-chart svg').first().waitFor({ timeout: 60000 });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(await page.evaluate(() => localStorage.getItem('swingpulse-reel-range')), null, 'stored Chart range is dropped');
  assert.equal(await rangeOn(), '0', 'charts open on their frames, not a stored range');
  if (!live) {
    assert.ok(chunks > 0, '1H chart chunk was fetched');
    const oldSummaries = summaries, oldChunks = chunks;
    const refreshedSummary = page.waitForResponse(r => r.url().includes('/ma500/summary.json'));
    const refreshedChart = page.waitForResponse(r => r.url().includes('/ma500/chart/1H/'));
    revision++;
    await page.clock.fastForward(30 * 60 * 1000 + 1000);
    await Promise.all([refreshedSummary, refreshedChart]);
    await page.waitForFunction(() => document.querySelector('.reel-chart svg'));
    await page.waitForTimeout(1000);
    assert.ok(summaries > oldSummaries, 'visible app reloads datasets after 30 minutes');
    assert.ok(chunks > oldChunks, 'new dataset invalidates and reloads chart chunks');
  }
  if (!live) {
    // Weekly and Monthly (back 2026-10-19): chart only, each read through its own
    // chunk map, with no 4H read under their name, divided by administration
    // term with every line equal (no bold, no year lines).
    const shownBars = {};
    for (const [tf, word] of [['W', 'weekly'], ['M', 'monthly']]) {
      const index = page.waitForResponse(r => r.url().includes(`/ma500/chart/${tf}/index.json`));
      const chunk = page.waitForResponse(r => r.url().includes(`/ma500/chart/${tf}/0.json`));
      await page.locator(`#tfBtn${tf}`).click();
      await Promise.all([index, chunk]);
      await page.waitForFunction(id => document.querySelector(id).getAttribute('aria-selected') === 'true', `#tfBtn${tf}`);
      await page.locator('#chartReel .reel-chart svg').first().waitFor({ timeout: 60000 });
      const card = await page.locator('#chartReel .reel-card').first().innerText();
      // Labels are thinned to fit, so which ones are named depends on width.
      // Labels are thinned to fit, so which terms are named depends on width.
      assert.ok(/20\d\d · (Obama|Trump|Biden)/.test(card), `${tf} is divided by term`);
      const grid = page.locator('#chartReel .reel-card').first();
      assert.equal(await grid.locator('.reel-tgrid-admin, .reel-tgrid-year, .reel-tgrid-quarter, .reel-tgrid-month').count(), 0, `${tf} lines are all equal`);
      assert.ok(await grid.locator('line.reel-tgrid').count() >= 3, `${tf} draws its term lines`);
      assert.ok(!/\b[WM] (aligned|minor)/.test(card), `${tf} shows no borrowed 4H relation`);
      assert.ok(/Bar \d+ \w+/.test(card), `${word} bar is dated`);
      shownBars[tf] = await page.locator('#chartReel .reel-chart').first().evaluate(h => h._reelCtx.b.c.length);
      if (tf === 'W') {
        // The Monthly overlay on Weekly, drawn from the Weekly bundle's own `mo`.
        await page.locator('#chartReel [data-act="tf-menu"]').first().click();
        await page.locator('.reel-tf-menu [data-act="ov-htf"][data-tf="M"]').click();
        await page.waitForFunction(() => [...document.querySelectorAll('#chartReel .reel-chart .reel-ov text')].some(t => t.textContent.startsWith('M50')));
        await page.locator('.reel-tf-menu [data-act="ov-htf"][data-tf="M"]').click();
        await page.locator('#chartReel [data-act="tf-menu"]').first().click();
      }
    }
    // Chart range is PER TIMEFRAME (2026-10-28): Close up tapped on Monthly
    // zooms Monthly only; Weekly keeps its opening frame, and Monthly keeps
    // the range when the reader comes back to it.
    const firstShown = () => page.locator('#chartReel .reel-chart').first().evaluate(h => h._reelCtx.b.c.length);
    const toTf = async tf => {
      await page.locator(`#tfBtn${tf}`).click();
      await page.waitForFunction(id => document.querySelector(id).getAttribute('aria-selected') === 'true', `#tfBtn${tf}`);
      await page.locator('#chartReel .reel-chart svg').first().waitFor({ timeout: 60000 });
    };
    assert.ok(shownBars.M > 65 && shownBars.W > 65, 'both charts open on more than 65 bars: ' + JSON.stringify(shownBars));
    assert.equal(await page.locator('#reelMenuSort [data-range]').count(), 0, 'Chart range is no longer in the Sort menu');
    await setRange(65);
    await page.waitForFunction(() => document.querySelector('#chartReel .reel-chart')._reelCtx.b.c.length === 65);
    await toTf('W');
    assert.equal(await rangeOn(), '0', 'Weekly shows no range');
    assert.equal(await firstShown(), shownBars.W, 'Weekly keeps its opening frame');
    await toTf('M');
    assert.equal(await rangeOn(), '65', 'Monthly keeps its own range');
    assert.equal(await firstShown(), 65, 'Monthly is still zoomed to 65 bars');
    const storedRanges = () => page.evaluate(() => JSON.parse(localStorage.getItem('swingpulse-reel-ranges')));
    assert.deepEqual(await storedRanges(), { M: 65 }, 'only the Monthly range is remembered');
    assert.ok(await page.locator('#chartReel .reel-grid-btn.on').count() > 0, 'the Grid button is lit while a range is set');
    await setRange(0);
    assert.deepEqual(await storedRanges(), {}, 'Full window forgets it');
    // The Monthly overlay on Daily rolls from the Monthly chart's whole history
    // (2026-10-28, "like on the monthly MAs"). The fixture's Daily bundle
    // carries no Monthly lines at all and its Monthly chart 25 years, so an
    // M250 on Daily can only come from there.
    await toTf('D');
    await page.locator('#chartReel [data-act="tf-menu"]').first().click();
    await page.locator('.reel-tf-menu [data-act="ov-htf"][data-tf="M"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#chartReel .reel-chart .reel-ov text')].some(t => t.textContent.startsWith('M250')));
    assert.match(await page.locator('.reel-tf-menu').innerText(), /50 · 250 · 500/, 'the menu lists the Monthly 500');
    await page.locator('.reel-tf-menu [data-act="ov-htf"][data-tf="M"]').click();
    await page.locator('#chartReel [data-act="tf-menu"]').first().click();
    assert.equal(errors.length, 0, errors.join('\n'));
  }
  await page.locator('#tfBtn4H').click();
  await page.waitForFunction(() => document.querySelector('#tfBtn4H').getAttribute('aria-selected') === 'true');
  await page.locator('#chartReel [data-act="chart-expand"]').first().click();
  await page.locator('#chartFull .reel-chart svg').waitFor({ timeout: 60000 });
  // The full name under the symbol: the fixture's own name offline; live, the
  // first chart is any market (ABSA reads "Absa"), so only that it is not blank.
  const fullName = page.locator('#chartFull .cf-fullname');
  if (!live) assert.equal(await fullName.innerText(), 'Test instrument', 'full name under the symbol');
  else if (await fullName.count()) assert.ok((await fullName.innerText()).trim(), 'full name is not blank');
  for (let i = 0; i < 2; i++) {
    // Repainting replaces the SVG node, so read visibility and coordinates
    // together instead of racing waitFor() against a separate boundingBox().
    const ready = await page.waitForFunction(() => {
      const el = document.querySelector('#chartFull .reel-tgrip');
      if (!el) return null;
      const { x, y, width, height } = el.getBoundingClientRect();
      return width > 0 && height > 0 ? { x, y, width, height } : null;
    });
    const grip = await ready.jsonValue();
    await ready.dispose();
    await page.mouse.move(grip.x + 12, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width - 8, grip.y + grip.height / 2, { steps: 12 });
    await page.mouse.up();
  }
  await page.locator('#chartFull .reel-tgrid-year').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('#chartFull .reel-tgrid-year').first().evaluate(line => getComputedStyle(line).strokeWidth), '2px', 'Thin yearly guide retains a stronger boundary than ordinary grid lines');
  assert.ok(await page.locator('#chartFull .reel-tgrid-year').count() > 0, 'Permanent yearly references render on 4H');
  // The time grid in use sits after the timeframe in the header (2026-10-28)
  // and follows a new choice at once. A session-only 4H feed draws Month as
  // two-month blocks, so the tag may read 2M.
  const gridTag = () => page.locator('#chartFull [data-cf-grid]').innerText();
  assert.match(await gridTag(), /^· \S+$/, 'full screen names its time grid');
  await page.locator('#chartFull [data-act="grid-menu"]').click();
  await page.locator('.reel-grid-menu [data-division="M"]').click();
  await page.waitForFunction(() => /^· (M|2M)$/.test(document.querySelector('#chartFull [data-cf-grid]').textContent));
  // Swap shaded gaps is kept per market (2026-10-17; 'other' split into
  // energy, commodities, crypto, currency and rates 2026-10-21). The swap
  // lands on the open chart's market only (TEST offline is a stock; live, the
  // first chart can be any market), and the other markets keep their own.
  await page.locator('.reel-grid-menu [data-act="grid-set"][data-part="on"]').click();
  const bandXs = () => page.locator('#chartFull .reel-band-g rect').evaluateAll(rs => rs.map(r => r.getAttribute('x')).join(','));
  const unswapped = await bandXs();
  assert.ok(unswapped.length > 0, 'Shading draws bands on 4H');
  const market = await page.locator('.reel-grid-menu [data-division="M"]').getAttribute('data-grid-scope');
  assert.ok(await page.evaluate(m => Object.hasOwn(window.SwingPulseModules.chartPreferences.scopes, m), market), 'The menu names a known market');
  if (!live) assert.equal(market, 'stocks', 'TEST is a stock');
  await page.locator('.reel-grid-menu [data-part="flip"]').click();
  await page.waitForFunction(before => [...document.querySelectorAll('#chartFull .reel-band-g rect')].map(r => r.getAttribute('x')).join(',') !== before, unswapped);
  const shade4h = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('sp-overlay')))).shade['4H']);
  assert.deepEqual(Object.keys(shade4h.flipBy), [market], 'Only the open chart\'s market is swapped');
  assert.equal(shade4h.flipBy[market], true);
  await page.locator('.reel-grid-menu [data-part="flip"]').click();
  await page.waitForFunction(before => [...document.querySelectorAll('#chartFull .reel-band-g rect')].map(r => r.getAttribute('x')).join(',') === before, unswapped);
  await page.locator('.reel-grid-menu [data-act="grid-set"][data-part="on"]').click();
  await page.locator('#chartFull [data-act="grid-menu"]').click();
  await require('./drawing_toolbar_checks.cjs')(page);
  await require('./saved_work_checks.cjs')(page);
  await page.locator('#tfBtn1H').click();
  await page.screenshot({ path: 'hourly-chart-mobile.png', fullPage: false });
  await page.locator('.nav-tab[data-tab="scanner"]').click();
  await page.locator('.al-chips [data-al-tf="4H"]').waitFor();
  await page.locator('.al-chips [data-al-tf="D"]').waitFor();
  assert.equal(await page.locator('.al-chips [data-al-tf="1H"]').count(), 0, '1H is linked entry context, not a standalone signal stream');
  assert.ok((await page.locator('#alertsPane').innerText()).includes('linked 1H entry detail'));
  assert.equal(await page.locator('[data-al-tf="30m"]').count(), 0);
  await page.locator('.nav-tab[data-tab="watchlist"]').click();
  assert.equal(await page.locator('[data-wl-ttf="30m"]').count(), 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  if (!live) await require('./chart_framing_checks.cjs')(page);
  assert.equal(errors.length, 0, errors.join('\n'));
  if (!live) {
    // A remembered range comes back after a reload on its own timeframe only;
    // values the buttons do not offer, and unknown timeframes, are dropped.
    await page.evaluate(() => localStorage.setItem('swingpulse-reel-ranges', JSON.stringify({ M: 65, W: 7, XX: 65 })));
    await page.reload({ waitUntil: 'networkidle' });
    if (await page.locator('.up-skip').isVisible()) await page.locator('.up-skip').click();
    await page.locator('.nav-tab[data-tab="charts"]').click();
    for (const [tf, want] of [['M', '65'], ['W', '0']]) {
      await page.locator(`#tfBtn${tf}`).click();
      await page.waitForFunction(id => document.querySelector(id).getAttribute('aria-selected') === 'true', `#tfBtn${tf}`);
      await page.locator('#chartReel .reel-chart svg').first().waitFor({ timeout: 60000 });
      assert.equal(await rangeOn(), want, `${tf} range after reload`);
    }
    assert.equal(await page.locator('#chartReel .reel-chart').first().evaluate(h => h._reelCtx.b.c.length) === 65, false, 'Weekly is not zoomed by the Monthly range');
    assert.equal(errors.length, 0, errors.join('\n'));
    // Active at last close (2026-10-28): a row per timeframe with a busy
    // sector (the fixture: Technology on Day and Week, quiet on Month), and a
    // tap opens that sector's markets on Charts at that timeframe.
    await page.locator('.nav-tab[data-tab="watchlist"]').click();
    const strip = page.locator('#wl2Active');
    await strip.locator('.wl2-act-s').first().waitFor();
    // One entry per sector, then the timeframes it is busy on (none for M).
    assert.deepEqual(await strip.locator('.wl2-act-s').allInnerTexts(), ['Tech']);
    assert.deepEqual(await strip.locator('.wl2-act-tf.up').allInnerTexts(), ['D▲', 'W▲']);
    // Tapping ACTIVE opens the numbers (a phone never shows the hover title).
    assert.equal(await strip.locator('.wl2-act-panel').count(), 0);
    await strip.locator('.wl2-act-hd').click();
    assert.deepEqual(await strip.locator('.wl2-act-p-tf').evaluateAll(es => es.map(e => e.firstChild.textContent)), ['Day', 'Week']);
    assert.match(await strip.locator('.wl2-act-panel').innerText(), /Tech ▲\s+4 big moves/);
    await strip.locator('.wl2-act-hd').click();
    assert.equal(await strip.locator('.wl2-act-panel').count(), 0, 'tapping ACTIVE again closes it');
    await strip.locator('[data-act-tf="W"][data-act-sector="Technology"]').click();
    await page.waitForFunction(() => document.querySelector('#tfBtnW').getAttribute('aria-selected') === 'true');
    await page.locator('#chartReel .reel-card').first().waitFor();
    assert.match(await page.locator('#reelSimBar').innerText(), /Active: Technology · Week · 1/);
    assert.deepEqual(await page.locator('#chartReel .reel-card').evaluateAll(cs => cs.map(c => c.dataset.name)), ['TEST']);
    assert.equal(errors.length, 0, errors.join('\n'));

    // Swipe between lists (2026-10-28): left = next tab, right = previous;
    // nothing past the ends, and a vertical drag never switches.
    await page.evaluate(() => localStorage.setItem('sp-watchlists', JSON.stringify({ mod: Date.now(),
      lists: [{ id: 'a', name: 'Mine', items: ['§Tech names', 'TEST'] }, { id: 'b', name: 'Other', items: [] }] })));
    await page.reload({ waitUntil: 'networkidle' });
    if (await page.locator('.up-skip').isVisible()) await page.locator('.up-skip').click();
    await page.locator('.nav-tab[data-tab="watchlist"]').click();
    await page.locator('#wl2Lists [data-wl-list="all"]').click();
    const onList = () => page.locator('#wl2Lists .wl2-pill.on').getAttribute('data-wl-list');
    const swipe = (dx, dy = 0) => page.evaluate(([dx, dy]) => {
      const el = document.getElementById('wl2Body'), r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + 40;
      const fire = (type, cx, cy) => {
        const t = new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
        el.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
      };
      fire('touchstart', x, y);
      for (let k = 1; k <= 6; k++) fire('touchmove', x + dx * k / 6, y + dy * k / 6);
      fire('touchend', x + dx, y + dy);
    }, [dx, dy]);
    await swipe(-120);
    assert.equal(await onList(), 'a', 'swipe left opens the next list');
    await swipe(-120);
    assert.equal(await onList(), 'b');
    await swipe(-120);
    assert.equal(await onList(), 'b', 'nothing past the last list');
    await swipe(120);
    assert.equal(await onList(), 'a', 'swipe right goes back');
    await swipe(30, 160);
    assert.equal(await onList(), 'a', 'a vertical drag is a scroll, not a switch');
    await swipe(-40);
    assert.equal(await onList(), 'a', 'a short nudge does not switch');
    // Sorting keeps the sections (2026-10-28): a list's divisions and All
    // markets' groups stay as headings; only the rows inside are reordered.
    await page.evaluate(() => document.querySelector('[data-wl-sort="up"]').click());
    assert.deepEqual(await page.locator('#wl2Body .wl2-udiv').evaluateAll(es => es.map(e => e.textContent)), ['Tech names'], 'the division stays when sorted');
    await page.locator('#wl2Lists [data-wl-list="all"]').click();
    assert.ok(await page.locator('#wl2Body .wl2-group').count() >= 1, 'All markets keeps its group headings when sorted');
    await page.evaluate(() => document.querySelector('[data-wl-sort="group"]').click());
    // One row, five views (2026-10-29): the dropdown before the lists swaps
    // the row for a filter's choices; Sort sits beside the search.
    const wlRow = page.locator('#wl2Lists');
    assert.equal(await page.locator('#wl2Drops').count(), 0, 'the old dropdown row is gone');
    assert.ok(await page.locator('.wl2-head #wl2DdSort').isVisible(), 'Sort sits beside the search');
    await page.locator('#wl2DdMode').click();
    await page.locator('#wl2MenuMode [data-wl-mode="cls"]').click();
    assert.equal(await page.locator('#wl2DdMode .wl2-mode-lbl').innerText(), 'Class');
    assert.deepEqual(await wlRow.locator('.wl2-pill').allInnerTexts(), ['All', 'Indices', 'Stocks', 'Forex', 'Ccy Index', 'Commodities', 'Crypto']);
    await swipe(-120);
    assert.equal(await wlRow.locator('.wl2-pill.on').getAttribute('data-wl-cls'), 'Index', 'the swipe steps what the row holds');
    assert.equal(await page.locator('#wl2DdMode .wl2-mode-n').innerText(), '1', 'the dropdown counts the filters set');
    await page.locator('#wl2DdMode').click();
    assert.match(await page.locator('#wl2MenuMode [data-wl-mode="cls"]').innerText(), /Indices/, 'the menu names a set filter');
    await page.locator('#wl2MenuMode [data-wl-mode="sector"]').click();
    await wlRow.locator('[data-wl-sector]:not([data-wl-sector=""])').first().click();
    assert.ok(await wlRow.locator('.wl2-sub[data-wl-industry]').count() >= 1, 'a picked sector opens its industries in the row');
    assert.ok(await wlRow.evaluate(r => { const on = r.querySelector('[data-wl-step].on'); return on.offsetLeft >= r.scrollLeft; }), 'the picked sector is not cut off on the left');
    await page.locator('#wl2Clear').click();
    // A filter view with one of the reader's lists open says so in the row,
    // and an empty result offers all markets (2026-10-29).
    await page.locator('#wl2DdMode').click();
    await page.locator('#wl2MenuMode [data-wl-mode="lists"]').click();
    await wlRow.locator('[data-wl-list="a"]').click();
    await page.locator('#wl2DdMode').click();
    await page.locator('#wl2MenuMode [data-wl-mode="cls"]').click();
    assert.match(await page.locator('#wl2InList').innerText(), /Mine/);
    await wlRow.locator('[data-wl-cls="Crypto"]').click();
    assert.match(await page.locator('#wl2Body .wl2-empty').innerText(), /Nothing in Mine matches/);
    await page.locator('#wl2Body .wl2-empty-btn').click();
    assert.equal(await page.locator('#wl2InList').isHidden(), true, 'Search all markets leaves the list');
    assert.equal(await wlRow.locator('.wl2-pill.on').getAttribute('data-wl-cls'), 'Crypto', 'Search all markets keeps the filter');
    // Filters belong to the list (2026-10-30): opening another list switches
    // them off, here through the list's own chip.
    await page.locator('#wl2DdMode').click();
    await page.locator('#wl2MenuMode [data-wl-mode="lists"]').click();
    await wlRow.locator('[data-wl-list="a"]').click();
    assert.equal(await page.locator('#wl2DdMode .wl2-mode-n').isHidden(), true, 'another list starts with no filter');
    await page.locator('#wl2DdMode').click();
    await page.locator('#wl2MenuMode [data-wl-mode="cls"]').click();
    await wlRow.locator('[data-wl-cls="Equity"]').click();
    await page.locator('#wl2InList').click();
    assert.equal(await page.locator('#wl2DdMode .wl2-mode-n').isHidden(), true, 'back to All markets: the filter went off');
    await page.locator('#wl2DdMode').click();
    await page.locator('#wl2MenuMode [data-wl-mode="lists"]').click();
    assert.equal(await onList(), 'all', 'the list pick survives the other views');
    assert.equal(errors.length, 0, errors.join('\n'));
  }
  if (!live) await require('./charts_row_checks.cjs')(page);
  if (!live) {
    // TradingView removed (2026-10-30, user: "We no longer need tradingview"):
    // no button, link or text on the chart cards, the instrument sheet or the
    // details modal, and no tv-map.json request.
    const tvRequests = [];
    page.on('request', r => { if (/tradingview|tv-map/i.test(r.url())) tvRequests.push(r.url()); });
    await page.locator('.nav-tab[data-tab="charts"]').click();
    await page.locator('#chartReel .reel-card footer').first().waitFor();
    assert.equal(await page.locator('[data-act="tv"], a[href*="tradingview"]').count(), 0, 'no TradingView button on Charts');
    await page.locator('.nav-tab[data-tab="watchlist"]').click();
    await page.locator('#wl2Body .wl2-row').first().click();
    assert.doesNotMatch(await page.locator('.wl2-sheet').innerText(), /tradingview/i, 'no TradingView in the instrument sheet');
    await page.locator('.wl2-sheet [data-wl-act="details"]').click();
    await page.waitForTimeout(300);
    assert.doesNotMatch(await page.content(), /tradingview/i, 'no TradingView anywhere on the page');
    await page.keyboard.press('Escape');
    assert.deepEqual(tvRequests, [], 'nothing asks TradingView or tv-map.json');
  }
  if (!live) await require('./dollar_index_checks.cjs')(browser);
  console.log('PASS: mobile 1H/4H/Weekly/Monthly charts, removed 30m, alerts, compact drawing toolbar, refresh and chart-cache invalidation');
  await browser.close();
})().catch(async e => { console.error(e); if(debugPage&&!debugPage.isClosed()){console.log('SMOKE_FAILURE='+(await debugPage.screenshot({type:'jpeg',quality:55})).toString('base64'));console.log('TOOLBAR_BOXES',await debugPage.locator('#chartFull .reel-toolbar, #chartFull .reel-props-main, #chartFull [data-act=draw-more]').evaluateAll(es=>es.map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON(),scroll:e.scrollWidth,width:e.clientWidth}))));} process.exit(1); });
