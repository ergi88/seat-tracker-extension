/* ------------------------------------------------------------------
 * Seat Tracker - ticket statuses
 *
 * Where a ticket you bought stands. It is worked out, never stored, from
 * what is recorded: its PDF, the listings it is on, the sale that took it,
 * viagogo's status for that sale, the event's time and the deposit that
 * paid it. One status per ticket:
 *
 *   Purchased  awaiting_tickets  bought, the ticket itself not here yet
 *              ready             here, on no listing
 *   listed           on an active (or pending) listing
 *   reserved         held for a buyer viagogo is still checking
 *   sold             a sale took it
 *   awaiting_payout  sold, the event is over, viagogo has not paid yet
 *   paid_out         viagogo paid it out ("Complete"): PayPal or the like
 *   done             its money reached the bank, in lek (a deposit)
 *   sold_elsewhere   sold outside viagogo, what it brought not known yet
 *                    (once it is known: done)
 *   unsold           the event is over and it never sold: its cost is lost
 *
 * Badges sit next to it: no_pdf (listed, reserved or sold, but the ticket
 * has not come yet; not_received for a mobile-transfer ticket) and take_off
 * (sold, still on another active listing).
 *
 * A ticket comes as a PDF (received once its PDF is attached) or by mobile
 * transfer (received once you say so).
 *
 * A status set by hand (a pin) stands over the worked-out one for as long
 * as the facts stay what they were when it was set (pinnedOver). Once they
 * change, either way, the pin goes.
 *
 * An event is over 3 hours after it starts. One known only by its day
 * (a time of midnight) is over when that day ends. When it starts:
 * eventTime reads it from text (a title, the date viagogo gives), and
 * eventTimes finds each tracked event's, the same on a PC and in the app.
 *
 * Uses SK.sales.isPaid, SK.viagogo.parseWhen and SK.util.eventInfo: load
 * core/util.js, core/viagogo.js and core/sales.js first. Pure, no chrome.*
 * and no DOM: the app copies it (src/shared/sk/core-stages.js).
 * ------------------------------------------------------------------ */
(function (root) {
  'use strict';
  const SK = root.SK = root.SK || {};

  /* tone: the colour it is shown in (ok, low, bad, none, accent, bought) */
  const STAGES = [
    { key: 'awaiting_tickets', label: 'Awaiting tickets', group: 'purchased', tone: 'none' },
    { key: 'ready', label: 'Ready to list', group: 'purchased', tone: 'low' },
    { key: 'listed', label: 'Listed', group: '', tone: 'accent' },
    { key: 'reserved', label: 'Reserved', group: '', tone: 'bought' },
    { key: 'sold', label: 'Sold', group: '', tone: 'ok' },
    { key: 'awaiting_payout', label: 'Awaiting payout', group: '', tone: 'low' },
    { key: 'paid_out', label: 'Paid out', group: '', tone: 'accent' },
    { key: 'done', label: 'Done', group: '', tone: 'ok' },
    { key: 'sold_elsewhere', label: 'Sold elsewhere', group: '', tone: 'ok' },
    { key: 'unsold', label: 'Unsold', group: '', tone: 'bad' }
  ];
  const KEYS = STAGES.map(s => s.key);
  const BY_KEY = Object.fromEntries(STAGES.map(s => [s.key, s]));
  const GROUPS = [{ key: 'purchased', label: 'Purchased', stages: ['awaiting_tickets', 'ready'] }];
  const BADGES = { no_pdf: 'No PDF yet', not_received: 'Not received', take_off: 'Take it off' };
  const DELIVERY = [{ key: 'pdf', label: 'PDF' }, { key: 'mobile', label: 'Mobile transfer' }];
  /* the stages a viagogo sale's money goes through */
  const MONEY = ['sold', 'awaiting_payout', 'paid_out', 'done'];
  /* not received yet matters while it is on sale or sold, until the event */
  const NEEDS_TICKET = new Set(['listed', 'reserved', 'sold']);

  const OVER_AFTER = 3 * 60 * 60 * 1000;

  const stage = key => BY_KEY[key] || null;
  const label = key => (BY_KEY[key] ? BY_KEY[key].label : String(key || ''));
  const tone = key => (BY_KEY[key] ? BY_KEY[key].tone : 'none');
  /* a stage, or a group of them ('purchased') -> its stage keys */
  const keysOf = key => {
    const g = GROUPS.find(x => x.key === key);
    return g ? g.stages.slice() : BY_KEY[key] ? [key] : [];
  };

  /* when an event starting at `at` (ms) is over, or null when it has no time */
  function overAt(at) {
    const t = Number(at);
    if (!(t > 0)) return null;
    const d = new Date(t);
    if (d.getHours() === 0 && d.getMinutes() === 0) { d.setDate(d.getDate() + 1); return d.getTime(); }
    return t + OVER_AFTER;
  }
  const isOver = (at, now) => {
    const o = overAt(at);
    return o !== null && (now === undefined ? Date.now() : now) >= o;
  };

  /* The ticket itself has come: its PDF is in (or was: one deleted after its
   * event still came), or it is a mobile transfer you said came. A PDF ticket
   * from before received_at counts as come once it has (or had) its file.
   * t = { receivedAt, delivery, filePath, fileGoneAt } */
  const isReceived = t => !!t && (!!t.receivedAt || (t.delivery !== 'mobile' && !!(t.filePath || t.fileGoneAt)));

  /* ---------------- when an event is --------------------------------- */

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /* SK.viagogo.parseWhen knows "14 Nov", "14.11.2026" and "2026-11-14", but
   * not the month first, which is how eBileta writes it in its titles:
   * "Shqiperi - Finlande - November 12, 2026, 8:45 PM - Air Albania Stadium".
   * This adds that, and keeps parseWhen's answer otherwise. */
  function readDate(text) {
    const w = SK.viagogo.parseWhen(text);
    if (w.month) return w;
    const m = /(?:^|[^a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?!\d)/i.exec(text);
    if (!m || +m[2] < 1 || +m[2] > 31) return w;
    return { day: +m[2], month: MONTHS[m[1].toLowerCase()], minutes: w.minutes };
  }

  /* When an event is, as a time, from text: the date as the viagogo listings
   * page writes it ("2026-11-14 20:45", "Sat 14 Nov", "22.10.2026"...) or
   * month first ("November 12, 2026"), in the year the text names; with no
   * year, the coming one (a date more than 60 days past is next year's).
   * -> ms, or null when the text holds no date */
  function eventTime(text, now) {
    if (now === undefined) now = Date.now();
    text = String(text || '');
    const w = readDate(text);
    if (!w.month) return null;
    const y = /(?:^|\D)(20\d{2})(?!\d)/.exec(text);
    const h = w.minutes === null ? 0 : Math.floor(w.minutes / 60), mi = w.minutes === null ? 0 : w.minutes % 60;
    const at = year => new Date(year, w.month - 1, w.day, h, mi).getTime();
    if (y) return at(+y[1]);
    const t = at(new Date(now).getFullYear());
    return t < now - 60 * 86400000 ? at(new Date(now).getFullYear() + 1) : t;
  }

  /* The day and time split from a title (SK.util.splitEventTitle: { date:
   * 'YYYY-MM-DD', time: 'HH:MM' }) as a time, or null when it has no date. */
  function infoTime(info) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec((info && info.date) || '');
    if (!d) return null;
    const t = /^(\d{2}):(\d{2})$/.exec(info.time || '');
    return new Date(+d[1], +d[2] - 1, +d[3], t ? +t[1] : 0, t ? +t[2] : 0).getTime();
  }

  /* When each tracked event is. Sites rarely fill its date (eBileta and
   * Posttick put it in the title, eFinity nowhere), so: its title and date
   * together; else the date viagogo gives on the first listing or sale of
   * yours linked to it. dated: listings and sales ({ eventKey, userId, when })
   * -> { [eventKey]: ms } */
  function eventTimes(events, dated, me, now) {
    const out = {};
    for (const x of dated || []) {
      if (!x || !x.eventKey || x.userId !== me || out[x.eventKey]) continue;
      const t = eventTime(x.when, now);
      if (t !== null) out[x.eventKey] = t;
    }
    for (const ev of events || []) {
      const fromInfo = infoTime(SK.util.eventInfo(ev));
      const t = fromInfo !== null ? fromInfo : eventTime(`${ev.date || ''} ${ev.title || ''}`, now);
      if (t !== null) out[ev.key] = t;
    }
    return out;
  }

  /* Where a viagogo sale's money stands. o = { eventAt, deposited, now }:
   * deposited = the sale is in a deposit (its lek reached the bank).
   * -> 'sold' | 'awaiting_payout' | 'paid_out' | 'done' */
  function saleStage(sale, o) {
    o = o || {};
    if (o.deposited) return 'done';
    if (SK.sales.isPaid(sale)) return 'paid_out';
    if (isOver(o.eventAt, o.now)) return 'awaiting_payout';
    return 'sold';
  }

  /* f = { received, listed, reserved, sold, sale, deposited, elsewhere, unsold, eventAt, now }
   *   sold: a viagogo sale took it (sale: that sale, when known)
   *   elsewhere: the sale outside viagogo that took it ({ lek }: what it brought, all its tickets)
   *   reserved: 'open' (the buyer is being checked) or 'confirmed' (viagogo
   *     said yes: sold, until its sale is read and takes it) */
  function workedOut(f) {
    if (f.sale) return saleStage(f.sale, f);
    if (f.elsewhere) return Number(f.elsewhere.lek) > 0 ? 'done' : 'sold_elsewhere';
    if (f.sold || f.reserved === 'confirmed') return saleStage({}, f);
    if (f.reserved) return 'reserved';
    if (f.unsold) return 'unsold';
    if (f.listed) return 'listed';
    return f.received ? 'ready' : 'awaiting_tickets';
  }

  /* One ticket's status. f as workedOut takes, plus delivery ('pdf' |
   * 'mobile'), takeOff (still on another active listing), pin and
   * pinnedOver (a status set by hand).
   * -> { key, worked, pinned, stalePin, badges }
   *    stalePin: a pin the facts moved away from: it no longer counts */
  function ticketStatus(f) {
    f = Object.assign({}, f, { now: f && f.now !== undefined ? f.now : Date.now() });
    const worked = workedOut(f);
    const pinned = !!f.pin && KEYS.includes(f.pin) && f.pinnedOver === worked;
    const key = pinned ? f.pin : worked;
    const badges = [];
    if (!f.received && NEEDS_TICKET.has(key)) badges.push(f.delivery === 'mobile' ? 'not_received' : 'no_pdf');
    if (f.takeOff) badges.push('take_off');
    return { key, worked, pinned, stalePin: !!f.pin && !pinned, badges };
  }

  /* counts added up: [{ [key]: n }] -> { [key]: n } */
  function addCounts(list) {
    const out = {};
    for (const c of list || []) for (const [k, n] of Object.entries(c || {})) if (Number(n) > 0) out[k] = (out[k] || 0) + Number(n);
    return out;
  }

  SK.stages = {
    STAGES, KEYS, GROUPS, BADGES, DELIVERY, MONEY, OVER_AFTER, stage, label, tone, keysOf, overAt, isOver,
    isReceived, eventTime, infoTime, eventTimes, saleStage, ticketStatus, addCounts
  };

  if (typeof module === 'object' && module.exports) module.exports = SK;
})(globalThis);
