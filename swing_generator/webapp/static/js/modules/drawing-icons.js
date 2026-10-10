/* Consistent drawing and chart-action icons. */
(function(root) {
  'use strict';
  // Shared outline style keeps every compact drawing icon clear and consistent.
  const drawIcon = paths => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
  const TOOL_CHANNEL = drawIcon('<path d="M4 13l16-8M4 20l16-8"/><path d="M4 16.5l16-8" stroke-dasharray="2 3" opacity=".5"/>');
  const TOOL_TREND = drawIcon('<path d="M6 18L18 6"/><circle cx="4.5" cy="19.5" r="2"/><circle cx="19.5" cy="4.5" r="2"/>');
  const TOOL_HLINE = drawIcon('<path d="M4 12h16M4 9v6M20 9v6"/>');
  const TOOL_VLINE = drawIcon('<path d="M12 4v16M9 4h6M9 20h6"/>');
  const TOOL_LADDER = drawIcon('<path d="M5 4v16M5 4h15M5 9.3h12M5 14.7h15M5 20h12"/>');
  const TOOL_CIRCLE = drawIcon('<circle cx="12" cy="12" r="8"/>');
  const TOOL_TRIANGLE = drawIcon('<path d="M12 4l9 16H3z"/>');
  const TOOL_ENTRY = drawIcon('<circle cx="6" cy="12" r="3"/><path d="M9 12h11M17 9l3 3-3 3"/>');
  const TOOL_BUY = drawIcon('<path d="M12 4l7 9H5zM5 20h14"/>');
  const TOOL_SELL = drawIcon('<path d="M12 20l7-9H5zM5 4h14"/>');
  const ICON_BACK = drawIcon('<path d="M10 6l-6 6 6 6M4 12h11a5 5 0 0 1 5 5v1"/>');
  const ICON_UNDO = drawIcon('<path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>');
  const ICON_REDO = drawIcon('<path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"/>');
  const ICON_COPY = drawIcon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 15V6a2 2 0 0 1 2-2h9"/>');
  const ICON_LOCK = drawIcon('<rect x="5" y="10" width="14" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>');
  const ICON_UNLOCK = drawIcon('<rect x="5" y="10" width="14" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/>');
  const ICON_TRASH = drawIcon('<path d="M4 6h16M9 6V3h6v3M6 6l1 14h10l1-14M10 10v6M14 10v6"/>');
  const api = Object.freeze({TOOL_CHANNEL, TOOL_TREND, TOOL_HLINE, TOOL_VLINE, TOOL_LADDER, TOOL_CIRCLE, TOOL_TRIANGLE, TOOL_ENTRY, TOOL_BUY, TOOL_SELL, ICON_BACK, ICON_UNDO, ICON_REDO, ICON_COPY, ICON_LOCK, ICON_UNLOCK, ICON_TRASH});
  (root.SwingPulseModules ||= {}).drawingIcons = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
