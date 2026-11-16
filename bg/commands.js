/* ------------------------------------------------------------------
 * Seat Tracker - phone commands (service worker)
 *
 * Each user's phone posts to that user's shortcuts topic on ntfy. One
 * online PC (holding the "commands" lease) reads every user's topic every
 * 30 s and runs each command AS that user: their requests, their numbers,
 * their settings; the answer goes to their ntfy topic. A command is
 * recorded in Supabase before it runs, so it never runs twice, whichever
 * PC reads it. COMMANDS.md lists every command.
 * ------------------------------------------------------------------ */
'use strict';

const Commands = (() => {
  const U = SK.util;
  const MAX_AGE_S = 600;
  const MAX_PER_TOPIC = 10;

  /* ---------------- parsing ---------------------------------------- */

  const VERB_ALIASES = {
    status: 'get', list: 'get', ls: 'get', show: 'get',
    check: 'scan', refresh: 'scan',
    rm: 'del', delete: 'del', remove: 'del',
    reopen: 'undo', undone: 'undo',
    price: 'prices', event: 'events',
    config: 'settings', silence: 'mute', snooze: 'mute'
  };
  const KEY_ALIASES = { item: 'req', n: 'req', eur: 'price', cat: 'price', e: 'event' };

  function tokenize(s) {
    const out = [];
    let cur = '', quote = null, has = false;
    for (const c of s) {
      if (quote) { if (c === quote) quote = null; else cur += c; has = true; continue; }
      if (c === '"' || c === "'") { quote = c; has = true; continue; }
      if (c === ' ' || c === '\t' || c === ',' || c === '\n' || c === '\r' || c === ';') {
        if (has) out.push(cur);
        cur = ''; has = false;
        continue;
      }
      cur += c; has = true;
    }
    if (has) out.push(cur);
    return out;
  }

  function parse(text) {
    const raw = String(text == null ? '' : text)
      .replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'")
      .trim().replace(/^\//, '');
    const toks = tokenize(raw);
    if (!toks.length) return { verb: '', args: {}, bare: [], raw };
    let verb = toks.shift().toLowerCase();
    verb = VERB_ALIASES[verb] || verb;
    const args = {}, bare = [];
    for (const t of toks) {
      const eq = t.indexOf('=');
      if (eq > 0) {
        let key = t.slice(0, eq).trim().toLowerCase();
        key = KEY_ALIASES[key] || key;
        args[key] = t.slice(eq + 1);
      } else if (t) {
        bare.push(t.toLowerCase());
      }
    }
    return { verb, args, bare, raw };
  }

  /* client=Ergi_A -> "Ergi A"; client=_ clears it */
  const textValue = v => (v === '_' ? '' : String(v).replace(/_/g, ' ').trim());
  const listingValue = v => (v === '_' ? '' : U.listingId(v));
  const listingActions = r => (r && r.listing
    ? [{ action: 'view', label: 'Viagogo listing', url: U.viagogoUrl(r.listing), clear: true }]
    : undefined);

  function fail(message) { return { title: 'Command failed', message, tags: ['x'] }; }

  class CmdError extends Error {}

  /* ---------------- resolving things ------------------------------- */

  function eventByNumber(m, n) {
    const num = Number(String(n).replace(/\D/g, ''));
    return Object.keys(m.events).find(k => m.events[k].num === num) || null;
  }

  function eventList(m, keys) {
    return keys.sort(byEventNumber(m)).map(k => eventTag(m, k)).join('\n');
  }

  /* event=<n>, or site=<site> eid=<site id>, or the only event that makes sense for this user */
  async function resolveEvent(m, args, purpose, uid) {
    if (args.event !== undefined) {
      const key = eventByNumber(m, args.event);
      if (!key) throw new CmdError(`There is no event ${args.event}. Send "events" for the numbers.`);
      return key;
    }
    if (args.eid !== undefined) {
      const eid = String(args.eid).trim();
      const sites = SK.siteList().filter(x => !args.site || x.id === String(args.site).toLowerCase());
      if (!sites.length) throw new CmdError(`Unknown site "${args.site}". Sites: ${SK.siteList().map(x => x.id).join(', ')}.`);
      let hit = sites.filter(x => m.events[SK.eventKey(x.id, eid)]);
      if (!hit.length) hit = sites.filter(x => (m.catalog[x.id] || {})[eid]);
      if (!hit.length && sites.length === 1) hit = sites;
      if (hit.length !== 1) throw new CmdError(`Say which site for eid=${eid}: add site=ebileta (sites: ${sites.map(x => x.id).join(', ')}).`);
      const c = (m.catalog[hit[0].id] || {})[eid] || {};
      const ev = await registerEvent(hit[0].id, eid, { title: c.title, date: c.date, venue: c.venue });
      return ev.key;
    }
    const withOpen = [...new Set(openRequests(m, null, uid).map(r => r.eventKey))].filter(k => m.events[k]);
    if (withOpen.length === 1) return withOpen[0];
    const archived = new Set(m.settingsFor(uid).archivedEvents);
    const active = Object.keys(m.events).filter(k => !archived.has(k));
    if (!withOpen.length && active.length === 1) return active[0];
    const choose = withOpen.length ? withOpen : active;
    if (!choose.length) throw new CmdError('No events yet. Track one on its page first, or: add site=ebileta eid=2154 sec=… qty=…');
    throw new CmdError(`Say which event for ${purpose}: event=<n>\n${eventList(m, choose)}`);
  }

  /* request numbers are per user: #3 is always the sender's own #3 */
  function requestByNumber(m, n, uid) {
    if (n === undefined) throw new CmdError('Say which request: req=<number> (see "get").');
    const num = Number(String(n).replace(/\D/g, ''));
    const r = m.requests.find(x => x.userId === uid && x.num === num);
    if (!r) throw new CmdError(`You have no request #${num}. Send "get" for your numbers.`);
    return r;
  }

  /* price=65 · price=65/55 · price=CAT_7 · price=all */
  function priceKeys(m, eventKey, value) {
    const ev = m.events[eventKey];
    const site = SK.site(ev.site);
    const raw = String(value).trim();
    if (!raw || ['all', 'any', '*', '_'].includes(raw.toLowerCase())) return [];
    if (!site.can.prices) throw new CmdError(`${site.label} has no price filter.`);
    const cats = ev.cats || {};
    const keys = new Set();
    for (const part of raw.split(/[\/|]/).map(x => x.replace(/_/g, ' ').trim()).filter(Boolean)) {
      for (const k of onePrice(cats, part)) keys.add(k);
    }
    return [...keys];
  }

  function onePrice(cats, v) {
    const n = parseFloat(v.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && !/^c/i.test(v)) {
      const keys = Object.keys(cats).filter(k => Number(cats[k].price) === n);
      if (keys.length) return keys;
    }
    const slug = U.normKey(v).replace(/^C(?=\d)/, 'CAT');
    const byLabel = Object.keys(cats).filter(k => U.normKey(cats[k].label).replace(/^C(?=\d)/, 'CAT') === slug);
    if (byLabel.length) return byLabel;
    throw new CmdError(`No price "${v}". Send "prices" for the list.`);
  }

  async function sectorIn(m, eventKey, input) {
    let ev = m.events[eventKey];
    if (!ev.sectors || !ev.sectors.length) ev = await ensureEvent(eventKey);
    const hit = SK.resolveSector(ev.site, input, ev.sectors);
    if (hit.error) throw new CmdError(hit.error);
    return hit.sector;
  }

  const fresh = () => model();

  function errText(errors) {
    return errors && errors.length ? `\n\n! ${errors.slice(0, 5).join('\n! ')}` : '';
  }

  function reuseText(res) {
    return res && res.reused ? `\n(from the scan ${U.ago(res.reusedAt)}${res.reusedBy ? ' by ' + res.reusedBy : ''})` : '';
  }

  function userEvents(m, uid) {
    return [...new Set(openRequests(m, null, uid).map(r => r.eventKey))].filter(k => m.events[k]).sort(byEventNumber(m));
  }

  /* ---------------- the commands ----------------------------------- */

  const HELP = [
    'help · ping · settings',
    'get · get event=1 · get req=3',
    'events · events all',
    'scan · scan event=1 · scan req=3',
    'scan event=1 sec=A1 qty=10 · scan event=1 all qty=10',
    'prices event=1 [sec=D1]',
    'add event=1 sec=A1 qty=10 client=Ana_K warn=2 opts=3 price=65/55 together=on listing=12345678',
    'stop req=7               end a warning\'s reminders (the request stays as it is)',
    'add site=ebileta eid=2154 sec=E105 qty=10',
    'edit req=3 qty=12 warn=4 opts=2 client=Ana price=all together=off listing=12345678 (listing=_ clears)',
    'done req=3 · undo req=3 · del req=3 · del event=4 (nobody has open requests)',
    'set poll=5 newevents=30 (shared) · set together=on warn=2 opts=3 notify=on summary=off|every|daily quiet=on cooldown=10 confirm=on buttons=on',
    'set event=1 poll=2 · set event=1 poll=0 · set event=1 poll=default   (auto-check for one event)',
    'mute 60 · unmute',
    '',
    'Requests and #numbers are your own. event= is optional when only one event has your open requests.',
    'Links: spaces → +, names with spaces → _, never & or #'
  ].join('\n');

  const handlers = {
    async help(c) {
      const cfg = (await fresh()).settingsFor(c.uid);
      return { title: 'Commands', message: `${cfg.ntfyServer}/${cfg.cmdTopic || '<shortcuts topic>'}/publish?message=<command>\n\n${HELP}`, tags: ['information_source'] };
    },

    async ping(c) {
      const m = await fresh();
      const open = openRequests(m, null, c.uid).length;
      const online = m.devices.filter(d => Date.now() - d.lastSeen < 2 * 60000).map(d => d.name || d.id);
      const newest = Math.max(0, ...Object.values(m.scanMeta).flatMap(x => Object.values(x).map(s => s.at)));
      const mute = (m.profiles[c.uid] || {}).snoozeUntil > Date.now() ? `\nmuted until ${U.fmtClock(m.profiles[c.uid].snoozeUntil)}` : '';
      return {
        title: 'Pong — running',
        message: `${U.plural(open, 'open request')} · last scan ${U.ago(newest)}\nonline: ${online.join(', ') || 'this PC'}${mute}`,
        tags: ['white_check_mark']
      };
    },

    async get(c) {
      const m = await fresh();
      if (c.args.req !== undefined) {
        const r = requestByNumber(m, c.args.req, c.uid);
        return { title: eventTag(m, r.eventKey), message: lineFor(m, r) + (r.done ? ' (done)' : ''), click: eventUrlOf(m.events[r.eventKey]), tags: ['ticket'], actions: listingActions(r) };
      }
      const keys = c.args.event !== undefined ? [await resolveEvent(m, c.args, 'get', c.uid)] : userEvents(m, c.uid);
      if (!keys.length) return { title: 'No open requests', message: 'Add one: add event=1 sec=A1 qty=4', tags: ['ticket'] };
      return {
        title: `Requests · ${keys.reduce((n, k) => n + openRequests(m, k, c.uid).length, 0)} open`,
        message: keys.map(k => [eventTag(m, k), ...openRequests(m, k, c.uid).map(r => lineFor(m, r))].join('\n')).join('\n\n'),
        click: keys.length === 1 ? eventUrlOf(m.events[keys[0]]) : undefined,
        tags: ['ticket']
      };
    },

    async events(c) {
      const note = [];
      for (const r of await checkNewEvents()) {
        if (r.error) note.push(`${r.site}: list not refreshed (${r.error})`);
        else if (r.added.length) note.push(`${r.site}: ${r.added.length} new`);
      }
      const m = await fresh();
      const all = c.bare.includes('all');
      const archived = new Set(m.settingsFor(c.uid).archivedEvents);
      const lines = Object.keys(m.events)
        .filter(k => all || !archived.has(k))
        .sort(byEventNumber(m))
        .map(k => {
          const ev = m.events[k];
          const open = openRequests(m, k, c.uid).length;
          const every = autoMinutesOf(ev, m.team);
          return `${eventTag(m, k)}${ev.date ? ' · ' + ev.date : ''} · ${SK.site(ev.site).label}${open ? ` · ${U.plural(open, 'request')} · auto ${every ? every + ' min' : 'off'}` : ''}${archived.has(k) ? ' · archived' : ''}`;
        });
      for (const site of SK.siteList()) {
        const cat = m.catalog[site.id] || {};
        const untracked = Object.values(cat).filter(e => !m.events[SK.eventKey(site.id, e.siteId)] && (all || !e.gone));
        if (untracked.length) {
          lines.push('', `Not tracked yet on ${site.label}:`);
          for (const e of untracked) lines.push(`eid ${e.siteId} · ${e.title}${e.date ? ' · ' + e.date : ''}${e.gone ? ' · no longer listed' : ''}`);
        }
      }
      return {
        title: `Events${note.length ? ' · ' + note.join(' · ') : ''}`,
        message: (lines.join('\n') || 'No events yet.') + '\n\nTrack one: add site=ebileta eid=<id> sec=… qty=…',
        tags: ['calendar']
      };
    },

    async prices(c) {
      let m = await fresh();
      const key = await resolveEvent(m, c.args, 'prices', c.uid);
      const ev = m.events[key];
      const site = SK.site(ev.site);
      if (!site.can.prices) return fail(`${site.label} has no price categories.`);
      await scanEvent(key, c.args.sec !== undefined ? [(await sectorIn(m, key, c.args.sec)).id] : 'all', { reuse: true });
      m = await fresh();
      const cur = currencyOf(m.events[key]);
      if (c.args.sec !== undefined) {
        const sec = await sectorIn(m, key, c.args.sec);
        const rows = SK.rules.sectorPrices((m.scans[key] || {})[sec.id], m.events[key].cats, cur).map(p => `${p.text} — ${p.avail} free of ${p.total}`);
        return { title: `Prices in ${sec.code}`, message: rows.join('\n') || 'Not scanned yet.', tags: ['moneybag'] };
      }
      const totals = new Map();
      for (const sec of m.events[key].sectors) {
        for (const p of SK.rules.sectorPrices((m.scans[key] || {})[sec.id], m.events[key].cats, cur)) {
          const t = totals.get(p.key) || { price: p.price, text: p.text, avail: 0, secs: [] };
          t.avail += p.avail;
          if (p.avail) t.secs.push(`${sec.code}:${p.avail}`);
          totals.set(p.key, t);
        }
      }
      const rows = [...totals.values()]
        .sort((a, b) => (b.price === null ? -1 : b.price) - (a.price === null ? -1 : a.price))
        .map(t => `${t.text} — ${t.avail} free${t.secs.length ? ' (' + t.secs.join(', ') + ')' : ''}`);
      return { title: `Prices · ${eventTag(m, key)}`, message: rows.join('\n') || 'Nothing scanned yet.', tags: ['moneybag'] };
    },

    async scan(c) {
      let m = await fresh();

      if (c.args.req !== undefined) {
        const r = requestByNumber(m, c.args.req, c.uid);
        const res = await scanEvent(r.eventKey, [r.sec], { reuse: false });
        m = await fresh();
        return { title: eventTag(m, r.eventKey), message: lineFor(m, r) + reuseText(res) + errText(res.errors), click: eventUrlOf(m.events[r.eventKey]), tags: ['mag'], actions: listingActions(r) };
      }

      const wantsEvent = c.args.event !== undefined || c.args.eid !== undefined || c.args.sec !== undefined || c.bare.includes('all');
      if (!wantsEvent) {
        const res = await scanTrackedAll({ reuse: false }, c.uid);
        for (const k of res.keys) await restartAutoTimer(k);
        m = await fresh();
        const keys = userEvents(m, c.uid);
        if (!keys.length) return { title: 'Nothing to scan', message: 'You have no open requests.\nScan one sector: scan event=1 sec=A1 qty=10', tags: ['mag'] };
        return {
          title: res.scanned ? `Scanned ${U.plural(res.scanned, 'sector')}` : 'Latest scans',
          message: keys.map(k => [eventTag(m, k), ...openRequests(m, k, c.uid).map(r => lineFor(m, r))].join('\n')).join('\n\n') + errText(res.errors),
          click: keys.length === 1 ? eventUrlOf(m.events[keys[0]]) : undefined,
          tags: ['mag']
        };
      }

      const key = await resolveEvent(m, c.args, 'scan', c.uid);
      const ev = m.events[key];
      const cfg = m.settingsFor(c.uid);
      const qty = c.args.qty !== undefined ? U.clampInt(c.args.qty, 1, 1, 9999) : null;
      const cats = c.args.price !== undefined ? priceKeys(m, key, c.args.price) : [];
      const tag = cats.length ? ' ' + SK.rules.priceTag({ cats }, ev.cats, currencyOf(ev)) : '';
      const click = eventUrlOf(ev);

      if (c.args.sec !== undefined) {
        const sec = await sectorIn(m, key, c.args.sec);
        const res = await scanEvent(key, [sec.id], { reuse: false });
        m = await fresh();
        const scan = (m.scans[key] || {})[sec.id];
        const lines = openRequests(m, key, c.uid).filter(r => String(r.sec) === String(sec.id)).map(r => lineFor(m, r));
        if (scan && scan.unmapped) lines.push(`${sec.code} — ${scan.note}`);
        else if (scan && qty) {
          const o = SK.rules.optionsFor(SK.rules.blocksFor(scan, cats), qty, cfg.together);
          lines.push(`${sec.code}${tag} ×${qty} — ${U.plural(o.options, 'option')}`);
        } else if (scan) {
          const v = SK.rules.blocksFor(scan, cats);
          lines.push(`${sec.code}${tag} — ${v.available} free · longest block ${v.longest}`);
        }
        return { title: `${sec.code} · ${eventTag(m, key)}`, message: (lines.join('\n') || 'Nothing to report.') + reuseText(res) + errText(res.errors), click, tags: ['mag'] };
      }

      const scope = c.bare.includes('all') || !openRequests(m, key, c.uid).length ? 'all' : 'tracked';
      const res = await scanEvent(key, scope, { reuse: false });
      if (res.scanned) await restartAutoTimer(key);
      m = await fresh();
      if (scope === 'tracked') {
        return { title: `Scanned · ${eventTag(m, key)}`, message: openRequests(m, key, c.uid).map(r => lineFor(m, r)).join('\n') + reuseText(res) + errText(res.errors), click, tags: ['mag'] };
      }
      const rows = [];
      for (const id of res.ids) {
        const scan = (m.scans[key] || {})[id];
        const sec = sectorOf(m.events[key], id);
        if (!scan || scan.unmapped || !sec) continue;
        const view = SK.rules.blocksFor(scan, cats);
        if (qty) {
          const o = SK.rules.optionsFor(view, qty, cfg.together);
          if (o.options > 0) rows.push({ n: o.options, text: `${sec.code} — ${U.plural(o.options, 'option')}` });
        } else if (view.longest > 0) {
          rows.push({ n: view.longest, text: `${sec.code} — longest block ${view.longest}` });
        }
      }
      rows.sort((a, b) => b.n - a.n || a.text.localeCompare(b.text));
      return {
        title: `All sectors${tag}${qty ? ' ×' + qty : ''} · ${eventTag(m, key)}`,
        message: (rows.slice(0, 40).map(r => r.text).join('\n') || 'Nothing available.') +
          (rows.length > 40 ? `\n+${rows.length - 40} more` : '') + reuseText(res) + errText(res.errors),
        click, tags: ['mag']
      };
    },

    async add(c) {
      let m = await fresh();
      if (c.args.sec === undefined) return fail('add needs sec=, e.g. add sec=A1 qty=4');
      const key = await resolveEvent(m, c.args, 'add', c.uid);
      m = await fresh();
      const req = await addRequest({
        eventKey: key,
        sec: c.args.sec,
        qty: c.args.qty,
        cats: c.args.price !== undefined ? priceKeys(m, key, c.args.price) : [],
        client: c.args.client !== undefined ? textValue(c.args.client) : '',
        listing: c.args.listing !== undefined ? listingValue(c.args.listing) : '',
        warn: c.args.warn,
        opts: c.args.opts,
        together: c.args.together !== undefined ? U.boolValue(c.args.together, m.settingsFor(c.uid).together) : undefined
      }, c.uid);
      let note = '';
      try { const r = await scanEvent(key, [req.sec], { reuse: true }); note = reuseText(r) + errText(r.errors); } catch (e) { note = `\n! scan failed: ${e.message}`; }
      m = await fresh();
      const r = m.requests.find(x => x.id === req.id) || req;
      return { title: `Added · ${eventTag(m, key)}`, message: lineFor(m, r) + note, click: eventUrlOf(m.events[key]), tags: ['heavy_plus_sign'], actions: listingActions(r) };
    },

    async edit(c) {
      let m = await fresh();
      const r = requestByNumber(m, c.args.req, c.uid);
      const changes = {};
      if (c.args.sec !== undefined) changes.sec = c.args.sec;
      if (c.args.qty !== undefined) changes.qty = c.args.qty;
      if (c.args.warn !== undefined) changes.warn = c.args.warn;
      if (c.args.opts !== undefined) changes.opts = c.args.opts;
      if (c.args.client !== undefined) changes.client = textValue(c.args.client);
      if (c.args.listing !== undefined) changes.listing = listingValue(c.args.listing);
      if (c.args.together !== undefined) changes.together = U.boolValue(c.args.together, r.together);
      if (c.args.price !== undefined) changes.cats = priceKeys(m, r.eventKey, c.args.price);
      if (!Object.keys(changes).length) return fail('Nothing to change — use qty=, warn=, opts=, client=, listing=, price=, together= or sec=.');
      const updated = await updateRequest(r.id, changes);
      try { await scanEvent(r.eventKey, [updated.sec], { reuse: true }); } catch (e) { /* the line says NOT SCANNED */ }
      m = await fresh();
      const now = m.requests.find(x => x.id === r.id) || updated;
      return { title: `Edited · ${eventTag(m, r.eventKey)}`, message: lineFor(m, now), tags: ['pencil2'], actions: listingActions(now) };
    },

    async done(c) { return flag(c, true); },
    async undo(c) { return flag(c, false); },

    /* the Stop button on a repeating warning */
    async stop(c) {
      const m = await fresh();
      if (c.args.req !== undefined) {
        const r = requestByNumber(m, c.args.req, c.uid);
        const res = await stopReminders({ num: r.num, userId: c.uid });
        return {
          title: `Reminders stopped · #${r.num} ${codeOf(m, r)}`,
          message: `${eventTag(m, r.eventKey)}\n${res.already ? 'They had already stopped.' : 'The request is untouched — they start again if it gets worse.'}`,
          tags: ['mute']
        };
      }
      if (c.args.event !== undefined) {
        const key = eventByNumber(m, c.args.event);
        if (!key) return fail(`There is no event ${c.args.event}. Send "events" for the numbers.`);
        await stopReminders({ eventKey: key, userId: c.uid });
        return { title: 'Reminders stopped', message: `${eventTag(m, key)}\nNo more "scan failing" reminders until it works again.`, tags: ['mute'] };
      }
      return fail('Say what to stop: stop req=7, or stop event=1 for failing scans.');
    },

    async del(c) {
      const m = await fresh();
      if (c.args.req === undefined && c.args.event !== undefined) {
        const key = eventByNumber(m, c.args.event);
        if (!key) return fail(`There is no event ${c.args.event}. Send "events" for the numbers.`);
        const tag = eventTag(m, key);
        const res = await forgetEvent(key);
        return { title: 'Event deleted', message: tag + (res.removedRequests ? `\n(${U.plural(res.removedRequests, 'done request')} removed with it)` : ''), tags: ['wastebasket'] };
      }
      const r = requestByNumber(m, c.args.req, c.uid);
      await deleteRequest(r.id);
      return { title: `Deleted #${r.num} ${codeOf(m, r)} ×${r.qty}`, message: eventTag(m, r.eventKey), tags: ['wastebasket'] };
    },

    async settings(c) {
      const m = await fresh();
      return { title: 'Settings', message: settingsText(m.settingsFor(c.uid)) + '\n\nChange: set poll=5 summary=daily …', tags: ['gear'] };
    },

    async set(c) {
      const m = await fresh();
      if (c.args.event !== undefined || c.args.eid !== undefined) return setForEvent(m, c);
      const cur = m.settingsFor(c.uid);
      const changes = {};
      const rejected = [];
      for (const [k, v] of Object.entries(c.args)) {
        const spec = SETTABLE[k];
        if (!spec) { rejected.push(k); continue; }
        const val = spec(v, cur, changes);
        if (val instanceof Error) return fail(val.message);
      }
      if (!Object.keys(changes).length) {
        return fail(rejected.length
          ? `Cannot set ${rejected.join(', ')} from the phone (topics, per-type switches, theme and sidebar are in the popup).`
          : `Nothing to set. Keys: ${Object.keys(SETTABLE).join(', ')}`);
      }
      const after = await saveSettingsFor(c.uid, changes);
      const note = rejected.length ? `\n(ignored: ${rejected.join(', ')})` : '';
      return { title: 'Settings saved', message: settingsText(after) + note, tags: ['gear'] };
    },

    async mute(c) {
      const mins = U.clampInt(c.args.min !== undefined ? c.args.min : c.bare[0], 60, 1, 7 * 24 * 60);
      const until = await setSnooze(c.uid, mins);
      return { title: 'Muted', message: `No alerts for you until ${U.fmtClock(until)} (${mins} min). Commands still answer.\nSend "unmute" to end it.`, tags: ['no_bell'] };
    },

    async unmute(c) {
      await setSnooze(c.uid, 0);
      return { title: 'Unmuted', message: 'Your alerts are on again.', tags: ['bell'] };
    }
  };

  async function flag(c, done) {
    const m = await fresh();
    const r = requestByNumber(m, c.args.req, c.uid);
    await updateRequest(r.id, { done });
    if (done) return { title: `Done #${r.num}`, message: `#${r.num} ${codeOf(m, r)} ×${r.qty} — no longer scanned or alerted.\n${eventTag(m, r.eventKey)}`, tags: ['heavy_check_mark'] };
    try { await scanEvent(r.eventKey, [r.sec], { reuse: true }); } catch (e) { /* the line says NOT SCANNED */ }
    const after = await fresh();
    return { title: `Reopened #${r.num}`, message: lineFor(after, after.requests.find(x => x.id === r.id) || r), tags: ['arrows_counterclockwise'] };
  }

  function autoText(ev, cfg) {
    const every = autoMinutesOf(ev, cfg);
    const own = ev.autoMin !== null && ev.autoMin !== undefined;
    return (every ? `every ${every} min` : 'off') +
      (own ? ' (this event only, for the whole team)' : ` (follows the team default: ${cfg.autoMin ? cfg.autoMin + ' min' : 'off'})`);
  }

  /* set event=1 poll=2 | poll=0 | poll=default */
  async function setForEvent(m, c) {
    const key = await resolveEvent(m, c.args, 'set', c.uid);
    const other = Object.keys(c.args).filter(k => !['event', 'eid', 'site', 'poll'].includes(k));
    if (c.args.poll === undefined || other.length) {
      return fail('For one event only poll= can be set: set event=1 poll=2 (0 = off, default = follow the team default).');
    }
    const v = String(c.args.poll).trim().toLowerCase();
    const toDefault = ['default', 'auto', '-'].includes(v);
    const minutes = toDefault ? null : U.clampInt(v, null, 0, 1440);
    if (!toDefault && minutes === null) return fail('poll= must be minutes, 0 (off) or default.');
    await setEventAutoMin(key, minutes);
    await syncAlarms();
    const after = await fresh();
    return { title: `Auto-check · ${eventTag(after, key)}`, message: autoText(after.events[key], after.settingsFor(c.uid)), tags: ['gear'] };
  }

  const onOff = b => (b ? 'on' : 'off');
  const mins = v => (Number(v) > 0 ? `every ${v} min` : 'off');

  function settingsText(cfg) {
    return [
      `poll=${cfg.autoMin} — auto-check ${mins(cfg.autoMin)} (team default; one event: set event=1 poll=2)`,
      `newevents=${cfg.eventCheckMin} — new-event check ${mins(cfg.eventCheckMin)} (team)`,
      `together=${onOff(cfg.together)} · warn=${cfg.defaultWarn} · opts=${cfg.defaultOpts} — your defaults for new requests`,
      `notify=${onOff(Object.values(cfg.notify).some(t => t.desktop))} — your desktop notifications`,
      `summary=${cfg.summaryMode}${cfg.summaryMode === 'daily' ? ' at ' + cfg.summaryTime : ''}`,
      `quiet=${onOff(cfg.quiet.enabled)} ${cfg.quiet.from}–${cfg.quiet.to}${cfg.quiet.allowAvailable ? ' (available still comes through)' : ''}`,
      `cooldown=${cfg.cooldownMin} min · confirm=${onOff(cfg.confirmGone)} · buttons=${onOff(cfg.buttons)}`,
      `ntfy topic ${cfg.phoneTopic ? 'set' : 'NOT set'} · shortcuts topic ${cfg.cmdTopic ? 'set' : 'not set'}`
    ].join('\n');
  }

  const int = (key, lo, hi) => (v, cur, ch) => { ch[key] = U.clampInt(v, cur[key], lo, hi); };
  const bool = key => (v, cur, ch) => { ch[key] = U.boolValue(v, cur[key]); };

  const SETTABLE = {
    poll: int('autoMin', 0, 1440),
    newevents: int('eventCheckMin', 0, 1440),
    together: bool('together'),
    warn: int('defaultWarn', 0, 9999),
    opts: int('defaultOpts', 0, 9999),
    cooldown: int('cooldownMin', 0, 1440),
    confirm: bool('confirmGone'),
    buttons: bool('buttons'),
    summary: (v, cur, ch) => {
      const x = String(v).toLowerCase();
      const m = /^daily@?(\d{1,2}:\d{2})?$/.exec(x);
      if (m) { ch.summaryMode = 'daily'; if (m[1]) ch.summaryTime = m[1]; return; }
      if (x === 'off' || x === 'every') { ch.summaryMode = x; return; }
      return new Error('summary must be off, every or daily (daily@09:00)');
    },
    quiet: (v, cur, ch) => {
      const m = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(String(v));
      ch.quiet = Object.assign({}, cur.quiet, m ? { enabled: true, from: m[1], to: m[2] } : { enabled: U.boolValue(v, cur.quiet.enabled) });
    },
    notify: (v, cur, ch) => {
      const on = U.boolValue(v, true);
      ch.notify = {};
      for (const [k, t] of Object.entries(cur.notify)) ch.notify[k] = Object.assign({}, t, { desktop: k === 'summary' ? t.desktop : on });
    }
  };

  /* ---------------- running ---------------------------------------- */

  async function run(text, uid) {
    const c = parse(text);
    if (!uid) return fail('Not signed in on this PC.');
    c.uid = uid;
    if (!c.verb) return fail('Empty command. Send "help" for the list.');
    const h = handlers[c.verb];
    if (!h) return { title: `Unknown command "${c.verb}"`, message: 'Send "help" for the list.', tags: ['question'] };
    try {
      return await h(c);
    } catch (e) {
      return fail(`${c.raw}\n→ ${e.message || e}`);
    }
  }

  let polling = false;

  /* one PC reads every user's shortcuts topic; the lease moves if it goes offline */
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const m = await model();
      if (!m.meId) return;
      const topics = Object.keys(m.profiles)
        .map(uid => ({ uid, cfg: m.settingsFor(uid) }))
        .filter(x => x.cfg.cmdTopic);
      if (!topics.length) return;
      if (!(await Remote.claimLease('commands', 75, m.device.id))) return;

      const nowS = Math.floor(Date.now() / 1000);
      for (const { uid, cfg } of topics) {
        let msgs = [];
        try {
          const res = await fetch(`${cfg.ntfyServer}/${encodeURIComponent(cfg.cmdTopic)}/json?poll=1&since=${nowS - MAX_AGE_S}`, { cache: 'no-store' });
          if (!res.ok) throw new Error('ntfy HTTP ' + res.status);
          msgs = (await res.text()).split('\n').filter(Boolean)
            .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
            .filter(x => x && x.event === 'message' && x.id && nowS - (x.time || nowS) <= MAX_AGE_S)
            .sort((a, b) => (a.time || 0) - (b.time || 0))
            .slice(0, MAX_PER_TOPIC);
        } catch (e) {
          await setMeta({ lastError: 'shortcuts topic: ' + (e.message || e) });
          continue;
        }
        for (const msg of msgs) {
          if (!(await Remote.markHandled(msg.id, uid))) continue;      // already run (here or on another PC)
          const answer = await run(msg.message || '', uid);
          await Notify.reply(answer, uid);
          await Net.keepAlive();
        }
      }
    } catch (e) {
      await setMeta({ lastError: 'command poll: ' + (e.message || e) });
    } finally {
      polling = false;
    }
  }

  return { parse, run, poll, settingsText };
})();
