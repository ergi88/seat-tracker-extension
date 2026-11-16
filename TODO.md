# Seat Tracker — things to build later

Ideas that are wanted but deliberately not built yet. Each one says why it is
parked, so picking it up later does not start from nothing.

## Team prices on viagogo events that are not tracked

**What:** the event drawer shows teammates' prices only when the viagogo event
is matched to a tracked Seat Tracker event. On any other event page the team
column stays empty.

**Why it is parked:** the `team_prices` view does not expose `vg_event_id`, so a
teammate's listing cannot be tied to a viagogo event on its own — only through
the Seat Tracker event it belongs to.

**How to build it:**

1. In `supabase/schema.sql`, add `l.vg_event_id` to the `team_prices` view and
   re-run the file (it is idempotent — `create or replace view`).
2. `bg/remote.js` → `toTeamPrice`: carry `vgEventId: r.vg_event_id || ''`.
3. `background.js` → the `teamPrices` state list: carry `vgEventId`.
4. `core/team.js` → `teamAt`: when `where.vgEventId` is given, match on it
   first and fall back to `eventKey`. The section matching already works on
   viagogo's own section labels, so nothing else changes.
5. The drawer already knows its viagogo event id (`VG.eventIdOf(location)`) —
   pass it into `teamAt` next to `eventKey`.

## Undercut alert

A teammate (or an outsider) listing below you in a section you are in is the
case that costs money, and it happens far more often than "only we are here".
Needs a scan to compare against, so it belongs with the drawer, not the
service worker: after a scan, compare each of your sections with the team
prices and offer the same one-press message.

## Display ↔ real price calibration

viagogo shows your $100 listing as $74 to you, and every viewer sees their own
numbers, so display prices cannot be compared between sellers. Your own
listings give the conversion away: the listings page has the real price and
the scan has the display price for the same listing id. One ratio per event
(median over your listings) would let the drawer estimate an outsider's real
price and a teammate's display price — the missing piece for honest ranking.

## Message inbox in the popup

Team messages arrive as a phone push and a desktop notification, and both
vanish. Every one of them is already stored in the `alerts` table, so a
"Messages" list in the popup only needs a read of the last N rows of
`type = 'teamNote'` (`Remote.alertsSince` is close to what is needed).

## Reply from the phone

ntfy can put buttons on a push. A "Done" / "Raised" button posting to the
sender's `cmdTopic` would close the loop without opening Chrome, reusing the
command system that already exists (`bg/commands.js`). A `tell "…"` command
would let a phone start a message too.

## Team view per event

One place listing every section the team is in: who is in it, at what price,
who is cheapest, how many tickets the team holds there. Stops two people
dumping the same sector, and is the natural home for the ideas above.
