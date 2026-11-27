/* ------------------------------------------------------------------
 * Seat Tracker - this PC's local storage (service worker)
 *
 * The team's data lives in Supabase. Every PC keeps a copy ("mirror") in
 * chrome.storage.local so the popup, the sidebars and the phone commands
 * read it instantly; the service worker is the only writer and every local
 * write goes through one queue.
 *
 *   auth / authProblem   this PC's Supabase session
 *   device               { id, name } of this PC
 *   deviceSettings       theme, sidebar mode, on-site panels
 *   mirror               the team's events, requests, states, …
 *   scanCache            full scans this PC has fetched or taken
 *   lastAlertId          desktop notifications already shown on this PC
 *
 * Never call withLocal from inside a withLocal callback: it would wait for itself.
 * ------------------------------------------------------------------ */
'use strict';

const LOCAL_DEFAULTS = {
  auth: null,
  authProblem: null,
  device: null,
  deviceSettings: {},
  mirror: null,
  scanCache: {},
  lastAlertId: -1,
  meta: { lastError: '', lastSyncAt: 0, lastScanAt: 0 },
  throttle: {},
  pushLog: []          // [{ at, type, who, ok, reason }] — why the last phone pushes did or did not arrive

};

const EMPTY_MIRROR = {
  team: {},
  profiles: {},        // userId -> { displayName, settings, snoozeUntil }
  members: [],         // [{ userId, email }]
  events: {},          // key -> event
  requests: [],        // every member's requests
  state: {},           // requestId -> { status, options, free, pendingGone, alertLog, scanAt, version }
  scanMeta: {},        // eventKey -> sectorId -> { at, summary, by }
  health: {},          // eventKey -> { failing, firstFailAt, lastOkAt, lastError, failedBy }
  catalog: {},         // site -> siteId -> { title, date, venue, status, firstSeen, gone }
  catalogSites: {},    // site -> last checked
  leases: {},          // name -> { deviceId, userId, expiresAt }
  devices: [],         // [{ id, userId, name, lastSeen, version }]
  listings: {},        // listingId -> this person's viagogo listing (price, payout, tickets, …)
  sales: {},           // saleId -> this person's viagogo sale (payout, tickets, sale date, …)
  teamPrices: {},      // listingId -> { userId, eventKey, sectorId, price, currency, tickets, status } (no payout)
  fx: {},              // 'YYYY-MM-DD' -> { USD: lek per dollar, EUR, RSD, GBP }
  accounts: {},        // id -> this person's buying account { email, firstName, lastName, birthday, notes }
  purchases: {},       // id -> this person's purchase { accountId, eventKey, requestId, sectorId, qty, price, spentAll, orderRef, … }
  deposits: {},        // id -> this person's payout that reached the bank { receivedOn, currency, amount, amountAll, rate, bank }
  depositSales: [],    // [{ depositId, saleId }]: the sales each deposit paid
  sectorPrices: {},    // eventKey -> sectorId -> { amount, currency } — the team's price list, typed in the app
  lastSales: {},       // id -> a sale viagogo's "just sold" toast showed on a sell page (the team's)
  fingerprints: {}
};

function emptyMirror() { return structuredClone(EMPTY_MIRROR); }

async function readLocal(keys) {
  const list = keys || Object.keys(LOCAL_DEFAULTS);
  const got = await chrome.storage.local.get(list);
  const out = {};
  for (const k of list) {
    const dflt = LOCAL_DEFAULTS[k] === undefined ? null : LOCAL_DEFAULTS[k];
    out[k] = got[k] === undefined ? structuredClone(dflt) : got[k];
  }
  return out;
}

let writeChain = Promise.resolve();

/* fn(values) may return patch({ ...keys to write }, valueToReturn) */
function withLocal(fn, keys) {
  const run = writeChain.then(async () => {
    const values = await readLocal(keys);
    const result = await fn(values);
    if (result && result.__patch) await chrome.storage.local.set(result.__patch);
    return result && result.__patch ? result.__value : result;
  });
  writeChain = run.catch(() => {});
  return run;
}

function patch(obj, value) { return { __patch: obj, __value: value }; }

function mutateMirror(fn) {
  return withLocal(s => {
    const m = Object.assign(emptyMirror(), s.mirror || {});
    const value = fn(m);
    return patch({ mirror: m }, value);
  }, ['mirror']);
}

async function ensureDevice() {
  return withLocal(s => {
    if (s.device && s.device.id) return s.device;
    const device = { id: 'pc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name: '' };
    return patch({ device }, device);
  }, ['device']);
}

/* Everything the background logic reads, in one object. */
async function model() {
  const s = await readLocal(['auth', 'authProblem', 'device', 'deviceSettings', 'mirror', 'scanCache', 'meta', 'lastAlertId']);
  const m = Object.assign(emptyMirror(), s.mirror || {});
  const me = s.auth && s.auth.user ? s.auth.user : null;
  const cache = new Map();
  const settingsFor = uid => {
    if (!cache.has(uid)) {
      const profile = m.profiles[uid] || {};
      cache.set(uid, SK.settings.normalize(Object.assign({},
        SK.settings.userPart(profile.settings || {}),
        SK.settings.teamPart(m.team || {}),
        SK.settings.devicePart(s.deviceSettings || {}))));
    }
    return cache.get(uid);
  };
  return Object.assign(m, {
    me,
    meId: me ? me.id : null,
    authProblem: s.authProblem,
    device: s.device || { id: '', name: '' },
    deviceSettings: s.deviceSettings || {},
    scans: s.scanCache || {},
    meta: s.meta,
    lastAlertId: s.lastAlertId,
    settingsFor,
    settings: settingsFor(me ? me.id : '')
  });
}

async function setMeta(changes) {
  /* an error carries its time, so an old one can be left out of the status line */
  const stamp = 'lastError' in changes ? { lastErrorAt: changes.lastError ? Date.now() : 0 } : {};
  await withLocal(s => patch({ meta: Object.assign({}, s.meta, changes, stamp) }), ['meta']);
}

/* adapter caches (e.g. a seats.io layout) stay on this PC under their own keys */
const cacheKey = (eventKey, name) => `cache:${eventKey}:${name}`;

async function cacheGet(eventKey, name) {
  const k = cacheKey(eventKey, name);
  return (await chrome.storage.local.get(k))[k];
}

async function cacheSet(eventKey, name, value) {
  await chrome.storage.local.set({ [cacheKey(eventKey, name)]: value });
}
