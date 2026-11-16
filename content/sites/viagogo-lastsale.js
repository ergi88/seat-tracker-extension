/* ------------------------------------------------------------------
 * Seat Tracker - viagogo's "just sold" toast, on the sell pages
 *
 * While a sell step is open (sell.viagogo.com/…/Secure/Pipeline/Sell/…),
 * viagogo shows the event's last sale in a toast. Whenever it shows, it is
 * read by its text and handed to the service worker, which saves it for
 * the team (or notes the same sale was seen again).
 *
 * Refreshing by itself is switched on per tab, from the sidebar (5–60
 * minutes, ± 20 %), and kept across the reloads in sessionStorage. To stay
 * clear of viagogo's bot check (it blocked this browser once, 2026-10-18):
 *   - a reload is an ordinary page load with your own cookies, nothing else;
 *   - no two viagogo reloads, in any tab, are closer than 90 s;
 *   - nothing reloads while you are typing or have just clicked;
 *   - if viagogo's bot page shows, refreshing stops on this PC for 6 hours.
 *
 * Opened by hand with no toast after a few seconds, the page asks viagogo
 * once itself (lastSaleCheckNow), so a new sale is saved without waiting
 * for the scan's timer.
 *
 * Nothing on the page is clicked. SK.lastSaleWatch is what the sidebar
 * (content/sites/viagogo.js) shows and switches.
 *
 * Every page also hands over the sell sessions viagogo keeps in this
 * browser (localStorage, one per event): the last-sales scan
 * (bg/lastsalescan.js) asks viagogo for each event's last sale with them,
 * with no page open.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK || !SK.lastSales || !SK.ui || !SK.viagogo) return;
  const L = SK.lastSales;
  const ui = SK.ui;

  const WATCH_KEY = 'seat-tracker:lastsale-watch';    // { every } — this tab only, kept across reloads
  const EVENT_KEY = 'seat-tracker:lastsale-event:';   // + the sell flow's ID -> { title, when, vgEventId }
  const RELOAD_KEY = 'seat-tracker:lastsale-reloaded'; // set just before this script reloads the tab
  const CHECK_AFTER_MS = 8 * 1000;                     // no toast this long after opening: ask viagogo once
  const QUIET_MS = 90 * 1000;                         // no reload this soon after you touched the page
  const TYPING_RETRY_MS = 2 * 60 * 1000;

  const ss = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* this load only */ } }
  };

  const w = {
    every: 0,              // minutes between reloads, 0 = off
    nextAt: 0,             // when the next reload is due
    waiting: '',           // '' | 'typing' | 'gap' — why the reload was put off
    toast: null,           // the sale the toast on this page shows
    saved: null,           // what the service worker said: { sale, isNew }
    checked: null,         // no toast showed: what asking viagogo once on opening said
    error: '',
    blockedUntil: 0,
    loadedAt: Date.now()
  };
  let timer = null, lastFp = '', lastTouch = 0, stopped = false;
  const listeners = new Set();
  const emit = () => { for (const f of listeners) { try { f(); } catch (e) { /* a listener's own trouble */ } } };

  /* ---------------- which event this sell flow is for ---------------- */

  const flowKey = () => EVENT_KEY + (L.pipelineIdOf(location) || 'last');

  function eventHere() {
    const kept = ss.get(flowKey()) || {};
    const d = SK.viagogo.readSellDetails(document);
    const title = kept.title || (d && d.title) || (w.toast && w.toast.title) || '';
    if (!title) return null;
    return {
      title,
      when: kept.when || (d && d.when) || '',
      vgEventId: kept.vgEventId || L.eventIdIn(location) || L.eventIdOnPage(document) || eventOfSession() || '',
      sessionId: L.pipelineIdOf(location) || ''
    };
  }

  /* viagogo keeps which event each sell session is for: this page's session -> its event */
  function eventOfSession() {
    const id = L.pipelineIdOf(location);
    if (!id) return '';
    let found = {};
    try { found = L.sessionsFrom(localStorage.getItem(L.SESSION_KEY)); } catch (e) { return ''; }
    return Object.keys(found).find(ev => found[ev].id.toLowerCase() === id.toLowerCase()) || '';
  }

  function remember(ev) {
    const was = ss.get(flowKey()) || {};
    ss.set(flowKey(), {
      title: ev.title || was.title || '', when: ev.when || was.when || '', vgEventId: ev.vgEventId || was.vgEventId || ''
    });
  }

  /* ---------------- the sell sessions, for the scan ------------------ */

  function handOverSessions() {
    if (!/^sell\./i.test(location.hostname)) return;
    let found = {};
    try { found = L.sessionsFrom(localStorage.getItem(L.SESSION_KEY)); } catch (e) { /* storage off */ }
    /* this page's own, when it is known which event it is for */
    const id = L.pipelineIdOf(location);
    const ev = eventHere();
    if (id && ev && ev.vgEventId && !found[ev.vgEventId]) found[ev.vgEventId] = { id, at: Date.now() };
    if (Object.keys(found).length) ui.send('vgSellSessions', { sessions: found }).catch(() => {});
  }

  /* ---------------- reading the toast -------------------------------- */

  function capture() {
    if (stopped || !L.isSellPage(location)) return;
    if (!ui.alive()) return shutdown();
    if (L.isBlockPage(document)) return blocked();
    const t = L.readToast(document);
    if (!t) return;
    const kept = ss.get(flowKey()) || {};
    const d = SK.viagogo.readSellDetails(document);
    const item = {
      title: t.title, section: t.section, row: t.row, tickets: t.tickets, price: t.price, currency: t.currency,
      when: L.whenNear(document, t.title, t.el) || (d && d.title && L.vgKeyOf(d.title) === L.vgKeyOf(t.title) ? d.when : '') || kept.when || '',
      vgEventId: L.eventIdIn(location) || L.eventIdOnPage(document) || kept.vgEventId || eventOfSession() || ''
    };
    const clean = L.clean(item);
    if (!clean) return;
    const fp = L.fingerprint(clean);
    if (fp === lastFp) return;
    lastFp = fp;
    remember(item);
    w.toast = clean;
    w.saved = null;
    w.error = '';
    emit();
    ui.send('saveLastSale', { item }).then(
      r => { w.saved = r; emit(); },
      e => { w.error = e.message; lastFp = ''; emit(); }
    );
  }

  /* ---------------- refreshing --------------------------------------- */

  /* typing in the page, or touched it a moment ago: a reload would lose that */
  function busy() {
    const a = document.activeElement;
    const typing = !!a && a !== document.body && (/^(input|textarea|select)$/i.test(a.tagName) || a.isContentEditable);
    return typing || Date.now() - lastTouch < QUIET_MS;
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = null;
    if (!w.every || stopped || !L.isSellPage(location)) { w.nextAt = 0; emit(); return; }
    const wait = ms === undefined ? L.nextDelay(w.every) : ms;
    w.nextAt = Date.now() + wait;
    timer = setTimeout(due, wait);
    emit();
  }

  async function due() {
    if (!w.every || stopped) return;
    if (!ui.alive()) return shutdown();
    if (busy()) { w.waiting = 'typing'; return schedule(TYPING_RETRY_MS); }
    let slot;
    try { slot = await ui.send('lastSaleSlot'); } catch (e) { w.error = e.message; return schedule(5 * 60000); }
    if (slot.blockedUntil) { w.blockedUntil = slot.blockedUntil; setEvery(0); return; }
    if (slot.wait > 0) { w.waiting = 'gap'; return schedule(slot.wait); }
    ss.set(RELOAD_KEY, Date.now());
    location.reload();
  }

  let blockSent = false;
  async function blocked() {
    clearTimeout(timer);
    if (blockSent) return;
    blockSent = true;
    const ev = eventHere();
    const info = { by: w.every ? 'reload' : 'page', vgEventId: (ev && ev.vgEventId) || '', title: (ev && ev.title) || '', why: 'its check page showed in a sell tab' };
    try { const r = await ui.send('vgBlocked', { info }); w.blockedUntil = r.blockedUntil; } catch (e) { w.blockedUntil = Date.now() + L.BLOCK_PAUSE_MS; }
    setEvery(0);
  }

  /* You opened this sell page yourself and no toast showed: ask viagogo once,
   * with this page's own sell session — the request the page makes for its
   * toast. New sale: saved; the one already saved: skipped. Not after this
   * script's own reloads (that is the timer), and not when the event was
   * asked about in the last 2 minutes. */
  async function checkOnOpen() {
    if (stopped || w.toast || !L.isSellPage(location) || L.isBlockPage(document)) return;
    if (!ui.alive()) return shutdown();
    const ev = eventHere();
    if (!ev || !ev.vgEventId) return;
    try {
      w.checked = await ui.send('lastSaleCheckNow', { vgEventId: ev.vgEventId, sessionId: ev.sessionId, title: ev.title, when: ev.when, by: 'page' });
    } catch (e) {
      w.checked = { kind: 'error', why: e.message };
    }
    if (w.checked && w.checked.kind === 'blocked') w.blockedUntil = w.checked.blockedUntil;
    emit();
  }

  function setEvery(minutes) {
    const n = Number(minutes) || 0;
    w.every = L.EVERY.includes(n) ? n : 0;
    w.waiting = '';
    ss.set(WATCH_KEY, w.every ? { every: w.every } : null);
    schedule();
  }

  async function turnOn(minutes) {
    try {
      const { vgBlockedUntil } = await chrome.storage.local.get('vgBlockedUntil');
      if (vgBlockedUntil && vgBlockedUntil > Date.now()) { w.blockedUntil = vgBlockedUntil; emit(); return; }
    } catch (e) { /* extension context gone */ }
    w.blockedUntil = 0;
    setEvery(minutes);
  }

  async function unblock() {
    try { await ui.send('vgUnblock'); } catch (e) { /* nothing to undo */ }
    w.blockedUntil = 0;
    emit();
  }

  /* ---------------- following the page ------------------------------- */

  let observer = null, readTimer = null, lastHref = '', followTimer = null, tick = null;

  function follow() {
    if (stopped) return;
    if (!ui.alive()) return shutdown();
    if (location.href === lastHref) return;
    lastHref = location.href;
    lastFp = '';
    w.toast = null; w.saved = null; w.error = '';
    capture();
    schedule();
  }

  function shutdown() {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(readTimer);
    clearInterval(followTimer);
    clearInterval(tick);
    if (observer) observer.disconnect();
  }

  async function boot() {
    const reloadedAt = ss.get(RELOAD_KEY);
    ss.set(RELOAD_KEY, null);
    const kept = ss.get(WATCH_KEY);
    if (kept && kept.every) {
      w.every = L.EVERY.includes(kept.every) ? kept.every : 0;
      /* blocked since this tab last loaded: stay off */
      try {
        const { vgBlockedUntil } = await chrome.storage.local.get('vgBlockedUntil');
        if (vgBlockedUntil && vgBlockedUntil > Date.now()) { w.blockedUntil = vgBlockedUntil; w.every = 0; ss.set(WATCH_KEY, null); }
      } catch (e) { /* extension context gone */ }
      if (w.every && L.isBlockPage(document)) await blocked();
    }
    for (const type of ['pointerdown', 'keydown', 'wheel']) {
      window.addEventListener(type, () => { lastTouch = Date.now(); }, { capture: true, passive: true });
    }
    observer = new MutationObserver(() => { clearTimeout(readTimer); readTimer = setTimeout(capture, 400); });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
    lastHref = location.href;
    handOverSessions();
    capture();
    schedule();
    if (!(reloadedAt && Date.now() - reloadedAt < 60000)) setTimeout(checkOnOpen, CHECK_AFTER_MS);
    followTimer = setInterval(follow, 1000);
    /* the countdown in the sidebar */
    tick = setInterval(() => { if (w.every) emit(); }, 30000);
  }

  SK.lastSaleWatch = {
    state: () => w,
    event: eventHere,
    set: minutes => (Number(minutes) ? turnOn(minutes) : setEvery(0)),
    unblock,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };

  boot();
})();
