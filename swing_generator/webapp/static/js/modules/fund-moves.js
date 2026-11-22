/* Big-fund moves from 13F filings (holdings.json, webapp/holdings_feed.py):
   what the Monthly chart's red and green markers say, and the pop-up a tap
   opens (user, 2026-11-22). Pure: no DOM, so tests/fund_moves_test.cjs runs it
   under node. */
(function (root) {
  'use strict';
  const BUY = new Set(['new', 'add']);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "YYYY-MM-DD" quarter end -> { label: "Q3 2025", months: "Jul–Sep 2025", keys: ["2025-07", "2025-08", "2025-09"] }
  function quarterOf(q) {
    const y = +String(q).slice(0, 4), m = +String(q).slice(5, 7);
    const first = m - 2;
    const keys = [first, first + 1, m].map(k => `${y}-${String(k).padStart(2, '0')}`);
    return { label: `Q${Math.ceil(m / 3)} ${y}`, months: `${MONTHS[first - 1]}–${MONTHS[m - 1]} ${y}`, keys };
  }
  function fmtDate(d) {
    const s = String(d || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return '';
    return `${+s.slice(8, 10)} ${MONTHS[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
  }
  function fmtNum(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(Math.round(v));
  }
  const fmtUsd = v => '$' + fmtNum(Math.abs(v));
  const fmtPct = v => (Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + '%';

  // One entry per quarter on the chart. A stock gets a green marker for the
  // funds that bought and a red one for those that sold; an index gets one,
  // the colour of its net. { q, buy: n, sell: n, kind: 'stock'|'index', moves|row }
  function marks(data, name) {
    if (!data) return [];
    const idx = data.indices && data.indices[name];
    if (Array.isArray(idx)) {
      return idx.filter(r => r && r.net).map(r => ({ q: r.q, kind: 'index', buy: r.net > 0 ? 1 : 0, sell: r.net < 0 ? 1 : 0, row: r }));
    }
    const list = data.stocks && data.stocks[name];
    if (!Array.isArray(list)) return [];
    const byQ = new Map();
    for (const m of list) {
      if (!m || !m.q) continue;
      const e = byQ.get(m.q) || { q: m.q, kind: 'stock', buy: 0, sell: 0, moves: [] };
      e.moves.push(m);
      if (BUY.has(m.a)) e.buy++; else e.sell++;
      byQ.set(m.q, e);
    }
    return [...byQ.values()].sort((a, b) => (a.q < b.q ? -1 : 1));
  }

  function moveLine(m) {
    const was = fmtNum(m.was), now = fmtNum(m.sh), usd = fmtUsd(m.usd);
    switch (m.a) {
      case 'new':  return `New position · ${now} shares · ≈ ${usd} · ${fmtPct(m.w)} of the fund`;
      case 'exit': return `Sold out · all ${was} shares · ≈ ${usd} · was ${fmtPct(m.wp)} of the fund`;
      case 'add':  return `Added ${fmtPct((m.sh / m.was - 1) * 100)} · ${was} → ${now} shares · ≈ ${usd} bought · now ${fmtPct(m.w)} of the fund`;
      default:     return `Cut ${fmtPct((1 - m.sh / m.was) * 100)} · ${was} → ${now} shares · ≈ ${usd} sold · was ${fmtPct(m.wp)}, now ${fmtPct(m.w)} of the fund`;
    }
  }

  const FOOT = '13F filings show long stock held on the last day of the quarter. Exact trade dates, short positions and swaps are not reported, so a cut can be a hedge as well as a sale.';

  // The pop-up's content, every string passed through `esc`.
  function popupHtml(data, mark, esc) {
    const qt = quarterOf(mark.q), fund = id => (data.funds && data.funds[id]) || { n: id, who: '' };
    let h = `<div class="fm-pop-head"><b>${esc(qt.label)}</b> · ${esc(qt.months)}</div>`;
    if (mark.kind === 'index') {
      const r = mark.row;
      h += `<div class="fm-pop-sub">Tracked funds in the ${esc(String(r.n))} stocks your list files under this index · disclosed by ${esc(fmtDate(r.filed))}</div>`;
      h += `<div class="fm-pop-net ${r.net > 0 ? 'buy' : 'sell'}">Net ${r.net > 0 ? 'buying' : 'selling'} ≈ ${esc(fmtUsd(r.net))}</div>`;
      h += `<div class="fm-pop-sub">Bought ${esc(fmtUsd(r.buy))} (${r.nb} fund${r.nb === 1 ? '' : 's'}) · sold ${esc(fmtUsd(r.sell))} (${r.ns} fund${r.ns === 1 ? '' : 's'})</div>`;
      const list = (rows, cls, title) => rows && rows.length ? `<div class="fm-pop-sec ${cls}">${title}</div>` + rows.map(([stock, fid, act, usd]) =>
        `<div class="fm-pop-row"><span class="fm-dot ${cls}"></span><div><b>${esc(stock)}</b> · ${esc(fund(fid).n)}<em>${esc(act === 'new' ? 'new position' : act === 'exit' ? 'sold out' : act === 'add' ? 'added' : 'cut')} · ≈ ${esc(fmtUsd(usd))}</em></div></div>`).join('') : '';
      h += list(r.top_s, 'sell', 'Biggest sales') + list(r.top_b, 'buy', 'Biggest buys');
    } else {
      const filed = mark.moves.map(m => m.filed).filter(Boolean).sort().pop();
      h += `<div class="fm-pop-sub">Quarter-end holdings · disclosed by ${esc(fmtDate(filed))}</div>`;
      const sec = (want, cls, title) => {
        const ms = mark.moves.filter(m => BUY.has(m.a) === want).sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd));
        return ms.length ? `<div class="fm-pop-sec ${cls}">${title} (${ms.length})</div>` + ms.map(m => {
          const f = fund(m.f);
          return `<div class="fm-pop-row"><span class="fm-dot ${cls}"></span><div><b>${esc(f.n)}</b>${f.who ? ' · ' + esc(f.who) : ''}<em>${esc(moveLine(m))}</em></div></div>`;
        }).join('') : '';
      };
      h += sec(false, 'sell', 'Selling') + sec(true, 'buy', 'Buying');
    }
    return h + `<div class="fm-pop-foot">${esc(FOOT)}</div>`;
  }

  const api = Object.freeze({ quarterOf, fmtDate, fmtNum, fmtUsd, marks, moveLine, popupHtml });
  (root.SwingPulseModules ||= {}).fundMoves = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
