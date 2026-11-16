/* Run with:  node --test tests/
 *
 * viagogo's "just sold" toast on the sell pages: reading it, telling a new
 * sale from the same one seen again, matching it to an event, and the
 * spacing of the page refreshes.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/util.js');
require('../core/profit.js');
require('../core/viagogo.js');
const SK = require('../core/lastsales.js');
const L = SK.lastSales;

/* the toast's text pieces, in order, as copied from the page on 2026-11-04 */
const LINES = ['Tickets for Albania vs Finland - Nations League were just purchased!', 'S205 • 3 tickets', '$82.24', 'Just sold!'];

test('parseToast reads the section, tickets, price and event', () => {
  assert.deepEqual(L.parseToast(LINES), {
    title: 'Albania vs Finland - Nations League', section: 'S205', row: '', tickets: 3, price: 82.24, currency: 'USD'
  });
});

test('parseToast copes with a row, one ticket, euros and a "Section" word', () => {
  assert.deepEqual(L.parseToast(['Tickets for Kosovo vs Sweden was just purchased!', 'Section E102 • Row 4 • 1 ticket', '€1,045.50']), {
    title: 'Kosovo vs Sweden', section: 'E102', row: '4', tickets: 1, price: 1045.5, currency: 'EUR'
  });
});

test('parseToast says nothing when a part is missing', () => {
  assert.equal(L.parseToast(['Tickets for X were just purchased!', 'S205 • 3 tickets']), null);       // no price
  assert.equal(L.parseToast(['Tickets for X were just purchased!', '$82.24']), null);                 // no section
  assert.equal(L.parseToast(['S205 • 3 tickets', '$82.24']), null);                                    // no event
});

test('only the sell steps count, after a locale too, never the confirmation', () => {
  const at = (p, h = 'sell.viagogo.com') => ({ hostname: h, pathname: p, search: '' });
  assert.ok(L.isSellPage(at('/ww/Secure/Pipeline/Sell/TicketDetails/Quantity')));
  assert.ok(L.isSellPage(at('/Secure/Pipeline/Sell/PriceDetails')));
  assert.ok(!L.isSellPage(at('/ww/Secure/Pipeline/Sell/Confirmed')));
  assert.ok(!L.isSellPage(at('/ww/listings', 'my.viagogo.com')));
  assert.ok(!L.isSellPage(at('/Secure/Pipeline/Sell/Quantity', 'sell.example.com')));
  assert.equal(L.pipelineIdOf({ search: '?ID=02d09c84-45f7-4cf4-9591-64c4eea2ee0c' }), '02d09c84-45f7-4cf4-9591-64c4eea2ee0c');
  assert.equal(L.eventIdIn({ search: '?eventId=161613530&x=1' }), '161613530');
});

test('clean keeps what a sale shows and drops nonsense', () => {
  const s = L.clean({ title: ' Albania vs Finland - Nations League ', section: 'S205', tickets: '3', price: '82.239', currency: 'usd', vgEventId: 'E-1', when: 'Sat 14 Nov' });
  assert.deepEqual(s, {
    vgKey: 'albaniavsfinlandnationsleague', title: 'Albania vs Finland - Nations League', section: 'S205', row: '',
    tickets: 3, price: 82.24, currency: 'USD', when: 'Sat 14 Nov', vgEventId: '', listingId: ''
  });
  assert.equal(L.clean({ title: 'X', section: 'S1', tickets: 0, price: 5 }), null);
  assert.equal(L.clean({ title: 'X', section: 'S1', tickets: 2, price: 0 }), null);
  assert.equal(L.clean({ title: '', section: 'S1', tickets: 2, price: 5 }), null);
});

test('the same toast again is the same sale; a different one is new', () => {
  const a = Object.assign(L.clean({ title: 'Albania vs Finland - Nations League', section: 'S205', tickets: 3, price: 82.24, currency: 'USD' }), { firstSeen: 1000 });
  const b = Object.assign(L.clean({ title: 'Albania vs Finland - Nations League', section: 'N101', tickets: 2, price: 60, currency: 'USD' }), { firstSeen: 2000 });
  const other = Object.assign(L.clean({ title: 'Kosovo vs Sweden', section: 'S205', tickets: 3, price: 82.24, currency: 'USD' }), { firstSeen: 3000 });
  const saved = [a, b, other];
  /* the newest for this event is b: a toast showing b again is b */
  assert.deepEqual(L.compare(saved, L.clean({ title: 'Albania vs Finland - Nations League', section: 'N101', tickets: 2, price: 60, currency: 'USD' })), { latest: b, same: true });
  /* showing a again after b came in: a new sale with a's look (nothing tells them apart) */
  assert.equal(L.compare(saved, L.clean({ title: 'Albania vs Finland - Nations League', section: 'S205', tickets: 3, price: 82.24, currency: 'USD' })).same, false);
  /* a first sale for an event nobody saw yet */
  assert.deepEqual(L.compare(saved, L.clean({ title: 'Serbia vs Albania', section: 'A', tickets: 1, price: 9 })), { latest: null, same: false });
});

test('sameEvent: viagogo ID, then tracked event, then name and date', () => {
  const s = { vgKey: 'albaniavsfinlandnationsleague', title: 'Albania vs Finland - Nations League', when: 'Sat, 14 Nov • 8:45 PM', vgEventId: '', eventKey: 'ebileta:9' };
  assert.ok(L.sameEvent(s, { eventKey: 'ebileta:9' }));
  assert.ok(!L.sameEvent(s, { eventKey: 'ebileta:8' }));
  assert.ok(L.sameEvent(s, { title: 'Albania vs Finland - Nations League', when: '2026-11-14T20:45:00' }));
  assert.ok(!L.sameEvent(s, { title: 'Albania vs Finland - Nations League', when: '2026-11-15T20:45:00' }));
  assert.ok(L.sameEvent(Object.assign({}, s, { vgEventId: '161613530' }), { vgEventId: '161613530', eventKey: 'ebileta:1' }));
  assert.ok(!L.sameEvent(Object.assign({}, s, { vgEventId: '161613530' }), { vgEventId: '161613531', title: s.title }));
  const list = [Object.assign({}, s, { firstSeen: 1 }), Object.assign({}, s, { firstSeen: 5 }), { title: 'Other', firstSeen: 9 }];
  assert.deepEqual(L.forEvent(list, { eventKey: 'ebileta:9' }).map(x => x.firstSeen), [5, 1]);
});

test('reloads wait the picked minutes ± 20 %, never under 5 minutes', () => {
  assert.equal(L.nextDelay(15, 0), 12 * 60000);
  assert.equal(L.nextDelay(15, 1), 18 * 60000);
  assert.equal(L.nextDelay(1, 0.5), 5 * 60000);
  for (let i = 0; i < 50; i++) {
    const d = L.nextDelay(10);
    assert.ok(d >= 8 * 60000 && d <= 12 * 60000);
  }
});

/* ---------------- the scan of every event's sell page ---------------- */

test('sellUrl is viagogo\'s own Sell link for the event', () => {
  assert.equal(L.sellUrl('161613530'), 'https://www.viagogo.com/ww/Secure/Pipeline/Sell/Initialise?EventID=161613530');
  assert.equal(L.sellUrl('E-161613530'), 'https://www.viagogo.com/ww/Secure/Pipeline/Sell/Initialise?EventID=161613530');
  assert.equal(L.sellUrl(''), '');
  assert.equal(L.sellUrl('12'), '');
});

test('isLoginPage knows viagogo\'s sign-in pages and nothing else', () => {
  assert.equal(L.isLoginPage(new URL('https://my.viagogo.com/ww/login?returnUrl=x')), true);
  assert.equal(L.isLoginPage(new URL('https://www.viagogo.com/secure/login')), true);
  assert.equal(L.isLoginPage(new URL('https://sell.viagogo.com/ww/Secure/Pipeline/Sell/TicketDetails/Quantity?ID=1')), false);
  assert.equal(L.isLoginPage(new URL('https://example.com/login')), false);
});

test('isPastWhen: a date 2–200 days back this year is over, anything else is not', () => {
  const now = new Date(2026, 10, 5).getTime();                 // 5 Nov 2026
  assert.equal(L.isPastWhen('Sat, 18 Oct · 20:45', now), true);
  assert.equal(L.isPastWhen('Sat 14 Nov', now), false);
  assert.equal(L.isPastWhen('Wed, 4 Nov', now), false);         // yesterday: still sellable a moment
  assert.equal(L.isPastWhen('Sat, 10 Jan', now), false);        // next year
  assert.equal(L.isPastWhen('', now), false);
});

test('scanTargets: every event the team lists on, once, recent and not over', () => {
  const now = new Date(2026, 10, 5).getTime();
  const day = 86400000;
  const list = L.scanTargets({
    listings: [
      { vgEventId: '161613530', title: 'Albania vs Finland', when: 'Sat 14 Nov', eventKey: 'ebileta:1', seenAt: now - day },
      { vgEventId: '161613530', title: 'Albania vs Finland', when: 'Sat 14 Nov', seenAt: now - day },
      { vgEventId: '161600001', title: 'Old game', when: 'Sat, 18 Oct', seenAt: now - day },
      { vgEventId: '161600002', title: 'Not seen lately', when: 'Sat 21 Nov', seenAt: now - 30 * day },
      { vgEventId: '', title: 'No id', seenAt: now }
    ],
    teamPrices: [{ vgEventId: '161600003', title: 'Kosovo vs Sweden', when: 'Tue 17 Nov', seenAt: now - 2 * day }]
  }, now);
  assert.deepEqual(list.map(x => [x.vgEventId, x.source]), [['161613530', 'yours'], ['161600003', 'team']]);
  assert.equal(list[0].eventKey, 'ebileta:1');
});

test('scanPlan: the team\'s list adds events, leaves some out and sets their interval', () => {
  const now = new Date(2026, 10, 5).getTime();
  const src = {
    listings: [{ vgEventId: '161613530', title: 'Albania vs Finland', when: 'Sat 14 Nov', seenAt: now }],
    teamPrices: [{ vgEventId: '161600003', title: 'Kosovo vs Sweden', when: 'Tue 17 Nov', seenAt: now }],
    watch: {
      '161600003': { mode: 'off' },
      '161699999': { mode: 'add', title: 'Research: Serbia vs England', when: 'Sun 22 Nov', every: 60 },
      '161613530': { every: 5 }
    }
  };
  const plan = L.scanPlan(src, now);
  assert.deepEqual(plan.on.map(x => [x.vgEventId, x.source, x.every]),
    [['161613530', 'yours', 15], ['161699999', 'added', 60]], 'own interval, never under 15 min');
  assert.deepEqual(plan.off.map(x => [x.vgEventId, x.source]), [['161600003', 'team']]);
  assert.equal(plan.on[1].title, 'Research: Serbia vs England');
});

test('eventIdFrom: a viagogo link or the number', () => {
  assert.equal(L.eventIdFrom('https://www.viagogo.com/Sports-Tickets/Soccer/Albania-National-Football-Team-Tickets/E-161613530'), '161613530');
  assert.equal(L.eventIdFrom('https://www.viagogo.com/ww/Secure/Pipeline/Sell/Initialise?EventID=161613530'), '161613530');
  assert.equal(L.eventIdFrom(' 161613530 '), '161613530');
  assert.equal(L.eventIdFrom('hello'), '');
});

test('nextTarget: the longest-waiting event that is due and not set aside', () => {
  const now = 10 * 3600000;
  const hour = 3600000;
  const targets = [{ vgEventId: 'a' }, { vgEventId: 'b' }, { vgEventId: 'c' }, { vgEventId: 'd' }];
  const history = {
    a: { at: now - 2 * hour },
    b: { at: now - 3 * hour, skipUntil: now + hour },           // set aside
    c: { at: now - 10 * 60000 },                                // not due
    d: { at: now - 90 * 60000 }
  };
  assert.equal(L.nextTarget(targets, history, hour, now).vgEventId, 'a');
  assert.equal(L.nextTarget([{ vgEventId: 'e' }].concat(targets), history, hour, now).vgEventId, 'e');   // never visited first
  assert.equal(L.nextTarget([{ vgEventId: 'c' }], history, hour, now), null);
  assert.equal(L.nextTarget([{ vgEventId: 'c', every: 5 }], history, hour, now).vgEventId, 'c', 'its own interval wins');
});

test('scanGap is 45 to 75 seconds', () => {
  assert.equal(L.scanGap(0), 45000);
  assert.equal(L.scanGap(1), 75000);
});

test('recentSoldUrl is the sell page\'s own request, and needs a session', () => {
  assert.equal(L.recentSoldUrl('50e4a792-0922-41c1-a78f-4758882389ec'),
    'https://sell.viagogo.com/Secure/Pipeline/Sell/GetRecentlySoldListingForEvent?ID=50e4a792-0922-41c1-a78f-4758882389ec');
  assert.equal(L.recentSoldUrl('161613530'), '');
  assert.equal(L.recentSoldUrl(''), '');
});

test('parseRecentSold reads viagogo\'s answer as captured on 2026-11-06, and {} as nothing', () => {
  const json = { listingId: 14514628268, quantity: 1, section: 'N207', price: '$21.75', eventName: 'Albania vs Finland - Nations League',
    categoryImageUrl: 'https://media.stubhubstatic.com/x.jpg' };
  assert.deepEqual(L.parseRecentSold(json), {
    title: 'Albania vs Finland - Nations League', section: 'N207', row: '', tickets: 1, price: 21.75, currency: 'USD', listingId: '14514628268'
  });
  assert.equal(L.parseRecentSold({}), null);
  assert.equal(L.parseRecentSold(null), null);
  assert.equal(L.parseRecentSold({ listingId: 1, quantity: 2, section: 'N207', price: '', eventName: 'X' }), null);
  /* the same sale read off the page and asked of viagogo is the same sale */
  const fromApi = L.clean(L.parseRecentSold(json));
  const fromPage = L.clean(L.parseToast(['Tickets for Albania vs Finland - Nations League were just purchased!', 'N207 • 1 ticket', '$21.75', 'Just sold!']));
  assert.equal(L.fingerprint(fromApi), L.fingerprint(fromPage));
  assert.equal(fromApi.listingId, '14514628268');
});

test('compare: another listing is another sale, even at the same section, tickets and price', () => {
  const base = { title: 'Albania vs Finland', section: 'N207', tickets: 1, price: 21.75, currency: 'USD' };
  const saved = [Object.assign({}, L.clean(base), { id: '1', firstSeen: 1, listingId: '14514628268' })];
  assert.equal(L.compare(saved, L.clean(Object.assign({ listingId: '14514628268' }, base))).same, true);
  assert.equal(L.compare(saved, L.clean(Object.assign({ listingId: '14514699999' }, base))).same, false);
  assert.equal(L.compare(saved, L.clean(base)).same, true, 'the toast on a page has no listing: same as before');
});

test('sessionsFrom reads viagogo\'s list of sell sessions in the browser', () => {
  const raw = JSON.stringify({
    '161613530': { pipelineStateId: '50e4a792-0922-41c1-a78f-4758882389ec', lastUpdated: 1793949954985 },
    '161600003': { pipelineStateId: '4d27d558-0000-41c1-a78f-4758882389ec', lastUpdated: 1793940000000 },
    junk: { pipelineStateId: 'x' }
  });
  assert.deepEqual(L.sessionsFrom(raw), {
    '161613530': { id: '50e4a792-0922-41c1-a78f-4758882389ec', at: 1793949954985 },
    '161600003': { id: '4d27d558-0000-41c1-a78f-4758882389ec', at: 1793940000000 }
  });
  assert.deepEqual(L.sessionsFrom(JSON.stringify({ state: { '161613530': { pipelineStateId: '50e4a792-0922-41c1-a78f-4758882389ec' } } })),
    { '161613530': { id: '50e4a792-0922-41c1-a78f-4758882389ec', at: 0 } }, 'wrapped');
  assert.deepEqual(L.sessionsFrom('not json'), {});
  assert.deepEqual(L.sessionsFrom(null), {});
});

test('isBotAnswer: 403, 429 or DataDome\'s page', () => {
  assert.equal(L.isBotAnswer(403, ''), true);
  assert.equal(L.isBotAnswer(429, ''), true);
  assert.equal(L.isBotAnswer(200, '{"url":"https://geo.captcha-delivery.com/captcha/?initialCid=x"}'), true);
  assert.equal(L.isBotAnswer(200, '{"listingId":1}'), false);
  assert.equal(L.isBotAnswer(404, 'not found'), false);
});

test('priceSplit and priceText: the total and what each ticket comes to', () => {
  const fmt = (n, c) => `${c === 'USD' ? '$' : c + ' '}${n}`;
  assert.deepEqual(L.priceSplit({ price: 100, tickets: 4 }), { total: 100, each: 25 });
  assert.deepEqual(L.priceSplit({ price: 82.24, tickets: 3 }), { total: 82.24, each: 27.41 });
  assert.deepEqual(L.priceSplit({ price: null, tickets: 3 }), { total: null, each: null });
  assert.equal(L.priceText({ price: 100, tickets: 4, currency: 'USD' }, fmt), '$100 | $25/pc');
  assert.equal(L.priceText({ price: 21.75, tickets: 1, currency: 'USD' }, fmt), '$21.75', 'one ticket: no split');
  assert.equal(L.priceText({ price: 90, tickets: 2, currency: 'EUR' }, fmt), 'EUR 90 | EUR 45/pc');
});

test('byDay and dayLine: each day\'s sales, tickets and heading, newest day first', () => {
  const at = (d, h) => new Date(2026, 10, d, h, 0).getTime();
  const list = [
    { id: 'a', tickets: 4, firstSeen: at(6, 18) },
    { id: 'b', tickets: 2, firstSeen: at(6, 9) },
    { id: 'c', tickets: 3, firstSeen: at(5, 22) },
    { id: 'd', tickets: 1, firstSeen: at(3, 12) }
  ];
  const days = L.byDay(list);
  assert.deepEqual(days.map(g => [g.day, g.sales.map(s => s.id).join(''), g.tickets]), [
    ['2026-11-06', 'ab', 6], ['2026-11-05', 'c', 3], ['2026-11-03', 'd', 1]
  ]);
  const now = at(6, 20);
  assert.equal(L.dayLine(days[0], now), 'Today · 6 Nov · 6 tickets · 2 sales');
  assert.equal(L.dayLine(days[1], now), 'Yesterday · 5 Nov · 3 tickets · 1 sale');
  assert.equal(L.dayLine(days[2], now), 'Tue 3 Nov · 1 ticket · 1 sale');
  assert.equal(L.dayLabel(new Date(2025, 11, 30).getTime(), now), 'Tue 30 Dec 2025');
  assert.deepEqual(L.byDay([]), []);
});

test('scanQueue: the next turns, one request per gap, a turn more to start a session', () => {
  const now = 1e12;
  const t = [{ vgEventId: '1000001' }, { vgEventId: '1000002' }, { vgEventId: '1000003', every: 60 }];
  const h = { '1000001': { at: now - 31 * 60000 }, '1000002': { at: now - 10 * 60000 }, '1000003': { at: 0 } };
  const q = L.scanQueue(t, h, 30 * 60000, { now, gapMs: 60000, withSession: ['1000001', '1000002', '1000003'] });
  assert.equal(q['1000003'], now, 'never asked: first');
  assert.equal(q['1000001'], now + 60000);
  assert.equal(q['1000002'], now + 20 * 60000, 'not due before its interval');
  const late = L.scanQueue(t, h, 30 * 60000, { now, startAt: now + 3600000, gapMs: 60000 });
  assert.ok(Object.values(late).every(v => v >= now + 3600000), 'nothing before a block ends');
  assert.equal(late['1000003'], now + 3600000 + 60000, 'a turn to start its session first');
  const skip = L.scanQueue([{ vgEventId: '1000001' }], { '1000001': { at: 0, skipUntil: now + 5000 } }, 30 * 60000, { now, gapMs: 60000, withSession: ['1000001'] });
  assert.equal(skip['1000001'], now + 5000);
});

test('requestsPerHour', () => {
  assert.equal(L.requestsPerHour([{ vgEventId: '1' }, { vgEventId: '2', every: 60 }], 30), 3);
  assert.equal(L.requestsPerHour(Array.from({ length: 200 }, (_, i) => ({ vgEventId: String(i) })), 15), 60, 'never more than the gap allows');
});
