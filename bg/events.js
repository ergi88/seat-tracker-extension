/* ------------------------------------------------------------------
 * Seat Tracker - events, requests and scanning (service worker)
 *
 * Events and scans are shared by the team; every request belongs to one
 * user. Any online PC may scan an event; the latest scan of each sector is
 * stored in Supabase and reused by the other PCs.
 * ------------------------------------------------------------------ */
'use strict';

function adapterCtx(eventKey) {
  return {
    net: Net,
    cacheGet: name => cacheGet(eventKey, name),
    cacheSet: (name, value) => cacheSet(eventKey, name, value)
  };
}

/* ================================================================== */
/* lookups shared by alerts, commands and the UI state                 */
/* ================================================================== */

function sectorOf(ev, secId) {
  return ((ev && ev.sectors) || []).find(s => String(s.id) === String(secId)) || null;
}

function eventUrlOf(ev) {
  const site = ev && SK.site(ev.site);
  return site ? site.eventUrl(ev) : '';
}

function eventTag(m, key) {
  const ev = m.events[key];
  return `[${ev ? ev.num : '?'}] ${(ev && ev.title) || key}`;
}

/* An event as alerts name it: its own name, as the app's Now and Events
 * pages show it — no [n], no date or venue. Commands keep eventTag, because
 * their numbers are what you type back. */
function eventName(m, key) {
  const ev = m.events[key];
  if (!ev) return key;
  return SK.util.eventInfo(ev).name || ev.title || key;
}

/* sector codes for a title: "E106", "E106, E107", "E106, E107, E108 +2" */
function sectorList(codes) {
  const all = [...new Set(codes.filter(Boolean))];
  return all.length > 3 ? `${all.slice(0, 3).join(', ')} +${all.length - 3}` : all.join(', ');
}

function currencyOf(ev) {
  const site = ev && SK.site(ev.site);
  return site && site.currency ? site.currency(ev) : '';
}

function codeOf(m, r) {
  const sec = sectorOf(m.events[r.eventKey], r.sec);
  return sec ? sec.code : String(r.sec);
}

function priceTagOf(m, r) {
  const ev = m.events[r.eventKey];
  const site = ev && SK.site(ev.site);
  return site && site.can.prices ? SK.rules.priceTag(r, ev.cats, currencyOf(ev)) : '';
}

/* How often every sector of this event is scanned, not just the ones with
 * requests. null on the event = the team default; 0 = off; a site that says
 * nothing about sweeping is never swept unless the event asks for it. */
function sweepMinutesOf(ev, team) {
  const site = ev && SK.site(ev.site);
  const own = ev && ev.extra && ev.extra.sweepMin;
  if (own !== undefined && own !== null) return Number(own) > 0 ? Math.max(1, Number(own)) : 0;
  if (!site || !site.can.sweep) return 0;
  const dflt = team && team.sweepMin !== undefined && team.sweepMin !== null ? Number(team.sweepMin) : 30;
  return dflt > 0 ? Math.max(1, dflt) : 0;
}

/* null = the team default, 0 = off */
function autoMinutesOf(ev, team) {
  const dflt = team && team.autoMin !== undefined && team.autoMin !== null ? Number(team.autoMin) : 5;
  const mins = ev && ev.autoMin !== null && ev.autoMin !== undefined ? Number(ev.autoMin) : dflt;
  return mins > 0 ? Math.max(1, mins) : 0;
}

/* How a request stands: the shared state written by the last evaluation,
 * unless this PC holds a newer scan of that sector. BOUGHT stands over it
 * when you have the tickets; the scan's own status is never changed. */
function evalOf(m, r) {
  const e = scanEvalOf(m, r);
  return Object.assign(e, { status: SK.rules.shownStatus(r, e.status) });
}

function scanEvalOf(m, r) {
  const scan = (m.scans[r.eventKey] || {})[r.sec];
  const st = m.state[r.id];
  if (scan && (!st || scan.at > (st.scanAt || 0))) {
    const e = SK.rules.evaluate(r, scan);
    return { status: e.status, options: e.options, free: e.view ? e.view.available : null, note: scan.unmapped ? scan.note : '' };
  }
  if (st) return { status: st.status, options: st.options, free: st.free, note: '' };
  const meta = (m.scanMeta[r.eventKey] || {})[r.sec];
  const note = meta && meta.summary && meta.summary.unmapped ? meta.summary.note || 'no seat map' : '';
  return { status: SK.rules.STATUS.NONE, options: 0, free: null, note };
}

/* 🟢 #2 A1 65€ ×4 OK — 12 options */
function lineFor(m, r) {
  return SK.rules.line(r, r.num, evalOf(m, r), codeOf(m, r), priceTagOf(m, r));
}

/* 🔴 E106 65€ ×4 SHORT — 0 options · Ana K. — a request in an alert: no
 * number, and who it is for, which is what tells two in one sector apart */
function alertLine(m, r, e) {
  return SK.rules.line(r, null, e || evalOf(m, r), codeOf(m, r), priceTagOf(m, r)) + (r.client ? ` · ${r.client}` : '');
}

/* A request you have bought ("I already have these tickets") is still yours
 * and still shown — it just stops driving anything: no scans, no alerts, no
 * badge, no phone list. The same goes for one whose viagogo listing an older
 * build switched off. Only your own listings are readable here, so a
 * teammate's request is never muffled by a listing this PC cannot see. */
function muffled(m, r) {
  if (r.bought) return true;
  const l = r.listing ? m.listings[r.listing] : null;
  /* Only a switch you threw yourself silences a request. "Gone" is a guess a
   * sweep made from something it did not see, so it labels the listing and
   * asks — it never quietly stops the alerts, because a wrong guess would
   * cost exactly the alert you were waiting for. */
  return !!l && l.userId === r.userId && l.track === 'off';
}

function openRequests(m, eventKey, userId) {
  return m.requests.filter(r => !r.done && (!eventKey || r.eventKey === eventKey) && (!userId || r.userId === userId) && !muffled(m, r));
}

function byEventNumber(m) {
  return (a, b) => ((m.events[a] || {}).num || 1e9) - ((m.events[b] || {}).num || 1e9);
}

function normalizeCats(v) {
  return Array.isArray(v) ? v.map(String).filter(x => x && x !== 'null') : [];
}

/* ================================================================== */
/* events                                                              */
/* ================================================================== */

const loadedAt = new Map();         // eventKey -> when this PC last loaded its sector list

/* The title split into name, day, time and venue (SK.util.splitEventTitle),
 * kept in extra.info so every PC and the app show the same thing. The title
 * itself stays as the site wrote it: viagogo matching and commands read it. */
function withInfo(extra, title, date, venue) {
  const was = (extra && extra.info) || {};
  return Object.assign({}, extra, { info: SK.util.splitEventTitle(title, { date, venue: venue || was.venue }) });
}

/* The sector list to store when a load (or the page itself) brings `fresh`.
 * A site that drops sold-out sectors (eBileta) keeps them through
 * site.keepSectors; one newly dropped takes its last scanned price along, so
 * its price group is still known when nothing can scan it any more. */
function mergeSectors(m, ev, fresh) {
  const site = SK.site(ev.site);
  if (!site || !site.keepSectors) return fresh;
  const metas = m.scanMeta[ev.key] || {};
  const kept = site.keepSectors(ev.sectors || [], fresh, Date.now()).map(s => {
    if (!s.meta || !s.meta.gone || s.meta.price) return s;
    const sum = (metas[String(s.id)] || {}).summary;
    return sum && sum.price ? Object.assign({}, s, { meta: Object.assign({}, s.meta, { price: sum.price }) }) : s;
  });
  const out = kept.concat(lostSectors(m, ev, kept));
  adoptGuessed(m, ev, out);
  return out;
}

/* A sector saved from the viagogo drawer under a stand-in id (no event in
 * the stadium knew its real one) is replaced by keepSectors once the page
 * lists it again. Its typed price and the requests in it move to the real
 * id. Runs on its own: the sector list is written by the caller. */
function adoptGuessed(m, ev, sectors) {
  const E = SK.ebileta;
  const N = SK.util.normKey;
  const now = new Set(sectors.map(s => String(s.id)));
  for (const old of (ev.sectors || []).filter(s => E.isGuessed(s) && !now.has(String(s.id)))) {
    const real = sectors.find(s => !E.isGuessed(s) && N(s.code) === N(old.code));
    if (!real) continue;
    const from = String(old.id), to = String(real.id);
    const prices = (m.sectorPrices || {})[ev.key] || {};
    (async () => {
      const typed = prices[from];
      if (typed && typed.amount > 0 && !prices[to]) {
        await Remote.saveSectorPrice({ event_key: ev.key, sector_id: to, amount: typed.amount, currency: typed.currency || 'ALL' });
      }
      if (typed) await Remote.deleteSectorPrice(ev.key, from);
      for (const r of m.requests.filter(x => x.eventKey === ev.key && String(x.sec) === from)) await Remote.patchRequest(r.id, { sec: to });
    })().catch(e => console.warn('[Seat Tracker] moving', old.code, 'to its real sector:', e.message));
  }
}

/* Sectors dropped before the event kept them: only a request or a listing
 * still names them, by id. eBileta keeps a stadium's sector ids from one event
 * to the next, so another tracked event there knows the name and the outline
 * on the map; the sector comes back as a removed one. */
function lostSectors(m, ev, sectors) {
  const have = new Set(sectors.map(s => String(s.id)));
  const named = [
    ...m.requests.filter(r => r.eventKey === ev.key).map(r => String(r.sec)),
    ...Object.values(m.listings || {}).filter(l => l.eventKey === ev.key && l.sectorId).map(l => String(l.sectorId))
  ];
  const idSM = SK.ebileta.idSMOf(ev);
  const out = [];
  for (const id of new Set(named)) {
    if (have.has(id)) continue;
    let twin = null;
    for (const other of Object.values(m.events)) {
      if (other.site !== ev.site || other.key === ev.key) continue;
      twin = (other.sectors || []).find(s => String(s.id) === id) || null;
      if (twin) break;
    }
    if (!twin) continue;
    const meta = { idSM, tipoM: (twin.meta && twin.meta.tipoM) || '1', status: 'soldout', gone: Date.now() };
    if (twin.meta && twin.meta.shape) meta.shape = twin.meta.shape;
    out.push({ id, code: twin.code, name: twin.name, meta });
  }
  return out;
}

const isGoneSector = (ev, sec) => {
  const site = ev && SK.site(ev.site);
  return !!(site && site.isGone && site.isGone(sec));
};

/* Create the event for the team (it gets the next [n]) or fill in details.
 * hint: { title, titleWins, date, venue, extra, sectors } */
async function registerEvent(siteId, id, hint) {
  if (!SK.site(siteId)) throw new Error('unknown site ' + siteId);
  const key = SK.eventKey(siteId, id);
  hint = hint || {};
  const m = await model();
  const me = m.meId;
  let ev = m.events[key];

  if (!ev) {
    ev = await Remote.insertEvent({
      key, site: siteId, site_id: String(id), title: hint.title || '', date: hint.date || '',
      sectors: hint.sectors || [], extra: withInfo(hint.extra || {}, hint.title, hint.date, hint.venue), cats: {}, created_by: me
    });
    if (hint.sectors && hint.sectors.length) loadedAt.set(key, Date.now());
    return ev;
  }

  const changes = {};
  if (hint.title && (!ev.title || hint.titleWins) && hint.title !== ev.title) changes.title = hint.title;
  if (hint.date && !ev.date) changes.date = hint.date;
  const extra = withInfo(Object.assign({}, ev.extra, hint.extra), changes.title || ev.title, changes.date || ev.date, hint.venue);
  if (JSON.stringify(extra) !== JSON.stringify(ev.extra)) changes.extra = extra;
  if (hint.sectors && hint.sectors.length) {
    loadedAt.set(key, Date.now());
    const sectors = mergeSectors(m, ev, hint.sectors);
    if (JSON.stringify(sectors) !== JSON.stringify(ev.sectors)) changes.sectors = sectors;
  }
  return Object.keys(changes).length ? Remote.patchEvent(key, changes) : ev;
}

async function registerFromUrl(url, hint) {
  url = await resolveEventUrl(url);
  const hit = SK.eventForUrl(url);
  if (!hit) throw new Error(`That link is not an event page on ${SK.siteList().map(x => x.label).join(', ')}.`);
  const site = SK.site(hit.site);
  const extra = Object.assign({}, site.extraFromUrl ? site.extraFromUrl(url) : {}, hint && hint.extra);
  return registerEvent(hit.site, hit.siteId, Object.assign({}, hint, { extra }));
}

/* eBileta Kosovo's event page (listaEventiPub.do) names no event: read the
 * page once to find the idSM of its sectors. (Not eventUrlOf — that one turns
 * an event into its address, and two functions of one name in the worker's
 * one scope silently replace each other.) */
async function resolveEventUrl(url) {
  if (SK.eventForUrl(url)) return url;
  let host = null;
  try { host = SK.ebileta.hostOf(new URL(url).hostname); } catch (e) { return url; }
  if (!host || !host.byIdSM) return url;
  const { sections } = SK.ebileta.parseSections(await Net.text(url, { credentials: 'include' }));
  return SK.ebileta.eventPageUrl(host, url, sections) || url;
}

const loadingEvents = new Map();

/* Load the sector list through the adapter when this PC has not done so
 * recently. Only real changes are written back to Supabase. */
async function ensureEvent(key, opts) {
  const m = await model();
  const ev = m.events[key];
  if (!ev) throw new Error('unknown event ' + key);
  const site = SK.site(ev.site);
  if (!site) throw new Error('unknown site ' + ev.site);
  const fresh = ev.sectors && ev.sectors.length && Date.now() - (loadedAt.get(key) || 0) < site.sectorMaxAgeMs;
  if (fresh && !(opts && opts.force)) return ev;
  if (loadingEvents.has(key)) return loadingEvents.get(key);

  const run = (async () => {
    let got;
    try {
      got = await site.loadEvent(ev, adapterCtx(key));
    } catch (e) {
      if (ev.sectors && ev.sectors.length) return ev;
      throw e;
    }
    loadedAt.set(key, Date.now());
    const changes = {};
    if (got.title && got.title !== ev.title) changes.title = got.title;
    if (got.date && got.date !== ev.date) changes.date = got.date;
    if (got.sectors && got.sectors.length) {
      const sectors = mergeSectors(m, ev, got.sectors);
      if (JSON.stringify(sectors) !== JSON.stringify(ev.sectors)) changes.sectors = sectors;
    }
    const extra = withInfo(Object.assign({}, ev.extra, got.extra), changes.title || ev.title, changes.date || ev.date);
    if (JSON.stringify(extra) !== JSON.stringify(ev.extra)) changes.extra = extra;
    if (got.cats && Object.keys(got.cats).length && JSON.stringify(got.cats) !== JSON.stringify(ev.cats)) changes.cats = got.cats;
    return Object.keys(changes).length ? Remote.patchEvent(key, changes) : ev;
  })().finally(() => loadingEvents.delete(key));

  loadingEvents.set(key, run);
  return run;
}

/* archiving hides an event for one user only */
async function setArchived(userId, key, archived) {
  const m = await model();
  const list = new Set(m.settingsFor(userId).archivedEvents);
  if (archived) list.add(key); else list.delete(key);
  await saveSettingsFor(userId, { archivedEvents: [...list] });
  return true;
}

/* null = follow the team default, 0 = off for this event, N = every N minutes */
async function setEventAutoMin(key, minutes) {
  await Remote.patchEvent(key, { auto_min: minutes });
  return minutes;
}

/* How often this one event has every sector read, whatever the team default
 * says. A popular match where the whole stadium goes on sale at once needs no
 * sweeping; one released a floor at a time wants it often. null = the default.
 * It lives in the event's `extra`, so it is shared and needs no new column. */
async function setEventSweepMin(key, minutes) {
  const m = await model();
  const ev = m.events[key];
  if (!ev) throw new Error('unknown event');
  const extra = Object.assign({}, ev.extra || {});
  if (minutes === null) delete extra.sweepMin; else extra.sweepMin = minutes;
  await Remote.patchEvent(key, { extra });
  return minutes;
}

/* Delete an event nobody has open requests in. Done requests, scans and
 * health go with it; tracking it again later brings back the same [n]. */
async function forgetEvent(key) {
  const m = await model();
  if (!m.events[key]) throw new Error('unknown event');
  const open = openRequests(m, key);
  if (open.length) {
    const names = [...new Set(open.map(r => (m.profiles[r.userId] || {}).displayName || 'someone'))];
    throw new Error(`This event still has ${SK.util.plural(open.length, 'open request')} (${names.join(', ')}). They must be done or deleted first.`);
  }
  const removed = m.requests.filter(r => r.eventKey === key).length;
  await Remote.deleteEvent(key);
  const all = await chrome.storage.local.get(null);
  const caches = Object.keys(all).filter(k => k.startsWith(`cache:${key}:`));
  if (caches.length) await chrome.storage.local.remove(caches);
  loadedAt.delete(key);
  return { removedRequests: removed };
}

/* Remember which tracked event and sector a viagogo listing turned out to be,
 * so that event's next listing fills itself in. It is kept on the event, so
 * the whole team shares it. extra is written whole: take the newest first. */
async function learnViagogo({ eventKey, key, section, sectorId }) {
  try { await Remote.pull(); } catch (e) { /* use what this PC has */ }
  const m = await model();
  const ev = m.events[eventKey];
  if (!ev) throw new Error('That event no longer exists.');
  const was = (ev.extra && ev.extra.viagogo) || {};
  const events = Array.isArray(was.events) ? was.events.slice() : [];
  const sectors = Object.assign({}, was.sectors);
  const name = String(key || '').slice(0, 160);
  if (name && !events.includes(name)) events.push(name);
  const secKey = SK.viagogo.sectionKey(section);
  if (secKey && sectorId && (ev.sectors || []).some(s => String(s.id) === String(sectorId))) sectors[secKey] = String(sectorId);
  const next = { events: events.slice(-30), sectors };
  if (JSON.stringify(next) === JSON.stringify({ events: was.events || [], sectors: was.sectors || {} })) return { changed: false };
  await Remote.patchEvent(eventKey, { extra: Object.assign({}, ev.extra, { viagogo: next }) });
  return { changed: true };
}

/* ================================================================== */
/* requests                                                            */
/* ================================================================== */

const REQUEST_FIELDS = ['sec', 'qty', 'cats', 'client', 'listing', 'warn', 'opts', 'together', 'done', 'bought', 'buyPrice', 'buyCurrency'];
/* bought too: switching it either way starts the alerts afresh, so no old reminder carries over */
const CRITERIA = ['sec', 'qty', 'cats', 'warn', 'opts', 'together', 'done', 'bought'];

async function addRequest(fields, userId) {
  if (!userId) throw new Error('Sign in first.');
  let ev;
  try { ev = await ensureEvent(fields.eventKey); }
  catch (e) { ev = (await model()).events[fields.eventKey]; if (!ev) throw e; }

  const hit = SK.resolveSector(ev.site, fields.sec, ev.sectors);
  if (hit.error) throw new Error(hit.error);
  const cfg = (await model()).settingsFor(userId);
  const U = SK.util;
  const req = await Remote.insertRequest({
    id: U.newId('r'),
    user_id: userId,
    event_key: ev.key,
    sec: String(hit.sector.id),
    qty: U.clampInt(fields.qty, 1, 1, 9999),
    cats: normalizeCats(fields.cats),
    client: String(fields.client || '').trim(),
    listing: U.listingId(fields.listing),
    warn: U.clampInt(fields.warn, cfg.defaultWarn, 0, 9999),
    opts: U.clampInt(fields.opts, cfg.defaultOpts, 0, 9999),
    together: fields.together === undefined || fields.together === null ? cfg.together : !!fields.together,
    done: false
  });
  if (cfg.archivedEvents.includes(ev.key)) await setArchived(userId, ev.key, false);
  return req;
}

/* A change to what the request needs resets its alert baseline: the next
 * evaluation only records the new state, so your own edit never alerts. */
async function updateRequest(id, changes) {
  const m = await model();
  const r = m.requests.find(x => x.id === id);
  if (!r) throw new Error('request not found');
  const U = SK.util;
  const clean = {};
  for (const k of REQUEST_FIELDS) {
    if (changes[k] === undefined) continue;
    const v = changes[k];
    if (k === 'sec') {
      const ev = m.events[r.eventKey];
      const hit = SK.resolveSector(ev.site, v, ev.sectors);
      if (hit.error) throw new Error(hit.error);
      clean.sec = String(hit.sector.id);
    } else if (k === 'qty') clean.qty = U.clampInt(v, r.qty, 1, 9999);
    else if (k === 'warn' || k === 'opts') clean[k] = U.clampInt(v, r[k], 0, 9999);
    else if (k === 'cats') clean.cats = normalizeCats(v);
    else if (k === 'client') clean.client = String(v || '').trim();
    else if (k === 'listing') clean.listing = U.listingId(v);
    else if (k === 'buyPrice') clean.buy_price = v === null || v === '' || !(Number(v) > 0) ? null : Math.round(Number(v) * 100) / 100;
    else if (k === 'buyCurrency') clean.buy_currency = SK.profit.CURRENCIES.includes(v) ? v : 'ALL';
    else clean[k] = !!v;
  }
  if (!Object.keys(clean).length) return r;
  const rebase = CRITERIA.some(k => k in clean && JSON.stringify(clean[k]) !== JSON.stringify(r[k]));
  const updated = await Remote.patchRequest(id, clean);
  if (rebase) await Remote.resetState(id);
  return updated;
}

function deleteRequest(id) {
  return Remote.deleteRequest(id);                     // the number is retired
}

function deleteRequests(ids) {
  return Remote.deleteRequests(ids);                   // every number retired, like one at a time
}

/* the − / + on an eBileta sector badge */
async function bumpSector(eventKey, sec, delta, userId) {
  const m = await model();
  const mine = m.requests.filter(r => r.eventKey === eventKey && String(r.sec) === String(sec) && !r.done && r.userId === userId);
  if (!mine.length) return delta > 0 ? addRequest({ eventKey, sec, qty: delta }, userId) : null;
  /* an open request before a bought one: bought tickets change by hand */
  const open = mine.filter(x => !x.bought);
  const r = (open.length ? open : mine)[(open.length ? open : mine).length - 1];
  const qty = Number(r.qty) + delta;
  if (qty <= 0) { await deleteRequest(r.id); return null; }
  return updateRequest(r.id, { qty });
}

/* ================================================================== */
/* scanning                                                            */
/* ================================================================== */

const scanChains = new Map();

/* scope: 'tracked' | 'all' | [sectorIds]
 * opts.reuse: use the event's latest scan (by any PC) when it is newer than
 * the event's auto-check interval (1 minute when auto-check is off). */
/* What a sector's summary keeps besides its counts: the section's price
 * (eBileta's "Rates from … to …", kept from the last scan that showed it) and,
 * where prices vary by seat (Posttick), which price categories still have
 * free seats. */
function summaryOf(v, r, site, before) {
  const s = { available: v.available, total: v.total, longest: v.longest };
  const p = r && r.price;
  if (p && Number(p.max) > 0 && SK.profit.CURRENCIES.includes(p.currency)) {
    s.price = { min: Number(p.min) || Number(p.max), max: Number(p.max), currency: p.currency };
  } else if (before && before.summary && before.summary.price) {
    s.price = before.summary.price;
  }
  if (site && site.can.prices && r && Array.isArray(r.seats)) {
    const cats = [...new Set(r.seats.filter(x => x.free && x.cat !== undefined && x.cat !== null).map(x => String(x.cat)))];
    if (cats.length) s.cats = cats.slice(0, 20);
  }
  return s;
}

function scanEvent(key, scope, opts) {
  const prev = scanChains.get(key) || Promise.resolve();
  const run = prev.then(() => doScanEvent(key, scope, opts || {}));
  scanChains.set(key, run.catch(() => {}));
  return run;
}

/* Seats held in a cart read as taken, so a PC holding some would write a scan
 * that is wrong for the whole team. It stands aside instead and lets another
 * PC take the lease. The hold is remembered for half an hour at most, so a tab
 * closed without emptying the cart never freezes an event for good. */
const CART_HOLD_MS = 30 * 60000;

async function noteCartHold(msg) {
  const key = msg.idSM ? SK.eventKey(msg.site, msg.idSM) : '';
  await withLocal(store => {
    const holds = Object.assign({}, store.cartHolds || {});
    /* the cart belongs to the site's session, not to one sector */
    if (msg.held > 0) holds[msg.site] = { at: Date.now(), held: msg.held, eventKey: key, sectorId: String(msg.sectorId || '') };
    else delete holds[msg.site];
    return patch({ cartHolds: holds });
  }, ['cartHolds']);
  return { ok: true };
}

async function cartHoldFor(site) {
  const { cartHolds } = await readLocal(['cartHolds']);
  const h = (cartHolds || {})[site];
  return h && Date.now() - h.at < CART_HOLD_MS ? h : null;
}

async function doScanEvent(key, scope, opts) {
  let ev;
  try {
    ev = await ensureEvent(key);
  } catch (e) {
    await recordHealth(key, false, e.message);
    await loginWarning(SK.site((await model()).events[key] ? (await model()).events[key].site : ''), e.message);
    throw e;
  }
  const site = SK.site(ev.site);
  /* ensureEvent has just re-read the sector list, labels and all, so this is
   * the moment a stand going back on sale can be seen — for nothing */
  checkOpenSectors(key).catch(() => {});
  const hold = await cartHoldFor(ev.site);
  if (hold) {
    /* not an error, and not this event's fault: say so and let it be */
    const me0 = await model();
    await Remote.releaseLease('scan:' + key, me0.device.id).catch(() => {});
    return { scanned: 0, errors: [], ids: [], skipped: `${site.label}: ${SK.util.plural(hold.held, 'seat')} held in the cart on this PC, so its scans are paused here` };
  }
  /* know every user's requests before judging them: another PC may have just added one */
  try { await Remote.pull(); } catch (e) { /* carry on with what this PC has */ }
  const m = await model();

  let ids;
  if (Array.isArray(scope)) ids = scope.map(String);
  else if (scope === 'all') ids = ev.sectors.filter(x => !site.scanAllFilter || site.scanAllFilter(x)).map(x => String(x.id));
  /* a sector the site has dropped has nothing to read: its requests keep the
   * last scan, unless someone asks for that sector by name */
  else ids = [...new Set(openRequests(m, key).map(r => String(r.sec)))].filter(id => !isGoneSector(ev, sectorOf(ev, id)));
  ids = ids.filter(id => sectorOf(ev, id));
  if (!ids.length) return { scanned: 0, errors: [], ids };

  if (opts.reuse) {
    const every = autoMinutesOf(ev, m.team);
    const maxAge = (every || 1) * 60000;
    const metas = ids.map(id => (m.scanMeta[key] || {})[id]);
    if (metas.every(x => x && Date.now() - x.at < maxAge)) {
      const stale = ids.filter(id => {
        const have = (m.scans[key] || {})[id];
        return !have || have.at < m.scanMeta[key][id].at;
      });
      if (stale.length) await Remote.fetchScans(key, stale);
      await Alerts.afterScan(key, ids);
      const oldest = metas.reduce((a, b) => (a.at <= b.at ? a : b));
      return { scanned: 0, reused: ids.length, reusedAt: oldest.at, reusedBy: oldest.by, errors: [], ids };
    }
  }

  let res;
  try {
    res = await site.scan(ev, ids, adapterCtx(key));
  } catch (e) {
    await recordHealth(key, false, e.message);
    await loginWarning(site, e.message);
    throw e;
  }

  const before = m.scanMeta[key] || {};
  const fresh = [];
  const errors = (res.errors || []).slice();
  for (const id of ids) {
    const r = res.results && res.results[id];
    if (!r) continue;
    if (r.unmapped) {
      const was = before[id];
      if (was && was.summary && !was.summary.unmapped) {
        errors.push(`${(sectorOf(ev, id) || {}).code || id}: no seat data this time (logged out?) — kept the last scan`);
        continue;
      }
      const scan = SK.rules.unmappedScan(id, r.note);
      fresh.push({ sec: id, scan, summary: { unmapped: true, note: scan.note } });
    } else {
      const scan = SK.rules.packScan(id, r.seats, site.rowOrder);
      const v = SK.rules.blocksFor(scan, null);
      fresh.push({ sec: id, scan, summary: summaryOf(v, r, site, before[id]) });
    }
  }

  const by = m.device.name || m.device.id;
  if (fresh.length) await Remote.saveScans(key, fresh, by);

  const changes = {};
  if (res.cats && Object.keys(res.cats).length && JSON.stringify(res.cats) !== JSON.stringify(ev.cats)) changes.cats = res.cats;
  if (res.extra) {
    const extra = Object.assign({}, ev.extra, res.extra);
    if (JSON.stringify(extra) !== JSON.stringify(ev.extra)) changes.extra = extra;
  }
  if (Object.keys(changes).length) await Remote.patchEvent(key, changes);

  const ok = fresh.length > 0;
  await setMeta({ lastScanAt: Date.now(), lastError: errors.length ? `${eventTag(m, key)}: ${errors[0]}` : '' });
  await recordHealth(key, ok, ok ? '' : errors[0] || 'nothing could be scanned');
  if (errors.length) await loginWarning(site, errors.join(' '));
  if (ok) await Alerts.afterScan(key, fresh.map(x => x.sec));
  await updateBadge();
  return { scanned: fresh.length, errors, ids };
}

/* every event with open requests (of one user, or of the whole team) */
async function scanTrackedAll(opts, userId) {
  const m = await model();
  const keys = [...new Set(openRequests(m, null, userId).map(r => r.eventKey))]
    .filter(k => m.events[k])
    .sort(byEventNumber(m));
  let scanned = 0, reused = 0;
  const errors = [], scannedKeys = [];
  for (const key of keys) {
    try {
      const r = await scanEvent(key, 'tracked', opts);
      scanned += r.scanned;
      reused += r.reused || 0;
      if (r.scanned) scannedKeys.push(key);
      errors.push(...r.errors.map(e => `[${m.events[key].num}] ${e}`));
    } catch (e) {
      errors.push(`[${m.events[key].num}] ${e.message}`);
    }
  }
  return { scanned, reused, errors, events: keys.length, keys: scannedKeys };
}

/* Stop: the reminders for one request, or for one event's failing scans, end
 * for the person who pressed it. The request stays as it is — Stop is not
 * "done", it only ends the repeating. */
async function stopReminders(target) {
  const m = await model();
  const uid = target.userId || m.meId;
  if (!uid) throw new Error('Sign in first.');

  if (target.requestId || target.num) {
    const r = m.requests.find(x => x.userId === uid &&
      (target.requestId ? x.id === target.requestId : x.num === Number(target.num)));
    if (!r) throw new Error(`No request ${target.num || target.requestId} of yours.`);
    const prev = m.state[r.id];
    const nag = prev && prev.alertLog && prev.alertLog.nag;
    if (!nag || nag.stopped) return { ok: true, num: r.num, already: true };
    const alertLog = Object.assign({}, prev.alertLog, { nag: Object.assign({}, nag, { stopped: true }) });
    const won = await Remote.casState(r.id, prev.version, {
      status: prev.status, options: prev.options, free: prev.free, pending_gone: !!prev.pendingGone,
      alert_log: alertLog, scan_at: prev.scanAt ? new Date(prev.scanAt).toISOString() : null
    });
    if (!won) throw new Error('Someone changed that request just now — try again.');
    return { ok: true, num: r.num };
  }

  const key = target.eventKey;
  const h = key && m.health[key];
  if (!h) throw new Error('No failing scans to stop.');
  const stopped = [...new Set([...(h.stopped || []), uid])];
  await Remote.saveHealth(key, Object.assign({}, h, { stopped }));
  return { ok: true, eventKey: key };
}

/* "Scan failing" only when no PC has scanned the event for about one
 * interval; one PC failing while another succeeds never alerts. */
async function recordHealth(key, ok, error) {
  const m = await model();
  const ev = m.events[key];
  if (!ev) return;
  const h = Object.assign({ failing: false, firstFailAt: 0, lastOkAt: 0, lastError: '', failedBy: '', openSectors: [], openAt: 0, sweptAt: 0 }, m.health[key] || {});
  const every = (autoMinutesOf(ev, m.team) || 5) * 60000;
  let change = null;
  let next;
  if (ok) {
    if (!h.failing && !h.firstFailAt && h.lastOkAt && Date.now() - h.lastOkAt < every / 2) return;   // nothing new to record
    if (h.failing) change = { type: 'recovered', since: h.firstFailAt };
    next = { failing: false, firstFailAt: 0, lastOkAt: Date.now(), lastError: '', failedBy: '',
      openSectors: h.openSectors || [], openAt: h.openAt || 0, sweptAt: h.sweptAt || 0 };
  } else {
    const firstFail = h.firstFailAt || Date.now();
    const grace = Math.min(every, 10 * 60000);
    const alertNow = !h.failing && Date.now() - firstFail >= grace;
    next = { failing: h.failing || alertNow, firstFailAt: firstFail, lastOkAt: h.lastOkAt, lastError: String(error || ''), failedBy: m.device.name || m.device.id,
      nagAt: h.nagAt || 0, stopped: h.stopped || [],
      openSectors: h.openSectors || [], openAt: h.openAt || 0, sweptAt: h.sweptAt || 0 };
    if (alertNow) { change = { type: 'failing', error: String(error || ''), lastOkAt: h.lastOkAt, device: next.failedBy }; next.nagAt = Date.now(); next.stopped = []; }
    /* still failing and nobody stopped it: say so again every so often */
    else if (next.failing) {
      const every = (m.settings.repeatWarnMin || 0) * 60000;
      if (every && Date.now() - (next.nagAt || firstFail) >= every) {
        next.nagAt = Date.now();
        change = { type: 'failing', error: String(error || ''), lastOkAt: h.lastOkAt, device: next.failedBy, reminder: true, since: firstFail, skip: next.stopped };
      }
    }
  }
  try { await Remote.saveHealth(key, next); } catch (e) { return; }
  if (change) await Alerts.health(key, change);
}

/* this PC could not read a site that needs a login: tell whoever sits at it */
async function loginWarning(site, text) {
  if (!site || !SK.ebileta.isEbileta(site.id)) return;
  if (!/log(ged)? ?(in|out)|login|sign/i.test(String(text || ''))) return;
  await Notify.local(`${site.label}: this PC may be logged out`,
    `A scan on this PC got no seat data. Log in at ${site.origin.replace('https://', '')} so this PC can scan; another online PC keeps scanning meanwhile.`,
    'login:' + site.id, 60 * 60000);
}

/* ------------------------------------------------------------------ *
 * The price list, from the viagogo drawer                             *
 * ------------------------------------------------------------------ */

/* One sector's price on the team's price list (the app's Price list).
 * An empty amount takes it off, so the site's own price shows again. */
async function setSectorPrice({ eventKey, sectorId, amount, currency }) {
  const m = await model();
  const ev = m.events[eventKey];
  if (!ev) throw new Error('That event no longer exists.');
  const sid = String(sectorId);
  if (!(ev.sectors || []).some(s => String(s.id) === sid)) throw new Error('That sector is not on the event.');
  const n = Math.round(Number(amount) * 100) / 100;
  if (!(n > 0)) {
    await Remote.deleteSectorPrice(eventKey, sid);
    return null;
  }
  const cur = SK.profit.CURRENCIES.includes(currency) ? currency : 'ALL';
  await Remote.saveSectorPrice({ event_key: eventKey, sector_id: sid, amount: n, currency: cur, updated_by: m.meId });
  return { amount: n, currency: cur };
}

/* The same sector on another tracked event of the site: eBileta keeps a
 * stadium's sector ids from one event to the next. Only an answer that is
 * not in doubt — one id, from the same venue when there is a choice. */
function twinSector(m, ev, code) {
  const N = SK.util.normKey;
  const venue = N(SK.util.eventInfo(ev).venue || '');
  const found = [];
  for (const other of Object.values(m.events)) {
    if (other.site !== ev.site || other.key === ev.key) continue;
    const sec = (other.sectors || []).find(s => N(s.code) === N(code) && !SK.ebileta.isGuessed(s));
    if (sec) found.push({ sec, sameVenue: !!venue && N(SK.util.eventInfo(other).venue || '') === venue });
  }
  const one = list => (new Set(list.map(x => String(x.sec.id))).size === 1 ? list[0].sec : null);
  if (!found.length) return null;
  return one(found) || one(found.filter(x => x.sameVenue));
}

/* A viagogo section the tracked event has no sector for — eBileta took it
 * off the event page before Seat Tracker kept removed sectors. It goes back
 * on the event as a removed sector: with its real id when another event in
 * the stadium knows it, under a stand-in id otherwise. A price given goes on
 * the price list with it.
 * -> { sectorId, code, how: 'there' | 'twin' | 'guessed', price } */
async function keepViagogoSector({ eventKey, label, amount, currency }) {
  try { await Remote.pull(); } catch (e) { /* use what this PC has */ }
  const m = await model();
  const ev = m.events[eventKey];
  if (!ev) throw new Error('That event no longer exists.');
  const site = SK.site(ev.site);
  if (!site || !site.keepSectors) throw new Error(`${site ? site.label : ev.site} lists every sector on its page: there is no removed sector to save.`);
  const E = SK.ebileta;
  const N = SK.util.normKey;
  const code = E.stadiumCode(label);
  if (!N(code)) throw new Error('That section has no name.');
  let sec = (ev.sectors || []).find(s => N(s.code) === N(code)) || null;
  let how = 'there';
  if (!sec) {
    const twin = twinSector(m, ev, code);
    const same = twin && (ev.sectors || []).find(s => String(s.id) === String(twin.id));
    if (same) sec = same;
    else {
      const gone = Date.now();
      if (twin) {
        const meta = { idSM: E.idSMOf(ev), tipoM: (twin.meta && twin.meta.tipoM) || '1', status: 'soldout', gone, saved: 'viagogo' };
        if (twin.meta && twin.meta.shape) meta.shape = twin.meta.shape;
        sec = { id: String(twin.id), code: twin.code, name: twin.name, meta };
        how = 'twin';
      } else {
        sec = { id: E.guessedId(code), code, name: code, meta: { status: 'soldout', gone, saved: 'viagogo' } };
        how = 'guessed';
      }
      await Remote.patchEvent(eventKey, { sectors: (ev.sectors || []).concat(sec) });
    }
  }
  const price = Number(amount) > 0 ? await setSectorPrice({ eventKey, sectorId: sec.id, amount, currency }) : null;
  return { sectorId: String(sec.id), code: sec.code, how, price };
}

/* the eBileta seat page already holds the seats: store them as a scan */
async function savePageScan(siteId, sectorId, seats, match) {
  const site = SK.site(siteId);
  const m = await model();
  const idSM = match && match.idSM ? String(match.idSM) : '';
  const matches = Object.values(m.events).filter(ev => {
    if (ev.site !== siteId) return false;
    const sec = sectorOf(ev, sectorId);
    return sec && (!idSM || String((sec.meta || {}).idSM || '') === idSM);
  });
  let ev = matches.length === 1 ? matches[0] : null;
  if (!seats || !seats.length) return { eventKey: ev ? ev.key : null };
  /* A sector eBileta had already dropped from the event page before it was
   * kept, opened by its own address: the seating map says whose it is, so it
   * goes back on that event as a removed sector. */
  if (!ev && !matches.length && idSM && match.name && site.keepSectors) {
    const bySM = Object.values(m.events).filter(e => e.site === siteId && SK.ebileta.idSMOf(e) === idSM);
    if (bySM.length === 1) {
      const sec = { id: String(sectorId), code: SK.ebileta.shortCode(match.name), name: match.name, meta: { idSM, tipoM: String(match.tipoM || '1'), status: 'soldout', gone: Date.now() } };
      /* saved by hand from viagogo under a stand-in id: this is its real one */
      const N = SK.util.normKey;
      const sectors = (bySM[0].sectors || []).filter(s => !(SK.ebileta.isGuessed(s) && N(s.code) === N(sec.code))).concat(sec);
      adoptGuessed(m, bySM[0], sectors);
      ev = await Remote.patchEvent(bySM[0].key, { sectors });
    }
  }
  if (!ev) return { eventKey: null };

  const scan = SK.rules.packScan(sectorId, seats, site.rowOrder);
  const v = SK.rules.blocksFor(scan, null);
  const summary = summaryOf(v, { seats, price: match && match.price }, site, (m.scanMeta[ev.key] || {})[String(sectorId)]);
  await Remote.saveScans(ev.key, [{ sec: String(sectorId), scan, summary }], m.device.name || m.device.id);
  await Alerts.afterScan(ev.key, [String(sectorId)]);
  await updateBadge();
  return { eventKey: ev.key };
}

/* ================================================================== */
/* new events on sites that publish a list                             */
/* ================================================================== */

async function checkNewEvents(onlySite) {
  const found = [];
  for (const site of SK.siteList()) {
    if (!site.can.listEvents || (onlySite && site.id !== onlySite)) continue;
    let list;
    try { list = await site.listEvents({ net: Net }); } catch (e) { found.push({ site: site.id, error: e.message }); continue; }

    const m = await model();
    const baseline = !m.catalogSites[site.id];                  // the very first check only records
    const known = m.catalog[site.id] || {};
    const rowOf = e => ({ site: site.id, site_id: String(e.siteId), data: { title: e.title, date: e.date, venue: e.venue, status: e.status }, gone: false });

    /* insert-if-new: only the PC that really adds a row gets it back, so a new event alerts once */
    const inserted = await Remote.insertCatalog(list.map(rowOf));
    const insertedIds = new Set(inserted.map(r => r.site_id));
    const live = new Set(list.map(e => String(e.siteId)));
    const updates = [];
    for (const e of list) {
      const id = String(e.siteId);
      const k = known[id];
      if (insertedIds.has(id) || !k) continue;
      if (k.gone || k.title !== e.title || k.date !== e.date || k.venue !== e.venue || k.status !== e.status) updates.push(rowOf(e));
    }
    for (const [id, k] of Object.entries(known)) {
      if (!live.has(id) && !k.gone) updates.push({ site: site.id, site_id: id, data: { title: k.title, date: k.date, venue: k.venue, status: k.status }, gone: true });
    }
    await Remote.upsertCatalog(updates);
    await Remote.markCatalogSite(site.id);

    const added = baseline ? [] : inserted.map(r => Object.assign({ siteId: r.site_id }, r.data || {}));
    found.push({ site: site.id, added, total: list.length });
    if (added.length) await Alerts.newEvents(site, added);
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * Looking at a stadium before tracking it                             *
 *                                                                     *
 * Reads every sector of an event nobody has tracked, so the map can   *
 * show what is actually free before you commit to following it. The   *
 * result stays on this PC: the shared scans table is keyed to an       *
 * event, and there is no event — nothing is added to the team's data   *
 * by looking at a page, which is the rule everywhere else too.         *
 * ------------------------------------------------------------------ */

const PREVIEW_MAX_AGE = 60 * 60000;

async function readPreviews() {
  const { previews } = await readLocal(['previews']);
  const out = {};
  for (const [k, v] of Object.entries(previews || {})) {
    if (v && Date.now() - v.at < PREVIEW_MAX_AGE) out[k] = v;
  }
  return out;
}

async function previewScan(url) {
  const at = await resolveEventUrl(String(url || '').trim());
  const hit = SK.eventForUrl(at);
  if (!hit) throw new Error(`That link is not an event page on ${SK.siteList().map(x => x.label).join(', ')}.`);
  const m = await model();
  if (m.events[hit.key]) throw new Error('That event is tracked — use Scan all sectors instead.');

  const site = SK.site(hit.site);
  const ev = {
    key: hit.key, site: hit.site, siteId: hit.siteId, title: '', sectors: [], cats: {},
    extra: site.extraFromUrl ? site.extraFromUrl(at) : {}
  };
  const loaded = await site.loadEvent(ev, adapterCtx(hit.key));
  ev.sectors = loaded.sectors || [];
  ev.title = loaded.title || '';
  /* what loading found out (Posttick's chart keys, its price categories) is
   * what the scan needs, exactly as on a tracked event */
  if (loaded.extra) ev.extra = Object.assign({}, ev.extra, loaded.extra);
  if (loaded.cats) ev.cats = loaded.cats;

  /* the same sectors a Scan all would read: what the site calls sold out is
   * left alone, because it has already said there is nothing there */
  const ids = ev.sectors.filter(x => !site.scanAllFilter || site.scanAllFilter(x)).map(x => String(x.id));
  const res = await site.scan(ev, ids, adapterCtx(hit.key));
  const { results, errors } = res;
  if (res.cats && Object.keys(res.cats).length) ev.cats = res.cats;

  const sectors = {};
  const packed = {};
  for (const sec of ev.sectors) {
    const id = String(sec.id);
    const r = results[id];
    /* what the drawer lists next to the seats, and where a badge goes */
    const meta = sec.meta || {};
    const info = { code: sec.code };
    if (meta.price != null) info.price = meta.price;
    if (meta.svgId) info.svgId = meta.svgId;
    if (meta.perTable) info.perTable = meta.perTable;
    if (!r) { sectors[id] = { ...info, skipped: true }; continue; }
    if (r.unmapped) { sectors[id] = { ...info, unmapped: true, note: r.note || '' }; packed[id] = { unmapped: true }; continue; }
    packed[id] = SK.rules.packScan(id, r.seats, site.rowOrder);
    const view = SK.rules.blocksFor(packed[id], []);
    /* the same shape a scan's summary has, when included, so everything that
     * reads one can read this without knowing which it got */
    sectors[id] = { ...info, total: view.total, available: view.available, longest: view.longest, at: Date.now() };
  }

  const now = Date.now();
  /* the face values to hand to a viagogo event: per sector, or per price
   * category inside a sector (Posttick) */
  const face = SK.face.build({ site: hit.site, siteId: hit.siteId, title: ev.title, url: at, currency: faceCurrency(ev), at: now }, ev.sectors, packed, ev.cats);
  const preview = { key: hit.key, site: hit.site, siteId: hit.siteId, title: ev.title, url: at, at: now, currency: faceCurrency(ev), sectors, errors, face };
  /* patch() only describes a write; withLocal is what performs it */
  await withLocal(store => {
    const previews = {};
    for (const [k, v] of Object.entries(store.previews || {})) {
      if (v && Date.now() - v.at < PREVIEW_MAX_AGE) previews[k] = v;
    }
    previews[hit.key] = preview;
    return patch({ previews });
  }, ['previews']);
  return preview;
}

/* the ISO code a site's prices are in: RSD on eFinity, € -> EUR on Posttick */
function faceCurrency(ev) {
  const site = ev && SK.site(ev.site);
  if (site && site.priceCurrency) return site.priceCurrency;
  return SK.profit.currencyOf(currencyOf(ev)) || 'EUR';
}

/* Face values of one event, to paste on a viagogo event: a tracked event
 * from the team's last scans, an untracked one from this PC's stadium read.
 * -> { face, code } */
async function faceFor(msg) {
  const m = await model();
  let face = null;
  const key = msg.eventKey || (msg.url ? (SK.eventForUrl(String(msg.url)) || {}).key : null);
  const ev = key && m.events[key];
  if (ev) {
    const site = SK.site(ev.site);
    const sectors = (ev.sectors || []).map(sec => {
      const meta = (m.scanMeta[ev.key] || {})[sec.id];
      return Object.assign({}, sec, { summary: meta ? meta.summary : null });
    });
    face = SK.face.build({
      site: ev.site, siteId: ev.siteId, title: ev.title, url: site && site.eventUrl ? site.eventUrl(ev) : '',
      currency: faceCurrency(ev), at: Math.max(0, ...Object.values(m.scanMeta[ev.key] || {}).map(x => x.at || 0)) || Date.now()
    }, sectors, m.scans[ev.key] || {}, ev.cats);
  } else if (key) {
    const pv = (await readPreviews())[key];
    if (pv) face = SK.face.fromPreview(pv);
  }
  if (!face) throw new Error(key ? 'Read the whole stadium first — nothing is known about this event yet.' : 'That is not an event page.');
  if (!face.sectors.length) throw new Error('No sector has a price yet — scan the event (Scan all) first.');
  return { face, code: SK.face.pack(face) };
}

/* ------------------------------------------------------------------ *
 * Sectors going on sale                                               *
 *                                                                     *
 * eBileta holds stands back and releases them as the date comes       *
 * closer. A scan only reads the sectors somebody has a request in, so  *
 * a stand nobody is watching can open without anyone noticing. Every   *
 * so often this reads every sector instead — including the ones the    *
 * site calls sold out, which is where a held-back stand hides — and    *
 * says so when one that had no free seat has some.                     *
 *                                                                      *
 * Only that one change is an alert. A sector nobody has scanned before  *
 * has no "was empty" to compare against, so the first sweep of an event *
 * only learns the ground truth and stays quiet.                         *
 * ------------------------------------------------------------------ */

/* Which sectors nobody is watching have something to sell, as far as anything
 * known says: the site's own availability label first, then the last scan.
 * -> array of sector ids */
function onSaleNow(m, key) {
  const ev = m.events[key];
  if (!ev) return [];
  const out = [];
  for (const sec of ev.sectors || []) {
    const id = String(sec.id);
    if ((sec.meta || {}).status === 'soldout') continue;            // the site says there is nothing
    const sum = ((m.scanMeta[key] || {})[id] || {}).summary;
    if (sum && !sum.unmapped && sum.available === 0) continue;      // read, and empty
    out.push(id);
  }
  return out;
}

/* A stand going back on sale, told from the event page's own labels — which
 * every scan already fetches, so this costs nothing and works for the sold-out
 * sectors a sweep never reads.
 *
 * The first look only learns: without something to compare against, every
 * sector on sale would look like news the moment an event is tracked. */
async function checkOpenSectors(key) {
  const m = await model();
  const ev = m.events[key];
  if (!ev) return { opened: [] };
  const health = m.health[key] || {};
  const now = onSaleNow(m, key);
  const known = new Set((health.openSectors || []).map(String));
  const same = now.length === known.size && now.every(id => known.has(id));
  if (same) return { opened: [] };

  const watched = new Set(openRequests(m, key).map(r => String(r.sec)));
  const opened = health.openAt
    ? now.filter(id => !known.has(id) && !watched.has(id)).map(id => {
      const sec = sectorOf(ev, id);
      const sum = ((m.scanMeta[key] || {})[id] || {}).summary;
      return { id, code: sec ? sec.code : id, name: sec ? sec.name : '', free: sum ? sum.available : null, longest: sum ? sum.longest : 0 };
    })
    : [];

  try {
    await Remote.saveHealth(key, Object.assign({}, health, { openSectors: now, openAt: Date.now() }));
  } catch (e) { return { opened: [] }; }
  if (opened.length) await Alerts.sectorsOpen(key, opened);
  return { opened };
}

async function sweepSectors(key, opts) {
  const before = await model();
  const ev = before.events[key];
  if (!ev) return { swept: 0 };
  if (!(opts && opts.force) && !sweepMinutesOf(ev, before.team)) return { swept: 0, off: true };

  /* what every sector looked like before this sweep, as the team last saw it */
  const was = new Map();
  for (const [id, meta] of Object.entries(before.scanMeta[key] || {})) {
    if (meta && meta.summary && !meta.summary.unmapped) was.set(String(id), Number(meta.summary.available) || 0);
  }

  /* "all" leaves out what the site itself calls sold out. On a big stadium
   * that is most of the map, and reading fifty shut sectors every half hour
   * would cost more than everything else the extension does — while the page
   * says they are shut, for nothing, on every load. A stand going back on
   * sale is caught by that label instead: see checkOpenSectors. */
  const res = await scanEvent(key, 'all', { reason: 'sweep' });

  const after = await model();
  /* a sector somebody is already waiting on alerts through its request */
  const watched = new Set(openRequests(after, key).map(r => String(r.sec)));
  const health = Object.assign({ openSectors: [], openAt: 0 }, after.health[key] || {});
  const known = new Set((health.openSectors || []).map(String));

  const opened = [];
  for (const [id, meta] of Object.entries(after.scanMeta[key] || {})) {
    const sum = meta && meta.summary;
    if (!sum || sum.unmapped) continue;
    const free = Number(sum.available) || 0;
    if (free <= 0) continue;
    if (watched.has(String(id))) continue;
    /* never seen before: learn it, do not shout about it */
    if (!was.has(String(id))) continue;
    if (was.get(String(id)) > 0) continue;
    if (known.has(String(id))) continue;
    const sec = sectorOf(ev, id);
    opened.push({ id: String(id), code: sec ? sec.code : String(id), name: sec ? sec.name : '', free, longest: sum.longest || 0 });
  }

  /* remembered so the same opening is not announced twice; a sector that fills
   * up and empties again may announce itself once more, which is right */
  try {
    await Remote.saveHealth(key, Object.assign({}, health, { openSectors: onSaleNow(after, key), openAt: Date.now(), sweptAt: Date.now() }));
  } catch (e) { /* the alert below matters more than the bookkeeping */ }

  if (opened.length) await Alerts.sectorsOpen(key, opened);
  return { swept: (res && res.scanned) || 0, opened, errors: (res && res.errors) || [] };
}

/* ================================================================== */
/* viagogo listings                                                    */
/* ================================================================== */

const LISTING_KEYS = ['status', 'currency', 'price', 'payout', 'tickets', 'performance', 'section', 'row', 'title', 'when', 'uploaded'];

/* a card as the listings page sent it, checked and trimmed */
function cleanListing(x) {
  const id = String((x && x.id) || '').replace(/\D/g, '');
  if (id.length < 5 || id.length > 20) return null;
  const str = (v, n) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const num = v => (v === null || v === undefined || v === '' || !(Number(v) >= 0) ? null : Math.round(Number(v) * 100) / 100);
  return {
    id,
    status: str(x.status, 30), title: str(x.title, 200), when: str(x.when, 60),
    section: str(x.section, 40), row: str(x.row, 20),
    /* an unknown currency is kept empty: no rate, so no profit is guessed */
    currency: /^[A-Z]{3}$/.test(String(x.currency || '')) ? String(x.currency) : '',
    price: num(x.price), payout: num(x.payout),
    tickets: x.tickets === null || x.tickets === undefined ? null : Math.max(0, Math.round(Number(x.tickets)) || 0),
    performance: str(x.performance, 60), venue: str(x.venue, 120),
    vgEventId: str(x.vgEventId, 20).replace(/\D/g, ''),
    uploaded: x.uploaded === true ? true : x.uploaded === false ? false : null
  };
}

/* a card whose price could not be read keeps the last one that was: a layout
 * viagogo changes must not wipe a known price, or report it as a change */
function keepKnownPrice(it, was) {
  if (it.price === null && was && was.price !== null && was.price !== undefined) {
    it.price = was.price;
    if (!it.currency) it.currency = was.currency || '';
  }
  return it;
}

/* A listing read from viagogo's JSON (partial) has no "Listing performance"
 * — the page works that out itself: keep what the card last showed rather
 * than blanking it. */
function keepCardOnly(it, was) {
  if (!was) return it;
  if (!it.performance && was.performance) it.performance = was.performance;
  return it;
}

/* Uploaded (viagogo's PreDelivered) comes only from the JSON: a card read
 * leaves it null, and null never wipes what the JSON said. */
function keepUploaded(it, was) {
  if (it.uploaded === null && was && (was.uploaded === true || was.uploaded === false)) it.uploaded = was.uploaded;
  return it;
}

/* which tracked event and sector a listing belongs to: its request, else the viagogo pairing */
function matchListing(m, it, userId) {
  const r = it.id ? m.requests.find(x => x.userId === userId && x.listing === it.id) : null;
  if (r) return { eventKey: r.eventKey, sectorId: String(r.sec) };
  const events = Object.values(m.events).map(ev => ({
    key: ev.key, site: ev.site, title: ev.title, date: ev.date, sectors: ev.sectors || [], viagogo: (ev.extra || {}).viagogo || null
  }));
  const pick = SK.viagogo.pickEvent({ title: it.title, when: it.when }, events);
  if (!pick) return { eventKey: null, sectorId: null };
  const ev = events.find(e => e.key === pick.key);
  const sec = SK.viagogo.sectorFor(ev, it.section);
  const hit = ['matched', 'remembered'].includes(sec.how) ? ev.sectors.find(s => s.code === sec.code) : null;
  return { eventKey: pick.key, sectorId: hit ? String(hit.id) : null };
}

/* The cards read on my.viagogo.com/listings. A listing is written when something
 * on it changed (a change also goes into its short history), or once every 30
 * minutes to say it was still there. Payouts stay with their owner; the team
 * sees the price per section through the team_prices view. */
async function saveListings(items, userId, opts) {
  const m = await model();
  const now = Date.now();
  const rows = [];
  const follow = [];       // requests whose quantity follows a listing that changed
  const partial = !!(opts && opts.partial);
  /* a page of cards is a few dozen; a full read from viagogo's JSON is every listing */
  for (const raw of (items || []).slice(0, partial ? 2000 : 200)) {
    const it = cleanListing(raw);
    if (!it) continue;
    const other = m.teamPrices[it.id];
    if (other && other.userId && other.userId !== userId) continue;    // a teammate's listing: theirs to save
    const was = m.listings[it.id];
    keepKnownPrice(it, was);
    if (partial) keepCardOnly(it, was);
    keepUploaded(it, was);
    const match = matchListing(m, it, userId);
    const same = k => String(was[k] === null || was[k] === undefined ? '' : was[k]) === String(it[k] === null || it[k] === undefined ? '' : it[k]);
    const changed = !was || LISTING_KEYS.some(k => !same(k)) || was.eventKey !== match.eventKey || String(was.sectorId) !== String(match.sectorId);
    if (!changed && now - was.seenAt < 30 * 60000) continue;
    const history = was && Array.isArray(was.history) ? was.history.slice() : [];
    if (!was || !same('price') || !same('tickets') || !same('status')) history.push({ at: now, price: it.price, tickets: it.tickets, status: it.status });
    /* The listing's ticket count changed on viagogo: its open request follows,
     * as the price does. Only a change does it — a request set by hand to
     * differ is left alone until the listing moves again. 0 left is not a
     * quantity to search for, so a listing that ran out changes nothing. */
    if (was && !same('tickets') && Number(it.tickets) >= 1) {
      const r = m.requests.find(x => x.userId === userId && x.listing === it.id && !x.done);
      if (r && Number(r.qty) !== Number(it.tickets)) follow.push({ id: r.id, num: r.num, listing: it.id, from: r.qty, to: Number(it.tickets), was: was.tickets });
    }
    rows.push({
      listing_id: it.id, user_id: userId, event_key: match.eventKey, sector_id: match.sectorId, vg_event_id: it.vgEventId,
      title: it.title, event_when: it.when, venue: it.venue, section: it.section, row_label: it.row, status: it.status,
      currency: it.currency, price: it.price, payout: it.payout, tickets: it.tickets, recommended: null,
      performance: it.performance, history: history.slice(-30), uploaded: it.uploaded,
      seen_at: new Date(now).toISOString(), seen_by: m.device.name || m.device.id
    });
  }
  const saved = rows.length ? await Remote.saveListings(rows) : 0;
  const followed = [];
  for (const f of follow) {
    try { await updateRequest(f.id, { qty: f.to }); followed.push(f); }
    catch (e) { console.warn('[seat-tracker] request #' + f.num + ' did not follow listing ' + f.listing + ':', e.message); }
  }
  return { read: (items || []).length, saved, followed };
}

/* ------------------------------------------------------------------ *
 * Sales, as read from My Sales                                        *
 *                                                                     *
 * The page hands over sales already reduced by SK.sales.saleFromApi;  *
 * they are cleaned again here, matched to the tracked event and       *
 * sector they came from (through their listing when there is one),    *
 * and written only when new or changed.                               *
 * ------------------------------------------------------------------ */

const SALE_KEYS = ['listingId', 'title', 'section', 'row', 'seats', 'tickets', 'currency', 'amount', 'status', 'soldOn'];

function cleanSale(x) {
  const s = SK.sales.saleFromApi({
    SaleId: x && x.id, ListingId: x && x.listingId, EventId: x && x.vgEventId, EventDescription: x && x.title,
    EventDate: x && x.when, Venue: x && x.venue, Section: x && x.section, Row: x && x.row, Seats: x && x.seats, Quantity: x && x.tickets,
    Currency: x && x.currency, TotalPayout: x && x.amount, Status: x && x.status, SaleDate: x && (x.soldAt || x.soldOn)
  });
  return s;
}

async function saveSales(items, userId) {
  const m = await model();
  const now = Date.now();
  const rows = [];
  for (const raw of (items || []).slice(0, 500)) {
    const it = cleanSale(raw);
    if (!it) continue;
    const was = m.sales[it.id];
    if (was && was.userId && was.userId !== userId) continue;
    /* the listing it was sold from knows its event and sector best */
    const l = it.listingId ? m.listings[it.listingId] : null;
    const match = l && l.eventKey ? { eventKey: l.eventKey, sectorId: l.sectorId }
      : matchListing(m, { id: it.listingId || '', title: it.title, when: it.when, section: it.section }, userId);
    const same = k => String(was[k] === null || was[k] === undefined ? '' : was[k]) === String(it[k] === null || it[k] === undefined ? '' : it[k]);
    if (was && SALE_KEYS.every(same) && was.eventKey === match.eventKey && String(was.sectorId) === String(match.sectorId)) continue;
    rows.push({
      sale_id: it.id, user_id: userId, event_key: match.eventKey, sector_id: match.sectorId, vg_event_id: it.vgEventId,
      listing_id: it.listingId, title: it.title, event_when: it.when, venue: it.venue, section: it.section, row_label: it.row,
      seats: it.seats, tickets: it.tickets, currency: it.currency, amount: it.amount, status: it.status, sold_on: it.soldOn || null,
      seen_at: new Date(now).toISOString(), seen_by: m.device.name || m.device.id
    });
  }
  const saved = rows.length ? await Remote.saveSales(rows) : 0;
  return { read: (items || []).length, saved };
}

/* what one ticket cost, typed on a section of sales that had no buy price */
async function setSalesBuy(ids, price, currency, userId) {
  const m = await model();
  const mine = (ids || []).map(String).filter(id => m.sales[id] && m.sales[id].userId === userId);
  if (!mine.length) throw new Error('Those sales are not saved yet: scan My Sales first.');
  const n = Number(price);
  const amount = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  const cur = SK.profit.CURRENCIES.includes(currency) ? currency : 'ALL';
  return Remote.patchSales(mine, { buy_price: amount, buy_currency: cur });
}

/* ------------------------------------------------------------------ *
 * viagogo's "just sold" toast, from a sell page                       *
 *                                                                     *
 * The toast has no time and no ID: the same section, tickets and      *
 * price as the newest sale saved for that event is that sale again,   *
 * and nothing is written; anything else is a new sale, saved with     *
 * the time it was first read. The team shares them.                   *
 * ------------------------------------------------------------------ */

/* listing_id came after vg_last_sales: a database not updated yet still takes the rest */
async function withoutListingId(row, write) {
  try {
    return await write(row);
  } catch (e) {
    if (!('listing_id' in row) || !/listing_id/i.test(String(e && e.message))) throw e;
    const rest = Object.assign({}, row);
    delete rest.listing_id;
    return write(rest);
  }
}

async function saveLastSale(item, userId) {
  const it = SK.lastSales.clean(item);
  if (!it) throw new Error('That toast did not show a section, tickets and a price.');
  const m = await model();
  const now = Date.now();
  const { latest, same } = SK.lastSales.compare(Object.values(m.lastSales || {}), it);
  const by = m.device.name || m.device.id;
  try {
    /* still the same sale: skipped, the saved one keeps its first time */
    if (same) return { sale: latest, isNew: false };
    const match = matchListing(m, { id: '', title: it.title, when: it.when, section: it.section }, userId);
    const row = {
      vg_key: it.vgKey, vg_event_id: it.vgEventId, event_key: match.eventKey, sector_id: match.sectorId,
      title: it.title, event_when: it.when, section: it.section, row_label: it.row,
      tickets: it.tickets, price: it.price, currency: it.currency,
      first_seen: new Date(now).toISOString(), last_seen: new Date(now).toISOString(), seen_count: 1, seen_by: by
    };
    if (it.listingId) row.listing_id = it.listingId;
    const sale = await withoutListingId(row, r => Remote.insertLastSale(r));
    return { sale, isNew: true };
  } catch (e) {
    if (/vg_last_sales|does not exist|schema cache|404/i.test(String(e && e.message))) {
      throw new Error('The database has no last-sales table yet: run supabase/schema.sql again in Supabase.');
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ *
 * Revalidating every listing                                          *
 *                                                                     *
 * The page walks its own pages and hands the cards over; the diff is   *
 * worked out here, where the previous state lives. `complete` says the *
 * sweep reached the last page with nothing skipped — only then may a   *
 * listing that was not seen be called gone, because a sweep that       *
 * stopped early has no idea what it never looked at.                   *
 * ------------------------------------------------------------------ */

const SWEEP_FIELDS = [
  { key: 'price', label: 'price' },
  { key: 'tickets', label: 'tickets' },
  { key: 'status', label: 'status' }
];

async function sweepListings(msg, userId) {
  const m = await model();
  const mine = Object.values(m.listings).filter(l => l.userId === userId);
  const before = new Map(mine.map(l => [l.id, l]));
  const items = (msg.items || []).map(cleanListing).filter(Boolean);
  const complete = !!msg.complete;
  const now = Date.now();

  const changes = [];
  const partial = !!msg.partial;
  for (const it of items) {
    const was = before.get(it.id);
    keepKnownPrice(it, was);
    if (partial) keepCardOnly(it, was);
    if (!was) { changes.push({ id: it.id, kind: 'new', section: it.section, title: it.title, tickets: it.tickets, price: it.price, currency: it.currency }); continue; }
    for (const f of SWEEP_FIELDS) {
      const a = was[f.key], b = it[f.key];
      if (String(a === null || a === undefined ? '' : a) === String(b === null || b === undefined ? '' : b)) continue;
      changes.push({ id: it.id, kind: f.key, from: a, to: b, currency: it.currency || was.currency, section: it.section || was.section });
    }
  }

  /* the write itself is the one that already exists, so history, matching and
   * "only when something changed" all behave exactly as on a normal read */
  const saved = await saveListings(items, userId, { partial });

  /* every listing this sweep looked at is fresh as of now, changed or not */
  const seenIds = items.map(it => it.id);
  if (seenIds.length) await Remote.patchListings(seenIds, { last_sweep_at: new Date(now).toISOString(), gone_at: null });

  /* Nothing is ever marked gone. A listing this read did not see may have been
   * removed, or may simply have been on a page nobody looked at — and those
   * are not the same thing. The unseen ones are reported and left alone. */
  const seen = new Set(seenIds);
  const unseen = mine.filter(l => !seen.has(l.id))
    .map(l => ({ id: l.id, section: l.section, title: l.title, vgEventId: l.vgEventId }));

  /* A listing whose ticket count changed has already taken its request along
   * (saveListings). What is left to offer is a request that differs without
   * the listing having moved — set by hand, or older than this rule. */
  const after = await model();
  const qtyOffers = [];
  for (const c of changes.filter(x => x.kind === 'tickets')) {
    const r = after.requests.find(x => x.userId === userId && x.listing === c.id && !x.done);
    const qty = Number(c.to);
    if (!r || !Number.isFinite(qty) || qty < 1 || qty === r.qty) continue;
    qtyOffers.push({ requestId: r.id, num: r.num, code: codeOf(after, r), from: r.qty, to: qty, id: c.id });
  }

  const sold = changes.filter(c => (c.kind === 'tickets' && Number(c.to) === 0) || (c.kind === 'status' && SK.viagogo.listingStatus(c.to) === 'sold'))
    .map(c => {
      const r = after.requests.find(x => x.userId === userId && x.listing === c.id && !x.done);
      return { id: c.id, requestId: r ? r.id : null, num: r ? r.num : null, section: c.section };
    });

  await updateBadge();
  return { read: items.length, saved, complete, at: now, changes, unseen, qtyOffers, sold };
}

/* Forget every listing read from viagogo and start again. Requests keep their
 * listing ids, so a listing read back in finds its request exactly as before —
 * only what was read from viagogo is thrown away. */
async function resetListings(userId) {
  const m = await model();
  const mine = Object.values(m.listings).filter(l => l.userId === userId);
  await Remote.deleteListings(userId);
  await updateBadge();
  return { removed: mine.length };
}

/* What these tickets cost you, per ticket, typed on the listing. Empty clears
 * it and the ticket site's own section price takes over again where there is
 * one. This is the only buy price a listing on an untracked event can have. */
async function setListingBuy(id, price, currency, userId) {
  const m = await model();
  const l = m.listings[String(id)];
  if (!l) throw new Error('That listing is not saved yet — read your viagogo listings page first.');
  if (l.userId !== userId) throw new Error('That listing belongs to someone else.');
  const n = Number(price);
  const amount = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  const cur = SK.profit.CURRENCIES.includes(currency) ? currency : 'ALL';
  return Remote.patchListing(l.id, { buy_price: amount, buy_currency: cur });
}

/* "Bought" and back again. With a request of yours behind the listing the
 * switch is the request's own (it shows BOUGHT and keeps its number, history
 * and sector); a listing with no request keeps it on the listing. Nothing on
 * viagogo is touched either way. */
async function setListingTrack(id, track, userId) {
  const m = await model();
  const l = m.listings[String(id)];
  if (!l) throw new Error('That listing is not saved yet — read your viagogo listings page first.');
  if (l.userId !== userId) throw new Error('That listing belongs to someone else.');
  const off = track === 'off';
  const r = m.requests.find(x => x.userId === userId && x.listing === l.id && !x.done);
  if (r) {
    if (!!r.bought !== off) await updateRequest(r.id, { bought: off });
    if (l.track === 'off') await Remote.patchListing(l.id, { track: 'auto' });   // an older build's switch moves onto the request
    await updateBadge();
    return l;
  }
  const next = off ? 'off' : 'auto';
  if (l.track === next) return l;
  const out = await Remote.patchListing(l.id, { track: next });
  await updateBadge();
  return out;
}

/* ---------------- reservations ---------------------------------------
 * viagogo: "Please reserve these tickets while we run our final checks on
 * the buyer". Marked by hand on the listing: how many tickets, their seats
 * when known. Confirm (viagogo said yes) makes them sold; the database then
 * joins it to its sale once that is read (schema.sql confirm_reservation).
 * Cancel deletes it: no trace, the tickets are listed again. Which tickets
 * it holds is picked in the app (this PC keeps no tickets). */
async function reserveListing(id, tickets, seats, userId) {
  if (!userId) throw new Error('Sign in first.');
  const m = await model();
  const l = m.listings[String(id)];
  if (!l) throw new Error('That listing is not saved yet — read your viagogo listings page first.');
  if (l.userId !== userId) throw new Error('That listing belongs to someone else.');
  const n = SK.util.clampInt(tickets, 1, 1, 99);
  return Remote.insertReservation({ id: SK.util.newId('r'), user_id: userId, listing_id: l.id, tickets: n, seats: String(seats || '').trim().slice(0, 80) });
}

/* a reservation of yours, as this PC last read it */
async function ownReservation(id, userId) {
  const r = ((await model()).reservations || {})[String(id)];
  if (!r) throw new Error('That reservation is gone: refresh.');
  if (r.userId !== userId) throw new Error('That reservation belongs to someone else.');
  return r;
}

/* -> the sale it joined, or null (it waits for its sale, sold already) */
async function confirmReservation(id, userId) {
  const r = await ownReservation(id, userId);
  return Remote.confirmReservation(r.id);
}

async function cancelReservation(id, userId) {
  const r = await ownReservation(id, userId);
  await Remote.deleteReservation(r.id);
  return true;
}

/* ================================================================== */
/* buy tracker                                                         */
/* ================================================================== */

/* A new buying account from the eBileta checkout drawer, checked like the
 * app checks it: a valid email, not one you already saved. */
async function saveBuyAccount(fields, userId) {
  if (!userId) throw new Error('Sign in first.');
  const email = String((fields && fields.email) || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Type a valid email.');
  const m = await model();
  if (Object.values(m.accounts || {}).some(a => a.userId === userId && a.email === email)) throw new Error(`${email} is already saved.`);
  const birthday = String(fields.birthday || '');
  return Remote.insertAccount({
    id: SK.util.newId('a'), user_id: userId, email,
    first_name: String(fields.firstName || '').trim(),
    last_name: String(fields.lastName || '').trim(),
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : null,
    notes: String(fields.notes || '').trim()
  });
}

/* The tickets of a lot from the eBileta checkout: one per ticket the page
 * lists for its sector, with what the page says of it (the sector as
 * printed, row, seat, price with the fee). They have no file yet: each
 * waits for its PDF (delivery 'pdf', the column's default), which the app
 * attaches. p: the purchase row (snake case); checkout: [{ place, row, seat,
 * price, currency }]. -> rows for the tickets table */
function checkoutTicketRows(p, checkout, userId) {
  return (checkout || []).map((t, i) => {
    const price = Number(t.price) > 0 ? Math.round(Number(t.price) * 100) / 100 : null;
    return {
      id: SK.util.newId('t'), user_id: userId, purchase_id: p.id, page: i + 1,
      sector_text: String(t.place || '').trim().slice(0, 60), sector_id: p.sector_id || null,
      row_label: String(t.row || '').trim().slice(0, 20), seat: String(t.seat || '').trim().slice(0, 20),
      price, currency: SK.profit.CURRENCIES.includes(t.currency) ? t.currency : p.currency
    };
  });
}

/* Purchases of yours, from the eBileta checkout drawer: one per sector of
 * the order, each with its tickets (above), so the app knows every seat
 * before the PDF comes. Like the app: a purchase linked to a request makes
 * it Bought once its purchases cover its tickets, and gives it the price
 * paid when it has none typed. What it cost in lek (Spent) is filled at
 * today's rate, marked auto: the app is where the bank's real charge is
 * typed. The tickets are saved after the lots; if they cannot be (a
 * database without them), the lots stay counted and the app can make them.
 * -> { purchases, tickets: how many were saved, ticketsError } */
async function savePurchases(items, userId) {
  if (!userId) throw new Error('Sign in first.');
  const m = await model();
  const U = SK.util;
  const today = new Date().toISOString().slice(0, 10);
  const override = SK.settings.normalize(m.team || {}).fxOverride;
  const rows = (items || []).map(it => {
    const account = (m.accounts || {})[it.accountId];
    if (!account || account.userId !== userId) throw new Error('Pick one of your buying accounts.');
    if (!m.events[it.eventKey]) throw new Error('Track this event first: a purchase belongs to a tracked event.');
    const r = it.requestId ? m.requests.find(x => x.id === it.requestId) : null;
    const qty = U.clampInt(it.qty, 1, 1, 999);
    const price = Number(it.price) > 0 ? Math.round(Number(it.price) * 100) / 100 : null;
    const currency = SK.profit.CURRENCIES.includes(it.currency) ? it.currency : 'ALL';
    return {
      id: U.newId('p'), user_id: userId, account_id: account.id, event_key: it.eventKey,
      request_id: r && r.userId === userId ? r.id : null,
      sector_id: it.sectorId ? String(it.sectorId) : null,
      qty, price, currency,
      spent_all: price ? SK.profit.lekAt(price * qty, currency, m.fx, override, Date.now()) : null, spent_auto: true,
      bought_on: today, order_ref: String(it.orderRef || '').trim(), notes: String(it.notes || '').trim()
    };
  });
  const saved = await Remote.insertPurchases(rows);
  /* each lot's tickets, when the page listed exactly as many */
  const tix = rows.flatMap((r, i) => {
    const list = (items[i] && items[i].tickets) || [];
    return list.length === r.qty ? checkoutTicketRows(r, list, userId) : [];
  });
  let tickets = 0, ticketsError = '';
  if (tix.length) {
    try { tickets = await Remote.insertTickets(tix); } catch (e) { ticketsError = (e && e.message) || String(e); }
  }
  const after = await model();
  for (const p of saved) {
    const r = p.requestId && after.requests.find(x => x.id === p.requestId);
    if (!r) continue;
    const got = Object.values(after.purchases || {}).filter(x => x.requestId === r.id).reduce((n, x) => n + x.qty, 0);
    const changes = {};
    if (got >= Number(r.qty) && !r.bought && !r.done) changes.bought = true;
    if (p.price > 0 && !(Number(r.buyPrice) > 0)) { changes.buyPrice = p.price; changes.buyCurrency = p.currency; }
    if (Object.keys(changes).length) await updateRequest(r.id, changes);
  }
  await updateBadge();
  return { purchases: saved, tickets, ticketsError };
}
