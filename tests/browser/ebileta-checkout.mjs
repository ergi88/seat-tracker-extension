/* Browser test: eBileta's checkout (al.ebileta.al/biglietteria/trans/transazione.do).
 *
 * The page as captured on 2026-10-13 (tests/browser/fixtures/ebileta-checkout.html,
 * personal data replaced) runs the extension's checkout script with a stand-in for
 * the service worker: a tracked event with sector N104, a request for 2 there and
 * two buying accounts. The drawer fills every ticket's names from an account, edits
 * one ticket, adds the order as a purchase, and saves a new buying account.
 *
 *   node tests/browser/ebileta-checkout.mjs
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

const URL_ = 'https://al.ebileta.al/biglietteria/trans/transazione.do';
const PAGE = fs.readFileSync(path.join(HERE, 'fixtures/ebileta-checkout.html'), 'utf8');

/* the service worker: state with or without the event tracked; savePurchases records and answers */
const STUB = `(() => {
  const area = { get: async () => ({}), set: async () => {}, remove: async () => {} };
  window.__log = [];
  window.__saved = [];
  window.__tracked = true;
  window.__state = () => {
    const ev = { key: 'ebileta:2182', num: 3, site: 'ebileta', siteLabel: 'eBileta', siteId: '2182', archived: false,
      title: 'Shqiperi - Finlande - November 12, 2026, 8:45 PM - Air Albania Stadium', date: '', extra: {}, cats: {},
      sectors: [{ id: '1601', code: 'N104', name: 'TRIBUNA N104' }, { id: '1602', code: 'N10', name: 'TRIBUNA N10' }] };
    return { auth: { signedIn: true, email: 'me@example.com' }, settings: SK.settings.normalize({ buyLimits: { ebileta: 4 } }),
      events: window.__tracked ? [ev] : [],
      requests: window.__tracked ? [{ id: 'r1', num: 7, eventKey: ev.key, sec: '1601', code: 'N104', qty: 2, done: false, bought: false, client: 'Ana' }] : [],
      buyAccounts: window.__accounts.slice(),
      purchases: window.__saved.slice(),
      listings: [], teamPrices: [], scans: {}, fx: { day: '', rates: {} } };
  };
  window.__accounts = [
    { id: 'a1', userId: 'me', email: 'john.doe@example.com', firstName: 'john', lastName: 'doe', birthday: '1990-01-01', notes: '' },
    { id: 'a2', userId: 'me', email: 'second@example.com', firstName: 'Ana', lastName: 'Krasniqi', birthday: '1995-03-04', notes: '' }
  ];
  window.__changed = [];
  window.chrome = {
    runtime: {
      id: 'seat-tracker-test', lastError: null,
      getURL: p => 'https://ext.local/' + p,
      onMessage: { addListener() {} },
      sendMessage(msg, cb) {
        window.__log.push(JSON.parse(JSON.stringify(msg)));
        setTimeout(() => {
          if (msg.type === 'state') return cb({ ok: true, data: window.__state() });
          if (msg.type === 'savePurchases') {
            const rows = msg.items.map((it, i) => Object.assign({ id: 'p' + i, userId: 'me' }, it));
            window.__saved.push(...rows);
            /* as bg/events.js savePurchases answers: the lots, and how many tickets went with them */
            return cb({ ok: true, data: { purchases: rows, tickets: msg.items.reduce((n, it) => n + ((it.tickets || []).length), 0), ticketsError: '' } });
          }
          if (msg.type === 'saveBuyAccount') {
            const f = msg.account;
            if (window.__accounts.some(a => a.email === f.email.trim().toLowerCase())) return cb({ ok: false, error: f.email + ' is already saved.' });
            const a = { id: 'a' + (window.__accounts.length + 1), userId: 'me', email: f.email.trim().toLowerCase(), firstName: f.firstName, lastName: f.lastName, birthday: f.birthday, notes: '' };
            window.__accounts.push(a);
            return cb({ ok: true, data: a });
          }
          cb({ ok: true, data: null });
        }, 15);
      }
    },
    storage: { local: area, session: area, onChanged: { addListener: f => window.__changed.push(f) } }
  };
})();`;

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const entry = manifest.content_scripts.find(cs => cs.matches.some(m => m.startsWith('https://al.ebileta.al/biglietteria/trans/transazione.do')));
const INJECT = STUB + '\nwindow.addEventListener("load", function () {\n' +
  (entry ? entry.js : []).map(f => fs.readFileSync(path.join(EXT, f), 'utf8')).join('\n;\n') + '\n});';

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
  const tab = { errors: [], asked: [] };
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
    if (u.host === 'eu.ebileta.al' || u.host === 'al.ebileta.al') {
      tab.asked.push(request.url);
      body = u.pathname.endsWith('transazione.do') ? PAGE : '<!doctype html><html><body></body></html>';
      type = 'text/html; charset=utf-8';
    } else {
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
  await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: INJECT }, sessionId);
  await b.cmd('Fetch.enable', { patterns: [{ urlPattern: 'https://eu.ebileta.al/*' }, { urlPattern: 'https://al.ebileta.al/*' }, { urlPattern: 'https://ext.local/*' }] }, sessionId);
  tab.eval = async expression => {
    const r = await b.cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  };
  tab.go = async url => {
    await b.cmd('Page.navigate', { url }, sessionId);
    await until(() => tab.eval(`document.readyState === 'complete'`), 8000);
  };
  tab.shot = async name => {
    const r = await b.cmd('Page.captureScreenshot', { format: 'png' }, sessionId);
    const f = path.join(SHOTS, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return f;
  };
  return tab;
}

const R = `document.getElementById('sk-eb-checkout')?.shadowRoot`;
const pageVals = id => `['cognome','nome','dataNascita','email'].map(k => document.getElementById('anagrafica_${id}_' + k).value).join('|')`;

(async () => {
  const t0 = Date.now();
  expect(!!entry && entry.matches.some(m => m.startsWith('https://eu.ebileta.al/biglietteria/trans/transazione.do')),
    'the manifest runs the checkout script on both eBileta hosts');
  const b = await launch();
  try {
    const t = await openTab(b);
    await t.go(URL_);
    const title = await until(() => t.eval(`(() => { const r = ${R}; const x = r && r.querySelector('.ck-titles'); return x && x.innerText; })()`), 8000);
    expect(/Shqiperi - Finlande/.test(title || '') && /2 tickets/.test(title || '') && /N104/.test(title || '') && /alb00test01/.test(title || ''),
      'the drawer names the event, the tickets, the sector and the order', title);
    const seats = await t.eval(`[...${R}.querySelectorAll('.ck-seat')].map(x => x.textContent)`);
    expect(JSON.stringify(seats) === '["N104 RQ S10","N104 RQ S11"]', 'one row per ticket: sector, row and seat', seats);

    console.log('\n== participants: every ticket at once, from an account');
    await t.eval(`(() => { const s = ${R}.querySelector('.ck-card .ck-select'); s.value = 'a2'; s.dispatchEvent(new Event('change')); return true; })()`);
    const allRow = await until(() => t.eval(`[...${R}.querySelectorAll('tr.all .ck-in')].map(i => i.value).join('|')`), 3000);
    expect(allRow === 'Krasniqi|Ana|04/03/1995|', 'picking an account fills the "All tickets" row: last name, name, birth date as dd/mm/yyyy, email left empty', allRow);
    await t.eval(`[...${R}.querySelectorAll('button')].find(x => x.textContent === 'Apply to all').click()`);
    await sleep(200);
    const a = await t.eval(pageVals(5038685)), b2 = await t.eval(pageVals(5038686));
    expect(a === 'Krasniqi|Ana|04/03/1995|buyer@example.com' && b2 === a, 'Apply to all writes both tickets on the page; the email stays as it was', { a, b: b2 });

    /* one ticket by hand, in the drawer */
    await t.eval(`(() => { const rows = ${R}.querySelectorAll('.ck-table tr'); const i = rows[3].querySelectorAll('.ck-in')[1]; i.value = 'Besa'; i.dispatchEvent(new Event('input')); return true; })()`);
    expect(await t.eval(`document.getElementById('anagrafica_5038686_nome').value`) === 'Besa', 'typing in a ticket\'s box changes that ticket on the page only');
    expect(await t.eval(`document.getElementById('anagrafica_5038685_nome').value`) === 'Ana', 'and leaves the other one alone');
    await t.eval(`(() => { const i = ${R}.querySelectorAll('tr.all .ck-in')[2]; i.value = '1995-03-04'; i.dispatchEvent(new Event('input')); return true; })()`);
    await t.eval(`[...${R}.querySelectorAll('button')].find(x => x.textContent === 'Apply to all').click()`);
    const warn = await until(() => t.eval(`(() => { const n = ${R}.querySelector('.ck-notice.bad'); return n && n.textContent; })()`), 2000);
    expect(/dd\/mm\/yyyy/.test(warn || '') && await t.eval(`document.getElementById('anagrafica_5038685_dataNascita').value`) === '04/03/1995',
      'a birth date not written dd/mm/yyyy is refused, and nothing is changed', warn);

    console.log('\n== the purchase');
    const pre = await t.eval(`(() => { const cards = ${R}.querySelectorAll('.ck-card'); const c = cards[1]; return { acc: c.querySelector('.ck-line select').value, req: c.querySelector('.ck-group select').value, group: c.querySelector('.ck-group').innerText }; })()`);
    expect(pre.acc === 'a1' && pre.req === 'r1' && /N104 · 2 tickets/.test(pre.group) && /1,048/.test(pre.group),
      'the account eBileta names as the client (doe john) is picked, with request #7 in N104, 2 tickets at 1,048 L, fee included', pre);
    console.log('   screenshot:', await t.shot('ebileta-checkout.png'));
    await t.eval(`[...${R}.querySelectorAll('button')].find(x => /^Add 2 tickets to/.test(x.textContent)).click()`);
    const sent = await until(() => t.eval(`(() => { const m = window.__log.find(x => x.type === 'savePurchases'); return m && m.items; })()`), 3000);
    const it = sent && sent[0];
    expect(sent && sent.length === 1 && it.accountId === 'a1' && it.eventKey === 'ebileta:2182' && it.sectorId === '1601' && it.requestId === 'r1'
      && it.qty === 2 && it.price === 1048 && it.currency === 'ALL' && it.orderRef === 'alb00test01' && it.notes === 'RQ S10, RQ S11',
      'one purchase: account, event, sector N104, request #7, 2 tickets at 1,048 ALL, the order code and the seats', sent);
    expect(it && JSON.stringify((it.tickets || []).map(x => [x.place, x.row, x.seat, x.price, x.currency])) === JSON.stringify([['TRIBUNA N104', 'Q', '10', 1048, 'ALL'], ['TRIBUNA N104', 'Q', '11', 1048, 'ALL']]),
      'and each of its tickets, to be saved waiting for its PDF: sector as printed, row, seat, price', it && it.tickets);
    const said = await until(() => t.eval(`(() => { const n = [...${R}.querySelectorAll('*')].find(x => /each waiting for its PDF/.test(x.textContent) && !x.children.length); return n && n.textContent; })()`), 3000);
    expect(!!said, 'the drawer says the tickets wait for their PDF', said);
    const done = await until(() => t.eval(`(() => { const d = ${R}.querySelector('.ck-done'); return d && d.textContent; })()`), 3000);
    expect(/Added: 2 tickets of order alb00test01 on john.doe@example.com/.test(done || ''), 'and the drawer then says it is added, so it is not added twice', done);

    console.log('\n== a new buying account');
    await t.eval(`[...${R}.querySelectorAll('button')].find(x => x.textContent === '+ New account').click()`);
    const pre2 = await until(() => t.eval(`[...${R}.querySelectorAll('.ck-new .ck-in')].map(i => i.value).join('|')`), 2000);
    expect(pre2 === '|Krasniqi|Besa|04/03/1995' || pre2 === '|Krasniqi|Ana|1995-03-04', 'the form opens with what the "All tickets" row holds', pre2);
    const typeIn = (i, v) => `(() => { const x = ${R}.querySelectorAll('.ck-new .ck-in')[${i}]; x.value = '${v}'; x.dispatchEvent(new Event('input')); return true; })()`;
    await t.eval(typeIn(0, 'second@example.com'));
    await t.eval(typeIn(3, '07/08/1999'));
    await t.eval(`[...${R}.querySelectorAll('button')].find(x => x.textContent === 'Save account').click()`);
    const dup = await until(() => t.eval(`(() => { const n = ${R}.querySelector('.ck-notice.bad'); return n && n.textContent; })()`), 2000);
    expect(/already saved/.test(dup || '') && await t.eval(`!!${R}.querySelector('.ck-new')`), 'an email already saved is refused and the form stays open', dup);
    console.log('   screenshot:', await t.shot('ebileta-checkout-account.png'));
    await t.eval(typeIn(0, 'New.Buyer@Example.com'));
    await t.eval(typeIn(1, 'Hoxha'));
    await t.eval(typeIn(2, 'Era'));
    await t.eval(`[...${R}.querySelectorAll('button')].find(x => x.textContent === 'Save account').click()`);
    const saved = await until(() => t.eval(`(() => { const m = window.__log.filter(x => x.type === 'saveBuyAccount'); return m.length === 2 && m[1].account; })()`), 3000);
    expect(saved && saved.email === 'New.Buyer@Example.com' && saved.firstName === 'Era' && saved.lastName === 'Hoxha' && saved.birthday === '1999-08-07',
      'Save account sends the email, names and the birth date as yyyy-mm-dd', saved);
    const after = await until(() => t.eval(`(() => { const r = ${R}; if (r.querySelector('.ck-new')) return null; const n = r.querySelector('.ck-notice'); return { notice: n && n.textContent, pick: r.querySelector('.ck-card .ck-select').value, row: [...r.querySelectorAll('tr.all .ck-in')].map(i => i.value).join('|') }; })()`), 3000);
    expect(after && /Saved new.buyer@example.com/.test(after.notice || '') && after.pick === 'a3' && after.row.startsWith('Hoxha|Era|07/08/1999'),
      'the form closes, the new account is picked and fills the "All tickets" row', after);

    console.log('\n== an event that is not tracked');
    await t.eval(`(() => { window.__tracked = false; window.__changed.forEach(f => f({ mirror: {} }, 'local')); return true; })()`);
    const note = await until(() => t.eval(`(() => { const p = [...${R}.querySelectorAll('.ck-card .note')].find(x => /not tracked/.test(x.textContent)); return p && p.textContent; })()`), 3000);
    expect(!!note, 'the purchase card says the event has to be tracked first; the names still work', note);

    expect(!t.errors.length, 'nothing thrown', t.errors);
  } finally {
    b.close();
  }
  console.log(`\n${failures ? '✗ ' + failures + ' FAILED' : '✓ all checkout checks passed'} · ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(failures ? 1 : 0);
})();
