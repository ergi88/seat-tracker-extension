/* Run with:  node --test tests/
 *
 * My Sales, read from viagogo's own endpoint: what is kept of a sale (and
 * what never is), its profit in lek, the grouping by event and section, and
 * where a "Scan new sales" may stop.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/util.js');
require('../core/profit.js');
const SK = require('../core/sales.js');
const S = SK.sales;

/* as the endpoint returns them (capture of 2026-10-04), buyer fields included */
const API = [
  { SaleId: 656096343, ListingId: 14123898111, EventId: 161613551, EventDescription: 'Albania vs San Marino - Nations League', Section: 'N105',
    Quantity: 3, TotalPayout: 86.4, TotalTicketPrice: 96, SaleDate: '2026-10-04T08:17:16', Status: 'Get Paid',
    BuyerEmail: 'someone@example.com', BuyerFirstName: 'A', BuyerLastName: 'B', BuyerPhoneNumber: '+355 69 000 0000' },
  { SaleId: 655666275, ListingId: 14123898198, EventId: 161613551, EventDescription: 'Albania vs San Marino - Nations League', Section: 'S102',
    Quantity: 4, TotalPayout: 90, SaleDate: '2026-09-30T11:02:00', Status: 'Get Paid' },
  { SaleId: 554045892, ListingId: 8742195139, EventId: 157090940, EventDescription: 'England vs France', Section: 'L34 • Row 16',
    Quantity: 2, TotalPayout: 172.8, TotalTicketPrice: 192, SaleDate: '2025-02-09T18:47:56', Status: 'Complete' }
];
const RATES = { USD: 100, EUR: 110 };

test('saleFromApi keeps the sale and nothing of the buyer', () => {
  const s = S.saleFromApi(API[0]);
  assert.deepEqual(s, {
    id: '656096343', listingId: '14123898111', vgEventId: '161613551', title: 'Albania vs San Marino - Nations League', when: '', venue: '',
    section: 'N105', row: '', seats: '', tickets: 3, currency: 'USD', amount: 86.4, status: 'Get Paid', soldOn: '2026-10-04', soldAt: '2026-10-04T08:17:16'
  });
  assert.doesNotMatch(JSON.stringify(s), /example\.com|\+355|Buyer/);
  const e = S.saleFromApi(API[2]);
  assert.equal(e.section, 'L34');
  assert.equal(e.row, '16', '"L34 • Row 16" splits into section and row');
  assert.equal(S.saleFromApi({ SaleId: '' }), null);
});

test('saleFromApi keeps viagogo\'s Seats, whatever shape they come in', () => {
  const seats = v => S.saleFromApi(Object.assign({}, API[2], { Seats: v })).seats;
  assert.equal(seats('1-4'), '1-4');
  assert.equal(seats(' 1,  2, 3 '), '1, 2, 3');
  assert.equal(seats(12), '12');
  assert.equal(seats(['14', 15, '']), '14, 15', 'a list is joined');
  assert.equal(seats(null), '');
  assert.equal(seats({ From: 1 }), '', 'an object is not seats');
  assert.equal(seats('9'.repeat(200)).length, 80);
});

test('paid is Status "Complete"; "Get Paid" is not paid yet', () => {
  assert.equal(S.isPaid({ status: 'Complete' }), true);
  assert.equal(S.isPaid({ status: 'Get Paid' }), false);
});

test('saleMoney: payout for the whole sale against the buy price of every ticket, in lek', () => {
  const s = S.saleFromApi(API[2]);                            // $172.80 for 2 tickets
  const m = S.saleMoney(s, { amount: 4000, currency: 'ALL' }, RATES);
  assert.equal(m.missing, null);
  assert.equal(Math.round(m.payoutL), 17280);
  assert.equal(m.costL, 8000);
  assert.equal(Math.round(m.profitL), 9280);
  assert.equal(Math.round(m.winRate * 100) / 100, 2.16);
  assert.equal(S.saleMoney(s, null, RATES).missing, 'buy');
  assert.equal(Math.round(S.saleMoney(s, null, RATES).payoutL), 17280, 'what it paid is known without a buy price');
  assert.equal(S.saleMoney(s, { amount: 30, currency: 'GBP' }, RATES).missing, 'rate');
});

test('saleMoney: a lot\'s kept lek is the cost as it is; a deposit\'s lek is the payout, settled', () => {
  const s = S.saleFromApi(API[2]);                            // $172.80 for 2 tickets
  const kept = S.saleMoney(s, { amount: 70, currency: 'EUR', lek: 6500 }, RATES);
  assert.equal(kept.costL, 13000, 'what the bank charged, whatever today\'s EUR rate');
  assert.equal(kept.deposited, false);
  assert.equal(Math.round(kept.payoutL), 17280, 'not in the bank yet: the payout at the rates given (live)');
  const got = S.saleMoney(s, { amount: 70, currency: 'EUR', lek: 6500 }, RATES, { lek: 14000, rate: 81.5, on: '2026-11-20', depositId: 'd1' });
  assert.equal(got.payoutL, 14000, 'in the bank: the deposit\'s lek');
  assert.equal(got.deposited, true);
  assert.equal(got.payoutRate, 81.5);
  assert.equal(got.profitL, 1000);
  const noRate = S.saleMoney(Object.assign({}, s, { currency: 'GBP' }), null, RATES, { lek: 14000, rate: 90 });
  assert.equal(noRate.missing, 'buy', 'a deposited sale needs no rate for its payout');
  assert.equal(noRate.payoutL, 14000);
});

test('depositShares: a deposit\'s lek over its sales, by payout, fees off each in proportion', () => {
  const sales = [{ id: 'a', amount: 200, currency: 'USD' }, { id: 'b', amount: 100, currency: 'USD' }, { id: 'c', amount: 50, currency: 'USD' }];
  const deposits = [{ id: 'd1', currency: 'USD', amount: 295, amountAll: 24190, receivedOn: '2026-11-20', bank: 'BKT' }];
  const links = [{ depositId: 'd1', saleId: 'a' }, { depositId: 'd1', saleId: 'b' }, { depositId: 'd1', saleId: 'gone' }];
  const sh = S.depositShares(deposits, links, sales);
  assert.deepEqual(Object.keys(sh).sort(), ['a', 'b'], 'only the sales in it, and only ones still there');
  assert.ok(Math.abs(sh.a.lek - 24190 * 2 / 3) < 0.001 && Math.abs(sh.b.lek - 24190 / 3) < 0.001);
  assert.equal(sh.a.rate, 82, 'the bank\'s own rate: 24,190 L for $295');
  assert.deepEqual([sh.a.on, sh.a.depositId, sh.a.bank], ['2026-11-20', 'd1', 'BKT']);
  assert.deepEqual(S.depositShares({ d1: deposits[0] }, links, { a: sales[0] }).a.lek, 24190, 'by id works too; the one sale takes it all');
});

test('groupSales: by event, newest first, then by section, with totals at every level', () => {
  const sales = API.map(S.saleFromApi).map(s => Object.assign(s, {
    money: S.saleMoney(s, s.section === 'S102' ? null : { amount: 2000, currency: 'ALL' }, RATES)
  }));
  const g = S.groupSales(sales);
  assert.deepEqual(g.events.map(e => e.title), ['Albania vs San Marino - Nations League', 'England vs France']);
  const alb = g.events[0];
  assert.deepEqual(alb.sections.map(x => x.section), ['N105', 'S102']);
  assert.equal(alb.total.tickets, 7);
  assert.equal(alb.total.sales, 2);
  assert.equal(alb.total.counted, 1, 'S102 has no buy price, so only N105 counts for profit');
  assert.equal(alb.total.noBuy, 1);
  assert.equal(alb.total.unpaid, 2);
  assert.equal(Math.round(alb.total.profitL), 8640 - 6000);
  assert.equal(Math.round(alb.total.payoutL), 8640 + 9000, 'paid counts every sale, with a buy price or not');
  assert.equal(g.total.tickets, 9);
  assert.equal(g.total.banked, 0, 'nothing in the bank yet');
  assert.equal(Math.round(g.total.profitL), 2640 + 13280);
  assert.equal(Math.round(g.total.winRate * 100) / 100, Math.round(((8640 + 17280) / (6000 + 4000)) * 100) / 100);
});

test('stopRule: stop at the first saved sale, unless a saved one is still unpaid', () => {
  const saved = { 554045892: { id: '554045892', status: 'Complete', soldOn: '2025-02-09' } };
  const stop = S.stopRule(saved);
  assert.equal(stop({ id: '999', soldOn: '2026-10-05' }), false, 'a new sale: read on');
  assert.equal(stop({ id: '554045892', soldOn: '2025-02-09' }), true, 'one already saved: everything after is too');

  saved['655666275'] = { id: '655666275', status: 'Get Paid', soldOn: '2026-09-30' };
  saved['656096343'] = { id: '656096343', status: 'Complete', soldOn: '2026-10-04' };
  const stop2 = S.stopRule(saved);
  assert.equal(stop2({ id: '656096343', soldOn: '2026-10-04' }), false, 'saved, but newer than an unpaid sale: read on to see it paid');
  assert.equal(stop2({ id: '655666275', soldOn: '2026-09-30' }), false, 'the unpaid sale itself is read again');
  assert.equal(stop2({ id: '554045892', soldOn: '2025-02-09' }), true, 'past the oldest unpaid one: stop');
});

test('the endpoint is asked newest first, both statuses', () => {
  assert.equal(S.apiUrl(2, 20), '/sales/getSales?filters=STATUS%3AOPEN%7CCOMPLETED&sort=SALEDATE%20desc&page=2&pageSize=20');
  assert.equal(S.isSalesPage({ hostname: 'my.viagogo.com', pathname: '/sales' }), true);
  assert.equal(S.isSalesPage({ hostname: 'my.viagogo.com', pathname: '/listings' }), false);
  assert.equal(S.isSalesPage({ hostname: 'my.viagogo.com', pathname: '/ww/sales' }), true, 'behind a locale');
  assert.equal(S.isSalesPage({ hostname: 'my.viagogo.com', pathname: '/ww/listings' }), false);
});
