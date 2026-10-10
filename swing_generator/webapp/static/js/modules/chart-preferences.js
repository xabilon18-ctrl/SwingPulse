/* Per-user, per-timeframe chart choices; merge by each choice's edit time. */
(function (root) {
  'use strict';
  const choices = [{ code: 'M', name: 'Month', parts: 12 }, { code: 'Q', name: 'Quarter', parts: 4 }, { code: 'H', name: 'Half-year', parts: 2 }, { code: 'Y', name: 'Year', parts: 1 }];
  const defaults = { '15m': 'M', '10m': 'M', '30m': 'M', '1H': 'M', '2H': 'M', '4H': 'Q' };
  const valid = code => choices.some(c => c.code === code);
  function clean(value) {
    const grids = {};
    for (const [tf, row] of Object.entries(value && value.grids || {})) {
      if (!/^(?:\d+[mHDW]|D|W|M)$/.test(tf) || !row || !valid(row.division)) continue;
      if (!Number.isFinite(row.modifiedAt) || row.modifiedAt < 0) continue;
      grids[tf] = { division: row.division, modifiedAt: row.modifiedAt };
    }
    return { version: 1, grids };
  }
  function merge(left, right) {
    const result = clean(left), incoming = clean(right);
    for (const [tf, row] of Object.entries(incoming.grids)) {
      const local = result.grids[tf];
      // Legacy device choices have no edit time. Prefer the synced copy on a
      // tie so old browser-only choices converge without replacing real edits.
      if (!local || row.modifiedAt > local.modifiedAt || row.modifiedAt === 0 && local.modifiedAt === 0) result.grids[tf] = row;
    }
    return result;
  }
  function create({ storage, key, legacyKey = 'swingpulse-grid-divisions', now = Date.now, onChange = () => {} }) {
    let state;
    function reload() {
      try { state = clean(JSON.parse(storage.getItem(key()) || 'null')); } catch (_) { state = clean(null); }
      if (!Object.keys(state.grids).length && storage.getItem(key()) == null) {
        let legacy = {}; try { legacy = JSON.parse(storage.getItem(legacyKey) || '{}') || {}; } catch (_) {}
        for (const [tf, division] of Object.entries(legacy)) if (valid(division)) state.grids[tf] = { division, modifiedAt: 0 };
        save();
      }
    }
    function save() { try { storage.setItem(key(), JSON.stringify(state)); } catch (_) {} }
    function snapshot() { return clean(state); }
    function division(tf) { const code = state.grids[tf]?.division || defaults[tf] || 'Y'; return choices.find(c => c.code === code); }
    function set(tf, code) {
      if (!valid(code)) return false;
      const old = state.grids[tf];
      if (old && old.division === code) return true;
      state.grids[tf] = { division: code, modifiedAt: Math.max(now(), (old?.modifiedAt || 0) + 1) };
      save(); onChange(); return true;
    }
    function mergeRemote(remote) {
      const next = merge(state, remote), changed = JSON.stringify(next) !== JSON.stringify(state);
      if (changed) { state = next; save(); }
      return changed;
    }
    function pending(remote) {
      const other = clean(remote);
      return Object.entries(state.grids).some(([tf, row]) => !other.grids[tf] || row.modifiedAt > other.grids[tf].modifiedAt);
    }
    function previewRestore(value) {
      const next = snapshot(), backup = clean(value);
      for (const [tf, row] of Object.entries(backup.grids)) next.grids[tf] = { division: row.division, modifiedAt: Math.max(now(), (next.grids[tf]?.modifiedAt || 0) + 1) };
      return next;
    }
    function restore(value) { state = previewRestore(value); save(); onChange(); }
    reload();
    return { reload, snapshot, division, set, mergeRemote, pending, restore, previewRestore };
  }
  const api = Object.freeze({ choices, defaults, clean, merge, create });
  (root.SwingPulseModules ||= {}).chartPreferences = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
