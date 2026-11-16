/* Run with:  node --test tests/
 *
 * Seat Tracker reads the ticket sites. The single exception is holding seats
 * on eBileta, which happens in one file, only from a real click, and never
 * more times than you asked for. These check the parts of that which can be
 * checked without a browser — above all that the exception stays one file.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* Every script that reaches into a ticket site's own DOM. The panel's own
 * buttons live in ui/ and content/shell.js and are not in question. */
const siteScripts = () => {
  const out = ['content/act.js', 'content/shell.js'];
  for (const f of fs.readdirSync(path.join(ROOT, 'content/sites'))) {
    if (f.endsWith('.js')) out.push('content/sites/' + f);
  }
  return out;
};

/* Every place the extension is allowed to press something on a site, and why.
 * A third one appearing is what this test exists to catch. */
const ALLOWED = {
  'content/act.js': 'the one press primitive, behind a real click, a budget and an audit log',
  'content/sites/viagogo-event.js': 'pressing viagogo\'s own "Show more" to load the listing list'
};

test('only the named files may act on a ticket site', () => {
  const found = {};
  for (const f of siteScripts()) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (/^\s*(\/\*|\*|\/\/)/.test(line)) continue;
      /* Matching the constructor by name alone is not enough: building it
       * through a variable (new Kind(type, ...)) would slip past, which is
       * exactly how someone would hide one. Any dispatchEvent counts, except
       * a plain new Event — window.dispatchEvent(new Event('resize')) tells
       * the page to re-lay-out and presses nothing. */
      const dispatches = /\.dispatchEvent\s*\(/.test(line) && !/new Event\s*\(/.test(line);
      if (dispatches || /new (Mouse|Pointer|Keyboard|Touch)Event\s*\(/.test(line) || /\w\.click\s*\(\s*\)/.test(line)) {
        (found[f] = found[f] || []).push(i + 1);
      }
    }
  }
  const unexpected = Object.keys(found).filter(f => !ALLOWED[f]);
  assert.deepEqual(unexpected, [],
    'these would also act on a site, and nothing says they may:\n  ' + unexpected.map(f => f + ' line ' + found[f]).join('\n  '));
  for (const f of Object.keys(ALLOWED)) {
    assert.ok(found[f], `${f} no longer acts on a site — drop it from the list (${ALLOWED[f]})`);
  }
});

test('a site\'s own act file only decides what to press, never presses', () => {
  /* eBileta and eFinity differ on what a seat is and how a chosen one looks,
   * but neither dispatches anything: they hand the element to content/act.js,
   * which is where the real click, the ceiling and the log live. */
  for (const f of ['content/sites/ebileta-act.js', 'content/sites/efinity-act.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(/SK\.act|A\.pressAndCheck/.test(src), `${f} goes through the shared press`);
    const code = src.split('\n').filter(l => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n');
    assert.ok(!/\.dispatchEvent\s*\(/.test(code) && !/new (Mouse|Pointer)Event/.test(code),
      `${f} dispatches nothing of its own`);
  }
});

test('holding seats is off until it is switched on, and only on this PC', () => {
  const SK = require(path.join(ROOT, 'core/util.js'));
  require(path.join(ROOT, 'core/settings.js'));
  const d = SK.settings.normalize({});
  assert.equal(d.selectSeats, false, 'off by default: the extension only reads until you say otherwise');
  assert.equal(SK.settings.normalize({ selectSeats: true }).selectSeats, true);
  assert.equal(SK.settings.normalize({ selectSeats: 'yes' }).selectSeats, false, 'and only a real yes counts');
  assert.equal(SK.settings.scopeOf('selectSeats'), 'device', 'it is this PC that would be clicking');
});

test('the act file says what it will not do', () => {
  const src = fs.readFileSync(path.join(ROOT, 'content/act.js'), 'utf8');
  assert.ok(/TICKETS_PER_MIN\s*=\s*\d+/.test(src), 'a ceiling on how fast seats can be taken');
  assert.ok(/isTrusted|sessionStorage/.test(src), 'a write is tied to a real click');
  assert.ok(!/fetch\s*\(|XMLHttpRequest/.test(src), 'it never talks to the site behind your back');
  assert.ok(!/submit\s*\(|\.form\.submit/.test(src), 'and never submits anything');
});

test('a reserve goes to the request\'s own sector, never the open one', () => {
  /* The bug this replaces: pressing Reserve on a request for E105 while
   * looking at S103 held ten seats in S103. The sector a request names is
   * the only sector it can be filled from. */
  const src = fs.readFileSync(path.join(ROOT, 'content/sites/ebileta-seats.js'), 'utf8');
  const fn = /onReserve:\s*\(r, qty\)\s*=>\s*\{([\s\S]*?)\n    \},/.exec(src);
  assert.ok(fn, 'the seat page still decides where a reserve goes');
  assert.ok(/String\(r\.sec\) === String\(idSett\)/.test(fn[1]),
    'it compares the request\'s sector with the open one before holding anything');
  assert.ok(/leaveTicket|location\.href/.test(fn[1]),
    'and sends it to that sector\'s page when they differ');

  const sectors = fs.readFileSync(path.join(ROOT, 'content/sites/ebileta-sectors.js'), 'utf8');
  assert.ok(/sections\.find\(x => x\.id === String\(r\.sec\)\)/.test(sectors),
    'the sector list opens the request\'s own sector too');
});

test('a quantity may be smaller than the request', () => {
  /* ten wanted, four already sold: hold four */
  const src = fs.readFileSync(path.join(ROOT, 'ui/components.js'), 'utf8');
  assert.ok(/reserve-line/.test(src), 'the card carries its own quantity box');
  assert.ok(/Math\.max\(1, parseInt\(qty\.value, 10\) \|\| r\.qty\)/.test(src),
    'what is typed wins, and the request is only the starting point');
  assert.ok(/ctx\.canReserve \|\| ctx\.canReserve\(r\)|!ctx\.canReserve \|\| ctx\.canReserve\(r\)/.test(src),
    'and the button is not drawn where it could not work');
});

test('seats can be held in a sector with no request at all', () => {
  const src = fs.readFileSync(path.join(ROOT, 'content/sites/ebileta-seats.js'), 'utf8');
  const fn = /function holdBox\(ctx, ev\) \{([\s\S]*?)\n  \}/.exec(src);
  assert.ok(fn, 'the seat page offers a Hold box of its own');
  assert.ok(/reserve\(n, 'no request'\)/.test(fn[1]), 'which reserves without needing one');
  assert.ok(/actState\(\)/.test(fn[1]), 'still only where the page may act');
  assert.ok(/go\.disabled = !can/.test(fn[1]), 'and says so instead of failing when it may not');
});
