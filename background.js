/* ------------------------------------------------------------------
 * Seat Tracker - service worker entry
 *
 * Every PC signs in to the team's Supabase project. Every 30 s it syncs
 * the team's data, shows its user's desktop alerts and (if it holds the
 * lease) reads everyone's shortcuts topics. Each event with open requests
 * has an auto-check alarm on every PC; a lease decides which PC scans.
 *
 * Read-only towards the ticket sites, with one exception the user switches
 * on: holding seats on eBileta, which happens in the page (see
 * content/sites/ebileta-act.js) and never from here. Nothing in this worker
 * ever writes to a ticket site.
 * ------------------------------------------------------------------ */
'use strict';

importScripts(
  'core/util.js', 'core/rules.js', 'core/registry.js', 'core/settings.js', 'core/config.js', 'core/viagogo.js', 'core/profit.js', 'core/team.js', 'core/market.js', 'core/sales.js', 'core/lastsales.js', 'core/face.js', 'core/update.js',
  'sites/ebileta.js', 'sites/efinity.js', 'sites/posttick.js',
  'bg/net.js', 'bg/store.js', 'bg/supabase.js', 'bg/remote.js',
  'bg/events.js', 'bg/alerts.js', 'bg/notify.js', 'bg/commands.js', 'bg/importer.js', 'bg/fx.js', 'bg/lastsalescan.js'
);

const ALARM = { sync: 'sync', events: 'event-list', digest: 'daily-summary' };
const AUTO_PREFIX = 'auto:';                               // "auto:<eventKey>"
const SWEEP_PREFIX = 'sweep:';                             // "sweep:<eventKey>"
const OLD_ALARMS = ['auto-check', 'cmd-poll', 'snooze-end'];
const ONLINE_MS = 2 * 60000;

/* ================================================================== */
/* settings and mute                                                   */
/* ================================================================== */

function isPlain(o) { return o && typeof o === 'object' && !Array.isArray(o); }

function deepMerge(base, changes) {
  const out = Object.assign({}, base);
  for (const [k, v] of Object.entries(changes || {})) {
    out[k] = isPlain(v) && isPlain(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/* team keys go to team_settings, device keys stay on this PC, the rest is the user's */
async function saveSettingsFor(userId, changes) {
  const m = await model();
  const parts = SK.settings.splitChanges(changes);
  if (Object.keys(parts.device).length && userId === m.meId) {
    await withLocal(s => patch({ deviceSettings: deepMerge(s.deviceSettings || {}, parts.device) }), ['deviceSettings']);
  }
  if (Object.keys(parts.team).length) await Remote.saveTeam(deepMerge(m.team || {}, parts.team));
  if (Object.keys(parts.user).length) {
    await Remote.saveProfile(userId, { settings: deepMerge(SK.settings.userPart((m.profiles[userId] || {}).settings || {}), parts.user) });
  }
  await syncAlarms();
  return (await model()).settingsFor(userId);
}

async function setSnooze(userId, minutes) {
  const until = minutes > 0 ? Date.now() + minutes * 60000 : 0;
  await Remote.saveProfile(userId, { snoozeUntil: until || null });
  await updateBadge();
  return until;
}

/* ================================================================== */
/* alarms and badge                                                    */
/* ================================================================== */

/* touch an alarm only when its period changed, so saving never resets a timer */
async function ensureAlarm(name, period, delay) {
  const cur = await chrome.alarms.get(name);
  if (!period) { if (cur) await chrome.alarms.clear(name); return; }
  if (cur && cur.periodInMinutes === period) return;
  await chrome.alarms.create(name, { periodInMinutes: period, delayInMinutes: delay === undefined ? period : delay });
}

/* after a pressed Scan the event's next auto-check comes a full interval later */
async function restartAutoTimer(key) {
  const m = await model();
  const mins = autoMinutesOf(m.events[key], m.team);
  if (!(mins > 0) || !(await chrome.alarms.get(AUTO_PREFIX + key))) return;
  await chrome.alarms.create(AUTO_PREFIX + key, { delayInMinutes: mins, periodInMinutes: mins });
}

async function syncAlarms() {
  const m = await model();
  for (const n of OLD_ALARMS) if (await chrome.alarms.get(n)) await chrome.alarms.clear(n);
  const signedIn = !!m.meId;
  await ensureAlarm(ALARM.sync, signedIn ? 0.5 : 0, 0.1);

  const wanted = new Map();
  const sweeps = new Map();
  if (signedIn) {
    for (const r of m.requests) {
      const ev = m.events[r.eventKey];
      if (r.done || !ev || wanted.has(ev.key)) continue;
      const mins = autoMinutesOf(ev, m.team);
      if (mins > 0) wanted.set(ev.key, mins);
      /* every sector, not just the wanted ones: its own, slower timer */
      const sweep = sweepMinutesOf(ev, m.team);
      if (sweep > 0) sweeps.set(ev.key, sweep);
    }
  }
  for (const a of await chrome.alarms.getAll()) {
    if (a.name.startsWith(AUTO_PREFIX) && !wanted.has(a.name.slice(AUTO_PREFIX.length))) await chrome.alarms.clear(a.name);
    if (a.name.startsWith(SWEEP_PREFIX) && !sweeps.has(a.name.slice(SWEEP_PREFIX.length))) await chrome.alarms.clear(a.name);
  }
  for (const [key, mins] of wanted) await ensureAlarm(AUTO_PREFIX + key, mins);
  /* offset so a sweep never lands in the same second as an auto-check */
  for (const [key, mins] of sweeps) await ensureAlarm(SWEEP_PREFIX + key, mins, Math.max(2, Math.round(mins / 2)));

  const team = SK.settings.normalize(m.team || {});
  const hasLists = SK.siteList().some(x => x.can.listEvents);
  await ensureAlarm(ALARM.events, signedIn && hasLists && team.eventCheckMin > 0 ? Math.max(1, team.eventCheckMin) : 0, 1);
  const anyDaily = signedIn && Object.keys(m.profiles).some(uid => m.settingsFor(uid).summaryMode === 'daily');
  await ensureAlarm(ALARM.digest, anyDaily ? 15 : 0, 1);

  /* viagogo's last sales, asked event by event with no page open: a 30 s tick while it is on */
  const vg = await LastSaleScan.settingsOf(m);
  await ensureAlarm(LastSaleScan.ALARM, signedIn && vg.every > 0 && vg.here ? 0.5 : 0, 0.5);
}

async function updateBadge() {
  try {
    const m = await model();
    if (!m.meId || m.authProblem) {
      await chrome.action.setBadgeText({ text: m.authProblem || !m.meId ? '!' : '' });
      await chrome.action.setBadgeBackgroundColor({ color: '#b3261e' });
      await chrome.action.setTitle({ title: `Seat Tracker · ${m.authProblem ? m.authProblem.message : 'sign in to start'}` });
      return;
    }
    const open = openRequests(m, null, m.meId);
    const statuses = open.map(r => evalOf(m, r).status);
    const low = statuses.filter(x => x === 'LOW').length;
    const gone = statuses.filter(x => x === 'SPLIT' || x === 'SHORT').length;
    const warnings = low + gone;
    const muted = (m.profiles[m.meId] || {}).snoozeUntil > Date.now();
    await chrome.action.setBadgeText({ text: warnings ? String(warnings) : '' });
    if (warnings) await chrome.action.setBadgeBackgroundColor({ color: muted ? '#6b7280' : gone ? '#b3261e' : '#d98324' });
    const parts = [`${open.length} open`];
    if (low) parts.push(`${low} running low`);
    if (gone) parts.push(`${gone} no longer fillable`);
    if (open.length && !warnings) parts.push('no warnings');
    if (muted) parts.push(`muted until ${SK.util.fmtClock(m.profiles[m.meId].snoozeUntil)}`);
    await chrome.action.setTitle({ title: `Seat Tracker · ${parts.join(' · ')}` });
  } catch (e) { /* the badge is cosmetic */ }
}

/* ================================================================== */
/* sync tick (every 30 s)                                              */
/* ================================================================== */

let tickChain = Promise.resolve();
let ticks = 0;

/* syncs never overlap, and a sync asked for now always runs after the one in flight */
function tick() {
  const run = tickChain.then(doTick, doTick);
  tickChain = run.catch(() => {});
  return run;
}

/* A sync that failed. Kept apart from other errors so it clears itself on the
 * next good sync, and says which kind of failure it is. Once it has failed
 * long enough to show the orange box in the popup, every signed-in user on
 * this PC also gets one desktop notification saying so (and one more when it
 * reconnects) — so a PC left running still warns someone not looking at it. */
const OFFLINE_SHOWN_MS = 60000;                             // matches ui/components.js connectionNote

async function noteSyncFailure(e, meta) {
  const was = meta && meta.sync;
  const kind = e.offline ? 'offline' : e.network ? 'unreachable' : e.server ? 'server' : 'error';
  const since = was ? was.since : Date.now();
  const fails = (was ? was.fails : 0) + 1;
  const shown = fails >= 2 || Date.now() - since >= OFFLINE_SHOWN_MS;
  const notified = !!(was && was.notified);
  if (shown && !notified) {
    await Notify.local('Seat Tracker: connection lost',
      kind === 'offline'
        ? 'This PC lost its internet connection. Scanning and syncing are paused until it is back.'
        : 'Seat Tracker can\'t reach its server (Supabase). Scanning and syncing are paused until it answers again.',
      'sync-offline', OFFLINE_SHOWN_MS);
  }
  await setMeta({ sync: { kind, message: e.message, detail: e.detail || '', since, at: Date.now(), fails, notified: shown || notified } });
}

async function doTick() {
  {
    const m = await model();
    if (!m.meId) return;
    const device = await ensureDevice();
    let res;
    try {
      res = await Remote.pull();
    } catch (e) {
      if (e.notMember) await Supa.setProblem(e.message);
      if (!e.auth) await noteSyncFailure(e, m.meta);
      return;
    }
    /* connected: forget the failure, and the never-cleared "Cannot reach Supabase" of earlier versions */
    const wasDown = m.meta && m.meta.sync;
    const connected = { lastSyncAt: Date.now(), sync: null };
    if (/Cannot reach Supabase/.test((m.meta && m.meta.lastError) || '')) connected.lastError = '';
    await setMeta(connected);
    if (wasDown && wasDown.notified) {
      const mins = Math.max(1, Math.round((Date.now() - wasDown.since) / 60000));
      await Notify.local('Seat Tracker: back online', `Reconnected after ${mins} min.`, 'sync-online', 0);
    }
    try { await Fx.ensureToday(); } catch (e) { /* no rates today yet: tried again within the hour */ }
    try { await Remote.heartbeat(device, m.meId); } catch (e) { /* next time */ }
    if (ticks++ % 4 === 0) { try { await Remote.fetchDevices(); } catch (e) { /* next time */ } }
    await showNewAlerts(res.alerts);
    await remindUpdate();
    await Commands.poll();
    if (ticks % 240 === 1) {
      try { if (await Remote.claimLease('cleanup', 23 * 3600, device.id)) await Remote.cleanup(); } catch (e) { /* not important */ }
    }
    await syncAlarms();
    await updateBadge();
  }
}

/* a newer Seat Tracker shared in the popup's Updates section: tell this PC
 * at once, then again once a day until it runs that version. A click opens the link. */
async function remindUpdate() {
  const m = await model();
  const u = SK.update.pending((m.team || {}).update, SK.update.installed());
  if (!u) return;
  await Notify.local(`Seat Tracker ${u.version} is ready`,
    `${u.note ? u.note + '\n' : ''}This PC runs ${SK.update.installed()}. Click to download, then unzip it over the old Seat Tracker folder and press Reload in the popup → Updates.`,
    `update:${u.version}:${u.at}`, 24 * 3600000, { click: u.url });
}

/* desktop notifications for the signed-in user, found by any PC */
async function showNewAlerts(serverMax) {
  const m = await model();
  const { lastAlertId } = await readLocal(['lastAlertId']);
  if (lastAlertId < 0) {                                   // just signed in: skip the history
    await withLocal(() => patch({ lastAlertId: serverMax }), ['lastAlertId']);
    return;
  }
  if (serverMax <= lastAlertId) return;
  const rows = await Remote.alertsSince(m.meId, lastAlertId);
  const cfg = m.settings;
  for (const r of rows) {
    /* the same rule as an alert this PC found itself, so a PC behaves the same
     * whichever one did the scanning — and so a PC set to custom can show a
     * kind your account has switched off, which is the point of custom */
    if (!SK.settings.showsHere(cfg, r.type).show) continue;
    await Notify.showDesktop({ id: r.id, title: r.title, message: r.message, click: r.click, eventKey: r.event_key, buttons: (r.data || {}).buttons || [] });
  }
  if (rows.length) await withLocal(() => patch({ lastAlertId: rows[rows.length - 1].id }), ['lastAlertId']);
}

/* ================================================================== */
/* timers                                                              */
/* ================================================================== */

const skipUntil = new Map();                               // eventKey -> this PC failed; let another PC try

/* Every sector of one event, on its own slow timer. It takes the same lease as
 * a scan, so two PCs never sweep the same event at once and a sweep never runs
 * on top of an auto-check. A sweep that cannot get the lease simply waits for
 * its next turn — there is nothing urgent about it. */
async function sweepEvent(key) {
  const m = await model();
  if (!m.meId) return;
  const ev = m.events[key];
  if (!ev) { await syncAlarms(); return; }
  const mins = sweepMinutesOf(ev, m.team);
  if (!mins) { await syncAlarms(); return; }

  const health = m.health[key] || {};
  if (Date.now() - (health.sweptAt || 0) < mins * 60000 - 20000) return;   // another PC just did it

  const lease = 'scan:' + key;
  let claimed = false;
  try { claimed = await Remote.claimLease(lease, mins * 60 + 120, m.device.id); } catch (e) { return; }
  if (!claimed) return;
  try {
    await sweepSectors(key);
  } catch (e) { /* the next sweep tries again */ }
  try { await Remote.releaseLease(lease, m.device.id); } catch (e) { /* it expires anyway */ }
  await updateBadge();
}

async function autoCheckEvent(key) {
  const m = await model();
  if (!m.meId) return;
  const ev = m.events[key];
  if (!ev || !openRequests(m, key).length) { await syncAlarms(); return; }
  const every = autoMinutesOf(ev, m.team);
  if (!every) return;

  /* scanned within this round already (a pressed Scan, or another PC): that was the auto-check */
  const metas = [...new Set(openRequests(m, key).map(r => String(r.sec)))].map(id => (m.scanMeta[key] || {})[id]);
  if (metas.length && metas.every(x => x && Date.now() - x.at < every * 60000 - 20000)) return;

  const others = m.devices.some(d => d.id !== m.device.id && Date.now() - d.lastSeen < ONLINE_MS);
  if (others && (skipUntil.get(key) || 0) > Date.now()) return;

  const lease = 'scan:' + key;
  let claimed = false;
  try { claimed = await Remote.claimLease(lease, every * 60 + 90, m.device.id); } catch (e) { return; }
  if (!claimed) return;                                    // another PC scans this event

  let failed = false;
  try {
    const r = await scanEvent(key, 'tracked', { auto: true });
    failed = r.scanned === 0 && r.errors.length > 0;
  } catch (e) {
    failed = true;
  }
  if (failed) {
    skipUntil.set(key, Date.now() + 10 * 60000);
    try { await Remote.releaseLease(lease, m.device.id); } catch (e) { /* it expires anyway */ }
    return;
  }
  skipUntil.delete(key);

  const after = await model();
  const users = [...new Set(openRequests(after, key).map(r => r.userId))];
  for (const uid of users) {
    if (after.settingsFor(uid).summaryMode === 'every') await Alerts.summary('Auto-check', [key], uid);
  }
}

async function eventListCheck() {
  const m = await model();
  if (!m.meId) return;
  const team = SK.settings.normalize(m.team || {});
  if (!team.eventCheckMin) return;
  if (!(await Remote.claimLease('event-list', Math.max(30, team.eventCheckMin * 60 - 20), m.device.id))) return;
  await checkNewEvents();
}

async function dailySummaries() {
  const m = await model();
  if (!m.meId) return;
  const today = SK.util.dayStamp(Date.now());
  const d = new Date();
  const nowMin = d.getHours() * 60 + d.getMinutes();
  for (const uid of Object.keys(m.profiles)) {
    const cfg = m.settingsFor(uid);
    if (cfg.summaryMode !== 'daily' || nowMin < SK.util.parseHM(cfg.summaryTime)) continue;
    if (!(await Remote.markHandled(`digest:${uid}:${today}`, uid))) continue;   // once a day, whichever PC
    await scanTrackedAll({ reuse: true }, uid);
    await Alerts.summary('Daily summary', null, uid);
  }
}

chrome.alarms.onAlarm.addListener(alarm => {
  let run;
  if (alarm.name.startsWith(AUTO_PREFIX)) run = () => autoCheckEvent(alarm.name.slice(AUTO_PREFIX.length));
  else if (alarm.name.startsWith(SWEEP_PREFIX)) run = () => sweepEvent(alarm.name.slice(SWEEP_PREFIX.length));
  else run = { [ALARM.sync]: tick, [ALARM.events]: eventListCheck, [ALARM.digest]: dailySummaries, [LastSaleScan.ALARM]: LastSaleScan.tick }[alarm.name];
  if (run) Promise.resolve().then(run).catch(() => {});
});

function boot() {
  ensureDevice().then(syncAlarms).then(updateBadge).then(tick).catch(() => {});
}
chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(boot);
boot();

let alarmTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.mirror || changes.auth || changes.authProblem || changes.scanCache)) return;
  clearTimeout(alarmTimer);
  alarmTimer = setTimeout(() => { syncAlarms().catch(() => {}); updateBadge(); }, 400);
});

/* ================================================================== */
/* the state the popup and sidebars render                             */
/* ================================================================== */

const fetchingScans = new Set();

/* the popup/sidebar needs full scans (price chips, sector cards): fetch the newer ones */
function refreshScansSoon(m, key) {
  const metas = m.scanMeta[key] || {};
  const have = m.scans[key] || {};
  const stale = Object.keys(metas).filter(sec => !have[sec] || have[sec].at < metas[sec].at);
  if (!stale.length || fetchingScans.has(key)) return;
  fetchingScans.add(key);
  Remote.fetchScans(key, stale.length > 40 ? null : stale).catch(() => {}).finally(() => fetchingScans.delete(key));
}

/* What a viagogo listing is to Seat Tracker.
 *   bought     its request is bought: you hold these tickets
 *   ignored    switched off with no request behind it: you hold these tickets
 *   tracked    bound to a request, so it is scanned and alerted like one
 *   linkable   its event is tracked and matched, but no request binds it yet
 *   untracked  no tracked event matches it — shown with a link back to viagogo
 * There is deliberately no "gone": a scan session reports what it did not see
 * and never rewrites a record on the strength of an absence. */
function listingState(l, request, event) {
  if (request && request.bought && !request.done) return 'bought';
  if (l.track === 'off') return 'ignored';
  if (request && !request.done) return 'tracked';
  if (request) return 'done';
  return event ? 'linkable' : 'untracked';
}

/* The tracked event whose seating map is this one. eBileta hands every event
 * its own idSM, and its sectors carry it, so a page that names no idEvento can
 * still be matched to the event you have been tracking all along.
 * -> event key | null */
function eventByIdSM(m, site, idSM) {
  const want = String(idSM || '');
  if (!want || !SK.ebileta.isEbileta(site)) return null;
  for (const ev of Object.values(m.events)) {
    if (ev.site !== site) continue;
    if (SK.ebileta.idSMOf(ev) === want) return ev.key;
  }
  return null;
}

/* Event scans handed between pages: a viagogo event scan made signed in,
 * for the listings page and for the same event signed out (incognito shares
 * this worker). Kept in session storage — never synced, gone when the
 * browser closes — and each one expires on its own after COMPARE_TTL. */
const COMPARES_KEY = 'compares';

async function liveCompares() {
  try {
    const all = (await chrome.storage.session.get(COMPARES_KEY))[COMPARES_KEY] || {};
    const now = Date.now();
    return Object.values(all).filter(c => SK.market.compareLive(c, now)).sort((a, b) => b.at - a.at);
  } catch (e) {
    return [];
  }
}

/* one per event: a newer scan of the same event replaces the older */
async function putCompare(c) {
  const ok = SK.market.unpackCompare(SK.market.packCompare(c));      // the same checks as a paste
  const all = (await chrome.storage.session.get(COMPARES_KEY))[COMPARES_KEY] || {};
  const now = Date.now();
  for (const k of Object.keys(all)) if (!SK.market.compareLive(all[k], now)) delete all[k];
  all[ok.eventId] = ok;
  await chrome.storage.session.set({ [COMPARES_KEY]: all });
  await chrome.storage.local.set({ compareAt: now });                // wakes every open page
  return ok;
}

async function dropCompare(eventId) {
  const all = (await chrome.storage.session.get(COMPARES_KEY))[COMPARES_KEY] || {};
  delete all[String(eventId)];
  await chrome.storage.session.set({ [COMPARES_KEY]: all });
  await chrome.storage.local.set({ compareAt: Date.now() });
  return true;
}

/* the shared update link and how this PC compares with it */
function updateState(m) {
  const latest = (m.team || {}).update || null;
  const installed = SK.update.installed();
  return { installed, latest, pending: !!SK.update.pending(latest, installed) };
}

async function buildState(msg) {
  const m = await model();
  const me = m.meId;
  const base = {
    now: Date.now(),
    auth: {
      signedIn: !!me,
      email: m.me ? m.me.email : '',
      userId: me,
      displayName: me && m.profiles[me] ? m.profiles[me].displayName : '',
      problem: m.authProblem ? m.authProblem.message : ''
    },
    device: m.device,
    settings: m.settings,
    sites: SK.siteList().map(x => ({ id: x.id, label: x.label, can: x.can, pages: x.pages, badges: x.badges, pushSelectors: x.pushSelectors })),
    notifyTypes: SK.settings.NOTIFY_TYPES,
    meta: m.meta,
    pushLog: (await readLocal(['pushLog'])).pushLog || [],
    /* every seat this PC clicked on a ticket site, newest first */
    actionLog: (await readLocal(['actionLog'])).actionLog || [],
    /* stadiums read without tracking them: this PC only, an hour at most */
    previews: await readPreviews(),
    legacy: await Backup.hasLegacy()
  };
  if (!me) return Object.assign(base, { events: [], requests: [], scans: {}, catalog: [], devices: [], listings: [], teamPrices: [], teamRequests: [], team: [], fx: null, snoozeUntil: 0 });

  const archived = new Set(m.settings.archivedEvents);
  const deviceName = id => ((m.devices.find(d => d.id === id) || {}).name) || 'another PC';
  const ownerName = uid => (m.profiles[uid] || {}).displayName || 'someone';

  /* A title with no date in it (eFinity's "Senidah Cair") borrows the day,
   * and the venue if it has none, from a listing or sale of yours linked to
   * the event on viagogo, as the app does. */
  const vgWhen = {};
  for (const x of [...Object.values(m.listings || {}), ...Object.values(m.sales || {})]) {
    if (!x.eventKey || x.userId !== me || vgWhen[x.eventKey] || !x.when) continue;
    const w = SK.util.splitEventTitle(x.when);
    if (w.date) vgWhen[x.eventKey] = Object.assign(w, { venue: String(x.venue || '').trim() });
  }
  const infoOf = ev => {
    const info = SK.util.eventInfo(ev);
    const w = !info.date && vgWhen[ev.key];
    return w ? Object.assign({}, info, { date: w.date, time: info.time || w.time, venue: info.venue || w.venue }) : info;
  };

  const events = Object.values(m.events).map(ev => {
    const site = SK.site(ev.site);
    const all = m.requests.filter(r => r.eventKey === ev.key);
    const mine = all.filter(r => r.userId === me);
    const metas = Object.values(m.scanMeta[ev.key] || {});
    const newest = metas.reduce((a, b) => (!a || b.at > a.at ? b : a), null);
    const lease = m.leases['scan:' + ev.key];
    return {
      key: ev.key, num: ev.num || 0, site: ev.site, siteLabel: site ? site.label : ev.site,
      siteId: ev.siteId, title: ev.title || ev.key, date: ev.date || '', url: eventUrlOf(ev),
      info: infoOf(ev),
      viagogo: (ev.extra && ev.extra.viagogo) || null,
      archived: archived.has(ev.key), currency: currencyOf(ev), cats: ev.cats || {},
      autoMin: ev.autoMin === undefined ? null : ev.autoMin,
      autoEvery: autoMinutesOf(ev, m.team),
      /* every sector, not just the wanted ones: null = the team default */
      sweepMin: ev.extra && ev.extra.sweepMin !== undefined ? ev.extra.sweepMin : null,
      sweepEvery: sweepMinutesOf(ev, m.team),
      canSweep: !!(site && site.can.sweep),
      sweptAt: (m.health[ev.key] || {}).sweptAt || 0,
      sectors: (ev.sectors || []).map(sec => {
        const meta = (m.scanMeta[ev.key] || {})[sec.id];
        return {
          id: String(sec.id), code: sec.code, name: sec.name, meta: sec.meta || {},
          url: site && site.sectorUrl ? site.sectorUrl(ev, sec) : null,
          hint: site && site.sectorHint ? site.sectorHint(sec, ev) : '',
          summary: meta ? Object.assign({}, meta.summary, { at: meta.at }) : null,
          price: sectorPriceOf(m, ev, sec, me)
        };
      }),
      open: mine.filter(r => !r.done).length,
      total: mine.length,
      teamOpen: all.filter(r => !r.done).length,
      teamTotal: all.length,
      otherOwners: [...new Set(all.filter(r => !r.done && r.userId !== me).map(r => ownerName(r.userId)))],
      worst: SK.rules.worst(mine.filter(r => !r.done).map(r => evalOf(m, r).status)),
      lastScanAt: newest ? newest.at : 0,
      lastScanBy: newest ? newest.by : '',
      scanner: lease && lease.expiresAt > Date.now() ? (lease.deviceId === m.device.id ? 'this PC' : deviceName(lease.deviceId)) : '',
      health: m.health[ev.key] || null
    };
  }).sort((a, b) => a.num - b.num);

  /* teammates' sell prices in one sector: a suggestion, never their payout */
  const teamPricesAt = (eventKey, sectorId) => Object.values(m.teamPrices)
    .filter(t => t.userId !== me && t.eventKey === eventKey && String(t.sectorId) === String(sectorId) && ACTIVE_LISTING.test(t.status || 'active'))
    .map(t => ({ owner: ownerName(t.userId), price: t.price, currency: t.currency, tickets: t.tickets, seenAt: t.seenAt }));

  const requests = m.requests.filter(r => r.userId === me).map(r => {
    const ev = m.events[r.eventKey];
    const site = ev && SK.site(ev.site);
    const e = evalOf(m, r);
    const sector = sectorOf(ev, r.sec);
    const listing = r.listing ? m.listings[r.listing] : null;
    const buy = buyOf(m, r, ev, r.sec, listing);
    return Object.assign({}, r, {
      buy,
      profit: listing ? moneyOf(m, listing, buy) : null,
      teamPrices: teamPricesAt(r.eventKey, r.sec),
      code: codeOf(m, r),
      sectorName: sector ? sector.name : String(r.sec),
      priceTag: priceTagOf(m, r),
      line: lineFor(m, r),
      eval: { status: e.status, options: e.options },
      free: e.free,
      scanNote: e.note,
      pendingGone: !!(m.state[r.id] || {}).pendingGone,
      /* its listing is switched off or gone from viagogo: shown, never acted on */
      muffled: muffled(m, r),
      listingTrack: listing ? listing.track : null,
      listingUrl: r.listing ? SK.util.viagogoUrl(r.listing) : '',
      sectorUrl: sector && site && site.sectorUrl ? site.sectorUrl(ev, sector) : null
    });
  });

  const want = msg && msg.scansFor;
  const scanKeys = want === 'priced'
    ? Object.values(m.events).filter(ev => (SK.site(ev.site) || { can: {} }).can.prices).map(ev => ev.key)
    : [].concat(want || []);
  const scans = {};
  for (const k of scanKeys) {
    if (!m.events[k]) continue;
    scans[k] = m.scans[k] || {};
    refreshScansSoon(m, k);
  }

  const catalog = [];
  for (const [siteId, list] of Object.entries(m.catalog)) {
    for (const e of Object.values(list)) {
      if (e.gone || m.events[SK.eventKey(siteId, e.siteId)]) continue;
      catalog.push({ site: siteId, siteLabel: (SK.site(siteId) || {}).label || siteId, siteId: e.siteId, title: e.title, date: e.date, venue: e.venue });
    }
  }

  const devices = m.devices.map(d => ({
    id: d.id, name: d.name || 'unnamed PC', owner: ownerName(d.userId), lastSeen: d.lastSeen,
    online: Date.now() - d.lastSeen < ONLINE_MS, thisPc: d.id === m.device.id, version: d.version || ''
  }));

  /* this person's viagogo listings, joined with their requests */
  const listings = Object.values(m.listings).filter(l => l.userId === me).map(l => {
    const r = m.requests.find(x => x.userId === me && x.listing === l.id) || null;
    const ev = m.events[r ? r.eventKey : l.eventKey] || null;
    const sectorId = r ? r.sec : l.sectorId;
    /* a price typed on the listing needs no event and no sector behind it */
    const buy = Number(l.buyPrice) > 0
      ? SK.profit.buyPriceOf({ listing: l })
      : (ev && sectorId ? buyOf(m, r, ev, sectorId, l) : null);
    return {
      id: l.id, title: l.title, when: l.when, section: l.section, row: l.row, status: l.status, history: l.history, vgEventId: l.vgEventId,
      sectorId: sectorId || null,
      requestId: r ? r.id : null, num: r ? r.num : null, done: r ? r.done : false,
      code: r ? codeOf(m, r) : ((sectorOf(ev, sectorId) || {}).code || l.section),
      reqStatus: r ? evalOf(m, r).status : null,
      reqOptions: r ? evalOf(m, r).options : null,
      eventKey: ev ? ev.key : null, eventNum: ev ? ev.num : null, eventTitle: ev ? SK.util.eventInfo(ev).name : '',
      /* v4: the listing is its own record and says so itself */
      track: l.track, lastSweepAt: l.lastSweepAt, seenAt: l.seenAt, venue: l.venue,
      currency: l.currency, price: l.price, tickets: l.tickets, payout: l.payout,
      buyPrice: l.buyPrice, buyCurrency: l.buyCurrency,
      state: listingState(l, r, ev),
      statusKind: SK.viagogo.listingStatus(l.status),
      options: r && !r.done ? evalOf(m, r).options : null,
      buy, money: moneyOf(m, l, buy)
    };
  });
  const teamPrices = Object.values(m.teamPrices).filter(t => t.userId !== me).map(t => ({
    listingId: t.id, userId: t.userId, owner: ownerName(t.userId), eventKey: t.eventKey, sectorId: t.sectorId,
    section: t.section, row: t.row, price: t.price, currency: t.currency, tickets: t.tickets, status: t.status, seenAt: t.seenAt
  }));
  /* teammates' open requests: whose, where and how many — never their client,
   * buy price or payout. Shown on viagogo's price step for the section being listed. */
  const teamRequests = m.requests.filter(r => r.userId !== me && !r.done).map(r => ({
    id: r.id, userId: r.userId, owner: ownerName(r.userId), eventKey: r.eventKey, sec: r.sec,
    code: codeOf(m, r), qty: r.qty, listing: r.listing || ''
  }));
  /* who can be messaged, and who the prices above belong to */
  const team = [...new Set(m.members.map(x => x.userId).concat(Object.keys(m.profiles)))]
    .map(uid => ({ userId: uid, name: ownerName(uid), me: uid === me }))
    .sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
  const today = ratesAt(m, Date.now());

  return Object.assign(base, {
    events, requests, scans, catalog, devices, listings, teamPrices, teamRequests, team,
    compares: await liveCompares(),
    sales: salesOf(m, me),
    lastSales: lastSalesOf(m),
    lastSaleScan: await LastSaleScan.status(m).catch(() => null),
    update: updateState(m),
    /* the buy tracker, yours alone: the eBileta checkout drawer fills names from these and adds purchases */
    buyAccounts: Object.values(m.accounts || {}).filter(a => a.userId === me).sort((a, b) => a.email.localeCompare(b.email)),
    purchases: Object.values(m.purchases || {}).filter(p => p.userId === me),
    fx: { day: today.day, rates: today.rates, fetched: (today.day && m.fx[today.day]) || {}, manual: today.manual, source: 'ExchangeRate-API' },
    snoozeUntil: (m.profiles[me] || {}).snoozeUntil || 0
  });
}

/* ------------------------------------------------------------------ */
/* money: buy price, viagogo payout and profit, in lek                 */
/* ------------------------------------------------------------------ */

const ACTIVE_LISTING = /^(active|pending|live)/i;

function ratesAt(m, at) {
  return SK.profit.pickRates(m.fx, SK.settings.normalize(m.team || {}).fxOverride, at);
}

function buyOf(m, r, ev, sectorId, listing) {
  if (!ev) return null;
  const summary = ((m.scanMeta[ev.key] || {})[String(sectorId)] || {}).summary;
  const priceList = ((m.sectorPrices || {})[ev.key] || {})[String(sectorId)] || null;
  return SK.profit.buyPriceOf({ site: ev.site, request: r || {}, listing: listing || {}, event: ev, sector: sectorOf(ev, sectorId), summary, priceList });
}

/* A sector's ticket price, as the app's price list shows it: the one the
 * team typed, else the site's (Posttick's categories, eFinity's sector price,
 * the range an eBileta scan read), else what you last paid there.
 * -> { amount, currency, source: 'list' | 'site' | 'paid', range } or null */
function sectorPriceOf(m, ev, sec, me) {
  const typed = ((m.sectorPrices || {})[ev.key] || {})[String(sec.id)];
  if (typed && typed.amount > 0) return { amount: typed.amount, currency: typed.currency, source: 'list', range: null };
  const summary = ((m.scanMeta[ev.key] || {})[String(sec.id)] || {}).summary;
  const site = SK.profit.buyPriceOf({ site: ev.site, event: ev, sector: sec, summary });
  if (site) return { amount: site.amount, currency: site.currency, source: 'site', range: site.range || null };
  const paid = Object.values(m.purchases || {})
    .filter(p => p.userId === me && p.eventKey === ev.key && String(p.sectorId) === String(sec.id) && p.price > 0)
    .sort((a, b) => String(b.boughtOn).localeCompare(String(a.boughtOn)))[0];
  return paid ? { amount: paid.price, currency: paid.currency, source: 'paid', range: null } : null;
}

/* This person's sales, each with what one ticket cost and the profit in lek.
 * What a sale paid: once it reached the bank, its share of the deposit (as
 * typed in the app, settled); until then, at today's rate (live). The buy
 * price is found as for a listing: typed on the listing, then the request's,
 * then the sector's price — and last, a price typed on the sale's section in
 * the sales sidebar. With no lot behind it, it is an estimate: today's rate too. */
function salesOf(m, me) {
  const live = ratesAt(m, Date.now());
  const mine = Object.values(m.sales || {}).filter(s => s.userId === me);
  const got = SK.sales.depositShares(m.deposits, m.depositSales, mine);
  return mine.map(s => {
    const l = s.listingId ? m.listings[s.listingId] : null;
    const r = s.listingId ? m.requests.find(x => x.userId === me && x.listing === s.listingId) : null;
    const ev = m.events[r ? r.eventKey : (l && l.eventKey) || s.eventKey] || null;
    const sectorId = r ? r.sec : (l && l.sectorId) || s.sectorId;
    let buy = ev && sectorId ? buyOf(m, r, ev, sectorId, l) : l ? SK.profit.buyPriceOf({ listing: l }) : null;
    if (!buy && Number(s.buyPrice) > 0) buy = { amount: s.buyPrice, currency: s.buyCurrency || 'ALL', source: 'typed on the section' };
    const g = got[s.id] || null;
    return Object.assign({}, s, {
      eventNum: ev ? ev.num : null, eventTitle: ev ? SK.util.eventInfo(ev).name : '', requestNum: r ? r.num : null,
      buy, money: Object.assign(SK.sales.saleMoney(s, buy, live.rates, g), { rateDay: g ? g.on : live.day })
    });
  });
}

/* The team's last sales from viagogo's "just sold" toast, newest first,
 * with the tracked event and sector they were matched to. */
function lastSalesOf(m) {
  return Object.values(m.lastSales || {}).map(s => {
    const ev = s.eventKey ? m.events[s.eventKey] : null;
    const sec = ev && s.sectorId ? sectorOf(ev, s.sectorId) : null;
    return Object.assign({}, s, {
      eventNum: ev ? ev.num : null, eventTitle: ev ? SK.util.eventInfo(ev).name : '', code: sec ? sec.code : ''
    });
  }).sort((a, b) => b.firstSeen - a.firstSeen).slice(0, 500);
}

/* Auto-refreshing sell pages: one viagogo reload at a time across every tab,
 * never two closer than MIN_GAP_MS, and none at all for hours after viagogo
 * showed its bot page. -> { wait } ms to wait first (0 = go), or { blockedUntil } */
async function lastSaleSlot() {
  const L = SK.lastSales;
  const now = Date.now();
  const { vgBlockedUntil } = await chrome.storage.local.get('vgBlockedUntil');
  if (vgBlockedUntil && vgBlockedUntil > now) return { wait: vgBlockedUntil - now, blockedUntil: vgBlockedUntil };
  const { lastSaleReloadAt } = await chrome.storage.session.get('lastSaleReloadAt');
  const gap = now - (lastSaleReloadAt || 0);
  if (gap < L.MIN_GAP_MS) return { wait: L.MIN_GAP_MS - gap + Math.round(Math.random() * 20000) };
  await chrome.storage.session.set({ lastSaleReloadAt: now });
  return { wait: 0 };
}

/* viagogo's bot check answered instead of the data. Everything that talks to
 * viagogo on this PC stops for BLOCK_PAUSE_MS, and the stop is kept in a short
 * history (vgBlockLog, newest first) so the popup can say when it happened,
 * what was being asked, and when it ends.
 * info: { by: 'scan' | 'hand' | 'page' | 'reload', vgEventId, title, why } */
async function noteVgBlocked(info) {
  const now = Date.now();
  const { vgBlockedUntil, vgBlockLog } = await chrome.storage.local.get(['vgBlockedUntil', 'vgBlockLog']);
  if (vgBlockedUntil > now) return { blockedUntil: vgBlockedUntil };   // already stopped: the first one counts
  const until = now + SK.lastSales.BLOCK_PAUSE_MS;
  const i = info || {};
  const entry = {
    at: now, until, by: String(i.by || ''), vgEventId: String(i.vgEventId || ''),
    title: String(i.title || '').slice(0, 200), why: String(i.why || '').slice(0, 200)
  };
  await chrome.storage.local.set({ vgBlockedUntil: until, vgBlockLog: [entry].concat(vgBlockLog || []).slice(0, 20) });
  await Notify.local('viagogo blocked this browser',
    `viagogo showed its bot check at ${SK.util.fmtClock(now)}${entry.title ? ` (asking about ${entry.title})` : ''}. The last-sales scan and tab refreshing stop on this PC until ${SK.util.fmtClock(until)}. Leave viagogo alone for a while; the popup's viagogo last sales section has the details.`,
    'vg-blocked', 30 * 60000);
  return { blockedUntil: until };
}

/* start again before the stop runs out (you passed viagogo's check in a tab) */
async function vgUnblock() {
  const { vgBlockedUntil, vgBlockLog } = await chrome.storage.local.get(['vgBlockedUntil', 'vgBlockLog']);
  const log = (vgBlockLog || []).slice();
  if (vgBlockedUntil > Date.now() && log[0] && !log[0].endedAt) log[0] = Object.assign({}, log[0], { endedAt: Date.now(), ended: 'hand' });
  await chrome.storage.local.set({ vgBlockLog: log });
  await chrome.storage.local.remove('vgBlockedUntil');
  return true;
}

/* one listing's profit against a buy price, at today's rate: nothing of it
 * is settled yet (live) */
function moneyOf(m, listing, buy) {
  const at = ratesAt(m, Date.now());
  return Object.assign(SK.profit.profitOf(listing, buy, at.rates), {
    rateDay: at.day, manualRates: at.manual,
    listing: {
      id: listing.id, price: listing.price, payout: listing.payout, tickets: listing.tickets, currency: listing.currency,
      status: listing.status, performance: listing.performance, seenAt: listing.seenAt
    }
  });
}

/* ================================================================== */
/* messages                                                            */
/* ================================================================== */

/* scans started by a UI action run in the background; the screens update when they finish */
function scanSoon(key, scope) { scanEvent(key, scope, { reuse: true }).catch(() => {}); }

async function me() {
  const m = await model();
  if (!m.meId) throw new Error('Sign in first — open the extension popup.');
  return m;
}

async function ownRequest(id) {
  const m = await me();
  const r = m.requests.find(x => x.id === id);
  if (!r) throw new Error('request not found');
  if (r.userId !== m.meId) throw new Error('That request belongs to someone else.');
  return r;
}

const HANDLERS = {
  state: msg => buildState(msg),

  /* the popup's Updates section: share a new version's link with every PC, or take it back */
  async shareUpdate(msg) {
    const m = await me();
    const update = SK.update.clean(msg, (m.profiles[m.meId] || {}).displayName || (m.me && m.me.email) || '');
    await Remote.saveTeam(Object.assign({}, m.team || {}, { update }));
    return update;
  },
  async clearUpdate() {
    const m = await me();
    const team = Object.assign({}, m.team || {});
    delete team.update;
    await Remote.saveTeam(team);
    return true;
  },
  reloadExtension: () => { setTimeout(() => chrome.runtime.reload(), 200); return true; },

  async signIn(msg) {
    const user = await Supa.signIn(msg.email, msg.password);
    const name = String(msg.deviceName || '').trim();
    await ensureDevice();
    await withLocal(s => patch({
      device: Object.assign({}, s.device, name ? { name } : {}),
      mirror: null, scanCache: {}, lastAlertId: -1
    }), ['device', 'mirror', 'scanCache', 'lastAlertId']);
    try {
      await Remote.pull({ full: true });
    } catch (e) {
      if (e.notMember) { await Supa.signOut(); }
      throw e;
    }
    await Remote.ensureProfile(user);
    try { await Remote.heartbeat(await ensureDevice(), user.id); await Remote.fetchDevices(); } catch (e) { /* next tick */ }
    await syncAlarms();
    await updateBadge();
    tick().catch(() => {});
    return { email: user.email };
  },

  async signOut() {
    await Supa.signOut();
    await withLocal(() => patch({ mirror: null, scanCache: {}, lastAlertId: -1 }), ['mirror', 'scanCache', 'lastAlertId']);
    await syncAlarms();
    await updateBadge();
    return true;
  },

  async setDeviceName(msg) {
    const m = await me();
    await withLocal(s => patch({ device: Object.assign({}, s.device, { name: String(msg.name || '').trim() }) }), ['device']);
    try { await Remote.heartbeat(await ensureDevice(), m.meId); await Remote.fetchDevices(); } catch (e) { /* next tick */ }
    return true;
  },

  /* Take PCs off the team's list. Never this PC, never one online now: a
   * PC still in use would only come back at its next heartbeat anyway. */
  async deleteDevices(msg) {
    const m = await model();
    const me = (await ensureDevice()).id;
    const now = Date.now();
    const ids = (msg.ids || []).map(String).filter(id => {
      const d = (m.devices || []).find(x => x.id === id);
      return d && id !== me && now - d.lastSeen >= ONLINE_MS;
    });
    if (!ids.length) throw new Error('Nothing to remove: this PC and PCs online now stay on the list.');
    const n = await Remote.deleteDevices(ids);
    return { removed: n };
  },

  async setDisplayName(msg) {
    const m = await me();
    await Remote.saveProfile(m.meId, { displayName: String(msg.name || '').trim() });
    return true;
  },

  syncNow: () => tick().then(async () => {
    const m = await model();
    return { ok: !(m.meta && m.meta.sync), sync: (m.meta && m.meta.sync) || null };
  }),

  /* which event is this page, and is it tracked? Never adds anything. */
  async lookupPage(msg) {
    const hit = SK.eventForUrl(msg.url);
    const m = await model();
    if (m.meId) {
      if (hit && m.events[hit.key]) return { key: hit.key, candidate: hit.key };
      /* The page may name no event at all: with one event on sale eBileta puts
       * its sectors on the event list page. An event tracked by its number is
       * still that event, and its seating map says so. */
      const bySM = eventByIdSM(m, msg.site, msg.idSM);
      if (bySM) return { key: bySM, candidate: bySM };
    }
    if (!hit) return null;
    if (!m.meId) return { key: null, candidate: hit.key, signedOut: true };
    return { key: null, candidate: hit.key };
  },

  /* only after the user pressed "Track this event" */
  async registerPage(msg) {
    const m0 = await me();
    /* never add a second record for an event already tracked under its number */
    const known = eventByIdSM(m0, msg.site, msg.idSM);
    if (known) return { key: known };
    const hit = SK.eventForUrl(msg.url);
    if (!hit) return null;
    const hint = { title: msg.title, titleWins: !!msg.titleWins };
    if (msg.sections && SK.ebileta.isEbileta(hit.site)) hint.sectors = msg.sections.map(x => SK.ebileta.toSector(x));
    const ev = await registerFromUrl(msg.url, hint);
    if (!ev.sectors || !ev.sectors.length) ensureEvent(ev.key).catch(() => {});
    return { key: ev.key };
  },

  /* a teammate pressed send: their message, to whoever they picked */
  async notifyTeam(msg) {
    const m = await me();
    return Alerts.teamMessage(m.meId, {
      text: msg.text, to: Array.isArray(msg.to) ? msg.to : null,
      eventKey: msg.eventKey || null, section: msg.section || '', click: msg.click || ''
    });
  },

  async trackUrl(msg) {
    await me();
    const ev = await registerFromUrl(String(msg.url || '').trim());
    await ensureEvent(ev.key);
    return { key: ev.key };
  },

  async trackCatalog(msg) {
    const m = await me();
    const c = (m.catalog[msg.site] || {})[msg.siteId] || {};
    const ev = await registerEvent(msg.site, msg.siteId, { title: c.title, date: c.date, venue: c.venue });
    await ensureEvent(ev.key);
    return { key: ev.key };
  },

  ensureEvent: msg => me().then(() => ensureEvent(msg.key, { force: !!msg.force })).then(ev => ({ key: ev.key })),
  archiveEvent: msg => me().then(m => setArchived(m.meId, msg.key, msg.archived)),
  forgetEvent: msg => me().then(() => forgetEvent(msg.key)),
  learnViagogo: msg => me().then(() => learnViagogo(msg)),

  async setEventSweep(msg) {
    await me();
    const v = msg.minutes === null || msg.minutes === undefined || msg.minutes === '' ? null : SK.util.clampInt(msg.minutes, 0, 0, 1440);
    await setEventSweepMin(msg.key, v);
    await syncAlarms();
    return v;
  },

  async setEventAuto(msg) {
    await me();
    const v = msg.minutes === null || msg.minutes === undefined || msg.minutes === '' ? null : SK.util.clampInt(msg.minutes, 0, 0, 1440);
    await setEventAutoMin(msg.key, v);
    await syncAlarms();
    return v;
  },

  async addRequest(msg) {
    const m = await me();
    const req = await addRequest(msg.req, m.meId);
    scanSoon(req.eventKey, [req.sec]);
    return req;
  },

  async updateRequest(msg) {
    await ownRequest(msg.id);
    const r = await updateRequest(msg.id, msg.changes || {});
    if (!r.done) scanSoon(r.eventKey, [r.sec]);
    return r;
  },

  async deleteRequest(msg) {
    await ownRequest(msg.id);
    await deleteRequest(msg.id);
    return true;
  },

  /* only your own: one that is not stops the whole delete before anything goes */
  async deleteRequests(msg) {
    const ids = [...new Set((msg.ids || []).map(String))];
    for (const id of ids) await ownRequest(id);
    return deleteRequests(ids);
  },

  async bumpSector(msg) {
    const m = await me();
    const r = await bumpSector(msg.eventKey, msg.sec, msg.delta, m.meId);
    if (r && !r.done) scanSoon(msg.eventKey, [String(msg.sec)]);
    return true;
  },

  /* a scan someone pressed always reads the site and counts as the event's auto-check */
  async scan(msg) {
    const m = await me();
    if (msg.eventKey) {
      const res = await scanEvent(msg.eventKey, msg.scope || 'tracked', { reuse: false });
      if (res.scanned) await restartAutoTimer(msg.eventKey);
      return res;
    }
    const res = await scanTrackedAll({ reuse: false }, m.meId);
    for (const key of res.keys) await restartAutoTimer(key);
    return res;
  },

  pageScan: msg => me().then(() => savePageScan(msg.site, String(msg.sectorId), msg.seats, { idSM: msg.idSM, price: msg.price, name: msg.name, tipoM: msg.tipoM })),
  saveListings: msg => me().then(m => saveListings(msg.items, m.meId)),
  setListingTrack: msg => me().then(m => setListingTrack(msg.id, msg.track, m.meId)),
  savePurchases: msg => me().then(m => savePurchases(msg.items, m.meId)),
  saveBuyAccount: msg => me().then(m => saveBuyAccount(msg.account, m.meId)),
  setListingBuy: msg => me().then(m => setListingBuy(msg.id, msg.price, msg.currency, m.meId)),
  resetListings: () => me().then(m => resetListings(m.meId)),
  sweepNow: msg => me().then(() => sweepSectors(msg.eventKey, { force: true })),
  previewScan: msg => me().then(() => previewScan(msg.url)),
  faceFor: msg => me().then(() => faceFor(msg)),
  setSectorPrice: msg => me().then(() => setSectorPrice(msg)),
  keepViagogoSector: msg => me().then(() => keepViagogoSector(msg)),
  cartHold: msg => noteCartHold(msg),
  sweepListings: msg => me().then(m => sweepListings(msg, m.meId)),
  putCompare: msg => putCompare(msg.compare),
  /* the drawer's saved scans of a viagogo event, kept in Supabase too (the newest two) */
  saveVgScan: msg => me().then(m => {
    if (!m.meId) throw new Error('Not signed in: saved on this PC only.');
    const ev = msg.eventKey ? m.events[msg.eventKey] : null;
    return Remote.saveVgScan(SK.market.scanToRow(msg.scan, { eventKey: ev ? ev.key : null, by: m.device.name || m.device.id }));
  }),
  /* null when signed out: "Supabase has none" would make the drawer drop its copies */
  vgScans: msg => me().then(m => (m.meId ? Remote.listVgScans(msg.vgEventId) : null)),
  deleteVgScan: msg => me().then(m => (m.meId ? Remote.deleteVgScan(msg.vgEventId, msg.at) : null)),
  resetVgScans: msg => me().then(m => {
    if (!m.meId) throw new Error('Not signed in: reset on this PC only.');
    return Remote.deleteVgScans(msg.vgEventId);
  }),
  saveSales: msg => me().then(m => saveSales(msg.items, m.meId)),
  setSalesBuy: msg => me().then(m => setSalesBuy(msg.ids, msg.price, msg.currency, m.meId)),
  /* a "just sold" toast read on a sell page: saved, and it counts as that event's turn of the scan */
  saveLastSale: msg => me().then(async m => {
    const r = await saveLastSale(msg.item, m.meId);
    const id = msg.item && msg.item.vgEventId;
    if (id) await LastSaleScan.seen(id, r && r.isNew ? 'sale' : 'same', 'page').catch(() => {});
    return r;
  }),
  /* ask viagogo for one event's last sale now, outside the schedule */
  lastSaleCheckNow: msg => me().then(() => LastSaleScan.checkNow(msg.vgEventId, msg)),
  /* the sell sessions viagogo keeps in the browser, handed over by any sell page */
  vgSellSessions: msg => LastSaleScan.learn(msg.sessions),
  /* the team's list of events for that scan: add, leave out, own interval */
  setLastSaleEvent: msg => me().then(async () => { const r = await LastSaleScan.setEvent(msg.vgEventId, msg.change || {}); await syncAlarms(); return r; }),
  lastSaleScanResume: () => LastSaleScan.resume(),
  lastSaleSlot: () => lastSaleSlot(),
  vgBlocked: msg => noteVgBlocked(Object.assign({ by: 'reload' }, msg.info || {})),
  vgUnblock: () => vgUnblock(),
  dropCompare: msg => dropCompare(msg.eventId),
  checkEvents: () => me().then(() => checkNewEvents()),

  saveSettings: msg => me().then(m => saveSettingsFor(m.meId, msg.changes || {})),
  snooze: msg => me().then(m => setSnooze(m.meId, SK.util.clampInt(msg.minutes, 60, 0, 7 * 24 * 60))),
  testPhone: () => me().then(() => Notify.testPhone()),
  testDesktop: () => Notify.testDesktop(),

  async runCommand(msg) {
    const m = await me();
    const answer = await Commands.run(msg.text || '', m.meId);
    if (msg.push) await Notify.reply(answer, m.meId);
    return answer;
  },

  export: () => me().then(m => Backup.exportAll(m.meId)),
  import: msg => me().then(m => Backup.importData(msg.data, m.meId)),
  importLegacy: () => me().then(m => Backup.importLegacy(m.meId)),

  openPage: msg => chrome.tabs.create({ url: chrome.runtime.getURL(msg.path || 'popup/popup.html?page=1') }).then(() => true)
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = HANDLERS[msg && msg.type];
  if (!h) { sendResponse({ ok: false, error: 'unknown message ' + (msg && msg.type) }); return false; }
  Promise.resolve()
    .then(() => h(msg, sender))
    .then(data => sendResponse({ ok: true, data }), err => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true;
});
