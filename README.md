# Seat Tracker

One Chrome extension (Manifest V3, plain JavaScript, no build step) that tracks client ticket
requests and real seat availability on **eBileta** (Albania and Kosovo), **eFinity** and **Posttick**, and tells you on
your desktop and phone the moment a request can — or can no longer — be filled.

It replaces the three separate trackers. **It reads the sites and nothing more**, with one exception
you switch on yourself: on eBileta it can hold seats in the site's own cart when you click a seat or
press **Reserve**. Even then it never logs in, never pays and never submits anything — you finish on
eBileta. Off by default, per PC: Settings → On-site panels → *Let Seat Tracker select seats*. See
[Holding seats on eBileta](#holding-seats-on-ebileta).

A small team shares it. Events and their scans are **shared**; requests, alerts and topics stay
**yours**. Whichever PC is online scans an event once, and everyone's requests are judged from that
same scan — see [The team](#the-team).

| Guide | What's in it |
|---|---|
| **?** buttons in the extension | a short explanation of every setting, next to the setting |
| [NOTIFICATIONS.md](NOTIFICATIONS.md) | every notification, when it fires, examples and timelines |
| [COMMANDS.md](COMMANDS.md) | every phone command with a link |
| [SHORTCUTS.md](SHORTCUTS.md) | building an iPhone Shortcut that sends the commands |
| [the app's README](../seat-tracker-app/README.md) | the phone app: the same data, on the phone |

---

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → pick this `seat-tracker` folder.
3. Pin it to the toolbar.
4. **Sign in** with your team email and password. Until you do, the popup shows only the sign-in card
   and the toolbar icon shows **!**.

Repeat on every PC. The same person may be signed in on several PCs at once.

### Updating to a new version

The popup's **Updates** section tells every signed-in PC when a newer Seat Tracker is out:

1. Whoever makes the zip puts its link in **Updates → Send to every PC**, with the version number and
   an optional note. Every signed-in PC sees it within a minute: a bar at the top of the popup with
   **Download** and **How**.
2. On each PC: download the zip and unzip it **over the same Seat Tracker folder**. Chrome knows the
   extension by its folder; a new folder means a new extension, signed out, with no settings.
3. **Reload Seat Tracker** (in Updates) or ↻ on `chrome://extensions`.

A PC is told only when the shared version is higher than the `"version"` in its `manifest.json`, so
**raise that number for every release**. Updates also lists every PC with the version it runs
("not updated" when it is behind). **Copy link** is for someone who is not signed in; **Take the link
back** removes it.

After a release that changes the database, run `supabase/schema.sql` again (see below) before the
PCs update. Running it twice is harmless.

### Preparing the shared database (once, for the whole team)

1. In the Supabase project: **SQL Editor** → paste `supabase/schema.sql` → **Run**. Running it again
   later is safe; it only creates what is missing.
2. **Authentication → Providers → Email** → turn **"Allow new users to sign up" OFF**.
3. **Authentication → Users → Add user** for each member (email + password, auto-confirm).
4. Put those same emails in the `members` insert at the bottom of `schema.sql` and run it again.
   Nobody outside that list can read or write anything.

The project URL and the **publishable** key are built into `core/config.js`. That key is public by
design — on its own it opens nothing, because every table is behind the members list. The secret /
service_role key and the database password never belong in the extension.

### Moving over from the three old extensions

1. In each old extension's popup: **Export JSON**.
2. In Seat Tracker: **Backup → Import JSON**, once per file. Requests are added, never replaced; the
   three old formats are recognised automatically. Your phone and shortcuts topics are copied over if
   Seat Tracker's are still empty. Everything you import becomes **your** requests, so each person
   imports their own files while signed in as themselves.
3. Old requests get **new numbers** (each old extension had its own #1), so update any saved phone links.
4. Keep the old extensions running for a day and compare the numbers. Then switch them off —
   otherwise you get every alert twice.

---

## The team

Everyone signs in with their own account. What that changes:

| Shared by everyone | Yours alone | This PC only |
|---|---|---|
| events, their sectors and titles | your requests and their numbers (`#1` starts again per person) | theme (light / dark) |
| every scan and its seats | your alerts, mute and quiet hours | sidebar push / overlay |
| event numbers `[1]`, `[2]` | your ntfy and shortcuts topics | on-site panels and badges |
| auto-check intervals | your defaults for new requests | the PC's name |
| viagogo sell prices per section, exchange rates | your viagogo listings, payouts and profits | |
| viagogo's "just sold" sales (last sales) | your viagogo sales and their profit | |
| the price list per sector, buy limits per site and event | your buying accounts and purchases | |
| the update link | your saved viagogo event scans | |

**Requests are judged one by one, never added up.** If you want 5 seats in E105 and someone else
wants 6 there, each is evaluated against the same scan on its own — never as 11.

**One PC scans, everyone benefits.** Before scanning an event a PC takes a short lease on it, so two
PCs never scan the same event at the same time. Pressing **Scan** (or sending `scan`) always reads the
site again and counts as that event's auto-check on every PC, so the next one comes a full interval
later. Adding or editing a request reuses a scan that is still fresh instead of touching the site. If
the PC holding the lease starts failing, it drops the lease and another PC takes over.

**Alerts are per person.** An alert about your request goes to your ntfy topic and appears on the PCs
where you are signed in — once each, whichever PC ran the scan. Other people's requests never alert
you and are not listed for you; the popup only tells you an event has *someone's* open requests, so
you don't delete it by accident. The one exception is viagogo's price step: it shows who on the team has
how many tickets in the section you are listing, and at what price — never their client, buy price or payout.

**Account** (in the popup) shows your display name, this PC's name and the other PCs signed in with
their last-seen time, plus **Sign out**.

If a session expires and cannot be refreshed, that PC signs out, shows **!** on the icon and tells
whoever is sitting at it. Nothing is lost — sign in again and everything comes back.

**With every PC closed nothing is scanned.** There is no server doing it for you.

---

## How it reads each site

| Site | Source | Scan cost |
|---|---|---|
| **eBileta** | the sector list page, then each sector's seat page (`var posti = [...]`) | 1 request per sector, uses your login |
| **eBileta Kosovo** | `eu.ebileta.al` — the same software as eBileta, read the same way; prices in euro. Its event page (`listaEventiPub.do`) shows the sector list itself and names no event, so an event is known by the `idSM` in its sector links (e.g. `ebileta-ks:1215`) | 1 request per sector, uses your login |
| **eFinity** | one public JSON API with the whole venue as SVG | 1 request for every sector |
| **eFinity · Bar Table** | every `BARSKI STO` article gathered into one sector, a row per table | no extra request — the same response |
| **Posttick** | the event page's seats.io keys + three public seats.io endpoints | 2–3 requests for every sector |

Requests go out **one at a time, at least 0.8 s apart**, whatever asked for them.

**Blocks** are runs of free seats next to each other in a row, found from seat **positions**, never
seat numbers. A taken seat or an aisle (a gap wider than 1.75× the row's usual spacing) ends a block.
eBileta rows are ordered left to right; eFinity and Posttick rows along their own axis (rotated and
curved stands).

**Options** = how many separate groups fit: `floor(block ÷ tickets)` added up over every block.

| Status | Meaning |
|---|---|
| 🟢 OK | fillable |
| 🟠 LOW | fillable, but options ≤ *options warn*, or only one block fits and it has ≤ *tickets + block warn* seats |
| 🔴 SPLIT | enough free seats, but no block fits the group |
| 🔴 SHORT | fewer free seats than tickets |
| 🟣 BOUGHT | you have these tickets: shown in place of the scan's status, no scans, no alerts, no badge. Switched with **Bought** on the request (or on its viagogo listing). A sector or event shows it only when every request there is bought |
| ⚪ NOT SCANNED | no data yet, or a sector without a seat map |

---

## Events

**Read the whole stadium first.** On an event you have not tracked, the sidebar offers **Read the
whole stadium**: it reads every sector on sale, once, and puts the free seats on the map as badges,
so you can see whether a match is worth following before following it. It skips what the site calls
sold out, exactly as Scan all does. The answer stays **on this PC** for an hour and nothing reaches
the team — the shared scans belong to an event, and there is no event yet. Track it to keep the
numbers.

Every event has a permanent number `[1]`, `[2]` … used in phone commands. Nothing is added just
because you looked at a page. An event is added when you:

- press **Track this event** in the sidebar on its page, or
- paste its link into **Add a request → Track** in the popup, or
- pick it from the **"not tracked yet"** group in the event list (eBileta's own list) and confirm, or
- send `add site=ebileta eid=2160 …` from the phone (`site=ebileta-ks` for eBileta Kosovo).

An event **nobody on the team** still has open requests on can be **deleted** (⋯ → Delete event, or
the "events without requests" list in the popup, or `del event=4`); its done requests go with it.
While someone else still has one open, the popup says so instead of offering the delete.

On Posttick a request can take **several prices**: click more than one price chip (`price=65/55` by
phone). Seats at any of the picked prices may sit together; other prices break a block.

**Sector sweep per event.** A scan only reads the sectors somebody has a request in, so a stand
released near the date goes unnoticed. Every **Settings → Scanning → Sector sweep** minutes (30 by
default, eBileta only) one PC reads the untracked sectors too, and tells the whole team when one that
had no free seat has some. It never reads a sector the site calls **Soldout** — eBileta prints every
sector's availability above the map, so a stand going back on sale is read off that label for
nothing, on every scan. Matches differ, so
it is set per event too: ⋯ → *Sector sweep*, with **Sweep now** for the spot check. A match whose
whole stadium is already on sale can be switched off; one released a floor at a time can be watched
every 5 minutes.

**Auto-check per event.** Settings → Scanning → Auto-check is the default. Any event can have its
own interval — ⋯ on the event in the popup (Default, Off, every 1–60 min), or `set event=1 poll=2` by
phone — so a priority event is checked every minute while a quiet one waits 30. Each event has its
own timer.

---

## The popup

- **Toolbar badge** — the number on the icon counts only requests that need attention: orange =
  running low, red = at least one no longer fillable. No number = nothing needs attention.
- **Header** — open requests, last scan, auto-check; the **bell** mutes every alert for 30 min – 8 h;
  **Scan tracked** scans every event's open requests; the **search** box below finds requests by
  sector or listing ID across every event (Esc clears it).
- **Listings · Events** — the popup opens on **Listings**, your viagogo listings with Active, Pending,
  Deactivated and Sold chips, **Scan listings** and **Read my listings ↗**. **Events** is one click away
  (remembered per PC).
- **Events** — one group per event with requests: number, title, site, worst-status dot, last scan,
  a red line if its scans are failing. **↻** scans it, **⋯** has Scan all, Open event page and Archive.
- **Request cards** — the status colour is the stripe on the left. First row: `#n`, sector, price
  (Posttick), status, client, `Listing ↗` (opens your viagogo listing in a new tab) and a − qty +
  stepper. Second row: `485 free · 36 options` on the left and the profit `+13,812 L (x1.6)` on the
  right. Click a card to edit block warn, options warn, client, Listing ID, buy price, prices and side
  by side, see how the profit is worked out, open its sector, mark it done or delete it.
- **Listing ID** — your viagogo listing for the request. Alerts about that one request get a
  listing button on the phone and the desktop.
- **Add a request** — track an event by link, pick the event, sector (autocomplete shows free seats),
  price, tickets, warns, client, side by side.
- **viagogo last sales** — the scan that reads viagogo's latest sale per event: its interval, this
  PC's switch, the last and next request, the bot-check log, and every event with its last and next
  turn and **Get now**. See [viagogo last sales](#viagogo-last-sales).
- **Team** — every section the team is listed in, your price next to theirs, and **Tell the team**.
- **Updates** — the shared link to a new version, and which PCs have it. See
  [Updating to a new version](#updating-to-a-new-version).
- **Settings** — Appearance, On-site panels, Scanning, Money, Notifications. Each group has a **?**.
- **Phone** — ntfy topic with Test, shortcuts topic, your `get` link, and a box to try any command.
- **Account** — your display name, this PC's name, the other signed-in PCs with their last-seen
  time, and **Sign out**.
- **Backup** — export and import.

The popup also opens as a full tab (the ⚙ in the sidebar).

---

## viagogo, prices and profit

Every request with a **Listing ID** can show what it earns. Everything is in **lek**.

**Reading your listings.** Open [my.viagogo.com/listings](https://my.viagogo.com/listings/). Every
listing card is read — status, price per ticket, *You'll get*, tickets left, section and row,
and *Listing performance* — and matched to the request with that Listing ID. viagogo's recommended
price is not read.
Scroll viagogo's list to load more; each listing is read as it appears. Nothing on viagogo is ever
clicked, and viagogo is never contacted in the background: prices are as fresh as your last visit
("read on viagogo 2 min ago"). A listing is saved only when something on it changed, and each change
(price, tickets, status) is kept in its short history.

**What you pay.** The buy price per ticket comes from the ticket site:

| Site | Buy price |
|---|---|
| eBileta | the section's price ("Rates from Lekë … to …", the higher one), read by every scan and when you open the seat page |
| Posttick | the request's picked prices (the highest), else the prices still free in the section |
| eFinity | the sector's price (RSD) |

When a site shows none, type **Buy price** on the request; a typed price always wins.

On my.viagogo.com/listings every card of yours has a **Buy** box in its money column, also a listing
with no request or of an event Seat Tracker does not track: type what one ticket cost (saved when you
leave the box) and the card shows the profit and the win rate. Empty clears it.

**Lek.** viagogo prices (USD), Posttick (€) and eFinity (RSD) convert to lek at the rate of the day
they were read. The rates come once a day from [ExchangeRate-API](https://www.exchangerate-api.com)
and are stored for the whole team; **Settings → Money** shows them and lets you type a rate to fix it.
A listing in an unrecognised currency shows no profit rather than a guessed one.

**The numbers.**

| | |
|---|---|
| Profit | `(You'll get ÷ tickets − buy price) × tickets`, for the tickets still listed |
| Win rate | what you get ÷ what the tickets cost, after the profit: `(x1.6)`. Under x1 is a loss; close to x1 it keeps two decimals, so a small loss reads `(x0.98)` |
| Break-even | the viagogo price at which you neither win nor lose |

Example — listing 13988951528, E106, 6 tickets at $84.00, *You'll get* $453.60, bought at 4,000 L,
1 USD = 83.36 L: you get $75.60 = 6,302 L a ticket, so **+13,812 L (x1.6)**; break-even **$53.32**.

**On the listings page** each card gets one Seat Tracker line — `#7 E106 · OK · +13,812 L (x1.6) ·
Delete request · Team Ana Krasniqi $40.00` — and the sidebar lists your listings
with the total profit, how many are requests, and how many are priced below their break-even. A card
that is not a request yet gets **Add as request**, which fills the form (event matched by date and
teams, section, tickets, Listing ID).

The line also carries what **your teammates ask for the same sector** of the same event — their real
price, so it reads next to yours without viagogo's display maths — in red when one of them is under
you. It needs a tracked event: a section name like "E106" means nothing without knowing the stadium.

**Delete request** (on the card and in the sidebar) asks first and removes only Seat Tracker's
request — the listing itself stays exactly as it is on viagogo, where nothing is ever clicked.

**Who sees what.** Your listings, payouts and profits are yours alone — the database only lets their
owner read them. Your **sell price per section** is shared: a teammate adding or looking at a request
in the same section sees "Team lists E106 at $84 (Ergi, 6)" as a suggestion.

Prices and profits are **not** in notifications.

### Your viagogo sales

On [my.viagogo.com/sales](https://my.viagogo.com/sales) the sidebar lists every sale you have made,
read from viagogo's own list of your sales (`/sales/getSales`), never by clicking the page.
Buyer names, emails and phone numbers in that list are never saved.

- **Scan all sales** the first time; after that **Scan new sales** reads only what came in since (and
  keeps going past a sale that is still unpaid). **Rescan all** reads everything again.
- **Four tiles:** profit (with the win rate), sold (what viagogo pays, in its currency), spent, and
  **you get** = spent + profit. Sales with no buy price are left out of profit, spent and you get, and
  a line says how many.
- **Events**, newest sale first, each with tickets, sales, profit and win rate. Open one for **By
  section** or **All sales**.
- **Every sale** shows its date, section, tickets, row, sale number, buy price, what it sold for and
  its profit with its own win rate: `+2,640 L (x1.4)`. Under it: `spent 6,000 + profit +2,640 = you
  get 8,640 L`. A sale viagogo has not paid yet is marked **not paid yet** (viagogo's cards say
  "Completed" either way, so this comes from the sale's status).
- **Buy price.** It comes from the listing, else the request, else the sector's price. A section
  whose sales have none gets a box: type one price and **Save** puts it on all of them.

Sales are saved for you alone, so every PC you sign in on, and the app, sees them.

---

## The viagogo event drawer

On **any** `www.viagogo.com` event page — tracked in Seat Tracker or not — a drawer at the bottom
reads the listings and ranks every section by **viagogo's display price**. viagogo shows each seller
a different "relative" price, so the drawer never tries to work out real prices: it ranks what the
page shows, against every listing in the section, whatever the quantity.

**Before scanning**, remove viagogo's filters (quantity, price, features) and leave **no section
picked on the map** — with a section picked, the same list shows only that section, so **Scan** stays
off.

| Button | What it does |
|---|---|
| **Scan** | presses **Show more** until it is gone, then reads every listing in the list and sorts each into its own section (from the listing's section id) |
| **Stop** | ends a scan; what was loaded so far is still read |
| **Clear** | forgets this event's scanned sections |

It waits about 0.6–0.9 s between clicks and gives up after 20 minutes. The only thing it ever does on
viagogo is pressing **Show more** — no page reloads, no section changes.

**What it shows**

- **Totals** — sections with listings, listings, in how many of your sections you are the
  cheapest, your listings seen.
- **Overview graph** — every scanned section on one price axis: grey dots for other listings, blue
  for yours.
- **Table** — section, listings, cheapest, **yours shown** (what viagogo displays for your listing),
  your rank (`3rd of 14`), the **gap** to the nearest seller who is not you — green and negative when
  you are the cheapest (`−$10.00`, the room you have to go up), amber just above them, red once you
  are more than 10% above — and **real prices**: what you and each teammate actually set, from your
  own listings pages. On a tracked event it also shows eBileta's free seats in that section, and next to
  your listing the **profit from your listings page**.
- **only us** — a section with nothing in it but your team's listings, so there is room to raise.
  Teammates' rows are found by their row label or the tickets left, never by price (viagogo shows
  every viewer its own); one that cannot be pinned down is still counted, and a teammate price older
  than a week never counts.
- **Search** — the box above the table narrows it to the sections whose name matches what you type
  (`E1` leaves E101 and E106), or to the one section a listing ID is in. The overview graph follows
  the search; the totals above it always count everything scanned.
- **Click a section** — its own graph (ties stacked, yours labelled) and every listing: price, row,
  "1–6 together", "only 6 left", features, with teammates' rows named. **Tell the team** sends what
  you type to their phones — the only thing the drawer ever sends anywhere.

Your listings are the rows viagogo marks **Your listing - <id>**; each counts in its own section.

**Kept in the tab.** What was read lives in the tab's session storage. **Scan again** replaces
everything; after 30 minutes the sections turn grey. **Refreshing the page clears the scan on
screen**, but not the scans you saved (below).

**By section and By price.** The Listings tab has two layouts:

- **By section** — the table above.
- **By price** — every listing of every section in one list, cheapest first. **Tickets** keeps the
  listings that sell that many: Any, Single (exactly one), 1 to 10, or 10+. **Sector price** keeps the
  sections whose ticket-site sector costs that much: the tracked event's price list, else the site's
  price, else what you paid; on an untracked event, the linked face values. **No price** is the
  sections none of these covers. On a tracked event, it opens a panel to type their price (**Set
  price** puts it on the team's price list) or, for a section the event lost, **Save section**.

**Filters**, the same in both layouts: the search box, **Only sections with my listings**, **Only
instant download** (listings viagogo marks Instant Download, plus yours whose request is Bought), and
the sort (section, biggest gap, cheapest, most listings).

**Stands.** On a tracked eBileta event, or when the sections are named like Air Albania's, chips filter
by stand: N, E, S, V and W by the code's first letter, and **Corners** (N106, N206, N207, E101, E201,
E202, E210, E109, E211, S201, S101, S202), which belong to no other stand. Several can be on at once.
They filter By section, By price and Changes.

**Save scan and Changes.** **Save scan** keeps the scan on screen. **Only the newest 2 are kept** per
event: a third save deletes the oldest. Signed in, a save goes to Supabase too, so the app shows it
and every PC you use gets it the next time it opens the event. The **Changes** tab compares two scans,
by default the newest against the one before it (or the scan on screen against the newest saved one),
and shows:

- new listings, removed ones (sold or taken off), prices that went down or up, and listings whose
  ticket count changed, per section and in total;
- chips for each kind of change, and **Only sections that changed**.

Signed in, listings are paired by their ID. Signed out they have none, so a listing is paired with
one that looks the same (section, row, features) and marked "matched by look". A signed-in scan and a
signed-out one cannot be compared on price, because viagogo shows every viewer its own prices; the tab
warns when that is the case.

Under Changes, the saved scans are listed with **×** to delete one and **Reset saved scans** to
delete them all, on this PC and in the app. A scan deleted in the app, or on another PC, disappears
from this PC the next time its drawer opens the event. A scan saved while signed out or offline stays
on the PC and is sent up later.

**Your listings as a buyer sees them.** Signed in, **Copy for compare** copies your listings from the
scan. Open the same event signed out (an incognito window) and **Paste from clipboard**, then **Scan**:
the drawer looks for each of your listings in what a buyer sees, as Mine, Possibly mine, Hidden or Not
seen yet. A copy expires after a while; **Forget it** drops it sooner.

**Sell** opens viagogo's sell page for this event in a new tab. The **Last sales** tab shows what
viagogo's "just sold" toast showed for this event; see [viagogo last sales](#viagogo-last-sales).

**Face values from the ticket site** (eFinity and Posttick) live in their own **Face value** tab, next
to **Listings**. The listings table stays exactly as it is; face value never appears in it.

To link a ticket-site event, open the Face value tab and pick one of your tracked eFinity / Posttick
events, a stadium read made on this PC in the last hour, or paste a code copied with **Copy for
viagogo** on the ticket site (tracked or not: untracked, press **Read the whole stadium** first;
tracked, the button is in the sidebar's toolbar and works from the team's last scans). The link is kept
per viagogo event, so a refresh keeps it; **Change** links another.

The tab shows:

- a line for the whole event: how many listings are **below** face value, how many **above**;
- per section, grouped by face price (dearest first, each group folds on a click): the face value in
  its currency and in $, the listings, how many are below and above face value with the furthest of
  each, and the cheapest and median listing against it — in $ and as a multiple (`+$12.40 · x1.5`),
  red under face value, amber up to x1.3, green above. Open a section for every listing against it;
- the sector each section was matched to, with a picker to put a wrong guess right. viagogo often names
  a section more loosely than the ticket site (`210` for `210 RIGHT P` and `210 LEFT K`): such a
  section is **split** over several prices, shows their range, and counts a listing as below only under
  the cheapest of them and above only over the dearest. Posttick prices by category, so a block is one
  entry per category it holds (`B · CAT 2`, `B · CAT 3`);
- **Seats on eFinity / Posttick**: every sector that is not sold out, grouped by price, next to the
  cheapest viagogo price for it. The list and each price group fold; what is folded is remembered.

The drawer **starts closed** on every page, as a bar at the bottom with only **Scan**, **Sell** and
the arrow; its height and sorting are remembered, but whether it was open is not. It can be resized by dragging its top edge;
**Settings → On-site panels → viagogo · event page drawer** switches it off.

---

## viagogo last sales

While you list tickets, viagogo's sell pages show the event's latest sale in a toast: "Tickets for
… were just purchased!", `S205 • 3 tickets`, `$82.24`. Seat Tracker saves each one for the **whole
team** (the `vg_last_sales` table). A toast has no time and no ID, so the time shown is when it was
saved, and the same sale as the newest one already saved is skipped. The price is taken as the price
for all its tickets and shown as total and per ticket: `Price: $100 | $25/pc`. Lists are grouped by
day: "Today · 6 Nov · 7 tickets · 3 sales".

**Where it shows:** the drawer's **Last sales** tab, the sidebar on the sell pages, the popup's
**viagogo last sales** section, and in the app (an event's **Sold** tab, the map's **Sales** mode, and
"Just sold on viagogo" on Now).

**The scan.** One PC at a time (it takes a lease) asks viagogo for each event's latest sale, from the
service worker with the browser's own cookies: no window opens. Which events: those you or a teammate
have a listing in, plus the ones added by hand in the popup or the drawer (and minus the ones switched
off there). It is slow on purpose:

| | |
|---|---|
| Between two requests | 45–75 s, doubled for 24 h after a bot check |
| The same event | at most every *interval* minutes (team setting, 30 by default, 15 at least) |
| By hand | **Get last sale now** (drawer, sell sidebar) or **Get now** (popup): one event, never two requests within 10 s |
| This PC | its own switch in the popup |

**Bot checks.** If viagogo answers with its "automated activity" page, or with 403 / 429, every PC
stops asking for **6 hours** and shows it. The popup keeps a log of each check: when, how long, which
event. **Open viagogo** takes you to that event's sell page so you can pass the check yourself; Seat
Tracker never tries to solve it. A sign-in page pauses just that PC for 6 hours.

**Reload this tab** (on a sell page) reloads that tab every 5–60 minutes (± 20 %) to catch the next
toast, never while you are typing or have touched the page in the last 90 s, and never two viagogo
reloads within 90 s across all tabs. It is off until you pick an interval, per tab.

---

## Buying

**eBileta checkout.** On the confirmation page (`trans/transazione.do`) a drawer at the bottom lists
every ticket with its last name, first name, birth date and email. Pick one of your buying accounts or
type in the **All tickets** row, then **Apply to all**, or change one ticket in its own row. **+ New
account** saves another email you buy with. It only fills eBileta's boxes: nothing is sent until you
pay. **Add purchase** records the order in the buy tracker: the account, one purchase per sector at
the price paid with the fee, the order code, and the request it fills.

**The buy tracker** itself (accounts, lots, tickets left per account against the site's limit,
the price list, and the inventory: lots put on listings, tickets still to buy) lives in the app; see [the app's README](../seat-tracker-app/README.md#buying).
Accounts and purchases are yours alone. The limits and the price list are the team's.

---

## On the sites

Every site gets the same **sidebar** docked on the right: the event's requests, the add form, Scan
and Scan all, with a search box that finds both the event's requests and its **sectors** — every
sector whose code or name matches, tracked or not, with its free seats and how many tickets are
wanted there. Clicking one opens it: the seat page on eBileta, the sector card on eFinity and
Posttick. Click anywhere on its header (or **›**) to
collapse it to a tab on the edge; it remembers open/closed per site.
**Settings → Appearance → Sidebar**: *Push page* narrows the site so the map is never covered,
*Overlay* slides over it.

| Site | Page | Extra |
|---|---|---|
| viagogo | price step (Sell/PriceDetails) | reads the event, date, tickets and section from viagogo's box, matches the tracked event and sector, and lists **the team in that section**: every open request — yours and teammates' — and listings with no request, with the price each is listed at (cheapest in green, unlisted last). No match: pick the event from a list. Then the price calculator. Nothing on the page is changed. |
| every site | sidebar | a **price calculator** at the bottom: a buy price and an ask price in any two currencies give the payout, profit, win rate and break-even, with viagogo's share learned from your own listings. A buy price alone is enough to show what to ask for **×1.5, ×2, ×2.5 and ×3** of what the tickets cost |
| viagogo | my listings | a **Calculator** on each card: try another sell price and see what it would earn against the price you set |
| eBileta | sector list | a **− qty +** pill on every sector and, on the stadium map, a badge over each sector: `L2 \| 2` coloured by status for the tickets you want, `W105 \| 43` in blue for a sector that was read and has seats nobody has asked for, and a grey `E109 \| 0` for one with nothing to sell. A sector nobody has read gets none. **Clicking the number (or a badge) opens that sector's seat page.** Sectors eBileta has **removed** from the page (it drops them a few days after they sell out) stay on the tracked event, sold out, under a *Removed from the site* list with their last known price and the same pill, so tickets bought there can still be tracked. eBileta takes the sector's shape off the stadium map too; the outline is saved with the sector, so the extension draws it back (dashed) and badges it where it was — only the link to its seat page is gone. A sector lost before outlines were kept is rebuilt from your requests and listings, named and outlined from another tracked event at the same stadium. Above the free-seats strip, **price groups** (dearest first, one colour each, removed sectors included) narrow the strip and the map to one price; click it again for all. Opening a removed sector's seat page puts it back on its event if it was lost before this. |
| eBileta Kosovo | event page (`listaEventiPub.do`), seat page | the same as eBileta, switched separately in Settings |
| eBileta | seat page | the sector card at the top: free / taken / longest block and **blocks of at least N** — click a block to outline its seats |
| eFinity | seat map | badges over tracked sectors; click one for its sector card; click a block to outline the seats |
| Posttick | seat map | a badge strip under the map; click a sector to zoom the real map; click a block to spotlight it |
| viagogo | listing confirmed | reads the listing you just created (tickets, section, listing ID, event) and fills **Add a request** with it. The event is matched by date and name; the event and sector you add it to are remembered for that event's next listing, for the whole team. A listing that is already a request says so instead. |
| viagogo | event page | the drawer at the bottom: one scan of the whole listing list, every section ranked by display price with your listings, gaps and graphs. See [the viagogo event drawer](#the-viagogo-event-drawer). |
| viagogo | my listings | under the search bar, **My listings**: every listing of yours (all pages, as saved), grouped by event, one short line each — `section \| tickets \| price \| win rate \| status` (its request's status: OK, LOW, SPLIT, SHORT, not scanned, done, or *no request*), then — once that event has been scanned in the last 30 minutes — the gap to the cheapest other seller in the section: `+$15.00` above it (red), `−$5.00` the cheapest by that much (green), *alone* when nobody else sells there, *sold* when the scan saw it sold. Its own search box narrows it to a section (`e10` keeps E105 and E106), a listing number or a word of the event. Click a line to search viagogo's list for that listing number (through the address, every tab); the searched one is marked, with **Clear search**. Active and pending only until **Show all**; the box and each event fold. The search bar is found by what it is (a search field); without one the box goes above the cards. |
| viagogo | my listings | **Scan all listings** (in the sidebar, or *Scan listings* in the popup): every listing you have on viagogo, in every status (active, pending, deactivated, expired), read from viagogo's own list of your listings (`/listings/getListings`, the same way My Sales is read) — 100 a request, no page turning, nothing clicked. It is saved as one complete read and compared with what was stored: new listings, price, ticket and status changes, sold-out ones, requests whose quantity no longer matches, and stored listings that are no longer on viagogo at all (reported, never changed). "Listing performance" is not in that list, so the text a card last showed is kept. It also reads `PreDelivered` (tickets uploaded, or "Instant download pending"): the app's Inventory offers a lot for an uploaded listing no lot covers. |
| viagogo | my sales | the sales sidebar: every sale with its profit and win rate, grouped by event and section. See [Your viagogo sales](#your-viagogo-sales). |
| viagogo | sell pages | saves viagogo's "just sold" toast and shows the event's last sales, with **Get last sale now** and **Reload this tab**. See [viagogo last sales](#viagogo-last-sales). |
| eBileta | checkout | the drawer that fills the ticket holders from your buying accounts and records the purchase. See [Buying](#buying). |
| viagogo | my listings | one Seat Tracker line in every listing card (request, status, profit in lek, win rate, what teammates ask for the same sector, **Delete request**) and the sidebar list with totals; **Add as request** for cards that are not requests yet. See [viagogo, prices and profit](#viagogo-prices-and-profit). |

**Settings → On-site panels** switches the sidebar per site and page, and the badges per site, with a
master switch for everything. All on by default.

---

## Holding seats

Off until you turn it on: **Settings → On-site panels → Let Seat Tracker select seats**, per PC.

On **eFinity**, choosing a seat puts it straight in the Summary — there is no basket step — so Reserve
picks the shortest run that fits and presses those seats. The drawer lists what is chosen and gives
it all back with one press. eFinity keeps no sign of you in the page, so it never blocks on being
logged in; it says so instead, because Payment will ask.

On **eBileta**, while you are logged in, seats go into eBileta's own cart:

- **click a seat** on the seat map, or **Hold N** on a block in the sector card;
- **Reserve N** on a request — from the sector list it opens that sector's seat page first — which
  takes the *shortest* run of free seats that still fits, so a run of six is not spent on a pair.

What keeps it in bounds:

| | |
|---|---|
| One file | every synthetic event in the extension is dispatched from `content/act.js`; a test fails if any other site script grows one, and it catches a constructor built through a variable too |
| A real press | a write needs the click happening now, or a ticket that click left behind — readable once, by that tab, for a minute. Nothing in the background can start one |
| A ceiling | never more seats than the request asks for, and never more than 12 a minute |
| Written down | every click goes in a log on this PC: Settings → On-site panels → *What this PC clicked* |
| Scans stand aside | held seats read as taken, so while this PC holds an eBileta cart it refuses to scan that site's events and drops its lease for another PC to take |

The cart strip above eBileta's own cart shows what is held, warns when eBileta says the seats are not
together, and has **Give them back**, which presses eBileta's own Delete on each one.

**Seat Tracker never buys anything.** It presses seats and nothing else — never Payment, never
checkout, never a terms box. Finishing is yours.

---

## Notifications

Desktop and phone (ntfy) for: **Tickets available now**, **Running low**, **Back to OK**, **No longer fillable**,
**Scan failing**, **Scan working again**, **New event**, and an optional **Summary** — each with its
own desktop and phone switch, plus quiet hours, mute, cooldown, confirmation of "No longer fillable"
and action buttons. **[NOTIFICATIONS.md](NOTIFICATIONS.md)** explains every case.

Alerts are **per person**: about your own requests, to your own ntfy topic, on the PCs where you are
signed in — once each, no matter which PC ran the scan.

**Every PC starts silent.** Signing in on a machine does not make it start showing notifications,
which matters most on a shared or always-on one. Settings → Notifications → **On this PC**:

| | |
|---|---|
| **Silent** (the default) | nothing about requests appears on that PC. Your phone still gets everything, and so does any other PC you have switched on |
| **Follow mine** | that PC shows whatever your account's Desktop column says — how it behaved before |
| **Its own** | that PC has its own per-kind switches and its own quiet hours, whatever your account says, so it can show a kind your account has off, or stay quiet at night while another PC does not |

Phone pushes are untouched by any of it — a phone is not a PC, and the push goes out once from
whichever PC found the change. Trouble with a PC itself (signed out, alerts not sending) still shows
on that PC either way, because nothing else would tell whoever is sitting at it. *Scan failing* reaches everyone with an open
request in that event; *New event* reaches the whole team.

Phone setup: install the **ntfy** app, subscribe to a long, hard-to-guess topic, paste it into
**Phone → ntfy topic**, press **Test**.

---

## Things worth knowing

- **Chrome has to be running and the computer awake** — on at least one PC of the team. The others
  reuse that PC's scans. With all of them closed, nothing is scanned and nothing answers.
- **Connection problems.** If syncing keeps failing, an orange box says whether this PC is offline or
  online but blocked from Supabase (VPN, firewall, network filter, blocker extension, or a Supabase
  outage), since when, and the browser's own reason. It retries every 30 s, clears itself after the
  next good sync, and has **Retry now**. A single failure right after waking from sleep is not shown,
  and a Supabase outage never signs anyone out.
- **eBileta scans use your browser session.** If you are logged out, you get *Scan failing* once and the
  last good scan is kept. Don't scan while you're mid-checkout on eBileta in the same browser.
- **Posttick prices** come from a checked price table for Max Amini and from each event page for
  other shows.
- **eFinity standing areas** (PARTER, FAN PIT) publish no seat data; they stay NOT SCANNED.
- **eFinity bar tables.** Each `BARSKI STO` is its own article, so asking for "a table" would mean
  picking one of a dozen sectors and hoping. The **Bar Table** sector stands for all of them, one row
  per table, and answers the question you actually have: how many tables can take your group.
  A table counts only when **every** seat is free: eFinity will not sell fewer than four of the six,
  so the one or two left at a part-sold table cannot be bought by anyone and are not free to you.
  `6 free · 3 options` means three whole tables. Search it as `bar table`, `tables` or `sto`; a
  numbered `bs12` still means that one table.
- Storage writes all go through the service worker, so the popup, the sidebars, phone commands and
  auto-checks can never overwrite each other. Between PCs the shared database decides: the first PC
  to record a change wins, which is what keeps the same alert from being sent twice.

---

## Adding another site

A site is one adapter file in `sites/` plus one small content script. The adapter only fetches and
returns plain seats `{ row, label, x, y, free, cat, id }`; blocks, options, statuses, alerts, commands,
the popup and the sidebar all work unchanged. The contract is documented at the top of
`core/registry.js`. Register the file in `background.js` (`importScripts`) and `manifest.json`.

---

## Tests

| Command | What it checks |
|---|---|
| `node --test tests/*.test.js` | also: sales, last sales and their scan, face values, the update link, removed eBileta sectors, saved-scan rows · viagogo market: your pinned listings kept out of other sections, ranks with ties, verdicts, sold listings, sections without a map id, event page addresses · seat rules: the status table from the original spec (both row-ordering modes), aisles, backwards seat numbers, rotated rows, price filters · viagogo: dates as each site writes them, matching a listing to its event and sector, remembered pairings · money: prices as the sites write them, eBileta's price block, rates per day, buy price per site, the profit example above · eBileta Kosovo: its own site next to eBileta, its sector list (from real markup), seat pages with euro prices |
| `node tests/db/schema.test.mjs` | `supabase/schema.sql` on a real Postgres: runs twice without losing data, members only, numbering, leases, "alert once", commands handled once, listings, sales, accounts, purchases and saved scans private to their owner, saved scans kept to the newest 2, team prices without payouts, cascades |
| `node tests/browser/ebileta-ks.mjs` | eBileta Kosovo's event page built from its real markup: the sidebar on `listaEventiPub.do`, Track this event as idSM 1215 with its 14 sectors, pills and map badges (`L2|2`), the sidebar's sector search, a sector opening on `eu.ebileta.al` |
| `node tests/browser/viagogo-event.mjs` | the event drawer on a stand-in event page built from real viagogo markup: Scan off while a section is picked, one scan pressing "Show more" to the end with no reloads, every listing sorted into its section, ranks, gaps, verdicts, eBileta seats, profit, graphs, the table's search box, By price and its filters, stands, Save scan (the newest 2, here and in the app), Changes, deleting and Reset, a scan deleted in the app dropped here, the Last sales tab, Stop, and a refresh clearing the scan on screen |
| `node --test tests/preview.test.js` | reading a stadium before tracking it: it goes through the same adapter, refuses on an event that is already tracked, skips the sold-out sectors, writes nothing at all to Supabase, and the map's three badges say wanted / free-but-unasked / nothing, with silence for a sector nobody has read |
| `node --test tests/pcnotify.test.js` | desktop alerts per PC: a fresh PC is silent for every kind and says why, "follow mine" reproduces the old behaviour exactly, "its own" overrides the account in both directions, per-PC quiet hours still let "tickets available now" through, and both places a notification can appear ask the same question |
| `node --test tests/act.test.js` | the write boundary: only the two named files may act on a ticket site (a third one appearing fails the test), holding seats is off by default and per PC, and the acting file has no fetch, no submit and no way to run without a real click |
| `node tests/browser/popup.mjs` | the popup opened in Chrome against a stand-in service worker: it loads without throwing (a name used before it is declared, or a `core/*.js` missing from its script tags, only shows when someone opens it), every listing is drawn in its own group, the Active / Pending / Deactivated / Sold chips count and filter, the search box narrows and says which reason it found nothing, **Revalidate all** asks for a sweep, and Events still works |
| `node tests/browser/viagogo-sales.mjs` | the sales page in Chrome against a stand-in of `/sales/getSales`: the full scan, no buyer data leaving the page, sales grouped by event and section, the profit and what you get, a buy price typed on a section, and Scan new sales stopping at what is already saved |
| `node tests/browser/viagogo-lastsale.mjs` | a sell page in Chrome: the "just sold" toast read and saved, the price split per ticket, the same toast again skipped and a different one saved, Reload this tab staying on across reloads, and viagogo's bot page switching it off |
| `node tests/browser/ebileta-checkout.mjs` | eBileta's confirmation page in Chrome (captured, personal data replaced): every ticket's names filled from an account, one ticket edited, the order added as a purchase, a new buying account saved |
| `node tests/browser/viagogo-listings.mjs` | the listings page in Chrome with a real viagogo card: every field read, the line added to each card with the team's price and **Delete request** (which asks first and touches nothing on viagogo), the sidebar totals, **Add as request**, and a tab left open while the extension reloads shutting down without errors |

The database test needs PGlite once, outside the extension folder (Chrome refuses unpacked
extensions with some `node_modules` file names): `npm install --prefix ~/.cache/seat-tracker-tests @electric-sql/pglite`.
The browser test uses Chrome for Testing from Playwright's cache, or `CHROME=/path/to/chrome`.

---

## Files

```
manifest.json
background.js              service worker entry: messages, alarms, toolbar badge, UI state
core/
  config.js                the Supabase project URL, the publishable key, the version
  util.js                  helpers
  rules.js                 packing scans, blocks, options, status, the one-line format
  registry.js              the site adapter contract and sector lookup
  settings.js              defaults, validation, notification types, team/user/PC scope
  help.js                  the text behind every "?"
  viagogo.js               reading viagogo listings, matching them to an event and sector
  profit.js                money: prices as sites write them, rates, buy price, profit, win rate
  market.js                a scanned viagogo event: sections, ranks, gaps, verdicts, graph axes,
                           saved scans and what changed between two
  team.js                  what the team lists per section, and who else is in it
  sales.js                 viagogo sales: reading getSales, buy price, profit per sale and in total
  lastsales.js             viagogo's "just sold" toast: reading it, same-sale rule, price text, the scan plan
  face.js                  face values handed from a ticket site to the viagogo drawer
  update.js                the shared update link and version compare
sites/
  ebileta.js  efinity.js  posttick.js   (ebileta.js registers eBileta and eBileta Kosovo)
bg/
  net.js                   the polite request queue
  supabase.js              sign in / out, tokens, the REST calls
  remote.js                pull and push the shared data, leases, the alert fan-out
  store.js                 this PC's copy of the shared data, with serialized writes
  events.js                events, requests, scanning, health, new-event check
  alerts.js                what changed → which alert
  notify.js                desktop + ntfy delivery, quiet hours, mute, buttons
  commands.js              phone commands
  importer.js              export / import (new + the 3 old formats)
  fx.js                    the daily exchange rates to lek
  lastsalescan.js          the last-sales scan: one request at a time, leases, bot-check pauses
ui/
  app.css                  the shared look (light + dark)
  components.js            request cards, add form, sector card, help drawer
  lastsalewatch.js         one event's place in the last-sales scan (drawer tab, sell sidebar)
popup/                     popup.html / .css / .js
content/
  shell.js  sidebar.css    the sidebar for every site
  drawer.css               the viagogo event drawer
  page.css                 badges, outlines, push mode
  act.js                   the one file that presses anything on a ticket site (holding seats)
  checkout.css             the eBileta checkout drawer
  sites/                   ebileta-sectors.js, ebileta-seats.js, ebileta-events.js, ebileta-act.js,
                           ebileta-checkout.js, efinity.js, efinity-act.js, posttick.js, posttick-page.js,
                           viagogo.js (listings, sales, sell sidebar), viagogo-event.js (the drawer),
                           viagogo-lastsale.js (the sell pages' toast)
help/                      the full guide page
icons/
supabase/
  schema.sql               the shared database: tables, access rules, leases, numbering, listings,
                           sales, last sales, accounts, purchases, the price list, saved scans
tests/
  *.test.js                unit tests (node --test)
  db/schema.test.mjs       the database rules on a real Postgres
  browser/viagogo-listings.mjs   the listings page in Chrome
  browser/viagogo-event.mjs      the event drawer in Chrome (fixtures/: real viagogo row markup)
  browser/viagogo-sales.mjs      the sales page in Chrome
  browser/viagogo-lastsale.mjs   the sell pages in Chrome
  browser/ebileta-checkout.mjs   eBileta's checkout drawer in Chrome
  browser/popup.mjs              the popup in Chrome
  browser/ebileta-ks.mjs         eBileta Kosovo's event page in Chrome
```
