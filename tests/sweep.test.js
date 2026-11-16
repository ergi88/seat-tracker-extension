/* Run with:  node --test tests/
 *
 * eBileta holds stands back and releases them near the date. A scan only reads
 * the sectors somebody has a request in, so a stand nobody is watching can go
 * on sale unnoticed. The sweep reads every sector now and then and says when
 * one that had no free seat has some.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function worker() {
  const src = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const listed = [...(/importScripts\(([\s\S]*?)\);/.exec(src)[1]).matchAll(/'([^']+)'/g)].map(m => m[1]);
  const anything = () => new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : anything()), apply: () => anything(), has: () => true
  });
  const sandbox = { chrome: anything(), fetch: anything(), navigator: { onLine: true }, console, importScripts: () => {} };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of listed.concat('background.js')) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const W = worker();

test('how often each event is swept', () => {
  const eb = { site: 'ebileta', extra: {} };
  const ef = { site: 'efinity', extra: {} };
  assert.equal(W.sweepMinutesOf(eb, {}), 30, 'eBileta is swept by default: it is where stands are held back');
  assert.equal(W.sweepMinutesOf(ef, {}), 0, 'a site that says nothing about sweeping is left alone');
  assert.equal(W.sweepMinutesOf(eb, { sweepMin: 0 }), 0, 'the team can turn it off everywhere');
  assert.equal(W.sweepMinutesOf(eb, { sweepMin: 15 }), 15);
  assert.equal(W.sweepMinutesOf({ site: 'ebileta', extra: { sweepMin: 0 } }, {}), 0, 'and one event can opt out');
  assert.equal(W.sweepMinutesOf({ site: 'efinity', extra: { sweepMin: 20 } }, {}), 20, 'or opt in on a site that is off');
});

test('a sweep never reads what the site says is sold out', () => {
  /* On a big stadium most of the map is shut — the Egnatia event has some
   * fifty sold-out sectors — and reading them every half hour would cost more
   * than everything else the extension does. The event page says they are
   * shut, for nothing, on every load. */
  const src = fs.readFileSync(path.join(ROOT, 'bg/events.js'), 'utf8');
  assert.ok(/scanEvent\(key, 'all', \{ reason: 'sweep' \}\)/.test(src), 'the sweep asks for a scan-all');
  const all = /else if \(scope === 'all'\) ids = ([^;]+);/.exec(src);
  assert.ok(all && /scanAllFilter/.test(all[1]), 'and scan-all leaves out what the site calls sold out');
  assert.ok(!/scope === 'every'/.test(src), 'the scope that read everything is gone');

  const eb = fs.readFileSync(path.join(ROOT, 'sites/ebileta.js'), 'utf8');
  assert.ok(/scanAllFilter\(sector\) \{ return !\(sector\.meta && sector\.meta\.status === 'soldout'\); \}/.test(eb),
    'eBileta is the site that says so, from the availability label on the page');
});

test('a stand going back on sale is read off the page, not scanned for', () => {
  /* dispEsaurita -> soldout, and the label changing is what says a held-back
   * stand has been released. It comes with the sector list every scan already
   * fetches, so it costs nothing and covers the sectors a sweep never reads. */
  const src = fs.readFileSync(path.join(ROOT, 'bg/events.js'), 'utf8');
  const onSale = /function onSaleNow\(m, key\) \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(onSale, 'there is one answer to "what has something to sell"');
  assert.ok(/status === 'soldout'\) continue;/.test(onSale[1]), 'the site saying sold out is enough to leave it out');
  assert.ok(/sum\.available === 0\) continue;/.test(onSale[1]), 'and so is a scan that found it empty');

  const check = /async function checkOpenSectors\(key\) \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(check, 'and something compares it with last time');
  assert.ok(/health\.openAt\n?\s*\?/.test(check[1]) || /health\.openAt$/m.test(check[1]),
    'the first look only learns, so tracking an event does not announce every open sector');
  assert.ok(/watched\.has\(id\)/.test(check[1]), 'a sector with a request alerts through that request');
  assert.ok(/if \(same\) return/.test(check[1]), 'and nothing is written when nothing moved');
  assert.ok(/checkOpenSectors\(key\)\.catch/.test(src), 'it runs on every scan, off the list that was just fetched');
});

test('only a sector that went from none to some is announced', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bg/events.js'), 'utf8');
  const fn = /async function sweepSectors\(key, opts\) \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(fn, 'the sweep is still there');
  const body = fn[1];
  assert.ok(/if \(free <= 0\) continue;/.test(body), 'a sector with nothing free is not news');
  assert.ok(/if \(!was\.has\(String\(id\)\)\) continue;/.test(body),
    'a sector never scanned before has no "was empty" to compare with, so the first sweep only learns');
  assert.ok(/if \(was\.get\(String\(id\)\) > 0\) continue;/.test(body), 'one that already had seats is not an opening');
  assert.ok(/if \(watched\.has\(String\(id\)\)\) continue;/.test(body),
    'and a sector somebody already has a request in alerts through that request, not this');
  assert.ok(/if \(known\.has\(String\(id\)\)\) continue;/.test(body), 'an opening is announced once, not every sweep');
});

test('it reaches the whole team, and says what opened', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bg/alerts.js'), 'utf8');
  const fn = /async function sectorsOpen\(key, opened\) \{([\s\S]*?)\n  \}/.exec(src);
  assert.ok(fn, 'the alert exists');
  assert.ok(/m\.members\.length \? m\.members\.map/.test(fn[1]), 'every member gets it: the sector belongs to no one request');
  assert.ok(/free|longest/.test(fn[1]), 'and it says how many seats and how long a block');

  const SK = require(path.join(ROOT, 'core/util.js'));
  require(path.join(ROOT, 'core/settings.js'));
  const t = SK.settings.notifyType('sectorsOpen');
  assert.ok(t, 'it is a kind you can switch off like any other');
  assert.equal(t.desktop, true);
  assert.equal(t.phone, true);
});

test('one event can be swept differently from the rest', () => {
  /* a popular match puts the whole stadium on sale at once and needs no
   * sweeping; one released a floor at a time wants it often */
  const team = { sweepMin: 30 };
  assert.equal(W.sweepMinutesOf({ site: 'ebileta', extra: {} }, team), 30, 'the default');
  assert.equal(W.sweepMinutesOf({ site: 'ebileta', extra: { sweepMin: 5 } }, team), 5, 'watched closely');
  assert.equal(W.sweepMinutesOf({ site: 'ebileta', extra: { sweepMin: 0 } }, team), 0, 'or left alone entirely');
  /* the whole stadium already on sale: no point reading it every half hour */
  assert.equal(W.sweepMinutesOf({ site: 'ebileta', extra: { sweepMin: 0 } }, { sweepMin: 5 }), 0,
    'the event wins over the team default, in both directions');

  const src = fs.readFileSync(path.join(ROOT, 'bg/events.js'), 'utf8');
  const fn = /async function setEventSweepMin\(key, minutes\) \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(fn, 'and it can be set per event');
  assert.ok(/Object\.assign\(\{\}, ev\.extra \|\| \{\}\)/.test(fn[1]), 'without trampling the rest of the event');
  assert.ok(/delete extra\.sweepMin/.test(fn[1]), 'and cleared back to the default');

  const worker = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  assert.ok(/setEventSweep:|async setEventSweep\(/.test(worker), 'the popup can ask for it');
  assert.ok(/sweepNow:/.test(worker), 'and sweep one event on the spot');
  assert.ok(/SWEEP_PREFIX \+ key, mins/.test(worker), 'each event gets its own timer');
});
