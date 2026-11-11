/* Equal chart divisions and permanent references; no browser state. */
(function(root) {
  'use strict';
  const ADMINISTRATIONS = { 2009: 'Obama I', 2013: 'Obama II', 2017: 'Trump I', 2021: 'Biden', 2025: 'Trump II' };
  const isTermYear = y => ((y - 2025) % 4 + 4) % 4 === 0;
  function termLabel(year) { return ADMINISTRATIONS[year] ? `${year} · ${ADMINISTRATIONS[year]}` : String(year); }
  // A half term starts on a term year or two years after one (2027 = Trump II's second half).
  function halfTermLabel(year) { return isTermYear(year) ? termLabel(year) : `${year} · 2nd half`; }
  function partLabel(year, part, division) {
    if (division === 'Y' || division === 'Y10' || division === 'Y20') return String(year);
    if (division === 'T') return termLabel(year);
    if (division === 'T2') return halfTermLabel(year);
    if (division === 'M') return new Date(Date.UTC(year, part, 1))
      .toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) + (part === 0 ? ' ' + year : '');
    return `${division}${part + 1}${part === 0 ? ' ' + year : ''}`;
  }

  // The equal-year frame every grid line is placed on: `anchor` is the bar
  // position of 1 January of the newest bar's year, `yearBars` how many bars
  // one calendar year spans on this bundle. Shared with the chart's opening
  // window (app.js reelQuarterView) so the frame and the lines agree.
  function yearFrame(src, barTimes) {
    const n = src && src.t ? src.t.length : 0;
    if (n < 2) return null;
    const bt = barTimes(src);
    const first = bt[0], last = bt[n - 1];
    if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;
    const yearAt = ms => {
      const year = new Date(ms).getUTCFullYear();
      const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
      return year + (ms - start) / (end - start);
    };
    const yearBars = (n - 1) / (yearAt(last) - yearAt(first));
    if (!Number.isFinite(yearBars) || yearBars <= 0) return null;
    const anchorMs = Date.UTC(new Date(last).getUTCFullYear(), 0, 1);
    let anchor;
    if (anchorMs <= first) {
      anchor = (anchorMs - first) / ((last - first) / (n - 1));
    } else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (bt[mid] <= anchorMs) lo = mid; else hi = mid; }
      const span = bt[hi] - bt[lo];
      anchor = lo + (span ? (anchorMs - bt[lo]) / span : 0);
    }
    return { anchor, yearBars, n };
  }

  function timeGrid(b, tf, { barTimes, getDivision }) {
    const src = b._src || b, from = b._from || 0;
    // Measure the whole bundle in fractional calendar years. A single year
    // width is used everywhere: holidays and leap years cannot change a gap.
    // Anchor January of the newest year to its bar position; division labels
    // name equal year parts, not exact calendar-week/month start dates.
    const frame = yearFrame(src, barTimes);
    if (!frame) return [];
    const { anchor, yearBars, n } = frame;
    const bt = barTimes(src);
    const first = bt[0], last = bt[n - 1];
    const year = new Date(last).getUTCFullYear();
    const division = getDivision(tf), parts = division.parts;
    const step = yearBars / parts;
    // A window scrolled back past the oldest bar (negative `from`, app.js
    // reelSlice) needs lines for the years before the data too.
    const firstYear = new Date(first).getUTCFullYear() - 1 - (from < 0 ? Math.ceil(-from / yearBars) : 0);
    const out = [];
    // Divisions longer than a year: [span in years, a year a line falls on].
    // Terms count from 2025; ten years fall on the decades and twenty on
    // 2000, 2020, 2040.
    const multi = { T: [4, 2025], T2: [2, 2025], Y10: [10, 2020], Y20: [20, 2020] }[division.code];
    const termly = !!multi;
    if (termly) {
      // One equal division per span, on the same equal-year geometry;
      // shading alternates part by part.
      const [span, base] = multi;
      for (let y = firstYear - Math.max(3, span - 1); y <= year + Math.max(8, 2 * span); y++) {
        if ((((y - base) % span) + span) % span) continue;
        const fi = anchor + (y - year) * yearBars - from;
        out.push({ fi, label: partLabel(y, 0, division.code), future: fi > n - 1 - from,
          par: (((y - base) / span) % 2 + 2) % 2, year: y, part: 0, division: division.code });
      }
    }
    for (let y = firstYear; !termly && y <= year + 4; y++) {
      for (let k = 0; k < parts; k++) {
        const fi = anchor + ((y - year) * parts + k) * step - from;
        out.push({ fi, label: partLabel(y, k, division.code),
          future: fi > n - 1 - from, par: ((y * parts + k) % 2 + 2) % 2,
          year: y, part: k, division: division.code });
      }
    }
    // Quarter thirds (switch on the Q grid): two light, unlabelled lines in
    // each quarter on the same equal-year geometry. fixedOnly keeps them out
    // of the alternating shading, so the quarters shade exactly as before.
    if (division.code === 'Q' && division.thirds) {
      for (let y = firstYear; y <= year + 4; y++) for (let k = 0; k < 4; k++) for (const j of [1, 2]) {
        const fi = anchor + ((y - year) * 4 + k + j / 3) * step - from;
        out.push({ fi, future: fi > n - 1 - from, fixedOnly: true, third: true, year: y, part: k });
      }
    }
    // Term fourths (switch on the T grid, Daily): three light, unlabelled
    // lines in each four-year term, on its years, outside the shading, like
    // the quarter thirds.
    if (division.code === 'T' && division.fourths) {
      for (let y = firstYear - 3; y <= year + 8; y++) {
        if (isTermYear(y)) continue;
        const fi = anchor + (y - year) * yearBars - from;
        out.push({ fi, future: fi > n - 1 - from, fixedOnly: true, fourth: true, year: y, part: 0 });
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
      // Bold lines one YEAR apart on 1H (1H was quarters until
      // 2026-11-01; user: "the bolded vertical lines should be 1 year apart").
      for (let y = firstYear; y <= year + 4; y++) {
        permanent(anchor + (y - year) * yearBars - from, String(y), 'annual');
      }
    } else if (tf === 'D') {
      // Daily's bold term lines over its year grid. Weekly and Monthly have
      // none: their DIVISION is the term (chartPreferences default 'T'), so
      // every line there is the same light line.
      for (let y = firstYear; y <= year + 4; y++) {
        if (!isTermYear(y)) continue;
        permanent(anchor + (y - year) * yearBars - from, termLabel(y), 'admin');
      }
    }
    out.sort((a, b) => a.fi - b.fi);
    return out;
  }

  const api = Object.freeze({ yearFrame, partLabel, timeGrid });
  (root.SwingPulseModules ||= {}).gridGeometry = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
