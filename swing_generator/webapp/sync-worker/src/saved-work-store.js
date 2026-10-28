/* Merge independent charts and grid choices without erasing another device. */
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const safeKey = k => !['__proto__', 'constructor', 'prototype'].includes(k);
const stamp = v => Number.isFinite(v) && v >= 0 ? v : 0;
function grids(value, field) {
  const out = {};
  for (const [tf, row] of Object.entries(object(value?.[field]) ? value[field] : {})) {
    if (!/^(?:\d+[mHDW]|D|W|M)$/.test(tf) || !object(row) || !['M', 'Q', 'H', 'Y', 'T2', 'T', 'Y5', 'Y10'].includes(row.division)) continue;
    if (!Number.isFinite(row.modifiedAt) || row.modifiedAt < 0) continue;
    out[tf] = { division: row.division, modifiedAt: row.modifiedAt };
  }
  return out;
}
// Notes merge note by note on their own timestamps (notesMod), like drawings.
// A note whose stamp is set but whose text is absent is a deletion tombstone.
// A save from an app that predates notesMod (a phone still on cached app.js)
// keeps the old whole-list rule for unstamped notes only: when newer, its copy
// wins, absences included. It can never erase a stamped note. A current app
// changes only what it stamped: an unstamped note it does not carry is one it
// has not loaded yet, not one it deleted.
export function mergeNotes(previous, incoming) {
  const notes = { ...(object(previous.notes) ? previous.notes : {}) };
  const mods = { ...(object(previous.notesMod) ? previous.notesMod : {}) };
  if (!object(incoming.notes)) return { notes, notesMod: mods };
  const legacy = !object(incoming.notesMod);
  const nextMods = legacy ? {} : incoming.notesMod;
  const legacyWins = legacy && stamp(incoming.lastModified) > stamp(previous.lastModified);
  const names = new Set(Object.keys(nextMods));
  if (legacyWins) {
    for (const name of Object.keys(incoming.notes)) names.add(name);
    for (const name of Object.keys(notes)) names.add(name);
  }
  for (const name of names) {
    if (!name || !safeKey(name)) continue;
    const oldAt = stamp(mods[name]), nextAt = stamp(nextMods[name]);
    const take = nextAt > oldAt || (legacyWins && !oldAt);
    if (!take) continue;
    const text = incoming.notes[name];
    if (typeof text === 'string' && text) notes[name] = text;
    else delete notes[name];
    if (nextAt) mods[name] = nextAt;
  }
  return { notes, notesMod: mods };
}
export function mergeSavedWork(previous, incoming) {
  const merged = { ...previous, ...incoming };
  merged.chartPrefs = { version: 2 };
  // The markets split out of 'grids' on 2026-10-21 read it until set, so they
  // need no copy from a version-1 store.
  for (const field of ['grids', 'stockGrids', 'indexGrids', 'energyGrids', 'commodityGrids', 'cryptoGrids', 'currencyGrids']) {
    const localGrids = grids(previous.chartPrefs, field), remoteGrids = grids(incoming.chartPrefs, field);
    if ((field === 'stockGrids' || field === 'indexGrids') && previous.chartPrefs?.version !== 2) {
      for (const [tf, row] of Object.entries(grids(previous.chartPrefs, 'grids'))) {
        if (!localGrids[tf]) localGrids[tf] = { division: row.division, modifiedAt: 0 };
      }
    }
    for (const [tf, row] of Object.entries(remoteGrids)) if (!localGrids[tf] || row.modifiedAt > localGrids[tf].modifiedAt) localGrids[tf] = row;
    merged.chartPrefs[field] = localGrids;
  }
  const channels = JSON.parse(JSON.stringify(object(previous.channels) ? previous.channels : {}));
  const mods = { ...(object(previous.channelsMod) ? previous.channelsMod : {}) };
  const nextMods = object(incoming.channelsMod) ? incoming.channelsMod : {};
  const nextChannels = object(incoming.channels) ? incoming.channels : {};
  const names = new Set([...Object.keys(nextChannels), ...Object.keys(nextMods).map(k => k.slice(0, k.lastIndexOf('|')))]);
  for (const name of names) {
    if (!name || !safeKey(name)) continue;
    const next = object(nextChannels[name]) ? nextChannels[name] : {};
    const timeframes = new Set([...Object.keys(next), ...Object.keys(nextMods).filter(k => k.startsWith(name + '|')).map(k => k.slice(name.length + 1))]);
    for (const tf of timeframes) {
      if (!/^(?:\d+[mHDW]|D|W|M)$/.test(tf)) continue;
      const key = name + '|' + tf, oldAt = stamp(mods[key]), nextAt = stamp(nextMods[key]);
      const list = next[tf];
      if (list != null && !Array.isArray(list)) continue;
      const take = nextAt > oldAt || !oldAt && !nextAt && Array.isArray(list) && (!channels[name]?.[tf] || stamp(incoming.lastModified) > stamp(previous.lastModified));
      if (!take) continue;
      // Explicit timestamped deletion is a tombstone, never a missing chart.
      if (!object(channels[name]) || channels[name].kind || channels[name].p1 != null) channels[name] = {};
      channels[name][tf] = list || [];
      mods[key] = nextAt;
    }
  }
  merged.channels = channels; merged.channelsMod = mods;
  if (!object(incoming.watchlists) || stamp(previous.watchlists?.mod) > stamp(incoming.watchlists.mod)) merged.watchlists = previous.watchlists;
  Object.assign(merged, mergeNotes(previous, incoming));
  merged.lastModified = Math.max(stamp(previous.lastModified), stamp(incoming.lastModified));
  return merged;
}
