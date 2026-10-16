/* Per-user chart choices, independent by market group and timeframe. */
(function (root) {
  'use strict';
  const choices = [{ code: 'M', name: 'Month', parts: 12 }, { code: 'Q', name: 'Quarter', parts: 4 }, { code: 'H', name: 'Half-year', parts: 2 }, { code: 'Y', name: 'Year', parts: 1 }];
  const defaults = { '15m': 'M', '10m': 'M', '30m': 'M', '1H': 'M', '2H': 'M', '4H': 'Q' };
  const scopes = { other: 'grids', stocks: 'stockGrids', indices: 'indexGrids' };
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
    function division(tf, scope = 'other') { const code = state[scopes[scope] || 'grids'][tf]?.division || defaults[tf] || 'Y'; return choices.find(c => c.code === code); }
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
  const api = Object.freeze({ choices, defaults, scopes, clean, migrate, merge, create });
  (root.SwingPulseModules ||= {}).chartPreferences = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
