/* Browser test: my.viagogo.com/listings, against a real listing card.
 *
 * Runs the extension's own page scripts in Chrome for Testing, with a stand-in
 * for the service worker — no Supabase, no viagogo account, no network.
 * Checks reading the cards, saving them, the line added to each card, the
 * sidebar, "Add as request", and that a tab left open while the extension is
 * reloaded shuts down quietly instead of throwing "Extension context invalidated".
 *
 *   node tests/browser/viagogo-listings.mjs
 *   CHROME=/path/to/chrome node tests/browser/viagogo-listings.mjs
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

/* one listing card, exactly as copied from my.viagogo.com/listings */
const CARD = `<div class="sc-olbas eEcWqN sc-1l7e1r9-0 jyWHeX"><div class="sc-1l7e1r9-22 jYZMLm"><div class="sc-j9khbl-0 kuwBkx"><span color="infoPrimary" class="sc-j9khbl-1 chKkpI"></span>Active</div></div><div class="sc-1l7e1r9-8 jDZfjl"><div class="sc-ehmTmK fLEbbp"><div class="sc-1l7e1r9-1 iwoyVj">Albania vs Belarus - Nations League<span class="sc-1l7e1r9-14 kJYDfh"><a class="sc-papXJ iJOCOo" href="https://www.viagogo.com/E-161613516/?listingId=13988951528"><svg viewBox="0 0 25 10" fill="none" width="26px" height="20px" xmlns="http://www.w3.org/2000/svg"><path d="M6.7999 3.99996H4.12101C3.78122 3.99996 3.44904 4.10054 3.16631 4.28902C2.6875 4.60823 2.3999 5.14561 2.3999 5.72108V11.5514C2.3999 12.0948 2.61573 12.6158 2.9999 13C3.38408 13.3841 3.90513 13.6 4.44843 13.6H9.95134C10.4947 13.6 11.0157 13.3841 11.3999 13C11.7841 12.6158 11.9999 12.0948 11.9999 11.5514V9.19996M6.3999 9.59996C6.7199 9.27996 11.3333 4.66663 13.5999 2.39996M13.5999 2.39996H9.5999M13.5999 2.39996V6.79996" stroke="#0075C4" stroke-width="1.28" stroke-linecap="round"></path></svg></a></span></div><div class="sc-1l7e1r9-4 cUYcsv">Listing No. 13988951528</div><div class="sc-1l7e1r9-4 cUYcsv">Air Albania Stadium (Arena Kombëtare), Tirana, null, Albania</div><div class="sc-1l7e1r9-4 cUYcsv">Sat, 26 Sep • 8:45 PM</div></div><div class="sc-1l7e1r9-11 jMfPUn"><div class="sc-1l7e1r9-1 iwoyVj">$84.00&nbsp;<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" role="img" width="12px" height="12px" fill="textBrand" class="sc-dkzDqf cphzba"><path fill="currentColor" fill-rule="evenodd" d="M9.883 2.583a2 2 0 0 1 2.828 0l.707.708a2 2 0 0 1 0 2.828l-6.057 6.058a2 2 0 0 1-.68.446l-3.31 1.305c-.813.32-1.618-.484-1.297-1.297l1.305-3.31a2 2 0 0 1 .446-.68z" clip-rule="evenodd"></path></svg></div><div class="sc-1l7e1r9-4 cUYcsv">Price per ticket</div><div class="sc-1l7e1r9-10 eJynLl"><div class="sc-1l7e1r9-4 cUYcsv">You'll get</div><div class="sc-1l7e1r9-7 kgRdwR">$453.60</div><div class="sc-1l7e1r9-4 cUYcsv">if your tickets sell</div></div><div class="sc-1l7e1r9-12 kvTbwg"><div class="sc-1l7e1r9-4 cUYcsv">Section E106 • Row ALB</div><div class="sc-1l7e1r9-4 cUYcsv">6 Tickets available</div></div></div></div><button class="sc-dIouRR iwSIaC">Show details</button><div class="sc-1o34ejs-0 bNnFJb"><div class="sc-1o34ejs-1 fOXPpp"><div class="sc-1o34ejs-2 liFUKU"><div class="sc-1o34ejs-3 eIgIjT"><div class="sc-1o34ejs-4 lmCWmq">Listing performance</div><div class="sc-1o34ejs-33 dha-DUv">Not competitive</div></div><div class="sc-1o34ejs-8 uVOjz"><span class="sc-1o34ejs-32 fMuPou">Prices in your section have dropped 10% in the last 6 days. Buyers are choosing similar seats at lower prices. Lower your price to $52 to make your listing more competitive.</span></div></div><div class="sc-1o34ejs-9 beOFPp"><div class="sc-1o34ejs-10 gLnjeC"><div class="sc-1o34ejs-11 ecxCIS">Recommended price: $52</div><div class="sc-1o34ejs-12 gWYWPS"><svg aria-labelledby="title desc" fill="none" height="12px" viewBox="0 0 16 16" width="12px" xmlns="http://www.w3.org/2000/svg" class="sc-1o34ejs-13 dCZiPX" role="graphics-symbol" aria-hidden="true" focusable="false"><path d="M8.54 13.765a.75.75 0 0 1-1.09 0l-4.246-4.5a.75.75 0 1 1 1.092-1.03l2.954 3.132V2.75a.75.75 0 0 1 1.5 0v8.61l2.955-3.125a.75.75 0 1 1 1.09 1.03z" fill="currentColor"></path></svg><span class="sc-1o34ejs-14 cYENfr">$32 lower than your listing</span></div></div></div></div><div class="sc-1o34ejs-27 jySfpz"></div></div><div class="sc-1l7e1r9-9 klrrS"></div><div class="sc-91pdow-0 biUIke"><div class="sc-g1pihb-0 lnuLVL"><div class="sc-kItwNn flDRpL"><span>Instant download pending</span><span><span style="display: inline-block; padding: 0px; cursor: pointer; vertical-align: middle;"><button aria-expanded="false" aria-haspopup="true" type="button" aria-label="tooltip"></button></span></span></div></div><div class="sc-5ply12-0 hONvgB"><div class="sc-5ply12-1 laMxsc"><button class="sc-dIouRR oUmxC"><span class="sc-1jf98p5-1 jjauH">See actions</span></button><button class="sc-dIouRR tkeSc"><span class="sc-1l7e1r9-16 iHFUrg">Adjust price</span></button></div></div></div></div>`;

/* a second listing on the same page that is not a request yet */
const CARD2 = CARD.replace(/13988951528/g, '13992748289').replace('$453.60', '$302.40')
  .replace('6 Tickets available', '4 Tickets available').replace('Section E106 • Row ALB', 'Section E105 • Row 12');

const box = html => `<div style="background:#fff;border:1px solid #dde1e6;border-radius:12px;padding:20px 24px">${html}</div>`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>My listings</title>
<style>.jDZfjl{display:flex;justify-content:space-between;gap:24px}.jMfPUn{text-align:right}.iwoyVj{font-weight:700;font-size:17px}.cUYcsv{color:#555;font-size:14px}.bNnFJb{display:flex;justify-content:space-between;border-top:1px solid #eee;margin-top:12px;padding-top:12px}.hONvgB{display:flex;gap:8px}</style></head>
<body style="margin:0;font-family:Helvetica,Arial,sans-serif;background:#f5f6f8">
<header style="padding:16px 40px;font-weight:700;font-size:20px">My listings</header>
<div class="sbar-row" style="padding:0 40px 12px;max-width:900px"><div class="sbar" style="display:flex;gap:8px"><input type="search" placeholder="Search by event or listing no." style="flex:1;padding:8px"><button>Search</button></div></div>
<main id="list" style="padding:0 40px 40px;display:grid;gap:16px;max-width:900px"></main>
<script>setTimeout(function () { document.getElementById('list').innerHTML = ${JSON.stringify(box(CARD) + box(CARD2))}; }, 700);</script>
</body></html>`;

/* the service worker's answers: request #7 in E106 has listing 13988951528, bought at 4,000 L;
   rates 1 USD = 83.36 L — the worked example */
const STUB = `(() => {
  /* viagogo's own JSON for My listings, as captured on 2026-10-08: 130
     listings over two pages of 100, 3 active and the rest deactivated */
  window.__fetches = [];
  const realFetch = window.fetch.bind(window);
  const item = i => ({ Id: 15000000000 + i, Status: i < 3 ? 'Active' : 'Deactivated', EventId: 161959641,
    EventDescription: 'KF Egnatia vs FC Midtjylland - European Club Conference', EventDateSimplifiedStr: 'Thu, 15 Oct • 6:45 PM',
    VenueDescription: 'Air Albania Stadium (Arena Kombëtare)', City: 'Tirana', State: null, Country: 'Albania',
    Quantity: 4, QuantityRemain: 4, Section: 'E10' + (i % 9), Rows: null,
    PricePerTicket: { Amount: 50, Currency: 'USD' }, PayoutPerTicket: { Amount: 45, Currency: 'USD' },
    DisplayPricePerTicket: { Amount: 9999999, Currency: 'DisplayPricePerTicketCURRENCY' } });
  window.fetch = async (url, opts) => {
    const u = new URL(String(url), location.href);
    if (u.pathname === '/listings/getListings') {
      window.__fetches.push({ path: u.pathname, page: u.searchParams.get('page'), size: u.searchParams.get('pageSize'), filters: u.searchParams.get('filters'), creds: opts && opts.credentials });
      const page = Number(u.searchParams.get('page')), size = Number(u.searchParams.get('pageSize'));
      const all = Array.from({ length: 130 }, (_, i) => item(i));
      return new Response(JSON.stringify({ NumFound: 130, Listing: all.slice((page - 1) * size, page * size), IsMLBLinked: false }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (u.pathname === '/recommendedListing/isListingRecommended') {
      window.__fetches.push({ path: u.pathname, id: u.searchParams.get('listingId') });
      return new Response(JSON.stringify({ RecommendedMidPrice: 18, RecommendedPriceMessage: { Message: 'Recommended price: $18' } }), { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, opts);
  };
  window.__log = [];
  window.__saved = {};
  window.__changed = [];
  const area = { get: async () => ({}), set: async () => {}, remove: async () => {} };
  window.__state = () => {
    const P = SK.profit;
    const sec = (id, code) => ({ id, code, name: 'TRIBUNA ' + code, meta: {}, hint: '', summary: null, url: null });
    const ev = { key: 'ebileta:2153', num: 1, site: 'ebileta', siteLabel: 'eBileta', siteId: '2153', title: 'Shqiperi - Bjellorusi',
      date: 'Sht 26 sht 2026 20:45', archived: false, open: 1, total: 1, teamOpen: 1, teamTotal: 1, otherOwners: [], worst: 'OK',
      cats: {}, currency: '', autoMin: null, autoEvery: 5, lastScanAt: 0, lastScanBy: '', scanner: '', health: null, url: '',
      viagogo: null, sectors: [sec('1601', 'E105'), sec('1602', 'E106')] };
    const buy = { amount: 4000, currency: 'ALL', source: 'section price' };
    const req = { id: 'r7', num: 7, eventKey: ev.key, sec: '1602', code: 'E106', qty: window.__reqQty || 6, listing: '13988951528', done: false,
      cats: [], client: '', eval: { status: 'OK', options: 12 }, free: 331, buy, teamPrices: [] };
    const rates = { USD: 83.36, EUR: 97.5 };
    const listings = Object.values(window.__saved).map(l => {
      const r = l.id === req.listing ? req : null;
      const typed = (window.__buys || {})[l.id];
      const lb = typed ? { amount: Number(typed.price), currency: typed.currency, source: 'typed on the listing' } : r ? buy : null;
      return { id: l.id, title: l.title, when: l.when, section: l.section, row: l.row, status: l.status, history: (window.__hist || {})[l.id] || [],
        requestId: r ? r.id : null, num: r ? r.num : null, code: r ? r.code : l.section, reqStatus: r ? 'OK' : null, reqOptions: r ? 36 : null,
        eventKey: r ? ev.key : null, eventNum: r ? 1 : null, eventTitle: r ? ev.title : '', buy: lb,
        buyPrice: typed ? Number(typed.price) : null, buyCurrency: typed ? typed.currency : 'ALL',
        money: Object.assign(P.profitOf(l, lb, rates), { rateDay: '2026-09-17', manualRates: [], listing: l }) };
    });
    return { auth: { signedIn: true, email: 'you@example.com' }, settings: SK.settings.normalize({}),
      sites: SK.siteList().map(x => ({ id: x.id, label: x.label, can: x.can, pages: x.pages, badges: x.badges, pushSelectors: x.pushSelectors })),
      events: [ev], requests: [req], scans: {}, catalog: [], devices: [], listings, compares: window.__compares || [],
      team: [{ userId: 'me', name: 'Sam Rivers', me: true }, { userId: 'u2', name: 'Ana Krasniqi', me: false }],
      teamPrices: [{ listingId: 'a1', userId: 'u2', owner: 'Ana Krasniqi', eventKey: ev.key, sectorId: '1602', section: 'E106', row: '',
        price: 40, currency: 'USD', tickets: 3, status: 'active', seenAt: Date.now() }],
      fx: { day: '2026-09-17', rates, fetched: rates, manual: [] }, snoozeUntil: 0, meta: {} };
  };
  window.chrome = {
    runtime: {
      id: 'seat-tracker-test', lastError: null,
      getURL: p => 'https://ext.local/' + p,
      onMessage: { addListener() {} },
      sendMessage(msg, cb) {
        window.__log.push(JSON.parse(JSON.stringify(msg)));
        setTimeout(() => {
          if (msg.type === 'state') return cb({ ok: true, data: window.__state() });
          if (msg.type === 'sweepListings') {
            return cb({ ok: true, data: { read: msg.items.length, saved: msg.items.length, complete: msg.complete, at: Date.now(),
              changes: [{ id: '15000000000', kind: 'new', section: 'E100', title: 'KF Egnatia vs FC Midtjylland', tickets: 4, price: 50, currency: 'USD' },
                        { id: '15000000001', kind: 'price', from: 55, to: 50, currency: 'USD', section: 'E101' }],
              unseen: [{ id: '13992748289', section: 'E105' }], qtyOffers: [], sold: [] } });
          }
          if (msg.type === 'setListingBuy') {
            (window.__buys = window.__buys || {})[msg.id] = { price: msg.price, currency: msg.currency };
            cb({ ok: true, data: null });
            setTimeout(() => window.__changed.forEach(f => f({ mirror: {} }, 'local')), 20);
            return;
          }
          if (msg.type === 'saveListings') {
            for (const it of msg.items) window.__saved[it.id] = Object.assign({}, it, { seenAt: Date.now() });
            cb({ ok: true, data: { read: msg.items.length, saved: msg.items.length } });
            /* the service worker's write changes storage: the sidebar refreshes */
            setTimeout(() => window.__changed.forEach(f => f({ mirror: {} }, 'local')), 20);
            return;
          }
          cb({ ok: true, data: null });
        }, 15);
      }
    },
    storage: { local: area, session: area, onChanged: { addListener: f => window.__changed.push(f) } }
  };
})();`;

let failures = 0;
function expect(cond, label, extra) {
  console.log(cond ? '  ✓' : '  ✗', label, cond || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600));
  if (!cond) failures++;
}
async function until(fn, ms) {
  const end = Date.now() + (ms || 6000);
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* not yet */ }
    await sleep(100);
  }
  return null;
}

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'st-browser-'));
  const proc = spawn(findChrome(), ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', '--lang=en-US'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  const tab = { errors: [] };
  b.on(msg => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      tab.errors.push((d.exception && d.exception.description) || d.text);
      return;
    }
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    const u = new URL(request.url);
    let body = null, type = 'text/plain';
    if (u.host === 'my.viagogo.com') { body = PAGE; type = 'text/html; charset=utf-8'; }
    else {
      const f = path.join(EXT, decodeURIComponent(u.pathname));
      if (f.startsWith(EXT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        body = fs.readFileSync(f);
        type = f.endsWith('.css') ? 'text/css' : f.endsWith('.png') ? 'image/png' : 'text/plain';
      }
    }
    if (body === null) { b.cmd('Fetch.fulfillRequest', { requestId, responseCode: 404, body: '' }, sessionId).catch(() => {}); return; }
    b.cmd('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: type }], body: Buffer.from(body).toString('base64') }, sessionId).catch(() => {});
  });
  await b.cmd('Page.enable', {}, sessionId);
  await b.cmd('Runtime.enable', {}, sessionId);
  await b.cmd('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: STUB }, sessionId);
  await b.cmd('Fetch.enable', { patterns: [{ urlPattern: 'https://my.viagogo.com/*' }, { urlPattern: 'https://ext.local/*' }] }, sessionId);
  tab.eval = async expression => {
    const r = await b.cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  };
  tab.go = async url => {
    await b.cmd('Page.navigate', { url }, sessionId);
    await until(() => tab.eval(`document.readyState === 'complete' && location.href === ${JSON.stringify(url)}`), 8000);
  };
  tab.shot = async name => {
    const r = await b.cmd('Page.captureScreenshot', { format: 'png' }, sessionId);
    const f = path.join(SHOTS, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return f;
  };
  return tab;
}

const FILES = ['core/util.js', 'core/rules.js', 'core/registry.js', 'core/settings.js', 'core/profit.js', 'core/help.js',
  'sites/ebileta.js', 'sites/efinity.js', 'sites/posttick.js', 'core/viagogo.js', 'core/market.js', 'core/team.js', 'ui/components.js', 'content/shell.js',
  'content/sites/viagogo.js'];

const READ = `window.__t = {
  root() { const h = document.getElementById('sk-host-viagogo'); return h && h.shadowRoot; },
  lines() { return [...document.querySelectorAll('[data-sk-line]')].map(h => { const l = h.shadowRoot.querySelector('.l'); return l ? l.textContent.replace(/\\s+/g, ' ').trim() : ''; }); },
  text(sel) { const r = this.root(); const n = r && r.querySelector(sel); return n ? n.innerText : null; },
  form() {
    const r = this.root();
    if (!r || !r.querySelector('.vg-add select')) return null;
    const field = label => { const l = [...r.querySelectorAll('.vg-add label')].find(x => x.firstChild && x.firstChild.textContent.trim() === label); return l ? l.querySelector('input, select') : null; };
    return { event: r.querySelector('.vg-add select').value, sector: r.querySelector('.vg-add .picker input').value, qty: field('Tickets').value, listing: field('Listing ID').value };
  }
}; true`;

(async () => {
  const t0 = Date.now();
  const b = await launch();
  try {
    const t = await openTab(b);
    console.log('\n== my.viagogo.com/listings with a real card');
    await t.go('https://my.viagogo.com/listings/?search=belar&activeTab=ACTIVE%7CPENDING%7CDEACTIVATED%7CEXPIRED');
    await t.eval(`(() => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://ext.local/content/page.css'; document.head.append(l); return true; })()`);
    for (const f of FILES) await t.eval(fs.readFileSync(path.join(EXT, f), 'utf8') + '\n;true');
    await t.eval(READ);

    const cards = await until(() => t.eval(`(() => { const c = SK.viagogo.readListingCards(document); return c.length === 2 ? c.map(x => x.data) : null; })()`), 6000);
    const want = { id: '13988951528', status: 'Active', title: 'Albania vs Belarus - Nations League',
      venue: 'Air Albania Stadium (Arena Kombëtare), Tirana, null, Albania', when: 'Sat, 26 Sep • 8:45 PM', currency: 'USD',
      price: 84, payout: 453.6, tickets: 6, section: 'E106', row: 'ALB', performance: 'Not competitive', vgEventId: '161613516' };
    expect(!!cards && JSON.stringify(cards[0]) === JSON.stringify(want), 'every field of the real card is read', cards && cards[0]);
    expect(!!cards && cards[1].id === '13992748289' && cards[1].tickets === 4 && cards[1].payout === 302.4 && cards[1].section === 'E105',
      'the second card is read separately', cards && cards[1]);

    const saved = await until(() => t.eval(`(() => { const m = __log.find(x => x.type === 'saveListings'); return m ? m.items.map(i => i.id) : null; })()`), 5000);
    expect(!!saved && saved.join(',') === '13988951528,13992748289', 'both listings are sent to be saved, once the cards appear', saved);

    const lines = await until(() => t.eval(`(() => { const l = __t.lines(); return l.length === 2 && l[0].includes('13,812') ? l : null; })()`), 5000);
    const box = () => t.eval(`(() => {
      const h = document.querySelector('[data-sk-line]').shadowRoot;
      const txt = n => (n ? n.innerText.replace(/\\s+/g, ' ').trim() : null);
      return {
        rows: [...h.querySelectorAll('.l > .r')].map(r => r.className),
        info: txt(h.querySelector('.split > .col:not(.money) .ln')),
        moved: txt(h.querySelectorAll('.split > .col:not(.money) .ln')[1]),
        old: [...h.querySelectorAll('.chg.old')].map(txt),
        table: [...h.querySelectorAll('.money tr')].map(r => [...r.children].map(c => c.innerText.trim()).filter(Boolean).join(' | ')),
        team: txt(h.querySelectorAll('.l > .r')[1]), acts: txt(h.querySelector('.l > .r.acts')),
        all: txt(h.querySelector('.l'))
      };
    })()`);
    const b1 = await box();
    expect(/^#7 E106 OK x1\.6$/.test(b1.info), 'on the left: the request, its status and the win rate', b1.info);
    expect(b1.table.join(' / ').replace(/^EACH \| TOTAL/, 'each | total') === 'each | total (6) / Buy | 4,000 L | 24,000 L / You get | 6,302 L | 37,812 L / Profit | +2,302 L | +13,812 L | x1.6',
      'on the right: buy, what viagogo pays and the profit, each and for all 6, with the win rate too', b1.table);
    expect(!/\$52/.test(b1.all), 'viagogo\'s suggested price is not repeated on the card', b1.all);
    expect(b1.rows.join(',') === 'r split,r,r acts' && /^Team Ana Krasniqi \$40\.00$/i.test(b1.team) && /^Delete request Bought$/.test(b1.acts),
      'then the team and the actions, each across the box', b1);
    /* viagogo showed $80 four days ago, 8 tickets until a minute ago: both said, the old one faded */
    await t.eval(`(() => { const now = Date.now(); window.__hist = { '13988951528': [
      { at: now - 5 * 86400000, tickets: 8, price: 80, status: 'Active' },
      { at: now - 4 * 86400000, tickets: 8, price: 84, status: 'Active' },
      { at: now - 60000, tickets: 6, price: 84, status: 'Active' }] }; __changed.forEach(f => f({ mirror: {} }, 'local')); return true; })()`);
    const b2 = await until(async () => { const b = await box(); return b.moved ? b : null; }, 4000);
    expect(!!b2 && /^Changed Tickets 8 → 6 .*Price \$80\.00 → \$84\.00/i.test(b2.moved), 'under the request: what changed, tickets 8 → 6 and price $80 → $84', b2 && b2.moved);
    expect(!!b2 && b2.old.length === 1 && /^Price/.test(b2.old[0]), 'the price change, four days old, is faded; the new one is not', b2 && b2.old);
    expect(!!lines && /Not in Seat Tracker yet/.test(lines[1]) && /Add as request/.test(lines[1]), 'the other card offers "Add as request"', lines && lines[1]);
    expect(!!lines && /Team ?Ana Krasniqi ?\$40\.00/.test(lines[0]), 'the card itself says what Ana asks for the same section', lines && lines[0]);
    const under = await t.eval(`(() => { const h = [...document.querySelectorAll('[data-sk-line]')][0]; const m = h.shadowRoot.querySelector('.mate'); return m && m.className; })()`);
    expect(under === 'mate under', 'and marks her as under your price', under);

    const tiles = await until(() => t.eval(`__t.text('.vg-tiles')`), 3000);
    expect(!!tiles && tiles.includes('+13,812 L') && tiles.includes('x1.6') && /^0\s*differ from their request/m.test(tiles) && /^0\s*below their break-even/m.test(tiles),
      'sidebar totals: +13,812 L (x1.6), none differ from their request, none priced below break-even', tiles);
    const body = await t.eval(`__t.text('.sk-slot')`);
    expect(/LISTINGS · 1/i.test(body) && /#7/.test(body) && /NO REQUEST YET · 1/i.test(body) && body.includes('13992748289') && !/viagogo suggests/.test(body),
      'sidebar lists the linked listing and the one with no request yet, and no viagogo suggested price', body);
    expect(!/REQUESTS/.test(body), 'the list is about listings, not requests', body.slice(0, 200));
    /* $84 is above its break-even, so nothing opens the card by itself: open it */
    await t.eval(`(() => { const c = __t.root().querySelector('.lcard'); if (c && !c.classList.contains('open')) c.querySelector('.top').click(); return true; })()`);
    const cmp = await until(() => t.eval(`(() => { const g = __t.root().querySelector('.lcard.open .lcmp'); return g ? g.innerText : null; })()`), 3000);
    expect(!!cmp && /Tickets\s+6\s+6/.test(cmp) && /Section\s+E106\s+E106/.test(cmp), 'the open card puts the listing next to request #7', cmp);
    /* the team is there, but folded away under the listing */
    const teamSum = await t.eval(`(() => { const d = __t.root().querySelector('.lcard details.lteam'); return d ? { open: d.open, text: d.querySelector('summary').innerText } : null; })()`);
    expect(!!teamSum && teamSum.open === false && /Team · 1 · 1 under you/i.test(teamSum.text), 'the team block starts folded, and its title says Ana is under you', teamSum);
    await t.eval(`(() => { const d = __t.root().querySelector('.lcard details.lteam'); d.open = true; return true; })()`);
    const teamText = await t.eval(`__t.root().querySelector('.lcard details.lteam').innerText`);
    expect(/Ana Krasniqi/.test(teamText) && /\$40\.00/.test(teamText), 'opened, it says what Ana lists the same section for', teamText);
    expect(/Ana Krasniqi is under you here \(\$40\.00 vs your \$84\.00\)/.test(teamText), 'and warns that she is under you', teamText);

    /* the listing has 6 tickets, the request now asks for 7: said on the card and in the sidebar, never as "sold" */
    await t.eval(`(() => { window.__reqQty = 7; __changed.forEach(f => f({ mirror: {} }, 'local')); return true; })()`);
    const diff = await until(() => t.eval(`(() => { const p = __t.root().querySelector('.lcard .dpill.d-warn'); return p ? p.innerText : null; })()`), 4000);
    expect(diff === '6 vs 7 tickets', 'the card header says the listing has 6, the request 7', diff);
    const diffBody = await t.eval(`__t.root().querySelector('.lcard .ldiff').innerText`);
    expect(/1 ticket fewer than request #7/.test(diffBody) && /Set request to 6/.test(diffBody) && !/sold/i.test(diffBody), 'and explains it, with a button to match the request', diffBody);
    const onPage = await until(() => t.eval(`(() => { const h = document.querySelector('[data-sk-line]'); const d = h && h.shadowRoot.querySelector('.diff'); return d ? d.textContent : null; })()`), 3000);
    expect(onPage === '6 vs 7 tickets', 'viagogo\'s own card says it too', onPage);
    const tiles2 = await t.eval(`__t.text('.vg-tiles')`);
    expect(/^1\s*differs from its request/m.test(tiles2), 'and the totals count it', tiles2);
    console.log('   screenshot:', await t.shot('viagogo-listings-diff.png'));
    await t.eval(`(() => { const b = [...__t.root().querySelectorAll('.ldiff button')].find(x => /Set request to 6/.test(x.textContent)); b.click(); return true; })()`);
    const upd = await until(() => t.eval(`(() => { const m = __log.find(x => x.type === 'updateRequest'); return m ? m : null; })()`), 3000);
    expect(!!upd && upd.id === 'r7' && upd.changes.qty === 6, 'Set request to 6 changes only the request', upd);
    await t.eval(`(() => { window.__reqQty = 6; __changed.forEach(f => f({ mirror: {} }, 'local')); return true; })()`);

    /* an event scan handed over from the event page: each listing learns where it stands */
    const box0 = await t.eval(`(() => { const b = __t.root().querySelector('.vg-compares'); return b && b.innerText; })()`);
    expect(!!box0 && /Event scans/i.test(box0) && /Scan an event page while signed in/.test(box0), 'the sidebar has a place for event scans, and says how one arrives', box0);
    await t.eval(`(() => {
      const now = Date.now();
      const r = (id, price, mine, extra) => Object.assign({ id: mine ? id : '', i: 0, sprite: '1844501', section: 'E106', row: '', price, currency: 'USD', qtyMin: 1, qtyMax: 2, features: [], mine, sold: false }, extra);
      window.__compares = [{ v: 1, eventId: '161613516', name: 'Albania vs Belarus', start: '', at: now - 5 * 60000, expiresAt: now + 25 * 60000, complete: true,
        sections: [{ key: '1844501', label: 'E106', rows: [r('13988951528', 67, true), r('', 55, false), r('', 63, false), r('', 80, false)] }] }];
      __changed.forEach(f => f({ compareAt: {} }, 'local'));
      return true;
    })()`);
    const market = await until(() => t.eval(`(() => { const h = document.querySelector('[data-sk-line]'); const l = h && [...h.shadowRoot.querySelectorAll('.ln')].find(x => /Market/i.test(x.innerText)); return l ? l.innerText.replace(/\\s+/g, ' ').trim() : null; })()`), 4000);
    expect(!!market && /^Market E106 · 3rd of 4 · \$12\.00 above the cheapest scan 5 min ago$/i.test(market), 'the card says: E106, 3rd of 4, $12 above the cheapest, from a scan 5 min ago', market);
    const box1 = await t.eval(`__t.root().querySelector('.vg-compares').innerText`);
    expect(/Albania vs Belarus · 1 yours · scan 5 min ago · until/.test(box1), 'and the sidebar lists that scan with when it expires', box1);
    await t.eval(`(() => { window.__compares[0].expiresAt = Date.now() - 1; __changed.forEach(f => f({ compareAt: {} }, 'local')); return true; })()`);
    const expiredGone = await until(() => t.eval(`(() => { const h = document.querySelector('[data-sk-line]'); return h && ![...h.shadowRoot.querySelectorAll('.ln')].some(x => /Market/i.test(x.innerText)); })()`), 4000);
    expect(expiredGone === true, 'an expired scan is no longer shown', expiredGone);
    await t.eval(`(() => { window.__compares = []; return true; })()`);

    /* Delete request: it asks first, and only the request goes */
    await t.eval(`(() => { window.__asked = null; window.confirm = m => { window.__asked = m; return false; }; return true; })()`);
    await t.eval(`(() => { const b = [...__t.root().querySelectorAll('button')].find(x => x.textContent === 'Delete request'); b.click(); return true; })()`);
    const asked = await t.eval(`window.__asked`);
    expect(/#7 \(E106\)/.test(asked || '') && /13988951528 stays/.test(asked || ''),
      'Delete request asks first, and says the viagogo listing stays as it is', asked);
    expect(await t.eval(`!__log.some(x => x.type === 'deleteRequest')`), 'saying no deletes nothing');
    await t.eval(`(() => { window.confirm = () => true; const h = document.querySelector('[data-sk-line]'); const b = [...h.shadowRoot.querySelectorAll('button')].find(x => x.textContent === 'Delete request'); b.click(); return true; })()`);
    const deleted = await until(() => t.eval(`(() => { const m = __log.find(x => x.type === 'deleteRequest'); return m ? m.id : null; })()`), 3000);
    expect(deleted === 'r7', 'the same button on viagogo\'s own card deletes request #7 — and nothing on viagogo', deleted);
    /* the calculator: try $100 and see what it would earn, changing nothing */
    const opened = await t.eval(`(() => { const r = __t.root(); const b = [...r.querySelectorAll('button')].find(x => x.textContent === 'Calculator'); if (!b) return 'no button'; b.click(); return !!r.querySelector('.calc'); })()`);
    expect(opened === true, 'each listing has a Calculator', opened);
    await t.eval(`(() => { const i = __t.root().querySelector('.calc input'); i.value = '100'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const calc = await until(() => t.eval(`(() => { const c = __t.root().querySelector('.calc-out'); return c && /21,014/.test(c.innerText) ? c.innerText : null; })()`), 3000);
    expect(!!calc && /\$90\.00 each · \$540\.00 for 6/.test(calc) && /\+21,014 L in all \(x1\.9\)/.test(calc) && /\+7,202 L more/.test(calc),
      'at $100 it shows viagogo paying $90 each, +21,014 L in all (x1.9), 7,202 L more than the $84 set now', calc);
    const low = await t.eval(`(() => { const i = __t.root().querySelector('.calc input'); i.value = '40'; i.dispatchEvent(new Event('input', { bubbles: true })); const c = __t.root().querySelector('.calc-out'); return c.innerText; })()`);
    expect(/−/.test(low) && /Below your break-even/.test(low), 'and warns below the break-even', low.slice(0, 200));
    /* the sidebar's own calculator, with no listing behind it */
    const openCalc = await t.eval(`(() => { const r = __t.root(); const d = [...r.querySelectorAll('details.section')].find(x => /Price calculator/.test(x.textContent)); if (!d) return 'no section'; d.open = true; d.dispatchEvent(new Event('toggle')); return !!r.querySelector('.pcalc'); })()`);
    expect(openCalc === true, 'the sidebar has a price calculator of its own', openCalc);
    const typed = await t.eval(`(() => {
      const r = __t.root().querySelector('.pcalc');
      const rows = [...r.querySelectorAll('.pcalc-row')];
      const set = (row, value, cur) => {
        const i = row.querySelector('input'); i.value = String(value); i.dispatchEvent(new Event('input', { bubbles: true }));
        if (cur) { const s = row.querySelector('select'); s.value = cur; s.dispatchEvent(new Event('change', { bubbles: true })); }
      };
      set(rows[0], 4000, 'ALL');            /* buy */
      set(rows[1], 84, 'USD');              /* ask */
      const nums = rows[2].querySelectorAll('input');
      nums[0].value = '6'; nums[0].dispatchEvent(new Event('input', { bubbles: true }));
      nums[1].value = '90'; nums[1].dispatchEvent(new Event('input', { bubbles: true }));
      return r.querySelector('.calc-out').innerText;
    })()`);
    expect(/\$75\.60 each · \$453\.60 for 6/.test(typed) && /\+13,812 L in all \(x1\.6\)/.test(typed) && /\$53\.32/.test(typed),
      'buying at 4,000 L and asking $84 for 6 gives the same figures as the real listing', typed);
    /* the prices to aim at appear as soon as a buy price is in, and fill the ask */
    const chips = await t.eval(`[...__t.root().querySelectorAll('.pcalc .calc-targets button')].map(b => b.textContent).join(' | ')`);
    expect(/×1\.5 \$79\.98/.test(chips) && /×2 \$106\.64/.test(chips) && /×2\.5 \$133\.30/.test(chips) && /×3 \$159\.95/.test(chips),
      'the calculator offers ×1.5 ×2 ×2.5 ×3 prices for a 4,000 L ticket', chips);
    const picked = await t.eval(`(() => {
      const r = __t.root().querySelector('.pcalc');
      [...r.querySelectorAll('.calc-targets button')].find(b => /×2 /.test(b.textContent)).click();
      return { ask: r.querySelectorAll('.pcalc-row input')[1].value, out: r.querySelector('.calc-out').innerText };
    })()`);
    expect(picked.ask === '106.64' && /\(x2\.0\)/.test(picked.out), 'pressing ×2 asks that price, and the profit comes out at x2', picked);
    const onCard = await t.eval(`[...__t.root().querySelectorAll('.req .calc .calc-targets button')].map(b => b.textContent).join(' | ')`);
    expect(/×1\.5/.test(onCard) && /×3/.test(onCard), 'a listing card has the same references', onCard);

    const mixed = await t.eval(`(() => {
      const r = __t.root().querySelector('.pcalc');
      const row = r.querySelectorAll('.pcalc-row')[0];
      const s = row.querySelector('select'); s.value = 'EUR'; s.dispatchEvent(new Event('change', { bubbles: true }));
      const i = row.querySelector('input'); i.value = '35'; i.dispatchEvent(new Event('input', { bubbles: true }));
      return r.querySelector('.calc-out').innerText;
    })()`);
    expect(/3,413 L each/.test(mixed) && /\+/.test(mixed), 'the buy price can be in another currency than the ask', mixed);
    console.log('   screenshot:', await t.shot('viagogo-listings.png'));

    /* a buy price typed on a card with no request: the money and the win rate show on it */
    const noReq = await t.eval(`(() => { const r = [...document.querySelectorAll('[data-sk-line]')][1].shadowRoot;
      return { box: !!r.querySelector('.buy input'), note: r.querySelector('.money') ? r.querySelector('.money').innerText : '' }; })()`);
    expect(noReq.box && /no buy price yet/.test(noReq.note), 'a card with no request has a buy price box', noReq);
    await t.eval(`(() => { const i = [...document.querySelectorAll('[data-sk-line]')][1].shadowRoot.querySelector('.buy input');
      i.focus(); i.value = '3000'; i.dispatchEvent(new Event('change', { bubbles: true })); i.blur(); return true; })()`);
    const priced = await until(() => t.eval(`(() => { const r = [...document.querySelectorAll('[data-sk-line]')][1].shadowRoot;
      const m = r.querySelector('.money'); return m && /Profit/.test(m.innerText) ? { money: m.innerText, rate: (r.querySelector('.rate') || {}).textContent || '',
      sent: __log.filter(x => x.type === 'setListingBuy') } : null; })()`), 4000);
    expect(!!priced && priced.sent.length === 1 && priced.sent[0].id === '13992748289' && priced.sent[0].price === '3000' && /x\d/.test(priced.rate),
      'typing 3,000 L saves it on the listing, and the card shows the profit and the win rate', priced);
    console.log('   screenshot:', await t.shot('viagogo-listings-buy.png'));
    /* back to no buy price, as the checks below expect */
    await t.eval(`(() => { window.__buys = {}; window.__changed.forEach(f => f({ mirror: {} }, 'local')); return true; })()`);
    await until(() => t.eval(`/no buy price yet/.test([...document.querySelectorAll('[data-sk-line]')][1].shadowRoot.querySelector('.money').innerText) || null`), 4000);

    await t.eval(`(() => { const h = [...document.querySelectorAll('[data-sk-line]')][1]; [...h.shadowRoot.querySelectorAll('button')].find(b => /Add as request/.test(b.textContent)).click(); return true; })()`);
    const form = await until(() => t.eval(`__t.form()`), 4000);
    expect(!!form && form.event === 'ebileta:2153' && form.sector === 'E105' && form.qty === '4' && form.listing === '13992748289',
      '"Add as request" fills the form: event matched by date and teams, E105, 4 tickets, the listing ID', form);
    console.log('   screenshot:', await t.shot('viagogo-listings-add.png'));

    console.log('\n== Scan all listings: viagogo\'s own JSON, no page turning');
    const scanBtn = await until(() => t.eval(`(() => { const b = [...__t.root().querySelectorAll('button')].find(x => x.textContent === 'Scan all listings'); return !!b; })()`), 4000);
    expect(!!scanBtn, 'the sidebar offers "Scan all listings"');
    await t.eval(`(() => { [...__t.root().querySelectorAll('button')].find(x => x.textContent === 'Scan all listings').click(); return true; })()`);
    const swept = await until(() => t.eval(`(() => { const m = __log.find(x => x.type === 'sweepListings'); return m ? { n: m.items.length, complete: m.complete, partial: m.partial, first: m.items[0], recs: m.items.filter(i => 'recommended' in i).length } : null; })()`), 15000);
    const lists = await t.eval(`__fetches.filter(f => f.path === '/listings/getListings')`);
    const recs = await t.eval(`__fetches.filter(f => f.path === '/recommendedListing/isListingRecommended').map(f => f.id)`);
    expect(lists.length === 2 && lists[0].page === '1' && lists[1].page === '2' && lists.every(f => f.size === '100' && f.filters === 'STATUS:ACTIVE|PENDING|DEACTIVATED|EXPIRED' && f.creds === 'include'),
      'two requests of 100 read all 130 listings, every status, with the cookies — and stop once NumFound is reached', lists);
    expect(recs.length === 0, 'viagogo\'s recommended price is never asked for', recs);
    expect(!!swept && swept.n === 130 && swept.complete === true && swept.partial === true, 'all 130 are saved as one complete read', swept && { n: swept.n, complete: swept.complete, partial: swept.partial });
    expect(!!swept && swept.first.id === '15000000000' && swept.first.price === 50 && swept.first.payout === 180 && swept.first.tickets === 4 && swept.first.section === 'E100' && swept.first.vgEventId === '161959641' && swept.recs === 0,
      'each read as its card would be: price, payout for the tickets left, section, event — and no recommended price', swept && swept.first);
    const report = await until(() => t.eval(`(() => { const c = __t.root().querySelector('.track-card.sweep'); return c && /All listings read/.test(c.innerText) ? c.innerText : null; })()`), 4000);
    expect(!!report && /130 listings read in 2 requests/.test(report) && !/recommended/i.test(report) && /added/i.test(report) && /no longer on viagogo in any status: E105/.test(report),
      'the sidebar reports what changed, and what is no longer on viagogo at all', report);

    console.log('\n== every listing of yours, under the search bar');
    const panelNow = () => t.eval(`(() => {
      const h = document.querySelector('[data-sk-panel]');
      if (!h) return null;
      const r = h.shadowRoot;
      return { after: h.previousElementSibling ? h.previousElementSibling.className : '', head: r.querySelector('.hd b')?.textContent,
        groups: [...r.querySelectorAll('.evh b')].map(b => b.textContent), items: [...r.querySelectorAll('.it')].map(b => b.textContent),
        on: [...r.querySelectorAll('.it.on')].map(b => b.textContent), now: r.querySelector('.now')?.textContent || '' };
    })()`);
    const panel = await until(async () => { const p = await panelNow(); return p && p.items.length === 2 ? p : null; }, 4000);
    expect(!!panel && panel.after === 'sbar-row', 'the box sits right under the search bar', panel);
    expect(!!panel && panel.head === 'My listings · 2' && panel.groups.includes('[1] Shqiperi - Bjellorusi') && panel.groups.includes('Albania vs Belarus - Nations League'),
      'every listing of yours, grouped by event — the tracked event by its Seat Tracker name', panel);
    expect(!!panel && panel.items.includes('E106|6|$84.00|x1.6|OK 36') && panel.items.includes('E105|4|$84.00|x—|no request'),
      'one short line each: section | tickets | price | win rate | status of its request with its options', panel && panel.items);
    const okClass = await t.eval(`[...document.querySelector('[data-sk-panel]').shadowRoot.querySelectorAll('.it .st')].map(x => x.className).join(',')`);
    expect(/st st-OK/.test(okClass) && /st st-idle/.test(okClass), 'the status is coloured: OK green, no request grey', okClass);
    /* the box's own search: by section, keeping its focus while typing */
    const boxSearch = await t.eval(`(() => {
      const r = document.querySelector('[data-sk-panel]').shadowRoot;
      const i = r.querySelector('.srch input');
      i.focus();
      i.value = 'e10'; i.dispatchEvent(new Event('input', { bubbles: true }));
      const both = [...r.querySelectorAll('.it')].length;
      i.value = 'e105'; i.dispatchEvent(new Event('input', { bubbles: true }));
      const items = [...r.querySelectorAll('.it')].map(b => b.textContent);
      return { both, items, found: r.querySelector('.srch .m').textContent, focused: r.activeElement === r.querySelector('.srch input'), groups: r.querySelectorAll('.evh').length };
    })()`);
    expect(boxSearch.both === 2 && boxSearch.items.length === 1 && boxSearch.items[0].startsWith('E105|') && boxSearch.groups === 1 && boxSearch.found === '1 match "e105"',
      'searching a section narrows the box: "e10" keeps E105 and E106, "e105" only E105 and its event', boxSearch);
    expect(boxSearch.focused, 'and the search field keeps its focus while the box redraws', boxSearch);
    const noMatch = await t.eval(`(() => {
      const r = document.querySelector('[data-sk-panel]').shadowRoot; const i = r.querySelector('.srch input');
      i.value = 'W999'; i.dispatchEvent(new Event('input', { bubbles: true }));
      const text = r.querySelector('.p').textContent;
      i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
      return { text, back: r.querySelectorAll('.it').length };
    })()`);
    expect(/No listing of yours in a section matching "W999"/.test(noMatch.text) && noMatch.back === 2, 'no match says so, and clearing brings everything back', noMatch);
    console.log('   screenshot:', await t.shot('viagogo-listings-panel.png'));
    await t.eval(`(() => { [...document.querySelector('[data-sk-panel]').shadowRoot.querySelectorAll('.it')].find(b => b.textContent.startsWith('E106')).click(); return true; })()`);
    const searchedUrl = await until(() => t.eval(`document.readyState === 'complete' && /[?&]search=13988951528(&|$)/.test(location.search) ? location.href : null`), 8000);
    expect(!!searchedUrl && /activeTab=ACTIVE%7CPENDING%7CDEACTIVATED%7CEXPIRED/.test(searchedUrl), 'clicking a line searches viagogo for that listing number, in every tab', searchedUrl);
    for (const f of FILES) await t.eval(fs.readFileSync(path.join(EXT, f), 'utf8') + '\n;true');
    await t.eval(READ);
    const after = await until(async () => { const p = await panelNow(); return p && p.now && p.on.length ? p : null; }, 8000);
    expect(!!after && /Showing listing 13988951528/.test(after.now) && after.on.length === 1 && after.on[0].startsWith('E106'),
      'the searched listing is marked, with a way to clear the search', after);
    expect(!!after && /\|OK 36$/.test(after.on[0]), 'and its status and options still read on the marked line', after && after.on);
    await until(() => t.eval(`document.querySelectorAll('[data-sk-line]').length === 2`), 6000);

    expect(t.errors.length === 0, 'no errors on the page', t.errors);

    console.log('\n== the extension is reloaded while the tab stays open');
    await t.eval(`(() => {
      chrome.runtime.id = undefined;
      chrome.runtime.getURL = () => { throw new Error('Extension context invalidated.'); };
      chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.'); };
      document.getElementById('list').append(document.createElement('div'));
      return true;
    })()`);
    await sleep(2500);
    const gone = await t.eval(`!document.getElementById('sk-host-viagogo') && document.querySelectorAll('[data-sk-line], [data-sk-panel]').length === 0`);
    expect(gone, 'the old script removes its sidebar, card lines and the listings box');
    await t.eval(`(() => { document.getElementById('list').append(document.createElement('p')); history.pushState({}, '', '/listings/?page=2'); return true; })()`);
    await sleep(2000);
    expect(t.errors.length === 0, 'and never throws "Extension context invalidated", even as the page keeps changing', t.errors);
  } catch (e) {
    console.log('  ✗ crashed:', e.message);
    failures++;
  } finally { b.close(); }
  console.log(`\n${failures ? '✗ ' + failures + ' FAILED' : '✓ all listings-page checks passed'} · ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(failures ? 1 : 0);
})();
