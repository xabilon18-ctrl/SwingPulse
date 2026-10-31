/* Presentation only: stroke choices and price-axis label spacing. */
(function(root) {
  'use strict';
  const levels = Object.freeze([[1, 'Thin'], [2, 'Medium'], [3, 'Thick']]);
  const valid = value => levels.some(([v]) => v === value);
  const level = value => valid(value) ? value : 1;
  const nativeScale = value => [0.35, 0.6, 1][level(value) - 1];
  function drawingLevel(d) {
    if (valid(d.strokeWeight)) return d.strokeWeight;
    if (valid(d.weight)) return d.weight;
    if (typeof d.bold === 'boolean') return d.bold ? 3 : 2;
    return 1;
  }
  function drawingAttrs(d) {
    // Explicit legacy settings retain their original rendering until edited.
    if (!valid(d.strokeWeight) && (valid(d.weight) || typeof d.bold === 'boolean')) return '';
    return ` data-stroke="${drawingLevel(d)}" data-stroke-kind="${d.side || d.kind || 'channel'}"`;
  }
  function axisTarget(plotPixels, fontPixels = 12) {
    // Aim for ~44px, with at least three text heights between labels.
    // Nice rounding may use fewer labels. Never use SVG units as screen pixels.
    return Math.max(1, Math.min(40, Math.floor(Math.max(0, plotPixels) / Math.max(44, fontPixels * 3))));
  }
  function ticks(lo, hi, want) {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return [];
    const raw = (hi - lo) / Math.max(1, Math.min(100, want || 1));
    const mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const out = [], start = Math.ceil(lo / step);
    for (let i = 0; i < 102; i++) {
      const v = Number(((start + i) * step).toPrecision(14));
      if (v > hi) break;
      if (v >= lo) out.push(v);
    }
    return out;
  }
  function axisLabels(lo, hi, want, format, yOf, pixelsPerUnit, lastPrice) {
    let values = ticks(lo, hi, want);
    // Preserve instrument formatting; at a very tight saved zoom, omit
    // duplicate rounded labels instead of changing precision or the scale.
    const seen = new Set();
    return values.filter(v => {
      const label = format(v);
      if (seen.has(label)) return false;
      seen.add(label);
      return !(lastPrice >= lo && lastPrice <= hi && Math.abs(yOf(v) - yOf(lastPrice)) * pixelsPerUnit < 19);
    });
  }
  const api = Object.freeze({levels, valid, level, nativeScale, drawingLevel, drawingAttrs, axisTarget, ticks, axisLabels});
  (root.SwingPulseModules ||= {}).chartReadability = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
