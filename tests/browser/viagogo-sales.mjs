/* Browser test: my.viagogo.com/sales.
 *
 * The sales sidebar against a stand-in of viagogo's own /sales/getSales
 * endpoint (shaped as captured on 2026-10-04, pages counted from 1, buyer
 * fields included), with a stand-in for the service worker.
 * Checks the full scan, that no buyer data leaves the page, the grouping by
 * event and section, the profit, a typed buy price, and that "Scan new
 * sales" stops at what is already saved.
 *
 *   node tests/browser/viagogo-sales.mjs
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

/* 23 sales, newest first: Albania (N105 ×2, S102 ×1, unpaid ones among them) and England (L34 and 20 more) */
let SALES = [];
function makeSales() {
  const out = [];
  const day = d => `2026-${d}T12:00:00`;
  out.push({ SaleId: 656096343, ListingId: 14123898111, EventId: 161613551, EventDescription: 'Albania vs San Marino - Nations League', EventDate: '2026-10-06T20:45:00', Section: 'N105', Quantity: 3, TotalPayout: 86.4, SaleDate: day('10-04'), Status: 'Get Paid' });
  out.push({ SaleId: 656024675, ListingId: 14123898111, EventId: 161613551, EventDescription: 'Albania vs San Marino - Nations League', EventDate: '2026-10-06T20:45:00', Section: 'N105', Quantity: 3, TotalPayout: 75.6, SaleDate: day('10-03'), Status: 'Complete' });
  out.push({ SaleId: 655666275, ListingId: 14123898198, EventId: 161613551, EventDescription: 'Albania vs San Marino - Nations League', EventDate: '2026-10-06T20:45:00', Section: 'S102', Quantity: 4, TotalPayout: 90, SaleDate: day('09-30'), Status: 'Complete' });
  for (let i = 0; i < 20; i++) {
    out.push({ SaleId: 554045000 - i, ListingId: 8742195139, EventId: 157090940, EventDescription: 'England vs France', Section: i ? 'L' + (30 + (i % 3)) : 'L34 • Row 16',
      Quantity: 2, TotalPayout: 100 + i, SaleDate: `2025-02-${String(28 - i).padStart(2, '0')}T10:00:00`, Status: 'Complete' });
  }
  return out.map(s => Object.assign(s, { BuyerEmail: 'buyer@private.example', BuyerFirstName: 'Pat', BuyerPhoneNumber: '+44 7000 000000' }));
}
SALES = makeSales();
/* pages counted from 1; page 0 answers like page 1, as some endpoints do */
function salesApi(u) {
  const p = Math.max(1, Number(u.searchParams.get('page')) || 1);
  const size = Number(u.searchParams.get('pageSize')) || 5;
  return { NumFound: SALES.length, Sale: SALES.slice((p - 1) * size, p * size) };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>viagogo - Buy & Sell Concert, Sport & Theatre Tickets</title></head>
<body><div id="app"><div class="sc-4esrrg-2"><div class="sc-4esrrg-4">Sales</div><p>(the cards would be here)</p></div></div></body></html>`;

/* the service worker: keeps what saveSales sends, and works out money the way background.js does */
const STUB = `(() => {
  window.__log = [];
  window.__saved = JSON.parse(sessionStorage.getItem('__saved') || '{}');
  window.__changed = [];
  const store = {};
  const area = {
    get: async k => { const out = {}; for (const key of (k ? [].concat(k) : Object.keys(store))) if (key in store) out[key] = JSON.parse(JSON.stringify(store[key])); return out; },
    set: async o => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
    remove: async () => {}
  };
  const keep = () => sessionStorage.setItem('__saved', JSON.stringify(window.__saved));
  window.__state = () => {
    const rates = { USD: 100 };
    const sales = Object.values(window.__saved).map(s => {
      const buy = s.buyPrice ? { amount: s.buyPrice, currency: s.buyCurrency, source: 'typed on the section' }
        : s.section === 'N105' ? { amount: 2000, currency: 'ALL', source: 'typed on the listing' } : null;
      return Object.assign({}, s, { buy, money: Object.assign(SK.sales.saleMoney(s, buy, rates), { rateDay: '2026-10-04' }) });
    });
    return { auth: { signedIn: true, email: 'you@example.com' }, settings: SK.settings.normalize({}),
      sites: SK.siteList().map(x => ({ id: x.id, label: x.label, can: x.can, pages: x.pages, badges: x.badges, pushSelectors: x.pushSelectors })),
      events: [], requests: [], scans: {}, catalog: [], devices: [], listings: [], compares: [], sales,
      team: [{ userId: 'me', name: 'Sam Rivers', me: true }], teamPrices: [],
      fx: { day: '2026-10-04', rates, fetched: rates, manual: [] }, snoozeUntil: 0, meta: {} };
  };
  const changed = () => setTimeout(() => window.__changed.forEach(f => f({ mirror: {} }, 'local')), 20);
  window.chrome = {
    runtime: {
      id: 'seat-tracker-test', lastError: null,
      getURL: p => 'https://ext.local/' + p,
      onMessage: { addListener() {} },
      sendMessage(msg, cb) {
        window.__log.push(JSON.parse(JSON.stringify(msg)));
        setTimeout(() => {
          if (msg.type === 'state') return cb({ ok: true, data: window.__state() });
          if (msg.type === 'saveSales') {
            let saved = 0;
            for (const it of msg.items) {
              const was = window.__saved[it.id];
              if (was && was.status === it.status) continue;
              window.__saved[it.id] = Object.assign({ buyPrice: null, buyCurrency: 'ALL' }, was || {}, it);
              saved++;
            }
            keep(); changed();
            return cb({ ok: true, data: { read: msg.items.length, saved } });
          }
          if (msg.type === 'setSalesBuy') {
            for (const id of msg.ids) Object.assign(window.__saved[id], { buyPrice: Number(msg.price), buyCurrency: msg.currency });
            keep(); changed();
            return cb({ ok: true, data: msg.ids.length });
          }
          cb({ ok: true, data: null });
        }, 10);
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
  const tab = { errors: [], api: [] };
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
    if (u.host === 'my.viagogo.com' && u.pathname === '/sales/getSales') { body = JSON.stringify(salesApi(u)); type = 'application/json'; tab.api.push(u.search); }
    else if (u.host === 'my.viagogo.com' || u.host === 'sell.viagogo.com') { body = PAGE; type = 'text/html; charset=utf-8'; }
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
  await b.cmd('Fetch.enable', { patterns: [{ urlPattern: 'https://my.viagogo.com/*' }, { urlPattern: 'https://sell.viagogo.com/*' }, { urlPattern: 'https://ext.local/*' }] }, sessionId);
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
  'sites/ebileta.js', 'sites/efinity.js', 'sites/posttick.js', 'core/viagogo.js', 'core/market.js', 'core/sales.js', 'core/team.js',
  'ui/components.js', 'content/shell.js', 'content/sites/viagogo.js'];
const R = `(() => { const h = document.getElementById('sk-host-viagogo'); return h && h.shadowRoot; })()`;
const text = (t, sel) => t.eval(`(() => { const r = ${R}; const n = r && r.querySelector(${JSON.stringify(sel)}); return n ? n.innerText : null; })()`);
const click = (t, re) => t.eval(`(() => { const b = [...${R}.querySelectorAll('button')].find(x => ${re}.test(x.textContent)); if (!b || b.disabled) return false; b.click(); return true; })()`);

async function load(t) {
  await t.go('https://my.viagogo.com/sales');
  for (const f of FILES) await t.eval(fs.readFileSync(path.join(EXT, f), 'utf8') + '\n;true');
}

(async () => {
  const t0 = Date.now();
  const b = await launch();
  try {
    const t = await openTab(b);
    console.log('\n== my.viagogo.com/sales, first scan');
    await load(t);
    const empty = await until(() => text(t, '.sk-slot'), 6000);
    expect(!!empty && /Nothing saved yet/.test(empty), 'the sidebar opens on My Sales, with nothing saved', empty);
    expect(await click(t, /^Scan all sales$/), 'and offers to scan every sale');
    const done = await until(async () => /23 new sales saved/.test(await t.eval(`document.getElementById('sk-host-viagogo').shadowRoot.textContent`)), 20000);
    expect(!!done, 'it reads every page of the endpoint and saves all 23 sales', t.api);
    expect(t.api.every(q => /sort=SALEDATE%20desc/.test(q) && /STATUS%3AOPEN%7CCOMPLETED/.test(q)), 'always newest first, open and completed', t.api);
    const sent = await t.eval(`JSON.stringify(__log.filter(m => m.type === 'saveSales'))`);
    expect(!/private\.example|\+44|Pat/.test(sent), 'nothing of the buyer is sent to the extension', sent.slice(0, 200));

    const tiles = await until(async () => { const x = await text(t, '.vg-tiles'); return x && /50 tickets/.test(x) ? x : null; }, 4000) || await text(t, '.vg-tiles');
    /* N105: 86.40 + 75.60 = $162 → 16,200 L paid for 6 tickets bought at 2,000 L = 12,000 L → +4,200 L */
    /* sold: 162 + 90 + (100 + … + 119 = 2,190) = $2,442 */
    expect(!!tiles && /\+4,200 L/.test(tiles) && /x1\.4/.test(tiles) && /\$2,442\.00\s*sold · 50 tickets/.test(tiles) && /12,000 L\s*spent · 21 no buy price/.test(tiles),
      'tiles: +4,200 L profit (x1.4), $2,442 sold for 50 tickets, 12,000 L spent', tiles);
    expect(!!tiles && /16,200 L\s*you get · spent \+ profit/.test(tiles), 'and what you get: 12,000 spent + 4,200 profit = 16,200 L', tiles);
    const events = await t.eval(`[...${R}.querySelectorAll('.sl-event')].map(e => e.innerText.replace(/\\s+/g, ' '))`);
    expect(events.length === 2 && /^▸ Albania vs San Marino - Nations League 1 unpaid/.test(events[0]) && /^▸ England vs France/.test(events[1]),
      'grouped by event, newest first, the unpaid one flagged', events);
    expect(/10 tickets · 3 sales/.test(events[0]) && /\+4,200 L/.test(events[0]) && /sold \$252\.00 · spent 12,000 L \(2 of 3 sales\) · you get 16,200 L/.test(events[0]),
      'with tickets, sales, profit, what it sold for in $, what it cost and what you get (spent + profit), per event', events[0]);
    expect(/Tue, 06 Oct 2026 · 20:45 · last sale Sun, 04 Oct 2026/.test(events[0]), 'the event date and the last sale are written out', events[0]);
    const titles = await t.eval(`[...${R}.querySelectorAll('.sl-event .detail span')].slice(0, 2).map(x => x.title)`);
    expect(titles[0] === 'When the event takes place' && /newest sale/.test(titles[1]), 'and each says what it is on hover', titles);

    await t.eval(`(() => { ${R}.querySelector('.sl-event .top').click(); return true; })()`);
    const secs = await until(() => t.eval(`(() => { const s = [...${R}.querySelectorAll('.sl-sec-head')].map(x => x.innerText.replace(/\\s+/g, ' ')); return s.length ? s : null; })()`), 3000);
    expect(!!secs && secs.length === 2 && /^▸ N105 6 tickets · 2 sales \+4,200 L \(x1\.4\) sold \$162\.00 · spent 12,000 L · you get 16,200 L$/.test(secs[0]) && /^▸ S102 4 tickets · 1 sale no buy price sold \$90\.00 · spent —$/.test(secs[1]),
      'inside the event: N105 and S102, each with its own totals, you get only where there is a buy price', secs);
    await t.eval(`(() => { [...${R}.querySelectorAll('.sl-sec-head')][1].click(); return true; })()`);
    const s102 = await until(() => t.eval(`(() => { const s = ${R}.querySelector('.sl-sec.open'); return s ? s.innerText.replace(/\\s+/g, ' ') : null; })()`), 3000);
    expect(!!s102 && /30 Sep\b/.test(s102) && /#655666275 · no buy price/.test(s102) && /\$90\.00/.test(s102) && /1 with no buy price/.test(s102),
      'S102 lists its sale and asks for a buy price', s102);
    await t.eval(`(() => {
      const box = ${R}.querySelector('.sl-sec.open .sl-buy');
      const i = box.querySelector('input'); i.value = '1500';
      const s = box.querySelector('select'); s.value = 'ALL';
      box.querySelector('button').click(); return true;
    })()`);
    const after = await until(() => t.eval(`(() => { const s = [...${R}.querySelectorAll('.sl-sec-head')][1]; return s && /\\+3,000 L/.test(s.innerText) ? s.innerText.replace(/\\s+/g, ' ') : null; })()`), 4000);
    expect(!!after, 'a buy price of 1,500 L typed on S102 gives its profit: 9,000 − 6,000 = +3,000 L', after);

    /* the same event as one list of sales, each with its section */
    await t.eval(`(() => { [...${R}.querySelectorAll('.sl-tabs button')].find(b => b.textContent === 'All sales').click(); return true; })()`);
    const gets = await until(() => t.eval(`(() => { const l = [...${R}.querySelectorAll('.sl-event.open > .sl-secs > .sl-sales .sg')].map(x => x.textContent); return l.length ? l : null; })()`), 3000);
    expect(!!gets && gets.length === 3 && gets.every(x => /^spent [\d,]+ \+ profit [+−-][\d,]+ = you get [\d,]+ L$/.test(x))
      && gets.some(x => x === 'spent 6,000 + profit +3,000 = you get 9,000 L'),
      'each sale with a buy price: spent + profit = what it pays you', gets);
    const flat = await until(() => t.eval(`(() => { const l = ${R}.querySelector('.sl-event.open > .sl-secs > .sl-sales'); return l ? [...l.children].map(li => li.querySelector('.sq').textContent) : null; })()`), 3000);
    expect(!!flat && flat.join(' | ') === 'N105 · 3 tkt | N105 · 3 tkt | S102 · 4 tkt', 'All sales lists every sale of the event, newest first, with its section', flat);
    console.log('   screenshot:', await t.shot('viagogo-sales.png'));
    await t.eval(`(() => { [...${R}.querySelectorAll('.sl-tabs button')].find(b => b.textContent === 'By section').click(); return true; })()`);

    /* search by event name: the box keeps its place and focus while the list changes */
    await t.eval(`(() => { const i = ${R}.querySelector('.sl-search input') || ${R}.querySelector('.sl-search'); i.focus(); i.value = 'engl'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const found = await until(() => t.eval(`(() => { const e = [...${R}.querySelectorAll('.sl-event .top .sec')].map(x => x.textContent); return e.length === 1 ? e : null; })()`), 3000);
    const kept = await t.eval(`(() => { const a = ${R}.activeElement; return !!a && (!!a.closest('.sl-search') || a === ${R}.querySelector('.sl-search')); })()`);
    expect(!!found && found[0] === 'England vs France' && /Events · 1 of 2/i.test(await text(t, '.sk-section-title')) && kept,
      '"engl" leaves England vs France, says 1 of 2, and the box keeps its focus', { found, kept });
    await t.eval(`(() => { const i = ${R}.querySelector('.sl-search input') || ${R}.querySelector('.sl-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

    console.log('\n== Scan new sales');
    SALES.unshift({ SaleId: 656200001, ListingId: 14123898111, EventId: 161613551, EventDescription: 'Albania vs San Marino - Nations League', EventDate: '2026-10-06T20:45:00', Section: 'N105', Quantity: 2, TotalPayout: 60, SaleDate: '2026-10-05T09:00:00', Status: 'Get Paid' });
    SALES[1].Status = 'Complete';                        // the unpaid one got paid
    t.api.length = 0;
    expect(await click(t, /^Scan new sales$/), 'once sales are saved it offers Scan new sales');
    const fresh = await until(async () => /1 new sale saved/.test(await t.eval(`document.getElementById('sk-host-viagogo').shadowRoot.textContent`)), 15000);
    expect(!!fresh, 'it saves the one new sale', t.api);
    expect(t.api.length <= 2, 'and stops at the sales already saved, without reading every page', t.api);
    const paidNow = await t.eval(`__saved['656096343'].status`);
    expect(paidNow === 'Complete', 'reading past the unpaid sale, it picks up that it was paid', paidNow);

    console.log('\n== sell.viagogo.com, setting the price');
    await t.go('https://sell.viagogo.com/Secure/Pipeline/Sell/PriceDetails?ListingId=0&EventId=161613551');
    for (const f of FILES) await t.eval(fs.readFileSync(path.join(EXT, f), 'utf8') + '\n;true');
    const price = await until(() => t.eval(`(() => { const r = ${R}; if (!r) return null; const d = [...r.querySelectorAll('details.section')].find(x => /Price calculator/.test(x.textContent)); return d ? { title: r.querySelector('.sk-head .title').textContent, open: d.open, calc: !!d.querySelector('.pcalc') } : null; })()`), 6000);
    expect(!!price && price.title === 'viagogo price' && price.open && price.calc, 'the price page gets the sidebar, with the calculator already open', price);
    const side = await t.eval(`(() => { const p = ${R}.querySelector('.sk-panel') || ${R}.querySelector('.sk-app'); const r = p.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: innerWidth }; })()`);
    expect(side.right >= side.width - 2 && side.left > side.width / 2, 'on the right of the page', side);
    /* ⇄ moves it to the other side whenever you like, and the page remembers */
    expect(await click(t, /^⇄$/), 'the header has a ⇄ button');
    const moved = await until(() => t.eval(`(() => { const r = ${R}.querySelector('.sk-panel').getBoundingClientRect(); return r.left < 2 ? { left: Math.round(r.left), right: Math.round(r.right) } : null; })()`), 3000);
    expect(!!moved, 'pressing it moves the panel to the left', moved);
    const sideKept = await t.eval(`(async () => (await chrome.storage.local.get('ui')).ui)()`);
    expect(!!sideKept && sideKept.sidebarSide && sideKept.sidebarSide['viagogo:price'] === 'left', 'and the choice is kept for this page', sideKept);
    expect(await click(t, /^⇄$/), 'pressing it again');
    const back = await until(() => t.eval(`(() => { const r = ${R}.querySelector('.sk-panel').getBoundingClientRect(); return r.right >= innerWidth - 2 ? true : null; })()`), 3000);
    expect(back === true, 'moves it back to the right');
    const worked = await t.eval(`(() => {
      const r = ${R}.querySelector('.pcalc');
      const rows = [...r.querySelectorAll('.pcalc-row')];
      const set = (row, value, cur) => {
        const i = row.querySelector('input'); i.value = String(value); i.dispatchEvent(new Event('input', { bubbles: true }));
        if (cur) { const s = row.querySelector('select'); s.value = cur; s.dispatchEvent(new Event('change', { bubbles: true })); }
      };
      set(rows[0], 4000, 'ALL'); set(rows[1], 84, 'USD');
      return r.querySelector('.calc-out').innerText;
    })()`);
    expect(/L/.test(worked) && /each/.test(worked), 'and it works out a price there', worked.slice(0, 120));
    expect(t.errors.length === 0, 'no errors on the page', t.errors);
  } catch (e) {
    console.log('  ✗ crashed:', e.message);
    failures++;
  } finally { b.close(); }
  console.log(`\n${failures ? '✗ ' + failures + ' FAILED' : '✓ all sales-page checks passed'} · ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(failures ? 1 : 0);
})();
