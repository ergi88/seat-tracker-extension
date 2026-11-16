-- ====================================================================
-- Seat Tracker · Supabase schema
--
-- Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- Safe to run again after an update: it only adds what is missing.
--
-- Who can do what
--   * Only accounts listed in public.members can read or write anything.
--     Anyone else — including someone who signs up with the public key — sees
--     nothing. The members list is filled at the bottom of this file.
--   * Members trust each other: a PC signed in as one member can scan, alert
--     and run phone commands for every member.
-- ====================================================================

-- ---------------------------------------------------------------- members
create table if not exists public.members (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  email    text,
  added_at timestamptz not null default now()
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.members where user_id = auth.uid()) $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------- team settings
create table if not exists public.team_settings (
  id         int primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,       -- autoMin, eventCheckMin
  updated_at timestamptz not null default now()
);
insert into public.team_settings (id) values (1) on conflict (id) do nothing;

-- --------------------------------------------------------------- profiles
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  settings     jsonb not null default '{}'::jsonb,     -- notifications, topics, defaults
  snooze_until timestamptz,
  updated_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------- events
-- numbers are kept per event key forever, so tracking an event again brings back its [n]
create table if not exists public.event_numbers (
  key text primary key,
  num int not null unique
);

create table if not exists public.events (
  key        text primary key,                          -- "ebileta:2153"
  num        int,
  site       text not null,
  site_id    text not null,
  title      text not null default '',
  date       text not null default '',
  sectors    jsonb not null default '[]'::jsonb,
  extra      jsonb not null default '{}'::jsonb,
  cats       jsonb not null default '{}'::jsonb,
  auto_min   int,                                       -- null = team default, 0 = off
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.assign_event_num() returns trigger
language plpgsql as $$
begin
  -- one number per key, no gaps: a lock instead of a sequence
  perform pg_advisory_xact_lock(hashtext('seat-tracker:event_numbers'));
  select num into new.num from public.event_numbers where key = new.key;
  if new.num is null then
    select coalesce(max(num), 0) + 1 into new.num from public.event_numbers;
    insert into public.event_numbers (key, num) values (new.key, new.num);
  end if;
  return new;
end $$;

-- --------------------------------------------------------------- requests
create table if not exists public.user_counters (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  next_req int not null default 1
);

create table if not exists public.requests (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  event_key  text not null references public.events (key) on delete cascade,
  num        int,                                       -- per user, never reused
  sec        text not null,
  qty        int not null default 1 check (qty >= 1),
  cats       jsonb not null default '[]'::jsonb,
  client     text not null default '',
  listing    text not null default '',
  warn       int not null default 2,
  opts       int not null default 3,
  together   boolean not null default true,
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists requests_event_key on public.requests (event_key);
create unique index if not exists requests_user_num on public.requests (user_id, num);

create or replace function public.assign_request_num() returns trigger
language plpgsql as $$
begin
  if new.num is null then
    insert into public.user_counters as c (user_id, next_req) values (new.user_id, 2)
    on conflict (user_id) do update set next_req = c.next_req + 1
    returning next_req - 1 into new.num;
  end if;
  return new;
end $$;

-- the last evaluation of a request; `version` makes "alert once" safe across PCs
create table if not exists public.request_state (
  request_id   text primary key references public.requests (id) on delete cascade,
  status       text not null,
  options      int not null default 0,
  free         int,
  pending_gone boolean not null default false,
  alert_log    jsonb not null default '{}'::jsonb,
  scan_at      timestamptz,
  version      int not null default 0,
  updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------------------ scans
-- only the latest scan of each sector, shared by every PC
create table if not exists public.scans (
  event_key  text not null references public.events (key) on delete cascade,
  sector_id  text not null,
  scan       jsonb not null,
  summary    jsonb not null default '{}'::jsonb,
  scanned_at timestamptz not null default now(),
  scanned_by text,
  primary key (event_key, sector_id)
);

create table if not exists public.event_health (
  event_key  text primary key references public.events (key) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------ site event lists (eBileta)
create table if not exists public.catalog (
  site       text not null,
  site_id    text not null,
  data       jsonb not null default '{}'::jsonb,
  first_seen timestamptz not null default now(),
  gone       boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (site, site_id)
);

create table if not exists public.catalog_sites (
  site       text primary key,
  checked_at timestamptz not null default now()
);

-- ------------------------------------------------ devices, leases, alerts
create table if not exists public.devices (
  id        text primary key,
  user_id   uuid not null references auth.users (id) on delete cascade,
  name      text not null default '',
  last_seen timestamptz not null default now(),
  version   text
);

-- "this PC scans event X until …": only one PC does a job at a time
create table if not exists public.leases (
  name       text primary key,
  device_id  text not null,
  user_id    uuid,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- desktop notifications fan out to every PC of the user they are for
create table if not exists public.alerts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  event_key  text,
  request_id text,
  type       text not null,
  title      text not null,
  message    text not null,
  click      text,
  data       jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists alerts_user_id on public.alerts (user_id, id);

-- phone commands run exactly once, whichever PC reads them
create table if not exists public.handled_commands (
  id         text primary key,
  user_id    uuid,
  handled_at timestamptz not null default now()
);

-- a price typed on a request, when the site shows none (per ticket)
alter table public.requests add column if not exists buy_price numeric;
alter table public.requests add column if not exists buy_currency text not null default 'ALL';

-- viagogo listings as last read on my.viagogo.com/listings: private to their owner
create table if not exists public.listings (
  listing_id  text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_key   text references public.events (key) on delete set null,
  sector_id   text,
  vg_event_id text not null default '',
  title       text not null default '',
  event_when  text not null default '',
  section     text not null default '',
  row_label   text not null default '',
  status      text not null default '',
  currency    text not null default 'USD',
  price       numeric,                                  -- per ticket
  payout      numeric,                                  -- "You'll get", for every ticket still listed
  tickets     int,
  recommended numeric,
  performance text not null default '',
  history     jsonb not null default '[]'::jsonb,       -- [{ at, price, tickets, status }], last 30 changes
  seen_at     timestamptz not null default now(),
  seen_by     text,
  updated_at  timestamptz not null default now()
);
create index if not exists listings_event on public.listings (event_key, sector_id);

-- v4: a listing is its own record, not half of a request.
--   track = 'auto'  scanned and alerted like any request  (the default)
--   track = 'off'   "I already have these tickets": no scans, no alerts, no badge
-- buy_price is what these tickets cost you, typed on the listing. It beats the
-- price scraped from the ticket site, and it is the only way a listing on an
-- event nobody tracks can show a profit at all.
-- Added separately so an older build, which never writes these columns, keeps
-- working against the same database.
alter table public.listings add column if not exists track         text not null default 'auto';
alter table public.listings add column if not exists last_sweep_at timestamptz;
alter table public.listings add column if not exists gone_at       timestamptz;
alter table public.listings add column if not exists buy_price     numeric;
alter table public.listings add column if not exists buy_currency  text not null default 'ALL';
alter table public.listings add column if not exists venue         text not null default '';
do $$ begin
  alter table public.listings add constraint listings_track_check check (track in ('auto', 'off'));
exception when duplicate_object then null; end $$;

-- v5: "Bought" lives on the request, so it works before anything is listed.
--   bought = true  you have these tickets: no scans, no alerts, no badge, and
--                  BOUGHT is shown in place of the scan's status
-- listings.track = 'off' is kept only for a listing with no request. A switch
-- thrown on a listing that has its owner's request moves onto the request and
-- the listing goes back to 'auto', so running this again changes nothing.
alter table public.requests add column if not exists bought boolean not null default false;
with moved as (
  update public.requests r set bought = true, updated_at = now()
  from public.listings l
  where l.listing_id = r.listing and l.user_id = r.user_id and l.track = 'off' and r.listing <> ''
  returning l.listing_id, l.user_id
)
update public.listings l set track = 'auto'
from moved where l.listing_id = moved.listing_id and l.user_id = moved.user_id;

-- gone_at is retired: nothing writes it any more. A scan session reports what
-- it did not see and leaves every record alone, because "I did not see it" and
-- "it is not there" are not the same thing, and guessing cost a whole set of
-- requests once already. The column stays so an older build still loads.
update public.listings set gone_at = null where gone_at is not null;

-- the team sees everyone's sell price per section, never the payout.
-- vg_event_id, title and event_when came later (the last-sales scan visits
-- every event the team lists on): new columns only ever go at the end.
create or replace view public.team_prices as
  select l.listing_id, l.user_id, l.event_key, l.sector_id, l.section, l.row_label, l.status,
         l.currency, l.price, l.tickets, l.seen_at,
         l.vg_event_id, l.title, l.event_when
  from public.listings l
  where public.is_member();

-- viagogo sales as read on my.viagogo.com → My Sales: private to their owner,
-- like listings. A sale is history, so nothing ever deletes it on its own.
--   amount     the money shown on the sale card, for all its tickets, in currency
--   sold_on    the "Sale date" from the card's details; newest-first is how a
--              scan knows it has reached the sales it already has
--   listing_id the listing it was sold from, when the page shows it
--   buy_price  what one ticket cost you, when no listing or request says so:
--              typed once on the section in the sidebar
create table if not exists public.sales (
  sale_id      text primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_key    text references public.events (key) on delete set null,
  sector_id    text,
  vg_event_id  text not null default '',
  listing_id   text,
  title        text not null default '',
  event_when   text not null default '',
  venue        text not null default '',
  section      text not null default '',
  row_label    text not null default '',
  tickets      int,
  currency     text not null default 'USD',
  amount       numeric,
  status       text not null default '',              -- 'Complete' = paid, 'Get Paid' = not paid yet (viagogo's own)
  sold_on      date,
  buy_price    numeric,
  buy_currency text not null default 'ALL',
  seen_at      timestamptz not null default now(),
  seen_by      text,
  updated_at   timestamptz not null default now()
);
create index if not exists sales_by_date  on public.sales (user_id, sold_on desc);
create index if not exists sales_by_event on public.sales (event_key, sector_id);

-- exchange rates: lek per unit of each currency, one row per day
create table if not exists public.fx_rates (
  day        date primary key,
  lek_per    jsonb not null,
  source     text not null default '',
  fetched_by text,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------ buy tracker
-- The ticket-site logins each person buys with, and what each bought. Both
-- private to their owner, like listings. An account is an email, the same
-- one on every site, so its tickets count per event whatever the site.
create table if not exists public.buy_accounts (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email      text not null,
  first_name text not null default '',
  last_name  text not null default '',
  birthday   date,
  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists buy_accounts_email on public.buy_accounts (user_id, lower(email));

--   qty        tickets bought in this purchase
--   request_id the request it fills, when there is one: enough tickets make it Bought
--   price      per ticket, in currency
create table if not exists public.purchases (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id text not null references public.buy_accounts (id) on delete cascade,
  event_key  text not null references public.events (key) on delete cascade,
  request_id text references public.requests (id) on delete set null,
  sector_id  text,
  qty        int not null default 1 check (qty >= 1),
  price      numeric,
  currency   text not null default 'ALL',
  bought_on  date not null default current_date,
  order_ref  text not null default '',
  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchases_event on public.purchases (user_id, event_key);

-- Inventory: a purchase is a lot. Only lots are stock; a listing or sale with
-- no lot behind it is a ticket still to buy.
--   assigned    where its tickets went, typed in the app:
--               { "listings": { "<listing id>": qty }, "sales": { "<sale id>": qty } }
--               a listing's sales come off its lots oldest first
--   vg_event_id a lot for a viagogo event nobody tracks (event_key empty),
--   event_title with its name and a typed section
alter table public.purchases add column if not exists assigned    jsonb not null default '{}'::jsonb;
alter table public.purchases add column if not exists vg_event_id text not null default '';
alter table public.purchases add column if not exists event_title text not null default '';
alter table public.purchases add column if not exists section     text not null default '';
alter table public.purchases alter column event_key drop not null;
do $$ begin
  alter table public.purchases add constraint purchases_event_check check (event_key is not null or vg_event_id <> '');
exception when duplicate_object then null; end $$;

-- viagogo's PreDelivered on a listing: true once the tickets are uploaded
-- (null until the extension reads it from the listings JSON)
alter table public.listings add column if not exists uploaded boolean;

-- The limits themselves (tickets one account may buy per event) are team
-- settings: buyLimits per site, eventBuyLimits for an event that differs.

-- What a ticket in each sector costs, typed by the team (or learnt from a
-- purchase) where the site's own price is missing or wrong. Shared: a price
-- is the site's, not anyone's. One per sector; it goes with its event.
create table if not exists public.sector_prices (
  event_key  text not null references public.events (key) on delete cascade,
  sector_id  text not null,
  amount     numeric not null check (amount > 0),
  currency   text not null default 'ALL',
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (event_key, sector_id)
);

-- ------------------------------------------------------- viagogo last sales

-- The "just sold" toast viagogo shows on its sell pages: an event's latest
-- sale, read off an open sell page or asked of viagogo by the last-sales scan.
-- Shared with the team: it is the market's, not anyone's.
-- The toast has no time and no ID, so the same section, tickets and price as
-- the newest row for that event is the same sale again: it is skipped and
-- nothing is written. (last_seen and seen_count are no longer moved: they
-- stay as first saved.)
--   vg_key      the viagogo event by its name, folded ("albaniavsfinlandnationsleague")
--   first_seen  when it was saved: the closest there is to when it sold
--   price       as the toast shows it, taken to be for all its tickets, in currency
create table if not exists public.vg_last_sales (
  id          bigint generated always as identity primary key,
  vg_key      text not null,
  vg_event_id text not null default '',
  event_key   text references public.events (key) on delete set null,
  sector_id   text,
  title       text not null default '',
  event_when  text not null default '',
  section     text not null default '',
  row_label   text not null default '',
  tickets     int,
  price       numeric,
  currency    text not null default '',
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  seen_count  int not null default 1,
  seen_by     text,
  user_id     uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);
-- listing_id: the listing it sold from, when viagogo's own answer says so
-- (the toast on the page does not). Two listings are never the same sale.
alter table public.vg_last_sales add column if not exists listing_id text not null default '';
create index if not exists vg_last_sales_event on public.vg_last_sales (vg_key, first_seen desc);
create index if not exists vg_last_sales_tracked on public.vg_last_sales (event_key, sector_id);

-- ------------------------------------------------ viagogo saved scans

-- A viagogo event page as read by the drawer's Scan, kept when Save is
-- pressed: every listing of every section (rows: the drawer's saved-scan
-- rows). Only the newest two per person and event are kept (the trigger
-- below drops the rest), so the app can show the newer one and what
-- changed since the older. Their owner's alone: a signed-in scan knows
-- which listings are yours, and its prices are the ones viagogo shows you.
--   scanned_at  when the scan was read (two saves of one scan are one row)
--   listings    listings for sale in it, for the list without the rows
create table if not exists public.vg_scans (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vg_event_id text not null,
  event_key   text references public.events (key) on delete set null,
  name        text not null default '',
  start_text  text not null default '',
  scanned_at  timestamptz not null,
  signed_in   boolean not null default false,
  complete    boolean not null default false,
  shown       int,
  total       int,
  listings    int not null default 0,
  rows        jsonb not null default '[]'::jsonb,
  saved_by    text not null default '',
  created_at  timestamptz not null default now()
);
create unique index if not exists vg_scans_one on public.vg_scans (user_id, vg_event_id, scanned_at);

create or replace function public.keep_two_vg_scans()
returns trigger language plpgsql as $$
begin
  delete from public.vg_scans s
  where s.user_id = new.user_id and s.vg_event_id = new.vg_event_id
    and s.id not in (select x.id from public.vg_scans x
                     where x.user_id = new.user_id and x.vg_event_id = new.vg_event_id
                     order by x.scanned_at desc limit 2);
  return null;
end $$;

-- --------------------------------------------------------------- triggers
drop trigger if exists vg_scans_keep_two on public.vg_scans;
create trigger vg_scans_keep_two after insert on public.vg_scans
  for each row execute function public.keep_two_vg_scans();

drop trigger if exists events_num on public.events;
create trigger events_num before insert on public.events
  for each row execute function public.assign_event_num();

drop trigger if exists requests_num on public.requests;
create trigger requests_num before insert on public.requests
  for each row execute function public.assign_request_num();

do $$
declare t text;
begin
  foreach t in array array['team_settings', 'profiles', 'events', 'requests', 'request_state', 'event_health', 'catalog', 'leases', 'listings', 'sales', 'fx_rates', 'buy_accounts', 'purchases', 'sector_prices', 'vg_last_sales'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- -------------------------------------------------------------- functions
create or replace function public.claim_lease(p_name text, p_device text, p_seconds int)
returns boolean language plpgsql as $$
declare ok boolean;
begin
  if not public.is_member() then return false; end if;
  insert into public.leases as l (name, device_id, user_id, expires_at)
  values (p_name, p_device, auth.uid(), now() + make_interval(secs => p_seconds))
  on conflict (name) do update
    set device_id = excluded.device_id, user_id = excluded.user_id, expires_at = excluded.expires_at
    where l.expires_at < now() or l.device_id = p_device
  returning true into ok;
  return coalesce(ok, false);
end $$;

create or replace function public.release_lease(p_name text, p_device text)
returns void language sql as $$
  delete from public.leases where name = p_name and device_id = p_device;
$$;

-- one small call tells a PC which tables changed since it last looked
create or replace function public.sync_status()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'now',      now(),
    'member',   public.is_member(),
    'team',     (select concat(max(updated_at), '|', count(*)) from public.team_settings),
    'profiles', (select concat(max(updated_at), '|', count(*)) from public.profiles),
    'events',   (select concat(max(updated_at), '|', count(*)) from public.events),
    'requests', (select concat(max(updated_at), '|', count(*)) from public.requests),
    'state',    (select concat(max(updated_at), '|', count(*)) from public.request_state),
    'scans',    (select concat(max(scanned_at), '|', count(*)) from public.scans),
    'health',   (select concat(max(updated_at), '|', count(*)) from public.event_health),
    'catalog',  (select concat(max(updated_at), '|', count(*)) from public.catalog),
    'leases',   (select concat(max(updated_at), '|', count(*)) from public.leases),
    'listings', (select concat(max(updated_at), '|', count(*)) from public.listings),
    'sales',    (select concat(max(updated_at), '|', count(*)) from public.sales where user_id = auth.uid()),
    'teamPrices', (select concat(max(seen_at), '|', count(*)) from public.team_prices),
    'fx',       (select concat(max(updated_at), '|', count(*)) from public.fx_rates),
    'accounts', (select concat(max(updated_at), '|', count(*)) from public.buy_accounts where user_id = auth.uid()),
    'purchases', (select concat(max(updated_at), '|', count(*)) from public.purchases where user_id = auth.uid()),
    'prices',   (select concat(max(updated_at), '|', count(*)) from public.sector_prices),
    'lastSales', (select concat(max(updated_at), '|', count(*)) from public.vg_last_sales),
    'vgScans',  (select concat(max(created_at), '|', count(*)) from public.vg_scans where user_id = auth.uid()),
    'alerts',   (select coalesce(max(id), 0) from public.alerts where user_id = auth.uid())
  )
$$;

create or replace function public.cleanup_old()
returns void language sql as $$
  delete from public.alerts where created_at < now() - interval '7 days';
  delete from public.handled_commands where handled_at < now() - interval '2 days';
  delete from public.leases where expires_at < now() - interval '1 day';
  delete from public.fx_rates where day < current_date - 180;
  delete from public.listings where seen_at < now() - interval '120 days';
  delete from public.vg_last_sales where last_seen < now() - interval '180 days';
  delete from public.vg_scans where scanned_at < now() - interval '120 days';
$$;

-- ------------------------------------------------------- row level security
do $$
declare t text;
begin
  foreach t in array array['team_settings', 'profiles', 'event_numbers', 'events', 'user_counters', 'requests',
                           'request_state', 'scans', 'event_health', 'catalog', 'catalog_sites', 'devices',
                           'leases', 'alerts', 'handled_commands', 'fx_rates', 'sector_prices', 'vg_last_sales'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_members on public.%I', t);
    execute format('create policy team_members on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

alter table public.members enable row level security;
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (public.is_member());

-- a listing, with its payout, is only ever read or written by its owner
alter table public.listings enable row level security;
drop policy if exists own_listings on public.listings;
create policy own_listings on public.listings for all to authenticated
  using (public.is_member() and user_id = auth.uid())
  with check (public.is_member() and user_id = auth.uid());

-- a sale, with what it paid, is only ever read or written by its owner
alter table public.sales enable row level security;
drop policy if exists own_sales on public.sales;
create policy own_sales on public.sales for all to authenticated
  using (public.is_member() and user_id = auth.uid())
  with check (public.is_member() and user_id = auth.uid());

-- buying accounts (names, birthdays), purchases and saved viagogo scans: their owner's alone
do $$
declare t text;
begin
  foreach t in array array['buy_accounts', 'purchases', 'vg_scans'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (public.is_member() and user_id = auth.uid()) with check (public.is_member() and user_id = auth.uid())', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ grants
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.members from authenticated;
-- the view reads past the owner-only rule on purpose (price, not payout): it must never write
revoke insert, update, delete on public.team_prices from authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_member(), public.claim_lease(text, text, int), public.release_lease(text, text),
  public.sync_status(), public.cleanup_old(), public.touch_updated_at(), public.assign_event_num(),
  public.assign_request_num() to authenticated;

-- ------------------------------------------------------------ the team
-- Who is on the team lives in supabase/team.sql, kept off GitHub because it
-- holds real emails. Make it once from supabase/team.example.sql, put the
-- team's emails in, and run it after this file whenever someone joins.
-- Nothing in this file removes a member, so running it again keeps the team.
