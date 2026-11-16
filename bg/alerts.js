/* ------------------------------------------------------------------
 * Seat Tracker - deciding what to tell whom (service worker)
 *
 * After a scan every open request in the scanned sectors — of every user —
 * is compared with its shared state; a bought one never is, even when its
 * sector was scanned for someone else. NOTIFICATIONS.md describes each case.
 *
 *   available : was not OK/LOW, now OK or LOW
 *   low       : was OK and now LOW, or LOW and the options dropped
 *   backOk    : was LOW, now OK again
 *   gone      : was OK/LOW, now SPLIT/SHORT (with "confirm", after two scans)
 *
 * The state row has a version. A PC only alerts when its update of that
 * version succeeds, so two PCs looking at the same change alert once.
 * Each alert goes to the request's owner, with the owner's settings.
 * ------------------------------------------------------------------ */
'use strict';

const Alerts = (() => {
  const U = SK.util;
  const fill = s => SK.rules.isFillable(s);
  const ORDER = ['available', 'low', 'backOk', 'gone'];

  async function afterScan(key, sectorIds) {
    const wanted = new Set(sectorIds.map(String));
    const m = await model();
    const ev = m.events[key];
    if (!ev) return;
    const now = Date.now();
    const groups = new Map();                            // "userId|type" -> { userId, type, lines, requests }

    for (const r of m.requests) {
      if (r.eventKey !== key || r.done || muffled(m, r) || !wanted.has(String(r.sec))) continue;
      const scan = (m.scans[key] || {})[r.sec];
      if (!scan) continue;
      const e = SK.rules.evaluate(r, scan);
      if (e.status === SK.rules.STATUS.NONE) continue;
      const cur = { status: e.status, options: e.options, free: e.view ? e.view.available : null, scanAt: scan.at };
      const prev = m.state[r.id];

      try {
        if (!prev) { await Remote.baselineState(r.id, cur); continue; }   // baseline, never alerts
        if (prev.scanAt && cur.scanAt < prev.scanAt) continue;          // an older scan than the one already judged

        const cfg = m.settingsFor(r.userId);
        let type = null;
        let next = { status: cur.status, options: cur.options, pendingGone: false };
        if (!fill(prev.status) && fill(cur.status)) {
          type = 'available';
        } else if (fill(prev.status) && !fill(cur.status)) {
          if (cfg.confirmGone && !prev.pendingGone) next = { status: prev.status, options: prev.options, pendingGone: true };
          else type = 'gone';
        } else if (prev.status === 'OK' && cur.status === 'LOW') {
          type = 'low';
        } else if (prev.status === 'LOW' && cur.status === 'LOW' && cur.options < prev.options) {
          type = 'low';
        } else if (prev.status === 'LOW' && cur.status === 'OK') {
          type = 'backOk';
        }

        const alertLog = Object.assign({}, prev.alertLog);
        let send = false;
        if (type) {
          const cooldown = cfg.cooldownMin * 60000;
          if (!cooldown || !alertLog[type] || now - alertLog[type] >= cooldown) {
            alertLog[type] = now;
            send = true;
          }
        }

        /* A warning that lasts is worse than one that starts, so it comes back
         * every so often until someone presses Stop. The reminder is kept with
         * the request, so whichever PC scans next carries it on. */
        const before = alertLog.nag || null;
        const nag = SK.rules.nagAfter(before, next.pendingGone ? prev.status : cur.status,
          { everyMs: cfg.repeatWarnMin * 60000, now });
        if (send && type && nag.nag && nag.nag.type === type) nag.nag.lastAt = now;   // the alert itself counts as a reminder
        if (nag.nag) alertLog.nag = nag.nag; else delete alertLog.nag;
        if (nag.repeat && !send) { type = nag.nag.type; send = true; }

        const unchanged = !send && prev.status === next.status && prev.options === next.options &&
          prev.free === cur.free && !!prev.pendingGone === next.pendingGone &&
          JSON.stringify(before || null) === JSON.stringify(alertLog.nag || null);
        if (unchanged) continue;

        const won = await Remote.casState(r.id, prev.version, {
          status: next.status, options: next.options, free: cur.free, pending_gone: next.pendingGone,
          alert_log: alertLog, scan_at: new Date(cur.scanAt).toISOString()
        });
        if (!won || !send) continue;

        const gk = `${r.userId}|${type}`;
        if (!groups.has(gk)) groups.set(gk, { userId: r.userId, type, lines: [], codes: [], requests: [], reminder: 0, since: 0 });
        const g = groups.get(gk);
        g.lines.push(alertLine(m, r, e));
        g.codes.push(codeOf(m, r));
        g.requests.push(r);
        if (nag.repeat) { g.reminder = Math.max(g.reminder, nag.nag.count); g.since = nag.nag.since; }
      } catch (err) {
        /* 23503: no such request any more. It was deleted on another PC or in
         * the app after this PC last pulled it, so it is dropped here too
         * rather than reported on every scan. */
        if (err.code === '23503') { await Remote.forgetRequest(r.id).catch(() => {}); continue; }
        await setMeta({ lastError: 'alert check: ' + err.message });
      }
    }

    for (const type of ORDER) {
      for (const g of groups.values()) {
        if (g.type !== type) continue;
        /* "No longer fillable · E106": the sectors in the title, the event's name first in the text */
        const lines = [eventName(m, key), ...g.lines];
        if (g.reminder) lines.push(`Still there after ${U.since(g.since)} · Stop ends these reminders.`);
        const what = SK.settings.notifyType(type).title;
        await Notify.send(type, {
          userId: g.userId,
          eventKey: key,
          title: `${g.reminder ? `Still: ${what.toLowerCase()}` : what} · ${sectorList(g.codes)}`,
          message: lines.join('\n'),
          click: eventUrlOf(ev),
          requests: g.requests,
          reminder: g.reminder,
          always: g.reminder > 0
        });
      }
    }
  }

  /* failing / recovered go to everyone with open requests in the event */
  async function health(key, change) {
    const m = await model();
    const ev = m.events[key];
    if (!ev) return;
    const message = change.type === 'failing'
      ? `${eventName(m, key)}\n${change.error}\nLast try: ${change.device} · last good scan: ${change.lastOkAt ? U.fmtTime(change.lastOkAt) : 'never'}`
        + (change.reminder ? `\nFailing for ${U.since(change.since)} · Stop ends these reminders.` : '')
      : `${eventName(m, key)}\nScans work again${change.since ? ` after ${Math.max(1, Math.round((Date.now() - change.since) / 60000))} min` : ''}.`;
    const skip = new Set(change.skip || []);
    const users = [...new Set(openRequests(m, key).map(r => r.userId))].filter(uid => !skip.has(uid));
    for (const userId of users) {
      await Notify.send(change.type, {
        userId, eventKey: key, message, click: eventUrlOf(ev),
        title: change.reminder ? 'Still failing' : undefined,
        reminder: change.reminder ? 1 : 0, always: !!change.reminder
      });
    }
  }

  /* A message one teammate typed for the others. Never automatic: it goes out
   * only when someone presses send, and each recipient's own switches, mute
   * and quiet hours still decide how it reaches them. */
  async function teamMessage(fromUserId, msg) {
    const m = await model();
    const from = (m.profiles[fromUserId] || {}).displayName || 'A teammate';
    const text = String(msg.text || '').trim().slice(0, 500);
    if (!text) throw new Error('Nothing to send.');
    const everyone = m.members.length ? m.members.map(x => x.userId) : Object.keys(m.profiles);
    const to = (msg.to && msg.to.length ? msg.to : everyone).filter(uid => uid && uid !== fromUserId);
    if (!to.length) throw new Error('There is nobody else on the team to tell.');
    const where = msg.eventKey && m.events[msg.eventKey] ? eventName(m, msg.eventKey) : '';
    const message = [where, text].filter(Boolean).join('\n');
    const sent = [];
    for (const userId of to) {
      const res = await Notify.send('teamNote', {
        userId, eventKey: msg.eventKey || null,
        title: `${from} says${msg.section ? ' · ' + msg.section : ''}`,
        message,
        click: msg.click || (msg.eventKey && m.events[msg.eventKey] ? eventUrlOf(m.events[msg.eventKey]) : undefined)
      });
      sent.push({ userId, name: (m.profiles[userId] || {}).displayName || 'someone', skipped: res && res.skipped ? res.skipped : null });
    }
    return { sent };
  }

  async function newEvents(site, added) {
    const m = await model();
    /* the name, then when and where: the title split as the app splits it, no ids */
    const day = iso => new Date(iso + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });   // "30 Oct"
    const lines = added.map(e => {
      const info = U.splitEventTitle(e.title, { date: e.date });
      const when = info.date ? [day(info.date), info.time].filter(Boolean).join(' ') : e.date;
      return [info.name || e.title, when, e.venue || info.venue].filter(Boolean).join(' · ');
    });
    const users = m.members.length ? m.members.map(x => x.userId) : Object.keys(m.profiles);
    for (const userId of users) {
      await Notify.send('newEvent', {
        userId,
        title: added.length === 1 ? `New event on ${site.label}` : `${added.length} new events on ${site.label}`,
        message: lines.join('\n'),
        click: site.eventUrl({ siteId: added[0].siteId, extra: {} })
      });
    }
  }

  /* A stand that had no free seat now has some. It belongs to nobody's
   * request — that is the point — so it goes to the whole team. */
  async function sectorsOpen(key, opened) {
    const m = await model();
    const ev = m.events[key];
    if (!ev || !opened.length) return;
    const lines = opened.map(o => `${o.code}${o.name && o.name !== o.code ? ` (${o.name})` : ''} · ${o.free} free · longest block ${o.longest}`);
    const users = m.members.length ? m.members.map(x => x.userId) : Object.keys(m.profiles);
    for (const userId of users) {
      await Notify.send('sectorsOpen', {
        userId,
        eventKey: key,
        title: `${sectorList(opened.map(o => o.code))} on sale`,
        message: `${eventName(m, key)}\n${lines.join('\n')}\nNo request is watching ${opened.length === 1 ? 'it' : 'them'} yet.`,
        click: eventUrlOf(ev)
      });
    }
  }

  /* one push with a user's open requests, grouped by event */
  async function summary(title, onlyKeys, userId) {
    const m = await model();
    const keys = [...new Set(openRequests(m, null, userId).map(r => r.eventKey))]
      .filter(k => m.events[k] && (!onlyKeys || onlyKeys.includes(k)))
      .sort(byEventNumber(m));
    if (!keys.length && onlyKeys) return;
    const message = keys
      .map(k => [eventName(m, k), ...openRequests(m, k, userId).map(r => alertLine(m, r))].join('\n'))
      .join('\n\n') || 'No open requests.';
    await Notify.send('summary', {
      userId,
      title: title || 'Summary',
      message,
      eventKey: keys.length === 1 ? keys[0] : null,
      click: keys.length === 1 ? eventUrlOf(m.events[keys[0]]) : undefined
    });
  }

  return { afterScan, health, newEvents, sectorsOpen, summary, teamMessage };
})();
