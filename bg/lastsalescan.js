/* ------------------------------------------------------------------
 * Seat Tracker - the last-sales scan of every viagogo event
 *
 * viagogo's sell page shows an event's latest sale in a toast. The page
 * gets it from one small request (found 2026-11-06):
 *   GET sell.viagogo.com/Secure/Pipeline/Sell/GetRecentlySoldListingForEvent?ID=<sell session>
 *   -> {"listingId":…,"quantity":1,"section":"N207","price":"$21.75","eventName":"…"}, or {}
 * This asks the same, from here, with the browser's own cookies. No tab, no
 * window, nothing on screen, no notifications.
 *
 * The request needs a sell session ID, which belongs to one event:
 *   - the ones viagogo already keeps in this browser (any sell page you open
 *     hands them over: content/sites/viagogo-lastsale.js);
 *   - else one fetch of viagogo's own Sell link, Initialise?EventID=<n>,
 *     whose redirect ends on …?ID=<session>. A session older than a day is
 *     renewed that way when it answers {}.
 *
 * Which events: every one someone in the team has a listing on (seen in the
 * last 14 days, not over yet), plus the team's own list — events added by
 * hand for research, events left out, an interval per event (team setting
 * lastSaleEvents, kept by setEvent below). See SK.lastSales.scanPlan.
 *
 * Kept slow on purpose (viagogo blocked this browser once, 2026-10-18; it
 * runs DataDome):
 *   - one PC does it for the team (a lease), and only a PC allowed to;
 *   - one request every 45–75 s, each event at most every `lastSaleScanMin`
 *     minutes (30 by default, never under 15); never without cookies;
 *   - a 403/429 or DataDome's answer stops all viagogo automation on this PC
 *     for 6 hours (kept in vgBlockLog: when, what was asked, when it ends),
 *     and for a day after it ends the scan goes at half speed; a signed-out
 *     answer stops this scan here for 6 hours.
 *
 * Outside the schedule: checkNow (the "Get last sale now" buttons, and a
 * sell page you open whose toast did not show) asks about one event at once;
 * seen() counts a toast read on a sell page as that event's turn.
 *
 * Uses background.js's model() and noteVgBlocked(), and bg/events.js's
 * saveLastSale().
 * ------------------------------------------------------------------ */
'use strict';

const LastSaleScan = (() => {
  const L = SK.lastSales;
  const LEASE = 'vg-lastsales';
  const ALARM_NAME = 'vg-lastsales';
  const PAUSE_MS = 6 * 3600 * 1000;
  const FAIL_PAUSE_MS = 3600 * 1000;
  const TIMEOUT_MS = 20 * 1000;
  /* asked by hand (Get last sale now, a sell page you opened): never two requests closer than this */
  const HAND_GAP_MS = 10 * 1000;
  /* a sell page you open asks only if nobody asked about its event this recently */
  const PAGE_RECENT_MS = 2 * 60 * 1000;
  /* after a bot check ends, the scan goes at half speed this long */
  const SLOW_MS = 24 * 3600 * 1000;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let chain = Promise.resolve();
  const serial = fn => (chain = chain.then(fn, fn));

  const getJob = async () => (await chrome.storage.session.get('vgScanJob')).vgScanJob || {};
  const setJob = job => chrome.storage.session.set({ vgScanJob: job });
  const getLog = async () => (await chrome.storage.local.get('vgScan')).vgScan || { history: {} };
  const setLog = log => chrome.storage.local.set({ vgScan: log });
  const getSessions = async () => (await chrome.storage.local.get('vgSellSessions')).vgSellSessions || {};
  const setSessions = s => chrome.storage.local.set({ vgSellSessions: s });

  async function settingsOf(m) {
    const team = SK.settings.normalize(m.team || {});
    const every = team.lastSaleScanMin ? Math.max(L.SCAN_MIN_EVERY, team.lastSaleScanMin) : 0;
    return { every, here: m.settings.lastSaleScan !== false };
  }

  function planOf(m) {
    return L.scanPlan({
      listings: Object.values(m.listings || {}),
      teamPrices: Object.values(m.teamPrices || {}),
      watch: SK.settings.normalize(m.team || {}).lastSaleEvents
    }, Date.now());
  }
  const targetsOf = m => planOf(m).on;

  /* ---------------- talking to viagogo ------------------------------- */

  /* always with the browser's cookies: a request without them is what got this browser blocked */
  async function get(url, accept) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { credentials: 'include', redirect: 'follow', cache: 'no-store', signal: ctl.signal, headers: { Accept: accept } });
    } finally {
      clearTimeout(timer);
    }
  }

  /* -> { kind: 'ok', id } | { kind: 'blocked' | 'signed-out' | 'no-sell' | 'error', why } */
  async function newSession(vgEventId) {
    let res;
    try { res = await get(L.sellUrl(vgEventId), 'text/html,application/xhtml+xml'); } catch (e) { return { kind: 'error', why: e.message }; }
    let final;
    try { final = new URL(res.url); } catch (e) { final = null; }
    const id = final && L.isSellPage(final) ? L.pipelineIdOf(final) : '';
    if (res.status === 200 && id) {
      try { if (res.body) await res.body.cancel(); } catch (e) { /* the page itself is not needed */ }
      return { kind: 'ok', id };
    }
    const text = await res.text().catch(() => '');
    if (L.isBotAnswer(res.status, text)) return { kind: 'blocked', why: `HTTP ${res.status}` };
    if (res.status === 401 || (final && L.isLoginPage(final))) return { kind: 'signed-out' };
    return { kind: 'no-sell', why: `HTTP ${res.status} at ${final ? final.pathname : '?'}` };
  }

  /* -> { kind: 'sale', sale } | { kind: 'none' } | { kind: 'blocked' | 'signed-out' | 'bad-session' | 'error', why } */
  async function recentSold(sessionId) {
    let res;
    try { res = await get(L.recentSoldUrl(sessionId), 'application/json, text/plain, */*'); } catch (e) { return { kind: 'error', why: e.message }; }
    const text = await res.text().catch(() => '');
    if (L.isBotAnswer(res.status, text)) return { kind: 'blocked', why: `HTTP ${res.status}` };
    let final;
    try { final = new URL(res.url); } catch (e) { final = null; }
    if (res.status === 401 || (final && L.isLoginPage(final))) return { kind: 'signed-out' };
    if (res.status >= 400) return { kind: 'bad-session', why: `HTTP ${res.status}` };
    let json;
    try { json = JSON.parse(text); } catch (e) { return { kind: 'bad-session', why: 'not JSON' }; }
    const sale = L.parseRecentSold(json);
    return sale ? { kind: 'sale', sale } : { kind: 'none' };
  }

  /* ---------------- the tick (every 30 s while it is on) -------------- */

  /* the last bot check, and until when the scan goes slower after it */
  async function blockInfo() {
    const { vgBlockedUntil, vgBlockLog } = await chrome.storage.local.get(['vgBlockedUntil', 'vgBlockLog']);
    const now = Date.now();
    const log = (vgBlockLog || []).map(b => Object.assign({}, b, {
      endedAt: b.endedAt || (b.until <= now ? b.until : 0), ended: b.ended || (b.until <= now ? 'time' : '')
    }));
    const blockedUntil = vgBlockedUntil > now ? vgBlockedUntil : 0;
    const lastEnd = !blockedUntil && log[0] ? log[0].endedAt : 0;
    const slowUntil = lastEnd && lastEnd + SLOW_MS > now ? lastEnd + SLOW_MS : 0;
    return { blockedUntil, current: blockedUntil ? log[0] || null : null, log, slowUntil };
  }

  function note(log, target, result, why, by) {
    const h = Object.assign({}, log.history[target.vgEventId] || {});
    h.at = Date.now();
    h.result = result;
    h.by = by || 'scan';
    if (result === 'no-sell' || result === 'error') {
      h.misses = (h.misses || 0) + 1;
      if (h.misses >= 2) h.skipUntil = Date.now() + 24 * 3600 * 1000;   // an event that is over, most likely
      log.fails = (log.fails || 0) + 1;
    } else {
      h.misses = 0;
      log.fails = 0;
    }
    log.history[target.vgEventId] = h;
    log.last = { at: Date.now(), vgEventId: target.vgEventId, title: target.title, result, why: why || '', by: by || 'scan' };
    if (log.fails >= 4) {
      log.pausedUntil = Date.now() + FAIL_PAUSE_MS;
      log.pausedWhy = `viagogo did not answer four times in a row${why ? ` (${why})` : ''}`;
      log.fails = 0;
    }
  }

  /* forget events no longer scanned, so the history never grows */
  function prune(log, targets) {
    const keep = new Set(targets.map(t => t.vgEventId));
    for (const id of Object.keys(log.history)) {
      if (!keep.has(id) && Date.now() - (log.history[id].at || 0) > 30 * 86400000) delete log.history[id];
    }
  }

  async function stopFor(log, kind, m, info) {
    if (kind === 'blocked') {
      await noteVgBlocked(info);
    } else {
      Object.assign(log, { pausedUntil: Date.now() + PAUSE_MS, pausedWhy: 'viagogo is signed out in this browser' });
    }
    try { await Remote.releaseLease(LEASE, m.device.id); } catch (e) { /* it expires */ }
  }

  async function tick() {
    const m = await model();
    const job = await getJob();
    const log = await getLog();
    const cfg = await settingsOf(m);
    const now = Date.now();

    const { vgBlockedUntil } = await chrome.storage.local.get('vgBlockedUntil');
    if (!m.meId || !cfg.every || !cfg.here || (vgBlockedUntil && vgBlockedUntil > now) || log.pausedUntil > now) return;
    if (job.nextAt > now) return;

    const targets = targetsOf(m);
    prune(log, targets);
    const target = L.nextTarget(targets, log.history, cfg.every * 60000, now);
    if (!target) { await setLog(log); return; }

    let claimed = false;
    try { claimed = await Remote.claimLease(LEASE, 10 * 60, m.device.id); } catch (e) { return; }
    if (!claimed) return;                                  // another PC asks for the team

    const sessions = await getSessions();
    const had = sessions[target.vgEventId];
    const slow = (await blockInfo()).slowUntil > now;
    job.nextAt = now + L.scanGap() * (slow ? 2 : 1);
    await setJob(job);
    log.lastReqAt = now;
    const info = why => ({ by: 'scan', vgEventId: target.vgEventId, title: target.title, why: why || '' });

    /* no session for this event yet: get one, and ask on the next turn */
    if (!had || had.stale) {
      const s = await newSession(target.vgEventId);
      if (s.kind === 'ok') {
        sessions[target.vgEventId] = { id: s.id, at: Date.now(), source: 'scan' };
        await setSessions(sessions);
        log.last = { at: Date.now(), vgEventId: target.vgEventId, title: target.title, result: 'session' };
      } else if (s.kind === 'blocked' || s.kind === 'signed-out') {
        log.last = { at: Date.now(), vgEventId: target.vgEventId, title: target.title, result: s.kind, why: s.why || '', by: 'scan' };
        await stopFor(log, s.kind, m, info(`starting a sell session, ${s.why || ''}`));
      } else {
        note(log, target, s.kind, s.why);
      }
      await setLog(log);
      return;
    }

    const r = await recentSold(had.id);
    if (r.kind === 'blocked' || r.kind === 'signed-out') {
      log.last = { at: Date.now(), vgEventId: target.vgEventId, title: target.title, result: r.kind, why: r.why || '', by: 'scan' };
      await stopFor(log, r.kind, m, info(`asking for the last sale, ${r.why || ''}`));
      await setLog(log);
      return;
    }
    if (r.kind === 'bad-session' || (r.kind === 'none' && Date.now() - (had.at || 0) > L.SESSION_FRESH_MS)) {
      /* a session viagogo no longer knows, or an old one that says nothing: a new one next time */
      sessions[target.vgEventId] = Object.assign({}, had, { stale: true });
      await setSessions(sessions);
    }
    if (r.kind === 'sale') {
      let saved = null;
      try {
        saved = await saveLastSale(Object.assign({}, r.sale, { vgEventId: target.vgEventId, when: target.when }), m.meId);
      } catch (e) {
        note(log, target, 'error', e.message);
        await setLog(log);
        return;
      }
      note(log, target, saved && saved.isNew ? 'sale' : 'same');
    } else if (r.kind === 'bad-session' && !(had.source === 'scan' && Date.now() - (had.at || 0) < 3600000)) {
      /* a renewal is not a visit: ask again as soon as the new session is there */
      note(log, target, 'renew', r.why);
      delete log.history[target.vgEventId].at;
    } else {
      /* a session made a moment ago failing already counts against the event */
      note(log, target, r.kind === 'none' ? 'none' : 'error', r.why);
    }
    await setLog(log);
  }

  /* ---------------- outside the schedule --------------------------- */

  /* a sell page showed the event's toast: that was its turn, the timer starts over */
  async function seen(vgEventId, result, by) {
    const id = String(vgEventId || '').replace(/\D/g, '');
    if (id.length < 5) return false;
    const log = await getLog();
    const h = Object.assign({}, log.history[id] || {}, { at: Date.now(), result, by: by || 'page', misses: 0 });
    delete h.skipUntil;
    log.history[id] = h;
    await setLog(log);
    return true;
  }

  /* Get last sale now: one event, at once, from this PC, whatever the
   * schedule says. Still never while viagogo's bot check is on, never two
   * requests closer than HAND_GAP_MS, always with the browser's cookies.
   * opts: { sessionId (the page's own), title, when, by: 'hand' | 'page' }
   * -> { kind: 'sale' | 'same' | 'none' | 'recent' | 'blocked' | 'signed-out' | 'no-sell' | 'error', sale, why, blockedUntil } */
  async function checkNow(vgEventId, opts) {
    const o = opts || {};
    const id = String(vgEventId || '').replace(/\D/g, '');
    if (id.length < 5) throw new Error('That is not a viagogo event number.');
    const by = o.by === 'page' ? 'page' : 'hand';
    const m = await model();
    if (!m.meId) throw new Error('Sign in first.');
    const blocks = await blockInfo();
    if (blocks.blockedUntil) return { kind: 'blocked', blockedUntil: blocks.blockedUntil };

    const log = await getLog();
    const h = log.history[id] || {};
    if (by === 'page' && Date.now() - (h.at || 0) < PAGE_RECENT_MS) return { kind: 'recent', at: h.at, result: h.result };
    const plan = planOf(m);
    const known = plan.on.concat(plan.off).find(t => t.vgEventId === id) || {};
    const target = { vgEventId: id, title: o.title || known.title || '', when: o.when || known.when || '' };
    const info = why => ({ by, vgEventId: id, title: target.title, why: why || '' });

    const pace = async () => {
      const wait = (log.lastReqAt || 0) + HAND_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      log.lastReqAt = Date.now();
    };
    /* the scan does not ask right after this */
    const job = await getJob();
    const keepScanBack = () => setJob(Object.assign(job, { nextAt: Math.max(job.nextAt || 0, Date.now() + L.scanGap()) }));
    const finish = async (result, extra) => {
      if (result === 'blocked' || result === 'signed-out') {
        log.last = { at: Date.now(), vgEventId: id, title: target.title, result, why: (extra && extra.why) || '', by };
        await stopFor(log, result, m, info(extra && extra.why));
      } else note(log, target, result, extra && extra.why, by);
      await setLog(log);
      await keepScanBack();
      const b = result === 'blocked' ? await blockInfo() : null;
      return Object.assign({ kind: result }, extra || {}, b ? { blockedUntil: b.blockedUntil } : {});
    };

    const sessions = await getSessions();
    const pageSession = /^[0-9a-f-]{20,}$/i.test(String(o.sessionId || '')) ? String(o.sessionId) : '';
    if (pageSession && (!sessions[id] || sessions[id].id !== pageSession)) {
      sessions[id] = { id: pageSession, at: Date.now(), source: 'page' };
      await setSessions(sessions);
    }
    const start = async () => {
      await pace();
      const s = await newSession(id);
      if (s.kind !== 'ok') return s;
      sessions[id] = { id: s.id, at: Date.now(), source: 'scan' };
      await setSessions(sessions);
      await sleep(2000 + Math.round(Math.random() * 2000));   // the page itself would load before asking
      return s;
    };

    let sid = sessions[id] && !sessions[id].stale ? sessions[id].id : '';
    let fresh = false;
    if (!sid) {
      const s = await start();
      if (s.kind !== 'ok') return finish(s.kind, { why: `starting a sell session${s.why ? ', ' + s.why : ''}` });
      sid = s.id;
      fresh = true;
    }
    await pace();
    let r = await recentSold(sid);
    /* a session viagogo forgot: one new one, and ask again */
    if (!fresh && (r.kind === 'bad-session' || (r.kind === 'none' && Date.now() - (sessions[id].at || 0) > L.SESSION_FRESH_MS))) {
      sessions[id] = Object.assign({}, sessions[id], { stale: true });
      await setSessions(sessions);
      const s = await start();
      if (s.kind !== 'ok') return finish(s.kind, { why: `starting a sell session${s.why ? ', ' + s.why : ''}` });
      await pace();
      r = await recentSold(s.id);
    }
    if (r.kind === 'blocked' || r.kind === 'signed-out') return finish(r.kind, { why: `asking for the last sale${r.why ? ', ' + r.why : ''}` });
    if (r.kind === 'none') return finish('none');
    if (r.kind !== 'sale') return finish('error', { why: r.why || 'no answer' });
    let saved;
    try {
      saved = await saveLastSale(Object.assign({}, r.sale, { vgEventId: id, when: target.when }), m.meId);
    } catch (e) {
      return finish('error', { why: e.message, sale: r.sale });
    }
    return finish(saved && saved.isNew ? 'sale' : 'same', { sale: r.sale });
  }

  /* ---------------- sessions a sell page hands over ------------------- */

  /* { <vgEventId>: { id, at } } from viagogo's own list in the browser: the newer one wins */
  async function learn(found) {
    const sessions = await getSessions();
    let changed = 0;
    for (const [ev, s] of Object.entries(found || {})) {
      if (!/^\d{5,}$/.test(ev) || !s || !/^[0-9a-f-]{20,}$/i.test(String(s.id || ''))) continue;
      const had = sessions[ev];
      if (had && !had.stale && (had.at || 0) >= (Number(s.at) || 0)) continue;
      sessions[ev] = { id: String(s.id), at: Number(s.at) || Date.now(), source: 'page' };
      changed++;
    }
    /* never more than the last 300 events */
    const ids = Object.keys(sessions);
    if (ids.length > 300) {
      ids.sort((a, b) => (sessions[a].at || 0) - (sessions[b].at || 0)).slice(0, ids.length - 300).forEach(k => delete sessions[k]);
    }
    if (changed) await setSessions(sessions);
    return changed;
  }

  /* for the popup and the drawers: on or off, where, what it did last, and
   * every event with its interval, last answer and next turn */
  async function status(m) {
    const cfg = await settingsOf(m);
    const log = await getLog();
    const job = await getJob();
    const sessions = await getSessions();
    const blocks = await blockInfo();
    const lease = (m.leases || {})[LEASE];
    const holder = lease && lease.expiresAt > Date.now() && lease.deviceId !== m.device.id
      ? ((m.devices || []).find(d => d.id === lease.deviceId) || {}).name || 'another PC' : '';
    const plan = m.meId ? planOf(m) : { on: [], off: [] };
    const salesOf = {};
    for (const x of Object.values(m.lastSales || {})) if (x.vgEventId) salesOf[x.vgEventId] = (salesOf[x.vgEventId] || 0) + 1;
    /* when each one's turn should come, if this PC does the asking */
    const now = Date.now();
    const pausedUntil = log.pausedUntil > now ? log.pausedUntil : 0;
    const asking = !!(m.meId && cfg.every && cfg.here && !holder);
    const gapMs = (L.SCAN_GAP_MS[0] + L.SCAN_GAP_MS[1]) / 2 * (blocks.slowUntil > now ? 2 : 1);
    const eta = asking ? L.scanQueue(plan.on, log.history, cfg.every * 60000, {
      now, startAt: Math.max(job.nextAt || 0, blocks.blockedUntil, pausedUntil), gapMs,
      withSession: Object.keys(sessions).filter(k => !sessions[k].stale)
    }) : {};
    const describe = (t, on) => {
      const h = log.history[t.vgEventId] || {};
      const every = t.every || cfg.every;
      return {
        vgEventId: t.vgEventId, title: t.title, when: t.when, eventKey: t.eventKey, source: t.source, on,
        every, ownEvery: t.every || null, lastAt: h.at || 0, lastResult: h.result || '', lastBy: h.by || (h.at ? 'scan' : ''),
        nextAt: on && every ? Math.max((h.at || 0) + every * 60000, h.skipUntil || 0) : 0,
        etaAt: on ? eta[t.vgEventId] || 0 : 0,
        skipUntil: h.skipUntil > Date.now() ? h.skipUntil : 0,
        session: !!(sessions[t.vgEventId] && !sessions[t.vgEventId].stale), sales: salesOf[t.vgEventId] || 0
      };
    };
    const events = plan.on.map(t => describe(t, true)).concat(plan.off.map(t => describe(t, false)));
    return {
      every: cfg.every, here: cfg.here, events: plan.on.length, list: events,
      withSession: plan.on.filter(t => sessions[t.vgEventId] && !sessions[t.vgEventId].stale).length,
      nextAt: job.nextAt || 0, last: log.last || null, lastReqAt: log.lastReqAt || 0, holder, asking,
      perHour: L.requestsPerHour(plan.on, cfg.every),
      pausedUntil, pausedWhy: log.pausedWhy || '',
      blockedUntil: blocks.blockedUntil, block: blocks.current, blocks: blocks.log.slice(0, 10), slowUntil: blocks.slowUntil
    };
  }

  /* The team's list: add an event, leave one out, give one its own interval.
   * change: { on: true | false, every: minutes | null, title, when }; only what is given changes. */
  async function setEvent(vgEventId, change) {
    const id = String(vgEventId || '').replace(/\D/g, '');
    if (id.length < 5) throw new Error('That is not a viagogo event number.');
    const m = await model();
    const list = Object.assign({}, SK.settings.normalize(m.team || {}).lastSaleEvents);
    const auto = planOf(Object.assign({}, m, { team: Object.assign({}, m.team, { lastSaleEvents: {} }) })).on
      .some(t => t.vgEventId === id);
    const e = Object.assign({}, list[id] || {});
    const c = change || {};
    if (c.title) e.title = String(c.title).slice(0, 200);
    if (c.when) e.when = String(c.when).slice(0, 80);
    if (c.on === true) { if (auto) delete e.mode; else e.mode = 'add'; }
    if (c.on === false) { if (auto) e.mode = 'off'; else delete e.mode; }
    if ('every' in c) { if (Number(c.every) > 0) e.every = Math.max(L.SCAN_MIN_EVERY, Math.round(Number(c.every))); else delete e.every; }
    if (!e.mode && !e.every) delete list[id];
    else list[id] = e;
    await Remote.saveTeam(Object.assign({}, m.team || {}, { lastSaleEvents: list }));
    return status(await model());
  }

  async function resume() {
    const log = await getLog();
    delete log.pausedUntil;
    delete log.pausedWhy;
    log.fails = 0;
    await setLog(log);
    return true;
  }

  return {
    ALARM: ALARM_NAME,
    settingsOf,
    tick: () => serial(tick),
    learn: found => serial(() => learn(found)),
    setEvent: (id, change) => serial(() => setEvent(id, change)),
    resume: () => serial(resume),
    seen: (id, result, by) => serial(() => seen(id, result, by)),
    checkNow: (id, opts) => serial(() => checkNow(id, opts)),
    status
  };
})();
