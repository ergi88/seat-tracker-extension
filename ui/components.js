/* ------------------------------------------------------------------
 * Seat Tracker - UI pieces shared by the popup and the on-site sidebar
 *
 * Plain DOM builders. They work in a normal page and inside the sidebar's
 * shadow root. Every change goes to the service worker as a message.
 *
 * ctx = {
 *   state,            the last `state` from the service worker
 *   expanded: Set,    request ids whose edit panel is open
 *   addDraft,         the add form's half-typed values
 *   refresh(force), rerender(), notice(text, isError), openUrl(url),
 *   onShow(request)?  sidebar only: "Show on map"
 *   idPrefix          keeps datalist ids unique
 * }
 * Exposed as SK.ui.
 * ------------------------------------------------------------------ */
(function (root) {
  'use strict';
  const SK = root.SK;
  const U = SK.util;

  /* ---------------- basics ----------------------------------------- */

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* false once the extension was reloaded, updated or removed: a script still
   * running in an open tab is then an orphan, and every chrome.* call throws */
  function alive() {
    try { return !!(globalThis.chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }

  function send(type, extra) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(Object.assign({ type }, extra || {}), res => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!res) return reject(new Error('no response from the extension'));
          if (res.ok) resolve(res.data); else reject(new Error(res.error));
        });
      } catch (e) {
        reject(new Error('The extension was reloaded — refresh this page.'));
      }
    });
  }

  function applyTheme(node, theme) {
    if (!node) return;
    if (theme === 'dark' || theme === 'light') node.setAttribute('data-theme', theme);
    else node.removeAttribute('data-theme');
  }

  /* an input being typed in must never be re-rendered away */
  function typingIn(rootNode) {
    const a = rootNode && rootNode.activeElement;
    if (!a) return false;
    if (a.tagName === 'SELECT' || a.tagName === 'TEXTAREA') return true;
    return a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file'].includes(a.type);
  }

  /* Would this address load in the page we are already in? True only inside a
   * site's own sidebar — the popup is its own document, so it always opens a
   * tab. Used to keep a listing on the listings page instead of stacking tabs. */
  function sameSite(url) {
    try {
      return typeof location === 'object' && !!location.origin && new URL(url, location.href).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  const statusClass = s => 'st-' + (!s ? 'idle' : s === 'NOT SCANNED' ? 'NONE' : s);
  const eventOf = (state, key) => (state && key ? state.events.find(e => e.key === key) || null : null);
  const siteOf = (state, id) => (state && state.sites.find(s => s.id === id)) || { id, label: id, can: {}, pages: [] };
  const sectorIn = (ev, id) => (ev ? ev.sectors.find(s => String(s.id) === String(id)) || null : null);

  function button(text, cls, onClick, title) {
    const b = el('button', cls || '', text);
    b.type = 'button';
    if (title) b.title = title;
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function dot(status) { return el('span', 'dot ' + statusClass(status)); }

  function labelled(text, control, cls) {
    const l = el('label', cls || '');
    l.append(el('span', null, text), control);
    return l;
  }

  function checkbox(text, checked, onChange, cls) {
    const l = el('label', 'check' + (cls ? ' ' + cls : ''));
    const i = el('input');
    i.type = 'checkbox';
    i.checked = !!checked;
    i.addEventListener('change', () => onChange(i.checked));
    l.append(i, el('span', null, text));
    return l;
  }

  function numberInput(value, min, onChange, placeholder) {
    const i = el('input');
    i.type = 'number';
    i.min = String(min);
    i.value = value === undefined || value === null ? '' : String(value);
    if (placeholder !== undefined) i.placeholder = String(placeholder);
    if (onChange) i.addEventListener('change', () => onChange(i.value));
    return i;
  }

  function textInput(value, onChange, placeholder) {
    const i = el('input');
    i.type = 'text';
    i.value = value || '';
    i.autocomplete = 'off';
    i.spellcheck = false;
    if (placeholder) i.placeholder = placeholder;
    if (onChange) i.addEventListener('change', () => onChange(i.value.trim()));
    return i;
  }

  function segmented(options, value, onChange) {
    const box = el('div', 'seg');
    for (const o of options) {
      const b = button(o.label, o.value === value ? 'on' : '', () => onChange(o.value));
      box.append(b);
    }
    return box;
  }

  async function busy(btn, fn, ctx) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      return await fn();
    } catch (e) {
      if (ctx && ctx.notice) ctx.notice(e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  /* ---------------- "?" help ---------------------------------------- */

  function helpButton(key, host) {
    const b = button('?', 'help-btn', e => {
      e.preventDefault();
      e.stopPropagation();
      openHelp(key, typeof host === 'function' ? host() : host);
    }, 'What do these do?');
    return b;
  }

  function openHelp(key, host) {
    const sec = SK.help && SK.help.sections[key];
    if (!sec || !host) return;
    host.querySelectorAll(':scope > .drawer-wrap').forEach(n => n.remove());

    const wrap = el('div', 'drawer-wrap');
    const back = el('div', 'drawer-back');
    const sheet = el('div', 'drawer');
    const close = () => wrap.remove();

    const head = el('div', 'drawer-head');
    const x = button('✕', 'ghost icon', close, 'Close');
    head.append(el('strong', null, sec.title), x);

    const body = el('div', 'drawer-body');
    if (sec.intro) body.append(el('p', 'drawer-intro', sec.intro));
    for (const it of sec.items) {
      const item = el('div', 'help-item');
      const name = el('div', 'help-name', it.name);
      if (it.def) name.append(el('span', 'help-def', 'default: ' + it.def));
      item.append(name, el('div', 'help-text', it.text));
      body.append(item);
    }

    const foot = el('div', 'drawer-foot');
    foot.append(button('Open the full guide ↗', '', () => send('openPage', { path: 'help/help.html#' + key }).catch(() => {})));

    sheet.append(head, body, foot);
    back.addEventListener('click', close);
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    wrap.append(back, sheet);
    host.append(wrap);
    x.focus();
  }

  /* ---------------- prices ------------------------------------------ */

  function priceOptions(state, ev, secId) {
    const out = [{ value: '', text: 'All prices' }];
    const scan = state.scans[ev.key] && state.scans[ev.key][secId];
    if (scan && !scan.unmapped) {
      for (const p of SK.rules.sectorPrices(scan, ev.cats, ev.currency)) out.push({ value: String(p.key), text: `${p.text} · ${p.avail} free` });
    } else {
      const keys = Object.keys(ev.cats || {}).sort((a, b) => (ev.cats[b].price || -1) - (ev.cats[a].price || -1));
      for (const k of keys) out.push({ value: k, text: SK.rules.priceText(ev.cats, k, ev.currency) });
    }
    return out;
  }

  /* Toggle chips: pick one or more prices, or All prices. Seats at any of the
   * picked prices may sit together; a seat at another price breaks a block. */
  function priceChips(state, ev, secId, current, onChange) {
    const box = el('div', 'chips');
    const picked = new Set((current || []).map(String));
    const options = priceOptions(state, ev, secId).slice(1);
    const toggle = value => {
      const next = new Set(picked);
      if (next.has(value)) next.delete(value); else next.add(value);
      onChange([...next]);
    };
    const all = button('All prices', 'chip-btn' + (picked.size ? '' : ' on'), () => { if (picked.size) onChange([]); });
    all.setAttribute('aria-pressed', picked.size ? 'false' : 'true');
    box.append(all);
    for (const o of options) {
      const b = button(o.text, 'chip-btn' + (picked.has(o.value) ? ' on' : ''), () => toggle(o.value));
      b.setAttribute('aria-pressed', picked.has(o.value) ? 'true' : 'false');
      box.append(b);
    }
    /* a picked price this sector does not sell stays visible so it can be removed */
    for (const k of picked) {
      if (options.some(o => o.value === k)) continue;
      const b = button(SK.rules.priceText(ev.cats, k, ev.currency) + ' · none here', 'chip-btn on', () => toggle(k));
      b.title = 'This sector has no seats at this price — click to remove it';
      box.append(b);
    }
    return box;
  }

  /* a labelled group that is not a <label> (it holds several controls) */
  function fieldBox(text, control, cls) {
    const box = el('div', 'field' + (cls ? ' ' + cls : ''));
    box.append(el('span', null, text), control);
    return box;
  }

  /* ---------------- request cards ----------------------------------- */

  async function mutate(ctx, id, changes) {
    try { await send('updateRequest', { id, changes }); }
    catch (e) { ctx.notice(e.message, true); }
    ctx.refresh(true);
  }

  function requestCard(r, ctx) {
    const st = ctx.state;
    const ev = eventOf(st, r.eventKey);
    const site = siteOf(st, ev ? ev.site : '');
    const open = ctx.expanded.has(r.id);
    /* bought: a status of its own, in its own colour, never faded */
    const bought = !!r.bought && !r.done;
    const li = el('li', `req ${statusClass(r.eval.status)}${r.done || (r.muffled && !bought) ? ' done' : ''}${open ? ' open' : ''}`);

    const toggle = () => {
      if (ctx.expanded.has(r.id)) ctx.expanded.delete(r.id); else ctx.expanded.add(r.id);
      ctx.rerender();
    };

    const top = el('div', 'top');
    /* picked for a bulk delete (see requestList) */
    if (ctx.selected) {
      const pick = el('input', 'pick');
      pick.type = 'checkbox';
      pick.checked = ctx.selected.has(r.id);
      pick.title = `Select #${r.num} to delete it with others`;
      pick.setAttribute('aria-label', `Select request #${r.num}`);
      pick.addEventListener('click', e => e.stopPropagation());
      pick.addEventListener('change', () => {
        if (pick.checked) ctx.selected.add(r.id); else ctx.selected.delete(r.id);
        ctx.rerender();
      });
      top.append(pick);
      if (pick.checked) li.classList.add('picked');
    }
    top.append(el('span', 'num', '#' + r.num));
    const sec = el('span', 'sec', r.code);
    sec.title = r.sectorName;
    top.append(sec);
    if (r.priceTag) top.append(el('span', 'chip', r.priceTag));
    const pill = el('span', 'pill ' + statusClass(r.eval.status), r.eval.status === 'NOT SCANNED' ? 'not scanned' : r.eval.status);
    if (r.pendingGone) pill.title = 'Looks unfillable — the next scan confirms it before you are alerted';
    top.append(pill);
    /* its listing was switched off by an older build: the card stays, the alerts don't */
    if (r.muffled && !bought) {
      const why = el('span', 'pill', 'ignored');
      why.title = 'You switched this listing off — no scans, no alerts, no badge. Its profit still counts.';
      top.append(why);
    }
    if (r.client) top.append(el('span', 'client', r.client));
    top.append(el('span', 'spacer'));
    /* the short link sits in the busy top row; the longer profit goes on the line below */
    if (r.listingUrl) {
      /* On viagogo itself this stays in the tab you are already in; anywhere
       * else it opens one. ctx.openUrl knows which, and the href is left alone
       * so a middle click still opens a tab wherever you are. */
      const here = !!ctx.openUrl && sameSite(r.listingUrl);
      const a = el('a', 'listing-link', here ? 'Listing' : 'Listing ↗');
      a.href = r.listingUrl;
      a.rel = 'noopener noreferrer';
      if (!here) a.target = '_blank';
      a.title = here ? `Show viagogo listing ${r.listing} on this page` : `Open viagogo listing ${r.listing} in a new tab`;
      a.addEventListener('click', e => {
        e.stopPropagation();
        if (!here) return;
        e.preventDefault();
        ctx.openUrl(r.listingUrl);
      });
      top.append(a);
    }

    const step = el('span', 'stepper');
    step.append(
      button('−', 'mini', e => { e.stopPropagation(); mutate(ctx, r.id, { qty: Math.max(1, r.qty - 1) }); }, 'One ticket less'),
      el('span', 'qty', String(r.qty)),
      button('+', 'mini', e => { e.stopPropagation(); mutate(ctx, r.id, { qty: r.qty + 1 }); }, 'One ticket more')
    );
    top.append(step, button(open ? '▴' : '▾', 'ghost mini caret', e => { e.stopPropagation(); toggle(); }, open ? 'Close' : 'Edit'));
    top.addEventListener('click', e => { if (!e.target.closest('button, input, select, a')) toggle(); });
    /* short line: "485 free · 36 options" on the left, "+13,812 L (x1.6)" on the right */
    const info = el('div', 'detail split');
    if (bought) info.append(el('span', null, 'you have these tickets · not tracked'));
    else if (r.eval.status === 'NOT SCANNED') info.append(el('span', null, r.scanNote || 'not scanned yet'));
    else info.append(el('span', null, `${r.free} free · ${U.plural(r.eval.options, 'option')}`));
    const chip = profitChip(r.profit);
    if (chip) info.append(chip);                          // pushed to the right edge by .split
    li.append(top, info);
    /* Holding seats is only offered where the page can do it, and only for as
     * many as you ask for now: a request for 10 with 4 already sold needs 4. */
    if (ctx.onReserve && !r.done && !bought && (!ctx.canReserve || ctx.canReserve(r))) {
      const line = el('div', 'reserve-line');
      const qty = el('input');
      qty.type = 'number';
      qty.min = '1';
      qty.value = String(r.qty);
      qty.title = 'How many seats to hold now';
      qty.addEventListener('click', e => e.stopPropagation());
      const go = button('Reserve', 'mini', e => {
        e.stopPropagation();
        const n = Math.max(1, parseInt(qty.value, 10) || r.qty);
        ctx.onReserve(r, n);
      }, `Hold seats next to each other in ${r.code} — nothing is bought, you finish on the site`);
      line.append(el('span', 'buylabel', 'Hold'), qty, go);
      li.append(line);
    }

    if (open) {
      const knobs = el('div', 'knobs');
      if (!r.done) knobs.append(checkbox('Bought', !!r.bought, v => mutate(ctx, r.id, { bought: v }), 'wide'));
      /* a bought request never warns, so its warning knobs wait (kept) until it is tracked again */
      if (site.can.prices && ev && !bought) knobs.append(fieldBox('Prices', priceChips(st, ev, r.sec, r.cats, v => mutate(ctx, r.id, { cats: v })), 'wide'));
      if (!bought) {
        knobs.append(
          labelled('Block warn', numberInput(r.warn, 0, v => mutate(ctx, r.id, { warn: v }))),
          labelled('Options warn', numberInput(r.opts, 0, v => mutate(ctx, r.id, { opts: v })))
        );
      }
      knobs.append(
        labelled('Client', textInput(r.client, v => mutate(ctx, r.id, { client: v }), 'optional')),
        labelled('Listing ID', textInput(r.listing, v => mutate(ctx, r.id, { listing: v }), 'viagogo listing'))
      );
      if (!bought) knobs.append(checkbox('Seats side by side', r.together !== false, v => mutate(ctx, r.id, { together: v }), 'wide'));
      knobs.append(moneyBox(r), buyField(ctx, r));
      const acts = el('div', 'acts wide');
      const url = r.sectorUrl || (ev && ev.url);
      if (url) acts.append(button(r.sectorUrl ? 'Open sector ↗' : 'Open event ↗', 'mini', () => ctx.openUrl(url)));
      if (ctx.onShow) acts.append(button('Show on map', 'mini', () => ctx.onShow(r)));
      acts.append(el('span', 'spacer'));
      acts.append(button(r.done ? 'Reopen' : 'Done', 'mini', () => mutate(ctx, r.id, { done: !r.done })));
      acts.append(button('Delete', 'mini danger', async () => {
        if (!confirm(`Delete request #${r.num} (${r.code})? Its number is never reused.`)) return;
        try { await send('deleteRequest', { id: r.id }); } catch (e) { ctx.notice(e.message, true); }
        ctx.refresh(true);
      }));
      knobs.append(acts);
      li.append(knobs);
    }
    return li;
  }

  /* ---------------- money ------------------------------------------- */

  /* "+13,812 L (x1.6)" — profit in lek if every listed ticket sells, and the win rate */
  function profitChip(p) {
    if (!p) return null;
    const P = SK.profit;
    if (p.missing === 'buy') return el('span', 'profit none', 'no buy price');
    if (p.missing === 'rate') return el('span', 'profit none', 'no rate yet');
    if (p.missing) return null;
    const c = el('span', 'profit ' + (p.total >= 0 ? 'up' : 'dn'), `${P.formatLek(p.total, true)} ${P.winRateText(p.winRate)}`);
    c.title = `Profit in lek if all ${p.tickets} listed tickets sell · win rate = what you get ÷ what they cost`;
    return c;
  }

  /* ---------------- the team ---------------------------------------- */

  /* "Team · Sam Rivers $22 (4) · Ana $25" — what teammates sell this section
   * for. Their real price, as their own listings page last showed it; never
   * their payout. */
  function teamLine(team, opts) {
    const o = opts || {};
    if (!team || !team.length) return null;
    const P = SK.profit;
    const line = el('div', 'team-line' + (o.cls ? ' ' + o.cls : ''));
    line.append(el('span', 'team-label', o.label || 'Team'));
    for (const t of team) {
      const one = el('span', 'team-one' + (t.stale ? ' stale' : ''));
      one.append(el('b', null, t.owner), el('span', null, P.formatMoney(t.price, t.currency)));
      if (t.tickets) one.append(el('span', 'm', `${t.tickets}`));
      one.title = `${t.owner} lists ${t.section || 'this section'}${t.row ? ` row ${t.row}` : ''} at ${P.formatMoney(t.price, t.currency)}`
        + `${t.tickets ? ` · ${t.tickets} tickets` : ''} · read ${U.ago(t.seenAt)}${t.stale ? ' — old, check with them' : ''}`;
      line.append(one);
    }
    return line;
  }

  /* Type something and send it to teammates' phones. Nothing is ever sent on
   * its own: this is the only way a team message goes out. */
  function messageBox(st, opts, ctx) {
    const o = opts || {};
    const mates = ((st && st.team) || []).filter(x => !x.me);
    const box = el('div', 'msg-box');
    if (!mates.length) {
      box.append(el('p', 'note', 'Nobody else has signed in to the team yet.'));
      return box;
    }
    const picked = new Set(mates.map(x => x.userId));
    if (mates.length > 1) {
      const who = el('div', 'msg-who');
      for (const mate of mates) {
        who.append(checkbox(mate.name, true, v => { if (v) picked.add(mate.userId); else picked.delete(mate.userId); }, 'mini'));
      }
      box.append(who);
    }
    const text = el('textarea', 'msg-text');
    text.rows = 2;
    text.value = o.prefill || '';
    text.placeholder = o.placeholder || 'e.g. only our listings in E105 — raising to $120';
    text.spellcheck = false;
    box.append(text);
    const foot = el('div', 'msg-foot');
    const go = button(o.sendLabel || 'Send to phones', 'primary mini', () => busy(go, async () => {
      const res = await send('notifyTeam', {
        text: text.value, to: [...picked],
        eventKey: o.eventKey || null, section: o.section || '', click: o.click || ''
      });
      const names = (res.sent || []).map(x => x.name + (x.skipped ? ` (${x.skipped})` : ''));
      if (ctx) ctx.notice(`Sent to ${names.join(', ')}.`);
      text.value = '';
      if (o.onSent) o.onSent();
    }, ctx));
    foot.append(el('span', 'note', mates.length > 1 ? 'Goes to the teammates ticked above.' : `Goes to ${mates[0].name}.`), el('span', 'spacer'), go);
    box.append(foot);
    text.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") go.click();
    });
    return box;
  }

  /* Try another sell price without touching viagogo: what it would pay out,
   * what it would earn, and how that compares with the price set now. Nothing
   * here changes a listing — it is for thinking before you do. */
  function calculator(money, opts) {
    const P = SK.profit;
    const o = opts || {};
    const box = el('div', 'calc');
    const L = (money && money.listing) || {};
    if (!money || !money.ratio || money.missing === 'listing') {
      box.append(el('p', 'note', 'viagogo has not shown a price and a payout for this listing yet.'));
      return box;
    }
    const head = el('div', 'calc-head');
    const input = el('input');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.value = String(o.price !== undefined && o.price !== '' ? o.price : L.price || '');
    input.setAttribute('aria-label', 'A sell price to try');
    head.append(el('span', 'calc-label', `Sell price${L.currency ? ' (' + L.currency + ')' : ''}`), input);
    const out = el('div', 'calc-out');
    const row = (label, value, cls) => {
      const d = el('div', 'mrow' + (cls ? ' ' + cls : ''));
      d.append(el('span', null, label), el('span', null, value));
      out.append(d);
    };
    const draw = () => {
      out.textContent = '';
      const at = P.atPrice(money, input.value);
      if (!at) { out.append(el('p', 'note', 'Type a price above to see what it would earn.')); return; }
      row('viagogo pays you', `${P.formatMoney(at.payoutPerTicket, at.currency)} each · ${P.formatMoney(at.payout, at.currency)} for ${at.tickets}`);
      if (at.total === undefined) {
        out.append(el('p', 'note', 'No buy price yet — add one on the request to see the profit.'));
        return;
      }
      row('The tickets cost', `${P.formatLek(at.costL)} each`);
      row('Profit', `${P.formatLek(at.perTicket, true)} each · ${P.formatLek(at.total, true)} in all ${P.winRateText(at.winRate)}`,
        'sum ' + (at.total >= 0 ? 'up' : 'dn'));
      if (money.total !== undefined && L.price) {
        const diff = at.total - money.total;
        row(`Against your ${P.formatMoney(L.price, at.currency)}`,
          Math.round(Math.abs(diff)) < 1 ? 'the same' : `${P.formatLek(diff, true)} ${diff > 0 ? 'more' : 'less'}`,
          Math.round(Math.abs(diff)) < 1 ? '' : diff > 0 ? 'up' : 'dn');
      }
      if (money.breakEven) {
        row('Break-even', P.formatMoney(money.breakEven, at.currency), at.price < money.breakEven ? 'dn' : '');
      }
      if (at.price < (money.breakEven || 0)) out.append(el('p', 'note warn-line', 'Below your break-even: every ticket sold loses money.'));
    };
    input.addEventListener('input', () => { draw(); if (o.onPrice) o.onPrice(input.value); });
    draw();
    box.append(head);
    const chips = targetChips(money.breakEven, L.currency, price => {
      input.value = String(price);
      draw();
      if (o.onPrice) o.onPrice(input.value);
    });
    if (chips) box.append(chips);
    box.append(out);
    if (money.rateDay) box.append(el('div', 'mnote', `lek at the rates of ${money.rateDay}`));
    return box;
  }

  /* What to ask to get 1.5, 2, 2.5 or 3 times what the tickets cost. They sit
   * under the prices as references; pressing one fills the ask in. */
  function targetChips(breakEven, currency, onPick) {
    const P = SK.profit;
    if (!(breakEven > 0)) return null;
    const box = el('div', 'calc-targets');
    box.append(el('span', 'pcalc-label', 'Ask for'));
    for (const w of P.WIN_TARGETS) {
      const price = P.askFor(breakEven, w);
      const chip = button(`×${w} ${P.formatMoney(price, currency)}`, 'mini chip',
        () => onPick && onPick(price),
        `Ask ${P.formatMoney(price, currency)} to get ${w} times what the tickets cost back`);
      box.append(chip);
    }
    return box;
  }

  /* A calculator with no listing behind it: type what the tickets cost and
   * what you would ask, in any two currencies, and see the same figures a real
   * listing gets. What you type is kept for next time. */
  function priceCalculator(st, opts) {
    const P = SK.profit;
    const o = opts || {};
    const box = el('div', 'calc pcalc');
    const rates = (st.fx && st.fx.rates) || {};
    const learned = P.keepRatio(st.listings);
    const d = Object.assign(
      { buy: '', buyCurrency: P.BASE, sell: '', sellCurrency: 'USD', tickets: 1,
        keepPct: learned ? Math.round(learned * 1000) / 10 : 100 },
      o.value || {}
    );

    const money = (label, key, curKey) => {
      const row = el('div', 'pcalc-row');
      const input = numberInput(d[key], 0, v => { d[key] = v; changed(); }, '0');
      input.step = 'any';
      input.addEventListener('input', () => { d[key] = input.value; draw(); });
      const sel = el('select');
      for (const c of P.CURRENCIES) {
        const op = el('option', null, c);
        op.value = c;
        op.selected = d[curKey] === c;
        sel.append(op);
      }
      sel.addEventListener('change', () => { d[curKey] = sel.value; changed(); });
      row.append(el('span', 'pcalc-label', label), input, sel);
      return row;
    };

    const tickets = numberInput(d.tickets, 1, v => { d.tickets = v; changed(); });
    tickets.addEventListener('input', () => { d.tickets = tickets.value; draw(); });
    const keep = numberInput(d.keepPct, 0, v => { d.keepPct = v; changed(); });
    keep.step = 'any';
    keep.max = '100';
    keep.addEventListener('input', () => { d.keepPct = keep.value; draw(); });
    const bottom = el('div', 'pcalc-row');
    bottom.append(el('span', 'pcalc-label', 'Tickets'), tickets,
      el('span', 'pcalc-label wide', 'viagogo pays'), keep, el('span', 'pcalc-label', '%'));

    const targets = el('div', 'calc-target-host');
    const out = el('div', 'calc-out');
    const row = (label, value, cls) => {
      const r = el('div', 'mrow' + (cls ? ' ' + cls : ''));
      r.append(el('span', null, label), el('span', null, value));
      out.append(r);
    };

    function drawTargets() {
      targets.textContent = '';
      const be = P.breakEvenAsk({ buy: d.buy, buyCurrency: d.buyCurrency, sellCurrency: d.sellCurrency, keep: Number(d.keepPct) / 100 }, rates);
      const chips = targetChips(be, d.sellCurrency, price => {
        d.sell = price;
        const input = box.querySelectorAll('.pcalc-row input')[1];
        if (input) input.value = String(price);
        changed();
      });
      if (chips) targets.append(chips);
    }

    function draw() {
      drawTargets();
      out.textContent = '';
      const q = P.quote({
        buy: d.buy, buyCurrency: d.buyCurrency, sell: d.sell, sellCurrency: d.sellCurrency,
        tickets: d.tickets, keep: Number(d.keepPct) / 100
      }, rates);
      if (q.missing === 'sell') { out.append(el('p', 'note', 'Type what you would ask per ticket.')); return; }
      if (q.missing === 'rate') { out.append(el('p', 'note warn-line', `No rate for ${q.currency} yet — it arrives with the daily rates, or type one in Settings → Money.`)); return; }
      const perTicket = Number(d.sell) * q.ratio;
      row('viagogo pays you', `${P.formatMoney(perTicket, d.sellCurrency)} each · ${P.formatMoney(perTicket * q.tickets, d.sellCurrency)} for ${q.tickets}`);
      row('That is', `${P.formatLek(q.payoutL)} each`);
      if (q.missing === 'buy') { out.append(el('p', 'note', 'Add what the tickets cost to see the profit.')); return; }
      row('They cost', `${P.formatLek(q.costL)} each`);
      row('Profit', `${P.formatLek(q.perTicket, true)} each · ${P.formatLek(q.total, true)} in all ${P.winRateText(q.winRate)}`,
        'sum ' + (q.total >= 0 ? 'up' : 'dn'));
      row('Break-even ask', P.formatMoney(q.breakEven, d.sellCurrency), Number(d.sell) < q.breakEven ? 'dn' : '');
    }

    function changed() {
      draw();
      if (o.onChange) o.onChange(Object.assign({}, d));
    }

    box.append(money('Buy', 'buy', 'buyCurrency'), money('Ask', 'sell', 'sellCurrency'), bottom, targets, out);
    draw();
    const note = [st.fx && st.fx.day ? `lek at the rates of ${st.fx.day}` : 'no rates yet',
      learned ? `viagogo's share learned from your listings` : 'no listings read yet — set the share yourself'].join(' · ');
    box.append(el('div', 'mnote', note));
    return box;
  }

  /* the working behind the chip: viagogo price and payout, buy price, profit, break-even, team prices */
  function moneyBox(r) {
    const P = SK.profit;
    const box = el('div', 'money wide');
    const row = (label, value, cls) => {
      const d = el('div', 'mrow' + (cls ? ' ' + cls : ''));
      d.append(el('span', null, label), el('span', null, value));
      box.append(d);
    };
    const p = r.profit;
    const L = p && p.listing;
    if (!r.listing) row('viagogo', 'no Listing ID yet');
    else if (!L) row('viagogo', 'open your viagogo listings page to read it');
    else {
      row('viagogo price', `${P.formatMoney(L.price, L.currency)} / ticket · ${L.tickets} listed${L.status ? ' · ' + L.status : ''}`);
      if (p.payoutL !== undefined) row('You get', `${P.formatMoney(L.payout / L.tickets, L.currency)} = ${P.formatLek(p.payoutL)}`);
      else row('You get', L.currency ? `no ${L.currency} rate yet` : 'currency not recognised');
    }
    const b = r.buy;
    if (b) {
      const range = b.range ? ` (${b.range.map(x => P.formatMoney(x, b.currency)).join('–')})` : '';
      const lek = b.currency !== P.BASE && p && p.costL !== undefined ? ` = ${P.formatLek(p.costL)}` : '';
      row(`Buy · ${b.source}`, `${P.formatMoney(b.amount, b.currency)}${range}${lek}`);
    } else {
      row('Buy', 'no price from the site — type it below');
    }
    if (p && p.missing === null) {
      row(`Profit · ${p.tickets} tickets`, `${P.formatLek(p.total, true)} ${P.winRateText(p.winRate)}`, 'sum ' + (p.total >= 0 ? 'up' : 'dn'));
      row('Breaks even at', P.formatMoney(p.breakEven, L.currency));
    } else if (p && p.missing === 'rate' && p.payoutL !== undefined) {
      row('Profit', `waiting for the ${p.currency} rate`);
    }
    for (const t of r.teamPrices || []) row(`Team · ${t.owner}`, `${P.formatMoney(t.price, t.currency)} · ${t.tickets} listed`);
    if (L) {
      const typed = (p.manualRates || []).length ? ` (typed: ${p.manualRates.join(', ')})` : '';
      box.append(el('div', 'mnote', `read on viagogo ${U.ago(L.seenAt)}${p.rateDay ? ` · rates of ${p.rateDay}${typed}` : ''}`));
    }
    return box;
  }

  /* a price typed on the request wins over the site's; empty = the site's */
  function buyField(ctx, r) {
    const wrap = el('div', 'buyfield');
    const amount = el('input');
    amount.type = 'number';
    amount.min = '0';
    amount.step = 'any';
    amount.value = r.buyPrice > 0 ? String(r.buyPrice) : '';
    amount.placeholder = r.buy && r.buy.source !== 'typed' ? `site: ${r.buy.amount}` : 'per ticket';
    amount.addEventListener('change', () => mutate(ctx, r.id, { buyPrice: amount.value === '' ? null : Number(amount.value) }));
    const cur = el('select');
    for (const c of SK.profit.CURRENCIES) {
      const o = el('option', null, c);
      o.value = c;
      o.selected = c === (r.buyCurrency || SK.profit.BASE);
      cur.append(o);
    }
    cur.addEventListener('change', () => mutate(ctx, r.id, { buyCurrency: cur.value }));
    wrap.append(amount, cur);
    return labelled('Buy price per ticket (empty = from the site)', wrap, 'wide');
  }

  /* Options is how close a request is to failing, so fewest-first puts what
   * needs you at the top. A request with no scan behind it has no number to
   * sort on, so it sinks below the ones that do rather than pretending to be
   * urgent. Settings → Appearance can put the old #n order back. */
  function sortRequests(list, mode, pinSec) {
    const rank = r => (!r.eval || r.eval.status === 'NOT SCANNED' ? 1 : 0);
    /* on a sector's own page, its requests are the ones you came for */
    const pin = r => (pinSec && String(r.sec) === String(pinSec) ? 0 : 1);
    /* bought ones after the open ones, before the done ones */
    const held = r => (r.bought && !r.done ? 1 : 0);
    const byNumber = (a, b) => (a.done - b.done) || (held(a) - held(b)) || (pin(a) - pin(b)) || (a.num - b.num);
    if (mode === 'number') return list.slice().sort(byNumber);
    return list.slice().sort((a, b) =>
      (a.done - b.done)
      || (held(a) - held(b))
      || (pin(a) - pin(b))
      || (rank(a) - rank(b))
      || ((a.eval ? a.eval.options : 0) - (b.eval ? b.eval.options : 0))
      || (a.num - b.num));
  }

  /* One event's requests. Each has a checkbox; the bar above selects them
   * all and deletes the selected ones together — the end of an event, in one
   * go. ctx.selected (request ids) lives as long as the panel. */
  function requestList(ctx, list) {
    ctx.selected = ctx.selected || new Set();
    const live = new Set(((ctx.state && ctx.state.requests) || []).map(r => r.id));
    for (const id of [...ctx.selected]) if (!live.has(id)) ctx.selected.delete(id);   // deleted elsewhere

    const box = el('div', 'reqs-box');
    if (list.length) box.append(bulkBar(ctx, list));
    const ul = el('ul', 'reqs');
    const mode = ctx.state && ctx.state.settings ? ctx.state.settings.listSort : 'options';
    sortRequests(list, mode, ctx.pinSector).forEach(r => ul.append(requestCard(r, ctx)));
    box.append(ul);
    return box;
  }

  function bulkBar(ctx, list) {
    const ids = list.map(r => r.id);
    const picked = list.filter(r => ctx.selected.has(r.id));
    const bar = el('div', 'bulk-bar' + (picked.length ? ' on' : ''));
    const all = el('input');
    all.type = 'checkbox';
    all.checked = picked.length === list.length;
    all.indeterminate = picked.length > 0 && picked.length < list.length;
    all.setAttribute('aria-label', 'Select every request of this event');
    all.addEventListener('change', () => {
      if (all.checked) ids.forEach(id => ctx.selected.add(id)); else ids.forEach(id => ctx.selected.delete(id));
      ctx.rerender();
    });
    const label = el('label', 'bulk-all');
    label.append(all, el('span', null, picked.length ? `${picked.length} of ${list.length} selected` : `Select all ${list.length}`));
    bar.append(label, el('span', 'spacer'));
    if (picked.length) {
      bar.append(button('Clear', 'ghost mini', () => { ids.forEach(id => ctx.selected.delete(id)); ctx.rerender(); }, 'Unselect them'));
      const del = button(`Delete ${picked.length}`, 'mini danger', async () => {
        const nums = picked.map(r => '#' + r.num).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
        const shown = nums.length > 12 ? nums.slice(0, 12).join(', ') + `, … (${nums.length - 12} more)` : nums.join(', ');
        if (!confirm(`Delete ${U.plural(picked.length, 'request')}?\n\n${shown}\n\nTheir numbers are never reused. Listings on viagogo are not touched.`)) return;
        await busy(del, async () => {
          await send('deleteRequests', { ids: picked.map(r => r.id) });
          picked.forEach(r => ctx.selected.delete(r.id));
          ctx.notice(`Deleted ${U.plural(picked.length, 'request')}.`);
        }, ctx);
        ctx.refresh(true);
      }, `Delete the ${picked.length} selected request${picked.length === 1 ? '' : 's'}`);
      bar.append(del);
    }
    return bar;
  }

  /* the same order for listings: a listing bound to a request sorts on that
   * request's options, and one with nothing to scan sits after them */
  function sortListings(list, mode) {
    if (mode === 'number') return list.slice().sort((a, b) => (a.num || 1e9) - (b.num || 1e9) || String(a.id).localeCompare(String(b.id)));
    const rank = l => (l.options === null || l.options === undefined ? 1 : 0);
    return list.slice().sort((a, b) =>
      (rank(a) - rank(b))
      || ((a.options || 0) - (b.options || 0))
      || (a.num || 1e9) - (b.num || 1e9)
      || String(a.id).localeCompare(String(b.id)));
  }

  /* ---------------- viagogo listings -------------------------------- */

  /* What each state means where it is shown, in the words the popup uses. */
  const LISTING_STATE = {
    tracked: { label: '', hint: 'Scanned and alerted like any request.' },
    linkable: { label: 'not linked', hint: 'Its event is tracked, but no request of yours is bound to it yet.' },
    untracked: { label: 'no event', hint: 'No tracked event matches this listing. It is kept here with a link back to viagogo.' },
    bought: { label: 'bought', hint: 'You have these tickets: no scans, no alerts, no badge.' },
    ignored: { label: 'ignored', hint: 'You already have these tickets: no scans, no alerts, no badge.' },
    done: { label: 'done', hint: 'Its request is marked done.' }
  };

  const listingStateHint = state => (LISTING_STATE[state] || {}).hint || '';

  /* A listing card is striped by what viagogo says about the listing itself —
   * Active, Pending, Deactivated, Sold — not by whether its seats can still be
   * found. That is the thing you are scanning for, so it is the thing the
   * colour should carry. */
  const listingClass = l => 'lst-' + (l.statusKind || (SK.viagogo ? SK.viagogo.listingStatus(l.status) : 'other'));

  /* "Bought" / "Track it again". The request behind it is kept either way,
   * so switching back restores its number and its history. */
  function trackToggle(l, ctx, cls) {
    const off = l.track === 'off' || l.state === 'bought';
    const b = button(off ? 'Track again' : 'Bought', (cls || 'mini') + (off ? ' primary' : ''), null,
      off
        ? `Start scanning and alerting for listing ${l.id} again`
        : `You have these tickets: stop scanning and alerting for listing ${l.id}. Nothing on viagogo changes.`);
    b.addEventListener('click', e => {
      e.stopPropagation();
      busy(b, async () => {
        await send('setListingTrack', { id: l.id, track: off ? 'auto' : 'off' });
        ctx.notice(off
          ? `Tracking listing ${l.id} again.`
          : `Listing ${l.id} is bought — no scans and no alerts for it. Nothing changed on viagogo.`);
        await ctx.refresh(true);
      }, ctx);
    });
    return b;
  }

  /* One listing, in the same shape as a request card so a list of both reads
   * as one thing: status colour as the left stripe, money on the right. */
  function listingCard(l, ctx, opts) {
    const o = opts || {};
    const P = SK.profit;
    const muted = l.state === 'ignored' || l.state === 'done';
    const li = el('li', `req listing ${listingClass(l)}${muted ? ' done' : ''}`);

    const top = el('div', 'top');
    top.append(el('span', 'num', l.num ? '#' + l.num : l.id));
    const sec = el('span', 'sec', l.code || l.section || '?');
    sec.title = l.section ? `viagogo section ${l.section}` : '';
    top.append(sec);
    /* what viagogo calls it, in viagogo's own word, matching the stripe */
    if (l.status) {
      const sp = el('span', 'pill ' + listingClass(l), l.status);
      sp.title = 'viagogo says this listing is ' + l.status;
      top.append(sp);
    }
    /* and how it stands here, when that is worth saying */
    if ((l.state === 'tracked' || l.state === 'bought') && l.reqStatus) {
      top.append(el('span', 'pill ' + statusClass(l.reqStatus), l.reqStatus === 'NOT SCANNED' ? 'not scanned' : l.reqStatus));
    } else {
      const st = LISTING_STATE[l.state];
      if (st && st.label) {
        const pill = el('span', 'pill', st.label);
        pill.title = st.hint;
        top.append(pill);
      }
    }
    if (l.tickets !== null && l.tickets !== undefined) top.append(el('span', 'chip', U.plural(l.tickets, 'ticket')));
    top.append(el('span', 'spacer'));
    const chip = profitChip(l.money);
    if (chip) top.append(chip);
    li.append(top);

    const where = l.eventNum ? `[${l.eventNum}] ${l.eventTitle}` : (l.title || 'unknown event');
    const left = [where, l.price === null || l.price === undefined ? '' : P.formatMoney(l.price, l.currency), l.status]
      .filter(Boolean).join(' · ');
    const detail = el('div', 'detail split');
    detail.append(el('span', null, left));
    if (l.state === 'tracked' && l.options !== null) detail.append(el('span', null, U.plural(l.options, 'option')));
    li.append(detail);

    /* its sales, and where their money stands: the tickets at each stage */
    if (o.stages && l.sales && l.sales.length) {
      const counts = {};
      for (const s of l.sales) if (s.stage) counts[s.stage] = (counts[s.stage] || 0) + (Number(s.tickets) || 1);
      const line = stageCounts(counts, n => U.plural(n, 'ticket'));
      if (line) {
        line.prepend(el('span', 'buylabel', 'Sales'));
        li.append(line);
      }
    }

    /* what these tickets cost, per ticket. Typed here it beats the ticket
     * site's section price, and it is what makes a profit possible at all on
     * an event nobody tracks. */
    if (o.onBuy) li.append(buyRow(l, o));

    const acts = el('div', 'row-acts');
    if (o.onOpen) acts.append(button('Open', 'mini', e => { e.stopPropagation(); o.onOpen(l); }, 'Open this listing on viagogo'));
    if (o.onTrackEvent && l.state === 'untracked') {
      acts.append(button('Track this event', 'mini primary', e => { e.stopPropagation(); o.onTrackEvent(l); }, 'Add this listing\'s event to Seat Tracker'));
    }
    if (o.onLink && l.state === 'linkable') {
      acts.append(button('Add as request', 'mini primary', e => { e.stopPropagation(); o.onLink(l); }, 'Bind this listing to a sector so it is scanned'));
    }
    acts.append(trackToggle(l, ctx));
    li.append(acts);
    if (o.reservations) li.append(reservationRow(l, ctx));

    const hint = listingStateHint(l.state);
    if (hint && l.state !== 'tracked') li.append(el('div', 'detail', hint));
    return li;
  }

  /* Where a sale's money stands (core/stages.js), as a pill in its colour:
   * Sold, Awaiting payout, Paid out, Done. */
  const STAGE_HINT = {
    sold: 'Sold. Its event has not happened yet: 3 hours after it starts, it is awaiting payout.',
    awaiting_payout: 'Its event is over and viagogo has not paid it out yet.',
    paid_out: 'viagogo paid it out (Complete): in PayPal, not in the bank yet.',
    done: 'Its money reached the bank: a deposit in the app pays it.'
  };
  function stagePill(key) {
    const p = el('span', 'pill stg-' + SK.stages.tone(key), SK.stages.label(key));
    if (STAGE_HINT[key]) p.title = STAGE_HINT[key];
    return p;
  }
  /* { [stage]: n } -> a line of pills with their counts, in the stages'
   * order (unit(n): "2 tickets"), or null when there are none */
  function stageCounts(counts, unit) {
    const keys = SK.stages.KEYS.filter(k => (counts || {})[k] > 0);
    if (!keys.length) return null;
    const line = el('div', 'stageline');
    for (const k of keys) {
      const item = el('span', 'stageitem');
      item.append(stagePill(k), el('span', 'stagen', unit ? unit(counts[k]) : String(counts[k])));
      line.append(item);
    }
    return line;
  }

  /* Buyers viagogo is checking, on a listing card: each reservation (how
   * many, its seats, since when) with Confirm (viagogo said yes: sold; it
   * joins its sale once that is read) and Cancel (no trace: the tickets are
   * listed again); and, on an active listing, "Reserved…" to mark one: how
   * many tickets and their seats when known. Which tickets it holds is
   * picked in the app. */
  function reservationRow(l, ctx) {
    const wrap = el('div', 'resline');
    const stop = e => e.stopPropagation();
    const act = (b, fn, done) => b.addEventListener('click', e => {
      stop(e);
      busy(b, async () => { const out = await fn(); ctx.notice(done(out)); await ctx.refresh(true); }, ctx);
    });
    for (const r of l.reservations || []) {
      const line = el('div', 'resitem');
      const what = `${U.plural(r.tickets, 'ticket')}${r.seats ? ' · seats ' + r.seats : ''}`;
      line.append(el('span', 'pill ' + (r.confirmedAt ? 'res-ok' : 'res-open'), r.confirmedAt ? 'Sold' : 'Reserved'));
      line.append(el('span', 'restext', r.confirmedAt ? `${what} · confirmed, waiting for its sale` : `${what} · ${U.ago(r.createdAt)}`));
      if (!r.confirmedAt) {
        const ok = button('Confirm', 'mini primary', null, 'viagogo confirmed the buyer: these tickets are sold. They join the sale once a PC reads it on My Sales.');
        act(ok, () => send('confirmReservation', { id: r.id }), sale => (sale ? `Confirmed: joined sale ${sale}.` : `Confirmed: ${what} sold, waiting for the sale on My Sales.`));
        line.append(ok);
      }
      const no = button('Cancel', 'mini', null, 'The sale fell through: viagogo puts the tickets back on this listing. Nothing of the reservation is kept.');
      act(no, async () => (confirm(`Cancel the reservation of ${what}? Nothing of it is kept.`) ? send('cancelReservation', { id: r.id }).then(() => true) : false),
        gone => (gone ? 'Reservation cancelled: the tickets are listed again.' : 'Kept.'));
      line.append(no);
      wrap.append(line);
    }
    if (['active', 'pending'].includes(l.statusKind)) {
      const open = button('Reserved…', 'mini', null, 'viagogo asked you to reserve tickets of this listing while it checks the buyer: mark them here');
      const form = el('div', 'resform');
      form.hidden = true;
      const n = el('input');
      n.type = 'number'; n.min = '1'; n.max = '99'; n.value = '1';
      n.title = 'How many tickets the buyer took';
      const seats = el('input');
      seats.placeholder = 'seats (if known)';
      seats.title = 'Their seats, as viagogo gives them ("1-2"): the app then knows which tickets';
      const save = button('Save', 'mini primary');
      for (const x of [n, seats, form]) x.addEventListener('click', stop);
      act(save, () => send('reserveListing', { id: l.id, tickets: n.value, seats: seats.value }), () => `Reserved: ${U.plural(Number(n.value) || 1, 'ticket')} of listing ${l.id}.`);
      form.append(el('span', 'buylabel', 'Tickets'), n, seats, save);
      open.addEventListener('click', e => { stop(e); form.hidden = !form.hidden; if (!form.hidden) n.focus(); });
      wrap.append(open, form);
    }
    return wrap;
  }

  /* The buy price on a listing card: an amount, a currency, and what the
   * ticket site says when you have typed nothing. */
  function buyRow(l, o) {
    const P = SK.profit;
    const wrap = el('div', 'buyline');
    const amount = el('input');
    amount.type = 'number';
    amount.min = '0';
    amount.step = 'any';
    amount.value = l.buyPrice > 0 ? String(l.buyPrice) : '';
    amount.placeholder = l.buy && l.buy.source !== 'typed on the listing' ? String(l.buy.amount) : 'per ticket';
    amount.title = 'What one of these tickets cost you. Empty uses the ticket site\'s price where there is one.';
    amount.addEventListener('click', e => e.stopPropagation());
    amount.addEventListener('change', () => o.onBuy(l, amount.value, cur.value));
    const cur = el('select');
    for (const c of P.CURRENCIES) {
      const opt = el('option', null, c);
      opt.value = c;
      opt.selected = c === (l.buyCurrency || P.BASE);
      cur.append(opt);
    }
    cur.addEventListener('click', e => e.stopPropagation());
    cur.addEventListener('change', () => o.onBuy(l, amount.value, cur.value));
    wrap.append(el('span', 'buylabel', 'Buy'), amount, cur);
    if (l.buy && l.buy.source !== 'typed on the listing') wrap.append(el('span', 'note', l.buy.source));
    return wrap;
  }

  /* One viagogo event, as the popup heads a group of listings. */
  function listingTotals(items) {
    let tickets = 0, cost = 0, got = 0, total = 0, priced = 0;
    for (const l of items) {
      tickets += Number(l.tickets) || 0;
      const m = l.money;
      if (!m || m.missing !== null) continue;
      priced++;
      cost += m.costL * m.tickets;
      got += m.payoutL * m.tickets;
      total += m.total;
    }
    return { tickets, cost, got, total, priced, winRate: cost > 0 ? got / cost : 0 };
  }

  /* Listings split the way the popup shows them: by the viagogo event each one
   * is for — its id from the card's own link, so two matches that share a name
   * stay apart — then the ones that need something from you, then the quiet
   * ones.
   *
   * Every listing lands in exactly one group. A listing whose state the service
   * worker did not set — an older worker still running behind a freshly loaded
   * popup, say — is grouped by what can be seen instead of vanishing. */
  function listingGroups(st) {
    const all = (st.listings || []).slice();
    const events = st.events || [];

    const stateOf = l => {
      if (['tracked', 'bought', 'linkable', 'untracked', 'ignored', 'done'].includes(l.state)) return l.state;
      if (l.track === 'off') return 'ignored';               // a worker too old to send `state`
      if (l.requestId) return l.done ? 'done' : 'tracked';
      return l.eventKey ? 'linkable' : 'untracked';
    };

    /* viagogo's own event id when the card carried one, else its name and date */
    const groupKey = l => (l.vgEventId ? 'E-' + l.vgEventId : 'n:' + (l.title || '?') + '|' + (l.when || ''));

    const byEvent = new Map();
    const ignored = [];
    for (const l of all) {
      if (stateOf(l) === 'ignored') { ignored.push(l); continue; }
      const k = groupKey(l);
      if (!byEvent.has(k)) byEvent.set(k, []);
      byEvent.get(k).push(l);
    }

    const groups = [...byEvent.entries()].map(([key, items]) => {
      const tracked = items.map(l => events.find(e => e.key === l.eventKey)).find(Boolean) || null;
      const first = items.find(l => l.title) || items[0];
      return {
        key, items, event: tracked,
        title: (first && first.title) || (tracked && tracked.title) || 'Unknown event',
        sub: [first && first.when, first && first.venue, tracked ? `tracked as [${tracked.num}]` : '']
          .filter(Boolean).join(' · '),
        totals: listingTotals(items),
        order: tracked ? tracked.num : 1e6
      };
    }).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'en'));

    if (ignored.length) {
      groups.push({ key: 'ignored', items: ignored, event: null, title: 'Ignored',
        sub: 'you already have these tickets', totals: listingTotals(ignored), order: 1e9 });
    }
    return groups;
  }

  /* ---------------- add form ---------------------------------------- */

  function sectorLabel(s) {
    const m = s.summary;
    if (m && m.unmapped) return `${s.name} · ${m.note}`;
    if (m) return `${s.name} · ${m.available} free · longest ${m.longest}`;
    return s.hint && s.hint !== s.name ? `${s.name} · ${s.hint}` : s.name;
  }

  function sectorHintText(s) {
    const parts = [];
    if (s.name && s.name !== s.code) parts.push(s.name);
    const m = s.summary;
    if (m && m.unmapped) parts.push(m.note);
    else if (m) parts.push(`${m.available} free · longest ${m.longest}`);
    else if (s.hint && s.hint !== s.name) parts.push(s.hint);
    return parts.join(' · ');
  }

  /* Search box with a live-filtered list: every keystroke filters, arrows move,
   * Enter picks, Escape closes. onValue(text, sectorOrNull) on every change. */
  function sectorPicker(ev, value, onValue) {
    const wrap = el('div', 'picker');
    const sectors = ev ? ev.sectors : [];
    const input = textInput(value, null, sectors.length ? `search, e.g. ${sectors[0].code}` : ev ? 'loading sectors…' : 'pick the event first');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    const list = el('ul', 'picker-list');
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    let hits = [];
    let active = -1;

    const matches = q => {
      const k = U.normKey(q);
      if (!k) return sectors.slice(0, 60);
      const starts = [], inside = [];
      for (const s of sectors) {
        const code = U.normKey(s.code), name = U.normKey(s.name);
        if (code.startsWith(k) || name.startsWith(k)) starts.push(s);
        else if (code.includes(k) || name.includes(k)) inside.push(s);
      }
      return starts.concat(inside).slice(0, 60);
    };

    const close = () => { list.hidden = true; active = -1; };
    const pick = s => {
      input.value = s.code;
      onValue(s.code, s);
      close();
    };
    const draw = () => {
      hits = matches(input.value);
      if (active >= hits.length) active = hits.length - 1;
      list.textContent = '';
      if (!hits.length) list.append(el('li', 'empty', sectors.length ? 'No sector matches' : 'No sectors loaded yet'));
      hits.forEach((s, i) => {
        const li = el('li', i === active ? 'on' : '');
        li.setAttribute('role', 'option');
        li.append(el('span', 'code', s.code), el('span', 'hint', sectorHintText(s)));
        li.addEventListener('mousedown', e => { e.preventDefault(); pick(s); });
        list.append(li);
      });
      list.hidden = false;
      const on = list.querySelector('li.on');
      if (on) on.scrollIntoView({ block: 'nearest' });
    };

    input.addEventListener('input', () => {
      active = 0;
      draw();
      onValue(input.value, null);
    });
    input.addEventListener('focus', () => { active = -1; draw(); });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.hidden) draw();
        if (!hits.length) return;
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
        draw();
      } else if (e.key === 'Enter') {
        if (!list.hidden && hits[active]) { e.preventDefault(); pick(hits[active]); }
      } else if (e.key === 'Escape') {
        if (!list.hidden) { e.stopPropagation(); close(); }
      }
    });

    wrap.append(input, list);
    return wrap;
  }

  function findSector(ev, text) {
    if (!ev || !text) return null;
    const k = U.normKey(text);
    return ev.sectors.find(s => U.normKey(s.code) === k || U.normKey(s.name) === k || s.id === text) || null;
  }

  /* opts: { fixedEventKey?, withTrack? } */
  function addForm(ctx, opts) {
    opts = opts || {};
    const st = ctx.state;
    const d = ctx.addDraft || (ctx.addDraft = { eventKey: '', sec: '', qty: '2', warn: '', opts: '', client: '', listing: '', cats: [], together: null });
    if (!Array.isArray(d.cats)) d.cats = [];
    if (opts.fixedEventKey) d.eventKey = opts.fixedEventKey;

    const live = st.events.filter(e => !e.archived || e.key === d.eventKey);
    /* emptyEvent: never guess an event, show "pick the event" instead */
    if (!eventOf(st, d.eventKey)) d.eventKey = opts.emptyEvent ? '' : ((live.find(e => e.open) || live[0]) || {}).key || '';

    const wrap = el('div', 'add');

    if (opts.withTrack) {
      const row = el('div', 'track row');
      const inp = textInput('', null, 'Paste an event link to track it');
      const go = button('Track', '', () => busy(go, async () => {
        if (!inp.value.trim()) throw new Error('Paste the link of an event page first.');
        const res = await send('trackUrl', { url: inp.value });
        Object.assign(d, { eventKey: res.key, sec: '', cats: [] });
        ctx.notice('Event added — pick a sector below.');
        await ctx.refresh(true);
      }, ctx));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
      row.append(inp, go, helpButton('events', () => (document.body.classList.contains('sk-app') ? document.body : wrap.getRootNode().querySelector('.sk-panel'))));
      wrap.append(row);
    }

    if (!live.length && !st.catalog.length) {
      wrap.append(el('p', 'note', opts.withTrack
        ? 'No events yet. Open an event page on eBileta, eFinity or Posttick, or paste its link above.'
        : 'This page is not linked to an event yet.'));
      return wrap;
    }

    const form = el('div', 'form');

    if (!opts.fixedEventKey) {
      const sel = el('select');
      if (opts.emptyEvent) {
        const none = el('option', null, '— pick the event —');
        none.value = '';
        none.selected = !d.eventKey;
        sel.append(none);
      }
      const g = el('optgroup');
      g.label = 'Events';
      for (const e of live) {
        /* "[3] Shqiperi - Finlande · 12 Nov 2026" rather than the whole site title */
        const info = e.info || SK.util.eventInfo(e);
        const day = /^\d{4}-\d{2}-\d{2}$/.test(info.date)
          ? new Date(info.date + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
          : '';
        const o = el('option', null, `[${e.num}] ${info.name}${day ? ' · ' + day : ''}`);
        o.title = e.title;
        o.value = e.key;
        if (e.key === d.eventKey) o.selected = true;
        g.append(o);
      }
      if (live.length) sel.append(g);
      const bySite = new Map();
      for (const c of st.catalog) {
        if (!bySite.has(c.site)) bySite.set(c.site, []);
        bySite.get(c.site).push(c);
      }
      for (const [, list] of bySite) {
        const cg = el('optgroup');
        cg.label = `${list[0].siteLabel} — not tracked yet`;
        for (const c of list) {
          const o = el('option', null, `${c.title}${c.date ? ' · ' + c.date : ''}`);
          o.value = `catalog|${c.site}|${c.siteId}`;
          cg.append(o);
        }
        sel.append(cg);
      }
      sel.addEventListener('change', async () => {
        if (sel.value.startsWith('catalog|')) {
          const [, site, siteId] = sel.value.split('|');
          const c = st.catalog.find(x => x.site === site && String(x.siteId) === siteId) || {};
          /* nothing is tracked without saying so */
          if (!confirm(`Track "${c.title || siteId}" on ${c.siteLabel || site}?\nIt is added to your events so you can add requests to it.`)) {
            sel.value = d.eventKey;
            return;
          }
          try { d.eventKey = (await send('trackCatalog', { site, siteId })).key; }
          catch (e) { ctx.notice(e.message, true); }
        } else {
          d.eventKey = sel.value;
        }
        /* a sector code means nothing in another venue, unless the caller knows better */
        if (opts.onEventChange) opts.onEventChange(d);
        else { d.sec = ''; d.cats = []; }
        ctx.refresh(true);
      });
      form.append(labelled('Event', sel, 'wide'));
    }

    const ev = eventOf(st, d.eventKey);
    const site = siteOf(st, ev ? ev.site : '');

    const hasPrices = !!(site.can.prices && ev);
    const priceHolder = el('div');
    const drawPrice = () => {
      priceHolder.textContent = '';
      const s = findSector(ev, d.sec);
      priceHolder.append(priceChips(st, ev, s ? s.id : '', d.cats, v => { d.cats = v; drawPrice(); }));
    };
    /* what teammates sell this section for on viagogo: a suggestion */
    const teamNote = el('div', 'note team-note wide');
    const drawTeam = () => {
      const s = ev ? findSector(ev, d.sec) : null;
      const here = s ? (st.teamPrices || []).filter(t => t.eventKey === ev.key && String(t.sectorId) === String(s.id) && /^(active|pending|live)/i.test(t.status || 'active')) : [];
      teamNote.hidden = !here.length;
      teamNote.textContent = here.length
        ? `Team lists ${s.code} at ${here.map(t => `${SK.profit.formatMoney(t.price, t.currency)} (${t.owner}, ${t.tickets})`).join(' · ')}`
        : '';
    };
    const picker = sectorPicker(ev, d.sec, (text, sector) => {
      d.sec = text;
      drawTeam();
      if (!hasPrices) return;
      /* a newly picked sector only keeps the picked prices it actually sells */
      const scan = sector && st.scans[ev.key] && st.scans[ev.key][sector.id];
      if (scan && !scan.unmapped) d.cats = d.cats.filter(k => scan.cats[k]);
      drawPrice();
    });

    const qty = numberInput(d.qty, 1);
    qty.addEventListener('input', () => { d.qty = qty.value; });
    const warn = numberInput(d.warn, 0, null, st.settings.defaultWarn);
    warn.addEventListener('input', () => { d.warn = warn.value; });
    const optsIn = numberInput(d.opts, 0, null, st.settings.defaultOpts);
    optsIn.addEventListener('input', () => { d.opts = optsIn.value; });
    const client = textInput(d.client, null, 'optional');
    client.addEventListener('input', () => { d.client = client.value; });
    const listing = textInput(d.listing, null, 'viagogo listing');
    listing.addEventListener('input', () => { d.listing = listing.value; });
    const together = d.together === null ? st.settings.together : d.together;

    form.append(fieldBox('Sector', picker), labelled('Tickets', qty));
    drawTeam();
    form.append(teamNote);
    if (hasPrices) { drawPrice(); form.append(fieldBox('Prices', priceHolder, 'wide')); }
    form.append(
      labelled('Block warn', warn),
      labelled('Options warn', optsIn),
      labelled('Client', client),
      labelled('Listing ID', listing),
      checkbox('Seats must be side by side', together, v => { d.together = v; }, 'wide')
    );

    const add = button('Add request', 'primary wide', () => busy(add, async () => {
      if (!ev) throw new Error('Pick an event first.');
      if (!String(d.sec).trim()) throw new Error('Type a sector.');
      const req = await send('addRequest', {
        req: {
          eventKey: ev.key, sec: d.sec, qty: d.qty, warn: d.warn, opts: d.opts, client: d.client, listing: d.listing,
          cats: d.cats, together: d.together === null ? st.settings.together : d.together
        }
      });
      ctx.notice(`Added ${req.qty} × ${String(d.sec).trim()} — scanning it now.`);
      if (opts.onAdded) { try { await opts.onAdded(req, ev, d); } catch (e) { /* remembering is a bonus */ } }
      Object.assign(d, { sec: '', client: '', listing: '', cats: [] });
      await ctx.refresh(true);
    }, ctx));
    form.append(add);

    wrap.append(form);
    return wrap;
  }

  /* ---------------- sector card ------------------------------------- */

  /* o: { eventKey, secId, view: { minBlock, cats, selected }, localScan?, title?,
   *      onBlock?(block), onClear?(), onClose?() } */
  function sectorCard(ctx, o) {
    const st = ctx.state;
    const ev = eventOf(st, o.eventKey);
    const site = siteOf(st, ev ? ev.site : '');
    const sector = sectorIn(ev, o.secId);
    const scan = (ev && st.scans[ev.key] && st.scans[ev.key][o.secId]) || o.localScan || null;
    const v = o.view;

    const card = el('div', 'sector-card');
    const head = el('div', 'sc-head');
    head.append(el('strong', null, sector ? sector.code : (o.title || o.secId)));
    if (sector && sector.name !== sector.code) head.append(el('span', 'muted', sector.name));
    head.append(el('span', 'spacer'));
    if (o.onClose) head.append(button('✕', 'ghost mini', o.onClose, 'Close this card'));
    card.append(head);

    const scanBtn = () => {
      const b = button('Scan sector', 'mini', () => busy(b, async () => {
        const r = await send('scan', { eventKey: ev.key, scope: [String(o.secId)] });
        if (r.errors && r.errors.length) ctx.notice(r.errors[0], true);
      }, ctx));
      return b;
    };

    if (!scan) {
      card.append(el('p', 'note', 'Not scanned yet.'));
      if (ev) card.append(scanBtn());
      return card;
    }
    if (scan.unmapped) {
      card.append(el('p', 'note', scan.note || 'No seat map for this sector.'));
      return card;
    }

    if (site.can.prices && ev) {
      card.append(fieldBox('Prices', priceChips(st, ev, o.secId, v.cats, val => { v.cats = val; v.selected = null; ctx.rerender(); })));
    }
    const view = SK.rules.blocksFor(scan, v.cats);
    const stats = el('div', 'stats');
    const stat = (n, label, cls) => { const s = el('div', 'stat ' + (cls || '')); s.append(el('b', null, String(n)), el('span', null, label)); return s; };
    stats.append(stat(view.available, 'free', 'ok'), stat(view.taken, 'taken', 'bad'), stat(view.longest, 'longest block'));
    card.append(stats);

    const mine = ev ? st.requests.filter(r => r.eventKey === ev.key && String(r.sec) === String(o.secId) && !r.done) : [];
    if (mine.length) card.append(el('p', 'note', 'Tracked here: ' + mine.map(r => `#${r.num}${r.client ? ' ' + r.client : ''} ×${r.qty}`).join(', ')));

    if (v.minBlock === null || v.minBlock === undefined) {
      const want = mine.length ? Math.max(...mine.map(r => r.qty)) : 2;
      v.minBlock = Math.max(1, Math.min(want, view.longest || 1));
    }
    const minInput = numberInput(v.minBlock, 1);
    /* how many groups of that many seats side by side the sector holds, counted
     * the way a request's options are (rules.optionsFor) */
    const optCount = el('span', 'opt-count');
    const minRow = el('div', 'min-row');
    minRow.append(labelled('Blocks of at least', minInput, 'inline'), optCount);
    card.append(minRow);
    /* 1 to 10 in one tap; sizes no block reaches are dimmed, not hidden */
    const seg = el('div', 'seg min-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Block size');
    const segBtns = [];
    for (let n = 1; n <= 10; n++) {
      const b = button(String(n), n > view.longest ? 'none' : '', () => setMin(n),
        `Blocks of at least ${n}: ${U.plural(SK.rules.optionsFor(view, n, true).options, 'option')}`);
      segBtns.push(b);
      seg.append(b);
    }
    card.append(seg);

    const list = el('ul', 'blocks');
    card.append(list);
    const drawList = () => {
      list.textContent = '';
      const hits = view.blocks.filter(b => b.len >= v.minBlock);
      if (!hits.length) {
        list.append(el('li', 'note', view.available >= v.minBlock
          ? `No block of ${v.minBlock}. The longest is ${view.longest}; the ${view.available} free seats are split up.`
          : `No block of ${v.minBlock} — only ${view.available} free.`));
        return;
      }
      for (const b of hits.slice(0, 60)) {
        const key = `${b.row}:${b.first}-${b.last}`;
        const li = el('li', v.selected === key ? 'on' : '');
        li.append(el('span', null, `Row ${b.row} · seats ${b.first}–${b.last}`), el('span', 'muted', String(b.len)));
        if (o.onBlock) {
          li.classList.add('clickable');
          li.title = 'Outline these seats on the map';
          li.addEventListener('click', () => { v.selected = key; o.onBlock(b); drawList(); });
        }
        /* only where the page can act, and only as many seats as you asked for */
        if (o.onHold) {
          const n = Math.min(v.minBlock, b.len);
          const take = button(`Hold ${n}`, 'mini', e => {
            e.stopPropagation();
            o.onHold(b, n);
          }, `Hold ${n} seats in row ${b.row} in eBileta's cart — nothing is bought`);
          li.append(take);
        }
        list.append(li);
      }
      if (hits.length > 60) list.append(el('li', 'note', `+${hits.length - 60} more`));
    };
    const drawCount = () => {
      const n = SK.rules.optionsFor(view, v.minBlock, true).options;
      optCount.textContent = n ? U.plural(n, 'option') : 'no options';
      optCount.className = 'opt-count' + (n ? '' : ' zero');
      segBtns.forEach((b, i) => { b.classList.toggle('on', i + 1 === v.minBlock); b.setAttribute('aria-pressed', String(i + 1 === v.minBlock)); });
    };
    function setMin(n) {
      v.minBlock = n;
      minInput.value = String(n);
      v.selected = null;
      drawCount();
      drawList();
    }
    minInput.addEventListener('input', () => { v.minBlock = Math.max(1, parseInt(minInput.value, 10) || 1); v.selected = null; drawCount(); drawList(); });
    drawCount();
    drawList();

    const foot = el('div', 'sc-foot');
    foot.append(el('span', 'muted', 'scanned ' + U.ago(scan.at)), el('span', 'spacer'));
    if (o.onClear) foot.append(button('Clear outline', 'mini', () => { v.selected = null; o.onClear(); drawList(); }));
    if (ev) foot.append(scanBtn());
    card.append(foot);
    return card;
  }

  /* ---------------- search ------------------------------------------ */

  /* a request matches by its sector (code or name) or its listing ID */
  function requestMatches(r, ev, query) {
    const k = U.normKey(query);
    if (!k) return true;
    const s = sectorIn(ev, r.sec);
    return [r.code, s && s.code, s && s.name, r.listing].some(v => v && U.normKey(v).includes(k));
  }

  function searchInput(value, onChange, opts) {
    const o = opts || {};
    const i = textInput(value, null, o.placeholder || 'Sector or listing ID');
    i.type = 'search';
    i.classList.add('search');
    i.setAttribute('aria-label', o.label || 'Search requests and sectors by name or listing ID');
    i.addEventListener('input', () => onChange(i.value));
    i.addEventListener('keydown', e => {
      if (e.key === 'Escape' && i.value) { e.preventDefault(); i.value = ''; onChange(''); }
    });
    return i;
  }

  /* The event's sectors that match what was typed — the ones you have no
   * request in included, so a sector can be found before it is tracked.
   * Names that start with the query come first, as in the sector picker. */
  function matchSectors(ev, query) {
    const k = U.normKey(query);
    if (!ev || !k) return [];
    const starts = [], inside = [];
    for (const s of ev.sectors || []) {
      const code = U.normKey(s.code), name = U.normKey(s.name);
      if (code.startsWith(k) || name.startsWith(k)) starts.push(s);
      else if (code.includes(k) || name.includes(k)) inside.push(s);
    }
    return starts.concat(inside);
  }

  /* ---------------- connection ---------------------------------------- */

  const CONNECTION = {
    offline: ['This PC is offline',
      'Nothing is lost: it syncs again by itself as soon as the connection is back.'],
    unreachable: ['Can\'t reach the Seat Tracker server',
      'This PC is online, so something is stopping it from reaching Supabase: a VPN, a firewall or network filter, a blocker extension — or Supabase is down. It keeps retrying every 30 seconds.'],
    server: ['The Seat Tracker server has a problem',
      'Supabase answered with an error. It keeps retrying every 30 seconds; if it lasts, look at status.supabase.com.']
  };

  /* Shown only once a sync failure lasts (a PC waking from sleep fails one sync),
   * and gone by itself after the next good sync. */
  function connectionNote(st, onRetry) {
    const s = st && st.meta && st.meta.sync;
    if (!s || (s.fails < 2 && Date.now() - s.since < 60000)) return null;
    const [head, why] = CONNECTION[s.kind] || ['Syncing failed', s.message];
    const box = el('div', 'conn');
    box.append(el('strong', null, head), el('p', null, why),
      el('p', 'conn-meta', `Since ${U.fmtClock(s.since)} · last synced ${U.ago(st.meta.lastSyncAt)}${s.detail ? ' · ' + s.detail : ''}`));
    if (onRetry) {
      const b = button('Retry now', 'mini');
      b.addEventListener('click', () => onRetry(b));
      box.append(b);
    }
    return box;
  }

  function retrySync(btn, ctx) {
    return busy(btn, async () => {
      const r = await send('syncNow');
      if (r && r.ok) ctx.notice('Connected again.');
      else ctx.notice(`Still not connected${r && r.sync && r.sync.detail ? ': ' + r.sync.detail : '.'}`, true);
      await ctx.refresh(true);
    }, ctx);
  }

  /* Listings build up: one read from months ago left rows for listings that
   * no longer exist, and nothing removes them, so the count drifts above
   * what viagogo actually shows. Starting again is the honest cure.
   * after() redraws whatever showed them. */
  function forgetListingsButton(st, ctx, after) {
    const b = button('Forget all listings', 'mini danger', () => busy(b, async () => {
      const n = ((st && st.listings) || []).length;
      const ok = confirm(`Forget all ${n} listings read from viagogo?\n\n`
        + 'Your requests, their numbers and their history all stay exactly as they are — only what was read from '
        + 'viagogo is thrown away. Read your listings page again and each one comes back, matched to its request '
        + 'by listing ID.');
      if (!ok) return;
      const r = await send('resetListings');
      ctx.notice(`Forgot ${U.plural(r.removed, 'listing')}. Open your viagogo listings page to read them again.`);
      if (after) await after();
    }, ctx), 'Throw away every listing read from viagogo and start again — requests are untouched');
    return b;
  }

  /* the last error, only while it is recent */
  function recentError(meta) {
    return meta && meta.lastError && meta.lastErrorAt && Date.now() - meta.lastErrorAt < 15 * 60000 ? meta.lastError : '';
  }

  SK.ui = {
    alive, requestMatches, searchInput, matchSectors, connectionNote, retrySync, recentError, profitChip, moneyBox, calculator, priceCalculator, teamLine, messageBox,
    el, send, applyTheme, typingIn, statusClass, eventOf, siteOf, sectorIn,
    button, dot, labelled, checkbox, numberInput, textInput, segmented, busy,
    helpButton, openHelp, priceChips, fieldBox, sectorPicker, requestCard, requestList, addForm, sectorCard, sectorLabel, sectorHintText,
    listingCard, listingGroups, forgetListingsButton, listingTotals, listingStateHint, trackToggle, sortRequests, sortListings,
    stagePill, stageCounts
  };
})(globalThis);
