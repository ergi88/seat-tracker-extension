/* ------------------------------------------------------------------
 * Seat Tracker - choosing seats on eFinity
 *
 * What a seat is here, and how to tell one that is chosen. Every press goes
 * through content/act.js, which is the only file that dispatches an event at
 * a site.
 *
 * How eFinity's map works (read off the live page):
 *   the whole venue is one SVG in the document — some 4,000 <rect> with a
 *   state attribute — injected outside React's tree, so the clicks are taken
 *   by a delegated native listener and the rect carries no React props.
 *   Choosing a seat adds the classes "isselected outlineCustom" to that same
 *   rect and leaves state="Available" alone, so the class is what says a seat
 *   is yours, and the chosen seats are simply .isselected across the map.
 *   Clicking a chosen seat gives it back, so each one is checked first.
 *
 *   There is no basket step: a chosen seat is in the Summary at once, and the
 *   only thing after that is Payment, which this never touches.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK || !SK.act) return;
  const A = SK.act;

  const CHOSEN = 'isselected';
  const AVAILABLE = 'Available';

  const isChosen = rect => !!rect && rect.classList.contains(CHOSEN);
  const seatOf = id => document.getElementById(String(id));

  /* eFinity keeps no sign of you in the page: the tokens live in localStorage,
   * and the map lets anyone choose seats. So this never blocks on being logged
   * in — it says so, because Payment will ask. */
  function loggedIn() {
    try {
      const auth = JSON.parse(localStorage.getItem('auth') || 'null');
      const until = auth && auth.SecurityToken && auth.SecurityToken.ValidTo;
      return !!until && Date.parse(until) > Date.now();
    } catch (e) {
      return false;
    }
  }

  const enabled = settings => !!(settings && settings.selectSeats);

  function why(settings) {
    if (!enabled(settings)) return 'Choosing seats is switched off — Settings → On-site panels.';
    if (!document.querySelector('rect[state]')) return 'The seat map has not finished drawing.';
    return '';
  }

  const canAct = settings => !why(settings);

  /* everything chosen on the map right now, whoever chose it */
  function chosenSeats() {
    return [...document.querySelectorAll('rect.' + CHOSEN)].map(r => ({
      id: r.id,
      row: r.getAttribute('row') || '?',
      num: r.getAttribute('number') || '?',
      sector: sectorNameOf(r),
      el: r
    }));
  }

  /* the innermost <svg id> around a seat is its article on the map */
  function sectorNameOf(rect) {
    for (let n = rect.parentNode; n && n.tagName; n = n.parentNode) {
      if (String(n.tagName).toLowerCase() === 'svg' && n.id) return n.id;
    }
    return '';
  }

  /* One seat, once. -> { ok, reason } */
  async function selectSeat(id, opts) {
    const o = opts || {};
    const rect = seatOf(id);
    if (!rect) return { ok: false, reason: `seat ${id} is not on this map` };
    if (rect.getAttribute('state') !== AVAILABLE) return { ok: false, reason: 'that seat is not free any more' };
    return A.pressAndCheck(rect, () => isChosen(rect), {
      what: 'choose', label: `${sectorNameOf(rect)} row ${rect.getAttribute('row')} seat ${rect.getAttribute('number')}`,
      why: o.why || '', failed: 'eFinity did not take that seat — it may have just gone'
    });
  }

  /* Give every chosen seat back by pressing it again, which is how the map
   * un-chooses one. */
  async function clearChosen() {
    let released = 0;
    for (const s of chosenSeats()) {
      const r = await A.pressAndCheck(s.el, () => !isChosen(s.el), { what: 'release seat', label: `${s.sector} ${s.row}/${s.num}` });
      if (!r.ok) break;
      released++;
    }
    await A.note({ what: 'clear selection', seats: released, ok: true });
    return released;
  }

  SK.efAct = {
    loggedIn, enabled, canAct, why,
    leaveTicket: A.leaveTicket, takeTicket: A.takeTicket, note: A.note,
    isChosen, chosenSeats, selectSeat, clearChosen
  };
})();
