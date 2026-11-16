/* Run with:  node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../core/util.js');
require('../core/profit.js');
const SK = require('../core/registry.js');
require('../sites/ebileta.js');
const EB = SK.ebileta;

test('eBileta Kosovo (eu.ebileta.al) is its own site, its events known by idSM', () => {
  const al = SK.site('ebileta'), ks = SK.site('ebileta-ks');
  assert.ok(al && ks);
  assert.equal(ks.label, 'eBileta Kosovo');
  const list = 'https://eu.ebileta.al/biglietteria/listaEventiPub.do';
  const seat = 'https://eu.ebileta.al/biglietteria/pub/buyseats/scegliPostoPub.do?idSett=437&idSM=1215&tipoM=1';
  assert.equal(ks.eventFromUrl(list), null, 'the event page itself names no event');
  assert.equal(ks.eventFromUrl(seat), '1215', 'a sector link names it by idSM');
  assert.equal(ks.eventFromUrl(list + '?idSM=1215'), '1215');
  assert.equal(al.eventFromUrl(seat), null, 'an eu.ebileta.al page is never an al.ebileta.al event');
  assert.equal(al.eventFromUrl('https://al.ebileta.al/biglietteria/pub/buyseats/scegliSettorePub.do?idEvento=2153'), '2153');
  assert.equal(al.eventFromUrl('https://al.ebileta.al/biglietteria/pub/buyseats/scegliPostoPub.do?idSett=1&idSM=9&tipoM=1'), null, 'eBileta keeps idEvento');
  assert.equal(SK.eventForUrl(seat).site, 'ebileta-ks');
  assert.equal(ks.eventUrl({ siteId: '1215' }), list);
  assert.equal(EB.hostOf('eu.ebileta.al').currency, 'EUR');
  assert.equal(EB.hostOf('al.ebileta.al').id, 'ebileta');
  assert.equal(EB.hostOf('example.com'), null);
  assert.ok(EB.isEbileta('ebileta-ks') && EB.isEbileta('ebileta') && !EB.isEbileta('efinity'));
});

test('the address that names the page: idSM added when it names no event', () => {
  const ks = EB.hostOf('eu.ebileta.al'), al = EB.hostOf('al.ebileta.al');
  const secs = [{ id: '444', idSM: '1215' }];
  assert.equal(EB.eventPageUrl(ks, 'https://eu.ebileta.al/biglietteria/listaEventiPub.do', secs), 'https://eu.ebileta.al/biglietteria/listaEventiPub.do?idSM=1215');
  assert.equal(EB.eventPageUrl(ks, 'https://eu.ebileta.al/biglietteria/listaEventiPub.do', []), null);
  /* al.ebileta does it too, once it has one event left on sale */
  assert.equal(EB.eventPageUrl(al, 'https://al.ebileta.al/biglietteria/listaEventiPub.do', secs), 'https://al.ebileta.al/biglietteria/listaEventiPub.do?idSM=1215');
  const alUrl = 'https://al.ebileta.al/biglietteria/pub/buyseats/scegliSettorePub.do?idEvento=2153';
  assert.equal(EB.eventPageUrl(al, alUrl, secs), alUrl);
  assert.deepEqual(EB.splitHeading('Kosova - Republika e Irlandes - September 24, 2026, 8:45 PM - FADIL VOKRRI STADIUM'),
    { title: 'Kosova - Republika e Irlandes', date: 'September 24, 2026, 8:45 PM', venue: 'FADIL VOKRRI STADIUM' });
  assert.equal(EB.splitHeading('Just a title').title, 'Just a title');
});

test('Kosovo: sectors and the event list both come from listaEventiPub.do', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/ebileta-ks-sectors.html'), 'utf8');
  const asked = [];
  const net = page => ({ text: async url => { asked.push(url); return page; } });
  const ks = SK.site('ebileta-ks');
  const got = await ks.loadEvent({ siteId: '1215', title: '' }, { net: net(html) });
  assert.deepEqual(got.sectors.map(x => x.code), ['J2', 'P2', 'V1', 'VIP1']);
  assert.equal(asked[0], 'https://eu.ebileta.al/biglietteria/listaEventiPub.do');
  await assert.rejects(ks.loadEvent({ siteId: '9999' }, { net: net(html) }), /no longer on the event page/);
  await assert.rejects(ks.loadEvent({ siteId: '1215' }, { net: net('<html>You are now in line</html>') }), /queue/);
  assert.deepEqual(await ks.listEvents({ net: net(html) }),
    [{ siteId: '1215', title: 'Kosova - Republika e Irlandes', date: 'September 24, 2026, 8:45 PM', venue: 'FADIL VOKRRI STADIUM', status: 'unknown' }]);
  await assert.rejects(ks.listEvents({ net: net('<html>queue</html>') }), /queue/);
});

test('the Kosovo sector list: "Sektori J2" -> J2, VIP1 as is, availability, links on eu.ebileta.al', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/ebileta-ks-sectors.html'), 'utf8');
  const { title, sections } = EB.parseSections(html);
  assert.equal(title, 'Kosova - Republika e Irlandes - September 24, 2026, 8:45 PM - FADIL VOKRRI STADIUM');
  assert.deepEqual(sections.map(s => [s.id, s.code, s.status, s.idSM]),
    [['444', 'J2', 'high', '1215'], ['447', 'P2', 'low', '1215'], ['440', 'V1', 'high', '1215'], ['452', 'VIP1', 'high', '1215']]);
  const ks = SK.site('ebileta-ks');
  const ev = { site: 'ebileta-ks', siteId: '1215' };
  assert.equal(ks.sectorUrl(ev, EB.toSector(sections[2])), 'https://eu.ebileta.al/biglietteria/pub/buyseats/scegliPostoPub.do?idSett=440&idSM=1215&tipoM=1');
  assert.equal(SK.site('ebileta').sectorUrl(ev, EB.toSector(sections[2])), 'https://al.ebileta.al/biglietteria/pub/buyseats/scegliPostoPub.do?idSett=440&idSM=1215&tipoM=1');
});

test('Kosovo seat pages: seats as on eBileta, prices in euro', () => {
  const html = `<div class="tabprezzi"><h2>Sektori V1</h2><div class="prezzi">Rates from €25.00 to €40.00</div></div>
    <script>var posti = [ [9001, true, 441.4, 174.1, 7.5, 0, 'Sektori V1 Rreshti 1 Vendi 31', '31', 3], [9002, false, 453.9, 174.1, 7.5, 0, 'Sektori V1 Rreshti 1 Vendi 32', '32', 3] ];</script>`;
  const parsed = EB.parseSeats(html, 'EUR');
  assert.equal(parsed.section, 'Sektori V1');
  assert.deepEqual(parsed.seats.map(s => [s.row, s.seat, s.free]), [['1', '31', true], ['1', '32', false]]);
  assert.deepEqual(parsed.price, { min: 25, max: 40, currency: 'EUR' });
});

/* al.ebileta normally names an event by idEvento and lists its sectors at
 * scegliSettorePub.do. With one event left on sale it drops the list and puts
 * that event's sectors on listaEventiPub.do, which names no event at all —
 * the shape eu.ebileta is always in. An event tracked before that happened
 * has to keep working. */
test('al.ebileta: an event whose page moves to the event list keeps working', async () => {
  const al = SK.site('ebileta');
  const sectors = fs.readFileSync(path.join(__dirname, 'fixtures/ebileta-ks-sectors.html'), 'utf8')
    .replace(/eu\.ebileta\.al/g, 'al.ebileta.al');
  const LIST = 'https://al.ebileta.al/biglietteria/listaEventiPub.do';
  const OWN = 'https://al.ebileta.al/biglietteria/pub/buyseats/scegliSettorePub.do?idEvento=2153';

  /* its own page has stopped answering; the list page now carries its sectors */
  const asked = [];
  const net = {
    text: async url => {
      asked.push(url);
      return url === LIST ? sectors : '<html>nothing here</html>';
    }
  };
  /* what the event looks like after any earlier scan: its sectors carry the idSM */
  const tracked = { siteId: '2153', title: 'Kosova - Republika e Irlandes', sectors: [{ id: '444', meta: { idSM: '1215' } }] };

  const got = await al.loadEvent(tracked, { net });
  assert.equal(asked[0], OWN, 'its own page is tried first');
  assert.equal(asked[1], LIST, 'then the event list page');
  assert.deepEqual(got.sectors.map(x => x.code), ['J2', 'P2', 'V1', 'VIP1'], 'and its sectors are found there');

  /* the event on that page is a different match: its seats must never be
   * scanned into ours just because it is the only one left */
  const other = { siteId: '2153', sectors: [{ id: '444', meta: { idSM: '9999' } }] };
  await assert.rejects(al.loadEvent(other, { net }), /no longer on the event page/);

  /* tracked by number, never scanned, so nothing to recognise it by */
  await assert.rejects(al.loadEvent({ siteId: '2153' }, { net }), /names no idEvento/);

  /* the page names the event by its seating map, and that is a real id */
  assert.equal(al.eventFromUrl(LIST + '?idSM=1215'), 'sm1215');
  assert.equal(al.eventFromUrl(LIST), null, 'without one it names nothing');
  assert.equal(al.eventUrl({ siteId: 'sm1215' }), LIST, 'such an event lives on the list page');
  assert.equal(al.eventUrl({ siteId: '2153' }), OWN, 'a numbered one still has its own');
  assert.equal(EB.idSMOf(tracked), '1215');
  assert.equal(EB.idSMOf({ siteId: 'sm1215' }), '1215');
  assert.equal(EB.idSMOf({ siteId: '2153' }), '', 'a number on its own says nothing about the map');

  /* and the event list falls back to that one event instead of coming back empty */
  assert.deepEqual(await al.listEvents({ net: { text: async () => sectors } }),
    [{ siteId: 'sm1215', title: 'Kosova - Republika e Irlandes', date: 'September 24, 2026, 8:45 PM', venue: 'FADIL VOKRRI STADIUM', status: 'unknown' }]);
});

test('a sector eBileta drops from the event page is kept, sold out and marked gone', () => {
  const al = SK.site('ebileta');
  const sec = (id, status, extra) => ({ id, code: 'N' + id, name: 'TRIBUNA N' + id, meta: Object.assign({ idSM: '9', tipoM: '1', status }, extra) });
  const prev = [sec('1', 'high'), sec('2', 'soldout'), sec('3', 'low')];
  const fresh = [sec('1', 'high'), sec('3', 'soldout')];

  const kept = al.keepSectors(prev, fresh, 1000);
  assert.deepEqual(kept.map(s => s.id), ['1', '3', '2'], 'the page order first, the dropped ones after');
  assert.deepEqual(kept[2].meta, { idSM: '9', tipoM: '1', status: 'soldout', gone: 1000 });
  assert.ok(al.isGone(kept[2]) && !al.isGone(kept[0]));
  assert.equal(al.sectorHint(kept[2]), 'removed from the site');
  assert.equal(al.scanAllFilter(kept[2]), false, 'never part of a Scan all');

  /* still missing next time: the same record, so nothing is written again */
  const again = al.keepSectors(kept, fresh, 5000);
  assert.equal(JSON.stringify(again), JSON.stringify(kept));
  /* what it kept on the way out (its price) stays with it */
  const priced = kept.map(s => (s.id === '2' ? Object.assign({}, s, { meta: Object.assign({}, s.meta, { price: { min: 900, max: 1000, currency: 'ALL' } }) }) : s));
  assert.deepEqual(al.keepSectors(priced, fresh, 9000)[2].meta.price, { min: 900, max: 1000, currency: 'ALL' });

  /* listed again: the page's own record, no longer gone */
  const back = al.keepSectors(kept, [sec('1', 'high'), sec('2', 'low'), sec('3', 'soldout')], 9000);
  assert.deepEqual(back.map(s => [s.id, s.meta.status, !!s.meta.gone]), [['1', 'high', false], ['2', 'low', false], ['3', 'soldout', false]]);
  assert.equal(SK.site('ebileta-ks').keepSectors([sec('7', 'high')], [], 1)[0].meta.gone, 1);
});

test('each sector keeps its outline on the stadium map, and keeps it once eBileta takes the polygon away', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/ebileta-ks-sectors.html'), 'utf8');
  const { sections } = EB.parseSections(html);
  const v1 = sections.find(s => s.code === 'V1');
  assert.deepEqual(v1.shape, { points: '278,631 308,684 351,731 384,760 349,821 288,767 248,716 209,650', vb: '0 0 1504 1059' });
  assert.equal(sections.find(s => s.code === 'J2').shape, undefined, 'no polygon on the page, no outline');
  assert.deepEqual(EB.toSector(v1).meta.shape, v1.shape);
  assert.equal('shape' in EB.toSector(sections[0]).meta, false);

  const ks = SK.site('ebileta-ks');
  const withShape = sections.map(EB.toSector);
  /* the polygon gone from the page, the sector still listed: the outline stays */
  const noPoly = withShape.map(s => Object.assign({}, s, { meta: Object.assign({}, s.meta) })).map(s => { delete s.meta.shape; return s; });
  assert.deepEqual(ks.keepSectors(withShape, noPoly, 1).find(s => s.id === v1.id).meta.shape, v1.shape);
  /* and the sector gone too */
  const gone = ks.keepSectors(withShape, noPoly.filter(s => s.id !== v1.id), 1).find(s => s.id === v1.id);
  assert.ok(gone.meta.gone && gone.meta.shape.points.startsWith('278,631'));
});

test('Air Albania stands for the viagogo drawer: the code\'s letter, and the corners on their own', () => {
  const E = SK.ebileta;
  const corners = ['n106', 'n206', 'n207', 'e101', 'e201', 'e202', 'e210', 'e109', 'e211', 's201', 's101', 's202'];
  for (const c of corners) assert.equal(E.standOf(c), 'corner', c);
  assert.deepEqual(['N101', 'E105', 'S203', 'V101', 'W104', 'Section E 106', 'N-205'].map(E.standOf), ['N', 'E', 'S', 'V', 'W', 'E', 'N']);
  assert.equal(E.standOf('TETRAPLEGJIK N'), '', 'no stand for what is not a numbered section');
  assert.equal(E.stadiumCode('section n 106'), 'N106');
});

test('a viagogo section written "Section E106" or "Section E 106" is sector E106', () => {
  const sectors = [{ id: '1', code: 'E106', name: 'TRIBUNA E106' }, { id: '2', code: 'N103', name: 'TRIBUNA N103' }];
  for (const label of ['Section E106', 'Section E 106', 'section e-106', 'E106']) {
    assert.equal((SK.resolveSector('ebileta', label, sectors).sector || {}).id, '1', label);
  }
  assert.equal(SK.resolveSector('ebileta', 'Section N106', sectors).sector, undefined, 'a sector the event does not have is not guessed');
  assert.equal((SK.resolveSector('ebileta', 'TRIBUNA N103', sectors).sector || {}).id, '2', 'eBileta\'s own name still works');
});
