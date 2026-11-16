/* ------------------------------------------------------------------
 * Seat Tracker - viagogo event pages (www.viagogo.com/…/E-<id>)
 *
 * A drawer at the bottom of every event page, tracked or not. "Scan" presses
 * viagogo's "Show more" until it is gone, then reads every listing of the
 * list and sorts them into their sections. Each section is ranked by
 * viagogo's display price, with your listings, the gap to the cheapest and
 * graphs.
 *
 * Nothing leaves this tab: what was read lives in sessionStorage, and a page
 * refresh starts from nothing.
 *
 * The page, as captured on 2026-09-17: the map is WebGL (nothing readable);
 * listing rows carry the data (data-listing-id, data-feature-id
 * "<zone>_<sprite>", data-price); "Show more" appends rows and leaves the page
 * when all are loaded. With a section picked on the map the same list shows
 * only that section, so the scan waits for no section to be picked.
 * The only thing this script ever does on viagogo: click "Show more".
 *
 *
 *
 *
 *
 * ------------------------------------------------------------------ */
(function () {
  "use strict";
  const SK = globalThis.SK;
  if (!SK || !SK.ui || !SK.viagogo || !SK.market || !SK.profit || !SK.team || !SK.face) return;
  const ui = SK.ui,
    VG = SK.viagogo,
    M = SK.market,
    T = SK.team,
    P = SK.profit,
    F = SK.face,
    U = SK.util;

  const PAUSE = 600; // between clicks on "Show more", plus up to 0.3 s
  const SCAN_CAP = 20 * 60000;
  const PAGE_CAP = 400;
  const STALE = 30 * 60000;
  const STORE_PREFIX = "seat-tracker:vg-event:";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pause = () => sleep(PAUSE + Math.round(Math.random() * 300));
  const rowCount = () => VG.rowCount(document);

  /* ---------------- sessionStorage ----------------------------------- */

  const ss = {
    get(k) {
      try {
        return JSON.parse(sessionStorage.getItem(k) || "null");
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        sessionStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* full or blocked: the drawer still has it in memory */
      }
    },
    clearStores() {
      try {
        for (const k of Object.keys(sessionStorage))
          if (k.startsWith(STORE_PREFIX)) sessionStorage.removeItem(k);
      } catch (e) {
        /* blocked */
      }
    },
  };

  /* every load of the page, a refresh included, starts from nothing */
  ss.clearStores();

  let eventId = "";
  let store = null;
  let info = { name: "", start: "", venue: "" };
  let state = null;
  let scanning = null;
  let notice = null;
  let host = null,
    app = null;
  const view = { open: false, height: 340, onlyMine: false, instant: false, sort: "section", layout: "sections", qty: 0, price: 0, q: "", closed: [], tab: "listings", stands: [], diffKind: "all", diffOnly: true, priceCur: "" };
  const expanded = new Set();
  const faceExpanded = new Set(); // sections opened in the Face value tab

  const storeKey = () => STORE_PREFIX + eventId;
  const save = () => ss.set(storeKey(), store);

  function loadEvent() {
    eventId = VG.eventIdOf(location);
    store = (eventId && ss.get(storeKey())) || M.emptyStore(eventId);
    info = VG.readEventInfo(document);
    expanded.clear();
    faceExpanded.clear();
    loadConfirms();
    pasteOpen = false;
    saved = [];
    diffPick = { from: "", to: "" };
    diffOpen.clear();
    priceDrafts.clear();
    loadSaved();
  }

  function note(text, isError) {
    notice = { text, isError, at: Date.now() };
    render();
    setTimeout(() => {
      if (notice && Date.now() - notice.at >= 8000) {
        notice = null;
        render();
      }
    }, 8100);
  }

  /* ---------------- scanning ----------------------------------------- */

  async function waitFor(test, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (test()) return true;
      await sleep(100);
    }
    return !!test();
  }

  /* until the list has not changed for 600 ms (at most 10 s) */
  async function settle() {
    let sig = null,
      since = Date.now();
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      const now = `${rowCount()}|${VG.firstRowSig(document)}|${VG.showMoreButton(document) ? 1 : 0}|${JSON.stringify(VG.listFooter(document))}`;
      if (now !== sig) {
        sig = now;
        since = Date.now();
      } else if (Date.now() - since >= 600) return;
      await sleep(100);
    }
  }

  /* click "Show more" until it is gone -> true when every listing was loaded */
  async function expandAll(run) {
    for (let page = 0; page < PAGE_CAP; page++) {
      if (run.stop || Date.now() > run.until) return false;
      const button = VG.showMoreButton(document);
      if (!button) return true;
      const before = rowCount();
      button.click();
      const grew = await waitFor(
        () => rowCount() > before || !VG.showMoreButton(document),
        8000,
      );
      await settle();
      run.pages++;
      run.rows = rowCount();
      render();
      if (!grew && VG.showMoreButton(document)) return false; // viagogo stopped answering
      await pause();
    }
    return !VG.showMoreButton(document);
  }

  async function startScan() {
    if (scanning || VG.selectedSectionOf(location)) return;
    const run = {
      pages: 0,
      rows: rowCount(),
      stop: false,
      startedAt: Date.now(),
      until: Date.now() + SCAN_CAP,
    };
    scanning = run;
    render();
    try {
      await settle();
      const complete = await expandAll(run);
      const rows = VG.readRows(document);
      const scan = M.putAll(
        store,
        rows,
        complete && !run.stop,
        Date.now(),
        VG.listFooter(document),
      );
      save();
      expanded.clear();
      /* signed in: hand your sections on to the other pages by itself */
      if (ownSeen()) publishCompare(true);
      const what = `${U.plural(scan.listings, "listing")} in ${U.plural(Object.keys(store.sections).length, "section")}`;
      if (run.stop) note(`Stopped — partly read: ${what}.`);
      else if (!complete)
        note(`Stopped at the safety limit — partly read: ${what}.`, true);
      else note(`Scanned: ${what}.`);
    } catch (e) {
      note(e.message, true);
    }
    scanning = null;
    render();
  }

  function stopScan() {
    if (!scanning) return;
    scanning.stop = true;
    render();
  }

  function clearEvent() {
    if (scanning) return;
    store = M.emptyStore(eventId);
    save();
    expanded.clear();
    render();
  }

  /* ---------------- what Seat Tracker knows about this event ----------- */

  function trackedEvent() {
    if (!state || !state.events) return null;
    const own = (state.listings || []).find(
      (l) => l.vgEventId === eventId && l.eventKey,
    );
    if (own) return state.events.find((e) => e.key === own.eventKey) || null;
    const pick = VG.pickEvent(
      { title: info.name, when: info.start },
      state.events.filter((e) => !e.archived),
    );
    return pick ? state.events.find((e) => e.key === pick.key) || null : null;
  }

  function freeSeats(ev, label) {
    if (!ev) return null;
    const r = VG.sectorFor(ev, label);
    if (!["matched", "remembered"].includes(r.how)) return null;
    const sector = ev.sectors.find((s) => s.code === r.code);
    return sector && sector.summary && !sector.summary.unmapped
      ? sector.summary.available
      : null;
  }

  const listingOf = (id) =>
    ((state && state.listings) || []).find((l) => l.id === id) || null;

  /* A listing of yours whose request is Bought: you have the tickets, so it
   * can go at once, whether or not viagogo labels it Instant Download. */
  const boughtListing = (l) => !!l && (l.state === "bought" || l.reqStatus === "BOUGHT");
  const boughtMine = (r) => !!r.mine && boughtListing(listingOf(r.anon ? r.mineId : r.mineId || r.id));
  const boughtIds = () => ((state && state.listings) || []).filter(boughtListing).map((l) => l.id).sort();

  /* what your teammates sell this section for — only on a tracked event: a
   * section name alone ("E105") means nothing without knowing the stadium */
  function teamAt(section, tracked) {
    if (!tracked) return [];
    return T.teamAt(state, { eventKey: tracked.key, section: section.label });
  }

  /* your real price for a section, as your listings page last showed it */
  function myReal(section) {
    const out = [];
    for (const r of section.rows) {
      if (!r.mine || r.sold) continue;
      const l = listingOf(r.id);
      const own = l && l.money && l.money.listing;
      if (own && own.price) out.push({ price: own.price, currency: own.currency, id: r.id });
    }
    return out.sort((a, b) => a.price - b.price);
  }


  /* ---------------- comparing with a signed-in scan ------------------ *
   * Signed in, a scan of your sections is handed on by itself (and can be
   * copied). Signed out — no "Your listing" anywhere — that scan is what
   * names your listings, by what they show: see M.matchSignedOut. */

  const CONFIRM_PREFIX = "seat-tracker:vg-confirm:"; // kept across a refresh of this tab
  let confirms = {};
  let pasteOpen = false;
  let pasteEl = null;

  const confirmKey = () => CONFIRM_PREFIX + eventId;
  function loadConfirms() {
    confirms = (eventId && ss.get(confirmKey())) || {};
  }
  function setConfirm(key, value) {
    if (value) confirms[key] = value;
    else delete confirms[key];
    ss.set(confirmKey(), confirms);
    render();
  }

  /* the live scan of this event handed over from a signed-in page */
  function compareHere() {
    const now = Date.now();
    return (((state && state.compares) || []).find(
      (c) => c.eventId === eventId && M.compareLive(c, now),
    ) || null);
  }

  const ownSeen = () => Object.keys(store.own || {}).length;
  /* signed out = a scan that found nothing labelled as yours */
  const signedOutView = () => !ownSeen() && !!compareHere();

  async function publishCompare(quiet) {
    if (!ownSeen()) return null;
    try {
      const c = await ui.send("putCompare", { compare: M.compareFrom(store, info) });
      if (!quiet) note(`Handed on to the listings page and to this event signed out — until ${U.fmtClock(c.expiresAt)}.`);
      return c;
    } catch (e) {
      if (!quiet) note(e.message, true);
      return null;
    }
  }

  async function copyCompare() {
    const c = M.compareFrom(store, info);
    try {
      await navigator.clipboard.writeText(M.packCompare(c));
      note(`Copied ${U.plural(M.compareMine(c).length, "listing")} in ${U.plural(c.sections.length, "section")} — paste it on the listings page or in an incognito window. Valid until ${U.fmtClock(c.expiresAt)}.`);
    } catch (e) {
      note("The clipboard refused: click the page once and press Copy again.", true);
    }
    publishCompare(true);
  }

  async function takePaste(text) {
    let c;
    try {
      c = M.unpackCompare(text);
    } catch (e) {
      note(e.message, true);
      return;
    }
    if (c.eventId !== eventId) {
      note(`That scan is of another event (${c.name || "E-" + c.eventId}), not this one.`, true);
      return;
    }
    try {
      await ui.send("putCompare", { compare: c });
      pasteOpen = false;
      note(`Pasted: ${U.plural(M.compareMine(c).length, "listing")} of yours to look for. Valid until ${U.fmtClock(c.expiresAt)}.`);
      await refresh();
    } catch (e) {
      note(e.message, true);
    }
  }

  function pasteBox() {
    const box = ui.el("div", "dr-paste");
    const area = ui.el("textarea");
    area.placeholder = "Paste the scan copied on the signed-in event page (⌘V / Ctrl+V)";
    area.rows = 2;
    area.addEventListener("paste", (e) => {
      const text = e.clipboardData && e.clipboardData.getData("text");
      if (text) {
        e.preventDefault();
        takePaste(text);
      }
    });
    const read = ui.button("Paste from clipboard", "mini", async () => {
      try {
        takePaste(await navigator.clipboard.readText());
      } catch (e) {
        note("The clipboard can't be read from here: click in the box and press ⌘V / Ctrl+V.", true);
      }
    });
    box.append(area, read, ui.button("Cancel", "ghost mini", () => { pasteOpen = false; render(); }));
    setTimeout(() => area.focus(), 0);
    return box;
  }

  const allRows = () => Object.values(store.sections).flatMap((s) => s.rows);

  /* the store as this page should show it: on a signed-out page the rows you
   * confirmed (or that match very strongly) count as yours, so every rank,
   * gap and total below is worked out with them */
  function viewStore(match) {
    if (!match) return store;
    const sections = {};
    for (const [k, s] of Object.entries(store.sections)) {
      sections[k] = Object.assign({}, s, {
        rows: s.rows.map((r) => {
          const m = match.rows[r.id];
          if (!m || m.status === "other") return r;
          return Object.assign({}, r, {
            mine: m.status === "mine",
            maybe: m.status === "possible",
            mineId: m.listings.length === 1 ? m.listings[0] : "",
            confirmKey: m.key,
            how: m.how || "",
          });
        }),
      });
    }
    return Object.assign({}, store, { sections });
  }

  function describe(r) {
    const qty = r.qtyMax
      ? r.qtyMin && r.qtyMin !== r.qtyMax ? `${r.qtyMin}–${r.qtyMax} together` : `${r.qtyMax} together`
      : "";
    return [r.section, r.row ? `Row ${r.row}` : "", qty, ...(r.features || [])].filter(Boolean).join(" · ");
  }

  function placeText(p) {
    const gap =
      p.gap === null ? "nobody else to compare with"
        : p.gap > 0 ? `${price(p.gap)} above the cheapest other`
        : p.gap === 0 ? "tied with the cheapest other"
        : `cheapest by ${price(-p.gap)}`;
    return `#${p.position} of ${p.of} in the list · ${ordinal(p.rank)} cheapest of ${p.listings} here · ${gap}` +
      (p.unsure ? ` · ${U.plural(p.unsure, "row")} here may be yours too` : "");
  }

  const yesNo = (key, current) => {
    const box = ui.el("span", "dr-yesno");
    const yes = ui.button(current === "yes" ? "Mine ✓" : "Mine", "mini" + (current === "yes" ? " primary" : ""), (e) => {
      e.stopPropagation();
      setConfirm(key, current === "yes" ? "" : "yes");
    }, "This row is my listing — count it as mine from now on");
    const no = ui.button(current === "no" ? "Not mine ✓" : "Not mine", "mini" + (current === "no" ? " danger on" : ""), (e) => {
      e.stopPropagation();
      setConfirm(key, current === "no" ? "" : "no");
    }, "This row is someone else's — stop matching it");
    box.append(yes, no);
    return box;
  }

  /* your listings as a signed-out buyer sees them */
  function comparePanel(c, match, rows) {
    const box = ui.el("div", "dr-compare");
    const head = ui.el("div", "dr-compare-head");
    head.append(
      ui.el("b", null, "Your listings, signed out"),
      ui.el("span", "m", `from your scan at ${U.fmtClock(c.at)} (${U.ago(c.at)}) · expires ${U.fmtClock(c.expiresAt)}`),
      ui.el("span", "spacer"),
      ui.button("Forget it", "ghost mini", () => ui.send("dropCompare", { eventId }).then(refresh), "Stop comparing with that scan"),
    );
    box.append(head);
    if (!match) {
      box.append(ui.el("p", "note", `Press Scan to look for your ${U.plural(M.compareMine(c).length, "listing")} on this page.`));
      return box;
    }
    const count = (st) => match.listings.filter((l) => l.status === st).length;
    box.append(ui.el("p", "dr-compare-sum", [
      [count("mine"), "mine"], [count("possible"), "possibly mine"], [count("hidden"), "hidden"], [count("unseen"), "not seen yet"],
    ].filter(([n]) => n).map(([n, what]) => `${n} ${what}`).join(" · ") || "No listing of yours to look for"));

    const ORDER = { mine: 0, possible: 1, hidden: 2, unseen: 3 };
    const LABEL = { mine: "Mine", possible: "Possibly mine", hidden: "Hidden", unseen: "Not seen yet" };
    const ul = ui.el("ul", "dr-mine-list");
    for (const l of match.listings.slice().sort((a, b) => ORDER[a.status] - ORDER[b.status])) {
      const li = ui.el("li", "st-" + l.status);
      const top = ui.el("div", "t");
      top.append(ui.el("span", "pill st-" + l.status, LABEL[l.status]), ui.el("b", null, describe(l.row)), ui.el("span", "m", `listing ${l.id}`));
      li.append(top);
      if (l.status === "mine") {
        const r = l.matches[0];
        if (r) {
          const line = ui.el("div", "d");
          line.append(ui.el("span", null, `${price(r.price)} · ${placeText(M.placeOf(r, rows, match))}`));
          line.append(ui.el("span", "m", l.how === "you" ? "you confirmed it" : l.how === "id" ? "by its listing ID" : "row, quantity and features match only this listing"));
          if (l.how !== "id") line.append(yesNo(match.rows[r.id].key, confirms[match.rows[r.id].key] || ""));
          li.append(line);
        }
      } else if (l.status === "possible") {
        for (const r of l.matches) {
          const line = ui.el("div", "d");
          line.append(ui.el("span", null, `${price(r.price)} · ${placeText(M.placeOf(r, rows, match))}`));
          line.append(yesNo(match.rows[r.id].key, confirms[match.rows[r.id].key] || ""));
          li.append(line);
        }
      } else if (l.status === "hidden") {
        li.append(ui.el("div", "d m", "Nothing on this page shows these seats: a buyer who is not signed in does not see this listing."));
      } else {
        li.append(ui.el("div", "d m", "Not found in what was read — the scan stopped before the end of the list."));
      }
      ul.append(li);
    }
    box.append(ul);
    return box;
  }

  /* ---------------- face values from the ticket site ----------------- *
   * A stadium read on eFinity knows each sector's face value and its free
   * seats, but nothing ties that page to this viagogo event. It arrives as a
   * code (or is picked from this PC's recent reads) and stays linked to this
   * event in chrome.storage — a refresh keeps it, unlike a scan. Which face
   * sector a viagogo section is: the site's own names first, a pick by hand
   * in the Face value column when that is wrong. */

  let faceLinks = {}; // viagogo event id -> { face, map: { sectionKey: code | '' }, at }
  let faceOpen = false;
  let faceEl = null;

  async function loadFace() {
    try {
      const { ui: u } = await chrome.storage.local.get("ui");
      faceLinks = (u && u.vgFace) || {};
    } catch (e) {
      /* nothing linked */
    }
  }

  async function saveFace() {
    try {
      const { ui: u } = await chrome.storage.local.get("ui");
      await chrome.storage.local.set({ ui: Object.assign({}, u || {}, { vgFace: faceLinks }) });
    } catch (e) {
      /* kept in memory for this page */
    }
  }

  const faceLink = () => (eventId && faceLinks[eventId]) || null;
  const siteLabel = (id) => (SK.sites && SK.sites[id] && SK.sites[id].label) || id || "the ticket site";

  function linkFace(face) {
    const old = faceLink();
    /* the same show again (a fresh read): keep the sectors picked by hand */
    const map = old && old.face.site === face.site && old.face.siteId === face.siteId ? old.map : {};
    faceLinks[eventId] = { face, map, at: Date.now() };
    saveFace();
    faceOpen = false;
    faceEl = null;
    lastBodySig = null;
    note(`Linked ${U.plural(face.sectors.length, "sector")} of ${face.title || siteLabel(face.site)} (${siteLabel(face.site)}, read ${U.ago(face.at)}).`);
  }

  function unlinkFace() {
    delete faceLinks[eventId];
    saveFace();
    faceEl = null;
    lastBodySig = null;
    render();
  }

  function pickFace(label, code) {
    const L = faceLink();
    if (!L) return;
    /* back to the guess: forget the pick */
    if (code === "__auto") delete L.map[U.normKey(label)];
    else L.map[U.normKey(label)] = code;
    saveFace();
    lastBodySig = null;
    render();
  }

  function takeFace(text) {
    try {
      linkFace(F.unpack(text));
    } catch (e) {
      note(e.message, true);
    }
  }

  /* stadium reads made on this PC in the last hour, with prices */
  function recentReads() {
    return Object.values((state && state.previews) || {})
      .map((pv) => F.fromPreview(pv))
      .filter((f) => f.sectors.length)
      .sort((a, b) => b.at - a.at);
  }

  function faceBox() {
    const box = ui.el("div", "dr-face-box");
    const L = faceLink();
    if (L) {
      const line = ui.el("div", "dr-face-line");
      line.append(
        ui.el("b", null, `Face values: ${L.face.title || "linked"}`),
        ui.el("span", "m", `${siteLabel(L.face.site)} · ${U.plural(L.face.sectors.length, "sector")} · read ${U.ago(L.face.at)}`),
        ui.el("span", "spacer"),
      );
      if (L.face.url) {
        const a = document.createElement("a");
        a.href = L.face.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Open the stadium";
        line.append(a);
      }
      line.append(ui.button("Unlink", "ghost mini", () => unlinkFace(), "Stop showing these face values on this event"));
      box.append(line);
    }
    /* your tracked events whose sectors carry prices: built from the team's
     * last scans, no reading needed */
    const known = ((state && state.events) || []).filter((e) => !e.archived && (e.site === "efinity" || e.site === "posttick"));
    if (known.length) {
      const line = ui.el("div", "dr-face-line");
      const sel = ui.el("select", "dr-face-events");
      const first = ui.el("option", null, "Pick a tracked event…");
      first.value = "";
      sel.append(first);
      for (const e of known) {
        const o = ui.el("option", null, `[${e.num}] ${e.title} · ${siteLabel(e.site)}${e.date ? " · " + e.date : ""}`);
        o.value = e.key;
        o.selected = !!L && L.face.site === e.site && L.face.siteId === e.siteId;
        sel.append(o);
      }
      sel.addEventListener("change", async () => {
        if (!sel.value) return;
        try {
          const r = await ui.send("faceFor", { eventKey: sel.value });
          linkFace(r.face);
        } catch (e) {
          note(e.message, true);
        }
      });
      line.append(ui.el("span", "m", "Tracked:"), sel);
      box.append(line);
    }
    const recent = recentReads();
    if (recent.length) {
      const line = ui.el("div", "dr-face-line");
      line.append(ui.el("span", "m", "Read on this PC:"));
      for (const f of recent.slice(0, 4)) {
        const same = L && L.face.site === f.site && L.face.siteId === f.siteId && L.face.at === f.at;
        const b = ui.button(`${f.title || siteLabel(f.site)} · ${U.ago(f.at)}`, "mini" + (same ? "" : " primary"), () => linkFace(f),
          same ? "Already linked" : `Link ${siteLabel(f.site)}'s face values and free seats to this viagogo event`);
        b.disabled = !!same;
        line.append(b);
      }
      box.append(line);
    }
    const paste = ui.el("div", "dr-paste");
    const area = ui.el("textarea");
    area.placeholder = 'Paste a face-value code ("Copy for viagogo" on the ticket site) — ⌘V / Ctrl+V';
    area.rows = 1;
    area.addEventListener("paste", (e) => {
      const text = e.clipboardData && e.clipboardData.getData("text");
      if (text) {
        e.preventDefault();
        takeFace(text);
      }
    });
    const read = ui.button("Paste from clipboard", "mini", async () => {
      try {
        takeFace(await navigator.clipboard.readText());
      } catch (e) {
        note("The clipboard can't be read from here: click in the box and press ⌘V / Ctrl+V.", true);
      }
    });
    paste.append(area, read);
    if (L) paste.append(ui.button("Close", "ghost mini", () => { faceOpen = false; faceEl = null; lastBodySig = null; render(); }));
    box.append(paste);
    return box;
  }

  /* ---------------- face value money --------------------------------- */

  const fxRates = () => (state && state.fx && state.fx.rates) || {};
  const toUsd = (n, cur) => F.convert(n, cur, "USD", fxRates());
  /* dinars and lek in whole units, the rest as money */
  const faceMoney = (n, cur) =>
    ["RSD", "ALL"].includes(cur) ? `${Math.round(n).toLocaleString("en")} ${cur === "ALL" ? "L" : cur}` : P.formatMoney(n, cur);

  /* -> { L, how, secs, sec } for a viagogo section, or null with nothing
   * linked. secs is every face sector the section stands for — more than one
   * when viagogo names it more loosely ("210" for "210 RIGHT P" and "210 LEFT
   * K"); sec is set only when there is exactly one. */
  function faceOf(label) {
    const L = faceLink();
    if (!L) return null;
    const m = F.match(L.face, label, L.map);
    /* a sector priced by category (Posttick) is one entry per category */
    const secs = m.codes.flatMap((c) => F.entriesOf(L.face, c)).sort((a, b) => b.price - a.price);
    return { L, how: m.how, secs, sec: secs.length === 1 ? secs[0] : null };
  }

  /* one display price against one face sector: the gap in dollars and the multiple */
  function vsOne(priceShown, L, sec) {
    if (!sec || !(priceShown > 0)) return null;
    const cur = currencyOfStore();
    const faceShown = F.convert(sec.price, L.face.currency, cur, fxRates());
    if (!faceShown) return null;
    const a = toUsd(priceShown, cur), b = toUsd(sec.price, L.face.currency);
    return { mult: priceShown / faceShown, usd: a !== null && b !== null ? a - b : null };
  }

  /* against every price the section stands for: lo is against the dearest
   * face value, hi against the cheapest — the colour goes by lo, so a split
   * section is never shown rosier than its dearest seats */
  function vsFace(priceShown, f) {
    if (!f || !f.secs.length) return null;
    const lo = vsOne(priceShown, f.L, f.secs[0]);
    const hi = vsOne(priceShown, f.L, f.secs[f.secs.length - 1]);
    if (!lo || !hi) return null;
    return { lo, hi, mult: lo.mult, split: f.secs[0].price !== f.secs[f.secs.length - 1].price };
  }

  const multBand = (m) => (m < 1 ? "fv-lo" : m < 1.3 ? "fv-mid" : "fv-hi");
  const usdGap = (n) => (n === null ? "" : `${n < 0 ? "−" : "+"}${P.formatMoney(Math.abs(n), "USD")}`);
  const vsText = (v) => {
    if (!v) return "";
    if (v.lo && v.split) {
      const d = v.lo.usd !== null && v.hi.usd !== null ? `${usdGap(v.lo.usd)} to ${usdGap(v.hi.usd)} · ` : "";
      return `${d}${F.multText(v.lo.mult)}–${F.multText(v.hi.mult).slice(1)}`;
    }
    const one = v.lo || v;
    return (one.usd === null ? "" : usdGap(one.usd) + " · ") + F.multText(one.mult);
  };

  const freeText = (x) =>
    x.unmapped ? "standing" : x.available === null ? "not read" : x.available <= 0 ? "sold out"
      : x.perTable ? U.plural(Math.floor(x.available / x.perTable), "table") : `${x.available} free`;
  const range = (lo, hi, fmt) => (lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`);
  /* "2,500–3,000 RSD": a currency written after the number is written once */
  const faceRange = (lo, hi, cur) =>
    lo === hi || !["RSD", "ALL"].includes(cur) ? range(lo, hi, (n) => faceMoney(n, cur))
      : `${Math.round(lo).toLocaleString("en")}–${faceMoney(hi, cur)}`;

  /* the face value cell: one price, or a range over the sectors the section
   * is split into — with a select, so a wrong guess is put right where it shows */
  function faceCell(s) {
    const td = ui.el("td", "n fv");
    const f = faceOf(s.label);
    const cur = f.L.face.currency;
    if (f.secs.length) {
      const lo = f.secs[f.secs.length - 1].price, hi = f.secs[0].price;
      td.append(ui.el("b", null, faceRange(lo, hi, cur)));
      const ul = toUsd(lo, cur), uh = toUsd(hi, cur);
      td.append(ui.el("small", null, ul === null ? "no $ rate" : range(ul, uh, (n) => P.formatMoney(n, "USD"))));
      if (f.secs.length > 1) {
        const free = f.secs.reduce((n, x) => n + Math.max(0, x.available || 0), 0);
        td.append(ui.el("small", "fv-split", `split · ${U.plural(f.secs.length, "sector")} · ${free} free`));
      }
      const v = vsFace(s.sum.cheapest, f);
      td.title = f.secs.map((x) => `${F.nameOf(x)}: ${faceMoney(x.price, cur)} · ${freeText(x)}`).join("\n") +
        (v ? `\nCheapest here ${price(s.sum.cheapest)}: ${vsText(v)}` : "");
    }
    const sel = ui.el("select", "fv-pick");
    const opt = (value, text, on) => {
      const o = ui.el("option", null, text);
      o.value = value;
      o.selected = !!on;
      sel.append(o);
    };
    const guessed = F.match(f.L.face, s.label, {});
    const manual = f.how === "picked" || f.how === "none";
    opt("__auto", guessed.codes.length > 1 ? `auto · ${U.plural(guessed.codes.length, "sector")}` : guessed.codes.length ? `auto · ${guessed.codes[0]}` : "auto · no match", !manual);
    opt("", "— none —", f.how === "none");
    /* one option per sector, with its price or the range of its categories */
    const pickedCode = f.how === "picked" && f.secs.length ? f.secs[0].code : null;
    const codes = [...new Set(f.L.face.sectors.map((x) => x.code))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    for (const code of codes) {
      const ps = F.entriesOf(f.L.face, code).map((x) => x.price);
      opt(code, `${code} · ${faceRange(Math.min(...ps), Math.max(...ps), cur)}`, pickedCode === code);
    }
    sel.title = f.how === "picked" ? "Picked by hand — choose auto to go back to the guess"
      : f.how === "none" ? "Set to no sector by hand"
      : f.how === "split" ? `Guessed: viagogo's ${s.label} covers ${f.secs.map((x) => F.nameOf(x)).join(", ")} — pick one if it is only one of them`
      : f.secs.length ? "Guessed by name — change it if wrong" : "No sector guessed — pick it";
    for (const t of ["click", "keydown", "pointerdown"]) sel.addEventListener(t, (e) => e.stopPropagation());
    sel.addEventListener("change", () => pickFace(s.label, sel.value));
    td.append(sel);
    return td;
  }

  /* the head of an opened section: its face value(s), how far the listings
   * sit, and — split over several sectors — each one's price and free seats */
  function faceLine(s) {
    const f = faceOf(s.label);
    if (!f) return null;
    const wrap = ui.el("div", "dr-face-head");
    const box = ui.el("div", "dr-face-sum");
    wrap.append(box);
    if (!f.secs.length) {
      box.append(ui.el("span", "m", "No face value for this section — pick its sector in the Face value column."));
      return wrap;
    }
    const cur = f.L.face.currency;
    const site = siteLabel(f.L.face.site);
    const lo = f.secs[f.secs.length - 1].price, hi = f.secs[0].price;
    const ul = toUsd(lo, cur), uh = toUsd(hi, cur);
    box.append(ui.el("b", null, `Face value ${faceRange(lo, hi, cur)}${ul !== null ? ` · ${range(ul, uh, (n) => P.formatMoney(n, "USD"))}` : ""}`));
    box.append(ui.el("span", "m", f.sec ? `${F.nameOf(f.sec)} on ${site}` : `split over ${U.plural(f.secs.length, "sector")} on ${site}`));
    const live = s.rows.filter((r) => !r.sold && r.price > 0).map((r) => r.price).sort((a, b) => a - b);
    if (live.length) {
      const low = vsFace(live[0], f);
      const mid = vsFace(live[Math.floor((live.length - 1) / 2)], f);
      if (low) box.append(ui.el("span", "fv " + multBand(low.mult), `cheapest ${vsText(low)}`));
      if (mid && live.length > 2) box.append(ui.el("span", "fv " + multBand(mid.mult), `median ${vsText(mid)}`));
    }
    if (f.sec) {
      box.append(ui.el("span", "m", `${freeText(f.sec)} on ${site}`));
      return wrap;
    }

    /* one line per face sector: its price, its seats, and the cheapest here against it */
    const { colorOf } = F.tiers(f.L.face.sectors.map((x) => x.price));
    const ul2 = ui.el("ul", "dr-face-split");
    for (const x of f.secs) {
      const li = ui.el("li", x.available > 0 ? "" : "empty");
      const dot = ui.el("span", "tier-dot");
      dot.style.background = colorOf(x.price);
      const usd = toUsd(x.price, cur);
      const v = live.length ? vsOne(live[0], f.L, x) : null;
      li.append(
        dot,
        ui.el("b", null, F.nameOf(x)),
        ui.el("span", "p", faceMoney(x.price, cur)),
        ui.el("span", "m", usd === null ? "" : P.formatMoney(usd, "USD")),
        ui.el("span", null, freeText(x)),
        ui.el("span", "m", x.available > 0 && !x.perTable && x.longest ? `longest ${x.longest}` : ""),
      );
      if (v) li.append(ui.el("span", "fv " + multBand(v.mult), `cheapest here ${usdGap(v.usd)} · ${F.multText(v.mult)}`));
      ul2.append(li);
    }
    wrap.append(ul2);
    return wrap;
  }

  /* ---------------- price groups ------------------------------------ *
   * Folded groups are remembered with the drawer's height and sorting:
   * "list:<lo>-<hi>" in the section table, "seats" and "seats:<price>" in
   * the face-value list below it. */

  const isClosed = (key) => (view.closed || []).includes(key);
  function toggleClosed(key) {
    const set = new Set(view.closed || []);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    view.closed = [...set];
    saveView();
    lastBodySig = null;
    render();
  }

  /* a clickable group head: caret, a dot per price, the label, the counts */
  function groupHead(tag, key, colors, label, extra, onToggle) {
    const head = ui.el(tag, "dr-tier" + (isClosed(key) ? " closed" : ""));
    head.tabIndex = 0;
    head.append(ui.el("span", "caret", isClosed(key) ? "▸" : "▾"));
    for (const c of colors) {
      const dot = ui.el("span", "tier-dot");
      dot.style.background = c;
      head.append(dot);
    }
    head.append(ui.el("b", null, label));
    for (const x of extra.filter(Boolean)) head.append(typeof x === "string" ? ui.el("span", "m", x) : x);
    const go = (e) => { e.stopPropagation(); (onToggle || (() => toggleClosed(key)))(); };
    head.addEventListener("click", go);
    head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(e); } });
    head.title = isClosed(key) ? "Show this group" : "Fold this group";
    return head;
  }

  /* the section table's groups: one per face price (or price range, for a
   * section split over several), dearest first, unmatched last */
  function priceGroups(list) {
    const groups = new Map();
    for (const s of list) {
      const f = faceOf(s.label);
      const lo = f.secs.length ? f.secs[f.secs.length - 1].price : 0;
      const hi = f.secs.length ? f.secs[0].price : 0;
      const key = f.secs.length ? `${lo}-${hi}` : "none";
      if (!groups.has(key)) groups.set(key, { key, lo, hi, f, sections: [] });
      groups.get(key).sections.push(s);
    }
    return [...groups.values()].sort((a, b) => b.hi - a.hi || b.lo - a.lo || (a.key === "none") - (b.key === "none"));
  }

  /* Every sector of the ticket site with seats free, at its face value, next
   * to the cheapest viagogo price for it: where buying and listing pays. */
  function faceSeats(list) {
    const L = faceLink();
    if (!L) return null;
    const cur = L.face.currency;
    const site = siteLabel(L.face.site);
    const bySector = new Map();
    for (const s of list) {
      for (const x of faceOf(s.label).secs) {
        const a = bySector.get(x.code) || [];
        a.push(s);
        bySector.set(x.code, a);
      }
    }
    /* everything but what is sold out: a standing area or a sector that was
     * not read may still have seats */
    const soldOut = (x) => !x.unmapped && x.available !== null && x.available <= 0;
    const rows = L.face.sectors.filter((x) => !soldOut(x));
    const gone = L.face.sectors.length - rows.length;
    const box = ui.el("div", "dr-face-seats");
    const seats = rows.reduce((n, x) => n + Math.max(0, x.available || 0), 0);
    box.append(groupHead("div", "seats", [], `Seats on ${site}`, [
      `${U.plural(rows.length, "sector")} · ${seats} seats free · read ${U.ago(L.face.at)}`,
      gone ? `${gone} sold out left out` : "",
      "face value against the cheapest here",
    ]));
    if (isClosed("seats")) return box;
    if (!rows.length) {
      box.append(ui.el("p", "note", `Everything was sold out on ${site} when it was read.`));
      return box;
    }
    const { colorOf } = F.tiers(L.face.sectors.map((x) => x.price));
    rows.sort((a, b) => b.price - a.price || (b.available || 0) - (a.available || 0) || a.code.localeCompare(b.code, "en", { numeric: true }));
    const t = ui.el("table", "dr-table");
    const hr = ui.el("tr");
    const heads = [
      ["Sector", `The sector on ${site}`],
      ["Face", `Its price on ${site}`],
      ["$", "The face value in US dollars, at today's rate"],
      ["Free", `Free seats on ${site} (whole tables for bar tables)`],
      ["Longest", "The longest run of seats next to each other"],
      ["viagogo", "The viagogo sections matched to it, and their cheapest price"],
      ["vs face", "The cheapest viagogo price against the face value"],
    ];
    for (const [h, why] of heads) {
      const th = ui.el("th", null, h);
      th.title = why;
      hr.append(th);
    }
    const thead = ui.el("thead");
    thead.append(hr);
    const tbody = ui.el("tbody");
    const prices = [...new Set(rows.map((x) => x.price))];
    for (const p of prices) {
      const group = rows.filter((x) => x.price === p);
      const key = `seats:${p}`;
      const gtr = ui.el("tr", "dr-tier-row");
      const gtd = ui.el("td");
      gtd.colSpan = heads.length;
      const usd = toUsd(p, cur);
      const free = group.reduce((n, x) => n + Math.max(0, x.available || 0), 0);
      gtd.append(groupHead("div", key, [colorOf(p)], faceMoney(p, cur), [
        usd === null ? "" : P.formatMoney(usd, "USD"),
        `${U.plural(group.length, "sector")} · ${free} free`,
      ]));
      gtr.append(gtd);
      tbody.append(gtr);
      if (isClosed(key)) continue;
      for (const x of group) {
        const tr = ui.el("tr", "sec");
        const first = ui.el("td");
        const dot = ui.el("span", "tier-dot");
        dot.style.background = colorOf(x.price);
        first.append(dot, ui.el("b", null, F.nameOf(x)));
        const secs = bySector.get(x.code) || [];
        const cheapest = secs.map((s) => s.sum.cheapest).filter((n) => n !== null).sort((a, b) => a - b)[0];
        const v = cheapest !== undefined ? vsOne(cheapest, L, x) : null;
        tr.append(
          first,
          ui.el("td", "n", faceMoney(x.price, cur)),
          ui.el("td", "n", usd === null ? "—" : P.formatMoney(usd, "USD")),
          ui.el("td", "n", x.available > 0 && !x.perTable ? String(x.available) : freeText(x)),
          ui.el("td", "n", x.perTable || !x.longest ? "—" : String(x.longest)),
          ui.el("td", "n", secs.length ? `${secs.map((s) => s.label).join(", ")}${cheapest !== undefined ? ` · ${price(cheapest)}` : ""}` : "not listed"),
          ui.el("td", "n" + (v ? " fv " + multBand(v.mult) : ""), v ? vsText(v) : "—"),
        );
        if (secs.length) {
          tr.title = "Open the matched viagogo section above";
          tr.addEventListener("click", () => {
            for (const s of secs) faceExpanded.add(s.key);
            /* its group may be folded: open it so the section can be seen */
            const want = new Set(priceGroups(secs).map((g) => `face:${g.key}`));
            view.closed = (view.closed || []).filter((k) => !want.has(k));
            saveView();
            lastBodySig = null;
            render();
            const open = app && app.querySelector(".dr-face-table tr.sec.open");
            if (open) open.scrollIntoView({ block: "center", behavior: "smooth" });
          });
        }
        tbody.append(tr);
      }
    }
    t.append(thead, tbody);
    const wrap = ui.el("div", "dr-table-wrap");
    wrap.append(t);
    box.append(wrap);
    return box;
  }

  /* ---------------- the Face value tab -------------------------------- *
   * Everything about face value lives here, apart from the listings table:
   * which ticket-site event is linked, and for every section how many
   * listings sit below or above face value and by how much. A section split
   * over several prices counts a listing as below only under the cheapest of
   * them, above only over the dearest, and "within" in between. */

  function placeOf(priceShown, f) {
    const v = vsFace(priceShown, f);
    if (!v) return null;
    return { v, where: v.hi.mult < 1 ? "below" : v.lo.mult >= 1 ? "above" : "within" };
  }

  function faceStats(s, f) {
    const live = s.rows.filter((r) => !r.sold && r.price > 0).sort((a, b) => a.price - b.price);
    const out = { live, below: [], within: [], above: [] };
    if (!f || !f.secs.length) return out;
    for (const r of live) {
      const p = placeOf(r.price, f);
      if (p) out[p.where].push({ r, v: p.v });
    }
    return out;
  }

  function faceSource(L) {
    const line = ui.el("div", "dr-face-line dr-face-source");
    line.append(
      ui.el("b", null, L.face.title || "Linked event"),
      ui.el("span", "m", `${siteLabel(L.face.site)} · ${U.plural(L.face.sectors.length, "price")} · read ${U.ago(L.face.at)}`),
      ui.el("span", "spacer"),
      ui.button(faceOpen ? "Done" : "Change", "mini", () => { faceOpen = !faceOpen; faceEl = null; lastBodySig = null; render(); },
        "Link another event, a fresh read or a pasted code"),
    );
    return line;
  }

  /* how far a section's listings are from face value */
  function faceTable(list) {
    const L = faceLink();
    const cur = L.face.currency;
    const { colorOf } = F.tiers(L.face.sectors.map((x) => x.price));
    const wrap = ui.el("div", "dr-table-wrap");
    const t = ui.el("table", "dr-table dr-face-table");
    const heads = [
      ["Section", ""],
      ["Face value", `The price on ${siteLabel(L.face.site)}, in its currency and in US dollars — change the sector if the guess is wrong`],
      ["Listings", "Listings viagogo shows in this section"],
      ["Below face", "Listings under face value, and the furthest under"],
      ["Above face", "Listings over face value, and the furthest over"],
      ["Cheapest", "The cheapest listing against face value"],
      ["Median", "The middle listing against face value"],
    ];
    const hr = ui.el("tr");
    for (const [h, why] of heads) {
      const th = ui.el("th", null, h);
      if (why) th.title = why;
      hr.append(th);
    }
    const thead = ui.el("thead");
    thead.append(hr);
    const tbody = ui.el("tbody");
    const vsCell = (x) => (x ? ui.el("td", "n fv " + multBand(x.v.mult), vsText(x.v)) : ui.el("td", "n", "—"));
    const countCell = (items, far) => {
      const td = ui.el("td", "n");
      if (!items.length) { td.textContent = "0"; return td; }
      td.append(ui.el("b", null, String(items.length)));
      if (far) td.append(ui.el("small", null, vsText(far.v)));
      return td;
    };
    const addRow = (s) => {
      const f = faceOf(s.label);
      const st = faceStats(s, f);
      const tr = ui.el("tr", "sec" + (faceExpanded.has(s.key) ? " open" : ""));
      tr.tabIndex = 0;
      const first = ui.el("td");
      first.append(ui.el("b", null, s.label));
      if (s.sum.mine.length) first.append(ui.el("small", null, `${s.sum.mine.length} yours`));
      const mid = st.live.length ? st.live[Math.floor((st.live.length - 1) / 2)] : null;
      const cheap = st.live[0] ? placeOf(st.live[0].price, f) : null;
      const median = mid && st.live.length > 2 ? placeOf(mid.price, f) : null;
      const belowCell = countCell(st.below, st.below[0]);
      const aboveCell = countCell(st.above, st.above[st.above.length - 1]);
      if (st.within.length) belowCell.title = `${U.plural(st.within.length, "listing")} sit between this section's face values`;
      tr.append(first, faceCell(s), ui.el("td", "n", String(st.live.length)), belowCell, aboveCell, vsCell(cheap), vsCell(median));
      const toggle = () => {
        if (faceExpanded.has(s.key)) faceExpanded.delete(s.key);
        else faceExpanded.add(s.key);
        lastBodySig = null;
        render();
      };
      tr.addEventListener("click", toggle);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      tbody.append(tr);
      if (!faceExpanded.has(s.key)) return;
      const dtr = ui.el("tr", "dr-detail");
      const td = ui.el("td");
      td.colSpan = heads.length;
      const fl = faceLine(s);
      if (fl) td.append(fl);
      if (f.secs.length) {
        const ul = ui.el("ul", "dr-list");
        for (const r of st.live) {
          const p = placeOf(r.price, f);
          const li = ui.el("li", (r.mine ? "mine" : r.maybe ? "maybe" : "") + (p ? " at-" + p.where : ""));
          li.append(ui.el("span", "p", price(r.price)));
          if (p) li.append(ui.el("span", "fv " + multBand(p.v.mult), vsText(p.v)));
          const qty = r.qtyMax ? (r.qtyMin && r.qtyMin !== r.qtyMax ? `${r.qtyMin}–${r.qtyMax} together` : `${r.qtyMax} together`) : "";
          li.append(ui.el("span", "m", [r.mine ? "yours" : r.maybe ? "possibly yours" : "", r.row ? `Row ${r.row}` : "", qty].filter(Boolean).join(" · ")));
          if (p && !p.v.split) li.title = `${price(r.price)} against ${F.nameOf(f.secs[0])} at ${faceMoney(f.secs[0].price, cur)}`;
          else if (p) li.title = f.secs.map((x) => `${F.nameOf(x)}: ${vsText(vsOne(r.price, f.L, x))}`).join("\n");
          ul.append(li);
        }
        td.append(ul);
      }
      dtr.append(td);
      tbody.append(dtr);
    };
    for (const g of priceGroups(list)) {
      const key = `face:${g.key}`;
      const gtr = ui.el("tr", "dr-tier-row");
      const gtd = ui.el("td");
      gtd.colSpan = heads.length;
      let below = 0, above = 0, all = 0;
      for (const s of g.sections) {
        const st = faceStats(s, faceOf(s.label));
        below += st.below.length; above += st.above.length; all += st.live.length;
      }
      const counts = `${U.plural(g.sections.length, "section")} · ${U.plural(all, "listing")}`;
      if (g.key === "none") {
        gtd.append(groupHead("div", key, [F.NO_PRICE], "No face value", [counts, "pick the sector in the Face value column"]));
      } else {
        const ul = toUsd(g.lo, cur), uh = toUsd(g.hi, cur);
        gtd.append(groupHead("div", key, g.lo === g.hi ? [colorOf(g.hi)] : [colorOf(g.hi), colorOf(g.lo)], faceRange(g.lo, g.hi, cur), [
          ul === null ? "" : range(ul, uh, (n) => P.formatMoney(n, "USD")),
          counts,
          below ? ui.el("span", "fv fv-lo", `${below} below face`) : "",
          above ? ui.el("span", "fv fv-hi", `${above} above`) : "",
        ]));
      }
      gtr.append(gtd);
      tbody.append(gtr);
      if (!isClosed(key)) g.sections.forEach(addRow);
    }
    t.append(thead, tbody);
    wrap.append(t);
    return wrap;
  }

  function faceView(list) {
    const box = ui.el("div", "dr-face-view");
    const L = faceLink();
    if (L) box.append(faceSource(L));
    if (!L || faceOpen) box.append(faceEl || (faceEl = faceBox()));
    if (!L) {
      box.append(ui.el("p", "dr-empty", 'Link the ticket site\'s face values: pick one of your tracked events, a stadium read on this PC, or paste a code copied with "Copy for viagogo" on the ticket site.'));
      return box;
    }
    if (list.length) {
      let below = 0, within = 0, above = 0, all = 0, unmatched = 0;
      for (const s of list) {
        const f = faceOf(s.label);
        if (!f.secs.length) { unmatched++; continue; }
        const st = faceStats(s, f);
        below += st.below.length; within += st.within.length; above += st.above.length; all += st.live.length;
      }
      const sumLine = ui.el("div", "dr-face-line dr-face-totals");
      sumLine.append(ui.el("b", null, `${U.plural(all, "listing")} against face value`));
      sumLine.append(ui.el("span", "fv fv-lo", `${below} below`));
      if (within) sumLine.append(ui.el("span", "fv fv-mid", `${within} within a split section's range`));
      sumLine.append(ui.el("span", "fv fv-hi", `${above} above`));
      if (unmatched) sumLine.append(ui.el("span", "m", `${U.plural(unmatched, "section")} without a face value`));
      box.append(sumLine, faceTable(list));
    } else {
      box.append(ui.el("p", "note", "Scan the listings to see them against face value."));
    }
    const fs = faceSeats(list);
    if (fs) box.append(fs);
    return box;
  }

  /* ---------------- saved scans ------------------------------------- *
   * A scan is kept only when Save is pressed: on this PC, in
   * chrome.storage under a "cache:" key (no other page redraws for it),
   * and, signed in, in Supabase too, where another PC and the app see it.
   * Only the newest SAVED_CAP per event are kept, here and there; the
   * oldest goes when a new one is saved. A refresh clears the scan on
   * screen, never what was saved. */

  const SAVED_PREFIX = "cache:vgscans:";
  const SAVED_CAP = 2;
  let saved = [];
  let diffPick = { from: "", to: "" }; // saved scan ids, "now" = the scan on screen, "" = the default
  const diffOpen = new Set(); // sections opened in the Changes tab

  const savedKey = () => SAVED_PREFIX + eventId;
  const isSaved = () => !!(store && store.scan) && saved.some((x) => x.at === store.scan.at);
  const signedIn = () => !!(state && state.auth && state.auth.signedIn);
  const trackedKey = () => {
    const ev = signedIn() ? trackedEvent() : null;
    return ev ? ev.key : null;
  };

  async function keepLocal(list) {
    if (list.length) await chrome.storage.local.set({ [savedKey()]: list });
    else await chrome.storage.local.remove(savedKey());
  }

  async function loadSaved() {
    const id = eventId;
    let list = [];
    try {
      const got = await chrome.storage.local.get(savedKey());
      list = Array.isArray(got[savedKey()]) ? got[savedKey()] : [];
    } catch (e) {
      /* nothing saved, or the extension was reloaded */
    }
    if (id !== eventId) return;
    const before = list.length;
    saved = M.mergeSaved(list, [], SAVED_CAP);
    if (saved.length !== before) keepLocal(saved).catch(() => {});
    lastBodySig = null;
    render();
    syncSaved(id);
  }

  /* Supabase's list of this event's scans, taken in. A copy that was in the
   * app once (it has a dbId) and is not any more was deleted there, by a
   * Reset or on another PC, so it goes here too; one that never got there
   * (saved signed out, or offline) stays, to be sent up. */
  function takeRemote(remote) {
    const kept = saved.filter((x) => !x.dbId || remote.some((y) => y.at === x.at));
    return M.mergeSaved(remote, kept, SAVED_CAP);
  }
  const sigOf = (list) => list.map((x) => `${x.at}:${x.dbId || ""}`).join();

  /* what Supabase has for this event, merged in; a scan of the newest two
   * that only this PC has goes up, so the app sees it too */
  async function syncSaved(id) {
    let remote;
    try {
      remote = await ui.send("vgScans", { vgEventId: id });
    } catch (e) {
      return; /* offline: this PC's own stay */
    }
    if (id !== eventId || !Array.isArray(remote)) return; /* null: signed out */
    let next = takeRemote(remote);
    for (const x of next.filter((y) => !y.dbId)) {
      try {
        const back = await ui.send("saveVgScan", { scan: x, eventKey: trackedKey() });
        if (id !== eventId) return;
        if (Array.isArray(back)) { remote = back; next = M.mergeSaved(back, next.filter((y) => !y.dbId || back.some((z) => z.at === y.at)), SAVED_CAP); }
      } catch (e) {
        break; /* sent up next time */
      }
    }
    if (sigOf(next) !== sigOf(saved)) {
      if (diffPick.from && !next.some((x) => x.id === diffPick.from)) diffPick.from = "";
      if (diffPick.to && diffPick.to !== "now" && !next.some((x) => x.id === diffPick.to)) diffPick.to = "";
      saved = next;
      try { await keepLocal(saved); } catch (e) { /* cosmetic */ }
      lastBodySig = null;
      render();
    }
  }

  async function saveScan() {
    if (scanning || !store.scan || isSaved()) return;
    const before = saved;
    const snap = M.snapshotOf(store, info, Date.now());
    const next = M.mergeSaved(saved, [snap], 0);
    const dropped = Math.max(0, next.length - SAVED_CAP);
    saved = next.slice(dropped);
    try {
      await keepLocal(saved);
    } catch (e) {
      saved = before;
      note(`Not saved: ${e.message}`, true);
      return;
    }
    diffPick = { from: "", to: "" };
    lastBodySig = null;
    const tail = (dropped ? ` The oldest was deleted: only the newest ${SAVED_CAP} are kept.` : "") +
      (saved.length > 1 ? " Changes shows what moved since the one before." : " Scan and save again later to see what changed.");
    if (!signedIn()) {
      note(`Saved on this PC (sign in to see it in the app).${tail}`);
      return;
    }
    note(`Saving…`);
    try {
      const remote = await ui.send("saveVgScan", { scan: snap, eventKey: trackedKey() });
      if (Array.isArray(remote)) {
        saved = takeRemote(remote);
        try { await keepLocal(saved); } catch (e) { /* cosmetic */ }
      }
      note(`Saved, here and in the app.${tail}`);
    } catch (e) {
      note(`Saved on this PC, but not in the app: ${e.message}`, true);
    }
    lastBodySig = null;
    render();
  }

  async function deleteSaved(id) {
    const gone = saved.find((x) => x.id === id);
    saved = saved.filter((x) => x.id !== id);
    if (diffPick.from === id) diffPick.from = "";
    if (diffPick.to === id) diffPick.to = "";
    try {
      await keepLocal(saved);
      if (gone && signedIn()) await ui.send("deleteVgScan", { vgEventId: eventId, at: gone.at });
    } catch (e) {
      note(e.message, true);
    }
    lastBodySig = null;
    render();
  }

  /* every saved scan of the event gone: here, in the app, and (the next
   * time their drawer opens it) on the other PCs */
  async function resetSaved() {
    if (!saved.length) return;
    const where = signedIn() ? "here, in the app and on your other PCs" : "on this PC";
    if (!confirm(`Delete the ${U.plural(saved.length, "saved scan")} of this event, ${where}?`)) return;
    saved = [];
    diffPick = { from: "", to: "" };
    try {
      await keepLocal(saved);
      if (signedIn()) await ui.send("resetVgScans", { vgEventId: eventId });
      note(signedIn() ? "Saved scans deleted, here and in the app. The next Save starts fresh." : "Saved scans deleted on this PC.");
    } catch (e) {
      note(`Deleted on this PC, but not in the app: ${e.message}`, true);
    }
    lastBodySig = null;
    render();
  }

  /* the two scans compared: by default the scan on screen (when it is not
   * saved yet) or the newest saved one, against the saved one before it */
  function diffSides() {
    const now = store.scan && !isSaved() ? M.snapshotOf(store, info) : null;
    const picked = diffPick.to === "now" ? now : saved.find((x) => x.id === diffPick.to) || null;
    const to = picked || now || saved[saved.length - 1] || null;
    const older = to ? saved.filter((x) => x.at < to.at) : [];
    const from = older.find((x) => x.id === diffPick.from) || older[older.length - 1] || null;
    return { now, to, from, older };
  }

  /* ---------------- the Changes tab ---------------------------------- */

  const money = (n, cur) => P.formatMoney(n, cur || "USD");
  const when = (ts) => new Date(ts).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const scanText = (x) => `${when(x.at)} · ${U.plural(x.rows.filter((r) => !r.sold && r.price > 0).length, "listing")} · ${x.signedIn ? "signed in" : "signed out"}${x.complete ? "" : " · partly read"}`;
  const qtyText = (r) => (r.qtyMax ? (r.qtyMin && r.qtyMin !== r.qtyMax ? `${r.qtyMin}–${r.qtyMax}` : String(r.qtyMax)) : "?");
  const signed = (n, fmt) => (n > 0 ? "+" : n < 0 ? "−" : "±") + (fmt ? fmt(Math.abs(n)) : String(Math.abs(n)));
  const spanOf = (a, b) => {
    const min = Math.round(Math.abs(b - a) / 60000);
    if (min < 1) return "under a minute";
    if (min < 60) return `${min} min`;
    if (min < 48 * 60) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
    return `${Math.round(min / 1440)} days`;
  };

  /* "120 → 131" and what it moved by */
  function moveCell(a, b, fmt, cls) {
    const td = ui.el("td", "n mv" + (cls ? " " + cls : ""));
    const f = fmt || String;
    if (a === null && b === null) { td.textContent = "—"; return td; }
    td.append(ui.el("span", "m", a === null ? "—" : f(a)), ui.el("span", "arrow", " → "), ui.el("b", null, b === null ? "—" : f(b)));
    if (a !== null && b !== null && a !== b) td.append(ui.el("small", b > a ? "up" : "down", signed(b - a, fmt ? (n) => f(n) : null)));
    return td;
  }

  const DIFF_KINDS = [
    ["all", "All changes", () => true],
    ["new", "New", (c) => c.kind === "new"],
    ["gone", "Removed", (c) => c.kind === "gone"],
    ["down", "Cheaper", (c) => c.delta < 0],
    ["up", "Dearer", (c) => c.delta > 0],
    ["qty", "Tickets", (c) => !!c.qty],
  ];
  const kindTest = () => (DIFF_KINDS.find((k) => k[0] === view.diffKind) || DIFF_KINDS[0])[2];

  function changeItem(c) {
    const r = c.b || c.a;
    const cur = r.currency;
    const li = ui.el("li", "chg chg-" + (c.kind === "changed" ? (c.delta < 0 ? "down" : c.delta > 0 ? "up" : "qty") : c.kind));
    const pill = c.kind === "new" ? "New" : c.kind === "gone" ? "Removed" : c.delta < 0 ? "Cheaper" : c.delta > 0 ? "Dearer" : "Tickets";
    li.append(ui.el("span", "pill", pill));
    if (c.kind === "changed" && c.delta) {
      li.append(ui.el("span", "p", `${money(c.a.price, cur)} → ${money(c.b.price, cur)}`), ui.el("span", c.delta < 0 ? "down" : "up", signed(c.delta, (n) => money(n, cur))));
    } else li.append(ui.el("span", "p", money(r.price, cur)));
    if (c.qty) li.append(ui.el("span", "q", `${qtyText(c.a)} → ${qtyText(c.b)} tickets`));
    else li.append(ui.el("span", "q", `${qtyText(r)} ${r.qtyMax === 1 ? "ticket" : "tickets"}`));
    const bits = [r.mine ? "yours" : "", r.row ? `Row ${r.row}` : "", ...(r.features || [])].filter(Boolean);
    li.append(ui.el("span", "m", bits.join(" · ")));
    if (c.how === "look") {
      const g = ui.el("span", "m guess", "matched by look");
      g.title = "Signed out, listings have no ID: this is the listing that looks the same (section, row, features) — a good guess, not a certainty";
      li.append(g);
    } else if (!r.anon && r.id) li.title = `listing ${r.id}`;
    return li;
  }

  function changesTable(d, sections, test) {
    const wrap = ui.el("div", "dr-table-wrap");
    const t = ui.el("table", "dr-table dr-diff");
    const heads = [
      ["Section", ""],
      ["Listings", "Listings for sale in the older scan → the newer one"],
      ["Tickets", "Tickets for sale (\"1–8 together\" counts as 8)"],
      ["Cheapest", "The cheapest display price"],
      ["New", "Listings that were not there before"],
      ["Removed", "Listings that are gone: sold, or taken off"],
      ["Price", "Listings still there whose price went down ↓ or up ↑"],
      ["Tickets moved", "Listings still there whose ticket count changed"],
    ];
    const hr = ui.el("tr");
    for (const [h, why] of heads) {
      const th = ui.el("th", null, h);
      if (why) th.title = why;
      hr.append(th);
    }
    const thead = ui.el("thead");
    thead.append(hr);
    const tbody = ui.el("tbody");
    const cur = (d.to.rows.find((r) => r.currency) || d.from.rows.find((r) => r.currency) || {}).currency || "USD";
    const count = (n, cls) => ui.el("td", "n" + (n ? " " + cls : ""), n ? String(n) : "—");
    for (const s of sections) {
      const list = d.changes.filter((c) => c.k === s.key && test(c));
      const open = diffOpen.has(s.key);
      const tr = ui.el("tr", "sec" + (open ? " open" : "") + (s.status ? " st-" + s.status : ""));
      tr.tabIndex = 0;
      const first = ui.el("td");
      first.append(ui.el("b", null, s.label || s.key));
      if (s.status === "new") first.append(ui.el("small", "badge new", "new on viagogo"));
      else if (s.status === "gone") first.append(ui.el("small", "badge gone", "nothing left"));
      tr.append(
        first,
        moveCell(s.a.listings, s.b.listings),
        moveCell(s.a.tickets, s.b.tickets),
        moveCell(s.a.cheapest, s.b.cheapest, (n) => money(n, cur), "price"),
        count(s.added, "c-new"),
        count(s.removed, "c-gone"),
      );
      const pc = ui.el("td", "n");
      if (s.down) pc.append(ui.el("span", "down", `↓${s.down}`));
      if (s.up) pc.append(ui.el("span", "up", `${s.down ? " " : ""}↑${s.up}`));
      if (!s.down && !s.up) pc.textContent = "—";
      tr.append(pc, count(s.qty, "c-qty"));
      const toggle = () => {
        if (diffOpen.has(s.key)) diffOpen.delete(s.key);
        else diffOpen.add(s.key);
        lastBodySig = null;
        render();
      };
      tr.addEventListener("click", toggle);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      tbody.append(tr);
      if (!open) continue;
      const dtr = ui.el("tr", "dr-detail");
      const td = ui.el("td");
      td.colSpan = heads.length;
      if (list.length) {
        const ul = ui.el("ul", "dr-list dr-changes");
        const order = { new: 0, gone: 1, changed: 2 };
        for (const c of list.slice().sort((x, y) => order[x.kind] - order[y.kind] || (x.b || x.a).price - (y.b || y.a).price)) ul.append(changeItem(c));
        td.append(ul);
      } else td.append(ui.el("p", "note", "No change of this kind here."));
      dtr.append(td);
      tbody.append(dtr);
    }
    t.append(thead, tbody);
    wrap.append(t);
    return wrap;
  }

  function changesView(tracked) {
    const box = ui.el("div", "dr-diff-view");
    const { now, to, from, older } = diffSides();
    if (!saved.length) {
      box.append(ui.el("p", "dr-empty", store.scan
        ? 'Press "Save scan" to keep this scan, here and in the app. Scan and save again later, and this tab shows what changed between the two: new and removed listings, prices that moved, and ticket counts. Only the newest 2 are kept.'
        : "Nothing saved for this event yet. Scan, then press \"Save scan\"; save again later and this tab shows what changed."));
      return box;
    }

    /* which two scans */
    const pickLine = ui.el("div", "dr-diff-pick");
    const sel = (options, value, onPick, label) => {
      const s = ui.el("select");
      s.setAttribute("aria-label", label);
      for (const [v, text] of options) {
        const o = ui.el("option", null, text);
        o.value = v;
        o.selected = v === value;
        s.append(o);
      }
      s.addEventListener("change", () => onPick(s.value));
      return s;
    };
    const toOptions = (now ? [["now", `This scan, not saved · ${scanText(now)}`]] : [])
      .concat(saved.slice().reverse().map((x) => [x.id, scanText(x)]));
    const toValue = to === now ? "now" : to ? to.id : "";
    pickLine.append(ui.el("span", "m", "From"));
    if (older.length) {
      pickLine.append(sel(older.slice().reverse().map((x) => [x.id, scanText(x)]), from ? from.id : "", (v) => {
        diffPick.from = v;
        lastBodySig = null;
        render();
      }, "The older scan"));
    } else pickLine.append(ui.el("b", null, "nothing older"));
    pickLine.append(ui.el("span", "m", "to"));
    pickLine.append(sel(toOptions, toValue, (v) => {
      diffPick = { from: "", to: v };
      lastBodySig = null;
      render();
    }, "The newer scan"));
    if (from && to) pickLine.append(ui.el("span", "m", `· ${spanOf(from.at, to.at)} apart`));
    box.append(pickLine);

    if (!from) {
      box.append(ui.el("p", "note", saved.length === 1 && !now
        ? "One scan saved. Scan again later and save it (or just scan: an unsaved scan is compared too) to see what changed."
        : "No saved scan is older than this one — pick another."));
      box.append(savedList());
      return box;
    }

    const d = M.diffScans(from, to);
    if (d.warnings.includes("signed")) {
      box.append(ui.el("p", "note err", `One scan was made signed in and the other signed out. viagogo shows every viewer its own prices, so prices can't be compared, and signed out no listing has an ID: everything may look new and removed.`));
    }
    const partly = [d.warnings.includes("fromPartial") ? "the older" : "", d.warnings.includes("toPartial") ? "the newer" : ""].filter(Boolean);
    if (partly.length) box.append(ui.el("p", "note", `${partly.join(" and ")} scan stopped before the end of the list: some "new" or "removed" listings may only be ones it did not reach.`.replace(/^./, (c) => c.toUpperCase())));

    /* the event in numbers */
    const T = d.totals;
    const cur = (to.rows.find((r) => r.currency) || {}).currency || "USD";
    const tiles = ui.el("div", "dr-tiles dr-diff-tiles");
    const tile = (value, label, cls, title) => {
      const x = ui.el("div", "dr-tile" + (cls ? " " + cls : ""));
      x.append(ui.el("b", null, value), ui.el("span", null, label));
      if (title) x.title = title;
      tiles.append(x);
    };
    tile(`${T.from.listings} → ${T.to.listings}`, `listings (${signed(T.to.listings - T.from.listings)})`);
    tile(`${T.from.tickets} → ${T.to.tickets}`, `tickets (${signed(T.to.tickets - T.from.tickets)})`);
    tile(String(T.added), `new · ${U.plural(T.addedTickets, "ticket")}`, T.added ? "c-new" : "");
    tile(String(T.removed), `removed · ${U.plural(T.removedTickets, "ticket")}`, T.removed ? "c-gone" : "", "Gone from the list: sold, or taken off by the seller");
    tile(`↓${T.down} ↑${T.up}`, "prices moved", T.down || T.up ? "c-price" : "");
    tile(T.qtyLess || T.qtyMore ? `−${T.qtyLess} +${T.qtyMore}` : "0", `tickets on ${U.plural(T.qty, "listing")} still there`, T.qty ? "c-qty" : "",
      "Listings still for sale whose ticket count went down (sold some, or edited) or up");
    if (T.from.cheapest !== null || T.to.cheapest !== null) {
      tile(`${T.from.cheapest === null ? "—" : money(T.from.cheapest, cur)} → ${T.to.cheapest === null ? "—" : money(T.to.cheapest, cur)}`, "cheapest");
    }
    box.append(tiles);
    if (T.guessed) box.append(ui.el("p", "note", `${U.plural(T.guessed, "listing")} paired by how they look (no listing ID signed out).`));

    /* what to show */
    const kinds = ui.el("div", "dr-qty dr-diff-kinds");
    kinds.append(ui.el("span", "m", "Show"));
    for (const [k, label, test] of DIFF_KINDS) {
      const n = d.changes.filter(test).length;
      const b = ui.button(`${label}${k === "all" ? "" : ` · ${n}`}`, (view.diffKind || "all") === k ? "on" : "", () => {
        view.diffKind = k;
        saveView();
        render();
      });
      if (!n && k !== "all") b.classList.add("none");
      kinds.append(b);
    }
    kinds.append(ui.checkbox("Only sections that changed", view.diffOnly !== false, (v) => {
      view.diffOnly = v;
      saveView();
      render();
    }));
    box.append(kinds);

    const test = kindTest();
    const standsOn = standsHere(d.sections, tracked);
    if (standsOn) box.append(standChips(d.sections, tracked));
    let sections = d.sections;
    if (standsOn) sections = sections.filter((s) => inStand(s.label));
    if (view.diffOnly !== false || (view.diffKind || "all") !== "all") sections = sections.filter((s) => d.changes.some((c) => c.k === s.key && test(c)) || ((view.diffKind || "all") === "all" && s.status));
    if (sections.length) box.append(changesTable(d, sections, test));
    else box.append(ui.el("p", "dr-empty", d.changes.length ? "No section has a change of this kind." : "Nothing changed between these two scans."));
    box.append(savedList());
    return box;
  }

  /* every saved scan of the event, to drop the ones not needed */
  function savedList() {
    const box = ui.el("div", "dr-saved");
    box.append(ui.el("span", "m", `Saved${signedIn() ? ", here and in the app" : " on this PC"} (${saved.length} of ${SAVED_CAP}${saved.length >= SAVED_CAP ? " — saving again deletes the oldest" : ""}):`));
    for (const x of saved.slice().reverse()) {
      const chip = ui.el("span", "dr-saved-chip");
      chip.append(ui.el("span", null, scanText(x)));
      const del = ui.button("×", "ghost mini", () => deleteSaved(x.id), "Delete this saved scan");
      del.setAttribute("aria-label", `Delete the scan of ${when(x.at)}`);
      chip.append(del);
      box.append(chip);
    }
    if (saved.length) box.append(ui.button("Reset saved scans", "ghost mini danger", () => resetSaved(),
      signedIn() ? "Delete every saved scan of this event, here, in the app and on your other PCs" : "Delete every saved scan of this event on this PC"));
    return box;
  }

  /* ---------------- the Last sales tab -------------------------------- *
   * What viagogo's "just sold" toast showed on this event's sell pages,
   * saved by whoever on the team had one open (content/sites/viagogo-lastsale.js). */

  function lastSalesHere(tracked) {
    if (!SK.lastSales || !state) return [];
    return SK.lastSales.forEvent(state.lastSales || [], {
      vgEventId: eventId, eventKey: tracked ? tracked.key : null, title: info.name, when: info.start,
    });
  }

  function lastSalesView(tracked) {
    const box = ui.el("div", "dr-last-view");
    const list = lastSalesHere(tracked);
    /* whether the scan asks viagogo about this event, and the switches */
    if (SK.lastSaleWatchUI) box.append(SK.lastSaleWatchUI(state, { vgEventId: eventId, title: info.name, when: info.start }, { onChange: () => refresh() }));
    if (!list.length) {
      box.append(ui.el("p", "dr-empty", 'No sale saved for this event yet. The last-sales scan asks viagogo about every event the team lists on, and any you add above; any sell page you open saves its "just sold" toast too.'));
      return box;
    }
    const tickets = list.reduce((n, s) => n + (Number(s.tickets) || 0), 0);
    box.append(ui.el("p", "dr-found", `${U.plural(list.length, "sale")} · ${U.plural(tickets, "ticket")} · by day, newest first. The time is when the sale was first read; the price is viagogo's for the sale, then per ticket.`));
    const wrap = ui.el("div", "dr-table-wrap");
    const table = ui.el("table", "dr-table");
    const head = ui.el("tr");
    for (const h of ["Time", "Section", "Tickets", "Price"]) head.append(ui.el("th", null, h));
    const thead = ui.el("thead");
    thead.append(head);
    table.append(thead);
    const tb = ui.el("tbody");
    /* one heading per day: its tickets and sales, then that day's sales */
    for (const g of SK.lastSales.byDay(list)) {
      const day = ui.el("tr", "dr-day");
      const cell = ui.el("td", null, SK.lastSales.dayLine(g));
      cell.colSpan = 4;
      day.append(cell);
      tb.append(day);
      for (const s of g.sales) tb.append(lastSaleRow(s));
    }
    table.append(tb);
    wrap.append(table);
    box.append(wrap);
    return box;
  }

  /* one sale's row in the Last sales table */
  function lastSaleRow(s) {
    const tr = ui.el("tr");
    const when = ui.el("td");
    when.append(ui.el("b", null, U.fmtClock(s.firstSeen)), ui.el("small", null, U.ago(s.firstSeen)));
    const sec = ui.el("td", "n");
    sec.append(ui.el("b", null, s.section));
    if (s.code && SK.lastSales.vgKeyOf(s.code) !== SK.lastSales.vgKeyOf(s.section)) sec.append(ui.el("small", null, `→ ${s.code}`));
    if (s.row) sec.append(ui.el("small", null, `row ${s.row}`));
    tr.append(when, sec,
      ui.el("td", "n", String(s.tickets || "?")),
      ui.el("td", "n", SK.lastSales.priceText(s, P.formatMoney)));
    tr.title = [`Saved ${U.fmtTime(s.firstSeen)}`, s.seenBy ? `read by ${s.seenBy}` : "", s.eventNum ? `[${s.eventNum}] ${s.eventTitle}` : "not matched to a tracked event"].filter(Boolean).join(" · ");
    return tr;
  }

  function tabs() {
    const box = ui.el("div", "dr-tabs");
    const L = faceLink();
    const tracked = state && state.auth && state.auth.signedIn ? trackedEvent() : null;
    const sold = lastSalesHere(tracked).length;
    for (const [id, label] of [["listings", "Listings"], ["changes", saved.length ? `Changes · ${saved.length}` : "Changes"], ["face", L ? "Face value ✓" : "Face value"], ["sales", sold ? `Last sales · ${sold}` : "Last sales"]]) {
      const b = ui.button(label, "tab" + (view.tab === id ? " on" : ""), () => {
        if (view.tab === id) return;
        view.tab = id;
        saveView();
        render();
      });
      b.setAttribute("aria-pressed", String(view.tab === id));
      box.append(b);
    }
    return box;
  }

  /* ---------------- the drawer --------------------------------------- */

  const SVG = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, text) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {}))
      n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const ordinal = (n) =>
    n +
    (n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : ["th", "st", "nd", "rd"][n % 10] || "th");
  const currencyOfStore = () => {
    for (const s of Object.values(store.sections))
      for (const r of s.rows) if (r.currency) return r.currency;
    return "USD";
  };
  const price = (n) => P.formatMoney(n, currencyOfStore());
  const tick = (n) => {
    const sign = { USD: "$", EUR: "€", GBP: "£" }[currencyOfStore()];
    return sign ? sign + Math.round(n) : Math.round(n) + "";
  };

  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement("div");
    host.id = "sk-vg-drawer";
    host.setAttribute(
      "style",
      "all: initial; position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483646;",
    );
    const shadow = host.attachShadow({ mode: "open" });
    for (const href of ["ui/app.css", "content/drawer.css"]) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = chrome.runtime.getURL(href);
      shadow.append(l);
    }
    app = document.createElement("div");
    app.className = "sk-app vg-drawer";
    /* typing in the drawer must not reach viagogo's shortcuts */
    for (const t of ["keydown", "keyup", "keypress"])
      app.addEventListener(t, (e) => e.stopPropagation());
    shadow.append(app);
    document.documentElement.append(host);
  }

  function unmount() {
    if (host) host.remove();
    host = null;
    app = null;
  }

  function subtitle(t) {
    if (scanning) {
      const f = VG.listFooter(document);
      return `Scanning · "Show more" pressed ${U.plural(scanning.pages, "time")} · ${f ? `${f.shown} of ${f.total}` : U.plural(scanning.rows, "listing")} loaded`;
    }
    if (!t.sections)
      return "Nothing scanned yet — remove viagogo's filters, then press Scan.";
    const partly = store.scan && !store.scan.complete ? " · partly read" : "";
    return `${U.plural(t.sections, "section")} · ${U.plural(t.listings, "listing")} · ${U.plural(t.tickets, "ticket")} · yours in ${t.withMine} · read ${U.ago(t.oldest)}${partly}`;
  }

  function bar(t, tracked) {
    const b = ui.el("div", "dr-bar");
    const logo = document.createElement("img");
    logo.src = chrome.runtime.getURL("icons/32.png");
    logo.className = "logo";
    logo.alt = "";
    const titles = ui.el("div", "dr-titles");
    titles.append(
      ui.el(
        "div",
        "dr-title",
        `${info.name || "viagogo event"}${tracked ? ` · [${tracked.num}] ${tracked.title}` : ""}`,
      ),
      ui.el("div", "dr-sub", subtitle(t)),
    );
    b.append(logo, titles);

    const sel = VG.selectedSectionOf(location);
    const scan = ui.button(
      t.sections ? "Scan again" : "Scan",
      "primary",
      () => startScan(),
      sel
        ? "A section is picked on the map, so the list shows only that section — clear it first"
        : 'Press "Show more" until every listing is loaded, then read them all',
    );
    scan.disabled = !!sel || !!scanning;
    b.append(scan);
    if (scanning) b.append(ui.button("Stop", "danger", () => stopScan()));
    /* viagogo's own Sell link for this event, in a new tab */
    const sellAt = SK.lastSales && SK.lastSales.sellUrl(eventId);
    if (sellAt) b.append(ui.button("Sell", "", () => window.open(sellAt, "_blank", "noopener"), "Open viagogo's sell page for this event in a new tab"));
    /* collapsed: only Scan and Sell, and the way to open it */
    if (!view.open) {
      b.append(openToggle());
      return b;
    }
    const kept = isSaved();
    const keep = ui.button(kept ? "Saved ✓" : "Save scan", kept ? "ghost" : "", () => saveScan(),
      kept ? "This scan is saved on this PC. Scan again later and save that one too: Changes shows what moved between them"
        : saved.length ? `Keep this scan on this PC, next to ${U.plural(saved.length, "saved scan")} — Changes compares them`
          : "Keep this scan on this PC, to compare a later scan with it");
    keep.disabled = !!scanning || !store.scan || kept;
    b.append(keep);
    const clear = ui.button(
      "Clear",
      "ghost",
      () => clearEvent(),
      "Forget this event's scanned sections",
    );
    clear.disabled = !!scanning || !t.sections;
    /* signed in: hand the scan on; anywhere else: take one */
    if (ownSeen()) {
      const copy = ui.button("Copy for compare", "", () => copyCompare(),
        "Copy your sections of this scan, to paste on the listings page or on this event in an incognito window. It is also handed on by itself.");
      copy.disabled = !!scanning;
      b.append(copy);
    } else {
      b.append(ui.button(compareHere() ? "Paste another scan" : "Paste scan", "", () => { pasteOpen = !pasteOpen; render(); },
        "Paste a scan copied on this event while signed in, to find your listings on this page"));
    }
    b.append(
      clear,
      ui.helpButton("market", () => app),
    );
    b.append(openToggle());
    return b;
  }

  function openToggle() {
    return ui.button(
      view.open ? "▾" : "▴",
      "ghost icon",
      () => {
        view.open = !view.open;
        saveView();
        render();
      },
      view.open ? "Collapse" : "Open",
    );
  }

  function tiles(t) {
    const box = ui.el("div", "dr-tiles");
    const tile = (value, label, cls) => {
      const d = ui.el("div", "dr-tile" + (cls ? " " + cls : ""));
      d.append(ui.el("b", null, value), ui.el("span", null, label));
      return d;
    };
    box.append(
      tile(String(t.sections), "sections with listings"),
      tile(String(t.listings), "listings"),
      tile(String(t.tickets), "tickets"),
      tile(
        `${t.cheapestFor} / ${t.withMine}`,
        "cheapest where you list",
        t.withMine && t.cheapestFor === t.withMine ? "good" : "",
      ),
      tile(String(t.ownListings), "your listings seen"),
    );
    return box;
  }

  /* every section on one price axis: grey dots for everyone, blue for yours */
  function overview(list) {
    const rows = list.filter((s) => s.sum.prices.length);
    if (!rows.length) return null;
    const all = rows.flatMap((s) => s.sum.prices);
    const ax = M.axis(Math.min(...all), Math.max(...all), 6);
    const W = 460,
      L = 58,
      R = 14,
      T = 20,
      H = T + rows.length * 16 + 6;
    const x = (v) => L + ((v - ax.min) / (ax.max - ax.min)) * (W - L - R);
    const chart = svg("svg", {
      viewBox: `0 0 ${W} ${H}`,
      class: "dr-chart",
      role: "img",
      "aria-label": "Display prices by section",
    });
    for (const v of ax.ticks) {
      chart.append(
        svg("line", {
          x1: x(v),
          x2: x(v),
          y1: T - 6,
          y2: H - 4,
          class: "grid",
        }),
      );
      chart.append(
        svg(
          "text",
          { x: x(v), y: T - 9, "text-anchor": "middle", class: "axis" },
          tick(v),
        ),
      );
    }
    rows.forEach((s, i) => {
      const y = T + i * 16 + 8;
      chart.append(
        svg(
          "text",
          {
            x: L - 8,
            y: y + 3.5,
            "text-anchor": "end",
            class: "lab" + (s.sum.mine.length ? " mine" : ""),
          },
          s.label,
        ),
      );
      chart.append(
        svg("line", {
          x1: x(s.sum.cheapest),
          x2: x(s.sum.highest),
          y1: y,
          y2: y,
          class: "range",
        }),
      );
      for (const r of s.rows)
        if (!r.sold && r.price > 0 && !r.mine) {
          const dot = svg("circle", { cx: x(r.price), cy: y, r: 3, class: "dot" });
          dot.append(svg("title", {}, `${s.label} · ${tick(r.price)}`));
          chart.append(dot);
        }
      for (const m of s.sum.mine) {
        const dot = svg("circle", {
          cx: x(m.row.price),
          cy: y,
          r: 4.5,
          class: "dot mine",
        });
        dot.append(svg("title", {}, `${s.label} · your listing ${m.row.id} · ${tick(m.row.price)}`));
        chart.append(dot);
      }
    });
    return chart;
  }

  /* one section: every listing as a dot, ties stacked, yours in blue */
  function ladder(s) {
    const live = s.rows
      .filter((r) => !r.sold && r.price > 0)
      .sort((a, b) => a.price - b.price);
    if (!live.length) return null;
    const ax = M.axis(live[0].price, live[live.length - 1].price, 6);
    const W = 460,
      L = 14,
      R = 14;
    const x = (v) => L + ((v - ax.min) / (ax.max - ax.min || 1)) * (W - L - R);
    const stack = {};
    const dots = live.map((r) => {
      const k = Math.round(x(r.price) / 7);
      stack[k] = (stack[k] || 0) + 1;
      return { r, level: stack[k] - 1 };
    });
    const levels = Math.max(...dots.map((d) => d.level)) + 1;
    const H = 28 + levels * 9 + 14;
    const base = H - 20;
    const chart = svg("svg", {
      viewBox: `0 0 ${W} ${H}`,
      class: "dr-chart",
      role: "img",
      "aria-label": `Display prices in ${s.label}`,
    });
    chart.append(
      svg("line", { x1: L, x2: W - R, y1: base, y2: base, class: "grid" }),
    );
    for (const v of ax.ticks)
      chart.append(
        svg(
          "text",
          { x: x(v), y: H - 6, "text-anchor": "middle", class: "axis" },
          tick(v),
        ),
      );
    for (const d of dots.filter((d) => !d.r.mine)) {
      const dot = svg("circle", {
        cx: x(d.r.price),
        cy: base - 5 - d.level * 9,
        r: 3.5,
        class: "dot",
      });
      dot.append(svg("title", {}, tick(d.r.price)));
      chart.append(dot);
    }
    for (const d of dots.filter((d) => d.r.mine)) {
      const dot = svg("circle", {
        cx: x(d.r.price),
        cy: base - 5 - d.level * 9,
        r: 5,
        class: "dot mine",
      });
      dot.append(svg("title", {}, `your listing ${d.r.id} · ${tick(d.r.price)}`));
      chart.append(dot);
      chart.append(
        svg(
          "text",
          {
            x: x(d.r.price),
            y: base - 13 - d.level * 9,
            "text-anchor": "middle",
            class: "axis mine",
          },
          tick(d.r.price),
        ),
      );
    }
    return chart;
  }

  /* The money side of an opened section: the profit calculator for your
   * cheapest listing here, and — when you are above the cheapest other
   * seller — the real price that would close that gap. The gap is measured in
   * the display prices this page shows, then taken off the price you really
   * set, so it is a starting point, not a promise. */
  const sectionPrice = new Map(); // section key -> the price being tried

  function moneySide(s) {
    const best = s.sum && s.sum.mine[0];
    if (!best) return null;
    const side = ui.el("div", "dr-money");
    side.append(ui.el("div", "dr-money-title", "Your price here"));
    const l = listingOf(best.row.mineId || best.row.id);
    const money = l && l.money;
    const own = money && money.listing;
    if (!own || !own.price) {
      side.append(ui.el("p", "note", "Open your viagogo listings page once: its real price and payout are what the calculator works from."));
      return side;
    }
    const cur = own.currency;
    const holder = ui.el("div", "dr-calc");
    const draw = (price) => {
      if (price !== undefined) sectionPrice.set(s.key, price);
      holder.textContent = "";
      holder.append(ui.calculator(money, {
        price: sectionPrice.has(s.key) ? sectionPrice.get(s.key) : own.price,
        onPrice: (v) => sectionPrice.set(s.key, v),
      }));
    };
    if (best.gap !== null && best.gap > 0) {
      const target = Math.round((own.price - best.gap) * 100) / 100;
      const tip = ui.el("div", "dr-suggest");
      tip.append(
        ui.el("span", null, `${price(best.gap)} above the cheapest other seller here. Your real price ${P.formatMoney(own.price, cur)} − ${price(best.gap)} = `),
        ui.el("b", null, P.formatMoney(target, cur)),
      );
      const go = ui.button(`Try ${P.formatMoney(target, cur)}`, "mini primary", (e) => { e.stopPropagation(); draw(target); }, "Put this price in the calculator below — nothing on viagogo changes");
      tip.append(go);
      tip.title = "The gap is in the display prices this page shows; taken off the price you really set, it is where to start, not a promise.";
      side.append(tip);
    } else if (best.gap !== null) {
      side.append(ui.el("p", "note", best.gap === 0 ? "You are tied with the cheapest other seller." : `You are the cheapest, ${price(-best.gap)} under the next seller.`));
    }
    draw();
    side.append(holder);
    return side;
  }

  function detail(s, tracked) {
    const box = ui.el("div", "dr-detail-box");
    const team = teamAt(s, tracked);
    const who = T.whoIsHere(s.rows, team);
    const chart = ladder(s);
    if (chart) box.append(chart);
    const list = ui.el("ul", "dr-list");
    for (const r of s.rows
      .slice()
      .sort((a, b) => (a.price || 0) - (b.price || 0))) {
      const mate = who.byRow[r.id] || null;
      const li = ui.el(
        "li",
        (r.mine ? "mine" : r.maybe ? "maybe" : mate ? "team" : "") + (r.sold ? " sold" : ""),
      );
      const qty = r.qtyMax
        ? r.qtyMin && r.qtyMin !== r.qtyMax
          ? `${r.qtyMin}–${r.qtyMax} together`
          : `${r.qtyMax} together`
        : "";
      const extras = [
        r.row ? `Row ${r.row}` : "",
        qty,
        r.left ? `only ${r.left} left` : "",
        ...r.features,
        ...r.tags,
        r.sold ? "sold" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      li.append(ui.el("span", "p", r.price !== null ? price(r.price) : "—"));
      if (r.was) li.append(ui.el("s", "m", price(r.was)));
      /* signed out, a row of yours has no ID of its own: it is the listing it matched */
      const lid = r.anon ? r.mineId : r.id;
      if (r.mine && lid) {
        const link = document.createElement("a");
        link.href = `https://my.viagogo.com/listings/?search=${encodeURIComponent(lid)}&activeTab=ACTIVE%7CPENDING%7CDEACTIVATED%7CEXPIRED`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `Your listing ${lid}`;
        li.append(link);
      } else if (r.mine) {
        li.append(ui.el("span", null, "Yours"));
      } else if (r.maybe) {
        li.append(ui.el("span", null, "Possibly yours"));
        if (extras) li.append(ui.el("span", "m", extras));
      } else if (mate) {
        const label = ui.el("span", null, `${mate.owner}'s listing · ${P.formatMoney(mate.price, mate.currency)} set`);
        label.title =
          `Matched to ${mate.owner}'s listing by ${r.row && mate.row ? "the row" : "the ticket count"}` +
          ` · they set ${P.formatMoney(mate.price, mate.currency)} · read ${U.ago(mate.seenAt)}`;
        li.append(label);
        if (extras) li.append(ui.el("span", "m", extras));
      } else {
        li.append(ui.el("span", null, extras || (r.anon ? "listing" : `listing ${r.id}`)));
      }
      if (r.mine && extras) li.append(ui.el("span", "m", extras));
      if (r.confirmKey && r.how !== "id") li.append(yesNo(r.confirmKey, confirms[r.confirmKey] || ""));
      list.append(li);
    }
    box.append(list);

    const line = ui.teamLine(team, { label: "Team sets" });
    if (line) box.append(line);
    if (who.unmatched.length) {
      box.append(
        ui.el(
          "p",
          "note",
          `${U.plural(who.unmatched.length, "teammate listing")} here could not be matched to a row — viagogo shows every seller its own prices, so only the row and the ticket count can name them.`,
        ),
      );
    }
    box.append(tellTeam(s, tracked, team, who));
    /* the graph and the listings on one side, the money on the other */
    const money = moneySide(s);
    if (!money) return box;
    const grid = ui.el("div", "dr-detail-grid");
    grid.append(box, money);
    return grid;
  }

  /* Nothing about the team is ever sent on its own: this button is the only
   * way a message leaves this tab. */
  function tellTeam(s, tracked, team, who) {
    const acts = ui.el("div", "dr-acts");
    const mates = ((state && state.team) || []).filter((x) => !x.me);
    if (!tracked || !mates.length) return acts;
    const holder = ui.el("div", "dr-tell");
    const open = () => {
      holder.textContent = "";
      holder.append(
        ui.messageBox(
          state,
          {
            eventKey: tracked.key,
            section: s.label,
            prefill: prefillFor(s, team, who),
            sendLabel: "Send",
            onSent: () => {
              holder.textContent = "";
              holder.append(button);
            },
          },
          { notice: (text, err) => note(text, err) },
        ),
      );
    };
    const button = ui.button(
      who.teamOnly ? "Only us here — tell the team" : "Tell the team",
      who.teamOnly ? "mini primary" : "mini",
      open,
      "Send a message to your teammates' phones about this section",
    );
    holder.append(button);
    acts.append(holder);
    return acts;
  }

  function prefillFor(s, team, who) {
    const mine = myReal(s);
    const prices = [
      mine.length ? `you ${P.formatMoney(mine[0].price, mine[0].currency)}` : "",
      ...team.map((t) => `${t.owner} ${P.formatMoney(t.price, t.currency)}`),
    ].filter(Boolean);
    if (who.teamOnly) {
      return `${s.label}: only our listings${prices.length ? ` (${prices.join(", ")})` : ""} — raise?`;
    }
    const cheapest = s.sum.cheapest !== null ? `cheapest shown ${price(s.sum.cheapest)}` : "";
    return `${s.label}: ${U.plural(s.sum.listings, "listing")}${cheapest ? `, ${cheapest}` : ""}${prices.length ? ` · we set ${prices.join(", ")}` : ""}`;
  }

  /* How far your listing is from the nearest seller who is not you. Under
   * them it is green and negative — the room you have to go up; over them it
   * is amber, or red once it is worth doing something about. */
  function gapCell(best, sum) {
    if (!best || best.gap === null || best.gap === undefined) {
      const none = ui.el("td", "n gap", "—");
      none.title = best
        ? "Nobody else is listed here, so there is nothing to measure against"
        : "You have no listing in this section";
      return none;
    }
    const gap = best.gap;
    const other = sum.cheapestOther || 0;
    const share = other > 0 ? Math.abs(gap) / other : 0;
    const cls = gap <= 0 ? "g-ok" : share <= 0.1 ? "g-warn" : "g-bad";
    const text = gap > 0 ? "+" + price(gap) : gap < 0 ? "−" + price(-gap) : "0";
    const td = ui.el("td", "n gap " + cls, text);
    td.title =
      gap < 0
        ? `You are the cheapest — ${price(-gap)} under the next listing (${price(other)}), so there is room to go up`
        : gap === 0
          ? `Level with the next listing at ${price(other)}`
          : `${price(gap)} above the next listing (${price(other)})${share ? ` — ${Math.round(share * 100)}% more` : ""}`;
    return td;
  }

  /* the prices actually set — yours from your listings page, teammates' from
   * theirs. Never a payout, and never viagogo's display price. */
  function realCell(section, team) {
    const td = ui.el("td", "real");
    const mine = myReal(section);
    for (const m of mine) {
      const line = ui.el("div", "real-row mine");
      line.append(ui.el("b", null, "You"), ui.el("span", null, P.formatMoney(m.price, m.currency)));
      line.title = `You set ${P.formatMoney(m.price, m.currency)} for listing ${m.id}`;
      td.append(line);
    }
    for (const t of team) {
      const line = ui.el("div", "real-row" + (t.stale ? " stale" : ""));
      line.append(ui.el("b", null, t.owner), ui.el("span", null, P.formatMoney(t.price, t.currency)));
      line.title =
        `${t.owner} set ${P.formatMoney(t.price, t.currency)}${t.tickets ? ` for ${U.plural(t.tickets, "ticket")}` : ""}` +
        `${t.row ? ` · row ${t.row}` : ""} · read ${U.ago(t.seenAt)}${t.stale ? " — old, ask them" : ""}`;
      td.append(line);
    }
    if (!td.childNodes.length) {
      td.append(document.createTextNode("—"));
      td.title = state && state.auth && state.auth.signedIn
        ? "Neither you nor a teammate has a listing read here yet"
        : "Sign in to see what the team lists here";
    }
    return td;
  }

  function table(list, tracked) {
    const wrap = ui.el("div", "dr-table-wrap");
    const t = ui.el("table", "dr-table");
    const head = ui.el("tr");
    const heads = [
      ["Section", ""],
      ["Listings", "Yours / all listings viagogo shows in this section"],
      ["Cheapest", "The cheapest price viagogo shows here"],
      ["Tickets", "All tickets listed here, yours in brackets — \"1-8 together\" counts as 8"],
      ["Rank", "Where your cheapest listing sits among them"],
      ["Gap", "How far above the cheapest shown price you are"],
      tracked ? ["eBileta free", "Free seats in this sector on eBileta"] : null,
      ["Profit", "In lek, if every listed ticket sells"],
      ["Real prices", "The prices you and your teammates actually set, from your listings pages"],
    ].filter(Boolean);
    for (const [h, why] of heads) {
      const th = ui.el("th", null, h);
      if (why) th.title = why;
      head.append(th);
    }
    const thead = ui.el("thead");
    thead.append(head);
    const tbody = ui.el("tbody");
    const cols = heads.length;
    const addRow = (s) => {
      const sum = s.sum;
      const best = sum.mine[0];
      const stale = Date.now() - s.readAt > STALE;
      const team = teamAt(s, tracked);
      const who = T.whoIsHere(s.rows, team);
      const tr = ui.el(
        "tr",
        `sec k-${sum.kind}${who.teamOnly ? " k-teamonly" : ""}${stale ? " stale" : ""}${expanded.has(s.key) ? " open" : ""}`,
      );
      tr.tabIndex = 0;
      const first = ui.el("td");
      first.append(
        ui.el("b", null, s.label),
        ui.el("small", null, s.complete ? U.ago(s.readAt) : "partly read"),
      );
      if (who.teamOnly) {
        const only = ui.el("span", "only-us", "only us");
        only.title = who.assumed
          ? `Nobody outside the team seems to be here — ${U.plural(who.assumed, "teammate listing")} could not be pinned to a row, so this is a good guess, not a certainty.`
          : "Every listing here is yours or a teammate's — room to raise.";
        first.append(only);
      }
      tr.append(
        first,
        ui.el(
          "td",
          "n",
          sum.mine.length
            ? `${sum.mine.length}/${sum.listings}`
            : String(sum.listings),
        ),
        ui.el("td", "n", sum.cheapest !== null ? price(sum.cheapest) : "—"),
        ui.el(
          "td",
          "n",
          sum.mine.length
            ? `${sum.tickets} (${sum.myTickets})`
            : String(sum.tickets),
        ),
        ui.el(
          "td",
          "n",
          best ? `${ordinal(best.rank)} of ${sum.listings}` : "—",
        ),
        gapCell(best, sum),
      );
      if (tracked) {
        const free = freeSeats(tracked, s.label);
        tr.append(ui.el("td", "n", free === null ? "—" : String(free)));
      }
      const profitCell = ui.el("td", "n");
      const l = best ? listingOf(best.row.mineId || best.row.id) : null;
      const chip = l ? ui.profitChip(l.money) : null;
      profitCell.append(chip || document.createTextNode("—"));
      if (chip)
        profitCell.title =
          "From your listings page (real price, not the display price)";
      tr.append(profitCell, realCell(s, team));
      const toggle = () => {
        if (expanded.has(s.key)) expanded.delete(s.key);
        else expanded.add(s.key);
        render();
      };
      tr.addEventListener("click", toggle);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });
      tbody.append(tr);
      if (expanded.has(s.key)) {
        const dtr = ui.el("tr", "dr-detail");
        const td = ui.el("td");
        td.colSpan = cols;
        td.append(detail(s, tracked));
        dtr.append(td);
        tbody.append(dtr);
      }
    };
    list.forEach(addRow);
    t.append(thead, tbody);
    wrap.append(t);
    return wrap;
  }

  /* the scanned sections whose name — or one of whose listing IDs — matches
   * what was typed in the search box */
  function searchSections(list, query) {
    const q = String(query || "").trim();
    if (!q) return list;
    const k = U.normKey(q);
    const id = q.replace(/\D/g, "");
    return list.filter(
      (s) =>
        U.normKey(s.label).includes(k) ||
        (id.length >= 3 && s.rows.some((r) => String(r.id).includes(id))),
    );
  }

  /* "23 listings · 61 tickets instant download or bought, of 140 · 380", while the filter is on */
  function instantCount(t, all) {
    const box = ui.el("span", "dr-instant");
    box.append(ui.el("b", null, `${U.plural(t.listings, "listing")} · ${U.plural(t.tickets, "ticket")}`));
    box.append(ui.el("span", null, ` instant download or bought, of ${all.listings} · ${all.tickets}`));
    box.title = "Listings viagogo marks Instant Download, and yours whose request is Bought, with their tickets, out of everything scanned";
    return box;
  }

  /* "By section" (the table of sections) or "By price" (every listing, all sections together) */
  function layoutToggle() {
    const seg = ui.el("div", "dr-layout");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", "Show the listings");
    for (const [k, label, why] of [
      ["sections", "By section", "One row per section, as viagogo groups them"],
      ["price", "By price", "Every listing of every section in one list, cheapest first"],
    ]) {
      const b = ui.button(label, view.layout === k ? "on" : "", () => {
        if (view.layout === k) return;
        view.layout = k;
        saveView();
        render();
      }, why);
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(view.layout === k));
      seg.append(b);
    }
    return seg;
  }

  /* the price list: how many tickets you want to buy at once */
  /* 'single': listings of exactly one ticket; 'over10': listings that sell more than 10 */
  const QTYS = [0, "single", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, "over10"];
  const QTY_LABEL = { 0: "Any", single: "Single", over10: "10+" };
  const QTY_TIP = {
    0: "Every quantity",
    single: 'Only listings of exactly 1 ticket, not "1 - 4" or "1 - 10 together" that can also sell one',
    over10: "Listings that sell more than 10 tickets",
  };
  function qtyChips(found) {
    const box = ui.el("div", "dr-qty");
    box.append(ui.el("span", "m", "Tickets"));
    for (const n of QTYS) {
      const b = ui.button(QTY_LABEL[n] || String(n), view.qty === n ? "on" : "", () => {
        view.qty = n;
        saveView();
        render();
      }, QTY_TIP[n] || `Listings that sell ${U.plural(n, "ticket")}: "1 - 10 together" does, "4 tickets" only for 4`);
      box.append(b);
    }
    const tickets = found.reduce((s, r) => s + (r.qtyMax || 0), 0);
    const count = ui.el("span", "dr-qty-count");
    count.append(ui.el("b", null, U.plural(found.length, "listing")));
    count.append(ui.el("span", null, view.qty
      ? ` ${M.qtyWords(view.qty)}${found.length ? ` · from ${price(found[0].price)}` : ""}`
      : ` · ${U.plural(tickets, "ticket")}${found.length ? ` · from ${price(found[0].price)}` : ""}`));
    box.append(count);
    return box;
  }

  /* What a ticket costs in a viagogo section on the ticket site: the tracked
   * event's sector price (the team's price list, else the site's, else what
   * you paid), or else the linked face values. -> { prices, currency } | null */
  function sectionCost(s, tracked) {
    if (tracked) {
      const r = VG.sectorFor(tracked, s.label);
      const sec = ["matched", "remembered"].includes(r.how) && tracked.sectors.find((x) => x.code === r.code);
      if (sec && sec.price && sec.price.amount > 0) return { prices: [sec.price.amount], currency: sec.price.currency };
    }
    const f = faceOf(s.label);
    if (f && f.secs.length) return { prices: [...new Set(f.secs.map((x) => x.price))], currency: f.L.face.currency };
    return null;
  }

  /* the sector prices of the sections shown, cheapest first; a section split
   * over several prices is under each of them. -> [{ amount, currency, sections }]
   * plus, last, { amount: -1 } for the sections with no price */
  function sectorPrices(list, tracked) {
    const by = new Map(), none = [];
    for (const s of list) {
      const p = sectionCost(s, tracked);
      if (!p) { none.push(s); continue; }
      for (const amount of p.prices) {
        const k = `${amount} ${p.currency}`;
        if (!by.has(k)) by.set(k, { amount, currency: p.currency, sections: [] });
        by.get(k).sections.push(s);
      }
    }
    const out = [...by.values()].sort((a, b) => a.amount - b.amount);
    /* on a tracked event, "No price" is where prices are set: shown even when nothing has one yet */
    if (none.length && (out.length || tracked)) out.push({ amount: -1, currency: "", sections: none });
    return out;
  }

  /* ---------------- stands (eBileta at Air Albania) ------------------ *
   * N, E, S, V and W by the section code's letter, and the corners as their
   * own group. Several can be on at once; none on is everything. */

  const STAND_LABEL = { N: "N", E: "E", S: "S", V: "V", W: "W", corner: "Corners", other: "Other" };
  const standKey = (label) => (SK.ebileta && SK.ebileta.standOf(label)) || "other";
  const inStand = (label) => !(view.stands || []).length || view.stands.includes(standKey(label));

  /* on a tracked eBileta event, or when most sections are named like its sectors */
  function standsHere(list, tracked) {
    if (!SK.ebileta || !list.length) return false;
    const named = list.filter((s) => standKey(s.label) !== "other").length;
    if (tracked && tracked.site === "ebileta") return named > 0;
    return list.length >= 4 && named >= list.length * 0.6;
  }

  function standChips(list) {
    const box = ui.el("div", "dr-qty dr-stands");
    box.append(ui.el("span", "m", "Stand"));
    const on = new Set(view.stands || []);
    const set = (next) => {
      view.stands = [...next];
      saveView();
      lastBodySig = null;
      render();
    };
    box.append(ui.button("All", on.size ? "" : "on", () => set([]), "Every section"));
    const keys = [...SK.ebileta.STANDS, "corner"];
    if (list.some((s) => standKey(s.label) === "other")) keys.push("other");
    for (const k of keys) {
      const here = list.filter((s) => standKey(s.label) === k);
      const b = ui.button(STAND_LABEL[k], on.has(k) ? "on" : "", () => {
        const next = new Set(on);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        set(next);
      });
      b.title = (k === "corner" ? `The corners: ${[...SK.ebileta.CORNERS].join(", ")}\n` : k === "other" ? "Sections with no stand letter\n" : `Stand ${k}, corners left out\n`) +
        (here.length ? `Here: ${here.map((s) => s.label).join(", ")}` : "No section here") + "\nClick again to take it off; several can be on";
      if (!here.length) b.classList.add("none");
      box.append(b);
    }
    return box;
  }

  /* ---------------- prices for the "No price" sections --------------- *
   * A price typed here goes on the tracked event's price list — the team's,
   * the one the app's Price list shows. A section eBileta took off the
   * event page (before removed sectors were kept) is saved back on the
   * event first, so it can carry a price and a request. */

  const priceDrafts = new Map(); // section key -> what is typed, kept across redraws
  let priceBusy = "";

  function listCurrency(tracked) {
    if (view.priceCur && P.CURRENCIES.includes(view.priceCur)) return view.priceCur;
    const typed = tracked.sectors.find((x) => x.price && x.price.source === "list");
    if (typed) return typed.price.currency;
    const site = SK.sites && SK.sites[tracked.site];
    return (site && site.priceCurrency) || ({ ebileta: "ALL", efinity: "RSD", posttick: "EUR" })[tracked.site] || "ALL";
  }

  async function putPrice(s, tracked, sector, keeps) {
    const raw = String(priceDrafts.get(s.key) || "").replace(",", ".").trim();
    const amount = raw ? Number(raw) : 0;
    if (raw && !(amount > 0)) { note(`"${raw}" is not a price.`, true); return; }
    if (sector && !amount) { note("Type a price first.", true); return; }
    const currency = listCurrency(tracked);
    priceBusy = s.key;
    lastBodySig = null;
    render();
    try {
      if (sector) {
        await ui.send("setSectorPrice", { eventKey: tracked.key, sectorId: sector.id, amount, currency });
        note(`${s.label}: ${money(amount, currency)} is on [${tracked.num}]'s price list.`);
      } else if (keeps) {
        const r = await ui.send("keepViagogoSector", { eventKey: tracked.key, label: s.label, amount, currency });
        const how = r.how === "twin" ? "with its id from another event in the stadium" : r.how === "guessed" ? "under a stand-in id (no event here knows its real one)" : "";
        note(`${r.code} is back on [${tracked.num}] as a removed sector${how ? " " + how : ""}${r.price ? `, at ${money(r.price.amount, r.price.currency)}` : ""}.`);
      }
      priceDrafts.delete(s.key);
    } catch (e) {
      note(e.message, true);
    }
    priceBusy = "";
    lastBodySig = null;
    await refresh();
  }

  function noPricePanel(sections, tracked) {
    const box = ui.el("div", "dr-noprice");
    const site = SK.sites && SK.sites[tracked.site];
    const keeps = !!(site && site.keepSectors);
    const head = ui.el("div", "dr-noprice-head");
    head.append(
      ui.el("b", null, `${U.plural(sections.length, "section")} without a sector price`),
      ui.el("span", "m", `A price set here goes on [${tracked.num}] ${tracked.title}'s price list, shared with the team (the app's Price list).`),
      ui.el("span", "spacer"),
    );
    const cur = ui.el("select", "dr-noprice-cur");
    cur.setAttribute("aria-label", "Currency of the prices typed here");
    for (const c of P.CURRENCIES) {
      const o = ui.el("option", null, c);
      o.value = c;
      o.selected = c === listCurrency(tracked);
      cur.append(o);
    }
    cur.addEventListener("change", () => { view.priceCur = cur.value; saveView(); });
    head.append(cur);
    box.append(head);

    const ul = ui.el("ul", "dr-noprice-list");
    for (const s of sections.slice().sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }))) {
      const r = VG.sectorFor(tracked, s.label);
      const sector = ["matched", "remembered"].includes(r.how) ? tracked.sectors.find((x) => x.code === r.code) || null : null;
      const li = ui.el("li");
      li.append(ui.el("b", null, s.label));
      const gone = sector && sector.meta && sector.meta.gone;
      const code = SK.ebileta ? SK.ebileta.stadiumCode(s.label) : s.label;
      const canKeep = !sector && keeps && /[A-Z]/i.test(code);
      li.append(ui.el("span", "m", sector
        ? `${sector.code === s.label ? "sector" : "sector " + sector.code}${gone ? ` · removed from ${tracked.siteLabel || "the site"}${sector.meta.saved ? ", saved by hand" : ""}` : ""}`
        : canKeep ? `not on the event — ${tracked.siteLabel || "the site"} removed it` : "no sector matched on the event"));
      li.append(ui.el("span", "m", U.plural(M.summarize(s).listings, "listing")));
      if (sector || canKeep) {
        const input = ui.el("input");
        input.type = "text";
        input.inputMode = "decimal";
        input.placeholder = "price";
        input.value = priceDrafts.get(s.key) || "";
        input.setAttribute("aria-label", `Price for ${s.label}`);
        input.addEventListener("input", () => priceDrafts.set(s.key, input.value));
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); putPrice(s, tracked, sector, keeps); } });
        const go = ui.button(priceBusy === s.key ? "Saving…" : sector ? "Set price" : "Save section", sector ? "mini primary" : "mini", () => putPrice(s, tracked, sector, keeps),
          sector ? `Put this price on the price list for ${sector.code}`
            : `Put ${code} back on [${tracked.num}] as a removed sector — with the price, when one is typed`);
        go.disabled = !!priceBusy;
        li.append(input, go);
      }
      ul.append(li);
    }
    box.append(ul);
    return box;
  }

  /* the price list: only the sections at one sector price */
  function priceChips(groups) {
    const box = ui.el("div", "dr-qty dr-groups");
    const curs = [...new Set(groups.filter((g) => g.amount > 0).map((g) => g.currency))];
    const unit = (c) => (c === "ALL" ? "L" : c);
    box.append(ui.el("span", "m", curs.length === 1 ? `Sector price · ${unit(curs[0])}` : "Sector price"));
    const pick = (amount) => {
      view.price = amount;
      saveView();
      render();
    };
    const on = groups.some((g) => g.amount === view.price) ? view.price : 0;
    box.append(ui.button("All", on ? "" : "on", () => pick(0), "Every section"));
    const { colorOf } = F.tiers(groups.filter((g) => g.amount > 0).map((g) => g.amount));
    for (const g of groups) {
      const n = M.byPrice(g.sections, view.qty).length;
      const b = ui.button("", on === g.amount ? "on" : "", () => pick(g.amount));
      const dot = ui.el("span", "tier-dot");
      dot.style.background = g.amount > 0 ? colorOf(g.amount) : F.NO_PRICE;
      b.append(dot, g.amount > 0 ? g.amount.toLocaleString("en") + (curs.length > 1 ? ` ${unit(g.currency)}` : "") : "No price");
      b.title = [
        `${U.plural(g.sections.length, "section")}: ${g.sections.map((s) => s.label).join(", ")}`,
        `${U.plural(n, "listing")}${view.qty ? ` that ${M.qtyWords(view.qty)}` : ""}`,
      ].join("\n");
      if (!n) b.classList.add("none");
      box.append(b);
    }
    return box;
  }

  /* every listing, all sections together, cheapest first */
  function priceTable(found) {
    const wrap = ui.el("div", "dr-table-wrap");
    const t = ui.el("table", "dr-table dr-prices");
    const head = ui.el("tr");
    for (const [h, why] of [
      ["#", "Place in this list"],
      ["Price", "viagogo's display price for one ticket"],
      ["Section", ""],
      ["Row", ""],
      ["Tickets", "How many a buyer can take: \"1–10 together\" is any number from 1 to 10"],
      ["Details", "What viagogo says about the listing"],
    ]) {
      const th = ui.el("th", null, h);
      if (why) th.title = why;
      head.append(th);
    }
    const thead = ui.el("thead");
    thead.append(head);
    const tbody = ui.el("tbody");
    found.forEach((r, i) => {
      const tr = ui.el("tr", "lst" + (r.mine ? " mine" : r.maybe ? " maybe" : ""));
      const qty = r.qtyMax
        ? r.qtyMin && r.qtyMin !== r.qtyMax ? `${r.qtyMin}–${r.qtyMax} together` : `${r.qtyMax}`
        : "?";
      const details = [r.mine ? "yours" : r.maybe ? "possibly yours" : "", ...(r.features || []), ...(r.tags || [])].filter(Boolean).join(" · ");
      const cells = [
        [String(i + 1), "n"],
        [price(r.price), "n price"],
        [r.label, "sec-name"],
        [r.row || "—", ""],
        [qty, "n"],
        [details, "details"],
      ];
      for (const [text, cls] of cells) tr.append(ui.el("td", cls, text));
      if (r.was) tr.children[1].title = `was ${price(r.was)}`;
      tbody.append(tr);
    });
    t.append(thead, tbody);
    wrap.append(t);
    return wrap;
  }

  function controls(onSearch, t, all) {
    const box = ui.el("div", "dr-controls");
    box.append(layoutToggle());
    const search = ui.searchInput(
      view.q,
      (v) => {
        view.q = v;
        onSearch();
      },
      {
        placeholder: "Search a section, e.g. E105",
        label: "Search the scanned sections by name or listing ID",
      },
    );
    search.classList.add("dr-search");
    box.append(search);
    box.append(
      ui.checkbox("Only sections with my listings", view.onlyMine, (v) => {
        view.onlyMine = v;
        saveView();
        render();
      }),
    );
    box.append(
      ui.checkbox("Only instant download", view.instant, (v) => {
        view.instant = v;
        saveView();
        render();
      }),
    );
    box.lastElementChild.title = "Listings viagogo marks Instant Download, and yours whose request is Bought";
    if (view.instant && t && all) box.append(instantCount(t, all));
    const sort = ui.el("select");
    sort.id = "sk-vg-sort";
    for (const [value, label] of [
      ["section", "Sort: section"],
      ["gap", "Sort: biggest gap"],
      ["cheapest", "Sort: cheapest"],
      ["listings", "Sort: most listings"],
    ]) {
      const o = ui.el("option", null, label);
      o.value = value;
      o.selected = view.sort === value;
      sort.append(o);
    }
    sort.addEventListener("change", () => {
      view.sort = sort.value;
      saveView();
      render();
    });
    if (view.layout !== "price") box.append(sort);
    return box;
  }

  /* A signature of what the body would show right now. Rebuilt only when
   * this changes — in particular NOT on every "Show more" click while a scan
   * runs (the store, and so this signature, only changes once the scan
   * finishes): the table stays exactly as it is, scroll position and all,
   * so nothing in it moves or loses your place while a scan is going. */
  let lastBodySig = null;

  function bodySig(t, tracked) {
    const tp = (state && state.teamPrices) || [];
    return JSON.stringify([
      !!scanning,
      tp.length,
      tp.reduce((n, x) => Math.max(n, x.seenAt || 0), 0),
      view.open,
      t.sections,
      t.listings,
      t.oldest,
      view.onlyMine,
      view.layout,
      view.qty,
      view.price,
      view.instant,
      view.instant ? boughtIds() : null,
      view.sort,
      view.closed,
      view.tab,
      view.stands,
      view.diffKind,
      view.diffOnly,
      saved.map((x) => x.id),
      diffPick,
      [...diffOpen],
      priceBusy,
      store.scan ? store.scan.at : 0,
      faceOpen,
      [...expanded],
      [...faceExpanded],
      tracked ? tracked.key : null,
      tracked ? tracked.sectors.map((x) => (x.price ? `${x.price.amount} ${x.price.currency}` : "")) : null,
      faceLink() ? [faceLink().at, faceLink().map] : null,
      state && state.fx ? state.fx.day : null,
      lastSalesHere(tracked).map((x) => x.id),
      lastSaleScanSig(),
    ]);
  }

  /* this event's place in the last-sales scan, as the Last sales tab shows it */
  function lastSaleScanSig() {
    const x = state && state.lastSaleScan;
    if (!x || view.tab !== "sales") return null;
    return [x.every, x.here, x.holder, x.blockedUntil, x.pausedUntil, (x.list || []).find((y) => y.vgEventId === eventId) || null];
  }

  function render() {
    if (!ui.alive()) return shutdown();
    if (!state || !eventId || !store) return;
    if (!SK.settings.panelOn(state.settings, "viagogo", "event")) {
      unmount();
      return;
    }
    mount();
    ui.applyTheme(app, state.settings.theme);
    app.classList.toggle("open", view.open);
    app.style.setProperty("--dr-h", `${view.open ? view.height : 48}px`);

    /* signed out, with a scan handed over: your listings are the rows it
     * recognised, and every count below — header included — uses them */
    const cmp = signedOutView() ? compareHere() : null;
    const match = cmp && Object.keys(store.sections).length
      ? M.matchSignedOut(cmp, allRows(), confirms, !!(store.scan && store.scan.complete)) : null;
    /* everything scanned, then what the instant-download filter leaves of it */
    const scanned = viewStore(match);
    const shown = view.instant ? M.onlyInstant(scanned, boughtMine) : scanned;
    const all = view.instant ? M.totals(scanned) : null;
    const t = M.totals(shown);
    const tracked = state.auth && state.auth.signedIn ? trackedEvent() : null;

    /* top: grip, bar (with the live scan progress) and notice — cheap to
     * rebuild every time, so this always shows the latest without touching
     * the body below it */
    let top = app.querySelector(".dr-top");
    if (!top) {
      top = ui.el("div", "dr-top");
      app.prepend(top);
    }
    top.textContent = "";
    const grip = ui.el("div", "dr-grip");
    grip.title = "Drag to resize";
    grip.addEventListener("pointerdown", startResize);
    top.append(grip, bar(t, tracked));
    /* the same box every time, so what is typed in it survives a redraw */
    if (pasteOpen) top.append(pasteEl || (pasteEl = pasteBox()));
    else pasteEl = null;
    if (notice && Date.now() - notice.at < 8000)
      top.append(
        ui.el("div", "dr-notice" + (notice.isError ? " err" : ""), notice.text),
      );

    if (!view.open) {
      const oldBody = app.querySelector(".dr-body");
      if (oldBody) oldBody.remove();
      lastBodySig = null;
      return;
    }

    const sig = bodySig(t, tracked) + JSON.stringify([cmp ? cmp.at : 0, confirms]);
    if (sig === lastBodySig && app.querySelector(".dr-body")) return;
    lastBodySig = sig;

    const oldBody = app.querySelector(".dr-body");
    const scrollTop = oldBody ? oldBody.scrollTop : 0;
    const oldWrap = oldBody && oldBody.querySelector(".dr-table-wrap");
    const scrollLeft = oldWrap ? oldWrap.scrollLeft : 0;
    /* a scan finishing must not take the search box away mid-word */
    const oldSearch = oldBody && oldBody.querySelector(".dr-search");
    const wasSearching =
      !!oldSearch && app.getRootNode().activeElement === oldSearch;
    if (oldBody) oldBody.remove();

    const body = ui.el("div", "dr-body");
    body.append(tabs());
    if (view.tab === "face") {
      const list = t.sections ? M.sectionsView(shown, { onlyMine: false, sort: view.sort }) : [];
      body.append(faceView(list));
    } else if (view.tab === "changes") {
      body.append(changesView(tracked));
    } else if (view.tab === "sales") {
      body.append(lastSalesView(tracked));
    } else {
    if (cmp) body.append(comparePanel(cmp, match, allRows()));
    if (!t.sections && !(all && all.sections)) {
      body.append(
        ui.el(
          "p",
          "dr-empty",
          scanning
            ? "Loading every listing… sections appear here when the list is read."
            : 'Remove viagogo\'s filters (no section picked on the map), then press Scan: it presses "Show more" until everything is loaded and sorts every listing into its section. Refreshing the page clears what was read.',
        ),
      );
    } else {
      const list = M.sectionsView(shown, {
        onlyMine: view.onlyMine,
        sort: view.sort,
      });
      const results = ui.el("div", "dr-results");
      const tableHost = ui.el("div", "dr-table-host");
      const chartHost = ui.el("div", "dr-chart-host");
      /* typing in the search box redraws only these two, so the drawer keeps
       * its place — and the caret keeps its own */
      const drawFound = () => {
        const matched = searchSections(list, view.q);
        /* eBileta's stands: a filter over the search, in both layouts */
        const stands = standsHere(matched, tracked);
        const shown = stands ? matched.filter((s) => inStand(s.label)) : matched;
        tableHost.textContent = "";
        chartHost.textContent = "";
        if (stands) tableHost.append(standChips(matched));
        if (shown.length) {
          if (view.q.trim() && shown.length !== list.length)
            tableHost.append(
              ui.el(
                "p",
                "dr-found",
                `${U.plural(shown.length, "section")} of ${list.length} match "${view.q.trim()}".`,
              ),
            );
          if (view.layout === "price") {
            const groups = sectorPrices(shown, tracked);
            const group = view.price ? groups.find((g) => g.amount === view.price) : null;
            const found = M.byPrice(group ? group.sections : shown, view.qty);
            tableHost.append(qtyChips(found));
            if (groups.length) tableHost.append(priceChips(groups));
            if (group && group.amount === -1 && tracked) tableHost.append(noPricePanel(group.sections, tracked));
            if (found.length) tableHost.append(priceTable(found));
            else tableHost.append(ui.el("p", "dr-empty", view.qty
              ? `No listing ${view.qty === "single" ? "is a single ticket" : view.qty === "over10" ? "sells more than 10 tickets" : `sells ${U.plural(view.qty, "ticket")}`}${view.instant ? " with instant download" : ""}${group ? " at this sector price" : ""}.`
              : group ? "No listing for sale at this sector price." : "No listing for sale here."));
          } else tableHost.append(table(shown, tracked));
        } else {
          tableHost.append(
            ui.el(
              "p",
              "dr-empty",
              matched.length
                ? "No scanned section is in the stands picked."
                : view.q.trim()
                ? `No scanned section matches "${view.q.trim()}".`
                : view.instant && !t.listings
                  ? "No listing here has instant download, and none of yours is bought."
                  : "None of the scanned sections has one of your listings.",
            ),
          );
        }
        const chart = overview(shown);
        if (chart) chartHost.append(chart);
      };
      results.append(controls(drawFound, t, all), tableHost);
      drawFound();
      if (!tracked && state.auth && state.auth.signedIn)
        results.append(
          ui.el(
            "p",
            "note",
            "Not one of your tracked events: eBileta seats are not shown.",
          ),
        );
      const stats = ui.el("div", "dr-stats");
      stats.append(tiles(t), chartHost);
      body.append(results, stats);
    }
    }
    app.append(body);
    body.scrollTop = scrollTop;
    const newWrap = body.querySelector(".dr-table-wrap");
    if (newWrap) newWrap.scrollLeft = scrollLeft;
    const newSearch = body.querySelector(".dr-search");
    if (wasSearching && newSearch) {
      newSearch.focus();
      const end = newSearch.value.length;
      try {
        newSearch.setSelectionRange(end, end);
      } catch (e) {
        /* some browsers refuse this on type=search */
      }
    }
  }

  /* ---------------- resizing and remembered view ---------------------- */

  function startResize(e) {
    e.preventDefault();
    const move = (ev) => {
      view.height = Math.max(
        160,
        Math.min(
          Math.round(window.innerHeight * 0.85),
          window.innerHeight - ev.clientY,
        ),
      );
      if (app) app.style.setProperty("--dr-h", `${view.height}px`);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      saveView();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* The height and the sorting are remembered; whether the drawer is open is
   * not. Every page starts with it closed, out of the way, until it is opened
   * by hand. */
  async function loadView() {
    try {
      const { ui: u } = await chrome.storage.local.get("ui");
      const saved = Object.assign({}, (u && u.vgDrawer) || {});
      delete saved.open;
      delete saved.q;
      Object.assign(view, saved);
    } catch (e) {
      /* defaults */
    }
    view.open = false;
    view.q = "";
  }

  async function saveView() {
    try {
      const { ui: u } = await chrome.storage.local.get("ui");
      const keep = Object.assign({}, view);
      delete keep.open;
      delete keep.q;
      await chrome.storage.local.set({
        ui: Object.assign({}, u || {}, { vgDrawer: keep }),
      });
    } catch (e) {
      /* cosmetic */
    }
  }

  /* ---------------- state and following the page ---------------------- */

  async function refresh() {
    if (!ui.alive()) return shutdown();
    try {
      state = await ui.send("state", {});
    } catch (e) {
      return;
    }
    render();
  }

  let lastHref = "",
    timer = null,
    refreshTimer = null,
    stopped = false;

  function follow() {
    if (stopped) return;
    if (!ui.alive()) return shutdown();
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (!VG.isEventPage(location)) {
      unmount();
      eventId = "";
      return;
    }
    if (VG.eventIdOf(location) !== eventId) loadEvent();
    render();
  }

  function shutdown() {
    stopped = true;
    if (scanning) scanning.stop = true;
    clearInterval(timer);
    unmount();
  }

  async function boot() {
    if (!VG.isEventPage(location)) return;
    loadEvent();
    await loadView();
    await loadFace();
    lastHref = location.href;
    await refresh();
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || stopped) return;
        if (
          !Object.keys(changes).some(
            (k) => k !== "ui" && !k.startsWith("cache:"),
          )
        )
          return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 300);
      });
    } catch (e) {
      /* extension context gone */
    }
    timer = setInterval(follow, 1000);
    /* a handed-over scan expires on its own: redraw so it leaves on time */
    setInterval(() => { if (!stopped && state && (state.compares || []).length) render(); }, 60000);
    window.addEventListener("popstate", () => setTimeout(follow, 50));
  }

  boot();
})();
