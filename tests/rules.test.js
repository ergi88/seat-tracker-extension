/* Run with:  node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/util.js');
const SK = require('../core/rules.js');
const R = SK.rules;

/* one row per block of free seats, 10 units apart */
function scanOf(blocks, rowOrder) {
  const seats = [];
  blocks.forEach((len, i) => {
    for (let k = 0; k < len; k++) seats.push({ row: String(i + 1), label: String(k + 1), x: k * 10, y: i * 20, free: true });
  });
  return R.packScan('S', seats, rowOrder || 'x');
}

const req = (o) => Object.assign({ qty: 10, warn: 2, opts: 3, together: true }, o);

/* the table from PROMPT-new-site-extension.md */
const TABLE = [
  { blocks: [50], exp: 'OK', options: 5 },
  { blocks: [39], exp: 'LOW', options: 3 },
  { blocks: [39], opts: 2, exp: 'OK' },
  { blocks: [40, 12], opts: 0, exp: 'OK' },
  { blocks: [12], opts: 0, exp: 'LOW' },
  { blocks: [16, 3], warn: 6, opts: 0, exp: 'LOW' },
  { blocks: [17, 3], warn: 6, opts: 0, exp: 'OK' },
  { blocks: [9, 4], exp: 'SPLIT', options: 0 },
  { blocks: [9], exp: 'SHORT', options: 0 }
];

for (const row of TABLE) {
  const name = `${row.blocks.join(', ')}${row.warn !== undefined ? ' warn ' + row.warn : ''}${row.opts !== undefined ? ' opts ' + row.opts : ''} -> ${row.exp}`;
  for (const order of ['x', 'axis']) {
    test(`${name} (${order})`, () => {
      const r = req({ warn: row.warn === undefined ? 2 : row.warn, opts: row.opts === undefined ? 3 : row.opts });
      const ev = R.evaluate(r, scanOf(row.blocks, order));
      assert.equal(ev.status, row.exp);
      if (row.options !== undefined) assert.equal(ev.options, row.options);
    });
  }
}

test('not scanned and unmapped sectors are NOT SCANNED', () => {
  assert.equal(R.evaluate(req({}), null).status, 'NOT SCANNED');
  assert.equal(R.evaluate(req({}), R.unmappedScan('S', 'standing')).status, 'NOT SCANNED');
});

test('together off counts every free seat', () => {
  const ev = R.evaluate(req({ together: false, opts: 0 }), scanOf([9, 4, 30]));
  assert.equal(ev.status, 'OK');
  assert.equal(ev.options, 4);
});

test('a taken seat breaks a block', () => {
  const seats = [];
  for (let k = 0; k < 10; k++) seats.push({ row: 'A', label: String(k + 1), x: k * 10, y: 0, free: k !== 4 });
  const v = R.blocksFor(R.packScan('S', seats, 'x'), null);
  assert.deepEqual(v.blocks.map(b => b.len), [5, 4]);
  assert.equal(v.available, 9);
});

test('an aisle (gap > 1.75x pitch) breaks a block in x mode', () => {
  const xs = [0, 10, 20, 30, 80, 90, 100];
  const seats = xs.map((x, i) => ({ row: 'A', label: String(i + 1), x, y: 0, free: true }));
  const v = R.blocksFor(R.packScan('S', seats, 'x'), null);
  assert.deepEqual(v.blocks.map(b => b.len), [4, 3]);
});

test('x mode sorts by x even when seat numbers run backwards', () => {
  const seats = [5, 4, 3, 2, 1].map((n, i) => ({ row: 'A', label: String(n), x: i * 10, y: 0, free: true }));
  const b = R.blocksFor(R.packScan('S', seats, 'x'), null).blocks[0];
  assert.equal(b.first, '5');
  assert.equal(b.last, '1');
});

test('axis mode handles a rotated row with an aisle', () => {
  const th = Math.PI / 3;
  const ts = [0, 10, 20, 30, 40, 100, 110, 120];
  const seats = ts.map((t, i) => ({ row: '1', label: String(i + 1), x: t * Math.cos(th), y: t * Math.sin(th), free: true }))
    .reverse();
  const v = R.blocksFor(R.packScan('S', seats, 'axis'), null);
  assert.deepEqual(v.blocks.map(b => b.len), [5, 3]);
});

test('a seat at another price breaks a run when a price is pinned', () => {
  const cats = [7, 7, 7, 5, 7, 7];
  const seats = cats.map((c, i) => ({ row: '1', label: String(i + 1), x: i * 10, y: 0, free: true, cat: c }));
  const scan = R.packScan('S', seats, 'x');
  assert.deepEqual(R.blocksFor(scan, [7]).blocks.map(b => b.len), [3, 2]);
  assert.deepEqual(R.blocksFor(scan, []).blocks.map(b => b.len), [6]);
  assert.equal(R.blocksFor(scan, ['7']).available, 5);
});

test('several picked prices may sit together; other prices still break a block', () => {
  const cats = [7, 7, 5, 6, 7, 5];
  const seats = cats.map((c, i) => ({ row: '1', label: String(i + 1), x: i * 10, y: 0, free: true, cat: c }));
  const scan = R.packScan('S', seats, 'x');
  assert.deepEqual(R.blocksFor(scan, ['7', '5']).blocks.map(b => b.len), [3, 2]);
  assert.equal(R.blocksFor(scan, ['7', '5']).available, 5);
  assert.equal(R.priceTag({ cats: ['7', '5'] }, { 7: { price: 65 }, 5: { price: 55 } }, '€'), '65€ + 55€');
});

test('per-row breakdown and line format', () => {
  const ev = R.evaluate(req({ qty: 4, opts: 0 }), scanOf([8, 4]));
  assert.equal(R.optionsPhrase(ev), '3 options in 2 rows (1×2, 2×1)');
  assert.equal(R.line({ qty: 4 }, 2, ev, 'A1', '65€'), '\u{1F7E2} #2 A1 65€ ×4 OK — 3 options');
  assert.equal(R.line({ qty: 4 }, null, ev, 'A1', '65€'), '\u{1F7E2} A1 65€ ×4 OK — 3 options', 'alerts leave the number out');
});

test('a warning keeps coming back until it is stopped, and stays stopped', () => {
  const every = 15 * 60000;
  const at = t => ({ everyMs: every, now: t });
  const t0 = 1000000;
  /* nothing to warn about */
  assert.deepEqual(R.nagAfter(null, 'OK', at(t0)), { nag: null, repeat: false });
  /* a low request starts a reminder, but is not told twice at once */
  const start = R.nagAfter(null, 'LOW', at(t0));
  assert.equal(start.repeat, false);
  assert.deepEqual([start.nag.type, start.nag.count, start.nag.stopped], ['low', 0, false]);
  /* too early */
  assert.equal(R.nagAfter(start.nag, 'LOW', at(t0 + every - 1)).repeat, false);
  /* due */
  const again = R.nagAfter(start.nag, 'LOW', at(t0 + every));
  assert.equal(again.repeat, true);
  assert.equal(again.nag.count, 1);
  assert.equal(again.nag.since, t0, 'it remembers when the trouble started');
  /* and again, 15 minutes after the last reminder */
  assert.equal(R.nagAfter(again.nag, 'LOW', at(t0 + every + 60000)).repeat, false);
  assert.equal(R.nagAfter(again.nag, 'LOW', at(t0 + 2 * every)).repeat, true);
  /* Stop: no more, even though it is still low */
  const stopped = Object.assign({}, again.nag, { stopped: true });
  assert.equal(R.nagAfter(stopped, 'LOW', at(t0 + 10 * every)).repeat, false);
  assert.equal(R.nagAfter(stopped, 'LOW', at(t0 + 10 * every)).nag.stopped, true, 'and it is not started again by the next scan');
  /* a worse warning starts afresh, stopped or not */
  const worse = R.nagAfter(stopped, 'SHORT', at(t0 + 11 * every));
  assert.equal(worse.nag.type, 'gone');
  assert.equal(worse.nag.stopped, false);
  /* recovering ends it */
  assert.deepEqual(R.nagAfter(worse.nag, 'OK', at(t0 + 12 * every)), { nag: null, repeat: false });
  /* switched off */
  assert.deepEqual(R.nagAfter(start.nag, 'LOW', { everyMs: 0, now: t0 + 99 * every }), { nag: null, repeat: false });
  assert.equal(R.warnTypeOf('SPLIT'), 'gone');
  assert.equal(R.warnTypeOf('NOT SCANNED'), null);
});

test('BOUGHT stands over the scan, never over done', () => {
  assert.equal(R.shownStatus({ bought: true }, 'SHORT'), 'BOUGHT');
  assert.equal(R.shownStatus({ bought: true, done: true }, 'SHORT'), 'SHORT');
  assert.equal(R.shownStatus({}, 'LOW'), 'LOW');
  assert.equal(R.isFillable('BOUGHT'), false);
  assert.ok(R.DOT.BOUGHT);
});

test('a badge: open requests win, BOUGHT only when all of them are bought', () => {
  const st = r => R.shownStatus(r, r.s);
  assert.equal(R.badgeOf([], st), null);
  assert.deepEqual(R.badgeOf([{ qty: 4, bought: true, s: 'SHORT' }, { qty: 2, bought: true, s: 'OK' }], st), { status: 'BOUGHT', qty: 6 });
  assert.deepEqual(R.badgeOf([{ qty: 4, bought: true, s: 'OK' }, { qty: 2, s: 'OK' }], st), { status: 'OK', qty: 2 }, 'mixed: the open one, its tickets only');
  assert.deepEqual(R.badgeOf([{ qty: 4, bought: true }, { qty: 2, s: 'LOW' }, { qty: 1, s: 'SHORT' }], st), { status: 'SHORT', qty: 3 });
  assert.equal(R.badgeOf([{ qty: 4, done: true, s: 'OK' }], st), null, 'done ones are left out');
  assert.equal(R.worst(['BOUGHT', 'OK']), 'OK');
  assert.equal(R.worst(['BOUGHT']), 'BOUGHT');
});
