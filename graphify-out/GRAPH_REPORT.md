# Graph Report - seat-tracker-extension  (2026-11-27)

## Corpus Check
- 86 files · ~229,661 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: .css 6, (none) 1)

## Summary
- 1373 nodes · 2334 edges · 84 communities (72 shown, 12 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 112 edges (avg confidence: 0.8)
- Token cost: 262,145 input · 0 output

## Graph Freshness
- Built from commit: `058e621d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Viagogo Event Page UI
- Viagogo Site Adapter
- Notify & UI Components
- eBileta Sector Map
- Background Service Worker
- Viagogo Core Parsing
- Market Price Comparison
- Popup UI
- Extension Manifest
- Last Sales Analysis
- Core Utilities
- HTML Pages & Fixtures
- Seat Rules Engine
- eBileta Site Adapter
- New Event Detection
- eFinity Content Script
- Profit & Break-even
- Posttick Site Adapter
- Viagogo Event Browser Test
- Event Scanning
- Viagogo Last-Sale Capture
- On-site Sidebar Shell
- eBileta Checkout Drawer
- Viagogo Sales Browser Test
- Viagogo Sales Parsing
- DB Schema Tests
- eFinity Site Adapter
- Settings Normalization
- eBileta Kosovo Browser Test
- Local Store & Cache
- Last-Sale Browser Test
- Remote Sync Cleanup
- eBileta Checkout Browser Test
- Team Pricing
- Listings Tests
- Phone Commands & Buttons
- Alert Delivery Controls
- Viagogo Listings Browser Test
- eFinity Bar Tests
- Removed Sectors Tests
- Team Prices & Drawer Docs
- Event Registration
- Alert Line Formatting
- eBileta Seat Holding
- Face Value Matching
- Last-Sale Scan Tests
- Version Update Check
- Product Overview Docs
- Team Sharing & Infra Docs
- Popup Browser Test
- Listings API Tests
- PC Notify Tests
- Sector Sweep Tests
- Request & Purchase Edits
- Notification Channels
- Ticket Sites & Write Boundary
- Profit & Viagogo Docs
- Act Boundary Tests
- Face Value Tests
- Service Worker Tests
- Ticket Action Primitives
- eFinity Seat Actions
- Adapter & Status Concepts
- Preview Tests
- Shortcut Command Transport
- Warning Thresholds
- eBileta Event Badges
- Shared DB & Privacy
- New Event & Sweep Alerts
- eBileta Cart Actions
- Extension Icons
- Phone Push & Commands Docs
- Request Numbering & Status
- Last-Sale Watch UI
- Alerts Module
- Commands Module
- FX Rates Module
- Backup Importer
- Network Module
- Supabase Client
- Release Script

## God Nodes (most connected - your core abstractions)
1. `render()` - 53 edges
2. `el()` - 29 edges
3. `create()` - 17 edges
4. `render()` - 16 edges
5. `button()` - 16 edges
6. `requestCard()` - 16 edges
7. `note()` - 15 edges
8. `eventKey()` - 15 edges
9. `doScanEvent()` - 14 edges
10. `get()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `LastSaleScan` --indirect_call--> `tick()`  [INFERRED]
  bg/lastsalescan.js → background.js
- `shutdown()` --indirect_call--> `tick()`  [INFERRED]
  content/sites/viagogo-lastsale.js → background.js
- `Remote` --indirect_call--> `deleteEvent()`  [INFERRED]
  bg/remote.js → popup/popup.js
- `render()` --indirect_call--> `state()`  [INFERRED]
  content/sites/ebileta-checkout.js → tests/team.test.js
- `bestBlock()` --indirect_call--> `eventKey()`  [INFERRED]
  content/sites/efinity.js → core/registry.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Request status-change alert types** — notifications_tickets_available_now, notifications_running_low, notifications_back_to_ok, notifications_no_longer_fillable, notifications_request_status [EXTRACTED 1.00]
- **Delivery suppression controls in the alert pipeline** — notifications_cooldown, notifications_mute, notifications_quiet_hours, notifications_confirm_two_scans, notifications_send_once_dedup [EXTRACTED 1.00]
- **Popup collapsible sections (add, last sales, team, updates, settings, phone, backup)** — popup_popup_addbox, popup_popup_lastsalesbox, popup_popup_teambox, popup_popup_updatebox, popup_popup_settingsbox, popup_popup_phonebox, popup_popup_backupbox [EXTRACTED 1.00]
- **Ticket sites read through the site adapter contract** — readme_ebileta, readme_ebileta_kosovo, readme_efinity, readme_posttick, readme_site_adapter_contract [EXTRACTED 1.00]
- **Read-only by default safety guarantees** — readme_holding_seats, readme_act_js_write_boundary, readme_viagogo_listings_reading, readme_viagogo_last_sales, readme_polite_request_queue [INFERRED 0.75]
- **Phone command round-trip via ntfy** — commands_shortcuts_topic, commands_command_polling, commands_ntfy_topic, shortcuts_send_block, notifications_command_answers [INFERRED 0.85]
- **Team-pricing backlog ideas** — todo_team_prices_untracked_events, todo_undercut_alert, todo_display_real_price_calibration, todo_team_view_per_event [INFERRED 0.85]
- **Captured ticket-site DOM fixtures for scraper tests** — tests_browser_fixtures_ebileta_checkout_fixture, tests_browser_fixtures_viagogo_event_row_listing_card, tests_fixtures_ebileta_ks_sectors_fixture [INFERRED 0.85]
- **Extension icon size set (16/32/48/128)** — icons_16_icon, icons_32_icon, icons_48_icon, icons_128_icon [INFERRED 0.95]

## Communities (84 total, 12 thin omitted)

### Community 0 - "Viagogo Event Page UI"
Cohesion: 0.05
Nodes (105): bar(), bodySig(), boot(), changeItem(), changesTable(), changesView(), clearEvent(), compareHere() (+97 more)

### Community 1 - "Viagogo Site Adapter"
Cohesion: 0.07
Nodes (60): buyBox(), buyEdit(), checkedText(), compareGrid(), comparesBox(), deleteRequestFor(), diffsFor(), eventBody() (+52 more)

### Community 2 - "Notify & UI Components"
Cohesion: 0.09
Nodes (48): Notify, reply(), addForm(), bulkBar(), busy(), button(), buyField(), buyRow() (+40 more)

### Community 3 - "eBileta Sector Map"
Cohesion: 0.09
Nodes (44): badgesOn(), bump(), freeRowHost(), ghostPolygons(), goneSections(), hideTip(), infoFor(), inPrice() (+36 more)

### Community 4 - "Background Service Worker"
Cohesion: 0.07
Nodes (35): ALARM, autoCheckEvent(), boot(), buildState(), buyOf(), deepMerge(), doTick(), ensureAlarm() (+27 more)

### Community 5 - "Viagogo Core Parsing"
Cohesion: 0.07
Nodes (31): blocksOf(), cardOf(), fold(), listFooter(), listingCardOf(), listingDiffs(), listingKey(), listingStatus() (+23 more)

### Community 6 - "Market Price Comparison"
Cohesion: 0.06
Nodes (27): byPrice(), compareMine(), compareStanding(), diffScans(), emptyStore(), fingerprintOf(), fitsQty(), matchSignedOut() (+19 more)

### Community 7 - "Popup UI"
Cohesion: 0.11
Nodes (35): dateTile(), dayOf(), deleteEvent(), eventBlock(), field(), fromToday(), group(), infoOf() (+27 more)

### Community 8 - "Extension Manifest"
Cohesion: 0.08
Nodes (24): action, default_icon, default_popup, default_title, background, service_worker, content_scripts, 128 (+16 more)

### Community 9 - "Last Sales Analysis"
Cohesion: 0.07
Nodes (15): blocksOf(), isPastWhen(), nextTarget(), parseToast(), priceSplit(), priceText(), readToast(), scanPlan() (+7 more)

### Community 10 - "Core Utilities"
Cohesion: 0.08
Nodes (17): byteLength(), cut(), dayStamp(), eventInfo(), fmtAt(), fmtClock(), inDailyWindow(), listingId() (+9 more)

### Community 11 - "HTML Pages & Fixtures"
Cohesion: 0.07
Nodes (32): Air Albania Stadium, COMMANDS.md, Fadil Vokrri Stadium, Guide Content Container (#content), Seat Tracker Guide Page (help.html), Guide Table of Contents (#toc), NOTIFICATIONS.md, Add a Request Section (#addBox) (+24 more)

### Community 12 - "Seat Rules Engine"
Cohesion: 0.11
Nodes (21): badgeOf(), blocksFor(), cmpRow(), detail(), evaluate(), median(), nagAfter(), optionsFor() (+13 more)

### Community 13 - "eBileta Site Adapter"
Cohesion: 0.14
Nodes (22): aliasSector(), eventFromUrl(), eventPageUrl(), eventUrl(), idSMOf(), listEvents(), loadEvent(), parseEventList() (+14 more)

### Community 14 - "New Event Detection"
Cohesion: 0.09
Nodes (11): CRITERIA, keepViagogoSector(), LISTING_KEYS, loadedAt, loadingEvents, REQUEST_FIELDS, SALE_KEYS, scanChains (+3 more)

### Community 15 - "eFinity Content Script"
Cohesion: 0.23
Nodes (22): actState(), bestBlock(), chosenBox(), convert(), copyForViagogo(), currencyPicker(), drawOutline(), hold() (+14 more)

### Community 16 - "Profit & Break-even"
Cohesion: 0.06
Nodes (25): breakEvenAsk(), currencyOf(), formatLek(), formatMoney(), lekAt(), parseMoney(), parseNumber(), pickRates() (+17 more)

### Community 17 - "Posttick Site Adapter"
Cohesion: 0.18
Nodes (16): aliasSector(), buildCategories(), buildLayout(), catSlug(), decodeSeatsio(), eventUrl(), fetchSeatsio(), formatOf() (+8 more)

### Community 18 - "Viagogo Event Browser Test"
Cohesion: 0.12
Nodes (12): EXT, FILES, findChrome(), HERE, launch(), openDrawer(), openTab(), ROW (+4 more)

### Community 19 - "Event Scanning"
Cohesion: 0.14
Nodes (20): autoMinutesOf(), byEventNumber(), cartHoldFor(), checkOpenSectors(), doScanEvent(), eventTag(), forgetEvent(), isGoneSector() (+12 more)

### Community 20 - "Viagogo Last-Sale Capture"
Cohesion: 0.26
Nodes (16): blocked(), boot(), busy(), capture(), checkOnOpen(), due(), eventHere(), eventOfSession() (+8 more)

### Community 21 - "On-site Sidebar Shell"
Cohesion: 0.23
Nodes (17): applyPageTheme(), create(), copyFace(), doScan(), flipSide(), loadOpen(), mount(), orphaned() (+9 more)

### Community 22 - "eBileta Checkout Drawer"
Cohesion: 0.26
Nodes (18): accountForm(), boot(), eventFor(), groupsOf(), limitOf(), mount(), participants(), purchase() (+10 more)

### Community 23 - "Viagogo Sales Browser Test"
Cohesion: 0.14
Nodes (11): CARD2, EXT, FILES, findChrome(), launch(), openTab(), SALES, salesApi() (+3 more)

### Community 25 - "DB Schema Tests"
Cohesion: 0.09
Nodes (20): addReq(), as(), cas(), db, dlink(), EXT, fails(), fz (+12 more)

### Community 26 - "eFinity Site Adapter"
Cohesion: 0.21
Nodes (12): attr(), barSeats(), barTables(), eventFromUrl(), extraFromUrl(), humanize(), loadEvent(), num() (+4 more)

### Community 27 - "Settings Normalization"
Cohesion: 0.21
Nodes (13): badgesOn(), buyLimitsOf(), fxOverrideOf(), helperPages(), hm(), lastSaleEventsOf(), normalize(), num() (+5 more)

### Community 28 - "eBileta Kosovo Browser Test"
Cohesion: 0.16
Nodes (13): CSS, entry, EVENTS, EXT, findChrome(), HERE, launch(), manifest (+5 more)

### Community 29 - "Local Store & Cache"
Cohesion: 0.25
Nodes (14): cacheGet(), cacheKey(), cacheSet(), EMPTY_MIRROR, emptyMirror(), ensureDevice(), LOCAL_DEFAULTS, model() (+6 more)

### Community 30 - "Last-Sale Browser Test"
Cohesion: 0.18
Nodes (11): EXT, FILES, findChrome(), launch(), LOADS, openTab(), sellPage(), SHOTS (+3 more)

### Community 31 - "Remote Sync Cleanup"
Cohesion: 0.19
Nodes (13): cleanListing(), cleanSale(), deleteRequests(), keepCardOnly(), keepKnownPrice(), keepUploaded(), matchListing(), saveLastSale() (+5 more)

### Community 32 - "eBileta Checkout Browser Test"
Cohesion: 0.19
Nodes (11): entry, EXT, findChrome(), HERE, launch(), manifest, openTab(), PAGE (+3 more)

### Community 33 - "Team Pricing"
Cohesion: 0.19
Nodes (7): conflicts(), score(), whoIsHere(), assert, now, SK, test

### Community 34 - "Listings Tests"
Cohesion: 0.15
Nodes (8): assert, event, fs, path, ROOT, test, vm, W

### Community 35 - "Phone Commands & Buttons"
Cohesion: 0.24
Nodes (11): add command, done / undo / del commands, Posttick (ticket site), prices command (Posttick), scan command, Notification Buttons (Open map, Scan again, Mark done, Stop, Listing), Viagogo Listing ID, Extras Loop (Choose from List + Repeat with Each) (+3 more)

### Community 36 - "Alert Delivery Controls"
Cohesion: 0.22
Nodes (9): mute / unmute commands, Per-event Auto-check (set event=n poll=), set / settings commands, Back to OK, Cooldown, Mute, Quiet Hours (with let-through for Tickets available now), Summary Notification (every / daily) (+1 more)

### Community 37 - "Viagogo Listings Browser Test"
Cohesion: 0.23
Nodes (9): CARD2, EXT, FILES, findChrome(), launch(), openTab(), SHOTS, sleep() (+1 more)

### Community 38 - "eFinity Bar Tests"
Cohesion: 0.23
Nodes (11): assert, fresh(), load(), options(), path, ROOT, scan(), site (+3 more)

### Community 39 - "Removed Sectors Tests"
Cohesion: 0.17
Nodes (7): assert, fs, path, ROOT, test, vm, W

### Community 40 - "Team Prices & Drawer Docs"
Cohesion: 0.25
Nodes (11): Face value tab (eFinity / Posttick vs viagogo), Read the whole stadium (preview before tracking), Save scan and Changes (newest 2 kept), Team sell prices per section, viagogo event drawer, Team prices on untracked viagogo events, team_prices view (vg_event_id), Team view per event (+3 more)

### Community 41 - "Event Registration"
Cohesion: 0.24
Nodes (10): adapterCtx(), adoptGuessed(), ensureEvent(), lostSectors(), mergeSectors(), previewScan(), registerEvent(), registerFromUrl() (+2 more)

### Community 42 - "Alert Line Formatting"
Cohesion: 0.24
Nodes (10): alertLine(), codeOf(), currencyOf(), evalOf(), faceCurrency(), faceFor(), lineFor(), priceTagOf() (+2 more)

### Community 43 - "eBileta Seat Holding"
Cohesion: 0.42
Nodes (8): bestBlock(), cartStrip(), clearHighlight(), highlight(), hold(), holdBox(), renderSlot(), reserve()

### Community 45 - "Last-Sale Scan Tests"
Cohesion: 0.22
Nodes (8): assert, fs, path, ROOT, SALE, test, vm, world()

### Community 46 - "Version Update Check"
Cohesion: 0.25
Nodes (5): compare(), pending(), assert, SK, test

### Community 47 - "Product Overview Docs"
Cohesion: 0.22
Nodes (8): Buy tracker (in the app), eBileta checkout drawer (buying accounts), Import JSON from three old trackers, Posttick (seats.io), Seat Tracker Chrome Extension (MV3), Seat Tracker phone app, SHORTCUTS.md, Seat Tracker backlog (TODO)

### Community 48 - "Team Sharing & Infra Docs"
Cohesion: 0.25
Nodes (7): Device management (remove old PCs), Popup (Listings, Events, Settings, Phone, Account, Backup), Supabase shared database (schema.sql), Test suite (unit, PGlite schema, Chrome browser tests), Updates: shared version link to every PC, viagogo last sales (vg_last_sales, just-sold toast), Message inbox in the popup

### Community 49 - "Popup Browser Test"
Cohesion: 0.33
Nodes (7): EXT, findChrome(), launch(), openTab(), SHOTS, sleep(), until()

### Community 50 - "Listings API Tests"
Cohesion: 0.22
Nodes (8): assert, fs, ITEM, path, ROOT, SK, test, vm

### Community 51 - "PC Notify Tests"
Cohesion: 0.22
Nodes (6): assert, fs, path, ROOT, SK, test

### Community 52 - "Sector Sweep Tests"
Cohesion: 0.22
Nodes (7): assert, fs, path, ROOT, test, vm, W

### Community 53 - "Request & Purchase Edits"
Cohesion: 0.29
Nodes (8): addRequest(), bumpSector(), deleteRequest(), normalizeCats(), savePurchases(), setArchived(), setListingTrack(), updateRequest()

### Community 54 - "Notification Channels"
Cohesion: 0.25
Nodes (8): eFinity (ticket site), ntfy Topic (answer/push channel), Phone Commands (COMMANDS.md), Command Answers, Desktop Notification Channel (Chrome), Notifications (NOTIFICATIONS.md), Phone Notification Channel (ntfy), iPhone Shortcut (SHORTCUTS.md)

### Community 55 - "Ticket Sites & Write Boundary"
Cohesion: 0.25
Nodes (5): eBileta (Albania and Kosovo), eBileta Kosovo (eu.ebileta.al, idSM), eFinity, Removed eBileta sectors (outline kept), Sector sweep (untracked sectors, eBileta)

### Community 56 - "Profit & Viagogo Docs"
Cohesion: 0.25
Nodes (7): Daily exchange rates to lek (ExchangeRate-API), On-site sidebar and badges, Price calculator (sidebar), Profit, win rate and break-even (in lek), viagogo resale marketplace, Reading viagogo listings (my.viagogo.com/listings), Your viagogo sales (/sales/getSales)

### Community 57 - "Act Boundary Tests"
Cohesion: 0.25
Nodes (6): ALLOWED, assert, fs, path, ROOT, test

### Community 58 - "Face Value Tests"
Cohesion: 0.25
Nodes (6): assert, path, preview, ROOT, SK, test

### Community 59 - "Service Worker Tests"
Cohesion: 0.25
Nodes (5): assert, fs, path, ROOT, test

### Community 60 - "Ticket Action Primitives"
Cohesion: 0.43
Nodes (4): budgetLeft(), note(), press(), pressAndCheck()

### Community 61 - "eFinity Seat Actions"
Cohesion: 0.43
Nodes (4): chosenSeats(), clearChosen(), sectorNameOf(), selectSeat()

### Community 62 - "Adapter & Status Concepts"
Cohesion: 0.29
Nodes (3): Notifications (desktop + ntfy), NOTIFICATIONS.md, Request status (OK / LOW / SPLIT / SHORT / BOUGHT / NOT SCANNED)

### Community 63 - "Preview Tests"
Cohesion: 0.29
Nodes (6): assert, fs, path, ROOT, src, test

### Community 64 - "Shortcut Command Transport"
Cohesion: 0.47
Nodes (5): Command Link Format (ntfy publish URL, key=value args), Shortcuts Topic (ntfy command channel), One-tap Shortcuts (Home Screen, widget, Siri, Back Tap), Send Block (URL Encode + Get Contents of URL), Shortcut Troubleshooting

### Community 65 - "Warning Thresholds"
Cohesion: 0.25
Nodes (5): edit command, No Longer Fillable, Options Warn / Block Warn thresholds, Running Low, Scan Failing / Scan Working Again

### Community 66 - "eBileta Event Badges"
Cohesion: 0.60
Nodes (4): infoFor(), renderBadges(), renderSlot(), track()

### Community 67 - "Shared DB & Privacy"
Cohesion: 0.33
Nodes (3): Shared Database (Supabase), supabase/schema.sql members list, Messages Between Teammates (Tell the team)

### Community 68 - "New Event & Sweep Alerts"
Cohesion: 0.40
Nodes (4): eBileta (ticket site), events command, New Event on a Site, A Sector With No Seats Now Has Some

### Community 69 - "eBileta Cart Actions"
Cohesion: 0.60
Nodes (3): emptyCart(), readCart(), selectSeat()

### Community 70 - "Extension Icons"
Cohesion: 0.40
Nodes (5): Seat Tracker Icon 128px, Ticket/Seat Icon Design (blue ticket on dark rounded square with green status dot), Seat Tracker Icon 16px, Seat Tracker Icon 32px, Seat Tracker Icon 48px

### Community 71 - "Phone Push & Commands Docs"
Cohesion: 0.40
Nodes (5): Auto-check interval per event, COMMANDS.md, ntfy phone push, Phone commands (add, scan, set, del), Reply from the phone (ntfy buttons to cmdTopic)

### Community 72 - "Request Numbering & Status"
Cohesion: 0.50
Nodes (4): Event [n] and Request #n Numbers (never reused), get command, Request Line Format, Request Status (OK / LOW / SPLIT / SHORT / NOT SCANNED)

### Community 73 - "Last-Sale Watch UI"
Cohesion: 0.83
Nodes (3): answerText(), blockText(), lastSaleWatchUI()

## Ambiguous Edges - Review These
- `Change-only Alerting (fresh baseline, what never notifies)` → `Repeat Warnings Until Stop (15 min)`  [AMBIGUOUS]
  NOTIFICATIONS.md · relation: conceptually_related_to

## Knowledge Gaps
- **53 isolated node(s):** `eBileta Participant Data Fields (anagrafica)`, `eBileta Cart Row data-item JSON (staId, eveId, codice, dataInizio)`, `eBileta Online Payment Deadline Notice`, `Guide Content Container (#content)`, `Guide Table of Contents (#toc)` (+48 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 482 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `state()` connect `Viagogo Event Page UI` to `Team Pricing`, `eBileta Checkout Drawer`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `eBileta Participant Data Fields (anagrafica)`, `eBileta Cart Row data-item JSON (staId, eveId, codice, dataInizio)`, `eBileta Online Payment Deadline Notice` to the rest of the system?**
  _53 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Viagogo Event Page UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05486327448944271 - nodes in this community are weakly interconnected._
- **Why does `eventKey()` connect `eBileta Sector Map` to `On-site Sidebar Shell`, `eFinity Content Script`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Should `Viagogo Site Adapter` be split into smaller, more focused modules?**
  _Cohesion score 0.07219662058371736 - nodes in this community are weakly interconnected._
- **Why does `Remote` connect `Remote Sync Cleanup` to `Request & Purchase Edits`, `Popup UI`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Change-only Alerting (fresh baseline, what never notifies)` and `Repeat Warnings Until Stop (15 min)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._