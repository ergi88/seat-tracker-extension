/* ------------------------------------------------------------------
 * Seat Tracker - the team's shared data in Supabase (service worker)
 *
 * pull() asks sync_status() which tables changed and only fetches those
 * (only rows newer than last time where possible, a full reload every ~10
 * minutes). Every write updates the local mirror straight away, so this
 * PC's screens do not wait for the next pull.
 * ------------------------------------------------------------------ */
'use strict';

const Remote = (() => {
  const iso = ts => (ts ? new Date(ts).toISOString() : null);
  const enc = v => encodeURIComponent(String(v));
  const eq = (col, v) => `${col}=eq.${enc(v)}`;
  const inList = (col, values) => `${col}=in.(${values.map(v => enc('"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',')})`;
  const time = v => (v ? Date.parse(v) : 0);
  const first = rows => (Array.isArray(rows) ? rows[0] : rows) || null;

  /* ---------------- rows -> local shapes ----------------------------- */

  const toEvent = r => ({
    key: r.key, num: r.num, site: r.site, siteId: r.site_id, title: r.title || '', date: r.date || '',
    sectors: r.sectors || [], extra: r.extra || {}, cats: r.cats || {},
    autoMin: r.auto_min === undefined ? null : r.auto_min, createdBy: r.created_by, createdAt: time(r.created_at)
  });

  const toRequest = r => ({
    id: r.id, userId: r.user_id, eventKey: r.event_key, num: r.num, sec: r.sec, qty: r.qty,
    cats: (r.cats || []).map(String), client: r.client || '', listing: r.listing || '',
    warn: r.warn, opts: r.opts, together: r.together !== false, done: !!r.done, bought: !!r.bought, createdAt: time(r.created_at),
    buyPrice: r.buy_price === null || r.buy_price === undefined ? null : Number(r.buy_price), buyCurrency: r.buy_currency || 'ALL'
  });

  const numOr = v => (v === null || v === undefined || v === '' ? null : Number(v));

  const toListing = r => ({
    id: r.listing_id, userId: r.user_id, eventKey: r.event_key || null, sectorId: r.sector_id || null, vgEventId: r.vg_event_id || '',
    title: r.title || '', when: r.event_when || '', section: r.section || '', row: r.row_label || '', status: r.status || '',
    currency: r.currency || '', price: numOr(r.price), payout: numOr(r.payout), tickets: numOr(r.tickets),
    performance: r.performance || '', history: r.history || [],
    seenAt: time(r.seen_at), seenBy: r.seen_by || '', venue: r.venue || '',
    /* v4: 'auto' | 'off' — a listing you already hold the tickets for is 'off' */
    track: r.track === 'off' ? 'off' : 'auto',
    lastSweepAt: time(r.last_sweep_at),
    /* what these tickets cost you, typed on the listing: beats the site's price */
    buyPrice: numOr(r.buy_price), buyCurrency: r.buy_currency || 'ALL',
    /* viagogo's PreDelivered: tickets uploaded (null: not read yet, or a database without the column) */
    uploaded: r.uploaded === true ? true : r.uploaded === false ? false : null
  });

  /* one sale from My Sales (owner-only rows) */
  const toSale = r => ({
    id: r.sale_id, userId: r.user_id, eventKey: r.event_key || null, sectorId: r.sector_id || null,
    vgEventId: r.vg_event_id || '', listingId: r.listing_id || null, title: r.title || '', when: r.event_when || '',
    venue: r.venue || '', section: r.section || '', row: r.row_label || '', seats: r.seats || '', tickets: numOr(r.tickets),
    currency: r.currency || 'USD', amount: numOr(r.amount), status: r.status || '',
    soldOn: r.sold_on ? String(r.sold_on).slice(0, 10) : '',
    buyPrice: numOr(r.buy_price), buyCurrency: r.buy_currency || 'ALL', seenAt: time(r.seen_at)
  });

  /* viagogo's "just sold" toast, as a sell page showed it (the team's) */
  const toLastSale = r => ({
    id: String(r.id), vgKey: r.vg_key || '', vgEventId: r.vg_event_id || '', eventKey: r.event_key || null, sectorId: r.sector_id || null,
    title: r.title || '', when: r.event_when || '', section: r.section || '', row: r.row_label || '',
    tickets: numOr(r.tickets), price: numOr(r.price), currency: r.currency || '',
    firstSeen: time(r.first_seen), lastSeen: time(r.last_seen), seenCount: Number(r.seen_count) || 1,
    seenBy: r.seen_by || '', userId: r.user_id || null, listingId: r.listing_id || ''
  });

  /* what the team sees of a listing: no payout */
  const toTeamPrice = r => ({
    id: r.listing_id, userId: r.user_id, eventKey: r.event_key || null, sectorId: r.sector_id || null, section: r.section || '',
    row: r.row_label || '', status: r.status || '', currency: r.currency || '', price: numOr(r.price), tickets: numOr(r.tickets),
    seenAt: time(r.seen_at),
    /* not there before the schema re-run: '' */
    vgEventId: r.vg_event_id || '', title: r.title || '', when: r.event_when || ''
  });

  const toState = r => ({
    status: r.status, options: r.options, free: r.free, pendingGone: !!r.pending_gone,
    alertLog: r.alert_log || {}, scanAt: time(r.scan_at), version: r.version
  });

  /* the buy tracker: your ticket-site logins and what each bought (owner-only rows) */
  const toAccount = r => ({
    id: r.id, userId: r.user_id, email: r.email || '', firstName: r.first_name || '', lastName: r.last_name || '',
    birthday: r.birthday ? String(r.birthday).slice(0, 10) : '', notes: r.notes || ''
  });
  const toPurchase = r => ({
    id: r.id, userId: r.user_id, accountId: r.account_id, eventKey: r.event_key, requestId: r.request_id || null,
    sectorId: r.sector_id || null, qty: Number(r.qty) || 1, price: numOr(r.price), currency: r.currency || 'ALL',
    boughtOn: r.bought_on ? String(r.bought_on).slice(0, 10) : '', orderRef: r.order_ref || '', notes: r.notes || ''
  });

  /* the team's price list: what a ticket costs in one sector, typed in the app */
  const toSectorPrice = r => ({ amount: Number(r.amount), currency: r.currency || 'ALL', updatedAt: time(r.updated_at) });

  const toScanMeta = r => ({ at: time(r.scanned_at), summary: r.summary || {}, by: r.scanned_by || '' });
  const toLease = r => ({ deviceId: r.device_id, userId: r.user_id, expiresAt: time(r.expires_at) });

  const SPECS = [
    { name: 'team', table: 'team_settings', select: 'data', replace: (m, rows) => { m.team = (first(rows) || {}).data || {}; } },
    { name: 'profiles', table: 'profiles', ts: 'updated_at', clear: m => { m.profiles = {}; },
      put: (m, r) => { m.profiles[r.user_id] = { displayName: r.display_name || '', settings: r.settings || {}, snoozeUntil: time(r.snooze_until) }; } },
    { name: 'events', table: 'events', ts: 'updated_at', clear: m => { m.events = {}; },
      put: (m, r) => { m.events[r.key] = toEvent(r); },
      idCol: 'key', keep: (m, ids) => { for (const k of Object.keys(m.events)) if (!ids.has(k)) delete m.events[k]; } },
    { name: 'requests', table: 'requests', ts: 'updated_at', clear: m => { m.requests = []; },
      put: (m, r) => {
        const v = toRequest(r);
        const i = m.requests.findIndex(x => x.id === v.id);
        if (i >= 0) m.requests[i] = v; else m.requests.push(v);
      },
      idCol: 'id', keep: (m, ids) => { m.requests = m.requests.filter(r => ids.has(String(r.id))); } },
    { name: 'state', table: 'request_state', ts: 'updated_at', clear: m => { m.state = {}; },
      put: (m, r) => { m.state[r.request_id] = toState(r); } },
    { name: 'scans', table: 'scans', select: 'event_key,sector_id,summary,scanned_at,scanned_by', ts: 'scanned_at', clear: m => { m.scanMeta = {}; },
      put: (m, r) => { (m.scanMeta[r.event_key] = m.scanMeta[r.event_key] || {})[r.sector_id] = toScanMeta(r); } },
    { name: 'health', table: 'event_health', ts: 'updated_at', clear: m => { m.health = {}; },
      put: (m, r) => { m.health[r.event_key] = r.data || {}; } },
    { name: 'catalog', table: 'catalog', ts: 'updated_at', clear: m => { m.catalog = {}; },
      put: (m, r) => {
        (m.catalog[r.site] = m.catalog[r.site] || {})[r.site_id] =
          Object.assign({}, r.data || {}, { siteId: r.site_id, firstSeen: time(r.first_seen), gone: !!r.gone });
      } },
    { name: 'leases', table: 'leases', ts: 'updated_at', clear: m => { m.leases = {}; },
      put: (m, r) => { m.leases[r.name] = toLease(r); } },
    { name: 'listings', table: 'listings', ts: 'updated_at', clear: m => { m.listings = {}; },
      put: (m, r) => { m.listings[r.listing_id] = toListing(r); },
      idCol: 'listing_id', keep: (m, ids) => { for (const k of Object.keys(m.listings)) if (!ids.has(k)) delete m.listings[k]; } },
    /* optional: a database that has not run the schema with sales yet says nothing about them */
    { name: 'sales', table: 'sales', ts: 'updated_at', optional: true, clear: m => { m.sales = {}; },
      put: (m, r) => { m.sales[r.sale_id] = toSale(r); } },
    { name: 'teamPrices', table: 'team_prices', ts: 'seen_at', clear: m => { m.teamPrices = {}; },
      put: (m, r) => { m.teamPrices[r.listing_id] = toTeamPrice(r); } },
    { name: 'fx', table: 'fx_rates', ts: 'updated_at', clear: m => { m.fx = {}; },
      put: (m, r) => { m.fx[String(r.day).slice(0, 10)] = r.lek_per || {}; } },
    /* optional, like sales: a database without the buy tracker syncs everything else */
    { name: 'accounts', table: 'buy_accounts', ts: 'updated_at', optional: true, clear: m => { m.accounts = {}; },
      put: (m, r) => { m.accounts[r.id] = toAccount(r); } },
    { name: 'purchases', table: 'purchases', ts: 'updated_at', optional: true, clear: m => { m.purchases = {}; },
      put: (m, r) => { m.purchases[r.id] = toPurchase(r); } },
    { name: 'prices', table: 'sector_prices', ts: 'updated_at', optional: true, clear: m => { m.sectorPrices = {}; },
      put: (m, r) => { (m.sectorPrices[r.event_key] = m.sectorPrices[r.event_key] || {})[r.sector_id] = toSectorPrice(r); } },
    /* optional too: a database without the last-sales table syncs everything else */
    { name: 'lastSales', table: 'vg_last_sales', ts: 'updated_at', optional: true, clear: m => { m.lastSales = {}; },
      put: (m, r) => { (m.lastSales = m.lastSales || {})[String(r.id)] = toLastSale(r); } }
  ];
  const specOf = name => SPECS.find(s => s.name === name);

  /* drop what belongs to events or requests that no longer exist */
  function prune(m) {
    m.requests = m.requests.filter(r => m.events[r.eventKey]);
    const ids = new Set(m.requests.map(r => r.id));
    for (const id of Object.keys(m.state)) if (!ids.has(id)) delete m.state[id];
    for (const key of Object.keys(m.scanMeta)) if (!m.events[key]) delete m.scanMeta[key];
    for (const key of Object.keys(m.health)) if (!m.events[key]) delete m.health[key];
    for (const [id, p] of Object.entries(m.purchases || {})) if ((p.eventKey && !m.events[p.eventKey]) || !(m.accounts || {})[p.accountId]) delete m.purchases[id];
    for (const key of Object.keys(m.sectorPrices || {})) if (!m.events[key]) delete m.sectorPrices[key];
  }

  async function applyRows(name, rows) {
    if (!rows || !rows.length) return;
    const spec = specOf(name);
    await mutateMirror(m => { for (const r of rows) spec.put(m, r); });
  }

  /* ---------------- pull -------------------------------------------- */

  const splitFp = fp => {
    const s = String(fp || '');
    const i = s.lastIndexOf('|');
    return { max: i > 0 ? s.slice(0, i) : '', count: Number(s.slice(i + 1)) || 0 };
  };

  let pulls = 0;

  async function pull(opts) {
    opts = opts || {};
    const status = await Supa.rpc('sync_status');
    if (!status || status.member !== true) {
      const e = new Error('This account is not on the Seat Tracker team. Add its email to the members list at the bottom of supabase/schema.sql and run it again.');
      e.notMember = true;
      throw e;
    }

    const { mirror } = await readLocal(['mirror']);
    const old = (mirror && mirror.fingerprints) || {};
    const full = !!opts.full || !mirror || (++pulls % 20 === 0);

    const jobs = [];
    for (const spec of SPECS) {
      const now = status[spec.name];
      if (spec.optional && now === undefined) continue;
      if (!full && old[spec.name] === now) continue;
      const a = splitFp(old[spec.name]);
      const b = splitFp(now);
      const incremental = !full && spec.ts && a.max && old[spec.name] !== undefined && b.count >= a.count;
      const filter = incremental ? `&${spec.ts}=gt.${enc(a.max)}` : '';
      /* The fingerprint is "newest | count", so a row deleted while another
       * was added between two pulls changes neither in a way that says so: an
       * incremental pull would keep the deleted one for ever (until the next
       * full pull), and a request kept like that fails every alert check it
       * meets. Where rows get deleted, the ids that still exist come along. */
      const rows = Supa.rest('GET', `${spec.table}?select=${spec.select || '*'}${filter}`);
      const ids = incremental && spec.idCol
        ? Supa.rest('GET', `${spec.table}?select=${spec.idCol}`).then(list => new Set((list || []).map(x => String(x[spec.idCol]))))
        : Promise.resolve(null);
      jobs.push(Promise.all([rows, ids])
        .then(([rows, keep]) => ({ spec, rows: rows || [], incremental, keep })));
    }
    if (full || old.profiles !== status.profiles) {
      jobs.push(Supa.rest('GET', 'members?select=user_id,email').then(rows => ({ members: rows || [] })));
    }
    if (full || old.catalog !== status.catalog) {
      jobs.push(Supa.rest('GET', 'catalog_sites?select=*').then(rows => ({ catalogSites: rows || [] })));
    }

    const results = await Promise.all(jobs);
    await withLocal(s => {
      const m = Object.assign(emptyMirror(), s.mirror || {});
      for (const r of results) {
        if (r.members) { m.members = r.members.map(x => ({ userId: x.user_id, email: x.email })); continue; }
        if (r.catalogSites) { m.catalogSites = {}; for (const x of r.catalogSites) m.catalogSites[x.site] = time(x.checked_at); continue; }
        if (r.spec.replace) { r.spec.replace(m, r.rows); continue; }
        if (!r.incremental) r.spec.clear(m);
        else if (r.keep) r.spec.keep(m, r.keep);
        for (const row of r.rows) r.spec.put(m, row);
      }
      prune(m);
      const fingerprints = {};
      for (const spec of SPECS) fingerprints[spec.name] = status[spec.name];
      m.fingerprints = fingerprints;
      m.serverOffset = Date.parse(status.now) - Date.now();
      return patch({ mirror: m });
    }, ['mirror']);

    return { changed: results.length > 0, alerts: Number(status.alerts) || 0 };
  }

  /* ---------------- events ------------------------------------------ */

  async function insertEvent(row) {
    let r = first(await Supa.rest('POST', 'events', { body: [row], prefer: 'resolution=ignore-duplicates,return=representation' }));
    if (!r) r = first(await Supa.rest('GET', `events?select=*&${eq('key', row.key)}`));
    await applyRows('events', [r]);
    return toEvent(r);
  }

  async function patchEvent(key, changes) {
    const r = first(await Supa.rest('PATCH', `events?${eq('key', key)}`, { body: changes, prefer: 'return=representation' }));
    if (!r) throw new Error('That event no longer exists.');
    await applyRows('events', [r]);
    return toEvent(r);
  }

  async function deleteEvent(key) {
    await Supa.rest('DELETE', `events?${eq('key', key)}`, { prefer: 'return=minimal' });
    await mutateMirror(m => { delete m.events[key]; prune(m); });
    await withLocal(s => {
      const scanCache = Object.assign({}, s.scanCache);
      delete scanCache[key];
      return patch({ scanCache });
    }, ['scanCache']);
  }

  /* ---------------- requests and their state ------------------------ */

  async function insertRequest(row) {
    const r = first(await Supa.rest('POST', 'requests', { body: [row], prefer: 'return=representation' }));
    await applyRows('requests', [r]);
    return toRequest(r);
  }

  async function insertRequests(rows) {
    if (!rows.length) return [];
    const out = await Supa.rest('POST', 'requests', { body: rows, prefer: 'resolution=ignore-duplicates,return=representation' });
    await applyRows('requests', out);
    return (out || []).map(toRequest);
  }

  async function patchRequest(id, changes) {
    const r = first(await Supa.rest('PATCH', `requests?${eq('id', id)}`, { body: changes, prefer: 'return=representation' }));
    if (!r) throw new Error('That request no longer exists.');
    await applyRows('requests', [r]);
    return toRequest(r);
  }

  /* ---------------- the price list ---------------------------------- */

  /* one sector's price on its event's list, shared with the team (the app's
   * Price list shows the same rows) */
  async function saveSectorPrice(row) {
    const out = await Supa.rest('POST', 'sector_prices', { body: [row], prefer: 'resolution=merge-duplicates,return=representation' });
    await applyRows('prices', out);
    return first(out);
  }

  async function deleteSectorPrice(eventKey, sectorId) {
    await Supa.rest('DELETE', `sector_prices?${eq('event_key', eventKey)}&${eq('sector_id', String(sectorId))}`, { prefer: 'return=minimal' });
    await mutateMirror(m => { delete ((m.sectorPrices || {})[eventKey] || {})[String(sectorId)]; });
  }

  /* ---------------- buy tracker ------------------------------------- */

  /* a new buying account of yours (the database shows it to nobody else) */
  async function insertAccount(row) {
    const r = first(await Supa.rest('POST', 'buy_accounts', { body: [row], prefer: 'return=representation' }));
    if (!r) throw new Error('The account was not saved.');
    await applyRows('accounts', [r]);
    return toAccount(r);
  }

  async function insertPurchases(rows) {
    if (!rows.length) return [];
    const out = await Supa.rest('POST', 'purchases', { body: rows, prefer: 'return=representation' });
    await applyRows('purchases', out);
    return (out || []).map(toPurchase);
  }

  /* ---------------- viagogo listings and rates ----------------------- */

  /* this person's listings as read on viagogo (owner-only rows) */
  async function saveListings(rows) {
    if (!rows.length) return 0;
    const post = body => Supa.rest('POST', 'listings', { body, prefer: 'resolution=merge-duplicates,return=representation' });
    let out;
    try { out = await post(rows); }
    catch (e) {
      /* a database not updated yet (schema.sql) has no "uploaded": save the rest */
      if (!/uploaded/i.test(String(e && e.message))) throw e;
      out = await post(rows.map(r => { const x = Object.assign({}, r); delete x.uploaded; return x; }));
    }
    await mutateMirror(m => {
      for (const r of out || []) { m.listings[r.listing_id] = toListing(r); m.teamPrices[r.listing_id] = toTeamPrice(r); }
    });
    return (out || []).length;
  }

  /* sales as read on My Sales; a sale already saved is updated in place.
   * seats came later: a database that has not run schema.sql since still takes the rest */
  async function saveSales(rows) {
    if (!rows.length) return 0;
    const post = body => Supa.rest('POST', 'sales', { body, prefer: 'resolution=merge-duplicates,return=representation' });
    let out;
    try {
      out = await post(rows);
    } catch (e) {
      if (!/seats/i.test(String(e && e.message))) throw e;
      out = await post(rows.map(r => { const rest = Object.assign({}, r); delete rest.seats; return rest; }));
    }
    await mutateMirror(m => { for (const r of out || []) m.sales[r.sale_id] = toSale(r); });
    return (out || []).length;
  }

  /* ---------------- saved viagogo event scans ------------------------
   * Your own, the newest two per event (the database drops the rest). Not
   * mirrored: they are large and only the drawer and the app read them. */
  async function saveVgScan(row) {
    await Supa.rest('POST', 'vg_scans?on_conflict=user_id,vg_event_id,scanned_at', { body: [row], prefer: 'resolution=ignore-duplicates,return=minimal' });
    return listVgScans(row.vg_event_id);
  }
  async function listVgScans(vgEventId) {
    const rows = await Supa.rest('GET', `vg_scans?select=*&${eq('vg_event_id', String(vgEventId))}&order=scanned_at.desc&limit=2`);
    return (rows || []).map(SK.market.scanFromRow);
  }
  async function deleteVgScan(vgEventId, at) {
    await Supa.rest('DELETE', `vg_scans?${eq('vg_event_id', String(vgEventId))}&${eq('scanned_at', new Date(Number(at)).toISOString())}`, { prefer: 'return=minimal' });
  }

  /* every saved scan of one event (yours: row level security) */
  async function deleteVgScans(vgEventId) {
    await Supa.rest('DELETE', `vg_scans?${eq('vg_event_id', String(vgEventId))}`, { prefer: 'return=minimal' });
  }

  /* a sale the "just sold" toast showed: a new one, or the same seen again */
  async function insertLastSale(row) {
    const r = first(await Supa.rest('POST', 'vg_last_sales', { body: [row], prefer: 'return=representation' }));
    if (r) await mutateMirror(m => { (m.lastSales = m.lastSales || {})[String(r.id)] = toLastSale(r); });
    return r ? toLastSale(r) : null;
  }

  async function patchLastSale(id, changes) {
    const r = first(await Supa.rest('PATCH', `vg_last_sales?${eq('id', id)}`, { body: changes, prefer: 'return=representation' }));
    if (r) await mutateMirror(m => { (m.lastSales = m.lastSales || {})[String(r.id)] = toLastSale(r); });
    return r ? toLastSale(r) : null;
  }

  /* the same change to a handful of sales, in one request */
  async function patchSales(ids, changes) {
    const list = (ids || []).map(String).filter(Boolean);
    if (!list.length) return 0;
    const out = await Supa.rest('PATCH', `sales?${inList('sale_id', list)}`, { body: changes, prefer: 'return=representation' });
    await mutateMirror(m => { for (const r of out || []) m.sales[r.sale_id] = toSale(r); });
    return (out || []).length;
  }

  /* Writes only the columns given, so a sweep that sends prices never clobbers
   * `track`, and switching `track` never clobbers a price. */
  async function patchListing(id, changes) {
    const r = first(await Supa.rest('PATCH', `listings?${eq('listing_id', id)}`, { body: changes, prefer: 'return=representation' }));
    if (!r) throw new Error('That listing is no longer saved.');
    await mutateMirror(m => { m.listings[r.listing_id] = toListing(r); m.teamPrices[r.listing_id] = toTeamPrice(r); });
    return toListing(r);
  }

  /* Start again: every listing of this person's, gone. Only their own rows are
   * reachable at all, so this can never touch a teammate's. */
  async function deleteListings(userId) {
    await Supa.rest('DELETE', `listings?${eq('user_id', userId)}`, { prefer: 'return=minimal' });
    await mutateMirror(m => {
      for (const [id, l] of Object.entries(m.listings)) {
        if (l.userId === userId) { delete m.listings[id]; delete m.teamPrices[id]; }
      }
    });
  }

  /* the same change to a handful of listings, in one request */
  async function patchListings(ids, changes) {
    const list = [...new Set((ids || []).map(String))].filter(Boolean);
    if (!list.length) return [];
    const out = await Supa.rest('PATCH', `listings?${inList('listing_id', list)}`,
      { body: changes, prefer: 'return=representation' });
    await mutateMirror(m => {
      for (const r of out || []) { m.listings[r.listing_id] = toListing(r); m.teamPrices[r.listing_id] = toTeamPrice(r); }
    });
    return (out || []).map(toListing);
  }

  /* one row per day for the whole team; a second PC's insert is ignored */
  async function saveFx(day, lekPer, source, by) {
    const out = await Supa.rest('POST', 'fx_rates', {
      body: [{ day, lek_per: lekPer, source, fetched_by: by }],
      prefer: 'resolution=ignore-duplicates,return=representation'
    });
    await mutateMirror(m => { m.fx[day] = (first(out) || {}).lek_per || lekPer; });
    return (out || []).length > 0;
  }

  async function deleteRequest(id) {
    await Supa.rest('DELETE', `requests?${eq('id', id)}`, { prefer: 'return=minimal' });
    await mutateMirror(m => { m.requests = m.requests.filter(r => r.id !== id); delete m.state[id]; });
  }

  /* several at once, in one request: the end of an event */
  async function deleteRequests(ids) {
    const list = (ids || []).map(String).filter(Boolean);
    if (!list.length) return 0;
    await Supa.rest('DELETE', `requests?${inList('id', list)}`, { prefer: 'return=minimal' });
    const gone = new Set(list);
    await mutateMirror(m => { m.requests = m.requests.filter(r => !gone.has(String(r.id))); for (const id of list) delete m.state[id]; });
    return list.length;
  }

  /* the first evaluation of a request; false when another PC already wrote one */
  async function baselineState(id, st) {
    const rows = await Supa.rest('POST', 'request_state', {
      body: [{ request_id: id, status: st.status, options: st.options, free: st.free, scan_at: iso(st.scanAt), pending_gone: false, alert_log: {} }],
      prefer: 'resolution=ignore-duplicates,return=representation'
    });
    await applyRows('state', rows);
    return !!(rows && rows.length);
  }

  /* update only if nobody changed it since `version`: the winner sends the alert */
  async function casState(id, version, changes) {
    const rows = await Supa.rest('PATCH', `request_state?${eq('request_id', id)}&version=eq.${Number(version)}`, {
      body: Object.assign({}, changes, { version: Number(version) + 1 }),
      prefer: 'return=representation'
    });
    await applyRows('state', rows);
    return !!(rows && rows.length);
  }

  /* a request deleted elsewhere that this PC still had: forget it here too */
  async function forgetRequest(id) {
    await mutateMirror(m => { m.requests = m.requests.filter(r => String(r.id) !== String(id)); delete m.state[id]; });
  }

  async function resetState(id) {
    await Supa.rest('DELETE', `request_state?${eq('request_id', id)}`, { prefer: 'return=minimal' });
    await mutateMirror(m => { delete m.state[id]; });
  }

  /* ---------------- scans ------------------------------------------- */

  async function putScansLocally(eventKey, items) {
    await withLocal(s => {
      const scanCache = Object.assign({}, s.scanCache);
      scanCache[eventKey] = Object.assign({}, scanCache[eventKey] || {});
      for (const x of items) scanCache[eventKey][x.sec] = x.scan;
      return patch({ scanCache });
    }, ['scanCache']);
    await mutateMirror(m => {
      m.scanMeta[eventKey] = Object.assign({}, m.scanMeta[eventKey] || {});
      for (const x of items) m.scanMeta[eventKey][x.sec] = { at: x.scan.at, summary: x.summary, by: x.by || '' };
    });
  }

  async function saveScans(eventKey, items, by) {
    if (!items.length) return;
    await Supa.rest('POST', 'scans', {
      body: items.map(x => ({ event_key: eventKey, sector_id: x.sec, scan: x.scan, summary: x.summary, scanned_at: iso(x.scan.at), scanned_by: by })),
      prefer: 'resolution=merge-duplicates,return=minimal'
    });
    await putScansLocally(eventKey, items.map(x => Object.assign({ by }, x)));
  }

  async function fetchScans(eventKey, sectorIds) {
    const filter = sectorIds && sectorIds.length ? '&' + inList('sector_id', sectorIds) : '';
    const rows = await Supa.rest('GET', `scans?select=sector_id,scan,summary,scanned_at,scanned_by&${eq('event_key', eventKey)}${filter}`);
    const items = (rows || []).map(r => ({ sec: r.sector_id, scan: r.scan, summary: r.summary || {}, by: r.scanned_by || '' }));
    if (items.length) await putScansLocally(eventKey, items);
    return items.length;
  }

  async function saveHealth(eventKey, data) {
    const rows = await Supa.rest('POST', 'event_health', {
      body: [{ event_key: eventKey, data }], prefer: 'resolution=merge-duplicates,return=representation'
    });
    await applyRows('health', rows);
  }

  /* ---------------- leases ------------------------------------------ */

  async function claimLease(name, seconds, deviceId) {
    const ok = await Supa.rpc('claim_lease', { p_name: name, p_device: deviceId, p_seconds: Math.max(10, Math.round(seconds)) });
    if (ok === true) await mutateMirror(m => { m.leases[name] = { deviceId, userId: null, expiresAt: Date.now() + seconds * 1000 }; });
    return ok === true;
  }

  async function releaseLease(name, deviceId) {
    await Supa.rpc('release_lease', { p_name: name, p_device: deviceId });
    await mutateMirror(m => { if (m.leases[name] && m.leases[name].deviceId === deviceId) delete m.leases[name]; });
  }

  /* ---------------- alerts and commands ----------------------------- */

  async function insertAlert(row) {
    return first(await Supa.rest('POST', 'alerts', { body: [row], prefer: 'return=representation' }));
  }

  async function alertsSince(userId, afterId) {
    return (await Supa.rest('GET', `alerts?select=*&${eq('user_id', userId)}&id=gt.${Number(afterId)}&order=id.asc&limit=30`)) || [];
  }

  /* true only for the first PC that records this ntfy message */
  async function markHandled(messageId, userId) {
    const rows = await Supa.rest('POST', 'handled_commands', {
      body: [{ id: String(messageId), user_id: userId }], prefer: 'resolution=ignore-duplicates,return=representation'
    });
    return !!(rows && rows.length);
  }

  /* ---------------- profiles, team, devices ------------------------- */

  async function ensureProfile(user) {
    const rows = await Supa.rest('POST', 'profiles', {
      body: [{ user_id: user.id, display_name: String(user.email || '').split('@')[0] }],
      prefer: 'resolution=ignore-duplicates,return=representation'
    });
    await applyRows('profiles', rows);
  }

  async function saveProfile(userId, changes) {
    const body = {};
    if (changes.settings !== undefined) body.settings = changes.settings;
    if (changes.displayName !== undefined) body.display_name = changes.displayName;
    if (changes.snoozeUntil !== undefined) body.snooze_until = iso(changes.snoozeUntil);
    const r = first(await Supa.rest('PATCH', `profiles?${eq('user_id', userId)}`, { body, prefer: 'return=representation' }));
    if (!r) throw new Error('Profile not found.');
    await applyRows('profiles', [r]);
  }

  async function saveTeam(data) {
    const r = first(await Supa.rest('PATCH', 'team_settings?id=eq.1', { body: { data }, prefer: 'return=representation' }));
    await mutateMirror(m => { m.team = (r && r.data) || data; });
  }

  async function heartbeat(device, userId) {
    await Supa.rest('POST', 'devices', {
      body: [{ id: device.id, user_id: userId, name: device.name || '', last_seen: new Date().toISOString(), version: SK.update ? SK.update.installed() : SK.config.version }],
      prefer: 'resolution=merge-duplicates,return=minimal'
    });
  }

  async function fetchDevices() {
    const rows = (await Supa.rest('GET', 'devices?select=*&order=last_seen.desc')) || [];
    const devices = rows.map(r => ({ id: r.id, userId: r.user_id, name: r.name || '', lastSeen: time(r.last_seen), version: r.version || '' }));
    await mutateMirror(m => { m.devices = devices; });
    return devices;
  }

  /* old PCs off the list; one still in use comes back at its next heartbeat */
  async function deleteDevices(ids) {
    const list = (ids || []).map(String).filter(Boolean);
    if (!list.length) return 0;
    await Supa.rest('DELETE', `devices?${inList('id', list)}`, { prefer: 'return=minimal' });
    await mutateMirror(m => { m.devices = (m.devices || []).filter(d => !list.includes(d.id)); });
    return list.length;
  }

  /* ---------------- event lists (eBileta) --------------------------- */

  /* returns only the rows that were not there before */
  async function insertCatalog(rows) {
    if (!rows.length) return [];
    const out = await Supa.rest('POST', 'catalog', { body: rows, prefer: 'resolution=ignore-duplicates,return=representation' });
    await applyRows('catalog', out);
    return out || [];
  }

  async function upsertCatalog(rows) {
    if (!rows.length) return;
    const out = await Supa.rest('POST', 'catalog', { body: rows, prefer: 'resolution=merge-duplicates,return=representation' });
    await applyRows('catalog', out);
  }

  async function markCatalogSite(site) {
    await Supa.rest('POST', 'catalog_sites', { body: [{ site, checked_at: new Date().toISOString() }], prefer: 'resolution=merge-duplicates,return=minimal' });
    await mutateMirror(m => { m.catalogSites[site] = Date.now(); });
  }

  async function cleanup() { await Supa.rpc('cleanup_old'); }

  return {
    pull, toEvent, toRequest,
    insertEvent, patchEvent, deleteEvent,
    insertRequest, insertRequests, patchRequest, insertAccount, insertPurchases, deleteRequest, deleteRequests, saveListings, patchListing, patchListings, deleteListings, saveSales, patchSales, insertLastSale, patchLastSale, saveVgScan, listVgScans, deleteVgScan, deleteVgScans, saveFx,
    baselineState, casState, resetState, forgetRequest,
    saveScans, fetchScans, saveHealth,
    claimLease, releaseLease,
    insertAlert, alertsSince, markHandled,
    ensureProfile, saveProfile, saveTeam, heartbeat, fetchDevices, deleteDevices,
    insertCatalog, upsertCatalog, markCatalogSite, cleanup,
    saveSectorPrice, deleteSectorPrice
  };
})();
