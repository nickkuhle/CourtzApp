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
npm run dev      # start the dev server
npm test         # parser + adapter tests (node --test)
npm run build    # production build
```

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

See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) for the step-by-step setup,
testing checklist, and the instructions for redeploying the Apps Script (v2.1).
