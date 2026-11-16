/* ------------------------------------------------------------------
 * Seat Tracker on eBileta's seat page (scegliPostoPub.do)
 * The page already carries every seat, so it is read here, saved as a
 * scan, and shown in the sidebar's sector card: free / taken / longest
 * block and the "blocks of at least N" list. Clicking a block outlines
 * its seats on the map. The sidebar collapses like on every other page.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK || !SK.shell || window.__skEbSeats) return;
  const HOST = SK.ebileta.hostOf(location.hostname);
  if (!HOST) return;
  const params = new URLSearchParams(location.search);
  const idSett = params.get('idSett');
  const idSM = params.get('idSM');
  if (!idSett) return;
  window.__skEbSeats = true;

  const ui = SK.ui;
  const ACT = SK.ebAct || null;
  const parsed = SK.ebileta.parseSeats(document.documentElement.innerHTML, HOST.currency);
  if (!parsed.seats.length) return;

  const seats = parsed.seats.map(s => ({ row: s.row, label: s.seat, x: s.x, y: s.y, free: s.free, cat: s.rate, id: s.id }));
  /* eBileta writes each seat's full description into its own map, and the cart
   * shows exactly that string — so it is what says whether a seat is held */
  const descrById = new Map(parsed.seats.map(s => [String(s.id), s.descr || '']));
  const localScan = SK.rules.packScan(idSett, seats, 'x');
  const byId = new Map(parsed.seats.map(s => [String(s.id), s]));
  /* eBileta names the open sector in the page heading — "TRIBUNA S104" —
   * which is more dependable than reading it back off a seat description. */
  const headingName = (() => {
    const h2 = document.querySelector('#titolo h2');
    return h2 ? h2.textContent.replace(/\s+/g, ' ').trim() : '';
  })();
  const sectionName = headingName || parsed.section || '';
  const view = { minBlock: null, cats: [], selected: null };
  /* what the standalone Hold box is set to, kept across re-renders */
  let holdQty = null;

  /* the page draws each seat as <g><rect x y></g>; match them by position */
  const nodes = new Map();
  const posKey = (x, y) => Math.round(x) + ',' + Math.round(y);
  document.querySelectorAll('#viewport > g, svg g[cursor]').forEach(g => {
    const r = g.querySelector('rect');
    if (r) nodes.set(posKey(parseFloat(r.getAttribute('x')), parseFloat(r.getAttribute('y'))), g);
  });

  const NS = 'http://www.w3.org/2000/svg';
  let hl = null;

  function clearHighlight() {
    if (hl) { hl.remove(); hl = null; }
  }

  function highlight(ids) {
    clearHighlight();
    const svg = document.querySelector('svg#map') || document.querySelector('svg');
    const host = svg && (svg.querySelector('#viewport') || svg);
    if (!host) return;
    hl = document.createElementNS(NS, 'g');
    for (const id of ids) {
      const s = byId.get(String(id));
      const g = s && nodes.get(posKey(s.x, s.y));
      const r = g && g.querySelector('rect');
      if (!r) continue;
      const box = document.createElementNS(NS, 'rect');
      box.setAttribute('x', parseFloat(r.getAttribute('x')) - 2);
      box.setAttribute('y', parseFloat(r.getAttribute('y')) - 2);
      box.setAttribute('width', parseFloat(r.getAttribute('width')) + 4);
      box.setAttribute('height', parseFloat(r.getAttribute('height')) + 4);
      box.setAttribute('rx', '2');
      box.setAttribute('class', 'sk-hl');
      hl.appendChild(box);
    }
    host.appendChild(hl);
  }

  /* ---------------- holding seats ---------------------------------- */

  const nodeFor = id => {
    const s = byId.get(String(id));
    return s ? nodes.get(posKey(s.x, s.y)) : null;
  };
  const seatInfo = id => ({ id: String(id), descr: descrById.get(String(id)) || '' });

  const actState = () => {
    const st = sidebar && sidebar.state;
    if (!ACT) return { can: false, why: 'This page cannot hold seats.' };
    return { can: ACT.canAct(st && st.settings), why: ACT.why(st && st.settings) };
  };

  /* Clicking a seat in a block holds it. One at a time, checking the cart
   * after each, because eBileta's own handler toggles: clicking a seat that
   * is already held gives it back. */
  async function hold(ids, label) {
    const { can, why } = actState();
    if (!can) { sidebar.ctx.notice(why, true); return { taken: 0, stopped: why }; }
    let taken = 0;
    for (const id of ids) {
      const seat = seatInfo(id);
      const r = await ACT.selectSeat(nodeFor(id), seat, { why: label });
      if (!r.ok) {
        sidebar.render();
        sidebar.ctx.notice(`Stopped after ${taken}: ${r.reason}`, true);
        return { taken, stopped: r.reason };
      }
      taken++;
      sidebar.render();
    }
    return { taken, stopped: '' };
  }

  /* Reserve: the best run of `qty` seats next to each other. The shortest
   * block that still fits wins, so a run of six is not spent on a pair. */
  function bestBlock(qty) {
    const v = SK.rules.blocksFor(localScan, view.cats);
    const runs = ((v && v.blocks) || []).filter(b => b.len >= qty);
    if (!runs.length) return null;
    runs.sort((a, b) => a.len - b.len || String(a.row).localeCompare(String(b.row), 'en', { numeric: true }));
    return runs[0];
  }

  async function reserve(qty, label) {
    const block = bestBlock(qty);
    if (!block) { sidebar.ctx.notice(`No run of ${qty} seats next to each other in this sector.`, true); return; }
    const ids = block.seats.slice(0, qty);
    highlight(ids);
    const r = await hold(ids, label || `reserve ${qty}`);
    if (r.taken === qty) {
      sidebar.ctx.notice(`${qty} seats held in row ${block.row}. Check the cart below the map and finish on eBileta yourself.`);
    }
    sidebar.render();
  }

  const sidebar = SK.shell.create({
    site: HOST.id,
    pageKey: 'seats',
    slotFirst: true,
    title: () => sectionName || 'Sector',
    pinSector: idSett,
    canReserve: () => actState().can,
    /* A request for another sector is not this sector's to fill. Send the
     * reserve to that sector's own page instead of quietly holding the wrong
     * seats here — which is exactly what it used to do. */
    onReserve: (r, qty) => {
      const n = Math.max(1, Number(qty) || r.qty);
      if (String(r.sec) === String(idSett)) return reserve(n, `request #${r.num}`);
      const ev = ui.eventOf(sidebar.state, r.eventKey);
      const sec = ui.sectorIn(ev, r.sec);
      if (!sec || !sec.url) { sidebar.ctx.notice(`#${r.num} is for ${r.code}, and that sector has no seat page here.`, true); return; }
      const { can, why } = actState();
      if (!can) { sidebar.ctx.notice(why, true); return; }
      sidebar.ctx.notice(`#${r.num} is for ${r.code} — opening it to hold ${n}.`);
      ACT.leaveTicket({ sectorId: String(r.sec), qty: n, label: `request #${r.num}` });
      location.href = sec.url;
    },
    renderSlot(slot, ctx, ev) {
      slot.append(cartStrip(ctx));
      slot.append(holdBox(ctx, ev));
      slot.append(ui.sectorCard(ctx, {
        eventKey: ev ? ev.key : null,
        secId: idSett, view, localScan,
        title: SK.ebileta.shortCode(sectionName) || 'Sector',
        onBlock: b => highlight(b.seats),
        onClear: clearHighlight,
        onHold: actState().can ? (b, n) => hold(b.seats.slice(0, n || b.seats.length), 'block') : null
      }));
      if (!ev) slot.append(ui.el('p', 'note', 'This sector\'s event is not tracked. Open the event\'s sector list and press "Track this event" to add requests and get alerts.'));
    }
  });

  /* ---------------- holding seats with no request ------------------- */

  /* Sometimes you just want seats here — a walk-up buyer, a sector nobody has
   * a request for yet. This holds any number in the open sector without one,
   * by the same rule as everything else: the shortest run that still fits. */
  function holdBox(ctx, ev) {
    const box = ui.el('div', 'track-card');
    const head = ui.el('div', 'top');
    head.append(ui.el('strong', null, `Hold seats in ${SK.ebileta.shortCode(sectionName) || 'this sector'}`));
    box.append(head);

    if (holdQty === null) {
      /* start at what is already wanted here, else a sensible pair */
      const mine = ev ? (ctx.state.requests || []).filter(r => r.eventKey === ev.key && !r.done && String(r.sec) === String(idSett)) : [];
      holdQty = mine.length ? Math.max(...mine.map(r => r.qty)) : 2;
    }

    const { can, why } = actState();
    const row = ui.el('div', 'reserve-line');
    const qty = ui.el('input');
    qty.type = 'number';
    qty.min = '1';
    qty.value = String(holdQty);
    qty.title = 'How many seats next to each other to hold';
    qty.addEventListener('input', () => { holdQty = Math.max(1, parseInt(qty.value, 10) || 1); });
    const go = ui.button('Reserve', 'mini primary', () => {
      const n = Math.max(1, parseInt(qty.value, 10) || 1);
      holdQty = n;
      reserve(n, 'no request');
    }, `Hold ${holdQty} seats next to each other here — nothing is bought, you finish on eBileta`);
    go.disabled = !can;
    row.append(ui.el('span', 'buylabel', 'Seats'), qty, go);
    box.append(row);

    if (!can) box.append(ui.el('p', 'note', why));
    else {
      const v = SK.rules.blocksFor(localScan, view.cats);
      box.append(ui.el('p', 'note', v && v.longest
        ? `Longest run free here: ${v.longest}. The shortest run that still fits is taken, so a long one is not spent on a few seats.`
        : 'Nothing free in this sector right now.'));
    }
    return box;
  }

  /* ---------------- what is in the cart ----------------------------- */

  function cartStrip(ctx) {
    const box = ui.el('div', 'track-card');
    const rows = ACT ? ACT.readCart() : [];
    const head = ui.el('div', 'top');
    head.append(ui.el('strong', null, rows.length ? `${SK.util.plural(rows.length, 'seat')} held` : 'Nothing held'));
    head.append(ui.el('span', 'spacer'));
    if (rows.length) {
      const empty = ui.button('Give them back', 'mini danger', () => ui.busy(empty, async () => {
        const n = await ACT.emptyCart();
        ctx.notice(`Released ${SK.util.plural(n, 'seat')}.`);
        sidebar.render();
      }, ctx), 'Press eBileta\'s own Delete on every held seat');
      head.append(empty);
    }
    box.append(head);

    if (!rows.length) {
      const { can, why } = actState();
      box.append(ui.el('p', 'note', can
        ? 'Click a seat on the map, or press Reserve on a request, to hold seats. Seat Tracker never buys anything — you finish on eBileta.'
        : why));
      return box;
    }
    for (const r of rows) {
      box.append(ui.el('div', 'detail', [r.descr, r.rate, r.total].filter(Boolean).join(' · ')));
    }
    if (ACT.cartSplit()) box.append(ui.el('p', 'vg-why warn', 'eBileta says these seats are not all next to each other.'));
    box.append(ui.el('p', 'note', 'Auto-scans of this event are paused on this PC while seats are held — they would read as taken.'));
    return box;
  }

  /* the section's price block, as shown: "Rates from Lekë1,045.00 to Lekë1,045.00" (euro on eu.ebileta.al) */
  const priceText = [...document.querySelectorAll('.tabprezzi .prezzi, .prezzi')].map(n => n.textContent).join(' ');
  const price = SK.profit ? SK.profit.priceRange(priceText, HOST.currency) : null;

  /* the name too: a sector eBileta has dropped from the event page is put
   * back on its event from here */
  ui.send('pageScan', { site: HOST.id, sectorId: idSett, idSM, seats, price, name: sectionName, tipoM: params.get('tipoM') || '1' })
    .then(res => { if (res && res.eventKey) sidebar.setEventKey(res.eventKey); })
    .catch(() => {});

  /* A Reserve pressed on another page left a ticket behind. It is spent the
   * moment it is read, and only this tab could have written it. */
  /* The popup cannot write this tab's sessionStorage, so a Reserve pressed
   * there asks in the address instead. It is honoured on the same terms as
   * everything else: only while you have switched selecting on, and only
   * while you are logged in. */
  const asked = (/[#&]sk-reserve=(\d{1,3})/.exec(location.hash) || [])[1];
  if (asked) {
    history.replaceState(null, '', location.pathname + location.search);
    if (ACT) ACT.leaveTicket({ sectorId: idSett, qty: Number(asked), label: 'from the extension' });
  }
  const ticket = ACT ? ACT.takeTicket() : null;
  if (ticket && String(ticket.sectorId) === String(idSett) && ticket.qty > 0) {
    const wait = setInterval(() => {
      if (!ui.alive()) return clearInterval(wait);
      if (!sidebar.state) return;
      clearInterval(wait);
      sidebar.open();
      reserve(Number(ticket.qty), ticket.label || 'reserve');
    }, 250);
  }

  /* tell this PC whether seats are being held here, so its own scans of this
   * event stand aside rather than reading held seats as sold */
  function reportCart() {
    if (!ACT) return;
    const held = ACT.readCart().length;
    ui.send('cartHold', { site: HOST.id, idSM, sectorId: idSett, held }).catch(() => {});
  }
  reportCart();
  setInterval(() => { if (ui.alive()) reportCart(); }, 15000);
  new MutationObserver(() => { sidebar.render(); reportCart(); })
    .observe(document.body, { childList: true, subtree: true });
})();
