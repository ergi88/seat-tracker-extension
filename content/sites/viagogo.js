/* ------------------------------------------------------------------
 * Seat Tracker - viagogo "Listing confirmed" page
 *
 * Reads the listing that was just created and fills Add a request with
 * it: the event (matched by date and name, then remembered), the tickets,
 * the section and the listing ID. Nothing is added until Add is pressed.
 *
 * On my.viagogo.com/listings it reads every listing card (price, payout,
 * tickets left, section, performance), saves them for their owner, adds a
 * one-line Seat Tracker summary to each card (request, status, profit in lek,
 * win rate) and lists them in the sidebar; a card without a request can be
 * added from there. Nothing on viagogo is ever clicked.
 *
 * viagogo's pages are apps, so a page can change without reloading: the
 * script follows the address and shows the sidebar only on those two pages.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  const SK = globalThis.SK;
  if (!SK || !SK.ui || !SK.shell || !SK.viagogo) return;
  const ui = SK.ui;
  const VG = SK.viagogo;

  let sidebar = null, observer = null, readTimer = null;
  let listings = [];
  let chosen = 0;          // which listing the form follows when the page shows several
  let filledFor = '';      // the listing ID last written into the form
  let pick = null;         // how the event was chosen: { key, how } or null
  let mode = null;         // 'confirmed' | 'listings'
  let cards = [];          // listings page: [{ data, el }] in page order
  let adding = null;       // listings page: the listing whose "Add as request" form is open
  let saveTimer = null, lastSent = '', saveError = '';
  let expiryTimer = null;
  let sellDetails = null;  // price step: what the listing being made shows (event, date, tickets, section)
  let sellPick = '';       // price step: the event picked by hand when none matched

  /* ---------------- filling the form ------------------------------ */

  function fill(ctx, l) {
    const st = ctx.state;
    pick = VG.pickEvent(l, st.events.filter(e => !e.archived));
    const d = ctx.addDraft || {};
    /* keep what was typed by hand (client, warns); replace what the listing says */
    ctx.addDraft = Object.assign({ warn: '', opts: '', client: '', together: null }, d, {
      eventKey: pick ? pick.key : '',
      qty: String(l.qty || d.qty || 2),
      listing: l.listing,
      sec: '',
      cats: [],
      prefill: { section: l.section, key: VG.listingKey(l), forEvent: null, how: '' }
    });
    filledFor = l.listing;
  }

  /* match the section again when the event changes, or when its sectors arrive */
  function syncSector(ctx) {
    const d = ctx.addDraft;
    if (!d || !d.prefill) return;
    const ev = ui.eventOf(ctx.state, d.eventKey);
    const evKey = ev ? ev.key : '';
    const arrived = d.prefill.how === 'waiting' && ev && ev.sectors.length;
    if (d.prefill.forEvent === evKey && !arrived) return;
    const r = VG.sectorFor(ev, d.prefill.section);
    Object.assign(d, { sec: r.code, cats: [] });
    Object.assign(d.prefill, { forEvent: evKey, how: r.how });
  }

  function eventWhy(st, d, l) {
    const ev = ui.eventOf(st, d.eventKey);
    if (ev && pick && pick.key === ev.key) {
      return { text: pick.how === 'remembered' ? 'Event: remembered from an earlier listing.' : `Event: matched by ${pick.how}.` };
    }
    if (ev) return { text: 'Event: your pick — remembered for this listing\'s event when you add.' };
    const untracked = VG.pickEvent(l, st.catalog.map(c => ({ key: `${c.siteLabel}: "${c.title}"`, title: c.title, date: c.date })));
    return {
      warn: true,
      text: untracked
        ? `Pick the event. It looks like ${untracked.key}, which is not tracked yet — pick it in the list to track it.`
        : 'Pick the event: no tracked event matches this listing\'s date and name.'
    };
  }

  function sectorWhy(d) {
    const p = d.prefill;
    if (!p.section) return { warn: true, text: 'This listing shows no section.' };
    switch (p.how) {
      case 'remembered': return { text: `Section ${p.section} → ${d.sec}, remembered.` };
      case 'matched': return { text: `Section ${p.section} → ${d.sec}.` };
      case 'pick': return { warn: true, text: `Section ${p.section} has no sector with that name here — pick it from the list, already filtered by "${d.sec}".` };
      case 'waiting': return { warn: true, text: `Section ${p.section}: the event's sectors are still loading.` };
      default: return { text: `Section ${p.section} is matched once the event is picked.` };
    }
  }

  async function learn(req, ev, d) {
    if (!d.prefill || !ev) return;
    await ui.send('learnViagogo', { eventKey: ev.key, key: d.prefill.key, section: d.prefill.section, sectorId: req && req.sec });
  }

  /* ---------------- the sidebar ----------------------------------- */

  function renderConfirmed(slot, ctx) {
    const st = ctx.state;
    const box = ui.el('div', 'track-card vg-found');
    slot.append(box);

    const l = listings[chosen];
    if (!l) {
      box.append(ui.el('strong', null, 'Reading the listing…'), ui.el('p', 'note', 'Waiting for viagogo to show the listing ID.'));
      return;
    }

    if (listings.length > 1) {
      const row = ui.el('div', 'vg-row');
      listings.forEach((x, i) => {
        row.append(ui.button(`${x.qty || '?'} × ${x.section || '?'}`, i === chosen ? 'mini primary' : 'mini',
          () => { chosen = i; filledFor = ''; ctx.rerender(); }, `Listing ${x.listing}`));
      });
      box.append(row);
    }

    box.append(ui.el('strong', null, 'Found on this page'));
    box.append(ui.el('div', 'vg-facts', [
      `${l.qty || '?'} ticket${l.qty === 1 ? '' : 's'}`,
      l.section ? `Section ${l.section}` : 'no section',
      `Listing ${l.listing}`
    ].join(' · ')));
    box.append(ui.el('p', 'vg-why', [l.title, l.when].filter(Boolean).join(' · ')));

    /* landing on the confirmation again must not add the listing twice */
    const dup = st.requests.find(r => r.listing && String(r.listing) === String(l.listing));
    if (dup) {
      const ev = ui.eventOf(st, dup.eventKey);
      box.append(ui.el('p', 'vg-why warn', `Already added as #${dup.num}${ev ? ` in [${ev.num}] ${ev.title}` : ''}${dup.done ? ' (done)' : ''}.`));
      return;
    }

    if (filledFor !== l.listing) fill(ctx, l);
    syncSector(ctx);
    const d = ctx.addDraft;
    for (const why of [eventWhy(st, d, l), sectorWhy(d)]) box.append(ui.el('p', 'vg-why' + (why.warn ? ' warn' : ''), why.text));
    box.append(ui.button('Fill again', 'mini', () => { fill(ctx, l); ctx.rerender(); }, 'Put this listing back into the form'));

    const add = ui.el('div', 'vg-add');
    const head = ui.el('div', 'sk-section-title');
    head.append(ui.el('span', null, 'Add a request'), ui.el('span', 'spacer'), ui.helpButton('requests', () => slot.getRootNode().querySelector('.sk-panel')));
    add.append(head, ui.addForm(ctx, {
      emptyEvent: true,
      onEventChange() { /* syncSector matches the section for the new event on the next render */ },
      onAdded: learn
    }));
    slot.append(add);
  }

  /* ---------------- reading every listing --------------------------- */
  /*
   * The listings page loads its list from viagogo's own JSON endpoint,
   * /listings/getListings (SK.viagogo.listingsApiUrl), with your cookies and
   * nothing else. Reading it gives every listing in every status — active,
   * pending, deactivated, expired — in a few requests, without turning a page
   * or clicking anything. Everything read is saved as one complete read and compared with what was stored: a listing that is no
   * longer on viagogo in any status is reported, never rewritten.
   */

  const API_PAGE = 100;
  const API_GAP = 500;                 // between two requests, plus up to 0.3 s

  let session = null;   // { on, phase, pages, read, total, complete, report, error, stop, at }

  /* viagogo's JSON is at /listings/…, /sales/…; should it have moved under the
   * page's locale too (/ww/listings/…), a 404 is asked once more there */
  async function vgFetch(path) {
    const opts = { credentials: 'include', headers: { Accept: 'application/json' } };
    const res = await fetch(path, opts);
    const loc = VG.localeOf(location.pathname);
    return res.status === 404 && loc ? fetch(loc + path, opts) : res;
  }

  async function getJson(url) {
    const res = await vgFetch(url);
    if (res.status === 401 || res.status === 403) throw new Error('viagogo says you are signed out — sign in on viagogo and scan again.');
    if (!res.ok) throw new Error(`viagogo answered ${res.status} for your listings — try again in a moment.`);
    return res.json();
  }

  const apiGap = ms => SK.util.sleep((ms || API_GAP) + Math.round(Math.random() * 300));
  const sessionDraw = () => { if (sidebar) sidebar.render(); };

  async function startSession(ctx) {
    if (session && session.on) return;
    session = { on: true, phase: 'list', pages: 0, read: 0, total: null, complete: false, report: null, error: '', stop: false, at: Date.now() };
    sessionDraw();
    const items = new Map();
    try {
      for (let page = 1; page <= 200; page++) {
        if (session.stop) break;
        const json = await getJson(VG.listingsApiUrl(page, API_PAGE));
        const list = VG.apiList(json);
        if (session.total === null) session.total = VG.apiTotal(json);
        for (const x of list) {
          const it = VG.listingFromApi(x);
          if (it) items.set(it.id, it);
        }
        session.pages = page;
        session.read = items.size;
        sessionDraw();
        if (!list.length || list.length < API_PAGE || (session.total !== null && items.size >= session.total)) break;
        await apiGap();
      }
      session.complete = !session.stop && (session.total === null || items.size >= session.total);

      session.phase = 'save';
      sessionDraw();
      session.report = await ui.send('sweepListings', { items: [...items.values()], complete: session.complete, partial: true });
      session.error = '';
    } catch (e) {
      session.error = e.message;
    }
    session.on = false;
    if (sidebar) { sidebar.render(); sidebar.refresh(true); }
  }

  function sessionBox(ctx) {
    if (!session) return null;
    const box = ui.el('div', 'track-card sweep');
    const head = ui.el('div', 'top');
    head.append(ui.el('strong', null, session.on ? 'Reading all your listings' : 'All listings read'));
    head.append(ui.el('span', 'spacer'));
    if (!session.on) head.append(ui.button('✕', 'ghost mini', () => { session = null; ctx.rerender(); }, 'Hide this'));
    box.append(head);

    if (session.on) {
      const of = session.total !== null ? ` of ${session.total}` : '';
      box.append(ui.el('p', 'note',
        session.phase === 'list' ? `Listings · ${session.read}${of} read` : `${session.read} listings read · saving…`));
      const row = ui.el('div', 'row-acts');
      const stop = ui.button('Stop', 'ghost mini', () => { session.stop = true; sessionDraw(); },
        'Stop here — what was read so far is still saved');
      if (session.stop || session.phase === 'save') stop.disabled = true;
      row.append(stop);
      box.append(row);
      box.append(ui.el('p', 'note', 'Read from viagogo\'s own list of your listings, every status at once. Nothing on viagogo is clicked or changed.'));
      return box;
    }

    if (session.error) { box.append(ui.el('p', 'vg-why warn', session.error)); return box; }
    const r = session.report || { read: 0, changes: [], unseen: [], qtyOffers: [], sold: [] };
    const money = (v, c) => (v === null || v === undefined ? '—' : P.formatMoney(v, c));
    const line = (tag, cls, text, extra) => {
      const row = ui.el('div', 'sweep-line');
      row.append(ui.el('span', 'sweep-tag ' + cls, tag), ui.el('span', null, text));
      if (extra) row.append(extra);
      box.append(row);
    };

    for (const c of r.changes) {
      if (c.kind === 'new') line('added', 'new', `${c.section || '?'} ${c.id} · ${c.title || 'unknown event'}`);
      else if (c.kind === 'price') line('price', 'price', `${c.section || '?'} ${c.id} · ${money(c.from, c.currency)} → ${money(c.to, c.currency)}`);
      else if (c.kind === 'tickets') line('qty', 'qty', `${c.section || '?'} ${c.id} · ${c.from} → ${c.to} tickets`);
      else if (c.kind === 'status') line('status', 'qty', `${c.section || '?'} ${c.id} · ${c.from || 'none'} → ${c.to || 'none'}`);
    }
    for (const x of r.sold) line('sold', 'gone', `${x.section || x.id} sold out${x.num ? ` · request #${x.num}` : ''}`);

    /* a request's quantity is offered, never applied */
    for (const q of r.qtyOffers) {
      const go = ui.button(`Set #${q.num} to ${q.to}`, 'mini', () => ui.busy(go, async () => {
        await ui.send('updateRequest', { id: q.requestId, changes: { qty: q.to } });
        ctx.notice(`Request #${q.num} now asks for ${q.to}.`);
        await ctx.refresh(true);
      }, ctx));
      line('qty', 'qty', `request #${q.num} ${q.code || ''} asks for ${q.from}, viagogo has ${q.to}`, go);
    }

    if (r.unseen.length) {
      box.append(ui.el('p', 'note',
        (session.complete
          ? `${r.unseen.length} stored listing${r.unseen.length === 1 ? ' is' : 's are'} no longer on viagogo in any status: `
          : `${r.unseen.length} stored listing${r.unseen.length === 1 ? ' was' : 's were'} not read before the scan stopped: `)
        + r.unseen.map(u => u.section || u.id).join(', ')
        + '. Nothing was changed — use Forget all listings in the extension if you want to start clean.'));
    }
    if (!r.changes.length && !r.unseen.length) box.append(ui.el('p', 'note', 'Nothing changed.'));
    box.append(ui.el('p', 'note', `${r.read} listing${r.read === 1 ? '' : 's'} read in ${SK.util.plural(session.pages, 'request')}${session.complete ? '' : ' · stopped before the end'} · ${SK.util.ago(session.at)}.`));
    return box;
  }

  /* ---------------- my.viagogo.com/listings ------------------------ */

  const P = SK.profit;

  const calcOpen = new Set();          // listing ids whose calculator is open
  const calcPrice = new Map();         // listing id -> the price being tried

  /* a listing card in the shape the confirmed page's form filler reads */
  const toFound = d => ({ listing: d.id, qty: d.tickets || 0, section: d.section, title: d.title, venue: d.venue, when: d.when });

  /* what teammates sell the same sector of the same event for — their real
   * price, so it can be read next to yours without viagogo's display maths.
   * Without a tracked event a section name means nothing, so nothing is shown. */
  function teamFor(st, s) {
    if (!s || !s.eventKey || !SK.team) return [];
    return SK.team.teamAt(st, { eventKey: s.eventKey, section: s.section || s.code, sectorId: s.sectorId });
  }

  /* Deletes the Seat Tracker request behind a listing. The listing itself is
   * never touched: nothing on viagogo is ever changed from here. */
  async function deleteRequestFor(s) {
    if (!s || !s.requestId) return;
    const ok = confirm(`Delete request #${s.num} (${s.code})?\n\n`
      + `Only Seat Tracker's request goes — your viagogo listing ${s.id} stays exactly as it is. `
      + 'The number #' + s.num + ' is never reused.');
    if (!ok) return;
    try {
      await ui.send('deleteRequest', { id: s.requestId });
      if (sidebar) sidebar.ctx.notice(`Deleted request #${s.num} — listing ${s.id} is untouched on viagogo.`);
    } catch (e) {
      if (sidebar) sidebar.ctx.notice(e.message, true);
    }
    if (sidebar) sidebar.refresh(true);
  }

  function sectionTitle(text) {
    const h = ui.el('div', 'sk-section-title');
    h.append(ui.el('span', null, text));
    return h;
  }

  /* ---------------- one listing card in the sidebar ---------------- */

  const cardOpen = new Map();          // listing id -> expanded, once toggled by hand
  const teamOpen = new Set();          // listing ids whose team block is open

  /* the request behind a saved listing, as the sidebar's state has it */
  const requestOf = (st, s) => (s && s.requestId ? (st.requests || []).find(x => x.id === s.requestId) || null : null);

  /* how this listing compares with its request, worked out from the page as it is now */
  function diffsFor(st, d, req) {
    return req ? VG.listingDiffs(d, req, (st.events || []).filter(e => !e.archived)) : [];
  }

  function svgIcon(paths, size) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', String(size || 14));
    svg.setAttribute('height', String(size || 14));
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }

  /* "go to it on the page": a box with an arrow leaving it */
  function locateButton(r) {
    const b = ui.button('', 'ghost icon locate', e => {
      e.stopPropagation();
      if (!r.el.isConnected) return;
      r.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      /* a short ring so the eye lands on the right card; nothing is left on viagogo's page */
      if (r.el.animate) r.el.animate([{ boxShadow: '0 0 0 3px rgba(31, 95, 214, .7)' }, { boxShadow: '0 0 0 3px rgba(31, 95, 214, 0)' }], { duration: 1400, easing: 'ease-out', delay: 300 });
    }, 'Scroll to this listing on the page');
    b.setAttribute('aria-label', 'Scroll to this listing on the page');
    b.append(svgIcon(['M9 2.5h4.5V7', 'M13.5 2.5 7.5 8.5', 'M12 9.5v3.25c0 .41-.34.75-.75.75h-8a.75.75 0 0 1-.75-.75v-8c0-.41.34-.75.75-.75H6.5']));
    return b;
  }

  /* listing | request, one line per thing they should agree on */
  function compareGrid(st, d, req, diffs) {
    const differs = new Set(diffs.map(x => x.key));
    const ev = ui.eventOf(st, req.eventKey);
    const grid = ui.el('div', 'lcmp');
    grid.append(ui.el('span', 'h'), ui.el('span', 'h', 'Listing'), ui.el('span', 'h', `Request #${req.num}`));
    const row = (key, label, a, b) => {
      const off = differs.has(key);
      grid.append(
        ui.el('span', 'k' + (off ? ' off' : ''), label),
        ui.el('span', 'v' + (off ? ' off' : ''), a === null || a === undefined || a === '' ? '—' : String(a)),
        ui.el('span', 'v' + (off ? ' off' : ''), b === null || b === undefined || b === '' ? '—' : String(b)));
    };
    row('tickets', 'Tickets', d.tickets, req.qty);
    row('section', 'Section', d.section, req.code);
    row('event', 'Event', [d.title, d.when].filter(Boolean).join(' · '), ev ? `[${ev.num}] ${ev.title}` : '');
    row('status', 'Status', d.status, req.done ? 'done' : (req.eval && req.eval.status) === 'NOT SCANNED' ? 'not scanned' : (req.eval && req.eval.status) || 'open');
    return grid;
  }

  function teamBlock(ctx, s, d, team) {
    const det = document.createElement('details');
    det.className = 'lteam';
    det.open = teamOpen.has(d.id);
    det.addEventListener('toggle', () => { if (det.open) teamOpen.add(d.id); else teamOpen.delete(d.id); });
    const under = team.filter(t => t.price < d.price && t.currency === d.currency);
    det.append(ui.el('summary', null, `Team · ${team.length}${under.length ? ` · ${under.length} under you` : ''}`));
    det.append(ui.teamLine(team, { label: 'Lists at' }));
    if (under.length) {
      det.append(ui.el('div', 'detail', `${under.map(t => t.owner).join(' and ')} ${under.length > 1 ? 'are' : 'is'} under you here (${under.map(t => P.formatMoney(t.price, t.currency)).join(', ')} vs your ${P.formatMoney(d.price, d.currency)})`));
    }
    const holder = ui.el('div', 'msg-holder');
    det.append(ui.button('Tell the team', 'mini', e => {
      e.stopPropagation();
      if (holder.childNodes.length) { holder.textContent = ''; return; }
      holder.append(ui.messageBox(ctx.state, {
        eventKey: s.eventKey, section: s.code || s.section, sendLabel: 'Send',
        prefill: `${s.code || s.section}: I list ${P.formatMoney(d.price, d.currency)}, ${team.map(t => `${t.owner} ${P.formatMoney(t.price, t.currency)}`).join(', ')}`,
        onSent: () => { holder.textContent = ''; }
      }, ctx));
    }, 'Send your teammates a message about this section'), holder);
    return det;
  }

  function listingRow(ctx, r) {
    const st = ctx.state;
    const s = r.saved, d = r.data;
    const req = requestOf(st, s);
    const linked = !!(s && s.requestId);
    const diffs = r.diffs || [];
    const worst = VG.worstDiff(diffs);
    const m = s && s.money;
    /* your own price pays out less than the tickets cost */
    const losing = !!(m && m.missing === null && m.perTicket < 0);
    const open = cardOpen.has(d.id) ? cardOpen.get(d.id) : (worst === 'bad' || worst === 'warn' || losing);

    const li = ui.el('li', 'req lcard ' + ui.statusClass(linked ? s.reqStatus : null) + (worst ? ' diff-' + worst : '') + (open ? ' open' : ''));

    /* the header: always shown, toggles the card */
    const top = ui.el('div', 'top');
    const caret = ui.el('span', 'caret', '▸');
    caret.setAttribute('aria-hidden', 'true');
    top.append(caret);
    if (linked) top.append(ui.el('span', 'num', '#' + s.num), ui.el('span', 'sec', s.code));
    else top.append(ui.el('span', 'sec', d.section || '?'), ui.el('span', 'num', d.id));
    for (const x of diffs) top.append(ui.el('span', 'dpill d-' + x.level, x.short));
    if (losing) top.append(ui.el('span', 'dpill d-bad', 'below break-even'));
    top.append(ui.el('span', 'spacer'));
    if (!linked) top.append(ui.button('Add', 'mini primary', e => { e.stopPropagation(); adding = d.id; filledFor = ''; ctx.rerender(); }, 'Fill Add a request with this listing'));
    top.append(locateButton(r));
    top.setAttribute('role', 'button');
    top.setAttribute('aria-expanded', String(open));
    top.tabIndex = 0;
    const toggle = () => {
      const next = !li.classList.contains('open');
      cardOpen.set(d.id, next);
      li.classList.toggle('open', next);
      top.setAttribute('aria-expanded', String(next));
    };
    top.addEventListener('click', e => { if (!e.target.closest('button, a, input, select, summary')) toggle(); });
    top.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === top) { e.preventDefault(); toggle(); } });
    li.append(top);

    /* one line under the header, also shown when collapsed */
    const sum = ui.el('div', 'detail split');
    sum.append(ui.el('span', 'ell', [
      d.tickets !== null ? `${d.tickets} listed` : '',
      P.formatMoney(d.price, d.currency),
      d.status
    ].filter(Boolean).join(' · ')));
    const chip = linked ? ui.profitChip(s.money) : null;
    if (chip) sum.append(chip);
    li.append(sum);

    const body = ui.el('div', 'lbody');
    li.append(body);

    if (linked && req) {
      body.append(compareGrid(st, d, req, diffs));
      for (const x of diffs) {
        const line = ui.el('div', 'ldiff d-' + x.level);
        line.append(ui.el('span', null, x.text));
        if (x.fixQty) {
          const go = ui.button(`Set request to ${x.fixQty}`, 'mini', e => ui.busy(go, async () => {
            e.stopPropagation();
            await ui.send('updateRequest', { id: req.id, changes: { qty: x.fixQty } });
            ctx.notice(`Request #${req.num} now asks for ${x.fixQty}.`);
            await ctx.refresh(true);
          }, ctx), `Change request #${req.num} to ${x.fixQty} tickets — nothing on viagogo changes`);
          line.append(go);
        }
        body.append(line);
      }
    } else if (!linked) {
      body.append(ui.el('div', 'detail', [d.title, d.when].filter(Boolean).join(' · ') || 'No event shown on the card'));
    }

    /* what changed on viagogo since an earlier read, so a difference has a when */
    const moved = s ? VG.lastChange(s.history, 'tickets') : null;
    if (moved) body.append(ui.el('div', 'detail', `Tickets on this listing went ${moved.from} → ${moved.to} ${SK.util.ago(moved.at)}.`));

    if (losing) {
      body.append(ui.el('div', 'ldiff d-bad', `Your ${P.formatMoney(Number(s.price), d.currency)} is below your break-even of ${P.formatMoney(m.breakEven, d.currency)}.`));
    }

    const acts = ui.el('div', 'row-acts');
    const calcHolder = ui.el('div', 'calc-holder');
    if (s && s.money && s.money.ratio) {
      const drawCalc = () => {
        calcHolder.textContent = '';
        if (!calcOpen.has(d.id)) return;
        calcHolder.append(ui.calculator(s.money, {
          price: calcPrice.has(d.id) ? calcPrice.get(d.id) : d.price,
          onPrice: v => calcPrice.set(d.id, v)
        }));
      };
      acts.append(ui.button('Calculator', 'mini', e => {
        e.stopPropagation();
        if (calcOpen.has(d.id)) calcOpen.delete(d.id); else calcOpen.add(d.id);
        drawCalc();
      }, 'Try another sell price and see what it would earn — nothing is changed on viagogo'));
      drawCalc();
    }
    /* "I already have these tickets": stops scans and alerts, keeps the request */
    if (s) acts.append(ui.trackToggle(s, ctx));
    if (linked) {
      acts.append(ui.button('Delete request', 'mini danger', e => {
        e.stopPropagation();
        deleteRequestFor(s);
      }, `Remove request #${s.num} from Seat Tracker — the listing on viagogo is not touched`));
    }
    if (acts.childNodes.length) body.append(acts);
    body.append(calcHolder);

    /* teammates' prices: useful, but second to the listing itself */
    const team = teamFor(st, s);
    if (team.length) body.append(teamBlock(ctx, s, d, team));
    return li;
  }

  /* ---------------- event scans handed over from an event page ---------- */

  const M = SK.market;
  const ordinal = n => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const liveCompares = st => ((st && st.compares) || []).filter(c => M.compareLive(c));

  /* where a listing stood in the newest scan that saw it -> { c, at } | null */
  function standingFor(st, id) {
    for (const c of liveCompares(st)) {
      const at = M.compareStanding(c, id);
      if (at) return { c, at };
    }
    return null;
  }

  function standingText(x) {
    const a = x.at;
    if (a.sold) return `${a.section} · sold in that scan`;
    const money = n => P.formatMoney(n, a.currency);
    const gap = a.gap === null ? (a.alone ? 'only your listings here' : 'nobody else here')
      : a.gap > 0 ? `${money(a.gap)} above the cheapest`
      : a.gap === 0 ? 'tied cheapest' : `cheapest by ${money(-a.gap)}`;
    return `${a.section} · ${ordinal(a.rank)} of ${a.listings} · ${gap}`;
  }

  async function takeCompare(ctx, text) {
    try {
      const c = M.unpackCompare(text);
      await ui.send('putCompare', { compare: c });
      ctx.notice(`Pasted the scan of ${c.name || 'E-' + c.eventId}: ${M.compareMine(c).length} of your listings ranked, until ${SK.util.fmtClock(c.expiresAt)}.`);
      await ctx.refresh(true);
    } catch (e) {
      ctx.notice(e.message, true);
    }
  }

  function comparesBox(ctx) {
    const st = ctx.state;
    const list = liveCompares(st);
    const box = ui.el('div', 'vg-compares');
    const head = ui.el('div', 'top');
    head.append(ui.el('strong', null, 'Event scans'), ui.el('span', 'spacer'));
    box.append(head);
    if (list.length) {
      for (const c of list) {
        const row = ui.el('div', 'vg-cmp');
        row.append(ui.el('span', 'ell', `${c.name || 'E-' + c.eventId} · ${M.compareMine(c).length} yours · scan ${SK.util.ago(c.at)} · until ${SK.util.fmtClock(c.expiresAt)}`));
        row.append(ui.button('✕', 'ghost mini', () => ui.send('dropCompare', { eventId: c.eventId }).then(() => ctx.refresh(true)), 'Forget this scan'));
        box.append(row);
      }
    } else {
      box.append(ui.el('p', 'note', 'Scan an event page while signed in and its ranks show up on these cards by themselves. Or paste one copied with "Copy for compare".'));
    }
    const area = ui.el('textarea', 'vg-paste');
    area.rows = 1;
    area.placeholder = 'Paste a scan here (⌘V / Ctrl+V)';
    area.addEventListener('paste', e => {
      const text = e.clipboardData && e.clipboardData.getData('text');
      if (!text) return;
      e.preventDefault();
      takeCompare(ctx, text);
    });
    box.append(area);
    return box;
  }

  function renderListings(slot, ctx) {
    const st = ctx.state;
    injectLines(st);
    injectPanel(st);

    if (saveError) {
      const warn = ui.el('div', 'track-card');
      warn.append(ui.el('strong', null, 'These listings are not being saved'));
      warn.append(ui.el('p', 'vg-why warn', saveError));
      warn.append(ui.el('p', 'note', 'Nothing read from this page is stored until this is fixed. If the extension was updated, the shared database may need its new columns — run supabase/schema.sql again.'));
      slot.append(warn);
    }

    const report = sessionBox(ctx);
    if (report) slot.append(report);
    /* every listing in every status, from viagogo's own list: no page turning */
    if (!session || !session.on) {
      const bar = ui.el('div', 'row-acts');
      bar.append(ui.button('Scan all listings', 'primary mini', () => startSession(ctx),
        'Read every listing you have on viagogo — active, pending, deactivated and expired — in a few requests, and compare with what is stored'));
      if ((st.listings || []).length) bar.append(ui.forgetListingsButton(st, ctx, () => ctx.refresh(true)));
      slot.append(bar);
    }

    if (adding) {
      slot.append(ui.button('‹ All listings', 'ghost mini', () => { adding = null; ctx.rerender(); }));
      const c = cards.find(x => x.data.id === adding);
      if (!c) { slot.append(ui.el('p', 'note', 'That listing is no longer on the page.')); return; }
      listings = [toFound(c.data)];
      chosen = 0;
      renderConfirmed(slot, ctx);
      return;
    }

    if (!cards.length) {
      const box = ui.el('div', 'track-card');
      box.append(ui.el('strong', null, 'Reading your listings…'), ui.el('p', 'note', 'Waiting for viagogo to show them.'));
      slot.append(box);
      return;
    }

    const byId = new Map((st.listings || []).map(l => [l.id, l]));
    const rows = cards.map(c => ({ data: c.data, el: c.el, saved: byId.get(c.data.id) || null }));
    for (const r of rows) r.diffs = diffsFor(st, r.data, requestOf(st, r.saved));
    const RANK = { bad: 0, warn: 1, info: 2, '': 3 };
    const rank = r => RANK[VG.worstDiff(r.diffs)];
    /* the ones that differ from their request first, then page order */
    const matched = rows.filter(r => r.saved && r.saved.requestId).sort((a, b) => rank(a) - rank(b));
    const others = rows.filter(r => !(r.saved && r.saved.requestId));
    const differ = matched.filter(r => rank(r) < 2).length;

    let total = 0, got = 0, cost = 0, counted = 0, losing = 0;
    for (const r of matched) {
      const m = r.saved.money;
      if (!m || m.missing !== null) continue;
      counted++;
      total += m.total;
      got += m.payoutL * m.tickets;
      cost += m.costL * m.tickets;
      if (m.perTicket < 0) losing++;
    }
    const tiles = ui.el('div', 'vg-tiles');
    const tile = (value, label, cls) => {
      const t = ui.el('div', 'vg-tile' + (cls ? ' ' + cls : ''));
      t.append(ui.el('b', null, value), ui.el('span', null, label));
      return t;
    };
    tiles.append(
      counted
        ? tile(P.formatLek(total, true), `if all sell · ${P.winRateText(cost > 0 ? got / cost : 0).replace(/[()]/g, '')}`, total >= 0 ? 'up' : 'dn')
        : tile('—', 'no profit to show yet'),
      tile(String(differ), differ === 1 ? 'differs from its request' : 'differ from their request', differ ? 'dn' : ''),
      tile(String(losing), losing === 1 ? 'below its break-even' : 'below their break-even', losing ? 'dn' : '')
    );
    slot.append(tiles);
    slot.append(comparesBox(ctx));

    const groups = [
      [`Listings · ${matched.length}${differ ? ` · ${differ} differ` : ''}`, matched],
      [`No request yet · ${others.length}`, others]
    ];
    for (const [title, list] of groups) {
      if (!list.length) continue;
      slot.append(sectionTitle(title));
      const ul = ui.el('ul', 'reqs');
      for (const r of list) ul.append(listingRow(ctx, r));
      slot.append(ul);
    }
    const seen = rows.map(r => (r.saved && r.saved.money && r.saved.money.listing ? r.saved.money.listing.seenAt : 0)).filter(Boolean);
    slot.append(ui.el('p', 'note', `${seen.length ? `Saved ${SK.util.ago(Math.max(...seen))}. ` : ''}This page is read and compared by itself — scroll or turn viagogo's pages and each listing is checked as it appears.`));
  }

  /* the one-line summary added under each viagogo card, in its own shadow root */
  const LINE_CSS = `:host { all: initial; display: block; margin-top: 10px; }
    .l { display: inline-grid; gap: 4px; font: 12px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #16181d; background: #eef3fd; border: 1px solid #c9d8f6; border-radius: 7px; padding: 5px 8px; }
    .r { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .r + .r { border-top: 1px solid #c9d8f6; padding-top: 4px; }
    .none .r + .r { border-top-color: #e5e7eb; }
    .acts { gap: 12px; }
    .split { align-items: flex-start; gap: 6px 22px; }
    .col { display: grid; gap: 5px; align-content: start; min-width: 0; }
    .col.money { border-left: 1px solid #c9d8f6; padding-left: 14px; }
    .ln { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .rate { font-weight: 700; font-size: 11px; padding: 0 5px; border-radius: 5px; }
    .rate.up { background: #e3f5ec; } .rate.dn { background: #fceceb; }
    table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th, td { padding: 1px 0 1px 12px; text-align: right; white-space: nowrap; font-weight: 400; }
    th:first-child { padding-left: 0; text-align: left; color: #6b7280; }
    tr.head th { font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #6b7280; }
    tr.sum th, tr.sum td { font-weight: 700; border-top: 1px solid #c9d8f6; padding-top: 3px; }
    tr.sum th { color: #16181d; }
    .chg.old { background: #eef0f3; color: #8b93a1; }
    .chg.old b { font-weight: 500; }
    .chg { display: inline-flex; align-items: baseline; gap: 5px; padding: 1px 6px; border-radius: 999px; background: #fdf0e0; color: #8a4a08; }
    .chg b { font-weight: 600; font-variant-numeric: tabular-nums; }
    .l.none { background: #f6f7f9; border-color: #e5e7eb; color: #6b7280; }
    .logo { width: 14px; height: 14px; border-radius: 4px; background: #1f5fd6; flex: none; }
    .none .logo { background: #98a1b0; }
    .pill { font-weight: 700; font-size: 10px; padding: 1px 6px; border-radius: 5px; }
    .st-OK { color: #12875a; background: #e3f5ec; } .st-LOW { color: #b4620c; background: #fdf0e0; }
    .st-SPLIT, .st-SHORT { color: #b3261e; background: #fceceb; } .st-NONE, .st-idle { color: #6b7280; background: #eef0f3; }
    .st-BOUGHT { color: #6d28d9; background: #f1ebfd; }
    .up { color: #12875a; font-weight: 600; } .dn { color: #b3261e; font-weight: 600; } .mut { color: #6b7280; }
    .team-label { font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #6b7280; }
    .mate { display: inline-flex; align-items: baseline; gap: 4px; padding: 1px 6px; border-radius: 999px; background: #e7ecf6; }
    .mate b { font-weight: 600; }
    .mate.under { background: #fceceb; color: #b3261e; }
    .diff { font-weight: 700; font-size: 10px; padding: 1px 6px; border-radius: 5px; }
    .diff.d-bad { color: #b3261e; background: #fceceb; } .diff.d-warn { color: #b4620c; background: #fdf0e0; } .diff.d-info { color: #6b7280; background: #eef0f3; }
    .mate.stale { background: #f1f2f4; color: #6b7280; }
    button { font: inherit; font-weight: 600; color: #1f5fd6; background: none; border: 0; padding: 0; cursor: pointer; }
    button.del { color: #b3261e; }
    .buy { display: flex; align-items: center; gap: 5px; margin-top: 2px; }
    .buy input, .buy select { font: inherit; color: #16181d; background: #fff; border: 1px solid #c9d8f6; border-radius: 5px; padding: 1px 5px; height: 22px; box-sizing: border-box; }
    .buy input { width: 76px; font-variant-numeric: tabular-nums; }
    .buy input:focus, .buy select:focus { outline: 2px solid #1f5fd6; outline-offset: 0; }
    .none .buy input, .none .buy select { border-color: #d8dce3; }
    button:focus-visible { outline: 2px solid #1f5fd6; outline-offset: 2px; border-radius: 3px; }`;

  /* each | total for what the tickets cost, what viagogo pays and the difference */
  function moneyTable(s, m) {
    const box = document.createDocumentFragment();
    const note = text => { const p = document.createElement('div'); p.className = 'mut'; p.textContent = text; box.append(p); return box; };
    if (!m) return note('saving…');
    if (m.missing === 'rate') return note('waiting for exchange rates');
    if (m.missing === 'listing') return note('no price on this listing yet');
    const t = document.createElement('table');
    const tr = (cells, cls) => {
      const r = document.createElement('tr');
      if (cls) r.className = cls;
      cells.forEach((v, i) => {
        const c = document.createElement(i === 0 || cls === 'head' ? 'th' : 'td');
        if (v && typeof v === 'object') { c.className = v.cls || ''; c.textContent = v.text; } else c.textContent = v;
        r.append(c);
      });
      t.append(r);
    };
    const n = m.tickets;
    tr(['', 'each', `total (${n})`], 'head');
    if (m.missing === 'buy') {
      tr(['You get', P.formatLek(m.payoutL), P.formatLek(m.payoutL * n)]);
      box.append(t);
      return note('no buy price yet');
    }
    const buy = s && s.buy;
    const each = buy && buy.currency && buy.currency !== 'ALL'
      ? `${P.formatMoney(buy.amount, buy.currency)} (${P.formatLek(m.costL)})`
      : P.formatLek(m.costL);
    const cls = m.total >= 0 ? 'up' : 'dn';
    tr(['Buy', each, P.formatLek(m.costL * n)]);
    tr(['You get', P.formatLek(m.payoutL), P.formatLek(m.payoutL * n)]);
    tr(['Profit', { text: P.formatLek(m.perTicket, true), cls }, { text: P.formatLek(m.total, true), cls },
      { text: P.winRateText(m.winRate).replace(/[()]/g, ''), cls: 'rate ' + cls }], 'sum');
    box.append(t);
    return box;
  }

  /* What one of the listing's tickets cost you, typed on the card: for any
   * listing of yours, tracked event or not, so the profit and the win rate
   * always show. Empty clears it (the site's price, where there is one,
   * takes over again). */
  function buyEdit(s) {
    const wrap = document.createElement('div');
    wrap.className = 'buy';
    const stop = e => { e.stopPropagation(); };
    const lbl = document.createElement('span');
    lbl.className = 'mut';
    lbl.textContent = 'Buy';
    const amount = document.createElement('input');
    amount.type = 'number';
    amount.min = '0';
    amount.step = 'any';
    amount.inputMode = 'decimal';
    amount.value = Number(s.buyPrice) > 0 ? String(s.buyPrice) : '';
    amount.placeholder = s.buy && s.buy.source !== 'typed on the listing' ? String(s.buy.amount) : 'a ticket';
    amount.title = 'What one of these tickets cost you. Saved when you leave the box.';
    const cur = document.createElement('select');
    for (const c of P.CURRENCIES) {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      o.selected = c === (Number(s.buyPrice) > 0 ? s.buyCurrency : (s.buy && s.buy.currency) || P.BASE);
      cur.append(o);
    }
    let saving = false;
    const save = () => {
      if (saving) return;
      const same = String(amount.value || '') === (Number(s.buyPrice) > 0 ? String(s.buyPrice) : '') && cur.value === (s.buyCurrency || P.BASE);
      if (same) return;
      saving = true;
      amount.disabled = cur.disabled = true;
      ui.send('setListingBuy', { id: s.id, price: amount.value, currency: cur.value })
        .then(() => { if (sidebar) sidebar.refresh(true); })
        .catch(err => { amount.disabled = cur.disabled = false; saving = false; if (sidebar) sidebar.ctx.notice(err.message, true); });
    };
    for (const x of [amount, cur]) {
      /* the card is a link: a click in the box must not open the listing */
      x.addEventListener('click', e => { e.preventDefault(); stop(e); });
      for (const t of ['mousedown', 'pointerdown', 'keydown', 'keyup']) x.addEventListener(t, stop);
    }
    amount.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); amount.blur(); } });
    amount.addEventListener('change', save);
    cur.addEventListener('change', () => { if (amount.value) save(); });
    wrap.append(lbl, amount, cur);
    if (s.buy && s.buy.source !== 'typed on the listing') {
      const src = document.createElement('span');
      src.className = 'mut';
      src.textContent = s.buy.source;
      wrap.append(src);
    }
    return wrap;
  }

  function injectLines(st) {
    const byId = new Map(((st && st.listings) || []).map(l => [l.id, l]));
    for (const c of cards) {
      if (!c.el.isConnected) continue;
      let host = [...c.el.children].find(x => x.hasAttribute('data-sk-line'));
      /* someone is typing a buy price on this card: leave it be until they are done */
      if (host && host.shadowRoot && host.shadowRoot.activeElement) continue;
      if (!host) {
        host = document.createElement('div');
        host.setAttribute('data-sk-line', '');
        host.attachShadow({ mode: 'open' });
        c.el.append(host);
      }
      const root = host.shadowRoot;
      root.textContent = '';
      const style = document.createElement('style');
      style.textContent = LINE_CSS;
      /* The request and what changed on the left, the money on the right, then
       * the team and what can be done underneath, each across the whole box. */
      const line = document.createElement('div');
      const div = cls => { const r = document.createElement('div'); r.className = cls; return r; };
      const top = div('r split'), side = div('col'), info = div('ln'), moved = div('ln'), money = div('col money');
      const mates = div('r'), acts = div('r acts');
      side.append(info, moved);
      const add = (cls, text, into) => { const x = document.createElement('span'); if (cls) x.className = cls; x.textContent = text; (into || info).append(x); return x; };
      const s = byId.get(c.data.id);
      const req = !(s && s.requestId) && st ? (st.requests || []).find(r => r.listing === c.data.id) : null;
      if ((s && s.requestId) || req) {
        line.className = 'l';
        add('logo', '');
        const b = document.createElement('b');
        b.textContent = s && s.requestId ? `#${s.num} ${s.code}` : `#${req.num} ${req.code}`;
        info.append(b);
        const status = s && s.requestId ? s.reqStatus : req.eval.status;
        if (status) add('pill ' + ui.statusClass(status), status === 'NOT SCANNED' ? 'not scanned' : status);
        /* where the listing no longer agrees with its request, on the card itself */
        for (const x of diffsFor(st, c.data, (s && s.requestId) ? requestOf(st, s) : req)) {
          add('diff d-' + x.level, x.short).title = x.text;
        }
        const m = s && s.money;
        if (m && m.missing === null && m.winRate) add('rate ' + (m.total >= 0 ? 'up' : 'dn'), P.winRateText(m.winRate).replace(/[()]/g, '')).title = 'Win rate: what you get ÷ what the tickets cost';
        money.append(moneyTable(s, m));
        if (s) money.append(buyEdit(s));
        /* the latest change of each, as viagogo showed it on an earlier read */
        const changes = [
          ['Tickets', VG.lastChange(s && s.history, 'tickets'), v => String(v)],
          ['Price', VG.lastChange(s && s.history, 'price'), v => P.formatMoney(Number(v), c.data.currency)]
        ].filter(x => x[1]);
        if (changes.length) {
          add('team-label', 'Changed', moved);
          const FADE_MS = 3 * 86400000;      // older than three days: still there, no longer news
          for (const [label, ch, fmt] of changes) {
            const x = add('chg' + (Date.now() - ch.at > FADE_MS ? ' old' : ''), '', moved);
            const b = document.createElement('b');
            b.textContent = `${label} ${fmt(ch.from)} → ${fmt(ch.to)}`;
            const at = document.createElement('span');
            at.className = 'mut';
            at.textContent = SK.util.ago(ch.at);
            x.append(b, at);
            x.title = `${label} on this listing went ${fmt(ch.from)} → ${fmt(ch.to)} on ${new Date(ch.at).toLocaleString()}`;
          }
        }
        if (s && s.requestId) {
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'del';
          del.textContent = 'Delete request';
          del.title = `Remove request #${s.num} from Seat Tracker — this listing stays on viagogo`;
          del.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            deleteRequestFor(s);
          });
          acts.append(del);
        }
        /* the same switch as in the sidebar, on viagogo's own card */
        if (s) {
          const off = s.track === 'off' || s.state === 'bought';
          if (s.track === 'off' && s.state !== 'bought') add('mut', 'ignored');
          const t = document.createElement('button');
          t.type = 'button';
          t.textContent = off ? 'Track again' : 'Bought';
          t.title = off
            ? `Start scanning and alerting for listing ${s.id} again`
            : `You have these tickets: stop scanning and alerting for listing ${s.id}. Nothing on viagogo changes.`;
          t.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            t.disabled = true;
            ui.send('setListingTrack', { id: s.id, track: off ? 'auto' : 'off' })
              .then(() => { if (sidebar) sidebar.refresh(true); })
              .catch(err => { t.disabled = false; if (sidebar) sidebar.ctx.notice(err.message, true); });
          });
          acts.append(t);
        }
      } else {
        line.className = 'l none';
        add('logo', '');
        add('', 'Not in Seat Tracker yet');
        /* no request, maybe no tracked event at all: the money still shows once you type what a ticket cost */
        if (s) {
          const m = s.money;
          if (m && m.missing === null && m.winRate) add('rate ' + (m.total >= 0 ? 'up' : 'dn'), P.winRateText(m.winRate).replace(/[()]/g, '')).title = 'Win rate: what you get ÷ what the tickets cost';
          money.append(moneyTable(s, m));
          money.append(buyEdit(s));
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Add as request';
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          adding = c.data.id;
          filledFor = '';
          if (sidebar) sidebar.open();
        });
        acts.append(btn);
      }
      /* what your teammates ask for the same sector of the same event, right
       * on the card — theirs is the price they set, like the one on the card */
      const team = teamFor(st, s);
      if (team.length) {
        add('team-label', 'Team', mates);
        for (const t of team) {
          const under = c.data.price !== null && t.currency === c.data.currency && t.price < c.data.price;
          const mate = document.createElement('span');
          mate.className = 'mate' + (t.stale ? ' stale' : under ? ' under' : '');
          const who = document.createElement('b');
          who.textContent = t.owner;
          const at = document.createElement('span');
          at.textContent = P.formatMoney(t.price, t.currency);
          mate.append(who, at);
          mate.title = `${t.owner} lists ${t.section || 'this sector'}${t.row ? ` row ${t.row}` : ''} at ${P.formatMoney(t.price, t.currency)}`
            + `${t.tickets ? ` · ${t.tickets} tickets` : ''} · read ${SK.util.ago(t.seenAt)}`
            + (t.stale ? ' — old, check with them' : under ? ` — under your ${P.formatMoney(c.data.price, c.data.currency)}` : '');
          mates.append(mate);
        }
      }
      if (!moved.childNodes.length) moved.remove();
      /* where it stood in the latest event scan, in that scan's display prices —
       * any listing of yours, with a request or not */
      const stand = standingFor(st, c.data.id);
      if (stand) {
        const mk = div('ln');
        side.append(mk);
        add('team-label', 'Market', mk);
        const a = stand.at;
        add(a.sold ? 'mut' : a.gap === null || a.gap <= 0 ? 'up' : 'dn', standingText(stand), mk).title =
          `From your scan of ${stand.c.name || 'the event'} at ${SK.util.fmtClock(stand.c.at)}, in the display prices that scan saw — not your real price. Gone at ${SK.util.fmtClock(stand.c.expiresAt)}.`;
        add('mut', `scan ${SK.util.ago(stand.c.at)}`, mk);
      }
      top.append(side);
      if (money.childNodes.length) top.append(money);
      for (const r of [top, mates, acts]) if (r.childNodes.length) line.append(r);
      root.append(style, line);
    }
  }

  /* ---------------- every listing of yours, under the search bar ------ *
   * One short line per listing — section | tickets | price | win rate |
   * status, and the gap to the cheapest other seller once the event is scanned —
   * grouped by event, from every listing saved for you (all pages, not just
   * this one). Clicking a line searches viagogo's list for that listing
   * number, the way its own search does: through the address.
   *
   * Where the search bar is: viagogo's markup has hashed class names, so it
   * is found by what it is (a search field), and when none is found the box
   * goes just above the listing cards. It lives in a shadow root, so viagogo
   * never sees it change and the page's observer is not woken by it.        */

  const PANEL_SHOWN = ['active', 'pending'];
  let panelHost = null;
  let panelOpen = true;
  let panelAll = false;            // also the deactivated, sold and other ones
  const panelClosed = new Set();   // events folded in the box
  let panelQuery = '';             // what is typed in the box's own search
  let panelParts = null;           // { head, search, list }: built once, so typing keeps its focus

  const PANEL_CSS = `:host { all: initial; display: block; margin: 12px 0; }
    .p { font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #16181d; background: #fff;
         border: 1px solid #d8dce3; border-radius: 10px; padding: 8px 12px; }
    .hd { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
    .hd b { font-size: 13.5px; }
    .logo { width: 16px; height: 16px; border-radius: 4px; background: #1f5fd6; flex: none; }
    .m { color: #6b7280; font-size: 12px; }
    .sp { flex: 1; }
    .tg { all: unset; cursor: pointer; color: #1f5fd6; font-size: 12px; }
    .ev { margin-top: 8px; }
    .evh { display: flex; align-items: baseline; gap: 8px; cursor: pointer; user-select: none; padding: 2px 0; }
    .evh b { font-size: 12.5px; }
    .car { width: 10px; color: #6b7280; font-size: 10px; }
    .its { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 4px 0 2px 18px; }
    .it { all: unset; cursor: pointer; font: 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap;
          padding: 3px 8px; border: 1px solid #d8dce3; border-radius: 6px; background: #f7f8fa; }
    .it:hover, .it:focus-visible { border-color: #1f5fd6; background: #eef3fd; }
    /* selected: a light tint and a blue ring, so the red, green and orange inside keep reading */
    .it.on { border-color: #1f5fd6; background: #dce7fc; box-shadow: inset 0 0 0 1px #1f5fd6; font-weight: 600; }
    .it .bar { color: #9aa1ad; margin: 0 4px; }
    .it .x.up { color: #12875a; } .it .x.dn { color: #b3261e; } .it .x.na { color: #9aa1ad; }
    .it.off { opacity: .55; }
    .srch { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .srch input { all: unset; box-sizing: border-box; flex: 0 1 260px; min-width: 0; padding: 4px 8px; font-size: 12.5px;
                  border: 1px solid #d8dce3; border-radius: 6px; background: #fff; color: #16181d; }
    .srch input:focus { border-color: #1f5fd6; box-shadow: 0 0 0 2px #1f5fd633; }
    .st { font-weight: 700; }
    .st.st-OK { color: #12875a; } .st.st-LOW { color: #b4620c; } .st.st-SPLIT, .st.st-SHORT { color: #b3261e; } .st.st-BOUGHT { color: #6d28d9; }
    .st.st-NONE, .st.st-idle { color: #9aa1ad; font-weight: 400; }
    .now { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 5px 8px; border-radius: 6px; background: #eef3fd; font-size: 12px; }
    /* light, like viagogo's own page and the lines on its cards */`;

  /* the search field of the listings page, or null: found by what it is */
  function searchField() {
    const sel = 'input[type="search"], [role="searchbox"], input[placeholder*="earch" i], input[aria-label*="earch" i], input[name*="search" i]';
    return [...document.querySelectorAll(sel)].find(x => !x.closest('[data-sk-panel], [data-sk-line]') && x.getClientRects().length) || null;
  }

  /* where the box goes: after the search field's row, else above the cards */
  function panelAnchor() {
    const field = searchField();
    if (field) {
      /* climb to the row that holds the field and its buttons, not past the
       * box that also holds the listing cards */
      let row = field.closest('form') || field.parentElement;
      const firstCard = cards[0] && cards[0].el;
      while (row && row.parentElement && row.parentElement !== document.body
        && !(firstCard && row.parentElement.contains(firstCard))
        && row.parentElement.getBoundingClientRect().height < 160) row = row.parentElement;
      if (row) return { after: row };
    }
    const first = cards[0] && cards[0].el;
    return first ? { before: first } : null;
  }

  const searchedId = () => new URLSearchParams(location.search).get('search') || '';

  /* viagogo's own search, through the address: every tab, only this listing */
  function searchListing(id) {
    const u = new URL(location.href);
    if (id) {
      u.searchParams.set('search', id);
      u.searchParams.set('activeTab', VG.SWEEP_TABS);
    } else u.searchParams.delete('search');
    location.assign(u.toString());
  }

  /* the box's search: a section ("e10" finds E105 and E106), else a listing
   * number or a word of the event's name */
  function panelMatches(l, q) {
    const k = SK.util.normKey(q);
    if (!k) return true;
    if (SK.util.normKey(l.code || l.section).includes(k) || SK.util.normKey(l.section).includes(k)) return true;
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 4 && String(l.id).includes(digits)) return true;
    return k.length >= 3 && SK.util.normKey(`${l.title} ${l.eventTitle || ''}`).includes(k);
  }

  function panelGroups(st) {
    const shown = (st.listings || []).filter(l => (panelAll || PANEL_SHOWN.includes(VG.listingStatus(l.status))) && panelMatches(l, panelQuery));
    const groups = new Map();
    for (const l of shown) {
      const key = l.eventKey || `${l.title}|${l.when}`;
      if (!groups.has(key)) {
        const w = VG.parseWhen(l.when || '');
        groups.set(key, { key, title: l.eventKey && l.eventTitle ? `[${l.eventNum}] ${l.eventTitle}` : (l.title || 'Event'), when: l.when || '',
          order: w.month ? w.month * 100 + w.day : 9999, items: [] });
      }
      groups.get(key).items.push(l);
    }
    const out = [...groups.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    for (const g of out) {
      g.items.sort((a, b) => String(a.code || a.section).localeCompare(String(b.code || b.section), 'en', { numeric: true })
        || (Number(a.money && a.money.listing && a.money.listing.price) || 0) - (Number(b.money && b.money.listing && b.money.listing.price) || 0));
    }
    const allowed = (st.listings || []).filter(l => panelAll || PANEL_SHOWN.includes(VG.listingStatus(l.status))).length;
    return { groups: out, hidden: (st.listings || []).length - allowed };
  }

  /* the request this listing fills and how its seats look: OK, LOW, SPLIT,
   * SHORT, not scanned, bought — or nothing, for a listing that is not a request —
   * with how many options its last scan found */
  function panelStatus(st, l) {
    if (l.requestId && l.reqStatus) return { status: l.reqStatus, options: l.reqOptions };
    const req = (st.requests || []).find(r => r.listing === l.id);
    if (!req) return { status: '', options: null };
    if (req.done) return { status: 'done', options: null };
    return { status: (req.eval && req.eval.status) || '', options: req.eval ? req.eval.options : null };
  }
  /* "OK 6", "LOW 2": the count only where a scan judged the seats */
  const SCANNED = ['OK', 'LOW', 'SPLIT', 'SHORT'];
  const statusLabel = s => (SCANNED.includes(s.status) && Number.isFinite(Number(s.options)) && s.options !== null
    ? `${s.status} ${s.options}` : STATUS_TEXT[s.status] || s.status);
  const STATUS_TEXT = { 'NOT SCANNED': 'not scanned', BOUGHT: 'bought', done: 'done', '': 'no request' };
  const STATUS_WHY = {
    OK: 'enough seats free, side by side', LOW: 'still free, but only just', SPLIT: 'free, but not side by side',
    SHORT: 'not enough seats free', 'NOT SCANNED': 'its sector has not been scanned yet', BOUGHT: 'you have these tickets: not tracked',
    done: 'the request is done', '': 'this listing is not a request'
  };

  /* "E106 | 6 | $45.00 | x1.6 | OK | +$15.00" — the gap only once the event is scanned */
  function panelItem(st, l, on) {
    const own = (l.money && l.money.listing) || {};
    const m = l.money || {};
    const b = document.createElement('button');
    b.type = 'button';
    const status = VG.listingStatus(l.status);
    b.className = 'it' + (on ? ' on' : '') + (PANEL_SHOWN.includes(status) ? '' : ' off');
    const part = (text, cls) => { const x = document.createElement('span'); if (cls) x.className = cls; x.textContent = text; return x; };
    const bar = () => part('|', 'bar');
    const tickets = own.tickets != null ? own.tickets : l.tickets;
    const priceText = Number(own.price) > 0 ? P.formatMoney(Number(own.price), own.currency) : '—';
    const rate = m.missing === null && m.winRate ? P.winRateText(m.winRate).replace(/[()]/g, '') : '';
    const seen = panelStatus(st, l);
    const avail = seen.status;
    b.append(
      part(String(l.code || l.section || '?')), bar(),
      part(tickets != null ? String(tickets) : '?'), bar(),
      part(priceText), bar(),
      part(rate || 'x—', 'x ' + (rate ? (m.total >= 0 ? 'up' : 'dn') : 'na')), bar(),
      part(statusLabel(seen), 'st ' + (avail === 'done' ? 'st-idle' : ui.statusClass(avail)))
    );
    /* the gap to the cheapest other seller in its section, once its event is scanned */
    const stand = standingFor(st, l.id);
    if (stand) {
      const a = stand.at;
      const gap = a.sold ? 'sold' : a.gap === null ? 'alone'
        : `${a.gap > 0 ? '+' : a.gap < 0 ? '−' : '±'}${P.formatMoney(Math.abs(a.gap), a.currency)}`;
      b.append(bar(), part(gap, 'x ' + (a.sold || a.gap === null ? 'na' : a.gap > 0 ? 'dn' : 'up')));
    }
    b.title = `Listing ${l.id}${l.row ? ` · row ${l.row}` : ''} · ${l.status || 'status unknown'}` +
      ` · ${STATUS_TEXT[avail] || avail}: ${STATUS_WHY[avail] || ''}` +
      (SCANNED.includes(avail) && seen.options !== null && seen.options !== undefined ? ` · ${SK.util.plural(Number(seen.options), 'option')}` : '') +
      (rate ? ` · win rate ${rate}: what you get ÷ what the tickets cost` : m.missing === 'buy' ? ' · no buy price, so no win rate' : '') +
      (stand ? ` · event scan ${SK.util.ago(stand.c.at)}: ${standingText(stand)}` : '') +
      `\n${on ? 'Click to clear the search' : 'Click to search for this listing'}`;
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); searchListing(on ? '' : l.id); });
    return b;
  }

  function injectPanel(st) {
    if (mode !== 'listings' || !st || !SK.settings.panelOn(st.settings, 'viagogo', 'listings')) {
      if (panelHost) { panelHost.remove(); panelHost = null; panelParts = null; }
      return;
    }
    const at = panelAnchor();
    if (!at) return;
    if (!panelHost) {
      panelHost = document.createElement('div');
      panelHost.setAttribute('data-sk-panel', '');
      panelHost.attachShadow({ mode: 'open' });
    }
    /* put it in place only when it is not already there: moving it is a
     * change to viagogo's page, which would wake the observer again */
    const where = at.after ? at.after.nextElementSibling : at.before.previousElementSibling;
    if (where !== panelHost) {
      if (at.after) at.after.after(panelHost);
      else at.before.before(panelHost);
    }

    const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
    /* the frame once: style, head, search, list. Later only the head and
     * the list are redrawn, so the search keeps its focus while typing */
    if (!panelParts || !panelHost.shadowRoot.contains(panelParts.search)) {
      const root = panelHost.shadowRoot;
      root.textContent = '';
      const style = el('style');
      style.textContent = PANEL_CSS;
      const box = el('div', 'p');
      const head = el('div', 'hd');
      head.addEventListener('click', () => { panelOpen = !panelOpen; injectPanel(sidebar && sidebar.state); });
      const srch = el('div', 'srch');
      const search = el('input');
      search.type = 'search';
      search.placeholder = 'Search a section, e.g. E106';
      search.setAttribute('aria-label', 'Search your listings by section, listing number or event');
      search.value = panelQuery;
      search.addEventListener('input', () => { panelQuery = search.value; injectPanel(sidebar && sidebar.state); });
      /* typing here must not reach viagogo's own keyboard handling */
      for (const t of ['keydown', 'keyup', 'keypress']) search.addEventListener(t, e => e.stopPropagation());
      const found = el('span', 'm');
      srch.append(search, found);
      const list = el('div');
      box.append(head, srch, list);
      root.append(style, box);
      panelParts = { head, srch, search, found, list };
    }
    const { head, srch, found, list } = panelParts;
    const { groups, hidden } = panelGroups(st);
    const count = groups.reduce((n, g) => n + g.items.length, 0);
    const q = panelQuery.trim();

    head.textContent = '';
    head.append(el('span', 'car', panelOpen ? '▾' : '▸'), el('span', 'logo'), el('b', null, `My listings · ${count}`),
      el('span', 'm', `${groups.length} event${groups.length === 1 ? '' : 's'} · section | tickets | price | win rate | status | gap`), el('span', 'sp'));
    const all = el('button', 'tg', panelAll ? 'Active only' : `Show all${hidden ? ` (+${hidden})` : ''}`);
    all.type = 'button';
    all.title = panelAll ? 'Only active and pending listings' : 'Also deactivated, sold and other listings';
    all.addEventListener('click', e => { e.stopPropagation(); panelAll = !panelAll; injectPanel(st); });
    head.append(all);

    srch.style.display = panelOpen ? '' : 'none';
    found.textContent = q ? `${count} match${count === 1 ? '' : 'es'} "${q}"` : '';
    list.textContent = '';
    if (!panelOpen) return;

    const searched = searchedId();
    if (searched) {
      const now = el('div', 'now');
      now.append(el('span', null, /^\d{5,}$/.test(searched) ? `Showing listing ${searched}` : `Search: "${searched}"`), el('span', 'sp'));
      const clear = el('button', 'tg', 'Clear search');
      clear.type = 'button';
      clear.addEventListener('click', () => searchListing(''));
      now.append(clear);
      list.append(now);
    }
    if (!groups.length) {
      list.append(el('p', 'm', q ? `No listing of yours in a section matching "${q}".`
        : (st.listings || []).length ? 'No active or pending listing saved — press Show all for the rest.'
          : 'No listing saved yet: they are saved as this page shows them.'));
    }
    for (const g of groups) {
      const ev = el('div', 'ev');
      /* while searching, every event with a match is open */
      const folded = !q && panelClosed.has(g.key);
      const h = el('div', 'evh');
      const tickets = g.items.reduce((n, l) => n + (Number((l.money && l.money.listing && l.money.listing.tickets) ?? l.tickets) || 0), 0);
      h.append(el('span', 'car', folded ? '▸' : '▾'), el('b', null, g.title), el('span', 'm', [g.when, `${g.items.length} listing${g.items.length === 1 ? '' : 's'}`, `${tickets} tickets`].filter(Boolean).join(' · ')));
      h.addEventListener('click', () => { if (panelClosed.has(g.key)) panelClosed.delete(g.key); else panelClosed.add(g.key); injectPanel(st); });
      ev.append(h);
      if (!folded) {
        const its = el('div', 'its');
        for (const l of g.items) its.append(panelItem(st, l, l.id === searched));
        ev.append(its);
      }
      list.append(ev);
    }
  }

  function rereadListings() {
    const next = VG.readListingCards(document);
    const sig = JSON.stringify(next.map(x => x.data));
    const changed = sig !== JSON.stringify(cards.map(x => x.data));
    cards = next;
    if (sidebar && sidebar.state) { injectLines(sidebar.state); injectPanel(sidebar.state); }
    if (!changed) return;
    if (next.length && sig !== lastSent) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        lastSent = sig;
        ui.send('saveListings', { items: cards.map(x => x.data) })
          .then(res => {
            if (saveError) { saveError = ''; if (sidebar) sidebar.render(); }
            const f = (res && res.followed) || [];
            if (f.length && sidebar) {
              sidebar.ctx.notice(f.map(x => `Request #${x.num} now asks for ${x.to} (was ${x.from}): listing ${x.listing} went ${x.was} → ${x.to} tickets.`).join(' '));
              sidebar.refresh(true);
            }
          })
          .catch(err => {
            lastSent = '';
            /* Saving used to fail in silence, which looks exactly like a page
             * that was never read — every card saying "Not in Seat Tracker
             * yet" while the real problem was a database that had not been
             * updated. Say it out loud instead. */
            saveError = err.message;
            if (sidebar) sidebar.render();
          });
      }, 1200);
    }
    if (sidebar) sidebar.render();
  }

  /* ---------------- my.viagogo.com/sales -------------------------- *
   * Every sale is read from viagogo's own endpoint (SK.sales), newest
   * first, and saved for its owner. "Scan new sales" stops at the first sale
   * already saved — or, while a saved sale is still unpaid, once it is past
   * the oldest unpaid one. Nothing on the page is clicked.                */

  const SALES_PAGE = 20;
  const SALES_GAP = 500;               // between two requests, plus up to 0.3 s
  let salesScan = null;                // { all, page, read, fresh, stopped, done, error }
  const salesOpen = new Set();         // expanded event keys
  const secOpen = new Set();           // expanded "<event>|<section>"

  const mySales = st => (st && st.sales) || [];

  function salesSubtitle(st) {
    if (salesScan && !salesScan.done) return `Reading sales · ${salesScan.read} read`;
    const n = mySales(st).length;
    return n ? `${n} sale${n === 1 ? '' : 's'} saved` : 'No sales saved yet';
  }

  async function fetchSalesPage(page) {
    const res = await vgFetch(SK.sales.apiUrl(page, SALES_PAGE));
    if (!res.ok) throw new Error(`viagogo answered ${res.status} for the sales list — are you still signed in?`);
    return res.json();
  }

  async function scanSales(ctx, all) {
    if (salesScan && !salesScan.done) return;
    const saved = {};
    for (const s of mySales(ctx.state)) saved[s.id] = s;
    const canStop = all ? () => false : SK.sales.stopRule(saved);
    salesScan = { all, page: 0, read: 0, fresh: 0, stopped: '', done: false, error: '' };
    if (sidebar) sidebar.render();
    const seen = new Set();
    let total = null;
    try {
      /* the endpoint's first page may be 0 or 1: read from 0 and let the IDs say what is new */
      for (let page = 0; page < 500; page++) {
        salesScan.page = page;
        let json;
        try { json = await fetchSalesPage(page); } catch (e) { if (page === 0) continue; throw e; }
        if (total === null && Number.isFinite(SK.sales.totalOf(json))) total = SK.sales.totalOf(json);
        const items = SK.sales.listOf(json).map(SK.sales.saleFromApi).filter(Boolean);
        const fresh = items.filter(x => !seen.has(x.id));
        fresh.forEach(x => seen.add(x.id));
        /* counted from 1, page 0 and page 1 are the same page: one repeat right after the start is not the end */
        if (!fresh.length) { if (page <= 1) continue; break; }
        salesScan.read = seen.size;
        salesScan.fresh += fresh.filter(x => !saved[x.id]).length;
        const stopAt = fresh.findIndex(canStop);
        await ui.send('saveSales', { items: stopAt >= 0 ? fresh.slice(0, stopAt + 1) : fresh });
        if (sidebar) sidebar.render();
        if (stopAt >= 0) { salesScan.stopped = 'reached the sales already saved'; break; }
        if (total !== null && seen.size >= total) break;
        await new Promise(r => setTimeout(r, SALES_GAP + Math.round(Math.random() * 300)));
      }
      if (!seen.size) throw new Error('viagogo returned no sales for this account.');
      ctx.notice(salesScan.fresh
        ? `${salesScan.fresh} new sale${salesScan.fresh === 1 ? '' : 's'} saved · ${salesScan.read} read.`
        : `No new sales · ${salesScan.read} read${salesScan.stopped ? ', stopped at the ones already saved' : ''}.`);
    } catch (e) {
      salesScan.error = e.message;
      ctx.notice(e.message, true);
    }
    salesScan.done = true;
    if (sidebar) { sidebar.render(); sidebar.refresh(true); }
  }

  const lek = (n, signed) => P.formatLek(n, signed);
  const profitCls = n => (n >= 0 ? 'up' : 'dn');

  /* "2026-10-06T20:45:00" -> "Tue, 06 Oct 2026 · 20:45"; anything else is shown as viagogo wrote it */
  function fmtDate(v, withTime) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(v || ''));
    if (!m) return String(v || '');
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    /* written out by hand: browsers disagree on "Sep" and "Sept" */
    const day = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]}, ${m[3]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1]} ${m[1]}`;
    return withTime && m[4] ? `${day} · ${m[4]}:${m[5]}` : day;
  }

  /* { USD: 162 } -> "$162.00", several currencies joined */
  const soldText = sold => Object.entries(sold || {}).map(([c, n]) => P.formatMoney(n, c)).join(' + ') || '—';

  /* tickets · sales · profit, then what it sold for and what it cost — for any level of the grouping */
  function sumLine(t, cls) {
    const box = ui.el('div', 'sl-sum' + (cls ? ' ' + cls : ''));
    const top = ui.el('div', 'sl-sum-row');
    top.append(ui.el('span', null, `${t.tickets} ticket${t.tickets === 1 ? '' : 's'} · ${t.sales} sale${t.sales === 1 ? '' : 's'}`), ui.el('span', 'spacer'));
    if (t.counted) {
      const p = ui.el('span', 'profit ' + profitCls(t.profitL), `${lek(t.profitL, true)} ${P.winRateText(t.winRate)}`);
      p.title = `Profit over ${t.counted} of ${t.sales} sales with a buy price, in lek`;
      top.append(p);
    } else top.append(ui.el('span', 'profit none', 'no buy price'));
    const money = ui.el('div', 'sl-sum-row m');
    const sold = ui.el('span', null, `sold ${soldText(t.sold)}`);
    sold.title = `What viagogo paid for these sales ("Total price" on each card) · ${lek(t.payoutL)} in lek`;
    const spent = ui.el('span', null, t.counted ? `spent ${lek(t.costL)}${t.counted < t.sales ? ` (${t.counted} of ${t.sales} sales)` : ''}` : 'spent —');
    spent.title = 'What the tickets cost you: the buy price × the tickets of every sale that has one';
    money.append(sold, ui.el('span', null, '·'), spent);
    /* spent + profit: what you get back, in lek */
    if (t.counted) {
      const get = ui.el('span', 'get', `you get ${lek(t.costL + t.profitL)}`);
      get.title = `Spent ${lek(t.costL)} + profit ${lek(t.profitL, true)} = ${lek(t.costL + t.profitL)}${t.counted < t.sales ? `, over the ${t.counted} of ${t.sales} sales with a buy price` : ''}${t.unpaid ? ` · ${t.unpaid} sale${t.unpaid === 1 ? '' : 's'} not paid yet` : ''}`;
      money.append(ui.el('span', null, '·'), get);
    }
    box.append(top, money);
    return box;
  }

  function saleRow(s, withSection) {
    const li = ui.el('li', SK.sales.isPaid(s) ? '' : 'unpaid');
    const m = s.money || {};
    /* short in the row ("04 Oct", the year only when it is not this one), in full on hover */
    const full = fmtDate(s.soldOn);
    const short = full ? full.replace(/^\w+, /, '').replace(` ${new Date().getFullYear()}`, '') : '—';
    const sd = ui.el('span', 'sd', short);
    sd.title = s.soldAt ? `Sold ${fmtDate(s.soldAt, true)}` : full ? `Sold ${full}` : 'Sale date';
    const what = [withSection ? s.section : '', `${s.tickets || '?'} tkt`, s.row ? 'row ' + s.row : ''].filter(Boolean).join(' · ');
    const buy = s.buy ? `bought ${P.formatMoney(s.buy.amount, s.buy.currency)} each` : 'no buy price';
    li.append(
      sd,
      ui.el('span', 'sq', what),
      ui.el('span', 'sn', `#${s.id} · ${buy}`),
      ui.el('span', 'sp', P.formatMoney(s.amount, s.currency)),
      /* the profit, and what the sale got back for what the tickets cost: (x2.5) */
      ui.el('span', 'sr ' + (m.missing === null ? profitCls(m.profitL) : 'mut'), m.missing === null ? `${lek(m.profitL, true)} ${P.winRateText(m.winRate)}`.trim() : '—')
    );
    /* spent + profit = what this sale pays you, in lek */
    if (m.missing === null) {
      const bare = (n, signed) => lek(n, signed).replace(/\s*L$/, '');
      const sg = ui.el('span', 'sg', `spent ${bare(m.costL)} + profit ${bare(m.profitL, true)} = you get ${lek(m.costL + m.profitL)}`);
      sg.title = 'In lek: what the tickets cost you, plus the profit, is what this sale pays you';
      li.append(sg);
    }
    if (!SK.sales.isPaid(s)) li.append(ui.el('span', 'pill st-LOW', 'not paid yet'));
    else if (m.deposited) li.append(ui.el('span', 'pill st-OK', 'in bank'));
    li.title = [
      `Sale ${s.id}${s.listingId ? ` · listing ${s.listingId}` : ''}${s.requestNum ? ` · request #${s.requestNum}` : ''}`,
      s.buy ? `Bought at ${P.formatMoney(s.buy.amount, s.buy.currency)} a ticket (${s.buy.source})` : 'No buy price known',
      m.missing === null ? `Sold ${lek(m.payoutL)} − spent ${lek(m.costL)} = ${lek(m.profitL, true)}` : '',
      m.deposited ? `In the bank on ${m.rateDay}, at ${P.rateText(s.amount, m.payoutL, s.currency) || 'its deposit\'s rate'} (fees included)`
        : m.rateDay ? `Lek at today's rate (${m.rateDay}): not in the bank yet` : ''
    ].filter(Boolean).join('\n');
    return li;
  }

  /* a buy price for the sales of one section that have none */
  function buyBox(ctx, sales) {
    const ids = sales.filter(s => s.money && s.money.missing === 'buy').map(s => s.id);
    if (!ids.length) return null;
    const box = ui.el('div', 'sl-buy');
    const input = ui.el('input');
    input.type = 'number';
    input.min = '0';
    input.step = 'any';
    input.placeholder = 'per ticket';
    const cur = ui.el('select');
    for (const c of P.CURRENCIES) { const o = ui.el('option', null, c); o.value = c; cur.append(o); }
    const go = ui.button('Save', 'mini primary', () => ui.busy(go, async () => {
      await ui.send('setSalesBuy', { ids, price: input.value, currency: cur.value });
      ctx.notice(`Buy price saved on ${ids.length} sale${ids.length === 1 ? '' : 's'}.`);
      await ctx.refresh(true);
    }, ctx), 'What one ticket cost you, for the sales here with no buy price');
    box.append(ui.el('span', 'mut', `${ids.length} with no buy price:`), input, cur, go);
    return box;
  }

  /* one event's sales, by section (the default) or as one list */
  const eventView = new Map();         // event key -> 'sections' | 'all'

  function eventBody(ctx, ev) {
    const body = ui.el('div', 'sl-secs');
    const view = eventView.get(ev.key) || 'sections';
    const tabs = ui.el('div', 'sl-tabs');
    for (const [k, label] of [['sections', 'By section'], ['all', 'All sales']]) {
      const b = ui.button(label, 'mini' + (view === k ? ' primary' : ' ghost'), e => { e.stopPropagation(); eventView.set(ev.key, k); ctx.rerender(); });
      b.setAttribute('aria-pressed', String(view === k));
      tabs.append(b);
    }
    body.append(tabs);

    if (view === 'all') {
      const list = ui.el('ul', 'sl-sales');
      const all = ev.sections.flatMap(x => x.sales)
        .sort((a, b) => String(b.soldAt || b.soldOn || '').localeCompare(String(a.soldAt || a.soldOn || '')));
      for (const s of all) list.append(saleRow(s, true));
      body.append(list);
      const b = buyBox(ctx, all);
      if (b) body.append(b);
      return body;
    }
    for (const sec of ev.sections) {
      const k = ev.key + '|' + sec.section;
      const so = secOpen.has(k);
      const box = ui.el('div', 'sl-sec' + (so ? ' open' : ''));
      const h = ui.el('div', 'sl-sec-head');
      h.append(ui.el('span', 'caret', '▸'), ui.el('b', null, sec.section), sumLine(sec.total, 'inline'));
      h.addEventListener('click', () => { if (secOpen.has(k)) secOpen.delete(k); else secOpen.add(k); ctx.rerender(); });
      box.append(h);
      if (so) {
        const list = ui.el('ul', 'sl-sales');
        for (const s of sec.sales) list.append(saleRow(s, false));
        box.append(list);
        const b = buyBox(ctx, sec.sales);
        if (b) box.append(b);
      }
      body.append(box);
    }
    return body;
  }

  function eventCard(ctx, ev) {
    const open = salesOpen.has(ev.key);
    const li = ui.el('li', 'req lcard sl-event' + (open ? ' open' : ''));
    const top = ui.el('div', 'top');
    top.append(ui.el('span', 'caret', '▸'), ui.el('span', 'sec', ev.title || 'Unknown event'), ui.el('span', 'spacer'));
    if (ev.total.unpaid) top.append(ui.el('span', 'dpill d-warn', `${ev.total.unpaid} unpaid`));
    top.addEventListener('click', () => { if (salesOpen.has(ev.key)) salesOpen.delete(ev.key); else salesOpen.add(ev.key); ctx.rerender(); });
    li.append(top);
    const when = ui.el('div', 'detail');
    if (ev.when) {
      const w = ui.el('span', null, fmtDate(ev.when, true));
      w.title = 'When the event takes place';
      when.append(w, document.createTextNode(' · '));
    }
    const last = ui.el('span', null, `last sale ${fmtDate(ev.lastSold) || '—'}`);
    last.title = 'The day of the newest sale for this event';
    when.append(last);
    li.append(when, sumLine(ev.total));
    if (open) li.append(eventBody(ctx, ev));
    return li;
  }

  let salesSearch = null, salesQuery = '';
  let drawSalesEvents = () => {};      // the latest render's list: what the search box redraws

  function renderSales(slot, ctx) {
    const st = ctx.state;
    const sales = mySales(st);
    const busy = salesScan && !salesScan.done;

    const bar = ui.el('div', 'row-acts');
    const scanNew = ui.button(sales.length ? 'Scan new sales' : 'Scan all sales', 'primary mini', () => scanSales(ctx, !sales.length),
      sales.length ? 'Read the newest sales until the ones already saved' : 'Read every sale on every page');
    const scanAll = ui.button('Rescan all', 'ghost mini', () => scanSales(ctx, true), 'Read every sale again, page by page');
    scanNew.disabled = scanAll.disabled = !!busy;
    bar.append(scanNew);
    if (sales.length) bar.append(scanAll);
    slot.append(bar);
    if (busy) slot.append(ui.el('p', 'note', `Reading page ${salesScan.page + 1} · ${salesScan.read} read · ${salesScan.fresh} new so far…`));
    if (salesScan && salesScan.error) slot.append(ui.el('p', 'vg-why warn', salesScan.error));

    if (!sales.length) {
      slot.append(ui.el('p', 'note', busy ? 'Saving as it reads…' : 'Nothing saved yet. Scan all sales once; after that, Scan new sales only reads what came in since.'));
      return;
    }

    const g = SK.sales.groupSales(sales);
    const t = g.total;
    const tiles = ui.el('div', 'vg-tiles two');
    const tile = (value, label, cls, title) => {
      const d = ui.el('div', 'vg-tile' + (cls ? ' ' + cls : ''));
      d.append(ui.el('b', null, value), ui.el('span', null, label));
      if (title) d.title = title;
      return d;
    };
    tiles.append(
      t.counted ? tile(lek(t.profitL, true), `profit · ${P.winRateText(t.winRate).replace(/[()]/g, '')}`, profitCls(t.profitL), `Sold ${lek(t.payoutL)} − spent ${lek(t.costL)}, over the sales with a buy price`) : tile('—', 'no profit yet'),
      tile(soldText(t.sold), `sold · ${t.tickets} tickets`, t.unpaid ? 'warn' : '', `${lek(t.payoutL)} in lek${t.banked ? ` · ${lek(t.bankedL)} of it in the bank (${t.banked} sale${t.banked === 1 ? '' : 's'})` : ''}${t.unpaid ? ` · ${lek(t.unpaidL)} of it not paid yet` : ''} · the rest at today's rate`),
      tile(t.counted ? lek(t.costL) : '—', `spent${t.noBuy ? ` · ${t.noBuy} no buy price` : ''}`, '', 'What the tickets cost you: buy price × tickets'),
      tile(t.counted ? lek(t.costL + t.profitL) : '—', 'you get · spent + profit', '', `Spent ${lek(t.costL)} + profit ${lek(t.profitL, true)}, over the sales with a buy price${t.unpaid ? ` · ${lek(t.unpaidL)} of all sales not paid yet` : ''}`)
    );
    slot.append(tiles);
    if (t.noBuy) slot.append(ui.el('p', 'note', `${t.noBuy} sale${t.noBuy === 1 ? ' has' : 's have'} no buy price, so ${t.noBuy === 1 ? 'it is' : 'they are'} left out of the profit. Open the section to type one.`));

    /* the search box is made once, so typing in it is never redrawn away */
    if (!salesSearch) {
      salesSearch = ui.searchInput(salesQuery, v => { salesQuery = v; drawSalesEvents(); }, { placeholder: 'Search an event', label: 'Search your sales by event name' });
      salesSearch.classList.add('sl-search');
    }
    const head = ui.el('div', 'sk-section-title');
    const count = ui.el('span');
    head.append(count);
    const host = ui.el('ul', 'reqs sl-events');
    const drawEvents = drawSalesEvents = () => {
      const q = SK.util.normKey(salesQuery);
      const shown = q ? g.events.filter(ev => SK.util.normKey(ev.title).includes(q)) : g.events;
      count.textContent = q ? `Events · ${shown.length} of ${g.events.length}` : `Events · ${g.events.length}`;
      host.textContent = '';
      for (const ev of shown) host.append(eventCard(ctx, ev));
      if (!shown.length) host.append(ui.el('li', 'note', `No event matches "${salesQuery.trim()}".`));
    };
    slot.append(salesSearch, head, host);
    drawEvents();
    const newest = sales.reduce((a, s) => (String(s.soldOn) > a ? String(s.soldOn) : a), '');
    slot.append(ui.el('p', 'note', `Newest sale ${fmtDate(newest) || '—'}. Profit in lek at each sale day's rates; "sold" is viagogo's payout, the "Total price" on each card.`));
  }

  /* ---------------- sell.viagogo.com: setting the price ---------------
   * What the team already has in the section being listed — every open
   * request, yours and teammates', with the price each one is listed at —
   * then the sidebar's own price calculator, opened from the start. The
   * event and section are read from viagogo's box on the page; nothing on
   * the page is changed.                                                   */

  /* everyone's open requests in one sector, and listings with no request,
   * cheapest first; unpriced last */
  function sectionTeam(st, ev, sec) {
    const sid = String(sec.id);
    const live = l => ['active', 'pending'].includes(VG.listingStatus(l.status));
    const mine = (st.listings || []).filter(l => l.eventKey === ev.key && String(l.sectorId) === sid && live(l));
    const theirs = SK.team ? SK.team.teamAt(st, { eventKey: ev.key, section: sec.code, sectorId: sec.id }) : [];
    const rows = [];
    const used = new Set();
    for (const r of st.requests.filter(x => x.eventKey === ev.key && String(x.sec) === sid && !x.done)) {
      const l = r.listing ? mine.find(x => String(x.id) === String(r.listing)) : null;
      if (l) used.add('me:' + l.id);
      rows.push({ who: 'You', me: true, num: r.num, qty: r.qty, price: l ? Number(l.price) : null, currency: l ? l.currency : '', listing: r.listing || '', row: l ? l.row : '' });
    }
    for (const l of mine) if (!used.has('me:' + l.id)) {
      rows.push({ who: 'You', me: true, num: null, qty: l.tickets, price: Number(l.price), currency: l.currency, listing: l.id, row: l.row, noRequest: true });
    }
    for (const r of (st.teamRequests || []).filter(x => x.eventKey === ev.key && String(x.sec) === sid)) {
      const t = r.listing ? theirs.find(x => String(x.listingId) === String(r.listing)) : null;
      if (t) used.add('them:' + t.listingId);
      rows.push({ who: r.owner, me: false, qty: r.qty, price: t ? t.price : null, currency: t ? t.currency : '', listing: r.listing, row: t ? t.row : '', seenAt: t ? t.seenAt : 0, stale: t ? t.stale : false });
    }
    for (const t of theirs) if (!used.has('them:' + t.listingId)) {
      rows.push({ who: t.owner, me: false, qty: t.tickets, price: t.price, currency: t.currency, listing: t.listingId, row: t.row, seenAt: t.seenAt, stale: t.stale, noRequest: true });
    }
    const priced = r => Number(r.price) > 0;
    return rows.sort((a, b) => priced(b) - priced(a) || (a.price || 0) - (b.price || 0) || Number(b.me) - Number(a.me));
  }

  function sellTeamBox(st) {
    const box = ui.el('div', 'track-card vg-found vg-team');
    const d = sellDetails;
    if (!d) {
      box.append(ui.el('strong', null, 'Reading the listing…'), ui.el('p', 'note', 'Waiting for viagogo to show the event and the section.'));
      return box;
    }
    box.append(ui.el('strong', null, 'Listing now'));
    box.append(ui.el('div', 'vg-facts', [`${d.qty || '?'} ticket${d.qty === 1 ? '' : 's'}`, d.section ? `Section ${d.section}` : 'no section'].join(' · ')));
    box.append(ui.el('p', 'vg-why', [d.title, d.when].filter(Boolean).join(' · ')));

    const events = st.events.filter(e => !e.archived);
    const auto = VG.pickEvent(d, events);
    const ev = ui.eventOf(st, sellPick || (auto && auto.key));
    if (!ev || !auto || ev.key !== auto.key) {
      /* no match, or a hand pick: let it be chosen (or changed back) */
      const sel = document.createElement('select');
      sel.className = 'sk-select';
      sel.append(new Option('Pick the tracked event…', ''));
      for (const e of events) sel.append(new Option(`[${e.num}] ${e.title}`, e.key, false, !!ev && e.key === ev.key));
      sel.addEventListener('change', () => { sellPick = sel.value; if (sidebar) sidebar.render(); });
      if (!ev) box.append(ui.el('p', 'vg-why warn', 'No tracked event matches this one by date and name — pick it to see the team here.'));
      box.append(sel);
    }
    if (!ev) return box;

    const hit = VG.sectorFor(ev, d.section);
    const sec = hit.code ? ev.sectors.find(s => s.code === hit.code) : null;
    if (!sec) {
      box.append(ui.el('p', 'vg-why warn', hit.how === 'waiting'
        ? `[${ev.num}] ${ev.title}: its sectors are still loading.`
        : `[${ev.num}] ${ev.title} has no sector named "${d.section}", so the team cannot be shown for it.`));
      return box;
    }

    const rows = sectionTeam(st, ev, sec);
    const tickets = rows.reduce((n, r) => n + (Number(r.qty) || 0), 0);
    box.append(ui.el('p', 'vg-why', `[${ev.num}] ${ev.title} · ${sec.code}${auto && auto.key === ev.key ? '' : ' (picked by hand)'}`));
    box.append(sectionTitle(rows.length ? `Team in ${sec.code} · ${rows.length} · ${tickets} tickets` : `Team in ${sec.code}`));
    if (!rows.length) {
      box.append(ui.el('p', 'note', 'Nobody on the team has a request or a listing in this section yet.'));
      return box;
    }
    const cheapest = rows.find(r => Number(r.price) > 0);
    const ul = ui.el('ul', 'vg-team-list');
    for (const r of rows) {
      const li = ui.el('li', (r.me ? 'me' : '') + (r.stale ? ' stale' : ''));
      li.append(
        ui.el('b', null, r.me && r.num ? `You #${r.num}` : r.who),
        ui.el('span', 'm', `${r.qty || '?'} ticket${Number(r.qty) === 1 ? '' : 's'}${r.row ? ` · row ${r.row}` : ''}${r.noRequest ? ' · no request' : ''}`),
        ui.el('span', 'sp'),
        ui.el('span', 'p' + (r === cheapest ? ' low' : ''), Number(r.price) > 0 ? P.formatMoney(r.price, r.currency || 'USD') : 'not listed')
      );
      li.title = [
        r.listing ? `Listing ${r.listing}` : 'No listing linked yet',
        r.seenAt ? `price read ${SK.util.ago(r.seenAt)}${r.stale ? ' — old, check with them' : ''}` : '',
        r === cheapest ? 'the cheapest on the team here' : ''
      ].filter(Boolean).join(' · ');
      ul.append(li);
    }
    box.append(ul);
    box.append(ui.el('p', 'note', 'Prices are what each listing is set to (not viagogo\'s display price), as last read from its owner\'s listings page.'));
    return box;
  }

  /* ---------------- last sales: viagogo's "just sold" toast ---------- *
   * content/sites/viagogo-lastsale.js reads and saves the toast and does the
   * refreshing; this shows it and switches it. */

  const LS = SK.lastSales;
  const U = SK.util;
  let watchOff = null;

  function inMinutes(at) {
    const min = Math.max(0, Math.round((at - Date.now()) / 60000));
    return min < 1 ? 'in under a minute' : `in ${min} min`;
  }

  function saleLine(s) {
    return [`${s.section}${s.row ? ` · row ${s.row}` : ''}`, U.plural(s.tickets, 'ticket'), `Price: ${LS.priceText(s, P.formatMoney)}`].join(' · ');
  }

  function lastSalesBox(st) {
    const W = SK.lastSaleWatch;
    const box = ui.el('div', 'track-card vg-found vg-last');
    box.append(ui.el('strong', null, 'Last sales on viagogo'));
    if (!W || !LS) { box.append(ui.el('p', 'note', 'Reload the page to read viagogo\'s "just sold" toast.')); return box; }
    const w = W.state();
    const ev = W.event();

    /* the scan that asks viagogo by itself, with no page open: this event's place in it */
    if (SK.lastSaleWatchUI) box.append(SK.lastSaleWatchUI(st, ev || {}, { onChange: () => { if (sidebar) sidebar.refresh(true); } }));

    /* reloading this tab, on top of that */
    const row = ui.el('div', 'vg-row');
    row.append(ui.el('span', 'vg-why', 'Reload this tab:'));
    for (const n of [0].concat(LS.EVERY)) {
      row.append(ui.button(n ? `${n} min` : 'Off', w.every === n ? 'mini primary' : 'mini', () => W.set(n),
        n ? `Reload this tab about every ${n} minutes (± 20 %) to catch the next "just sold" toast` : 'Stop refreshing this tab'));
    }
    box.append(row);
    if (w.blockedUntil > Date.now()) {
      box.append(ui.el('p', 'vg-why warn', `viagogo showed its "automated activity" page, so refreshing is stopped on this PC until ${U.fmtClock(w.blockedUntil)}.`));
      box.append(ui.button('Allow refreshing again', 'mini', () => W.unblock(), 'Only once viagogo works normally in this browser again'));
    } else if (w.every && w.nextAt) {
      const why = w.waiting === 'typing' ? ' — put off while you use the page' : w.waiting === 'gap' ? ' — another viagogo tab reloaded a moment ago' : '';
      box.append(ui.el('p', 'vg-why', `Next refresh ${inMinutes(w.nextAt)}${why}. Only this tab, and only while it stays open.`));
    } else {
      box.append(ui.el('p', 'vg-why', 'Off: this tab stays as it is. The scan above does not need it — it asks viagogo with no page open. The toast here is still saved whenever it shows.'));
    }

    /* the toast on this page */
    if (w.toast) {
      const said = w.error ? `not saved: ${w.error}`
        : !w.saved ? 'saving…'
        : w.saved.isNew ? 'saved as a new sale'
        : 'the same sale as the last one saved, skipped';
      box.append(ui.el('p', 'vg-why' + (w.error ? ' warn' : ''), `On this page: ${saleLine(w.toast)} — ${said}.`));
    } else if (w.checked) {
      box.append(ui.el('p', 'vg-why' + (['none', 'sale', 'same', 'recent'].includes(w.checked.kind) ? '' : ' warn'), `No "just sold" toast showed, so viagogo was asked when the page opened: ${checkedText(w.checked)}`));
    } else {
      box.append(ui.el('p', 'vg-why', 'No "just sold" toast on this page yet. If none shows, viagogo is asked once, a few seconds after the page opens.'));
    }

    if (!ev) return box;
    const list = LS.forEvent(st.lastSales || [], ev);
    box.append(sectionTitle(list.length ? `${ev.title} · ${U.plural(list.length, 'sale')}` : ev.title));
    if (!list.length) {
      box.append(ui.el('p', 'note', 'No sale saved for this event yet.'));
      return box;
    }
    const ul = ui.el('ul', 'vg-team-list');
    /* the day's totals count all its sales, not just the 15 listed here */
    const allDays = LS.byDay(list);
    for (const g of LS.byDay(list.slice(0, 15))) {
      const all = allDays.find(x => x.day === g.day) || g;
      ul.append(ui.el('li', 'vg-day', LS.dayLine(all)));
      for (const s of g.sales) ul.append(lastSaleItem(s));
    }
    box.append(ul);
    if (list.length > 15) box.append(ui.el('p', 'note', `…and ${list.length - 15} older, in the event page's drawer.`));
    box.append(ui.el('p', 'note', 'Times are when the sale was first read — the closest there is to when it sold. The price is viagogo\'s for the sale, then per ticket.'));
    return box;
  }

  /* what the check on opening this page came back with */
  function checkedText(r) {
    if (r.kind === 'sale') return `a new sale, saved: ${saleLine(r.sale)}.`;
    if (r.kind === 'same') return 'the same sale as the last one saved, skipped.';
    if (r.kind === 'none') return 'no sale to show.';
    if (r.kind === 'recent') return `not again, it was asked ${U.ago(r.at)}.`;
    if (r.kind === 'blocked') return `not asked, the bot check is on until ${U.fmtAt(r.blockedUntil)}.`;
    return (LS.RESULT_TEXT[r.kind] || 'no answer') + (r.why ? ` (${r.why})` : '') + '.';
  }

  /* one sale in the sidebar's list */
  function lastSaleItem(s) {
    const li = ui.el('li');
    li.append(
      ui.el('b', null, s.section + (s.code && LS.vgKeyOf(s.code) !== LS.vgKeyOf(s.section) ? ` → ${s.code}` : '')),
      ui.el('span', 'm', `${U.plural(s.tickets, 'ticket')} · ${U.fmtClock(s.firstSeen)} · ${U.ago(s.firstSeen)}`),
      ui.el('span', 'sp'),
      ui.el('span', 'p', `Price: ${LS.priceText(s, P.formatMoney)}`)
    );
    li.title = [`Saved ${U.fmtTime(s.firstSeen)}`,
      s.seenBy ? `by ${s.seenBy}` : '', s.eventNum ? `[${s.eventNum}] ${s.eventTitle}` : 'not matched to a tracked event'].filter(Boolean).join(' · ');
    return li;
  }

  function renderSell(slot, ctx) {
    slot.append(lastSalesBox(ctx.state));
  }

  function renderPrice(slot, ctx) {
    if (ctx.calcOpen === undefined) ctx.calcOpen = true;
    slot.append(sellTeamBox(ctx.state));
    slot.append(lastSalesBox(ctx.state));
    slot.append(ui.el('p', 'note', 'Type what one ticket cost you and the price you are thinking of: the calculator below shows what viagogo pays and the profit in lek. Nothing on this page is changed.'));
  }

  function rereadPrice() {
    const next = VG.readSellDetails(document);
    if (JSON.stringify(next) === JSON.stringify(sellDetails)) return;
    if (!next || !sellDetails || next.title !== sellDetails.title) sellPick = '';
    sellDetails = next;
    if (sidebar) sidebar.render();
  }

  /* ---------------- following the page ---------------------------- */

  function rereadConfirmed() {
    const next = VG.readListings(document);
    if (JSON.stringify(next) === JSON.stringify(listings)) return;
    listings = next;
    if (chosen >= listings.length) chosen = 0;
    if (sidebar) sidebar.render();
  }

  const reread = () => {
    if (!ui.alive()) return shutdown();
    if (mode === 'sales') return null;   // nothing to read: sales come from viagogo's endpoint
    return mode === 'price' || mode === 'sell' ? rereadPrice() : mode === 'listings' ? rereadListings() : rereadConfirmed();
  };

  function start(next) {
    mode = next;
    listings = []; chosen = 0; filledFor = ''; pick = null;
    cards = []; adding = null; lastSent = ''; saveError = ''; sellDetails = null; sellPick = '';
    sidebar = SK.shell.create({
      site: 'viagogo',
      pageKey: mode,
      slotFirst: true,
      /* viagogo keeps its own price tools on the right of its listings pages;
       * on the price step the right side is free */
      side: mode === 'price' || mode === 'sell' ? 'right' : 'left',
      title: () => (mode === 'price' ? 'viagogo price' : mode === 'sell' ? 'viagogo sell' : mode === 'sales' ? 'viagogo sales' : mode === 'listings' ? 'viagogo listings' : 'viagogo listing'),
      subtitle: st => (mode === 'price' ? 'Work out a price before you set it' : mode === 'sell' ? 'The event\'s last sales' : mode === 'sales' ? salesSubtitle(st) : mode === 'listings'
        ? (cards.length ? `${cards.length} listing${cards.length === 1 ? '' : 's'} read on this page` : 'Reading the page…')
        : listings.length > 1 ? `${listings.length} listings on this page` : listings.length ? 'Add it to Seat Tracker' : 'Reading the page…'),
      renderSlot: (slot, ctx) => (mode === 'price' ? renderPrice(slot, ctx) : mode === 'sell' ? renderSell(slot, ctx) : mode === 'sales' ? renderSales(slot, ctx) : mode === 'listings' ? renderListings(slot, ctx) : renderConfirmed(slot, ctx))
    });
    /* viagogo draws its cards after the page loads; the sidebar and the card lines live in shadow roots */
    observer = new MutationObserver(() => { clearTimeout(readTimer); readTimer = setTimeout(reread, 250); });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
    if ((mode === 'sell' || mode === 'price') && SK.lastSaleWatch) watchOff = SK.lastSaleWatch.subscribe(() => { if (sidebar) sidebar.render(); });
    reread();
    /* an event scan expires on its own: redraw so it leaves the cards on time */
    expiryTimer = setInterval(() => {
      if (!sidebar || !sidebar.state || !(sidebar.state.compares || []).length) return;
      injectLines(sidebar.state);
      sidebar.render();
    }, 60000);

    /* Either a sweep dropped a search filter and reloaded, or the popup sent
     * us here to run one. Both pick up once viagogo has drawn the list. */
    const asked = location.hash === '#sk-sweep' || location.hash === '#sk-scan';
    if (mode === 'listings' && asked) {
      history.replaceState(null, '', location.pathname + location.search);
      /* the list comes from viagogo's JSON, so nothing has to be drawn first */
      if (sidebar) { sidebar.open(); startSession(sidebar.ctx); }
    }
  }

  function stop() {
    if (!sidebar) return;
    sidebar.destroy();
    sidebar = null;
    if (observer) observer.disconnect();
    observer = null;
    clearTimeout(readTimer);
    clearTimeout(saveTimer);
    clearInterval(expiryTimer);
    if (watchOff) { watchOff(); watchOff = null; }
    document.querySelectorAll('[data-sk-line]').forEach(n => n.remove());
    mode = null;
    if (panelHost) { panelHost.remove(); panelHost = null; panelParts = null; }
  }

  let lastHref = '';
  function follow() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    const next = VG.isConfirmedPage(location) ? 'confirmed' : VG.isListingsPage(location) ? 'listings'
      : VG.isPricePage(location) ? 'price'
      : SK.lastSales && SK.lastSales.isSellPage(location) ? 'sell'
      : SK.sales && SK.sales.isSalesPage(location) ? 'sales' : null;
    if (next === mode) { if (mode) { clearTimeout(readTimer); readTimer = setTimeout(reread, 250); } return; }
    stop();
    if (next) start(next);
  }
  /* the extension was reloaded while this tab stayed open: stop following the page for good */
  let followTimer = null;
  function shutdown() {
    stop();
    clearInterval(followTimer);
    window.removeEventListener('popstate', guardedFollow);
  }
  function guardedFollow() {
    if (!ui.alive()) return shutdown();
    return follow();
  }
  guardedFollow();
  followTimer = setInterval(guardedFollow, 1000);
  window.addEventListener('popstate', guardedFollow);
})();
