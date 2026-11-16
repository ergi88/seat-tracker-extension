/* ------------------------------------------------------------------
 * Seat Tracker - popup
 * Also opens as a full tab (popup.html?page=1), used by the sidebar's
 * Settings button and for importing a file.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  const U = SK.util;
  const P = SK.profit;
  const ui = SK.ui;
  const $ = id => document.getElementById(id);
  const asPage = new URLSearchParams(location.search).has('page');
  if (asPage) document.body.classList.add('as-page');

  const local = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not important */ } }
  };

  const collapsed = new Set(local.get('sk.collapsed', []));
  let showArchived = false;
  let mainView = local.get('sk.mainView', 'listings');   // listings | events, this PC
  let statusFilter = local.get('sk.listingStatus', 'all');   // all | active | pending | deactivated | sold | other
  let search = '';            // the header search: sector or listing ID
  let menuFor = null;
  let muteMenu = false;
  let dirty = false;
  let notice = null;
  let cmdText = '';
  let cmdOut = '';
  const signIn = { email: local.get('sk.lastEmail', ''), password: '', device: '' };

  const ctx = {
    state: null,
    expanded: new Set(),
    addDraft: null,
    idPrefix: 'pop',
    refresh: force => refresh(force),
    rerender: () => render(),
    notice(text, isError) {
      notice = { text, isError, at: Date.now() };
      renderStatus();
      setTimeout(renderStatus, 6100);
    },
    openUrl: url => openUrl(url),
    /* Only eBileta can hold seats, and only a request whose sector has a seat
     * page to open. Everywhere else the button would be a lie, so it is not
     * drawn at all. */
    canReserve(r) {
      const st = ctx.state;
      const ev = st && ui.eventOf(st, r.eventKey);
      return !!(r.sectorUrl && ev && ui.siteOf(st, ev.site).can.hold && st.settings.selectSeats);
    },
    onReserve(r, qty) {
      const n = Math.max(1, Number(qty) || r.qty);
      ctx.openUrl(`${r.sectorUrl}#sk-reserve=${n}`);
    }
  };

  /* Opening a listing while you are already looking at your viagogo listings
   * should change that page, not stack another tab on top of it. Same page
   * means the same origin and the same path — a different query is what
   * picking a listing changes. Anything else still opens its own tab. */
  function samePage(a, b) {
    try {
      const x = new URL(a), y = new URL(b);
      return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '');
    } catch (e) {
      return false;
    }
  }

  async function openUrl(url) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      /* tab.url needs a host permission for that address; we have viagogo's */
      if (tab && tab.url && samePage(tab.url, url)) {
        await chrome.tabs.update(tab.id, { url });
        window.close();
        return;
      }
    } catch (e) { /* no permission to see it: open a tab, as before */ }
    await chrome.tabs.create({ url });
  }

  async function refresh(force) {
    try {
      ctx.state = await ui.send('state', { scansFor: 'priced' });
    } catch (e) {
      ctx.notice(e.message, true);
      return;
    }
    if (!force && ui.typingIn(document)) { dirty = true; return; }
    render();
  }

  function render() {
    const st = ctx.state;
    if (!st) return;
    dirty = false;
    ui.applyTheme(document.body, st.settings.theme);
    const signedIn = st.auth.signedIn;
    $('login').hidden = signedIn;
    $('main').hidden = !signedIn;
    $('muteBtn').hidden = !signedIn;
    $('scanBtn').hidden = !signedIn;
    $('search').hidden = !signedIn;
    renderHeader();
    renderStatus();
    renderUpdateBar();
    if (!signedIn) { renderLogin(); return; }
    renderMain();
    renderAdd();
    renderLastSales();
    renderTeam();
    renderUpdate();
    renderSettings();
    renderPhone();
    renderBackup();
  }

  /* ---------------- sign in ----------------------------------------- */

  function renderLogin() {
    const box = $('login');
    box.textContent = '';
    box.append(ui.el('h2', 'login-title', 'Sign in to your team'));
    box.append(ui.el('p', 'note', 'Events and scans are shared with your team; your requests, numbers and alerts stay yours. Use the email and password you were given.'));

    const email = ui.textInput(signIn.email, null, 'you@example.com');
    email.type = 'email';
    email.addEventListener('input', () => { signIn.email = email.value; });
    const pass = ui.textInput(signIn.password, null, 'password');
    pass.type = 'password';
    pass.addEventListener('input', () => { signIn.password = pass.value; });
    const device = ui.textInput(signIn.device || ctx.state.device.name || '', null, 'e.g. Ergi laptop');
    device.addEventListener('input', () => { signIn.device = device.value; });

    const form = ui.el('div', 'form');
    form.append(
      ui.labelled('Email', email, 'wide'),
      ui.labelled('Password', pass, 'wide'),
      ui.labelled('Name for this PC', device, 'wide')
    );
    const go = ui.button('Sign in', 'primary wide', () => ui.busy(go, async () => {
      if (!signIn.email.trim() || !signIn.password) throw new Error('Type your email and password.');
      await ui.send('signIn', { email: signIn.email, password: signIn.password, deviceName: signIn.device || device.value });
      local.set('sk.lastEmail', signIn.email.trim());
      signIn.password = '';
      ctx.notice('Signed in.');
      await refresh(true);
    }, ctx));
    pass.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
    form.append(go);
    box.append(form);
  }

  /* ---------------- header, mute, status ---------------------------- */

  function renderHeader() {
    const st = ctx.state;
    if (!st.auth.signedIn) {
      $('sub').textContent = 'not signed in on this PC';
      return;
    }
    const open = st.requests.filter(r => !r.done).length;
    const synced = st.meta.lastSyncAt ? `synced ${U.ago(st.meta.lastSyncAt)}` : 'not synced yet';
    $('sub').textContent = `${st.auth.displayName || st.auth.email} · ${U.plural(open, 'open request')} · ${synced}`;

    const muted = st.snoozeUntil > Date.now();
    const mb = $('muteBtn');
    mb.textContent = muted ? '🔕' : '🔔';
    mb.title = muted ? `Muted until ${U.fmtClock(st.snoozeUntil)} — click to change` : 'Mute your alerts for a while';
    mb.classList.toggle('on', muted);

    const menu = $('muteMenu');
    menu.hidden = !muteMenu;
    menu.textContent = '';
    if (muteMenu) {
      menu.append(ui.el('span', 'muted', muted ? `Muted until ${U.fmtClock(st.snoozeUntil)} ·` : 'Mute your alerts for'));
      for (const [label, mins] of [['30 min', 30], ['1 h', 60], ['3 h', 180], ['8 h', 480]]) {
        menu.append(ui.button(label, 'mini', () => snooze(mins)));
      }
      if (muted) menu.append(ui.button('Unmute', 'mini primary', () => snooze(0)));
    }
  }

  async function snooze(minutes) {
    muteMenu = false;
    try {
      await ui.send('snooze', { minutes });
      ctx.notice(minutes ? `Your alerts are muted for ${minutes >= 60 ? minutes / 60 + ' h' : minutes + ' min'}. Phone commands still answer.` : 'Your alerts are on again.');
    } catch (e) {
      ctx.notice(e.message, true);
    }
    refresh(true);
  }

  function renderStatus() {
    const bar = $('statusbar');
    const st = ctx.state;
    let text = '', cls = 'statusbar';
    const conn = st && ui.connectionNote(st, b => ui.retrySync(b, ctx));
    if (notice && Date.now() - notice.at < 6000) { text = notice.text; cls += notice.isError ? ' err' : ' ok'; }
    else if (st && st.auth.problem) { text = st.auth.problem; cls += ' err'; }
    else if (conn) {
      bar.className = 'statusbar conn-wrap';
      bar.textContent = '';
      bar.append(conn);
      bar.hidden = false;
      return;
    }
    else if (st && ui.recentError(st.meta)) { text = ui.recentError(st.meta); cls += ' err'; }
    bar.className = cls;
    bar.textContent = text;
    bar.hidden = !text;
  }

  /* ---------------- events and their requests ----------------------- */

  async function scanNow(eventKey, scope) {
    const r = await ui.send('scan', eventKey ? { eventKey, scope } : {});
    if (r.errors && r.errors.length) ctx.notice(r.errors[0], true);
    else ctx.notice(eventKey ? `Scanned ${U.plural(r.scanned, 'sector')}.` : `Scanned ${U.plural(r.scanned, 'sector')} in ${U.plural(r.events, 'event')}.`);
    refresh(true);
  }

  /* ---------------- listings vs events ------------------------------- */

  /* Seat Tracker follows viagogo listings first, so that is the view the popup
   * opens on. Events is the old list, one click away and remembered per PC. */
  function renderMain() {
    const st = ctx.state;
    const box = $('viewswitch');
    box.textContent = '';
    box.append(ui.segmented(
      [{ value: 'listings', label: `Listings${st.listings.length ? ' · ' + st.listings.length : ''}` },
        { value: 'events', label: `Events${st.events.filter(e => e.total > 0).length ? ' · ' + st.events.filter(e => e.total > 0).length : ''}` }],
      mainView,
      v => { mainView = v; local.set('sk.mainView', v); renderMain(); }
    ));
    $('listings').hidden = mainView !== 'listings';
    $('events').hidden = mainView === 'listings';
    if (mainView === 'listings') renderListings(); else renderEvents();
  }

  function renderListings() {
    const st = ctx.state;
    const box = $('listings');
    box.textContent = '';

    /* viagogo is only ever read from a tab you can see, never in the background,
     * so revalidating means opening the page and letting it walk itself. */
    const sweepHref = SK.viagogo.sweepUrl(null);
    const openListingsPage = () => ctx.openUrl(sweepHref);
    const revalidate = () => ctx.openUrl(sweepHref + '#sk-scan');

    const head = ui.el('div', 'list-head');
    head.append(ui.el('span', 'list-title', 'My listings'), ui.el('span', 'spacer'));
    if (st.listings.length) {
      head.append(ui.button('Scan listings', 'mini primary', revalidate,
        'Opens your viagogo listings page and reads every listing you have there — every status, from viagogo\'s own list, no page turning'));
    }
    head.append(ui.helpButton('requests', document.body));
    box.append(head);

    if (!st.listings.length) {
      box.append(ui.el('p', 'empty', 'No listings read yet.'));
      box.append(ui.el('p', 'note', 'Seat Tracker never contacts viagogo on its own. Open your listings page and every card is read as it scrolls into view.'));
      box.append(ui.button('Read my viagogo listings ↗', 'primary', openListingsPage));
      return;
    }

    /* when viagogo was last read. A full sweep is what proves a listing is
     * gone; until one has run, this only says how fresh the numbers are. */
    const seen = st.listings.map(l => l.seenAt || 0).filter(Boolean);
    const swept = st.listings.map(l => l.lastSweepAt || 0).filter(Boolean);
    const top = ui.el('div', 'list-top');
    top.append(ui.el('span', 'note', seen.length
      ? `Read on viagogo ${U.ago(Math.max(...seen))}${swept.length ? ` · last full check ${U.ago(Math.max(...swept))}` : ''}.`
      : 'Not read from viagogo yet.'));
    top.append(ui.button('Read my listings ↗', 'mini', openListingsPage,
      'Opens your viagogo listings page, where every card is read as it appears'));
    top.append(ui.forgetListingsButton(st, ctx, () => refresh(true)));
    box.append(top);

    /* the four states viagogo's own listings page filters by */
    const counts = {};
    for (const l of st.listings) counts[l.statusKind || 'other'] = (counts[l.statusKind || 'other'] || 0) + 1;
    const chips = ui.el('div', 'chips filter-chips');
    const chip = (key, label, n) => {
      const b = ui.button(n === null ? label : `${label} ${n}`, 'chip-btn' + (statusFilter === key ? ' on' : ''),
        () => { statusFilter = statusFilter === key ? 'all' : key; local.set('sk.listingStatus', statusFilter); renderListings(); });
      b.title = key === 'all' ? 'Show every listing' : `Show only listings viagogo calls ${label}`;
      return b;
    };
    chips.append(chip('all', 'All', st.listings.length));
    for (const s of SK.viagogo.LISTING_STATUSES) {
      if (counts[s.key]) chips.append(chip(s.key, s.label, counts[s.key]));
    }
    box.append(chips);

    const q = search.trim().toLowerCase();
    const matches = l =>
      (statusFilter === 'all' || (l.statusKind || 'other') === statusFilter)
      && (!q || [l.id, l.code, l.section, l.eventTitle, l.title].some(v => String(v || '').toLowerCase().includes(q)));

    let shown = 0;
    for (const g of ui.listingGroups(st)) {
      const items = g.items.filter(matches);
      if (!items.length) continue;
      shown += items.length;
      const gh = ui.el('div', 'group-head');
      gh.append(ui.el('span', 'group-title', g.title));
      if (g.sub) gh.append(ui.el('span', 'group-sub', g.sub));
      box.append(gh);
      /* what this event is worth: tickets, what they cost, what they earn */
      const t = g.totals;
      const sum = ui.el('div', 'group-sum');
      sum.append(ui.el('span', null, `${items.length} listing${items.length === 1 ? '' : 's'} · ${U.plural(t.tickets, 'ticket')}`));
      if (t.priced) {
        sum.append(ui.el('span', null, `cost ${P.formatLek(t.cost)}`));
        sum.append(ui.el('span', t.total >= 0 ? 'up' : 'dn', `${P.formatLek(t.total, true)} ${P.winRateText(t.winRate)}`));
      } else {
        sum.append(ui.el('span', 'muted', 'no buy price yet'));
      }
      box.append(sum);
      const ul = ui.el('ul', 'reqs');
      for (const l of ui.sortListings(items, st.settings.listSort)) {
        ul.append(ui.listingCard(l, ctx, {
          onOpen: x => ctx.openUrl(U.viagogoUrl(x.id)),
          onBuy: async (x, price, currency) => {
            try {
              await ui.send('setListingBuy', { id: x.id, price, currency });
              await refresh(true);
            } catch (e) { ctx.notice(e.message, true); }
          },
          onTrackEvent: () => ctx.notice('Open the event on viagogo and press "Track this event" in the drawer, or paste its link into Add a request.'),
          onLink: () => ctx.notice('Open my.viagogo.com/listings and press "Add as request" on that card — the sector is matched for you there.')
        }));
      }
      box.append(ul);
    }
    if (!shown) {
      const why = [q ? `nothing matches "${search.trim()}"` : '', statusFilter === 'all' ? '' : `none are ${statusFilter}`].filter(Boolean);
      box.append(ui.el('p', 'empty', why.length
        ? `Of your ${st.listings.length} listings, ${why.join(' and ')}.`
        : `None of your ${st.listings.length} listings could be grouped — reload the extension at chrome://extensions, then reopen this.`));
    }

  }

  function renderEvents() {
    const st = ctx.state;
    const box = $('events');
    box.textContent = '';

    if (st.legacy) {
      const card = ui.el('div', 'legacy-card');
      card.append(ui.el('strong', null, 'Requests from the old version are still on this PC'));
      card.append(ui.el('p', 'note', 'They were kept when this PC moved to the shared version. Import them into your account to keep using them.'));
      const go = ui.button('Import them into my account', 'primary mini', () => ui.busy(go, async () => {
        const r = await ui.send('importLegacy');
        ctx.notice(`Imported ${U.plural(r.added, 'request')} from this PC.`);
        await refresh(true);
      }, ctx));
      card.append(go);
      box.append(card);
    }

    const head = ui.el('div', 'list-head');
    head.append(ui.el('span', 'list-title', 'Events'), ui.el('span', 'spacer'), ui.helpButton('events', document.body));
    box.append(head);

    const withRequests = st.events.filter(e => e.total > 0);

    /* searching: every event with a match, archived or collapsed or not, and only the matches */
    const q = search.trim();
    if (q) {
      const hits = withRequests.filter(ev => st.requests.some(r => r.eventKey === ev.key && ui.requestMatches(r, ev, q)));
      if (!hits.length) box.append(ui.el('p', 'empty', `No request matches "${q}".`));
      for (const ev of hits) box.append(eventBlock(ev, q));
      return;
    }
    const shown = withRequests.filter(e => showArchived || !e.archived);
    if (!shown.length) {
      box.append(ui.el('p', 'empty', st.events.length
        ? 'You have no requests yet. Add one below.'
        : 'No events yet. Open an event page on eBileta, eFinity or Posttick and press "Track this event", or paste its link under "Add a request".'));
    }
    for (const ev of shown) box.append(eventBlock(ev));

    /* events nobody has requests in: safe to delete */
    const idle = st.events.filter(e => e.teamTotal === 0);
    if (idle.length) {
      const det = ui.el('details', 'idle-events');
      det.open = local.get('sk.idleOpen', false);
      det.addEventListener('toggle', () => local.set('sk.idleOpen', det.open));
      det.append(ui.el('summary', null, `${U.plural(idle.length, 'event')} without requests`));
      for (const ev of idle) {
        const row = ui.el('div', 'idle-row');
        const title = ui.el('span', 'event-title', `[${ev.num}] ${infoOf(ev).name}`);
        title.title = ev.title;
        row.append(
          title, ui.el('span', 'chip site', ev.siteLabel), ui.el('span', 'spacer'),
          ui.button('Open ↗', 'mini', () => ctx.openUrl(ev.url)),
          ui.button('Delete', 'mini danger', () => deleteEvent(ev))
        );
        det.append(row);
      }
      box.append(det);
    }

    const archived = withRequests.filter(e => e.archived).length;
    if (archived) {
      box.append(ui.button(showArchived ? 'Hide archived events' : `Show ${U.plural(archived, 'archived event')}`, 'ghost mini', () => {
        showArchived = !showArchived;
        render();
      }));
    }
  }

  function eventBlock(ev, q) {
    const st = ctx.state;
    const isCollapsed = !q && collapsed.has(ev.key);
    const sec = ui.el('section', `event${isCollapsed ? ' collapsed' : ''}${ev.archived ? ' archived' : ''}`);

    const toggle = () => {
      if (collapsed.has(ev.key)) collapsed.delete(ev.key); else collapsed.add(ev.key);
      local.set('sk.collapsed', [...collapsed]);
      render();
    };

    /* caret, the day as a calendar tile, then the name, when and where */
    const head = ui.el('div', 'event-head');
    const main = ui.el('div', 'event-main');
    const line = ui.el('div', 'event-line');
    const info = infoOf(ev);
    const title = ui.el('span', 'event-title', `[${ev.num}] ${info.name}`);
    title.title = ev.title;
    title.addEventListener('click', toggle);
    const scan = ui.button('↻', 'ghost icon', () => ui.busy(scan, () => scanNow(ev.key, 'tracked'), ctx), 'Scan the sectors with open requests');
    const more = ui.button('⋯', 'ghost icon', () => { menuFor = menuFor === ev.key ? null : ev.key; render(); }, 'More');
    line.append(ui.dot(ev.worst), title, ui.el('span', 'chip site', ev.siteLabel));
    main.append(line);
    const where = whereLine(info);
    if (where) main.append(where);
    head.append(
      ui.button(isCollapsed ? '▸' : '▾', 'ghost mini caret', toggle, isCollapsed ? 'Show requests' : 'Hide requests'),
      dateTile(info), main, scan, more
    );
    sec.append(head);

    const scanned = ev.lastScanAt ? `scanned ${U.ago(ev.lastScanAt)}${ev.lastScanBy ? ' by ' + ev.lastScanBy : ''}` : 'not scanned yet';
    const sub = ui.el('div', 'event-sub', [`${ev.open} open`, scanned].join(' · ') + ' · ');
    const auto = ui.el('span', ev.autoMin !== null ? 'auto own' : 'auto', ev.autoEvery ? `auto every ${ev.autoEvery} min` : 'auto-check off');
    auto.title = ev.autoMin !== null ? 'This event has its own auto-check (shared with the team) — click to change' : 'Follows the team default — click to give this event its own';
    auto.addEventListener('click', () => { menuFor = ev.key; render(); });
    sub.append(auto);
    main.append(sub);

    if (ev.health && ev.health.failing) {
      main.append(ui.el('div', 'event-health', `Scans failing since ${U.fmtClock(ev.health.firstFailAt)}${ev.health.failedBy ? ' (' + ev.health.failedBy + ')' : ''} — ${ev.health.lastError}`));
    }

    if (menuFor === ev.key) {
      const m = ui.el('div', 'event-menu');
      const all = ui.button('Scan all sectors', 'mini', () => ui.busy(all, () => scanNow(ev.key, 'all'), ctx));

      /* every sector, right now — the same read the timer does */
      const sweepBtn = ui.button('Sweep now', 'mini', () => ui.busy(sweepBtn, async () => {
        const r = await ui.send('sweepNow', { eventKey: ev.key });
        ctx.notice(r.opened && r.opened.length
          ? `${r.opened.map(o => o.code).join(', ')} went on sale — the team has been told.`
          : `Read ${U.plural(r.swept, 'sector')}. Nothing new on sale.`);
        await refresh(true);
      }, ctx), 'Read every sector of this event now, including the ones the site calls sold out');
      const autoSel = ui.el('select', 'auto-select');
      autoSel.title = 'How often this event is scanned automatically (shared with the team)';
      const choices = [['', `Auto-check: team default (${st.settings.autoMin ? st.settings.autoMin + ' min' : 'off'})`], ['0', 'Auto-check: off']]
        .concat([1, 2, 3, 5, 10, 15, 30, 60].map(n => [String(n), `Auto-check: every ${n} min`]));
      if (ev.autoMin !== null && !choices.some(c => c[0] === String(ev.autoMin))) choices.push([String(ev.autoMin), `Auto-check: every ${ev.autoMin} min`]);
      const current = ev.autoMin === null ? '' : String(ev.autoMin);
      for (const [value, label] of choices) {
        const o = ui.el('option', null, label);
        o.value = value;
        o.selected = value === current;
        autoSel.append(o);
      }
      const sweepSel = ui.el('select', 'auto-select');
      sweepSel.title = 'How often every sector of this event is read, including the ones nobody has a request in (shared with the team)';
      const dflt = ev.canSweep ? (st.settings.sweepMin ? st.settings.sweepMin + ' min' : 'off') : 'off for this site';
      const sweepChoices = [['', `Sector sweep: default (${dflt})`], ['0', 'Sector sweep: off']]
        .concat([5, 10, 15, 30, 60, 120].map(n => [String(n), `Sector sweep: every ${n} min`]));
      if (ev.sweepMin !== null && !sweepChoices.some(c => c[0] === String(ev.sweepMin))) {
        sweepChoices.push([String(ev.sweepMin), `Sector sweep: every ${ev.sweepMin} min`]);
      }
      const sweepNow = ev.sweepMin === null ? '' : String(ev.sweepMin);
      for (const [value, label] of sweepChoices) {
        const o = ui.el('option', null, label);
        o.value = value;
        o.selected = value === sweepNow;
        sweepSel.append(o);
      }
      sweepSel.addEventListener('change', async () => {
        try {
          await ui.send('setEventSweep', { key: ev.key, minutes: sweepSel.value === '' ? null : Number(sweepSel.value) });
          ctx.notice(sweepSel.value === '0'
            ? 'This event is not swept — only the sectors with requests are read.'
            : 'Saved. A sector that had no seats and goes on sale will be announced to the team.');
          await refresh(true);
        } catch (e) {
          ctx.notice(e.message, true);
        }
      });

      autoSel.addEventListener('change', async () => {
        try {
          await ui.send('setEventAuto', { key: ev.key, minutes: autoSel.value === '' ? null : Number(autoSel.value) });
          ctx.notice('Saved.');
        } catch (e) {
          ctx.notice(e.message, true);
        }
        autoSel.blur();
        refresh(true);
      });

      m.append(
        all,
        autoSel,
        sweepSel,
        sweepBtn,
        ui.button('Open event page ↗', 'mini', () => ctx.openUrl(ev.url)),
        ui.button(ev.archived ? 'Unarchive' : 'Archive', 'mini', async () => {
          menuFor = null;
          try { await ui.send('archiveEvent', { key: ev.key, archived: !ev.archived }); } catch (e) { ctx.notice(e.message, true); }
          refresh(true);
        })
      );
      if (ev.teamOpen === 0) m.append(ui.button('Delete event', 'mini danger', () => deleteEvent(ev)));
      else if (ev.otherOwners.length) m.append(ui.el('span', 'note', `${ev.otherOwners.join(', ')} still has open requests here`));
      main.append(m);
    }

    if (!isCollapsed) sec.append(ui.requestList(ctx, st.requests.filter(r => r.eventKey === ev.key && (!q || ui.requestMatches(r, ev, q)))));
    return sec;
  }

  /* name, day, time and venue (the worker sends them; split here if not) */
  function infoOf(ev) { return ev.info || U.eventInfo(ev); }

  /* info.date 'YYYY-MM-DD' -> a local Date, or null */
  function dayOf(info) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(info.date || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  /* "today", "tomorrow", "in 12 days", "3 days ago" */
  function fromToday(d) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const n = Math.round((d - today) / 86400000);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n > 0 ? `in ${n} days` : `${-n} days ago`;
  }

  /* NOV / 12 / Thu, greyed once the day is over; a dash when the title has no date */
  function dateTile(info) {
    const d = dayOf(info);
    const tile = ui.el('div', 'date-tile');
    if (!d) {
      tile.classList.add('none');
      tile.title = 'No date in the event\'s title';
      tile.append(ui.el('span', 'mon', ' '), ui.el('span', 'day', '–'), ui.el('span', 'wd', ' '));
      return tile;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d < today) tile.classList.add('past');
    tile.title = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    tile.append(
      ui.el('span', 'mon', d.toLocaleDateString('en-GB', { month: 'short' })),
      ui.el('span', 'day', String(d.getDate())),
      ui.el('span', 'wd', d.toLocaleDateString('en-GB', { weekday: 'short' }))
    );
    return tile;
  }

  /* 20:45 · Air Albania Stadium · in 32 days */
  function whereLine(info) {
    const d = dayOf(info);
    const box = ui.el('div', 'event-when');
    if (d && d.getFullYear() !== new Date().getFullYear()) box.append(ui.el('b', null, String(d.getFullYear())));
    if (info.time) box.append(ui.el('b', null, info.time));
    if (info.venue) {
      const v = ui.el('span', 'venue', info.venue);
      v.title = info.venue;
      box.append(v);
    }
    if (d) {
      const rel = fromToday(d);
      box.append(ui.el('span', /ago|yesterday/.test(rel) ? 'rel past' : 'rel', rel));
    }
    return box.childNodes.length ? box : null;
  }

  async function deleteEvent(ev) {
    const done = ev.teamTotal - ev.teamOpen;
    if (ev.teamOpen) {
      ctx.notice(ev.otherOwners.length ? `${ev.otherOwners.join(', ')} still has open requests here.` : 'Mark this event\'s open requests done (or delete them) first.', true);
      return;
    }
    if (!confirm(`Delete event [${ev.num}] ${ev.title} for the whole team?${done ? `\nIts ${U.plural(done, 'done request')} will be deleted too.` : ''}`)) return;
    try {
      await ui.send('forgetEvent', { key: ev.key });
      ctx.notice('Event deleted.');
    } catch (e) {
      ctx.notice(e.message, true);
    }
    menuFor = null;
    refresh(true);
  }

  function renderAdd() {
    const box = $('addForm');
    box.textContent = '';
    box.append(ui.addForm(ctx, { withTrack: true }));
  }

  /* ---------------- settings ---------------------------------------- */

  async function save(changes) {
    try {
      await ui.send('saveSettings', { changes });
      ctx.notice('Saved.');
    } catch (e) {
      ctx.notice(e.message, true);
    }
  }

  /* ---------------- viagogo last sales ------------------------------ *
   * The last-sales scan: is it running, what did it ask last and when, what
   * comes next, viagogo's bot checks (when, what was being asked, when the
   * stop ends), and the team's list of events — each with when it was asked
   * last, what came back, when its next turn should come, its own interval,
   * Get last sale now, and leaving it out. Events can be added by link or
   * number, for research. */
  let lsAdd = '';
  const lsAt = ts => `${U.fmtAt(ts)} (${U.ago(ts)})`;
  const lsNext = ts => `${U.fmtAt(ts)} (${U.until(ts)})`;

  function lastSalesSummary(x, s) {
    if (!s.lastSaleScanMin) return '· off';
    if (x.blockedUntil) return `· bot check, stopped until ${U.fmtClock(x.blockedUntil)}`;
    if (x.pausedUntil) return `· paused until ${U.fmtClock(x.pausedUntil)}`;
    const n = (x.list || []).filter(e => e.on).length;
    return `· ${U.plural(n, 'event')}`;
  }

  function renderLastSales() {
    const st = ctx.state;
    const x = st.lastSaleScan || {};
    const box = $('lastSales');
    box.textContent = '';
    $('lastSalesSum').textContent = lastSalesSummary(x, st.settings);
    box.append(lastSaleScanNote(st, st.settings));
  }

  function lastSaleScanNote(st, s) {
    const L = SK.lastSales;
    const W = SK.lastSaleWatchUI;
    const x = st.lastSaleScan || {};
    const wrap = ui.el('div', 'ls-scan');

    /* how often, and this PC */
    const form = ui.el('div', 'form');
    form.append(ui.labelled('Each event every (min, team)', ui.numberInput(s.lastSaleScanMin, 0, v => save({ lastSaleScanMin: v }))));
    wrap.append(form);
    wrap.append(ui.checkbox('This PC may ask viagogo for those last sales (needs viagogo signed in here)', s.lastSaleScan, v => save({ lastSaleScan: v })));
    if (!s.lastSaleScanMin) {
      wrap.append(ui.el('p', 'note', 'Off for the team. 0 turns it off; anything else is how often each event is asked about (15 at least). Get last sale now still works on each event.'));
      return wrap;
    }

    /* the state of it, in three lines: running or not, last request, next request */
    const card = ui.el('div', 'ls-card' + (x.blockedUntil || x.pausedUntil ? ' warn' : ''));
    const line = (label, text, cls) => {
      const p = ui.el('p', 'ls-line' + (cls ? ' ' + cls : ''));
      p.append(ui.el('b', null, label), document.createTextNode(' ' + text));
      card.append(p);
    };
    const on = (x.list || []).filter(e => e.on);
    const where = !s.lastSaleScan ? 'Not on this PC (its box above is off)'
      : x.holder ? `${x.holder} does the asking`
      : x.blockedUntil ? 'Stopped by viagogo\'s bot check'
      : x.pausedUntil ? `Paused: ${x.pausedWhy}`
      : 'Running on this PC';
    line('Scan:', `${where} · ${U.plural(on.length, 'event')}, each every ${x.every} min unless it has its own · about ${x.perHour || 0} requests an hour, one every 45–75 s${x.slowUntil ? ' (half speed after the bot check)' : ''}. No tab, no window, no notifications.`);
    const last = x.last;
    if (last && last.at) {
      line('Last request:', `${lsAt(last.at)} · ${last.title || `event ${last.vgEventId}`} — ${L.RESULT_TEXT[last.result] || last.result}${last.why ? ` (${last.why})` : ''}${last.by && last.by !== 'scan' ? `, ${L.BY_TEXT[last.by]}` : ''}`);
    } else {
      line('Last request:', 'none yet on this PC.');
    }
    if (x.asking) {
      const queue = on.filter(e => e.etaAt).sort((a, b) => a.etaAt - b.etaAt);
      const first = queue[0];
      line('Next request:', first ? `about ${lsNext(first.etaAt)} · ${first.title || `event ${first.vgEventId}`}` : 'nothing is due.');
    } else if (x.holder) {
      line('Next request:', `on ${x.holder}; this PC does not know its timing.`);
    }
    if (x.pausedUntil) line('Paused until', `${lsNext(x.pausedUntil)}: ${x.pausedWhy}.`, 'warn');
    if (x.slowUntil && !x.blockedUntil) line('Half speed until', `${U.fmtAt(x.slowUntil)}: a day after viagogo's last bot check.`);
    wrap.append(card);
    if (x.pausedUntil) {
      wrap.append(ui.button('Start again now', 'mini', async () => {
        await ui.send('lastSaleScanResume').catch(() => {});
        refresh(true);
      }, 'Once viagogo is signed in in this browser'));
    }

    /* the bot check: when, what, until when, and what to do about it */
    if (x.blockedUntil) {
      const b = ui.el('div', 'ls-card bad');
      b.append(ui.el('p', 'ls-line', W ? W.blockText(x) : `viagogo showed its bot check. Stopped until ${U.fmtAt(x.blockedUntil)}.`));
      b.append(ui.el('p', 'ls-line', 'It starts again by itself then. To start sooner: open viagogo in a tab; if it shows its check ("press and hold", a puzzle), pass it there as you normally would, then press Start again now. Seat Tracker never answers the check for you.'));
      const row = ui.el('div', 'row');
      const id = x.block && x.block.vgEventId;
      row.append(ui.button('Open viagogo', 'mini', () => chrome.tabs.create({ url: id ? L.sellUrl(id) : 'https://www.viagogo.com/ww/' }),
        id ? 'Opens the sell page of the event that was being asked about' : 'Opens viagogo'));
      row.append(ui.button('Start again now', 'mini primary', async () => {
        await ui.send('vgUnblock').catch(() => {});
        refresh(true);
      }, 'Only once viagogo pages open normally in this browser again'));
      b.append(row);
      wrap.append(b);
    }
    const blocks = x.blocks || [];
    if (blocks.length) {
      const det = ui.el('details', 'set-log ls-blocks');
      det.append(ui.el('summary', null, `viagogo's bot checks on this PC (${blocks.length})`));
      for (const k of blocks) {
        const what = [k.by ? L.BY_TEXT[k.by] || k.by : '', k.title ? `asking about ${k.title}` : '', k.why].filter(Boolean).join(', ');
        const end = k.endedAt ? (k.ended === 'hand' ? `started again by hand at ${U.fmtAt(k.endedAt)}` : `ended by itself at ${U.fmtAt(k.endedAt)}`)
          : `stopped until ${U.fmtAt(k.until)}`;
        det.append(ui.el('div', 'detail', `${U.fmtAt(k.at)} · ${what || 'cause not kept'} · ${end}`));
      }
      wrap.append(det);
    }

    const change = async (id, c, btn) => {
      if (btn) btn.disabled = true;
      try { ctx.state.lastSaleScan = await ui.send('setLastSaleEvent', { vgEventId: id, change: c }); }
      catch (e) { ctx.notice(e.message, true); }
      refresh(true);
    };
    const getNow = async (e, btn) => {
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const r = (await ui.send('lastSaleCheckNow', { vgEventId: e.vgEventId, title: e.title, when: e.when, by: 'hand' })) || { kind: 'error' };
        const text = W ? W.answerText(r) : r.kind;
        ctx.notice(`${e.title || e.vgEventId}: ${text}`, !['sale', 'same', 'none'].includes(r.kind));
      } catch (err) { ctx.notice(err.message, true); }
      refresh(true);
    };

    /* the events, the next turn first */
    const off = (x.list || []).filter(e => !e.on);
    const sorted = on.slice().sort((a, b) => (a.etaAt || Infinity) - (b.etaAt || Infinity) || (a.title || '').localeCompare(b.title || ''));
    wrap.append(ui.el('div', 'set-title ls-head', `Scanned · ${on.length}${x.asking ? ' · next turn first' : ''}`));
    if (!on.length) wrap.append(ui.el('p', 'note', 'No event yet. Events your team lists on join by themselves; add any other below.'));
    const table = ui.el('div', 'ls-list');
    for (const e of sorted.concat(off)) {
      const row = ui.el('div', 'ls-row' + (e.on ? '' : ' off'));
      const main = ui.el('div', 'ls-main');
      main.append(ui.el('b', null, e.title || `viagogo event ${e.vgEventId}`));
      main.append(ui.el('span', 'ls-sub', [e.when, L.SOURCE_TEXT[e.source] || e.source, e.on ? `every ${e.every} min${e.ownEvery ? '' : ' (team)'}` : 'left out',
        e.sales ? U.plural(e.sales, 'sale') + ' saved' : ''].filter(Boolean).join(' · ')));
      main.append(ui.el('span', 'ls-sub', e.lastAt
        ? `Last: ${lsAt(e.lastAt)}${e.lastResult ? ` — ${L.RESULT_TEXT[e.lastResult] || e.lastResult}` : ''}${e.lastBy && e.lastBy !== 'scan' ? `, ${L.BY_TEXT[e.lastBy] || e.lastBy}` : ''}`
        : 'Last: not asked yet'));
      if (e.on) {
        const next = e.skipUntil ? `set aside until ${U.fmtAt(e.skipUntil)} (no sell page twice)`
          : x.holder ? `on ${x.holder}`
          : !x.asking ? 'not on this PC'
          : e.etaAt ? `about ${lsNext(e.etaAt)}` : '—';
        main.append(ui.el('span', 'ls-sub', `Next: ${next}`));
      }
      row.append(main);
      const ctl = ui.el('div', 'ls-ctl');
      row.append(ctl);
      const now = ui.button('Get now', 'mini', function () { getNow(e, this); }, 'Get last sale now: ask viagogo about this event at once — saved if it is new, skipped if it is the one already saved');
      if (x.blockedUntil) now.disabled = true;
      if (e.on) {
        const sel = ui.el('select');
        const opt = (v, label) => { const o = ui.el('option', null, label); o.value = v; if (String(e.ownEvery || '') === v) o.selected = true; sel.append(o); };
        opt('', `${x.every} min (team)`);
        for (const n of L.EVENT_EVERY) opt(String(n), n < 60 ? `${n} min` : `${n / 60} h`);
        sel.title = 'How often this event is asked about';
        sel.addEventListener('change', () => change(e.vgEventId, { every: sel.value ? Number(sel.value) : null }, sel));
        ctl.append(sel, now);
        ctl.append(ui.button('✕', 'ghost icon', function () { change(e.vgEventId, { on: false }, this); },
          e.source === 'added' ? 'Remove from the scan' : 'Leave out of the scan (the team lists on it, so it would join by itself)'));
      } else {
        ctl.append(now, ui.button('Scan again', 'mini', function () { change(e.vgEventId, { on: true }, this); }));
      }
      table.append(row);
    }
    wrap.append(table);

    /* add one by hand */
    const add = ui.el('div', 'ls-add');
    const input = ui.textInput(lsAdd, v => { lsAdd = v; }, 'viagogo event link or number');
    const go = ui.button('Add', 'mini primary', async function () {
      const id = L.eventIdFrom(input.value);
      if (!id) { ctx.notice('Paste a viagogo event link (…/E-161613530) or its number.', true); return; }
      lsAdd = '';
      await change(id, { on: true }, this);
    }, 'Ask viagogo about this event too, for research: its name shows once its first sale is saved');
    input.addEventListener('input', () => { lsAdd = input.value; });
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') go.click(); });
    add.append(input, go);
    wrap.append(add);
    wrap.append(ui.el('p', 'note', 'Tip: on the event\'s viagogo page, the drawer\'s Last sales tab adds it with its name and date, and has Get last sale now. Next turns are a guess: the gaps between requests are random. A sell page you open asks once by itself when no "just sold" toast shows.'));
    return wrap;
  }

  function group(title, helpKey, note) {
    const g = ui.el('div', 'set-group');
    const h = ui.el('div', 'set-head');
    h.append(ui.el('span', 'set-title', title), ui.el('span', 'spacer'));
    if (helpKey) h.append(ui.helpButton(helpKey, document.body));
    g.append(h);
    if (note) g.append(ui.el('p', 'note', note));
    return g;
  }

  function field(label, control) {
    const r = ui.el('div', 'set-row');
    r.append(ui.el('span', 'set-label', label), control);
    return r;
  }

  function timeInput(value, onChange) {
    const i = ui.el('input', 'time');
    i.type = 'time';
    i.value = value;
    i.addEventListener('change', () => { if (i.value) onChange(i.value); });
    return i;
  }

  /* who is on the team, what they list, and a message to their phones */
  function renderTeam() {
    const st = ctx.state;
    const box = $('team');
    box.textContent = '';
    const mates = (st.team || []).filter(x => !x.me);
    if (!mates.length) {
      box.append(ui.el('p', 'note', 'Nobody else has signed in yet. Add their email to the members list in supabase/schema.sql, then they sign in on their own PC.'));
      return;
    }

    /* every section the team is listed in, yours next to theirs */
    const rows = [];
    for (const t of st.teamPrices || []) {
      const ev = ui.eventOf(st, t.eventKey);
      if (!ev) continue;
      const mine = (st.listings || []).filter(l => l.eventKey === t.eventKey && SK.team.norm(l.section || l.code) === SK.team.norm(t.section));
      rows.push({ t, ev, mine });
    }
    rows.sort((a, b) => a.ev.num - b.ev.num || String(a.t.section).localeCompare(String(b.t.section), 'en', { numeric: true }));

    if (rows.length) {
      const list = ui.el('div', 'team-rows');
      for (const { t, ev, mine } of rows) {
        const row = ui.el('div', 'team-row');
        row.append(ui.el('span', 'sec', t.section || '?'));
        row.append(ui.el('span', 'muted', `[${ev.num}] ${ev.title}`));
        row.append(ui.el('span', 'spacer'));
        const one = ui.teamLine([t], { label: '' });
        if (mine.length) {
          const l = mine[0].money && mine[0].money.listing;
          if (l && l.price) one.prepend(ui.el('span', 'team-one mine-one', `You ${SK.profit.formatMoney(l.price, l.currency)}`));
        }
        row.append(one);
        list.append(row);
      }
      box.append(list);
    } else {
      box.append(ui.el('p', 'note', 'No teammate prices yet — they appear once someone opens their viagogo listings page with Seat Tracker on.'));
    }

    box.append(ui.el('div', 'set-sep'));
    box.append(ui.el('div', 'note', 'Send your teammates a message on their phone (and their PC). Their own notification switches, mute and quiet hours still apply.'));
    box.append(ui.messageBox(st, { placeholder: 'e.g. only our listings in E105 — raising to $120' }, ctx));
  }

  /* ---------------- updates ---------------------------------------- *
   * One member shares the link to a new Seat Tracker zip here; every signed-in
   * PC gets it with the next sync, shows the bar at the top and a desktop
   * notification (again once a day) until it runs that version. Each PC's
   * version is listed, so you can see who has not updated yet. */
  const upDraft = { version: '', url: '', note: '' };

  function openUpdates() {
    const d = $('updateBox');
    d.open = true;
    setTimeout(() => d.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
  }

  function renderUpdateBar() {
    const bar = $('updateBar');
    const u = ctx.state && ctx.state.update;
    bar.textContent = '';
    bar.hidden = !(ctx.state && ctx.state.auth.signedIn && u && u.pending);
    if (bar.hidden) return;
    bar.append(ui.el('span', 'txt', `Seat Tracker ${u.latest.version} is ready (this PC has ${u.installed})`), ui.el('span', 'spacer'),
      ui.button('Download', 'mini primary', () => chrome.tabs.create({ url: u.latest.url }), u.latest.url),
      ui.button('How', 'mini', openUpdates, 'The steps, in Updates below'));
  }

  function renderUpdate() {
    const st = ctx.state;
    const u = st.update || { installed: '?', latest: null, pending: false };
    const box = $('update');
    box.textContent = '';
    $('updateSum').textContent = u.pending ? `· ${u.latest.version} ready` : `· ${u.installed}${u.latest ? ', up to date' : ''}`;

    /* what is shared, and what to do with it */
    const card = ui.el('div', 'ls-card' + (u.pending ? ' warn' : ''));
    const line = (label, text) => {
      const p = ui.el('p', 'ls-line');
      p.append(ui.el('b', null, label), document.createTextNode(' ' + text));
      card.append(p);
    };
    line('This PC:', `Seat Tracker ${u.installed}.`);
    if (u.latest) {
      line('Shared:', `${u.latest.version}${u.latest.by ? ` by ${u.latest.by}` : ''}, ${U.fmtAt(u.latest.at)} (${U.ago(u.latest.at)})${u.pending ? '' : ' — this PC has it'}.`);
      if (u.latest.note) line('Note:', u.latest.note);
      const row = ui.el('div', 'row');
      row.append(ui.button(u.pending ? 'Download' : 'Open the link', 'mini' + (u.pending ? ' primary' : ''), () => chrome.tabs.create({ url: u.latest.url }), u.latest.url),
        ui.button('Copy link', 'mini', async function () {
          try { await navigator.clipboard.writeText(u.latest.url); this.textContent = 'Copied'; } catch (e) { ctx.notice('Copy failed: ' + e.message, true); }
        }, 'For someone not signed in to Seat Tracker'));
      card.append(row);
    } else {
      line('Shared:', 'no update link yet.');
    }
    box.append(card);

    if (u.pending) {
      const steps = ui.el('ol', 'up-steps');
      for (const t of ['Download the zip (button above).',
        'Unzip it and copy its files over your old Seat Tracker folder — the same folder, so Chrome keeps your sign-in and settings.',
        'Press Reload Seat Tracker below (or the ↻ on chrome://extensions).']) steps.append(ui.el('li', null, t));
      box.append(steps);
    }
    const tools = ui.el('div', 'row');
    tools.append(ui.button('Reload Seat Tracker', 'mini', async function () {
      this.disabled = true;
      await ui.send('reloadExtension').catch(() => {});
      window.close();
    }, 'Restart the extension from its folder, after the new files are in it'),
    ui.button('chrome://extensions', 'mini', () => chrome.tabs.create({ url: 'chrome://extensions/' }), 'Chrome\'s extensions page'));
    box.append(tools);

    /* every PC and the version it last said it runs */
    const pcs = (st.devices || []).filter(d => Date.now() - d.lastSeen < 30 * 86400000);
    if (pcs.length) {
      const want = u.latest ? u.latest.version : u.installed;
      const list = ui.el('div', 'up-pcs');
      list.append(ui.el('div', 'set-title', 'PCs'));
      for (const d of pcs) {
        const old = d.version && SK.update.compare(d.version, want) < 0;
        const r = ui.el('div', 'up-pc' + (old ? ' old' : ''));
        r.append(ui.el('span', 'nm', `${d.name}${d.thisPc ? ' (this PC)' : ''}`), ui.el('span', 'muted', d.owner),
          ui.el('span', 'spacer'),
          ui.el('span', 'ver', d.version ? (old ? `${d.version} · not updated` : d.version) : 'version unknown'),
          ui.el('span', 'muted', d.online ? 'online' : U.ago(d.lastSeen)));
        list.append(r);
      }
      box.append(list);
    }

    /* share a new one */
    box.append(ui.el('div', 'set-sep'));
    box.append(ui.el('div', 'set-title', 'Share a new version'));
    if (!upDraft.version) upDraft.version = u.installed;
    const form = ui.el('div', 'form up-form');
    const ver = ui.textInput(upDraft.version, null, '3.1.0');
    ver.addEventListener('input', () => { upDraft.version = ver.value; });
    const url = ui.textInput(upDraft.url, null, 'https://drive.google.com/…');
    url.addEventListener('input', () => { upDraft.url = url.value; });
    const note = ui.textInput(upDraft.note, null, 'e.g. fixes the viagogo listings');
    note.addEventListener('input', () => { upDraft.note = note.value; });
    form.append(ui.labelled('Version', ver), ui.labelled('Link to the zip', url, 'wide'), ui.labelled('Note (optional)', note, 'wide'));
    box.append(form);
    const send = ui.button('Send to every PC', 'primary', () => ui.busy(send, async () => {
      const r = await ui.send('shareUpdate', { version: upDraft.version, url: upDraft.url, note: upDraft.note });
      upDraft.url = ''; upDraft.note = ''; upDraft.version = '';
      ctx.notice(`Shared ${r.version}: every signed-in PC gets it within a minute.`);
      refresh(true);
    }, ctx));
    const row = ui.el('div', 'row');
    row.append(send);
    if (u.latest) {
      const back = ui.button('Take the link back', 'mini', () => {
        if (!confirm(`Remove the shared link to ${u.latest.version}? PCs stop being reminded.`)) return;
        ui.busy(back, async () => {
          await ui.send('clearUpdate');
          ctx.notice('The update link is removed.');
          refresh(true);
        }, ctx);
      });
      row.append(back);
    }
    box.append(row);
    box.append(ui.el('p', 'note', 'Before zipping, raise "version" in manifest.json (e.g. 3.0.0 → 3.1.0): a PC is only told when the shared number is higher than its own. Zip the Seat Tracker folder, upload it where a link can download it (Google Drive with "anyone with the link", WeTransfer, Dropbox), paste the link here. Only the team\'s signed-in PCs see it; Copy link for anyone else.'));
  }

  function renderSettings() {
    const st = ctx.state;
    const s = st.settings;
    const box = $('settings');
    box.textContent = '';

    /* account */
    const ac = group('Account', 'account');
    ac.append(field('Signed in', ui.el('span', null, st.auth.email)));
    const name = ui.textInput(st.auth.displayName, v => ui.send('setDisplayName', { name: v }).then(() => refresh(true)).catch(e => ctx.notice(e.message, true)), 'your name');
    ac.append(field('Your name', name));
    const pcName = ui.textInput(st.device.name, v => ui.send('setDeviceName', { name: v }).then(() => refresh(true)).catch(e => ctx.notice(e.message, true)), 'e.g. Ergi laptop');
    ac.append(field('This PC', pcName));
    if (st.devices.length) {
      /* old PCs can be taken off: × on one, or every one not seen for 30 days.
       * This PC and PCs online now stay; one still in use comes back by itself. */
      const removeDevices = async (ids, what) => {
        if (!confirm(`Remove ${what} from the team's list? A PC still in use comes back by itself the next time it runs.`)) return;
        try { const r = await ui.send('deleteDevices', { ids }); ctx.notice(`Removed ${r.removed} PC${r.removed === 1 ? '' : 's'} from the list.`); await refresh(true); }
        catch (e) { ctx.notice(e.message, true); }
      };
      const OLD_MS = 30 * 86400000;
      const old = st.devices.filter(d => !d.thisPc && !d.online && Date.now() - d.lastSeen >= OLD_MS);
      const list = ui.el('div', 'devices');
      for (const d of st.devices) {
        const row = ui.el('div', 'device-row');
        row.append(ui.el('span', 'dot ' + (d.online ? 'st-OK' : 'st-idle')));
        row.append(ui.el('span', null, (d.name || 'unnamed PC') + (d.thisPc ? ' (this PC)' : '')));
        row.append(ui.el('span', 'muted', d.owner));
        row.append(ui.el('span', 'spacer'));
        row.append(ui.el('span', 'muted', d.online ? 'online' : U.ago(d.lastSeen)));
        if (!d.thisPc && !d.online) {
          const x = ui.button('×', 'mini device-x', () => removeDevices([d.id], `"${d.name || 'unnamed PC'}" (${d.owner})`), 'Take this PC off the list');
          x.setAttribute('aria-label', `Remove ${d.name || 'unnamed PC'}`);
          row.append(x);
        }
        list.append(row);
      }
      ac.append(list);
      if (old.length) {
        const sweep = ui.button(`Remove ${old.length} not seen for 30 days`, 'mini', () => removeDevices(old.map(d => d.id), `${old.length} PC${old.length === 1 ? '' : 's'} not seen for 30 days`),
          'Take every PC that has not run Seat Tracker for 30 days off the list');
        const r = ui.el('div', 'row');
        r.append(sweep);
        ac.append(r);
      }
    }
    const out = ui.button('Sign out', 'mini', () => ui.busy(out, async () => {
      await ui.send('signOut');
      await refresh(true);
    }, ctx));
    const footer = ui.el('div', 'set-foot');
    footer.append(out);
    ac.append(footer);
    box.append(ac);

    /* appearance (this PC) */
    const ap = group('Appearance', 'appearance', 'This PC only.');
    ap.append(
      field('Theme', ui.segmented(
        [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
        s.theme, v => { ui.applyTheme(document.body, v); save({ theme: v }); })),
      field('Sidebar', ui.segmented(
        [{ value: 'push', label: 'Push page' }, { value: 'overlay', label: 'Overlay' }],
        s.sidebarMode, v => save({ sidebarMode: v }))),
      field('Order lists by', ui.segmented(
        [{ value: 'options', label: 'Fewest options' }, { value: 'number', label: 'Number' }],
        s.listSort, v => save({ listSort: v })))
    );
    box.append(ap);

    /* panels (this PC) */
    const pn = group('On-site panels', 'panels', 'This PC only.');
    pn.append(ui.checkbox('Show on sites', s.panels.enabled, v => save({ panels: { enabled: v } })));
    for (const site of st.sites.concat(SK.settings.helperPages())) {
      const row = ui.el('div', 'set-site' + (s.panels.enabled ? '' : ' disabled'));
      const checks = ui.el('div', 'set-checks');
      const cur = s.panels.sites[site.id] || {};
      for (const p of site.pages) {
        checks.append(ui.checkbox(p.label.replace(/ page$/, ''), cur[p.key] !== false, v => save({ panels: { sites: { [site.id]: { [p.key]: v } } } })));
      }
      if (site.badges) checks.append(ui.checkbox('badges', cur.badges !== false, v => save({ panels: { sites: { [site.id]: { badges: v } } } })));
      checks.querySelectorAll('input').forEach(i => { i.disabled = !s.panels.enabled; });
      row.append(ui.el('span', 'set-label', site.label), checks);
      pn.append(row);
    }
    pn.append(ui.checkbox('Let Seat Tracker select seats on eBileta', s.selectSeats, v => save({ selectSeats: v })));
    pn.append(ui.el('p', 'note', s.selectSeats
      ? 'Clicking a seat or pressing Reserve holds seats in eBileta\'s own cart, while you are logged in. Nothing is ever bought, nothing happens on its own, and this PC\'s scans of that event pause while seats are held.'
      : 'Off: the extension only reads the ticket sites, and a seat you click is only outlined.'));
    if (st.actionLog && st.actionLog.length) {
      const det = ui.el('details', 'set-log');
      det.append(ui.el('summary', null, `What this PC clicked (${st.actionLog.length})`));
      for (const a of st.actionLog) {
        det.append(ui.el('div', 'detail', `${U.fmtClock(a.at)} · ${a.what}${a.seat ? ' · ' + a.seat : ''}${a.seats ? ' · ' + a.seats : ''} · ${a.ok ? 'done' : 'refused'}${a.why ? ' · ' + a.why : ''}`));
      }
      pn.append(det);
    }
    box.append(pn);

    /* scanning (shared) */
    const sc = group('Scanning', 'scanning', 'Shared with the team: whoever is online scans, everyone uses the result.');
    const grid = ui.el('div', 'form');
    grid.append(
      ui.labelled('Auto-check (min)', ui.numberInput(s.autoMin, 0, v => save({ autoMin: v }))),
      ui.labelled('New-event check (min)', ui.numberInput(s.eventCheckMin, 0, v => save({ eventCheckMin: v }))),
      ui.labelled('Sector sweep (min)', ui.numberInput(s.sweepMin, 0, v => save({ sweepMin: v })))
    );
    sc.append(grid);
    sc.append(ui.el('p', 'note', s.sweepMin
      ? `Every ${s.sweepMin} min one PC reads every sector of each event — the ones nobody has a request in, and the ones the site calls sold out — and tells the team when a sector that had no free seat has some. eBileta only; one request per sector. 0 turns it off.`
      : 'Off: only the sectors with requests are ever read, so a stand released near the date passes unnoticed.'));
    sc.append(ui.el('p', 'note', 'viagogo last sales has its own section above: its events, timing and bot checks.'));
    box.append(sc);

    /* money (team): lek is the base; the daily rates can be fixed by hand */
    const mo = group('Money', 'money', 'Shared with the team. Profits are shown in lek (ALL).');
    const fx = st.fx || { rates: {}, fetched: {}, manual: [] };
    const rates = ui.el('div', 'form');
    for (const c of ['USD', 'EUR', 'RSD']) {
      const input = ui.el('input');
      input.type = 'number';
      input.min = '0';
      input.step = 'any';
      input.id = 'fx-' + c;
      input.value = s.fxOverride[c] ? String(s.fxOverride[c]) : '';
      const fetched = (fx.fetched || {})[c];
      input.placeholder = fetched ? String(Math.round(fetched * 100) / 100) : '—';
      input.addEventListener('change', () => save({ fxOverride: Object.assign({}, s.fxOverride, { [c]: input.value === '' ? 0 : Number(input.value) }) }));
      rates.append(ui.labelled(`Lek per ${c}`, input));
    }
    mo.append(rates, ui.el('p', 'note', fx.day
      ? `Daily rates of ${fx.day} by ExchangeRate-API. Leave a box empty to use them; type a rate to fix it for the team.`
      : 'No daily rates yet — they are fetched on the next sync. Type a rate to use it now.'));
    box.append(mo);

    /* defaults for new requests (yours) */
    const df = group('New requests', 'requests', 'Yours only.');
    const dgrid = ui.el('div', 'form');
    dgrid.append(
      ui.labelled('Default block warn', ui.numberInput(s.defaultWarn, 0, v => save({ defaultWarn: v }))),
      ui.labelled('Default options warn', ui.numberInput(s.defaultOpts, 0, v => save({ defaultOpts: v }))),
      ui.checkbox('New requests need seats side by side', s.together, v => save({ together: v }), 'wide')
    );
    df.append(dgrid);
    box.append(df);

    /* notifications (yours) */
    const nt = group('Notifications', 'notifications', 'Yours only — they reach you from whichever PC is online.');
    const table = ui.el('table', 'notif-grid');
    const hr = ui.el('tr');
    hr.append(ui.el('th'), ui.el('th', null, 'Desktop'), ui.el('th', null, 'Phone'));
    table.append(hr);
    for (const t of st.notifyTypes) {
      const tr = ui.el('tr');
      tr.append(ui.el('td', null, t.label));
      for (const ch of ['desktop', 'phone']) {
        const td = ui.el('td');
        const i = ui.el('input');
        i.type = 'checkbox';
        i.checked = !!s.notify[t.key][ch];
        i.title = `${t.label} · ${ch}`;
        i.addEventListener('change', () => save({ notify: { [t.key]: { [ch]: i.checked } } }));
        td.append(i);
        tr.append(td);
      }
      table.append(tr);
    }
    nt.append(table);
    if (!s.phoneTopic) nt.append(ui.el('p', 'note', 'Phone notifications need your ntfy topic — see Phone below.'));

    /* ---- this PC ---- */
    /* A PC starts silent. Signing in somewhere should not make that machine
     * start shouting, least of all one you share. */
    const pc = s.pcNotify;
    const pcBox = ui.el('div', 'pcnotify');
    pcBox.append(ui.el('div', 'sk-section-title', `On this PC · ${st.device.name || 'this PC'}`));
    pcBox.append(ui.segmented([
      { value: 'off', label: 'Silent' },
      { value: 'follow', label: 'Follow mine' },
      { value: 'custom', label: 'Its own' }
    ], pc.mode, v => save({ pcNotify: { mode: v } })));
    pcBox.append(ui.el('p', 'note',
      pc.mode === 'off'
        ? 'Nothing about requests appears on this PC. Your phone still gets everything, and so does any other PC you have switched on.'
        : pc.mode === 'follow'
          ? 'This PC shows whatever the Desktop column above says.'
          : 'This PC has its own switches and its own quiet hours, whatever your account says.'));

    if (pc.mode === 'custom') {
      const t2 = ui.el('table', 'notif-grid');
      const h2 = ui.el('tr');
      h2.append(ui.el('th'), ui.el('th', null, 'Here'));
      t2.append(h2);
      for (const t of st.notifyTypes) {
        const tr = ui.el('tr');
        tr.append(ui.el('td', null, t.label));
        const td = ui.el('td');
        const i = ui.el('input');
        i.type = 'checkbox';
        i.checked = pc.desktop[t.key] === undefined ? !!s.notify[t.key].desktop : !!pc.desktop[t.key];
        i.title = `${t.label} · on this PC`;
        i.addEventListener('change', () => save({ pcNotify: { desktop: { [t.key]: i.checked } } }));
        td.append(i);
        tr.append(td);
        t2.append(tr);
      }
      pcBox.append(t2);

      const pq = ui.el('div', 'row');
      pq.append(
        ui.checkbox('Quiet hours here', pc.quiet.enabled, v => save({ pcNotify: { quiet: { enabled: v } } })),
        ui.el('span', 'spacer'),
        timeInput(pc.quiet.from, v => save({ pcNotify: { quiet: { from: v } } })),
        ui.el('span', 'muted', '–'),
        timeInput(pc.quiet.to, v => save({ pcNotify: { quiet: { to: v } } }))
      );
      pcBox.append(pq);
      pcBox.append(ui.checkbox('Let "Tickets available now" through', pc.quiet.allowAvailable,
        v => save({ pcNotify: { quiet: { allowAvailable: v } } }), 'indent'));
    }
    pcBox.append(ui.el('p', 'note', 'Trouble with this PC itself — signed out, alerts not sending — still shows either way. Nothing else would tell whoever is sitting here.'));
    nt.append(pcBox);

    const sumRow = ui.el('div', 'row');
    const sumSel = ui.el('select');
    for (const [v, label] of [['off', 'Off'], ['every', 'After every auto-check'], ['daily', 'Once a day']]) {
      const o = ui.el('option', null, label);
      o.value = v;
      o.selected = s.summaryMode === v;
      sumSel.append(o);
    }
    sumSel.addEventListener('change', () => save({ summaryMode: sumSel.value }));
    sumRow.append(sumSel);
    if (s.summaryMode === 'daily') sumRow.append(ui.el('span', 'muted', 'at'), timeInput(s.summaryTime, v => save({ summaryTime: v })));
    nt.append(field('Summary', sumRow));

    const quiet = ui.el('div', 'quiet');
    const qRow = ui.el('div', 'row');
    qRow.append(
      ui.checkbox('Quiet hours', s.quiet.enabled, v => save({ quiet: { enabled: v } })),
      ui.el('span', 'spacer'),
      timeInput(s.quiet.from, v => save({ quiet: { from: v } })),
      ui.el('span', 'muted', '–'),
      timeInput(s.quiet.to, v => save({ quiet: { to: v } }))
    );
    quiet.append(qRow, ui.checkbox('Let "Tickets available now" through', s.quiet.allowAvailable, v => save({ quiet: { allowAvailable: v } }), 'indent'));
    nt.append(quiet);

    const cd = ui.el('div', 'row');
    cd.append(ui.numberInput(s.cooldownMin, 0, v => save({ cooldownMin: v })), ui.el('span', 'muted', 'minutes'));
    const rep = ui.el('div', 'row');
    rep.append(ui.numberInput(s.repeatWarnMin, 0, v => save({ repeatWarnMin: v })), ui.el('span', 'muted', 'minutes · 0 = off'));
    nt.append(
      field('Cooldown', cd),
      field('Repeat warnings until Stop', rep),
      ui.checkbox('Confirm "No longer fillable" with a second scan', s.confirmGone, v => save({ confirmGone: v })),
      ui.checkbox('Buttons on notifications', s.buttons, v => save({ buttons: v }))
    );
    const foot = ui.el('div', 'set-foot');
    const test = ui.button('Test desktop notification', 'mini', () => ui.busy(test, async () => {
      await ui.send('testDesktop');
      ctx.notice('Sent — look at the corner of your screen.');
    }, ctx));
    foot.append(test);
    nt.append(foot);
    box.append(nt);
  }

  /* ---------------- phone ------------------------------------------- */

  function renderPhone() {
    const s = ctx.state.settings;
    const box = $('phone');
    box.textContent = '';

    const push = ui.textInput(s.phoneTopic, v => save({ phoneTopic: v }), 'e.g. ergi-seats-push-7k2p');
    const test = ui.button('Test', '', () => ui.busy(test, async () => {
      if (push.value.trim() !== s.phoneTopic) await ui.send('saveSettings', { changes: { phoneTopic: push.value.trim() } });
      await ui.send('testPhone');
      ctx.notice('Test sent — check your phone.');
    }, ctx));
    const r1 = ui.el('div', 'row');
    r1.append(push, test);
    box.append(ui.labelled('ntfy topic', r1, 'block'));
    box.append(ui.el('p', 'note', 'Where your alerts and command answers arrive. Subscribe to it in the ntfy app.'));

    /* why the last pushes did or did not arrive: a push that fails is otherwise silent */
    const log = ctx.state.pushLog || [];
    if (log.length) {
      const last = log[0];
      const bad = log.filter(x => !x.ok).length;
      const line = ui.el('div', 'push-log' + (last.ok ? '' : ' bad'));
      line.append(ui.el('strong', null, last.ok ? 'Last push sent' : 'Last push did not go out'));
      line.append(ui.el('span', null, `${SK.settings.notifyType(last.type) ? SK.settings.notifyType(last.type).label : last.type} · for ${last.who} · ${U.ago(last.at)}${last.ok ? '' : ' · ' + last.reason}`));
      if (bad > 1) line.append(ui.el('span', 'muted', `${bad} of the last ${log.length} did not go out`));
      const show = ui.el('details', 'push-more');
      show.append(ui.el('summary', null, 'The last few'));
      for (const x of log) {
        show.append(ui.el('div', 'push-row' + (x.ok ? '' : ' bad'),
          `${x.ok ? '✓' : '✗'} ${U.ago(x.at)} · ${x.type} · ${x.who}${x.ok ? '' : ' · ' + x.reason}`));
      }
      line.append(show);
      box.append(line);
    }

    box.append(ui.labelled('shortcuts topic', ui.textInput(s.cmdTopic, v => save({ cmdTopic: v }), 'empty = phone commands off'), 'block'));
    box.append(ui.el('p', 'note', 'Where your phone sends commands (the iPhone Shortcut posts here). Keep it secret; leave empty to switch commands off.'));

    if (s.cmdTopic) {
      const url = `${s.ntfyServer}/${encodeURIComponent(s.cmdTopic)}/publish?message=get`;
      const a = ui.el('a', 'link', url);
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      box.append(ui.el('div', 'note', 'Open this on your phone to get your open requests back as a push:'), a);
    }

    const tryIn = ui.textInput(cmdText, null, 'e.g. scan event=1 sec=A1 qty=4');
    tryIn.addEventListener('input', () => { cmdText = tryIn.value; });
    const run = ui.button('Run', '', () => ui.busy(run, async () => {
      const a = await ui.send('runCommand', { text: tryIn.value, push: true });
      cmdOut = `${a.title}\n${a.message}`;
      renderPhone();
    }, ctx));
    tryIn.addEventListener('keydown', e => { if (e.key === 'Enter') run.click(); });
    const r2 = ui.el('div', 'row');
    r2.append(tryIn, run);
    box.append(ui.labelled('Try a command (the answer also goes to your phone)', r2, 'block'));
    if (cmdOut) box.append(ui.el('pre', 'out', cmdOut));

    const adv = ui.el('details', 'adv');
    adv.append(ui.el('summary', null, 'Advanced'), ui.labelled('ntfy server', ui.textInput(s.ntfyServer, v => save({ ntfyServer: v })), 'block'));
    box.append(adv);
  }

  /* ---------------- backup ------------------------------------------ */

  function renderBackup() {
    const box = $('backup');
    box.textContent = '';
    const file = ui.el('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;

    const exp = ui.button('Export JSON', '', () => ui.busy(exp, async () => {
      const data = await ui.send('export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = `seat-tracker-${U.dayStamp(Date.now())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      ctx.notice('Exported your requests and settings.');
    }, ctx));

    /* a file picker can close the popup, so importing happens in a tab */
    const imp = ui.button('Import JSON', '', () => {
      if (!asPage) {
        ui.send('openPage', { path: 'popup/popup.html?page=1#backup' }).then(() => window.close()).catch(() => {});
        return;
      }
      file.click();
    });

    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        const r = await ui.send('import', { data: JSON.parse(await f.text()) });
        const from = { own: 'Seat Tracker', efinity: 'old eFinity', posttick: 'old Posttick', ebileta: 'old eBileta' }[r.kind] || r.kind;
        ctx.notice(`Imported ${U.plural(r.added, 'request')} from the ${from} file${r.skipped ? ` (${r.skipped} were already here)` : ''}.`);
      } catch (e) {
        ctx.notice('Import failed: ' + e.message, true);
      }
      file.value = '';
      refresh(true);
    });

    const row = ui.el('div', 'row');
    row.append(exp, imp, file);
    box.append(row);
    box.append(ui.el('p', 'note', 'Export saves your own requests and settings. Import adds requests to your account.'));
    if (!asPage) box.append(ui.el('p', 'note', 'Import opens in a tab, so picking a file cannot close this popup.'));
  }

  /* ---------------- boot -------------------------------------------- */

  function initSections() {
    const help = (id, key) => {
      const sum = document.querySelector(`#${id} > summary`);
      sum.append(ui.el('span', 'spacer'), ui.helpButton(key, document.body));
    };
    help('addBox', 'requests');
    help('phoneBox', 'phone');
    help('backupBox', 'backup');

    const openState = local.get('sk.details', {});
    for (const d of document.querySelectorAll('details.section')) {
      if (openState[d.id] !== undefined) d.open = !!openState[d.id];
      d.addEventListener('toggle', () => {
        const cur = local.get('sk.details', {});
        cur[d.id] = d.open;
        local.set('sk.details', cur);
      });
    }

    const hash = location.hash.slice(1);
    const target = hash && document.getElementById(hash + 'Box');
    if (target) { target.open = true; setTimeout(() => target.scrollIntoView({ block: 'start' }), 80); }
  }

  $('scanBtn').addEventListener('click', () => ui.busy($('scanBtn'), () => scanNow(null), ctx));
  const onSearch = () => { search = $('search').value; if (ctx.state) renderMain(); };
  $('search').addEventListener('input', onSearch);
  $('search').addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('search').value) { e.preventDefault(); $('search').value = ''; onSearch(); }
  });
  $('muteBtn').addEventListener('click', () => { muteMenu = !muteMenu; renderHeader(); });

  document.addEventListener('focusout', () => setTimeout(() => { if (dirty && !ui.typingIn(document)) render(); }, 60));

  let timer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!Object.keys(changes).some(k => ['mirror', 'auth', 'authProblem', 'scanCache', 'deviceSettings', 'device', 'meta', 'vgScan', 'vgBlockedUntil', 'vgBlockLog'].includes(k))) return;
    clearTimeout(timer);
    timer = setTimeout(() => refresh(false), 150);
  });
  setInterval(() => { if (ctx.state) renderHeader(); }, 20000);
  /* the last-sales times ("in 40 s") move on by themselves */
  setInterval(() => { if (ctx.state && ctx.state.auth.signedIn && $('lastSalesBox').open && !ui.typingIn(document)) renderLastSales(); }, 15000);

  initSections();
  refresh(true);
})();
