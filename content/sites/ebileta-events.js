/* ------------------------------------------------------------------
 * Seat Tracker on eBileta's event list (listaEventiPub.do, several events)
 *
 * eBileta's event page has two shapes. With one event on sale it shows that
 * event's sectors, which ebileta-sectors.js handles. With more than one it
 * shows a list of events instead — the same markup on both hosts — and this
 * is that page: a badge on every row saying whether the event is tracked and
 * how many tickets are wanted in it, and a sidebar listing the same, with
 * Track for the ones that are not.
 *
 * The page is read as it stands; nothing extra is fetched.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK || !SK.shell || window.__skEbEvents) return;
  const HOST = SK.ebileta.hostOf(location.hostname);
  if (!HOST) return;
  /* the sector list wins: that page is one event, not a list of them */
  if (document.querySelector('li.link_settore')) return;

  const ui = SK.ui;
  const EB = SK.ebileta;

  /* every event row on the page, with the row itself so it can be badged.
   * The same event appears under each of the page's tabs (Season, Site, Date,
   * Title), so one id can own several rows. */
  function readRows() {
    const out = new Map();
    for (const tr of document.querySelectorAll('tr.filtroeventi')) {
      const a = tr.querySelector('a[href*="idEvento="]');
      const id = a ? (/[?&]idEvento=(\d+)/.exec(a.getAttribute('href') || '') || [])[1] : '';
      if (!id) continue;
      const text = sel => {
        const n = tr.querySelector(sel);
        return n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
      };
      const row = out.get(id) || {
        id,
        title: text('.campo_ricerca_titolo') || text('.griglia.titolo .attivo') || text('.griglia.titolo'),
        date: text('.griglia.data .attivo') || text('.campo_ricerca_data'),
        venue: text('.griglia.titolo strong') || text('.griglia.sala strong'),
        rows: []
      };
      row.rows.push(tr);
      out.set(id, row);
    }
    return [...out.values()];
  }

  const events = readRows();
  if (!events.length) return;
  window.__skEbEvents = true;

  const eventUrl = id => EB.sectorPageUrl(id, HOST.origin);
  const keyOf = id => `${HOST.id}:${id}`;

  /* what this event is in Seat Tracker: its number, and the tickets wanted */
  function infoFor(st, e) {
    const ev = st ? st.events.find(x => x.key === keyOf(e.id)) : null;
    if (!ev) return { ev: null, qty: 0, status: null };
    const badge = SK.rules.badgeOf(st.requests.filter(r => r.eventKey === ev.key), r => r.eval.status);
    return { ev, qty: badge ? badge.qty : 0, status: badge ? badge.status : null };
  }

  async function track(e) {
    try {
      const res = await ui.send('trackUrl', { url: eventUrl(e.id) });
      sidebar.ctx.notice(`Tracking ${e.title || 'that event'}. Open it to add requests.`);
      await sidebar.refresh(true);
      return res;
    } catch (err) {
      sidebar.ctx.notice(err.message, true);
      return null;
    }
  }

  const sidebar = SK.shell.create({
    site: HOST.id,
    pageKey: 'events',
    slotFirst: true,
    title: () => `${HOST.label} events`,
    subtitle: () => `${events.length} event${events.length === 1 ? '' : 's'} on this page`,
    renderSlot(slot, ctx) {
      const st = ctx.state;
      renderBadges();
      const tracked = [], rest = [];
      for (const e of events) (infoFor(st, e).ev ? tracked : rest).push(e);

      for (const [title, list] of [['Tracked', tracked], ['Not tracked yet', rest]]) {
        if (!list.length) continue;
        const head = ui.el('div', 'sk-section-title');
        head.append(ui.el('span', null, title));
        slot.append(head);
        const ul = ui.el('ul', 'reqs');
        for (const e of list) {
          const { ev, qty, status } = infoFor(st, e);
          const li = ui.el('li', 'req ' + ui.statusClass(status));
          const top = ui.el('div', 'top');
          if (ev) top.append(ui.el('span', 'num', '[' + ev.num + ']'));
          top.append(ui.el('span', 'sec', e.title || 'event ' + e.id));
          if (qty) top.append(ui.el('span', 'chip', SK.util.plural(qty, 'ticket')));
          top.append(ui.el('span', 'spacer'));
          top.append(ui.button(ev ? 'Open' : 'Track', ev ? 'mini' : 'mini primary', async () => {
            if (!ev) { const r = await track(e); if (!r) return; }
            location.href = eventUrl(e.id);
          }, ev ? 'Open this event\'s sectors' : 'Add this event to Seat Tracker'));
          li.append(top, ui.el('div', 'detail', [e.date, e.venue].filter(Boolean).join(' · ')));
          ul.append(li);
        }
        slot.append(ul);
      }
      if (!st) slot.append(ui.el('p', 'note', 'Loading…'));
    },
    onState: () => renderBadges()
  });

  /* ---------------- a badge on every row ---------------------------- */

  function renderBadges() {
    const st = sidebar.state;
    const on = !!(st && SK.settings.badgesOn(st.settings, HOST.id));
    for (const e of events) {
      const { ev, qty, status } = infoFor(st, e);
      for (const tr of e.rows) {
        const cell = tr.querySelector('td.griglia.titolo') || tr.querySelector('td');
        if (!cell) continue;
        let b = cell.querySelector(':scope > .sk-eb-evbadge');
        if (!on) { if (b) b.remove(); continue; }
        if (!b) {
          b = document.createElement('button');
          b.type = 'button';
          b.className = 'sk-eb-evbadge';
          b.addEventListener('click', ev2 => {
            ev2.preventDefault();
            ev2.stopPropagation();
            sidebar.open();
          });
          cell.appendChild(b);
        }
        b.className = 'sk-eb-evbadge ' + (ev ? ui.statusClass(status) : 'untracked');
        b.textContent = ev ? `[${ev.num}]${qty ? ' · ' + qty : ''}` : 'not tracked';
        b.title = ev
          ? `Tracked as [${ev.num}]${qty ? ` · ${qty} tickets wanted` : ' · no open requests'}`
          : 'Not tracked yet — open the panel to add it';
      }
    }
  }
})();
