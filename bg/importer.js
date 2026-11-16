/* ------------------------------------------------------------------
 * Seat Tracker - export and import (service worker)
 *
 * Export saves YOUR requests (and the events they are in) and your
 * settings. Import adds requests to YOUR account from:
 *   - this extension's export                   (kind: "seat-tracker")
 *   - the old eFinity / Posttick / eBileta trackers' exports
 *   - this PC's data from the single-user version (importLegacy)
 * Nothing is removed; a request imported before is skipped; imported
 * requests get your next numbers. Topics are only copied into topics that
 * are still empty.
 * ------------------------------------------------------------------ */
'use strict';

const Backup = (() => {
  const EFINITY_OLD = { siteId: '32286', slug: 'senidah_cair_32286', title: 'SENIDAH - SC Cair, 22.10.2026' };
  const LEGACY_KEYS = ['settings', 'events', 'requests', 'numbers', 'scans', 'lastEval', 'alertLog', 'health',
    'catalog', 'catalogCheckedAt', 'cmdState', 'snoozeUntil', 'digest', 'schema'];

  async function exportAll(userId) {
    const m = await model();
    const mine = m.requests.filter(r => r.userId === userId);
    const events = {};
    for (const r of mine) {
      const ev = m.events[r.eventKey];
      if (ev) events[ev.key] = { key: ev.key, site: ev.site, siteId: ev.siteId, title: ev.title, date: ev.date, extra: ev.extra, autoMin: ev.autoMin };
    }
    return {
      kind: 'seat-tracker', version: 2, exportedAt: new Date().toISOString(),
      settings: SK.settings.userPart((m.profiles[userId] || {}).settings || {}),
      events,
      requests: mine.map(r => ({ id: r.id, eventKey: r.eventKey, num: r.num, sec: r.sec, qty: r.qty, cats: r.cats, client: r.client, listing: r.listing, warn: r.warn, opts: r.opts, together: r.together, done: r.done, bought: !!r.bought, createdAt: r.createdAt }))
    };
  }

  function detect(d) {
    if (!d || typeof d !== 'object') return null;
    if (d.kind === 'seat-tracker') return 'own';
    if (d.kind === 'efinity-seat-tracker') return 'efinity';
    if (d.event && d.event.eventKey && Array.isArray(d.requests)) return 'posttick';
    if (d.requests && !Array.isArray(d.requests) && typeof d.requests === 'object') return 'ebileta';
    return null;
  }

  /* -> { events: [{ site, siteId, hint, autoMin }], requests: [...], topics, settings, deviceSettings } */
  function convert(kind, d) {
    const out = { events: [], requests: [], topics: {}, settings: null, deviceSettings: null };
    const base = r => ({
      id: String(r.id || SK.util.newId('r')),
      qty: r.qty, client: r.client || '', listing: r.listing || '', warn: r.warn, together: r.together !== false,
      done: !!r.done, bought: !!r.bought, createdAt: r.createdAt || Date.now()
    });

    if (kind === 'own') {
      for (const ev of Object.values(d.events || {})) {
        out.events.push({ site: ev.site, siteId: ev.siteId, autoMin: ev.autoMin, hint: { title: ev.title, date: ev.date, extra: ev.extra, sectors: ev.sectors } });
      }
      const order = (d.numbers && d.numbers.req) || {};
      out.requests = (d.requests || []).slice()
        .sort((a, b) => (a.num || order[a.id] || 1e9) - (b.num || order[b.id] || 1e9))
        .map(r => Object.assign(base(r), { eventKey: r.eventKey, sec: r.sec, cats: (r.cats || []).map(String), opts: r.opts }));
      out.settings = d.settings ? SK.settings.userPart(d.settings) : null;
      out.deviceSettings = d.settings ? SK.settings.devicePart(d.settings) : null;
      return out;
    }

    if (kind === 'efinity') {
      const key = SK.eventKey('efinity', EFINITY_OLD.siteId);
      out.events.push({ site: 'efinity', siteId: EFINITY_OLD.siteId, hint: { title: EFINITY_OLD.title, extra: { slug: EFINITY_OLD.slug } } });
      const order = d.numbers || {};
      out.requests = (d.requests || []).slice().sort((a, b) => (order[a.id] || 1e9) - (order[b.id] || 1e9))
        .map(r => Object.assign(base(r), { eventKey: key, sec: r.sec, cats: [], opts: r.opts }));
      const st = d.settings || {};
      out.topics = { phoneTopic: st.phoneTopic, cmdTopic: st.commandTopic };
      return out;
    }

    if (kind === 'posttick') {
      const siteId = SK.site('posttick').eventFromUrl(d.event.url || '');
      if (!siteId) throw new Error('the Posttick export has no event link');
      const key = SK.eventKey('posttick', siteId);
      out.events.push({ site: 'posttick', siteId, hint: {} });
      const order = d.numbers || {};
      out.requests = (d.requests || []).slice().sort((a, b) => (order[a.id] || 1e9) - (order[b.id] || 1e9))
        .map(r => Object.assign(base(r), { eventKey: key, sec: r.sec, cats: (r.cats || []).map(String), opts: r.opts }));
      const st = d.settings || {};
      out.topics = { phoneTopic: st.phoneTopic, cmdTopic: st.cmdTopic };
      return out;
    }

    if (kind === 'ebileta') {
      const order = (d.nums && d.nums.req) || {};
      for (const [idEvento, list] of Object.entries(d.requests)) {
        const old = (d.events || {})[idEvento] || {};
        const cat = (d.catalog || {})[idEvento] || {};
        const sectors = (old.sections || []).map(s => SK.ebileta.toSector(s));
        out.events.push({ site: 'ebileta', siteId: idEvento, hint: { title: old.title || cat.title, date: cat.date, sectors } });
        const key = SK.eventKey('ebileta', idEvento);
        for (const r of list || []) {
          out.requests.push(Object.assign(base(r), { eventKey: key, sec: String(r.sectionId), cats: [], opts: r.minOptions, _order: order[r.id] || 1e9 }));
        }
      }
      out.requests.sort((a, b) => a._order - b._order || a.createdAt - b.createdAt);
      out.requests.forEach(r => delete r._order);
      const st = d.settings || {};
      out.topics = { phoneTopic: st.ntfyTopic, cmdTopic: st.cmdTopic };
      return out;
    }
    throw new Error('unknown file');
  }

  async function importData(d, userId) {
    if (!userId) throw new Error('Sign in first.');
    const kind = detect(d);
    if (!kind) throw new Error('Not a Seat Tracker export (new or old).');
    const c = convert(kind, d);

    for (const e of c.events) {
      const ev = await registerEvent(e.site, e.siteId, e.hint);
      if (e.autoMin !== undefined && e.autoMin !== null && (ev.autoMin === undefined || ev.autoMin === null)) await setEventAutoMin(ev.key, e.autoMin);
    }

    const m = await model();
    const cfg = m.settingsFor(userId);
    const U = SK.util;
    const have = new Set(m.requests.map(r => r.id));
    const rows = c.requests
      .filter(r => !have.has(r.id) && m.events[r.eventKey])
      .map(r => ({
        id: r.id, user_id: userId, event_key: r.eventKey, sec: String(r.sec),
        qty: U.clampInt(r.qty, 1, 1, 9999),
        cats: Array.isArray(r.cats) ? r.cats.map(String) : [],
        client: String(r.client || ''),
        listing: U.listingId(r.listing),
        warn: U.clampInt(r.warn, cfg.defaultWarn, 0, 9999),
        opts: U.clampInt(r.opts, cfg.defaultOpts, 0, 9999),
        together: r.together !== false, done: !!r.done, bought: !!r.bought
      }));
    const inserted = await Remote.insertRequests(rows);

    /* settings: a Seat Tracker export restores yours; old files only fill empty topics */
    const current = Object.assign({}, (m.profiles[userId] || {}).settings || {});
    let changed = false;
    if (c.settings && Object.keys(c.settings).length) {
      Object.assign(current, c.settings, { archivedEvents: current.archivedEvents || [] });
      changed = true;
    }
    for (const k of ['phoneTopic', 'cmdTopic']) {
      if (c.topics[k] && !current[k]) { current[k] = String(c.topics[k]).trim(); changed = true; }
    }
    if (changed) await Remote.saveProfile(userId, { settings: current });
    if (c.deviceSettings && Object.keys(c.deviceSettings).length) {
      await withLocal(s => patch({ deviceSettings: Object.assign({}, c.deviceSettings, s.deviceSettings || {}) }), ['deviceSettings']);
    }

    /* judge the imported requests against the latest scans */
    for (const key of [...new Set(inserted.filter(r => !r.done).map(r => r.eventKey))]) {
      scanEvent(key, 'tracked', { reuse: true }).catch(() => {});
    }
    await syncAlarms();
    await updateBadge();
    return { kind, added: inserted.length, skipped: c.requests.length - inserted.length, events: c.events.length };
  }

  /* ---------------- data from the single-user version --------------- */

  async function legacyData() {
    const got = await chrome.storage.local.get(['requests', 'events', 'numbers', 'settings']);
    if (!Array.isArray(got.requests) || !got.requests.length) return null;
    return { kind: 'seat-tracker', version: 1, events: got.events || {}, requests: got.requests, numbers: got.numbers || {}, settings: got.settings || {} };
  }

  async function hasLegacy() { return !!(await legacyData()); }

  async function importLegacy(userId) {
    const data = await legacyData();
    if (!data) return { kind: 'legacy', added: 0, skipped: 0, events: 0 };
    const result = await importData(data, userId);
    await chrome.storage.local.remove(LEGACY_KEYS);
    return Object.assign(result, { kind: 'legacy' });
  }

  return { exportAll, importData, detect, hasLegacy, importLegacy };
})();
