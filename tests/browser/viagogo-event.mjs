/* Browser test: the viagogo event page drawer.
 *
 * A stand-in viagogo event page built from the capture of 2026-09-17: real
 * listing-row markup (tests/browser/fixtures/viagogo-event-row.html) inside the
 * wrapper div viagogo added in October 2026 (it repeats data-listing-id), pages of
 * up to 10 rows with "Show more" that appends and then disappears, and a
 * section chosen with ?sections=<sprite>&ticketClasses=<zone> that narrows the
 * same list to that section.
 * The extension's page scripts run as they do in Chrome, with a stand-in for
 * the service worker.
 *
 *   node tests/browser/viagogo-event.mjs
 *   CHROME=/path/to/chrome node tests/browser/viagogo-event.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '../..');
const SHOTS = path.join(os.tmpdir(), 'seat-tracker-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true })) : [];
  for (const d of dirs) {
    for (const p of ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-linux/chrome']) {
      const f = path.join(base, d, p);
      if (fs.existsSync(f)) return f;
    }
  }
  throw new Error('Chrome for Testing not found — set CHROME=/path/to/chrome');
}

const ROW = fs.readFileSync(path.join(HERE, 'fixtures/viagogo-event-row.html'), 'utf8').trim();
const EVENT_PATH = '/ww/Sports-Tickets/Soccer/Albania-National-Football-Team-Tickets/E-161613516';
const url = (spa, extra) => `https://www.viagogo.com${EVENT_PATH}?lt=41.3214274&lg=19.8165576&quantity=0&sections=${extra || ''}&ticketClasses=${extra ? '26127' : ''}&rows=&seats=&seatTypes=&listingQty=&spa=${spa}`;

const SECTIONS = [['E101', '1844496', '26127'], ['N102', '1844491', '26129'], ['E106', '1844501', '26127'], ['S202', '1844533', '26130'], ['E210', '1844530', '26127']];

/* the stand-in viagogo page */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Albania vs Belarus - Nations League Air Albania Stadium (Arena Kombëtare) Tirana Tickets | Sat 26 Sep 2026 - viagogo</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SportsEvent","name":"Albania vs Belarus - Nations League","startDate":"2026-09-26T20:45:00","location":{"@type":"Place","name":"Air Albania Stadium (Arena Kombëtare)"}}</script>
<style>body{margin:0;font-family:Helvetica,Arial,sans-serif}#layout{display:grid;grid-template-columns:1fr 520px;height:100vh}#map{background:#e8efe3}[data-testid=ExpandableScrollContainer]{overflow-y:auto;height:100vh}.ensemble_listingCard__root{display:flex;gap:12px;padding:10px;border-bottom:1px solid #eee}img{display:none}</style></head>
<body><div id="app">
<svg id="section-map-base" width="0" height="0" style="position:absolute"><defs>
<g id="map-def">${SECTIONS.map(([, s, z]) => `<g sprite-identifier="s${s}"><path d="…" eid="${z}" t="tc"></path></g>`).join('')}</g>
<g id="map-def-with-text">${SECTIONS.map(([l, s, z]) => `<g sprite-identifier="s${s}"><path d="…" eid="${z}" t="tc"></path><text eid="${z}" t="tc">${l}</text></g>`).join('')}</g>
</defs></svg>
<div id="event-detail-header"><h1>Albania vs Belarus - Nations League</h1></div>
<div id="layout"><div id="map" data-testid="map-container"><canvas class="maplibregl-canvas"></canvas></div>
<div data-testid="ExpandableScrollContainer"><div id="listings-container" data-testid="listings-container"></div></div></div>
</div>
<template id="row-tpl">${ROW}</template>
<script>
(function () {
  const SPA = new URLSearchParams(location.search).get('spa') === '1';
  /* signed out: no listing IDs, no "Your listing", other display prices, and
     E106's listing of yours is not shown to a buyer at all */
  const OUT = new URLSearchParams(location.search).get('signedout') === '1';
  const TPL = document.getElementById('row-tpl').innerHTML;
  const OWN = [['13981313702', '1844496', '26127', 'E101', 'B', 18], ['14048806484', '1844491', '26129', 'N102', '', 20], ['13988951528', '1844501', '26127', 'E106', 'ALB', 67]]
    .map(([id, sprite, zone, section, row, price]) => ({ id, sprite, zone, section, row, price, mine: true }));
  const OTHERS = [
    ['900001', '1844496', '26127', 'E101', 'C', 16], ['900002', '1844496', '26127', 'E101', 'D', 16],
    ['900010', '1844491', '26129', 'N102', '', 23], ['900011', '1844491', '26129', 'N102', '', 25],
    ...[55, 58, 60, 63, 66, 70, 72, 75, 80, 85, 90].map((p, i) => [String(900020 + i), '1844501', '26127', 'E106', '', p]),
    ['900040', '1844533', '26130', 'S202', '', 16], ['900041', '1844533', '26130', 'S202', '', 16],
    ['900050', '1844530', '26127', 'E210', '', 16], ['13977957138', '1844530', '26127', 'E210', '', 16]
  ].map(([id, sprite, zone, section, row, price, hidden]) => ({ id, sprite, zone, section, row, price, hidden: !!hidden,
    /* four of E106's sellers deliver at once: "Instant Download" where the others say "Aisle seat" */
    instant: ['900020', '900023', '900026', '900029'].includes(id) }));

  function rowHtml(r, i) {
    let h = TPL.split('13981313702').join(r.id).split('26127_1844496').join(r.zone + '_' + r.sprite)
      .split('Section E101').join('Section ' + r.section).split('$18').join('$' + r.price)
      .replace('data-index="0"', 'data-index="' + i + '"').replace(/<s>\\$30<\\/s>/, '').replace('-41%', '')
      .split(', Row B,').join(r.row ? ', Row ' + r.row + ',' : ',').replace('>Row B</p>', '>' + (r.row ? 'Row ' + r.row : '') + '</p>');
    if (!r.mine || OUT) h = h.replace(/Your listing - \\d+/, '');
    /* viagogo's label since 2026-11: "Your tickets - <id>"; two of the three own rows use it */
    else if (r.id !== '13981313702') h = h.replace('Your listing - ', 'Your tickets - ');
    if (r.instant) h = h.split('Aisle seat').join('Instant Download');
    if (OUT) h = h.replace(/ data-listing-id="\\d+"/, '').split('listing-' + r.id).join('listing-').split('$' + r.price).join('$' + (r.price + 3));
    return h;
  }

  let pages = 1;
  const selected = () => new URLSearchParams(location.search).get('sections') || '';
  function renderList(reset) {
    const c = document.getElementById('listings-container');
    const sel = selected();
    const others = sel ? OTHERS.filter(r => r.sprite === sel) : OTHERS;
    const all = (OUT ? OWN.filter(r => r.id !== '13988951528') : OWN).concat(others);
    const total = all.length;
    const show = Math.min(all.length, pages * 10);
    if (reset) c.innerHTML = '';
    const old = c.querySelector('.footer');
    if (old) old.remove();
    const have = c.querySelectorAll('.ensemble_listingCard__root').length;
    let html = '';
    /* since 2026-10: each card sits in a wrapper div that repeats its listing ID */
    for (let i = have; i < show; i++) html += '<div data-image-container="true"' + (OUT ? '' : ' data-listing-id="' + all[i].id + '"') + '><div><div class="sc-iCoGMa">' + rowHtml(all[i], i) + '</div></div><hr></div>';
    c.insertAdjacentHTML('beforeend', html);
    const more = show < all.length;
    c.insertAdjacentHTML('beforeend', '<div class="footer"><p>Showing ' + show + ' of ' + total + '</p>' + (more ? '<button type="button"><span>Show more</span></button>' : '') + '</div>');
    if (more) c.querySelector('.footer button').addEventListener('click', () => setTimeout(() => { pages++; renderList(false); }, 400));
  }
  /* a click on the map: the page rewrites the address and redraws */
  window.__pickSection = sprite => {
    const u = new URL(location.href);
    const zone = { 1844496: '26127', 1844491: '26129', 1844501: '26127', 1844533: '26130', 1844530: '26127' }[sprite] || '';
    u.searchParams.set('sections', sprite || '');
    u.searchParams.set('ticketClasses', sprite ? zone : '');
    history.pushState({}, '', u);
    pages = 1;
    renderList(true);
  };
  /* the market moves on: E101's 900001 comes down $16 -> $14, S202's 900041 sells, a new N102 listing at $30 */
  window.__marketMoves = () => {
    OTHERS.find(r => r.id === '900001').price = 14;
    OTHERS.splice(OTHERS.findIndex(r => r.id === '900041'), 1);
    OTHERS.push({ id: '900099', sprite: '1844491', zone: '26129', section: 'N102', row: '', price: 30 });
    pages = 1;
    renderList(true);
    return true;
  };
  if (SPA) window.addEventListener('popstate', () => { pages = 1; renderList(true); });
  renderList(true);
})();
</script></body></html>`;

/* the service worker's answers: a tracked event with eBileta summaries, and the
   profit of listing 13981313702 read on the listings page */
const STUB = `(() => {
  /* storage that really stores, and starts from a drawer left open on an
     earlier visit — the state that used to reopen it on every page */
  const kept = { ui: { vgDrawer: { open: true, height: 300, sort: 'gap', onlyMine: false } } };
  const copy = v => JSON.parse(JSON.stringify(v));
  /* saved scans outlive a refresh, as in chrome.storage */
  const LASTING = k => k.startsWith('cache:vgscans:');
  try { Object.assign(kept, JSON.parse(localStorage.getItem('__lasting') || '{}')); } catch (e) { /* none yet */ }
  const keepLasting = () => localStorage.setItem('__lasting', JSON.stringify(Object.fromEntries(Object.entries(kept).filter(([k]) => LASTING(k)))));
  const area = {
    get: async k => {
      if (!k) return copy(kept);
      const out = {};
      for (const key of (Array.isArray(k) ? k : [k])) if (key in kept) out[key] = copy(kept[key]);
      return out;
    },
    set: async obj => { Object.assign(kept, copy(obj)); keepLasting(); },
    remove: async k => { for (const key of [].concat(k)) delete kept[key]; keepLasting(); }
  };
  window.__kept = () => copy(kept);
  window.chrome = {
    runtime: {
      id: 'seat-tracker-test', lastError: null,
      getURL: p => 'https://ext.local/' + p,
      onMessage: { addListener() {} },
      sendMessage(msg, cb) {
        if (msg.type === 'faceFor') {
          const face = { site: 'posttick', siteId: 'maxamini2027/show', title: 'Max Amini', url: 'https://posttick.com/c/maxamini2027/show/en/', currency: 'EUR', at: Date.now(),
            sectors: [{ code: 'E101', cat: 'CAT 2', price: 145, available: 4, longest: 2, total: 20, perTable: 0, unmapped: false },
                      { code: 'E101', cat: 'CAT 3', price: 119, available: 0, longest: 0, total: 10, perTable: 0, unmapped: false }] };
          return setTimeout(() => cb({ ok: true, data: { face, code: SK.face.pack(face) } }), 10);
        }
        if (msg.type === 'setSectorPrice' || msg.type === 'keepViagogoSector') {
          (window.__prices = window.__prices || []).push(msg);
          const extra = JSON.parse(localStorage.getItem('__extraSectors') || '[]');
          const code = msg.type === 'keepViagogoSector' ? SK.ebileta.stadiumCode(msg.label) : null;
          if (code) extra.push({ id: '16' + extra.length + '9', code, name: 'TRIBUNA ' + code, meta: { gone: Date.now(), status: 'soldout', saved: 'viagogo' }, hint: '', url: null, summary: null,
            price: Number(msg.amount) > 0 ? { amount: Number(msg.amount), currency: msg.currency, source: 'list', range: null } : null });
          localStorage.setItem('__extraSectors', JSON.stringify(extra));
          const data = code ? { sectorId: extra[extra.length - 1].id, code, how: 'twin', price: Number(msg.amount) > 0 ? { amount: Number(msg.amount), currency: msg.currency } : null } : { amount: msg.amount, currency: msg.currency };
          return setTimeout(() => cb({ ok: true, data }), 10);
        }
        if (msg.type === 'notifyTeam') { (window.__sent = window.__sent || []).push(msg); return setTimeout(() => cb({ ok: true, data: { sent: [{ userId: 'u2', name: 'Ana Krasniqi' }] } }), 10); }
        const cmp = () => { try { return JSON.parse(localStorage.getItem('__compares') || '{}'); } catch (e) { return {}; } };
        /* the last-sales scan: this event is not in it until Scan is pressed */
        if (msg.type === 'setLastSaleEvent') {
          const list = JSON.parse(localStorage.getItem('__lsw') || '[]').filter(e => e.vgEventId !== msg.vgEventId);
          if (msg.change.on !== false) list.push({ vgEventId: msg.vgEventId, title: msg.change.title, when: msg.change.when, source: 'added', on: true, every: 30, ownEvery: null, lastAt: 0, lastResult: '', nextAt: Date.now(), skipUntil: 0, session: false, sales: 0 });
          localStorage.setItem('__lsw', JSON.stringify(list));
          (window.__lswSent = window.__lswSent || []).push(msg);
          return setTimeout(() => cb({ ok: true, data: null }), 10);
        }
        if (msg.type === 'lastSaleCheckNow') {
          (window.__checkNow = window.__checkNow || []).push(msg);
          return setTimeout(() => cb({ ok: true, data: { kind: 'sale', sale: { section: 'S118', tickets: 2, price: 90, currency: 'USD' } } }), 10);
        }
        /* Supabase's vg_scans: the newest two per event, kept across a refresh */
        if (msg.type === 'saveVgScan' || msg.type === 'vgScans' || msg.type === 'deleteVgScan' || msg.type === 'resetVgScans') {
          const all = JSON.parse(localStorage.getItem('__vgRemote') || '[]');
          let list = all;
          if (msg.type === 'saveVgScan') {
            (window.__vgSaved = window.__vgSaved || []).push({ at: msg.scan.at, eventKey: msg.eventKey });
            /* a row read back has its database id, as scanFromRow gives it */
            if (!all.some(x => x.at === msg.scan.at)) list = all.concat(Object.assign({}, msg.scan, { dbId: 'db' + msg.scan.at })).sort((a, b) => a.at - b.at).slice(-2);
          }
          if (msg.type === 'deleteVgScan') list = all.filter(x => x.at !== msg.at);
          if (msg.type === 'resetVgScans') list = all.filter(x => x.eventId !== msg.vgEventId);
          localStorage.setItem('__vgRemote', JSON.stringify(list));
          const id = msg.vgEventId || (msg.scan && msg.scan.eventId);
          return setTimeout(() => cb({ ok: true, data: /^(delete|reset)/.test(msg.type) ? null : list.filter(x => x.eventId === id).reverse() }), 10);
        }
        if (msg.type === 'putCompare') { const all = cmp(); all[msg.compare.eventId] = msg.compare; localStorage.setItem('__compares', JSON.stringify(all)); return setTimeout(() => cb({ ok: true, data: msg.compare }), 10); }
        if (msg.type === 'dropCompare') { const all = cmp(); delete all[msg.eventId]; localStorage.setItem('__compares', JSON.stringify(all)); return setTimeout(() => cb({ ok: true, data: true }), 10); }
        setTimeout(() => {
          if (msg.type !== 'state') return cb({ ok: true, data: null });
          const sec = (id, code, free, price) => ({ id, code, name: 'TRIBUNA ' + code, meta: {}, hint: '', url: null, summary: { available: free, total: 600, longest: 20, at: Date.now() },
            price: price ? { amount: price, currency: 'ALL', source: 'list', range: null } : null });
          const ev = { key: 'ebileta:2153', num: 1, site: 'ebileta', siteLabel: 'eBileta', siteId: '2153', title: 'Shqiperi - Bjellorusi',
            date: 'Sht 26 sht 2026 20:45', archived: false, open: 1, total: 1, teamOpen: 1, teamTotal: 1, otherOwners: [], worst: 'OK',
            cats: {}, currency: '', autoMin: null, autoEvery: 5, lastScanAt: 0, lastScanBy: '', scanner: '', health: null, url: '', viagogo: null,
            sectors: [sec('1601', 'E101', 58, 1045), sec('1602', 'N102', 440, 545), sec('1603', 'E106', 331, 1045)].concat(JSON.parse(localStorage.getItem('__extraSectors') || '[]')) };
          const listing = { price: 50, payout: 270, tickets: 6, currency: 'USD', recommended: null, seenAt: Date.now() };
          const money = Object.assign(SK.profit.profitOf(listing, { amount: 1500, currency: 'ALL' }, { USD: 83.36 }), { rateDay: '2026-09-17', manualRates: [], listing });
          cb({ ok: true, data: {
            auth: { signedIn: true, email: 'you@example.com' }, settings: SK.settings.normalize({}),
            sites: [], events: [ev, { key: 'posttick:maxamini2027/show', num: 2, site: 'posttick', siteId: 'maxamini2027/show', title: 'Max Amini', date: '27.11.2026', archived: false, sectors: [], cats: {} }], requests: [], scans: {}, catalog: [], devices: [], snoozeUntil: 0, meta: {},
            team: [{ userId: 'me', name: 'Sam Rivers', me: true }, { userId: 'u2', name: 'Ana Krasniqi', me: false }],
            teamPrices: [
              { listingId: 'a1', userId: 'u2', owner: 'Ana Krasniqi', eventKey: ev.key, sectorId: null, section: 'S202', row: '', price: 88, currency: 'USD', tickets: 6, status: 'active', seenAt: Date.now() },
              { listingId: 'a2', userId: 'u2', owner: 'Ana Krasniqi', eventKey: ev.key, sectorId: null, section: 'S202', row: '', price: 92, currency: 'USD', tickets: 6, status: 'active', seenAt: Date.now() },
              { listingId: 'a3', userId: 'u2', owner: 'Ana Krasniqi', eventKey: ev.key, sectorId: null, section: 'E106', row: '', price: 95, currency: 'USD', tickets: 6, status: 'active', seenAt: Date.now() }
            ],
            listings: [{ id: '13981313702', vgEventId: '161613516', eventKey: ev.key, money },
              /* N102's listing: its request is Bought, so it counts as instant whatever viagogo says */
              { id: '14048806484', vgEventId: '161613516', eventKey: ev.key, state: 'bought', reqStatus: 'BOUGHT' }],
            compares: Object.values(cmp()),
            lastSaleScan: { every: 30, here: true, holder: '', blockedUntil: 0, pausedUntil: 0, events: 0, list: JSON.parse(localStorage.getItem('__lsw') || '[]') },
            /* the "just sold" toasts: by viagogo ID, by tracked event, by name — and one of another event */
            lastSales: [
              { id: '3', vgKey: 'albaniavsbelarusnationsleague', vgEventId: '161613516', eventKey: null, title: 'Albania vs Belarus - Nations League', when: '', section: 'S205', row: '', tickets: 4, price: 100, currency: 'USD', firstSeen: Date.now() - 5 * 60000, lastSeen: Date.now() - 5 * 60000, seenCount: 1, seenBy: 'PC 1', code: '' },
              { id: '2', vgKey: 'albaniavsbelarusnationsleague', vgEventId: '', eventKey: ev.key, eventNum: 1, eventTitle: 'Shqiperi - Bjellorusi', title: 'Albania vs Belarus - Nations League', when: '', section: '106', row: '', tickets: 2, price: 60, currency: 'USD', firstSeen: Date.now() - 60 * 60000, lastSeen: Date.now() - 60 * 60000, seenCount: 1, seenBy: 'PC 1', code: 'E106' },
              { id: '1', vgKey: 'albaniavsbelarusnationsleague', vgEventId: '', eventKey: null, title: 'Albania vs Belarus - Nations League', when: 'Sat, 26 Sep', section: 'N102', row: '', tickets: 1, price: 45, currency: 'USD', firstSeen: Date.now() - 3 * 3600e3, lastSeen: Date.now() - 3 * 3600e3, seenCount: 1, seenBy: 'PC 2', code: '' },
              { id: '0', vgKey: 'albaniavsfinlandnationsleague', vgEventId: '', eventKey: null, title: 'Albania vs Finland - Nations League', when: '', section: 'S1', row: '', tickets: 1, price: 10, currency: 'USD', firstSeen: Date.now(), lastSeen: Date.now(), seenCount: 1, seenBy: 'PC 2', code: '' }
            ],
            fx: { day: '2026-09-17', rates: { USD: 83.36, RSD: 0.85 }, fetched: {}, manual: [] }
          } });
        }, 15);
      }
    },
    storage: { local: area, session: area, onChanged: { addListener() {} } }
  };
})();`;

const FILES = ['core/util.js', 'core/rules.js', 'core/registry.js', 'core/settings.js', 'core/profit.js', 'core/help.js',
  'sites/ebileta.js', 'sites/efinity.js', 'sites/posttick.js', 'core/viagogo.js', 'core/market.js', 'core/team.js', 'core/face.js', 'core/lastsales.js', 'ui/components.js',
  'ui/lastsalewatch.js', 'content/sites/viagogo-event.js'];
/* like a content script at document_idle: after the page's own scripts, on every load */
const INJECT = STUB + '\nwindow.addEventListener("load", function () {\n' + FILES.map(f => fs.readFileSync(path.join(EXT, f), 'utf8')).join('\n;\n') + '\n});';

let failures = 0;
function expect(cond, label, extra) {
  console.log(cond ? '  ✓' : '  ✗', label, cond || extra === undefined ? '' : JSON.stringify(extra).slice(0, 700));
  if (!cond) failures++;
}
async function until(fn, ms) {
  const end = Date.now() + (ms || 8000);
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* the page is loading */ }
    await sleep(150);
  }
  return null;
}

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'st-event-'));
  const proc = spawn(findChrome(), ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', '--lang=en-US'], { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.resume();          // nobody reads Chrome's log: a full pipe would stop it dead
  /* the port Chrome really took, from the profile it writes it into */
  const portFile = path.join(profile, 'DevToolsActivePort');
  let port = 0;
  for (let i = 0; i < 80 && !port; i++) {
    try { port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]) || 0; } catch (e) { await sleep(250); }
  }
  let version = null;
  for (let i = 0; i < 40 && port && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch (e) { await sleep(250); }
  }
  if (!version) throw new Error('Chrome did not start');
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map(), handlers = [];
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
    } else if (msg.method) handlers.forEach(h => h(msg));
  };
  const cmd = (method, params, sessionId) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId }));
  });
  return { cmd, on: h => handlers.push(h), close() { try { ws.close(); } catch (e) { /* gone */ } proc.kill(); } };
}

async function openTab(b) {
  const { targetId } = await b.cmd('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await b.cmd('Target.attachToTarget', { targetId, flatten: true });
  const tab = { errors: [], loads: 0 };
  b.on(msg => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      tab.errors.push((d.exception && d.exception.description) || d.text);
    } else if (msg.method === 'Page.loadEventFired') {
      tab.loads++;
    } else if (msg.method === 'Fetch.requestPaused') {
      const { requestId, request } = msg.params;
      const u = new URL(request.url);
      let body = null, type = 'text/plain';
      if (u.host === 'www.viagogo.com') { body = PAGE; type = 'text/html; charset=utf-8'; }
      else {
        const f = path.join(EXT, decodeURIComponent(u.pathname));
        if (f.startsWith(EXT) && fs.existsSync(f) && fs.statSync(f).isFile()) { body = fs.readFileSync(f); type = f.endsWith('.css') ? 'text/css' : f.endsWith('.png') ? 'image/png' : 'text/plain'; }
      }
      const done = body === null
        ? b.cmd('Fetch.fulfillRequest', { requestId, responseCode: 404, body: '' }, sessionId)
        : b.cmd('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: type }], body: Buffer.from(body).toString('base64') }, sessionId);
      done.catch(() => {});
    }
  });
  await b.cmd('Page.enable', {}, sessionId);
  await b.cmd('Runtime.enable', {}, sessionId);
  await b.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: INJECT }, sessionId);
  await b.cmd('Fetch.enable', { patterns: [{ urlPattern: 'https://www.viagogo.com/*' }, { urlPattern: 'https://ext.local/*' }] }, sessionId);
  tab.eval = async expression => {
    const r = await b.cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  tab.go = async target => {
    await b.cmd('Page.navigate', { url: target }, sessionId);
    await until(() => tab.eval(`document.readyState === 'complete' && !!document.getElementById('sk-vg-drawer')`), 10000);
  };
  tab.reload = async () => {
    await b.cmd('Page.reload', {}, sessionId);
    await sleep(500);
    await until(() => tab.eval(`document.readyState === 'complete' && !!document.getElementById('sk-vg-drawer')`), 10000);
  };
  tab.shot = async name => {
    const r = await b.cmd('Page.captureScreenshot', { format: 'png' }, sessionId);
    const f = path.join(SHOTS, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return f;
  };
  return tab;
}

/* reading the drawer */
const D = `(() => { const h = document.getElementById('sk-vg-drawer'); return h && h.shadowRoot; })()`;
const sub = t => t.eval(`(${D} || { querySelector: () => null }).querySelector('.dr-sub')?.textContent || ''`);
const noticeText = t => t.eval(`(${D} || { querySelector: () => null }).querySelector('.dr-notice')?.textContent || ''`);
const clickButton = (t, re) => t.eval(`(() => { const b = [...${D}.querySelectorAll('button')].find(x => ${re}.test(x.textContent)); if (!b || b.disabled) return false; b.click(); return true; })()`);
const buttonState = (t, re) => t.eval(`(() => { const b = [...${D}.querySelectorAll('button')].find(x => ${re}.test(x.textContent)); return b ? { text: b.textContent, disabled: b.disabled } : null; })()`);
/* the drawer opens collapsed: every load has to open it before its body exists */
const openDrawer = async t => {
  await until(() => t.eval(`!!${D}`), 8000);
  await t.eval(`(() => { const b = [...${D}.querySelectorAll('button')].find(x => x.textContent === '\u25b4'); if (b) b.click(); return true; })()`);
  return until(() => t.eval(`!!${D}.querySelector('.dr-body')`), 5000);
};
const stored = t => t.eval(`JSON.parse(sessionStorage.getItem('seat-tracker:vg-event:161613516') || 'null')`);
const tableRows = t => t.eval(`[...${D}.querySelectorAll('.dr-table tr.sec')].map(tr => [...tr.children].map(td => td.textContent.trim()))`);

(async () => {
  const t0 = Date.now();
  const b = await launch();
  try {
    const t = await openTab(b);

    console.log('\n== one scan of the whole list');
    await t.go(url(1));
    const shut = await t.eval(`!${D}.querySelector('.dr-body') && !!${D}.querySelector('.dr-bar')`);
    expect(shut === true, 'the drawer is closed on a fresh page, even though an earlier visit left it open', shut);
    const closedButtons = await t.eval(`[...${D}.querySelectorAll('.dr-bar button')].map(b => b.textContent)`);
    expect(JSON.stringify(closedButtons) === JSON.stringify(['Scan', 'Sell', '\u25b4']), 'closed, the header has only Scan, Sell and the arrow', closedButtons);
    const opened = await t.eval(`(() => { const o = []; const real = window.open; window.open = (u, w) => { o.push([u, w]); return null; }; [...${D}.querySelectorAll('.dr-bar button')].find(b => b.textContent === 'Sell').click(); window.open = real; return o; })()`);
    expect(opened.length === 1 && opened[0][0] === 'https://www.viagogo.com/ww/Secure/Pipeline/Sell/Initialise?EventID=161613516' && opened[0][1] === '_blank',
      'Sell opens viagogo\'s sell page for this event in a new tab', opened);
    const remembered = await t.eval(`${D}.querySelector('#sk-vg-sort') ? 'open' : 'closed'`);
    expect(remembered === 'closed', 'nothing of the body is drawn while it is closed');
    expect(await openDrawer(t), 'the drawer starts collapsed and opens when its arrow is pressed');
    const saved = await t.eval(`(async () => JSON.stringify((await chrome.storage.local.get('ui')).ui.vgDrawer))()`);
    expect(!/\"open\"/.test(saved), 'and being open is never written down, so the next page starts closed again', saved);
    const kept = await t.eval(`(() => { const b = [...${D}.querySelectorAll('button')].find(x => x.textContent === '\u25be'); if (b) b.click(); return !${D}.querySelector('.dr-body'); })()`);
    expect(kept === true, 'and closes again');
    await openDrawer(t);
    expect(/Nothing scanned yet/.test(await sub(t)), 'the drawer opens on the event page, empty');
    expect(!(await buttonState(t, /^Scan (section|whole event|[A-Z]\d)/)), 'no section or whole-event buttons any more');

    await t.eval(`__pickSection('1844533'); true`);
    expect(await until(async () => { const s = await buttonState(t, /^Scan$/); return s && s.disabled; }, 4000), 'Scan is off while a section is picked on the map');
    await t.eval(`__pickSection(''); true`);
    expect(await until(async () => { const s = await buttonState(t, /^Scan$/); return s && !s.disabled; }, 4000), 'and on again once no section is picked');

    const loadsBefore = t.loads;
    const started = Date.now();
    await clickButton(t, /^Scan$/);
    expect(await until(async () => /Scanning · "Show more" pressed/.test(await sub(t)), 5000), 'progress shows how many times "Show more" was pressed');
    expect(!!(await until(async () => /Scanned: 22 listings in 5 sections/.test(await noticeText(t)), 60000)), 'Scan loads the whole list: 22 listings in 5 sections', await noticeText(t));
    console.log(`   scan took ${Math.round((Date.now() - started) / 100) / 10} s`);
    expect(t.loads === loadsBefore, 'no page reloads during the scan', t.loads - loadsBefore);
    expect(!(await t.eval(`[...document.querySelectorAll('#listings-container button')].some(b => /show more/i.test(b.textContent))`)), '"Show more" is gone at the end');
    expect((await t.eval('location.search')).includes('sections=&'), 'the address is untouched');

    let st = await stored(t);
    expect(!!st && Object.keys(st.sections).length === 5 && st.scan.complete, 'all 5 sections are kept, marked complete', st && Object.keys(st.sections));
    expect(!!st && st.sections['1844533'].rows.map(r => r.id).join(',') === '900040,900041', 'S202 has only its own 2 listings', st && st.sections['1844533']);
    expect(!!st && st.sections['1844501'].rows.length === 12 && st.sections['1844530'].rows.length === 2, 'E106 has 12 (11 others + yours), E210 has 2', st && Object.fromEntries(Object.values(st.sections).map(s => [s.label, s.rows.length])));
    expect(!!st && Object.keys(st.own).sort().join(',') === '13981313702,13988951528,14048806484', 'your 3 listings are recognised from "Your listing"', st && Object.keys(st.own));

    const rows = await tableRows(t);
    const row = label => rows.find(r => r[0].startsWith(label)) || [];
    const e101 = row('E101');
    expect(e101[1] === '1/3' && e101[2] === '$16.00' && e101[3] === '18 (6)' && e101[4] === '3rd of 3' && e101[5] === '+$2.00' && e101[6] === '58' && /L/.test(e101[7]) && e101[8] === 'You$50.00',
      'E101: 1 of 3 listings, cheapest shown $16, 18 tickets (6 yours), 3rd of 3, +$2.00, 58 free on eBileta, profit, and the $50 you really set', e101);
    const n102 = row('N102');
    expect(n102[4] === '1st of 3' && n102[5] === '−$3.00' && n102[8] === '—',
      'N102: yours $20 is the cheapest of 3 and $3 under the next seller, no real price read for it', n102);
    const green = await t.eval(`(() => { const tr = [...${D}.querySelectorAll('.dr-table tr.sec')].find(x => x.textContent.startsWith('N102')); return tr && tr.querySelector('td.gap') ? tr.querySelector('td.gap').className : null; })()`);
    expect(green === 'n gap g-ok', 'being under the next seller is shown in green', green);
    const s202 = row('S202');
    expect(s202[1] === '2' && s202[3] === '12' && s202[4] === '—' && s202[5] === '—' && /only us/.test(s202[0]) && s202[8] === 'Ana Krasniqi$88.00Ana Krasniqi$92.00',
      'S202: both listings are Ana\'s, so it is "only us", with the prices she really set', s202);
    const gapClass = await t.eval(`(() => { const tr = [...${D}.querySelectorAll('.dr-table tr.sec')].find(x => x.textContent.startsWith('E101')); return tr && tr.querySelector('td.gap') ? tr.querySelector('td.gap').className : null; })()`);
    expect(gapClass === 'n gap g-bad', 'the gap is coloured red: $2 above a $16 cheapest is 12% above it', gapClass);
    const teamOnly = await t.eval(`${D}.querySelectorAll('.dr-table tr.k-teamonly').length`);
    expect(teamOnly === 1, 'one section is marked as the team\'s alone', teamOnly);
    expect(await t.eval(`${D}.querySelector('#sk-vg-sort').value`) === 'gap', 'the sorting from the earlier visit is kept, only the open state is not');
    const tiles = await t.eval(`${D}.querySelector('.dr-tiles').innerText`);
    expect(/^5\s/.test(tiles) && /1 \/ 3/.test(tiles), 'totals: 5 sections with listings, cheapest in 1 of the 3 sections you list in', tiles);
    const labels = await t.eval(`[...${D}.querySelectorAll('.dr-stats .dr-chart text.lab')].map(x => x.textContent)`);
    expect(labels.length === 5, 'the overview graph has a row for each of the 5 sections', labels);

    /* the search box over the table: sections by name, and by listing ID */
    const search = v => t.eval(`(() => { const i = ${D}.querySelector('.dr-search'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input')); return true; })()`);
    await search('E1');
    let found = await tableRows(t);
    expect(found.length === 2 && found.every(r => r[0].startsWith('E1')), 'typing "E1" leaves only E101 and E106', found.map(r => r[0]));
    const graphed = await t.eval(`[...${D}.querySelectorAll('.dr-stats .dr-chart text.lab')].map(x => x.textContent)`);
    expect(graphed.length === 2, 'and the overview graph follows the search', graphed);
    await search('14048806484');
    found = await tableRows(t);
    expect(found.length === 1 && found[0][0].startsWith('N102'), 'a listing ID finds the section it is in', found.map(r => r[0]));
    await search('zzz');
    const none = await t.eval(`(() => { const p = ${D}.querySelector('.dr-empty'); return p && p.textContent; })()`);
    expect(/No scanned section matches "zzz"/.test(none || ''), 'and nothing matching says so', none);
    await search('');
    expect((await tableRows(t)).length === 5, 'clearing it brings all 5 sections back');

    /* only instant download: E106's four, and N102's listing of yours whose request is Bought */
    const instant = on => t.eval(`(() => { const l = [...${D}.querySelectorAll('.dr-controls label')].find(x => /Only instant download/.test(x.textContent)); const i = l.querySelector('input'); if (i.checked !== ${on}) i.click(); return true; })()`);
    await instant(true);
    const count = await until(() => t.eval(`(() => { const c = ${D}.querySelector('.dr-instant'); return c && c.textContent; })()`), 3000);
    const instantRows = await tableRows(t);
    const instantTiles = await t.eval(`${D}.querySelector('.dr-tiles').innerText`);
    const instantNames = instantRows.map(r => (/^[A-Z]\d+/.exec(r[0]) || [''])[0]).sort().join(',');
    expect(instantNames === 'E106,N102' && /^5 listings · 30 tickets instant download or bought, of \d+ · \d+$/.test(count || '')
      && /^2\s/.test(instantTiles), '"Only instant download" leaves E106\'s four and your Bought one in N102: 5 listings · 30 tickets', { rows: instantNames, count });
    console.log('   screenshot:', await t.shot('viagogo-event-instant.png'));
    await instant(false);
    await until(() => t.eval(`!${D}.querySelector('.dr-instant')`), 3000);
    expect((await tableRows(t)).length === 5, 'and switching it off brings every section back, without the count');

    /* by price: every listing of every section in one list, cheapest first, by tickets wanted */
    const layout = name => t.eval(`(() => { [...${D}.querySelectorAll('.dr-layout button')].find(b => b.textContent === '${name}').click(); return true; })()`);
    const priceRows = () => t.eval(`[...${D}.querySelectorAll('.dr-prices tbody tr')].map(tr => [...tr.children].map(td => td.textContent))`);
    await layout('By price');
    const pr = await until(async () => { const r = await priceRows(); return r.length ? r : null; }, 3000);
    const prices = (pr || []).map(r => Number(r[1].replace(/[^0-9.]/g, '')));
    expect(pr && pr.length === 22 && prices.every((p, i) => !i || p >= prices[i - 1]) && pr[0][1] === '$16.00'
      && !(await t.eval(`!!${D}.querySelector('#sk-vg-sort')`)),
      'By price: all 22 listings of the 5 sections in one list, cheapest first, no section sort', pr && pr.slice(0, 3));
    expect(pr && pr.some(r => r[2] === 'E101' && /yours/.test(r[5])), 'your listings are marked in it');
    const qty = n => t.eval(`(() => { [...${D}.querySelectorAll('.dr-qty button')].find(b => b.textContent === '${n}').click(); return true; })()`);
    await qty('2');
    const two = await until(() => t.eval(`(() => { const c = ${D}.querySelector('.dr-qty-count'); return c && c.textContent; })()`), 3000);
    expect(/^22 listings sell 2 tickets · from \$16\.00$/.test(two || ''), '2 tickets: every "1 - 6 together" listing sells 2', two);
    console.log('   screenshot:', await t.shot('viagogo-event-byprice.png'));
    await qty('7');
    const seven = await until(() => t.eval(`(() => { const p = ${D}.querySelector('.dr-empty'); return p && p.textContent; })()`), 3000);
    expect(/No listing sells 7 tickets/.test(seven || ''), '7 tickets: none of them goes above 6', seven);
    const order = await t.eval(`[...${D}.querySelectorAll('.dr-qty:not(.dr-stands):not(.dr-groups):not(.dr-diff-kinds) button')].map(b => b.textContent)`);
    expect(JSON.stringify(order) === '["Any","Single","1","2","3","4","5","6","7","8","9","10","10+"]', 'the chips: Any, Single, 1 to 10, then 10+', order);
    await qty('Single');
    const single = await until(() => t.eval(`(() => { const p = ${D}.querySelector('.dr-empty'); return p && /single/.test(p.textContent) ? p.textContent : null; })()`), 3000);
    expect(/No listing is a single ticket/.test(single || ''), 'Single: a "1 - 6 together" listing is not a single ticket', single);
    await qty('10+');
    const over = await until(() => t.eval(`(() => { const p = ${D}.querySelector('.dr-empty'); return p && /more than 10/.test(p.textContent) ? p.textContent : null; })()`), 3000);
    expect(/No listing sells more than 10 tickets/.test(over || ''), '10+: none of them sells more than 6', over);
    await qty('Any');

    /* the tracked event's sector prices, as chips under the ticket chips */
    const chips = await until(() => t.eval(`(() => { const g = ${D}.querySelector('.dr-groups'); return g && [...g.children].map(x => x.textContent); })()`), 3000);
    expect(JSON.stringify(chips) === '["Sector price · L","All","545","1,045","No price"]',
      'sector prices from the tracked event: All, then cheapest first, then the sections with none', chips);
    const chip = n => t.eval(`(() => { [...${D}.querySelectorAll('.dr-groups button')].find(b => b.textContent === '${n}').click(); return true; })()`);
    await chip('1,045');
    const at = await until(async () => { const r = await priceRows(); return r.length && r.length < 22 ? r : null; }, 3000);
    expect(!!at && at.every(r => ['E101', 'E106'].includes(r[2])) && at.some(r => r[2] === 'E101') && at.some(r => r[2] === 'E106'),
      '1,045: only the listings of E101 and E106, the two sectors at that price', at && at.map(r => r[2]));
    console.log('   screenshot:', await t.shot('viagogo-event-sectorprice.png'));
    await chip('All');
    expect(await until(async () => (await priceRows()).length === 22, 3000), 'All brings every listing back');
    await layout('By section');
    expect((await tableRows(t)).length === 5, 'and By section brings the section table back');

    await t.eval(`(() => { [...${D}.querySelectorAll('.dr-table tr.sec')].find(tr => tr.textContent.startsWith('E106')).click(); return true; })()`);
    const detail = await until(() => t.eval(`(() => { const d = ${D}.querySelector('.dr-detail'); return d && d.innerText; })()`), 3000);
    const dots = await t.eval(`${D}.querySelectorAll('.dr-detail .dr-chart circle').length`);
    expect(!!detail && detail.includes('Your listing 13988951528') && dots === 12, 'clicking E106 shows its graph (12 dots) and every listing, yours marked', { dots });
    console.log('   screenshot:', await t.shot('viagogo-event-drawer.png'));

    await t.eval(`(() => { const rows = [...${D}.querySelectorAll('.dr-table tr.sec')]; rows.find(tr => tr.textContent.startsWith('E106')).click(); return true; })()`);
    await until(() => t.eval(`!${D}.querySelector('.dr-detail')`), 3000);
    await t.eval(`(() => { [...${D}.querySelectorAll('.dr-table tr.sec')].find(tr => tr.textContent.startsWith('S202')).click(); return true; })()`);
    const mate = await until(() => t.eval(`(() => { const d = ${D}.querySelector('.dr-detail'); return d && d.innerText; })()`), 3000);
    expect(!!mate && /Ana Krasniqi's listing · \$88\.00 set/.test(mate) && /Ana Krasniqi's listing · \$92\.00 set/.test(mate),
      'both S202 rows are named as Ana\'s, matched by the tickets left', mate && mate.slice(0, 200));
    const told = await buttonState(t, /tell the team/i);
    expect(!!told && !told.disabled && /only us here/i.test(told.text), 'and it offers to tell the team, since only the team is here', told);
    await clickButton(t, /tell the team/i);
    const composer = await until(() => t.eval(`(() => { const box = ${D}.querySelector('.msg-box textarea'); return box && box.value; })()`), 3000);
    expect(!!composer && /S202: only our listings/.test(composer) && /Ana Krasniqi \$88\.00/.test(composer),
      'the message is written for you, with the section and what the team set', composer);
    const sent = await t.eval(`(() => { const b = [...${D}.querySelectorAll('.msg-box button')].find(x => /send/i.test(x.textContent)); if (!b) return 'no button'; b.click(); return 'clicked'; })()`);
    const msg = await until(() => t.eval(`(window.__sent || [])[0] || null`), 4000);
    expect(!!msg && msg.type === 'notifyTeam' && /S202/.test(msg.text) && msg.eventKey === 'ebileta:2153' && msg.to.join() === 'u2',
      'pressing send asks the service worker to tell Ana, and nothing is sent before that', { sent, msg });

    /* E101 opened: beside the graph, your price — the gap taken off your real price, and the calculator */
    await t.eval(`(() => { [...${D}.querySelectorAll('.dr-table tr.sec')].find(tr => tr.textContent.startsWith('S202')).click(); return true; })()`);
    await until(() => t.eval(`!${D}.querySelector('.dr-detail')`), 3000);
    await t.eval(`(() => { [...${D}.querySelectorAll('.dr-table tr.sec')].find(tr => tr.textContent.startsWith('E101')).click(); return true; })()`);
    const side = await until(() => t.eval(`(() => { const m = ${D}.querySelector('.dr-detail .dr-detail-grid > .dr-money'); return m ? { text: m.innerText.replace(/\\s+/g, ' '), calc: m.querySelector('.calc input') && m.querySelector('.calc input').value } : null; })()`), 3000);
    expect(!!side && /Your real price \$50\.00 − \$2\.00 = \$48\.00/.test(side.text) && side.calc === '50',
      'E101 shows its money beside the graph: $2 above the cheapest other, so $50 − $2 = $48, and the calculator starts at the $50 you set', side);
    await t.eval(`(() => { [...${D}.querySelectorAll('.dr-money button')].find(b => /^Try /.test(b.textContent)).click(); return true; })()`);
    const tried = await t.eval(`(() => { const m = ${D}.querySelector('.dr-money'); return { v: m.querySelector('.calc input').value, out: m.querySelector('.calc-out').innerText }; })()`);
    expect(tried.v === '48' && /L/.test(tried.out), '"Try $48.00" puts it in the calculator, which works out what $48 would earn', tried);
    const side2 = await t.eval(`(() => { const g = ${D}.querySelector('.dr-detail-grid'); const a = g.children[0].getBoundingClientRect(), b = g.children[1].getBoundingClientRect(); return { beside: b.left >= a.right - 1 && Math.abs(b.top - a.top) < 4 }; })()`);
    expect(side2.beside, 'side by side with the graph and the listings', side2);
    console.log('   screenshot:', await t.shot('viagogo-event-money.png'));

    console.log('\n== stands (eBileta at Air Albania)');
    const standChip = n => t.eval(`(() => { const b = [...${D}.querySelectorAll('.dr-stands button')].find(x => x.textContent === '${n}'); if (!b) return false; b.click(); return true; })()`);
    const standLabels = await until(() => t.eval(`(() => { const g = ${D}.querySelector('.dr-stands'); return g && [...g.children].map(x => x.textContent); })()`), 3000);
    expect(JSON.stringify(standLabels) === '["Stand","All","N","E","S","V","W","Corners"]', 'a tracked eBileta event gets stand chips: N, E, S, V, W and the corners', standLabels);
    await standChip('Corners');
    let standRows = await until(async () => { const r = await tableRows(t); return r.length === 3 ? r : null; }, 3000);
    expect(!!standRows && standRows.map(r => r[0].slice(0, 4)).sort().join() === 'E101,E210,S202', 'Corners: E101, E210 and S202 — the corners among the 5', standRows && standRows.map(r => r[0]));
    await standChip('N');
    standRows = await until(async () => { const r = await tableRows(t); return r.length === 4 ? r : null; }, 3000);
    expect(!!standRows && standRows.some(r => r[0].startsWith('N102')), 'N on as well adds N102: several stands at once', standRows && standRows.map(r => r[0]));
    await layout('By price');
    const standPrices = await until(async () => { const r = await priceRows(); return r.length ? r : null; }, 3000);
    expect(!!standPrices && standPrices.every(r => ['E101', 'E210', 'S202', 'N102'].includes(r[2])), 'and By price follows the same stands', standPrices && [...new Set(standPrices.map(r => r[2]))]);
    await standChip('All');
    expect(await until(async () => (await priceRows()).length === 22, 3000), 'All brings every stand back');

    console.log('\n== prices for the sections with none');
    await chip('No price');
    const panel = await until(() => t.eval(`(() => { const p = ${D}.querySelector('.dr-noprice'); return p && [...p.querySelectorAll('li')].map(li => li.innerText.replace(/\\s+/g, ' ')); })()`), 3000);
    expect(!!panel && panel.length === 2 && /^E210 not on the event — eBileta removed it/.test(panel[0]) && /^S202 not on the event/.test(panel[1]),
      '"No price" lists E210 and S202, which the tracked event has no sector for', panel);
    expect(/price list, shared with the team/.test(await t.eval(`${D}.querySelector('.dr-noprice-head').innerText`)), 'and says where a price goes');
    await t.eval(`(() => { const li = [...${D}.querySelectorAll('.dr-noprice li')].find(x => x.textContent.startsWith('S202')); const i = li.querySelector('input'); i.value = '4500'; i.dispatchEvent(new Event('input')); li.querySelector('button').click(); return true; })()`);
    const keptNote = await until(async () => /S202 is back on \[1\] as a removed sector/.test(await noticeText(t)) ? await noticeText(t) : null, 4000);
    const asked = await t.eval(`(window.__prices || [])[0] || null`);
    expect(!!asked && asked.type === 'keepViagogoSector' && asked.eventKey === 'ebileta:2153' && asked.label === 'S202' && asked.amount === 4500 && asked.currency === 'ALL',
      '"Save section" asks the service worker to put S202 back on the event, at 4,500 L', asked);
    expect(!!keptNote && /4,500/.test(keptNote), 'and says so', keptNote);
    const chipsAfter = await until(() => t.eval(`(() => { const g = ${D}.querySelector('.dr-groups'); const c = g && [...g.children].map(x => x.textContent); return c && c.includes('4,500') ? c : null; })()`), 4000);
    expect(!!chipsAfter, 'S202 now has its sector price: a 4,500 chip', chipsAfter);
    await chip('All');
    await layout('By section');

    console.log('\n== saved scans and what changed');
    const savedKey = 'cache:vgscans:161613516';
    const savedNow = () => t.eval(`(async () => ((await chrome.storage.local.get('${savedKey}'))['${savedKey}'] || []).map(x => ({ at: x.at, rows: x.rows.length, signedIn: x.signedIn })))()`);
    const changesTab = () => t.eval(`(() => { const b = [...${D}.querySelectorAll('.dr-tabs button')].find(x => /^Changes/.test(x.textContent)); b.click(); return b.textContent; })()`);
    expect(!!(await buttonState(t, /^Save scan$/)) && !(await buttonState(t, /^Save scan$/)).disabled, 'a finished scan can be saved');
    await clickButton(t, /^Save scan$/);
    const savedNote = await until(async () => /Saved, here and in the app/.test(await noticeText(t)) ? await noticeText(t) : null, 4000);
    let list = await savedNow();
    expect(!!savedNote && list.length === 1 && list[0].rows === 22 && list[0].signedIn === true, 'Save keeps the 22 listings on this PC, marked signed in', { savedNote, list });
    const up = await t.eval(`JSON.stringify(window.__vgSaved || [])`);
    expect(/"eventKey":"ebileta:/.test(up) && JSON.parse(up).length === 1, 'and sends it to Supabase for the app, with the tracked event', up);
    expect((await buttonState(t, /^Saved ✓$/) || {}).disabled === true, 'the button then says Saved and cannot save it twice');
    expect(await changesTab() === 'Changes · 1', 'the Changes tab counts the saved scans');
    const oneNote = await until(() => t.eval(`(() => { const v = ${D}.querySelector('.dr-diff-view'); return v && v.innerText; })()`), 3000);
    expect(/One scan saved/.test(oneNote || ''), 'with one saved scan it asks for another', oneNote);

    await t.eval(`__marketMoves()`);
    await clickButton(t, /^Scan again$/);
    expect(!!(await until(async () => /Scanned: 22 listings/.test(await noticeText(t)), 60000)), 'the market moved and was scanned again');
    const diffTiles = await until(() => t.eval(`(() => { const x = ${D}.querySelector('.dr-diff-tiles'); return x && x.innerText.replace(/\\s+/g, ' '); })()`), 4000);
    expect(!!diffTiles && /22 → 22 listings/.test(diffTiles) && /1 new · 6 tickets/.test(diffTiles) && /1 removed · 6 tickets/.test(diffTiles) && /↓1 ↑0 prices moved/.test(diffTiles),
      'the unsaved scan against the saved one: 1 new, 1 removed, 1 cheaper', diffTiles);
    const pick = await t.eval(`[...${D}.querySelectorAll('.dr-diff-pick select')].map(s => s.options[s.selectedIndex].text)`);
    expect(pick.length === 2 && /^This scan, not saved/.test(pick[1]), 'From the saved scan to this scan, not saved yet', pick);
    const diffRows = () => t.eval(`[...${D}.querySelectorAll('.dr-diff tr.sec')].map(tr => [...tr.children].map(td => td.textContent.trim()))`);
    const dr = await diffRows();
    const dRow = l => dr.find(r => r[0].startsWith(l)) || [];
    expect(dr.length === 3 && /\$16\.00 → \$14\.00/.test(dRow('E101')[3]) && dRow('E101')[6] === '↓1' && dRow('N102')[4] === '1' && /3 → 4/.test(dRow('N102')[1]) && dRow('S202')[5] === '1',
      'only the 3 sections that changed: E101 cheaper ($16 → $14), N102 one new (3 → 4), S202 one removed', dr);
    await t.eval(`(() => { [...${D}.querySelectorAll('.dr-diff tr.sec')].find(tr => tr.textContent.startsWith('E101')).click(); return true; })()`);
    const items = await until(() => t.eval(`(() => { const u = ${D}.querySelector('.dr-changes'); return u && [...u.children].map(li => li.innerText.replace(/\\s+/g, ' ')); })()`), 3000);
    expect(!!items && items.length === 1 && /^Cheaper \$16\.00 → \$14\.00 −\$2\.00/i.test(items[0]), 'opening E101 lists the change: $16 → $14, −$2', items);
    await t.eval(`(() => { [...${D}.querySelectorAll('.dr-diff-kinds button')].find(b => /^New/.test(b.textContent)).click(); return true; })()`);
    const onlyNew = await until(async () => { const r = await diffRows(); return r.length === 1 ? r : null; }, 3000);
    expect(!!onlyNew && onlyNew[0][0].startsWith('N102'), '"New" keeps only N102', onlyNew);
    await t.eval(`(() => { [...${D}.querySelectorAll('.dr-diff-kinds button')].find(b => /^All changes/.test(b.textContent)).click(); return true; })()`);
    console.log('   screenshot:', await t.shot('viagogo-event-changes.png'));
    await clickButton(t, /^Save scan$/);
    await until(async () => /Changes shows what moved/.test(await noticeText(t)), 4000);
    list = await savedNow();
    expect(list.length === 2 && list[0].at < list[1].at, 'saving the second scan keeps both, oldest first', list);
    expect(/^Changes · 2$/.test(await t.eval(`[...${D}.querySelectorAll('.dr-tabs button')].find(x => /^Changes/.test(x.textContent)).textContent`)), 'and the tab says 2');

    await t.reload();
    await openDrawer(t);
    expect(/Nothing scanned yet/.test(await sub(t)), 'a refresh clears the scan on screen…');
    expect(await changesTab() === 'Changes · 2', 'the tab still counts 2');
    const afterReload = await until(() => t.eval(`(() => { const x = ${D}.querySelector('.dr-diff-tiles'); return x && x.innerText.replace(/\\s+/g, ' '); })()`), 5000);
    expect(!!afterReload && /1 new/.test(afterReload) && /1 removed/.test(afterReload), '…but not the saved scans: Changes still compares the two', afterReload);
    /* a third save: only the newest two are kept, here and in Supabase */
    const firstAt = (await savedNow())[0].at;
    await t.eval(`__marketMoves()`);
    await clickButton(t, /^Scan$/);
    await until(async () => /Scanned: 22 listings/.test(await noticeText(t)), 60000);
    await clickButton(t, /^Save scan$/);
    const thirdNote = await until(async () => /The oldest was deleted/.test(await noticeText(t)) ? await noticeText(t) : null, 4000);
    list = await savedNow();
    const remoteAts = await t.eval(`JSON.parse(localStorage.getItem('__vgRemote') || '[]').map(x => x.at)`);
    expect(!!thirdNote && list.length === 2 && !list.some(x => x.at === firstAt) && remoteAts.length === 2 && !remoteAts.includes(firstAt),
      'a third save deletes the oldest: two kept on this PC and in the app', { thirdNote, list, remoteAts });

    /* another PC's save shows up here */
    await t.eval(`(() => { const all = JSON.parse(localStorage.getItem('__vgRemote')); const x = Object.assign({}, all[1], { at: all[1].at + 60000, id: String(all[1].at + 60000) }); localStorage.setItem('__vgRemote', JSON.stringify([all[1], x])); return true; })()`);
    await t.reload();
    await openDrawer(t);
    const merged = await until(async () => { const l = await savedNow(); return l.length === 2 && l[1].at === remoteAts[1] + 60000 ? l : null; }, 5000);
    expect(!!merged, 'a scan saved on another PC replaces the oldest here too', merged);

    /* deleted in the app (a Reset there, or a delete on another PC): it goes from this PC too, and is not sent back up */
    const both = await t.eval(`localStorage.getItem('__vgRemote')`);
    await t.eval(`(() => { const all = JSON.parse(localStorage.getItem('__vgRemote')); localStorage.setItem('__vgRemote', JSON.stringify([all[0]])); return true; })()`);
    await t.reload();
    await openDrawer(t);
    const dropped = await until(async () => { const l = await savedNow(); return l.length === 1 ? l : null; }, 5000);
    const remoteNow = await t.eval(`JSON.parse(localStorage.getItem('__vgRemote') || '[]').length`);
    expect(!!dropped && dropped[0].at === merged[0].at && remoteNow === 1, 'a scan deleted in the app is dropped here, not uploaded again', { dropped, remoteNow });
    await t.eval(`localStorage.setItem('__vgRemote', ${JSON.stringify(both)}); true`);
    await t.reload();
    await openDrawer(t);
    await until(async () => (await savedNow()).length === 2, 5000);

    await changesTab();
    await t.eval(`(() => { const b = [...${D}.querySelectorAll('.dr-saved-chip button')][0]; b.click(); return true; })()`);
    list = await until(async () => { const l = await savedNow(); return l.length === 1 ? l : null; }, 3000);
    const remoteLeft = await t.eval(`JSON.parse(localStorage.getItem('__vgRemote') || '[]').length`);
    expect(!!list && remoteLeft === 1, 'a saved scan can be deleted, in the app too', { list, remoteLeft });
    /* Reset: every saved scan of the event, here and in the app */
    await t.eval(`window.confirm = () => true; true`);
    await clickButton(t, /^Reset saved scans$/);
    const resetNote = await until(async () => /Saved scans deleted/.test(await noticeText(t)) ? await noticeText(t) : null, 4000);
    const afterReset = await savedNow();
    const remoteAfterReset = await t.eval(`JSON.parse(localStorage.getItem('__vgRemote') || '[]').length`);
    expect(!!resetNote && afterReset.length === 0 && remoteAfterReset === 0, 'Reset saved scans deletes them all, here and in the app', { resetNote, afterReset, remoteAfterReset });
    await t.eval(`(() => { [...${D}.querySelectorAll('.dr-tabs button')].find(x => x.textContent === 'Listings').click(); return true; })()`);
    await t.eval(`localStorage.removeItem('__lasting'); localStorage.removeItem('__vgRemote'); true`);

    console.log('\n== stop, and refresh');
    await t.reload();
    await openDrawer(t);
    expect(/Nothing scanned yet/.test(await sub(t)) && !(await stored(t)), 'refreshing the page clears everything');
    await clickButton(t, /^Scan$/);
    await until(async () => /pressed 1 time/.test(await sub(t)), 15000);
    await clickButton(t, /^Stop$/);
    const stopped = await until(async () => /Stopped — partly read: (\d+) listings/.exec(await noticeText(t)), 20000);
    st = await stored(t);
    expect(!!stopped && !!st && st.scan.complete === false && st.scan.listings < 22, 'Stop ends the scan and keeps what was loaded, marked partly read', { notice: await noticeText(t), listings: st && st.scan.listings });
    expect(/partly read/.test(await sub(t)), 'the header says partly read');
    console.log('\n== your listings, signed out');
    /* the signed-in scan above handed itself on; scan again so it is fresh */
    await t.go(url(1));
    await openDrawer(t);
    await clickButton(t, /^Scan$/);
    await until(async () => /Scanned: 22 listings/.test(await noticeText(t)), 60000);
    const handed = await until(() => t.eval(`(() => { const c = JSON.parse(localStorage.getItem('__compares') || '{}')['161613516']; return c ? { sections: c.sections.map(s => s.label).sort().join(','), mine: c.sections.flatMap(s => s.rows).filter(r => r.mine).length, others: c.sections.flatMap(s => s.rows).filter(r => !r.mine && r.id).length, ttl: c.expiresAt - c.at } : null; })()`), 4000);
    expect(!!handed && handed.sections === 'E101,E106,N102' && handed.mine === 3 && handed.others === 0 && handed.ttl === 30 * 60000,
      'a signed-in scan hands on your 3 sections by itself, other sellers without IDs, for 30 minutes', handed);
    expect(!!(await buttonState(t, /^Copy for compare$/)), 'and offers Copy for compare');

    await t.go(url(1) + '&signedout=1');
    await openDrawer(t);
    const waiting = await until(() => t.eval(`(() => { const c = ${D}.querySelector('.dr-compare'); return c && c.innerText; })()`), 5000);
    expect(!!waiting && /Your listings, signed out/.test(waiting) && /Press Scan to look for your 3 listings/.test(waiting) && /expires/.test(waiting),
      'signed out, the drawer already has the scan and asks for a Scan', waiting);
    expect(!(await buttonState(t, /^Copy for compare$/)) && !!(await buttonState(t, /^Paste another scan$/)), 'nothing to copy here; a scan can be pasted instead');
    await clickButton(t, /^Scan$/);
    await until(async () => /Scanned: 21 listings/.test(await noticeText(t)), 60000);
    const sum = await until(() => t.eval(`(() => { const p = ${D}.querySelector('.dr-compare-sum'); return p && p.innerText; })()`), 4000);
    expect(sum === '1 mine · 1 possibly mine · 1 hidden', 'E101 is mine (row B is unique), N102 only possibly (3 look the same), E106 hidden', sum);
    const mineLine = await t.eval(`(() => { const li = ${D}.querySelector('.dr-mine-list li.st-mine'); return li && li.innerText.replace(/\\s+/g, ' '); })()`);
    expect(/E101 · Row B/.test(mineLine) && /\$21\.00/.test(mineLine) && /#1 of 21 in the list/.test(mineLine) && /3rd cheapest of 3 here/.test(mineLine) && /\$2\.00 above the cheapest other/.test(mineLine),
      'for the one that is mine: its price signed out, place in the list, rank and gap', mineLine);
    const options = await t.eval(`${D}.querySelectorAll('.dr-mine-list li.st-possible .d').length`);
    expect(options === 3, 'N102 lists its 3 lookalikes, each with Mine / Not mine', options);

    /* you know which one is yours: say so, and everything after counts it */
    await t.eval(`(() => { const li = ${D}.querySelector('.dr-mine-list li.st-possible'); [...li.querySelectorAll('.d')][0].querySelector('button').click(); return true; })()`);
    const after = await until(() => t.eval(`(() => { const p = ${D}.querySelector('.dr-compare-sum'); return p && p.innerText === '2 mine · 1 hidden' ? p.innerText : null; })()`), 4000);
    expect(!!after, 'confirming one N102 row makes it mine, and the other two are someone else\'s', after);
    const n102out = (await tableRows(t)).find(r => r[0].startsWith('N102')) || [];
    expect(n102out[1] === '1/3' && /of 3/.test(n102out[4]), 'the table now ranks N102 with your listing in it', n102out);
    await t.eval(`(() => { const b = ${D}.querySelector('.dr-body'); if (b) b.scrollTop = 0; [...${D}.querySelectorAll('.dr-table tr.sec')].find(tr => tr.textContent.startsWith('N102')).click(); return true; })()`);
    await sleep(400);
    console.log('   screenshot:', await t.shot('viagogo-event-signedout.png'));
    const keptYes = await t.eval(`JSON.stringify(JSON.parse(sessionStorage.getItem('seat-tracker:vg-confirm:161613516') || '{}'))`);
    await t.reload();
    await openDrawer(t);
    const kept2 = await t.eval(`JSON.stringify(JSON.parse(sessionStorage.getItem('seat-tracker:vg-confirm:161613516') || '{}'))`);
    expect(/"yes"/.test(keptYes) && keptYes === kept2, 'what you confirmed survives a refresh of the tab', { keptYes, kept2 });

    /* a scan pasted by hand, and one that has run out */
    await t.eval(`localStorage.removeItem('__compares'); true`);
    await t.reload();
    await openDrawer(t);
    expect(!(await t.eval(`!!${D}.querySelector('.dr-compare')`)), 'with no scan handed over there is nothing to compare');
    await clickButton(t, /^Paste scan$/);
    const pasted = await t.eval(`(() => {
      const c = ${JSON.stringify({ v: 1, eventId: '161613516', name: 'Albania vs Belarus', start: '', at: 0, expiresAt: 0, complete: true, sections: [] })};
      c.at = Date.now(); c.expiresAt = c.at + 60000;
      c.sections = [{ key: '1844496', label: 'E101', rows: [{ id: '13981313702', i: 0, sprite: '1844496', section: 'E101', row: 'B', price: 18, currency: 'USD', qtyMin: 1, qtyMax: 6, features: ['Aisle seat', 'Event Organiser'], mine: true, sold: false }] }];
      const area = ${D}.querySelector('.dr-paste textarea');
      const dt = new DataTransfer(); dt.setData('text/plain', SK.market.packCompare(c));
      area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    const pastedNote = await until(async () => /Pasted: 1 listing of yours/.test(await noticeText(t)) ? await noticeText(t) : null, 4000);
    expect(pasted && !!pastedNote, 'a pasted scan is taken and handed on like an automatic one', pastedNote);
    const expired = await t.eval(`(() => { try { SK.market.unpackCompare(SK.market.packCompare({ v: 1, eventId: '1', sections: [], at: 0, expiresAt: Date.now() - 1 })); return 'taken'; } catch (e) { return e.message; } })()`);
    expect(/expired/.test(expired), 'an expired scan is refused with a reason', expired);

    console.log('\n== face values, in a tab of their own');
    const faceRows = () => t.eval(`[...${D}.querySelectorAll('.dr-face-table tr.sec')].map(tr => [...tr.children].map(td => td.textContent.trim()))`);
    const faceRow = async label => (await faceRows()).find(r => r[0].startsWith(label)) || [];
    const clickFaceRow = label => t.eval(`(() => { [...${D}.querySelectorAll('.dr-face-table tr.sec')].find(tr => tr.textContent.startsWith(${JSON.stringify(label)})).click(); return true; })()`);
    await t.go(url(1));
    await openDrawer(t);
    await clickButton(t, /^Scan$/);
    await until(async () => /Scanned: 22 listings/.test(await noticeText(t)), 60000);
    const listHeads = async () => t.eval(`[...${D}.querySelectorAll('.dr-results .dr-table th')].map(th => th.textContent).join('|')`);
    expect(await listHeads() === 'Section|Listings|Cheapest|Tickets|Rank|Gap|eBileta free|Profit|Real prices', 'the listings table is the listings table: nothing about face value in it', await listHeads());
    expect(!(await buttonState(t, /^Face values/)), 'and no face-value button in the bar either');
    await clickButton(t, /^Face value$/);
    await sleep(200);
    expect(await t.eval(`!!${D}.querySelector('.dr-face-view .dr-face-box textarea') && !${D}.querySelector('.dr-results')`), 'the Face value tab replaces the listings, and starts by asking which event to compare with');
    await t.eval(`(() => {
      const face = { site: 'efinity', siteId: '32286', title: 'Senidah', url: 'https://efinity.rs/event-map/senidah_32286', currency: 'RSD', at: Date.now(),
        sectors: [
          { code: 'E101', price: 3500, available: 12, longest: 4, total: 300, perTable: 0, unmapped: false },
          { code: 'TRIBUNA E106', price: 2000, available: 0, longest: 0, total: 300, perTable: 0, unmapped: false },
          { code: 'W105', price: 1500, available: 40, longest: 10, total: 300, perTable: 0, unmapped: false },
          { code: 'S202 LEFT K', price: 2500, available: 6, longest: 3, total: 200, perTable: 0, unmapped: false },
          { code: 'S202 RIGHT P', price: 3000, available: 0, longest: 0, total: 200, perTable: 0, unmapped: false },
          { code: 'PARTER', price: 1000, available: null, longest: 0, total: 0, perTable: 0, unmapped: true }
        ] };
      const area = ${D}.querySelector('.dr-face-box textarea');
      const dt = new DataTransfer(); dt.setData('text/plain', SK.face.pack(face));
      area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    const linked = await until(async () => /Linked 6 sectors of Senidah/.test(await noticeText(t)) ? await noticeText(t) : null, 4000);
    expect(!!linked, 'a pasted face-value code links the stadium to this event', linked || await noticeText(t));
    expect(!!(await buttonState(t, /^Face value ✓$/)), 'the tab says it is linked');
    const fheads = await t.eval(`[...${D}.querySelectorAll('.dr-face-table th')].map(th => th.textContent).join('|')`);
    expect(fheads === 'Section|Face value|Listings|Below face|Above face|Cheapest|Median', 'per section: face value, listings, how many are below and above it, the cheapest and the median against it', fheads);
    const fe101 = await faceRow('E101');
    expect(/^3,500 RSD\$35\.69/.test(fe101[1]) && fe101[2] === '3' && /^3−\$19\.69 · x0\.45$/.test(fe101[3]) && fe101[4] === '0' && /−\$19\.69 · x0\.45/.test(fe101[5]),
      'E101: face value in dinars and dollars, all 3 listings below it, the furthest $19.69 under (x0.45)', fe101);
    expect(/^2,000 RSD/.test((await faceRow('E106'))[1]), '"TRIBUNA E106" on the ticket site is matched to E106 by name');
    const totals = await t.eval(`${D}.querySelector('.dr-face-totals')?.textContent || ''`);
    expect(/listings against face value/.test(totals) && /below/.test(totals) && /above/.test(totals), 'a line above sums it up for the event', totals);
    const groups = await t.eval(`[...${D}.querySelectorAll('.dr-face-table tr.dr-tier-row b')].map(b => b.textContent).join('|')`);
    expect(groups === '3,500 RSD|2,500–3,000 RSD|2,000 RSD|No face value', 'sections are grouped by face price, dearest first, a split section under its range, unmatched last', groups);
    const foldOne = async (where, label) => t.eval(`(() => { const h = [...${D}.querySelectorAll('${where} .dr-tier')].find(x => x.querySelector('b').textContent === ${JSON.stringify(label)}); h.click(); return true; })()`);
    await foldOne('.dr-face-table', 'No face value');
    await sleep(200);
    const afterFold = (await faceRows()).map(r => r[0]);
    expect(!afterFold.some(x => /^(N102|E210)/.test(x)) && afterFold.some(x => x.startsWith('E101')), 'folding a price group hides just its sections', afterFold);
    await foldOne('.dr-face-table', 'No face value');
    await sleep(200);

    const seats = await t.eval(`(() => { const box = ${D}.querySelector('.dr-face-seats'); return box ? [...box.querySelectorAll('tbody tr.sec')].map(tr => [...tr.children].map(td => td.textContent.trim())) : null; })()`);
    expect(!!seats && seats.length === 4 && seats[3][0] === 'PARTER' && seats[3][3] === 'standing' && seats[0][0] === 'E101' && seats[0][3] === '12' && /E101 · \$16\.00/.test(seats[0][5]) && /x0\.45/.test(seats[0][6]) && seats[1][0] === 'S202 LEFT K' && /^S202/.test(seats[1][5]) && seats[2][0] === 'W105' && seats[2][5] === 'not listed',
      'below it, the ticket site\'s seats: every sector but the sold-out ones, dearest first, against the cheapest viagogo price', seats);
    await foldOne('.dr-face-seats', '2,500 RSD');
    await sleep(200);
    const seatsFolded = await t.eval(`[...${D}.querySelectorAll('.dr-face-seats tr.sec')].map(tr => tr.children[0].textContent)`);
    expect(seatsFolded.length === 3 && !seatsFolded.includes('S202 LEFT K'), 'a price group of the seats list folds on its own', seatsFolded);
    await foldOne('.dr-face-seats', '2,500 RSD');
    await t.eval(`(() => { ${D}.querySelector('.dr-face-seats > .dr-tier').click(); return true; })()`);
    await sleep(200);
    expect(await t.eval(`!${D}.querySelector('.dr-face-seats table') && /Seats on eFinity/.test(${D}.querySelector('.dr-face-seats').textContent)`), 'and the whole seats list folds to one line');
    const keptFold = await t.eval(`JSON.stringify(__kept().ui.vgDrawer.closed)`);
    expect(keptFold === '["seats"]', 'what is folded is remembered with the drawer', keptFold);
    await t.eval(`(() => { ${D}.querySelector('.dr-face-seats > .dr-tier').click(); return true; })()`);
    await sleep(200);

    const fs202 = await faceRow('S202');
    expect(/^2,500–3,000 RSD/.test(fs202[1]) && /split · 2 sectors · 6 free/.test(fs202[1]),
      'viagogo\'s S202 is guessed to be both "S202 LEFT K" and "S202 RIGHT P": a price range, split over 2 sectors', fs202);
    await clickFaceRow('S202');
    await sleep(300);
    const split = await t.eval(`[...${D}.querySelectorAll('.dr-face-split li')].map(li => li.textContent)`);
    expect(split.length === 2 && /^S202 RIGHT P3,000 RSD/.test(split[0]) && /sold out/.test(split[0]) && /^S202 LEFT K2,500 RSD/.test(split[1]) && /6 free/.test(split[1]) && /x\d/.test(split[1]),
      'opening it lists each sector with its price, its seats and the cheapest listing against it', split);
    console.log('   screenshot:', await t.shot('viagogo-event-split.png'));
    await clickFaceRow('S202');
    await sleep(200);
    await clickFaceRow('E101');
    await sleep(300);
    const faceSum = await t.eval(`${D}.querySelector('.dr-face-table .dr-face-sum')?.textContent || ''`);
    expect(/Face value 3,500 RSD · \$35\.69/.test(faceSum) && /cheapest −\$19\.69 · x0\.45/.test(faceSum), 'an opened section says its face value and how far the cheapest is from it', faceSum);
    const fvs = await t.eval(`[...${D}.querySelectorAll('.dr-face-table .dr-list .fv')].map(x => x.textContent)`);
    expect(fvs.length === 3 && fvs.every(x => /\$.* · x\d/.test(x)), 'and every listing in it, by how much in $ and as a multiple', fvs);
    console.log('   screenshot:', await t.shot('viagogo-event-face.png'));
    await t.eval(`(() => { const tr = [...${D}.querySelectorAll('.dr-face-table tr.sec')].find(tr => tr.textContent.startsWith('N102')); const sel = tr.querySelector('select.fv-pick'); sel.value = 'W105'; sel.dispatchEvent(new Event('change')); return true; })()`);
    const picked = await until(() => t.eval(`(() => { const m = __kept().ui.vgFace && __kept().ui.vgFace['161613516']; return m && m.map.N102 === 'W105'; })()`), 3000);
    /* kept in chrome.storage, not the tab's session: a refresh keeps it (the
       stub's storage itself starts over on a reload, so it is checked here) */
    expect(!!picked, 'the link and a sector picked by hand for N102 are kept in chrome.storage for this event');

    await clickButton(t, /^Listings$/);
    await sleep(200);
    await t.eval(`(() => { [...${D}.querySelectorAll('.dr-results .dr-table tr.sec')].find(tr => tr.textContent.startsWith('E101')).click(); return true; })()`);
    await sleep(300);
    expect(await t.eval(`!!${D}.querySelector('.dr-results .dr-list') && !${D}.querySelector('.dr-results .fv') && !${D}.querySelector('.dr-results .dr-tier-row')`),
      'back on Listings, an opened section shows its listings as before — no face value, no price groups');

    /* a tracked event is picked from a list: no code, no reading */
    await clickButton(t, /^Face value ✓$/);
    await clickButton(t, /^Change$/);
    await sleep(200);
    const picked2 = await t.eval(`(() => { const sel = ${D}.querySelector('.dr-face-events'); if (!sel) return null; sel.value = 'posttick:maxamini2027/show'; sel.dispatchEvent(new Event('change')); return [...sel.options].map(o => o.textContent); })()`);
    const linked2 = await until(async () => /Linked 2 sectors of Max Amini \(Posttick/.test(await noticeText(t)) ? await noticeText(t) : null, 4000);
    expect(!!picked2 && picked2.some(x => /\[2\] Max Amini · Posttick/.test(x)) && !!linked2, 'a tracked Posttick event can be picked from a list', { picked2, note: linked2 || await noticeText(t) });
    const pe101 = await faceRow('E101');
    expect(/^€119\.00–€145\.00/.test(pe101[1]) && /split · 2 sectors · 4 free/.test(pe101[1]), 'a Posttick block priced by category shows each category: E101 at €119–€145', pe101);

    console.log('\n== the Last sales tab');
    const openButtons = await t.eval(`[...${D}.querySelectorAll('.dr-bar button')].map(b => b.textContent)`);
    expect(openButtons.includes('Sell') && openButtons.includes('Clear') && openButtons.some(x => /Save|Saved/.test(x)), 'open, the header has every button, Sell too', openButtons);
    const salesTab = await t.eval(`(() => { const b = [...${D}.querySelectorAll('.dr-tabs button')].find(x => /^Last sales/.test(x.textContent)); if (!b) return null; b.click(); return b.textContent; })()`);
    expect(salesTab === 'Last sales · 3', 'the tab counts this event\'s sales: by viagogo ID, by tracked event and by name, not another event\'s', salesTab);
    const notScanned = await until(async () => { const x = await t.eval(`(${D}.querySelector('.dr-last-view .sk-lsw') || {}).innerText || ''`); return /not scanned/.test(x) ? x : null; }, 3000);
    expect(!!notScanned, 'it says this event\'s last sales are not scanned, with a button to start', notScanned);
    await t.eval(`[...${D}.querySelectorAll('.dr-last-view .sk-lsw button')].find(b => /Scan this event/.test(b.textContent)).click()`);
    const nowScanned = await until(async () => { const x = await t.eval(`(${D}.querySelector('.dr-last-view .sk-lsw') || {}).innerText || ''`); return /scanned every 30 min \(added by hand\)/.test(x) ? x : null; }, 3000);
    const sentWatch = await t.eval('window.__lswSent || []');
    expect(!!nowScanned && sentWatch.length === 1 && sentWatch[0].vgEventId === '161613516' && sentWatch[0].change.on === true && /Albania vs Belarus/.test(sentWatch[0].change.title),
      'pressing it adds the event, with its name, and the tab shows its schedule and an interval to pick', { nowScanned, sentWatch });
    await t.eval(`[...${D}.querySelectorAll('.dr-last-view .sk-lsw button')].find(b => b.textContent === 'Get last sale now').click()`);
    const gotNow = await until(async () => { const x = await t.eval(`(${D}.querySelector('.dr-last-view .sk-lsw') || {}).innerText || ''`); return /New sale saved: S118 · 2 tickets · \$90\.00 \| \$45\.00\/pc/.test(x) ? x : null; }, 3000);
    const checkNow = await t.eval('window.__checkNow || []');
    expect(!!gotNow && checkNow.length === 1 && checkNow[0].vgEventId === '161613516' && checkNow[0].by === 'hand',
      'Get last sale now asks about this event at once and says what came back', { gotNow, checkNow });
    const lastRows = await until(() => t.eval(`(() => { const rows = [...${D}.querySelectorAll('.dr-last-view tbody tr:not(.dr-day)')]; return rows.length ? rows.map(r => [...r.cells].map(c => c.innerText.replace(/\\s+/g, ' ').trim())) : null; })()`), 3000);
    const dayRows = await t.eval(`[...${D}.querySelectorAll('.dr-last-view tbody tr.dr-day')].map(r => r.innerText.trim())`);
    const sameDay = new Date(Date.now() - 3 * 3600e3).toDateString() === new Date().toDateString();
    expect(sameDay ? dayRows.length === 1 && /^Today · \d+ \w{3} · 7 tickets · 3 sales$/.test(dayRows[0]) : dayRows.length >= 1,
      'a heading per day: "Today · 6 Nov · 7 tickets · 3 sales"', dayRows);
    expect(!!lastRows && lastRows.length === 3 && /S205/.test(lastRows[0][1]) && lastRows[0][2] === '4' && /^\$100(\.00)? \| \$25(\.00)?\/pc$/.test(lastRows[0][3]),
      'newest first: S205, 4 tickets, price split "$100 | $25/pc"', lastRows);
    expect(!!lastRows && lastRows[0].length === 4 && !/\/pc/.test(lastRows[2][3]), 'no "Seen" column; one ticket shows just its price', lastRows);
    expect(!!lastRows && /^106\s*→ E106$/.test(lastRows[1][1]) && lastRows[2][2] === '1', 'a matched sector shows its code; tickets per sale', lastRows);
    expect(await t.eval(`!${D}.querySelector('.dr-results')`), 'the tab replaces the listings, which stay untouched');
    console.log('  screenshot:', await t.shot('vg-event-last-sales.png'));
    await clickButton(t, /^Listings$/);
    expect(t.errors.length === 0, 'no errors on the page', t.errors);
  } catch (e) {
    console.log('  ✗ crashed:', e.message);
    failures++;
  } finally { b.close(); }
  console.log(`\n${failures ? '✗ ' + failures + ' FAILED' : '✓ all event-page checks passed'} · ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(failures ? 1 : 0);
})();
