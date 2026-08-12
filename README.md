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

See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) for the step-by-step setup,
testing checklist, and the instructions for redeploying the Apps Script (v2.0).
