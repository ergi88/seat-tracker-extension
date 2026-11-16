/* ------------------------------------------------------------------
 * Seat Tracker - eBileta checkout (…/biglietteria/trans/transazione.do)
 *
 * A drawer at the bottom of the confirmation page with two jobs:
 *
 *   Participants  every ticket's last name, name, birth date and email in
 *                 one table, and an "All tickets" row that fills them all at
 *                 once (from one of your buying accounts, or typed). It writes
 *                 straight into eBileta's own fields; nothing is submitted.
 *   Purchase      the order as purchases of the buy tracker: one per sector,
 *                 with the account, the tickets, what one cost (price + fee),
 *                 the order code and the request it fills.
 *   New account   a buying account saved from here, without the app: its
 *                 email, names and birth date (taken from the "All tickets"
 *                 row when typed there first).
 *
 * The page, as captured on 2026-10-13: one tr.group[data-item] per ticket.
 * data-item is JSON (eveId, id, dataInizio); the description cell reads
 * "… Shqiperi - Finlande TRIBUNA N104 Rreshti Q Vendi 10 Normal10 (Price
 * Lekë1 000,00 + Booking fee Lekë48,00)"; the participant inputs carry the
 * classes tCognome, tNome, tDataNascita (dd/mm/yyyy) and tMail. The order
 * code is the first line of the Details fieldset, the client the #cliente
 * link ("Client: agasi laert").
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK || !SK.ui || !SK.profit) return;
  const ui = SK.ui, U = SK.util, P = SK.profit;

  const SITE = location.origin === 'https://eu.ebileta.al' ? 'ebileta-ks' : 'ebileta';
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const textOf = n => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');

  /* ---------------- reading the page ---------------------------------- */

  function readCheckout(doc) {
    const out = { code: '', status: '', client: '', tickets: [] };
    const details = [...doc.querySelectorAll('#corpo > fieldset')].find(f => !f.classList.contains('datipartecipante'));
    const lines = details ? [...details.querySelectorAll('p')] : [];
    if (lines[0]) { const s = lines[0].querySelectorAll('strong'); out.code = textOf(s[1] || s[0]); }
    if (lines[1]) out.status = textOf(lines[1]).replace(/^[^:]*:\s*/, '');
    out.client = textOf(doc.querySelector('#cliente a')).replace(/^[^:]*:\s*/, '');

    for (const tr of doc.querySelectorAll('tr.group[data-item]')) {
      let item = {};
      try { item = JSON.parse(tr.getAttribute('data-item')); } catch (e) { /* keep what the row shows */ }
      const text = textOf(tr.querySelector('td.descrizione'));
      const unit = tr.querySelector('td.importo');
      const paid = unit ? P.parseMoney(textOf(unit)) : null;
      const q = c => tr.querySelector('input.' + c);
      out.tickets.push({
        id: String(item.id || ''), eveId: String(item.eveId || ''), start: String(item.dataInizio || ''), text,
        place: ((/(\S+\s+\S+)\s+(?:Rreshti|Row|Fila)\b/i.exec(text) || [])[1] || '').trim(),
        row: ((/(?:Rreshti|Row|Fila)\s+(\S+)/i.exec(text) || [])[1] || ''),
        seat: ((/(?:Vendi|Seat|Posto)\s+(\S+)/i.exec(text) || [])[1] || ''),
        price: paid ? paid.amount : null, currency: (paid && paid.currency) || (SITE === 'ebileta-ks' ? 'EUR' : 'ALL'),
        inputs: { last: q('tCognome'), first: q('tNome'), birth: q('tDataNascita'), email: q('tMail') }
      });
    }
    return out;
  }

  /* the tracked event this order is for: its own id, else its name and day in the ticket's text */
  function eventFor(state, t) {
    const events = ((state && state.events) || []).filter(e => e.site === SITE);
    const direct = events.find(e => String(e.siteId) === t.eveId);
    if (direct) return direct;
    const day = t.start.slice(0, 10), text = norm(t.text);
    return events.find(e => {
      const info = U.eventInfo(e);
      return info.name && text.includes(norm(info.name)) && (!info.date || !day || info.date === day);
    }) || null;
  }

  /* the sector a ticket is in: the longest sector name or code the text holds as a word */
  function sectorFor(ev, t) {
    if (!ev) return null;
    const text = ' ' + norm(t.text) + ' ';
    let best = null, len = 0;
    for (const s of ev.sectors || []) {
      for (const k of [s.name, s.code]) {
        const w = norm(k);
        if (w && w.length > len && text.includes(' ' + w + ' ')) { best = s; len = w.length; }
      }
    }
    return best;
  }

  /* ---------------- writing eBileta's fields -------------------------- */

  function setField(input, value) {
    if (!input || input.value === value) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const isoToDmy = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const okDmy = v => !v || /^\d{2}\/\d{2}\/\d{4}$/.test(v);
  const dmyToIso = dmy => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };

  /* ---------------- the drawer ---------------------------------------- */

  let state = null, page = null, host = null, app = null, stopped = false;
  let open = true;
  const all = { last: '', first: '', birth: '', email: '' };
  let fillFrom = '';                          // account picked for "All tickets"
  let buyer = null;                           // account picked for the purchase (null = suggested)
  const pickedRequest = {};                   // group key -> request id ('' = none)
  let newAcc = null;                          // the new-account form while it is open
  let notice = null;

  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'sk-eb-checkout';
    host.setAttribute('style', 'all: initial; position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483646;');
    const shadow = host.attachShadow({ mode: 'open' });
    for (const href of ['ui/app.css', 'content/checkout.css']) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = chrome.runtime.getURL(href);
      shadow.append(l);
    }
    app = document.createElement('div');
    app.className = 'sk-app ck-drawer';
    for (const t of ['keydown', 'keyup', 'keypress']) app.addEventListener(t, e => e.stopPropagation());
    shadow.append(app);
    document.documentElement.append(host);
    /* the page keeps room under its own buttons for the drawer */
    const room = app;
    new ResizeObserver(() => { if (app === room) document.body.style.paddingBottom = room.offsetHeight + 24 + 'px'; }).observe(room);
  }

  function unmount() {
    if (host) host.remove();
    host = null; app = null;
    document.body.style.paddingBottom = '';
  }

  const accounts = () => (state && state.buyAccounts) || [];
  const fullName = a => [a.firstName, a.lastName].filter(Boolean).join(' ');

  function limitOf(ev) {
    const s = (state && state.settings) || {};
    return ev ? ((s.eventBuyLimits || {})[ev.key] || (s.buyLimits || {})[ev.site] || null) : null;
  }
  const usedBy = (ev, a) => ((state && state.purchases) || [])
    .filter(p => ev && p.eventKey === ev.key && p.accountId === a.id).reduce((n, p) => n + p.qty, 0);

  /* the account the order is on: the one named like eBileta's client, else the one with most left */
  function suggestedBuyer(ev) {
    const list = accounts();
    const client = norm(page.client);
    const named = client && list.find(a => [norm(`${a.firstName} ${a.lastName}`), norm(`${a.lastName} ${a.firstName}`)].includes(client));
    if (named) return named;
    const lim = limitOf(ev);
    return list.slice().sort((a, b) => (lim ? (lim - usedBy(ev, b)) - (lim - usedBy(ev, a)) : usedBy(ev, a) - usedBy(ev, b)))[0] || null;
  }

  function groupsOf(ev) {
    const groups = new Map();
    for (const t of page.tickets) {
      const sec = sectorFor(ev, t);
      const key = sec ? 'id:' + sec.id : 'txt:' + (t.place || '?');
      if (!groups.has(key)) groups.set(key, { key, sector: sec, label: sec ? sec.code : (t.place || 'this order'), tickets: [] });
      groups.get(key).tickets.push(t);
    }
    for (const g of groups.values()) {
      const prices = g.tickets.map(t => t.price).filter(n => n > 0);
      g.price = prices.length ? Math.max(...prices) : null;
      g.currency = g.tickets[0].currency;
    }
    return [...groups.values()];
  }

  function render() {
    if (!ui.alive()) return shutdown();
    if (!state || !page || !page.tickets.length) { unmount(); return; }
    if (!SK.settings.panelOn(state.settings, SITE, 'checkout')) { unmount(); return; }
    mount();
    ui.applyTheme(app, state.settings.theme);
    app.classList.toggle('open', open);
    const keep = app.querySelector('.ck-body');
    const scroll = keep ? keep.scrollTop : 0;
    app.textContent = '';

    const ev = eventFor(state, page.tickets[0]);
    const groups = groupsOf(ev);

    /* the bar: what this order is, and the fold */
    const bar = ui.el('div', 'ck-bar');
    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL('icons/32.png');
    logo.className = 'logo';
    logo.alt = '';
    const titles = ui.el('div', 'ck-titles');
    titles.append(ui.el('b', null, `Checkout · ${ev ? U.eventInfo(ev).name : 'event not tracked'}`));
    titles.append(ui.el('span', null, [U.plural(page.tickets.length, 'ticket'), groups.map(g => g.label).join(', '), page.code ? 'order ' + page.code : '', page.status].filter(Boolean).join(' · ')));
    bar.append(logo, titles, ui.el('span', 'spacer'), ui.button(open ? '▾' : '▴', 'ghost mini', () => { open = !open; render(); }, open ? 'Fold the drawer' : 'Open the drawer'));
    bar.addEventListener('dblclick', () => { open = !open; render(); });
    app.append(bar);
    if (!open) return;

    const body = ui.el('div', 'ck-body');
    if (notice) body.append(ui.el('div', 'ck-notice' + (notice.bad ? ' bad' : ''), notice.text));
    if (newAcc) body.append(accountForm());
    body.append(participants(), purchase(ev, groups));
    app.append(body);
    body.scrollTop = scroll;
  }

  /* ---------------- a new buying account --------------------------------- */

  /* opens the form with whatever the "All tickets" row already holds */
  function startAccount() {
    newAcc = { email: all.email.trim(), first: all.first.trim(), last: all.last.trim(), birth: all.birth.trim() };
    render();
    const first = host && host.shadowRoot.querySelector('.ck-new input');
    if (first) first.focus();
  }
  const newAccountButton = cls => ui.button('+ New account', cls || 'mini', startAccount, 'Save another email you buy with, here or later in the app');

  function accountForm() {
    const box = ui.el('section', 'ck-card ck-new');
    const head = ui.el('div', 'ck-head');
    head.append(ui.el('h3', null, 'New buying account'));
    box.append(head);
    const grid = ui.el('div', 'ck-new-grid');
    const field = (k, label, ph, type) => {
      const l = ui.el('label');
      const i = ui.el('input', 'ck-in' + (k === 'birth' && !okDmy(newAcc.birth) ? ' bad' : ''));
      if (type) i.type = type;
      i.value = newAcc[k];
      i.placeholder = ph;
      i.addEventListener('input', () => { newAcc[k] = i.value; i.classList.toggle('bad', k === 'birth' && !okDmy(i.value.trim())); });
      i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { newAcc = null; render(); } });
      l.append(ui.el('span', null, label), i);
      grid.append(l);
    };
    field('email', 'Email', 'name@example.com', 'email');
    field('last', 'Last name', 'last name');
    field('first', 'Name', 'name');
    field('birth', 'Birth date', 'dd/mm/yyyy');
    box.append(grid);
    const actions = ui.el('div', 'ck-actions');
    const submit = async () => {
      if (save.disabled) return;
      const birth = newAcc.birth.trim();
      if (!okDmy(birth)) { say('Birth date as dd/mm/yyyy, e.g. 05/06/1998.', true); return; }
      save.disabled = true;
      try {
        const a = await ui.send('saveBuyAccount', { account: { email: newAcc.email, firstName: newAcc.first, lastName: newAcc.last, birthday: dmyToIso(birth) } });
        newAcc = null;
        /* the new account is the one in use: for the names and for the purchase */
        fillFrom = a.id;
        buyer = a.id;
        Object.assign(all, { last: a.lastName || all.last, first: a.firstName || all.first, birth: isoToDmy(a.birthday) || all.birth });
        await refresh();
        say(`Saved ${a.email}. Apply to all to fill the tickets with it.`);
      } catch (e) { save.disabled = false; say(e.message, true); }
    };
    const save = ui.button('Save account', 'mini primary', submit);
    actions.append(save, ui.button('Cancel', 'mini ghost', () => { newAcc = null; render(); }));
    box.append(actions);
    box.append(ui.el('p', 'note', 'Saved to your buying accounts (only you see them), the same list as Settings → Buying in the app.'));
    return box;
  }

  /* ---------------- participants ---------------------------------------- */

  function participants() {
    const box = ui.el('section', 'ck-card');
    const head = ui.el('div', 'ck-head');
    head.append(ui.el('h3', null, 'Participants'));
    const pick = ui.el('select', 'ck-select');
    pick.append(new Option('Fill from an account…', ''));
    for (const a of accounts()) pick.append(new Option(`${fullName(a) || a.email} · ${a.email}`, a.id));
    pick.value = fillFrom;
    pick.title = 'Copies the account\'s last name, name and birth date into the "All tickets" row';
    pick.addEventListener('change', () => {
      fillFrom = pick.value;
      const a = accounts().find(x => x.id === fillFrom);
      if (a) Object.assign(all, { last: a.lastName, first: a.firstName, birth: isoToDmy(a.birthday) || all.birth });
      render();
    });
    const tools = ui.el('div', 'ck-tools');
    tools.append(pick);
    if (!newAcc) tools.append(newAccountButton());
    head.append(tools);
    box.append(head);
    if (!accounts().length) box.append(ui.el('p', 'note', 'No buying account yet: press "+ New account" to save one, then fill names from it.'));

    const table = ui.el('table', 'ck-table');
    const tr = (cells, cls) => { const r = ui.el('tr', cls); for (const c of cells) r.append(c); return r; };
    const th = t => ui.el('th', null, t);
    table.append(tr([th('Ticket'), th('Last name'), th('Name'), th('Birth date'), th('Email'), th('')]));

    /* the row that fills every ticket */
    const allInput = (k, ph) => {
      const i = ui.el('input', 'ck-in' + (k === 'birth' && !okDmy(all.birth) ? ' bad' : ''));
      i.value = all[k];
      i.placeholder = ph;
      i.addEventListener('input', () => { all[k] = i.value; i.classList.toggle('bad', k === 'birth' && !okDmy(i.value)); });
      const td = ui.el('td'); td.append(i); return td;
    };
    const apply = ui.button('Apply to all', 'mini primary', () => {
      if (!okDmy(all.birth.trim())) { say('Birth date as dd/mm/yyyy, e.g. 05/06/1998.', true); return; }
      let n = 0;
      for (const t of page.tickets) {
        for (const k of ['last', 'first', 'birth', 'email']) {
          const v = all[k].trim();
          if (v && t.inputs[k]) { setField(t.inputs[k], v); n++; }
        }
      }
      say(n ? `Filled ${U.plural(page.tickets.length, 'ticket')}. Check them, then pay on the page.` : 'Type something in the "All tickets" row first.', !n);
    }, 'Writes every filled box of this row into every ticket; empty boxes leave the tickets as they are');
    const applyTd = ui.el('td'); applyTd.append(apply);
    table.append(tr([ui.el('td', 'ck-all', 'All tickets'), allInput('last', 'last name'), allInput('first', 'name'),
      allInput('birth', 'dd/mm/yyyy'), allInput('email', 'leave empty to keep'), applyTd], 'all'));

    /* one row per ticket, bound to eBileta's own inputs */
    for (const t of page.tickets) {
      const cell = k => {
        const td = ui.el('td');
        const src = t.inputs[k];
        if (!src) { td.textContent = '—'; return td; }
        const i = ui.el('input', 'ck-in' + (k === 'birth' && !okDmy(src.value) ? ' bad' : ''));
        i.value = src.value;
        i.addEventListener('input', () => { setField(src, i.value); i.classList.toggle('bad', k === 'birth' && !okDmy(i.value)); });
        td.append(i);
        return td;
      };
      const label = ui.el('td', 'ck-seat');
      label.append(ui.el('b', null, [t.place.replace(/^tribuna\s+/i, ''), t.row && 'R' + t.row, t.seat && 'S' + t.seat].filter(Boolean).join(' ')));
      table.append(tr([label, cell('last'), cell('first'), cell('birth'), cell('email'), ui.el('td')]));
    }
    const wrap = ui.el('div', 'ck-table-wrap');
    wrap.append(table);
    box.append(wrap);
    box.append(ui.el('p', 'note', 'Changes go straight into eBileta\'s boxes above. Nothing is sent until you press "Proceed with the payment" on the page.'));
    return box;
  }

  /* ---------------- the purchase ---------------------------------------- */

  function purchase(ev, groups) {
    const box = ui.el('section', 'ck-card');
    const head = ui.el('div', 'ck-head');
    head.append(ui.el('h3', null, 'Add purchase'));
    box.append(head);
    if (!ev) {
      box.append(ui.el('p', 'note', 'This event is not tracked, so the purchase has nowhere to go. Track it from its sector page first.'));
      return box;
    }
    const list = accounts();
    if (!list.length) {
      box.append(ui.el('p', 'note', 'No buying account yet. Save the email this order is on, then add the order.'));
      if (!newAcc) box.append(newAccountButton('primary'));
      return box;
    }
    const done = ((state && state.purchases) || []).filter(p => p.eventKey === ev.key && page.code && p.orderRef === page.code);
    if (done.length) {
      const a = list.find(x => x.id === done[0].accountId);
      box.append(ui.el('div', 'ck-done', `✓ Added: ${U.plural(done.reduce((n, p) => n + p.qty, 0), 'ticket')} of order ${page.code} on ${a ? a.email : 'an account'}.`));
      return box;
    }

    const lim = limitOf(ev);
    const chosen = list.find(a => a.id === buyer) || suggestedBuyer(ev);
    const sel = ui.el('select', 'ck-select');
    for (const a of list) {
      const used = usedBy(ev, a);
      sel.append(new Option(`${a.email}${fullName(a) ? ' · ' + fullName(a) : ''} — ${lim ? `${used} / ${lim}` : `${used} bought`}`, a.id));
    }
    sel.value = chosen ? chosen.id : '';
    sel.addEventListener('change', () => { buyer = sel.value; render(); });
    const accLine = ui.el('div', 'ck-line');
    accLine.append(ui.el('span', null, 'Account'), sel);
    if (!newAcc) accLine.append(newAccountButton());
    box.append(accLine);
    if (page.client) box.append(ui.el('p', 'note', `eBileta says the client is ${page.client}.`));

    const total = page.tickets.length;
    const after = chosen ? usedBy(ev, chosen) + total : total;
    if (lim && after > lim) box.append(ui.el('div', 'ck-warn', `Over the limit: ${chosen.email} would have ${after} of ${lim} for this event.`));

    /* one purchase per sector of the order */
    const mine = ((state && state.requests) || []).filter(r => r.eventKey === ev.key && !r.done);
    for (const g of groups) {
      const row = ui.el('div', 'ck-group');
      row.append(ui.el('b', null, `${g.label} · ${U.plural(g.tickets.length, 'ticket')}`));
      row.append(ui.el('span', 'm', g.price ? `${P.formatMoney(g.price, g.currency)} each, fee included` : 'price not read'));
      const rs = ui.el('select', 'ck-select');
      rs.append(new Option('no request', ''));
      const here = g.sector ? mine.filter(r => String(r.sec) === String(g.sector.id)) : [];
      for (const r of mine) rs.append(new Option(`#${r.num} ${r.code} ×${r.qty}${r.client ? ' · ' + r.client : ''}${r.bought ? ' · bought' : ''}`, r.id));
      if (!(g.key in pickedRequest)) pickedRequest[g.key] = (here.find(r => !r.bought) || here[0] || { id: '' }).id;
      rs.value = pickedRequest[g.key];
      rs.addEventListener('change', () => { pickedRequest[g.key] = rs.value; });
      rs.title = 'The request these tickets fill: enough of them make it Bought';
      row.append(rs);
      box.append(row);
    }

    const go = ui.button(`Add ${U.plural(total, 'ticket')} to ${chosen ? chosen.email : 'the account'}`, 'primary', async () => {
      go.disabled = true;
      try {
        const items = groups.map(g => ({
          accountId: chosen.id, eventKey: ev.key, sectorId: g.sector ? g.sector.id : null, requestId: pickedRequest[g.key] || null,
          qty: g.tickets.length, price: g.price, currency: g.currency, orderRef: page.code,
          notes: page.tickets.filter(t => g.tickets.includes(t)).map(t => [t.row && 'R' + t.row, t.seat && 'S' + t.seat].filter(Boolean).join(' ')).join(', ')
        }));
        await ui.send('savePurchases', { items });
        say(`Added ${U.plural(total, 'ticket')} on ${chosen.email}.`);
        await refresh();
      } catch (e) { say(e.message, true); go.disabled = false; }
    });
    go.disabled = !chosen;
    box.append(go);
    box.append(ui.el('p', 'note', page.status && /wait|attes|pritje/i.test(page.status)
      ? 'This order is not paid yet. Add it now or after paying; if you do not pay, delete it in the app.'
      : 'Shows in the app under the event\'s Buys.'));
    return box;
  }

  function say(text, bad) {
    notice = { text, bad: !!bad };
    render();
    clearTimeout(say.t);
    say.t = setTimeout(() => { notice = null; render(); }, 6000);
  }

  /* ---------------- state ---------------------------------------------- */

  /* a redraw rebuilds the boxes: never while one of them has the caret */
  const typing = () => !!(host && host.shadowRoot && host.shadowRoot.activeElement &&
    /^(INPUT|SELECT)$/.test(host.shadowRoot.activeElement.tagName));

  async function refresh() {
    if (!ui.alive()) return shutdown();
    try { state = await ui.send('state', {}); } catch (e) { return; }
    if (typing()) { app.addEventListener('focusout', () => setTimeout(render, 0), { once: true }); return; }
    render();
  }

  function shutdown() {
    stopped = true;
    unmount();
  }

  async function boot() {
    page = readCheckout(document);
    if (!page.tickets.length) return;
    /* a typed name on the page itself redraws the drawer's copy, unless you are typing in the drawer */
    document.addEventListener('input', e => {
      if (stopped || !e.isTrusted || !(e.target instanceof HTMLInputElement) || !/\bt(Cognome|Nome|DataNascita|Mail)\b/.test(e.target.className)) return;
      clearTimeout(boot.t);
      boot.t = setTimeout(() => { if (!typing()) render(); }, 250);
    }, true);
    await refresh();
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || stopped) return;
        if (!Object.keys(changes).some(k => k !== 'ui' && !k.startsWith('cache:'))) return;
        clearTimeout(refresh.t);
        refresh.t = setTimeout(refresh, 300);
      });
    } catch (e) { /* extension context gone */ }
  }

  SK.ebCheckout = { readCheckout, eventFor, sectorFor };
  boot();
})();
