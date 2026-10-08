const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../webapp/static/js/app.js'), 'utf8');
const code = source.slice(source.indexOf('  // One equal grid for every chart'), source.indexOf('  // ── Trend strip'));
const storage = new Map();
const context = () => {
  const c = vm.createContext({
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    TF_BY_CODE: { '30m': {}, '1H': {}, D: {} }, timeframe: '30m',
    tfMeta: () => ({ label: '30m' }),
    reelBarTimes: b => b.t.map(t => Date.parse(t)),
  });
  vm.runInContext(code, c);
  return c;
};
const c = context();
// Session gaps, holidays, missing bars and leap years must not make gaps uneven.
const t = [];
for (let ms = Date.UTC(2023, 0, 1); ms < Date.UTC(2026, 10, 1); ms += 864e5) {
  const d = new Date(ms);
  if (![0, 6].includes(d.getUTCDay()) && d.getUTCDate() !== 15) t.push(d.toISOString());
}
const b = { t };
for (const [division, parts] of [['M', 12], ['Q', 4], ['H', 2], ['Y', 1]]) {
  assert.equal(c.reelSetGridDivision('30m', division), true);
  const lines = c.reelTimeGrid(b, '30m').filter(l => !l.fixedOnly);
  assert.equal(lines.filter(l => l.year === 2024).length, parts);
  const gap = lines[1].fi - lines[0].fi;
  for (let i = 2; i < lines.length; i++) assert.ok(Math.abs(lines[i].fi - lines[i - 1].fi - gap) < 1e-9, `${division}: equal spacing across year boundaries`);
  const panned = c.reelTimeGrid({ t: t.slice(50, 100), _src: b, _from: 50 }, '30m').filter(l => !l.fixedOnly);
  assert.equal(panned.length, lines.length);
  lines.forEach((l, i) => assert.ok(Math.abs(l.fi - 50 - panned[i].fi) < 1e-9, 'Panning must not move boundaries'));
  assert.ok(lines.some(l => l.future), 'Future divisions are projected');
}
c.reelSetGridDivision('30m', 'Q');
c.reelSetGridDivision('1H', 'H');
const reloaded = context();
assert.equal(reloaded.reelGridDivision('30m').code, 'Q');
assert.equal(reloaded.reelGridDivision('1H').code, 'H');
assert.equal(reloaded.reelGridDivision('D').code, 'Y');
assert.equal(reloaded.reelSetGridDivision('30m', 'invalid'), false);
assert.equal(reloaded.reelTimeGrid({ t: [] }, '30m').length, 0);
assert.equal(reloaded.reelTimeGrid({ t: ['invalid', 'invalid'] }, '30m').length, 0);
assert.match(reloaded.reelTimeGridSwitchHtml(), /aria-pressed="true"/);
for (const tf of ['30m', '1H']) {
  for (const code of ['M', 'Q', 'H', 'Y']) {
    c.reelSetGridDivision(tf, code);
    const refs = c.reelTimeGrid(b, tf).filter(l => l.quarter);
    const gap = refs[1].fi - refs[0].fi;
    refs.slice(2).forEach((l, i) => assert.ok(Math.abs(l.fi - refs[i + 1].fi - gap) < 1e-9, 'Permanent quarters must be equal'));
  }
}
for (const code of ['M', 'Q', 'H', 'Y']) {
  c.reelSetGridDivision('D', code);
  const refs = c.reelTimeGrid(b, 'D').filter(l => l.admin);
  const gap = refs[1].fi - refs[0].fi;
  refs.slice(2).forEach((l, i) => assert.ok(Math.abs(l.fi - refs[i + 1].fi - gap) < 1e-9, 'Administration spans must be equal'));
  assert.ok(refs.some(l => l.label === '2025 · Trump II'));
}
assert.equal(c.reelSetGridDivision('30m', 'W'), false);
storage.set('swingpulse-grid-divisions', JSON.stringify({'30m':'W'}));
assert.equal(context().reelGridDivision('30m').code, 'M', 'Old weekly selections fall back to month');
assert.ok(c.reelTimeGrid(b, '2H').every(l => !l.week && !l.quarter && !l.admin), 'Ordinary years must not be bold');
console.log('PASS: equal M/Q/H/Y, removed W, permanent equal quarters/admins, saved choices and shading');
