/* Run with:  node --test tests/
 *
 * The eBileta checkout drawer's purchases come with their tickets: one row
 * per ticket the page lists, with its sector, row, seat and price, waiting
 * for its PDF (the app attaches it).
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
const lot = { id: 'p1', sector_id: '4207', currency: 'ALL', qty: 2 };
/* as the drawer reads them off the checkout page */
const page = [
  { place: 'TRIBUNA N104', row: 'Q', seat: '10', price: 1048, currency: 'ALL' },
  { place: 'TRIBUNA N104', row: 'Q', seat: '11', price: 1048.004, currency: 'XYZ' }
];

test('one ticket per seat on the page, with what the page says of it, no file yet', () => {
  const rows = JSON.parse(JSON.stringify(W.checkoutTicketRows(lot, page, 'me')));
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => /^t/.test(r.id)) && rows[0].id !== rows[1].id, 'each its own id');
  assert.deepEqual(rows.map(({ id, ...r }) => r), [
    { user_id: 'me', purchase_id: 'p1', page: 1, sector_text: 'TRIBUNA N104', sector_id: '4207', row_label: 'Q', seat: '10', price: 1048, currency: 'ALL' },
    { user_id: 'me', purchase_id: 'p1', page: 2, sector_text: 'TRIBUNA N104', sector_id: '4207', row_label: 'Q', seat: '11', price: 1048, currency: 'ALL' }
  ], 'the price rounded to cents; an unknown currency takes the lot\'s');
  assert.ok(rows.every(r => !('file_path' in r) && !('received_at' in r)), 'waiting for its PDF');
});

test('a seat the page did not show stays blank; a price it did not show is none', () => {
  const [r] = JSON.parse(JSON.stringify(W.checkoutTicketRows(Object.assign({}, lot, { sector_id: null }), [{ place: '', row: '', seat: '', price: null }], 'me')));
  assert.deepEqual([r.sector_text, r.sector_id, r.row_label, r.seat, r.price, r.currency], ['', null, '', '', null, 'ALL']);
});
