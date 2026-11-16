/* Run with:  node --test tests/
 *
 * The service worker loads background.js and every bg/*.js into one scope
 * through importScripts, so two files (or one file twice) declaring the same
 * name silently replace each other — the last one wins, everywhere. That is
 * how every alert's link once became a Promise: a second eventUrlOf() took
 * the name of the first, and only ntfy noticed, with a 400.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const workerFiles = () => {
  const bg = fs.readdirSync(path.join(ROOT, 'bg')).filter(f => f.endsWith('.js')).map(f => 'bg/' + f);
  return ['background.js', ...bg];
};

/* top-level declarations only: no leading spaces */
function declaredIn(file) {
  const out = [];
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  src.split('\n').forEach((line, i) => {
    const fn = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/.exec(line);
    const cn = /^(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/.exec(line);
    const name = (fn && fn[1]) || (cn && cn[1]);
    if (name) out.push({ name, file, line: i + 1 });
  });
  return out;
}

test('nothing in the service worker is declared twice', () => {
  const all = workerFiles().flatMap(declaredIn);
  const by = new Map();
  for (const d of all) by.set(d.name, (by.get(d.name) || []).concat(d));
  const clashes = [...by.values()].filter(list => list.length > 1)
    .map(list => `${list[0].name}: ${list.map(d => `${d.file}:${d.line}`).join(' and ')}`);
  assert.deepEqual(clashes, [], 'these names would quietly replace each other');
});

test('every file the worker imports is there', () => {
  const src = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const block = /importScripts\(([\s\S]*?)\);/.exec(src);
  assert.ok(block, 'background.js still calls importScripts');
  const listed = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(listed.length > 5);
  for (const f of listed) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is imported but missing`);
  for (const f of workerFiles().filter(x => x !== 'background.js')) {
    assert.ok(listed.includes(f), `${f} sits in bg/ but is never imported`);
  }
});

test('an event turns into an address, not a promise', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bg/events.js'), 'utf8');
  const fn = /\nfunction eventUrlOf\(ev\) \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(fn, 'eventUrlOf(event) is still there');
  assert.ok(!/async function eventUrlOf/.test(src), 'and nothing else has taken its name');
  /* alerts put its result straight into a notification link */
  const alerts = fs.readFileSync(path.join(ROOT, 'bg/alerts.js'), 'utf8');
  assert.ok(/click: eventUrlOf\(ev\)/.test(alerts));
});

/* Loading every worker script into one context, in the order the worker does.
 * Catches what a syntax check cannot: something that throws while it is being
 * defined, or a name one file expects and another never made. */
test('the whole service worker evaluates, top to bottom', () => {
  const vm = require('node:vm');
  const src = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const listed = [...(/importScripts\(([\s\S]*?)\);/.exec(src)[1]).matchAll(/'([^']+)'/g)].map(m => m[1]);

  /* a Chrome that answers to anything, so listeners can be registered */
  const anything = () => new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : anything()),
    apply: () => anything(),
    has: () => true
  });
  /* the scripts are loaded here in the same order, so the call itself does nothing */
  const sandbox = { chrome: anything(), fetch: anything(), navigator: { onLine: true }, console, importScripts: () => {} };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);

  for (const f of listed.concat('background.js')) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotThrow(() => vm.runInContext(code, ctx, { filename: f }), `${f} throws while loading`);
  }
  /* and the pieces the rest of the worker leans on are really there */
  for (const name of ['util', 'rules', 'settings', 'profit', 'team', 'viagogo', 'ebileta']) {
    assert.ok(ctx.SK[name], `SK.${name} is missing after loading`);
  }
  assert.equal(typeof ctx.SK.registerSite, 'function');
  assert.ok(Object.keys(ctx.SK.sites).length >= 4, 'every site adapter registered itself');
  assert.equal(typeof ctx.eventUrlOf, 'function');
  assert.equal(typeof ctx.resolveEventUrl, 'function');
  assert.equal(ctx.eventUrlOf.constructor.name, 'Function', 'eventUrlOf is not async — its result goes straight into a notification link');
});

/* patch() builds a description of a write; withLocal is what performs one.
 * `await patch(...)` therefore stores nothing and says nothing — it cost two
 * features that looked finished (a stadium read without tracking it, and the
 * cart hold that pauses scans) before anyone noticed. */
test('nothing pretends to write to local storage', () => {
  const offenders = [];
  for (const f of workerFiles()) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\*|\*|\/\/)/.test(line)) return;
      if (/await\s+patch\s*\(/.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [],
    'patch() only describes a write — return it from a withLocal callback:\n  ' + offenders.join('\n  '));

  /* and every patch that is written is returned from one */
  const src = fs.readFileSync(path.join(ROOT, 'bg/events.js'), 'utf8');
  assert.ok(/withLocal\(store => \{[\s\S]*?return patch\(\{ previews \}\);[\s\S]*?\}, \['previews'\]\)/.test(src),
    'the stadium read without tracking it is stored through withLocal');
  assert.ok(/withLocal\(store => \{[\s\S]*?return patch\(\{ cartHolds: holds \}\);[\s\S]*?\}, \['cartHolds'\]\)/.test(src),
    'and so is the cart hold that pauses scans');
});

/* Taking old PCs off the team's list: never this PC, never one online now. */
test('deleteDevices removes only old PCs, never this one or one online', async () => {
  const vm = require('node:vm');
  const src = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const listed = [...(/importScripts\(([\s\S]*?)\);/.exec(src)[1]).matchAll(/'([^']+)'/g)].map(m => m[1]);
  const anything = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : anything()), apply: () => anything(), has: () => true });
  const sandbox = { chrome: anything(), fetch: anything(), navigator: { onLine: true }, console, importScripts: () => {} };
  sandbox.globalThis = sandbox; sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of listed.concat('background.js')) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

  const now = Date.now();
  ctx.__devices = [
    { id: 'me', lastSeen: now }, { id: 'live', lastSeen: now - 30000 },
    { id: 'old', lastSeen: now - 40 * 86400000 }, { id: 'laptop', lastSeen: now - 3 * 3600000 }];
  ctx.__sent = null;
  vm.runInContext(`
    model = async () => ({ devices: __devices });
    ensureDevice = async () => ({ id: 'me' });
    Remote.deleteDevices = async ids => { __sent = ids; return ids.length; };`, ctx);
  const H = vm.runInContext('HANDLERS', ctx);

  const r = await H.deleteDevices({ ids: ['me', 'live', 'old', 'laptop', 'nope'] });
  assert.deepEqual([...ctx.__sent], ['old', 'laptop'], 'this PC, an online PC and an unknown id stay');
  assert.equal(r.removed, 2);
  await assert.rejects(() => H.deleteDevices({ ids: ['me', 'live'] }), /Nothing to remove/);
});
