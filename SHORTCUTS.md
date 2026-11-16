# iPhone Shortcut

How to build one iOS Shortcut that sends every Seat Tracker phone command in a few taps. The answer
arrives as a normal push on your phone, like any command link (COMMANDS.md).

- [The idea: build the text, send once](#the-idea-build-the-text-send-once)
- [What changes from your current Shortcut](#what-changes-from-your-current-shortcut)
- [Before you start](#before-you-start)
- [1. The top menu](#1-the-top-menu)
- [2. Each menu item](#2-each-menu-item)
- [3. The send block](#3-the-send-block)
- [4. The "extras" loop](#4-the-extras-loop-conditions-and-a-loop)
- [5. Optional: one helper Shortcut for the loop](#5-optional-one-helper-shortcut-for-the-loop)
- [One-tap Shortcuts](#one-tap-shortcuts-home-screen-widget-siri-back-tap)
- [Troubleshooting](#troubleshooting)

Action names are the ones in the Shortcuts app on iOS 17 and 18.

**How the steps are written**

```
Action name   setting: value                 → rename the result to [Name]
    indented actions are inside the item, If or Repeat above them
[Name]        a magic variable you insert by tapping it
```

---

## The idea: build the text, send once

Every item in the menu only **makes the command text**. The menu hands that text on as
**Menu Result** (the output of the last action in the item you picked). One block after the menu
encodes it and sends it.

```
Choose from Menu
    Status   → Text: get
    Scan     → … → Text: scan event=2 sec=A1 qty=4
    Mute     → Text: mute 60
    …
End Menu
URL Encode             [Menu Result]
Get Contents of URL    https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=[URL Encoded Text]
```

This gives you:

- **The topic is written once.** Changing it later is one edit.
- **One send block** instead of URL + Open URL copied into every item.
- **No Safari page.** Get Contents of URL sends in the background; Open URLs opens a browser tab every
  time.
- **No link rules.** URL Encode takes care of spaces, `&`, `#`, quotes and `/`, so you never type `+`.
  The one thing to remember is that a space *inside* a value (a client name, a sector name) must be `_`,
  and the Shortcut below does that for you.

---

## What changes from your current Shortcut

| Now | Better |
|---|---|
| `URL` + `Open URL` repeated in every item | each item ends with one `Text`; one send block after `End Menu` |
| `Open URL` opens Safari every time | `Get Contents of URL` sends silently |
| `get` asks for text | `get` needs nothing; one tap |
| `add` asks you to type the whole command | asks event, sector, tickets as numbers/text, then lets you pick extras from a list |
| `scan` only scans everything | a small menu: everything, one event, one request, one sector, all sectors |
| — | Edit, Done / Reopen / Delete, Mute, Auto-check per event, Type a command |

Also update the topic to your **Seat Tracker shortcuts topic** (popup → Phone). The old eBileta topic
is no longer read.

---

## Before you start

1. **Your shortcuts topic.** Popup → Phone → Shortcuts topic. It goes into the send block only.
2. **Rename magic variables.** When you insert a result like *Provided Input* into a Text action, tap it
   → **Rename** (e.g. `Event`, `Sector`, `Qty`). With several questions in one item this is the only way
   to keep them apart.
3. **Numbers.** In **Ask for Input** set *Input Type* to **Number** for event numbers, request numbers and
   tickets. You get the number pad and can't send a letter by mistake. Give it a **Default Answer**
   (e.g. `0` or `2`) so you can just tap Done.
4. **Canceling** any question or menu stops the whole Shortcut; nothing is sent.

---

## 1. The top menu

Add **Choose from Menu**, prompt `Seat Tracker`, and these items, most used first:

```
Choose from Menu   prompt: Seat Tracker
    Status
    Scan
    Add request
    Edit request
    Done · Reopen · Delete
    Mute
    Auto-check for an event
    Events
    Prices
    Type a command
    More
End Menu
```

---

## 2. Each menu item

Every item ends with the finished command as its **last action**. The last line under each item shows
what gets sent.

### Status

```
Text: get
```
Sends `get`: every open request, grouped by event.

### Scan

```
Choose from Menu   prompt: Scan what?
    Everything
        Text: scan
    One event
        Ask for Input   Number   prompt: Event number                → [Event]
        Text: scan event=[Event]
    One request
        Ask for Input   Number   prompt: Request #                   → [Req]
        Text: scan req=[Req]
    One sector
        Ask for Input   Number   prompt: Event number                → [Event]
        Ask for Input   Text     prompt: Sector (e.g. A1, E105, a)   → [Sector]
        Ask for Input   Number   prompt: Tickets (0 = just free seats)   default: 0   → [Qty]
        If [Qty] is greater than 0
            Text: scan event=[Event] sec=[Sector] qty=[Qty]
        Otherwise
            Text: scan event=[Event] sec=[Sector]
        End If
    All sectors
        Ask for Input   Number   prompt: Event number                → [Event]
        Ask for Input   Number   prompt: Tickets per group   default: 2   → [Qty]
        Text: scan event=[Event] all qty=[Qty]
End Menu
```

The **If** is the first condition: with `0` tickets you get free seats and the longest block; with a
number you get how many groups fit. An **If** passes on the output of the side that ran, so the menu
still ends with the right text.

### Add request

```
Ask for Input   Number   prompt: Event number (0 = the only event)   default: 0   → [Event]
Ask for Input   Text     prompt: Sector                              → [Sector]
Replace Text    find: (a space)   replace: _   in [Sector]           → [SectorArg]
Ask for Input   Number   prompt: Tickets   default: 2                → [Qty]
If [Event] is greater than 0
    Text: event=[Event]
Otherwise
    Nothing
End If                                                               → [EventArg]
Choose from Menu   prompt: Anything else?
    No, add it
        Nothing
    Client, price, warns…
        (the extras loop — section 4, list: listing, client, price, warn, opts, together)
End Menu                                                             → [Extras]
Text: add [EventArg] sec=[SectorArg] qty=[Qty] [Extras]
```

- `0` leaves `event=` out. That works whenever only one event has open requests (COMMANDS.md →
  Numbers). With more than one, the answer lists your events so you can try again.
- Empty variables leave extra spaces behind; the extension ignores them.

Example sent: `add event=3 sec=D1 qty=2 listing=12345678 client=Ana_K price=65/55`

### Edit request

```
Ask for Input   Number   prompt: Request #                           → [Req]
(the extras loop — section 4, list: qty, listing, sec, price, client, warn, opts, together)   → [Extras]
Text: edit req=[Req] [Extras]
```

Example sent: `edit req=3 qty=12 warn=4`

### Done · Reopen · Delete

```
Choose from Menu   prompt: Which?
    Mark done
        Ask for Input   Number   prompt: Request #   → [Req]
        Text: done req=[Req]
    Reopen
        Ask for Input   Number   prompt: Request #   → [Req]
        Text: undo req=[Req]
    Delete request
        Ask for Input   Number   prompt: Request #   → [Req]
        Text: del req=[Req]
    Delete event (no open requests)
        Ask for Input   Number   prompt: Event number   → [Event]
        Text: del event=[Event]
End Menu
```

### Mute

A menu that only returns text needs no questions at all:

```
Choose from Menu   prompt: Mute alerts for
    30 min      Text: mute 30
    1 hour      Text: mute 60
    3 hours     Text: mute 180
    8 hours     Text: mute 480
    Unmute      Text: unmute
End Menu
```

### Auto-check for an event

Here the inner menu returns just **the value**, and one Text after it builds the command:

```
Ask for Input   Number   prompt: Event number   → [Event]
Choose from Menu   prompt: Scan it every
    1 min             Text: 1
    2 min             Text: 2
    5 min             Text: 5
    15 min            Text: 15
    Off               Text: 0
    Back to default   Text: default
End Menu                                        → [Poll]
Text: set event=[Event] poll=[Poll]
```

### Events

```
Text: events
```

### Prices

Posttick events only.

```
Ask for Input   Number   prompt: Event number   → [Event]
Choose from Menu   prompt: Prices for
    Whole event
        Text: prices event=[Event]
    One sector
        Ask for Input   Text   prompt: Sector   → [Sector]
        Text: prices event=[Event] sec=[Sector]
End Menu
```

### Type a command

For anything the menu doesn't cover:

```
Ask for Input   Text   prompt: Command   default: get
```

Type it as in COMMANDS.md, but with real spaces (no `+`). Use `_` for spaces inside a name
(`client=Ana_K`) or put the name in quotes (`client="Ana K"`).

### More

```
Choose from Menu   prompt: More
    Ping       Text: ping
    Settings   Text: settings
    Help       Text: help
End Menu
```

---

## 3. The send block

After the top menu's **End Menu**, add:

```
URL Encode            Encode   [Menu Result]
Get Contents of URL   URL: https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=[URL Encoded Text]
                      Method: GET
Show Notification     title: Sent   body: [Menu Result]          (optional)
```

- **URL Encode** placed right after End Menu already takes the Menu Result as its input.
- **Get Contents of URL** returns ntfy's receipt; you don't need to do anything with it.
- The answer arrives as a push within about **30–60 seconds** (the extension checks every 30 s).
  Scans take longer.

---

## 4. The "extras" loop (conditions and a loop)

Used by **Add** and **Edit**. You tick the fields you want from a list, and the Shortcut asks only
for those.

```
List                 items: listing · client · price · warn · opts · together        (Add)
                     items: qty · listing · sec · price · client · warn · opts · together   (Edit)
Choose from List     prompt: Set what?   Select Multiple: on
Repeat with Each     [Chosen Item]
    If [Repeat Item] is together
        Choose from Menu   prompt: Seats side by side?
            On    Text: on
            Off   Text: off
        End Menu
    Otherwise
        Ask for Input   Text   prompt: [Repeat Item]
        Replace Text    find: (a space)   replace: _   in [Provided Input]
    End If                                                               → [Value]
    Text: [Repeat Item]=[Value]
    Add to Variable   Extras
End Repeat
Combine Text         [Extras]   separator: Spaces
```

What each part does:

| Part | Why |
|---|---|
| **Choose from List** with *Select Multiple* | one screen to pick several fields; no empty answers to deal with |
| **Repeat with Each** | asks once per picked field, in order |
| **If … is together** | on/off is a tap, not typing |
| **Replace Text** space → `_` | `client=Ana K` becomes `client=Ana_K`, which the extension turns back into "Ana K" |
| **Add to Variable** + **Combine Text** | collects `client=Ana_K` `price=65/55` … into one line |

What to type for each field:

| Field | Type | Example |
|---|---|---|
| `listing` | viagogo listing ID (`_` clears it) | `12345678` |
| `client` | a name | `Ana K` |
| `price` | a price, several with `/`, or `all` | `65`, `65/55`, `all` |
| `warn` | block warning | `2` |
| `opts` | options warning, 0 = off | `3` |
| `qty` | tickets | `8` |
| `sec` | sector | `A1` |
| `together` | picked from the menu | on / off |

Pick at least one field in the list. If you want none, choose **No, add it** in the menu before it
(Add), or cancel (Edit).

**Nicer prompts (optional):** add a **Dictionary** before the loop with
`client → Client name`, `price → Price: 65, 65/55 or all`, `warn → Block warning`, and so on. Inside the
loop, use **Get Dictionary Value** for key [Repeat Item] as the Ask for Input prompt.

---

## 5. Optional: one helper Shortcut for the loop

Add and Edit use the same loop. To keep it in one place:

1. Create a Shortcut named **Seat fields**:

   ```
   Split Text         [Shortcut Input]   separator: Custom ","
   Choose from List   prompt: Set what?   Select Multiple: on
   Repeat with Each   [Chosen Item]
       … the same If / Ask / Replace / Text / Add to Variable as section 4 …
   End Repeat
   Combine Text       [Extras]   separator: Spaces
   Stop and Output    [Combined Text]
   ```

2. In the main Shortcut, replace the loop in **Add** with:

   ```
   Text: listing,client,price,warn,opts,together
   Run Shortcut   Seat fields   input: [Text]
   ```

   and in **Edit** with the same, using `qty,listing,sec,price,client,warn,opts,together`.

If [Shortcut Input] comes through empty when you test it, open **Seat fields** → ⓘ and allow it to
receive **Text**.

---

## One-tap Shortcuts (Home Screen, widget, Siri, Back Tap)

For the commands you send most often, a separate Shortcut with **one action** is fastest. No menu, no
encoding; here spaces are written as `+`:

| Shortcut name (also the Siri phrase) | The one action: Get Contents of URL |
|---|---|
| Seats status | `https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=get` |
| Seats scan | `https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=scan` |
| Seats mute | `https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=mute+60` |
| Seats unmute | `https://ntfy.sh/YOUR-SHORTCUTS-TOPIC/publish?message=unmute` |

Where to put them:

- **Home Screen:** open the Shortcut → Share → **Add to Home Screen**.
- **Widget:** long-press the Home Screen → **+** → Shortcuts → pick a folder with these.
- **Siri:** say the Shortcut's name, e.g. "Seats status".
- **Back Tap:** Settings → Accessibility → Touch → Back Tap → Double Tap → pick "Seats status".

---

## Troubleshooting

| What you see | Why / fix |
|---|---|
| Nothing arrives at all | Chrome must be running and the computer awake. Send **More → Ping**. Check that the topic in the send block is the **command** topic, and that a **push** topic is set in the popup. |
| The answer takes a minute | Normal: the extension checks every 30 s, and scans take longer. |
| `Command failed … Say which event` | More than one event has open requests: enter the event number instead of `0`. |
| `Command failed … unknown sector` | Type the short code (`A1`, `E105`, `a` for A TRIBINE). A space inside a name must be `_`; the Add item already replaces it. |
| `Command failed … matches 6 sectors` | Be more specific: `A1`, not `A`. |
| `Command failed … No price` | Use a price that exists (send **Prices**), several joined with `/`, or `all`. |
| The same command ran twice | Not possible from the extension's side (each message runs once). Check the Shortcut doesn't have two send blocks. |
| A command sent while the computer slept did nothing | Commands older than 10 minutes are skipped on purpose. Send it again. |
