/* Database test: runs supabase/schema.sql on a real Postgres (PGlite, in Node)
 * with a stand-in for Supabase's auth schema, then checks who can see and
 * change what — membership, numbering, leases, "alert once", commands handled
 * once, listings kept private, and that the file is safe to run again.
 *
 *   npm install --prefix ~/.cache/seat-tracker-tests @electric-sql/pglite   (once)
 *   node tests/db/schema.test.mjs
 *
 * PGlite lives outside the extension folder on purpose: Chrome will not load an
 * unpacked extension whose files include node_modules names starting with "_".
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA = fs.readFileSync(path.join(EXT, 'supabase/schema.sql'), 'utf8');
/* the team list, as team.sql holds it: the example one, with made-up emails */
const TEAM = fs.readFileSync(path.join(EXT, 'supabase/team.example.sql'), 'utf8');

async function loadPGlite() {
  try { return (await import('@electric-sql/pglite')).PGlite; } catch (e) { /* not next to the tests: look in the cache */ }
  const dir = process.env.PGLITE_DIR || path.join(os.homedir(), '.cache', 'seat-tracker-tests');
  try {
    /* the package does not export its package.json, so read it from its folder */
    const pkgFile = path.join(dir, 'node_modules', '@electric-sql', 'pglite', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    const entry = pkg.exports['.'].import;
    const file = typeof entry === 'string' ? entry : entry.default;
    return (await import(pathToFileURL(path.join(path.dirname(pkgFile), file)).href)).PGlite;
  } catch (e) {
    console.log(`This test needs PGlite (a real Postgres that runs in Node). Install it once:\n  npm install --prefix ${dir} @electric-sql/pglite`);
    process.exit(2);
  }
}

const A = '11111111-1111-1111-1111-111111111111';     // Ergi
const B = '22222222-2222-2222-2222-222222222222';     // Aldo
const X = '33333333-3333-3333-3333-333333333333';     // signed up, not a member

const PGlite = await loadPGlite();
const db = new PGlite();
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  insert into auth.users values ('${A}', 'Owner@Example.com'), ('${B}', 'mate@example.com'), ('${X}', 'stranger@example.com');
`);

let failures = 0;
const ok = (cond, label, extra) => {
  console.log(cond ? '  ✓' : '  ✗', label, cond || extra === undefined ? '' : JSON.stringify(extra));
  if (!cond) failures++;
};
/* run SQL as a signed-in user (or anonymous, uid null), the way PostgREST does */
async function as(uid, sql, params) {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    if (uid) await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    return tx.query(sql, params || []);
  });
}
async function fails(uid, sql, params) {
  try { await as(uid, sql, params); return ''; } catch (e) { return e.message; }
}

console.log('== the schema runs, and runs again');
await db.exec(SCHEMA);
await db.exec(TEAM);
await as(A, `insert into public.events (key, site, site_id, title) values ('ebileta:2153', 'ebileta', '2153', 'Shqiperi - Bjellorusi')`);
await db.exec(SCHEMA);
ok((await db.query('select count(*)::int n from public.events')).rows[0].n === 1, 'running schema.sql a second time keeps the data');
const members = (await db.query('select email from public.members order by email')).rows.map(r => r.email);
ok(members.length === 2 && !members.includes('stranger@example.com'), 'members = the two emails team.sql lists (case-insensitive), kept when schema.sql runs again', members);

console.log('\n== who can see what');
ok(/permission denied/.test(await fails(null, 'select * from public.events')), 'anonymous (public key only): permission denied');
ok((await as(X, 'select * from public.events')).rows.length === 0, 'a signed-up stranger sees no events');
ok(/row-level security/.test(await fails(X, `insert into public.events (key, site, site_id) values ('x:1', 'x', '1')`)), 'a stranger cannot insert');
ok((await as(B, 'select * from public.events')).rows.length === 1, 'Aldo sees the event Ergi added');
ok(/permission denied/.test(await fails(A, `insert into public.members (user_id) values ('${X}')`)), 'members cannot add members from the extension');

console.log('\n== numbering');
await as(A, `insert into public.events (key, site, site_id) values ('efinity:32286', 'efinity', '32286')`);
ok((await as(A, `select num from public.events where key = 'efinity:32286'`)).rows[0].num === 2, 'events get [1], [2]');
await as(A, `delete from public.events where key = 'efinity:32286'`);
await as(B, `insert into public.events (key, site, site_id) values ('efinity:32286', 'efinity', '32286')`);
ok((await as(A, `select num from public.events where key = 'efinity:32286'`)).rows[0].num === 2, 'an event tracked again gets its old number back');
const addReq = (who, id, user) => as(who, `insert into public.requests (id, user_id, event_key, sec, qty) values ($1, $2, 'ebileta:2153', '1637', 4) returning num`, [id, user]);
ok((await addReq(A, 'ra1', A)).rows[0].num === 1 && (await addReq(A, 'ra2', A)).rows[0].num === 2, 'Ergi #1, #2');
ok((await addReq(A, 'rb1', B)).rows[0].num === 1, 'Aldo\'s first request is his own #1');
await as(A, `delete from public.requests where id = 'ra2'`);
ok((await addReq(A, 'ra3', A)).rows[0].num === 3, 'a deleted number is never reused');

console.log('\n== leases, alert once, commands once');
ok((await as(A, `select public.claim_lease('scan:ebileta:2153', 'pc1', 60) c`)).rows[0].c === true, 'PC1 claims the scan lease');
ok((await as(B, `select public.claim_lease('scan:ebileta:2153', 'pc2', 60) c`)).rows[0].c === false, 'PC2 cannot take it while it is held');
await db.query(`update public.leases set expires_at = now() - interval '1 second'`);
ok((await as(B, `select public.claim_lease('scan:ebileta:2153', 'pc2', 60) c`)).rows[0].c === true, 'PC2 takes it once it expires');
ok((await as(X, `select public.claim_lease('x', 'pcx', 60) c`)).rows[0].c === false, 'a stranger cannot claim a lease');
await as(A, `insert into public.request_state (request_id, status, options) values ('ra1', 'OK', 5)`);
const cas = () => as(B, `update public.request_state set status = 'LOW', version = version + 1 where request_id = 'ra1' and version = 0 returning 1`);
ok((await cas()).rows.length === 1 && (await cas()).rows.length === 0, 'one status change is recorded once, whichever PC gets there first');
const handle = () => as(A, `insert into public.handled_commands (id, user_id) values ('cmd-1', '${A}') on conflict do nothing returning id`);
ok((await handle()).rows.length === 1 && (await handle()).rows.length === 0, 'a phone command is handled once');

console.log('\n== viagogo listings: payout private, price shared');
await as(A, `insert into public.listings (listing_id, user_id, event_key, sector_id, section, price, payout, tickets, currency)
  values ('13988951528', $1, 'ebileta:2153', '1637', 'E106', 84, 453.60, 6, 'USD')`, [A]);
ok((await as(A, 'select payout from public.listings')).rows.length === 1, 'the owner reads their listing and its payout');
ok((await as(B, 'select * from public.listings')).rows.length === 0, 'a teammate cannot read someone else\'s listing');
const tp = (await as(B, 'select * from public.team_prices')).rows;
ok(tp.length === 1 && Number(tp[0].price) === 84 && !('payout' in tp[0]), 'the team sees the sell price per section, without the payout', tp);
ok((await as(X, 'select * from public.team_prices')).rows.length === 0, 'a stranger sees no prices');
ok(/permission denied/.test(await fails(B, 'update public.team_prices set price = 1')), 'the team view cannot be written through');
ok((await as(B, `update public.listings set price = 1 where listing_id = '13988951528' returning 1`)).rows.length === 0 &&
  Number((await db.query('select price from public.listings')).rows[0].price) === 84, 'a teammate cannot change someone else\'s listing');
ok(/row-level security/.test(await fails(B, `insert into public.listings (listing_id, user_id) values ('999', $1)`, [A])), 'nobody can file a listing under someone else');
await as(B, `insert into public.fx_rates (day, lek_per, source) values ('2026-09-17', '{"USD": 83.36}', 'test')`);
ok((await as(A, 'select lek_per from public.fx_rates')).rows[0].lek_per.USD === 83.36, 'exchange rates are shared by the team');
ok((await as(X, 'select * from public.fx_rates')).rows.length === 0, 'a stranger sees no rates');
ok((await db.query(`select count(*)::int n from information_schema.columns where table_name = 'requests' and column_name in ('buy_price', 'buy_currency')`)).rows[0].n === 2,
  'requests have a buy price and currency');

console.log('\n== bought');
await as(A, `update public.requests set listing = '13988951528' where id = 'ra1'`);
await as(A, `update public.listings set track = 'off' where listing_id = '13988951528'`);
await as(A, `insert into public.listings (listing_id, user_id, track) values ('13900000002', $1, 'off')`, [A]);
await db.exec(SCHEMA);
const ra1 = (await db.query(`select bought from public.requests where id = 'ra1'`)).rows[0];
const tracks = Object.fromEntries((await db.query(`select listing_id, track from public.listings`)).rows.map(r => [r.listing_id, r.track]));
ok(ra1.bought === true && tracks['13988951528'] === 'auto', 'a listing switched off moves onto its request as bought', { ra1, tracks });
ok(tracks['13900000002'] === 'off', 'a listing with no request keeps its own switch');
ok((await db.query(`select bought from public.requests where id = 'ra3'`)).rows[0].bought === false, 'every other request starts not bought');
await as(A, `update public.requests set bought = false where id = 'ra1'`);
await db.exec(SCHEMA);
ok((await db.query(`select bought from public.requests where id = 'ra1'`)).rows[0].bought === false, 'running schema.sql again never switches it back on');
await db.query(`delete from public.listings where listing_id = '13900000002'`);

console.log('\n== buy tracker: accounts and purchases are their owner\'s alone');
await as(A, `insert into public.buy_accounts (id, user_id, email, first_name, birthday) values ('acc1', $1, 'buyer.one@example.com', 'Ergi', '1990-05-01')`, [A]);
await as(A, `insert into public.purchases (id, user_id, account_id, event_key, request_id, qty, price) values ('pu1', $1, 'acc1', 'ebileta:2153', 'ra1', 4, 4000)`, [A]);
ok((await as(A, 'select * from public.buy_accounts')).rows.length === 1 && (await as(A, 'select * from public.purchases')).rows.length === 1, 'the owner reads their accounts and purchases');
ok((await as(B, 'select * from public.buy_accounts')).rows.length === 0 && (await as(B, 'select * from public.purchases')).rows.length === 0, 'a teammate sees neither');
ok(/row-level security/.test(await fails(B, `insert into public.buy_accounts (id, user_id, email) values ('acc2', $1, 'x@y.z')`, [A])), 'nobody files an account under someone else');
ok(/duplicate key/.test(await fails(A, `insert into public.buy_accounts (id, user_id, email) values ('acc3', $1, 'BUYER.ONE@example.com')`, [A])), 'one email once per person, whatever its case');
const st = (await as(A, 'select public.sync_status() s')).rows[0].s;
ok(/\|1$/.test(st.accounts) && /\|1$/.test(st.purchases) && (await as(B, 'select public.sync_status() s')).rows[0].s.accounts === '|0', 'sync status counts only your own', { ergi: st.accounts, purchases: st.purchases });
/* inventory lots: a viagogo event nobody tracks, and where the tickets went */
await as(A, `insert into public.purchases (id, user_id, account_id, vg_event_id, event_title, section, qty, assigned) values ('pu2', $1, 'acc1', '161600003', 'Kosovo vs Sweden', 'Lindore', 3, '{"listings":{"14289737262":2},"sales":{}}')`, [A]);
const lot = (await as(A, `select event_key, assigned from public.purchases where id = 'pu2'`)).rows[0];
ok(lot.event_key === null && lot.assigned.listings['14289737262'] === 2, 'a lot for an untracked viagogo event keeps where its tickets went');
ok(/purchases_event_check/.test(await fails(A, `insert into public.purchases (id, user_id, account_id, qty) values ('pu3', $1, 'acc1', 1)`, [A])), 'a lot belongs to some event');
ok((await as(A, `select assigned from public.purchases where id = 'pu1'`)).rows[0].assigned && true, 'an older purchase gets an empty "assigned"');
await as(A, `delete from public.buy_accounts where id = 'acc1'`);
ok((await db.query(`select count(*)::int n from public.purchases`)).rows[0].n === 0, 'deleting an account deletes its purchases');

console.log('\n== price list: shared by the team');
await as(A, `insert into public.sector_prices (event_key, sector_id, amount, currency) values ('ebileta:2153', '1637', 4000, 'ALL')`);
ok(Number((await as(B, `select amount from public.sector_prices where sector_id = '1637'`)).rows[0].amount) === 4000, 'a teammate reads a price someone typed');
await as(B, `update public.sector_prices set amount = 4500 where sector_id = '1637'`);
ok(Number((await as(A, `select amount from public.sector_prices`)).rows[0].amount) === 4500, 'and can correct it');
ok((await as(X, 'select * from public.sector_prices')).rows.length === 0, 'a stranger sees no prices');
ok(/check/.test(await fails(A, `insert into public.sector_prices (event_key, sector_id, amount) values ('ebileta:2153', '1638', 0)`)), 'a price must be above 0');
ok(/\|1$/.test((await as(B, 'select public.sync_status() s')).rows[0].s.prices), 'sync status counts the list for everyone');

console.log('\n== viagogo saved scans: the newest two per person and event, their owner\'s alone');
const vgScan = (who, at, ev = '161613530') => as(who, `insert into public.vg_scans (vg_event_id, event_key, name, scanned_at, signed_in, listings, rows)
  values ($1, 'ebileta:2153', 'Albania vs Serbia', $2, true, 1, '[{"id":"1","k":"9","label":"E106","price":80}]')`, [ev, at]);
await vgScan(A, '2026-11-10T10:00:00Z');
await vgScan(A, '2026-11-11T10:00:00Z');
await vgScan(A, '2026-11-12T10:00:00Z');
await vgScan(A, '2026-11-12T11:00:00Z', '999');
const kept = (await as(A, `select scanned_at from public.vg_scans where vg_event_id = '161613530' order by scanned_at`)).rows.map(r => new Date(r.scanned_at).toISOString().slice(0, 10));
ok(kept.join() === '2026-11-11,2026-11-12', 'a third save drops the oldest; another event keeps its own', kept);
ok((await as(A, `select count(*)::int n from public.vg_scans`)).rows[0].n === 3, 'two of one event, one of the other');
await vgScan(B, '2026-11-12T10:00:00Z');
ok((await as(B, `select count(*)::int n from public.vg_scans`)).rows[0].n === 1, 'a teammate sees only their own, and theirs never pushes yours out');
ok((await as(A, `select count(*)::int n from public.vg_scans`)).rows[0].n === 3, 'yours are all still there');
ok(/duplicate key/.test(await fails(A, `insert into public.vg_scans (vg_event_id, scanned_at) values ('161613530', '2026-11-12T10:00:00Z')`)), 'the same scan is saved once');
ok(/row-level security/.test(await fails(B, `insert into public.vg_scans (user_id, vg_event_id, scanned_at) values ($1, '1', now())`, [A])), 'nobody saves a scan under someone else');
ok(/\|3$/.test((await as(A, 'select public.sync_status() s')).rows[0].s.vgScans), 'sync status counts your own scans');

console.log('\n== sync status');
const sa = (await as(A, 'select public.sync_status() s')).rows[0].s;
const sb = (await as(B, 'select public.sync_status() s')).rows[0].s;
const sx = (await as(X, 'select public.sync_status() s')).rows[0].s;
ok(sa.member === true && /\|1$/.test(sa.listings) && sb.listings === '|0' && /\|1$/.test(sb.teamPrices) && /\|1$/.test(sb.fx),
  'each person counts only their own listings; team prices and rates for everyone', { ergi: sa.listings, aldo: sb.listings });
ok(sx.member === false && sx.events === '|0' && sx.teamPrices === '|0', 'a stranger\'s status shows nothing', sx);

console.log('\n== cascades');
await as(A, `insert into public.scans (event_key, sector_id, scan) values ('ebileta:2153', '1637', '{}')`);
await as(A, `insert into public.event_health (event_key, data) values ('ebileta:2153', '{}')`);
await as(A, `delete from public.events where key = 'ebileta:2153'`);
const left = (await db.query(`select (select count(*)::int from public.requests) r, (select count(*)::int from public.request_state) s,
  (select count(*)::int from public.scans) sc, (select count(*)::int from public.event_health) h,
  (select event_key from public.listings where listing_id = '13988951528') l`)).rows[0];
ok(left.r === 0 && left.s === 0 && left.sc === 0 && left.h === 0, 'deleting an event removes its requests, states, scans and health', left);
ok(left.l === null, 'a listing survives its event being deleted, unlinked from it', left);

console.log(failures ? `\n✗ ${failures} failed` : '\n✓ database checks passed');
process.exit(failures ? 1 : 0);
