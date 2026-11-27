/* Run with:  node --test tests/
 *
 * The alerts about the tickets you bought (core/ticketalerts.js): no
 * tickets yet 7 and 2 days before the event, a reservation left unconfirmed
 * for 48 hours, a sold ticket still on another active listing. Worked out
 * from what is recorded, never from a guess.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/util.js');
require('../core/viagogo.js');
require('../core/profit.js');
require('../core/sales.js');
require('../core/stages.js');
const SK = require('../core/ticketalerts.js');
const T = SK.ticketAlerts;

const H = 3600000, DAY = 24 * H;
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const EVENT = at(2026, 12, 1, 20, 45);
const NOW = at(2026, 11, 27, 12);              // 4.4 days before: the 7-day step
const NEAR = at(2026, 11, 30, 12);             // 1.4 days before: the 2-day step
const ME = 'u-me', THEM = 'u-them';

const events = {
  'eb:1': { key: 'eb:1', title: 'Albania - Serbia', date: '', sectors: [{ id: '10', code: 'W105' }],
    extra: { info: { name: 'Albania - Serbia', date: '2026-12-01', time: '20:45' } } }
};
const listing = (id, o) => Object.assign({ id, userId: ME, eventKey: 'eb:1', vgEventId: '', status: 'Active', tickets: 2, when: '', title: 'Albania - Serbia', section: 'W105', row: '5' }, o);
const purchase = (id, o) => Object.assign({ id, userId: ME, eventKey: 'eb:1', vgEventId: '', eventTitle: '', section: '', sectorId: '10', qty: 4, assigned: {}, frozen: false }, o);
const ticket = (id, pid, o) => Object.assign({
  id, userId: ME, purchaseId: pid, page: Number(String(id).replace(/\D/g, '')) || 0, sectorText: '', row: '5', seat: String(id).replace(/\D/g, ''),
  eventAt: 0, saleId: null, reservationId: null, delivery: 'pdf', receivedAt: 0, filePath: '', fileGoneAt: 0, createdAt: 0
}, o);
const byId = list => Object.fromEntries(list.map(o => [o.id, o]));
const run = over => Object.assign({ purchases: {}, tickets: {}, links: [], listings: {}, sales: {}, reservations: {}, events, me: ME, now: NOW }, over);
const four = (o = {}) => [1, 2, 3, 4].map(i => ticket('t' + i, 'p1', o['t' + i]));

test('no tickets: nothing while the event is more than 7 days away', () => {
  const far = run({ purchases: byId([purchase('p1')]), tickets: byId(four()), now: EVENT - 8 * DAY });
  assert.deepEqual(T.noTickets(far), []);
});

test('no tickets, 7 days before: one alert for the event, mild when none of them is on sale', () => {
  const out = T.noTickets(run({ purchases: byId([purchase('p1')]), tickets: byId(four()) }));
  assert.equal(out.length, 1);
  const a = out[0];
  assert.deepEqual([a.type, a.key, a.step, a.missing, a.sold, a.listed], ['noTickets', 'notix:eb:1:7', 7, 4, 0, 0]);
  const msg = T.message('noTickets', [a]);
  assert.equal(msg.title, 'No tickets yet · in 4 days');
  assert.equal(msg.priority, 4);
  assert.match(msg.message, /^Albania - Serbia · Tue 1 Dec 20:45\nW105 · 4 no PDF yet\n/);
});

test('no tickets, 2 days before: the 2-day step, worse when some are sold or listed', () => {
  const tickets = four({
    t1: { saleId: 'S1' },                       // sold
    t2: {},                                     // listed (linked to an active listing)
    t3: { filePath: 'u/p1/3.pdf' },             // here: never counts
    t4: { delivery: 'mobile' }                  // a mobile transfer not received
  });
  const x = run({
    purchases: byId([purchase('p1')]), tickets: byId(tickets), now: NEAR,
    listings: byId([listing('L1')]), links: [{ listingId: 'L1', ticketId: 't2' }],
    sales: byId([{ id: 'S1', userId: ME, listingId: 'L9', tickets: 1 }])
  });
  const [a] = T.noTickets(x);
  assert.deepEqual([a.key, a.step, a.missing, a.mobile, a.sold, a.listed], ['notix:eb:1:2', 2, 3, 1, 1, 1]);
  const msg = T.message('noTickets', [a]);
  assert.equal(msg.title, 'Sold, no tickets yet · in 1 day');
  assert.equal(msg.priority, 5, 'worse: the phone rings louder');
  assert.match(msg.message, /W105 · 2 no PDF yet, 1 not received \(1 sold or reserved, 1 listed\)/);
});

test('no tickets: a reserved one counts as on sale; one sold elsewhere does not count at all', () => {
  const tickets = four({ t1: { reservationId: 'R1' } });
  const x = run({
    purchases: byId([purchase('p1', { assigned: { other: [{ id: 'o1', qty: 1, tickets: ['t2'] }] } })]),
    tickets: byId(tickets), listings: byId([listing('L1')]),
    reservations: byId([{ id: 'R1', userId: ME, listingId: 'L1', tickets: 1, confirmedAt: 0, createdAt: NOW - H }])
  });
  const [a] = T.noTickets(x);
  assert.deepEqual([a.missing, a.sold], [3, 1]);
});

test('no tickets: a counted lot goes by its numbers, a frozen one never counts', () => {
  const x = run({
    purchases: byId([
      purchase('p2', { qty: 3, assigned: { listings: { L1: 2 }, other: [{ id: 'o1', qty: 1 }] } }),
      purchase('p3', { qty: 5, frozen: true })
    ]),
    listings: byId([listing('L1')])
  });
  const [a] = T.noTickets(x);
  assert.deepEqual(a.lots, [{ code: 'W105', missing: 2, mobile: 0, sold: 0, listed: 1, exact: false }]);
  assert.match(T.message('noTickets', [a]).message, /W105 · 2 no PDF yet \(listed\)/);
  assert.equal(T.message('noTickets', [a]).title, 'Listed, no tickets yet · in 4 days');
});

test('no tickets: every ticket here, someone else\'s, no time known or the event started: nothing', () => {
  const here = four({ t1: { receivedAt: NOW }, t2: { filePath: 'a' }, t3: { fileGoneAt: NOW }, t4: { delivery: 'mobile', receivedAt: NOW } });
  assert.deepEqual(T.noTickets(run({ purchases: byId([purchase('p1')]), tickets: byId(here) })), []);
  const theirs = run({ purchases: byId([purchase('p1', { userId: THEM })]), tickets: byId(four().map(t => Object.assign(t, { userId: THEM }))) });
  assert.deepEqual(T.noTickets(theirs), []);
  const undated = run({ purchases: byId([purchase('p9', { eventKey: null, vgEventId: '555', eventTitle: 'Somebody live' })]) });
  assert.deepEqual(T.noTickets(undated), [], 'nothing to count down to');
  assert.deepEqual(T.noTickets(run({ purchases: byId([purchase('p1')]), tickets: byId(four()), now: EVENT + H })), [], 'too late to warn');
});

test('no tickets: a viagogo event nobody tracks takes its time and name from your listings on it', () => {
  const x = run({
    purchases: byId([purchase('p9', { eventKey: null, vgEventId: '777', eventTitle: 'Concert X', section: 'A1', sectorId: null, qty: 2 })]),
    listings: byId([listing('L7', { eventKey: null, vgEventId: '777', when: '2026-12-01 20:45', title: 'Concert X live', status: 'Deactivated' })])
  });
  const [a] = T.noTickets(x);
  assert.deepEqual([a.key, a.name, a.at], ['notix:vg:777:7', 'Concert X live', EVENT]);
  assert.match(T.message('noTickets', [a]).message, /\nA1 · 2 no PDF yet\n/);
});

test('reserved too long: once 48 hours have passed with no Confirm, and only yours', () => {
  const r = (id, o) => Object.assign({ id, userId: ME, listingId: 'L1', tickets: 2, seats: '5-6', confirmedAt: 0, createdAt: NOW - 49 * H }, o);
  const x = run({
    listings: byId([listing('L1')]),
    reservations: byId([r('R1'), r('R2', { createdAt: NOW - 47 * H }), r('R3', { confirmedAt: NOW - H }), r('R4', { listingId: 'gone' }), r('R5', { userId: THEM })])
  });
  const out = T.reservedLong(x);
  assert.deepEqual(out.map(a => [a.type, a.key]), [['reservedLong', 'reserved48:R1']]);
  const msg = T.message('reservedLong', out);
  assert.equal(msg.title, 'Reservation not confirmed · W105');
  assert.match(msg.message, /W105 · row 5 · listing L1 · 2 tickets · seats 5-6/);
  assert.match(msg.click, /my\.viagogo\.com\/listings\/\?search=L1/);
  assert.equal(msg.priority, 4);
});

test('take it off: a ticket sold, still on another active listing; never its own sale\'s, never one ended', () => {
  const tickets = four({ t1: { saleId: 'S1' } });
  const x = run({
    purchases: byId([purchase('p1')]), tickets: byId(tickets),
    listings: byId([listing('L1', { when: '2026-12-01 20:45' }), listing('L2'), listing('L3', { status: 'Deactivated' })]),
    sales: byId([{ id: 'S1', userId: ME, listingId: 'L1', tickets: 1 }]),
    links: [{ listingId: 'L1', ticketId: 't1' }, { listingId: 'L2', ticketId: 't1' }, { listingId: 'L3', ticketId: 't1' }]
  });
  assert.deepEqual(T.takeOff(x).map(a => a.key), ['takeoff:t1:L2']);
});

test('take it off: sold elsewhere counts too; a sale that never said which tickets is not a guess here', () => {
  const tickets = four({ t1: { saleId: 'S1' } });
  const x = run({
    purchases: byId([purchase('p1', { assigned: { other: [{ id: 'o1', qty: 1, tickets: ['t2'] }] } })]),
    tickets: byId(tickets),
    listings: byId([listing('L1'), listing('L2')]),
    sales: byId([{ id: 'S1', userId: ME, listingId: 'L1', tickets: 1 }, { id: 'S2', userId: ME, listingId: 'L2', tickets: 1 }]),
    links: [{ listingId: 'L2', ticketId: 't1' }, { listingId: 'L2', ticketId: 't2' }, { listingId: 'L1', ticketId: 't3' }, { listingId: 'L2', ticketId: 't3' }]
  });
  const out = T.takeOff(x);
  assert.deepEqual(out.map(a => [a.key, a.elsewhere]), [['takeoff:t1:L2', false], ['takeoff:t2:L2', true]],
    't3 is on two listings and S2 sold on one, but nothing says S2 took t3');
  const msg = T.message('takeOff', out);
  assert.equal(msg.title, 'Take it off · 2 tickets');
  assert.match(msg.message, /^Albania - Serbia\nW105 row 5 seat 1: sold \(sale S1\), still on listing L2 \(Active\)\nW105 row 5 seat 2: sold elsewhere, still on listing L2 \(Active\)\n/);
  assert.match(msg.click, /search=L2/, 'one listing: the button opens it');
  assert.equal(msg.priority, 5);
  assert.deepEqual(T.takeOff(Object.assign({}, x, { now: EVENT + 4 * H })), [], 'once the event is over there is nothing to take off');
});

test('the texts: when an event is, and how long until it', () => {
  assert.equal(T.whenText(EVENT), 'Tue 1 Dec 20:45');
  assert.equal(T.whenText(at(2026, 12, 1)), 'Tue 1 Dec', 'known only by its day');
  assert.equal(T.leftText(5 * H), 'in 5 hours');
  assert.equal(T.leftText(30 * 60000), 'in 1 hour');
  assert.equal(T.leftText(7 * DAY), 'in 7 days');
  assert.equal(T.leftText(DAY + H), 'in 1 day');
});
