/* Run with:  node --test tests/
 *
 * The shared update link: comparing versions, when a PC is told, and what
 * the Updates form accepts.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/config.js');
const SK = require('../core/update.js');
const Up = SK.update;

test('versions compare part by part as numbers', () => {
  assert.equal(Up.compare('3.1.0', '3.0.0'), 1);
  assert.equal(Up.compare('3.0.0', '3.1'), -1);
  assert.equal(Up.compare('3.10', '3.9'), 1);
  assert.equal(Up.compare('3', '3.0.0'), 0);
  assert.equal(Up.compare('3.0.1', '3.0.1'), 0);
});

test('a PC is told only about a higher version with a link', () => {
  const u = { version: '3.1.0', url: 'https://x.test/st.zip', at: 1 };
  assert.equal(Up.pending(u, '3.0.0'), u);
  assert.equal(Up.pending(u, '3.1.0'), null);
  assert.equal(Up.pending(u, '3.2'), null);
  assert.equal(Up.pending(Object.assign({}, u, { url: '' }), '3.0.0'), null);
  assert.equal(Up.pending(null, '3.0.0'), null);
});

test('outside the extension the installed version is config.js\'s', () => {
  assert.equal(Up.installed(), SK.config.version);
});

test('the form: a Chrome version and an http(s) link', () => {
  const u = Up.clean({ version: ' v3.1.0 ', url: ' https://drive.google.com/file/d/abc/view ', note: ' fixes ' }, 'Ergi', 5);
  assert.deepEqual(u, { version: '3.1.0', url: 'https://drive.google.com/file/d/abc/view', note: 'fixes', at: 5, by: 'Ergi' });
  assert.throws(() => Up.clean({ version: '3.1 beta', url: 'https://x.test' }), /numbers with dots/);
  assert.throws(() => Up.clean({ version: '1.2.3.4.5', url: 'https://x.test' }), /numbers with dots/);
  assert.throws(() => Up.clean({ version: '3.1', url: 'drive.google.com/x' }), /https:\/\//);
  assert.throws(() => Up.clean({ version: '3.1', url: 'javascript:alert(1)' }), /https:\/\//);
  assert.equal(Up.clean({ version: '3.1', url: 'https://x.test', note: 'n'.repeat(500) }).note.length, 300);
});
