/* Run with:  node --test tests/
 *
 * Face values handed from a ticket site to a viagogo event. Nothing ties an
 * eFinity page to a viagogo event, so a stadium read travels as a code: it
 * must come back exactly as it left, name the right sector for a viagogo
 * section, and turn dinars into dollars and multiples correctly.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SK = require(path.join(ROOT, 'core/util.js'));
require(path.join(ROOT, 'core/rules.js'));
require(path.join(ROOT, 'core/registry.js'));
require(path.join(ROOT, 'core/profit.js'));
require(path.join(ROOT, 'sites/efinity.js'));
require(path.join(ROOT, 'core/face.js'));
const F = SK.face;

const preview = {
  key: 'efinity:32286', site: 'efinity', siteId: '32286', title: 'Senidah – Čair', url: 'https://efinity.rs/event-map/senidah_cair_32286',
  at: 1760000000000, currency: 'RSD',
  sectors: {
    'A TRIBINE': { code: 'A TRIBINE', price: 3500, svgId: 's1', total: 400, available: 37, longest: 6 },
    'B TRIBINE': { code: 'B TRIBINE', price: 2500, svgId: 's2', total: 300, available: 0, longest: 0 },
    'PARTER': { code: 'PARTER', price: 2000, unmapped: true, note: 'standing area' },
    'BAR TABLES': { code: 'Bar Table', price: 9000, perTable: 6, total: 72, available: 12, longest: 6 },
    'NO PRICE': { code: 'NO PRICE', total: 10, available: 10, longest: 10 }
  }
};

test('a stadium read survives the trip as a code', () => {
  const face = F.fromPreview(preview);
  assert.equal(face.sectors.length, 4, 'sectors without a price are left behind');
  const back = F.unpack('  ' + F.pack(face) + '\n');
  assert.equal(back.title, 'Senidah – Čair', 'non-latin letters come back too');
  assert.equal(back.currency, 'RSD');
  assert.deepEqual(back.sectors.find(x => x.code === 'A TRIBINE'), { code: 'A TRIBINE', cat: '', price: 3500, available: 37, unmapped: false, longest: 6, total: 400, perTable: 0 });
  const standing = back.sectors.find(x => x.code === 'PARTER');
  assert.equal(standing.unmapped, true);
  assert.equal(standing.available, null, 'a standing area has no seat count, not zero');
  assert.equal(back.sectors.find(x => x.code === 'Bar Table').perTable, 6);
});

test('a bad code says so', () => {
  assert.throws(() => F.unpack('hello'), /not a face-value code/);
  assert.throws(() => F.unpack(F.PREFIX + 'abc%%'), /damaged/);
});

const pick = (face, label, manual) => { const m = SK.face.match(face, label, manual || {}); return [m.codes, m.how]; };

test('a viagogo section finds its sector', () => {
  const face = F.fromPreview(preview);
  assert.deepEqual(pick(face, 'A Tribine'), [['A TRIBINE'], 'matched']);
  assert.deepEqual(pick(face, 'Tribina B'), [['B TRIBINE'], 'matched'], 'the stand word can come first');
  assert.deepEqual(pick(face, 'Parter'), [['PARTER'], 'matched']);
  assert.deepEqual(pick(face, 'VIP Lounge'), [[], '']);
  /* a pick by hand wins, and "none" is a pick too */
  assert.deepEqual(pick(face, 'VIP Lounge', { VIPLOUNGE: 'Bar Table' }), [['Bar Table'], 'picked']);
  assert.deepEqual(pick(face, 'A Tribine', { ATRIBINE: '' }), [[], 'none']);
});

test('one viagogo section can be several sectors with their own prices', () => {
  const face = { site: 'efinity', sectors: ['210 RIGHT P', '210 LEFT K', '211', '213 DESNO', '213 LEVO', 'E 101', 'N103', 'S103', '014'].map(code => ({ code, price: 1 })) };
  assert.deepEqual(pick(face, '210'), [['210 RIGHT P', '210 LEFT K'], 'split'], 'viagogo\'s 210 is both halves of 210');
  assert.deepEqual(pick(face, 'Section 210'), [['210 RIGHT P', '210 LEFT K'], 'split']);
  assert.deepEqual(pick(face, '210 Left'), [['210 LEFT K'], 'matched'], 'a side on viagogo keeps only that side');
  assert.deepEqual(pick(face, '213 Right'), [['213 DESNO'], 'matched'], 'and sides are read in Serbian too');
  assert.deepEqual(pick(face, '211'), [['211'], 'matched']);
  assert.deepEqual(pick(face, 'E101'), [['E 101'], 'matched'], '"E 101" and "E101" are one name');
  assert.deepEqual(pick(face, '14'), [['014'], 'matched'], 'leading zeros do not matter');
  assert.deepEqual(pick(face, '103'), [[], ''], 'never a guess between N103 and S103');
  assert.deepEqual(pick(face, '210', { '210': '210 LEFT K' }), [['210 LEFT K'], 'picked'], 'a pick by hand narrows a split');
});

test('Posttick: one entry per price category inside a block', () => {
  const R = SK.rules;
  /* block B: row 1 is CAT 2 (seats 1-4, 2 and 3 free), row 2 is CAT 3 (all 3 free) */
  const seat = (row, n, cat, free) => ({ row, label: String(n), x: n * 10, y: row * 10, free, cat, id: `B-${row}-${n}` });
  const scans = {
    'Block B': R.packScan('Block B', [seat(1, 1, 2, false), seat(1, 2, 2, true), seat(1, 3, 2, true), seat(1, 4, 2, false), seat(2, 1, 3, true), seat(2, 2, 3, true), seat(2, 3, 3, true)], 'axis')
  };
  const cats = { 2: { key: '2', label: 'CAT 2', price: 145 }, 3: { key: '3', label: 'CAT 3', price: 119 }, 9: { key: '9', label: 'FREE', price: null } };
  const sectors = [{ id: 'Block B', code: 'B', name: 'Block B', meta: {} }, { id: 'Block C', code: 'C', name: 'Block C', meta: {} }];
  const face = F.build({ site: 'posttick', siteId: 'x/y', title: 'Max Amini', currency: 'EUR', at: 1 }, sectors, scans, cats);
  assert.deepEqual(face.sectors.map(x => [F.nameOf(x), x.price, x.available, x.longest, x.total]),
    [['B · CAT 2', 145, 2, 2, 4], ['B · CAT 3', 119, 3, 3, 3]], 'each category with its own seats; an unread block C is left out');
  /* it travels with its categories, and viagogo's "B" takes both */
  const back = F.unpack(F.pack(face));
  assert.equal(back.currency, 'EUR');
  assert.deepEqual(back.sectors.map(F.nameOf), ['B · CAT 2', 'B · CAT 3']);
  assert.deepEqual(F.match(back, 'Block B', {}).codes, ['B'], 'one sector code, matched once');
  assert.deepEqual(F.entriesOf(back, 'B').map(x => x.price), [145, 119]);
});

test('eFinity: one entry per priced sector, from the scan or the last summary', () => {
  const R = SK.rules;
  const scans = { A: R.packScan('A', [{ row: '1', label: '1', x: 0, y: 0, free: true }, { row: '1', label: '2', x: 1, y: 0, free: true }], 'axis'), P: { unmapped: true } };
  const sectors = [
    { id: 'A', code: 'A TRIBINE', meta: { price: 3500 } },
    { id: 'B', code: 'B TRIBINE', meta: { price: 2500 }, summary: { available: 7, longest: 3, total: 50 } },
    { id: 'P', code: 'PARTER', meta: { price: 2000 } },
    { id: 'Q', code: 'NOT READ', meta: { price: 1500 } }
  ];
  const face = F.build({ site: 'efinity', currency: 'RSD' }, sectors, scans, {});
  assert.deepEqual(face.sectors.map(x => [x.code, x.available, x.unmapped]),
    [['A TRIBINE', 2, false], ['B TRIBINE', 7, false], ['PARTER', null, true], ['NOT READ', null, false]]);
});

test('money: rates are lek per unit', () => {
  const rates = { USD: 90, RSD: 0.85 };
  assert.equal(F.convert(3500, 'RSD', 'USD', rates).toFixed(2), (3500 * 0.85 / 90).toFixed(2));
  assert.equal(F.convert(10, 'USD', 'USD', rates), 10);
  assert.equal(F.convert(10, 'EUR', 'USD', rates), null, 'a missing rate is no answer, not zero');
  assert.equal(F.multText(1.52), 'x1.5');
  assert.equal(F.multText(1.05), 'x1.05');
  assert.equal(F.multText(0.8), 'x0.80');
});

test('price colors: dearest first, the same for the same price', () => {
  const t = F.tiers([2500, 3500, 2500, null, 0]);
  assert.deepEqual(t.prices, [3500, 2500]);
  assert.notEqual(t.colorOf(3500), t.colorOf(2500));
  assert.equal(t.colorOf(1), F.NO_PRICE);
});
