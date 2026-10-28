/* Per-user chart choices, independent by market group and timeframe. */
(function (root) {
  'use strict';
  // T = one part per four-year US administration term (2025, 2029, ...);
  // T2 = half a term, two years (2025, 2027, 2029, ...; user, 2026-10-28:
  // "add 1/2 a term under time grid"). `label` is the button text.
  const choices = [{ code: 'M', name: 'Month', parts: 12 }, { code: 'Q', name: 'Quarter', parts: 4 }, { code: 'H', name: 'Half-year', parts: 2 }, { code: 'Y', name: 'Year', parts: 1 }, { code: 'T2', name: 'Half term', parts: 0.5, label: '½T' }, { code: 'T', name: 'Term', parts: 0.25 }];
  // Weekly and Monthly are divided by administration term, every line equal
  // (user, 2026-10-19: "divided by administration and not by year. All must
  // be equal").
  const defaults = { '15m': 'M', '10m': 'M', '30m': 'M', '1H': 'M', '2H': 'M', '4H': 'Q', W: 'T', M: 'T' };
  const scopes = { other: 'grids', stocks: 'stockGrids', indices: 'indexGrids',
    energy: 'energyGrids', commodities: 'commodityGrids', crypto: 'cryptoGrids', currency: 'currencyGrids' };
  // Split out of 'other' (user, 2026-10-21: "Fx, crypto, commodities, stocks
  // and brent as energy"); rates stay in 'other'. Until a market is set it
  // reads the 'other' choice, so nothing moved on the split.
  const fromOther = new Set(['energy', 'commodities', 'crypto', 'currency']);
  const valid = code => choices.some(c => c.code === code);
  function cleanRows(value) {
    const grids = {};
    for (const [tf, row] of Object.entries(value || {})) {
      if (!/^(?:\d+[mHDW]|D|W|M)$/.test(tf) || !row || !valid(row.division)) continue;
      if (!Number.isFinite(row.modifiedAt) || row.modifiedAt < 0) continue;
      grids[tf] = { division: row.division, modifiedAt: row.modifiedAt };
    }
    return grids;
  }
  function clean(value) {
    return { version: 2, ...Object.fromEntries(Object.values(scopes).map(field => [field, cleanRows(value?.[field])])) };
  }
  function migrate(value) {
    const result = clean(value);
    if (value?.version !== 2) {
      // Keep the old appearance on upgrade, then stop the groups following
      // one another. Untimed copies cannot replace a newer stock/index edit.
      for (const field of ['stockGrids', 'indexGrids']) for (const [tf, row] of Object.entries(result.grids)) {
        if (!result[field][tf]) result[field][tf] = { division: row.division, modifiedAt: 0 };
      }
    }
    return result;
  }
  function merge(left, right) {
    const result = clean(left), incoming = clean(right);
    for (const field of Object.values(scopes)) for (const [tf, row] of Object.entries(incoming[field])) {
      const local = result[field][tf];
      // Legacy device choices have no edit time. Prefer the synced copy on a
      // tie so old browser-only choices converge without replacing real edits.
      if (!local || row.modifiedAt > local.modifiedAt || row.modifiedAt === 0 && local.modifiedAt === 0) result[field][tf] = row;
    }
    return result;
  }
  function create({ storage, key, legacyKey = 'swingpulse-grid-divisions', now = Date.now, onChange = () => {} }) {
    let state;
    function reload() {
      try { state = migrate(JSON.parse(storage.getItem(key()) || 'null')); } catch (_) { state = clean(null); }
      if (!Object.keys(state.grids).length && storage.getItem(key()) == null) {
        let legacy = {}; try { legacy = JSON.parse(storage.getItem(legacyKey) || '{}') || {}; } catch (_) {}
        for (const [tf, division] of Object.entries(legacy)) if (valid(division)) state.grids[tf] = { division, modifiedAt: 0 };
        state = migrate({ version: 1, grids: state.grids });
      }
      save();
    }
    function save() { try { storage.setItem(key(), JSON.stringify(state)); } catch (_) {} }
    function snapshot() { return clean(state); }
    function division(tf, scope = 'other') {
      const code = state[scopes[scope] || 'grids'][tf]?.division || (fromOther.has(scope) && state.grids[tf]?.division) || defaults[tf] || 'Y';
      return choices.find(c => c.code === code);
    }
    function set(tf, code, scope = 'other') {
      if (!valid(code) || !Object.hasOwn(scopes, scope) || !/^(?:\d+[mHDW]|D|W|M)$/.test(tf)) return false;
      const rows = state[scopes[scope]], old = rows[tf];
      if (old && old.division === code) return true;
      rows[tf] = { division: code, modifiedAt: Math.max(now(), (old?.modifiedAt || 0) + 1) };
      save(); onChange(); return true;
    }
    function mergeRemote(remote) {
      const next = merge(state, remote), changed = JSON.stringify(next) !== JSON.stringify(state);
      if (changed) { state = next; save(); }
      return changed;
    }
    function pending(remote) {
      const other = clean(remote);
      return Object.values(scopes).some(field => Object.entries(state[field]).some(([tf, row]) => !other[field][tf] || row.modifiedAt > other[field][tf].modifiedAt));
    }
    function previewRestore(value) {
      const next = snapshot(), backup = migrate(value);
      for (const field of Object.values(scopes)) for (const [tf, row] of Object.entries(backup[field])) next[field][tf] = { division: row.division, modifiedAt: Math.max(now(), (next[field][tf]?.modifiedAt || 0) + 1) };
      return next;
    }
    function restore(value) { state = previewRestore(value); save(); onChange(); }
    reload();
    return { reload, snapshot, division, set, mergeRemote, pending, restore, previewRestore };
  }
  const api = Object.freeze({ choices, defaults, scopes, fromOther, clean, migrate, merge, create });
  (root.SwingPulseModules ||= {}).chartPreferences = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
