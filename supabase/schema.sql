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
-- seats: viagogo's Seats on the sale ("1-4"), so the app can tell which of
-- the listing's tickets it took
alter table public.sales add column if not exists seats text not null default '';

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

-- ------------------------------------------------------------- tickets
-- A ticket is one page of a ticket PDF, with its own file: listings link to
-- the tickets they hold, and a sale marks the tickets it took. The lot (the
-- purchase) stays the order. Tickets only ever come from a PDF uploaded in
-- the app; a lot with none stays counted (purchases.assigned, as before).
-- All of it is its owner's alone, like purchases.

-- Lots that were there when tickets came are frozen: read-only and counted
-- for good (they can still be deleted). Only the run that adds the column
-- freezes them, so running this file again never freezes a newer lot.
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'purchases' and column_name = 'frozen') then
    alter table public.purchases add column frozen boolean not null default false;
    update public.purchases set frozen = true;
  end if;
end $$;

-- Which market a listing is on. viagogo is the only one read so far (its
-- IDs as they are); StubHub's will be prefixed "sh:".
alter table public.listings add column if not exists market text not null default 'viagogo';
do $$ begin
  alter table public.listings add constraint listings_market_check check (market in ('viagogo', 'stubhub'));
exception when duplicate_object then null; end $$;

--   page         the page of the PDF it came from (1 = first)
--   sector_text  the sector as printed ("TRIBUNA E206"); sector_id: the tracked event's
--   serial       the ticket number printed on it: one per person, never twice
--   price        what it cost, bank fee included, in currency
--   event_at     when the event is, as printed: its PDF is deleted 7 days after
--   sale_id      the viagogo sale that took it (null: not sold on viagogo)
--   file_path    its PDF in the private "tickets" bucket: <user id>/<ticket id>.pdf
--   file_gone_at when the app deleted that PDF, after the event
create table if not exists public.tickets (
  id           text primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  purchase_id  text not null references public.purchases (id) on delete cascade,
  page         int,
  sector_text  text not null default '',
  sector_id    text,
  row_label    text not null default '',
  seat         text not null default '',
  serial       text not null default '',
  price        numeric,
  currency     text not null default 'ALL',
  event_at     timestamptz,
  sale_id      text references public.sales (sale_id) on delete set null,
  file_path    text,
  file_gone_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists tickets_serial on public.tickets (user_id, serial) where serial <> '';
create index if not exists tickets_purchase on public.tickets (purchase_id);

-- the tickets a listing holds; a link stays once the listing ends, as history
create table if not exists public.listing_tickets (
  listing_id text not null references public.listings (listing_id) on delete cascade,
  ticket_id  text not null references public.tickets (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (listing_id, ticket_id)
);
create index if not exists listing_tickets_ticket on public.listing_tickets (ticket_id);

-- A ticket goes on its owner's own lot, never a frozen one, and is sold
-- only by its owner's sale. The reads see only the caller's rows (RLS), so
-- someone else's lot or sale is "not found".
create or replace function public.check_ticket() returns trigger
language plpgsql as $$
declare lot record;
begin
  if tg_op = 'INSERT' or new.purchase_id is distinct from old.purchase_id then
    select user_id, frozen into lot from public.purchases where id = new.purchase_id;
    if not found or lot.user_id <> new.user_id then
      raise exception 'ticket_not_yours: lot % is not yours', new.purchase_id;
    end if;
    if lot.frozen then
      raise exception 'lot_frozen: lot % is frozen: it stays counted, with no tickets', new.purchase_id;
    end if;
  end if;
  if new.sale_id is not null and (tg_op = 'INSERT' or new.sale_id is distinct from old.sale_id) then
    if not exists (select 1 from public.sales where sale_id = new.sale_id and user_id = new.user_id) then
      raise exception 'sale_not_yours: sale % is not yours', new.sale_id;
    end if;
  end if;
  return new;
end $$;

-- A ticket on a listing. While the listing is active (its status as
-- core/viagogo.js LISTING_STATUSES reads it: active, live, pending, draft,
-- paused, on hold), the link is refused when
--   (a) the ticket is already on another active listing of the same market
--       (two markets at once is the point: one ticket, viagogo and StubHub), or
--   (b) the listing would hold more unsold tickets than it lists.
-- An ended listing takes any link: it is history, and its unsold tickets count as free.
create or replace function public.check_listing_ticket() returns trigger
language plpgsql as $$
declare l record; t record; other text; held int;
begin
  select user_id, market, status, tickets into l from public.listings where listing_id = new.listing_id;
  if not found or l.user_id <> new.user_id then
    raise exception 'listing_not_yours: listing % is not yours', new.listing_id;
  end if;
  select user_id, sale_id into t from public.tickets where id = new.ticket_id;
  if not found or t.user_id <> new.user_id then
    raise exception 'ticket_not_yours: ticket % is not yours', new.ticket_id;
  end if;
  if btrim(l.status) !~* '^(active|live|pending|draft|paused|on hold)\y' then return new; end if;

  select x.listing_id into other
  from public.listing_tickets x join public.listings o on o.listing_id = x.listing_id
  where x.ticket_id = new.ticket_id and x.listing_id <> new.listing_id
    and o.market = l.market and btrim(o.status) ~* '^(active|live|pending|draft|paused|on hold)\y'
  limit 1;
  if other is not null then
    raise exception 'ticket_double_listed: ticket % is already on listing %, on the same market', new.ticket_id, other;
  end if;

  if l.tickets is not null and t.sale_id is null then
    select count(*) into held
    from public.listing_tickets x join public.tickets k on k.id = x.ticket_id
    where x.listing_id = new.listing_id and x.ticket_id <> new.ticket_id and k.sale_id is null;
    if held + 1 > l.tickets then
      raise exception 'listing_over_count: listing % holds % tickets, % are on it already', new.listing_id, l.tickets, held;
    end if;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------ money in lek
-- Money is worth lek at three moments, and two of them are kept here:
--   bought     what the bank charged for a lot (purchases.spent_all)
--   live       today's rate, for whatever is not settled yet (worked out, not kept)
--   deposited  what reached the bank for a payout (deposits), in both
--              currencies, so its rate is the bank's own
--
--   spent_all   a lot's total in lek, bank fees included; its tickets share it
--               in proportion to their own prices (null: not known, worked
--               out at the rate of the day it was bought)
--   spent_auto  true: filled at the rate of the day it was bought, and filled
--               again when the lot changes; false: typed (as charged), never
--               changed on its own
alter table public.purchases add column if not exists spent_all  numeric;
alter table public.purchases add column if not exists spent_auto boolean not null default true;

-- A payout that reached the bank, in both currencies: the amount that came
-- (in the currency viagogo paid out in) and the lek the bank credited for it.
-- Their owner's alone, like sales.
--   received_on  the day it reached the bank
--   amount       what came, in currency: the sales' payouts, less any fee
--   amount_all   the lek the bank credited
--   all_auto     true: amount_all was filled at the day's rate, not typed
--   rate         lek per unit: the bank's own rate for this payout
--   bank         which account it reached, as you name it ("BKT USD")
create table if not exists public.deposits (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  received_on date not null default current_date,
  currency    text not null,
  amount      numeric not null check (amount > 0),
  amount_all  numeric not null check (amount_all > 0),
  all_auto    boolean not null default false,
  rate        numeric generated always as (amount_all / nullif(amount, 0)) stored,
  bank        text not null default '',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists deposits_by_day on public.deposits (user_id, received_on desc);

-- the sales a deposit paid: one deposit can pay several sales, and a sale is
-- paid into one deposit at most. Each sale's lek is its share of the deposit,
-- in proportion to its payout.
create table if not exists public.deposit_sales (
  deposit_id text not null references public.deposits (id) on delete cascade,
  sale_id    text not null references public.sales (sale_id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (deposit_id, sale_id)
);
create unique index if not exists deposit_sales_one on public.deposit_sales (sale_id);

-- A sale goes into its owner's own deposit, paid in the deposit's currency.
-- The reads see only the caller's rows (RLS), so someone else's is "not found".
create or replace function public.check_deposit_sale() returns trigger
language plpgsql as $$
declare d record; s record;
begin
  select user_id, currency into d from public.deposits where id = new.deposit_id;
  if not found or d.user_id <> new.user_id then
    raise exception 'deposit_not_yours: deposit % is not yours', new.deposit_id;
  end if;
  select user_id, currency into s from public.sales where sale_id = new.sale_id;
  if not found or s.user_id <> new.user_id then
    raise exception 'sale_not_yours: sale % is not yours', new.sale_id;
  end if;
  if s.currency <> d.currency then
    raise exception 'deposit_currency: sale % was paid in %, the deposit is in %', new.sale_id, s.currency, d.currency;
  end if;
  return new;
end $$;

-- a deposit keeps the currency its sales were paid in
create or replace function public.check_deposit() returns trigger
language plpgsql as $$
begin
  if new.currency is distinct from old.currency and exists (
    select 1 from public.deposit_sales x join public.sales s on s.sale_id = x.sale_id
    where x.deposit_id = new.id and s.currency <> new.currency) then
    raise exception 'deposit_currency: deposit % pays sales in %', new.id, old.currency;
  end if;
  return new;
end $$;

-- the PDFs: a private bucket, one file per ticket under its owner's folder.
-- Skipped where there is no Storage (the PGlite test stands one in).
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('tickets', 'tickets', false)
    on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns
               where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      update storage.buckets set allowed_mime_types = array['application/pdf'], file_size_limit = 10485760 where id = 'tickets';
    end if;
    execute 'drop policy if exists tickets_own on storage.objects';
    execute $p$create policy tickets_own on storage.objects for all to authenticated
      using (bucket_id = 'tickets' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member())
      with check (bucket_id = 'tickets' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member())$p$;
  end if;
end $$;

-- --------------------------------------------------------------- triggers
drop trigger if exists tickets_check on public.tickets;
create trigger tickets_check before insert or update on public.tickets
  for each row execute function public.check_ticket();

drop trigger if exists listing_tickets_check on public.listing_tickets;
create trigger listing_tickets_check before insert or update on public.listing_tickets
  for each row execute function public.check_listing_ticket();

drop trigger if exists deposit_sales_check on public.deposit_sales;
create trigger deposit_sales_check before insert or update on public.deposit_sales
  for each row execute function public.check_deposit_sale();

drop trigger if exists deposits_check on public.deposits;
create trigger deposits_check before update on public.deposits
  for each row execute function public.check_deposit();

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
  foreach t in array array['team_settings', 'profiles', 'events', 'requests', 'request_state', 'event_health', 'catalog', 'leases', 'listings', 'sales', 'fx_rates', 'buy_accounts', 'purchases', 'sector_prices', 'vg_last_sales', 'tickets', 'listing_tickets', 'deposits', 'deposit_sales'] loop
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
    'tickets',  (select concat(max(updated_at), '|', count(*)) from public.tickets where user_id = auth.uid()),
    'ticketLinks', (select concat(max(updated_at), '|', count(*)) from public.listing_tickets where user_id = auth.uid()),
    'deposits', (select concat(max(updated_at), '|', count(*)) from public.deposits where user_id = auth.uid()),
    'depositSales', (select concat(max(updated_at), '|', count(*)) from public.deposit_sales where user_id = auth.uid()),
    'alerts',   (select coalesce(max(id), 0) from public.alerts where user_id = auth.uid())
  )
$$;

create or replace function public.cleanup_old()
returns void language sql as $$
  delete from public.alerts where created_at < now() - interval '7 days';
  delete from public.handled_commands where handled_at < now() - interval '2 days';
  delete from public.leases where expires_at < now() - interval '1 day';
  -- exchange rates are kept for good: one small row a day, and any day a lot
  -- was bought on or a payout came may need its rate
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

-- buying accounts (names, birthdays), purchases, their tickets and the listings
-- those are on, saved viagogo scans, and deposits with the sales they paid:
-- their owner's alone
do $$
declare t text;
begin
  foreach t in array array['buy_accounts', 'purchases', 'vg_scans', 'tickets', 'listing_tickets', 'deposits', 'deposit_sales'] loop
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
  public.assign_request_num(), public.check_ticket(), public.check_listing_ticket(),
  public.check_deposit_sale(), public.check_deposit() to authenticated;

-- ------------------------------------------------------------ the team
-- Who is on the team lives in supabase/team.sql, kept off GitHub because it
-- holds real emails. Make it once from supabase/team.example.sql, put the
-- team's emails in, and run it after this file whenever someone joins.
-- Nothing in this file removes a member, so running it again keeps the team.
