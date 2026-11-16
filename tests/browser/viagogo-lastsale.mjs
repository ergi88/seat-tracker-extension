/* Browser test: viagogo's "just sold" toast on a sell page.
 *
 * A stand-in sell page (sell.viagogo.com/ww/Secure/Pipeline/Sell/TicketDetails/Quantity)
 * that draws the toast a moment after it loads, exactly as copied on
 * 2026-11-04, and a stand-in for the service worker that keeps what is saved
 * across reloads. Checks: the toast is read and saved, the sidebar shows it,
 * "Refresh" reloads the tab by itself, the same toast again is the same sale,
 * a different one is a new sale, and viagogo's bot page stops refreshing.
 *
 *   node tests/browser/viagogo-lastsale.mjs
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

/* the toast, exactly as copied from the page */
const TOAST = (section, qty, price) => `<div class="sc-d2hnfj-1 kytrZf"><div class="sc-d2hnfj-2 ktioIZ"><div class="sc-d2hnfj-3 lfPHa"><div class="sc-d2hnfj-4 buIjRo"><img class="sc-1lyqsii-5 cGwjnS sc-d2hnfj-5 dOKQml" src="https://media.stubhubstatic.com/x.jpg"></div><div class="sc-d2hnfj-6 bysOPa"><span class="sc-d2hnfj-7 gRyiBZ">Tickets for Albania vs Finland - Nations League were just purchased!</span><span class="sc-d2hnfj-8 GwKas"><div class="sc-d2hnfj-9 kHBtax">${section}<div>•</div>${qty} tickets</div><div>${price}</div></span><div><div class="sc-9y7ptg-0 eZWMTy"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M10 4z"></path></svg><span>Just sold!</span></div></div></div><button class="sc-d2hnfj-0 iexdqG"><svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 0 16 16" fill="currentColor"><path d="M13 3z"></path></svg></button></div></div></div>`;

/* what each load of the sell page shows: the same sale twice, then a new one, then the bot page */
const LOADS = [['S205', 3, '$82.24'], ['S205', 3, '$82.24'], ['N101', 2, '$60.00'], 'blocked'];
let loads = 0;
function sellPage() {
  const now = LOADS[Math.min(loads++, LOADS.length - 1)];
  if (now === 'blocked') {
    return `<!doctype html><html><head><title>Access temporarily restricted</title></head><body><h1>Access temporarily restricted</h1><p>We detected automated (bot) activity.</p></body></html>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sell tickets | viagogo</title></head><body>
<div id="app" style="padding:24px;font-family:sans-serif;max-width:700px">
  <div><h2>Albania vs Finland - Nations League</h2><div>Sat, 14 Nov 2026 • 8:45 PM</div><div>Air Albania Stadium, Tirana</div></div>
  <h3>How many tickets are you selling?</h3><select><option>1</option><option>2</option></select>
</div>
<div id="toast" style="position:fixed;right:16px;bottom:16px;width:340px;background:#fff;border:1px solid #ccc;padding:12px;border-radius:8px"></div>
<script>localStorage.setItem('PIPELINE_STATES_REF_STORAGE_KEY', JSON.stringify({ '161613530': { pipelineStateId: '02d09c84-45f7-4cf4-9591-64c4eea2ee0c', lastUpdated: 1793949954985 } }));
setTimeout(() => { document.getElementById('toast').innerHTML = ${JSON.stringify(TOAST(...now))}; }, 700);</script>
</body></html>`;
}

/* the service worker: saves the way bg/events.js saveLastSale does, kept across reloads */
const STUB = `(() => {
  window.__log = JSON.parse(sessionStorage.getItem('__log') || '[]');
  window.__saved = JSON.parse(sessionStorage.getItem('__saved') || '[]');
  window.__changed = [];
  const store = JSON.parse(sessionStorage.getItem('__store') || '{}');
  const area = {
    get: async k => { const out = {}; for (const key of (k ? [].concat(k) : Object.keys(store))) if (key in store) out[key] = JSON.parse(JSON.stringify(store[key])); return out; },
    set: async o => { Object.assign(store, JSON.parse(JSON.stringify(o))); sessionStorage.setItem('__store', JSON.stringify(store)); },
    remove: async k => { for (const key of [].concat(k)) delete store[key]; sessionStorage.setItem('__store', JSON.stringify(store)); }
  };
  const keep = () => { sessionStorage.setItem('__saved', JSON.stringify(window.__saved)); sessionStorage.setItem('__log', JSON.stringify(window.__log)); };
  window.__state = () => ({ auth: { signedIn: true, email: 'me@example.com' }, settings: SK.settings.normalize({}),
    sites: SK.siteList().map(x => ({ id: x.id, label: x.label, can: x.can, pages: x.pages, badges: x.badges, pushSelectors: x.pushSelectors })),
    events: [], requests: [], scans: {}, catalog: [], devices: [], listings: [], compares: [], sales: [], teamPrices: [], teamRequests: [],
    lastSales: window.__saved.slice().sort((a, b) => b.firstSeen - a.firstSeen),
    lastSaleScan: { every: 30, here: true, holder: '', blockedUntil: 0, pausedUntil: 0, events: 1,
      list: [{ vgEventId: '161613530', title: 'Albania vs Finland', when: '', source: 'yours', on: true, every: 30, ownEvery: null, lastAt: Date.now() - 4 * 60000, lastResult: 'none', nextAt: Date.now() + 26 * 60000, etaAt: Date.now() + 26 * 60000, skipUntil: 0, session: true, sales: 1 }] },
    team: [{ userId: 'me', name: 'Me', me: true }], fx: { day: '2026-11-04', rates: { USD: 100 }, fetched: {}, manual: [] }, snoozeUntil: 0, meta: {} });
  const changed = () => setTimeout(() => window.__changed.forEach(f => f({ mirror: {} }, 'local')), 20);
  let id = window.__saved.length;
  window.chrome = {
    runtime: {
      id: 'seat-tracker-test', lastError: null,
      getURL: p => 'https://ext.local/' + p,
      onMessage: { addListener() {} },
      sendMessage(msg, cb) {
        window.__log.push(JSON.parse(JSON.stringify(msg))); keep();
        setTimeout(() => {
          if (msg.type === 'state') return cb({ ok: true, data: window.__state() });
          if (msg.type === 'saveLastSale') {
            const it = SK.lastSales.clean(msg.item);
            const { latest, same } = SK.lastSales.compare(window.__saved, it);
            let sale;
            if (same) sale = latest;
            else { sale = Object.assign({ id: String(++id), firstSeen: Date.now(), lastSeen: Date.now(), seenCount: 1, seenBy: 'Test PC' }, it); window.__saved.push(sale); }
            keep(); changed();
            return cb({ ok: true, data: { sale, isNew: !same } });
          }
          if (msg.type === 'lastSaleSlot') return cb({ ok: true, data: { wait: 0 } });
          if (msg.type === 'vgSellSessions') return cb({ ok: true, data: Object.keys(msg.sessions || {}).length });
          if (msg.type === 'vgBlocked') { const until = Date.now() + 6 * 3600e3; area.set({ vgBlockedUntil: until }); return cb({ ok: true, data: { blockedUntil: until } }); }
          cb({ ok: true, data: null });
        }, 10);
      }
    },
    storage: { local: area, session: area, onChanged: { addListener: f => window.__changed.push(f) } }
  };
})();`;

const FILES = ['core/util.js', 'core/rules.js', 'core/registry.js', 'core/settings.js', 'core/profit.js', 'core/help.js',
  'sites/ebileta.js', 'sites/efinity.js', 'sites/posttick.js', 'core/viagogo.js', 'core/market.js', 'core/sales.js', 'core/lastsales.js', 'core/team.js',
  'ui/components.js', 'ui/lastsalewatch.js', 'content/shell.js', '@fast', 'content/sites/viagogo-lastsale.js', 'content/sites/viagogo.js'];
/* the refresh, sped up from minutes to a second and a half */
const FAST = 'SK.lastSales.nextDelay = () => 1500;';
/* the content scripts, run on every load the way document_idle does */
const SCRIPTS = `document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
  ${FILES.map(f => (f === '@fast' ? FAST : `(0, eval)(${JSON.stringify(fs.readFileSync(path.join(EXT, f), 'utf8'))});`)).join('\n')}
}, 50));`;

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
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request, resourceType } = msg.params;
    const u = new URL(request.url);
    let body = null, type = 'text/plain';
    if (u.host === 'sell.viagogo.com' && resourceType === 'Document') { body = sellPage(); type = 'text/html; charset=utf-8'; }
    else if (u.host === 'ext.local') {
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
  await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: SCRIPTS }, sessionId);
  await b.cmd('Fetch.enable', { patterns: [{ urlPattern: 'https://sell.viagogo.com/*' }, { urlPattern: 'https://media.stubhubstatic.com/*' }, { urlPattern: 'https://ext.local/*' }] }, sessionId);
  tab.eval = async expression => {
    const r = await b.cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  };
  tab.go = url => b.cmd('Page.navigate', { url }, sessionId);
  tab.shot = async name => {
    const r = await b.cmd('Page.captureScreenshot', { format: 'png' }, sessionId);
    const f = path.join(SHOTS, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return f;
  };
  return tab;
}

const R = `(() => { const h = document.getElementById('sk-host-viagogo'); return h && h.shadowRoot; })()`;
const sidebar = t => t.eval(`(() => { const r = ${R}; const n = r && r.querySelector('.vg-last'); return n ? n.innerText : null; })()`);
const click = (t, re) => t.eval(`(() => { const b = [...${R}.querySelectorAll('.vg-last button')].find(x => ${re}.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);
const saved = t => t.eval('JSON.stringify(window.__saved)').then(JSON.parse);
const URL0 = 'https://sell.viagogo.com/ww/Secure/Pipeline/Sell/TicketDetails/Quantity?ID=02d09c84-45f7-4cf4-9591-64c4eea2ee0c';

(async () => {
  const t0 = Date.now();
  const b = await launch();
  try {
    const t = await openTab(b);
    console.log('\n== the toast on a sell page');
    await t.go(URL0);
    const first = await until(async () => { const x = await sidebar(t); return x && /saved as a new sale/.test(x) ? x : null; }, 8000);
    expect(!!first, 'the sidebar reads the toast and saves it as a new sale', await sidebar(t));
    let rows = await saved(t);
    expect(rows.length === 1 && rows[0].section === 'S205' && rows[0].tickets === 3 && rows[0].price === 82.24 && rows[0].currency === 'USD',
      'saved: S205, 3 tickets, $82.24', rows);
    expect(rows[0] && rows[0].title === 'Albania vs Finland - Nations League' && /14 Nov/.test(rows[0].when), 'with the event and the date read from the page', rows[0]);
    const listed = await until(async () => { const x = await sidebar(t); return x && /NATIONS LEAGUE · 1 SALE/i.test(x) ? x : null; }, 4000);
    expect(!!listed && /S205[\s\S]*3 tickets[\s\S]*Price: \$82\.24 \| \$27\.41\/pc/.test(listed), 'the list for this event shows it, with the price split per ticket', await sidebar(t));
    expect(/Reload this tab:\s*Off/.test(first || '') && /Off: this tab stays as it is/.test(first || ''), 'reloading the tab is off until switched on', first);
    const sched = (await sidebar(t)) || '';
    expect(/Last sales: scanned every 30 min \(you list on it\)\.\s+Last asked \d\d:\d\d \(4 min ago\) — no sale to show\.\s+Next: about (?:tomorrow )?\d\d:\d\d \(in 2[56] min\)/.test(sched) && /Get last sale now/.test(sched),
      'the sidebar shows this event\'s place in the scan: interval, last answer, next turn (the event found from viagogo\'s session list)', sched);
    const handed = (await t.eval('window.__log')).filter(x => x.type === 'vgSellSessions');
    expect(handed.length >= 1 && handed[0].sessions['161613530'] && handed[0].sessions['161613530'].id === '02d09c84-45f7-4cf4-9591-64c4eea2ee0c',
      'the page hands viagogo\'s sell sessions to the service worker, for the scan', handed);
    console.log('  screenshot:', await t.shot('vg-lastsale-1.png'));

    console.log('\n== refreshing by itself');
    expect(await click(t, /^5 min$/), 'switch on "5 min"');
    const on = await until(async () => { const x = await sidebar(t); return x && /Next refresh/.test(x) ? x : null; }, 3000);
    expect(!!on, 'the sidebar says when the next refresh is', await sidebar(t));
    const again = await until(async () => { const x = await sidebar(t); return x && /same sale as the last one saved, skipped/.test(x) ? x : null; }, 10000);
    expect(!!again, 'it reloaded, and the same toast again is the same sale: skipped', await sidebar(t));
    rows = await saved(t);
    expect(rows.length === 1, 'nothing new was added', rows);
    const kept = await t.eval(`JSON.parse(sessionStorage.getItem('seat-tracker:lastsale-watch'))`);
    expect(kept && kept.every === 5, 'refreshing stays on across the reload (this tab)', kept);

    const second = await until(async () => { const x = await sidebar(t); return x && /N101/.test(x) && /saved as a new sale/.test(x) ? x : null; }, 10000);
    expect(!!second, 'the next reload shows a different sale: saved as new', await sidebar(t));
    rows = await saved(t);
    expect(rows.length === 2 && rows.some(r => r.section === 'N101' && r.tickets === 2 && r.price === 60), 'two sales saved now', rows);
    const both = await until(async () => { const x = await sidebar(t); return x && /2 SALES/i.test(x) ? x : null; }, 4000);
    const list = both ? both.slice(both.search(/2 SALES/i)) : '';
    expect(!!both && list.indexOf('N101') > -1 && list.indexOf('N101') < list.indexOf('S205'), 'listed newest first', await sidebar(t));
    console.log('  screenshot:', await t.shot('vg-lastsale-2.png'));

    console.log('\n== viagogo\'s bot page');
    const stopped = await until(async () => {
      const log = JSON.parse(await t.eval('JSON.stringify(window.__log)'));
      return log.some(m => m.type === 'vgBlocked');
    }, 10000);
    expect(!!stopped, 'the bot page is told to the service worker');
    await sleep(2500);
    const flag = await t.eval(`JSON.parse(sessionStorage.getItem('seat-tracker:lastsale-watch'))`);
    expect(flag === null, 'and refreshing is switched off', flag);
    expect(await t.eval('document.title') === 'Access temporarily restricted', 'no further reload happened');
    expect(!t.errors.length, 'no errors on the page', t.errors);
  } catch (e) {
    console.error(e);
    failures++;
  } finally {
    b.close();
  }
  console.log(`\n${failures ? `${failures} failed` : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(failures ? 1 : 0);
})();
