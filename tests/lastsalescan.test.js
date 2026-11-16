/* Run with:  node --test tests/
 *
 * The last-sales scan (bg/lastsalescan.js) against a stand-in viagogo: it
 * asks GetRecentlySoldListingForEvent for each event with a sell session,
 * gets a session from viagogo's Sell link when there is none, one request
 * every 45–75 s, always with cookies, and stops at viagogo's bot check and
 * sign-in page. No tab or window is ever opened.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const S1 = '50e4a792-0922-41c1-a78f-4758882389ec';
const S2 = '4d27d558-1111-41c1-a78f-4758882389ec';
const SALE = { listingId: 14514628268, quantity: 1, section: 'N207', price: '$21.75', eventName: 'Albania vs Finland - Nations League' };

function world(opts) {
  const o = opts || {};
  let now = new Date(2026, 10, 6, 12, 0).getTime();
  const store = { session: {}, local: {} };
  const area = name => ({
    get: async k => (typeof k === 'string' ? (k in store[name] ? { [k]: JSON.parse(JSON.stringify(store[name][k])) } : {}) : Object.assign({}, store[name])),
    set: async v => { Object.assign(store[name], JSON.parse(JSON.stringify(v))); },
    remove: async k => { delete store[name][k]; }
  });
  /* viagogo: what each address answers */
  const requests = [];
  const answers = Object.assign({
    initialise: id => ({ status: 200, url: `https://sell.viagogo.com/ww/Secure/Pipeline/Sell/TicketDetails/Quantity?ID=${id === '161600003' ? S2 : S1}`, body: '<html>sell</html>' }),
    recent: () => ({ status: 200, body: JSON.stringify(SALE) })
  }, o.answers || {});
  const fetch = async (url, init) => {
    requests.push({ url, credentials: init && init.credentials, at: now });
    const u = new URL(url);
    const a = /Initialise/.test(u.pathname) ? answers.initialise(u.searchParams.get('EventID')) : answers.recent(u.searchParams.get('ID'));
    let cancelled = false;
    return {
      status: a.status, url: a.url || url,
      body: { cancel: async () => { cancelled = true; } },
      text: async () => (cancelled ? '' : a.body || '')
    };
  };
  const day = 86400000;
  const m = {
    meId: 'me', device: { id: 'pc1', name: 'PC 1' }, devices: [], leases: {},
    team: { lastSaleScanMin: o.every === undefined ? 30 : o.every },
    settings: { lastSaleScan: o.here !== false },
    listings: {
      l1: { vgEventId: '161613530', title: 'Albania vs Finland', when: 'Thu 12 Nov', seenAt: now - day },
      l2: { vgEventId: '161600003', title: 'Kosovo vs Sweden', when: 'Tue 17 Nov', seenAt: now - day }
    },
    teamPrices: {}, lastSales: {}
  };
  const saved = [];
  const log = { leases: 0, released: 0, blocked: 0, windows: 0 };
  const ctx = {
    console, Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } },
    Math, JSON, Object, Array, Set, Map, Promise, String, Number, URLSearchParams, URL, RegExp, Error,
    /* the scan's own waits (2–10 s) pass at once, moving the clock on */
    setTimeout: (fn, ms) => { if (ms >= 1000 && ms <= 10000) { now += ms; return setTimeout(fn, 0); } return setTimeout(fn, ms); },
    clearTimeout, AbortController, fetch,
    chrome: {
      storage: { session: area('session'), local: area('local') },
      windows: { create: async () => { log.windows++; throw new Error('no windows'); } },
      tabs: { create: async () => { log.windows++; throw new Error('no tabs'); } }
    },
    model: async () => m,
    Remote: {
      claimLease: async () => { log.leases++; return !o.leaseTaken; },
      releaseLease: async () => { log.released++; },
      saveTeam: async data => { m.team = JSON.parse(JSON.stringify(data)); }
    },
    saveLastSale: async item => {
      const it = ctx.SK.lastSales.clean(item);
      const { latest, same } = ctx.SK.lastSales.compare(saved, it);
      if (same) return { sale: latest, isNew: false };
      const sale = Object.assign({ id: String(saved.length + 1), firstSeen: now, seenCount: 1 }, it);
      saved.push(sale);
      return { sale, isNew: true };
    },
    noteVgBlocked: async info => {
      log.blocked++;
      store.local.vgBlockedUntil = now + 6 * 3600000;
      store.local.vgBlockLog = [Object.assign({ at: now, until: now + 6 * 3600000 }, info || {})].concat(store.local.vgBlockLog || []);
      return { blockedUntil: store.local.vgBlockedUntil };
    }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['core/util.js', 'core/settings.js', 'core/profit.js', 'core/viagogo.js', 'core/lastsales.js', 'bg/lastsalescan.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  const S = vm.runInContext('LastSaleScan', ctx);
  return {
    S, m, log, store, requests, saved, answers,
    later: ms => { now += ms; },
    now: () => now,
    last: () => (store.local.vgScan || {}).last || {}
  };
}

/* a minute and a half on: past the gap between requests */
const step = async w => { w.later(90000); await w.S.tick(); };

test('an event with no sell session: viagogo\'s Sell link gives one, then the last sale is asked for', async () => {
  const w = world();
  await w.S.tick();
  assert.equal(w.requests.length, 1);
  assert.equal(w.requests[0].url, 'https://www.viagogo.com/ww/Secure/Pipeline/Sell/Initialise?EventID=161613530');
  assert.equal(w.store.local.vgSellSessions['161613530'].id, S1);
  assert.equal(w.last().result, 'session');

  await step(w);
  assert.equal(w.requests[1].url, `https://sell.viagogo.com/Secure/Pipeline/Sell/GetRecentlySoldListingForEvent?ID=${S1}`);
  assert.equal(w.saved.length, 1);
  assert.equal(w.saved[0].section, 'N207');
  assert.equal(w.saved[0].price, 21.75);
  assert.equal(w.saved[0].currency, 'USD');
  assert.equal(w.saved[0].listingId, '14514628268');
  assert.equal(w.saved[0].vgEventId, '161613530', 'tied to the event it was asked for');
  assert.equal(w.saved[0].when, 'Thu 12 Nov');
  assert.equal(w.last().result, 'sale');
  assert.ok(w.requests.every(r => r.credentials === 'include'), 'never without cookies');
  assert.equal(w.log.windows, 0, 'no tab, no window');
});

test('sessions a sell page handed over are used straight away', async () => {
  const w = world();
  assert.equal(await w.S.learn({ '161613530': { id: S1, at: w.now() }, '161600003': { id: S2, at: w.now() }, bad: { id: 'x' } }), 2);
  await w.S.tick();
  assert.equal(w.requests.length, 1);
  assert.match(w.requests[0].url, /GetRecentlySoldListingForEvent/);
  /* an older one does not replace a newer one */
  assert.equal(await w.S.learn({ '161613530': { id: S2, at: w.now() - 1000 } }), 0);
});

test('one request every 45–75 s, and each event at most every 30 min', async () => {
  const w = world();
  await w.S.learn({ '161613530': { id: S1, at: w.now() }, '161600003': { id: S2, at: w.now() } });
  await w.S.tick();
  await w.S.tick();
  w.later(30000);
  await w.S.tick();
  assert.equal(w.requests.length, 1, 'nothing more within the gap');
  await step(w);
  assert.equal(w.requests.length, 2, 'the second event');
  for (let i = 0; i < 10; i++) await step(w);
  assert.equal(w.requests.length, 2, 'both done: nothing until their half hour is up');
  w.later(16 * 60000);
  await w.S.tick();
  assert.equal(w.requests.length, 3);
  const gap = w.store.session.vgScanJob.nextAt - w.now();
  assert.ok(gap >= 45000 && gap <= 75000, `gap ${gap}`);
});

test('the same sale again is not saved twice; another listing is', async () => {
  const w = world();
  await w.S.learn({ '161613530': { id: S1, at: w.now() } });
  w.m.listings = { l1: w.m.listings.l1 };
  await w.S.tick();
  w.later(31 * 60000);
  await w.S.tick();
  assert.equal(w.saved.length, 1);
  assert.equal(w.last().result, 'same');
  w.answers.recent = () => ({ status: 200, body: JSON.stringify(Object.assign({}, SALE, { listingId: 14514699999 })) });
  w.later(31 * 60000);
  await w.S.tick();
  assert.equal(w.saved.length, 2);
});

test('{} is "no sale"; an old session that says {} is renewed', async () => {
  const w = world({ answers: { recent: () => ({ status: 200, body: '{}' }) } });
  w.m.listings = { l1: w.m.listings.l1 };
  await w.S.learn({ '161613530': { id: S2, at: w.now() - 2 * 86400000 } });
  await w.S.tick();
  assert.equal(w.last().result, 'none');
  assert.equal(w.store.local.vgSellSessions['161613530'].stale, true);
  w.later(31 * 60000);
  await w.S.tick();
  assert.match(w.requests.at(-1).url, /Initialise\?EventID=161613530/);
  assert.equal(w.store.local.vgSellSessions['161613530'].id, S1);
  assert.equal(w.store.local.vgSellSessions['161613530'].stale, undefined);
});

test('a session viagogo no longer knows is renewed at once', async () => {
  const w = world({ answers: { recent: id => (id === S2 ? { status: 404, body: 'gone' } : { status: 200, body: JSON.stringify(SALE) }) } });
  w.m.listings = { l1: w.m.listings.l1 };
  await w.S.learn({ '161613530': { id: S2, at: w.now() } });
  await w.S.tick();
  assert.equal(w.last().result, 'renew');
  await step(w);
  assert.match(w.requests.at(-1).url, /Initialise/);
  await step(w);
  assert.equal(w.saved.length, 1);
});

test('viagogo\'s bot check stops everything for 6 hours', async () => {
  const w = world({ answers: { recent: () => ({ status: 403, body: '{"url":"https://geo.captcha-delivery.com/captcha/"}' }) } });
  await w.S.learn({ '161613530': { id: S1, at: w.now() } });
  await w.S.tick();
  assert.equal(w.log.blocked, 1);
  assert.equal(w.log.released, 1);
  for (let i = 0; i < 20; i++) await step(w);
  assert.equal(w.requests.length, 1, 'not one more request');
});

test('a bot check on the Sell link stops it too', async () => {
  const w = world({ answers: { initialise: () => ({ status: 403, body: 'DataDome' }) } });
  await w.S.tick();
  assert.equal(w.log.blocked, 1);
  await step(w);
  assert.equal(w.requests.length, 1);
});

test('signed out of viagogo: this PC stops for 6 hours and hands the lease back', async () => {
  const w = world({ answers: { initialise: () => ({ status: 200, url: 'https://my.viagogo.com/ww/login?ReturnUrl=x', body: '<html>sign in</html>' }) } });
  await w.S.tick();
  assert.equal(w.last().result, 'signed-out');
  assert.equal(w.log.released, 1);
  assert.ok(w.store.local.vgScan.pausedUntil > w.now());
  await step(w);
  assert.equal(w.requests.length, 1);
  await w.S.resume();
  await step(w);
  assert.equal(w.requests.length, 2, '"Start again now" works');
});

test('an event with no sell page twice is set aside for a day', async () => {
  const w = world({ answers: { initialise: () => ({ status: 200, url: 'https://www.viagogo.com/E-161613530', body: '<html>event</html>' }) } });
  w.m.listings = { l1: w.m.listings.l1 };
  await w.S.tick();
  w.later(31 * 60000);
  await w.S.tick();
  assert.equal(w.last().result, 'no-sell');
  assert.ok(w.store.local.vgScan.history['161613530'].skipUntil > w.now());
  w.later(31 * 60000);
  await w.S.tick();
  assert.equal(w.requests.length, 2);
});

test('off, not this PC, or another PC holding it: not one request', async () => {
  for (const o of [{ every: 0 }, { here: false }, { leaseTaken: true }]) {
    const w = world(o);
    await w.S.tick();
    assert.equal(w.requests.length, 0, JSON.stringify(o));
  }
});

test('the popup\'s status', async () => {
  const w = world();
  await w.S.learn({ '161613530': { id: S1, at: w.now() } });
  const st = await w.S.status(w.m);
  assert.equal(st.every, 30);
  assert.equal(st.events, 2);
  assert.equal(st.withSession, 1);
});

test('the team\'s list: add an event by hand, leave one out, give one its own interval', async () => {
  const w = world();
  let st = await w.S.setEvent('161699999', { on: true, title: 'Serbia vs England', when: 'Sun 22 Nov' });
  assert.deepEqual(w.m.team.lastSaleEvents['161699999'], { mode: 'add', title: 'Serbia vs England', when: 'Sun 22 Nov' });
  assert.equal(st.list.find(e => e.vgEventId === '161699999').source, 'added');
  assert.equal(st.events, 3);

  st = await w.S.setEvent('161600003', { on: false });
  assert.equal(w.m.team.lastSaleEvents['161600003'].mode, 'off', 'a listing event is left out, not forgotten');
  assert.equal(st.list.find(e => e.vgEventId === '161600003').on, false);
  assert.equal(st.events, 2);

  st = await w.S.setEvent('161613530', { every: 120 });
  assert.equal(st.list.find(e => e.vgEventId === '161613530').every, 120);

  st = await w.S.setEvent('161600003', { on: true });
  assert.equal(w.m.team.lastSaleEvents['161600003'], undefined, 'back to joining by itself: nothing to keep');
  st = await w.S.setEvent('161699999', { on: false });
  assert.equal(w.m.team.lastSaleEvents['161699999'], undefined, 'a hand-added event removed is gone');
  await assert.rejects(w.S.setEvent('12', { on: true }), /not a viagogo event/);
});

test('a hand-added event is asked about like the rest; a left-out one never', async () => {
  const w = world();
  w.m.listings = { l1: w.m.listings.l1 };
  await w.S.setEvent('161613530', { on: false });
  await w.S.setEvent('161699999', { on: true, title: 'Serbia vs England' });
  await w.S.learn({ '161699999': { id: S2, at: w.now() }, '161613530': { id: S1, at: w.now() } });
  for (let i = 0; i < 5; i++) await step(w);
  assert.ok(w.requests.length >= 1);
  assert.ok(w.requests.every(r => r.url.includes(S2)), 'only the added event');
});

/* ---------------- outside the schedule ------------------------------ */

test('Get last sale now: one event at once, saved, and its timer starts over', async () => {
  const w = world();
  await w.S.learn({ '161613530': { id: S1, at: w.now() } });
  const r = await w.S.checkNow('161613530', { by: 'hand' });
  assert.equal(r.kind, 'sale');
  assert.equal(w.requests.length, 1);
  assert.match(w.requests[0].url, /GetRecentlySoldListingForEvent/);
  assert.equal(w.saved.length, 1);
  assert.equal(w.saved[0].when, 'Thu 12 Nov', 'the event\'s date from the plan');
  const h = w.store.local.vgScan.history['161613530'];
  assert.equal(h.by, 'hand');
  assert.equal(h.result, 'sale');
  assert.ok(w.store.session.vgScanJob.nextAt > w.now(), 'the scan does not ask right after');
  /* the same sale again: skipped */
  const again = await w.S.checkNow('161613530', { by: 'hand' });
  assert.equal(again.kind, 'same');
  assert.equal(w.saved.length, 1);
  assert.ok(w.requests[1].at - w.requests[0].at >= 10000, 'never two requests closer than 10 s');
  assert.ok(w.requests.every(x => x.credentials === 'include'));
});

test('Get last sale now with no session: the Sell link first, then the last sale', async () => {
  const w = world();
  const r = await w.S.checkNow('161699999', { title: 'Serbia vs England', when: 'Sun 22 Nov' });
  assert.equal(r.kind, 'sale');
  assert.equal(w.requests.length, 2);
  assert.match(w.requests[0].url, /Initialise\?EventID=161699999/);
  assert.match(w.requests[1].url, /GetRecentlySoldListingForEvent/);
  assert.equal(w.saved[0].vgEventId, '161699999');
});

test('Get last sale now: a forgotten session is renewed and asked again', async () => {
  let n = 0;
  const w = world({ answers: { recent: id => (id === S1 && n++ === 0 ? { status: 404, body: '' } : { status: 200, body: '{}' }) } });
  await w.S.learn({ '161613530': { id: S1, at: w.now() } });
  const r = await w.S.checkNow('161613530', {});
  assert.equal(r.kind, 'none');
  assert.deepEqual(w.requests.map(x => /Initialise/.test(x.url) ? 'init' : 'recent'), ['recent', 'init', 'recent']);
});

test('Get last sale now during a bot check: not one request', async () => {
  const w = world();
  w.store.local.vgBlockedUntil = w.now() + 3600000;
  const r = await w.S.checkNow('161613530', {});
  assert.equal(r.kind, 'blocked');
  assert.equal(r.blockedUntil, w.now() + 3600000);
  assert.equal(w.requests.length, 0);
});

test('Get last sale now meeting the bot check: stops, and says when and what', async () => {
  const w = world({ answers: { recent: () => ({ status: 403, body: 'captcha-delivery' }) } });
  await w.S.learn({ '161613530': { id: S1, at: w.now() } });
  const r = await w.S.checkNow('161613530', { by: 'hand' });
  assert.equal(r.kind, 'blocked');
  assert.ok(r.blockedUntil > w.now());
  const st = await w.S.status(w.m);
  assert.equal(st.block.by, 'hand');
  assert.equal(st.block.title, 'Albania vs Finland');
  assert.equal(st.block.vgEventId, '161613530');
  assert.match(st.block.why, /HTTP 403/);
  assert.equal(st.blocks.length, 1);
  assert.equal(st.blockedUntil, w.now() + 6 * 3600000);
});

test('a sell page you open: uses its own session, and not when asked a moment ago', async () => {
  const w = world();
  const r = await w.S.checkNow('161613530', { by: 'page', sessionId: S2 });
  assert.equal(r.kind, 'sale');
  assert.equal(w.requests.length, 1);
  assert.ok(w.requests[0].url.endsWith(S2), 'the page\'s own sell session');
  w.later(60000);
  const again = await w.S.checkNow('161613530', { by: 'page', sessionId: S2 });
  assert.equal(again.kind, 'recent');
  assert.equal(w.requests.length, 1);
});

test('a toast read on a sell page counts as the event\'s turn', async () => {
  const w = world();
  w.m.listings = { l1: w.m.listings.l1 };
  await w.S.learn({ '161613530': { id: S1, at: w.now() } });
  await w.S.seen('161613530', 'sale', 'page');
  await w.S.tick();
  assert.equal(w.requests.length, 0, 'not due: the page just read it');
  const st = await w.S.status(w.m);
  const e = st.list.find(x => x.vgEventId === '161613530');
  assert.equal(e.lastBy, 'page');
  assert.equal(e.etaAt, w.now() + 30 * 60000);
});

test('status: every event\'s next turn, in the order the scan takes them', async () => {
  const w = world();
  await w.S.learn({ '161613530': { id: S1, at: w.now() } });
  const st = await w.S.status(w.m);
  const a = st.list.find(x => x.vgEventId === '161613530');
  const b = st.list.find(x => x.vgEventId === '161600003');
  assert.equal(a.etaAt, w.now(), 'has a session: first');
  assert.equal(b.etaAt, w.now() + 2 * 60000, 'needs a session first: a turn for it, then its own');
  assert.ok(st.perHour >= 4);
  assert.equal(st.asking, true);
  /* blocked: nothing before the end of it */
  w.store.local.vgBlockedUntil = w.now() + 3600000;
  const st2 = await w.S.status(w.m);
  assert.ok(st2.list.filter(x => x.on).every(x => x.etaAt >= w.now() + 3600000));
});

test('a day after a bot check ends, the scan goes at half speed', async () => {
  const w = world();
  await w.S.learn({ '161613530': { id: S1, at: w.now() } });
  w.store.local.vgBlockLog = [{ at: w.now() - 7 * 3600000, until: w.now() - 3600000 }];
  await w.S.tick();
  assert.equal(w.requests.length, 1);
  assert.ok(w.store.session.vgScanJob.nextAt - w.now() >= 90000, 'gap doubled');
  const st = await w.S.status(w.m);
  assert.equal(st.slowUntil, w.now() - 3600000 + 24 * 3600000);
  assert.equal(st.blocks[0].ended, 'time');
});
