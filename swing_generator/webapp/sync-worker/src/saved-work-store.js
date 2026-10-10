/* Merge independent charts and grid choices without erasing another device. */
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const safeKey = k => !['__proto__', 'constructor', 'prototype'].includes(k);
const stamp = v => Number.isFinite(v) && v >= 0 ? v : 0;
function grids(value) {
  const out = {};
  for (const [tf, row] of Object.entries(object(value?.grids) ? value.grids : {})) {
    if (!/^(?:\d+[mHDW]|D|W|M)$/.test(tf) || !object(row) || !['M', 'Q', 'H', 'Y'].includes(row.division)) continue;
    if (!Number.isFinite(row.modifiedAt) || row.modifiedAt < 0) continue;
    out[tf] = { division: row.division, modifiedAt: row.modifiedAt };
  }
  return out;
}
export function mergeSavedWork(previous, incoming) {
  const merged = { ...previous, ...incoming };
  const localGrids = grids(previous.chartPrefs), remoteGrids = grids(incoming.chartPrefs);
  for (const [tf, row] of Object.entries(remoteGrids)) if (!localGrids[tf] || row.modifiedAt > localGrids[tf].modifiedAt) localGrids[tf] = row;
  merged.chartPrefs = { version: 1, grids: localGrids };
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
  if (stamp(incoming.lastModified) < stamp(previous.lastModified)) merged.notes = previous.notes;
  merged.lastModified = Math.max(stamp(previous.lastModified), stamp(incoming.lastModified));
  return merged;
}
