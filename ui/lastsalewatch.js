/* ------------------------------------------------------------------
 * Seat Tracker - one event's place in the last-sales scan
 *
 * Shown on viagogo's event page (the drawer's Last sales tab) and on its
 * sell pages (the sidebar): whether the scan asks viagogo about this event,
 * how often, when it asked last and what it heard, when it asks next — and
 * the switches to add it, leave it out or give it its own interval, plus
 * "Get last sale now" for when you can see a sale was just made. The list
 * itself is the team's (the popup's viagogo last sales section has all of it).
 *
 * SK.lastSaleWatchUI(state, { vgEventId, title, when, sessionId }, { onChange })
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK || !SK.ui || !SK.lastSales) return;
  const ui = SK.ui;
  const U = SK.util;
  const L = SK.lastSales;

  /* the last "Get last sale now" answer per event, kept across redraws */
  const asked = {};

  const money = (n, cur) => (SK.profit ? SK.profit.formatMoney(n, cur) : `${n} ${cur}`);
  const saleText = s => (s ? `${s.section} · ${U.plural(s.tickets, 'ticket')} · ${L.priceText(s, money)}` : '');
  const at = ts => `${U.fmtAt(ts)} (${U.ago(ts)})`;
  const next = ts => `${U.fmtAt(ts)} (${U.until(ts)})`;

  /* what "Get last sale now" came back with, in words */
  function answerText(r) {
    switch ((r = r || {}).kind) {
      case 'sale': return `New sale saved: ${saleText(r.sale)}.`;
      case 'same': return `viagogo still shows the last saved sale${r.sale ? ` (${saleText(r.sale)})` : ''}: skipped.`;
      case 'none': return 'viagogo has no sale to show for this event.';
      case 'recent': return `Asked ${U.ago(r.at)} already${r.result ? `: ${L.RESULT_TEXT[r.result] || r.result}` : ''}.`;
      case 'blocked': return `Not asked: viagogo's bot check is on until ${U.fmtAt(r.blockedUntil)}.`;
      case 'signed-out': return 'viagogo is signed out in this browser. Sign in there, then try again.';
      case 'no-sell': return 'viagogo has no sell page for this event (over?).';
      default: return `No answer${r.why ? `: ${r.why}` : ''}.`;
    }
  }

  /* the bot check: when it stopped, what was being asked, when it ends */
  function blockText(x) {
    const b = x.block;
    const what = b ? [b.by ? (L.BY_TEXT[b.by] || b.by) : '', b.title ? `asking about ${b.title}` : '', b.why].filter(Boolean).join(', ') : '';
    return `viagogo showed its bot check${b ? ` at ${U.fmtAt(b.at)}` : ''}${what ? ` (${what})` : ''}. Nothing asks viagogo on this PC until ${next(x.blockedUntil)}.`;
  }

  function lastSaleWatchUI(st, ev, opts) {
    const box = ui.el('div', 'sk-lsw');
    const x = st && st.lastSaleScan;
    if (!x) return box;
    const id = ev && String(ev.vgEventId || '');
    const say = (text, cls, into) => (into || box).append(ui.el('p', 'sk-lsw-line' + (cls ? ' ' + cls : ''), text));
    const changed = () => { if (opts && opts.onChange) opts.onChange(); };
    const send = async (change, btn) => {
      if (btn) btn.disabled = true;
      try { await ui.send('setLastSaleEvent', { vgEventId: id, change: Object.assign({ title: ev.title || '', when: ev.when || '' }, change) }); }
      catch (e) { say(e.message, 'warn'); }
      changed();
    };

    if (!id) { say('This page does not say which viagogo event it is, so its scan cannot be switched here. Use the event page, or the popup → viagogo last sales.'); return box; }

    /* Get last sale now: this event, at once, whatever the schedule says */
    const getNow = ui.button('Get last sale now', 'mini primary', async function () {
      this.disabled = true;
      this.textContent = 'Asking viagogo…';
      let r;
      try {
        r = await ui.send('lastSaleCheckNow', { vgEventId: id, title: ev.title || '', when: ev.when || '', sessionId: ev.sessionId || '', by: 'hand' });
      } catch (e) {
        r = { kind: 'error', why: e.message };
      }
      asked[id] = { at: Date.now(), r };
      changed();
    }, 'Ask viagogo for this event\'s latest sale now: saved if it is new, skipped if it is the one already saved');
    if (x.blockedUntil) getNow.disabled = true;
    const answer = () => {
      const a = asked[id];
      if (a && Date.now() - a.at < 10 * 60000) say(`${U.fmtClock(a.at)}: ${answerText(a.r)}`, ['sale', 'same', 'none', 'recent'].includes(a.r.kind) ? 'ok' : 'warn');
    };

    if (!x.every) {
      say('The last-sales scan is off for the team (popup → viagogo last sales).');
      const row = ui.el('div', 'sk-lsw-row');
      row.append(getNow);
      box.append(row);
      answer();
      return box;
    }

    const e = (x.list || []).find(y => y.vgEventId === id);
    if (e && e.on) {
      say(`Last sales: scanned every ${e.every} min (${L.SOURCE_TEXT[e.source] || e.source}).`);
      say(e.lastAt
        ? `Last asked ${at(e.lastAt)}${e.lastBy && e.lastBy !== 'scan' ? ` ${L.BY_TEXT[e.lastBy] || ''}` : ''}${e.lastResult ? ` — ${L.RESULT_TEXT[e.lastResult] || e.lastResult}` : ''}.`
        : 'Not asked yet.');
      if (e.skipUntil) say(`Set aside until ${U.fmtAt(e.skipUntil)}: viagogo had no sell page for it twice.`);
      else if (x.holder) say(`${x.holder} does the asking, so its next turn is not known here.`);
      else if (!x.here) say('This PC does not take part in the scan.');
      else if (e.etaAt) say(`Next: about ${next(e.etaAt)}.`);

      const row = ui.el('div', 'sk-lsw-row');
      const sel = ui.el('select');
      const opt = (v, label) => { const o = ui.el('option', null, label); o.value = v; if (String(e.ownEvery || '') === v) o.selected = true; sel.append(o); };
      opt('', `Every ${x.every} min (team)`);
      for (const n of L.EVENT_EVERY) opt(String(n), n < 60 ? `Every ${n} min` : `Every ${n / 60} h`);
      sel.addEventListener('change', () => send({ every: sel.value ? Number(sel.value) : null }, sel));
      const stop = ui.button(e.source === 'added' ? 'Remove from the scan' : 'Leave this event out', 'mini', function () { send({ on: false }, this); },
        e.source === 'added' ? 'Stop asking viagogo about this event' : 'Stop asking viagogo about this event, though the team lists on it');
      row.append(getNow, sel, stop);
      box.append(row);
    } else {
      say(e ? `Last sales: left out of the scan (${L.SOURCE_TEXT[e.source] || e.source}).` : 'Last sales: this event is not scanned.');
      if (e && e.lastAt) say(`Last asked ${at(e.lastAt)}${e.lastResult ? ` — ${L.RESULT_TEXT[e.lastResult] || e.lastResult}` : ''}.`);
      const row = ui.el('div', 'sk-lsw-row');
      row.append(ui.button(e ? 'Scan it again' : 'Scan this event\'s last sales', 'mini', function () { send({ on: true }, this); },
        `Ask viagogo for this event's latest sale every ${x.every} min, with no page open`), getNow);
      box.append(row);
    }
    answer();

    if (x.blockedUntil) {
      say(blockText(x), 'warn');
      const row = ui.el('div', 'sk-lsw-row');
      row.append(ui.button('Start again now', 'mini', async function () {
        this.disabled = true;
        await ui.send('vgUnblock').catch(() => {});
        changed();
      }, 'Only once viagogo pages open normally in this browser again (pass its check in a tab first)'));
      box.append(row);
    } else if (x.pausedUntil) {
      say(`Paused until ${U.fmtAt(x.pausedUntil)}: ${x.pausedWhy}.`, 'warn');
    } else if (x.slowUntil) {
      say(`Going at half speed until ${U.fmtAt(x.slowUntil)}, after viagogo's bot check.`);
    }
    return box;
  }

  SK.lastSaleWatchUI = lastSaleWatchUI;
  lastSaleWatchUI.answerText = answerText;
  lastSaleWatchUI.blockText = blockText;
})();
