const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const preferences = require('../webapp/static/js/modules/chart-preferences.js');
const geometry = require('../webapp/static/js/modules/grid-geometry.js');
const source = fs.readFileSync(path.join(__dirname, '../webapp/static/js/app.js'), 'utf8');
const code = source.slice(source.indexOf('  // One equal grid for every chart'), source.indexOf('  // ── Volume strip'));
const storage = new Map();
const context = () => {
  const disk = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
  const modules = { chartPreferences: preferences, gridGeometry: geometry };
  const c = vm.createContext({
    modules, window: { SwingPulseModules: modules },
    chartPreferences: preferences.create({ storage: disk, key: () => 'test-chart-preferences' }),
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    TF_BY_CODE: { '1H': {}, D: {}, W: {}, M: {} }, timeframe: '1H',
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
// A round-the-clock feed (a bar every four hours) for the 1H grid checks
// below. 4H itself was removed permanently on 2026-11-07.
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
const reloaded = context();
assert.equal(reloaded.reelGridDivision('1H').code, 'Q');
assert.equal(reloaded.reelGridDivision('D').code, 'H');
assert.equal(reloaded.reelGridDivision('2H').code, 'M');
assert.equal(reloaded.reelSetGridDivision('1H', 'invalid'), false);
assert.equal(reloaded.reelTimeGrid({ t: [] }, '1H').length, 0);
assert.equal(reloaded.reelTimeGrid({ t: ['invalid', 'invalid'] }, '1H').length, 0);
assert.match(reloaded.reelTimeGridSwitchHtml(), /aria-pressed="true"/);
for (const division of ['M', 'Q', 'H', 'Y']) {
  c.reelSetGridDivision('1H', division);
  const lines = c.reelTimeGrid(b24, '1H');
  const gap = lines[1].fi - lines[0].fi;
  lines.slice(2).forEach((l, i) => assert.ok(Math.abs(l.fi - lines[i + 1].fi - gap) < 1e-9, '1H grid gaps must be equal on a 24h feed'));
  const years = lines.filter(l => l.annual);
  assert.ok(years.length > 2, 'Yearly reference lines remain across every 1H grid choice on a 24h feed');
}
// 1H bold lines are one YEAR apart (user, 2026-11-01; they were quarters).
for (const tf of ['1H']) {
  for (const code of ['M', 'Q', 'H', 'Y']) {
    c.reelSetGridDivision(tf, code);
    const lines = c.reelTimeGrid(b, tf);
    const refs = lines.filter(l => l.annual);
    assert.ok(refs.length > 2, `1H ${code}: yearly bold lines present`);
    const gap = refs[1].fi - refs[0].fi;
    refs.slice(2).forEach((l, i) => assert.ok(Math.abs(l.fi - refs[i + 1].fi - gap) < 1e-9, 'Permanent 1H years must be equal'));
    assert.ok(refs.every(l => /^\d{4}$/.test(l.label)), '1H bold lines are labelled by year');
    assert.ok(lines.every(l => !l.quarter && !l.admin), '1H has no bold quarter lines');
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
c.reelSetGridDivision('1H','M','stocks');
c.reelSetGridDivision('1H','H','indices');
c.reelSetGridDivision('1H','Y','other');
c.reelSetGridDivision('D','Q','stocks');
for(const [item,code,parts] of [[stock,'M',12],[index,'H',2],[crypto,'Y',1]]) {
  const lines=c.reelTimeGrid(b24,'1H',item).filter(l=>!l.fixedOnly);
  assert.equal(lines.filter(l=>l.year===2024).length,parts);
  assert.ok(lines.every(l=>l.division===code));
  const gap=lines[1].fi-lines[0].fi;
  lines.slice(2).forEach((l,i)=>assert.ok(Math.abs(l.fi-lines[i+1].fi-gap)<1e-9));
}
assert.equal(c.reelTimeGrid(b,'D',stock).find(l=>!l.fixedOnly).division,'Q','another timeframe keeps its own grid');
assert.equal(c.reelGridScope({asset_class:'Index',group:'Rates'}),'other');
// Per market (user, 2026-10-21: "Fx, crypto, commodities, stocks and brent as
// energy"): oil never shares a grid or swap with crypto, metals or currencies.
assert.equal(c.reelGridScope({asset_class:'Commodity',group:'Commodity',industry:'Energy',instrument_name:'BRENT'}),'energy');
assert.equal(c.reelGridScope({asset_class:'Commodity',group:'Commodity',industry:'Precious Metals'}),'commodities');
assert.equal(c.reelGridScope(crypto),'crypto');
assert.equal(c.reelGridScope({asset_class:'Currency',group:'Currency'}),'currency');
c.reelSetGridDivision('1H','Q','energy');
assert.equal(c.reelTimeGrid(b24,'1H',{asset_class:'Commodity',industry:'Energy'}).find(l=>!l.fixedOnly).division,'Q');
assert.equal(c.reelTimeGrid(b24,'1H',crypto).find(l=>!l.fixedOnly).division,'Y','An energy grid leaves crypto on the other-markets grid');
// Session-only 1H and Daily keep the market's choice.
c.reelSetGridDivision('1H', 'Q', 'indices');
assert.equal(c.reelTimeGrid(b, '1H', index).find(l => !l.fixedOnly).division, 'Q');
assert.match(c.reelTimeGridSwitchHtml('STOCK'),/data-grid-scope="stocks"/);
assert.match(c.reelTimeGridSwitchHtml('STOCK'),/data-grid-scope="stocks"/);
assert.match(c.reelTimeGridSwitchHtml('INDEX'),/Time grid · Indices/);
assert.equal(context().reelGridDivision('1H','stocks').code,'M');
assert.equal(context().reelGridDivision('1H','indices').code,'Q');
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
c.timeframe = '1H';
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
for (const tf of ['D', '1H']) {
  c.timeframe = tf;
  assert.doesNotMatch(c.reelTimeGridSwitchHtml(), /data-division="Y10"|data-division="Y20"/, `no 10Y/20Y on ${tf}`);
}
// 10Y on Weekly too (user, 2026-10-28: "apply 10y time grid on weekly"); 20Y
// stays Monthly only. Weekly bars are Monday-stamped, so a decade line lands
// on the first week of its year.
c.timeframe = 'W';
const wHtml = c.reelTimeGridSwitchHtml();
assert.match(wHtml, /data-division="Y10"[^>]*>10Y</, '10Y on Weekly');
assert.doesNotMatch(wHtml, /data-division="Y20"/, 'no 20Y on Weekly');
assert.ok(wHtml.indexOf('data-division="T"') < wHtml.indexOf('data-division="Y10"'), 'Weekly: T before 10Y');
assert.equal(c.reelSetGridDivision('W', 'Y10'), true);
assert.equal(context().reelGridDivision('W').code, 'Y10', 'Weekly 10Y is saved');
{
  const lines = c.reelTimeGrid({ t: weeks }, 'W');
  assert.ok(lines.every(l => l.division === 'Y10' && !l.fixedOnly && !l.admin), 'Weekly 10Y: its own lines only');
  assert.deepEqual(lines.map(l => l.year).filter(y => y >= 2000 && y <= 2040), [2000, 2010, 2020, 2030, 2040]);
  const y2020 = lines.find(l => l.year === 2020);
  assert.ok(Math.abs(y2020.fi - weeks.findIndex(d => d >= '2020-01-01')) < 1, 'Weekly 2020 line on its week');
  const gap = lines[1].fi - lines[0].fi;
  lines.slice(2).forEach((l, i) => assert.ok(Math.abs(l.fi - lines[i + 1].fi - gap) < 1e-9, 'Weekly decades are equal'));
  lines.slice(1).forEach((l, i) => assert.notEqual(l.par, lines[i].par, 'Weekly shading alternates'));
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
// Quarter thirds (2026-11-02): a switch on the Q grid adds two lines per
// quarter at exactly 1/3 and 2/3, unlabelled, outside the shading, and
// changes nothing else.
{
  const q = context();
  q.reelSetGridDivision('1H', 'Q', 'other');
  const before = q.reelTimeGrid(b, '1H');
  assert.equal(before.some(l => l.third), false, 'Thirds are off by default');
  assert.equal(q.chartPreferences.setThirds('1H', true, 'other'), true);
  const after = q.reelTimeGrid(b, '1H');
  const thirds = after.filter(l => l.third), quarters = after.filter(l => !l.fixedOnly);
  assert.deepEqual(after.filter(l => !l.third), before, 'Quarter lines, labels and permanent lines are unchanged');
  assert.equal(thirds.filter(l => l.year === 2024).length, 8, 'Two lines in each of four quarters');
  assert.ok(thirds.every(l => l.fixedOnly && !l.label), 'Thirds carry no label and no shading');
  const step = quarters[1].fi - quarters[0].fi;
  for (const l of thirds) {
    const qi = quarters.find(x => x.year === l.year && x.part === l.part);
    const off = (l.fi - qi.fi) / step;
    assert.ok(Math.abs(off - 1 / 3) < 1e-9 || Math.abs(off - 2 / 3) < 1e-9, 'Thirds split the quarter equally');
  }
  // Remembered across a division change and a reload; shown on Q only.
  q.reelSetGridDivision('1H', 'M', 'other');
  assert.equal(q.reelTimeGrid(b, '1H').some(l => l.third), false, 'No thirds on the Month grid');
  q.reelSetGridDivision('1H', 'Q', 'other');
  assert.equal(context().reelTimeGrid(b, '1H').some(l => l.third), true, 'The switch is saved');
  // Per market: a stock switch leaves the other markets alone.
  q.chartPreferences.setThirds('1H', false, 'other');
  q.reelSetGridDivision('1H', 'Q', 'stocks');
  q.chartPreferences.setThirds('1H', true, 'stocks');
  assert.equal(q.reelTimeGrid(b, '1H', { asset_class: 'Equity' }).some(l => l.third), true);
  assert.equal(q.reelTimeGrid(b, '1H', { asset_class: 'Crypto' }).some(l => l.third), false);
  // The flag survives the sync merge and is dropped when not strictly true.
  const snap = q.chartPreferences.snapshot();
  assert.equal(snap.stockGrids['1H'].thirds, true);
  assert.equal(preferences.clean({ grids: { '1H': { division: 'Q', modifiedAt: 1, thirds: 'yes' } } }).grids['1H'].thirds, undefined);
}
console.log('PASS: quarter thirds switch');
// Term fourths (2026-11-04, user: "Each term into 4"): a switch on Daily's
// T grid adds a light, unlabelled line on each year inside a term, outside
// the shading; nothing else moves. Daily only.
{
  const q = context();
  const days = [];
  for (let ms = Date.UTC(2016, 0, 1); ms < Date.UTC(2026, 10, 1); ms += 864e5) {
    const d = new Date(ms);
    if (![0, 6].includes(d.getUTCDay())) days.push(d.toISOString().slice(0, 10));
  }
  const bd = { t: days };
  q.reelSetGridDivision('D', 'T', 'other');
  const before = q.reelTimeGrid(bd, 'D');
  assert.equal(before.some(l => l.fourth), false, 'Fourths are off by default');
  assert.equal(q.chartPreferences.setFourths('D', true, 'other'), true);
  const after = q.reelTimeGrid(bd, 'D');
  const fourths = after.filter(l => l.fourth), terms = after.filter(l => !l.fixedOnly);
  assert.deepEqual(after.filter(l => !l.fourth), before, 'Term lines, labels and bold term lines are unchanged');
  assert.deepEqual(fourths.filter(l => l.year >= 2025 && l.year < 2029).map(l => l.year), [2026, 2027, 2028], 'Three lines in the 2025 term, one a year');
  assert.ok(fourths.every(l => l.fixedOnly && !l.label), 'Fourths carry no label and no shading');
  const step = terms[1].fi - terms[0].fi;
  for (const l of fourths) {
    const start = terms.filter(x => x.fi <= l.fi + 1e-9).pop();
    if (!start) continue;
    const off = (l.fi - start.fi) / step;
    assert.ok([0.25, 0.5, 0.75].some(v => Math.abs(off - v) < 1e-9), 'Fourths split the term equally: ' + off);
  }
  // Under another grid, or on another timeframe, no fourths and no switch.
  q.reelSetGridDivision('D', 'Y', 'other');
  assert.equal(q.reelTimeGrid(bd, 'D').some(l => l.fourth), false, 'No fourths on the Year grid');
  q.reelSetGridDivision('D', 'T', 'other');
  assert.equal(context().reelTimeGrid(bd, 'D').some(l => l.fourth), true, 'The switch is saved and survives a division change');
  q.reelSetGridDivision('W', 'T', 'other');
  q.chartPreferences.setFourths('W', true, 'other');
  assert.equal(q.reelTimeGrid(bd, 'W').some(l => l.fourth), false, 'Daily only');
  assert.equal(q.chartPreferences.snapshot().grids['D'].fourths, true);
  assert.equal(preferences.clean({ grids: { D: { division: 'T', modifiedAt: 1, fourths: 'yes' } } }).grids['D'].fourths, undefined);
}
console.log('PASS: term fourths switch');
console.log('PASS: equal M/Q/H/Y, removed W, permanent equal 1H years and Daily admins, equal Weekly/Monthly terms, half terms, Weekly 10Y and Monthly 10Y/20Y, saved choices and shading');
