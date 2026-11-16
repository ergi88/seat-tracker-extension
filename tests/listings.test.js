/* Run with:  node --test tests/
 *
 * v4: a viagogo listing is the thing being tracked, and carries its own state.
 * These check the two rules the rest of the extension leans on — what state a
 * listing is in, and which requests stop driving scans and alerts because of it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

/* the whole service worker in one context, exactly as worker.test.js loads it */
function worker() {
  const src = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const listed = [...(/importScripts\(([\s\S]*?)\);/.exec(src)[1]).matchAll(/'([^']+)'/g)].map(m => m[1]);
  const anything = () => new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : anything()),
    apply: () => anything(),
    has: () => true
  });
  const sandbox = { chrome: anything(), fetch: anything(), navigator: { onLine: true }, console, importScripts: () => {} };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of listed.concat('background.js')) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

const W = worker();

const listing = over => Object.assign({ id: '13988951528', userId: 'u1', track: 'auto', goneAt: 0 }, over);
const request = over => Object.assign({ id: 'r1', userId: 'u1', listing: '13988951528', done: false, eventKey: 'ebileta:2160' }, over);
const event = { key: 'ebileta:2160', num: 1, title: 'Kosova - Austria' };

test('a listing knows what it is', () => {
  const s = (l, r, ev) => W.listingState(l, r || null, ev || null);

  assert.equal(s(listing(), request(), event), 'tracked', 'bound to an open request');
  assert.equal(s(listing(), request({ done: true }), event), 'done');
  assert.equal(s(listing(), null, event), 'linkable', 'its event is tracked, nothing binds it yet');
  assert.equal(s(listing(), null, null), 'untracked', 'no tracked event matches');
  assert.equal(s(listing({ track: 'off' }), request(), event), 'ignored', 'switched off beats its request');
  assert.equal(s(listing(), request({ bought: true }), event), 'bought', 'its request is bought');
  assert.equal(s(listing({ track: 'off' }), request({ bought: true }), event), 'bought');
  assert.equal(s(listing(), request({ bought: true, done: true }), event), 'done', 'done beats bought');
  /* there is deliberately no "gone": an absence never rewrites a record */
  assert.equal(s(listing({ goneAt: 1 }), request(), event), 'tracked');
  assert.equal(s(listing({ goneAt: 1 }), null, null), 'untracked');
});

test('a listing a read did not see never silences its request', () => {
  /* Not seeing something is not the same as it not being there, so a read
   * reports the absence and leaves every record exactly as it was. */
  const m = {
    listings: { 13977001122: listing({ id: '13977001122', goneAt: Date.now() }) },
    requests: [request({ id: 'unseen', listing: '13977001122' })]
  };
  assert.equal(W.muffled(m, m.requests[0]), false);
  assert.equal(W.openRequests(m, null, 'u1').length, 1, 'it is still scanned and still alerts');
});

test('a request whose listing is switched off stops driving anything', () => {
  const m = {
    listings: {
      13988951528: listing(),
      13990000001: listing({ id: '13990000001', track: 'off' }),
      13977001122: listing({ id: '13977001122', goneAt: Date.now() })
    },
    requests: [
      request({ id: 'live', num: 1 }),
      request({ id: 'off', num: 2, listing: '13990000001' }),
      request({ id: 'unseen', num: 3, listing: '13977001122' }),
      request({ id: 'plain', num: 4, listing: '' }),
      request({ id: 'finished', num: 5, done: true })
    ]
  };

  const open = W.openRequests(m, null, 'u1').map(r => r.id);
  assert.equal(open.join(','), 'live,unseen,plain', 'only the switched-off one is left out');

  /* the cards themselves are still yours: only the acting stops */
  assert.equal(m.requests.length, 5);
  assert.equal(W.muffled(m, m.requests[1]), true, 'switched off: silenced');
  assert.equal(W.muffled(m, m.requests[2]), false, 'not seen by a read: still alerting');
  assert.equal(W.muffled(m, m.requests[0]), false);
  assert.equal(W.muffled(m, m.requests[3]), false, 'a request without a listing is never muffled');
});

test('a teammate\'s request is never muffled by a listing this PC cannot see', () => {
  /* only your own listings are readable, so a row belonging to someone else
   * must never silence their request */
  const m = {
    listings: { 13988951528: listing({ userId: 'u1', track: 'off' }) },
    requests: [request({ id: 'theirs', userId: 'u2' })]
  };
  assert.equal(W.muffled(m, m.requests[0]), false);
  assert.equal(W.openRequests(m, null, 'u2').length, 1);
});

/* the UI pieces, loaded on their own: listingGroups touches no DOM */
function uiOnly() {
  const ctx = vm.createContext({ globalThis: null, document: {}, console, URL, URLSearchParams });
  ctx.globalThis = ctx;
  for (const f of ['core/util.js', 'core/profit.js', 'core/viagogo.js', 'ui/components.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx.SK;
}

test('viagogo\'s words for a listing fold into the four states it filters by', () => {
  const k = uiOnly().viagogo.listingStatus;
  assert.equal(k('Active'), 'active');
  assert.equal(k('live'), 'active');
  assert.equal(k('Pending'), 'pending');
  assert.equal(k('On hold'), 'pending');
  assert.equal(k('Deactivated'), 'deactivated');
  assert.equal(k('Expired'), 'deactivated');
  assert.equal(k('Sold out'), 'sold');
  assert.equal(k(''), 'other', 'a card with no status line is never guessed at');
  assert.equal(k('Something viagogo invents next year'), 'other');
});

test('a listing card with no status line is Deactivated', () => {
  /* viagogo drops the status element entirely once a listing is deactivated,
   * so the absence is the signal — but only a real absence. */
  const V = uiOnly().viagogo;

  /* the smallest DOM parseListingCard can walk: one box of one-line children */
  const leaf = text => ({
    nodeType: 1, tagName: 'DIV', children: [],
    childNodes: [{ nodeType: 3, nodeValue: text }],
    closest: () => null, querySelector: () => null
  });
  const card = status => {
    const texts = [status, 'Albania vs Belarus - Nations League', 'Listing No. 14019310917',
      'Air Albania Stadium, Tirana', 'Tue, 06 Oct', '$89.00', 'Price per ticket',
      "You'll get", '$400.50', 'Section W101', '5 Tickets available'].filter(Boolean);
    const box = { nodeType: 1, tagName: 'DIV', children: texts.map(leaf), childNodes: [], querySelector: () => null };
    box.childNodes = box.children;
    return V.parseListingCard(box);
  };

  const active = card('Active');
  assert.equal(active.status, 'Active', 'a status that is there is read as it is');
  assert.equal(active.title, 'Albania vs Belarus - Nations League');

  const dead = card(null);
  assert.equal(dead.status, 'Deactivated', 'and no status line at all means deactivated');
  assert.equal(V.listingStatus(dead.status), 'deactivated', 'so it filters under Deactivated');
  assert.equal(dead.title, 'Albania vs Belarus - Nations League', 'without eating the card\'s other fields');
  assert.equal(dead.id, '14019310917');
  assert.equal(dead.section, 'W101');

  const odd = card('Scheduled');
  assert.equal(odd.status, 'Scheduled', 'a word viagogo invents later is kept, not turned into deactivated');
  assert.equal(V.listingStatus(odd.status), 'other');
  assert.equal(odd.title, 'Albania vs Belarus - Nations League');
});

test('a price inside viagogo\'s edit button is read, not the date before it', () => {
  /* Editable listings show "$28.00 ✎" as a button. Skipping it left the date
   * "Tue, 06 Oct" just above "Price per ticket", and 06 read as $6. */
  const V = uiOnly().viagogo;
  const leaf = (text, tag) => ({
    nodeType: 1, tagName: tag || 'DIV', children: [],
    childNodes: [{ nodeType: 3, nodeValue: text }],
    closest: sel => (tag === 'BUTTON' && /button/.test(sel) ? {} : null), querySelector: () => null
  });
  const kids = [leaf('Active'), leaf('Albania vs San Marino - Nations League'), leaf('Listing No. 14227497532'),
    leaf('Air Albania Stadium, Tirana'), leaf('Tue, 06 Oct • 8:45 PM'), leaf('$28.00', 'BUTTON'),
    leaf('Price per ticket'), leaf("You'll get"), leaf('$252.00'), leaf('Section N103 • Row Home'),
    leaf('10 Tickets available'), leaf('Show details', 'BUTTON'), leaf('Adjust price', 'BUTTON')];
  const box = { nodeType: 1, tagName: 'DIV', children: kids, childNodes: kids, querySelector: () => null };
  const d = V.parseListingCard(box);
  assert.equal(d.price, 28);
  assert.equal(d.currency, 'USD');
  assert.equal(d.payout, 252);
  assert.equal(d.section, 'N103');

  /* and with no amount there at all, no price — never one out of the date */
  const noPrice = kids.filter(k => k.childNodes[0].nodeValue !== '$28.00');
  const d2 = V.parseListingCard({ ...box, children: noPrice, childNodes: noPrice });
  assert.equal(d2.price, null);
});

test('every listing lands in exactly one group, whatever the worker sent', () => {
  /* Grouping is by the viagogo event the card links to, so two matches that
   * share a name stay apart and a reworded name does not split one in half. */
  const groups = uiOnly().ui.listingGroups({
    events: [{ key: 'e1', num: 1, title: 'Kosova - Austria', siteLabel: 'eBileta Kosovo', date: '04 Oct' }],
    listings: [
      { id: '1', state: 'tracked', eventKey: 'e1', vgEventId: '900', title: 'Kosova - Austria', when: 'Sun 04 Oct', tickets: 6 },
      { id: '2', state: 'linkable', eventKey: 'e1', vgEventId: '900', title: 'Kosova - Austria', tickets: 2 },
      { id: '3', state: 'untracked', eventKey: null, vgEventId: '901', title: 'Kosova - Austria', when: 'Wed 12 Nov', tickets: 4 },
      { id: '4', state: 'ignored', eventKey: 'e1', vgEventId: '900', tickets: 3 },
      { id: '5', state: 'untracked', eventKey: null, vgEventId: '', title: 'Some gig', when: '01 Dec' },
      /* an older service worker still running behind a fresh popup */
      { id: '6', requestId: 'r', eventKey: 'e1', vgEventId: '900' },
      { id: '7', track: 'off', vgEventId: '900' },
      { id: '8' }
    ]
  });
  const placed = Array.from(groups.flatMap(g => g.items.map(l => l.id))).sort();
  assert.equal(placed.join(','), '1,2,3,4,5,6,7,8',
    'nothing is dropped, so the list can never come back empty while listings exist');
  assert.equal(new Set(placed).size, placed.length, 'and nothing is shown twice');

  const named = Object.fromEntries(groups.map(g => [g.key, g]));
  assert.equal(named['E-900'].items.map(l => l.id).join(','), '1,2,6', 'one group per viagogo event');
  assert.equal(named['E-900'].title, 'Kosova - Austria');
  assert.ok(named['E-900'].sub.includes('tracked as [1]'), 'and it says when the event is tracked');
  assert.equal(named['E-901'].items.map(l => l.id).join(','), '3',
    'the same name on another viagogo event is a group of its own');
  assert.equal(named.ignored.items.map(l => l.id).join(','), '4,7', 'ignored ones sit together, out of the way');
  assert.ok(groups.some(g => g.key.startsWith('n:')), 'a card with no event id falls back to its name and date');
  assert.equal(named['E-900'].totals.tickets, 8, 'group totals add up the tickets still listed');
  assert.ok(!groups.some(g => g.key === 'gone'), 'and nothing is ever grouped as gone');
});

test('the listings schema is additive, so an older build still works', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');
  for (const col of ['track', 'last_sweep_at', 'buy_price', 'buy_currency', 'venue']) {
    assert.ok(new RegExp(`add column if not exists\\s+${col}\\b`).test(sql), `${col} is added, not redefined`);
  }
  assert.ok(/add column if not exists\s+track\s+text not null default 'auto'/.test(sql),
    'track defaults to auto, so rows written by an older build behave exactly as before');
});

test('lists put the request closest to failing first', () => {
  const S = uiOnly().ui;
  const r = (num, options, status, done) => ({ num, done: !!done, eval: { status: status || 'OK', options } });
  const list = [r(1, 12), r(2, 0, 'SPLIT'), r(3, null, 'NOT SCANNED'), r(4, 3), r(5, 1), r(6, 0, 'OK', true)];

  assert.equal(S.sortRequests(list, 'options').map(x => x.num).join(','), '2,5,4,1,3,6',
    'fewest options first, never-scanned below them, done last');
  assert.equal(S.sortRequests(list, 'number').map(x => x.num).join(','), '1,2,3,4,5,6',
    'and the old order is still one setting away');

  /* listings follow their request's options, and the ones with nothing to
   * scan sit after the ones that have something */
  const l = (id, options, num) => ({ id, options, num });
  assert.equal(S.sortListings([l('c', null), l('a', 9, 2), l('b', 1, 7)], 'options').map(x => x.id).join(','), 'b,a,c');
  assert.equal(S.sortListings([l('c', null, 3), l('a', 9, 2), l('b', 1, 7)], 'number').map(x => x.id).join(','), 'a,c,b');
});

/* ---------------- a request follows its listing's ticket count ------ */

test('a listing whose ticket count changes takes its open request along', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const ROOT = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const listed = [...(/importScripts\(([\s\S]*?)\);/.exec(src)[1]).matchAll(/'([^']+)'/g)].map(m => m[1]);
  const anything = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : anything()), apply: () => anything(), has: () => true });
  const sandbox = { chrome: anything(), fetch: anything(), navigator: { onLine: true }, console, importScripts: () => {} };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of listed.concat('background.js')) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

  const card = (id, tickets) => ({ id, title: 'Albania vs Belarus', when: '26 Sep', section: 'E106', currency: 'USD', price: 84, payout: 75.6 * tickets, tickets, status: 'Active' });
  const was = (id, tickets) => Object.assign(card(id, tickets), { userId: 'me', seenAt: Date.now(), history: [] });
  const M = {
    events: {}, teamPrices: {}, device: { id: 'pc' },
    listings: { '10000001': was('10000001', 8), '10000002': was('10000002', 8), '10000003': was('10000003', 8), '10000004': was('10000004', 2), '10000005': was('10000005', 8) },
    requests: [
      { id: 'r1', num: 1, userId: 'me', listing: '10000001', qty: 8, done: false },
      { id: 'r2', num: 2, userId: 'me', listing: '10000002', qty: 8, done: true },
      { id: 'r3', num: 3, userId: 'me', listing: '10000003', qty: 8, done: false },
      { id: 'r4', num: 4, userId: 'me', listing: '10000004', qty: 2, done: false },
      { id: 'r5', num: 5, userId: 'me', listing: '10000005', qty: 8, done: false }
    ]
  };
  ctx.__M = M;
  ctx.__patched = [];
  vm.runInContext(`
    model = async () => __M;
    Remote.saveListings = async rows => rows.length;
    Remote.patchRequest = async (id, clean) => { __patched.push({ id, clean }); return Object.assign({}, __M.requests.find(r => r.id === id), clean); };
    Remote.resetState = async () => {};
  `, ctx);

  const res = await ctx.saveListings([card('10000001', 7), card('10000002', 7), card('10000003', 8), card('10000004', 0), card('10000005', 7)], 'me');
  assert.deepEqual(ctx.__patched.map(p => [p.id, p.clean.qty]), [['r1', 7], ['r5', 7]],
    'the open requests follow 8 → 7; a done one, an unchanged one and one that ran out to 0 do not');
  assert.deepEqual(JSON.parse(JSON.stringify(res.followed.map(f => [f.num, f.was, f.from, f.to]))), [[1, 8, 8, 7], [5, 8, 8, 7]], 'and the page is told which');
});

/* ---------------- sales from My Sales ------------------------------ */

test('sales are saved once, matched through their listing, and their profit uses its buy price', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const ROOT = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const listed = [...(/importScripts\(([\s\S]*?)\);/.exec(src)[1]).matchAll(/'([^']+)'/g)].map(m => m[1]);
  const anything = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : anything()), apply: () => anything(), has: () => true });
  const sandbox = { chrome: anything(), fetch: anything(), navigator: { onLine: true }, console, importScripts: () => {} };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of listed.concat('background.js')) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

  const M = {
    events: { 'ebileta:2154': { key: 'ebileta:2154', num: 2, site: 'ebileta', title: 'Shqiperi - San Marino', date: 'Mar 06 tet 2026 20:45',
      sectors: [{ id: '1705', code: 'N105', name: 'N105', meta: {} }] } },
    teamPrices: {}, device: { id: 'pc' }, requests: [], scanMeta: {}, fx: {}, team: {},
    listings: { 14123898111: { id: '14123898111', userId: 'me', eventKey: 'ebileta:2154', sectorId: '1705', buyPrice: 3000, buyCurrency: 'ALL' } },
    sales: {}
  };
  ctx.__M = M;
  ctx.__rows = [];
  vm.runInContext(`
    model = async () => __M;
    Remote.saveSales = async rows => { __rows.push(...rows); for (const r of rows) __M.sales[r.sale_id] = {
      id: r.sale_id, userId: r.user_id, eventKey: r.event_key, sectorId: r.sector_id, vgEventId: r.vg_event_id, listingId: r.listing_id,
      title: r.title, when: r.event_when, venue: r.venue, section: r.section, row: r.row_label, tickets: r.tickets, currency: r.currency,
      amount: r.amount, status: r.status, soldOn: r.sold_on || '', buyPrice: null, buyCurrency: 'ALL', seenAt: Date.now() }; return rows.length; };
  `, ctx);

  const sale = { id: '656096343', listingId: '14123898111', vgEventId: '161613551', title: 'Albania vs San Marino - Nations League', section: 'N105',
    tickets: 3, currency: 'USD', amount: 86.4, status: 'Get Paid', soldAt: '2026-10-04T08:17:16', buyerEmail: 'never@kept.example' };
  const first = await ctx.saveSales([sale], 'me');
  assert.equal(first.saved, 1);
  const row = ctx.__rows[0];
  assert.equal(row.event_key, 'ebileta:2154', 'its listing knows the event');
  assert.equal(row.sector_id, '1705', 'and the sector');
  assert.equal(row.sold_on, '2026-10-04');
  assert.doesNotMatch(JSON.stringify(row), /kept\.example/, 'nothing of the buyer is written');

  const again = await ctx.saveSales([sale], 'me');
  assert.equal(again.saved, 0, 'the same sale read again writes nothing');
  const paid = await ctx.saveSales([Object.assign({}, sale, { status: 'Complete' })], 'me');
  assert.equal(paid.saved, 1, 'but a payout that came in is written');

  const [s] = ctx.salesOf(M, 'me');
  assert.equal(s.buy.amount, 3000, 'the profit uses the buy price typed on its listing');
  assert.equal(s.buy.source, 'typed on the listing');
});

test('a bought request stops driving anything, with or without a listing', () => {
  const m = {
    listings: { 13988951528: listing() },
    requests: [
      request({ id: 'live', num: 1 }),
      request({ id: 'held', num: 2, bought: true }),
      request({ id: 'held-unlisted', num: 3, listing: '', bought: true })
    ]
  };
  assert.equal(W.openRequests(m, null, 'u1').map(r => r.id).join(','), 'live');
  assert.equal(W.muffled(m, m.requests[2]), true, 'no listing needed');
});

test('a bought request is never alerted, even when its sector is scanned for another request', async () => {
  const C = worker();
  /* a sector with 3 free seats in a row: a request for 4 is SHORT, one for 2 is OK */
  const seats = [1, 2, 3].map(k => ({ row: '1', label: String(k), x: k * 10, y: 0, free: true }));
  const scan = Object.assign(C.SK.rules.packScan('12', seats, 'x'), { at: Date.now() });
  const was = { status: 'OK', options: 1, free: 5, pendingGone: false, alertLog: {}, scanAt: scan.at - 60000, version: 1 };
  C.__m = {
    events: { 'ebileta:2160': event },
    listings: {},
    requests: [
      request({ id: 'held', num: 1, sec: '12', qty: 4, listing: '', bought: true }),
      request({ id: 'open', num: 2, sec: '12', qty: 4, listing: '', client: 'Ana K.' })
    ],
    scans: { 'ebileta:2160': { 12: scan } },
    state: { held: Object.assign({}, was), open: Object.assign({}, was) },
    settingsFor: () => C.SK.settings.normalize({ confirmGone: false, cooldownMin: 0 })
  };
  C.__sent = [];
  C.__cas = [];
  vm.runInContext(`
    model = async () => __m;
    setMeta = async () => {};
    Remote.casState = async (id) => { __cas.push(id); return true; };
    Remote.baselineState = async () => {};
    Notify.send = async (type, o) => { __sent.push({ type, ids: o.requests.map(r => r.id), title: o.title, message: o.message }); };
  `, C);
  await vm.runInContext(`Alerts.afterScan('ebileta:2160', ['12'])`, C);
  assert.equal(C.__cas.join(','), 'open', 'the bought one is not even judged');
  assert.equal(C.__sent.length, 1);
  assert.equal(C.__sent[0].type, 'gone');
  assert.equal(C.__sent[0].ids.join(','), 'open', 'only the open request is told "no longer fillable"');
  /* the text: sectors in the title, the event's own name, no [n] and no #n */
  assert.equal(C.__sent[0].title, 'No longer fillable · 12');
  assert.equal(C.__sent[0].message, 'Kosova - Austria\n\u{1F534} 12 ×4 SHORT — 0 options · Ana K.');
});
