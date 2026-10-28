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
    TF_BY_CODE: { '1H': {}, '4H': {}, D: {}, W: {}, M: {} }, timeframe: '1H',
    tfMeta: () => ({ label: '1H' }),
    assetClassOf: item => item.asset_class,
    instrumentByName: name => ({instrument_name:name,asset_class:name==='STOCK'?'Equity':name==='INDEX'?'Index':'Crypto'}),
    reelBarTimes: b => b.t.map(t => Date.parse(t)),
    reelSessionOnly: (b, tf) => b.t.length / (new Set(b.t.map(t => String(t).slice(0, 10))).size || 1)
      * ({ '2H': 2, '4H': 4 }[tf] || 24) < 16,
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
// The 4H checks below run on a round-the-clock feed (six bars a day); a
// session-only 4H feed scales its grid up a size (checked at the end).
const t24 = [];
for (let ms = Date.UTC(2023, 0, 1); ms < Date.UTC(2026, 10, 1); ms += 4 * 36e5) t24.push(new Date(ms).toISOString());
const b24 = { t: t24 };
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
  const lines = c.reelTimeGrid(b24, '4H');
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
  const lines=c.reelTimeGrid(b24,'4H',item).filter(l=>!l.fixedOnly);
  assert.equal(lines.filter(l=>l.year===2024).length,parts);
  assert.ok(lines.every(l=>l.division===code));
  const gap=lines[1].fi-lines[0].fi;
  lines.slice(2).forEach((l,i)=>assert.ok(Math.abs(l.fi-lines[i+1].fi-gap)<1e-9));
}
assert.equal(c.reelTimeGrid(b,'1H',stock).find(l=>!l.fixedOnly).division,'Q');
assert.equal(c.reelGridScope({asset_class:'Index',group:'Rates'}),'other');
// Per market (user, 2026-10-21: "Fx, crypto, commodities, stocks and brent as
// energy"): oil never shares a grid or swap with crypto, metals or currencies.
assert.equal(c.reelGridScope({asset_class:'Commodity',group:'Commodity',industry:'Energy',instrument_name:'BRENT'}),'energy');
assert.equal(c.reelGridScope({asset_class:'Commodity',group:'Commodity',industry:'Precious Metals'}),'commodities');
assert.equal(c.reelGridScope(crypto),'crypto');
assert.equal(c.reelGridScope({asset_class:'Currency',group:'Currency'}),'currency');
c.reelSetGridDivision('4H','Q','energy');
assert.equal(c.reelTimeGrid(b24,'4H',{asset_class:'Commodity',industry:'Energy'}).find(l=>!l.fixedOnly).division,'Q');
assert.equal(c.reelTimeGrid(b24,'4H',crypto).find(l=>!l.fixedOnly).division,'Y','An energy grid leaves crypto on the other-markets grid');
// A session-only 4H chart (fewer than 4 bars a day — `b` has one) takes the
// next size up from its market's choice (2026-10-24): Q → H, H → Y, M → two
// months; Year and Term stay. A 24h chart in the same market keeps the choice.
for (const [code, want, parts] of [['Q','H',2],['H','Y',1],['M','M2',6],['Y','Y',1]]) {
  c.reelSetGridDivision('4H', code, 'indices');
  const lines = c.reelTimeGrid(b, '4H', index).filter(l => !l.fixedOnly);
  assert.ok(lines.every(l => l.division === want), code + ' on a session chart draws ' + want);
  assert.equal(lines.filter(l => l.year === 2024).length, parts);
  assert.equal(c.reelTimeGrid(b24, '4H', index).find(l => !l.fixedOnly).division, code, code + ' stays on a 24h chart');
}
c.reelSetGridDivision('4H', 'H', 'indices');   // the saved choice read back below
assert.deepEqual(['2024-01','2024-03','2024-05'].map((_, k) => geometry.partLabel(2024, k, 'M2')),
  ['Jan 2024', 'Mar', 'May'], 'Two-month blocks are named by their first month');
// Session-only 1H and Daily keep the market's choice.
c.reelSetGridDivision('1H', 'Q', 'indices');
assert.equal(c.reelTimeGrid(b, '1H', index).find(l => !l.fixedOnly).division, 'Q');
assert.match(c.reelTimeGridSwitchHtml('STOCK'),/data-grid-scope="stocks"/);
assert.match(c.reelTimeGridSwitchHtml('STOCK'),/data-grid-scope="stocks"/);
assert.match(c.reelTimeGridSwitchHtml('INDEX'),/Time grid · Indices/);
assert.equal(context().reelGridDivision('4H','stocks').code,'M');
assert.equal(context().reelGridDivision('4H','indices').code,'H');
// Weekly (bars stamped on Mondays) and Monthly (on the 1st), back 2026-10-19:
// divided by administration TERM, every line equal (user: "divided by
// administration and not by year. All must be equal") — no year lines, no bold.
const weeks = [], months = [];
for (let ms = Date.UTC(2006, 0, 2); ms < Date.UTC(2026, 9, 12); ms += 7 * 864e5) weeks.push(new Date(ms).toISOString().slice(0, 10));
for (let y = 2006; y <= 2026; y++) for (let m = 0; m < 12 && (y < 2026 || m < 9); m++) months.push(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10));
for (const [tf, t] of [['W', weeks], ['M', months]]) {
  assert.equal(c.reelGridDivision(tf).code, 'T', `${tf} opens on the term grid`);
  const lines = c.reelTimeGrid({ t }, tf);
  assert.ok(lines.every(l => l.division === 'T' && !l.admin && !l.annual && !l.quarter && !l.fixedOnly), `${tf}: term lines only, all equal`);
  assert.deepEqual(lines.map(l => l.year).filter(y => y >= 2009 && y <= 2029), [2009, 2013, 2017, 2021, 2025, 2029]);
  assert.deepEqual(lines.filter(l => l.year >= 2009 && l.year <= 2025).map(l => l.label),
    ['2009 · Obama I', '2013 · Obama II', '2017 · Trump I', '2021 · Biden', '2025 · Trump II']);
  const y2025 = lines.find(l => l.year === 2025);
  assert.ok(Math.abs(y2025.fi - t.findIndex(d => d >= '2025-01-01')) < 1, `${tf} 2025 line on its bar`);
  const gap = lines[1].fi - lines[0].fi;
  lines.slice(2).forEach((l, i) => assert.ok(Math.abs(l.fi - lines[i + 1].fi - gap) < 1e-9, `${tf} terms are equal`));
  lines.slice(1).forEach((l, i) => assert.notEqual(l.par, lines[i].par, `${tf} shading alternates term by term`));
}
// Term is offered on the slow charts only, and Daily keeps its bold terms.
c.timeframe = 'W';
assert.match(c.reelTimeGridSwitchHtml(), /data-division="T"/);
c.timeframe = '1H';
assert.doesNotMatch(c.reelTimeGridSwitchHtml(), /data-division="T"/);
assert.ok(c.reelTimeGrid({ t: weeks }, 'D').some(l => l.admin), 'Daily keeps its term lines');
// Half term (user, 2026-10-28: "add 1/2 a term under time grid"): a line
// every two years from 2025, on the slow charts only, beside Term.
c.timeframe = 'W';
assert.match(c.reelTimeGridSwitchHtml(), /data-division="T2"[^>]*>½T</);
assert.ok(c.reelTimeGridSwitchHtml().indexOf('data-division="T2"') < c.reelTimeGridSwitchHtml().indexOf('data-division="T"'), '½T sits before T');
c.timeframe = '4H';
assert.doesNotMatch(c.reelTimeGridSwitchHtml(), /data-division="T2"/);
for (const [tf, t] of [['W', weeks], ['M', months], ['D', weeks]]) {
  assert.equal(c.reelSetGridDivision(tf, 'T2'), true);
  assert.equal(c.reelGridDivision(tf).code, 'T2');
  const lines = c.reelTimeGrid({ t }, tf), half = lines.filter(l => !l.fixedOnly);
  assert.ok(half.every(l => l.division === 'T2'), `${tf}: half-term lines`);
  assert.deepEqual(half.map(l => l.year).filter(y => y >= 2013 && y <= 2029), [2013, 2015, 2017, 2019, 2021, 2023, 2025, 2027, 2029]);
  assert.deepEqual(half.filter(l => l.year >= 2021 && l.year <= 2027).map(l => l.label),
    ['2021 · Biden', '2023 · 2nd half', '2025 · Trump II', '2027 · 2nd half']);
  const gap = half[1].fi - half[0].fi;
  half.slice(2).forEach((l, i) => assert.ok(Math.abs(l.fi - half[i + 1].fi - gap) < 1e-9, `${tf} half terms are equal`));
  half.slice(1).forEach((l, i) => assert.notEqual(l.par, half[i].par, `${tf} shading alternates`));
}
assert.ok(c.reelTimeGrid({ t: weeks }, 'D').some(l => l.admin), 'Daily keeps its bold term lines under half terms');
// Ten and twenty years (user, 2026-10-28: "Add 5 and 10 time grids for months
// only", then "Replace the monthy time grid 5y for Mothly with 20y"): Monthly
// only, after T; ten years on the decades, twenty on 2000/2020/2040. 5Y is gone.
c.timeframe = 'M';
const mHtml = c.reelTimeGridSwitchHtml();
assert.doesNotMatch(mHtml, /data-division="Y5"/, '5Y was replaced');
assert.equal(c.reelSetGridDivision('M', 'Y5'), false, 'Y5 is no longer a choice');
assert.match(mHtml, /data-division="Y10"[^>]*>10Y</);
assert.match(mHtml, /data-division="Y20"[^>]*>20Y</);
assert.ok(mHtml.indexOf('data-division="T"') < mHtml.indexOf('data-division="Y10"')
  && mHtml.indexOf('data-division="Y10"') < mHtml.indexOf('data-division="Y20"'), 'T, 10Y, 20Y in order');
for (const tf of ['W', 'D', '4H', '1H']) {
  c.timeframe = tf;
  assert.doesNotMatch(c.reelTimeGridSwitchHtml(), /data-division="Y10"|data-division="Y20"/, `no 10Y/20Y on ${tf}`);
}
for (const [code, want] of [['Y10', [2000, 2010, 2020, 2030, 2040]], ['Y20', [2000, 2020, 2040]]]) {
  assert.equal(c.reelSetGridDivision('M', code), true);
  assert.equal(context().reelGridDivision('M').code, code, `${code} is saved`);
  const lines = c.reelTimeGrid({ t: months }, 'M');
  assert.ok(lines.every(l => l.division === code && !l.fixedOnly && !l.admin), `${code}: its own lines only`);
  assert.deepEqual(lines.map(l => l.year).filter(y => y >= 2000 && y <= 2040), want);
  assert.equal(lines.find(l => l.year === 2020).label, '2020');
  const y2020 = lines.find(l => l.year === 2020);
  assert.ok(Math.abs(y2020.fi - months.indexOf('2020-01-01')) < 1, `${code} 2020 line on its bar`);
  assert.ok(lines.some(l => l.future), `${code}: the next line is projected`);
  const gap = lines[1].fi - lines[0].fi;
  lines.slice(2).forEach((l, i) => assert.ok(Math.abs(l.fi - lines[i + 1].fi - gap) < 1e-9, `${code} parts are equal`));
  lines.slice(1).forEach((l, i) => assert.notEqual(l.par, lines[i].par, `${code} shading alternates`));
}
console.log('PASS: equal M/Q/H/Y, removed W, permanent equal quarters/admins, equal Weekly/Monthly terms, half terms and Monthly 10Y/20Y, saved choices and shading');
