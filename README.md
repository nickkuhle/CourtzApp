# Courtz

Courtz is the practice-court scheduler for the USTA Girls' National Championships.

## Google Sheet connection

The app is connected to the **test copy** of the tournament Google Sheet through the Apps Script URL supplied for testing.

- Opening Courtz reads the player list, every reservation, **every date** (past, current and future) and **every court per date** (empty courts included — such as Barnes Court 6) from the Sheet. Nothing is hardcoded.
- Booking or canceling in Courtz changes the Sheet. A booking can include several players; the whole group is saved to every 30-minute part atomically, so a half-saved group never happens.
- Returning to the browser tab refreshes reservations that were edited directly in Google Sheets.
- A green **Google Sheet connected** message means it is safe to make bookings.
- A yellow warning means the app cannot reach Google Sheets; do not make bookings until the connection returns.

The connection URL is used only by the Next.js server. When it is time to switch from the test copy to the real tournament Sheet, set the host's `SHEETS_WEBAPP_URL` environment variable to the real Sheet's Apps Script `/exec` URL and redeploy.

## Development

```bash
npm install
npm run dev      # start the dev server on 0.0.0.0:3000
npm test         # parser + adapter tests (node --test)
npm run build    # production build
```

### GitHub Codespaces on iPhone or iPad

The Codespaces configuration forwards port 3000 as **HTTP** and shows a
notification instead of loading the app in VS Code's embedded Simple Browser.
This is intentional: the embedded preview and its private-port authentication
handoff are unreliable in some iOS/iPadOS browser sessions.

After the terminal says `Ready`:

1. Tap **Open in Browser** in the forwarded-port notification, or open the
   **Ports** panel and tap the globe icon for **Courtz web app (3000)**.
2. Open the generated `https://<codespace-name>-3000.app.github.dev` address.
   Do not browse to `localhost:3000`, and do not choose **Preview in Editor**.
3. In the Ports panel, leave **Port Protocol** set to **HTTP**. The public-facing
   URL is still HTTPS; Codespaces terminates HTTPS before proxying plain HTTP to
   the Next.js development server.
4. Sign in to GitHub in the same non-private browser session if prompted. A
   private forwarded port depends on GitHub's authentication cookie.

If iOS offers to download the extensionless port URL, cancel the download,
close the embedded preview, copy the forwarded address from the Ports panel,
and paste it into a new normal Safari tab. Temporarily disable a content blocker
for `github.com` / `app.github.dev` if it prevents the authentication redirect.
Do not make this app's port public as a workaround: the development app can
write tournament reservations.

Changes to `.devcontainer/devcontainer.json` apply to new codespaces. For an
existing codespace, run **Codespaces: Rebuild Container** from the command
palette before retesting.

`scripts/mock-apps-script.mjs` is a local mock of the Apps Script backend used
for integration testing:

```bash
node scripts/mock-apps-script.mjs            # terminal 1
SHEETS_WEBAPP_URL=http://127.0.0.1:3100/exec npm run dev   # terminal 2
```

### Booking rules (v2.1)

- Bookings and cancellations are only allowed for **today and tomorrow** (America/Los_Angeles). Other days are marked **View only**, and ended 30-minute slots cannot be changed. Enforced in the UI, the Next.js API, and `CourtzAppsScript.gs`.
- Max **2 practice sessions per player per day**. Barnes slots each count as one session; a continuous 1-hour booking elsewhere counts as one session. Back-to-back/close sessions require an explicit tournament-staff approval ("Confirm — staff approved"); the 2-session maximum can never be bypassed.
- Barnes, Peninsula and PLNU are shown by default; USD, Balboa and Pacific Beach stay hidden (match-play sites) and can be added with **+ Add site**.

### Finding a player's reservations

The **Player's reservations** button lives in the utility row in the page body
(next to the Sheet connection light and the last-refreshed timestamp), not in
the navbar. It searches every loaded date and location — including the hidden
match-play sites — and splits the results into Past / Current-today / Upcoming.

Names are searchable in **both** forms: the canonical Sheet value
`Abbey, Stephanie` and the displayed `Stephanie Abbey`. The value used for
matching and for any Sheet write is always the canonical roster entry; the app
never writes a reformatted name back to the Sheet.

### Reservation index

`lib/reservation-index.js` walks the reservations map **once** per schedule
refresh (`buildReservationIndex`, memoized in `pages/index.js`) and hands the
same index to `CourtGrid`, `CourtSchedule` and `PlayerReservationsModal`. It is
read-only display infrastructure — booking validation still runs through
`lib/booking-rules.js` with canonical names.

The bookable `/api/schedule` payload deliberately omits 30-minute slots that
have already ended, so the API also returns a read-only `history` payload (the
existing Apps Script `getAll` action) purely so past sessions remain searchable.

### Styling

Tailwind is **compiled at build time** via `tailwind.config.js` +
`postcss.config.js` + the directives in `global.css`. There is no runtime
dependency on `cdn.tailwindcss.com`. Content scanning covers `pages/`,
`components/` and `lib/` (the per-player color classes live in
`lib/schedule-display.js`).

The schedule auto-refreshes about every 60 seconds while the tab is visible,
with a manual **Refresh** button and a last-refreshed timestamp shown in PT.

See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) for the step-by-step setup,
testing checklist, and the instructions for redeploying the Apps Script (v2.1).
