/* Run with:  node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/util.js');
require('../core/registry.js');
const SK = require('../core/viagogo.js');
const V = SK.viagogo;

/* what the "Listing confirmed" card of 14062612642 reads as */
const LISTING = {
  listing: '14062612642', qty: 10, section: 'S103',
  title: 'Albania vs San Marino - Nations League',
  venue: 'Air Albania Stadium (Arena Kombëtare), Tirana, Albania',
  when: '06 Oct Tue 20:45'
};

/* titles and dates as the sites write them */
const EVENTS = [
  { key: 'ebileta:2153', site: 'ebileta', title: 'Shqiperi - Bjellorusi', date: 'Sht 26 sht 2026 20:45', sectors: [] },
  { key: 'ebileta:2154', site: 'ebileta', title: 'Shqiperi - San Marino', date: 'Mar 06 tet 2026 20:45', sectors: [] },
  { key: 'posttick:amini', site: 'posttick', title: 'Max Amini - 27.11.2026 - 9:30 PM', date: '', sectors: [] }
];

test('dates: viagogo, eBileta (weekday first), Posttick, eFinity', () => {
  assert.deepEqual(V.parseWhen('06 Oct Tue 20:45'), { day: 6, month: 10, minutes: 20 * 60 + 45 });
  assert.deepEqual(V.parseWhen('06 OctTue20:45'), { day: 6, month: 10, minutes: 20 * 60 + 45 });
  /* "Mar" is Tuesday and "tet" October; "Sht" is both Saturday and September */
  assert.deepEqual(V.parseWhen('Mar 06 tet 2026 20:45'), { day: 6, month: 10, minutes: 20 * 60 + 45 });
  assert.deepEqual(V.parseWhen('Sht 26 sht 2026 20:45'), { day: 26, month: 9, minutes: 20 * 60 + 45 });
  assert.deepEqual(V.parseWhen('Max Amini - 27.11.2026 - 9:30 PM'), { day: 27, month: 11, minutes: 21 * 60 + 30 });
  assert.deepEqual(V.parseWhen('SENIDAH - SC Cair, 22.10.2026'), { day: 22, month: 10, minutes: null });
  assert.equal(V.parseWhen('10x e-ticket Section S103 Listing ID: 14062612642').day, null);
});

test('Albanian team names meet the English ones', () => {
  assert.deepEqual([...V.titleWords('Shqipëri - San Marino')], ['albania', 'san', 'marino']);
  assert.deepEqual([...V.titleWords('Albania vs San Marino - Nations League')], ['albania', 'san', 'marino']);
});

test('the viagogo listing finds its eBileta event by date and title', () => {
  assert.deepEqual(V.pickEvent(LISTING, EVENTS), { key: 'ebileta:2154', how: 'date and title' });
});

test('no tracked event on that date: nothing is guessed', () => {
  assert.equal(V.pickEvent(Object.assign({}, LISTING, { when: '07 Oct Wed 20:45' }), EVENTS), null);
});

test('two shows on one day: the time decides', () => {
  const shows = [
    { key: 'posttick:a', title: 'Max Amini - 27.11.2026 - 6:00 PM', date: '' },
    { key: 'posttick:b', title: 'Max Amini - 27.11.2026 - 9:30 PM', date: '' }
  ];
  assert.equal(V.pickEvent({ title: 'Max Amini', when: '27 Nov Fri 21:30' }, shows).key, 'posttick:b');
});

test('without dates it takes two shared title words', () => {
  const evs = [{ key: 'efinity:1', title: 'Senidah Cair', date: '' }];
  assert.equal(V.pickEvent({ title: 'Senidah Live', when: '' }, evs), null);
  assert.equal(V.pickEvent({ title: 'Senidah - Cair Arena', when: '' }, evs).key, 'efinity:1');
});

test('a remembered pairing wins', () => {
  assert.equal(V.listingKey(LISTING), 'albaniavssanmarinonationsleague|6.10');
  const events = EVENTS.map(e => (e.key === 'ebileta:2153' ? Object.assign({}, e, { viagogo: { events: [V.listingKey(LISTING)] } }) : e));
  assert.deepEqual(V.pickEvent(LISTING, events), { key: 'ebileta:2153', how: 'remembered' });
});

test('sector: exact code, ambiguous digits filter the list, remembered pairing', () => {
  const ev = {
    key: 'ebileta:2154', site: 'ebileta',
    sectors: [
      { id: '1597', code: 'S103', name: 'TRIBUNA S103' },
      { id: '1600', code: 'N103', name: 'TRIBUNA N103' },
      { id: '1601', code: 'E105', name: 'TRIBUNA E105' }
    ]
  };
  assert.deepEqual(V.sectorFor(ev, 'S103'), { code: 'S103', how: 'matched' });
  assert.deepEqual(V.sectorFor(ev, '103'), { code: '103', how: 'pick' });
  assert.deepEqual(V.sectorFor(ev, 'W103'), { code: '103', how: 'pick' });
  assert.deepEqual(V.sectorFor(Object.assign({}, ev, { viagogo: { sectors: { s103: '1600' } } }), 'S103'), { code: 'N103', how: 'remembered' });
  assert.deepEqual(V.sectorFor(Object.assign({}, ev, { sectors: [] }), 'S103'), { code: 'S103', how: 'waiting' });
  assert.deepEqual(V.sectorFor(null, 'S103'), { code: 'S103', how: 'no event' });
});

/* ---------------- a listing next to its request ------------------ */

const REQ = { num: 14, qty: 8, code: 'A3', eventKey: 'posttick:amini', done: false };
const CARD = { tickets: 8, section: '', title: '', when: '', status: 'Active' };

test('listingDiffs: nothing to say when the listing agrees', () => {
  assert.deepEqual(V.listingDiffs(CARD, REQ, EVENTS), []);
  assert.deepEqual(V.listingDiffs(CARD, null, EVENTS), []);
});

test('listingDiffs: fewer tickets is a warning that never says sold', () => {
  const d = V.listingDiffs(Object.assign({}, CARD, { tickets: 7 }), REQ, EVENTS);
  assert.equal(d.length, 1);
  assert.equal(d[0].key, 'tickets');
  assert.equal(d[0].level, 'warn');
  assert.equal(d[0].fixQty, 7);
  assert.equal(d[0].short, '7 vs 8 tickets');
  assert.doesNotMatch(d[0].text, /sold/i);
});

test('listingDiffs: more tickets than the request covers is the worse case', () => {
  const d = V.listingDiffs(Object.assign({}, CARD, { tickets: 9 }), REQ, EVENTS);
  assert.equal(d[0].level, 'bad');
  assert.equal(d[0].fixQty, 9);
});

test('listingDiffs: unknown ticket count says nothing', () => {
  assert.deepEqual(V.listingDiffs(Object.assign({}, CARD, { tickets: null }), REQ, EVENTS), []);
});

test('listingDiffs: listing no longer active while the request is open, and the reverse', () => {
  const off = V.listingDiffs(Object.assign({}, CARD, { status: 'Deactivated' }), REQ, EVENTS);
  assert.equal(off[0].key, 'status');
  assert.equal(off[0].level, 'warn');
  const done = V.listingDiffs(CARD, Object.assign({}, REQ, { done: true }), EVENTS);
  assert.equal(done[0].level, 'info');
});

test('listingDiffs: the listing looks like another tracked event', () => {
  const d = V.listingDiffs(Object.assign({}, CARD, { title: LISTING.title, when: LISTING.when }), REQ, EVENTS);
  assert.ok(d.some(x => x.key === 'event' && x.level === 'bad'));
});

test('listingDiffs: worst first', () => {
  const d = V.listingDiffs(Object.assign({}, CARD, { tickets: 7, title: LISTING.title, when: LISTING.when }), REQ, EVENTS);
  assert.deepEqual(d.map(x => x.level), ['bad', 'warn']);
  assert.equal(V.worstDiff(d), 'bad');
  assert.equal(V.worstDiff([]), '');
});

test('lastChange: the latest change of one field in the history', () => {
  const h = [{ at: 1, tickets: 8, price: 50 }, { at: 2, tickets: 8, price: 45 }, { at: 3, tickets: 7, price: 45 }];
  assert.deepEqual(V.lastChange(h, 'tickets'), { from: 8, to: 7, at: 3 });
  assert.deepEqual(V.lastChange(h, 'price'), { from: 50, to: 45, at: 2 });
  assert.equal(V.lastChange([{ at: 1, tickets: 8 }], 'tickets'), null);
  assert.equal(V.lastChange(undefined, 'tickets'), null);
});

test('pages are found behind a locale (/ww/…), as viagogo writes them since 2026-10', () => {
  const at = h => { const u = new URL(h); return { hostname: u.hostname, pathname: u.pathname, href: u.href }; };
  assert.equal(V.isConfirmedPage(at('https://sell.viagogo.com/ww/Secure/Pipeline/Sell/Confirmed?ID=aac67a7c')), true);
  assert.equal(V.isConfirmedPage(at('https://sell.viagogo.com/Secure/Pipeline/Sell/Confirmed?ID=aac67a7c')), true);
  assert.equal(V.isPricePage(at('https://sell.viagogo.com/ww/Secure/Pipeline/Sell/PriceDetails?ID=aac67a7c')), true);
  assert.equal(V.isListingsPage(at('https://my.viagogo.com/ww/listings/?activeTab=ACTIVE')), true);
  assert.equal(V.isListingsPage(at('https://my.viagogo.com/en-gb/listings')), true);
  assert.equal(V.isListingsPage(at('https://my.viagogo.com/ww/settings')), false);
  assert.equal(V.sweepUrl(at('https://my.viagogo.com/ww/listings/?search=1')), 'https://my.viagogo.com/ww/listings/?activeTab=ACTIVE%7CPENDING%7CDEACTIVATED%7CEXPIRED');
  assert.equal(V.localeOf('/ww/listings/'), '/ww');
  assert.equal(V.localeOf('/listings/'), '');
});
