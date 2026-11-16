/* ------------------------------------------------------------------
 * Seat Tracker - the one file that presses anything on a ticket site
 *
 * Everywhere else the extension reads. Every synthetic event in the whole
 * extension is dispatched from here, so the boundary is one file and a test
 * fails the moment a second one grows a MouseEvent. The site-specific parts
 * — which element is a seat, how to tell a chosen one, what is held — live
 * in content/sites/<site>-act.js and come back here to press.
 *
 * Three things keep it honest, whatever the site:
 *   - a press needs a real click: the one happening now, or a ticket that
 *     click left behind, readable once, by that tab, for a minute. The
 *     service worker cannot write sessionStorage, so nothing in the
 *     background can start one;
 *   - never more presses than the tickets asked for, and never more than
 *     TICKETS_PER_MIN in a minute, whatever asks;
 *   - every press is written to a log you can read in Settings.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK) return;

  const TICKETS_PER_MIN = 12;
  const TICKET_KEY = 'seat-tracker:reserve';
  const TICKET_MS = 60000;
  const LOG_KEY = 'actionLog';

  const recent = [];                       // when each press happened, this page

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------------- a real click, or a ticket from one --------------- */

  /* A Reserve press often has to open another page first, so the click that
   * asked for it happened before this page existed. It leaves this behind
   * instead: spent the moment it is read, and stale after a minute. */
  function leaveTicket(data) {
    try { sessionStorage.setItem(TICKET_KEY, JSON.stringify(Object.assign({ at: Date.now() }, data))); } catch (e) { /* blocked */ }
  }

  function takeTicket() {
    let raw = null;
    try { raw = sessionStorage.getItem(TICKET_KEY); sessionStorage.removeItem(TICKET_KEY); } catch (e) { return null; }
    if (!raw) return null;
    let t = null;
    try { t = JSON.parse(raw); } catch (e) { return null; }
    return t && Date.now() - (t.at || 0) < TICKET_MS ? t : null;
  }

  /* ---------------- the audit trail --------------------------------- */

  async function note(entry) {
    try {
      const { [LOG_KEY]: log } = await chrome.storage.local.get(LOG_KEY);
      const next = [Object.assign({ at: Date.now(), host: location.hostname }, entry), ...(log || [])].slice(0, 50);
      await chrome.storage.local.set({ [LOG_KEY]: next });
    } catch (e) { /* the press already happened; the note is a convenience */ }
  }

  /* ---------------- the press --------------------------------------- */

  function budgetLeft() {
    const now = Date.now();
    while (recent.length && now - recent[0] > 60000) recent.shift();
    return recent.length < TICKETS_PER_MIN;
  }

  /* One press on one element.
   *
   * The whole sequence a mouse makes, at one place and with no movement
   * between the steps: sites differ on which of them they listen for — eBileta
   * binds click, and a map that pans watches pointerdown — and a sequence that
   * never moves cannot be read as a drag. Dispatching straight at the element
   * also skips hit-testing, so a map scrolled half off screen is pressed just
   * as reliably as one in view. */
  function press(el) {
    if (!el) return false;
    if (!budgetLeft()) return false;
    recent.push(Date.now());
    const box = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const at = box ? { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 } : {};
    const opts = Object.assign({ bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }, at);
    for (const [Kind, type] of [[PointerEvent, 'pointerdown'], [MouseEvent, 'mousedown'],
      [PointerEvent, 'pointerup'], [MouseEvent, 'mouseup'], [MouseEvent, 'click']]) {
      try { el.dispatchEvent(new Kind(type, type === 'click' ? Object.assign({}, opts, { buttons: 0 }) : opts)); } catch (e) { /* the next one may land */ }
    }
    return true;
  }

  /* press, then wait for the site to agree it happened. -> { ok, reason } */
  async function pressAndCheck(el, isDone, opts) {
    const o = opts || {};
    if (!el) return { ok: false, reason: 'that is not on this page' };
    if (isDone()) return { ok: true, reason: 'already' };
    if (!press(el)) return { ok: false, reason: `that is ${TICKETS_PER_MIN} in a minute — stopping here` };

    const until = Date.now() + (o.settleMs || 1400);
    while (Date.now() < until) {
      await sleep(60);
      if (isDone()) break;
    }
    const ok = isDone();
    await note({ what: o.what || 'press', seat: o.label || '', ok, why: o.why || '' });
    return ok ? { ok: true } : { ok: false, reason: o.failed || 'the site did not take it — it may have just gone' };
  }

  SK.act = { TICKETS_PER_MIN, leaveTicket, takeTicket, note, press, pressAndCheck, sleep };
})();
