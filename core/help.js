/* ------------------------------------------------------------------
 * Seat Tracker - help text behind every "?" button
 *
 * One source for the popup's help drawer, the sidebar and help/help.html,
 * so the settings screen can stay short and the explanations live here.
 * Exposed as SK.help.
 * ------------------------------------------------------------------ */
(function (root) {
  'use strict';
  const SK = root.SK = root.SK || {};

  const sections = {
    account: {
      title: 'Account and team',
      intro: 'Seat Tracker is shared by your team through one Supabase project. Events, sector lists and scans are shared; requests, numbers, notifications and topics belong to each person.',
      items: [
        { name: 'Signing in', text: 'Each person signs in on every PC they use, with the email and password the owner created. A PC that is not signed in shows nothing and scans nothing.' },
        { name: 'Your name', text: 'Shown to your team on scans and devices, e.g. "scanned 2 min ago by Ergi laptop".' },
        { name: 'This PC', text: 'Give each PC a name so you can tell from the popup which one is scanning.' },
        { name: 'Devices', text: 'Every PC signed in to the team, with a green dot while it is online (seen in the last 2 minutes). Any online PC scans for everyone and sends each person their own alerts.' },
        { name: 'Who scans', text: 'One PC at a time scans an event, chosen automatically. If it sleeps or fails, another online PC takes over within about one auto-check interval. With every PC off, nothing is scanned.' },
        { name: 'What others see', text: 'Everyone can see the team\'s events and scans. The popup only shows your own requests, and your alerts only go to you.' },
        { name: 'Sign-in expired', text: 'If a sign-in stops working you get a notification and a red banner; open the popup and sign in again. Nothing is lost.' }
      ]
    },

    requests: {
      title: 'Requests',
      intro: 'A request is one client\'s need in one sector of one event. Every request gets a permanent number (#1, #2 …) that is never reused, even after it is deleted.',
      items: [
        { name: 'Tickets', text: 'How many seats the client needs. Use − / + on the card or type a number.' },
        { name: 'Prices', text: 'Posttick only: click one or more price chips, or leave All prices. Seats at the picked prices may sit together in a block; a seat at any other price breaks it just like a taken seat. So "5 at 65€ + 55€" means five side-by-side seats that are each 65€ or 55€. By phone: price=65/55.' },
        { name: 'Side by side', text: 'On: the group must sit together in one block. Off: any free seats in the sector will do.' },
        { name: 'Block warn', def: '2', text: 'Running low when only one block still fits the group and it has at most tickets + this many seats. 10 tickets, warn 6 → low when the last fitting block has 16 seats or fewer.' },
        { name: 'Options warn', def: '3', text: 'Running low when this many or fewer groups still fit. 0 switches this rule off.' },
        { name: 'Client', text: 'A name or note. It is shown in the popup and sidebar and never sent in notifications.' },
        { name: 'Listing ID', text: 'Your viagogo listing for this request — the ID, or paste the whole my.viagogo.com link and only the ID is kept. The card then shows "Listing ↗", which opens your viagogo listings filtered to it in a new tab, and every alert about this one request carries a listing button on the phone and the desktop.' },
        { name: 'The card line', text: '"485 free · 36 options · +13,812 L (x1.6)": free seats (counting only the picked prices), how many separate groups of your tickets fit, and the profit with its win rate once the listing has been read on viagogo. "Listing ↗" sits in the row above, next to the status. Open the card for the rest.' },
        { name: 'Search', text: 'The search box finds requests by sector (code or name) or listing ID — in the popup across every event (archived too), in a sidebar within its event. In a sidebar it also lists the event\'s own sectors that match, tracked or not, with their free seats: click one to open it (the seat page on eBileta, the sector card on eFinity and Posttick). Esc clears it.' },
        { name: 'Done', text: 'Finished: no longer scanned or alerted. Reopen it any time.' },
        { name: 'Options', text: 'How many separate groups fit: for every block of free side-by-side seats, block ÷ tickets rounded down, added up. One 50-seat block for 10 tickets = 5 options; blocks of 20 and 12 = 3.' },
        { name: 'Blocks', text: 'A run of free seats next to each other in one row, found from seat positions (never seat numbers). A taken seat or an aisle — a gap wider than 1.75× the row\'s usual seat spacing — ends the block.' },
        { name: 'Status', text: '🟢 OK fillable · 🟠 LOW fillable but running low (see the two warns) · 🔴 SPLIT enough seats but no block fits · 🔴 SHORT fewer free seats than tickets · ⚪ NOT SCANNED no data yet (or a standing area) · 🟣 BOUGHT you have these tickets: it stands over the others, with no scans and no alerts (the Bought switch on the request, or on its listing).' },
        { name: 'Colour stripe', text: 'The stripe on the left of a card is the status colour. The pill next to the sector says which status it is, because SPLIT and SHORT are both red.' },
        { name: 'Toolbar badge', text: 'The number on the extension icon counts only open requests that need attention: orange = running low, red = at least one no longer fillable (SPLIT or SHORT). No number means nothing needs attention. Hover the icon for the counts.' }
      ]
    },

    events: {
      title: 'Events',
      intro: 'Events are grouped in the popup, each with its own number [1], [2] … used by phone commands.',
      items: [
        { name: 'Adding an event', text: 'Nothing is added on its own. On an event page the sidebar offers "Track this event"; in the popup you can paste an event link and press Track, or pick an eBileta event from the "not tracked yet" group (you are asked first).' },
        { name: 'Deleting an event', text: 'An event with no open requests can be deleted: ⋯ → Delete event, or Delete in "events without requests" under the list. Its done requests are deleted with it. Tracking it again later brings back the same number. By phone: del event=4.' },
        { name: 'Scan', text: 'Scan always reads the site again for the sectors that have open requests — even if another PC just did — and counts as the event\'s auto-check, so the next one comes a full interval later on every PC. Scan all reads every sector (eBileta skips sectors its own list shows as sold out).' },
        { name: 'Auto-check per event', def: 'the Settings default', text: 'Give a priority event a short interval and a quiet one a long one: ⋯ on the event → Auto-check (Default, Off or every 1–60 min), or click "auto every … min" under its title. Blue means the event has its own interval. By phone: set event=1 poll=2, poll=0 for off, poll=default to follow Settings.' },
        { name: 'Archive', text: 'Hides an event from the popup without touching its requests. Adding a request to it brings it back.' },
        { name: 'Health', text: 'If scans of an event keep failing (site down, logged out) a red line appears under its header until a scan works again.' }
      ]
    },

    appearance: {
      title: 'Appearance',
      items: [
        { name: 'Theme', def: 'System', text: 'Light or dark background for the popup, the on-site sidebar and the badges. System follows your computer\'s setting.' },
        { name: 'Sidebar', def: 'Push page', text: 'Push page: the site gets narrower while the sidebar is open, so it never covers the seat map. Overlay: the sidebar slides over the right side of the page, like a drawer. Some sites have fixed headers that do not move with Push page — switch to Overlay if a site looks wrong.' }
      ]
    },

    panels: {
      title: 'On-site panels',
      intro: 'What the extension adds to the ticket sites. Everything is on by default.',
      items: [
        { name: 'Show on sites', text: 'Master switch. Off removes every sidebar and badge from every site; the popup, scanning and alerts keep working.' },
        { name: 'eBileta · sector list page', text: 'The sidebar on an event\'s sector list: that event\'s requests, the add form and the scan buttons.' },
        { name: 'eBileta · seat page', text: 'The sidebar on a sector\'s seat map: free / gone / longest block, the "blocks of at least N" finder (click a block to outline it on the map) and the requests tracked in that sector.' },
        { name: 'eBileta · badges', text: 'The − qty + pill on every sector, and a badge on the stadium map over every sector you track, reading "sector | tickets wanted" (for example "L2 | 2"). Clicking the number (or a map badge) opens that sector\'s seat page; − and + change the tickets. The "Wanted / free" switch in the map\'s corner puts both numbers on every badge: tickets wanted / seats free from the last scan ("L2 | 2/43"; "?" when not read). It is remembered on this PC. Hovering any sector of the map shows its seats free (of how many, longest block, when read) and each of your requests there with its options.' },
        { name: 'eBileta · removed sectors', text: 'eBileta takes a sector off its event page a few days after it sells out. A tracked event keeps it: it is listed under the sector list as removed, with its last known price and the − qty + pill, so a request (tickets you bought there) can still be added. It is never scanned again unless the page lists it again. eBileta also takes its shape off the stadium map: the outline is kept with the sector and drawn back, dashed, with its badge where it always was. Clicking it opens nothing, since there is no seat page left. A sector lost before this came in returns when you open its seat page.' },
        { name: 'eBileta · price groups', text: 'Above the free-seats strip, one chip per price (the sector\'s top rate from its last scan), dearest first, removed sectors included. Click one to keep only those sectors in the strip, the drawer and the map — the rest of the map fades; click it again for every sector.' },
        { name: 'eBileta Kosovo', text: 'eu.ebileta.al runs the same software as eBileta, so it gets the same sector list sidebar, seat page and badges, switched separately. Its prices are in euro.' },
        { name: 'eFinity · seat map page', text: 'The sidebar on the event map, with a sector card when you pick a sector.' },
        { name: 'eBileta · checkout', text: 'On the confirmation page (trans/transazione.do) a drawer at the bottom lists every ticket with its last name, name, birth date and email. Pick one of your buying accounts or type in the "All tickets" row, then Apply to all; or change one ticket in its own row. "+ New account" saves another email you buy with (email, names, birth date — taken from the "All tickets" row if typed there) and picks it. It only fills eBileta\'s boxes: nothing is sent until you pay. Add purchase records the order in the buy tracker: the account (the one eBileta names as the client is picked), one purchase per sector at the price paid with the fee, the order code and the request it fills.' },
        { name: 'eFinity · badges', text: 'A badge over every sector that has an open request: tickets requested and the status colour. Click one to open its sector card.' },
        { name: 'Posttick · seat map page', text: 'The sidebar on the event page. Clicking a block zooms the real map to those seats and outlines them.' },
        { name: 'Posttick · badge strip', text: 'One badge per sector under the map. Click one to zoom the map to that sector and open its card.' },
        { name: 'viagogo · listing confirmed page', text: 'Right after you list tickets on viagogo, the sidebar reads the listing — tickets, section, listing ID — and fills Add a request with it. The event is matched by date and name; the event and sector you add it to are remembered for that event\'s next listing, for the whole team. Nothing is added until you press Add request, and a listing that is already a request says so instead.' },
        { name: 'viagogo · my listings page', text: 'On my.viagogo.com/listings each listing card gets one Seat Tracker line — its request, status, profit in lek and win rate, and what your teammates ask for the same sector (red when one of them is under you) — and the sidebar lists them with totals. Cards without a request can be added from there; a card that is a request carries "Delete request", which asks first and removes only Seat Tracker\'s request, never the listing on viagogo.' },
        { name: 'viagogo · event page drawer', text: 'On every www.viagogo.com event page, a drawer at the bottom reads the whole listing list and ranks every section by viagogo\'s display price, with your listings, the gap to the cheapest and graphs. A search box narrows the table to the sections you are looking for. Local to the tab; a refresh clears it. See the drawer\'s own ? for details.' },
        { name: 'Events you have not tracked', text: 'Looking at an event page never adds it. The sidebar shows a "Track this event" card; badges and requests appear once you press it.' },
        { name: 'Collapse', text: 'Click anywhere on a sidebar\'s header (or ›) to collapse it to a tab on the right edge of the page. It remembers whether it was open, per site.' }
      ]
    },

    money: {
      title: 'Money',
      intro: 'Profit per request, from your viagogo listing and the price on the ticket site. Everything is shown in lek.',
      items: [
        { name: 'viagogo prices', text: 'Open my.viagogo.com/listings. Every listing card is read — price per ticket, what you get, tickets left, section, listing performance — and matched to the request with that Listing ID. Scroll viagogo\'s list to load more; each listing is read as it appears. A card without a request gets "Add as request". Nothing on viagogo is clicked.' },
        { name: 'Buy price', text: 'Read from the ticket site: eBileta\'s section price ("Rates from … to …", the higher one, read by every scan), Posttick\'s picked prices (or the section\'s), eFinity\'s sector price. When a site shows none, type it on the request. A typed price always wins.' },
        { name: 'Lek', text: 'Every amount converts to lek at the rate of the day it was read. Rates come once a day from ExchangeRate-API for the whole team; type a rate in Settings → Money to fix it.' },
        { name: 'Profit', text: 'What viagogo pays for the tickets still listed, minus what they cost: (You\'ll get ÷ tickets − buy price) × tickets, in lek.' },
        { name: 'Win rate', text: 'What you get ÷ what the tickets cost, after the profit, like (x1.6). Under x1 is a loss; close to x1 it keeps two decimals, so a small loss shows as (x0.98), never (x1.0).' },
        { name: 'Break-even', text: 'The viagogo price at which you neither win nor lose. A listing priced below it is marked "below break-even" on its card.' },
        { name: 'Price calculator', text: 'At the bottom of the sidebar on every site: type what the tickets cost and what you would ask, each in its own currency, and it works out the payout, the profit per ticket and in all, the win rate and the break-even ask. viagogo\'s share starts from what your own listings pay out and can be typed over. As soon as a buy price is in, it also offers the asks that would bring back ×1.5, ×2, ×2.5 and ×3 of what the tickets cost — press one to use it. Nothing is saved to a request — it is for thinking before you list.' },
        { name: 'Calculator on a listing', text: 'On each card of your viagogo listings page: type another sell price and see what it would pay out and earn, next to what the listing earns now, with the break-even and the asks for ×1.5, ×2, ×2.5 and ×3. It changes nothing on viagogo.' },
        { name: 'Team prices', text: 'Teammates see your sell price per section — on their requests, in Add a request, on each card of your viagogo listings page (on viagogo\'s own card as well as in the sidebar, red when someone is under you), in the popup\'s Team section and in the event drawer. Only you see your payout and profit.' },
        { name: 'Telling the team', text: 'Nothing about prices is ever sent on its own. "Tell the team" (in the drawer, on a listings card, or in the popup\'s Team section) sends what you type to the teammates you tick, on their phone and their PCs. Their own switches, mute and quiet hours still decide how it arrives.' }
      ]
    },

    market: {
      title: 'viagogo event drawer',
      intro: 'On any viagogo event page, a drawer at the bottom reads the listings and ranks every section by viagogo\'s display price. A scan lives in this tab and a refresh clears it — unless you press Save scan, which keeps it on this PC to compare with later.',
      items: [
        { name: 'Before scanning', text: 'Remove viagogo\'s filters (quantity, price, features) and leave no section picked on the map, so the list shows every listing. Scan stays off while a section is picked.' },
        { name: 'Scan', text: 'Presses "Show more" until it is gone, then reads every listing in the list and sorts each into its own section. Stop ends it; what was loaded so far is still read. It gives up after 20 minutes.' },
        { name: 'Display prices', text: 'viagogo shows each seller a different "relative" price, so everything here is the price the page shows. Ranking and graphs use every listing in the section, whatever the quantity.' },
        { name: 'Your listings', text: 'Marked "Your listing" by viagogo; each counts in its own section. Profit next to them comes from your listings page (the real price), when that listing has been read there.' },
        { name: 'Real prices', text: 'The last column is what you and your teammates actually set, read from your own viagogo listings pages — not viagogo\'s display price. "Yours shown" is the display price of your listing in the same section, so the two rarely match.' },
        { name: 'Only us', text: 'A section marked "only us" has nothing in it but your team\'s listings — room to raise. Teammates\' rows are found by their row label or how many tickets are left, never by price (viagogo shows every viewer different prices); one that cannot be pinned to a row is still counted, and a price older than a week never counts at all.' },
        { name: 'Rank and gap', text: 'Rank: your cheapest listing among all listings of the section (ties share a rank). Gap: how far its display price is from the nearest seller who is not you. Green and negative means you are the cheapest and that is the room you have to raise; amber is just above them, red is more than 10% above. A dash means nobody else is listed there.' },
        { name: 'By price', text: 'Every listing of every section in one list, cheapest first. Tickets keeps the listings that sell that many. Sector price keeps the sections whose ticket-site sector costs that much: the tracked event\'s price list (typed in the app), else the site\'s price, else what you paid; on an untracked event, the linked face values. "No price" is the sections none of these covers.' },
        { name: 'Graphs', text: 'The overview puts every scanned section on one price axis: grey dots are other listings, blue ones yours. Click a section for its own graph and every listing in it.' },
        { name: 'Search', text: 'The box above the table narrows it to the sections whose name matches what you type ("E1" leaves E101 and E106), or to the one section a listing ID is in. The overview graph follows the search; the tiles above it always count everything scanned. Esc clears it, and so does a refresh.' },
        { name: 'Closed until you open it', text: 'The drawer starts as a bar at the bottom of every event page and only opens when you press its arrow. Its height and sorting are remembered between pages; being open is not.' },
        { name: 'Kept until refresh', text: 'What was read stays in this tab; after 30 minutes the sections turn grey. Scan again replaces everything. Clear forgets the event; refreshing the page clears it — saved scans stay.' },
        { name: 'Save scan and Changes', text: 'Save scan keeps the scan: only the newest 2 per event, so a third save deletes the oldest. A refresh does not clear them. Signed in, they are saved for you in the app too (not for the team), and your other PCs get them; × deletes one and Reset saved scans deletes them all, everywhere. The Changes tab compares two scans: by default the scan on screen, or the newest saved one, against the saved one before it — or pick any two. It shows new listings, removed ones (sold or taken off), prices that went down or up, and listings whose ticket count changed, per section and in total. Signed in, listings are paired by their ID. Signed out they have none, so a listing is paired with one that looks the same (section, row, features), marked "matched by look". A signed-in scan and a signed-out one cannot be compared on price: viagogo shows every viewer its own prices.' },
        { name: 'Stands', text: 'On a tracked eBileta event (or when the sections are named like Air Albania\'s), chips filter the sections by stand: N, E, S, V and W by the code\'s letter, and Corners — N106, N206, N207, E101, E201, E202, E210, E109, E211, S201, S101, S202 — which are in no other stand. Several can be on at once; All clears them. The same chips filter By section, By price and Changes.' },
        { name: 'Prices for "No price"', text: 'On a tracked event, the "No price" chip of By price lists the sections without a sector price, with a box for one. Set price puts it on the event\'s price list — the team\'s, the one the app\'s Price list shows. A section the event has no sector for (eBileta took it off its page before Seat Tracker kept removed sectors) gets Save section instead: it goes back on the event as a removed sector, with its price if one is typed. Its id comes from another tracked event in the stadium when one knows it; otherwise it gets a stand-in id, has no seat page, and gives way to the real sector (its price and requests moving with it) if eBileta ever lists it again.' },
        { name: 'Tracked events', text: 'When the event is one of your Seat Tracker events, the table also shows eBileta\'s free seats in that section.' }
      ]
    },

    scanning: {
      title: 'Scanning',
      items: [
        { name: 'Auto-check', def: '5 min', text: 'Shared with the team. The default for every event: every N minutes the sectors with open requests — everyone\'s — are re-scanned by whichever PC is online. 0 turns it off. An event can have its own interval (⋯ on the event in the popup). Only runs while a PC is on, with Chrome open and awake.' },
        { name: 'Scanning once for everyone', text: 'A sector is scanned once and the result serves every request in it, whoever\'s PC took it. Pressing Scan (or sending a scan command) always reads the site again and counts as that event\'s auto-check on every PC. Adding or editing a request reuses a scan that is still fresh instead of reading the site.' },
        { name: 'Side by side', def: 'on', text: 'The default for new requests.' },
        { name: 'Block warn / Options warn', def: '2 / 3', text: 'The defaults for new requests. See Requests for what they mean.' },
        { name: 'New-event check', def: '30 min', text: 'eBileta publishes a list of all its events. Every N minutes it is read and any event not seen before sends a "New event" notification. The very first check only records what is already there. 0 turns it off.' },
        { name: 'Politeness', text: 'Requests to the sites go out one at a time, at least 0.8 s apart, whatever asked for them.' },
        { name: 'Connection problems', text: 'When syncing with the Seat Tracker server (Supabase) keeps failing, an orange box says which case it is: this PC is offline, or it is online but something (a VPN, firewall, network filter, blocker extension, or a Supabase outage) stops it reaching the server. It shows since when and the browser\'s own reason, retries every 30 seconds, and disappears by itself after the next good sync. Retry now tries at once. One failed sync right after waking from sleep is not shown.' }
      ]
    },

    notifications: {
      title: 'Notifications',
      intro: 'NOTIFICATIONS.md in the extension folder describes every case with examples.',
      items: [
        { name: 'The grid', text: 'Each kind of notification has its own Desktop and Phone switch. Phone needs a ntfy topic (Phone section).' },
        { name: 'Tickets available now', text: 'A request that was not fillable (SPLIT, SHORT) became OK or LOW. Top priority on the phone.' },
        { name: 'Running low', text: 'A request went from OK to LOW, or is LOW and its options dropped further.' },
        { name: 'Back to OK', text: 'A request that was LOW is OK again, e.g. "🟢 #2 C TRIBINE ×12 OK — 4 options".' },
        { name: 'Does a warning repeat?', text: 'No. Each alert is sent when the status changes. A request that stays LOW only alerts again if its options drop further; one that stays unfillable does not alert again. Use Summary for a regular reminder of everything.' },
        { name: 'No longer fillable', text: 'A request that was OK or LOW became SPLIT or SHORT.' },
        { name: 'Scan failing / working again', text: 'Sent once when an event\'s scans start failing, and once when they work again — never on every failed scan.' },
        { name: 'New event on a site', text: 'The new-event check found an event that was not listed before.' },
        { name: 'Summary', text: 'Every open request, one line each, grouped by event. Off, after each event\'s auto-check (that event\'s requests), or once a day at the time you pick (all events).' },
        { name: 'Quiet hours', text: 'Between these times nothing is pushed to the phone. Desktop notifications still show. "Let Tickets available now through" keeps that one alert coming.' },
        { name: 'Mute (snooze)', text: 'The bell in the popup header, or the "mute 60" command, silences every alert — desktop and phone — for that long. Phone commands still answer. "unmute" ends it early.' },
        { name: 'Cooldown', def: '10 min', text: 'The same alert for the same request is not sent again within this many minutes. Stops a seat bouncing in and out of someone\'s cart from spamming you. 0 turns it off.' },
        { name: 'Confirm "No longer fillable"', def: 'on', text: 'Only send it when two scans in a row agree. Seats held in a cart for a minute then do not alert — the cost is that a real sell-out is reported one scan later.' },
        { name: 'Buttons', def: 'on', text: 'Phone: Open map, Scan again, and Mark done when the alert is about one request. Desktop: Open map, Scan again. When the alert is about one request with a Listing ID, "Viagogo listing" (phone) and "Open listing" (desktop) take Open map\'s place — tapping the notification itself still opens the map. On a repeating warning, Stop takes the place of Mark done (phone) and of Scan again (desktop). Scan again, Mark done and Stop send a command to your shortcuts topic, so they need one.' },
        { name: 'Repeat warnings until Stop', def: '15 min', text: 'Running low, No longer fillable and Scan failing come back every N minutes for as long as the trouble lasts and nobody presses Stop. Stop ends the reminders for you only and changes nothing about the request; they end by themselves when it recovers, and start again if the warning gets worse. Reminders ignore mute and quiet hours — the first alert does not. 0 turns repeating off.' },
        { name: 'Your own edits', text: 'Adding a request, or changing what it needs (tickets, price, warns, sector, side by side), only records a new starting point, so your own edit never alerts. Example: raising a request from 4 to 8 tickets can turn its card LOW with no notification — that is expected. From then on, changes on the site alert as usual.' }
      ]
    },

    phone: {
      title: 'Phone',
      intro: 'Phone alerts and commands use ntfy — free, no account. Install the ntfy app and subscribe to your ntfy topic.',
      items: [
        { name: 'ntfy topic', text: 'Where YOUR alerts and command answers arrive; each person has their own. Anyone who knows the name can read it, so make it long and hard to guess. Test sends a message right away.' },
        { name: 'shortcuts topic', text: 'Where your phone sends commands (the iPhone Shortcut posts here). Whichever PC is online reads it every 30 seconds, runs the command as you, and answers on your ntfy topic. Anyone who knows it can change your requests — keep it secret and different from your ntfy topic. Empty turns commands off.' },
        { name: 'The get link', text: 'Open it on your phone to get every open request back as a push. Add it to your home screen.' },
        { name: 'Try a command', text: 'Runs a command here, shows the answer and also sends it to your phone. COMMANDS.md lists every command.' },
        { name: 'Links', text: 'In a command link spaces become +, names with spaces use _, and never use & or #.' },
        { name: 'ntfy server', def: 'https://ntfy.sh', text: 'Only change this if you run your own ntfy server.' }
      ]
    },

    backup: {
      title: 'Backup',
      items: [
        { name: 'Export', text: 'Saves events, requests, their numbers and your settings as a JSON file. Scan results are not included; they are re-read.' },
        { name: 'Import', text: 'Adds the requests from a file; nothing already here is removed and a request imported before is skipped. It also reads the exports of the three old extensions (eBileta, eFinity, Posttick). Old requests get new numbers, and from old files only the ntfy and shortcuts topics are copied, into topics that are still empty.' }
      ]
    }
  };

  const order = ['account', 'requests', 'events', 'appearance', 'panels', 'scanning', 'money', 'market', 'notifications', 'phone', 'backup'];

  SK.help = { sections, order };

  if (typeof module === 'object' && module.exports) module.exports = SK;
})(globalThis);
