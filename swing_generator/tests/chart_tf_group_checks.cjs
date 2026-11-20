const assert = require('node:assert/strict');
const { fixturePage } = require('./chart_autoplay_checks.cjs');

// 2H and 4H charts in the 1H button's drop-down (user, 2026-11-20: "charts
// only and make both under 1h button as a drop-down"). From another
// timeframe the button opens the hourly chart last used;
// while one is on, a tap opens the list. Each draws a chart, with no signals.
module.exports = async function checkTfGroup(page0, live = false) {
  const page = live ? page0 : await fixturePage(page0);
  await page.evaluate(() => { try { localStorage.removeItem('sp-tf-group-last'); } catch (_) {} });
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#reelSearch').fill('');
  const btn = page.locator('#tfBtn1H');
  const label = async () => (await btn.innerText()).replace('▾', '').trim();
  const selected = tf => page.waitForFunction(t => localStorage.getItem('swingpulse-chart-tf') === t
    && document.querySelector('#tfBtn1H').getAttribute('aria-selected') === 'true', tf, { timeout: 15000 })
    .catch(async err => {
      const state = await page.evaluate(() => ({ tf: localStorage.getItem('swingpulse-chart-tf'), last: localStorage.getItem('sp-tf-group-last'),
        btn: document.querySelector('#tfBtn1H') && document.querySelector('#tfBtn1H').outerHTML, w: innerWidth, body: document.body.className }));
      throw new Error(`waiting for ${tf}: ${JSON.stringify(state)}\n${err.message}`);
    });
  for (const id of ['#tfBtn2H', '#tfBtn4H']) assert.equal(await page.locator(id).count(), 0, `${id}: no button of its own`);

  // From Daily the button opens the hourly chart it names (the last used;
  // earlier checks in the same browser may have left it on any of the three).
  await page.locator('#tfBtnD').click();
  const named = await label();
  assert.ok(['1H', '2H', '4H'].includes(named), 'on Daily the button names an hourly chart: ' + named);
  await btn.click();
  await selected(named);
  assert.equal(await page.locator('.tf-group-menu').count(), 0, 'from Daily the button opens its chart, no menu');

  await btn.click();
  const menu = page.locator('.tf-group-menu');
  await menu.waitFor();
  assert.deepEqual(await menu.locator('.tf-group-opt').allInnerTexts(), ['1H', '2H', '4H'], 'the drop-down lists 1H, 2H, 4H');
  // A tap elsewhere (here Daily) closes it, and does what it says.
  await page.locator('#tfBtnD').click();
  assert.equal(await menu.count(), 0, 'a tap elsewhere closes the drop-down');
  await page.waitForFunction(() => localStorage.getItem('swingpulse-chart-tf') === 'D');
  await btn.click();
  await selected(named);
  await btn.click();
  await page.locator('.tf-group-opt[data-tf="1H"]').click();
  await selected('1H');
  assert.equal(await label(), '1H');

  for (const tf of ['2H', '4H']) {
    await btn.click();
    await page.locator(`.tf-group-opt[data-tf="${tf}"]`).click();
    await selected(tf);
    assert.equal(await label(), tf, `the button reads ${tf}`);
    const card = page.locator('#chartReel .reel-card').first();
    await card.locator('.reel-chart svg').waitFor({ timeout: 60000 });
    const info = await card.evaluate(c => {
      const h = c.querySelector('.reel-chart'), ctx = h && h._reelCtx, b = ctx && ctx.bundle;
      return b ? { bars: b.t.length, p: b.p, sg: 'sg' in b, gap: (Date.parse(b.t[b.t.length - 1].replace(' ', 'T') + 'Z') - Date.parse(b.t[b.t.length - 2].replace(' ', 'T') + 'Z')) / 36e5 } : null;
    });
    assert.ok(info && info.bars > 10, `${tf} draws a chart: ` + JSON.stringify(info));
    assert.ok(!info.sg, `${tf} carries no signals`);
    assert.ok(info.gap >= (tf === '2H' ? 2 : 4) - 1e-9, `${tf} bars are ${tf} apart: ` + JSON.stringify(info));
  }
  // Daily, then the button: back to the last one used (4H).
  await page.locator('#tfBtnD').click();
  assert.equal(await label(), '4H', 'on Daily the button still names the last hourly chart');
  await btn.click();
  await selected('4H');
  // The full-screen timeframe menu lists every chart timeframe.
  await page.locator('#chartReel [data-act="chart-expand"]').first().click();
  await page.locator('#chartFull .reel-chart svg').waitFor({ timeout: 60000 });
  await page.locator('#chartFull [data-act="tf-menu"]').click();
  const opts = await page.locator('#chartFull .reel-tf-opt[data-act="tf-set"]').allInnerTexts();
  assert.deepEqual(opts.map(s => s.trim()), ['1H', '2H', '4H', 'Daily', 'Monthly'], 'full-screen menu: ' + opts.join(', '));
  await page.locator('#chartFull .reel-tf-opt[data-tf="1H"]').click();
  await page.waitForFunction(() => localStorage.getItem('swingpulse-chart-tf') === '1H');
  await page.locator('#chartFull [data-act="chart-full-close"]').click();
  assert.equal(await label(), '1H', 'the header button follows a switch made in full screen');
  if (!live) await page.close();
  console.log('PASS: 1H drop-down with 2H / 4H charts (button opens the last used, drop-down while on, charts only)');
};
