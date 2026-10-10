/* Drawing palette and properties; chart geometry and storage are injected. */
(function(root) {
  'use strict';
  function create(deps) {
    const { activeChannel, channelsFor, chKey, getTimeframe, getEditing, drawCanStep, DRAW_FILLABLE, drawFillColor, drawFillA, DRAW_COLORS, FILL_MIN, FILL_MAX, DRAW_BOLDABLE, ladderStack } = deps;
    const { TOOL_CHANNEL, TOOL_TREND, TOOL_HLINE, TOOL_VLINE, TOOL_LADDER, TOOL_CIRCLE, TOOL_TRIANGLE, TOOL_ENTRY, TOOL_BUY, TOOL_SELL, ICON_BACK, ICON_UNDO, ICON_REDO, ICON_COPY, ICON_LOCK, ICON_UNLOCK, ICON_TRASH } = root.SwingPulseModules.drawingIcons;
  // Toolbar visibility is independent of drawing mode and selection.
  const drawToolsCollapsed = new Set(), drawMoreOpen = new Set();
  const DRAW_TOOL_INFO = {
    channel: ['Channel', TOOL_CHANNEL], trend: ['Trend line', TOOL_TREND],
    hline: ['Horizontal', TOOL_HLINE], vline: ['Vertical', TOOL_VLINE],
    ladder: ['Price ladder', TOOL_LADDER], entry: ['Entry', TOOL_ENTRY],
    circle: ['Circle', TOOL_CIRCLE], triangle: ['Triangle', TOOL_TRIANGLE],
    buy: ['Buy', TOOL_BUY], sell: ['Sell', TOOL_SELL],
  };
  function drawSelectedKind(name) {
    const d = activeChannel(name);
    return d ? (d.side || d.kind) : '';
  }
  function reelDrawStripHtml(name) {
    const collapsed = drawToolsCollapsed.has(chKey(name, getTimeframe()));
    const [label, icon] = DRAW_TOOL_INFO[drawSelectedKind(name)] || ['Drawing', TOOL_CHANNEL];
    const toggle = collapsed ? 'Expand drawing tools' : 'Collapse drawing tools';
    const drawing = activeChannel(name), locked = !!(drawing && drawing.locked);
    const lockLabel = locked ? 'Unlock this drawing' : 'Lock this drawing';
    return `<button class="reel-tool reel-draw-current" data-act="draw-tools-toggle" data-name="${name}" aria-label="${toggle}" aria-expanded="${!collapsed}">${icon}<span>${label}</span></button>
      <button class="reel-tool reel-draw-lock${locked ? ' on' : ''}" data-act="draw-lock" data-name="${name}" aria-label="${lockLabel}" title="${lockLabel}" aria-pressed="${locked}"${drawing ? '' : ' disabled'}>${locked ? ICON_LOCK : ICON_UNLOCK}</button>
      <button class="reel-tool reel-hist" data-act="draw-undo" data-name="${name}" aria-label="Undo drawing" title="Undo"${drawCanStep(name, -1) ? '' : ' disabled'}>${ICON_UNDO}</button>
      <button class="reel-tool reel-hist" data-act="draw-redo" data-name="${name}" aria-label="Redo drawing" title="Redo"${drawCanStep(name, 1) ? '' : ' disabled'}>${ICON_REDO}</button>
      <button class="reel-tool reel-draw-fold" data-act="draw-tools-toggle" data-name="${name}" aria-label="${toggle}" aria-expanded="${!collapsed}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="${collapsed ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg></button>
      <button class="reel-tool reel-draw-done" data-act="draw-done" data-name="${name}">Done</button>`;
  }
  function reelToolbarHtml(name, edit) {
    const collapsed = drawToolsCollapsed.has(chKey(name, getTimeframe()));
    const selected = drawSelectedKind(name);
    return `<div class="reel-toolbar reel-draw-compact${collapsed ? ' is-collapsed' : ''}" data-tools${edit ? '' : ' hidden'}>
      <div class="reel-draw-strip" data-draw-strip>${reelDrawStripHtml(name)}</div>
      <div class="reel-draw-body" data-draw-body${collapsed ? ' hidden' : ''}>
        <div class="reel-tools-row" role="group" aria-label="Drawing tools">${Object.entries(DRAW_TOOL_INFO).map(([kind, [label, icon]]) =>
          `<button class="reel-tool${selected === kind ? ' is-selected' : ''}" data-act="channel-add" data-kind="${kind}" data-name="${name}" title="${label}" aria-label="Add ${label.toLowerCase()}" aria-pressed="${selected === kind}">${icon}</button>`).join('')}</div>
        <div class="reel-props" data-props${edit && channelsFor(name).length ? '' : ' hidden'}>${reelPropsHtml(name)}</div>
      </div>
    </div>`;
  }
  function reelSyncToolbar(root, name) {
    const toolbar = root && root.querySelector('[data-tools]');
    if (!toolbar) return;
    const collapsed = drawToolsCollapsed.has(chKey(name, getTimeframe()));
    toolbar.classList.toggle('is-collapsed', collapsed);
    const body = toolbar.querySelector('[data-draw-body]');
    if (body) body.hidden = collapsed;
    const strip = toolbar.querySelector('[data-draw-strip]');
    const html = reelDrawStripHtml(name);
    if (strip && strip._html !== html) { strip.innerHTML = html; strip._html = html; }
    const selected = drawSelectedKind(name);
    toolbar.querySelectorAll('[data-act="channel-add"]').forEach(button => {
      const on = button.dataset.kind === selected;
      button.classList.toggle('is-selected', on);
      button.setAttribute('aria-pressed', String(on));
    });
  }

  // Properties of the ONE selected drawing — colour, lock, delete. Every button
  // acts on that drawing only; tap another line to move the bar to it.
  function reelPropsHtml(name) {
    const d = activeChannel(name);
    if (!d) return '';
    // Background controls and less-used actions live in More.
    const fillable = DRAW_FILLABLE.has(d.kind), fillOn = fillable && !!d.fillOn;
    const fc = drawFillColor(d), fa = drawFillA(d);
    const dots = (act, sel, anyAct) => DRAW_COLORS.map(c =>
        `<button class="reel-tool reel-swatch${c === sel ? ' on' : ''}" data-act="${act}" data-color="${c}" data-name="${name}" aria-label="Colour" style="--sw:${c}"><i></i></button>`).join('')
      + `<label class="reel-swatch reel-swatch-any${DRAW_COLORS.includes(sel) ? '' : ' on'}" title="Any colour" style="--sw:${sel}"><i></i>`
      + `<input type="color" value="${sel}" data-act="${anyAct}" data-name="${name}" aria-label="Pick any colour"></label>`;
    let intensity = '';
    const more = drawMoreOpen.has(chKey(name, getTimeframe()));
    if (more && fillable) {
      intensity = `<div class="reel-style-panel">`;
      {
        // Background: a switch first; colour + intensity only once it is on.
        intensity += `<button class="reel-tool reel-grid-switch reel-fill-switch${fillOn ? ' on' : ''}" data-act="draw-fill-toggle" data-name="${name}" role="switch" aria-checked="${fillOn}"><span>Background</span><i class="reel-ov-knob" aria-hidden="true"></i></button>`;
        if (fillOn) {
          intensity += `<div class="reel-style-cols">${dots('draw-fill-color', fc, 'draw-any-fill')}</div>`
            + `<label class="reel-ov-row reel-fill-a"><span>Strength</span><input type="range" min="${FILL_MIN}" max="${FILL_MAX}" step="1" value="${fa}" data-act="draw-fill-a" data-name="${name}" aria-label="Background strength" style="accent-color:${fc}"><b>${Math.round(fa / FILL_MAX * 100)}%</b></label>`;
        }
      }
      intensity += `</div>`;
    }
    // Channel line style: dotted (the default) or dashed (user, 2026-09-27).
    const dashSvg = dash => `<svg width="26" height="10" viewBox="0 0 26 10"><line x1="2" y1="5" x2="24" y2="5" stroke="currentColor" stroke-width="3" stroke-linecap="${dash ? 'butt' : 'round'}" stroke-dasharray="${dash ? '7 4' : '0.1 5'}"/></svg>`;
    const lineStyle = d.kind !== 'channel' ? '' : `<span class="reel-dash-seg" role="group" aria-label="Line style">`
      + `<button class="reel-tool reel-dash-btn${d.dash ? '' : ' on'}" data-act="draw-dash" data-v="0" data-name="${name}" aria-pressed="${!d.dash}" aria-label="Dotted lines" title="Dotted">${dashSvg(false)}</button>`
      + `<button class="reel-tool reel-dash-btn${d.dash ? ' on' : ''}" data-act="draw-dash" data-v="1" data-name="${name}" aria-pressed="${!!d.dash}" aria-label="Dashed lines" title="Dashed">${dashSvg(true)}</button>`
      + `</span>`;
    // The 10-line ladder alone gets a "%" switch: show or hide its 10%–100%
    // labels (user, 2026-09-15). On = labels showing, the default.
    const pct = d.kind === 'ladder'
      ? `<button class="reel-tool reel-tool-pct${d.hideLabels ? '' : ' on'}" data-act="draw-labels" data-name="${name}" aria-pressed="${!d.hideLabels}" aria-label="${d.hideLabels ? 'Show percentages' : 'Hide percentages'}" title="${d.hideLabels ? 'Show %' : 'Hide %'}">%</button>`
        // Reverse the numbering: 10% at the top, 100% at the bottom (user, 2026-09-25).
        + `<button class="reel-tool reel-tool-pct${d.reverse ? ' on' : ''}" data-act="draw-reverse" data-name="${name}" aria-pressed="${!!d.reverse}" aria-label="${d.reverse ? 'Number the percentages from the bottom' : 'Number the percentages from the top'}" title="Reverse %">%⇅</button>`
        // Stack a copy of the 10 lines above / below, or take one away.
        + `<span class="reel-stack" role="group" aria-label="Stack ladder">`
        + `<button class="reel-tool reel-stack-btn" data-act="draw-stack" data-dir="up" data-d="1" data-name="${name}" title="Build another block above" aria-label="Build another block above">+▲</button>`
        + `<button class="reel-tool reel-stack-btn" data-act="draw-stack" data-dir="down" data-d="1" data-name="${name}" title="Build another block below" aria-label="Build another block below">+▼</button>`
        + `</span>`
      : '';
    // A BOLD switch on entry markers (user, 2026-09-15) and on horizontal and
    // vertical lines (user, 2026-09-19).
    const bold = DRAW_BOLDABLE.has(d.kind)
      ? `<button class="reel-tool reel-tool-pct${d.bold ? ' on' : ''}" data-act="draw-bold" data-name="${name}" aria-pressed="${!!d.bold}" aria-label="${d.bold ? 'Normal weight' : 'Make bold'}" title="Bold">B</button>`
      : '';
    // Buy/Sell markers: run the line to the chart's left / right edge.
    const ext = d.kind === 'entry' && d.side
      ? `<button class="reel-tool reel-tool-pct${d.extL ? ' on' : ''}" data-act="draw-ext" data-dir="L" data-name="${name}" aria-pressed="${!!d.extL}" aria-label="Extend the line left" title="Extend left">⟵</button>`
        + `<button class="reel-tool reel-tool-pct${d.extR ? ' on' : ''}" data-act="draw-ext" data-dir="R" data-name="${name}" aria-pressed="${!!d.extR}" aria-label="Extend the line right" title="Extend right">⟶</button>`
      : '';
    const less = d.kind !== 'ladder' ? '' : `<span class="reel-stack" role="group" aria-label="Remove ladder stacks">`
      + `<button class="reel-tool reel-stack-btn" data-act="draw-stack" data-dir="up" data-d="-1" data-name="${name}" aria-label="Remove a stack above"${ladderStack(d, 'up') ? '' : ' disabled'}>−▲</button>`
      + `<button class="reel-tool reel-stack-btn" data-act="draw-stack" data-dir="down" data-d="-1" data-name="${name}" aria-label="Remove a stack below"${ladderStack(d, 'down') ? '' : ' disabled'}>−▼</button></span>`;
    return `<div class="reel-props-main">${lineStyle}${pct}${ext}${bold}
      <button class="reel-tool reel-draw-more-btn${more ? ' on' : ''}" data-act="draw-more" data-name="${name}" aria-expanded="${more}">More <span aria-hidden="true">•••</span></button>
    </div>${more ? `<div class="reel-draw-more"><div class="reel-draw-actions">${less}
      <button class="reel-tool" data-act="draw-dup" data-name="${name}" aria-label="Duplicate this drawing">${ICON_COPY}<span>Duplicate</span></button>
      <button class="reel-tool reel-tool-del" data-act="draw-delete" data-name="${name}" aria-label="Delete this drawing">${ICON_TRASH}<span>Delete</span></button>
    </div>${intensity}</div>` : ''}`;
  }


    return { collapsed: drawToolsCollapsed, moreOpen: drawMoreOpen, stripHtml: reelDrawStripHtml, html: reelToolbarHtml, sync: reelSyncToolbar, propsHtml: reelPropsHtml };
  }
  const api = Object.freeze({create});
  (root.SwingPulseModules ||= {}).drawingToolbar = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
