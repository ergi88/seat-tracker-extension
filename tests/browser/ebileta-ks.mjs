/* Browser test: eBileta Kosovo's event page (eu.ebileta.al/biglietteria/listaEventiPub.do).
 *
 * That page shows the sector list itself and its address names no event, so
 * the event is known by the idSM of its sector links. A stand-in page built
 * from the page's real markup runs the extension's sector-list script with a
 * stand-in for the service worker that tracks events the way it does.
 *
 *   node tests/browser/ebileta-ks.mjs
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

const LIST_URL = 'https://eu.ebileta.al/biglietteria/listaEventiPub.do';
const SECTORS = [['444', 'Sektori J2'], ['445', 'Sektori J3'], ['436', 'Sektori L1'], ['437', 'Sektori L2'], ['438', 'Sektori L3'], ['439', 'Sektori L4'],
  ['446', 'Sektori P1'], ['447', 'Sektori P2', 'Bassa', 'Low'], ['448', 'Sektori P3'], ['449', 'Sektori P4'], ['450', 'Sektori P5'], ['440', 'Sektori V1'], ['452', 'VIP1'], ['451', 'VIP2']];
const link = id => `/biglietteria/pub/buyseats/scegliPostoPub.do?idSett=${id}&amp;idSM=1215&amp;tipoM=1`;
/* the other shape of the same address: with more than one event on sale the
 * page lists them instead of showing one event's sectors */
const EVENTS = [
  ['50050', 'Kosova - Republika e Irlandes', 'Thu 24 Sep 2026 20:45', '24/09/2026', 'dispBassa', 'Low'],
  ['50051', 'Kosova - Austria', 'Sun 04 Oct 2026 18:00', '04/10/2026', 'dispAlta', 'High']
];
const LIST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>eBileta</title></head><body>
<div id="content" class="listaEventiPub vendita"><div id="corpo" class="listacontab"><div id="divEventi0">
<table class="estesa"><tbody>
<tr><td colspan="4" class="titolotabella"><div class="treeHead treeOpen">UEFA Nations League</div></td></tr>
</tbody><tbody>${EVENTS.map(([id, title, when, date, cls, word], i) => `
<tr class="filtroeventi r${i}">
  <td class="griglia img">
    <div class="campo_ricerca_titolo" style="display:none">${title}</div>
    <div class="campo_ricerca_stagione" style="display:none">UEFA Nations League</div>
    <div class="campo_ricerca_data" style="display:none">${date}</div>
  </td>
  <td class="griglia data">
    <a tabindex="-1" href="/biglietteria/pub/buyseats/scegliSettorePub.do?idEvento=${id}"><span class="attivo"> ${when} </span></a>
  </td>
  <td class="griglia titolo">
    <div class="box"><h3>Title</h3>
      <a href="/biglietteria/pub/buyseats/scegliSettorePub.do?idEvento=${id}"><span class="attivo">${title}</span></a></div>
    <div class="box"><h3>Site</h3><strong>FADIL VOKRRI STADIUM</strong><span class="note sala"> - Prishtina XKX</span></div>
  </td>
  <td class="griglia disp ultima">
    <a href="/biglietteria/pub/buyseats/scegliSettorePub.do?idEvento=${id}"><span class="${cls}"><span class="etichetta"></span>${word}</span></a>
  </td>
</tr>`).join('')}</tbody></table></div></div></div>
</body></html>`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>eBileta</title></head><body>
<div id="corpo">
    <h1>Kosova - Republika e Irlandes - September 24, 2026, 8:45 PM - FADIL VOKRRI STADIUM</h1>
    <div class="sottoManifestazione"><div class="numerati">
        <h2><div>Select the sector:</div></h2>
        <ul>${SECTORS.map(([id, name, cls, word]) => `
            <li class="link_settore sett_${id}">
                <input type="hidden" value="${id}">
                <a href="${link(id)}" data-content="${name}">${name}
                    <span class="disp${cls || 'Alta'} conEtichetta" tabindex="0" aria-label="Availability ${word || 'High'}">
                        <span class="etichetta">Availability</span>${word || 'High'}
                    </span>
                </a>
            </li>`).join('')}
        </ul>
        <div class="map">
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:artacom="http://artacom.it" width="640" height="480" viewBox="0 0 1504 1059" preserveAspectRatio="xMidYMid meet">
                <a xlink:href="${link('440')}"><polygon points="278,631 308,684 351,731 384,760 349,821 288,767 248,716 209,650 " class="poly" artacom:id="440" artacom:descr="Sektori V1"></polygon></a>
                <a xlink:href="${link('437')}"><polygon points="580,180 800,182 798,248 583,248 " class="poly" artacom:id="437" artacom:descr="Sektori L2" style="opacity: 0;"></polygon></a>
            </svg>
        </div>
    </div></div>
</div></body></html>`;
const SEAT_PAGE = '<!doctype html><html><body><div id="corpo"><h1>seat page</h1></div></body></html>';

/* the service worker: registerPage / lookupPage answer through the real site
   adapters, as background.js does; a request for 2 tickets in L2 once tracked */
const STUB = `(() => {
  const area = { get: async () => ({}), set: async () => {}, remove: async () => {} };
  const load = () => { try { return JSON.parse(sessionStorage.getItem('__ev') || 'null'); } catch (e) { return null; } };
  window.__log = [];
  window.__state = () => {
    const ev = load();
    const sectors = ev ? ev.sectors.map(s => Object.assign({}, s, { hint: '', url: null, summary: s.summary || null })) : [];
    const events = ev ? [{ key: ev.key, num: 1, site: 'ebileta-ks', siteLabel: 'eBileta Kosovo', siteId: ev.siteId, title: ev.title,
      date: '', archived: false, open: 1, total: 1, teamOpen: 1, teamTotal: 1, otherOwners: [], worst: 'OK', cats: {}, currency: '',
      autoMin: null, autoEvery: 5, lastScanAt: 0, lastScanBy: '', scanner: '', health: null, url: '', viagogo: null, sectors }] : [];
    const requests = ev ? [{ id: 'r1', num: 1, eventKey: ev.key, sec: '437', code: 'L2', qty: 2, done: false, cats: [], client: '',
      eval: { status: 'OK', options: 4 }, free: null, buy: null, teamPrices: [] }] : [];
    return { auth: { signedIn: true, email: 'you@example.com' }, settings: SK.settings.normalize({}),
      sites: SK.siteList().map(x => ({ id: x.id, label: x.label, can: x.can, pages: x.pages, badges: x.badges, pushSelectors: x.pushSelectors })),
      events, requests, scans: {}, catalog: [], devices: [], listings: [], teamPrices: [],
      /* a stadium this PC read without tracking it */
      previews: window.__preview ? { 'ebileta-ks:1215': window.__preview } : {},
      fx: { day: '', rates: {}, fetched: {}, manual: [] }, snoozeUntil: 0, meta: {} };
  };
  window.__changed = [];
  window.chrome = {
    runtime: {
      id: 'seat-tracker-test', lastError: null,
      getURL: p => 'https://ext.local/' + p,
      onMessage: { addListener() {} },
      sendMessage(msg, cb) {
        window.__log.push(JSON.parse(JSON.stringify(msg)));
        /* a log that survives the navigation a Track press causes */
        try {
          const a = JSON.parse(sessionStorage.getItem('__msgs') || '[]');
          a.push(msg.type + (msg.url ? ' ' + msg.url : ''));
          sessionStorage.setItem('__msgs', JSON.stringify(a.slice(-40)));
        } catch (e) { /* nothing to do */ }
        setTimeout(() => {
          if (msg.type === 'state') return cb({ ok: true, data: window.__state() });
          if (msg.type === 'lookupPage') {
            const hit = SK.eventForUrl(msg.url);
            const ev = load();
            return cb({ ok: true, data: hit ? { key: ev && ev.key === hit.key ? hit.key : null, candidate: hit.key } : null });
          }
          if (msg.type === 'registerPage') {
            const hit = SK.eventForUrl(msg.url);
            if (!hit) return cb({ ok: false, error: 'That link is not an event page' });
            const sectors = (SK.ebileta.isEbileta(hit.site) && msg.sections || []).map(x => SK.ebileta.toSector(x));
            sessionStorage.setItem('__ev', JSON.stringify({ key: hit.key, siteId: hit.siteId, title: msg.title, sectors }));
            cb({ ok: true, data: { key: hit.key } });
            setTimeout(() => window.__changed.forEach(f => f({ mirror: {} }, 'local')), 20);
            return;
          }
          if (msg.type === 'trackUrl') {
            const hit = SK.eventForUrl(msg.url);
            if (!hit) return cb({ ok: false, error: 'not an event page' });
            sessionStorage.setItem('__tracked', msg.url);
            cb({ ok: true, data: { key: hit.key } });
            return;
          }
          cb({ ok: true, data: null });
        }, 15);
      }
    },
    storage: { local: area, session: area, onChanged: { addListener: f => window.__changed.push(f) } }
  };
})();`;

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const entry = manifest.content_scripts.find(cs => cs.matches.some(m => m.startsWith('https://eu.ebileta.al/biglietteria/listaEventiPub.do')));
/* the page styles too, as Chrome adds them, so the screenshots look like the real page */
const CSS = (entry ? entry.css || [] : []).map(f => fs.readFileSync(path.join(EXT, f), 'utf8')).join('\n');
const INJECT = STUB + '\nwindow.addEventListener("load", function () {\n  if (!/listaEventiPub/.test(location.pathname)) return;\n' +
  `document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(CSS)} }));\n` +
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
      body = u.pathname.endsWith('listaEventiPub.do')
        ? (u.searchParams.get('many') === '1' ? LIST_PAGE : PAGE)
        : SEAT_PAGE;
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

const R = `document.getElementById('sk-host-ebileta-ks')?.shadowRoot`;

(async () => {
  const t0 = Date.now();
  expect(!!entry, 'the manifest runs the sector-list script on eu.ebileta.al/biglietteria/listaEventiPub.do');
  const b = await launch();
  try {
    const t = await openTab(b);
    await t.go(LIST_URL);

    /* ---- reading the stadium before following it ---- */
    console.log('\n== a stadium read without tracking the event');
    await until(() => t.eval(`(() => { const r = ${R}; return !!(r && r.querySelector('.track-card')); })()`), 8000);
    const offersRead = await t.eval(`(() => {
      const b = [...${R}.querySelectorAll('button')].find(x => /Read the whole stadium/.test(x.textContent));
      return !!b;
    })()`);
    expect(offersRead, 'the untracked card offers to read the whole stadium');

    /* what previewScan would have stored */
    await t.eval(`(() => {
      const now = Date.now();
      window.__preview = { key: 'ebileta-ks:1215', at: now, title: 'Kosova', sectors: {
        '437': { code: 'L2', total: 400, available: 43, longest: 9, at: now },
        '440': { code: 'V1', total: 300, available: 0, longest: 0, at: now },
        '452': { code: 'VIP1', total: 60, available: 12, longest: 4, at: now }
      }, errors: [] };
      window.__changed.forEach(f => f({ mirror: {} }, 'local'));
      return true;
    })()`);
    const spare = await until(() => t.eval(`(() => {
      const n = document.querySelector('.sk-eb-map-badge.is-spare[data-sec="437"]');
      return n ? n.textContent : null;
    })()`), 6000);
    expect(spare === 'L2|43', 'a sector with seats nobody asked for is badged with what is free', spare);
    const shut = await t.eval(`document.querySelector('.sk-eb-map-badge.is-empty[data-sec="440"]')?.textContent`);
    expect(shut === 'V1|0', 'and one that was read and is empty says nothing is free', shut);
    const unread = await t.eval(`!document.querySelector('.sk-eb-map-badge[data-sec="446"]')`);
    expect(unread, 'a sector nobody read gets no badge at all');

    /* hovering a sector of the map: a tooltip with its seats */
    const hover = id => t.eval(`(() => {
      const p = [...document.querySelectorAll('polygon')].find(x => x.getAttribute('artacom:id') === '${id}' || x.getAttribute('data-sk-sec') === '${id}');
      const r = p.getBoundingClientRect();
      p.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      const tip = document.querySelector('.sk-eb-map-tip');
      return tip && !tip.hidden ? tip.innerText.replace(/\\s+/g, ' ').trim() : null;
    })()`);
    const tipV1 = await hover('440');
    expect(/^V1 ?Sektori V1 0 of 300 seats free/.test(tipV1 || ''), 'hovering V1 on the map: a tooltip with its seats, 0 of 300 free', tipV1);
    const tipL2 = await hover('437');
    expect(/43 of 400 seats free · longest block 9/.test(tipL2 || '') && !/option/.test(tipL2 || ''),
      'L2: 43 of 400 free, longest block 9, and no options since nobody asked for any', tipL2);
    await t.eval(`(() => { document.querySelector('div.map svg').dispatchEvent(new PointerEvent('pointerleave')); return true; })()`);
    expect(await t.eval(`document.querySelector('.sk-eb-map-tip').hidden`), 'and it goes when the pointer leaves the map');

    const strip = await t.eval(`document.querySelector('.sk-eb-free-head')?.textContent`);
    expect(/55 in 3 of 14 sectors/.test(strip || '') && !/read never/.test(strip || ''),
      'the strip above the map counts the free seats too, and says when they were read', strip);

    const drawerList = await until(() => t.eval(`(() => {
      const n = ${R}.querySelectorAll('.sk-slot .reqs .req');
      return n.length ? [...n].map(x => x.innerText.replace(/\\s+/g, ' ').trim()).join(' | ') : null;
    })()`), 5000);
    expect(/L2 43 free/.test(drawerList || '') && /VIP1 12 free/.test(drawerList || ''),
      'and the drawer lists every sector that was read, fullest first', drawerList);

    await t.eval('window.__preview = null; window.__changed.forEach(f => f({ mirror: {} }, "local")); true');
    await sleep(400);
    const card = await until(() => t.eval(`(() => { const r = ${R}; const c = r && r.querySelector('.track-card'); return c && c.innerText; })()`), 8000);
    expect(!!card && /This event is not tracked/.test(card) && /Kosova - Republika e Irlandes/.test(card), 'the sidebar opens on the event page and offers "Track this event"', card);
    const look = await t.eval(`__log.find(m => m.type === 'lookupPage')`);
    expect(!!look && look.url === LIST_URL + '?idSM=1215', 'the page is looked up as idSM 1215', look);

    await t.eval(`(() => { const btn = [...${R}.querySelectorAll('button')].find(x => /Track this event/.test(x.textContent)); btn.click(); return true; })()`);
    const reg = await until(() => t.eval(`__log.find(m => m.type === 'registerPage')`), 5000);
    expect(!!reg && reg.url === LIST_URL + '?idSM=1215' && reg.sections.length === 14, 'Track this event sends the event as idSM 1215 with its 14 sectors', reg && { url: reg.url, n: reg.sections.length });
    const ev = await until(() => t.eval(`JSON.parse(sessionStorage.getItem('__ev') || 'null')`), 3000);
    expect(!!ev && ev.key === 'ebileta-ks:1215', 'tracked as eBileta Kosovo event 1215', ev && ev.key);
    expect(!!ev && ev.sectors.map(s => s.code).join(',') === 'J2,J3,L1,L2,L3,L4,P1,P2,P3,P4,P5,V1,VIP1,VIP2', 'sector codes: J2 … V1, VIP1, VIP2', ev && ev.sectors.map(s => s.code));
    expect(!!ev && ev.sectors.find(s => s.code === 'P2').meta.status === 'low', 'P2 keeps its "Low" availability');

    const pills = await until(() => t.eval(`document.querySelectorAll('li.link_settore > .sk-eb-badge').length`), 5000);
    expect(pills === 14, 'a − qty + pill on all 14 sectors once tracked', pills);
    const l2 = await t.eval(`document.querySelector('li.sett_437 > .sk-eb-badge .sk-open')?.textContent`);
    expect(l2 === '2', 'L2 shows the 2 tickets requested', l2);
    const mapBadge = await until(() => t.eval(`document.querySelector('.sk-eb-map-badge[data-sec="437"]')?.textContent`), 4000);
    expect(mapBadge === 'L2|2', 'and a badge on the stadium map naming the sector: "L2|2"', mapBadge);
    console.log('   screenshot:', await t.shot('ebileta-ks-sectors.png'));

    const tipReq = await hover('437');
    expect(/#1 2 tickets · 4 options/.test(tipReq || ''), 'tracked, L2\'s tooltip lists request #1: 2 tickets · 4 options', tipReq);
    await t.eval(`(() => { document.querySelector('div.map svg').dispatchEvent(new PointerEvent('pointerleave')); return true; })()`);

    /* the switch on the map: every badge shows tickets wanted / seats free */
    const toggle = () => t.eval(`(() => { document.querySelector('.sk-eb-map-toggle').click(); return true; })()`);
    expect(await t.eval(`document.querySelector('.sk-eb-map-toggle')?.getAttribute('aria-checked')`) === 'false', 'a "Wanted / free" switch sits on the map, off');
    await toggle();
    const bothText = await until(() => t.eval(`(() => { const n = document.querySelector('.sk-eb-map-badge.both[data-sec="437"]'); return n && n.textContent; })()`), 3000);
    expect(/^L2\|2\/(\d+|\?)$/.test(bothText || '') && await t.eval(`document.querySelector('.sk-eb-map-toggle').getAttribute('aria-checked')`) === 'true',
      'switched on, the badge shows the tickets wanted and the seats free: "L2|2/…"', bothText);
    const legendBoth = await t.eval(`document.querySelector('.sk-eb-legend')?.textContent`);
    expect(/wanted \/ free/.test(legendBoth || ''), 'and the legend says so', legendBoth);
    console.log('   screenshot:', await t.shot('ebileta-ks-sectors-both.png'));
    await toggle();
    expect(await until(() => t.eval(`document.querySelector('.sk-eb-map-badge[data-sec="437"]')?.textContent === 'L2|2'`), 3000), 'switched off, back to one number');

    /* the sidebar's search finds sectors, not only requests */
    const sb = `document.getElementById('sk-host-ebileta-ks').shadowRoot`;
    await t.eval(`(() => { const i = ${sb}.querySelector('.sk-toolbar .search'); i.value = 'VIP'; i.dispatchEvent(new Event('input')); return true; })()`);
    const hits = await until(() => t.eval(`(() => { const n = ${sb}.querySelectorAll('.sk-sector-hits li'); return n.length ? [...n].map(li => li.querySelector('b').textContent).join(',') : null; })()`), 3000);
    expect(hits === 'VIP1,VIP2', 'searching "VIP" in the sidebar finds both VIP sectors, neither of them tracked', hits);
    const tracked = await t.eval(`(() => { const i = ${sb}.querySelector('.sk-toolbar .search'); i.value = 'L2'; i.dispatchEvent(new Event('input')); const li = ${sb}.querySelector('.sk-sector-hits li'); return li && li.textContent; })()`);
    expect(/L2/.test(tracked || '') && /2 wanted/.test(tracked || ''), 'and says how many tickets are wanted in a sector that is tracked', tracked);
    await t.eval(`(() => { const i = ${sb}.querySelector('.sk-toolbar .search'); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()`);

    /* ---- a sector eBileta has taken off the page, kept on the event ---- */
    console.log('\n== a sector the site removed, and the price groups');
    await t.eval(`(() => {
      const ev = JSON.parse(sessionStorage.getItem('__ev'));
      const now = Date.now();
      const price = max => ({ min: max, max, currency: 'EUR' });
      const sum = (id, available, max) => { ev.sectors.find(s => s.id === id).summary = { available, total: 100, longest: available, at: now, price: price(max) }; };
      sum('437', 43, 40); sum('440', 0, 25); sum('452', 12, 80);
      ev.sectors.push({ id: '453', code: 'VIP3', name: 'VIP3', meta: { idSM: '1215', tipoM: '1', status: 'soldout', gone: now - 3 * 86400000, price: price(80),
        shape: { points: '900,300 1050,300 1050,420 900,420', vb: '0 0 1504 1059' } } });
      sessionStorage.setItem('__ev', JSON.stringify(ev));
      window.__changed.forEach(f => f({ mirror: {} }, 'local'));
      return true;
    })()`);
    const goneRow = await until(() => t.eval(`(() => { const n = document.querySelectorAll('.sk-eb-gone-item'); return n.length ? [...n].map(x => x.innerText.replace(/\\s+/g, ' ').trim()).join(' | ') : null; })()`), 4000);
    expect(/^VIP3 ?€80\.00 · gone 3 ?d ago/.test(goneRow || ''), 'the removed VIP3 is listed under the sector list with its kept price', goneRow);
    expect(await t.eval(`!!document.querySelector('.sk-eb-gone-item > .sk-eb-badge')`), 'with the same − qty + pill');
    const goneChip = await t.eval(`[...document.querySelectorAll('.sk-eb-free-chip.is-gone')].map(x => x.querySelector('b').textContent).join(',')`);
    expect(goneChip === 'VIP3', 'and in the free-seats strip, marked removed', goneChip);
    const groups = await t.eval(`[...document.querySelectorAll('.sk-eb-price-chip')].map(x => x.firstChild.nextSibling.textContent + ' ' + x.lastChild.textContent).join(' | ')`);
    expect(groups === '€80.00 2 | €40.00 1 | €25.00 1 | No price 11', 'price groups dearest first, the removed sector counted in its own', groups);

    const pick = label => t.eval(`(() => { [...document.querySelectorAll('.sk-eb-price-chip')].find(x => x.textContent.startsWith('${label}')).click(); return true; })()`);
    await pick('€80.00');
    const only80 = await until(() => t.eval(`(() => { const c = [...document.querySelectorAll('.sk-eb-free-chip')].map(x => x.querySelector('b').textContent).join(','); return /€80/.test(document.querySelector('.sk-eb-free-head').textContent) ? c : null; })()`), 3000);
    expect(only80 === 'VIP1,VIP3', 'picking €80 leaves VIP1 and the removed VIP3 in the strip', only80);
    const dimmed = await until(() => t.eval(`(() => {
      const p = [...document.querySelectorAll('polygon:not(.sk-eb-ghost)')];
      const vip3 = document.querySelector('polygon.sk-eb-ghost[data-sk-sec="453"]');
      return p.length && p.every(x => x.classList.contains('sk-eb-dim')) && vip3 && vip3.classList.contains('sk-eb-pick') ? 'all' : null;
    })()`), 3000);
    expect(dimmed === 'all', 'and fades the map\'s sectors at other prices, outlining the removed VIP3 where it was', dimmed);
    const badgesNow = await t.eval(`[...document.querySelectorAll('.sk-eb-map-badge')].map(x => x.dataset.sec).join(',')`);
    expect(badgesNow === '453', 'map badges outside the group go; the removed VIP3 keeps its own, on its kept outline', badgesNow);
    await pick('€25.00');
    const v1 = await until(() => t.eval(`(() => { const p = [...document.querySelectorAll('polygon')].find(x => x.getAttribute('artacom:id') === '440'); return p.classList.contains('sk-eb-pick') && !p.classList.contains('sk-eb-dim') ? 'picked' : null; })()`), 3000);
    expect(v1 === 'picked', '€25 outlines V1 on the map', v1);
    await pick('€25.00');
    const cleared = await until(() => t.eval(`(() => document.querySelectorAll('.sk-eb-free-chip').length === 15 && !document.querySelector('polygon.sk-eb-dim, polygon.sk-eb-pick') ? 'all' : null)()`), 3000);
    expect(cleared === 'all', 'picking it again shows every sector, the removed one too, and clears the map', cleared);

    await t.eval(`(() => { [...document.querySelectorAll('.sk-eb-gone-item > .sk-eb-badge button')].find(b => b.textContent === '+').click(); return true; })()`);
    const bumped = await until(() => t.eval(`__log.find(m => m.type === 'bumpSector')`), 3000);
    expect(!!bumped && bumped.sec === '453', '+ on the removed sector asks for a ticket there', bumped);
    expect(t.errors.length === 0, 'no errors on the page', t.errors);
    console.log('   screenshot:', await t.shot('ebileta-ks-removed.png'));

    /* eBileta took the polygons away with the sectors: the kept outlines go back */
    console.log('\n== removed sectors on the map, where their polygons were');
    await t.eval(`(() => {
      const base = window.__state;
      window.__state = () => {
        const st = base();
        const ev = st.events[0];
        /* bought tickets in the removed VIP3; a request in a sector lost before sectors were kept */
        st.requests.push({ id: 'r2', num: 2, eventKey: ev.key, sec: '453', code: 'VIP3', sectorName: 'VIP3', qty: 3, done: false, bought: true, cats: [], client: '',
          eval: { status: 'BOUGHT', options: 0 }, free: null, buy: null, teamPrices: [] });
        st.requests.push({ id: 'r3', num: 3, eventKey: ev.key, sec: '999', code: '999', sectorName: '999', qty: 1, done: false, cats: [], client: '',
          eval: { status: 'NOT SCANNED', options: 0 }, free: null, buy: null, teamPrices: [] });
        /* another event at the same stadium still has that sector, and its outline */
        st.events.push(Object.assign({}, ev, { key: 'ebileta-ks:1300', num: 2, siteId: '1300', sectors: [
          { id: '999', code: 'W9', name: 'Sektori W9', meta: { idSM: '1300', status: 'high', shape: { points: '1100,600 1200,600 1200,700 1100,700', vb: '0 0 1504 1059' } } }] }));
        return st;
      };
      window.__changed.forEach(f => f({ mirror: {} }, 'local'));
      return true;
    })()`);
    const ghosts = await until(() => t.eval(`(() => { const g = [...document.querySelectorAll('polygon.sk-eb-ghost')].map(p => p.getAttribute('data-sk-sec')).sort().join(','); return g === '453,999' ? g : null; })()`), 4000);
    expect(ghosts === '453,999', 'the kept outline of VIP3, and W9\'s from the other event, are drawn back on the map', ghosts);
    const placed = await until(() => t.eval(`(() => {
      const out = {};
      for (const id of ['453', '999']) {
        const n = document.querySelector('.sk-eb-map-badge[data-sec="' + id + '"]');
        const g = document.querySelector('polygon.sk-eb-ghost[data-sk-sec="' + id + '"]');
        if (!n || !g) return null;
        const a = n.getBoundingClientRect(), b = g.getBoundingClientRect();
        out[id] = { text: n.textContent, cls: n.className, off: Math.round(Math.abs(a.left + a.width / 2 - (b.left + b.width / 2)) + Math.abs(a.top + a.height / 2 - (b.top + b.height / 2))) };
      }
      return out;
    })()`), 4000);
    expect(!!placed && placed['453'].text === 'VIP3|3' && /st-BOUGHT/.test(placed['453'].cls) && /is-gone/.test(placed['453'].cls) && placed['453'].off <= 2,
      'VIP3\'s badge says its 3 bought tickets, centred on its outline', placed && placed['453']);
    expect(!!placed && placed['999'].text === 'W9|1' && placed['999'].off <= 2, 'and the lost sector is badged as W9, named from the other event', placed && placed['999']);
    const lostRow = await t.eval(`[...document.querySelectorAll('.sk-eb-gone-item b')].map(b => b.textContent).join(',')`);
    expect(lostRow === 'Sektori W9,VIP3' || lostRow === 'VIP3,Sektori W9', 'both are listed as removed', lostRow);
    const tipGhost = await hover('453');
    expect(/Removed from the site/.test(tipGhost || '') && /#2 3 tickets · bought/.test(tipGhost || ''), 'hovering its outline: removed, and the bought request', tipGhost);
    const before = await t.eval('location.href');
    await t.eval(`(() => { document.querySelector('.sk-eb-map-badge[data-sec="453"]').click(); return true; })()`);
    const said = await until(() => t.eval(`(() => { const r = ${R}; const n = r && r.querySelector('.statusbar'); return n && /no longer on eBileta/.test(n.textContent) ? n.textContent : null; })()`), 3000);
    expect(!!said && await t.eval('location.href') === before, 'clicking it opens nothing — no seat page — and says why', said);
    expect(t.errors.length === 0, 'no errors on the page', t.errors);
    console.log('   screenshot:', await t.shot('ebileta-ks-ghosts.png'));

    await t.eval(`document.querySelector('li.sett_438 > .sk-eb-badge .sk-open').click(); true`);
    const went = await until(async () => { const h = await t.eval('location.href'); return /scegliPostoPub/.test(h) ? h : null; }, 5000);
    expect(went === 'https://eu.ebileta.al/biglietteria/pub/buyseats/scegliPostoPub.do?idSett=438&idSM=1215&tipoM=1', 'clicking L3\'s number opens L3 on eu.ebileta.al (not al.ebileta.al)', went);
    expect(t.errors.length === 0, 'no errors on the page', t.errors);

    /* the same address, the other shape: a list of events, not one event's sectors */
    console.log('\n== listaEventiPub.do when several events are on sale');
    await t.go(LIST_URL + '?many=1');
    const evRoot = `document.getElementById('sk-host-ebileta-ks')?.shadowRoot`;
    const listed = await until(() => t.eval(`(() => {
      const r = ${evRoot};
      const n = r && r.querySelectorAll('.sk-slot .req .sec');
      return n && n.length ? [...n].map(x => x.textContent).join(' | ') : null;
    })()`), 8000);
    expect(listed === 'Kosova - Republika e Irlandes | Kosova - Austria',
      'the sidebar lists both events on the page', listed);
    const badges = await until(() => t.eval(`document.querySelectorAll('.sk-eb-evbadge').length`), 4000);
    expect(badges === 2, 'and a badge goes on each row', badges);
    const first = await t.eval(`document.querySelector('.sk-eb-evbadge')?.textContent`);
    expect(first === 'not tracked', 'saying it is not tracked yet', first);

    const clicked = await t.eval(`(() => {
      const b = [...${evRoot}.querySelectorAll('button')].find(x => x.textContent.trim() === 'Track');
      if (!b) return 'no Track button';
      b.click();
      return 'clicked';
    })()`);
    expect(clicked === 'clicked', 'the sidebar offers Track on an event that is not tracked', clicked);
    const sent = await until(() => t.eval(`(() => {
      const a = JSON.parse(sessionStorage.getItem('__msgs') || '[]');
      return a.find(x => x.startsWith('trackUrl ')) || null;
    })()`), 5000);
    expect(sent === 'trackUrl https://eu.ebileta.al/biglietteria/pub/buyseats/scegliSettorePub.do?idEvento=50050',
      'Track sends that event\'s own sector page, named by its idEvento', sent);
    expect(t.errors.length === 0, 'and still nothing thrown', t.errors);
  } catch (e) {
    console.log('  ✗ crashed:', e.message);
    failures++;
  } finally { b.close(); }
  console.log(`\n${failures ? '✗ ' + failures + ' FAILED' : '✓ all eBileta Kosovo checks passed'} · ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(failures ? 1 : 0);
})();
