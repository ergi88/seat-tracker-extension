/* ------------------------------------------------------------------
 * Seat Tracker - shared update link
 *
 * One member puts the link to a new Seat Tracker zip in the popup's Updates
 * section, with its version number. It is kept in team_settings.data.update,
 * which every signed-in PC already syncs, so each PC sees it within a minute
 * and compares it with the version it runs (manifest.json's "version").
 *
 *   update = { version: '3.1.0', url: 'https://…', note: '', at: ms, by: 'Ergi' }
 * ------------------------------------------------------------------ */
(function (root) {
  'use strict';
  const SK = root.SK = root.SK || {};

  const VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/;   // what Chrome accepts in manifest.json

  /* the version this copy runs: manifest.json's, so there is only one number to bump */
  function installed() {
    try {
      const v = root.chrome && root.chrome.runtime && root.chrome.runtime.getManifest && root.chrome.runtime.getManifest().version;
      if (typeof v === 'string' && v) return v;
    } catch (e) { /* not in the extension (tests) */ }
    return (SK.config && SK.config.version) || '0';
  }

  /* -1, 0 or 1, part by part as numbers: 3.10 is newer than 3.9 */
  function compare(a, b) {
    const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  /* the shared update, only if it is newer than what runs here */
  function pending(update, have) {
    return update && update.url && update.version && compare(update.version, have) > 0 ? update : null;
  }

  /* what the form sent, checked: a version Chrome accepts and an http(s) link */
  function clean(input, by, now) {
    const version = String((input && input.version) || '').trim().replace(/^v/i, '');
    const url = String((input && input.url) || '').trim();
    const note = String((input && input.note) || '').trim().slice(0, 300);
    if (!VERSION_RE.test(version)) throw new Error('The version must be numbers with dots, like 3.1.0 (the "version" in manifest.json).');
    let u;
    try { u = new URL(url); } catch (e) { u = null; }
    if (!u || !/^https?:$/.test(u.protocol)) throw new Error('The link must start with https:// (Google Drive, WeTransfer, Dropbox, GitHub…).');
    return { version, url: u.href, note, at: now || Date.now(), by: String(by || '') };
  }

  SK.update = { VERSION_RE, installed, compare, pending, clean };
  if (typeof module === 'object' && module.exports) module.exports = SK;
})(globalThis);
