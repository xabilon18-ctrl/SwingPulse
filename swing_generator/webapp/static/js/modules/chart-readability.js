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
  // Chart MA widths (viewBox units), solid since 2026-11-07. Heavier with the
  // period so MA50 / MA250 / MA500 are told apart by weight; Thin is the
  // default and Medium / Thick scale all of them together.
  const NATIVE_BASE = Object.freeze({fast: 3, mid: 4.5, anchor: 6.5, other: 2});
  const NATIVE_GROW = [1, 1.25, 1.55];
  function nativeWidth(role, value) {
    const base = NATIVE_BASE[role] || NATIVE_BASE.other;
    return Number((base * NATIVE_GROW[level(value) - 1]).toFixed(2));
  }
  // The step whose multiples are drawn bold on the price axis: 5x the label
  // step when it is a 1 or 2 (labels 1,2,3 -> bold 5,10), 2x when it is a
  // 2.5 or 5 (labels 95,100,105 -> bold 90,100,110).
  function majorStep(lo, hi, want) {
    const t = ticks(lo, hi, want);
    if (t.length < 2) return 0;
    const step = t[1] - t[0], mag = Math.pow(10, Math.floor(Math.log10(step)));
    return Number((step * (step / mag < 2.25 ? 5 : 2)).toPrecision(12));
  }
  function isMajor(v, major) {
    if (!(major > 0) || !Number.isFinite(v)) return false;
    const q = v / major;
    return Math.abs(q - Math.round(q)) < 1e-6;
  }
  const api = Object.freeze({levels, valid, level, nativeScale, nativeWidth, majorStep, isMajor, drawingLevel, drawingAttrs, axisTarget, ticks, axisLabels});
  (root.SwingPulseModules ||= {}).chartReadability = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
