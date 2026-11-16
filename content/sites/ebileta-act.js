/* ------------------------------------------------------------------
 * Seat Tracker - holding seats on eBileta
 *
 * What a seat is here, and how to tell one that is held. Every press goes
 * through content/act.js, which is the only file in the extension that
 * dispatches an event at a site.
 *
 * How eBileta's seat map works (read off the live page):
 *   every free seat is a <g> with a jQuery "click" handler calling
 *   ctrl.click(this), which TOGGLES — clicking a chosen seat gives it back.
 *   A chosen seat's <rect> turns from #80FFC0 to #FFFF00 and a row appears
 *   in #cart. The cart is the truth; the colour is the quick check.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK || !SK.ebileta) return;

  const A = SK.act;
  if (!A) return;
  const SETTLE_MS = 1400;

  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /* ---------------- may we act at all ------------------------------- */

  /* eBileta only lets a logged-in session hold seats, and it says so with
   * the Logout link. Without it, clicking a seat does nothing useful. */
  const loggedIn = () => !!document.querySelector('#logout');

  /* off until you switch it on: until then the extension is read-only, as it
   * has always been */
  const enabled = settings => !!(settings && settings.selectSeats);

  function why(settings) {
    if (!enabled(settings)) return 'Selecting seats is switched off — Settings → On-site panels.';
    if (!loggedIn()) return 'Log in to eBileta to hold seats.';
    return '';
  }

  const canAct = settings => !why(settings);

  /* ---------------- the cart ---------------------------------------- */

  /* eBileta renders the held seats under the map. Both hosts use the same
   * markup; only the currency differs. -> [{ descr, rate, total, row }] */
  function readCart() {
    return [...document.querySelectorAll('#cart tr.rigaCarrello')].map(tr => {
      const sel = tr.querySelector('td.riduzione select');
      const opt = sel && sel.options[sel.selectedIndex];
      return {
        row: tr,
        descr: clean(tr.querySelector('td.descr') ? tr.querySelector('td.descr').textContent : ''),
        rate: opt ? clean(opt.textContent) : '',
        total: clean(tr.querySelector('.prezzo .tot') ? tr.querySelector('.prezzo .tot').textContent : '')
      };
    });
  }

  const cartHas = descr => {
    const want = clean(descr);
    return !!want && readCart().some(r => r.descr === want);
  };

  /* eBileta warns about this itself; repeating it saves reading the map */
  const cartSplit = () => [...document.querySelectorAll('#cart .noncontigui')]
    .some(n => n.offsetParent !== null || (n.style && n.style.display !== 'none'));

  /* ---------------- selecting one seat ------------------------------ */

  const rectOf = g => (g ? g.querySelector('rect') : null);
  const fillOf = g => {
    const r = rectOf(g);
    return r ? String(r.getAttribute('style') || r.getAttribute('fill') || '') : '';
  };

  /* One seat, once. The cart is the truth; the colour is the quick check —
   * a free seat's rect is #80FFC0 and a held one #FFFF00, but comparing it
   * with what it was needs no colour named at all. */
  async function selectSeat(g, seat, opts) {
    const o = opts || {};
    const before = fillOf(g);
    const rows = readCart().length;
    return A.pressAndCheck(g, () => cartHas(seat.descr) || readCart().length > rows || fillOf(g) !== before, {
      what: 'select', label: seat.descr, why: o.why || '', settleMs: SETTLE_MS,
      failed: 'eBileta did not take that seat — it may have just gone'
    });
  }

  /* Give every held seat back, using the site's own Delete buttons, one at a
   * time so the page keeps up. */
  async function emptyCart() {
    let removed = 0;
    for (let i = 0; i < 40; i++) {
      const btn = document.querySelector('#cart tr.rigaCarrello td.elimina button');
      if (!btn) break;
      const rows = readCart().length;
      const r = await A.pressAndCheck(btn, () => readCart().length < rows, { what: 'release seat', settleMs: SETTLE_MS });
      if (!r.ok) break;                              // it is not going: stop rather than hammer
      removed++;
    }
    await A.note({ what: 'empty cart', seats: removed, ok: true });
    return removed;
  }

  SK.ebAct = {
    loggedIn, enabled, canAct, why,
    leaveTicket: A.leaveTicket, takeTicket: A.takeTicket, note: A.note,
    readCart, cartHas, cartSplit, emptyCart, selectSeat
  };
})();
