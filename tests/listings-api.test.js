/* Run with:  node --test tests/
 *
 * My listings loads its list from viagogo's own JSON (/listings/getListings),
 * as My Sales does from /sales/getSales. Reading it gives every listing in
 * every status without turning a page. These check the address it is asked
 * with, that one item comes out exactly as its card does, and that what the
 * JSON does not carry (the card's "Listing performance") is never blanked.
 * The item below is the one captured on 2026-10-08 (listing 14289737262).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SK = require(path.join(ROOT, 'core/util.js'));
require(path.join(ROOT, 'core/profit.js'));
require(path.join(ROOT, 'core/viagogo.js'));
const V = SK.viagogo;

const ITEM = {
  IsEventDateTimeTba: false, Id: 14289737262, Status: 'Active', StatusId: 1, EventId: 161959641,
  EventDescription: 'KF Egnatia vs FC Midtjylland - European Club Conference',
  EventDate: '2026-10-15T16:45:00', EventDateStr: 'Thursday, 15 October 2026 18:45', EventDateSimplifiedStr: 'Thu, 15 Oct • 6:45 PM',
  Quantity: 12, QuantityRemain: 12, Section: 'E105', Rows: null, Seats: null,
  VenueDescription: 'Air Albania Stadium (Arena Kombëtare)', City: 'Tirana', State: null, Country: 'Albania',
  PricePerTicket: { Amount: 50, Currency: 'USD', CurrencySymbol: '$', DecimalPlace: 2 },
  PayoutPerTicket: { Amount: 45, Currency: 'USD', CurrencySymbol: '$', DecimalPlace: null },
  DisplayPricePerTicket: { Amount: 9999999, Currency: 'DisplayPricePerTicketCURRENCY' },
  PricingRecommendation: { ListingId: 14289737262, SectionMinPrice: -99999999, SectionMaxPrice: 999999999 },
  PriceDetails: { TotalTicketPrice: { amount: 600, currency_code: 'USD' }, SellerFee: { amount: 60 }, TotalProceeds: { amount: 540, currency_code: 'USD', display: '$540.00' } },
  EventPageUrl: 'https://www.viagogo.com/E-161959641'
};

test('every status, every page, in viagogo\'s own words', () => {
  const u = new URL('https://my.viagogo.com' + V.listingsApiUrl(2, 100));
  assert.equal(u.pathname, '/listings/getListings');
  assert.equal(u.searchParams.get('filters'), 'STATUS:ACTIVE|PENDING|DEACTIVATED|EXPIRED', 'EXPIRED is what the page\'s "Sold" choice sends');
  assert.equal(u.searchParams.get('sort'), 'action_date asc');
  assert.equal(u.searchParams.get('page'), '2');
  assert.equal(u.searchParams.get('pageSize'), '100');
  /* one listing: a Q: clause inside filters, not a parameter of its own */
  assert.equal(new URL('https://x' + V.listingsApiUrl(1, 5, '14289796741')).searchParams.get('filters'), 'STATUS:ACTIVE|PENDING|DEACTIVATED|EXPIRED,Q:14289796741');
  assert.equal(V.recommendationUrl, undefined, 'viagogo\'s recommended price is never asked for');
});

test('one item reads exactly as its card does', () => {
  assert.deepEqual(V.listingFromApi(ITEM), {
    id: '14289737262', status: 'Active', title: 'KF Egnatia vs FC Midtjylland - European Club Conference',
    venue: 'Air Albania Stadium (Arena Kombëtare), Tirana, Albania', when: 'Thu, 15 Oct • 6:45 PM',
    currency: 'USD', price: 50, payout: 540, tickets: 12, section: 'E105', row: '',
    performance: '', vgEventId: '161959641', uploaded: null
  });
  /* PreDelivered: uploaded or not; "Instant download pending" is false */
  assert.equal(V.listingFromApi(Object.assign({}, ITEM, { PreDelivered: true })).uploaded, true);
  assert.equal(V.listingFromApi(Object.assign({}, ITEM, { PreDelivered: false })).uploaded, false);
  /* the placeholders are never read */
  assert.notEqual(V.listingFromApi(ITEM).price, 9999999);
  /* payout is for the tickets still listed: 3 of 12 sold leaves 9 × $45 */
  const part = V.listingFromApi(Object.assign({}, ITEM, { QuantityRemain: 9 }));
  assert.equal(part.tickets, 9);
  assert.equal(part.payout, 405);
  assert.equal(V.listingFromApi({ Id: 12 }), null, 'no listing without a real number');
  assert.equal(V.apiTotal({ NumFound: 25, Listing: [] }), 25);
  assert.deepEqual(V.apiList({ NumFound: 0 }), []);
  /* "Sold" is EXPIRED in the JSON: whatever its word, it reads as not active */
  assert.notEqual(V.listingStatus('Expired'), 'active');
});

test('what the JSON does not carry is kept from the card', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bg/events.js'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(/function keepCardOnly[\s\S]*?\n\}/.exec(src)[0] + ';this.keepCardOnly = keepCardOnly;', ctx);
  const was = { performance: 'Not competitive' };
  assert.deepEqual(ctx.keepCardOnly({ performance: '' }, was), { performance: 'Not competitive' });
  assert.deepEqual(ctx.keepCardOnly({ performance: 'Great' }, was), { performance: 'Great' }, 'a fresh one wins');
  assert.ok(/if \(partial\) keepCardOnly\(it, was\)/.test(src), 'and only a read from the JSON keeps them — a card says it itself');
  assert.ok(/slice\(0, partial \? 2000 : 200\)/.test(src), 'a full read is every listing, not the first 200');
});
