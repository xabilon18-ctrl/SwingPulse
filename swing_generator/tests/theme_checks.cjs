const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// WHITE / DARK (user, 2026-11-27: "Now give me a white theme for the app";
// asked, chose a switch starting on White). A fresh device opens on White;
// the sun / moon button (#themeBtn) flips it and the device remembers; a Dark
// device is Dark from the first paint (index.html's head script), never a
// white flash; the chart's plot keeps the same marks in both themes.
module.exports = async function checkTheme(page) {
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  await p.route('**/ma500/**', async route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    let body = fs.existsSync(path.join(dataDir, rel)) ? fs.readFileSync(path.join(dataDir, rel)) : Buffer.from('null');
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    await route.fulfill({ contentType: 'application/json', body });
  });
  // What the page is before any app code runs (the head script's work).
  await p.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { window.__themeAtParse = document.documentElement.getAttribute('data-theme'); }, { once: true });
  });
  const url = process.env.SMOKE_URL || 'http://127.0.0.1:8000';
  await p.goto(url, { waitUntil: 'networkidle' });
  if (await p.locator('.up-skip').isVisible().catch(() => false)) await p.locator('.up-skip').click();
  const state = () => p.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    atParse: window.__themeAtParse,
    stored: localStorage.getItem('swingpulse-theme'),
    bg: getComputedStyle(document.body).backgroundColor,
    meta: document.querySelector('meta[name="theme-color"]').getAttribute('content'),
    label: document.getElementById('themeBtn').getAttribute('aria-label'),
  }));
  let s = await state();
  assert.deepEqual([s.theme, s.atParse, s.stored, s.meta], ['light', 'light', null, '#f4f4f2'], 'a fresh device opens on White: ' + JSON.stringify(s));
  assert.equal(s.label, 'Switch to dark');

  // The chart's plot marks, read inside .reel-chart, in each theme.
  const marks = () => p.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'reel-chart';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const out = ['--buy', '--sell', '--accent', '--reel-bar', '--text-secondary'].map(k => cs.getPropertyValue(k).trim());
    el.remove();
    return out;
  });
  const whiteMarks = await marks();

  // The page fades between themes (body's .25s background transition).
  const settled = dark => p.waitForFunction(d => (getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)') === d, dark);
  await p.locator('#themeBtn').click();
  await settled(true);
  s = await state();
  assert.deepEqual([s.theme, s.stored, s.meta, s.label], ['dark', 'dark', '#000000', 'Switch to white'], 'one tap: Dark, remembered: ' + JSON.stringify(s));
  assert.deepEqual(await marks(), whiteMarks, 'the chart plot draws the same in both themes');

  await p.reload({ waitUntil: 'networkidle' });
  if (await p.locator('.up-skip').isVisible().catch(() => false)) await p.locator('.up-skip').click();
  s = await state();
  assert.deepEqual([s.theme, s.atParse], ['dark', 'dark'], 'a Dark device is Dark from the first paint: ' + JSON.stringify(s));

  await p.locator('#themeBtn').click();
  await settled(false);
  s = await state();
  assert.deepEqual([s.theme, s.stored, s.meta], ['light', 'light', '#f4f4f2'], 'and back to White: ' + JSON.stringify(s));
  assert.notEqual(s.bg, 'rgb(0, 0, 0)');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS: White by default, one tap to Dark and back, remembered with no flash; the chart plot the same in both');
};
