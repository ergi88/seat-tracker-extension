/* Run with:  node --test tests/
 *
 * Reading a stadium before following it. Nothing about the team's data may
 * change just because a page was looked at — that rule holds everywhere else,
 * and the shared scans table is keyed to an event that does not exist yet.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'bg/events.js'), 'utf8');
const body = (/async function previewScan\(url\) \{([\s\S]*?)\n\}/.exec(src) || [])[1];

test('a stadium can be read without tracking it', () => {
  assert.ok(body, 'previewScan is there');
  assert.ok(/SK\.eventForUrl/.test(body), 'it works out which event the page is');
  assert.ok(/site\.loadEvent/.test(body) && /site\.scan/.test(body), 'through the same adapter every site already has');
  assert.ok(/if \(m\.events\[hit\.key\]\) throw/.test(body),
    'and refuses on a tracked event, which has Scan all sectors of its own');
});

test('looking at a page still adds nothing to the team', () => {
  /* the whole point: no event row, no shared scan, no catalog entry */
  assert.ok(!/Remote\.(insertEvent|saveScans|saveHealth|upsertCatalog|insertCatalog)/.test(body),
    'previewScan writes nothing to Supabase');
  /* and it really stores it: patch() only describes a write, so this once
   * asserted the broken line and passed because of it */
  assert.ok(/withLocal\(store => \{/.test(body) && /return patch\(\{ previews \}\);/.test(body),
    'it keeps the answer on this PC, through withLocal, which is what writes');
  assert.ok(!/await patch\(/.test(body), 'never awaiting a patch, which stores nothing');
  assert.ok(/PREVIEW_MAX_AGE/.test(src), 'and lets it go stale rather than pretending it is current');
});

test('it reads what a Scan all would read, and no more', () => {
  assert.ok(/scanAllFilter/.test(body),
    'a sector the site calls sold out is left alone, exactly as on a tracked event');
  assert.ok(/packed\[id\] = SK\.rules\.packScan\(id, r\.seats, site\.rowOrder\)/.test(body) && /blocksFor\(packed\[id\]/.test(body),
    'and the free seats are counted the same way');
  assert.ok(/ev\.extra = Object\.assign\(\{\}, ev\.extra, loaded\.extra\)/.test(body),
    'what loading found (Posttick\'s chart keys) reaches the scan — without it Posttick could not be read untracked');
  assert.ok(/SK\.face\.build\(/.test(body), 'and the face values to hand to viagogo are built from the same scans');
});

test('the map shows three different things, and stays quiet about the fourth', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'content/sites/ebileta-sectors.js'), 'utf8');
  assert.ok(/const spare = !qty && !empty && sum && !sum\.unmapped && sum\.available > 0;/.test(ui),
    'read, has seats, nobody asked -> its own badge');
  assert.ok(/String\(empty \? 0 : spare \? sum\.available : qty\)/.test(ui),
    'and the number on it is what is free, not what is wanted');
  assert.ok(/if \(!qty && !empty && !spare\) \{ if \(node\) node\.remove\(\); continue; \}/.test(ui),
    'a sector nobody has read gets no badge at all');
  assert.ok(/previewOf\(st\)/.test(ui), 'and a stadium read without tracking it draws them too');
});
