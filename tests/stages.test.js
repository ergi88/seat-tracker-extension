/* Run with:  node --test tests/
 *
 * Ticket statuses: one per ticket, worked out from what is recorded; a
 * status set by hand holds until the facts move; when an event is over.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/util.js');
require('../core/profit.js');
require('../core/sales.js');
const SK = require('../core/stages.js');
const S = SK.stages;

const H = 3600000;
/* local times, as the PCs and phones read them */
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const EVENT = at(2026, 11, 20, 20, 45);
const BEFORE = at(2026, 11, 20, 12);
const AFTER = EVENT + 4 * H;
const getPaid = { id: 'S1', status: 'Get Paid' };
const complete = { id: 'S2', status: 'Complete' };

test('the stages, in order, with the Purchased group', () => {
  assert.deepEqual(S.KEYS, ['awaiting_tickets', 'ready', 'listed', 'reserved', 'sold', 'awaiting_payout', 'paid_out', 'done', 'sold_elsewhere', 'unsold']);
  assert.deepEqual(S.keysOf('purchased'), ['awaiting_tickets', 'ready']);
  assert.deepEqual(S.keysOf('listed'), ['listed']);
  assert.deepEqual(S.keysOf('nope'), []);
  assert.equal(S.label('paid_out'), 'Paid out');
  assert.equal(S.tone('unsold'), 'bad');
});

test('an event is over 3 hours after it starts; one known only by its day, when that day ends', () => {
  assert.equal(S.overAt(EVENT), EVENT + 3 * H);
  assert.equal(S.isOver(EVENT, EVENT + 3 * H - 1), false);
  assert.equal(S.isOver(EVENT, EVENT + 3 * H), true);
  const day = at(2026, 11, 20);
  assert.equal(S.overAt(day), at(2026, 11, 21), 'midnight = no time known: over at the end of the day');
  assert.equal(S.isOver(day, at(2026, 11, 20, 23, 59)), false);
  assert.equal(S.overAt(null), null);
  assert.equal(S.isOver(0, AFTER), false, 'no time: never over');
});

test('a sale\'s money: sold, awaiting payout after the event, paid out on Complete, done in a deposit', () => {
  assert.equal(S.saleStage(getPaid, { eventAt: EVENT, now: BEFORE }), 'sold');
  assert.equal(S.saleStage(getPaid, { eventAt: EVENT, now: AFTER }), 'awaiting_payout');
  assert.equal(S.saleStage(getPaid, { eventAt: null, now: AFTER }), 'sold', 'no event time: stays sold');
  assert.equal(S.saleStage(complete, { eventAt: EVENT, now: BEFORE }), 'paid_out', 'viagogo\'s word wins over the clock');
  assert.equal(S.saleStage(getPaid, { eventAt: EVENT, now: BEFORE, deposited: true }), 'done', 'a deposit is the last word');
});

test('a ticket\'s status, worked out from the furthest fact', () => {
  const st = f => S.ticketStatus(Object.assign({ eventAt: EVENT, now: BEFORE }, f)).key;
  assert.equal(st({ received: false }), 'awaiting_tickets');
  assert.equal(st({ received: true }), 'ready');
  assert.equal(st({ received: true, listed: true }), 'listed');
  assert.equal(st({ received: true, listed: true, reserved: true }), 'reserved');
  assert.equal(st({ received: true, sold: true, sale: getPaid }), 'sold');
  assert.equal(st({ received: true, sold: true, sale: getPaid, now: AFTER }), 'awaiting_payout');
  assert.equal(st({ received: true, sold: true, sale: complete, now: AFTER }), 'paid_out');
  assert.equal(st({ received: true, sold: true, sale: complete, deposited: true }), 'done');
  assert.equal(st({ received: true, sold: true, sale: null }), 'sold', 'a sale not read yet: still sold');
  assert.equal(st({ received: true, elsewhere: { lek: null } }), 'sold_elsewhere');
  assert.equal(st({ received: true, elsewhere: { lek: 9000 } }), 'done', 'what it brought is known');
  assert.equal(st({ received: true, unsold: true }), 'unsold');
});

test('badges: no PDF yet while it is on sale or sold; take it off', () => {
  const b = f => S.ticketStatus(Object.assign({ eventAt: EVENT, now: BEFORE }, f)).badges;
  assert.deepEqual(b({ received: false }), [], 'awaiting tickets says it already');
  assert.deepEqual(b({ received: false, listed: true }), ['no_pdf']);
  assert.deepEqual(b({ received: false, sold: true, sale: getPaid }), ['no_pdf']);
  assert.deepEqual(b({ received: false, sold: true, sale: getPaid, now: AFTER }), [], 'the event is over: too late to matter');
  assert.deepEqual(b({ received: true, sold: true, sale: getPaid, takeOff: true }), ['take_off']);
  assert.deepEqual(b({ received: false, listed: true, delivery: 'mobile' }), ['not_received'], 'a mobile-transfer ticket is not received, not missing a PDF');
  assert.deepEqual(S.DELIVERY.map(d => d.key), ['pdf', 'mobile']);
});

test('a status set by hand holds while the facts stay as they were, then goes', () => {
  const pinned = S.ticketStatus({ received: true, listed: true, pin: 'sold', pinnedOver: 'listed', now: BEFORE });
  assert.deepEqual([pinned.key, pinned.worked, pinned.pinned, pinned.stalePin], ['sold', 'listed', true, false]);
  const moved = S.ticketStatus({ received: true, sold: true, sale: getPaid, eventAt: EVENT, pin: 'sold', pinnedOver: 'listed', now: BEFORE });
  assert.deepEqual([moved.key, moved.pinned, moved.stalePin], ['sold', false, true], 'the sale came: the facts reached it, the pin goes');
  const back = S.ticketStatus({ received: true, pin: 'sold', pinnedOver: 'listed', now: BEFORE });
  assert.deepEqual([back.key, back.stalePin], ['ready', true], 'taken off the listing: the facts went the other way, the pin goes too');
  const behind = S.ticketStatus({ received: true, sold: true, sale: complete, pin: 'awaiting_payout', pinnedOver: 'paid_out', now: AFTER });
  assert.deepEqual([behind.key, behind.pinned], ['awaiting_payout', true], 'a pin can hold a ticket back (viagogo says paid, nothing came)');
  assert.equal(S.ticketStatus({ received: true, pin: 'nonsense', pinnedOver: 'ready' }).key, 'ready', 'an unknown pin is ignored');
});

test('counts add up', () => {
  assert.deepEqual(S.addCounts([{ listed: 2, sold: 1 }, { listed: 1, unsold: 0 }, null]), { listed: 3, sold: 1 });
});
