/* Browser test: the popup actually opens.
 *
 * popup.html is loaded fresh from disk every time it is clicked, so a name
 * used before it is declared, or a core/*.js left out of its script tags,
 * only shows up when someone opens it. Chrome is the only thing that can say.
 * This loads the real page with a stand-in service worker and checks the
 * listings view renders, filters, searches and switches to events.
 *
 *   node tests/browser/popup.mjs
 *   CHROME=/path/to/chrome node tests/browser/popup.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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

/* A state in the shape buildState() really sends, with one listing of each
 * kind, so every branch of the listings view is drawn at least once. */
const STUB = `(() => {
  window.__opened = [];
  window.__updated = [];
  window.__activeTab = 'https://news.example.com/whatever';
  const area = { get: async () => ({}), set: async () => {}, remove: async () => {} };
  window.__state = () => {
    const sec = (id, code) => ({ id, code, name: 'TRIBUNA ' + code, meta: {}, hint: '', summary: null, url: null });
    const ev = { key: 'ebileta-ks:1215', num: 1, site: 'ebileta-ks', siteLabel: 'eBileta Kosovo', siteId: '1215',
      title: 'Kosova - Austria - October 4, 2026, 6:00 PM - FADIL VOKRRI STADIUM', date: '', archived: false, open: 1, total: 1, teamOpen: 1, teamTotal: 1,
      otherOwners: [], worst: 'OK', cats: {}, currency: 'EUR', autoMin: null, autoEvery: 5, lastScanAt: Date.now() - 60000,
      lastScanBy: 'this PC', scanner: '', health: null, url: '', viagogo: null, sectors: [sec('444', 'J2'), sec('445', 'E106')] };
    const req = { id: 'r7', num: 7, eventKey: ev.key, sec: '445', code: 'E106', qty: 6, listing: '13988951528', done: false,
      cats: [], client: '', eval: { status: 'OK', options: 12 }, free: 331, buy: null, teamPrices: [], muffled: false,
      listingTrack: 'auto', sectorName: 'TRIBUNA E106', priceTag: '', line: '', scanNote: '', pendingGone: false,
      listingUrl: 'https://my.viagogo.com/listings/?search=13988951528', sectorUrl: null, profit: null };
    const base = { title: 'Kosova - Austria', when: 'Sun 04 Oct 2026', row: '', vgEventId: '161613551',
      history: [], buy: null, money: null, seenAt: Date.now() - 120000, lastSweepAt: 0, goneAt: 0,
      currency: 'USD', price: 84, tickets: 6, done: false, sectorId: null };
    const listings = [
      Object.assign({}, base, { id: '13988951528', section: 'E106', code: 'E106', status: 'Active', statusKind: 'active',
        track: 'auto', state: 'tracked', options: 12, requestId: 'r7', num: 7, reqStatus: 'OK',
        eventKey: ev.key, eventNum: 1, eventTitle: ev.title, sectorId: '445' }),
      Object.assign({}, base, { id: '13990000001', section: 'J2', code: 'J2', status: 'Pending', statusKind: 'pending',
        track: 'auto', state: 'linkable', options: null, requestId: null, num: null, reqStatus: null,
        eventKey: ev.key, eventNum: 1, eventTitle: ev.title }),
      Object.assign({}, base, { id: '13977001122', section: 'B12', code: 'B12', status: 'Deactivated', statusKind: 'deactivated',
        track: 'auto', state: 'untracked', options: null, requestId: null, num: null, reqStatus: null,
        eventKey: null, eventNum: null, eventTitle: '', title: 'Shqiperi - Serbia', vgEventId: '161780042',
        when: 'Wed 12 Nov 2026' }),
      Object.assign({}, base, { id: '13961234567', section: 'N201', code: 'N201', status: 'Active', statusKind: 'active',
        track: 'off', state: 'ignored', options: null, requestId: null, num: null, reqStatus: null,
        eventKey: ev.key, eventNum: 1, eventTitle: ev.title }),
      /* a listing the service worker never stamped: an older worker, still running */
      Object.assign({}, base, { id: '13955550000', section: 'W101', code: 'W101', status: 'Sold', statusKind: 'sold',
        eventKey: ev.key, eventNum: 1, eventTitle: ev.title })
    ];
    return {
      now: Date.now(),
      auth: { signedIn: true, email: 'you@example.com', userId: 'me', displayName: 'Sam Rivers', problem: '' },
      device: { id: 'pc1', name: 'This PC' }, settings: SK.settings.normalize({}),
      sites: SK.siteList().map(x => ({ id: x.id, label: x.label, can: x.can, pages: x.pages, badges: x.badges, pushSelectors: x.pushSelectors })),
      notifyTypes: SK.settings.NOTIFY_TYPES, meta: {}, pushLog: [], legacy: false,
      /* three requests in the event, minus the ones deleted */
      events: [ev], requests: [req, Object.assign({}, req, { id: 'r8', num: 8, code: 'J2', sec: '444', listing: '', listingUrl: null }),
        Object.assign({}, req, { id: 'r9', num: 9, listing: '', listingUrl: null })].filter(r => !(window.__deleted || []).includes(r.id)),
      scans: {}, catalog: [], listings, teamPrices: [],
      devices: [{ id: 'pc1', name: 'This PC', owner: 'Sam Rivers', lastSeen: Date.now(), online: true, thisPc: true }],
      team: [{ userId: 'me', name: 'Sam Rivers', me: true }],
      fx: { day: '2026-09-17', rates: { USD: 83.36 }, fetched: { USD: 83.36 }, manual: [], source: 'ExchangeRate-API' },
      /* the last-sales scan: one listed event, one added by hand, one left out */
      lastSaleScan: { every: 30, here: true, holder: '', asking: true, perHour: 3, blockedUntil: 0, pausedUntil: 0, events: 2, withSession: 1,
        last: { at: Date.now() - 5 * 60000, vgEventId: '161613530', title: 'Albania vs Finland - Nations League', result: 'sale', by: 'scan' },
        slowUntil: Date.now() + 20 * 3600000,
        blocks: [{ at: Date.now() - 10 * 3600000, until: Date.now() - 4 * 3600000, endedAt: Date.now() - 4 * 3600000, ended: 'time', by: 'scan', title: 'Kosovo vs Sweden', why: 'asking for the last sale, HTTP 403' }],
        list: [
        { vgEventId: '161613530', title: 'Albania vs Finland - Nations League', when: 'Thu 12 Nov', source: 'yours', on: true, every: 30, ownEvery: null,
          lastAt: Date.now() - 5 * 60000, lastResult: 'sale', lastBy: 'scan', nextAt: Date.now() + 25 * 60000, etaAt: Date.now() + 25 * 60000, skipUntil: 0, session: true, sales: 4 },
        { vgEventId: '161699999', title: 'Serbia vs England', when: 'Sun 22 Nov', source: 'added', on: true, every: 60, ownEvery: 60,
          lastAt: 0, lastResult: '', nextAt: Date.now(), etaAt: Date.now() + 3 * 60000, skipUntil: 0, session: false, sales: 0 },
        { vgEventId: '161600003', title: 'Kosovo vs Sweden', when: 'Tue 17 Nov', source: 'team', on: false, every: 30, ownEvery: null,
          lastAt: 0, lastResult: '', nextAt: 0, skipUntil: 0, session: false, sales: 0 }] },
      snoozeUntil: 0
    };
  };
  window.chrome = {
    runtime: {
      id: 'seat-tracker-test', lastError: null,
      getURL: p => 'https://ext.local/' + p,
      onMessage: { addListener() {} },
      sendMessage(msg, cb) {
        (window.__log = window.__log || []).push(JSON.parse(JSON.stringify(msg)));
        if (msg.type === 'deleteRequests') window.__deleted = (window.__deleted || []).concat(msg.ids);
        setTimeout(() => cb({ ok: true, data: msg.type === 'state' ? window.__state() : null }), 10);
      }
    },
    tabs: {
      /* tab.url is only readable where the extension holds a host permission,
         so a tab we cannot see comes back without one */
      query: () => Promise.resolve([{ id: 7, url: window.__activeTab || undefined }]),
      create: o => { window.__opened.push(o.url); return Promise.resolve({}); },
      update: (id, o) => { window.__updated.push(o.url); return Promise.resolve({}); }
    },
    storage: { local: area, session: area, onChanged: { addListener() {} } }
  };
})();`;

let failures = 0;
function expect(cond, label, extra) {
  console.log(cond ? '  ✓' : '  ✗', label, cond || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500));
  if (!cond) failures++;
}
async function until(fn, ms) {
  const end = Date.now() + (ms || 6000);
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* not yet */ }
    await sleep(80);
  }
  return null;
}

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'st-popup-'));
  const proc = spawn(findChrome(), ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--window-size=460,900', '--lang=en-US'], { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.resume();
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
  const tab = { errors: [] };
  b.on(msg => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      tab.errors.push((d.exception && d.exception.description) || d.text);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      tab.errors.push(msg.params.args.map(a => a.description || a.value).join(' '));
      return;
    }
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    const f = path.join(EXT, decodeURIComponent(new URL(request.url).pathname));
    let body = null, type = 'text/plain';
    if (f.startsWith(EXT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      body = fs.readFileSync(f);
      type = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html; charset=utf-8'
        : f.endsWith('.png') ? 'image/png' : 'text/javascript';
    }
    if (body === null) { b.cmd('Fetch.fulfillRequest', { requestId, responseCode: 404, body: '' }, sessionId).catch(() => {}); return; }
    b.cmd('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: type }], body: Buffer.from(body).toString('base64') }, sessionId).catch(() => {});
  });
  await b.cmd('Page.enable', {}, sessionId);
  await b.cmd('Runtime.enable', {}, sessionId);
  await b.cmd('Emulation.setDeviceMetricsOverride', { width: 460, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: STUB }, sessionId);
  await b.cmd('Fetch.enable', { patterns: [{ urlPattern: 'https://ext.local/*' }] }, sessionId);
  tab.eval = async expression => {
    const r = await b.cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  };
  tab.go = async url => {
    await b.cmd('Page.navigate', { url }, sessionId);
    await until(() => tab.eval('document.readyState === "complete"'), 8000);
  };
  tab.shot = async name => {
    const r = await b.cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
    const f = path.join(SHOTS, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return f;
  };
  return tab;
}

const READ = `window.__t = {
  cards: () => [...document.querySelectorAll('#listings .reqs .req')].map(n => n.innerText.replace(/\\s+/g, ' ').trim()),
  groups: () => [...document.querySelectorAll('#listings .group-title')].map(n => n.textContent),
  chips: () => [...document.querySelectorAll('#listings .filter-chips button')].map(n => n.textContent),
  empty: () => { const n = document.querySelector('#listings .empty'); return n ? n.textContent : ''; },
  press: (sel, text) => {
    const b = [...document.querySelectorAll(sel)].find(x => x.textContent.trim().startsWith(text));
    if (!b) return false;
    b.click();
    return true;
  }
}; true`;

(async () => {
  const t0 = Date.now();
  const b = await launch();
  try {
    const t = await openTab(b);

    console.log('\n== the popup opens');
    await t.go('https://ext.local/popup/popup.html');
    await until(() => t.eval('!!document.querySelector("#listings .reqs .req")'), 8000);
    await t.eval(READ);

    expect(t.errors.length === 0, 'nothing throws while it loads', t.errors);
    expect(await t.eval('!document.getElementById("main").hidden'), 'and it opens signed in, on the listings view');

    const stripes = await t.eval('[...document.querySelectorAll("#listings .req")].map(n => [...n.classList].find(c => c.startsWith("lst-")))');
    /* group order, and inside a group the one with a scan behind it first:
     * the tracked E106 has 12 options, the other two have none to sort on */
    expect(stripes.join(',') === 'lst-active,lst-sold,lst-pending,lst-deactivated,lst-active',
      'every card is striped by what viagogo calls the listing', stripes);
    const words = await t.eval('[...document.querySelectorAll("#listings .req .pill")].map(n => n.textContent)');
    expect(['Active', 'Pending', 'Sold', 'Deactivated'].every(w => words.includes(w)),
      'and says the word next to it', words);

    const cards = await t.eval('window.__t.cards()');
    expect(cards.length === 5, 'every listing is drawn, none dropped', { drawn: cards.length, cards });
    expect(await t.eval('window.__t.empty()') === '', 'so the empty message stays away', await t.eval('window.__t.empty()'));

    const groups = await t.eval('window.__t.groups()');
    expect(groups.includes('Kosova - Austria') && groups.includes('Shqiperi - Serbia'),
      'one group per viagogo event, named as viagogo names it', groups);
    expect(groups.includes('Ignored'), 'with the ignored ones out of the way at the end', groups);
    const subs = await t.eval('[...document.querySelectorAll("#listings .group-sub")].map(n => n.textContent)');
    expect(subs.some(x => x.includes('tracked as [1]')), 'and a group says when its event is tracked', subs);
    const sums = await t.eval('[...document.querySelectorAll("#listings .group-sum")].map(n => n.innerText.replace(/\\s+/g, " "))');
    expect(sums.length === groups.length && sums[0].includes('tickets'), 'every group totals its tickets', sums);

    console.log('\n== the status filter');
    const chips = await t.eval('window.__t.chips()');
    expect(chips[0] === 'All 5', 'the chips count what is there', chips);
    expect(chips.join(' ').includes('Active 2') && chips.join(' ').includes('Pending 1')
      && chips.join(' ').includes('Deactivated 1') && chips.join(' ').includes('Sold 1'),
    'Active, Pending, Deactivated and Sold, as viagogo names them', chips);

    await t.eval('window.__t.press("#listings .filter-chips button", "Pending")');
    await sleep(120);
    expect((await t.eval('window.__t.cards()')).length === 1, 'picking one narrows the list');
    await t.eval('window.__t.press("#listings .filter-chips button", "All")');
    await sleep(120);
    expect((await t.eval('window.__t.cards()')).length === 5, 'and All brings them back');

    console.log('\n== search and the empty states');
    await t.eval('(() => { const s = document.getElementById("search"); s.value = "J2"; s.dispatchEvent(new Event("input")); })()');
    await sleep(150);
    expect((await t.eval('window.__t.cards()')).length === 1, 'the search box narrows by sector');
    await t.eval('(() => { const s = document.getElementById("search"); s.value = "zzzz"; s.dispatchEvent(new Event("input")); })()');
    await sleep(150);
    expect((await t.eval('window.__t.empty()')).includes('nothing matches "zzzz"'),
      'and says which of the two reasons it found nothing', await t.eval('window.__t.empty()'));
    await t.eval('(() => { const s = document.getElementById("search"); s.value = ""; s.dispatchEvent(new Event("input")); })()');
    await sleep(150);

    console.log('\n== the buttons');
    expect(await t.eval('window.__t.press("#listings .list-head button", "Scan listings")'), 'Scan listings is there and clickable');
    await sleep(150);
    const opened = await t.eval('window.__opened');
    expect(opened.length === 1 && opened[0].endsWith('#sk-scan'), 'and it opens the listings page asking for a scan', opened);
    expect(t.errors.length === 0, 'still nothing thrown', t.errors);

    console.log('  screenshot:', await t.shot('popup-listings.png'));

    console.log('\n== opening a listing while already on the listings page');
    await t.eval('window.__opened = []; window.__updated = [];');
    expect(await t.eval('window.__t.press("#listings .row-acts button", "Open")'), 'a listing has an Open button');
    await sleep(200);
    expect((await t.eval('window.__opened')).length === 1 && (await t.eval('window.__updated')).length === 0,
      'from an unrelated page it opens a tab, as before',
      { opened: await t.eval('window.__opened'), updated: await t.eval('window.__updated') });

    await t.eval('window.__activeTab = "https://my.viagogo.com/listings/?activeTab=ACTIVE"; window.__opened = []; window.__updated = [];');
    await t.eval('window.__t.press("#listings .row-acts button", "Open")');
    await sleep(200);
    const updated = await t.eval('window.__updated');
    expect((await t.eval('window.__opened')).length === 0 && updated.length === 1,
      'but with the listings page already open it changes that page instead of stacking a tab',
      { opened: await t.eval('window.__opened'), updated });
    expect(updated[0] && updated[0].includes('search=13988951528'),
      'and it goes to that one listing', updated);

    await t.eval('window.__activeTab = "https://my.viagogo.com/sales/"; window.__opened = []; window.__updated = [];');
    await t.eval('window.__t.press("#listings .row-acts button", "Open")');
    await sleep(200);
    expect((await t.eval('window.__opened')).length === 1,
      'a different viagogo page is still a different page, so that opens a tab',
      { opened: await t.eval('window.__opened'), updated: await t.eval('window.__updated') });

    console.log('\n== switching to events');
    await t.eval('window.__t.press("#viewswitch button", "Events")');
    await sleep(200);
    expect(await t.eval('document.getElementById("listings").hidden'), 'the listings view goes away');
    expect(await t.eval('!document.getElementById("events").hidden && !!document.querySelector("#events .req")'),
      'and the old events view still works');
    expect(t.errors.length === 0, 'with nothing thrown either way', t.errors);
    const card = await t.eval(`(() => { const e = document.querySelector('#events .event'); return { title: e.querySelector('.event-title').textContent, tile: e.querySelector('.date-tile').innerText.replace(/\\s+/g, ' ').trim(), when: e.querySelector('.event-when').innerText.replace(/\\s+/g, ' ').trim() }; })()`);
    expect(card.title === '[1] Kosova - Austria' && /Oct 4 Sun/i.test(card.tile) && /18:00/.test(card.when) && /Fadil Vokrri Stadium/.test(card.when),
      'the event card shows the name, a date tile, the time and the venue apart', card);
    console.log('  screenshot:', await t.shot('popup-events.png'));

    console.log('\n== deleting several requests at once');
    const bar0 = await t.eval(`(() => { const b = document.querySelector('#events .bulk-bar'); return b && b.innerText.trim(); })()`);
    const picks = await t.eval(`document.querySelectorAll('#events .req input.pick').length`);
    expect(bar0 === 'Select all 3' && picks === 3, 'the event has a Select all, and each of its 3 requests a checkbox', { bar0, picks });
    await t.eval(`(() => { document.querySelectorAll('#events .req input.pick')[0].click(); return true; })()`);
    const one = await t.eval(`(() => { const b = document.querySelector('#events .bulk-bar'); const all = b.querySelector('input'); return { text: b.innerText.replace(/\\s+/g, ' ').trim(), some: all.indeterminate }; })()`);
    expect(/^1 of 3 selected Clear Delete 1$/.test(one.text) && one.some, 'ticking one says 1 of 3, half-ticks Select all, and offers Delete 1', one);
    await t.eval(`(() => { document.querySelector('#events .bulk-bar input').click(); return true; })()`);
    const all = await t.eval(`(() => ({ text: document.querySelector('#events .bulk-bar').innerText.replace(/\\s+/g, ' ').trim(), ticked: [...document.querySelectorAll('#events .req input.pick')].every(x => x.checked) }))()`);
    expect(/^3 of 3 selected Clear Delete 3$/.test(all.text) && all.ticked, 'Select all ticks every request of the event', all);
    await t.eval(`(() => { window.__asked = ''; window.confirm = m => { window.__asked = m; return false; }; [...document.querySelectorAll('#events .bulk-bar button')].find(b => /^Delete/.test(b.textContent)).click(); return true; })()`);
    const asked = await t.eval('window.__asked');
    expect(/Delete 3 requests\?/.test(asked) && /#7, #8, #9/.test(asked) && !(await t.eval(`(window.__log || []).some(m => m.type === 'deleteRequests')`)),
      'it asks first, naming them, and saying no deletes nothing', asked);
    await t.eval(`(() => { window.confirm = () => true; [...document.querySelectorAll('#events .bulk-bar button')].find(b => /^Delete/.test(b.textContent)).click(); return true; })()`);
    const sentDel = await until(() => t.eval(`(() => { const m = (window.__log || []).find(x => x.type === 'deleteRequests'); return m ? m.ids.join(',') : null; })()`), 3000);
    expect(sentDel === 'r7,r8,r9' || (sentDel && sentDel.split(',').sort().join(',') === 'r7,r8,r9'), 'yes deletes all 3 in one message', sentDel);

    console.log('\n== viagogo last sales: its own section, every event with its last and next turn');
    const lsCard = await t.eval(`[...document.querySelectorAll('#lastSales .ls-card .ls-line')].map(x => x.textContent.trim())`);
    expect(lsCard.length >= 3 && /^Scan: Running on this PC · 2 events, each every 30 min .*about 3 requests an hour.*half speed/.test(lsCard[0])
      && /^Last request: (?:yesterday )?\d\d:\d\d \(5 min ago\) · Albania vs Finland - Nations League — saved a new sale$/.test(lsCard[1])
      && /^Next request: about (?:tomorrow )?\d\d:\d\d \(in 3 min\) · Serbia vs England$/.test(lsCard[2]),
      'the section says it runs here, when it asked last and what, and what comes next', lsCard);
    const sum = await t.eval(`document.getElementById('lastSalesSum').textContent`);
    expect(sum === '· 2 events', 'its heading counts the events', sum);
    const hist = await t.eval(`[...document.querySelectorAll('.ls-blocks .detail')].map(x => x.textContent)`);
    expect(hist.length === 1 && /by the scan, asking about Kosovo vs Sweden, asking for the last sale, HTTP 403 · ended by itself at/.test(hist[0]),
      'past bot checks: when, what was being asked, how it ended', hist);
    const ls = await t.eval(`[...document.querySelectorAll('.ls-row')].map(r => [...r.querySelectorAll('b, .ls-sub, button')].map(x => x.textContent.trim()).join(' '))`);
    expect(ls.length === 3 && /^Serbia vs England Sun 22 Nov · added by hand · every 60 min Last: not asked yet Next: about (?:tomorrow )?\d\d:\d\d \(in 3 min\)/.test(ls[0])
      && /^Albania vs Finland - Nations League Thu 12 Nov · you list on it · every 30 min \(team\) · 4 sales saved Last: (?:yesterday )?\d\d:\d\d \(5 min ago\) — saved a new sale Next: about (?:tomorrow )?\d\d:\d\d \(in 25 min\) Get now/.test(ls[1])
      && /Kosovo vs Sweden .*the team lists on it · left out.*Get now Scan again/.test(ls[2]),
      'every event with its source, last answer and next turn, the next turn first; the left-out one last', ls);
    await t.eval(`(() => { document.querySelectorAll('.ls-row')[1].querySelector('button').click(); return true; })()`);
    const getNow = await until(() => t.eval(`(() => { const m = (window.__log || []).find(x => x.type === 'lastSaleCheckNow'); return m || null; })()`), 3000);
    expect(!!getNow && getNow.vgEventId === '161613530' && getNow.by === 'hand', 'Get now asks about that event at once', getNow);
    const own = await t.eval(`[...document.querySelectorAll('.ls-row select')].map(s => s.value)`);
    expect(JSON.stringify(own) === JSON.stringify(['60', '']), 'each with its interval: the team\'s, or its own', own);
    await t.eval(`(() => { const i = document.querySelector('.ls-add input'); i.value = 'https://www.viagogo.com/Sports-Tickets/Soccer/E-161677777'; i.dispatchEvent(new Event('input')); [...document.querySelectorAll('.ls-add button')][0].click(); return true; })()`);
    await t.eval(`(() => { document.querySelectorAll('.ls-row')[0].querySelector('button.icon').click(); return true; })()`);
    await t.eval(`(() => { const s = document.querySelectorAll('.ls-row select')[1]; s.value = '120'; s.dispatchEvent(new Event('change')); return true; })()`);
    const lsSent = await until(() => t.eval(`(() => { const m = (window.__log || []).filter(x => x.type === 'setLastSaleEvent'); return m.length >= 3 ? m : null; })()`), 3000);
    expect(!!lsSent && lsSent[0].vgEventId === '161677777' && lsSent[0].change.on === true
      && lsSent[1].vgEventId === '161699999' && lsSent[1].change.on === false
      && lsSent[2].vgEventId === '161613530' && lsSent[2].change.every === 120,
      'a pasted link adds its event; ✕ removes one; the interval can be changed', lsSent);
    /* viagogo's bot check: when, what was being asked, until when, and the way out */
    await t.eval(`(() => {
      const base = window.__state;
      window.__state = () => { const st = base(); Object.assign(st.lastSaleScan, {
        blockedUntil: Date.now() + 5 * 3600000 + 30 * 60000,
        block: { at: Date.now() - 30 * 60000, until: Date.now() + 5 * 3600000 + 30 * 60000, by: 'scan', vgEventId: '161613530', title: 'Albania vs Finland - Nations League', why: 'asking for the last sale, HTTP 403' } });
        return st; };
      document.querySelectorAll('.ls-row')[0].querySelector('button').click();
      return true; })()`);
    const blockedText = await until(() => t.eval(`(() => { const c = document.querySelector('#lastSales .ls-card.bad'); return c ? c.textContent : null; })()`), 3000);
    expect(!!blockedText && /viagogo showed its bot check at (?:yesterday )?\d\d:\d\d \(by the scan, asking about Albania vs Finland - Nations League, asking for the last sale, HTTP 403\)\. Nothing asks viagogo on this PC until (?:tomorrow )?\d\d:\d\d \(in 5 h 30 min\)/.test(blockedText)
      && /Open viagogo/.test(blockedText) && /Start again now/.test(blockedText),
      'blocked: when it happened, what was being asked, when it starts again, and the buttons', blockedText);
    const sum2 = await t.eval(`document.getElementById('lastSalesSum').textContent`);
    expect(/^· bot check, stopped until \d\d:\d\d$/.test(sum2), 'the heading says so too', sum2);
    const nowOff = await t.eval(`[...document.querySelectorAll('.ls-row .ls-ctl button')].filter(b => b.textContent === 'Get now').every(b => b.disabled)`);
    expect(nowOff, 'Get now waits for the bot check to end');
    await t.eval(`(() => { [...document.querySelectorAll('#lastSales .ls-card.bad button')].find(b => b.textContent === 'Open viagogo').click(); return true; })()`);
    const vgOpened = await until(() => t.eval(`window.__opened.find(u => /Initialise\\?EventID=161613530/.test(u)) || null`), 2000);
    expect(!!vgOpened, 'Open viagogo opens the sell page of the event that was being asked about', vgOpened);
    await t.eval(`(() => { [...document.querySelectorAll('#lastSales .ls-card.bad button')].find(b => b.textContent === 'Start again now').click(); return true; })()`);
    const unb = await until(() => t.eval(`(window.__log || []).some(x => x.type === 'vgUnblock') || null`), 2000);
    expect(!!unb, 'Start again now lifts the stop');

    await t.eval(`(() => { const d = document.getElementById('lastSalesBox'); d.open = true; for (const x of document.querySelectorAll('#addBox, #events')) x.hidden = true; d.scrollIntoView(); return true; })()`);
    await sleep(200);
    console.log('  screenshot:', await t.shot('popup-last-sales.png'));

    /* Updates: a newer version shared by a teammate, two PCs, and sharing one */
    await t.eval(`(() => {
      window.confirm = () => true;
      const base = window.__state;
      window.__state = () => { const st = base(); st.lastSaleScan.blockedUntil = 0; st.lastSaleScan.block = null;
        st.update = { installed: '3.0.0', pending: true,
          latest: { version: '3.1.0', url: 'https://drive.google.com/file/d/abc/view', note: 'fixes the viagogo listings', at: Date.now() - 3600000, by: 'Aldo' } };
        st.devices = [{ id: 'pc1', name: 'Office', owner: 'Sam Rivers', lastSeen: Date.now(), online: true, thisPc: true, version: '3.0.0' },
          { id: 'pc2', name: 'Laptop', owner: 'Aldo', lastSeen: Date.now() - 3 * 3600000, online: false, thisPc: false, version: '3.1.0' }];
        return st; };
      document.getElementById('lastSalesBox').open = false;
      document.getElementById('updateBox').open = true;
      document.getElementById('muteBtn').click();
      return true; })()`);
    /* any answer re-reads the state: the mute menu's 30 min does */
    await t.eval(`(() => { [...document.querySelectorAll('#muteMenu button')].find(b => b.textContent === '30 min').click(); return true; })()`);
    const bar = await until(() => t.eval(`(() => { const b = document.getElementById('updateBar'); return b && !b.hidden ? b.textContent : null; })()`), 3000);
    expect(!!bar && /Seat Tracker 3\.1\.0 is ready \(this PC has 3\.0\.0\)/.test(bar), 'the bar at the top says a newer version is shared', bar);
    const upSum = await t.eval(`document.getElementById('updateSum').textContent`);
    expect(upSum === '· 3.1.0 ready', 'so does the Updates heading', upSum);
    const upText = await t.eval(`document.getElementById('update').textContent`);
    expect(/This PC: Seat Tracker 3\.0\.0\./.test(upText) && /Shared: 3\.1\.0 by Aldo/.test(upText) && /fixes the viagogo listings/.test(upText)
      && /Unzip it and copy its files over your old Seat Tracker folder/.test(upText),
      'the section: this PC, what is shared, by whom, the note and the steps', upText.slice(0, 400));
    const pcs = await t.eval(`[...document.querySelectorAll('.up-pc')].map(r => r.className + ' | ' + r.textContent)`);
    expect(pcs.length === 2 && /old/.test(pcs[0]) && /3\.0\.0 · not updated/.test(pcs[0]) && !/old/.test(pcs[1].split('|')[0]),
      'each PC with its version; the one behind is marked', pcs);
    await t.eval(`(() => { [...document.querySelectorAll('#updateBar button')].find(b => b.textContent === 'Download').click(); return true; })()`);
    const dl = await until(() => t.eval(`window.__opened.find(u => /drive\.google\.com/.test(u)) || null`), 2000);
    expect(!!dl, 'Download opens the shared link', dl);
    await t.eval(`(() => {
      const box = document.getElementById('update');
      const [ver, url, note] = box.querySelectorAll('.up-form input');
      ver.value = '3.2.0'; ver.dispatchEvent(new Event('input'));
      url.value = 'https://x.test/st-3.2.0.zip'; url.dispatchEvent(new Event('input'));
      note.value = 'faster scans'; note.dispatchEvent(new Event('input'));
      [...box.querySelectorAll('button')].find(b => b.textContent === 'Send to every PC').click();
      return true; })()`);
    const shared = await until(() => t.eval(`(window.__log || []).find(x => x.type === 'shareUpdate') || null`), 3000);
    expect(!!shared && shared.version === '3.2.0' && shared.url === 'https://x.test/st-3.2.0.zip' && shared.note === 'faster scans',
      'Send to every PC shares the version, link and note', shared);
    await t.eval(`(() => { [...document.querySelectorAll('#update button')].find(b => b.textContent === 'Take the link back').click(); return true; })()`);
    const cleared = await until(() => t.eval(`(window.__log || []).some(x => x.type === 'clearUpdate') || null`), 3000);
    expect(!!cleared, 'the link can be taken back');
    await t.eval(`(() => { for (const x of document.querySelectorAll('#listings, #viewswitch')) x.hidden = true; document.getElementById('updateBox').scrollIntoView(); return true; })()`);
    await sleep(200);
    console.log('  screenshot:', await t.shot('popup-updates.png'));
    expect(t.errors.length === 0, 'nothing thrown', t.errors);

    console.log(failures ? `\n✗ ${failures} check(s) failed · ${Math.round((Date.now() - t0) / 1000)} s`
      : `\n✓ all popup checks passed · ${Math.round((Date.now() - t0) / 1000)} s`);
  } finally {
    b.close();
  }
  process.exit(failures ? 1 : 0);
})();
