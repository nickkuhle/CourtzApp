# Courtz + Google Sheets (simple guide)

## What is already connected

Courtz uses this Apps Script Web App for the **test copy** of the tournament Sheet:

```text
https://script.google.com/macros/s/AKfycbzlHIg__YqQdq9ohWvFdu9wCZZ27S5XPTYeBCV3y9IdDx1AZmZjs7vaV3rcZVz2lFaW6g/exec
```

The connection is built into the Next.js server, so a normal deployment of this branch connects to the test Sheet without another secret setting.

When Courtz opens, it asks the Sheet for:

1. The player list from the `Players` tab.
2. Existing reservations from every court-location tab.
3. **Every date** found in those tabs (past, current and future — empty dates included).
4. **Every court** found on each date (from the court-header rows — empty courts and Barnes Court 6 included).

Bookings are written back to the same Sheet. A booking can contain several
players: the whole group is saved to every 30-minute part of the booking, and
the write either fully succeeds or fully fails (half of a group is never saved).

## What is new in v2.1

- **Booking window (America/Los_Angeles).** Reservations may only be booked or changed for **today and tomorrow**, in San Diego time regardless of the device or server timezone. Past and later dates stay clickable for reviewing but are marked **View only**. Ended 30-minute slots cannot be booked or canceled — the current 30-minute slot stays available (at 1:15 PM, 1:00–1:30 PM is still open, 12:30–1:00 PM is not). These rules are enforced in the UI, the Next.js API, **and** `CourtzAppsScript.gs` (re-checked under the write lock), so they cannot be bypassed.
- **Session limit and staff approval.** A player may hold at most **two practice sessions per day** across all active practice locations. Barnes bookings are 30 minutes, so every Barnes slot is one session and two adjacent Barnes reservations are two back-to-back sessions. At the other locations a continuous 1-hour booking counts as **one** session even though it is stored in two 30-minute Sheet slots (existing consecutive slots are grouped the same way). A new session that is back-to-back with another session, or starts within one hour of another session's start, opens an explicit **tournament-staff approval** prompt ("Confirm — staff approved"). Staff approval bypasses only the close-timing warning — the two-session maximum can never be bypassed. Every player in a multi-player booking is checked.
- **Practice locations.** Barnes, Peninsula and PLNU are shown by default. USD, Balboa and Pacific Beach are match-play sites: hidden by default, available through the **+ Add site** button (any Sheet tab that uses the court-grid layout is discovered automatically), and remembered in the browser. Hidden match-play reservations never count toward practice-session limits unless the site has been deliberately added.
- **Session metadata.** `getSchedule` now also returns `practiceSessions` (per day, per default practice location, per player) and `defaultPracticeLocations`, so the UI can show "X/2 sessions today".

## What was new in v2.0

- **Dates come from the Sheet.** No hardcoded tournament dates. The app shows every date the Sheet defines, sorted, with today selected by default when the Sheet has it. Past dates stay clickable so old reservations can be reviewed.
- **Courts come from the Sheet.** Each date's court-header row defines the courts; empty courts still appear. Barnes Court 6 shows up automatically.
- **Multi-column courts are read and written correctly.** Each court may span several spreadsheet columns (for example Barnes courts occupy two columns each). Every player-name cell belonging to the court is read, and bookings/cancellations write to all of that court's cells. This is what makes the existing Wednesday reservations appear.
- **Find a Court** uses the day selected on the main page, and asks for location, start time and length instead of a fixed time list. Barnes allows 30-minute bookings only; the other locations allow 30 minutes or 1 hour. A 1-hour court is offered only when both of its 30-minute parts are open.
- **Group bookings.** Booking starts with the signed-in player, more players can be searched from the roster and added, and every selected player is shown before confirming. Canceling a slot removes the whole group that was booked there.

## How to test it

1. Open Courtz and wait for the green **Google Sheet connected** message.
2. Pick a player using the **Booking Courts As** search box (clicking it selects the whole name so typing replaces it).
3. Check the day pills: they come from the Sheet and **today should be selected by default**. Days other than today/tomorrow carry a **View only** badge.
4. Pick a day and location, then open a court. Ended time slots show **Ended** and cannot be booked or canceled.
5. Pick an open 30-minute time, add a second player from the roster, and confirm. Both names should appear in the Sheet on that date, court and time.
6. In Courtz, tap that green **Your booking** time again and confirm the cancellation — the whole group disappears from the Sheet.
7. Try **Find a Court** for a non-Barnes venue with length **1 hour**: the 1-hour booking counts as one session and produces no staff-approval warning on its own. Booking a slot right before/after another session of the same player shows the **Tournament staff approval** prompt; only **Confirm — staff approved** continues.
8. Book a third session for the same player on the same day: it must be rejected even with staff approval.
9. Open Barnes in Find a Court: only 30-minute bookings are offered, and two adjacent Barnes reservations count as two sessions (staff approval required).
10. Click **+ Add site** to add a match-play site (e.g. USD): its reservations become visible, the choice survives a reload, and its sessions start counting toward the limit.
11. Days before today or after tomorrow stay clickable for viewing but reject every booking/cancellation.

## How to redeploy the Apps Script (v2.1)

The repository now contains version **2.1.1** of `CourtzAppsScript.gs`. To put it live:

1. Open the **test copy** of the Google Sheet.
2. Click **Extensions → Apps Script**.
3. Delete the old code and paste in all the code from `CourtzAppsScript.gs` in this repository.
4. Click **Save** (Ctrl/Cmd + S).
5. Click **Deploy → Manage deployments**.
6. Find the Web App deployment (the one whose URL starts with `https://script.google.com/macros/s/...`), click the **pencil/edit** icon.
7. Click **New version** and then **Deploy**. (The `/exec` URL stays the same — it belongs to the script, not to a specific version.)
8. Keep these settings:
   - **Execute as:** Me
   - **Who has access:** Anyone

To check which version is live, open:

```text
https://script.google.com/macros/s/AKfycbzlHIg__YqQdq9ohWvFdu9wCZZ27S5XPTYeBCV3y9IdDx1AZmZjs7vaV3rcZVz2lFaW6g/exec?action=ping
```

It should show `"success":true` and `"version":"2.1.1"`.

> If you ever see an old version here, the deployment was not updated (step 6/7) or
> the script code in the Apps Script editor was not saved.

### Debugging a tab layout

If a location's reservations look wrong, the script can dump the raw grid of any tab:

```text
https://script.google.com/macros/s/AKfycbzlHIg__YqQdq9ohWvFdu9wCZZ27S5XPTYeBCV3y9IdDx1AZmZjs7vaV3rcZVz2lFaW6g/exec?action=dumpGrid&sheet=Balboa%20Tennis
```

Use the exact tab name (URL-encoded). It returns `{ success, sheet, values }`
with the raw grid so a layout difference can be inspected.

## What the connection message means

- **Green message:** Courtz reached Google Sheets. It is safe to make bookings.
- **Yellow warning:** Courtz could not reach Google Sheets. Do not make a booking yet. Press **Try again**.

If the yellow warning stays:

1. Open the `ping` link above.
2. If Google asks for a login instead of showing a short JSON message, redeploy the script with **Who has access: Anyone**.
3. If the ping link works, restart or redeploy the Next.js app.

## Switching from the test copy to the real Sheet

Do this only after testing is complete:

1. Put `CourtzAppsScript.gs` into the real Sheet's Apps Script project.
2. At the top of that file, change `SHEET_ID` to the ID of the real Sheet.
3. Deploy it as a Web App with **Execute as: Me** and **Who has access: Anyone**.
4. Copy its new `/exec` URL.
5. In the app host (for example, Vercel), set `SHEETS_WEBAPP_URL` to that new URL and redeploy Courtz.

The environment setting replaces the built-in test URL, which helps prevent accidental changes to the real Sheet while testing.

## Safety note

Treat the Apps Script `/exec` URL like a key. Anyone who has it may be able to change reservations. Do not post the real Sheet's URL publicly.
