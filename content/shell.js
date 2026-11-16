/* ------------------------------------------------------------------
 * Seat Tracker - the on-site sidebar (every site)
 *
 * A docked panel on the right (or the left, where the site keeps its own
 * things there — opts.side), drawn inside a shadow root so the site's
 * CSS cannot touch it. Push mode narrows the page while it is open; overlay
 * mode slides over it. It collapses to a tab on its edge and remembers
 * open/closed per site. ⇄ in its header moves it to the other side, and
 * that is remembered per site and page (opts.side is only the default). Each site script fills its own slot
 * (a sector card, block highlighting) and draws its own badges.
 *
 * SK.shell.create({
 *   site, pageKey,               which Settings switch controls it
 *   title(state, ev)?            header title, default the event title
 *   subtitle(state, ev)?         header second line, default the event's number and last scan
 *   renderSlot(slot, ctx, ev)?   the site's own part
 *   slotFirst?                   slot above the request list
 *   onShow(request)?             "Show on map" on request cards
 *   onSector({ sec, eventKey })? what a hit of the sector search opens,
 *                                default onShow
 *   showTitle?                   what that does, for the hover text
 *   onState(state)?              every refresh, even when the panel is off
 *   onTrack()? -> key            the page's event is not tracked: offer "Track this event"
 *   trackTitle()?                what to call that event on the track card
 *   helpKey?
 * }) -> { ctx, state, eventKey, setEventKey, refresh, render, open, destroy }
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK || !SK.ui) return;
  const ui = SK.ui;
  const WIDTH = 360;
  const QUIET_KEYS = new Set(['ui', 'cmdState', 'alertLog']);

  function applyPageTheme(theme) {
    const root = document.documentElement;
    if (theme === 'dark' || theme === 'light') root.setAttribute('data-sk-theme', theme);
    else root.removeAttribute('data-sk-theme');
  }

  function create(opts) {
    let eventKey = opts.eventKey || null;
    let host = null, shadow = null, app = null, panel = null, tab = null, bodyEl = null, pushStyle = null;
    let left = opts.side === 'left';          // the default; ⇄ moves it, and the choice is kept
    const sideKey = opts.site + ':' + (opts.pageKey || '');
    let isOpen = true, openLoaded = false, dirty = false, notice = null, looked = false, stopped = false;
    /* the search box survives re-renders; typing only redraws what it filters:
     * this event's requests, and the sectors of the event it matches */
    let searchEl = null, drawRequests = () => {}, drawSectors = () => {};

    const ctx = {
      state: null,
      expanded: new Set(),
      addDraft: null,
      idPrefix: 'sk-' + opts.site,
      onShow: opts.onShow || null,
      onReserve: opts.onReserve || null,
      canReserve: opts.canReserve || null,
      /* the sector this page is showing, so its requests sort to the top */
      pinSector: opts.pinSector || null,
      refresh: force => refresh(force),
      rerender: () => render(),
      notice(text, isError) {
        notice = { text, isError, at: Date.now() };
        render();
        setTimeout(() => { if (notice && Date.now() - notice.at >= 6000) { notice = null; render(); } }, 6100);
      },
      openUrl(url) {
        try {
          const u = new URL(url);
          if (u.origin === location.origin) { if (u.href !== location.href) location.href = url; return; }
        } catch (e) { /* not a URL */ }
        window.open(url, '_blank', 'noopener');
      }
    };

    /* ---------------- open / closed, remembered per site ------------ */

    async function loadOpen() {
      try {
        const { ui: u } = await chrome.storage.local.get('ui');
        const v = u && u.sidebar && u.sidebar[opts.site];
        isOpen = v === undefined ? true : !!v;
        const side = u && u.sidebarSide && u.sidebarSide[sideKey];
        if (side === 'left' || side === 'right') left = side === 'left';
      } catch (e) { /* keep the default */ }
      openLoaded = true;
    }

    async function saveSide() {
      try {
        const { ui: u } = await chrome.storage.local.get('ui');
        const next = Object.assign({}, u || {});
        next.sidebarSide = Object.assign({}, next.sidebarSide || {}, { [sideKey]: left ? 'left' : 'right' });
        await chrome.storage.local.set({ ui: next });
      } catch (e) { /* cosmetic */ }
    }

    /* to the other edge of the page, and remembered for this page */
    function flipSide() {
      setPush(false);                         // the page gives back the room on the old side first
      left = !left;
      if (app) app.classList.toggle('side-left', left);
      saveSide();
      render();
    }

    async function saveOpen() {
      try {
        const { ui: u } = await chrome.storage.local.get('ui');
        const next = Object.assign({}, u || {});
        next.sidebar = Object.assign({}, next.sidebar || {}, { [opts.site]: isOpen });
        await chrome.storage.local.set({ ui: next });
      } catch (e) { /* cosmetic */ }
    }

    function setOpen(v) {
      isOpen = !!v;
      saveOpen();
      render();
    }

    /* ---------------- push mode ------------------------------------- */

    function setPush(on) {
      const root = document.documentElement;
      const cls = left ? 'sk-push-left' : 'sk-push';
      const was = root.classList.contains(cls);
      if (on === was) return;
      root.style.setProperty('--sk-push-w', WIDTH + 'px');
      root.classList.toggle(cls, on);
      const siteInfo = ctx.state && ctx.state.sites.find(x => x.id === opts.site);
      const sel = siteInfo && siteInfo.pushSelectors;
      if (on && sel) {
        pushStyle = pushStyle || document.createElement('style');
        pushStyle.textContent = `${sel} { ${left ? 'left' : 'right'}: ${WIDTH}px !important; }`;
        (document.head || document.documentElement).append(pushStyle);
      } else if (pushStyle) {
        pushStyle.remove();
      }
      /* maps lay themselves out on resize */
      setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
    }

    /* ---------------- mounting -------------------------------------- */

    /* the extension was reloaded while this tab stayed open: take the sidebar
     * away and stop for good, instead of throwing on every redraw */
    function orphaned() {
      if (ui.alive()) return false;
      if (!stopped) {
        stopped = true;
        try { unmount(); } catch (e) { /* the page is on its own now */ }
      }
      return true;
    }

    function mount() {
      if (orphaned()) return;
      if (host && host.isConnected) return;
      host = document.createElement('div');
      host.id = 'sk-host-' + opts.site;
      shadow = host.attachShadow({ mode: 'open' });
      for (const href of ['ui/app.css', 'content/sidebar.css']) {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = chrome.runtime.getURL(href);
        shadow.append(l);
      }
      app = document.createElement('div');
      app.className = 'sk-app sk-sidebar' + (left ? ' side-left' : '');
      tab = ui.button('', 'sk-tab', () => setOpen(true), 'Open Seat Tracker');
      panel = document.createElement('aside');
      panel.className = 'sk-panel';
      app.append(tab, panel);
      shadow.append(app);
      /* typing in the sidebar must not trigger the site's keyboard shortcuts */
      for (const t of ['keydown', 'keyup', 'keypress']) app.addEventListener(t, e => e.stopPropagation());
      shadow.addEventListener('focusout', () => setTimeout(() => { if (dirty && !ui.typingIn(shadow)) render(); }, 60));
      document.documentElement.append(host);
    }

    function unmount() {
      if (host) host.remove();
      host = null;
      setPush(false);
    }

    /* ---------------- the calculator's last figures ------------------ */

    let calcValue = null;

    /* the event's face values as a code for the viagogo drawer: a tracked
     * event from the team's last scans, an untracked one from this PC's read */
    async function copyFace() {
      const r = await ui.send('faceFor', eventKey ? { eventKey } : { url: opts.previewUrl ? opts.previewUrl() : location.href });
      try {
        await navigator.clipboard.writeText(r.code);
      } catch (e) {
        ctx.notice('The clipboard refused: click the page once and press Copy again.', true);
        return;
      }
      const prices = new Set(r.face.sectors.map(x => x.price)).size;
      ctx.notice(`Copied ${SK.util.plural(r.face.sectors.length, 'sector')} at ${SK.util.plural(prices, 'price')} — on the viagogo event, open the drawer, press Face values and paste it.`);
    }

    async function loadCalc() {
      try {
        const { ui: u } = await chrome.storage.local.get('ui');
        if (u && u.calc) calcValue = u.calc;
      } catch (e) { /* defaults are fine */ }
    }

    async function saveCalc(v) {
      try {
        const { ui: u } = await chrome.storage.local.get('ui');
        await chrome.storage.local.set({ ui: Object.assign({}, u || {}, { calc: v }) });
      } catch (e) { /* cosmetic */ }
    }

    /* ---------------- data ------------------------------------------ */

    async function refresh(force) {
      if (stopped || orphaned()) return;
      let st;
      try { st = await ui.send('state', { scansFor: eventKey ? [eventKey] : [] }); }
      catch (e) { return; }
      if (stopped) return;                    // the page moved on while the state was on its way
      ctx.state = st;
      applyPageTheme(st.settings.theme);
      if (opts.onState) { try { opts.onState(st); } catch (e) { console.warn('[Seat Tracker]', e); } }

      if (!SK.settings.panelOn(st.settings, opts.site, opts.pageKey)) { unmount(); return; }
      if (!openLoaded) await loadOpen();
      if (stopped) return;
      mount();
      if (!force && ui.typingIn(shadow)) { dirty = true; return; }
      render();
    }

    let timer = null;
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!Object.keys(changes).some(k => !QUIET_KEYS.has(k) && !k.startsWith('cache:'))) return;
        clearTimeout(timer);
        timer = setTimeout(() => refresh(false), 150);
      });
    } catch (e) { /* extension context gone */ }

    async function doScan(scope) {
      const r = await ui.send('scan', { eventKey, scope });
      if (r.errors && r.errors.length) ctx.notice(r.errors[0], true);
      else ctx.notice(`Scanned ${SK.util.plural(r.scanned, 'sector')}.`);
    }

    /* ---------------- rendering ------------------------------------- */

    function statusBar(st, ev) {
      let text = '', cls = 'statusbar';
      const conn = ui.connectionNote(st, b => ui.retrySync(b, ctx));
      if (notice && Date.now() - notice.at < 6000) { text = notice.text; cls += notice.isError ? ' err' : ' ok'; }
      else if (st.auth && st.auth.problem) { text = st.auth.problem; cls += ' err'; }
      else if (conn) return conn;
      else if (ev && ev.health && ev.health.failing) { text = `Scans failing since ${SK.util.fmtClock(ev.health.firstFailAt)}: ${ev.health.lastError}`; cls += ' err'; }
      else if (st.snoozeUntil > Date.now()) text = `Alerts muted until ${SK.util.fmtClock(st.snoozeUntil)}`;
      if (!text) return null;
      return ui.el('div', cls, text);
    }

    function render() {
      if (stopped || orphaned() || !panel || !ctx.state) return;
      dirty = false;
      const st = ctx.state;
      const ev = ui.eventOf(st, eventKey);
      const mine = ev ? st.requests.filter(r => r.eventKey === ev.key) : [];
      const openCount = mine.filter(r => !r.done).length;
      const push = st.settings.sidebarMode === 'push';

      ui.applyTheme(app, st.settings.theme);
      app.classList.toggle('mode-push', push);
      app.classList.toggle('side-left', left);
      panel.classList.toggle('open', isOpen);
      tab.hidden = isOpen;
      setPush(isOpen && push);

      tab.textContent = '';
      tab.append(ui.dot(ev && ev.worst), ui.el('span', null, openCount ? `Seat Tracker · ${openCount}` : 'Seat Tracker'));

      const scrollTop = bodyEl ? bodyEl.scrollTop : 0;
      const keepDrawer = panel.querySelector(':scope > .drawer-wrap');
      panel.textContent = '';

      const head = ui.el('header', 'sk-head');
      const logo = document.createElement('img');
      logo.src = chrome.runtime.getURL('icons/32.png');
      logo.className = 'logo';
      logo.alt = '';
      const titles = ui.el('div', 'titles');
      /* the event's own name; its day and time lead the line under it */
      const info = ev && ev.info;
      const day = info && /^\d{4}-\d{2}-\d{2}$/.test(info.date)
        ? new Date(info.date + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
        : '';
      const titleEl = ui.el('div', 'title', opts.title ? opts.title(st, ev) : ev ? (info && info.name) || ev.title : (opts.trackTitle && opts.trackTitle()) || 'Seat Tracker');
      if (ev) titleEl.title = ev.title;
      titles.append(
        titleEl,
        ui.el('div', 'sub', opts.subtitle ? opts.subtitle(st, ev) : ev
          ? [day && info.time ? `${day} ${info.time}` : day, `[${ev.num}] ${ev.siteLabel}`, `last scan ${SK.util.ago(ev.lastScanAt)}`, `auto ${ev.autoEvery ? ev.autoEvery + ' min' : 'off'}`].filter(Boolean).join(' · ')
          : looked ? 'Not tracked yet' : 'Linking this page…')
      );
      head.append(logo, titles,
        ui.button('⇄', 'ghost icon', () => flipSide(), left ? 'Move to the right of the page' : 'Move to the left of the page'),
        ui.button(left ? '‹' : '›', 'ghost icon', () => setOpen(false), 'Collapse to the edge'));
      /* anywhere on the header collapses it, not only › */
      head.classList.add('collapsible');
      head.title = 'Collapse to the edge';
      head.addEventListener('click', e => { if (!e.target.closest('button, a, input, select')) setOpen(false); });
      panel.append(head);

      const bar = ui.el('div', 'sk-toolbar');
      if (ev) {
        const scan = ui.button('Scan', 'primary', () => ui.busy(scan, () => doScan('tracked'), ctx), 'Scan the sectors with open requests');
        const all = ui.button('Scan all', '', () => ui.busy(all, () => doScan('all'), ctx), 'Scan every sector of this event');
        bar.append(scan, all);
        if (opts.faceCopy) {
          const fc = ui.button('Copy for viagogo', 'mini', () => ui.busy(fc, () => copyFace(), ctx),
            'Copy this event\'s face values and free seats (from the last scans), to paste on its viagogo event for price comparison');
          bar.append(fc);
        }
        if (!searchEl) searchEl = ui.searchInput('', v => { ctx.search = v; drawSectors(); drawRequests(); }, {
          placeholder: 'Sector, name or listing ID',
          label: 'Search this event\'s sectors and requests'
        });
        bar.append(searchEl);
      } else {
        bar.append(ui.el('span', 'spacer'));
      }
      bar.append(ui.button('⚙', 'ghost icon', () => ui.send('openPage', { path: 'popup/popup.html?page=1' }).catch(() => {}), 'Settings'));
      bar.append(ui.helpButton(opts.helpKey || 'panels', () => panel));
      panel.append(bar);

      const status = statusBar(st, ev);
      if (status) panel.append(status);

      bodyEl = ui.el('div', 'sk-body');

      /* this PC is not signed in to the team: nothing can be shown or tracked */
      if (!st.auth || !st.auth.signedIn) {
        const card = ui.el('div', 'track-card');
        card.append(ui.el('strong', null, 'Sign in on this PC'));
        card.append(ui.el('p', 'note', 'Seat Tracker shares events and scans with your team. Sign in once on this PC to see your requests here.'));
        const go = ui.button('Open Seat Tracker', 'primary', () => ui.send('openPage', { path: 'popup/popup.html?page=1' }).catch(() => {}));
        card.append(go);
        bodyEl.append(card);
        panel.append(bodyEl);
        if (keepDrawer) panel.append(keepDrawer);
        return;
      }

      /* an event page that is not tracked: nothing is added until the user says so */
      if (!ev && looked && opts.onTrack) {
        const card = ui.el('div', 'track-card');
        const name = opts.trackTitle ? opts.trackTitle() : '';
        card.append(ui.el('strong', null, 'This event is not tracked'));
        if (name) card.append(ui.el('div', 'track-title', name));
        card.append(ui.el('p', 'note', 'Track it to add requests, see badges and get alerts. Pages you only look at are never added.'));
        const go = ui.button('Track this event', 'primary', () => ui.busy(go, async () => {
          const key = await opts.onTrack();
          if (!key) return;
          eventKey = key;
          ctx.notice('Event tracked — add a request below.');
          ctx.addOpen = true;
          await refresh(true);
        }, ctx));
        card.append(go);

        /* Look before you follow: read every sector of an event nobody has
         * tracked, so the map can show what is free without adding anything
         * to the team's data. The answer stays on this PC for an hour. */
        if (opts.previewUrl) {
          const key = opts.previewUrl();
          const pv = key && ctx.state && ctx.state.previews ? ctx.state.previews[opts.previewKey ? opts.previewKey() : ''] : null;
          const look = ui.button(pv ? 'Read the stadium again' : 'Read the whole stadium', 'mini', () => ui.busy(look, async () => {
            const r = await ui.send('previewScan', { url: opts.previewUrl() });
            const n = Object.values(r.sectors).filter(x => x.available > 0).length;
            ctx.notice(r.errors && r.errors.length
              ? `Read ${Object.keys(r.sectors).length} sectors · ${r.errors.length} failed: ${r.errors[0]}`
              : `Read ${Object.keys(r.sectors).length} sectors — ${n} with seats free. Nothing was added.`);
            await refresh(true);
          }, ctx), 'Read every sector on sale and show the free seats on the map — nothing is tracked and nothing is shared');
          card.append(look);
          if (pv && opts.faceCopy === true) {
            const fc = ui.button('Copy for viagogo', 'mini primary', () => ui.busy(fc, () => copyFace(), ctx),
              'Copy the face values and free seats just read, to paste on this show\'s viagogo event for price comparison');
            card.append(fc);
          }
          if (pv) card.append(ui.el('p', 'note', `Read ${ui.el ? SK.util.ago(pv.at) : ''} · badges on the map show free seats. Track the event to keep them.`));
        }
        bodyEl.append(card);
      }
      const slot = ui.el('div', 'sk-slot');
      if (opts.renderSlot) opts.renderSlot(slot, ctx, ev);
      if (opts.slotFirst && slot.childNodes.length) bodyEl.append(slot);

      if (ev) {
        /* Sectors matching the search box, whether or not anything is tracked
         * in them — the way to find a sector by name without scrolling the
         * site's own list. Empty until something is typed. */
        const sectorHost = ui.el('div', 'sk-sectors');
        drawSectors = () => {
          sectorHost.textContent = '';
          const q = (ctx.search || '').trim();
          if (!q) return;
          const hits = ui.matchSectors(ev, q);
          const title = ui.el('div', 'sk-section-title');
          title.append(ui.el('span', null, `Sectors · ${hits.length} of ${ev.sectors.length}`));
          sectorHost.append(title);
          if (!hits.length) {
            sectorHost.append(ui.el('p', 'note', `No sector of this event matches "${q}".`));
            return;
          }
          const ul = ui.el('ul', 'sk-sector-hits');
          const pickSector = opts.onSector || opts.onShow;
          for (const s of hits.slice(0, 20)) {
            const wanted = mine.filter(r => !r.done && String(r.sec) === String(s.id)).reduce((n, r) => n + r.qty, 0);
            const li = ui.el('li');
            const line = ui.el('div', 'sh-line');
            line.append(ui.el('b', null, s.code));
            if (wanted) line.append(ui.el('span', 'sh-mine', `${wanted} wanted`));
            line.append(ui.el('span', 'spacer'), ui.el('span', 'sh-hint', ui.sectorHintText(s) || 'not scanned yet'));
            if (pickSector) {
              li.classList.add('clickable');
              li.title = opts.showTitle || 'Show this sector';
              li.addEventListener('click', () => pickSector({ sec: s.id, eventKey: ev.key }));
            }
            li.append(line);
            ul.append(li);
          }
          if (hits.length > 20) ul.append(ui.el('li', 'note', `+${hits.length - 20} more — type a little more`));
          sectorHost.append(ul);
        };
        drawSectors();
        bodyEl.append(sectorHost);

        const h = ui.el('div', 'sk-section-title');
        h.append(ui.el('span', null, openCount ? `Requests · ${openCount} open` : 'Requests'), ui.el('span', 'spacer'), ui.helpButton('requests', () => panel));
        bodyEl.append(h);
        const listHost = ui.el('div', 'sk-reqs');
        drawRequests = () => {
          const q = (ctx.search || '').trim();
          const shown = mine.filter(r => ui.requestMatches(r, ev, q));
          listHost.textContent = '';
          if (shown.length) listHost.append(ui.requestList(ctx, shown));
          else listHost.append(ui.el('p', 'note', mine.length ? `No request matches "${q}".` : 'No requests for this event yet.'));
        };
        drawRequests();
        bodyEl.append(listHost);

        const det = document.createElement('details');
        det.className = 'section';
        det.open = ctx.addOpen !== undefined ? ctx.addOpen : !mine.length;
        det.addEventListener('toggle', () => { ctx.addOpen = det.open; });
        det.append(ui.el('summary', null, 'Add a request'), ui.addForm(ctx, { fixedEventKey: ev.key }));
        bodyEl.append(det);
      }
      if (!opts.slotFirst && slot.childNodes.length) bodyEl.append(slot);

      /* a calculator of its own, on every site: try a buy and an ask price
       * in any two currencies without a listing to hang them on */
      const calc = document.createElement('details');
      calc.className = 'section';
      calc.open = !!ctx.calcOpen;
      calc.addEventListener('toggle', () => { ctx.calcOpen = calc.open; });
      calc.append(ui.el('summary', null, 'Price calculator'));
      calc.append(ui.priceCalculator(st, { value: calcValue, onChange: v => { calcValue = v; saveCalc(v); } }));
      bodyEl.append(calc);

      panel.append(bodyEl);
      if (keepDrawer) panel.append(keepDrawer);
      bodyEl.scrollTop = scrollTop;
    }

    loadCalc().then(() => { if (calcValue && !stopped) render(); });
    refresh(true);

    return {
      ctx,
      get state() { return ctx.state; },
      get eventKey() { return eventKey; },
      setEventKey(k) {
        const changed = k !== eventKey || !looked;
        eventKey = k || null;
        looked = true;
        if (changed) refresh(true);
      },
      refresh,
      render,
      open() { if (!isOpen) setOpen(true); else render(); },
      /* the page is no longer one the sidebar belongs on (single-page apps) */
      destroy() { stopped = true; unmount(); },
      get stopped() { return stopped; }
    };
  }

  SK.shell = { create, applyPageTheme };
})();
