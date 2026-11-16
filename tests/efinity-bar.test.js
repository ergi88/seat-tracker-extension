/* Run with:  node --test tests/
 *
 * eFinity sells every bar table as its own article, so asking for "a table"
 * means guessing which of a dozen sectors has room. One sector stands for all
 * of them, with a row per table, and the question it answers is the real one:
 * how many tables can take my group?
 *
 * A table counts only when all six seats are free: the site will not sell
 * fewer than four of the six, so the one or two left at a part-sold table
 * cannot be bought by anyone and are not free to you.
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

const site = SK.site('efinity');

/* a venue of six-seat tables, each with a number of seats still free, plus a
 * seated stand so the tables are not the only thing on the map */
function venue(freePerTable) {
  const articles = [{ ArticleName: 'A TRIBINE', SvgMapId: 'a', Price: 2500 }];
  let svg = '<svg id="a"><rect id="a1" row="1" number="1" state="Available" x="0" y="0" width="10" height="10"/></svg>';
  freePerTable.forEach((free, i) => {
    const n = i + 1;
    articles.push({ ArticleName: `BARSKI STO ${n}`, SvgMapId: 'sto' + n, Price: 12000, MaximumQuantityPerTransaction: 6 });
    /* real tables are a ring of six: positions all over the place, which is
     * why the sector lays them out itself */
    const rects = [];
    for (let seat = 1; seat <= 6; seat++) {
      const angle = seat * 60;
      rects.push(`<rect id="s${n}_${seat}" row="${n}" number="${seat}" state="${seat <= free ? 'Available' : 'Purchased'}" `
        + `x="${Math.round(Math.cos(angle) * 40) * 3}" y="${Math.round(Math.sin(angle) * 40)}" width="6" height="6"/>`);
    }
    svg += `<svg id="sto${n}">${rects.join('')}</svg>`;
  });
  return { Svg: svg, Articles: articles };
}

/* one response covers a whole venue, so the adapter caches it per event —
 * every fixture therefore needs an event of its own */
let nextId = 0;
const fresh = () => 'ev' + (++nextId);
const load = async json => site.loadEvent({ siteId: fresh(), title: 'x', extra: {} }, { net: { json: async () => json } });
const scan = async (json, ids) => site.scan({ siteId: fresh(), sectors: [] }, ids, { net: { json: async () => json } });

/* what the extension would show for a request of `qty` in the Bar Table sector */
async function options(freePerTable, qty) {
  const json = venue(freePerTable);
  const res = await scan(json, [SK.efinity.BAR]);
  const packed = SK.rules.packScan(SK.efinity.BAR, res.results[SK.efinity.BAR].seats, 'axis');
  const e = SK.rules.evaluate({ sec: SK.efinity.BAR, qty, cats: [], together: true, warn: 0, opts: 0 }, packed);
  return { options: e.options, status: e.status, free: e.view.available };
}

test('the tables become one sector, alongside the tables themselves', async () => {
  const ev = await load(venue([6, 2, 0]));
  const codes = ev.sectors.map(s => s.code);
  assert.ok(codes.includes('BARSKI STO 1'), 'each table is still its own sector');
  assert.ok(codes.includes('Bar Table'), 'and one sector stands for all of them');
  const bar = ev.sectors.find(s => s.code === 'Bar Table');
  assert.equal(bar.meta.tables, 3);
  assert.equal(bar.meta.perTable, 6);
  assert.equal(site.sectorHint(bar), '3 tables · 6 seats each · 12000 RSD · a table counts only when every seat is free');

  const none = await load({ Svg: '<svg id="a"><rect id="a1" row="1" number="1" state="Available"/></svg>', Articles: [{ ArticleName: 'A TRIBINE', SvgMapId: 'a', Price: 1 }] });
  assert.ok(!none.sectors.some(s => s.code === 'Bar Table'), 'an event with no tables does not grow the sector');
});

test('the options are the tables with every seat free', async () => {
  /* the states a six-seat table with a four-seat minimum can be in */
  const tables = [6, 6, 2, 1, 0, 6];
  for (const qty of [4, 5, 6]) {
    const r = await options(tables, qty);
    assert.equal(r.options, 3, `${qty} tickets: the three untouched tables, and nothing else`);
    assert.equal(r.free, 18, 'and the free seats are those tables\' seats');
    assert.equal(r.status, 'OK');
  }
});

test('a part-sold table counts for nothing', async () => {
  /* nobody can buy the one or two seats left at a table, so they are not free */
  const r = await options([2, 2, 2], 4);
  assert.equal(r.free, 0, 'six seats left over across three tables are still no table');
  assert.equal(r.options, 0);
  assert.equal(r.status, 'SHORT');
  assert.equal((await options([0, 0], 4)).status, 'SHORT', 'and neither is a room of sold-out tables');
  assert.equal((await options([6, 2, 1, 0], 4)).options, 1, 'one free table among part-sold ones is one option');
});

test('a table is never split by the aisle rule', async () => {
  /* the real coordinates are a ring, so the gap between neighbouring seats
   * jumps around; laid out as they come, a free table would read as pieces */
  const json = venue([6]);
  const seats = (await scan(json, [SK.efinity.BAR])).results[SK.efinity.BAR].seats;
  const packed = SK.rules.packScan(SK.efinity.BAR, seats, 'axis');
  const view = SK.rules.blocksFor(packed, []);
  assert.equal(view.longest, 6, 'a free table is one run of six');
  assert.equal(packed.rows.length, 1, 'and one row, because one table is one row');

  const raw = SK.rules.packScan('x', json.Svg ? [] : [], 'axis');   // guard: helper still exists
  assert.ok(raw);
});

test('"bar table" and its shorthands find the sector', () => {
  for (const q of ['bar table', 'Bar Tables', 'tables', 'sto', 'bs', 'barski sto']) {
    assert.equal(site.aliasSector(q), SK.efinity.BAR, `"${q}"`);
  }
  assert.equal(site.aliasSector('bs12'), 'BARSKI STO 12', 'while a numbered one still means that table');
});
