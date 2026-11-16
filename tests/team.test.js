/* Run with:  node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/util.js');
require('../core/profit.js');
const SK = require('../core/team.js');
const T = SK.team;

const now = Date.UTC(2026, 8, 20);
const day = 24 * 3600 * 1000;

/* a teammate's listing, as the team_prices view gives it */
const mate = (listingId, owner, section, price, extra) => Object.assign(
  { listingId, owner, userId: 'u-' + owner, eventKey: 'ebileta:2153', sectorId: null, section, row: '', price, currency: 'USD', tickets: null, status: 'active', seenAt: now - 3600000 },
  extra
);
/* a row as the event page gives it */
const row = (id, price, extra) => Object.assign({ id, price, row: '', qtyMin: 1, qtyMax: 4, left: null, mine: false, sold: false }, extra);

const state = tps => ({ teamPrices: tps });

test('teammates in a section: the event decides, the section name alone never does', () => {
  const tps = [mate('a', 'Sam Rivers', 'E105', 110), mate('b', 'Ana', 'E106', 90),
    mate('c', 'Ana', 'E105', 120, { eventKey: 'ebileta:2154' })];
  const here = T.teamAt(state(tps), { eventKey: 'ebileta:2153', section: 'Section E105' }, now);
  assert.deepEqual(here.map(t => t.owner), ['Sam Rivers'], 'only this event, only this section');
  assert.deepEqual(T.teamAt(state(tps), { section: 'E105' }, now), [], 'without an event key, nothing');
  assert.deepEqual(T.teamAt(state(tps), { eventKey: 'ebileta:2153', section: 'E404' }, now), []);
});

test('sold and old listings: sold ones are dropped, old ones are kept but marked', () => {
  const tps = [mate('a', 'Ergi', 'E105', 110, { status: 'SOLD' }), mate('b', 'Ana', 'E105', 90, { seenAt: now - 30 * day })];
  const here = T.teamAt(state(tps), { eventKey: 'ebileta:2153', section: 'E105' }, now);
  assert.deepEqual(here.map(t => [t.owner, t.stale]), [['Ana', true]]);
});

test('a teammate row is found by its row label or its ticket count, never by price', () => {
  const team = [mate('t1', 'Ergi', 'E105', 110, { row: 'ALB', tickets: 4 })];
  const rows = [row('r1', 54), row('r2', 67, { row: 'ALB' }), row('r3', 71)];
  const who = T.whoIsHere(rows, team);
  assert.equal(who.byRow.r2 && who.byRow.r2.owner, 'Ergi', 'the row label wins, though $67 is nothing like their $110');
  assert.equal(who.others, 2);
  assert.equal(who.teamOnly, false);

  /* no row label on the page: the tickets left do it instead */
  const byQty = T.whoIsHere([row('r1', 54, { left: 4 }), row('r2', 67)], team);
  assert.equal(byQty.byRow.r1 && byQty.byRow.r1.owner, 'Ergi');

  /* a row that says a different row is never theirs */
  const wrongRow = T.whoIsHere([row('r1', 67, { row: 'B', left: 4 })], [mate('t1', 'Ergi', 'E105', 110, { row: 'ALB', tickets: 4 })]);
  assert.deepEqual(wrongRow.byRow, {});
  assert.equal(wrongRow.others, 1);
});

test('only our team here: matched rows and yours, with the rest counted', () => {
  const team = [mate('t1', 'Ergi', 'E105', 110, { row: 'ALB', tickets: 4 }), mate('t2', 'Ana', 'E105', 120 )];
  const rows = [row('mine', 67, { mine: true }), row('r2', 71, { row: 'ALB' }), row('r3', 80)];
  const who = T.whoIsHere(rows, team);
  assert.equal(who.matched, 1, 'Ergi is pinned to row ALB');
  assert.equal(who.assumed, 1, 'Ana could not be pinned, so one leftover row is taken to be hers');
  assert.equal(who.others, 0);
  assert.equal(who.teamOnly, true);
  assert.equal(who.cheapestOutside, null);
});

test('an old price never makes a busy section look like ours', () => {
  const team = [mate('t1', 'Ergi', 'E105', 110, { seenAt: now - 30 * day })];
  const who = T.whoIsHere([row('mine', 67, { mine: true }), row('r2', 71)], T.teamAt(state(team), { eventKey: 'ebileta:2153', section: 'E105' }, now));
  assert.equal(who.assumed, 0);
  assert.equal(who.others, 1, 'the leftover row counts as an outsider while their price is old');
  assert.equal(who.teamOnly, false);
  assert.equal(who.cheapestOutside, 71);
});

test('sold rows and rows without a price are ignored', () => {
  const who = T.whoIsHere([row('mine', 67, { mine: true }), row('gone', 20, { sold: true }), row('free', 0)], []);
  assert.equal(who.others, 0);
  assert.equal(who.teamOnly, true, 'you are alone once the sold one is left out');
});

test('two teammates are never pinned to the same row', () => {
  const team = [mate('t1', 'Ergi', 'E105', 110, { tickets: 4 }), mate('t2', 'Ana', 'E105', 120, { tickets: 4 })];
  const who = T.whoIsHere([row('r1', 54, { left: 4 }), row('r2', 60)], team);
  assert.equal(Object.keys(who.byRow).length, 1);
  assert.equal(who.matched + who.assumed, 2);
});
