# Notifications

Every notification Seat Tracker can send: when it fires, what it says, where it goes and which
settings change it. The **?** next to Notifications in the popup has the short version.

- [Where notifications go](#where-notifications-go)
- [Who gets what](#who-gets-what)
- [All notifications at a glance](#all-notifications-at-a-glance)
- [The request line](#the-request-line)
- [Each notification](#each-notification)
- [Does a warning repeat?](#does-a-warning-repeat)
- [What never notifies](#what-never-notifies)
- [Settings that change delivery](#settings-that-change-delivery)
- [How one alert is delivered, step by step](#how-one-alert-is-delivered-step-by-step)
- [Timelines](#timelines)
- [Buttons](#buttons)
- [Privacy](#privacy)

---

## Where notifications go

| Channel | What you need | Notes |
|---|---|---|
| **Desktop** | nothing, on by default | Chrome's notification in the corner of the screen, on each PC where you are signed in. Clicking it opens the event's seat map. |
| **Phone** | the ntfy app + a **ntfy topic** (Settings → Phone) | Clicking it opens the event's seat map. Long messages arrive in parts `(1/2)`, `(2/2)`. |

Both only work while **Chrome is running and the computer is awake** — on any PC of the team, not
necessarily yours. There is no server sending them.

Everything below is **per person**: your switches, your topics, your quiet hours, your mute.

---

## Who gets what

A request belongs to one person, and so does every alert about it.

| Notification | Goes to |
|---|---|
| Tickets available now · Running low · Back to OK · No longer fillable | the person who owns that request |
| Scan failing · Scan working again | everyone with an open request in that event |
| New event on a site | everyone on the team |
| Summary | each person, with their own requests only |
| No tickets yet · Reservation not confirmed · Take it off | the person who bought those tickets |
| Command answers · Test | whoever sent it |

**Your tickets' alerts come from your own PCs.** The tickets you bought, their listings and
reservations are yours alone (a teammate's PC cannot read them), so these three are worked out only
on a PC where **you** are signed in, every 10 minutes after it syncs. If all of your PCs are off,
they wait until one is on.

**Sent once, whichever PC scanned.** Any PC may run the scan. Before alerting, the PC records the new
status in the shared database; if another PC recorded the same change a moment earlier, it stays
quiet. So two PCs that are both awake never double-alert, and a PC that was asleep does not re-send
old alerts when it wakes up — it shows the ones you have not seen yet.

**Requests are never added up.** Two people watching the same sector are judged separately: 5 seats
for one and 6 for the other are two questions about the same scan, never a request for 11.

**Other people's requests are invisible to you** — not in your popup, your alerts or your summaries.
The only thing you see is that an event still has someone's open requests, so you don't delete it.

---

## Warnings come back until you stop them

A problem that lasts is worse than one that starts, and the alert for it used
to be sent once, at the moment it began. **Running low**, **No longer fillable**
and **Scan failing** now come back every **15 minutes** (Settings →
Notifications → *Repeat warnings until Stop*, 0 turns it off) for as long as
the problem is there and nobody has pressed **Stop**.

| | |
|---|---|
| **Stop** | ends the reminders for that request (or that event's failing scans) — for you, not for your teammates. It does **not** mark anything done: the request is left exactly as it is. |
| It ends by itself | when the request recovers, is marked done or deleted, or when the scans work again. |
| It starts again | if the warning turns into a worse one — a *Running low* you stopped will still tell you when it becomes *No longer fillable*. |
| Mute and quiet hours | do **not** hold reminders back: a warning that is still there gets through anyway. The first alert still respects them. |
| Reminders say so | "Still: running low … Still there after 45 min · Stop ends these reminders." |

**Stop** replaces **Mark done** on the phone, and on the desktop it takes the
place of *Scan again*, next to *Open listing*. The phone's Stop needs your
**shortcuts topic** (Settings → Phone), like every other phone button.

## Messages between teammates

The only notification a person starts by hand. **Tell the team** in the viagogo
event drawer or on a listings card, and the **Team** section of the popup, send
what you type to the teammates you tick — on their phones and on every PC they
are signed in to. The section and event it was sent from are added above your
text, so "raise?" still makes sense on a phone.

Nothing else about the team is ever sent on its own: no price change, no
"only us in this sector" and no scan result leaves a PC unless someone presses
send. Recipients keep control at their end — their own switch for this
notification, their mute and their quiet hours all apply.

## All notifications at a glance

| Notification | Fires when | Desktop | Phone | Phone priority | Tap opens | Buttons |
|---|---|---|---|---|---|---|
| **Tickets available now** | a request becomes fillable | on | on | 5 (max) | seat map | Open map · Scan again · Mark done¹ |
| **Running low** | a request gets tight, then every 15 min until stopped | on | on | 4 | seat map | Open map · Scan again · Mark done¹ (**Stop** on a reminder) |
| **Back to OK** | a low request is OK again | on | on | 3 | seat map | Open map · Scan again · Mark done¹ |
| **No longer fillable** | a request can't be filled any more, then every 15 min until stopped | on | on | 4 | seat map | Open map · Scan again · Mark done¹ (**Stop** on a reminder) |
| **Scan failing** | an event's scans start failing, then every 15 min until stopped | on | on | 4 | seat map | Open map · Scan again (**Stop** on a reminder) |
| **Scan working again** | a failing event scans fine again | on | on | 3 | seat map | Open map · Scan again |
| **New event on a site** | the new-event check finds an unseen event | on | on | 4 | the event | — |
| **A sector with no seats now has some** | a sweep finds a sector that was empty and is on sale, and nobody has a request in it | on | on | 5 (max) | the event | — |
| **Message from a teammate** | a teammate typed one and pressed send | on | on | 4 | the event, when the message is about one | — |
| **No tickets yet** | a ticket you bought still has no PDF (or a mobile transfer is not received) 7 days, and again 2 days, before its event | on | on | 4 (5 when some are listed or sold) | — | — |
| **Reservation not confirmed** | a reservation you marked is still not confirmed 48 hours later | on | on | 4 | the listing | Viagogo listing (phone) |
| **Take it off** | a ticket you sold is still on another active listing | on | on | 5 (max) | the listing | Viagogo listing(s) (phone) |
| **Summary** | after every auto-check, or once a day | off | on | 2 | seat map² | — |
| Command answer | you sent a phone command | — | always | 3 (4 if failed) | — | — |
| Test | you pressed a Test button | once | once | 3 | — | — |

¹ Mark done only when the alert is about exactly one request. If that request has a **Listing ID**,
**Viagogo listing** (phone) / **Open listing** (desktop) takes Open map's place; tapping the
notification still opens the map.
² Only when every open request belongs to one event.

Every row with on/off in the Desktop and Phone columns has its own switch in
**Settings → Notifications**. The defaults are shown above.

---

## The request line

Alerts and summaries use one line per request, and nothing else:

```
🟢 A1 65€ ×4 OK — 12 options · Ana K.
```

| Part | Meaning |
|---|---|
| 🟢 🟠 🔴 ⚪ | OK · LOW · SPLIT or SHORT · NOT SCANNED |
| `A1` | the sector |
| `65€` | only on Posttick requests pinned to a price |
| `×4` | tickets |
| `OK — 12 options` | status and how many separate groups of 4 still fit |
| `Ana K.` | the client, when the request has one |

An alert's title names the sectors (`No longer fillable · E106, E107`, more than three as `+2`), and
its text starts with the event's own name, as the app's Now and Events pages show it: `Max Amini`.
No event `[n]` and no request `#n`. Command answers keep them, because they are what you type back
(`done req=2`), so there the line reads `🟢 #2 A1 65€ ×4 OK — 12 options`.

**Status, in short**

- **OK** — fillable.
- **LOW** — fillable, but options ≤ *options warn*, or only one block still fits and it has at most
  *tickets + block warn* seats.
- **SPLIT** — enough free seats, but no block big enough for the group (side by side on).
- **SHORT** — fewer free seats than tickets.
- **NOT SCANNED** — no data yet, or a sector without a seat map (standing areas).

---

## Each notification

### A sector with no seats now has some

**When:** a sector nobody has a request in goes from having nothing to sell to having something.

eBileta holds stands back and releases them as the date comes closer. It comes from two places, and
neither costs a request for a shut sector:

| Signal | Where it comes from |
|---|---|
| the site's own label stops saying **Soldout** | the event page prints every sector's availability above the map — `TRIBUNA E105 Availability Soldout` — and every scan already fetches that page |
| a listed sector that was scanned **empty** now has seats | the sector sweep, every **Settings → Scanning → Sector sweep** minutes (30 by default, eBileta only) |

The sweep leaves out the sectors the site calls sold out. On a big stadium that is most of the map —
the Egnatia event has some fifty — and reading them every half hour would cost more than everything
else the extension does, to learn what the page says for nothing on every load.

```
S104 on sale
Shqiperi - San Marino
S104 (TRIBUNA S104) · 412 free · longest block 14
No request is watching it yet.
```

It goes to **the whole team**, like New event: the sector belongs to nobody's request, which is the
point of it.

**What does not fire it:**

| | |
|---|---|
| a sector nobody ever scanned | there is no "was empty" to compare against, so the first sweep of an event only learns the ground truth |
| a sector that already had seats | nothing opened |
| a sector with an open request | it already alerts through that request |
| the same opening twice | the open sectors are remembered on the event, so it is announced once, and again only if it empties and reopens |

One PC sweeps, under the same lease as a scan, so two PCs never sweep at once and a sweep never lands
on top of an auto-check. It costs one request per sector, and only on sites that ask for it — eBileta
today.

**Per event**, because matches differ: a popular one puts the whole stadium on sale at once and never
needs sweeping, while another opens the first floor and holds the rest back until days before. The
event's **⋯** menu has *Sector sweep: default / off / every 5–120 min*, shared with the team, plus
**Sweep now** to read every sector on the spot. The line under the event says which it is —
`sweep every 30 min`, or `sweep off`.

### Tickets available now

**When:** a request that was **SPLIT or SHORT** on the previous scan is **OK or LOW** now.

```
Tickets available now · A1, D2
Max Amini
🟢 A1 ×4 OK — 3 options
🟠 D2 65€ ×2 LOW — 1 option
```

- Sent at **priority 5** on the phone, so it breaks through most "do not disturb" settings.
- All requests of one event that became available in the same scan share one notification.
  Requests in two events → two notifications, so each one opens the right map.
- **Quiet hours** do not stop it while *Let "Tickets available now" through* is on.

### Running low

**When**, for a request that is still fillable:

1. it was **OK** and is now **LOW**, or
2. it was **LOW** and is still **LOW**, but its **options dropped**.

```
Running low · E105
Shqiperi - Bjellorusi
🟠 E105 ×10 LOW — 2 options
```

What makes a request LOW is set per request:

| Warn | Example (10 tickets) |
|---|---|
| **Options warn** = 3 | LOW as soon as 3 or fewer groups of 10 still fit. Every further drop (3 → 2 → 1) alerts again. |
| **Block warn** = 6 | LOW when only one block still fits and it has 16 seats or fewer. |

Options warn 0 turns that rule off.

### Back to OK

**When:** a request that was **LOW** on the previous scan is **OK** now — a warning cleared.

```
Back to OK · C TRIBINE
Senidah Cair
🟢 C TRIBINE ×12 OK — 4 options
```

Typical cause: seats that were held in someone's cart were released, or new seats were put on sale.
The cooldown stops a request that keeps flipping between LOW and OK from sending this every scan.

### No longer fillable

**When:** a request that was **OK or LOW** is now **SPLIT or SHORT**.

```
No longer fillable · G TRIBINE
SENIDAH - SC Cair
🔴 G TRIBINE ×6 SPLIT — 0 options
```

With **Confirm "No longer fillable"** on (the default) it is only sent when **two scans in a row**
agree. After the first bad scan the request's pill shows a tooltip *"waiting for the next scan to
confirm"*. If the next scan is fine again, nothing is sent. See the [timelines](#timelines).

### Scan failing

**When:** a scan of an event fails — the site is down, returns an error, you are logged out of
eBileta, or nothing at all could be read — **and the previous scan of that event worked**.

```
Scan failing
Shqiperi - San Marino
HTTP 503 for al.ebileta.al/…/scegliPostoPub.do
Last good scan: 14.09, 10:42
```

- Sent **once**, when the problem starts — never on every failed auto-check.
- While it lasts the event shows a red line in the popup and the sidebar.
- If a sector that had a seat map suddenly comes back without one (usually a logged-out session), the
  last good scan is kept, the problem is listed, and that sector is **not** reported as NOT SCANNED.
- A scan where *some* sectors worked is not "failing"; the sectors that failed are listed in the
  popup's status line.

### Scan working again

**When:** the first successful scan after **Scan failing**.

```
Scan working again
Shqiperi - San Marino
Scans work again after 25 min.
```

### New event on a site

**When:** the new-event check (every 30 min by default) reads a site's event list and finds an event
it has never seen. Today only eBileta publishes such a list.

```
New event on eBileta
Shqiperi - Andorra · 12 Nov 20:45 · Air Albania Stadium
```

- The **very first** check only records what is already listed, so installing does not send a flood.
- Several new events in one check share one notification.

### No tickets yet

**When:** a ticket you bought has still not come (no PDF on it yet, or a mobile transfer you have not
marked **Received**) **7 days** before its event, and again **2 days** before. One notification per
event at each step; a lot bought 3 days before the event gets only the 2-day one.

```
Sold, no tickets yet · in 2 days
Albania - Serbia · Tue 1 Dec 20:45
W105 · 2 no PDF yet, 1 not received (1 sold or reserved, 1 listed)
Attach the PDF, or tap Received for a mobile transfer, on the lot in the app.
```

| Title | When | Phone priority |
|---|---|---|
| **No tickets yet** | none of the missing tickets is on sale yet | 4 |
| **Listed, no tickets yet** | some of them are on an active listing | 5 |
| **Sold, no tickets yet** | some of them are sold, or held for a buyer (reserved) | 5 |

- **What counts:** the tickets of your lots with no PDF yet, and mobile transfers not received. Not
  the ones sold outside viagogo. A frozen lot (from before PDFs were kept) never counts. A lot with no
  tickets yet goes by its numbers; it says "(listed)" or "(its listing sold)" from the listings its
  tickets were put on.
- **When the event is:** the time printed on the ticket, else the one in the event's title, else the
  date viagogo gives on your listing or sale for it, as the app works it out. No time known: no alert.
- **What the PC knows is what is recorded.** A ticket is listed, reserved or sold when its listing, its
  reservation or its sale says so. A sale that never said which tickets it took leaves them as they
  were, so where the app guesses "sold" the PC may send the milder title.

### Reservation not confirmed

**When:** a reservation you marked on a listing (a buyer viagogo is checking; see the app's
**Reservations**) is still not confirmed **48 hours** after you marked it. viagogo has decided by then:
check its email or My Sales, then **Confirm** or **Cancel** it on the listing. Once per reservation.

```
Reservation not confirmed · W105
Albania - Serbia · Tue 1 Dec 20:45
W105 · row 5 · listing 13990000001 · 2 tickets · seats 5-6
Reserved 2 days ago, still not confirmed. Check viagogo's email or My Sales, then Confirm or Cancel it on the listing (the popup or the app).
```

Tapping it, or **Viagogo listing** on the phone, opens the listing on my.viagogo.com.

### Take it off

**When:** a ticket you sold (by a viagogo sale, or outside viagogo) is still on **another** active
listing: another market, or a second listing of the same seats. It could sell twice. One notification
per event, a line per ticket; each ticket and listing is told once. Nothing after the event.

```
Take it off · 1 ticket
Albania - Serbia
W105 row 5 seat 1: sold (sale 656096343), still on listing 13990000002 (Active)
Take it off that listing on viagogo, or it can sell twice.
```

- Tapping it opens that listing (your listings page when there are several).
- Only tickets whose sale says which ones it took: a sale that never said is no guess here. The app's
  **Take it off** list in Inventory shows the same tickets.

### Summary

Every open request, grouped by event.

| Summary setting | When |
|---|---|
| **Off** (default) | never |
| **After every auto-check** | after each event's auto-check, with that event's requests, whether anything changed or not (events with different auto-check intervals send at their own pace) |
| **Once a day** | at the time you pick; it scans first so the numbers are fresh. If the computer was asleep at that time it is sent when Chrome wakes up, once per day at most. |

```
Daily summary
Max Amini
🟢 A1 ×4 OK — 12 options
🟠 D2 65€ ×2 LOW — 1 option

Shqiperi - Bjellorusi
🔴 E105 ×10 SPLIT — 0 options
```

### Command answers

Every phone command is answered on the ntfy topic (see COMMANDS.md). Answers are **not** affected by
the per-type switches, quiet hours or mute — you asked, so you get an answer. A command that goes
wrong is answered as **Command failed** with the reason, at priority 4.

### Test messages

**Test** (Phone) and **Test desktop notification** (Notifications) send one message right away,
regardless of any other setting.

---

## Does a warning repeat?

**No.** Every alert is about a *change*:

| The request… | Next scan sends |
|---|---|
| stays **LOW** with the same (or more) options | nothing |
| stays **LOW** and its options drop, e.g. 3 → 2 | **Running low** again |
| stays **SPLIT / SHORT** | nothing |
| goes **LOW → OK** | **Back to OK** |
| goes **SPLIT / SHORT → OK / LOW** | **Tickets available now** |

The card in the popup, the sidebar and the number on the toolbar icon keep showing the warning for as
long as it lasts. If you want a regular reminder of everything, turn on **Summary** (after each
auto-check, or once a day).

**The alerts about your tickets go out once each**: **No tickets yet** once at 7 days and once at 2
days, **Reservation not confirmed** once per reservation, **Take it off** once per ticket and listing.
They are never repeated, whichever of your PCs is on; each one is remembered for 60 days.

---

## What never notifies

- **The first scan of a request.** Adding a request only records where it stands.
- **Your own edits.** Changing tickets, price, block warn, options warn, sector or side by side, or
  reopening a done request, starts from a fresh baseline. Only changes *on the site* alert.
  Example: you raise #3 from 4 to 8 tickets and the next scan finds only one block of 9 → the card
  turns **LOW**, but no "Running low" is sent, because the site did not change — your request did. If
  that block then shrinks or another one sells, you are alerted as usual.
- **Done requests.** They are not scanned.
- **NOT SCANNED.** A sector without data, or a standing area, never counts as a change.
- **Sectors that were not part of the scan.** Scanning one sector only compares requests in that sector.
- **Client names.** They are never included in any notification.

---

## Settings that change delivery

| Setting | Default | Effect |
|---|---|---|
| **Desktop / Phone per type** | see the table above | switches that one notification on that channel |
| **Summary** | off | off · after every auto-check · once a day at a time |
| **Quiet hours** | off, 23:00–08:00 | no **phone** pushes in that window; desktop still shows. The alerts about your tickets wait for the end of it instead, so they still reach the phone |
| **Let "Tickets available now" through** | on | that one alert ignores quiet hours |
| **Mute** (bell in the popup, or `mute 60`) | — | silences **every alert on both channels** for a while; command answers still arrive. The alerts about your tickets wait until it ends |
| **Cooldown** | 10 min | the same alert for the same request is not repeated within this time (0 = off) |
| **Confirm "No longer fillable"** | on | needs two scans in a row before that alert |
| **Buttons on notifications** | on | adds the buttons described [below](#buttons) |
| **ntfy topic** | empty | no phone notifications without it |
| **Shortcuts topic** | empty | phone buttons that run commands need it |

---

## How one alert is delivered, step by step

1. A scan finishes — on whichever PC ran it — and each request's status is compared with the last one
   recorded in the shared database.
2. If it is the first scan, or nothing meaningful changed → stop.
3. **No longer fillable** with *confirm* on and this is the first bad scan → remember it, stop.
4. The same alert for this request within the **cooldown** → stop (the new state is still recorded).
5. The PC writes the new status back — but only if no other PC got there first. If one did, it has
   already alerted → stop.
6. **Muted** (the owner's mute) → stop.
7. That person's desktop switch on for this type → desktop notification on every PC where they are
   signed in, once each.
8. Their phone switch on, a ntfy topic is set, and it is **not quiet hours** (or it is "Tickets
   available now" with *let through* on) → one push to their ntfy topic.

---

## Timelines

Auto-check every 5 minutes, cooldown 10 minutes, confirm on, unless stated.

**A. Someone holds your seats in a cart for a few minutes**

| Time | Scan says | You get |
|---|---|---|
| 10:00 | OK, 2 options | — |
| 10:05 | SPLIT (seats held in a cart) | nothing — waiting to confirm |
| 10:10 | OK, 2 options (cart abandoned) | nothing |

**B. The block really sells out**

| Time | Scan says | You get |
|---|---|---|
| 10:00 | OK | — |
| 10:05 | SPLIT | nothing — waiting to confirm |
| 10:10 | SPLIT | **No longer fillable** |

**C. Availability keeps coming and going**

| Time | Scan says | You get |
|---|---|---|
| 10:00 | SPLIT | — |
| 10:05 | OK | **Tickets available now** |
| 10:10 | SPLIT | nothing — waiting to confirm |
| 10:15 | SPLIT | **No longer fillable** |
| 10:20 | OK | **Tickets available now** (the last one was 15 min ago, past the cooldown) |

With confirm **off**, 10:10 would send *No longer fillable* straight away; if it came back OK at
10:12 on a manual scan, *Tickets available now* would be held back until 10:15 by the cooldown.

**D. Running low, then lower**

| Time | Options (options warn 3) | You get |
|---|---|---|
| 10:00 | 5 → OK | — |
| 10:05 | 3 → LOW | **Running low** |
| 10:10 | 3 → LOW | nothing (no drop) |
| 10:15 | 2 → LOW | **Running low** |
| 10:20 | 1 → LOW | **Running low** |
| 10:25 | 1 → LOW | nothing (still low, no drop) |
| 10:30 | 5 → OK | **Back to OK** |

**E. Quiet hours 23:00–08:00, let available through**

| Time | Event | Desktop | Phone |
|---|---|---|---|
| 01:10 | Running low | yes | no |
| 03:40 | Tickets available now | yes | **yes** |
| 06:00 | Scan failing | yes | no |

**F. eBileta logs you out overnight**

| Time | Scan | You get |
|---|---|---|
| 02:00 | works | — |
| 02:05 | seat pages come back without seats | **Scan failing** (last scan kept) |
| 02:10 … 08:55 | still failing | nothing more |
| 09:00 | you log in, scan works | **Scan working again** |

---

## Buttons

With **Buttons on notifications** on:

| Button | Where | What it does |
|---|---|---|
| **Open map** | phone, desktop | opens the event's seat map |
| **Viagogo listing** / **Open listing** | phone / desktop, when the alert is about one request that has a Listing ID | opens `my.viagogo.com/listings` searched for that listing, in a new tab. It replaces Open map, because ntfy allows 3 buttons and Chrome 2; tapping the notification itself still opens the map |
| **Scan again** | phone, desktop | phone: sends `scan event=<n>` to your shortcuts topic; desktop: scans that event right away |
| **Mark done** | phone, when the alert is about one request | sends `done req=<n>` to your shortcuts topic |
| **Stop** | both, on a repeating warning | ends its reminders: `stop req=<n>` (or `stop event=<n>`) on the phone, at once on the desktop. Nothing else changes. |

The phone buttons post to your **shortcuts topic**, exactly as if you had opened a command link, so they
only appear when a shortcuts topic is set (the listing button is a plain link and needs no topic).

Command answers about one request — `get req=3`, `scan req=3`, `add …` — also carry the
**Viagogo listing** button when that request has a Listing ID. The answer arrives as a normal command answer within about
30–60 seconds.

---

## Privacy

- A notification contains the event title, sector codes, ticket counts, statuses and option counts —
  **never client names**. The alerts about your tickets also give their rows, seats, and listing and
  sale numbers.
- Anyone who knows your **ntfy topic** can read your notifications; anyone who knows your **shortcuts
  topic** can change your requests. Use long, hard-to-guess names, and different ones for the two.
- Topics are per person. Each member has their own pair, and nobody else's alerts arrive on yours.
- The shared database holds events, scans and requests. Only the emails on the members list in
  `supabase/schema.sql` can read or write any of it.
