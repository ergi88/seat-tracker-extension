/* ------------------------------------------------------------------
 * Seat Tracker - alerts about the tickets you bought
 *
 * Three alerts a PC sends about your tickets (bg/alerts.js tickets() sends
 * them; NOTIFICATIONS.md says what each one says):
 *
 *   noTickets     tickets still not here (no PDF yet, or a mobile transfer
 *                 not received) 7 days before their event, and again 2 days
 *                 before: worse when some of them are already listed,
 *                 reserved or sold
 *   reservedLong  a reservation still not confirmed 48 hours after it was
 *                 marked
 *   takeOff       a ticket sold (on viagogo or elsewhere) that is still on
 *                 another active listing: it could sell twice
 *
 * Worked out from what is recorded, as the app does (its src/lib/lots.js),
 * but without the app's guesses: a ticket counts as sold, reserved or listed
 * only when its sale, its reservation or a listing's link says so. A sale
 * that never said which tickets it took leaves them as they were, so the
 * milder noTickets may go where the app would say sold. A lot with no
 * tickets yet (counted) goes by the numbers typed on it; a frozen one (from
 * before PDFs were kept) is never "not here".
 *
 * Each alert has a key: it goes out once per key, whichever PC finds it.
 * Uses SK.util, SK.viagogo and SK.stages. Pure, no chrome.* and no DOM.
 * ------------------------------------------------------------------ */
(function (root) {
  'use strict';
  const SK = root.SK = root.SK || {};

  const H = 3600000, DAY = 24 * H;
  /* days before the event: one alert at each */
  const STEPS = [7, 2];
  const RESERVED_AFTER = 48 * H;

  const vals = o => (Array.isArray(o) ? o : Object.values(o || {}));
  const digits = v => String(v || '').replace(/\D/g, '');
  const num = v => Math.max(0, Math.round(Number(v)) || 0);
  const live = l => !!l && ['active', 'pending'].includes(SK.viagogo.listingStatus(l.status));
  const nowOf = x => (x.now === undefined ? Date.now() : x.now);
  /* a lot's tickets in the order of their PDF */
  const pageOf = t => (t.page === null || t.page === undefined ? 1e9 : t.page);
  const byPage = (a, b) => pageOf(a) - pageOf(b) || (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id));

  /* x = { purchases, tickets, links, listings, sales, reservations, events, me, now }
   *   as a PC's mirror holds them: listings, sales, reservations and events by id;
   *   links: [{ listingId, ticketId }]
   * -> your lots: { p, key, name, code, at, counted, frozen, tickets: [entry] }
   *    entry = { t, state: 'sold' | 'elsewhere' | 'reserved' | 'listed' | 'free', sale, links: [listing] }
   *    key: the event (a tracked one, else viagogo's: 'vg:<id>'); at: when it starts (null: not known) */
  function lotsOf(x) {
    const me = x.me;
    const now = nowOf(x);
    const listings = x.listings || {}, sales = x.sales || {}, reservations = x.reservations || {}, events = x.events || {};
    const dated = [...vals(listings), ...vals(sales)].filter(o => o.userId === me);
    const times = SK.stages.eventTimes(vals(events), dated, me, now);
    /* a viagogo event nobody tracks: its name, time (and any tracked event) from your listings and sales on it */
    const onVg = {};
    for (const o of dated) {
      const id = digits(o.vgEventId);
      if (id) (onVg[id] = onVg[id] || []).push(o);
    }
    const ticketsOf = {};
    for (const t of vals(x.tickets)) if (t.userId === me) (ticketsOf[t.purchaseId] = ticketsOf[t.purchaseId] || []).push(t);
    const linksOf = {};
    for (const k of vals(x.links)) {
      const l = listings[k.listingId];
      if (l) (linksOf[k.ticketId] = linksOf[k.ticketId] || []).push(l);
    }

    return vals(x.purchases).filter(p => p.userId === me).map(p => {
      const vg = digits(p.vgEventId);
      const on = vg ? onVg[vg] || [] : [];
      const tracked = p.eventKey || (on.find(o => o.eventKey) || {}).eventKey || null;
      const ev = tracked ? events[tracked] || null : null;
      let at = tracked && times[tracked] !== undefined ? times[tracked] : null;
      for (const o of on) if (at === null) at = SK.stages.eventTime(o.when, now);
      if (at === null && p.eventTitle) at = SK.stages.eventTime(p.eventTitle, now);
      const name = (ev && (SK.util.eventInfo(ev).name || ev.title)) || (on[0] && on[0].title) || p.eventTitle || 'An event';
      const sec = ev && p.sectorId ? (ev.sectors || []).find(s => String(s.id) === String(p.sectorId)) : null;
      const own = (ticketsOf[p.id] || []).slice().sort(byPage);
      const a = p.assigned || {};
      const tickets = own.map(t => ({ t, state: 'free', sale: null, links: linksOf[t.id] || [] }));
      /* the app's order: a sale took it; then sold outside viagogo (the
       * tickets it names, else the first free ones); then picked for a
       * reservation; then on an active listing */
      for (const e of tickets) if (e.t.saleId) { e.state = 'sold'; e.sale = sales[e.t.saleId] || null; }
      for (const o of Array.isArray(a.other) ? a.other : []) {
        const q = num(o && o.qty);
        if (!q) continue;
        const ids = Array.isArray(o.tickets) ? o.tickets.map(String) : [];
        const free = tickets.filter(e => e.state === 'free');
        for (const e of ids.length ? free.filter(e => ids.includes(String(e.t.id))) : free.slice(0, q)) e.state = 'elsewhere';
      }
      for (const e of tickets) {
        if (e.state !== 'free') continue;
        if (e.t.reservationId && reservations[e.t.reservationId]) e.state = 'reserved';
        else if (e.links.some(live)) e.state = 'listed';
      }
      return {
        p, key: tracked || 'vg:' + vg, name, code: (sec && sec.code) || p.section || '', at,
        counted: !own.length, frozen: !!p.frozen, tickets
      };
    });
  }

  /* Tickets still not here 7 days, then 2 days, before their event: one
   * alert per event and step (the nearest step reached, so a lot bought 3
   * days before gets only the 2-day one).
   * -> [{ type, key, group, name, at, left, step, missing, mobile, sold, listed,
   *       lots: [{ code, missing, mobile, sold, listed, exact }] }], soonest first
   *    sold: also reserved. exact: a lot of tickets (counted lots: sold and
   *    listed say only that some may be, from the listings their tickets are on) */
  function noTickets(x) {
    const now = nowOf(x);
    const listings = x.listings || {};
    const busy = {};                           // listingId -> it sold, or a buyer reserved on it
    for (const s of vals(x.sales)) if (s.listingId) busy[s.listingId] = true;
    for (const r of vals(x.reservations)) if (r.listingId) busy[r.listingId] = true;
    const groups = new Map();
    for (const lot of lotsOf(x)) {
      const row = { code: lot.code, missing: 0, mobile: 0, sold: 0, listed: 0, exact: !lot.counted };
      let at = lot.at;
      if (lot.counted) {
        if (lot.frozen) continue;
        const a = lot.p.assigned || {};
        const other = (Array.isArray(a.other) ? a.other : []).reduce((n, o) => n + num(o && o.qty), 0);
        row.missing = Math.max(0, num(lot.p.qty) - other);
        let sold = vals(a.sales).reduce((n, q) => n + num(q), 0), listed = 0;
        for (const [id, q] of Object.entries(a.listings || {})) {
          const l = listings[id];
          if (!l) continue;
          if (busy[id]) sold += num(q);
          else if (live(l)) listed += num(q);
        }
        row.sold = sold > 0 && row.missing > 0 ? 1 : 0;
        row.listed = listed > 0 && row.missing > 0 ? 1 : 0;
      } else {
        for (const e of lot.tickets) {
          if (e.state === 'elsewhere' || SK.stages.isReceived(e.t)) continue;
          row.missing += 1;
          if (e.t.delivery === 'mobile') row.mobile += 1;
          if (e.state === 'sold' || e.state === 'reserved') row.sold += 1;
          else if (e.state === 'listed') row.listed += 1;
          /* the time printed on the ticket beats the title's */
          if (e.t.eventAt && (at === null || e.t.eventAt < at)) at = e.t.eventAt;
        }
      }
      if (!row.missing) continue;
      if (!groups.has(lot.key)) groups.set(lot.key, { group: lot.key, name: lot.name, at: null, missing: 0, mobile: 0, sold: 0, listed: 0, lots: [] });
      const g = groups.get(lot.key);
      if (at !== null && (g.at === null || at < g.at)) g.at = at;
      for (const k of ['missing', 'mobile', 'sold', 'listed']) g[k] += row[k];
      g.lots.push(row);
    }
    const out = [];
    for (const g of groups.values()) {
      if (g.at === null) continue;                     // no time known: nothing to count down to
      const left = g.at - now;
      if (left <= 0) continue;                         // it has started
      const steps = STEPS.filter(d => left <= d * DAY);
      if (!steps.length) continue;
      const step = Math.min(...steps);
      out.push(Object.assign({ type: 'noTickets', key: `notix:${g.group}:${step}`, left, step }, g));
    }
    return out.sort((a, b) => a.at - b.at);
  }

  /* A reservation still not confirmed 48 hours after it was marked: viagogo
   * has decided by then (its email, My Sales), so Confirm or Cancel it.
   * -> [{ type, key, reservation, listing }], oldest first */
  function reservedLong(x) {
    const now = nowOf(x);
    const listings = x.listings || {};
    return vals(x.reservations)
      .filter(r => r.userId === x.me && !r.confirmedAt && r.createdAt > 0 && now - r.createdAt >= RESERVED_AFTER && listings[r.listingId])
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(r => ({ type: 'reservedLong', key: `reserved48:${r.id}`, reservation: r, listing: listings[r.listingId] }));
  }

  /* A ticket sold (by a viagogo sale, or outside viagogo) that is still on
   * an active listing other than its sale's, before the event: one per
   * ticket and listing. -> [{ type, key, group, name, code, ticket, listing, sale, elsewhere }] */
  function takeOff(x) {
    const now = nowOf(x);
    const out = [];
    for (const lot of lotsOf(x)) {
      if (SK.stages.isOver(lot.at, now)) continue;
      for (const e of lot.tickets) {
        if (e.state !== 'sold' && e.state !== 'elsewhere') continue;
        for (const l of e.links) {
          if (!live(l) || (e.sale && String(e.sale.listingId) === String(l.id))) continue;
          out.push({
            type: 'takeOff', key: `takeoff:${e.t.id}:${l.id}`, group: lot.key, name: lot.name, code: lot.code,
            ticket: e.t, listing: l, sale: e.sale, elsewhere: e.state === 'elsewhere'
          });
        }
      }
    }
    return out;
  }

  /* ---------------- what they say ------------------------------------ */

  const two = n => String(n).padStart(2, '0');
  /* "Sat 14 Nov 20:45"; the day alone when only the day is known (midnight) */
  function whenText(at) {
    const d = new Date(at);
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
    return d.getHours() || d.getMinutes() ? `${day} ${two(d.getHours())}:${two(d.getMinutes())}` : day;
  }
  /* "in 7 days", "in 5 hours" */
  function leftText(ms) {
    if (ms < DAY) {
      const h = Math.max(1, Math.round(ms / H));
      return `in ${h} hour${h === 1 ? '' : 's'}`;
    }
    const d = Math.round(ms / DAY);
    return `in ${d} day${d === 1 ? '' : 's'}`;
  }

  const MY_LISTINGS = 'https://my.viagogo.com/listings';

  /* one notification: noTickets and reservedLong take one item, takeOff the
   * ones of one event -> { title, message, click, clickLabel, priority } */
  function message(type, items) {
    const U = SK.util;
    const it = items[0];
    if (type === 'noTickets') {
      const what = it.sold ? 'Sold, no tickets yet' : it.listed ? 'Listed, no tickets yet' : 'No tickets yet';
      const lines = [`${it.name} · ${whenText(it.at)}`];
      for (const l of it.lots) {
        const parts = [];
        if (l.missing > l.mobile) parts.push(`${l.missing - l.mobile} no PDF yet`);
        if (l.mobile) parts.push(`${l.mobile} not received`);
        const out = l.exact
          ? [l.sold ? `${l.sold} sold or reserved` : '', l.listed ? `${l.listed} listed` : '']
          : [l.sold ? 'its listing sold' : '', l.listed ? 'listed' : ''];
        const said = out.filter(Boolean).join(', ');
        lines.push(`${l.code || 'No section'} · ${parts.join(', ')}${said ? ` (${said})` : ''}`);
      }
      lines.push('Attach the PDF, or tap Received for a mobile transfer, on the lot in the app.');
      return { title: `${what} · ${leftText(it.left)}`, message: lines.join('\n'), click: '', clickLabel: '', priority: it.sold || it.listed ? 5 : 4 };
    }
    if (type === 'reservedLong') {
      const r = it.reservation, l = it.listing;
      const where = [l.section, l.row ? 'row ' + l.row : ''].filter(Boolean).join(' · ');
      const lines = [
        [l.title || 'A listing', l.when].filter(Boolean).join(' · '),
        `${where ? where + ' · ' : ''}listing ${l.id} · ${U.plural(r.tickets, 'ticket')}${r.seats ? ' · seats ' + r.seats : ''}`,
        `Reserved ${U.since(r.createdAt)} ago, still not confirmed. Check viagogo's email or My Sales, then Confirm or Cancel it on the listing (the popup or the app).`
      ];
      return { title: `Reservation not confirmed · ${l.section || 'listing ' + l.id}`, message: lines.join('\n'), click: U.viagogoUrl(l.id), clickLabel: 'Viagogo listing', priority: 4 };
    }
    /* takeOff */
    const lines = [it.name];
    for (const x of items) {
      const t = x.ticket;
      const seat = [x.code || t.sectorText, t.row ? 'row ' + t.row : '', t.seat ? 'seat ' + t.seat : ''].filter(Boolean).join(' ') || 'A ticket';
      const how = x.elsewhere ? 'sold elsewhere' : x.sale ? `sold (sale ${x.sale.id})` : 'sold';
      lines.push(`${seat}: ${how}, still on listing ${x.listing.id}${x.listing.status ? ` (${x.listing.status})` : ''}`);
    }
    lines.push('Take it off that listing on viagogo, or it can sell twice.');
    const ids = [...new Set(items.map(x => String(x.listing.id)))];
    return {
      title: `Take it off · ${U.plural(items.length, 'ticket')}`, message: lines.join('\n'),
      click: ids.length === 1 ? U.viagogoUrl(ids[0]) : MY_LISTINGS, clickLabel: ids.length === 1 ? 'Viagogo listing' : 'Viagogo listings', priority: 5
    };
  }

  SK.ticketAlerts = { STEPS, RESERVED_AFTER, lotsOf, noTickets, reservedLong, takeOff, message, whenText, leftText };

  if (typeof module === 'object' && module.exports) module.exports = SK;
})(globalThis);
