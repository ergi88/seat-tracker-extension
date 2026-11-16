/* Runs in posttick's own page world so it can talk to the seats.io chart.
 * View only: zoom, spotlight, reset. It never selects, holds, carts or
 * submits anything. */
(function () {
  'use strict';
  if (window.__skPageApi) return;
  window.__skPageApi = true;

  function chart() {
    try {
      if (window.$seatsio1 && typeof window.$seatsio1.zoomToObjects === 'function') return window.$seatsio1;
      const s = window.seatsio;
      if (s && Array.isArray(s.charts) && s.charts.length) return s.charts[0];
    } catch (e) { /* not ready */ }
    return null;
  }

  function reply(id, ok, error) {
    window.postMessage({ source: 'sk-page', id, ok, error: error || null }, '*');
  }

  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d || d.source !== 'sk-content' || ev.source !== window) return;
    const c = chart();
    if (!c) return reply(d.id, false, 'seat map not ready');
    try {
      switch (d.action) {
        case 'spotlight':
          if (c.setSpotlightObjects) c.setSpotlightObjects(d.labels || []);
          else if (c.highlightObjects) c.highlightObjects(d.labels || []);
          break;
        case 'zoom':
          if (c.zoomToObjects && d.labels && d.labels.length) c.zoomToObjects(d.labels);
          break;
        case 'reset':
          if (c.clearSpotlightObjects) c.clearSpotlightObjects();
          if (c.resetView) c.resetView();
          break;
        default:
          return reply(d.id, false, 'unknown action');
      }
      reply(d.id, true);
    } catch (e) {
      reply(d.id, false, String((e && e.message) || e));
    }
  });
})();
