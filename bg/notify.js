/* ------------------------------------------------------------------
 * Seat Tracker - delivering notifications (service worker)
 *
 *   send(type, { userId, … })  an alert for one user, with that user's
 *        switches, mute and quiet hours. The phone push goes to the user's
 *        ntfy topic from whichever PC found the change. The desktop
 *        notification is stored in Supabase and shown by every PC signed
 *        in as that user (this PC shows it at once if it is theirs).
 *   reply(answer, userId)      a phone-command answer
 *   local(…)                   a notice about this PC only (e.g. a site login)
 *
 * ntfy messages are JSON, so non-ASCII names survive; long ones are split.
 * ------------------------------------------------------------------ */
'use strict';

const Notify = (() => {
  const U = SK.util;

  /* the viagogo link when the alert is about exactly one request that has a listing */
  function singleListing(msg) {
    const r = msg && msg.requests && msg.requests.length === 1 ? msg.requests[0] : null;
    return r && r.listing ? U.viagogoUrl(r.listing) : '';
  }

  /* what Stop would end: one request's reminders, or an event's failing-scan ones */
  function stopTarget(msg) {
    if (!msg.reminder) return null;
    const r = msg.requests && msg.requests.length === 1 ? msg.requests[0] : null;
    if (r) return { requestId: r.id, num: r.num, label: r.num ? `stop req=${r.num}` : '' };
    return msg.eventKey ? { eventKey: msg.eventKey, label: '' } : null;
  }

  /* Chrome allows 2 buttons. A reminder keeps Stop and the listing (clicking
   * the notification itself still opens the map). */
  function desktopButtons(cfg, msg) {
    if (!cfg.buttons || !msg.eventKey) return [];
    const listing = singleListing(msg);
    const stop = stopTarget(msg);
    if (stop) return [{ title: 'Stop', stop }, listing ? { title: 'Open listing', url: listing } : { title: 'Open map', url: msg.click || '' }];
    return listing
      ? [{ title: 'Open listing', url: listing }, { title: 'Scan again', scan: true }]
      : [{ title: 'Open map', url: msg.click || '' }, { title: 'Scan again', scan: true }];
  }

  /* ntfy allows 3 buttons: the listing takes the map's place (tapping still opens the map) */
  function phoneActions(cfg, m, msg) {
    if (!cfg.buttons) return undefined;
    const out = [];
    const listing = singleListing(msg);
    if (listing) out.push({ action: 'view', label: 'Viagogo listing', url: listing, clear: true });
    else if (msg.click) out.push({ action: 'view', label: msg.clickLabel || 'Open map', url: msg.click, clear: true });
    const ev = msg.eventKey && m.events[msg.eventKey];
    if (cfg.cmdTopic && ev) {
      const url = `${cfg.ntfyServer}/${encodeURIComponent(cfg.cmdTopic)}`;
      out.push({ action: 'http', label: 'Scan again', url, method: 'POST', body: `scan event=${ev.num}`, clear: true });
      /* a reminder offers Stop where a one-off offers Mark done */
      const stop = stopTarget(msg);
      if (stop && stop.num) out.push({ action: 'http', label: 'Stop', url, method: 'POST', body: `stop req=${stop.num}`, clear: true });
      else if (stop && stop.eventKey) out.push({ action: 'http', label: 'Stop', url, method: 'POST', body: `stop event=${ev.num}`, clear: true });
      else if (msg.requests && msg.requests.length === 1 && msg.requests[0].num) {
        out.push({ action: 'http', label: 'Mark done', url, method: 'POST', body: `done req=${msg.requests[0].num}`, clear: true });
      }
    }
    return out.length ? out : undefined;
  }

  async function send(type, msg) {
    const def = SK.settings.notifyType(type);
    const m = await model();
    const userId = msg.userId;
    if (!userId || !m.profiles[userId]) return { skipped: 'no such user' };
    const cfg = m.settingsFor(userId);
    const route = cfg.notify[type] || { desktop: false, phone: false };
    if (m.profiles[userId].snoozeUntil > Date.now() && !msg.always) return { skipped: 'snoozed' };
    const title = msg.title || def.title;
    const message = String(msg.message || '');

    /* The row goes in whatever this PC does with it: another PC of yours may
     * be the one that is switched on, and it reads the same row. */
    if (route.desktop) {
      const buttons = desktopButtons(cfg, msg);
      let row = null;
      try {
        row = await Remote.insertAlert({
          user_id: userId, event_key: msg.eventKey || null,
          request_id: msg.requests && msg.requests.length === 1 ? msg.requests[0].id : null,
          type, title, message, click: msg.click || null, data: { buttons }, created_by: m.device.id
        });
      } catch (e) { /* the phone push below still goes out */ }
      const here = SK.settings.showsHere(cfg, type);
      if (userId === m.meId && here.show) {
        await showDesktop({ id: row ? row.id : null, title, message, click: msg.click, eventKey: msg.eventKey, buttons });
      }
    }

    const quiet = cfg.quiet.enabled && !msg.always && U.inDailyWindow(new Date(), cfg.quiet.from, cfg.quiet.to) &&
      !(type === 'available' && cfg.quiet.allowAvailable);
    let push = null;
    if (!route.phone) push = { ok: false, reason: 'switched off for this kind' };
    else if (!cfg.phoneTopic) push = { ok: false, reason: 'no ntfy topic set' };
    else if (quiet) push = { ok: false, reason: 'quiet hours' };
    /* an alert may be more urgent than its kind (msg.priority: a sold ticket with no PDF days before its event) */
    else push = await publish(cfg, { title, message, priority: msg.priority || def.priority, tags: def.tags, click: msg.click, actions: phoneActions(cfg, m, msg) });
    await notePush(type, userId, push, m);
    return { ok: true, quiet, push };
  }

  /* What happened to the last phone pushes, so a push that never arrives can
   * be explained instead of guessed at. Kept on this PC only. */
  async function notePush(type, userId, res, m) {
    const who = userId === m.meId ? 'you' : ((m.profiles[userId] || {}).displayName || 'a teammate');
    const row = { at: Date.now(), type, who, ok: !!(res && res.ok), reason: (res && res.reason) || '' };
    try {
      await withLocal(s => {
        const pushes = [row, ...(s.pushLog || [])].slice(0, 12);
        return patch({ pushLog: pushes }, true);
      }, ['pushLog']);
    } catch (e) { /* the alert itself already went out */ }
    /* a run of failures is worth saying out loud, once an hour */
    if (!row.ok && res && res.reason && !/switched off|quiet hours/.test(row.reason)) {
      await local('Seat Tracker: phone alerts are not arriving',
        `The last push for ${who} failed: ${row.reason}. Open the extension → Phone to check the topic.`,
        'push-fail', 60 * 60000);
    }
  }

  /* shows a desktop notification once per alert id on this PC */
  async function showDesktop(a) {
    if (a.id) {
      const k = 'shown:' + a.id;
      if ((await chrome.storage.session.get(k))[k]) return;
      await chrome.storage.session.set({ [k]: 1 });
    }
    const id = 'sk-' + (a.id ? 'a' + a.id : Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    const opts = {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/128.png'),
      title: a.title,
      message: String(a.message || '').slice(0, 1000),
      priority: 2
    };
    const buttons = (a.buttons || []).filter(b => b && b.title);
    if (buttons.length) opts.buttons = buttons.slice(0, 2).map(b => ({ title: b.title }));
    try {
      await chrome.notifications.create(id, opts);
      await chrome.storage.session.set({ ['notif:' + id]: { url: a.click || '', eventKey: a.eventKey || null, buttons } });
    } catch (e) { /* the OS may have notifications switched off */ }
  }

  async function publish(cfg, msg) {
    if (!cfg.phoneTopic) return { ok: false, reason: 'no ntfy topic set' };
    const bodies = U.splitMessage(msg.message || '', U.NTFY_LIMIT);
    const titles = U.titleParts(msg.title, bodies.length);
    let ok = true, reason = '';
    const link = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');
    const actions = (msg.actions || []).filter(a => a && link(a.url));
    for (let i = 0; i < bodies.length; i++) {
      const body = { topic: cfg.phoneTopic, title: titles[i], message: bodies[i], priority: msg.priority || 3 };
      if (msg.tags && msg.tags.length) body.tags = msg.tags;
      if (link(msg.click)) body.click = msg.click;
      if (actions.length && i === bodies.length - 1) body.actions = actions;
      try {
        const res = await fetch(cfg.ntfyServer + '/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) {
          ok = false;
          /* ntfy explains a 400 in the answer; without it the number says nothing */
          let said = '';
          try { said = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 160); } catch (e) { /* no body */ }
          reason = `ntfy HTTP ${res.status}${said ? ' — ' + said : ''}`;
        }
      } catch (e) {
        ok = false; reason = String(e.message || e);
      }
      if (i < bodies.length - 1) await U.sleep(300);
    }
    return { ok, reason, parts: bodies.length };
  }

  async function reply(answer, userId) {
    const m = await model();
    const cfg = m.settingsFor(userId || m.meId);
    if (!cfg.phoneTopic) return { ok: false, reason: 'no ntfy topic set' };
    return publish(cfg, {
      title: answer.title, message: answer.message,
      priority: /failed|unknown/i.test(answer.title) ? 4 : 3,
      tags: answer.tags || ['robot'], click: answer.click,
      actions: cfg.buttons ? answer.actions : undefined
    });
  }

  /* a notice about this PC, at most once per `everyMs` for the same key */
  /* Trouble with this PC — signed out, alerts not sending. Not about anyone's
   * requests, and nothing else would tell whoever is sitting here, so it shows
   * even on a PC whose request alerts are off. */
  async function local(title, message, key, everyMs, extra) {
    const go = await withLocal(s => {
      const throttle = Object.assign({}, s.throttle);
      if (throttle[key] && Date.now() - throttle[key] < everyMs) return false;
      throttle[key] = Date.now();
      return patch({ throttle }, true);
    }, ['throttle']);
    if (go) await showDesktop(Object.assign({ title, message }, extra));
  }

  async function testPhone() {
    const m = await model();
    const cfg = m.settingsFor(m.meId);
    if (!cfg.phoneTopic) throw new Error('Set your ntfy topic first.');
    const res = await publish(cfg, { title: 'Seat Tracker', message: 'Test push — your ntfy topic works.', priority: 3, tags: ['bell'] });
    if (!res.ok) throw new Error(res.reason || 'send failed');
    return res;
  }

  async function testDesktop() {
    await showDesktop({ title: 'Seat Tracker', message: 'Test notification — desktop alerts work on this PC.' });
    return true;
  }

  async function lookup(id) {
    const k = 'notif:' + id;
    return (await chrome.storage.session.get(k))[k] || null;
  }

  chrome.notifications.onClicked.addListener(async id => {
    const info = await lookup(id);
    if (info && info.url) chrome.tabs.create({ url: info.url });
    chrome.notifications.clear(id);
  });

  chrome.notifications.onButtonClicked.addListener(async (id, index) => {
    const info = await lookup(id);
    chrome.notifications.clear(id);
    if (!info) return;
    const b = (info.buttons || [])[index];
    if (b && b.url) chrome.tabs.create({ url: b.url });
    else if (b && b.stop) stopReminders(b.stop).catch(() => {});
    else if (b && b.scan && info.eventKey) scanEvent(info.eventKey, 'tracked', { reuse: true }).catch(() => {});
  });

  return { send, reply, publish, showDesktop, local, testPhone, testDesktop };
})();
