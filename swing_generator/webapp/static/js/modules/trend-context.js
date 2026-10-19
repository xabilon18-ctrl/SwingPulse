/* Daily main trend is independent of the selected chart and its native direction. */
(function (root) {
  'use strict';
  const UP = 'UPTREND', DOWN = 'DOWNTREND', UNKNOWN = 'NEUTRAL';
  const isDirection = value => value === UP || value === DOWN;
  function number(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }
  function main(row, previous = null) {
    const close = number(row && row.close), average = number(row && row.ma_500);
    if (close === null || average === null || average === 0) return UNKNOWN;
    if (close > average) return UP;
    if (close < average) return DOWN;
    // Only a previously established Daily-500 state can resolve exact equality.
    // Legacy established_trend uses a different, full-ribbon rule.
    return isDirection(previous) ? previous : UNKNOWN;
  }
  function native(row, tf, channels) {
    if (tf === 'D') return daily(row, channels);
    // Only 1H and 4H have a native read. The Weekly and Monthly charts have none,
    // and must not fall through to the 1H columns below.
    if (tf !== '1H' && tf !== '4H') return UNKNOWN;
    const measured = snapshot(row, tf, channels);
    if (measured) {
      const direction = tf === '4H' ? measured.swingDirection || measured.direction : measured.direction;
      return isDirection(direction) ? direction : UNKNOWN;
    }
    const prefix = tf === '4H' ? 'h4_' : 'h1_';
    // Compatible with older published rows when their native values exist.
    // Channel geometry, quotes and the Daily direction are never fallbacks.
    return main({close: row && row[prefix + 'close'], ma_500: row && row[prefix + 'ma_500']});
  }
  function snapshot(row, tf, channels) {
    return channels && channels.workflow && channels.workflow[tf] && row && channels.workflow[tf][row.instrument_name] || null;
  }
  function daily(row, channels) {
    const measured = snapshot(row, 'D', channels);
    // Full-precision completed-bar context is authoritative when available;
    // rounded CSV display prices cannot reverse an almost-equal close.
    return measured ? isDirection(measured.direction) ? measured.direction : UNKNOWN : main(row);
  }
  function relationship(mainDirection, smallerDirection) {
    if (!isDirection(mainDirection) || !isDirection(smallerDirection)) return 'unknown';
    return mainDirection === smallerDirection ? 'aligned' : 'minor';
  }
  function label(direction) { return direction === UP ? 'Up' : direction === DOWN ? 'Down' : 'Unavailable'; }
  function glyph(direction) { return direction === UP ? '▲' : direction === DOWN ? '▼' : '—'; }
  function context(row, channels) {
    const mainDirection = daily(row, channels), h4 = native(row, '4H', channels), h1 = native(row, '1H', channels);
    return { main: mainDirection, h4, h1, h4Relation: relationship(mainDirection, h4), h1Relation: relationship(mainDirection, h1), asOf: snapshot(row,'D',channels)?.asOf || row && row.date || null };
  }
  function relationText(mainDirection, direction, tf = '4H') {
    const relation = relationship(mainDirection, direction);
    if (relation === 'unknown') return tf + ' direction unavailable';
    return tf + ' ' + (relation === 'minor' ? 'minor ' : 'aligned ') + label(direction).toLowerCase();
  }
  function matches(row, channels, filters = {}) {
    const c = context(row, channels);
    if (filters.main && filters.main !== 'all' && c.main !== filters.main) return false;
    const relation = filters.tf === '1H' ? c.h1Relation : c.h4Relation;
    return !filters.relationship || filters.relationship === 'all' || relation === filters.relationship;
  }
  function distance(price, average) {
    const p = number(price), m = number(average);
    return p === null || m === null || m === 0 ? null : 100 * (p - m) / Math.abs(m);
  }
  function clusters(row, channels, width = 0.25) {
    const setup = snapshot(row, '4H', channels)?.setup;
    if (!setup || !(number(setup.atr) > 0)) return {available:false, zones:[]};
    const levels = (setup.levels || []).filter(l => number(l.value) !== null).slice().sort((a,b) => a.value-b.value);
    const span = setup.atr * width, zones = [];
    for (let i=0; i<levels.length-1; i++) {
      let end=i+1;
      while (end<levels.length && levels[end].value-levels[i].value <= span + 1e-10) end++;
      const members=levels.slice(i,end);
      if (members.length<2) continue;
      // Whole-zone width, never a chain of individually close but widely
      // separated pairs. Suppress subsets of an already reported zone.
      if (zones.some(z => members.every(m => z.members.some(n => n.id===m.id)))) continue;
      const lo=members[0].value, hi=members[members.length-1].value;
      const prior=members.map(m => number(m.previous));
      const prevLo=prior.every(v=>v!==null) ? Math.min(...prior) : null;
      const prevHi=prior.every(v=>v!==null) ? Math.max(...prior) : null;
      const price=number(setup.price), previous=number(setup.previousClose);
      if (price===null) continue;
      const crossedUp=previous!==null && prevHi!==null && previous<=prevLo && price>hi;
      const crossedDown=previous!==null && prevHi!==null && previous>=prevHi && price<lo;
      const touched=number(setup.high)!==null && number(setup.low)!==null && setup.high>=lo && setup.low<=hi;
      const rejectedUp=touched && price>hi && previous!==null && prevHi!==null && previous>prevHi;
      const rejectedDown=touched && price<lo && previous!==null && prevLo!==null && previous<prevLo;
      const away=Math.max(lo-price, price-hi, 0);
      const state=crossedUp||crossedDown ? 'crossed' : rejectedUp||rejectedDown ? 'rejected' : touched ? 'touched' : away<=setup.atr*0.5 ? 'near' : 'away';
      zones.push({lo,hi,members,state,side:crossedUp||rejectedUp?'up':crossedDown||rejectedDown?'down':null,
                  distance:away, width:hi-lo, crossTimeframe:new Set(members.map(m=>m.tf)).size>1});
    }
    zones.sort((a,b)=>a.distance-b.distance || b.members.length-a.members.length);
    return {available:true,zones,asOf:setup.asOf,atr:setup.atr};
  }
  function matchesCluster(row, channels, mode='all', width=0.25) {
    if (!mode || mode==='all') return true;
    const result=clusters(row,channels,width);
    if (mode==='unavailable') return !result.available;
    return result.available && result.zones.some(z => mode==='any' || mode==='multi'&&z.crossTimeframe ||
      mode==='near'&&z.distance<=result.atr*0.5 || z.state===mode);
  }
  const api = Object.freeze({ UP, DOWN, UNKNOWN, main, daily, native, snapshot, relationship, context, matches, label, glyph, relationText, distance, clusters, matchesCluster });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SPTrendContext = api;
})(typeof window === 'object' ? window : null);
