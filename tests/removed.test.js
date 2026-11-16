/* Run with:  node --test tests/
 *
 * eBileta takes a sector off the event page (and its polygon off the map) a
 * few days after it sells out. The event keeps it, with its price and its
 * outline, and gets back the ones it lost before it kept them.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function worker() {
  const src = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const listed = [...(/importScripts\(([\s\S]*?)\);/.exec(src)[1]).matchAll(/'([^']+)'/g)].map(m => m[1]);
  const anything = () => new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : anything()), apply: () => anything(), has: () => true
  });
  const sandbox = { chrome: anything(), fetch: anything(), navigator: { onLine: true }, console, importScripts: () => {} };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of listed.concat('background.js')) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const W = worker();

const shape = points => ({ points, vb: '0 0 1352 1100' });
const sec = (id, code, sm, extra) => ({ id, code, name: 'TRIBUNA ' + code, meta: Object.assign({ idSM: sm, tipoM: '1', status: 'high' }, extra) });

test('a removed sector keeps its last price and its outline; a lost one comes back from another event at the stadium', () => {
  const ev = { key: 'ebileta:2174', site: 'ebileta', sectors: [sec('11', 'N101', '1300', { shape: shape('1,1 2,2 3,3') }), sec('12', 'N102', '1300')] };
  const other = { key: 'ebileta:2200', site: 'ebileta', sectors: [sec('15', 'E106', '1400', { shape: shape('9,9 8,8 7,7') })] };
  const m = {
    events: { [ev.key]: ev, [other.key]: other },
    scanMeta: { [ev.key]: { 11: { summary: { available: 0, price: { min: 3000, max: 3000, currency: 'ALL' } } } } },
    /* tickets bought in E106 of 2174 before sectors were kept; a listing in a sector nobody knows */
    requests: [{ eventKey: ev.key, sec: '15' }, { eventKey: ev.key, sec: '12' }],
    listings: { L1: { eventKey: ev.key, sectorId: '77' } }
  };
  const out = W.mergeSectors(m, ev, [sec('12', 'N102', '1300')]);
  assert.deepEqual(out.map(s => [s.id, s.code, !!s.meta.gone]), [['12', 'N102', false], ['11', 'N101', true], ['15', 'E106', true]]);
  const n101 = out.find(s => s.id === '11');
  assert.deepEqual(n101.meta.price, { min: 3000, max: 3000, currency: 'ALL' }, 'its price from the last scan');
  assert.equal(n101.meta.shape.points, '1,1 2,2 3,3', 'and its outline on the map');
  const e106 = out.find(s => s.id === '15');
  assert.equal(e106.meta.idSM, '1300', 'the lost one belongs to this event\'s seating map');
  assert.equal(e106.meta.shape.points, '9,9 8,8 7,7', 'with the other event\'s outline');
  assert.equal(e106.meta.status, 'soldout');
  assert.ok(!out.some(s => s.id === '77'), 'a sector no event knows stays unknown');

  /* the next load changes nothing: nothing is written again */
  ev.sectors = out;
  assert.equal(JSON.stringify(W.mergeSectors(m, ev, [sec('12', 'N102', '1300')])), JSON.stringify(out));
});

/* ---------------- a removed sector saved by hand from the viagogo drawer ---------------- */

function fakeRemote(m) {
  const calls = [];
  vm.runInContext('globalThis.__Remote = Remote', W);
  const R = W.__Remote;
  R.pull = async () => {};
  R.patchEvent = async (key, changes) => { calls.push(['patchEvent', key, changes]); Object.assign(m.events[key], changes); return m.events[key]; };
  R.saveSectorPrice = async row => { calls.push(['saveSectorPrice', row]); ((m.sectorPrices[row.event_key] = m.sectorPrices[row.event_key] || {}))[row.sector_id] = { amount: row.amount, currency: row.currency }; };
  R.deleteSectorPrice = async (key, id) => { calls.push(['deleteSectorPrice', key, id]); delete (m.sectorPrices[key] || {})[id]; };
  R.patchRequest = async (id, changes) => { calls.push(['patchRequest', id, changes]); };
  W.model = async () => m;
  return calls;
}

test('a section eBileta removed before it was kept is saved back with its real id from another event at the stadium, and priced', async () => {
  const ev = { key: 'ebileta:2174', site: 'ebileta', siteId: '2174', title: 'Shqiperi - Serbi', extra: { info: { name: 'Shqiperi - Serbi', venue: 'AIR ALBANIA STADIUM' } }, sectors: [sec('12', 'N102', '1300')] };
  const other = { key: 'ebileta:2153', site: 'ebileta', extra: { info: { name: 'Shqiperi - Bjellorusi', venue: 'AIR ALBANIA STADIUM' } }, sectors: [sec('31', 'N106', '1200', { shape: shape('4,4 5,5 6,6') })] };
  const m = { meId: 'me', events: { [ev.key]: ev, [other.key]: other }, sectorPrices: {}, requests: [], listings: {}, scanMeta: {} };
  const calls = fakeRemote(m);
  const r = await W.keepViagogoSector({ eventKey: ev.key, label: 'n 106', amount: '4500', currency: 'ALL' });
  assert.equal(r.how, 'twin');
  assert.equal(r.sectorId, '31');
  const n106 = ev.sectors.find(s => s.id === '31');
  assert.equal(n106.code, 'N106');
  assert.equal(n106.meta.idSM, '1300', 'on this event\'s seating map');
  assert.ok(n106.meta.gone && n106.meta.status === 'soldout', 'as a removed sector');
  assert.equal(n106.meta.shape.points, '4,4 5,5 6,6', 'with the outline the other event knows');
  assert.deepEqual(m.sectorPrices[ev.key]['31'], { amount: 4500, currency: 'ALL' }, 'the price goes on the price list');
  /* already there: only the price changes */
  calls.length = 0;
  const again = await W.keepViagogoSector({ eventKey: ev.key, label: 'N106', amount: 5000, currency: 'ALL' });
  assert.equal(again.how, 'there');
  assert.ok(!calls.some(c => c[0] === 'patchEvent'), 'the sector list is not written again');
  assert.equal(m.sectorPrices[ev.key]['31'].amount, 5000);
});

test('with no event knowing its id, a section gets a stand-in id and no seat page — and gives way to the real one when eBileta lists it again', async () => {
  const ev = { key: 'ebileta:2174', site: 'ebileta', siteId: '2174', title: 'Shqiperi - Serbi', extra: {}, sectors: [sec('12', 'N102', '1300')] };
  const m = { meId: 'me', events: { [ev.key]: ev }, sectorPrices: {}, requests: [], listings: {}, scanMeta: {} };
  const calls = fakeRemote(m);
  const r = await W.keepViagogoSector({ eventKey: ev.key, label: 'S202', amount: 0 });
  assert.equal(r.how, 'guessed');
  assert.equal(r.sectorId, 'vg:S202');
  const s202 = ev.sectors.find(s => s.id === 'vg:S202');
  assert.equal(W.SK.site('ebileta').sectorUrl(ev, s202), null, 'it has no seat page');
  assert.equal(r.price, null, 'no price typed: none set');
  await W.setSectorPrice({ eventKey: ev.key, sectorId: 'vg:S202', amount: 3800, currency: 'ALL' });
  m.requests.push({ id: 'r1', eventKey: ev.key, sec: 'vg:S202' });

  /* eBileta lists S202 again, under its real id */
  calls.length = 0;
  const out = W.mergeSectors(m, ev, [sec('12', 'N102', '1300'), sec('44', 'S202', '1300')]);
  assert.deepEqual(out.map(s => s.id), ['12', '44'], 'the stand-in is gone, not kept as removed');
  await new Promise(res => setTimeout(res, 20));
  assert.deepEqual(m.sectorPrices[ev.key], { 44: { amount: 3800, currency: 'ALL' } }, 'its price moved to the real id');
  assert.ok(calls.some(c => c[0] === 'patchRequest' && c[1] === 'r1' && c[2].sec === '44'), 'and so did the request in it');
});

test('a section with two different ids in the stadium\'s other events is not guessed', async () => {
  const ev = { key: 'ebileta:1', site: 'ebileta', extra: {}, sectors: [] };
  const a = { key: 'ebileta:2', site: 'ebileta', extra: { info: { venue: 'X' } }, sectors: [sec('31', 'N106', '1')] };
  const b = { key: 'ebileta:3', site: 'ebileta', extra: { info: { venue: 'Y' } }, sectors: [sec('99', 'N106', '2')] };
  const m = { events: { [ev.key]: ev, [a.key]: a, [b.key]: b } };
  assert.equal(W.twinSector(m, ev, 'N106'), null);
});
