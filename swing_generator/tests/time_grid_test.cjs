const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const preferences = require('../webapp/static/js/modules/chart-preferences.js');
const geometry = require('../webapp/static/js/modules/grid-geometry.js');
const source = fs.readFileSync(path.join(__dirname, '../webapp/static/js/app.js'), 'utf8');
const code = source.slice(source.indexOf('  // One equal grid for every chart'), source.indexOf('  // ── Trend strip'));
const storage = new Map();
const context = () => {
  const disk = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
  const modules = { chartPreferences: preferences, gridGeometry: geometry };
  const c = vm.createContext({
    modules, window: { SwingPulseModules: modules },
    chartPreferences: preferences.create({ storage: disk, key: () => 'test-chart-preferences' }),
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    TF_BY_CODE: { '1H': {}, '4H': {}, D: {} }, timeframe: '1H',
    tfMeta: () => ({ label: '1H' }),
    assetClassOf: item => item.asset_class,
    instrumentByName: name => ({instrument_name:name,asset_class:name==='STOCK'?'Equity':name==='INDEX'?'Index':'Crypto'}),
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
  assert.equal(c.reelSetGridDivision('1H', division), true);
  const lines = c.reelTimeGrid(b, '1H').filter(l => !l.fixedOnly);
  assert.equal(lines.filter(l => l.year === 2024).length, parts);
  const gap = lines[1].fi - lines[0].fi;
  for (let i = 2; i < lines.length; i++) assert.ok(Math.abs(lines[i].fi - lines[i - 1].fi - gap) < 1e-9, `${division}: equal spacing across year boundaries`);
  const panned = c.reelTimeGrid({ t: t.slice(50, 100), _src: b, _from: 50 }, '1H').filter(l => !l.fixedOnly);
  assert.equal(panned.length, lines.length);
  lines.forEach((l, i) => assert.ok(Math.abs(l.fi - 50 - panned[i].fi) < 1e-9, 'Panning must not move boundaries'));
  assert.ok(lines.some(l => l.future), 'Future divisions are projected');
}
c.reelSetGridDivision('1H', 'Q');
c.reelSetGridDivision('D', 'H');
c.reelSetGridDivision('4H', 'M');
const reloaded = context();
assert.equal(reloaded.reelGridDivision('1H').code, 'Q');
assert.equal(reloaded.reelGridDivision('D').code, 'H');
assert.equal(reloaded.reelGridDivision('4H').code, 'M');
assert.equal(reloaded.reelGridDivision('2H').code, 'M');
assert.equal(reloaded.reelSetGridDivision('1H', 'invalid'), false);
assert.equal(reloaded.reelTimeGrid({ t: [] }, '1H').length, 0);
assert.equal(reloaded.reelTimeGrid({ t: ['invalid', 'invalid'] }, '1H').length, 0);
assert.match(reloaded.reelTimeGridSwitchHtml(), /aria-pressed="true"/);
for (const division of ['M', 'Q', 'H', 'Y']) {
  c.reelSetGridDivision('4H', division);
  const lines = c.reelTimeGrid(b, '4H');
  const gap = lines[1].fi - lines[0].fi;
  lines.slice(2).forEach((l, i) => assert.ok(Math.abs(l.fi - lines[i + 1].fi - gap) < 1e-9, '4H grid gaps must be equal'));
  const years = lines.filter(l => l.annual);
  assert.ok(years.length > 2, 'Yearly reference lines remain across every 4H grid choice');
  const yearlyGap = years[1].fi - years[0].fi;
  years.slice(2).forEach((l, i) => assert.ok(Math.abs(l.fi - years[i + 1].fi - yearlyGap) < 1e-9, 'Permanent 4H years must be equal'));
  assert.ok(lines.every(l => !l.quarter && !l.admin), '4H keeps its yearly references');
}
for (const tf of ['1H']) {
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
assert.equal(c.reelSetGridDivision('1H', 'W'), false);
storage.delete('test-chart-preferences');
storage.set('swingpulse-grid-divisions', JSON.stringify({'1H':'W'}));
assert.equal(context().reelGridDivision('1H').code, 'M', 'Old weekly selections fall back to month');
assert.ok(c.reelTimeGrid(b, '2H').every(l => !l.week && !l.quarter && !l.admin), 'Ordinary years must not be bold');
// Each chart supplies its own market group; one visible stock must not choose
// the grid for neighbouring crypto/index charts or another timeframe.
const stock={asset_class:'Equity'}, index={asset_class:'Index'}, crypto={asset_class:'Crypto'};
c.reelSetGridDivision('4H','M','stocks');
c.reelSetGridDivision('4H','H','indices');
c.reelSetGridDivision('4H','Y','other');
c.reelSetGridDivision('1H','Q','stocks');
for(const [item,code,parts] of [[stock,'M',12],[index,'H',2],[crypto,'Y',1]]) {
  const lines=c.reelTimeGrid(b,'4H',item).filter(l=>!l.fixedOnly);
  assert.equal(lines.filter(l=>l.year===2024).length,parts);
  assert.ok(lines.every(l=>l.division===code));
  const gap=lines[1].fi-lines[0].fi;
  lines.slice(2).forEach((l,i)=>assert.ok(Math.abs(l.fi-lines[i+1].fi-gap)<1e-9));
}
assert.equal(c.reelTimeGrid(b,'1H',stock).find(l=>!l.fixedOnly).division,'Q');
assert.equal(c.reelGridScope({asset_class:'Index',group:'Rates'}),'other');
assert.match(c.reelTimeGridSwitchHtml('STOCK'),/data-grid-scope="stocks"/);
assert.match(c.reelTimeGridSwitchHtml('INDEX'),/Time grid · Indices/);
assert.equal(context().reelGridDivision('4H','stocks').code,'M');
assert.equal(context().reelGridDivision('4H','indices').code,'H');
// Weekly (bars stamped on Mondays) and Monthly (on the 1st), back 2026-10-19:
// a year grid by default. Monthly also carries the Daily's equal term lines,
// Obama I onwards; Weekly has its light year lines only (user: "divide the
// weekly by year with light division and remove the yearly ones").
const weeks = [], months = [];
for (let ms = Date.UTC(2006, 0, 2); ms < Date.UTC(2026, 9, 12); ms += 7 * 864e5) weeks.push(new Date(ms).toISOString().slice(0, 10));
for (let y = 2006; y <= 2026; y++) for (let m = 0; m < 12 && (y < 2026 || m < 9); m++) months.push(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10));
{
  assert.equal(c.reelGridDivision('M').code, 'Y', 'M opens on a year grid');
  const refs = c.reelTimeGrid({ t: months }, 'M').filter(l => l.admin);
  assert.deepEqual(refs.map(l => l.label).filter(l => l.includes('·')),
    ['2009 · Obama I', '2013 · Obama II', '2017 · Trump I', '2021 · Biden', '2025 · Trump II']);
  const gap = refs[1].fi - refs[0].fi;
  refs.slice(2).forEach((l, i) => assert.ok(Math.abs(l.fi - refs[i + 1].fi - gap) < 1e-9, 'M term spans must be equal'));
  // The 2025 line lands on the first bar of 2025.
  const at = months.findIndex(t => t >= '2025-01-01');
  assert.ok(Math.abs(refs.find(l => l.label === '2025 · Trump II').fi - at) < 1, 'M term line sits on its bar');
}
{
  assert.equal(c.reelGridDivision('W').code, 'Y', 'W opens on a year grid');
  const lines = c.reelTimeGrid({ t: weeks }, 'W');
  assert.ok(lines.every(l => !l.admin && !l.annual && !l.quarter && !l.fixedOnly), 'W carries no bold reference lines');
  // One light line per year, labelled with the year, on the first week of it.
  const y2025 = lines.find(l => l.label === '2025');
  assert.ok(y2025 && Math.abs(y2025.fi - weeks.findIndex(t => t >= '2025-01-01')) < 1);
  const gap = lines[1].fi - lines[0].fi;
  lines.slice(2).forEach((l, i) => assert.ok(Math.abs(l.fi - lines[i + 1].fi - gap) < 1e-9, 'W year lines are equal'));
}
console.log('PASS: equal M/Q/H/Y, removed W, permanent equal quarters/admins, light Weekly years, Monthly terms, saved choices and shading');
