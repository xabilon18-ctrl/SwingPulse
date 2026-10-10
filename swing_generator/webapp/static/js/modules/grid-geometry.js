/* Equal chart divisions and permanent references; no browser state. */
(function(root) {
  'use strict';
  function partLabel(year, part, division) {
    if (division === 'Y') return String(year);
    if (division === 'M') return new Date(Date.UTC(year, part, 1))
      .toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) + (part === 0 ? ' ' + year : '');
    return `${division}${part + 1}${part === 0 ? ' ' + year : ''}`;
  }

  function timeGrid(b, tf, { barTimes, getDivision }) {
    const src = b._src || b, from = b._from || 0;
    const n = src.t ? src.t.length : 0;
    if (n < 2) return [];
    const bt = barTimes(src);
    const first = bt[0], last = bt[n - 1];
    if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return [];
    // Measure the whole bundle in fractional calendar years. A single year
    // width is used everywhere: holidays and leap years cannot change a gap.
    // Anchor January of the newest year to its bar position; division labels
    // name equal year parts, not exact calendar-week/month start dates.
    const yearAt = ms => {
      const year = new Date(ms).getUTCFullYear();
      const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
      return year + (ms - start) / (end - start);
    };
    const yearBars = (n - 1) / (yearAt(last) - yearAt(first));
    if (!Number.isFinite(yearBars) || yearBars <= 0) return [];
    const year = new Date(last).getUTCFullYear();
    const anchorMs = Date.UTC(year, 0, 1);
    let anchor;
    if (anchorMs <= first) {
      anchor = (anchorMs - first) / ((last - first) / (n - 1));
    } else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (bt[mid] <= anchorMs) lo = mid; else hi = mid; }
      const span = bt[hi] - bt[lo];
      anchor = lo + (span ? (anchorMs - bt[lo]) / span : 0);
    }
    const division = getDivision(tf), parts = division.parts;
    const step = yearBars / parts;
    const firstYear = new Date(first).getUTCFullYear() - 1;
    const out = [];
    for (let y = firstYear; y <= year + 4; y++) {
      for (let k = 0; k < parts; k++) {
        const fi = anchor + ((y - year) * parts + k) * step - from;
        out.push({ fi, label: partLabel(y, k, division.code),
          future: fi > n - 1 - from, par: ((y * parts + k) % 2 + 2) % 2,
          year: y, part: k, division: division.code });
      }
    }
    // Permanent reference lines share exactly the same equal-year geometry.
    // They never alter the selected grid's alternating shading intervals.
    const permanent = (fi, label, kind) => {
      let line = out.find(l => Math.abs(l.fi - fi) < 1e-7);
      if (!line) {
        line = { fi, future: fi > n - 1 - from, fixedOnly: true };
        out.push(line);
      }
      line[kind] = true;
      line.label = label;
    };
    if (tf === '1H') {
      for (let y = firstYear; y <= year + 4; y++) {
        for (let k = 0; k < 4; k++) {
          permanent(anchor + (y - year + k / 4) * yearBars - from,
            `Q${k + 1}${k === 0 ? ' ' + y : ''}`, 'quarter');
        }
      }
    } else if (tf === '4H') {
      for (let y = firstYear; y <= year + 4; y++) {
        permanent(anchor + (y - year) * yearBars - from, String(y), 'annual');
      }
    } else if (tf === 'D') {
      const administrations = { 2017: 'Trump I', 2021: 'Biden', 2025: 'Trump II' };
      for (let y = firstYear; y <= year + 4; y++) {
        if (((y - 2025) % 4 + 4) % 4 !== 0) continue;
        permanent(anchor + (y - year) * yearBars - from,
          administrations[y] ? `${y} · ${administrations[y]}` : String(y), 'admin');
      }
    }
    out.sort((a, b) => a.fi - b.fi);
    return out;
  }

  const api = Object.freeze({partLabel, timeGrid});
  (root.SwingPulseModules ||= {}).gridGeometry = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
