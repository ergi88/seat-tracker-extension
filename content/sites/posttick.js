/* ------------------------------------------------------------------
 * Seat Tracker on posttick.com/c/*
 * The map is a seats.io chart, so badges sit in a strip under it, and the
 * sidebar drives the site's own chart (zoom + spotlight) through a small
 * page-world script. View only: nothing is ever selected or held.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK || !SK.shell || window.__skPosttick) return;
  if (!SK.site('posttick').eventFromUrl(location.href)) return;
  window.__skPosttick = true;

  const ui = SK.ui;
  let eventKey = null;
  let selected = null;
  const view = { minBlock: null, cats: [], selected: null };

  /* ---------------- page-world bridge ------------------------------- */

  const pending = new Map();
  let msgId = 0;
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/sites/posttick-page.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d || d.source !== 'sk-page' || ev.source !== window) return;
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  });

  function pageCall(action, labels) {
    const id = 'sk' + (++msgId);
    return new Promise(resolve => {
      pending.set(id, resolve);
      window.postMessage({ source: 'sk-content', id, action, labels }, '*');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ ok: false, error: 'timeout' }); } }, 1500);
    });
  }

  /* ---------------- sidebar ----------------------------------------- */

  const sidebar = SK.shell.create({
    site: 'posttick',
    pageKey: 'map',
    trackTitle: () => document.title.replace(/\s*-\s*posttick\.com\s*$/i, '').trim(),
    previewUrl: () => location.href,
    previewKey: () => SK.eventKey('posttick', SK.site('posttick').eventFromUrl(location.href) || ''),
    /* face values to paste on the viagogo event, tracked or not */
    faceCopy: true,
    onTrack: async () => {
      const res = await ui.send('registerPage', { url: location.href });
      eventKey = res.key;
      return res.key;
    },
    renderSlot(slot, ctx, ev) {
      if (!ev) return;
      if (!selected) {
        slot.append(ui.el('p', 'note hint', 'Click a sector in the strip under the map, or "Show on map" on a request, to see its blocks.'));
        return;
      }
      slot.append(ui.sectorCard(ctx, {
        eventKey: ev.key, secId: selected, view,
        onBlock: async b => { await pageCall('zoom', b.seats); await pageCall('spotlight', b.seats); },
        onClear: () => pageCall('reset'),
        onClose: () => { selected = null; pageCall('reset'); renderStrip(); sidebar.render(); }
      }));
    },
    onShow: r => select(r.sec, true),
    onState: () => renderStrip()
  });

  function firstSeats(sec) {
    const st = sidebar.state;
    const scan = st && st.scans[eventKey] && st.scans[eventKey][sec];
    if (!scan || scan.unmapped) return [];
    const ids = [];
    for (const b of SK.rules.blocksFor(scan, view.cats).blocks) ids.push(...b.seats.slice(0, 4));
    return ids.slice(0, 60);
  }

  function select(sec, zoom) {
    sec = String(sec);
    if (selected !== sec) Object.assign(view, { minBlock: null, cats: [], selected: null });
    selected = sec;
    renderStrip();
    sidebar.open();
    if (zoom) pageCall('zoom', firstSeats(sec));
  }

  /* ---------------- badge strip under the map ---------------------- */

  const strip = document.createElement('div');
  strip.className = 'sk-strip';

  function mountStrip() {
    const map = document.getElementById('seat_plan');
    if (map && map.parentNode && strip.parentNode !== map.parentNode) map.parentNode.insertBefore(strip, map.nextSibling);
  }

  function renderStrip() {
    const st = sidebar.state;
    const ev = st && ui.eventOf(st, eventKey);
    if (!ev || !SK.settings.badgesOn(st.settings, 'posttick')) { strip.remove(); return; }
    mountStrip();
    strip.textContent = '';
    for (const sec of ev.sectors) {
      const mine = st.requests.filter(r => r.eventKey === eventKey && !r.done && String(r.sec) === sec.id);
      /* open requests first; BOUGHT and the bought tickets only when all of them are */
      const badge = SK.rules.badgeOf(mine, r => r.eval.status);
      const worst = badge ? badge.status : null;
      const qty = badge ? badge.qty : 0;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sk-badge ${worst ? ui.statusClass(worst) : ''}${selected === sec.id ? ' sel' : ''}`;
      const dotEl = document.createElement('span');
      dotEl.className = 'sk-dot';
      const name = document.createElement('span');
      name.className = 'sk-name';
      name.textContent = sec.code;
      const q = document.createElement('span');
      q.className = 'sk-qty';
      q.textContent = qty ? `${qty} ${worst === 'BOUGHT' ? 'bought' : 'wanted'}` : sec.summary && !sec.summary.unmapped ? `${sec.summary.available} free` : '—';
      b.append(dotEl, name, q);
      b.addEventListener('click', e => { e.preventDefault(); select(sec.id, true); });
      strip.append(b);
    }
  }

  new MutationObserver(() => { if (strip.childNodes.length) mountStrip(); })
    .observe(document.body, { childList: true, subtree: true });

  /* only look the event up; it is added when the user presses Track */
  ui.send('lookupPage', { url: location.href })
    .then(res => { eventKey = res ? res.key : null; sidebar.setEventKey(eventKey); })
    .catch(() => {});
})();
