# Courtz

Courtz is the practice-court scheduler for the USTA Girls' National Championships.

## Google Sheet connection

The app is already connected to the **test copy** of the tournament Google Sheet through the Apps Script URL supplied for testing.

- Opening Courtz reads the player list and all existing reservations from the Sheet.
- Booking or canceling in Courtz changes the Sheet.
- Returning to the browser tab refreshes reservations that were edited directly in Google Sheets.
- A green **Google Sheet connected** message means it is safe to make bookings.
- A yellow warning means the app cannot reach Google Sheets; do not make bookings until the connection returns.

The connection URL is used only by the Next.js server. When it is time to switch from the test copy to the real tournament Sheet, set the host's `SHEETS_WEBAPP_URL` environment variable to the real Sheet's Apps Script `/exec` URL and redeploy.

See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) for the step-by-step setup and troubleshooting guide.
