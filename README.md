# Courtz App

Hello and welcome to the Courtz App!

This is for scheduling tennis courts.

Designed and built by Nick Kuhle.

Hit me with any questions or feedback!

## Running the app

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Connecting to your Google Sheets document

The app can read its roster, sites, and schedule directly from your Google
Sheets document, and every booking you make in the app is written back to the
spreadsheet.

Follow the complete walkthrough in **[GOOGLE_SHEETS_INTEGRATION.md](./GOOGLE_SHEETS_INTEGRATION.md)**.
In short:

1. Add `Roster`, `Sites`, and `Reservations` tabs to your spreadsheet.
2. Create a Google Cloud service account and enable the Google Sheets API.
3. Share the spreadsheet with the service account email (Editor).
4. Copy `.env.example` to `.env.local` and fill in your spreadsheet ID and
   service account credentials.

Until `.env.local` is configured, the app runs on the built-in
`data/reservations.json` store with the placeholder roster.
