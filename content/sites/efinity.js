/* ------------------------------------------------------------------
 * Seat Tracker on efinity.rs/event-map/*
 * Badges float over each sector with open requests (drawn in our own
 * fixed layer, never inside the site's React tree). Clicking one opens
 * that sector's card in the sidebar; clicking a block outlines its seats.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK || !SK.shell || window.__skEfinity) return;
  window.__skEfinity = true;

  const ui = SK.ui;
  const site = SK.site('efinity');
  let eventKey = null;
  let selected = null;
  let outlineIds = [];
  const view = { minBlock: null, cats: [], selected: null };
  const ACT = SK.efAct || null;
  let holdQty = null;

  const layer = document.createElement('div');
  layer.className = 'sk-layer';
  document.documentElement.appendChild(layer);
  const badges = new Map();

  const sidebar = SK.shell.create({
    site: 'efinity',
    pageKey: 'map',
    /* eFinity keeps its own basket and controls down the right of the map */
    side: 'left',
    trackTitle: () => ((/event-map\/([^/?#]+)/.exec(location.pathname) || [])[1] || '').replace(/_?\d+$/, '').replace(/_/g, ' ').toUpperCase(),
    previewUrl: () => location.href,
    previewKey: () => previewKey(),
    /* untracked, the sector list has its own Copy button */
    faceCopy: 'tracked',
    onTrack: async () => {
      const res = await ui.send('registerPage', { url: location.href });
      eventKey = res.key;
      return res.key;
    },
    pinSector: () => selected,
    canReserve: () => actState().can,
    /* a request for another sector is filled from that sector, so pick it
     * first — on eFinity every sector is on this one page, so nothing loads */
    onReserve: (r, qty) => {
      const n = Math.max(1, Number(qty) || r.qty);
      if (String(r.sec) !== String(selected)) select(r.sec);
      reserve(String(r.sec), n, `request #${r.num}`);
    },
    renderSlot(slot, ctx, ev) {
      if (!ev) { previewList(slot, ctx); return; }
      slot.append(chosenBox(ctx));
      if (!selected) {
        slot.append(ui.el('p', 'note hint', 'Click a badge on the map, or "Show on map" on a request, to see that sector\'s blocks.'));
        return;
      }
      slot.append(holdBox(ctx, ev));
      slot.append(ui.sectorCard(ctx, {
        eventKey: ev.key, secId: selected, view,
        onBlock: b => { outlineIds = b.seats; drawOutline(); },
        onClear: () => { outlineIds = []; drawOutline(); },
        onHold: actState().can ? (b, n) => hold(b.seats.slice(0, n || b.seats.length), 'block') : null,
        onClose: () => { selected = null; outlineIds = []; drawOutline(); syncBadges(); sidebar.render(); }
      }));
    },
    onShow: r => select(r.sec),
    onState: () => syncBadges()
  });

  /* ---------------- a stadium read without tracking it -------------- */

  function previewKey() {
    const id = site.eventFromUrl(location.href);
    return id ? SK.eventKey('efinity', id) : '';
  }

  function previewOf(st) {
    const key = previewKey();
    return (key && st && st.previews && st.previews[key]) || null;
  }

  /* sector prices are in dinars; the list shows them in whichever currency
   * is picked above it, at the team's rate of the day, remembered on this PC */
  let priceCur = 'RSD';
  /* what the list and the badges leave out: sold-out sectors, and sectors
   * where no two free seats are side by side (one seat left counts too) */
  const hide = { soldOut: false, singles: false };
  (async () => {
    try {
      const { ui: u } = await chrome.storage.local.get('ui');
      if (u && u.efPriceCur && SK.profit.CURRENCIES.includes(u.efPriceCur)) priceCur = u.efPriceCur;
      if (u && u.efHide) Object.assign(hide, { soldOut: !!u.efHide.soldOut, singles: !!u.efHide.singles });
      syncBadges();
      sidebar.render();
    } catch (e) { /* defaults are fine */ }
  })();
  async function saveUi(patch) {
    try {
      const { ui: u } = await chrome.storage.local.get('ui');
      await chrome.storage.local.set({ ui: Object.assign({}, u || {}, patch) });
    } catch (e) { /* cosmetic */ }
  }

  const soldOut = x => !x.unmapped && !x.skipped && !(x.available > 0);
  /* a bar table is whole or nothing, so runs inside it mean nothing */
  const singlesOnly = x => !x.unmapped && !x.skipped && !x.perTable && x.available > 0 && (x.longest || 0) < 2;
  const hidden = x => (hide.soldOut && soldOut(x)) || (hide.singles && singlesOnly(x));

  /* RSD -> lek -> the picked currency; null when a rate is missing */
  function convert(rsd) {
    if (priceCur === 'RSD') return rsd;
    const P = SK.profit;
    const rates = (sidebar.state && sidebar.state.fx && sidebar.state.fx.rates) || {};
    const from = P.rateOf(rates, 'RSD'), to = P.rateOf(rates, priceCur);
    return from && to ? rsd * from / to : null;
  }

  const rsdText = p => `${Number(p).toLocaleString('en')} RSD`;
  function price(p) {
    if (!(Number(p) > 0)) return '';
    const n = convert(Number(p));
    if (n === null || priceCur === 'RSD') return rsdText(p);
    return SK.profit.formatMoney(priceCur === 'ALL' ? Math.round(n) : n, priceCur);
  }

  function currencyPicker() {
    const row = ui.el('div', 'reserve-line');
    const sel = ui.el('select');
    for (const c of SK.profit.CURRENCIES) {
      const op = ui.el('option', null, c);
      op.value = c;
      op.selected = c === priceCur;
      sel.append(op);
    }
    sel.addEventListener('change', () => { priceCur = sel.value; saveUi({ efPriceCur: priceCur }); syncBadges(); sidebar.render(); });
    row.append(ui.el('span', 'buylabel', 'Prices in'), sel);

    const box = (key, text, tip) => {
      const lab = ui.el('label', 'hide-opt');
      const cb = ui.el('input');
      cb.type = 'checkbox';
      cb.checked = hide[key];
      cb.addEventListener('change', () => { hide[key] = cb.checked; saveUi({ efHide: { ...hide } }); syncBadges(); sidebar.render(); });
      lab.title = tip;
      lab.append(cb, document.createTextNode(text));
      return lab;
    };
    const filters = ui.el('div', 'reserve-line');
    filters.append(
      box('soldOut', 'Hide sold out', 'Leave out sectors with no free seat, in this list and on the map'),
      box('singles', 'Hide singles', 'Leave out sectors where no two free seats are next to each other — one seat left counts too'));
    const wrap = ui.el('div');
    wrap.append(row, filters);
    if (priceCur !== 'RSD' && convert(1) === null) wrap.append(ui.el('p', 'note', `No ${priceCur} rate yet — showing RSD.`));
    return wrap;
  }

  /* every sector of the read, the fullest first, with its price: the
   * drawer is where an untracked stadium is seen all at once */
  /* one color per price, the same ones the viagogo drawer uses */
  const NO_PRICE = SK.face.NO_PRICE;
  const tiers = pv => SK.face.tiers(Object.values(pv.sectors).map(x => x.price));

  /* the read as a code to paste on the viagogo event: face values and free
   * seats, since nothing ties this page to a viagogo event by itself */
  async function copyForViagogo(ctx, pv) {
    const face = SK.face.fromPreview(pv);
    if (!face.sectors.length) { ctx.notice('No sector has a price to hand on.', true); return; }
    try {
      await navigator.clipboard.writeText(SK.face.pack(face));
      ctx.notice(`Copied ${SK.util.plural(face.sectors.length, 'sector')} — on the viagogo event, open the drawer, press Face values and paste it. On this PC it is also offered there for an hour.`);
    } catch (e) {
      ctx.notice('The clipboard refused: click the page once and press Copy again.', true);
    }
  }

  function previewList(slot, ctx) {
    const pv = previewOf(ctx.state);
    if (!pv) return;
    const rows = Object.entries(pv.sectors).map(([id, x]) => ({ id, ...x, free: x.unmapped || x.skipped ? -1 : x.available }));
    if (!rows.length) return;

    const seated = rows.filter(r => r.free >= 0);
    const total = seated.reduce((n, r) => n + r.free, 0);
    const head = ui.el('div', 'sk-section-title');
    head.append(ui.el('span', null, `Seats free · ${total} in ${seated.filter(r => r.free > 0).length} of ${rows.length} sectors`));
    head.append(ui.el('span', 'spacer'), ui.el('span', 'muted', `read ${SK.util.ago(pv.at)}`));
    slot.append(head);
    const copy = ui.button('Copy for viagogo', 'mini', () => copyForViagogo(ctx, pv), 'Copy the face values and free seats, to paste on the viagogo event of this show for price comparison');
    const copyLine = ui.el('div', 'reserve-line');
    copyLine.append(copy);
    slot.append(copyLine);
    slot.append(currencyPicker());

    /* colors come from every price, so a group keeps its color when the
     * filters hide its neighbours */
    const { prices, colorOf } = tiers(pv);
    const shown = rows.filter(r => !hidden(r));
    const groups = prices.map(p => ({ price: p, rows: shown.filter(r => Number(r.price) === p) })).filter(g => g.rows.length);
    const unpriced = shown.filter(r => !(Number(r.price) > 0));
    if (unpriced.length) groups.push({ price: null, rows: unpriced });
    const nHidden = rows.length - shown.length;
    if (nHidden) slot.append(ui.el('p', 'note', `${SK.util.plural(nHidden, 'sector')} hidden by the filters.`));

    const byFree = (a, b) => b.free - a.free || String(a.code).localeCompare(String(b.code), 'en', { numeric: true });
    for (const g of groups) {
      g.rows.sort(byFree);
      const color = g.price ? colorOf(g.price) : NO_PRICE;
      const free = g.rows.reduce((n, r) => n + Math.max(0, r.free), 0);
      const open = g.rows.filter(r => r.free > 0).length;

      const gh = ui.el('div', 'tier-head');
      gh.style.setProperty('--tier', color);
      const label = ui.el('span', 'tier-price', g.price ? price(g.price) : 'No price');
      if (g.price && priceCur !== 'RSD') label.title = rsdText(g.price);
      gh.append(ui.el('span', 'tier-dot'), label, ui.el('span', 'spacer'),
        ui.el('span', 'muted', free ? `${free} free · ${open} of ${SK.util.plural(g.rows.length, 'sector')}` : `${SK.util.plural(g.rows.length, 'sector')} · none free`));
      slot.append(gh);

      const ul = ui.el('ul', 'reqs');
      for (const r of g.rows) {
        const li = ui.el('li', 'req tier' + (r.free > 0 ? '' : ' empty'));
        li.style.setProperty('--tier', color);
        const top = ui.el('div', 'top');
        top.append(ui.el('span', 'sec', r.code || r.id), ui.el('span', 'spacer'));
        let num;
        if (r.unmapped) num = 'standing';
        else if (r.skipped) num = 'not read';
        else if (r.perTable) num = r.free > 0 ? `${SK.util.plural(Math.floor(r.free / r.perTable), 'table')} free` : 'no table free';
        else num = r.free > 0 ? `${r.free} free` : 'sold out';
        top.append(ui.el('span', 'num', num));
        li.append(top);
        if (r.free > 0 && !r.perTable && r.longest) li.append(ui.el('div', 'detail', `longest run ${r.longest} · ${r.total} seats in all`));
        if (r.svgId) {
          li.classList.add('clickable');
          li.title = 'Outline this sector on the map';
          li.addEventListener('click', () => peek(r.id, r.svgId));
        }
        if (selected === r.id) li.classList.add('sel');
        ul.append(li);
      }
      slot.append(ul);
    }
  }

  /* an untracked event has no sector card to open: outline the sector */
  function peek(id, svgId) {
    selected = id;
    outlineIds = [svgId];
    drawOutline();
    syncBadges();
    sidebar.render();
  }

  /* ---------------- choosing seats --------------------------------- */

  function actState() {
    const st = sidebar && sidebar.state;
    if (!ACT) return { can: false, why: 'This page cannot choose seats.' };
    return { can: ACT.canAct(st && st.settings), why: ACT.why(st && st.settings) };
  }

  /* one seat at a time, checking each: the map gives a chosen seat back when
   * it is pressed again, so a blind retry would undo the last one */
  async function hold(ids, label) {
    const { can, why } = actState();
    if (!can) { sidebar.ctx.notice(why, true); return { taken: 0 }; }
    let taken = 0;
    for (const id of ids) {
      const r = await ACT.selectSeat(id, { why: label });
      if (!r.ok) {
        sidebar.render();
        sidebar.ctx.notice(`Stopped after ${taken}: ${r.reason}`, true);
        return { taken };
      }
      taken++;
      sidebar.render();
    }
    if (!ACT.loggedIn()) sidebar.ctx.notice(`${taken} seats chosen. Log in to eFinity before Payment — it will ask.`);
    return { taken };
  }

  /* the shortest run that still fits, so a long one is not spent on a few */
  function bestBlock(secId, qty) {
    const st = sidebar.state;
    const ev = ui.eventOf(st, eventKey);
    const scan = ev && st.scans[ev.key] && st.scans[ev.key][secId];
    if (!scan || scan.unmapped) return null;
    const v = SK.rules.blocksFor(scan, view.cats);
    const runs = ((v && v.blocks) || []).filter(b => b.len >= qty);
    if (!runs.length) return null;
    runs.sort((a, b) => a.len - b.len || String(a.row).localeCompare(String(b.row), 'en', { numeric: true }));
    return runs[0];
  }

  async function reserve(secId, qty, label) {
    const block = bestBlock(secId, qty);
    if (!block) { sidebar.ctx.notice(`No run of ${qty} seats next to each other in ${secId}.`, true); return; }
    outlineIds = block.seats;
    drawOutline();
    const r = await hold(block.seats.slice(0, qty), label || `reserve ${qty}`);
    if (r.taken === qty) sidebar.ctx.notice(`${qty} seats chosen in ${secId}, row ${block.row}. Finish on eFinity yourself.`);
    sidebar.render();
  }

  /* ---------------- what is chosen, and holding without a request ---- */

  function chosenBox(ctx) {
    const box = ui.el('div', 'track-card');
    const seats = ACT ? ACT.chosenSeats() : [];
    const head = ui.el('div', 'top');
    head.append(ui.el('strong', null, seats.length ? `${SK.util.plural(seats.length, 'seat')} chosen` : 'Nothing chosen'));
    head.append(ui.el('span', 'spacer'));
    if (seats.length) {
      const clear = ui.button('Give them back', 'mini danger', () => ui.busy(clear, async () => {
        const n = await ACT.clearChosen();
        ctx.notice(`Released ${SK.util.plural(n, 'seat')}.`);
        sidebar.render();
      }, ctx), 'Press each chosen seat again, which is how eFinity un-chooses one');
      head.append(clear);
    }
    box.append(head);
    if (!seats.length) {
      const { can, why } = actState();
      box.append(ui.el('p', 'note', can
        ? 'Press Reserve on a request, or Hold on a block, to choose seats. Seat Tracker never pays — you finish on eFinity.'
        : why));
      return box;
    }
    for (const s of seats.slice(0, 20)) box.append(ui.el('div', 'detail', `${s.sector} · row ${s.row} · seat ${s.num}`));
    if (seats.length > 20) box.append(ui.el('div', 'detail', `+${seats.length - 20} more`));
    if (!ACT.loggedIn()) box.append(ui.el('p', 'vg-why warn', 'You are not logged in to eFinity — Payment will ask for it.'));
    return box;
  }

  function holdBox(ctx, ev) {
    const box = ui.el('div', 'track-card');
    const sector = ui.sectorIn(ev, selected);
    box.append(ui.el('div', 'top', `Hold seats in ${sector ? sector.code : selected}`));
    if (holdQty === null) {
      const mine = (ctx.state.requests || []).filter(r => r.eventKey === ev.key && !r.done && String(r.sec) === String(selected));
      holdQty = mine.length ? Math.max(...mine.map(r => r.qty)) : 2;
    }
    const { can, why } = actState();
    const row = ui.el('div', 'reserve-line');
    const qty = ui.el('input');
    qty.type = 'number';
    qty.min = '1';
    qty.value = String(holdQty);
    qty.addEventListener('input', () => { holdQty = Math.max(1, parseInt(qty.value, 10) || 1); });
    const go = ui.button('Reserve', 'mini primary', () => {
      holdQty = Math.max(1, parseInt(qty.value, 10) || 1);
      reserve(selected, holdQty, 'no request');
    }, 'Choose that many seats next to each other here — nothing is paid');
    go.disabled = !can;
    row.append(ui.el('span', 'buylabel', 'Seats'), qty, go);
    box.append(row);
    if (!can) box.append(ui.el('p', 'note', why));
    return box;
  }

  function select(sec) {
    sec = String(sec);
    if (selected !== sec) {
      Object.assign(view, { minBlock: null, cats: [], selected: null });
      outlineIds = [];
      drawOutline();
    }
    selected = sec;
    syncBadges();
    sidebar.open();
  }

  function syncBadges() {
    const st = sidebar.state;
    const ev = st && ui.eventOf(st, eventKey);
    const pv = !ev && st ? previewOf(st) : null;
    if ((!ev && !pv) || !SK.settings.badgesOn(st.settings, 'efinity')) {
      badges.forEach(n => n.remove());
      badges.clear();
      return;
    }
    if (pv) { previewBadges(pv); return; }
    const bySec = new Map();
    for (const r of st.requests) {
      if (r.eventKey !== eventKey || r.done) continue;
      bySec.set(r.sec, (bySec.get(r.sec) || []).concat(r));
    }
    /* open requests first; BOUGHT and the bought tickets only when all of them are */
    for (const [sec, reqs] of bySec) bySec.set(sec, SK.rules.badgeOf(reqs, r => r.eval.status));
    for (const [sec, node] of badges) if (!bySec.has(sec)) { node.remove(); badges.delete(sec); }

    for (const [sec, info] of bySec) {
      const sector = ui.sectorIn(ev, sec);
      const svgId = sector && sector.meta && sector.meta.svgId;
      if (!svgId) continue;
      let node = badges.get(sec);
      if (!node) {
        node = document.createElement('button');
        node.type = 'button';
        node.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); select(sec); });
        layer.append(node);
        badges.set(sec, node);
      }
      const worst = info.status;
      node.className = `sk-badge ${ui.statusClass(worst)}${selected === sec ? ' sel' : ''}`;
      node.textContent = `${SK.rules.DOT[worst]} ${info.qty}`;
      node.title = `${sector.code} — ${info.qty} ${worst === 'BOUGHT' ? 'bought' : 'requested'} · ${worst}`;
      node.dataset.svg = svgId;
    }
    position();
  }

  /* free seats per sector, from a read of an untracked event */
  function previewBadges(pv) {
    const want = new Map();
    for (const [id, x] of Object.entries(pv.sectors)) {
      if (x.svgId && x.available > 0 && !hidden(x)) want.set(id, x);
    }
    for (const [sec, node] of badges) if (!want.has(sec)) { node.remove(); badges.delete(sec); }
    const { colorOf } = tiers(pv);
    for (const [sec, x] of want) {
      let node = badges.get(sec);
      if (!node) {
        node = document.createElement('button');
        node.type = 'button';
        node.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); peek(sec, node.dataset.svg); sidebar.open(); });
        layer.append(node);
        badges.set(sec, node);
      }
      node.className = `sk-badge tier${selected === sec ? ' sel' : ''}`;
      node.style.setProperty('--sk-tier', colorOf(x.price));
      node.textContent = '';
      node.append(Object.assign(document.createElement('span'), { className: 'sk-dot' }), String(x.available));
      node.title = `${x.code} — ${x.available} free${price(x.price) ? ' · ' + price(x.price) : ''}`;
      node.dataset.svg = x.svgId;
    }
    position();
  }

  /* the map pans and zooms: place what is on screen, cheaply */
  function position() {
    for (const node of badges.values()) {
      const target = document.getElementById(node.dataset.svg);
      const r = target && target.getBoundingClientRect();
      if (!r || !r.width || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
        node.style.display = 'none';
        continue;
      }
      node.style.display = '';
      node.style.left = (r.left + r.width / 2) + 'px';
      node.style.top = (r.top + r.height / 2) + 'px';
    }
    drawOutline();
  }

  function drawOutline() {
    const existing = layer.querySelectorAll('.sk-outline');
    let i = 0;
    for (const id of outlineIds) {
      const seat = document.getElementById(id);
      const r = seat && seat.getBoundingClientRect();
      if (!r || !r.width) continue;
      const o = existing[i] || layer.appendChild(Object.assign(document.createElement('div'), { className: 'sk-outline' }));
      o.style.cssText = `left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width + 4}px;height:${r.height + 4}px`;
      i++;
    }
    for (; i < existing.length; i++) existing[i].remove();
  }

  setInterval(() => { if (badges.size || outlineIds.length) position(); }, 250);
  addEventListener('scroll', position, true);
  addEventListener('resize', position);

  /* the site is a single-page app: follow URL changes */
  let lastUrl = '';
  async function link() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (!site.eventFromUrl(location.href)) return;
    try {
      /* only look the event up; it is added when the user presses Track */
      const res = await ui.send('lookupPage', { url: location.href });
      const key = res ? res.key : null;
      if (key !== eventKey) { selected = null; outlineIds = []; drawOutline(); }
      eventKey = key;
      sidebar.setEventKey(key);
    } catch (e) { /* extension reloaded */ }
  }
  link();
  setInterval(link, 1500);
})();
