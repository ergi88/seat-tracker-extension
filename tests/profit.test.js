/* Run with:  node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/util.js');
require('../core/registry.js');
const SK = require('../core/profit.js');
require('../sites/ebileta.js');
const P = SK.profit;

const near = (a, b, d) => assert.ok(Math.abs(a - b) < (d || 0.01), `${a} ≉ ${b}`);

test('money as the sites write it', () => {
  assert.deepEqual(P.parseMoney('$84.00'), { amount: 84, currency: 'USD' });
  assert.deepEqual(P.parseMoney('$453.60'), { amount: 453.6, currency: 'USD' });
  assert.deepEqual(P.parseMoney('Recommended price: $52'), { amount: 52, currency: 'USD' });
  assert.deepEqual(P.parseMoney('Lekë1,045.00'), { amount: 1045, currency: 'ALL' });
  assert.deepEqual(P.parseMoney('1.045,00 €'), { amount: 1045, currency: 'EUR' });
  assert.deepEqual(P.parseMoney('2 400 RSD'), { amount: 2400, currency: 'RSD' });
  assert.equal(P.parseNumber('84,50'), 84.5);
  assert.equal(P.parseNumber('1,045'), 1045);
});

test('eBileta price block, in the seat page and as page text', () => {
  const block = `<div class="tabprezzi" id="ordine-0">
      <div class="colore-ordine" style="background: #FF0000;"></div>
      <h2>Tribuna N105</h2>
      <div class="prezzi">Rates from Lekë1,045.00 to Lekë1,500.00</div>
      <button class="testo stretto" onclick="showDialog('dettaglio-ordine-0')">Detail</button>
    </div>`;
  assert.deepEqual(P.priceRange('Rates from Lekë1,045.00 to Lekë1,045.00', 'ALL'), { min: 1045, max: 1045, currency: 'ALL' });
  const html = `<html>${block}<script>var posti = [ [101, true, 10, 20, 8, 0, 'TRIBUNA N105 Rreshti 1 Vendi 1', '1', 7] ];</script></html>`;
  const parsed = SK.ebileta.parseSeats(html);
  assert.equal(parsed.seats.length, 1);
  assert.deepEqual(parsed.price, { min: 1045, max: 1500, currency: 'ALL' });
  assert.equal(SK.ebileta.parseSeats('<html>var posti = [ ];</html>').price, null);
});

test('rates: the day it was read, else the closest earlier day; manual rates win', () => {
  const fx = { '2026-09-15': { USD: 80 }, '2026-09-17': { USD: 83.36, EUR: 97.5 } };
  assert.deepEqual(P.pickRates(fx, {}, Date.parse('2026-09-16T12:00:00Z')), { rates: { USD: 80 }, day: '2026-09-15', manual: [] });
  assert.equal(P.pickRates(fx, {}, Date.parse('2026-09-17T08:00:00Z')).rates.EUR, 97.5);
  assert.equal(P.pickRates(fx, {}, Date.parse('2026-09-01T08:00:00Z')).day, '2026-09-15');
  assert.deepEqual(P.pickRates(fx, { USD: 90, EUR: 0 }, Date.parse('2026-09-17T08:00:00Z')).manual, ['USD']);
  assert.equal(P.rateOf({}, 'ALL'), 1);
  assert.equal(P.rateOf({}, 'USD'), null);
});

test('buy price per site', () => {
  const typed = P.buyPriceOf({ site: 'ebileta', request: { buyPrice: 3500, buyCurrency: 'ALL' }, summary: { price: { min: 1, max: 2, currency: 'ALL' } } });
  assert.deepEqual(typed, { amount: 3500, currency: 'ALL', source: 'typed' });
  assert.deepEqual(P.buyPriceOf({ site: 'ebileta', request: {}, summary: { price: { min: 1045, max: 1500, currency: 'ALL' } } }),
    { amount: 1500, currency: 'ALL', source: 'section price', range: [1045, 1500] });
  assert.deepEqual(P.buyPriceOf({ site: 'efinity', request: {}, sector: { meta: { price: 2400 } } }), { amount: 2400, currency: 'RSD', source: 'sector price' });
  const ev = { cats: { 1: { price: 65 }, 2: { price: 55 }, 3: { price: 45 } } };
  assert.deepEqual(P.buyPriceOf({ site: 'posttick', event: ev, request: { cats: ['2', '3'] } }),
    { amount: 55, currency: 'EUR', source: 'picked price', range: [45, 55] });
  assert.equal(P.buyPriceOf({ site: 'posttick', event: ev, request: { cats: [] }, summary: { cats: ['1'] } }).amount, 65);
  assert.equal(P.buyPriceOf({ site: 'ebileta', request: {}, summary: {} }), null);
});

test('the worked example: listing 13988951528, E106, 6 tickets', () => {
  const listing = { price: 84, payout: 453.6, tickets: 6, currency: 'USD' };
  const p = P.profitOf(listing, { amount: 4000, currency: 'ALL' }, { USD: 83.36 });
  near(p.payoutL, 6302.02);
  near(p.costL, 4000);
  near(p.total, 13812.10);
  near(p.winRate, 1.5755, 0.001);
  near(p.breakEven, 53.32);
  assert.equal(P.winRateText(p.winRate), '(x1.6)');
  assert.equal(P.formatLek(p.total, true), '+13,812 L');
  assert.equal(p.atRecommended, undefined, 'viagogo\'s recommended price is not used');
  assert.equal(P.formatMoney(p.breakEven, 'USD'), '$53.32');
});

test('what is missing is said, not guessed', () => {
  assert.equal(P.profitOf({ price: 84, payout: 0, tickets: 6, currency: 'USD' }, null, {}).missing, 'listing');
  assert.equal(P.profitOf({ price: 84, payout: 453.6, tickets: 6, currency: 'USD' }, null, {}).missing, 'rate');
  const noBuy = P.profitOf({ price: 84, payout: 453.6, tickets: 6, currency: 'USD' }, null, { USD: 83.36 });
  assert.equal(noBuy.missing, 'buy');
  near(noBuy.payoutL, 6302.02);
  assert.equal(P.profitOf({ price: 84, payout: 453.6, tickets: 6, currency: 'USD' }, { amount: 20, currency: 'EUR' }, { USD: 83.36 }).missing, 'rate');
});

test('what another price would earn: viagogo keeps the same share', () => {
  const m = P.profitOf({ price: 84, payout: 453.60, tickets: 6, currency: 'USD' }, { amount: 4000, currency: 'ALL' }, { USD: 83.36 });
  const at = P.atPrice(m, 100);
  assert.equal(Math.round(at.payoutPerTicket * 100) / 100, 90, 'viagogo pays 90% of the ask');
  assert.equal(Math.round(at.payout), 540);
  assert.equal(Math.round(at.total), 21014);
  assert.ok(at.winRate > 1.87 && at.winRate < 1.88);
  assert.equal(Math.round(P.atPrice(m, m.breakEven).total), 0, 'nothing is won or lost at the break-even price');
  assert.equal(Math.round(P.atPrice(m, 84).total), Math.round(m.total), 'the price it is set at gives what it earns now');
  for (const bad of [0, -5, null, undefined, 'x']) assert.equal(P.atPrice(m, bad), null);
  assert.equal(P.atPrice(null, 50), null);
  assert.equal(P.atPrice({ missing: 'listing' }, 50), null);
});

test('without a buy price the calculator still shows the payout', () => {
  const m = P.profitOf({ price: 84, payout: 453.60, tickets: 6, currency: 'USD' }, null, { USD: 83.36 });
  const at = P.atPrice(m, 120);
  assert.equal(m.missing, 'buy');
  assert.equal(Math.round(at.payout), 648);
  assert.equal(at.total, undefined, 'no cost, so no profit is claimed');
});

test('a price worked out by hand agrees with the same listing', () => {
  const rates = { USD: 83.36, EUR: 97.5 };
  const real = P.profitOf({ price: 84, payout: 453.60, tickets: 6, currency: 'USD' }, { amount: 4000, currency: 'ALL' }, rates);
  const byHand = P.quote({ buy: 4000, buyCurrency: 'ALL', sell: 84, sellCurrency: 'USD', tickets: 6, keep: 0.9 }, rates);
  assert.equal(Math.round(byHand.total), Math.round(real.total), 'same profit as the listing it copies');
  assert.equal(Math.round(byHand.breakEven * 100), Math.round(real.breakEven * 100));
  assert.equal(byHand.tickets, 6);

  /* the two prices may be in different currencies */
  const mixed = P.quote({ buy: 35, buyCurrency: 'EUR', sell: 84, sellCurrency: 'USD', tickets: 6, keep: 0.9 }, rates);
  assert.equal(Math.round(mixed.costL), Math.round(35 * 97.5));
  assert.ok(mixed.total > 0 && mixed.winRate > 1);

  /* viagogo keeping nothing is the plain difference */
  const whole = P.quote({ buy: 10, buyCurrency: 'ALL', sell: 20, sellCurrency: 'ALL', tickets: 2, keep: 1 }, rates);
  assert.equal(whole.perTicket, 10);
  assert.equal(whole.total, 20);

  assert.equal(P.quote({ buy: 10 }, rates).missing, 'sell', 'an ask is the one thing it cannot do without');
  assert.equal(P.quote({ sell: 50, sellCurrency: 'USD' }, rates).missing, 'buy', 'without a cost it still shows the payout');
  assert.equal(P.quote({ sell: 50, sellCurrency: 'GBP' }, rates).missing, 'rate');
  assert.equal(P.quote({ sell: 50, sellCurrency: 'USD', tickets: 0 }, rates).tickets, 1, 'never fewer than one ticket');
});

test("viagogo's share is learned from the listings it has paid out on", () => {
  assert.equal(P.keepRatio([{ money: { ratio: 0.9 } }, { money: { ratio: 0.8 } }, { money: { ratio: 0.95 } }]), 0.9);
  assert.ok(Math.abs(P.keepRatio([{ money: { ratio: 0.9 } }, { money: { ratio: 0.8 } }]) - 0.85) < 1e-9, 'the middle of an even list');
  assert.equal(P.keepRatio([{ money: { missing: 'buy' } }, {}, null]), null, 'nothing to learn from');
  assert.equal(P.keepRatio([]), null);
});

test('the prices to aim at: x1.5, x2, x2.5, x3 of what the tickets cost', () => {
  const rates = { USD: 83.36 };
  const q = { buy: 4000, buyCurrency: 'ALL', sellCurrency: 'USD', keep: 0.9 };
  const be = P.breakEvenAsk(q, rates);
  assert.equal(Math.round(be * 100) / 100, 53.32, 'the same break-even a real listing has');
  assert.deepEqual(P.WIN_TARGETS, [1.5, 2, 2.5, 3]);

  /* each target really lands on its win rate */
  for (const w of P.WIN_TARGETS) {
    const ask = P.askFor(be, w);
    const got = P.quote(Object.assign({}, q, { sell: ask, tickets: 1 }), rates);
    assert.ok(Math.abs(got.winRate - w) < 0.005, `asking ${ask} should give x${w}, gave x${got.winRate}`);
    assert.ok(got.winRate >= w, 'rounded up, so the target is really reached');
  }

  /* nothing to aim at without a cost, or without a rate */
  assert.equal(P.breakEvenAsk({ buyCurrency: 'ALL', sellCurrency: 'USD' }, rates), null);
  assert.equal(P.breakEvenAsk({ buy: 4000, buyCurrency: 'ALL', sellCurrency: 'GBP' }, rates), null);
  assert.equal(P.askFor(null, 2), null);
  assert.equal(P.askFor(50, 0), null);
  /* viagogo keeping nothing: the ask is simply the multiple of the cost */
  assert.equal(P.askFor(P.breakEvenAsk({ buy: 10, buyCurrency: 'ALL', sellCurrency: 'ALL', keep: 1 }, rates), 2), 20);
});
