/* ------------------------------------------------------------------
 * Seat Tracker - Supabase access (service worker)
 *
 * Plain fetch, no SDK. Email + password sign-in; the session is kept in
 * chrome.storage.local and refreshed before it expires. If it cannot be
 * refreshed (password changed, user removed) the extension shows a
 * "sign in again" notification and a red banner, and stops syncing.
 * ------------------------------------------------------------------ */
'use strict';

const Supa = (() => {
  const C = SK.config;
  let session;              // undefined = not loaded yet
  let refreshing = null;

  async function load() {
    if (session === undefined) session = (await chrome.storage.local.get('auth')).auth || null;
    return session;
  }

  async function save(next) {
    session = next;
    await chrome.storage.local.set({ auth: next });
  }

  function fromTokenResponse(j) {
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000,
      user: { id: j.user.id, email: j.user.email }
    };
  }

  /* fetch threw before any answer came back: say whether this PC is offline or
   * online with Supabase blocked, and keep the browser's own reason */
  function unreachable(e) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const err = new Error(offline ? 'This PC is offline.' : 'The Seat Tracker server (Supabase) did not answer.');
    err.network = true;
    err.offline = offline;
    err.detail = (e && e.message) || String(e);
    return err;
  }

  async function authPost(path, body, token) {
    const headers = { apikey: C.supabaseKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(`${C.supabaseUrl}/auth/v1/${path}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    } catch (e) {
      throw unreachable(e);
    }
    const text = await res.text();
    let j = {};
    try { j = text ? JSON.parse(text) : {}; } catch (e) { j = {}; }
    if (!res.ok) {
      const msg = j.msg || j.error_description || j.message || `HTTP ${res.status}`;
      const server = res.status >= 500;
      const err = new Error(server ? `The Seat Tracker server (Supabase) had a problem (HTTP ${res.status}).`
        : /invalid login/i.test(msg) ? 'Wrong email or password.' : msg);
      err.status = res.status;
      err.server = server;
      if (server) err.detail = msg;
      throw err;
    }
    return j;
  }

  /* ---------------- problems the user must see ---------------------- */

  async function setProblem(message) {
    const { authProblem } = await chrome.storage.local.get('authProblem');
    if (!message) {
      if (authProblem) await chrome.storage.local.remove('authProblem');
      return;
    }
    await chrome.storage.local.set({ authProblem: { message, at: Date.now() } });
    /* one desktop notification per problem, at most every 30 minutes */
    if (!authProblem || authProblem.message !== message || Date.now() - authProblem.at > 30 * 60000) {
      try {
        await chrome.notifications.create('sk-auth-' + Date.now(), {
          type: 'basic', iconUrl: chrome.runtime.getURL('icons/128.png'), priority: 2,
          title: 'Seat Tracker: sign in needed', message
        });
      } catch (e) { /* notifications blocked */ }
    }
  }

  /* ---------------- sessions ---------------------------------------- */

  async function signIn(email, password) {
    const j = await authPost('token?grant_type=password', { email: String(email || '').trim(), password: String(password || '') });
    await save(fromTokenResponse(j));
    await setProblem(null);
    return session.user;
  }

  async function signOut() {
    await load();
    if (session) {
      try { await authPost('logout', {}, session.access_token); } catch (e) { /* signing out locally is enough */ }
    }
    await save(null);
    await setProblem(null);
  }

  async function user() {
    await load();
    return session ? session.user : null;
  }

  function authError(message) {
    const e = new Error(message);
    e.auth = true;
    return e;
  }

  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        if (!session || !session.refresh_token) throw authError('Not signed in.');
        const j = await authPost('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
        await save(fromTokenResponse(j));
        await setProblem(null);
        return session.access_token;
      } catch (e) {
        /* offline, or Supabase itself failing: keep the session and try later */
        if (e.network || e.server || e.status === 429) throw e;
        await save(null);
        await setProblem('Your Seat Tracker sign-in expired. Open the extension and sign in again.');
        throw authError('Signed out: ' + e.message);
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function token() {
    await load();
    if (!session) throw authError('Not signed in.');
    if (Date.now() < session.expires_at - 60000) return session.access_token;
    return refresh();
  }

  /* ---------------- data API ---------------------------------------- */

  async function rest(method, path, opts) {
    opts = opts || {};
    const call = async tok => {
      const headers = {
        apikey: C.supabaseKey,
        Authorization: 'Bearer ' + tok,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      };
      if (opts.prefer) headers.Prefer = opts.prefer;
      try {
        return await fetch(`${C.supabaseUrl}/rest/v1/${path}`, {
          method, headers, cache: 'no-store',
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
        });
      } catch (e) {
        throw unreachable(e);
      }
    };

    let res = await call(await token());
    if (res.status === 401) res = await call(await refresh());

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const detail = data && typeof data === 'object' ? (data.message || data.hint || data.code) : data;
      const err = new Error(`Supabase: ${detail || 'HTTP ' + res.status}`);
      err.status = res.status;
      err.code = data && data.code;
      if (res.status >= 500) {
        err.message = `The Seat Tracker server (Supabase) had a problem (HTTP ${res.status}).`;
        err.server = true;
        err.detail = String(detail || '');
      }
      if (err.code === 'PGRST205' || err.code === 'PGRST202') {
        const missing = /'public\.([\w]+)/.exec(String((data && data.message) || ''));
        err.message = (missing ? `The Supabase ${err.code === 'PGRST202' ? 'function' : 'table'} ${missing[1]} is missing`
          : 'The Supabase tables are missing') + ' — run supabase/schema.sql in the SQL Editor (it is safe to run again).';
      }
      throw err;
    }
    return data;
  }

  const rpc = (fn, args) => rest('POST', 'rpc/' + fn, { body: args || {} });

  return { signIn, signOut, user, token, refresh, rest, rpc, setProblem };
})();
