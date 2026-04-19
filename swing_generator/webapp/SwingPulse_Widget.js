// SwingPulse Widget for Scriptable
// Supports Small, Medium, Large widget sizes
// Tap widget to open the app

const R2_BASE = "https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev";
const APP_URL = "https://swingpulse.pages.dev";

async function run() {
  // Fetch data from R2
  async function getJSON(url) {
    try {
      const req = new Request(url);
      req.timeoutInterval = 15;
      return await req.loadJSON();
    } catch (e) {
      return null;
    }
  }

  const summary = await getJSON(R2_BASE + "/summary.json") || {};
  const signals = await getJSON(R2_BASE + "/signals.json") || {};
  const names   = await getJSON(R2_BASE + "/names.json")   || {};
  const data    = signals.data || [];

  // Helpers
  function isBuyRow(d)  { return (d.confirmation_status || "").toLowerCase().includes("buy");  }
  function isSellRow(d) { return (d.confirmation_status || "").toLowerCase().includes("sell"); }

  function scoreRow(d) {
    let s = 0;
    if (d.primary_signal) s += 3;
    const al = (d.tf_alignment || "").toLowerCase();
    if (al.includes("triple")) s += 3;
    else if (al.includes("aligned")) s += 2;
    if (d.volume_spike_flag === "yes") s += 2;
    if ((d.signal_confidence || "") === "high") s += 1;
    return s;
  }

  function fmtPrice(val) {
    const n = parseFloat(val);
    if (isNaN(n)) return "--";
    if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (n >= 1)    return n.toFixed(2);
    return n.toFixed(4);
  }

  function shortName(ticker) {
    const n = names[ticker] || "";
    if (!n || n.toUpperCase() === ticker.toUpperCase()) return "";
    return n.length > 18 ? n.slice(0, 17) + "…" : n;
  }

  // Top signals sorted by score
  const topSignals = data
    .filter(d => d.primary_signal)
    .sort((a, b) => scoreRow(b) - scoreRow(a));

  // Colors
  const C = {
    bg:      new Color("#0a0e17"),
    surface: new Color("#111827"),
    accent:  new Color("#6366f1"),
    buy:     new Color("#10b981"),
    sell:    new Color("#ef4444"),
    watch:   new Color("#f59e0b"),
    vol:     new Color("#8b5cf6"),
    text:    new Color("#f1f5f9"),
    sub:     new Color("#94a3b8"),
    muted:   new Color("#64748b"),
    border:  new Color("#1e293b"),
    buyBg:   new Color("#10b981", 0.14),
    sellBg:  new Color("#ef4444", 0.14),
  };

  // Build widget
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + 3600 * 1000);

  const size = config.widgetFamily || "medium";

  // ── SMALL ────────────────────────────────────────────────────────────────
  if (size === "small") {
    w.setPadding(14, 14, 14, 14);

    // Header
    const hdr = w.addStack();
    hdr.centerAlignContent();
    const ht = hdr.addText("⚡ SwingPulse");
    ht.font = Font.boldSystemFont(11);
    ht.textColor = C.accent;
    hdr.addSpacer();
    const dt = hdr.addText(summary.date || "--");
    dt.font = Font.systemFont(8);
    dt.textColor = C.muted;

    w.addSpacer(8);

    // Buy / Sell pills
    const row = w.addStack();
    row.spacing = 8;

    function pill(parent, label, val, bg, fg) {
      const p = parent.addStack();
      p.backgroundColor = bg;
      p.cornerRadius = 8;
      p.setPadding(5, 10, 5, 10);
      p.layoutVertically();
      p.centerAlignContent();
      const n = p.addText(String(val));
      n.font = Font.boldSystemFont(18);
      n.textColor = fg;
      n.centerAlignText();
      const l = p.addText(label);
      l.font = Font.systemFont(8);
      l.textColor = fg;
      l.centerAlignText();
    }

    pill(row, "BUY",  summary.buy_count  || 0, C.buyBg,  C.buy);
    pill(row, "SELL", summary.sell_count || 0, C.sellBg, C.sell);

    w.addSpacer(10);

    // Top signal
    const top = topSignals[0];
    if (top) {
      const buy = isBuyRow(top);
      const card = w.addStack();
      card.backgroundColor = buy ? C.buyBg : C.sellBg;
      card.cornerRadius = 8;
      card.setPadding(7, 9, 7, 9);
      card.layoutVertically();

      const tr = card.addStack();
      tr.centerAlignContent();
      const strip = tr.addStack();
      strip.backgroundColor = buy ? C.buy : C.sell;
      strip.cornerRadius = 2;
      strip.size = new Size(3, 14);
      tr.addSpacer(5);
      const tn = tr.addText(top.instrument_name || "");
      tn.font = Font.boldSystemFont(12);
      tn.textColor = C.text;
      tr.addSpacer();
      const px = tr.addText(fmtPrice(top.close));
      px.font = Font.boldSystemFont(11);
      px.textColor = buy ? C.buy : C.sell;

      const fn = shortName(top.instrument_name);
      if (fn) {
        const fe = card.addText(fn);
        fe.font = Font.systemFont(9);
        fe.textColor = C.muted;
      }

      const sl = top.primary_signal || "";
      const al = (top.tf_alignment || "").replace("Triple ", "3× ").replace("Aligned ", "AL ");
      const st = card.addText([sl, al].filter(Boolean).join(" · "));
      st.font = Font.systemFont(9);
      st.textColor = buy ? C.buy : C.sell;
    }
  }

  // ── MEDIUM ───────────────────────────────────────────────────────────────
  else if (size === "medium") {
    w.setPadding(14, 14, 14, 14);

    // Header
    const hdr = w.addStack();
    hdr.centerAlignContent();
    const ht = hdr.addText("⚡ SwingPulse");
    ht.font = Font.boldSystemFont(13);
    ht.textColor = C.accent;
    hdr.addSpacer();
    const dt = hdr.addText(summary.date || "--");
    dt.font = Font.systemFont(9);
    dt.textColor = C.muted;

    w.addSpacer(8);

    // Stats row
    const stats = w.addStack();
    stats.spacing = 6;

    function statPill(parent, label, val, hex) {
      const color = new Color(hex);
      const bg    = new Color(hex, 0.13);
      const box = parent.addStack();
      box.backgroundColor = bg;
      box.cornerRadius = 7;
      box.setPadding(5, 9, 5, 9);
      box.layoutVertically();
      box.centerAlignContent();
      const n = box.addText(String(val));
      n.font = Font.boldSystemFont(16);
      n.textColor = color;
      n.centerAlignText();
      const l = box.addText(label);
      l.font = Font.systemFont(8);
      l.textColor = C.muted;
      l.centerAlignText();
    }

    statPill(stats, "BUY",   summary.buy_count     || 0, "#10b981");
    statPill(stats, "SELL",  summary.sell_count    || 0, "#ef4444");
    statPill(stats, "WATCH", summary.watch_count   || 0, "#f59e0b");
    statPill(stats, "VOL",   summary.volume_spikes || 0, "#8b5cf6");

    w.addSpacer(8);

    // Top 3 signals
    for (const item of topSignals.slice(0, 3)) {
      const buy = isBuyRow(item);
      const row = w.addStack();
      row.centerAlignContent();
      row.spacing = 6;

      const strip = row.addStack();
      strip.backgroundColor = buy ? C.buy : C.sell;
      strip.cornerRadius = 2;
      strip.size = new Size(3, 26);

      const info = row.addStack();
      info.layoutVertically();
      info.spacing = 1;

      const nameEl = info.addText(item.instrument_name || "");
      nameEl.font = Font.boldSystemFont(11);
      nameEl.textColor = C.text;

      const fn = shortName(item.instrument_name);
      if (fn) {
        const fe = info.addText(fn);
        fe.font = Font.systemFont(8);
        fe.textColor = C.muted;
      }

      const al = (item.tf_alignment || "").replace("Triple ", "3× ").replace("Aligned ", "AL ");
      const sl = [(item.primary_signal || ""), al].filter(Boolean).join(" · ");
      const sigEl = info.addText(sl);
      sigEl.font = Font.systemFont(8);
      sigEl.textColor = buy ? C.buy : C.sell;

      row.addSpacer();

      const priceEl = row.addText(fmtPrice(item.close));
      priceEl.font = Font.boldSystemFont(12);
      priceEl.textColor = buy ? C.buy : C.sell;

      w.addSpacer(3);
    }
  }

  // ── LARGE ────────────────────────────────────────────────────────────────
  else {
    w.setPadding(16, 16, 16, 16);

    // Header
    const hdr = w.addStack();
    const ht = hdr.addText("⚡ SwingPulse");
    ht.font = Font.boldSystemFont(15);
    ht.textColor = C.accent;
    hdr.addSpacer();
    const dt = hdr.addText(summary.date || "--");
    dt.font = Font.systemFont(10);
    dt.textColor = C.muted;

    w.addSpacer(10);

    // Stats
    const stats = w.addStack();
    stats.spacing = 7;

    function statLg(parent, label, val, hex) {
      const color = new Color(hex);
      const bg    = new Color(hex, 0.13);
      const box = parent.addStack();
      box.backgroundColor = bg;
      box.cornerRadius = 8;
      box.setPadding(7, 12, 7, 12);
      box.layoutVertically();
      box.centerAlignContent();
      const n = box.addText(String(val));
      n.font = Font.boldSystemFont(20);
      n.textColor = color;
      n.centerAlignText();
      const l = box.addText(label);
      l.font = Font.systemFont(9);
      l.textColor = C.muted;
      l.centerAlignText();
    }

    statLg(stats, "BUY",   summary.buy_count     || 0, "#10b981");
    statLg(stats, "SELL",  summary.sell_count    || 0, "#ef4444");
    statLg(stats, "WATCH", summary.watch_count   || 0, "#f59e0b");
    statLg(stats, "VOL",   summary.volume_spikes || 0, "#8b5cf6");

    w.addSpacer(10);

    // Top 6 signals
    for (const item of topSignals.slice(0, 6)) {
      const buy = isBuyRow(item);
      const row = w.addStack();
      row.centerAlignContent();
      row.spacing = 7;

      const strip = row.addStack();
      strip.backgroundColor = buy ? C.buy : C.sell;
      strip.cornerRadius = 2;
      strip.size = new Size(3, 28);

      const info = row.addStack();
      info.layoutVertically();
      info.spacing = 1;

      const nameEl = info.addText(item.instrument_name || "");
      nameEl.font = Font.boldSystemFont(12);
      nameEl.textColor = C.text;

      const fn = shortName(item.instrument_name);
      if (fn) {
        const fe = info.addText(fn);
        fe.font = Font.systemFont(9);
        fe.textColor = C.muted;
      }

      const al = (item.tf_alignment || "").replace("Triple ", "3× ").replace("Aligned ", "AL ");
      const sl = [(item.primary_signal || ""), al].filter(Boolean).join(" · ");
      const sigEl = info.addText(sl);
      sigEl.font = Font.systemFont(9);
      sigEl.textColor = buy ? C.buy : C.sell;

      row.addSpacer();

      const priceCol = row.addStack();
      priceCol.layoutVertically();
      priceCol.centerAlignContent();

      const priceEl = priceCol.addText(fmtPrice(item.close));
      priceEl.font = Font.boldSystemFont(12);
      priceEl.textColor = buy ? C.buy : C.sell;
      priceEl.rightAlignText();

      const roc = parseFloat(item.roc || 0);
      if (!isNaN(roc) && Math.abs(roc) > 0.01) {
        const rocEl = priceCol.addText((roc >= 0 ? "+" : "") + roc.toFixed(1) + "%");
        rocEl.font = Font.systemFont(9);
        rocEl.textColor = roc >= 0 ? C.buy : C.sell;
        rocEl.rightAlignText();
      }

      w.addSpacer(3);
    }
  }

  Script.setWidget(w);
  Script.complete();

  if (config.runsInApp) {
    if (size === "small") await w.presentSmall();
    else if (size === "large") await w.presentLarge();
    else await w.presentMedium();
  }
}

run();
