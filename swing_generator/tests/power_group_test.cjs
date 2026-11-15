// Energy and Power group buttons (2026-11-15): Energy is the Energy sector plus
// the energy commodities, Power is the electricity utilities by Yahoo industry.
// The "AI Energy" group name must not pull anything into Energy.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../webapp/static/js/app.js'), 'utf8');
const start = source.indexOf('  const POWER_INDUSTRIES');
const end = source.indexOf('\n', source.indexOf('  const wlGroupMatches'));
assert.ok(start > 0 && end > start, 'the group matchers are in app.js');
const c = vm.createContext({ matchesSearch: (d, q) => `${d.group} ${d.sector} ${d.industry}`.toLowerCase().includes(q) });
vm.runInContext(source.slice(start, end) + '\nthis.wlGroupMatches = wlGroupMatches;', c);
const m = c.wlGroupMatches;
const row = (group, sector, industry) => ({ group, sector, industry });

assert.ok(m(row('US500', 'Energy', 'Oil & Gas E&P'), 'energy'), 'oil company is Energy');
assert.ok(m(row('JSE', 'Energy', 'Thermal Coal'), 'energy'), 'coal miner is Energy');
assert.ok(m(row('Commodity', 'Commodities', 'Energy'), 'energy'), 'Brent is Energy');
assert.ok(!m(row('Commodity', 'Commodities', 'Precious Metals'), 'energy'), 'gold is not Energy');
assert.ok(!m(row('AI Energy', 'Utilities', 'Utilities - Independent Power Producers'), 'energy'), 'VST is not Energy');
assert.ok(!m(row('AI Energy', 'Industrials', 'Electrical Equipment & Parts'), 'energy'), 'HUBB is not Energy');

for (const ind of ['Utilities - Regulated Electric', 'Utilities - Independent Power Producers', 'Utilities - Diversified'])
  assert.ok(m(row('US500', 'Utilities', ind), 'power'), `${ind} is Power`);
assert.ok(m(row('AI Energy', 'Utilities', 'Utilities - Independent Power Producers'), 'power'), 'VST is Power');
for (const ind of ['Utilities - Regulated Gas', 'Utilities - Regulated Water', 'Waste Management'])
  assert.ok(!m(row('IT40', 'Utilities', ind), 'power'), `${ind} is not Power`);
assert.ok(!m(row('AI Energy', 'Industrials', 'Electrical Equipment & Parts'), 'power'), 'BE is not Power');
assert.ok(!m(row('US500', 'Energy', 'Oil & Gas Integrated'), 'power'), 'XOM is not Power');

assert.ok(m(row('US500', 'Financial Services', 'Banks - Diversified'), 'banks'), 'other groups still use matchesSearch');
console.log('power_group_test: ok');
