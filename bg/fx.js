/* ------------------------------------------------------------------
 * Seat Tracker - exchange rates to lek (service worker)
 *
 * Lek is the base currency. Once a day, whichever PC syncs first fetches
 * the rates and stores them for the team; every amount converts at the rate
 * of the day it was read. Rates by ExchangeRate-API (open access, no key):
 * https://www.exchangerate-api.com
 * ------------------------------------------------------------------ */
'use strict';

const Fx = (() => {
  const SOURCE = 'https://open.er-api.com/v6/latest/ALL';
  const WANTED = ['USD', 'EUR', 'RSD', 'GBP'];
  let lastTry = 0;

  /* -> true when today's rates were fetched and stored now */
  async function ensureToday() {
    const m = await model();
    if (!m.meId) return false;
    const day = SK.profit.dayOf(Date.now());
    if (m.fx[day]) return false;
    if (Date.now() - lastTry < 60 * 60000) return false;       // at most one try an hour
    lastTry = Date.now();

    const res = await fetch(SOURCE, { cache: 'no-store' });
    if (!res.ok) throw new Error(`exchange rates: HTTP ${res.status}`);
    const j = await res.json();
    if (j.result !== 'success' || !j.rates) throw new Error('exchange rates: the answer had no rates');
    /* the answer is "1 lek = x USD"; stored the other way round, lek per unit */
    const lekPer = {};
    for (const c of WANTED) {
      const x = Number(j.rates[c]);
      if (x > 0) lekPer[c] = Math.round(1e6 / x) / 1e6;
    }
    if (!lekPer.USD) throw new Error('exchange rates: no dollar rate');
    await Remote.saveFx(day, lekPer, 'open.er-api.com', m.device.name || m.device.id);
    return true;
  }

  return { ensureToday, SOURCE };
})();
