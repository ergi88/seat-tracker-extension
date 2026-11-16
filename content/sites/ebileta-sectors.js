/* ------------------------------------------------------------------
 * Seat Tracker on eBileta's sector list (scegliSettorePub.do)
 *
 * - a − qty + pill on every sector: − / + change the tickets, clicking the
 *   number opens that sector's seat page (it does not open the sidebar)
 * - a numbered badge over each tracked sector on the stadium map, which
 *   also opens the seat page; a switch on the map shows both numbers on
 *   every badge, tickets wanted / seats free
 * - a tooltip over any sector of the map: its seats free and, when you have
 *   requests there, each one's options
 * - the sidebar with this event's requests, add form and scan buttons
 * The sector list is read straight from the page, so no extra request.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK || !SK.shell || window.__skEbSectors) return;
  const HOST = SK.ebileta.hostOf(location.hostname);
  if (!HOST) return;
  /* Nothing is checked about the address here: with one event on sale eBileta
   * puts that event's sectors on the event list page, which names no event at
   * all. Finding sectors below is what says this is a sector list. */
  window.__skEbSectors = true;

  const ui = SK.ui;
  const EB = SK.ebileta;

  function readSections() {
    return [...document.querySelectorAll('li.link_settore')].map(li => {
      const a = li.querySelector('a[data-content]');
      const id = (li.className.match(/sett_(\d+)/) || [])[1] || '';
      const name = a ? a.getAttribute('data-content').trim() : '';
      const span = a && a.querySelector('span[class^="disp"]');
      const cls = span ? (span.className.match(/disp[A-Za-z]+/) || [])[0] : '';
      const p = new URLSearchParams(((a && a.getAttribute('href')) || '').split('?')[1] || '');
      const s = { li, id, name, code: EB.shortCode(name), idSM: p.get('idSM') || '', tipoM: p.get('tipoM') || '1', status: EB.STATUS_LABELS[cls] || 'unknown' };
      const shape = shapeOnPage(s);
      if (shape) s.shape = shape;
      return s;
    }).filter(s => s.id);
  }

  /* the sector's outline on the stadium map, kept with the sector so it can
   * still be badged once eBileta takes the polygon away */
  function shapeOnPage(s) {
    const svg = document.querySelector('div.map svg');
    if (!svg) return null;
    const poly = [...svg.querySelectorAll('polygon')].find(p => p.getAttribute('artacom:id') === s.id || p.getAttribute('artacom:descr') === s.name);
    const points = poly && EB.cleanPoints(poly.getAttribute('points'));
    if (!points) return null;
    const vb = EB.cleanPoints(svg.getAttribute('viewBox'));
    return vb ? { points, vb } : { points };
  }

  const sections = readSections();
  if (!sections.length) return;
  /* the address that names this event, with the page's idSM added when it
   * names none itself */
  const pageUrl = EB.eventPageUrl(HOST, location.href, sections);
  if (!pageUrl) return;
  /* what the event is recognised by when the address names nothing */
  const idSM = EB.idSMIn(sections);
  let eventKey = null;
  let both = false;          // the map's badges show wanted / free (see setBoth)
  let priceSel = null;       // the price group picked above the strip: its top rate, 0 = no price, null = all

  /* Sectors eBileta has taken off this page since they sold out. The tracked
   * event keeps them (SK.ebileta.keepSectors), so they are listed, counted,
   * filtered by price and badged here like the rest — sold out, with no <li>
   * of the page's own, and no seat page to open. */
  const onPage = new Set(sections.map(s => s.id));
  const isRemoved = s => !onPage.has(String(s.id));

  /* The same sector in another tracked event at this stadium: eBileta keeps a
   * stadium's sector ids from one event to the next, so its outline (and,
   * for a sector lost before sectors were kept, its name) can come from there. */
  function twinOf(st, id, code) {
    for (const e of (st && st.events) || []) {
      if (e.site !== HOST.id || e.key === eventKey) continue;
      const x = e.sectors.find(y => String(y.id) === String(id) && (!code || y.code === code));
      if (x && x.meta && x.meta.shape) return x;
    }
    return null;
  }

  function goneSections(st) {
    const ev = ui.eventOf(st, eventKey);
    if (!ev) return [];
    const shapeOf = x => (x.meta && x.meta.shape) || ((twinOf(st, x.id, x.code) || {}).meta || {}).shape || null;
    const out = ev.sectors.filter(x => !onPage.has(String(x.id))).map(x => ({
      li: null, id: String(x.id), name: x.name, code: x.code,
      idSM: (x.meta && x.meta.idSM) || idSM, tipoM: (x.meta && x.meta.tipoM) || '1',
      status: 'soldout', gone: (x.meta && x.meta.gone) || 0, shape: shapeOf(x)
    }));
    /* Removed before the event kept its sectors: only your requests and
     * listings still name them, by id. */
    const known = new Set([...onPage, ...ev.sectors.map(x => String(x.id))]);
    const named = [
      ...st.requests.filter(r => r.eventKey === eventKey && !r.done).map(r => ({ id: String(r.sec), name: r.sectorName })),
      ...(st.listings || []).filter(l => l.eventKey === eventKey && l.sectorId).map(l => ({ id: String(l.sectorId), name: l.section }))
    ];
    for (const n of named) {
      if (known.has(n.id)) continue;
      known.add(n.id);
      const twin = twinOf(st, n.id, null);
      const name = (twin && twin.name) || (n.name && n.name !== n.id ? n.name : '') || `sector ${n.id}`;
      out.push({ li: null, id: n.id, name, code: twin ? twin.code : EB.shortCode(name), idSM, tipoM: '1', status: 'soldout', gone: 0, shape: twin ? twin.meta.shape : null });
    }
    return out;
  }
  const allSections = st => sections.concat(goneSections(st));

  const pageTitle = () => {
    const h1 = document.querySelector('h1');
    return h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '';
  };

  const sidebar = SK.shell.create({
    site: HOST.id,
    pageKey: 'sectors',
    trackTitle: pageTitle,
    previewUrl: () => pageUrl,
    previewKey: () => `${HOST.id}:${SK.site(HOST.id).eventFromUrl(pageUrl) || ''}`,
    onTrack: async () => {
      const res = await ui.send('registerPage', {
        url: pageUrl,
        site: HOST.id,
        idSM,
        title: pageTitle(),
        titleWins: true,
        sections: sections.map(({ li, ...s }) => s)
      });
      eventKey = res.key;
      return res.key;
    },
    /* a hit of the sidebar's sector search opens that sector's seat map */
    onSector: r => {
      const s = allSections(sidebar.state).find(x => x.id === String(r.sec));
      if (s) openSection(s);
    },
    showTitle: 'Open this sector\'s seat map',
    slotFirst: true,
    renderSlot: (slot, ctx) => renderSectorList(slot, ctx),
    /* the seats live on the sector's own page, so Reserve goes there carrying
     * a ticket — spendable once, written only by this real click */
    canReserve: () => !!(SK.ebAct && SK.ebAct.canAct(sidebar.state && sidebar.state.settings)),
    onReserve: (r, qty) => {
      const sec = sections.find(x => x.id === String(r.sec));
      if (!sec) {
        const gone = goneSections(sidebar.state).some(x => x.id === String(r.sec));
        sidebar.ctx.notice(gone ? 'eBileta has removed that sector from the event: nothing left to hold.' : 'That sector is not on this page.', true);
        return;
      }
      if (!SK.ebAct || !SK.ebAct.canAct(sidebar.state && sidebar.state.settings)) {
        sidebar.ctx.notice(SK.ebAct ? SK.ebAct.why(sidebar.state && sidebar.state.settings) : 'Cannot hold seats here.', true);
        return;
      }
      SK.ebAct.leaveTicket({ sectorId: sec.id, qty: Math.max(1, Number(qty) || r.qty), label: `request #${r.num}` });
      openSection(sec);
    },
    onState: () => { renderListBadges(); renderFreeRow(); scheduleMap(); }
  });

  /* a removed sector has no seat page left to open: everything else about it stays */
  const openSection = s => {
    if (isRemoved(s)) { sidebar.ctx.notice(`${s.code || s.name} is no longer on eBileta, so it has no seat page to open.`); return; }
    location.href = EB.seatPageUrl(s, HOST.origin);
  };

  /* tickets wanted here and the worst status of those requests */
  /* what this PC read without tracking the event, when there is no event */
  function previewOf(st) {
    const key = eventKey || `${HOST.id}:${SK.site(HOST.id).eventFromUrl(pageUrl) || ''}`;
    return (st && st.previews && st.previews[key]) || null;
  }

  /* What is known about one sector's seats: the team's last scan when the
   * event is tracked, otherwise what this PC read on its own. One answer, so
   * the map, the strip and the list can never disagree. */
  function summaryFor(st, id) {
    const sector = ui.sectorIn(ui.eventOf(st, eventKey), id);
    if (sector && sector.summary) return sector.summary;
    const pv = previewOf(st);
    const own = pv && pv.sectors[String(id)];
    return own && !own.skipped ? own : null;
  }

  /* A sector's price group is its top rate: from the last scan, or for a
   * sector eBileta has dropped, the price kept with it when it went. */
  function priceOf(st, s) {
    const sum = summaryFor(st, s.id);
    const sec = ui.sectorIn(ui.eventOf(st, eventKey), s.id);
    const p = (sum && sum.price) || (sec && sec.meta && sec.meta.price) || null;
    return p && Number(p.max) > 0 ? p : null;
  }
  const priceText = p => SK.profit.formatMoney(Number(p.max), p.currency || HOST.currency)
    + (Number(p.min) > 0 && Number(p.min) !== Number(p.max) ? ` (from ${SK.profit.formatMoney(Number(p.min), p.currency || HOST.currency)})` : '');
  function priceTiers(st) {
    return SK.face.tiers(allSections(st).map(s => priceOf(st, s)).filter(Boolean).map(p => Number(p.max)));
  }
  function inPrice(st, s) {
    if (priceSel === null) return true;
    const p = priceOf(st, s);
    return p ? Number(p.max) === priceSel : priceSel === 0;
  }
  function pickPrice(v) {
    priceSel = priceSel === v ? null : v;
    renderFreeRow();
    scheduleMap();
    sidebar.render();
  }

  function infoFor(st, s) {
    const ev = ui.eventOf(st, eventKey);
    const mine = ev ? st.requests.filter(r => r.eventKey === eventKey && !r.done && String(r.sec) === s.id) : [];
    /* open requests first; BOUGHT and the bought tickets only when all of them are */
    const badge = SK.rules.badgeOf(mine, r => r.eval.status);
    const qty = badge ? badge.qty : 0;
    const sum = summaryFor(st, s.id);
    let status = badge ? badge.status : null;
    /* every request fits on its own, but not all of them together */
    if (status && sum && !sum.unmapped && sum.available < qty && SK.rules.isFillable(status)) status = 'SHORT';
    /* the page says so itself, above the map, before anything is scanned */
    return { qty, status, sum, soldout: s.status === 'soldout' };
  }

  async function bump(s, delta) {
    try { await ui.send('bumpSector', { eventKey, sec: s.id, delta }); }
    catch (e) { sidebar.ctx.notice(e.message, true); }
  }

  function badgesOn() {
    const st = sidebar.state;
    if (!st || !SK.settings.badgesOn(st.settings, HOST.id)) return false;
    /* a stadium read without tracking it has something to show too */
    return !!(eventKey || previewOf(st));
  }

  /* ---------------- every sector, in the drawer --------------------- */

  /* Once a stadium has been read, the drawer is the place to see all of it at
   * once: every sector, what is free, and the longest run in it. On a tracked
   * event the requests below already say what is wanted, so this stays about
   * the seats. */
  function renderSectorList(slot, ctx) {
    const st = ctx.state;
    if (!st) return;
    const pv = previewOf(st);
    const ev = ui.eventOf(st, eventKey);
    if (!pv && !ev) return;

    const rows = allSections(st).filter(s => inPrice(st, s)).map(s => {
      const { qty, sum, soldout } = infoFor(st, s);
      return { s, qty, sum, soldout, free: sum && !sum.unmapped ? sum.available : -1 };
    });
    const read = rows.filter(r => r.free >= 0);
    if (!read.length) return;

    const head = ui.el('div', 'sk-section-title');
    const total = read.reduce((n, r) => n + r.free, 0);
    const at = priceSel ? ` at ${SK.profit.formatMoney(priceSel, HOST.currency)}` : priceSel === 0 ? ' with no price' : '';
    head.append(ui.el('span', null, `Seats free${at} · ${total} in ${read.filter(r => r.free > 0).length} of ${rows.length} sectors`));
    head.append(ui.el('span', 'spacer'));
    if (pv && !ev) head.append(ui.el('span', 'muted', `read ${SK.util.ago(pv.at)}`));
    slot.append(head);

    /* the fullest first: what you would look at anyway */
    read.sort((a, b) => b.free - a.free || String(a.s.code).localeCompare(String(b.s.code), 'en', { numeric: true }));
    const ul = ui.el('ul', 'reqs');
    for (const r of read) {
      const li = ui.el('li', 'req ' + (r.free > 0 ? 'st-OK' : 'st-NONE'));
      const top = ui.el('div', 'top');
      top.append(ui.el('span', 'sec', r.s.code || r.s.name));
      if (isRemoved(r.s)) top.append(ui.el('span', 'chip', 'removed'));
      if (r.qty) top.append(ui.el('span', 'chip', `${r.qty} wanted`));
      top.append(ui.el('span', 'spacer'));
      top.append(ui.el('span', 'num', r.free > 0 ? `${r.free} free` : 'none'));
      li.append(top);
      if (r.free > 0 && r.sum.longest) li.append(ui.el('div', 'detail', `longest run ${r.sum.longest} · ${r.sum.total} seats in all`));
      li.addEventListener('click', () => openSection(r.s));
      li.title = 'Open this sector\'s seat map';
      ul.append(li);
    }
    slot.append(ul);

    const shut = rows.filter(r => r.free < 0 && r.soldout).length;
    if (shut) slot.append(ui.el('p', 'note', `${shut} sold out, so never read.`));
  }

  /* ---------------- pills on the sector list ------------------------ */

  function renderListBadges() {
    const on = badgesOn();
    const st = sidebar.state;
    for (const s of sections) {
      const b = s.li.querySelector(':scope > .sk-eb-badge');
      if (!on) { if (b) b.remove(); continue; }
      pill(st, s, b);
    }
    renderGoneList(on, st);
  }

  /* the − qty + pill on one sector's row; b = the one already there */
  function pill(st, s, b, host) {
    if (!b) {
      b = document.createElement('div');
      const minus = Object.assign(document.createElement('button'), { type: 'button', textContent: '−', title: 'One ticket less' });
      const num = Object.assign(document.createElement('button'), { type: 'button', className: 'sk-open', title: 'Open this sector\'s seat map' });
      const plus = Object.assign(document.createElement('button'), { type: 'button', textContent: '+', title: 'One ticket more' });
      minus.dataset.a = 'minus'; num.dataset.a = 'open'; plus.dataset.a = 'plus';
      b.append(minus, num, plus);
      b.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const a = e.target.closest('[data-a]');
        if (!a) return;
        if (a.dataset.a === 'minus') bump(s, -1);
        else if (a.dataset.a === 'plus') bump(s, +1);
        else openSection(s);
      }, true);
      (host || s.li).appendChild(b);
    }
    const { qty, status, sum } = infoFor(st, s);
    b.className = `sk-eb-badge ${status ? ui.statusClass(status) : ''}${qty ? ' has' : ''}`;
    const num = b.querySelector('.sk-open');
    num.textContent = String(qty);
    if (qty && sum && !sum.unmapped) {
      const free = document.createElement('span');
      free.className = 'sk-free';
      free.textContent = ` / ${sum.available}`;
      num.append(free);
    }
    b.title = qty
      ? `${s.name}\n${qty} requested · ${sum && !sum.unmapped ? `${sum.available} free · longest block ${sum.longest}` : 'not scanned yet'}\nClick the number to open the seat map`
      : `${s.name}\n+ to track tickets here · click the number to open the seat map`;
  }

  /* The sectors eBileta has dropped, under its own list and in the same
   * shape: + still adds a request there, which is how tickets already bought
   * in a sold-out stand get tracked. */
  let goneList = null;
  function renderGoneList(on, st) {
    const gone = on ? goneSections(st) : [];
    if (!gone.length) { if (goneList) { goneList.remove(); goneList = null; } return; }
    const ul = sections[0].li.parentElement;
    if (!goneList || !goneList.isConnected) {
      goneList = document.createElement('div');
      goneList.className = 'sk-eb-gone';
      ul.parentElement.insertBefore(goneList, ul.nextSibling);
    }
    goneList.textContent = '';
    const head = document.createElement('div');
    head.className = 'sk-eb-gone-head';
    head.textContent = `Removed from the site · ${gone.length} sold-out ${gone.length === 1 ? 'sector' : 'sectors'} kept by Seat Tracker`;
    goneList.append(head);
    gone.sort((a, b) => String(a.code).localeCompare(String(b.code), 'en', { numeric: true }));
    for (const s of gone) {
      const row = document.createElement('div');
      row.className = 'sk-eb-gone-item';
      const name = document.createElement('b');
      name.textContent = s.name || s.code;
      const note = document.createElement('span');
      const p = priceOf(st, s);
      note.textContent = [p ? priceText(p) : 'no price known', s.gone ? `gone ${SK.util.ago(s.gone)}` : ''].filter(Boolean).join(' · ');
      row.append(name, note);
      pill(st, s, null, row);
      goneList.append(row);
    }
  }

  /* ---------------- free seats, sector by sector -------------------- */

  /* A strip between the sector list and the stadium map with every sector's
   * free seats, so no sector has to be opened to see them. The numbers are the
   * last scan's, not what is requested. */
  let freeRow = null;

  function freeRowHost() {
    if (freeRow && freeRow.isConnected) return freeRow;
    const ul = (sections[0] && sections[0].li.parentElement) || null;
    const map = document.querySelector('div.map');
    if (!ul && !map) return null;
    freeRow = document.createElement('div');
    freeRow.className = 'sk-eb-free';
    if (map && map.parentElement) map.parentElement.insertBefore(freeRow, map);
    else ul.parentElement.insertBefore(freeRow, ul.nextSibling);
    return freeRow;
  }

  function renderFreeRow() {
    const st = sidebar.state;
    const show = !!(st && (eventKey || previewOf(st)) && SK.settings.panelOn(st.settings, HOST.id, 'sectors'));
    if (!show) { if (freeRow) { freeRow.remove(); freeRow = null; } return; }
    const host = freeRowHost();
    if (!host) return;
    host.textContent = '';

    const { prices, colorOf } = priceTiers(st);
    if (priceSel && !prices.includes(priceSel)) priceSel = null;
    const shown = allSections(st).filter(s => inPrice(st, s));
    const gone = shown.filter(isRemoved).length;
    const scanned = shown.map(s => summaryFor(st, s.id)).filter(x => x && !x.unmapped);
    const total = scanned.reduce((n, x) => n + x.available, 0);
    const at = scanned.length ? Math.max(...scanned.map(x => x.at || 0)) : 0;
    /* sold-out sectors are never scanned, so counting them as "not scanned yet"
     * would make a fully read event look half done for ever */
    const sellable = shown.filter(s => s.status !== 'soldout').length;
    const shut = shown.length - sellable - gone;
    const tail = `${shut ? ` · ${shut} sold out` : ''}${gone ? ` · ${gone} removed from the site` : ''}`;
    const where = priceSel ? ` at ${SK.profit.formatMoney(priceSel, HOST.currency)}` : priceSel === 0 ? ' with no price' : '';
    const head = document.createElement('div');
    head.className = 'sk-eb-free-head';
    head.textContent = scanned.length
      ? `Free seats${where} · ${total} in ${scanned.length} of ${sellable} sectors on sale${tail} · read ${SK.util.ago(at)}`
      : `Free seats${where} — nothing scanned yet: press Scan all in the sidebar${tail}`;
    host.append(head);

    /* The price groups, as eBileta's own filter had them — but from every
     * sector the event has known, so a group whose sectors the site has
     * all taken away can still be picked. */
    if (prices.length) {
      const bar = document.createElement('div');
      bar.className = 'sk-eb-prices';
      const all = allSections(st);
      const groupBtn = (v, label, n, color) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sk-eb-price-chip' + (priceSel === v ? ' on' : '');
        b.setAttribute('aria-pressed', String(priceSel === v));
        if (color) {
          const dot = document.createElement('i');
          dot.style.background = color;
          b.append(dot);
        }
        b.append(document.createTextNode(label), Object.assign(document.createElement('span'), { textContent: String(n) }));
        b.title = priceSel === v ? 'Show every price again' : `Only the ${n === 1 ? 'sector' : `${n} sectors`} ${v ? `at ${label}` : 'with no price known'}, here and on the map`;
        b.addEventListener('click', e => { e.preventDefault(); pickPrice(v); });
        bar.append(b);
      };
      for (const p of prices) {
        const n = all.filter(s => { const x = priceOf(st, s); return x && Number(x.max) === p; }).length;
        groupBtn(p, SK.profit.formatMoney(p, HOST.currency), n, colorOf(p));
      }
      const none = all.filter(s => !priceOf(st, s)).length;
      if (none) groupBtn(0, 'No price', none, SK.face.NO_PRICE);
      host.append(bar);
    }

    const row = document.createElement('div');
    row.className = 'sk-eb-free-row';
    for (const s of shown) {
      const sum = summaryFor(st, s.id);
      const chip = document.createElement('button');
      chip.type = 'button';
      const { qty, soldout } = infoFor(st, s);
      /* sold out is what the page itself says, so it beats a stale scan and is
       * there before anything has been scanned at all */
      const state = soldout ? 'soldout' : !sum ? 'none' : sum.unmapped ? 'nomap' : sum.available > 0 ? 'free' : 'empty';
      chip.className = `sk-eb-free-chip is-${state}${qty ? ' mine' : ''}${isRemoved(s) ? ' is-gone' : ''}`;
      if (prices.length) {
        const p = priceOf(st, s);
        const dot = document.createElement('i');
        dot.className = 'sk-eb-tier';
        dot.style.background = p ? colorOf(Number(p.max)) : SK.face.NO_PRICE;
        chip.append(dot);
      }
      const code = document.createElement('b');
      code.textContent = s.code || s.name;
      const value = document.createElement('span');
      value.textContent = state === 'soldout' ? '0'
        : state === 'free' || state === 'empty' ? String(sum.available)
          : state === 'nomap' ? 'no map' : '?';
      chip.append(code, value);
      const p = priceOf(st, s);
      chip.title = [s.name,
        p ? priceText(p) : '',
        isRemoved(s) ? `removed from the site${s.gone ? ` ${SK.util.ago(s.gone)}` : ''} — kept for the tickets bought there, no seat page` : '',
        state === 'soldout' && !isRemoved(s) ? 'sold out — the page says so, so it is never scanned' : '',
        state === 'free' || state === 'empty' ? `${sum.available} free of ${sum.total} · longest block ${sum.longest} · read ${SK.util.ago(sum.at)}` : '',
        state === 'nomap' ? 'this sector has no numbered seat map' : '',
        state === 'none' ? 'not scanned yet' : '',
        qty ? `${qty} requested here` : '',
        isRemoved(s) ? '' : 'Click to open the seat map'].filter(Boolean).join('\n');
      chip.addEventListener('click', e => { e.preventDefault(); openSection(s); });
      row.append(chip);
    }
    host.append(row);

    /* what the badges over the map mean, once there are any */
    const legend = document.createElement('div');
    legend.className = 'sk-eb-legend';
    const item = (cls, text, label) => {
      const i = document.createElement('i');
      i.className = 'sk-eb-key ' + cls;
      i.textContent = label;
      const sp = document.createElement('span');
      sp.append(i, document.createTextNode(text));
      legend.append(sp);
    };
    if (both) {
      item('st-OK', 'wanted / free', 'N104|4/12');
      item('st-BOUGHT', 'bought', 'N104|4/12');
      item('is-spare', 'nobody asked', 'W105|0/43');
      item('is-empty', 'nothing free', 'N104|0/0');
    } else {
      item('st-OK', 'wanted here', 'N104|4');
      item('st-BOUGHT', 'bought', 'N104|4');
      item('is-spare', 'free, nobody asked', 'W105|43');
      item('is-empty', 'nothing free', 'N104|0');
    }
    item('is-none', 'not read', '—');
    host.append(legend);
  }

  /* ---------------- badges over the stadium map --------------------- */

  let layer = null;

  /* Off: a badge shows one number, the tickets wanted (or, where nobody asked,
   * the seats free). On: every badge shows both, wanted / free. Remembered on
   * this PC for every eBileta event. */
  (async () => {
    try {
      const { ui: u } = await chrome.storage.local.get('ui');
      both = !!(u && u.ebMapBoth);
      if (both) { scheduleMap(); renderFreeRow(); }
    } catch (e) { /* the default */ }
  })();
  async function setBoth(v) {
    both = v;
    scheduleMap();
    renderFreeRow();
    try {
      const { ui: u } = await chrome.storage.local.get('ui');
      await chrome.storage.local.set({ ui: Object.assign({}, u || {}, { ebMapBoth: v }) });
    } catch (e) { /* cosmetic */ }
  }

  /* the switch, in the map's top-left corner */
  function mapToggle() {
    let t = layer.querySelector(':scope > .sk-eb-map-toggle');
    if (!t) {
      t = document.createElement('button');
      t.type = 'button';
      t.className = 'sk-eb-map-toggle';
      t.setAttribute('role', 'switch');
      t.append(Object.assign(document.createElement('i'), { className: 'sk-eb-switch' }), document.createTextNode('Wanted / free'));
      t.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setBoth(!both); });
      layer.prepend(t);
    }
    t.classList.toggle('on', both);
    t.setAttribute('aria-checked', String(both));
    t.title = both
      ? 'Badges show the tickets wanted / the seats free. Click for one number'
      : 'Show the tickets wanted and the seats free on every badge';
  }

  function mapHost() {
    const svg = document.querySelector('div.map svg') || document.querySelector('svg');
    if (!svg) return null;
    const host = svg.closest('div.map') || svg.parentElement;
    if (!host) return null;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    if (!layer || !layer.isConnected) {
      layer = document.createElement('div');
      layer.className = 'sk-eb-map-layer';
      host.appendChild(layer);
    }
    return { svg, host };
  }

  /* the map's shape for a sector, and the sector a shape is */
  const isPolyOf = (p, s) => p.getAttribute('artacom:id') === s.id || p.getAttribute('id') === s.id || p.getAttribute('artacom:descr') === s.name
    || p.getAttribute('data-sk-sec') === s.id;

  /* Removed sectors on the map. eBileta takes a sector's polygon away with
   * it, while the stadium picture under the polygons still shows the stand:
   * the outline kept with the sector goes back in its place, so its badge,
   * tooltip and price outline sit where they always did. Only the link to a
   * seat page is gone — the page has none for it any more. */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function ghostPolygons(svg, st) {
    const vb = EB.cleanPoints(svg.getAttribute('viewBox'));
    const real = [...svg.querySelectorAll('polygon:not(.sk-eb-ghost)')];
    const want = new Map();
    for (const s of eventKey ? goneSections(st) : []) {
      if (!s.shape || !s.shape.points) continue;
      if (s.shape.vb && vb && s.shape.vb !== vb) continue;              // drawn for another picture
      if (real.some(p => isPolyOf(p, s))) continue;                      // the page still has it
      want.set(s.id, s);
    }
    for (const g of svg.querySelectorAll('polygon.sk-eb-ghost')) {
      if (!want.has(g.getAttribute('data-sk-sec'))) g.remove();
    }
    /* where the page keeps its own polygons: beside them, over the picture */
    const first = real[0];
    const parent = !first ? svg : first.parentNode.nodeName.toLowerCase() === 'a' ? first.parentNode.parentNode : first.parentNode;
    for (const [id, s] of want) {
      let g = svg.querySelector(`polygon.sk-eb-ghost[data-sk-sec="${id}"]`);
      if (!g) {
        g = document.createElementNS(SVG_NS, 'polygon');
        g.setAttribute('class', 'sk-eb-ghost');
        g.setAttribute('data-sk-sec', id);
        parent.appendChild(g);
      }
      if (g.getAttribute('points') !== s.shape.points) g.setAttribute('points', s.shape.points);
    }
  }
  const sectionOfPoly = p => allSections(sidebar.state).find(s => isPolyOf(p, s)) || null;

  /* A price group picked above the strip: its sectors outlined in its color,
   * every other one faded — the removed ones too, the map still draws them. */
  function paintPrices(svg) {
    const st = sidebar.state;
    const all = allSections(st);
    const { colorOf } = priceTiers(st);
    const color = priceSel ? colorOf(priceSel) : SK.face.NO_PRICE;
    for (const poly of svg.querySelectorAll('polygon')) {
      const s = priceSel === null ? null : all.find(x => isPolyOf(poly, x));
      const pick = !!(s && inPrice(st, s));
      poly.classList.toggle('sk-eb-dim', priceSel !== null && !pick);
      poly.classList.toggle('sk-eb-pick', pick);
      if (pick) poly.style.setProperty('--sk-tier', color);
      else poly.style.removeProperty('--sk-tier');
    }
  }

  /* ---------------- the tooltip over the map ------------------------ */

  function tipLines(s) {
    const st = sidebar.state;
    const { sum, soldout } = infoFor(st, s);
    const box = document.createDocumentFragment();
    const line = (cls, ...parts) => {
      const d = document.createElement('div');
      d.className = cls;
      d.append(...parts);
      box.append(d);
      return d;
    };
    const b = t => Object.assign(document.createElement('b'), { textContent: t });
    const m = t => Object.assign(document.createElement('span'), { className: 'm', textContent: t });
    line('sk-tip-head', b(s.code || s.name), s.code && s.code !== s.name ? m(s.name) : '');
    const p = priceOf(st, s);
    if (p) line('sk-tip-seats', m(priceText(p)));
    if (isRemoved(s)) line('sk-tip-seats', 'Removed from the site', s.gone ? m(` · ${SK.util.ago(s.gone)}`) : '');
    else if (soldout && !(sum && !sum.unmapped && sum.available > 0)) line('sk-tip-seats', 'Sold out, says the page');
    else if (!sum) line('sk-tip-seats', 'Not read yet', m(' · Scan all in the sidebar'));
    else if (sum.unmapped) line('sk-tip-seats', 'No numbered seat map');
    else line('sk-tip-seats', b(String(sum.available)), ` of ${sum.total} seats free`,
      sum.available > 0 && sum.longest ? m(` · longest block ${sum.longest}`) : '', sum.at ? m(` · read ${SK.util.ago(sum.at)}`) : '');

    const mine = eventKey && st ? st.requests.filter(r => r.eventKey === eventKey && !r.done && String(r.sec) === s.id) : [];
    for (const r of mine) {
      const dot = Object.assign(document.createElement('i'), { className: 'sk-tip-dot ' + ui.statusClass(r.eval.status) });
      const what = r.eval.status === 'BOUGHT' ? 'bought'
        : r.eval.status === 'NOT SCANNED' ? 'not scanned yet'
          : SK.util.plural(r.eval.options, 'option') + (r.together === false ? ' (any seats)' : '');
      line('sk-tip-req', dot, b(`#${r.num}`), ` ${SK.util.plural(r.qty, 'ticket')} · `, b(what));
    }
    if (mine.length > 1) line('sk-tip-seats', m(`${mine.reduce((n, r) => n + r.qty, 0)} tickets wanted in all`));
    return box;
  }

  let tipFor = null;
  function showTip(s, x, y) {
    const st = sidebar.state;
    if (!st || !(eventKey || previewOf(st))) return hideTip();
    const m = mapHost();
    if (!m) return;
    let tip = layer.querySelector(':scope > .sk-eb-map-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'sk-eb-map-tip';
      tip.setAttribute('role', 'tooltip');
      layer.append(tip);
    }
    if (tipFor !== s.id || !tip.childNodes.length) {
      tip.textContent = '';
      tip.append(tipLines(s));
      tipFor = s.id;
    }
    tip.hidden = false;
    /* beside the pointer, flipped to the other side near the map's edges */
    const r = m.host.getBoundingClientRect();
    let left = x - r.left + 14, top = y - r.top + 14;
    if (left + tip.offsetWidth > m.host.clientWidth) left = x - r.left - tip.offsetWidth - 14;
    if (top + tip.offsetHeight > m.host.clientHeight) top = y - r.top - tip.offsetHeight - 14;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = Math.max(0, top) + 'px';
  }
  function hideTip() {
    tipFor = null;
    const tip = layer && layer.querySelector(':scope > .sk-eb-map-tip');
    if (tip) tip.hidden = true;
  }

  function renderMapBadges() {
    const svg = document.querySelector('div.map svg') || document.querySelector('svg');
    if (svg) { ghostPolygons(svg, sidebar.state); paintPrices(svg); }
    if (!badgesOn()) { if (layer) layer.textContent = ''; return; }
    const m = mapHost();
    if (!m) return;
    mapToggle();
    const st = sidebar.state;
    const polys = [...m.svg.querySelectorAll('polygon')];
    const hostRect = m.host.getBoundingClientRect();
    const seen = new Set();

    for (const s of allSections(st).filter(x => inPrice(st, x))) {
      const { qty, status, sum, soldout } = infoFor(st, s);
      /* Three things the map can say, and one it cannot:
       *   wanted here   the tickets you are after, coloured by their status
       *   free here     a sector that was read and has seats, but nobody has
       *                 asked for any — the number is what is free, not wanted
       *   nothing here  sold out, which eBileta prints above the map itself,
       *                 or read and empty
       * A sector nobody has read stays bare: there is nothing true to say. */
      const empty = !qty && (soldout || (sum && !sum.unmapped && sum.available === 0));
      const spare = !qty && !empty && sum && !sum.unmapped && sum.available > 0;
      let node = layer.querySelector(`[data-sec="${s.id}"]`);
      if (!qty && !empty && !spare) { if (node) node.remove(); continue; }
      const poly = polys.find(p => isPolyOf(p, s));
      if (!poly) continue;
      if (!node) {
        node = document.createElement('button');
        node.type = 'button';
        node.dataset.sec = s.id;
        node.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openSection(s); });
        node.addEventListener('pointermove', e => showTip(s, e.clientX, e.clientY));
        node.addEventListener('pointerleave', hideTip);
        layer.appendChild(node);
      }
      seen.add(s.id);
      const r = poly.getBoundingClientRect();
      node.style.left = (r.left - hostRect.left + r.width / 2) + 'px';
      node.style.top = (r.top - hostRect.top + r.height / 2) + 'px';
      node.className = `sk-eb-map-badge ${empty ? 'is-empty' : spare ? 'is-spare' : status ? ui.statusClass(status) : ''}${isRemoved(s) ? ' is-gone' : ''}`;
      /* "VERI A | 4": the sector's short name, then how many are wanted there */
      node.textContent = '';
      const name = document.createElement('span');
      name.className = 'sk-eb-map-name';
      name.textContent = s.code || s.name;
      const sep = document.createElement('span');
      sep.className = 'sk-eb-map-sep';
      sep.textContent = '|';
      const count = document.createElement('span');
      count.className = 'sk-eb-map-qty';
      node.append(name, sep, count);
      /* the seats free: what the last read found, 0 when the page says sold out */
      const free = sum && !sum.unmapped ? sum.available : soldout ? 0 : null;
      const go = isRemoved(s) ? 'no seat page, eBileta removed it' : 'click to open the seat map';
      if (both) {
        count.textContent = String(qty);
        const f = document.createElement('span');
        f.className = 'sk-eb-map-free';
        f.textContent = `/${free === null ? '?' : free}`;
        node.append(f);
        node.classList.add('both');
        node.setAttribute('aria-label', `${s.name} — ${qty} requested · ${free === null ? 'not read yet' : `${free} free`} · ${go}`);
        continue;
      }
      count.textContent = String(empty ? 0 : spare ? sum.available : qty);
      node.setAttribute('aria-label', empty
        ? `${s.name} — ${isRemoved(s) ? 'removed from eBileta' : soldout ? 'sold out, says the page' : 'read, nothing free'} · ${go}`
        : spare
          ? `${s.name} — ${sum.available} free, nobody has asked for any · longest block ${sum.longest} · ${go}`
          : `${s.name} — ${qty} requested · ${go}`);
    }
    layer.querySelectorAll('[data-sec]').forEach(n => { if (!seen.has(n.dataset.sec)) n.remove(); });
  }

  let raf = 0;
  function scheduleMap() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(renderMapBadges);
  }
  window.addEventListener('resize', scheduleMap, { passive: true });
  window.addEventListener('scroll', scheduleMap, { passive: true });
  const mapSvg = document.querySelector('div.map svg');
  if (mapSvg) new MutationObserver(scheduleMap).observe(mapSvg, { attributes: true, subtree: true, attributeFilter: ['transform', 'viewBox', 'width', 'height'] });
  /* every sector of the map, badged or not, says what it has on hover */
  if (mapSvg) {
    mapSvg.addEventListener('pointermove', e => {
      const p = e.target instanceof Element && e.target.closest('polygon');
      const sec = p && sectionOfPoly(p);
      if (sec) showTip(sec, e.clientX, e.clientY); else hideTip();
    });
    mapSvg.addEventListener('pointerleave', hideTip);
  }

  /* ---------------- link the page to its event ---------------------- */

  /* only look the event up; pills and map badges appear once it is tracked */
  ui.send('lookupPage', { url: pageUrl, site: HOST.id, idSM })
    .then(res => { eventKey = res ? res.key : null; sidebar.setEventKey(eventKey); renderFreeRow(); })
    .catch(() => {});
})();
