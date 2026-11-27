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
/* and for Supabase Storage: its buckets, its files (row-level security on,
 * as Supabase has it) and storage.foldername(), as Supabase defines it */
await db.exec(`
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id bigint generated always as identity primary key, bucket_id text references storage.buckets (id), name text not null, unique (bucket_id, name));
  create function storage.foldername(name text) returns text[] language plpgsql as $$
    declare _parts text[];
    begin
      select string_to_array(name, '/') into _parts;
      return _parts[1:array_length(_parts, 1) - 1];
    end $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated, anon;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;
  insert into storage.buckets (id, name) values ('other', 'other');
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

console.log('\n== tickets: one per PDF page, their owner\'s alone');
const err = p => p.then(() => '', e => e.message);
/* a lot that was there before tickets came is frozen, once */
await as(A, `insert into public.buy_accounts (id, user_id, email) values ('acc9', $1, 'tickets@example.com')`, [A]);
await db.exec('alter table public.purchases drop column frozen');
await as(A, `insert into public.purchases (id, user_id, account_id, event_key, qty) values ('pold', $1, 'acc9', 'ebileta:2153', 2)`, [A]);
await db.exec(SCHEMA);
await as(A, `insert into public.purchases (id, user_id, account_id, event_key, qty, price) values ('pt1', $1, 'acc9', 'ebileta:2153', 4, 2575)`, [A]);
await db.exec(SCHEMA);
const fz = Object.fromEntries((await db.query('select id, frozen from public.purchases')).rows.map(r => [r.id, r.frozen]));
ok(fz.pold === true && fz.pt1 === false, 'a lot from before tickets is frozen; a newer one is not, and running schema.sql again changes neither', fz);

const tk = (who, id, n, lot = 'pt1', serial) => as(who, `insert into public.tickets (id, purchase_id, page, sector_text, row_label, seat, serial, price, event_at)
  values ($1, $2, $3, 'TRIBUNA E206', 'O', $4, $5, 2575, '2026-11-20T19:45:00Z')`, [id, lot, n, String(n), serial ?? `ALB 10000${n}`]);
for (const n of [1, 2, 3, 4]) await tk(A, 't' + n, n);
ok((await as(A, 'select * from public.tickets')).rows.length === 4, 'the owner reads the lot\'s four tickets');
ok((await as(B, 'select * from public.tickets')).rows.length === 0, 'a teammate sees none of them');
ok(/duplicate key/.test(await err(tk(A, 't5', 5, 'pt1', 'ALB 100001'))), 'a ticket number is saved once per person');
await tk(A, 'tn1', 7, 'pt1', '');
await tk(A, 'tn2', 8, 'pt1', '');
ok((await as(A, `select count(*)::int n from public.tickets where serial = ''`)).rows[0].n === 2, 'tickets with no number printed are not held to that');
await as(A, `delete from public.tickets where id in ('tn1', 'tn2')`);
await as(B, `insert into public.buy_accounts (id, user_id, email) values ('accb', $1, 'mate.buys@example.com')`, [B]);
await as(B, `insert into public.purchases (id, user_id, account_id, event_key, qty) values ('pb1', $1, 'accb', 'ebileta:2153', 1)`, [B]);
await tk(B, 'tb1', 1, 'pb1', 'ALB 100001');
ok((await as(B, 'select * from public.tickets')).rows.length === 1, 'someone else may hold the same number: unique per person');
ok(/ticket_not_yours/.test(await err(tk(B, 'tb2', 2, 'pt1', 'X 2'))), 'nobody puts a ticket on someone else\'s lot');
/* the trigger speaks first (before triggers run ahead of the row-level check) */
ok(/row-level security|ticket_not_yours/.test(await fails(B, `insert into public.tickets (id, user_id, purchase_id) values ('tb3', $1, 'pt1')`, [A])), 'nobody files a ticket under someone else');
ok(/lot_frozen/.test(await err(tk(A, 'tf1', 1, 'pold', 'F 1'))), 'a frozen lot takes no tickets');

const lst = (id, status, tickets, market = 'viagogo') => as(A, `insert into public.listings (listing_id, user_id, event_key, status, tickets, market)
  values ($1, $2, 'ebileta:2153', $3, $4, $5)`, [id, A, status, tickets, market]);
await lst('14000000001', 'Active', 3);
await lst('14000000002', 'Pending', 4);
await lst('sh:5001', 'Active', 4, 'stubhub');
await lst('14000000003', 'Expired', 0);
ok((await as(A, `select market from public.listings where listing_id = '13988951528'`)).rows[0].market === 'viagogo', 'a listing read before markets is on viagogo');
ok(/listings_market_check/.test(await err(lst('14000000009', 'Active', 1, 'ebay'))), 'a listing is on viagogo or StubHub');
const link = (who, l, t) => as(who, 'insert into public.listing_tickets (listing_id, ticket_id) values ($1, $2)', [l, t]);
for (const t of ['t1', 't2', 't3']) await link(A, '14000000001', t);
ok((await as(A, `select count(*)::int n from public.listing_tickets where listing_id = '14000000001'`)).rows[0].n === 3, 'three tickets go on a listing of three');
ok(/listing_over_count/.test(await err(link(A, '14000000001', 't4'))), 'a fourth is refused: the listing holds 3');
ok(/ticket_double_listed/.test(await err(link(A, '14000000002', 't1'))), 'a ticket on an active viagogo listing goes on no other viagogo one (pending counts as active)');
ok((await err(link(A, 'sh:5001', 't1'))) === '', 'the same ticket goes on a StubHub listing too');
ok((await err(link(A, '14000000003', 't4'))) === '', 'an ended listing takes any link, as history');
ok(/listing_not_yours|ticket_not_yours/.test(await err(link(B, '14000000002', 't4'))), 'nobody links someone else\'s tickets');
ok(/ticket_not_yours/.test(await err(as(B, `insert into public.listings (listing_id, user_id, status, tickets) values ('14100000001', $1, 'Active', 2)`, [B])
  .then(() => link(B, '14100000001', 't4')))), 'nor puts them on a listing of their own');
ok((await as(B, 'select * from public.listing_tickets')).rows.length === 0, 'a teammate sees none of the links');

await as(A, `insert into public.sales (sale_id, user_id, listing_id, tickets, seats) values ('7001', $1, '14000000001', 1, '1')`, [A]);
await as(A, `update public.tickets set sale_id = '7001' where id = 't1'`);
await as(A,`update public.listings set tickets = 2 where listing_id = '14000000001'`);
ok(/listing_over_count/.test(await err(link(A, '14000000001', 't4'))), 'viagogo now lists 2 (one sold): t4 is refused');
await as(A, `update public.listings set tickets = 3 where listing_id = '14000000001'`);
ok((await err(link(A, '14000000001', 't4'))) === '', 'a sold ticket no longer counts: three unsold on a listing of three');
ok((await as(A, `select seats from public.sales where sale_id = '7001'`)).rows[0].seats === '1', 'a sale keeps viagogo\'s seats');
await as(B, `insert into public.sales (sale_id, user_id, tickets) values ('8001', $1, 1)`, [B]);
ok(/sale_not_yours/.test(await err(as(A, `update public.tickets set sale_id = '8001' where id = 't2'`))), 'a ticket is sold only by its owner\'s sale');

/* a status set by hand: kept with what the facts said when it was set */
await as(A, `update public.tickets set status_pin = 'sold', pinned_over = 'listed' where id = 't2'`);
const pin = (await as(A, `select status_pin, pinned_over from public.tickets where id = 't2'`)).rows[0];
ok(pin.status_pin === 'sold' && pin.pinned_over === 'listed', 'a ticket keeps a status set by hand, and what it was set over', pin);
ok(/tickets_status_pin_check/.test(await err(as(A, `update public.tickets set status_pin = 'lost' where id = 't2'`))), 'only a known status can be set');
ok(/tickets_status_pin_check/.test(await err(as(A, `update public.tickets set pinned_over = null where id = 't2'`))), 'a pin always says what it was set over');
await as(B, `update public.tickets set status_pin = null, pinned_over = null where id = 't2'`);
ok((await as(A, `select status_pin from public.tickets where id = 't2'`)).rows[0].status_pin === 'sold', 'a teammate cannot clear it (not even see it)');
await as(A, `update public.tickets set status_pin = null, pinned_over = null where id = 't2'`);
ok((await as(A, `select status_pin from public.tickets where id = 't2'`)).rows[0].status_pin === null, 'cleared: the worked-out status shows again');

/* how a ticket comes, and whether it has */
const dv = (await as(A, `select delivery, received_at from public.tickets where id = 't3'`)).rows[0];
ok(dv.delivery === 'pdf' && dv.received_at === null, 'a ticket comes as a PDF by default, and has not come until it is attached', dv);
await as(A, `update public.tickets set delivery = 'mobile', received_at = now() where id = 't3'`);
ok((await as(A, `select delivery from public.tickets where id = 't3'`)).rows[0].delivery === 'mobile', 'a ticket can come by mobile transfer, received once you say so');
ok(/tickets_delivery_check/.test(await err(as(A, `update public.tickets set delivery = 'post' where id = 't3'`))), 'only a PDF or a mobile transfer');
await as(A, `update public.tickets set delivery = 'pdf', received_at = null, file_path = $1 where id = 't4'`, [`${A}/t4.pdf`]);
await db.exec(SCHEMA);
ok((await as(A, `select received_at from public.tickets where id = 't4'`)).rows[0].received_at !== null, 'running schema.sql again: a ticket with its PDF counts as come');
ok((await as(A, `select received_at from public.tickets where id = 't2'`)).rows[0].received_at === null, 'one with no PDF yet does not');
await as(A, `update public.tickets set file_path = null, received_at = null where id = 't4'`);

const sst = (await as(A, 'select public.sync_status() s')).rows[0].s;
const sbt = (await as(B, 'select public.sync_status() s')).rows[0].s;
ok(/\|4$/.test(sst.tickets) && /\|6$/.test(sst.ticketLinks) && /\|1$/.test(sbt.tickets) && sbt.ticketLinks === '|0',
  'sync status counts only your own tickets and links', { ergi: [sst.tickets, sst.ticketLinks], aldo: [sbt.tickets, sbt.ticketLinks] });

await as(A, `delete from public.sales where sale_id = '7001'`);
ok((await as(A, `select sale_id from public.tickets where id = 't1'`)).rows[0].sale_id === null, 'a deleted sale leaves its ticket, unsold');
await as(A, `delete from public.listings where listing_id = '14000000003'`);
ok((await as(A, 'select count(*)::int n from public.listing_tickets')).rows[0].n === 5 && (await as(A, 'select count(*)::int n from public.tickets')).rows[0].n === 4,
  'a deleted listing takes its links with it, never the tickets');
await as(A, `delete from public.purchases where id = 'pt1'`);
ok((await as(A, 'select count(*)::int n from public.tickets')).rows[0].n === 0 && (await as(A, 'select count(*)::int n from public.listing_tickets')).rows[0].n === 0,
  'deleting a lot deletes its tickets and their links');

console.log('\n== ticket PDFs: a private bucket, each person\'s own folder');
const bucket = (await db.query(`select public, allowed_mime_types from storage.buckets where id = 'tickets'`)).rows[0];
ok(bucket && bucket.public === false && String(bucket.allowed_mime_types) === 'application/pdf', 'the tickets bucket is private and takes PDFs only', bucket);
const put = (who, name, b = 'tickets') => as(who, 'insert into storage.objects (bucket_id, name) values ($1, $2)', [b, name]);
await put(A, `${A}/t1.pdf`);
ok((await as(A, 'select name from storage.objects')).rows.length === 1, 'the owner saves and reads a PDF in their own folder');
ok((await as(B, 'select name from storage.objects')).rows.length === 0, 'a teammate sees none of it');
ok(/row-level security/.test(await err(put(B, `${A}/t2.pdf`))), 'nobody saves into someone else\'s folder');
ok(/row-level security/.test(await err(put(X, `${X}/t3.pdf`))), 'a stranger saves nothing, even in a folder of their own');
ok(/row-level security/.test(await err(put(A, `${A}/t4.pdf`, 'other'))), 'the rule opens the tickets bucket only');
ok((await as(A, `delete from storage.objects where name = '${A}/t1.pdf' returning 1`)).rows.length === 1, 'the owner deletes their own PDF');

/* what these checks added goes, so the counts further down are as before */
await db.query(`delete from public.listings where listing_id in ('14000000001', '14000000002', 'sh:5001', '14100000001')`);
await db.query(`delete from public.sales where sale_id = '8001'`);
await db.query(`delete from public.buy_accounts where id in ('acc9', 'accb')`);

console.log('\n== money in lek: what a lot cost, and deposits in both currencies');
await as(A, `insert into public.buy_accounts (id, user_id, email) values ('accm', $1, 'money@example.com')`, [A]);
await as(A, `insert into public.purchases (id, user_id, account_id, event_key, qty, price, currency) values ('pm1', $1, 'accm', 'ebileta:2153', 3, 70, 'EUR')`, [A]);
const pm1 = (await as(A, `select spent_all, spent_auto from public.purchases where id = 'pm1'`)).rows[0];
ok(pm1.spent_all === null && pm1.spent_auto === true, 'a new lot starts with no stored lek, marked auto', pm1);
await as(A, `update public.purchases set spent_all = 19500, spent_auto = false where id = 'pm1'`);
await db.exec(SCHEMA);
const pm1b = (await as(A, `select spent_all, spent_auto from public.purchases where id = 'pm1'`)).rows[0];
ok(Number(pm1b.spent_all) === 19500 && pm1b.spent_auto === false, 'what the bank charged, typed, stays when schema.sql runs again', pm1b);
ok((await as(B, `select * from public.purchases where id = 'pm1'`)).rows.length === 0, 'a teammate never sees what you spent');

await as(A, `insert into public.sales (sale_id, user_id, tickets, currency, amount, status) values ('9101', $1, 2, 'USD', 200, 'Complete'), ('9102', $1, 1, 'USD', 100, 'Complete'), ('9103', $1, 1, 'EUR', 90, 'Complete')`, [A]);
await as(A, `insert into public.deposits (id, user_id, received_on, currency, amount, amount_all, bank) values ('d1', $1, '2026-11-20', 'USD', 295, 24190, 'BKT USD')`, [A]);
const d1 = (await as(A, `select rate, all_auto from public.deposits where id = 'd1'`)).rows[0];
ok(Number(d1.rate) === 82 && d1.all_auto === false, 'a deposit keeps both amounts, and its rate is the bank\'s own (24,190 L for $295 = 82)', d1);
ok(/generated|cannot insert/i.test(await fails(A, `insert into public.deposits (id, user_id, currency, amount, amount_all, rate) values ('dx', $1, 'USD', 1, 80, 99)`, [A])), 'the rate is worked out, never typed');
const dlink = (who, d, s) => as(who, 'insert into public.deposit_sales (deposit_id, sale_id) values ($1, $2)', [d, s]);
await dlink(A, 'd1', '9101');
await dlink(A, 'd1', '9102');
ok((await as(A, `select count(*)::int n from public.deposit_sales where deposit_id = 'd1'`)).rows[0].n === 2, 'one deposit pays several sales');
ok(/deposit_currency/.test(await err(dlink(A, 'd1', '9103'))), 'a sale paid in EUR goes into no USD deposit');
await as(A, `insert into public.deposits (id, user_id, currency, amount, amount_all) values ('d2', $1, 'USD', 100, 8200)`, [A]);
ok(/duplicate key/.test(await err(dlink(A, 'd2', '9101'))), 'a sale is paid into one deposit at most');
ok(/check/.test(await fails(A, `insert into public.deposits (id, user_id, currency, amount, amount_all) values ('d3', $1, 'USD', 0, 1)`, [A])), 'a deposit\'s amounts are above 0');
ok(/deposit_currency/.test(await err(as(A, `update public.deposits set currency = 'EUR' where id = 'd1'`))), 'a deposit keeps the currency its sales were paid in');
ok((await err(as(A, `update public.deposits set amount_all = 24200, bank = 'BKT' where id = 'd1'`))) === '', 'its amounts and bank can be corrected');
ok((await as(B, 'select * from public.deposits')).rows.length === 0 && (await as(B, 'select * from public.deposit_sales')).rows.length === 0, 'a teammate sees neither your deposits nor the sales they paid');
ok(/row-level security/.test(await fails(B, `insert into public.deposits (id, user_id, currency, amount, amount_all) values ('db1', $1, 'USD', 1, 80)`, [A])), 'nobody files a deposit under someone else');
await as(B, `insert into public.sales (sale_id, user_id, tickets, currency, amount) values ('9201', $1, 1, 'USD', 50)`, [B]);
ok(/deposit_not_yours/.test(await err(dlink(B, 'd2', '9201'))), 'nobody puts a sale into someone else\'s deposit');
await as(B, `insert into public.deposits (id, user_id, currency, amount, amount_all) values ('db2', $1, 'USD', 50, 4100)`, [B]);
ok(/sale_not_yours/.test(await err(dlink(B, 'db2', '9101'))), 'nor someone else\'s sale into their own');
const dsa = (await as(A, 'select public.sync_status() s')).rows[0].s;
const dsb = (await as(B, 'select public.sync_status() s')).rows[0].s;
ok(/\|2$/.test(dsa.deposits) && /\|2$/.test(dsa.depositSales) && /\|1$/.test(dsb.deposits) && dsb.depositSales === '|0',
  'sync status counts only your own deposits and their sales', { ergi: [dsa.deposits, dsa.depositSales], aldo: [dsb.deposits, dsb.depositSales] });
await as(A, `delete from public.sales where sale_id = '9102'`);
ok((await as(A, `select count(*)::int n from public.deposit_sales where deposit_id = 'd1'`)).rows[0].n === 1, 'a deleted sale leaves the deposit, with the rest of its sales');
await as(A, `delete from public.deposits where id = 'd1'`);
ok((await as(A, `select count(*)::int n from public.deposit_sales`)).rows[0].n === 0 && (await as(A, `select count(*)::int n from public.sales where sale_id = '9101'`)).rows[0].n === 1,
  'deleting a deposit deletes what it paid, never the sales');

await db.query(`insert into public.fx_rates (day, lek_per, source) values ('2020-01-02', '{"EUR": 123}', 'test-old')`);
await db.query('select public.cleanup_old()');
ok((await db.query(`select count(*)::int n from public.fx_rates where day = '2020-01-02'`)).rows[0].n === 1, 'cleanup keeps old exchange rates: any day may need its rate');
await db.query(`delete from public.fx_rates where source = 'test-old'`);
await db.query(`delete from public.sales where sale_id in ('9101', '9103', '9201')`);
await db.query(`delete from public.deposits where id in ('d2', 'db2')`);
await db.query(`delete from public.buy_accounts where id = 'accm'`);

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
