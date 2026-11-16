/* Run with:  node --test tests/
 *
 * Desktop alerts are decided per PC. A PC starts silent — signing in on a
 * machine must not make it start shouting — and whichever PC found a change,
 * every PC decides for itself whether to put it on screen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SK = require(path.join(ROOT, 'core/util.js'));
require(path.join(ROOT, 'core/settings.js'));

const cfg = over => SK.settings.normalize(over || {});
const shows = (c, type, at) => SK.settings.showsHere(c, type, at).show;

test('a PC is silent until someone turns it on', () => {
  const d = cfg();
  assert.equal(d.pcNotify.mode, 'off');
  for (const t of SK.settings.NOTIFY_TYPES) {
    assert.equal(shows(d, t.key), false, `${t.key} stays off on a fresh PC`);
  }
  assert.equal(SK.settings.showsHere(d, 'available').why, 'desktop alerts are off on this PC',
    'and it says why rather than looking broken');
});

test('"follow mine" is the old behaviour, exactly', () => {
  const c = cfg({ pcNotify: { mode: 'follow' } });
  assert.equal(shows(c, 'available'), true, 'a kind your account has on');
  assert.equal(shows(c, 'summary'), false, 'and one it has off');
  const off = cfg({ pcNotify: { mode: 'follow' }, notify: { available: { desktop: false } } });
  assert.equal(shows(off, 'available'), false, 'switching it off for the account switches it off here');
});

test('"its own" overrides the account, both ways', () => {
  const on = cfg({ notify: { summary: { desktop: false } }, pcNotify: { mode: 'custom', desktop: { summary: true } } });
  assert.equal(shows(on, 'summary'), true, 'a PC can show a kind the account has off');
  const off = cfg({ pcNotify: { mode: 'custom', desktop: { available: false } } });
  assert.equal(shows(off, 'available'), false, 'and hide one it has on');
  const untouched = cfg({ pcNotify: { mode: 'custom' } });
  assert.equal(shows(untouched, 'available'), true, 'anything not set here follows the account');
});

test('quiet hours belong to the PC, and let the urgent one through', () => {
  const night = new Date('2026-10-06T01:30:00');
  const day = new Date('2026-10-06T13:00:00');
  const c = cfg({ pcNotify: { mode: 'custom', quiet: { enabled: true, from: '23:00', to: '08:00' } } });
  assert.equal(shows(c, 'low', night), false, 'a warning waits until morning');
  assert.equal(shows(c, 'low', day), true, 'and comes through in the day');
  assert.equal(shows(c, 'available', night), true, 'tickets available now is let through by default');
  const strict = cfg({ pcNotify: { mode: 'custom', quiet: { enabled: true, from: '23:00', to: '08:00', allowAvailable: false } } });
  assert.equal(shows(strict, 'available', night), false, 'unless you say otherwise');
});

test('it is this PC that decides, and nothing else changes', () => {
  assert.equal(SK.settings.scopeOf('pcNotify'), 'device', 'so it never syncs to another PC');
  assert.equal(SK.settings.scopeOf('notify'), 'user', 'while the account keeps its own switches');
  assert.equal(SK.settings.scopeOf('phoneTopic'), 'user', 'and the phone is not a PC');

  /* both places a notification can appear ask the same question */
  const worker = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const notify = fs.readFileSync(path.join(ROOT, 'bg/notify.js'), 'utf8');
  assert.ok(/showsHere\(cfg, r\.type\)/.test(worker), 'an alert synced from another PC is gated here');
  assert.ok(/showsHere\(cfg, type\)/.test(notify), 'and one this PC found itself');
  assert.ok(/insertAlert\(/.test(notify), 'the alert is still recorded, so a PC that is on can show it');
});
