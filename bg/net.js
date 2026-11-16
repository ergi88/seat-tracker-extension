/* ------------------------------------------------------------------
 * Seat Tracker - network for the site adapters (service worker)
 *
 * Every request to a ticket site goes through one queue: never two at
 * once and never closer than 800 ms apart, whichever site or event asked.
 * Each request also pings an extension API first, which resets the
 * worker's idle timer so a long scan is not cut off halfway.
 * ------------------------------------------------------------------ */
'use strict';

const Net = (() => {
  const GAP_MS = 800;
  const TIMEOUT_MS = 30000;
  let last = 0;
  let chain = Promise.resolve();

  function keepAlive() {
    return new Promise(resolve => {
      try { chrome.runtime.getPlatformInfo(() => resolve()); } catch (e) { resolve(); }
    });
  }

  function shortUrl(u) {
    try { const x = new URL(u); return x.host + '/…/' + x.pathname.split('/').filter(Boolean).pop(); } catch (e) { return u; }
  }

  function request(url, opts, read) {
    const run = chain.then(async () => {
      const wait = GAP_MS - (Date.now() - last);
      if (wait > 0) await SK.util.sleep(wait);
      await keepAlive();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          cache: 'no-store',
          credentials: (opts && opts.credentials) || 'omit',
          signal: ctrl.signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${shortUrl(url)}`);
        return await read(res);
      } catch (e) {
        if (e.name === 'AbortError') throw new Error(`timed out: ${shortUrl(url)}`);
        throw e;
      } finally {
        clearTimeout(timer);
        last = Date.now();
      }
    });
    chain = run.catch(() => {});
    return run;
  }

  return {
    keepAlive,
    text: (url, opts) => request(url, opts, r => r.text()),
    json: (url, opts) => request(url, opts, r => r.json()),
    buffer: (url, opts) => request(url, opts, r => r.arrayBuffer())
  };
})();
