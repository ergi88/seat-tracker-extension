# Phone commands

Control Seat Tracker from your phone by opening a link. The answer comes back as a push on your
**ntfy topic**. Test any command first in the popup: **Phone → Try a command**.

- [How it works](#how-it-works)
- [Building a link](#building-a-link)
- [Numbers: events and requests](#numbers-events-and-requests)
- [Look](#look): `help` · `ping` · `get` · `events` · `prices`
- [Scan](#scan): `scan`
- [Change requests](#change-requests): `add` · `edit` · `done` · `undo` · `del`
- [Alerts and settings](#alerts-and-settings): `mute` · `unmute` · `settings` · `set`
- [Quick reference](#quick-reference)

Building an iPhone Shortcut for these commands? See **[SHORTCUTS.md](SHORTCUTS.md)**.

In the links below replace **`YOUR-SHORTCUTS-TOPIC`** with your own shortcuts topic. The popup shows your
ready-made `get` link under **Phone**.

---

## How it works

1. You open a link. It posts the command text to your **shortcuts topic** on ntfy.
2. Every 30 seconds the extension reads that topic and runs any new command.
3. The answer arrives as a notification on your **ntfy topic**.

You need:

- Chrome running and the computer awake.
- A **ntfy topic** (Settings → Phone). Without it commands still run, but you get no answer.
- A **shortcuts topic** (Settings → Phone). Empty turns commands off.

Good to know:

- Answers take about **30–60 seconds**; scans take longer (eBileta ≈ 1 second per sector).
- Commands **older than 10 minutes are skipped** (sent while the computer slept or Chrome was closed).
- At most 10 commands run per check, oldest first, each exactly once.
- Something wrong → **Command failed** with the reason, e.g. `There is no request #9.`
- Opening a link shows a small block of text in the browser. That only confirms ntfy got it.
- The **Scan again**, **Mark done** and **Stop** buttons on alerts send these same commands for you.

> **Keep the shortcuts topic secret.** Anyone who knows it can add, change and delete requests.

---

## Building a link

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=<command>
```

A command is a word, then `key=value` arguments:

```
add event=1 sec=A1 qty=4 client=Ana_K
```

| In the command | In the link | Example |
|---|---|---|
| space | `+` | `get event=1` → `message=get+event=1` |
| space inside a name | `_` | `client=Ana_K` is saved as "Ana K" |
| `,` | `,` (works like a space) | `edit+req=3,qty=12` |
| `&` or `#` | **never** | `&` cuts the link, `#` hides the rest |

- Upper or lower case does not matter.
- Sectors match loosely: `E105`, `e105`, `TRIBUNA_E105`; on eFinity `a` = `A TRIBINE`, `bs12` = `BARSKI STO 12`;
  on Posttick `a1` = `Block A1`.
- Arguments can be in any order. `client=_` clears a client name.
- Also accepted: `status`/`list` = `get`, `check` = `scan`, `rm`/`delete` = `del`, `reopen` = `undo`,
  `item=` / `n=` = `req=`, `cat=` / `eur=` = `price=`.

Without a link: `curl -d "get" https://ntfy.sh/YOUR-SHORTCUTS-TOPIC`, or type into the ntfy app.

---

## Numbers: events and requests

| Thing | Looks like | Argument | Where you see it |
|---|---|---|---|
| Event | `[1]`, `[2]` … | `event=1` | popup, sidebar, every alert, `events` |
| Request | `#1`, `#2` … | `req=3` | popup, sidebar, every alert, `get` |
| Event by site id | `2160` | `site=ebileta eid=2160` | the `idEvento=` in an eBileta link, the `events` list |

Numbers never change and are **never reused**, not even after a delete.

**`event=` is optional** when only one event has open requests (or only one event is known). If it
is ambiguous you get the list of events to pick from.

---

## Look

### `help`

The list of commands.

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=help
```

### `ping`

Is it running? Open requests, time of the last scan, and whether alerts are muted.

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=ping
```

### `get`

Every open request, grouped by event. **Does not scan** — use `scan` for fresh numbers.

| Arguments | |
|---|---|
| none | every event with open requests |
| `event=1` | one event |
| `req=3` | one request |

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=get
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=get+event=1
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=get+req=3
```

```
Requests · 3 open
[1] Max Amini - 27.11.2026 - 9:30 PM
🟢 #2 A1 ×4 OK — 12 options

[2] Shqiperi - Bjellorusi
🟠 #1 E105 ×10 LOW — 3 options
🔴 #4 W101 ×5 SHORT — 0 options
```

### `events`

Your events with their numbers, then events on the site's list you are not tracking yet (eBileta).
Refreshes that list first. `events all` also shows archived events and events no longer listed.

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=events
```

### `prices`

Posttick only: every price with its free seats, per sector.

| Arguments | |
|---|---|
| `event=1` | optional when only one event has open requests |
| `sec=D1` | one sector |

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=prices+sec=D1
```

---

## Scan

### `scan`

| Form | Does | Answers with |
|---|---|---|
| `scan` | every open request, every event | their lines |
| `scan event=1` | that event's open requests (every sector if it has none) | the lines |
| `scan req=3` | that request's sector | its line |
| `scan event=1 sec=A1 qty=10` | any sector | your requests there + `A1 ×10 — 3 options` |
| `scan event=1 sec=A1` | any sector | free seats and longest block |
| `scan event=1 all qty=10` | every sector (eBileta skips its own sold-out ones) | `A1 — 3 options` per sector, most first, top 40 |
| `scan event=1 all` | every sector | longest block per sector |
| add `price=65` or `price=65/55` | Posttick: count only seats at those prices | |

Scans also run the normal alert checks. A scan always reads the site again, even if another PC just
scanned; `scan` and `scan event=1` also count as that event's auto-check, so the next one comes a full
interval later.

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=scan
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=scan+req=3
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=scan+event=2+sec=E105+qty=10
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=scan+event=1+all+qty=4+price=65
```

---

## Change requests

### `add`

Adds a request, scans its sector and answers with its line. Only `sec` is required (and `event` when
it is ambiguous).

| Argument | Default |
|---|---|
| `sec=A1` | required |
| `event=1` or `site=ebileta eid=2160` | the only event with open requests |
| `qty=4` | 1 |
| `client=Ana_K` | empty |
| `warn=2` | Settings → default block warn |
| `opts=3` | Settings → default options warn |
| `together=on` | Settings → side by side |
| `price=65` or `price=65/55` | Posttick: all prices (several prices: separate with `/`) |
| `listing=12345678` | empty — your viagogo listing ID; alerts about this request get a listing button |

`eid=` works for an event that is not tracked yet: it is added on the spot.

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=add+event=1+sec=A1+qty=4+client=Ana_K
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=add+site=ebileta+eid=2160+sec=E105+qty=10
```

### `edit`

Change any of `qty`, `warn`, `opts`, `client`, `listing`, `together`, `price`, `sec` (`listing=_` clears
the listing). Editing starts a fresh alert
baseline, so the edit itself never alerts.

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=edit+req=3+qty=12+warn=4+opts=2
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=edit+req=5+price=all
```

### `done` · `undo` · `del`

| Command | Does |
|---|---|
| `done req=3` | finished: no longer scanned or alerted |
| `undo req=3` | reopen and scan it |
| `del req=3` | delete it; its number is retired |
| `del event=4` | delete an event that has no open requests (its done requests go with it) |

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=done+req=3
```

---

## Alerts and settings

### `mute` · `unmute`

`mute 60` silences every alert (desktop and phone) for 60 minutes; `mute` alone = 60. Command answers
still arrive. `unmute` ends it.

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=mute+120
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=unmute
```

### `settings`

Every setting that can be changed from the phone.

### `set`

| Key | Values | Setting |
|---|---|---|
| `poll` | minutes, 0 = off | auto-check |
| `newevents` | minutes, 0 = off | new-event check |
| `together` | on / off | default for new requests |
| `warn` · `opts` | number | defaults for new requests |
| `notify` | on / off | desktop notifications for every type |
| `summary` | `off` · `every` · `daily` · `daily@09:00` | summary |
| `quiet` | on / off / `23:00-08:00` | quiet hours |
| `cooldown` | minutes, 0 = off | cooldown |
| `confirm` | on / off | confirm "No longer fillable" |
| `buttons` | on / off | notification buttons |
| `theme` | system / light / dark | theme |
| `sidebar` | push / overlay | sidebar mode |

**One event's auto-check:** `set event=1 poll=2` (every 2 min), `poll=0` (off for that event),
`poll=default` (follow the setting above). Only `poll` can be set per event.

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=set+event=1+poll=1
```

Topics and the per-type phone switches can only be changed in the popup.

```
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=set+poll=3+summary=daily@08:30
https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=set+quiet=23:30-07:00
```

---

## Quick reference

```
help · ping · settings · events [all]
get [event=1 | req=3]
prices [event=1] [sec=D1]
scan [event=1 | req=3] [sec=A1] [all] [qty=10] [price=65]
add [event=1 | site=ebileta eid=2160] sec=A1 [qty=4 client=Ana_K warn=2 opts=3 together=on price=65/55 listing=12345678]
edit req=3 [qty= warn= opts= client= listing= together= price= sec=]
done req=3 · undo req=3 · del req=3 · del event=4
mute [minutes] · unmute
set poll=5 newevents=30 together=on warn=2 opts=3 notify=on summary=daily@09:00 quiet=23:00-08:00 cooldown=10 confirm=on buttons=on theme=dark sidebar=push
set event=1 poll=2 · set event=1 poll=0 · set event=1 poll=default
```
