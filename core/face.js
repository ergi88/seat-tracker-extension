/* ------------------------------------------------------------------
 * Seat Tracker - face values handed from a ticket site to viagogo
 *
 * A stadium read on eFinity (or any site whose sectors carry a price)
 * knows each sector's face value and its free seats. Nothing ties that
 * page to a viagogo event, so the read travels as a short code: copied on
 * the site, pasted (or picked from this PC's recent reads) on the viagogo
 * event page, and kept there per viagogo event.
 *
 * Pure functions, no chrome.* and no DOM: shared by the content scripts
 * and the Node tests. Exposed as SK.face.
 * ------------------------------------------------------------------ */
(function (root) {
  'use strict';
  const SK = root.SK = root.SK || {};

  const PREFIX = 'SKFACE1:';

  /* utf-8 safe base64, in the browser and in Node alike */
  const b64 = s => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));
  const unb64 = s => (typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8'));

  /* ---------------- building the list ------------------------------- *
   * From an event's sectors and its packed scans (SK.rules.packScan), one
   * entry per price:
   *   - a site that prices by category (Posttick): one entry per category
   *     found in the sector's seats, e.g. "B · CAT 2" and "B · CAT 3", each
   *     with its own free seats. A sector that was never read is left out —
   *     which categories it holds is only known from its seats;
   *   - a site that prices the sector (eFinity, meta.price): one entry, its
   *     seats from the scan, else from the last summary.
   * head: { site, siteId, title, url, currency, at } */
  function build(head, sectors, scans, cats) {
    const R = SK.rules;
    const priced = Object.entries(cats || {}).filter(([, c]) => c && Number(c.price) > 0);
    const out = [];
    for (const sec of sectors || []) {
      const id = String(sec.id);
      const scan = scans && scans[id];
      const meta = sec.meta || {};
      const own = Number(meta.price) > 0 ? Number(meta.price) : 0;
      if (scan && scan.unmapped) {
        if (own) out.push({ code: sec.code, cat: '', price: own, available: null, longest: 0, total: 0, perTable: 0, unmapped: true });
        continue;
      }
      if (!own && priced.length) {
        if (!scan || !scan.rows) continue;
        for (const [k, c] of priced) {
          if (!scan.cats || !scan.cats[k]) continue;
          const v = R.blocksFor(scan, [k]);
          if (!v || !v.total) continue;
          out.push({ code: sec.code, cat: String(c.label || k), price: Number(c.price), available: v.available, longest: v.longest, total: v.total, perTable: 0, unmapped: false });
        }
        continue;
      }
      if (!own) continue;
      const v = scan && scan.rows ? R.blocksFor(scan, null) : null;
      const sum = sec.summary;
      const known = v || (sum && !sum.unmapped ? sum : null);
      out.push({
        code: sec.code, cat: '', price: own,
        available: known ? Number(known.available) || 0 : null,
        longest: known ? Number(known.longest) || 0 : 0,
        total: known ? Number(known.total) || 0 : 0,
        perTable: Number(meta.perTable) || 0,
        unmapped: !!(sum && sum.unmapped && !v)
      });
    }
    return Object.assign({ site: '', siteId: '', title: '', url: '', currency: 'EUR', at: Date.now() }, head, { sectors: out });
  }

  /* a preview (bg previewScan) -> what travels: only sectors with a price */
  function fromPreview(pv) {
    if (pv && pv.face && Array.isArray(pv.face.sectors)) return pv.face;
    const sectors = [];
    for (const [id, x] of Object.entries((pv && pv.sectors) || {})) {
      if (!(Number(x.price) > 0)) continue;
      sectors.push({
        code: x.code || id,
        cat: '',
        price: Number(x.price),
        available: x.unmapped || x.skipped ? null : Number(x.available) || 0,
        longest: Number(x.longest) || 0,
        total: Number(x.total) || 0,
        perTable: Number(x.perTable) || 0,
        unmapped: !!x.unmapped
      });
    }
    return {
      site: pv.site, siteId: String(pv.siteId || ''), title: pv.title || '', url: pv.url || '',
      currency: pv.currency || 'RSD', at: pv.at || Date.now(), sectors
    };
  }

  function pack(face) {
    const s = face.sectors.map(x => [x.code, x.price, x.unmapped ? -1 : x.available === null ? -2 : x.available, x.longest, x.total, x.perTable || 0, x.cat || '']);
    return PREFIX + b64(JSON.stringify({ v: 1, site: face.site, id: face.siteId, t: face.title, u: face.url, c: face.currency, at: face.at, s }));
  }

  function unpack(text) {
    const raw = String(text || '').trim();
    const i = raw.indexOf(PREFIX);
    if (i < 0) throw new Error('That is not a face-value code — copy it with "Copy for viagogo" on the ticket site.');
    let o;
    try {
      o = JSON.parse(unb64(raw.slice(i + PREFIX.length).replace(/\s+/g, '')));
    } catch (e) {
      throw new Error('That face-value code is cut short or damaged — copy it again.');
    }
    if (!o || o.v !== 1 || !Array.isArray(o.s)) throw new Error('That face-value code is from another version — copy it again.');
    return {
      site: o.site, siteId: String(o.id || ''), title: o.t || '', url: o.u || '', currency: o.c || 'RSD', at: Number(o.at) || 0,
      sectors: o.s.map(([code, price, avail, longest, total, perTable, cat]) => ({
        code: String(code), cat: cat ? String(cat) : '', price: Number(price) || 0,
        available: avail >= 0 ? avail : null, unmapped: avail === -1,
        longest: Number(longest) || 0, total: Number(total) || 0, perTable: Number(perTable) || 0
      }))
    };
  }

  /* ---------------- which face sector a viagogo section is ----------- *
   * viagogo often names a section more loosely than the ticket site: "210"
   * on viagogo is "210 RIGHT P" and "210 LEFT K" on eFinity, two prices for
   * one viagogo section. So a section can stand for several face sectors.
   *
   * Each name is split into a core — the word with digits in it, a lone
   * letter in front joined on ("E 101" -> E101) — and extras: the other words,
   * sides translated so LEFT / LEVO / LIJEVO all read L. Then, in order:
   *   1. a pick by hand for this section (one sector, or none);
   *   2. one sector by the site's own names (aliases, exact code);
   *   3. one sector equal once the stand words are taken off;
   *   4. every sector with the same core, narrowed by the section's extras
   *      ("210 Left" keeps only the left ones) when that leaves any;
   *   5. the same digits ("210" vs "E210") — only when that is one sector,
   *      since "103" may be N103 or S103.
   * -> { code, codes, how: 'picked' | 'none' | 'matched' | 'split' | 'digits' | '' } */

  const NOISE = /\b(TRIBINA|TRIBINE|TRIBUNA|TRIBUNE|STAND|SECTOR|SECTION|SEKTOR|SEKTORI|BLOCK|BLOK|ZONE|ZONA|AREA)\b/g;
  const NOISE_WORDS = new Set(['TRIBINA', 'TRIBINE', 'TRIBUNA', 'TRIBUNE', 'STAND', 'SECTOR', 'SECTION', 'SEKTOR', 'SEKTORI', 'BLOCK', 'BLOK', 'ZONE', 'ZONA', 'AREA', 'THE', 'OF']);
  const SIDE = {
    LEFT: 'L', LEVO: 'L', LEVA: 'L', LEVI: 'L', LIJEVO: 'L', LIJEVA: 'L', MAJTAS: 'L',
    RIGHT: 'R', DESNO: 'R', DESNA: 'R', DESNI: 'R', DJATHTAS: 'R',
    UPPER: 'U', TOP: 'U', GORNJA: 'U', GORNJI: 'U', SIPER: 'U',
    LOWER: 'D', BOTTOM: 'D', DONJA: 'D', DONJI: 'D', POSHTE: 'D',
    NORTH: 'N', SEVER: 'N', VERI: 'N', SOUTH: 'S', JUG: 'S', EAST: 'E', ISTOK: 'E', LINDJE: 'E', WEST: 'W', ZAPAD: 'W', PERENDIM: 'W'
  };
  const bare = s => String(s || '').toUpperCase().replace(NOISE, ' ').replace(/[^A-Z0-9]/g, '');

  function parts(label) {
    const words = String(label || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(w => w && !NOISE_WORDS.has(w));
    /* "E 101" is E101: a lone letter right before a number belongs to it */
    const joined = [];
    for (let i = 0; i < words.length; i++) {
      if (/^[A-Z]{1,2}$/.test(words[i]) && /^\d+$/.test(words[i + 1] || '') && !SIDE[words[i]]) { joined.push(words[i] + words[i + 1]); i++; }
      else joined.push(words[i]);
    }
    const at = joined.findIndex(w => /\d/.test(w));
    const core = at < 0 ? '' : joined[at].replace(/^([A-Z]*)0+(\d)/, '$1$2');
    const extra = joined.filter((w, i) => i !== at).map(w => SIDE[w] || w);
    return { core, digits: core.replace(/\D/g, ''), extra };
  }

  function match(face, label, manual) {
    const key = SK.util.normKey(label);
    const out = (codes, how) => ({ code: codes.length === 1 ? codes[0] : '', codes, how });
    if (manual && Object.prototype.hasOwnProperty.call(manual, key)) {
      const code = manual[key];
      return code ? out([code], 'picked') : out([], 'none');
    }
    /* one sector can be several entries (one per price category): match on its code */
    const codes = [...new Set(face.sectors.map(x => x.code))];
    const sectors = codes.map(c => ({ id: c, code: c, name: c }));
    const hit = SK.resolveSector ? SK.resolveSector(face.site, label, sectors) : {};
    if (hit.sector) return out([hit.sector.code], 'matched');
    const b = bare(label);
    if (b) {
      const same = codes.filter(c => bare(c) === b);
      if (same.length === 1) return out([same[0]], 'matched');
    }

    const want = parts(label);
    if (!want.core) return out([], '');
    const all = codes.map(c => ({ x: { code: c }, p: parts(c) }));
    let cand = all.filter(c => c.p.core === want.core);
    if (cand.length) {
      if (want.extra.length) {
        const narrow = cand.filter(c => want.extra.every(w => c.p.extra.includes(w)));
        if (narrow.length) cand = narrow;
      }
      return out(cand.map(c => c.x.code), cand.length === 1 ? 'matched' : 'split');
    }
    const byDigits = all.filter(c => c.p.digits && c.p.digits === want.digits);
    if (byDigits.length === 1) return out([byDigits[0].x.code], 'digits');
    return out([], '');
  }

  const sectorOf = (face, code) => (code && face.sectors.find(x => x.code === code)) || null;
  /* every entry of a sector: one per price category it holds */
  const entriesOf = (face, code) => (code ? face.sectors.filter(x => x.code === code) : []);
  /* what a person reads: "B · CAT 2", or just "A TRIBINE" */
  const nameOf = x => (x.cat ? `${x.code} · ${x.cat}` : x.code);

  /* ---------------- money ------------------------------------------- */

  /* rates are lek per unit (SK.profit); null when one is missing */
  function convert(n, from, to, rates) {
    if (!Number.isFinite(n)) return null;
    if (from === to) return n;
    const P = SK.profit;
    const a = P.rateOf(rates, from), b = P.rateOf(rates, to);
    return a && b ? n * a / b : null;
  }

  /* "x1.5" — one decimal, two under x1.1 so x1.05 is not read as x1.1 */
  function multText(m) {
    if (!Number.isFinite(m)) return '';
    return 'x' + (m < 1.1 ? m.toFixed(2) : m.toFixed(1));
  }

  /* ---------------- one color per price ------------------------------ *
   * Dearest first, mid-tone hues that read on light and dark alike, none of
   * them the status green or red. The ticket site and viagogo use the same
   * colors for the same prices. */
  const TIER_COLORS = ['#7c3aed', '#d97706', '#0891b2', '#db2777', '#2563eb', '#ca8a04', '#0d9488', '#c026d3', '#4f46e5', '#ea580c'];
  const NO_PRICE = '#9aa1ad';

  function tiers(list) {
    const prices = [...new Set((list || []).map(Number).filter(p => p > 0))].sort((a, b) => b - a);
    const color = new Map(prices.map((p, i) => [p, TIER_COLORS[i % TIER_COLORS.length]]));
    return { prices, colorOf: p => color.get(Number(p)) || NO_PRICE };
  }

  SK.face = { PREFIX, build, fromPreview, pack, unpack, parts, match, sectorOf, entriesOf, nameOf, convert, multText, tiers, NO_PRICE };

  if (typeof module === 'object' && module.exports) module.exports = SK;
})(globalThis);
