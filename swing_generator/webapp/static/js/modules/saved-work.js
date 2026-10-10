/* Portable saved-work backups and recovery UI. Authentication is never exported. */
(function (root) {
  'use strict';
  const FORMAT = 'SwingPulseBackup', MAX_BYTES = 5 * 1024 * 1024;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  function validate(value) {
    if (!object(value) || value.format !== FORMAT || value.version !== 1 || !object(value.data)) throw new Error('Choose a SwingPulse backup file.');
    let entries = 0;
    function visit(v, depth) {
      if (depth > 18 || ++entries > 100000) throw new Error('This backup is too large or complex.');
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Invalid number in backup.');
      if (v && typeof v === 'object') for (const key of Object.keys(v)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid field in backup.');
        visit(v[key], depth + 1);
      }
    }
    visit(value, 0);
    const d = value.data;
    if (!object(d.channels) || !object(d.notes) || !object(d.watchlists) || !Array.isArray(d.watchlists.lists)) throw new Error('This backup is missing saved work.');
    for (const [name, timeframes] of Object.entries(d.channels)) {
      if (name.length > 120 || !object(timeframes)) throw new Error('Invalid drawing list.');
      for (const [tf, drawings] of Object.entries(timeframes)) {
        if (!/^(?:\d+[mHDW]|D|W|M)$/.test(tf) || !Array.isArray(drawings) || drawings.length > 1000) throw new Error('Invalid drawing timeframe.');
        for (const drawing of drawings) {
          if (!object(drawing) || !['channel', 'trend', 'hline', 'vline', 'ladder', 'entry', 'circle', 'triangle'].includes(drawing.kind || 'channel')) throw new Error('Invalid drawing.');
          for (const field of ['p', 'p1', 'p2', 'p3', 'p4', 'up', 'dn']) if (drawing[field] != null && !Number.isFinite(drawing[field])) throw new Error('Invalid drawing price.');
        }
      }
    }
    if (Object.values(d.notes).some(note => typeof note !== 'string' || note.length > 10000)) throw new Error('Invalid notes.');
    for (const list of d.watchlists.lists) if (!object(list) || typeof list.id !== 'string' || typeof list.name !== 'string' || !Array.isArray(list.items) || list.items.some(n => typeof n !== 'string')) throw new Error('Invalid watchlist.');
    if (d.views != null && !object(d.views)) throw new Error('Invalid saved views.');
    if (d.overlay != null && !object(d.overlay)) throw new Error('Invalid chart settings.');
    return JSON.parse(JSON.stringify({ format: FORMAT, version: 1, user: typeof value.user === 'string' ? value.user : '', savedAt: value.savedAt || '', data: {
      channels: d.channels, channelsMod: object(d.channelsMod) ? d.channelsMod : {}, notes: d.notes,
      watchlists: d.watchlists, views: d.views || {}, grids: root.SwingPulseModules.chartPreferences.clean(d.grids), overlay: d.overlay || {},
    } }));
  }
  function parse(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Backup files must be smaller than 5 MB.');
    let value; try { value = JSON.parse(text); } catch (_) { throw new Error('This file is not valid JSON.'); }
    return validate(value);
  }
  function summary(backup) {
    let drawings = 0, charts = 0;
    for (const per of Object.values(backup.data.channels)) for (const list of Object.values(per)) { drawings += list.length; if (list.length) charts++; }
    return { drawings, charts, watchlists: backup.data.watchlists.lists.length, notes: Object.keys(backup.data.notes).length, grids: Object.keys(backup.data.grids.grids).length };
  }
  function create({ storage, key, user, capture, restore, syncNow, previousCloud, syncStatus, requestSync }) {
    let panel, selected = null, backupAt = 0, lastFingerprint = '';
    function backup() { return validate({ format: FORMAT, version: 1, user: user(), savedAt: new Date().toISOString(), data: capture() }); }
    function history() { try { const v = JSON.parse(storage.getItem(key()) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
    function remember(force = false) {
      try {
        const b = backup(), fingerprint = JSON.stringify(b.data);
        if (fingerprint === lastFingerprint) return true;
        if (!force && Date.now() - backupAt < 5 * 60000) return false;
        const copies = history();
        copies.unshift(b);
        storage.setItem(key(), JSON.stringify(copies.slice(0, 5)));
        lastFingerprint = fingerprint; backupAt = Date.now(); return true;
      } catch (_) { return false; }
    }
    function download() {
      const b = backup(), blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
      const link = document.createElement('a'), url = URL.createObjectURL(blob);
      link.href = url; link.download = `SwingPulse-${user() || 'guest'}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      remember(true); message('Backup downloaded. Keep it somewhere safe.');
    }
    function message(text) { if (panel) panel.querySelector('[data-work-message]').textContent = text; }
    function choose(value) {
      selected = validate(value);
      const counts = summary(selected), preview = panel.querySelector('[data-work-preview]');
      preview.hidden = false;
      const count = (n, name) => n + ' ' + name + (n === 1 ? '' : 's');
      preview.querySelector('[data-work-counts]').textContent = `${count(counts.drawings, 'drawing')} on ${count(counts.charts, 'chart')} · ${count(counts.watchlists, 'watchlist')} · ${count(counts.notes, 'note')} · ${count(counts.grids, 'grid choice')}`;
      preview.querySelector('[data-work-date]').textContent = 'Saved ' + (selected.savedAt ? new Date(selected.savedAt).toLocaleString() : 'time unavailable') + (selected.user ? ' · ' + selected.user : '');
      preview.querySelector('[data-work-restore]').textContent = 'Restore to ' + (user() || 'this device');
      message('Review the backup below. Your current work will be backed up before restoring.');
    }
    async function apply() {
      if (!selected) return;
      const b = selected;
      if (!remember(true)) { message('Could not save a recovery copy. Download a backup and free browser storage before restoring.'); return; }
      try {
        await restore(b.data);
        selected = null; panel.querySelector('[data-work-preview]').hidden = true;
        message('Restored on this device. ' + (user() ? 'Syncing your drawings, watchlists and grid choices…' : 'Sign in to sync across devices.'));
        try { await requestSync(); } catch (e) { message('Restored on this device. ' + e.message); }
        paintHistory(); paintStatus();
      } catch (e) { message('Restore could not finish: ' + e.message); }
    }
    function paintStatus() {
      if (!panel) return;
      panel.querySelector('[data-work-status]').textContent = (user() ? user() + ' · ' : '') + syncStatus();
      panel.querySelector('[data-work-sync]').disabled = !user();
      panel.querySelector('[data-work-cloud]').disabled = !user();
    }
    function paintHistory() {
      const list = panel.querySelector('[data-work-history]'); list.replaceChildren();
      const copies = history();
      if (!copies.length) { list.textContent = 'Local recovery copies appear here as you work.'; return; }
      copies.forEach(b => {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = 'Preview copy · ' + new Date(b.savedAt).toLocaleString();
        button.addEventListener('click', () => { try { choose(b); } catch (e) { message(e.message); } });
        list.append(button);
      });
    }
    function open() {
      if (!panel) {
        panel = document.createElement('dialog'); panel.className = 'saved-work-panel';
        panel.setAttribute('aria-labelledby', 'savedWorkTitle');
        panel.innerHTML = `<header><h2 id="savedWorkTitle">Saved work</h2><button type="button" data-work-close aria-label="Close saved work">×</button></header>
          <p data-work-status></p><p class="work-explain">Drawings, watchlists and time-grid choices sync when you sign in. Backups also include notes, saved chart views and chart settings.</p>
          <div class="work-actions"><button type="button" data-work-sync>Sync now</button><button type="button" data-work-download>Download backup</button><button type="button" data-work-upload>Choose backup file</button><input type="file" accept=".json,application/json" data-work-file hidden></div>
          <p data-work-message role="status"></p>
          <section data-work-preview hidden><h3>Backup preview</h3><p data-work-date></p><p data-work-counts></p><button type="button" data-work-restore>Restore backup</button></section>
          <section><h3>Recovery copies</h3><div data-work-history></div><button type="button" data-work-cloud>Preview previous synced copy</button></section>`;
        document.body.append(panel);
        panel.querySelector('[data-work-close]').onclick = () => panel.close();
        panel.addEventListener('click', e => { if (e.target === panel) { const r = panel.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) panel.close(); } });
        panel.querySelector('[data-work-download]').onclick = () => { try { download(); } catch (e) { message(e.message); } };
        panel.querySelector('[data-work-upload]').onclick = () => panel.querySelector('[data-work-file]').click();
        panel.querySelector('[data-work-file]').onchange = async e => {
          const file = e.target.files[0]; e.target.value = '';
          if (!file) return;
          try { if (file.size > MAX_BYTES) throw new Error('Backup files must be smaller than 5 MB.'); choose(parse(await file.text())); }
          catch (err) { selected = null; panel.querySelector('[data-work-preview]').hidden = true; message(err.message); }
        };
        panel.querySelector('[data-work-restore]').onclick = apply;
        panel.querySelector('[data-work-sync]').onclick = async () => { message('Syncing…'); try { await syncNow(); paintStatus(); message(syncStatus()); } catch (e) { message(e.message); } };
        panel.querySelector('[data-work-cloud]').onclick = async () => {
          message('Loading the previous synced copy…');
          try {
            const remote = await previousCloud();
            if (!remote || !remote.channels && !remote.watchlists && !remote.notes) throw new Error('No previous synced copy is available yet.');
            choose({ format: FORMAT, version: 1, user: user(), savedAt: remote.lastModified ? new Date(remote.lastModified).toISOString() : '', data: { channels: remote.channels || {}, channelsMod: remote.channelsMod || {}, notes: remote.notes || {}, watchlists: remote.watchlists || { lists: [], mod: 0 }, views: remote.views || capture().views || {}, grids: remote.chartPrefs || {}, overlay: remote.overlay || capture().overlay || {} } });
          } catch (e) { message(e.message); }
        };
      }
      selected = null; panel.querySelector('[data-work-preview]').hidden = true;
      remember(); paintStatus(); paintHistory(); message(''); panel.showModal();
    }
    function reset() { backupAt = 0; lastFingerprint = ''; if (panel?.open) { panel.close(); selected = null; } }
    return { open, remember, backup, reset, updateStatus: paintStatus };
  }
  const api = Object.freeze({ FORMAT, MAX_BYTES, validate, parse, summary, create });
  (root.SwingPulseModules ||= {}).savedWork = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
