// Scrolling BACK past the oldest bar (user, 2026-11-11: "just as i am able to
// go forward in time in the charts for all time frames i want to be able to
// move back even if it mean going back beyond a start of a chart equally so").
// On every timeframe: drag the chart right until it stops and left until it
// stops, and the blank before the oldest bar is as wide as the blank after the
// newest one. Run from app_smoke.cjs with its browser, on a page of its own.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('node:assert/strict');

module.exports = async browser => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  await page.route('**/ma500/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    const file = path.join(dataDir, relative);
    let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    await route.fulfill({ contentType: 'application/json', body });
  });
  await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  if (await page.locator('.up-skip').isVisible()) await page.locator('.up-skip').click();
  await page.locator('.nav-tab[data-tab="charts"]').click();
  const chart = page.locator('#chartReel .reel-chart').first();
  await chart.locator('svg').waitFor({ timeout: 60000 });

  // What is on screen: the window, how many of its slots are blank before the
  // oldest bar and after the newest, and where the first and last bar sit.
  const read = () => chart.evaluate(h => {
    const c = h._reelCtx, b = c.b, n = b.c.length;
    const lead = b.c.findIndex(v => v != null);
    const x = i => c.L.x0 + i * c.bw + c.bw / 2;
    return {
      win: c.win, pan: c.pan, bars: n - lead, lead, future: c.win - n,
      firstX: x(lead), lastX: x(n - 1), x0: c.L.x0, x1: c.L.x1, bw: c.bw,
      total: c.bundle.c.length, leftDate: String(b.t[0]), firstBarDate: String(c.bundle.t[0]),
      lines: [...h.querySelectorAll('line.reel-tgrid')].map(l => +l.getAttribute('x1')),
    };
  });
  // Drag sideways across the plot until the chart stops moving.
  const dragUntilStop = async dir => {
    const box = await chart.boundingBox();
    const y = box.y + box.height * 0.4, a = box.x + box.width * 0.2, z = box.x + box.width * 0.7;
    let last = null;
    for (let i = 0; i < 400; i++) {
      await page.mouse.move(dir > 0 ? a : z, y);
      await page.mouse.down();
      await page.mouse.move(dir > 0 ? z : a, y, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(40);
      const now = (await read()).pan;
      if (now === last) return read();
      last = now;
    }
    throw new Error('the chart never stopped scrolling');
  };

  // Weekly is hidden (config `hidden`, 2026-11-13): Charts cannot switch to it.
  for (const tf of ['1H', 'D', 'M']) {
    await page.locator(`#tfBtn${tf}`).click();
    await page.waitForFunction(id => document.querySelector(id).getAttribute('aria-selected') === 'true', `#tfBtn${tf}`);
    await chart.locator('svg').waitFor({ timeout: 60000 });
    await page.waitForTimeout(300);
    const open = await read();
    assert.equal(open.lead, 0, `${tf} opens with no blank before its bars`);

    const back = await dragUntilStop(+1);
    const share = Math.round(back.win * 0.9);
    const want = Math.min(share, back.win - 2);
    assert.ok(back.lead > 0, `${tf} scrolls back past its oldest bar`);
    assert.equal(back.lead, want, `${tf} stops with ${want} blank slots before the oldest bar`);
    assert.ok(back.firstX > back.x0 + back.bw * (back.lead - 1), `${tf} draws its oldest bar to the right of the blank`);
    assert.ok(back.leftDate < back.firstBarDate, `${tf} left edge carries a date before the first bar`);
    if (back.lines.length) assert.ok(Math.min(...back.lines) < back.firstX, `${tf} time grid runs on into the blank before the data`);

    // A view saved while scrolled back opens scrolled back: leave the
    // timeframe and return, and the same blank is in front of the bars.
    await page.locator('#chartReel .reel-view-btn[data-act="chart-view-save"]').first().click();
    const other = tf === 'D' ? 'M' : 'D';
    await page.locator(`#tfBtn${other}`).click();
    await page.waitForFunction(id => document.querySelector(id).getAttribute('aria-selected') === 'true', `#tfBtn${other}`);
    await page.locator(`#tfBtn${tf}`).click();
    await page.waitForFunction(id => document.querySelector(id).getAttribute('aria-selected') === 'true', `#tfBtn${tf}`);
    await chart.locator('svg').waitFor({ timeout: 60000 });
    await page.waitForFunction(w => { const c = document.querySelector('#chartReel .reel-chart')._reelCtx; return c && c.win === w; }, back.win);
    const again = await read();
    assert.ok(Math.abs(again.lead - back.lead) <= 1, `${tf} saved view reopens scrolled back (${again.lead} of ${back.lead} blank slots)`);

    const fwd = await dragUntilStop(-1);
    assert.equal(fwd.lead, 0, `${tf} scrolled forward has no blank before its bars`);
    // The same share of the window is blank at each end.
    if (want === share) assert.equal(fwd.win - fwd.bars, share, `${tf} goes as far back as it goes forward`);
  }
  assert.deepEqual(errors, [], 'no page errors while scrolling past either end');
  await page.context().close();
};
