/* Run with:  node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/util.js');
require('../core/profit.js');
const SK = require('../core/market.js');
require('../core/viagogo.js');
const M = SK.market;
const V = SK.viagogo;

/* rows as the event page gives them (from the capture of E-161613516) */
const row = (id, sprite, section, price, mine, extra) => Object.assign({ id, sprite, zone: '26127', section, row: '', price, currency: 'USD', mine: !!mine, sold: false }, extra);
const YOURS = [row('13981313702', '1844496', 'E101', 18, true), row('14048806484', '1844491', 'N102', 20, true), row('13988951528', '1844501', 'E106', 67, true)];

test('your listings pinned into another section never count for it', () => {
  const s202 = [...YOURS, row('13981258451', '1844533', 'S202', 16), row('13989591473', '1844533', 'S202', 16)];
  const store = M.emptyStore('161613516');
  const sec = M.putSection(store, { sprite: '1844533', zone: '26130', label: 'S202' }, s202, true, 1000);
  assert.deepEqual(sec.rows.map(r => r.id), ['13981258451', '13989591473']);
  assert.equal(Object.keys(store.own).length, 3, 'but they are remembered as yours');
  const sum = M.summarize(sec);
  assert.equal(sum.listings, 2);
  assert.equal(sum.kind, 'none');
});

test('rank against every listing of the section by display price; ties share a rank', () => {
  const e101 = [row('13981313702', '1844496', 'E101', 18, true), row('a', '1844496', 'E101', 16), row('b', '1844496', 'E101', 16), row('c', '1844496', 'E101', 30, false, { qtyMax: 2 })];
  const store = M.emptyStore('1');
  const sum = M.summarize(M.putSection(store, { sprite: '1844496', label: 'E101' }, e101, true));
  assert.equal(sum.cheapest, 16);
  assert.equal(sum.mine[0].rank, 3);
  assert.equal(sum.mine[0].gap, 2);
  assert.equal(sum.kind, 'above');
  assert.equal(sum.verdict, '$2.00 above the cheapest');
});

test('verdicts: cheapest, tied cheapest, only listing, sold ones left out', () => {
  const mk = rows => M.summarize({ rows });
  /* the gap is to the nearest seller who is not you: below them it is negative */
  const under = mk([row('m', '1', 'X', 10, true), row('o', '1', 'X', 12)]);
  assert.equal(under.verdict, 'cheapest by $2.00');
  assert.equal(under.mine[0].gap, -2, 'you are $2 under the next seller');
  assert.equal(under.cheapestOther, 12);
  assert.equal(mk([row('m', '1', 'X', 10, true), row('o', '1', 'X', 10)]).verdict, 'tied cheapest');
  assert.equal(mk([row('m', '1', 'X', 10, true), row('o', '1', 'X', 10)]).mine[0].gap, 0);
  assert.equal(mk([row('m', '1', 'X', 10, true)]).mine[0].gap, null, 'nobody to measure against when you are alone');
  assert.equal(mk([row('m', '1', 'X', 10, true)]).verdict, 'only listing');
  const withSold = mk([row('m', '1', 'X', 10, true), row('s', '1', 'X', 5, false, { sold: true })]);
  assert.equal(withSold.verdict, 'only listing');
  assert.equal(withSold.sold, 1);
});

test('a section without a map id is kept by its name ("West Tribuna")', () => {
  const store = M.emptyStore('1');
  const rows = [row('w1', '', 'West Tribuna', 40), row('w2', '', 'West Tribuna', 45, true)];
  const sec = M.putSection(store, { label: 'West Tribuna' }, rows, true);
  assert.equal(sec.key, 'name:WEST TRIBUNA');
  assert.equal(sec.rows.length, 2);
});

test('re-scanning a section replaces it; views sort and filter', () => {
  const store = M.emptyStore('1');
  M.putSection(store, { sprite: '1', label: 'E105' }, [row('a', '1', 'E105', 50), row('m', '1', 'E105', 60, true)], true, 1);
  M.putSection(store, { sprite: '2', label: 'E104' }, [row('b', '2', 'E104', 30)], true, 2);
  M.putSection(store, { sprite: '1', label: 'E105' }, [row('a', '1', 'E105', 50)], true, 3);
  assert.equal(store.sections['1'].rows.length, 1);
  assert.deepEqual(M.sectionsView(store).map(s => s.label), ['E104', 'E105']);
  M.putSection(store, { sprite: '3', label: 'E106' }, [row('c', '3', 'E106', 20), row('m2', '3', 'E106', 35, true)], true, 4);
  assert.deepEqual(M.sectionsView(store, { onlyMine: true }).map(s => s.label), ['E106']);
  const t = M.totals(store);
  assert.deepEqual([t.sections, t.listings, t.withMine, t.cheapestFor, t.oldest], [3, 4, 1, 0, 2]);
});

test('price axis has round ticks around the prices', () => {
  const a = M.axis(7, 143, 6);
  assert.ok(a.min <= 7 && a.max >= 143);
  assert.ok(a.ticks.every(t => Number.isInteger(t / 25) || Number.isInteger(t / 20) || Number.isInteger(t / 50)), JSON.stringify(a));
  assert.deepEqual(M.axis(16, 16).ticks.length > 1, true);
});

test('event page URLs: event id, the selected section, selecting another', () => {
  const loc = new URL('https://www.viagogo.com/ww/Sports-Tickets/Soccer/Albania-National-Football-Team-Tickets/E-161613516?lt=41.3&lg=19.8&quantity=0&sections=1844533&ticketClasses=26130&rows=&seats=&seatTypes=&listingQty=');
  assert.equal(V.isEventPage(loc), true);
  assert.equal(V.isEventPage(new URL('https://my.viagogo.com/listings/')), false);
  assert.equal(V.eventIdOf(loc), '161613516');
  assert.deepEqual(V.selectedSectionOf(loc), { sprite: '1844533', zone: '26130' });
  assert.equal(V.selectedSectionOf(new URL('https://www.viagogo.com/x/E-1?sections=&ticketClasses=')), null);
  const next = new URL(V.sectionUrl(loc, { sprite: '1844530', zone: '26127' }));
  assert.equal(next.searchParams.get('sections'), '1844530');
  assert.equal(next.searchParams.get('ticketClasses'), '26127');
  assert.equal(next.searchParams.get('quantity'), '0', 'other filters are kept');
  assert.equal(new URL(V.sectionUrl(loc, null)).searchParams.get('sections'), '');
});

test('one pass over the whole list: rows sorted into their sections, duplicates once, re-scan replaces', () => {
  const store = M.emptyStore('161613516');
  const rows = [...YOURS, row('a', '1844496', 'E101', 16), row('13981313702', '1844496', 'E101', 18, true),
    row('b', '1844533', 'S202', 16), row('w', '', 'West Tribuna', 40)];
  const scan = M.putAll(store, rows, true, 5, { shown: 6, total: 6 });
  assert.equal(scan.listings, 6);
  assert.deepEqual(Object.keys(store.sections).sort(), ['1844491', '1844496', '1844501', '1844533', 'name:WEST TRIBUNA']);
  assert.deepEqual(store.sections['1844496'].rows.map(r => r.id), ['13981313702', 'a']);
  assert.equal(store.sections['1844496'].label, 'E101');
  assert.equal(M.summarize(store.sections['1844496']).verdict, '$2.00 above the cheapest');
  assert.equal(Object.keys(store.own).length, 3);
  M.putAll(store, [row('b', '1844533', 'S202', 17)], false, 9);
  assert.deepEqual(Object.keys(store.sections), ['1844533']);
  assert.equal(store.scan.complete, false);
  assert.equal(Object.keys(store.own).length, 0);
});

/* ---------------- one scan, compared on another page --------------- */

/* signed in: two of yours in E106, one in N102; the rest is everyone else */
const IN = [
  row('1001', '1844501', 'E106', 60, true, { row: 'ALB', qtyMin: 1, qtyMax: 6, features: ['Aisle seat'], index: 0 }),
  row('1002', '1844501', 'E106', 70, true, { row: '', qtyMin: 2, qtyMax: 4, features: [], index: 1 }),
  row('1003', '1844491', 'N102', 20, true, { row: '', qtyMin: 1, qtyMax: 8, features: [], index: 2 }),
  row('2001', '1844501', 'E106', 55, false, { qtyMin: 1, qtyMax: 2, features: [], index: 3 }),
  row('2002', '1844501', 'E106', 65, false, { qtyMin: 1, qtyMax: 3, features: [], index: 4 }),
  row('2003', '1844533', 'S202', 16, false, { qtyMin: 1, qtyMax: 2, features: [], index: 5 })
];
const scanned = () => {
  const store = M.emptyStore('161613516');
  M.putAll(store, IN, true, 1000);
  return M.compareFrom(store, { name: 'Albania vs Belarus' }, 1000);
};

test('fingerprint: what a buyer sees apart from the price, in any order and case', () => {
  const a = { section: 'E106', row: 'ALB', qtyMin: 1, qtyMax: 6, features: ['Aisle seat', 'Event Organiser'], price: 60 };
  const b = { section: 'e106 ', row: 'alb', qtyMin: 1, qtyMax: 6, features: ['event organiser', 'Aisle  seat'], price: 99 };
  assert.equal(M.fingerprintOf(a), M.fingerprintOf(b), 'price and spelling do not count');
  assert.notEqual(M.fingerprintOf(a), M.fingerprintOf(Object.assign({}, a, { qtyMax: 5 })), 'the quantity does');
});

test('compareFrom keeps only your sections, and only your listings carry an ID', () => {
  const c = scanned();
  assert.deepEqual(c.sections.map(s => s.label).sort(), ['E106', 'N102'], 'S202 has nothing of yours');
  assert.equal(c.expiresAt - c.at, M.COMPARE_TTL);
  const e106 = c.sections.find(s => s.label === 'E106');
  assert.deepEqual(e106.rows.map(r => r.id).sort(), ['', '', '1001', '1002']);
  assert.deepEqual(M.compareMine(c).map(x => x.row.id).sort(), ['1001', '1002', '1003']);
});

test('pack and unpack round trip, with clear errors', () => {
  const c = scanned();
  const text = 'some chat noise\n' + M.packCompare(c);
  assert.deepEqual(M.unpackCompare(text, 2000), c, 'found inside other text');
  assert.throws(() => M.unpackCompare('hello', 2000), /not a Seat Tracker event scan/);
  assert.throws(() => M.unpackCompare(M.packCompare(c).slice(0, 60), 2000), /cut short/);
  assert.throws(() => M.unpackCompare(M.packCompare(c), c.expiresAt + 1), /expired/);
  assert.equal(M.compareLive(c, c.expiresAt - 1), true);
  assert.equal(M.compareLive(c, c.expiresAt), false);
});

test('compareStanding: rank among every listing of the section and the gap to the cheapest other', () => {
  const c = scanned();
  assert.deepEqual(M.compareStanding(c, '1001'), { section: 'E106', rank: 2, listings: 4, gap: 5, price: 60, currency: 'USD', cheapestOther: 55, alone: false });
  assert.equal(M.compareStanding(c, '1002').rank, 4);
  const n102 = M.compareStanding(c, '1003');
  assert.equal(n102.gap, null);
  assert.equal(n102.alone, true, 'alone in its section');
  assert.equal(M.compareStanding(c, '999'), null, 'a listing that scan never saw');
});

/* signed out: no IDs, other prices; the rows are read in viagogo's own order */
const anon = (i, section, sprite, price, extra) => Object.assign({ id: 'x' + i, index: i, sprite, zone: '26127', section, row: '', price, currency: 'USD', mine: false, sold: false, anon: true, qtyMin: 1, qtyMax: 2, features: [] }, extra);
const OUT = [
  anon(0, 'E106', '1844501', 50),
  anon(1, 'E106', '1844501', 63, { row: 'ALB', qtyMin: 1, qtyMax: 6, features: ['Aisle seat'] }),   // 1001, unique and with a row
  anon(2, 'E106', '1844501', 72, { qtyMin: 2, qtyMax: 4 }),                                         // 1002 — but no row
  anon(3, 'E106', '1844501', 74, { qtyMin: 2, qtyMax: 4 }),                                         // ...and a twin
  anon(4, 'S202', '1844533', 15)
];

test('matchSignedOut: very strong is mine, the rest possible, nothing at all is hidden', () => {
  const m = M.matchSignedOut(scanned(), OUT, {}, true);
  const by = id => m.listings.find(l => l.id === id);
  assert.equal(by('1001').status, 'mine', 'row, quantity and features match only each other');
  assert.equal(by('1001').how, 'fingerprint');
  assert.equal(m.rows.x1.status, 'mine');
  assert.equal(by('1002').status, 'possible', 'no row and two lookalikes: only possibly');
  assert.deepEqual(by('1002').matches.map(r => r.id), ['x2', 'x3']);
  assert.equal(m.rows.x2.status, 'possible');
  assert.equal(by('1003').status, 'hidden', 'N102 shows nothing like it signed out');
  assert.equal(m.rows.x4, undefined, 'a section you do not list in is not looked at');
  assert.equal(M.matchSignedOut(scanned(), OUT, {}, false).listings.find(l => l.id === '1003').status, 'unseen',
    'a scan that stopped early cannot call anything hidden');
});

test('matchSignedOut: what you confirm wins, and the numbers follow', () => {
  const first = M.matchSignedOut(scanned(), OUT, {}, true);
  const yes = { [first.rows.x3.key]: 'yes' };
  const m = M.matchSignedOut(scanned(), OUT, yes, true);
  assert.equal(m.rows.x3.status, 'mine');
  assert.equal(m.rows.x3.how, 'you');
  assert.equal(m.listings.find(l => l.id === '1002').status, 'mine');
  assert.equal(m.rows.x2.status, 'other', 'its twin is someone else once you said which is yours');
  const p = M.placeOf(OUT[3], OUT, m);
  assert.deepEqual([p.position, p.of, p.rank, p.listings, p.gap, p.cheapestOther], [4, 5, 4, 4, 24, 50]);

  const no = { [first.rows.x1.key]: 'no' };
  const n = M.matchSignedOut(scanned(), OUT, no, true);
  assert.equal(n.rows.x1.status, 'other', 'a strong match you rejected is not yours');
  assert.equal(n.listings.find(l => l.id === '1001').status, 'hidden');
});

test('your own cards: "Your listing - …" and, since 2026-11, "Your tickets - …"', () => {
  const V = SK.viagogo;
  assert.equal(V.isMineLabel('Your listing - 13981313702'), true);
  assert.equal(V.isMineLabel('Your tickets - 14625523298'), true);
  assert.equal(V.isMineLabel('  your ticket - 1'), true);
  assert.equal(V.isMineLabel('Fan favourite'), false);
  assert.equal(V.isMineLabel('Only 1 left'), false);
  assert.equal(V.isMineLabel(''), false);
});

test('readRows: a signed-out row with no listing ID still counts', () => {
  if (typeof document !== 'undefined') return;
  /* the reader keys a row without data-listing-id by its place in the list */
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../core/viagogo.js'), 'utf8');
  assert.ok(/a\.ensemble_listingCard__root/.test(src), 'the card itself is a row');
  assert.ok(/`x\$\{a\.getAttribute\('data-index'\) \|\| out\.length\}`/.test(src), 'and gets a stand-in key');
});

test('instant download: the label in the details or the tags, any case; only those rows and their sections stay', () => {
  const r = (id, section, extra) => Object.assign({ id, section, price: 50, qtyMax: 2, features: [], tags: [] }, extra);
  assert.equal(M.isInstant(r('1', 'E1', { features: ['Instant Download'] })), true);
  assert.equal(M.isInstant(r('2', 'E1', { tags: ['instant download'] })), true);
  assert.equal(M.isInstant(r('3', 'E1', { features: ['Aisle seat'], tags: ['Fan favourite'] })), false);
  const store = M.emptyStore('1');
  M.putSection(store, { label: 'E1' }, [r('1', 'E1', { features: ['Instant Download'], qtyMax: 4 }), r('3', 'E1')], true, 1);
  M.putSection(store, { label: 'E2' }, [r('4', 'E2')], true, 1);
  const only = M.onlyInstant(store);
  assert.deepEqual(Object.keys(only.sections), ['name:E1'], 'a section with no instant listing drops out');
  assert.deepEqual(only.sections['name:E1'].rows.map(x => x.id), ['1']);
  const t = M.totals(only);
  assert.equal(t.listings, 1);
  assert.equal(t.tickets, 4);
  assert.equal(Object.keys(store.sections).length, 2, 'the scan itself is untouched');
  /* a row the caller keeps (yours, Bought) stays without the label */
  const kept = M.onlyInstant(store, x => x.id === '4');
  assert.deepEqual(Object.keys(kept.sections).sort(), ['name:E1', 'name:E2']);
  assert.equal(M.totals(kept).listings, 2);
});

test('quantity: a range sells every number in it, a single quantity only that one', () => {
  const r = (qtyMin, qtyMax) => ({ qtyMin, qtyMax });
  assert.equal(M.fitsQty(r(1, 10), 2), true, '1 - 10 together: 2 fits');
  assert.equal(M.fitsQty(r(1, 10), 10), true);
  assert.equal(M.fitsQty(r(1, 10), 11), false);
  assert.equal(M.fitsQty(r(4, 4), 2), false, '4 tickets: 2 does not fit');
  assert.equal(M.fitsQty(r(4, 4), 4), true, '4 tickets: 4 does');
  assert.equal(M.fitsQty(r(null, 6), 6), true, 'only a top read: that number');
  assert.equal(M.fitsQty(r(null, null), 2), false, 'quantity never read: never fits a number');
  assert.equal(M.fitsQty(r(null, null), 0), true, 'any: everything');
  assert.equal(M.fitsQty(r(1, 1), 'single'), true, 'single: exactly one ticket');
  assert.equal(M.fitsQty(r(null, 1), 'single'), true);
  assert.equal(M.fitsQty(r(1, 4), 'single'), false, 'single: not a 1 - 4 that also sells one');
  assert.equal(M.fitsQty(r(1, 10), 'single'), false);
  assert.equal(M.fitsQty(r(1, 12), 'over10'), true, '10+: more than 10');
  assert.equal(M.fitsQty(r(14, 14), 'over10'), true);
  assert.equal(M.fitsQty(r(1, 10), 'over10'), false, '10+: 10 is not more than 10');
  assert.equal(M.fitsQty(r(null, null), 'over10'), false);
  assert.equal(M.qtyWords('single'), 'are single tickets');
  assert.equal(M.qtyWords('over10'), 'sell more than 10 tickets');
  assert.equal(M.qtyWords(2), 'sell 2 tickets');
});

test('by price: every section together, cheapest first, sold and unpriced left out, filtered by quantity', () => {
  const sec = (key, label, rows) => ({ key, label, rows });
  const list = [
    sec('a', 'E101', [{ id: '1', price: 30, qtyMin: 1, qtyMax: 10 }, { id: '2', price: 12, qtyMin: 4, qtyMax: 4, sold: true }]),
    sec('b', 'N102', [{ id: '3', price: 20, qtyMin: 4, qtyMax: 4 }, { id: '4', price: 0, qtyMin: 1, qtyMax: 2 }]),
    sec('c', 'S202', [{ id: '5', price: 20, qtyMin: 2, qtyMax: 2 }])
  ];
  assert.deepEqual(M.byPrice(list, 0).map(r => r.id + r.label), ['3N102', '5S202', '1E101']);
  assert.deepEqual(M.byPrice(list, 2).map(r => r.id), ['5', '1'], '2 tickets: the pair and the 1 - 10');
  assert.deepEqual(M.byPrice(list, 4).map(r => r.id), ['3', '1'], '4 tickets: the four and the 1 - 10');
});

/* ---------------- saved scans and what changed ---------------- */

const storeOf = (rows, at, complete) => {
  const store = M.emptyStore('161613516');
  M.putAll(store, rows, complete !== false, at);
  return store;
};
const q = (min, max) => ({ qtyMin: min, qtyMax: max });

test('a saved scan keeps every listing, slimmed, and says whether it was signed in', () => {
  const snap = M.snapshotOf(storeOf([row('1', '10', 'E101', 20, false, q(1, 4)), row('2', '11', 'N102', 30, true, q(2, 2))], 1000), { name: 'Albania v Serbia' }, 2000);
  assert.equal(snap.at, 1000, 'the time of the scan, not of the save');
  assert.equal(snap.savedAt, 2000);
  assert.equal(snap.rows.length, 2);
  assert.equal(snap.signedIn, true);
  assert.deepEqual(Object.keys(snap.rows[0]).sort(), ['anon', 'currency', 'features', 'id', 'k', 'label', 'mine', 'price', 'qtyMax', 'qtyMin', 'row', 'sold'].sort());
  const out = M.snapshotOf(storeOf([row('x0', '10', 'E101', 20, false, { anon: true })], 1000), {}, 2000);
  assert.equal(out.signedIn, false, 'no row with an ID: signed out');
});

test('signed in: new, removed, price and ticket changes are found by listing ID', () => {
  const a = M.snapshotOf(storeOf([
    row('1', '10', 'E101', 20, false, q(1, 4)),
    row('2', '10', 'E101', 25, false, q(2, 2)),
    row('3', '11', 'N102', 40, false, q(4, 4)),
    row('4', '12', 'S202', 50, false, q(2, 2))
  ], 1000), {});
  const b = M.snapshotOf(storeOf([
    row('1', '10', 'E101', 18, false, q(1, 4)),   // cheaper
    row('2', '10', 'E101', 25, false, q(1, 1)),   // sold one
    row('3', '11', 'N102', 45, false, q(4, 4)),   // dearer
    row('5', '11', 'N102', 39, false, q(2, 2)),   // new
    row('6', '13', 'W104', 60, false, q(2, 2))    // new, in a section that had none
  ], 5000), {});
  const d = M.diffScans(a, b);
  assert.equal(d.comparable, true);
  assert.deepEqual(d.changes.filter(c => c.kind === 'new').map(c => c.b.id).sort(), ['5', '6']);
  assert.deepEqual(d.changes.filter(c => c.kind === 'gone').map(c => c.a.id), ['4']);
  const byId = id => d.changes.find(c => c.kind === 'changed' && c.b.id === id);
  assert.equal(byId('1').delta, -2);
  assert.equal(byId('1').qty, null);
  assert.equal(byId('2').delta, 0);
  assert.deepEqual([byId('2').qty.from.qtyMax, byId('2').qty.to.qtyMax], [2, 1]);
  assert.equal(byId('3').delta, 5);
  assert.equal(d.totals.added, 2);
  assert.equal(d.totals.addedTickets, 4);
  assert.equal(d.totals.removed, 1);
  assert.equal(d.totals.removedTickets, 2);
  assert.deepEqual([d.totals.down, d.totals.up, d.totals.qty, d.totals.qtyLess], [1, 1, 1, 1]);
  const sec = k => d.sections.find(s => s.key === k);
  assert.equal(sec('12').status, 'gone');
  assert.equal(sec('13').status, 'new');
  assert.deepEqual([sec('10').a.cheapest, sec('10').b.cheapest], [20, 18]);
  assert.deepEqual([sec('11').a.listings, sec('11').b.listings, sec('11').added, sec('11').up], [1, 2, 1, 1]);
});

test('two listings with different IDs are never paired, even when they look the same', () => {
  const a = M.snapshotOf(storeOf([row('1', '10', 'E101', 20, false, q(2, 2))], 1000), {});
  const b = M.snapshotOf(storeOf([row('2', '10', 'E101', 20, false, q(2, 2))], 5000), {});
  const d = M.diffScans(a, b);
  assert.deepEqual(d.changes.map(c => c.kind).sort(), ['gone', 'new']);
});

test('signed out: rows have no ID, so they are paired by how they look — same price first, then in price order', () => {
  const anon = (i, sprite, section, price, extra) => row('x' + i, sprite, section, price, false, Object.assign({ anon: true }, extra));
  const a = M.snapshotOf(storeOf([
    anon(0, '10', 'E101', 20, Object.assign({ row: 'B' }, q(2, 2))),
    anon(1, '10', 'E101', 30, q(4, 4)),
    anon(2, '10', 'E101', 35, q(4, 4)),
    anon(3, '11', 'N102', 50, q(2, 2))
  ], 1000), {});
  const b = M.snapshotOf(storeOf([
    anon(0, '10', 'E101', 30, q(4, 4)),                          // the same as before
    anon(1, '10', 'E101', 32, q(2, 4)),                          // 35 came down to 32 and sells 2-4 now
    anon(2, '10', 'E101', 20, Object.assign({ row: 'B' }, q(2, 2)))
  ], 5000), {});
  const d = M.diffScans(a, b);
  assert.equal(d.totals.same, 2, 'row B at 20 and the listing at 30 did not change');
  const moved = d.changes.filter(c => c.kind === 'changed');
  assert.equal(moved.length, 1);
  assert.equal(moved[0].how, 'look');
  assert.equal(moved[0].delta, -3);
  assert.deepEqual([moved[0].qty.from.qtyMin, moved[0].qty.to.qtyMin], [4, 2]);
  assert.deepEqual(d.changes.filter(c => c.kind === 'gone').map(c => c.label), ['N102']);
});

test('a signed-in scan against a signed-out one says the prices cannot be compared; a partly read scan is flagged', () => {
  const a = M.snapshotOf(storeOf([row('1', '10', 'E101', 20)], 1000), {});
  const b = M.snapshotOf(storeOf([row('x0', '10', 'E101', 23, false, { anon: true })], 5000, false), {});
  const d = M.diffScans(a, b);
  assert.equal(d.comparable, false);
  assert.deepEqual(d.warnings.sort(), ['signed', 'toPartial']);
});

test('a sold row counts as gone', () => {
  const a = M.snapshotOf(storeOf([row('1', '10', 'E101', 20, false, q(2, 2))], 1000), {});
  const b = M.snapshotOf(storeOf([row('1', '10', 'E101', 20, false, Object.assign({ sold: true }, q(2, 2)))], 5000), {});
  assert.deepEqual(M.diffScans(a, b).changes.map(c => c.kind), ['gone']);
});

test('a saved scan goes to Supabase and back unchanged, and back into a store the views take', () => {
  const st = storeOf([row('1', '10', 'E101', 20, false, { qtyMin: 1, qtyMax: 4, tags: ['Instant Download'] }), row('2', '11', 'N102', 30, true, { qtyMin: 2, qtyMax: 2 }), row('3', '11', 'N102', 25, false, { sold: true })], 1000);
  const snap = M.snapshotOf(st, { name: 'Albania v Serbia', start: 'Sat 14 Nov' }, 2000);
  const rowOut = M.scanToRow(snap, { eventKey: 'ebileta:2160', by: 'Office PC' });
  assert.equal(rowOut.vg_event_id, snap.eventId);
  assert.equal(rowOut.listings, 2, 'a sold row is not for sale');
  assert.equal(rowOut.event_key, 'ebileta:2160');
  const back = M.scanFromRow(Object.assign({ id: 7, created_at: new Date(2000).toISOString() }, JSON.parse(JSON.stringify(rowOut))));
  assert.equal(back.at, snap.at);
  assert.equal(back.id, snap.id);
  assert.deepEqual(back.rows, snap.rows);
  assert.equal(back.by, 'Office PC');
  assert.equal(M.diffScans(snap, back).changes.length, 0);

  const again = M.storeOf(back);
  const view = M.sectionsView(again, { sort: 'section' });
  assert.deepEqual(view.map(s => [s.label, s.sum.listings]), [['E101', 1], ['N102', 1]]);
  assert.equal(M.totals(again).ownListings, 1);
  assert.equal(M.byPrice(view, 'single').length, 0);
  assert.equal(M.byPrice(view, 2).length, 2, '"1-4" sells 2, and so does "2"');
  assert.equal(Object.keys(M.onlyInstant(again).sections).join(), Object.keys(again.sections).find(k => again.sections[k].label === 'E101'), 'instant download read from the tags');
});

test('the newest two of what this PC kept and what Supabase has, one per scan time', () => {
  const s = at => ({ at, id: String(at), rows: [] });
  assert.deepEqual(M.mergeSaved([s(1), s(3)], [s(3), s(2), s(4)], 2).map(x => x.at), [3, 4]);
  assert.deepEqual(M.mergeSaved([s(5)], [], 2).map(x => x.at), [5]);
  assert.deepEqual(M.mergeSaved([s(1), s(2), s(3)], [], 0).map(x => x.at), [1, 2, 3], 'no cap');
  assert.equal(M.mergeSaved([], [{ at: 9, rows: null }], 2).length, 0, 'a list entry without its rows is no scan');
});
