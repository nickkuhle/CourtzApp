# Connecting CourtzApp to Google Sheets

This guide walks you through pointing the CourtzApp at **your** Google Sheets
document so the app reads your real roster and sites, and every booking you
make in the app is written straight into the spreadsheet — no more typing
players into Sheets by hand.

**What you'll end up with:**

| App data | Source |
|---|---|
| Player roster (the "Signed in as" dropdown) | `Roster` tab |
| Sites + court numbers (the location dropdown & court grid) | `Sites` tab |
| All bookings (the schedule) | `Reservations` tab |

The app connects using a **Google Service Account** — a machine identity that
Google issues to your project. You share your spreadsheet with it once, and the
app can then read and write the sheet with no login prompts. Since you're the
only user, there are no passwords, no OAuth screens, nothing to type when you
open the app.

> ⚠️ **Total time: ~15 minutes.** You'll do this once; after that the app just
> works. The steps below include everything you need — there's no coding
> required.

---

## How it works (60-second version)

```
You click "Book" in the app
        │
        ▼
/API route in your app (Next.js server)
        │
        ▼
Google Sheets API ──► your spreadsheet
        │                  │
        ▼                  ▼
App reads roster/sites  "Reservations" tab gets
& bookings from here    one row per booking
```

The code for this is already written and lives in `lib/sheets.js`. Your only
jobs are: (1) make the spreadsheet have 3 small tabs, (2) create a service
account, (3) share the sheet with it, (4) paste 3 values into a file. Steps
below.

---

## Step 1 — Set up your spreadsheet (one time, ~5 min)

Your spreadsheet needs **3 tabs** with these exact names and header rows. The
app looks them up by name, and reads data by the header labels.

### Tab 1: `Roster` — every player who may be booked

Header row (row 1), then one player name per row:

| Name |
| --- |
| Nina Carter |
| Tess Monroe |
| Zadie Brooks |

### Tab 2: `Sites` — which courts exist at each site

Header row, then one row per court:

| Location | Court |
| --- | --- |
| Barnes Tennis Center | 4 |
| Barnes Tennis Center | 5 |
| Peninsula Tennis Club | 1 |
| Peninsula Tennis Club | 2 |
| Point Loma Nazarene College | 1 |

> Tip: if you already have the site/court list somewhere in your sheet, just
> copy it into a `Sites` tab with the `Location` / `Court` headers.

### Tab 3: `Reservations` — the live schedule (the app reads AND writes this one)

Header row, then **one row per player booking**:

| Date | Location | Court | Slot | Player |
| --- | --- | --- | --- | --- |
| 2026-08-10 | Barnes Tennis Center | 4 | 8:00 AM–8:30 AM | Nina Carter |
| 2026-08-10 | Barnes Tennis Center | 4 | 8:00 AM–8:30 AM | Tess Monroe |

Notes:

- `Date` uses the format `YYYY-MM-DD` (e.g. `2026-08-10`).
- `Slot` uses the same label the app shows, e.g. `8:00 AM–8:30 AM` (it's a
  regular hyphen `-` surrounded by en-dashes `–`; safest tip: **copy the slot
  text from the app**, or leave the tab empty and let the app create rows).
- You can leave `Reservations` completely empty to start — the app adds rows as
  you book courts. It also reads any rows already there, so if you have an
  existing schedule in this exact format, it will show up in the app.

> **Using different tab names?** You don't have to rename your tabs. Set
> `GOOGLE_SHEETS_ROSTER_TAB`, `GOOGLE_SHEETS_SITES_TAB` and
> `GOOGLE_SHEETS_RESERVATIONS_TAB` in `.env.local` (Step 4) to whatever your
> tabs are called.
>
> **Your existing schedule format differs?** The app manages the `Reservations`
> tab in the format above. Your other tabs and columns are never touched or
> overwritten — only the `Reservations` rows for the exact date/location/court
> you book are updated.

---

## Step 2 — Create a Google Cloud service account (one time, ~7 min)

The service account is how the app proves its identity to Google. It's free
and takes a few clicks.

1. Go to **https://console.cloud.google.com** and sign in with the Google
   account that owns your spreadsheet.
2. If you don't have a project, create one:
   - Click the project dropdown (top-left) → **New Project** → name it
     (e.g. `courtz-app`) → **Create**.
3. **Enable the Google Sheets API:**
   - In the left menu: **APIs & Services → Library**.
   - Search for **Google Sheets API** → click it → **Enable**.
4. **Create the service account:**
   - In the left menu: **APIs & Services → Credentials**.
   - Click **+ Create Credentials → Service account**.
   - Name it (e.g. `courtz-app`) → **Create and Continue** (you can skip the
     optional grant roles) → **Done**.
5. **Download the key file:**
   - On the **Service accounts** list, click your new service account.
   - Click the **Keys** tab → **Add Key → Create new key**.
   - Choose **JSON** → **Create**. A file like
     `courtz-app-1234567890ab.json` downloads to your computer.
     **Keep this file safe — it's the app's login.** (You only need two values
     from it; you can delete the file after Step 4 if you like, as long as you
     saved the values.)

You now have a service account email that looks like
`courtz-app@your-project.iam.gserviceaccount.com` — you'll need it in Step 3
and Step 4.

---

## Step 3 — Share your spreadsheet with the service account (one time, ~1 min)

The service account is like a robot user. You have to invite it to the
document, or it gets a 403 "permission denied" error.

1. Open your spreadsheet in Google Sheets.
2. Click **Share** (top-right).
3. Paste the service account email
   (from Step 2 / from the JSON key: the `client_email` field).
4. Set permission to **Editor** (so the app can both read and write bookings).
5. Uncheck "Notify people" and click **Share**. It's fine that the email isn't
   a real person's email — Google accepts it.

---

## Step 4 — Put the credentials into the app (one time, ~2 min)

1. Open the JSON key file you downloaded in Step 2 with any text editor.
2. Find these two values:

   - `"client_email"` → looks like `courtz-app@your-project.iam.gserviceaccount.com`
   - `"private_key"` → a long string starting with `-----BEGIN PRIVATE KEY-----`
     and ending with `-----END PRIVATE KEY-----\n`

3. Also grab your **spreadsheet ID**: open your sheet in a browser and copy the
   long string in the URL between `/d/` and `/edit`.
   `https://docs.google.com/spreadsheets/d/`**`1AbC...xyz`**`/edit`

4. In the project folder, create a file named **`.env.local`** (the repo
   already ignores it from Git, so your key never gets committed). Paste:

```bash
# .env.local
GOOGLE_SPREADSHEET_ID=1AbC...your-spreadsheet-id...xyz
GOOGLE_SERVICE_ACCOUNT_EMAIL=courtz-app@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...your-long-key...\n-----END PRIVATE KEY-----\n"
```

**Important:** the private key must stay on **one line**, with the literal
`\n` characters, inside double quotes. If you paste the key as multiple lines
with real line breaks, the app can't read it. (If that ever happens, the app
also tries to fix common line-break mistakes automatically, but the one-line
format is the reliable one.)

That's it — no other setup needed.

---

## Step 5 — Run the app and verify (one time, ~2 min)

1. Start the app:

   ```bash
   npm install        # only if you haven't already
   npm run dev
   ```

2. Open **http://localhost:3000**.
3. Check the **"Signed in as"** dropdown — it should list your real players
   from the `Roster` tab instead of the fake placeholder names.
4. Click a court → pick a slot → book a player.
5. Open your spreadsheet → go to the `Reservations` tab → you should see the
   new row appear within a second or two. 🎉
6. Book the same player again on the same slot — the row disappears (that's
   the cancel/toggle behavior).

> Everything in Step 5 works with the fake placeholder data too — the app runs
> fine on its built-in file storage until you add `.env.local`. The moment the
> `.env.local` values are present, it switches to your spreadsheet
> automatically.

---

## Day-to-day use

- **To schedule a player:** open the app, pick day/location, click a court,
  pick a time slot, make sure the player's name is selected, click the slot.
  The booking lands in the `Reservations` tab immediately.
- **To cancel:** click the same slot again (the app asks for confirmation).
- **To add a new player:** add a row to the `Roster` tab — they appear in the
  app's dropdown on next page load. No code changes, no redeploys.
- **To add a court or a new site:** add a row to the `Sites` tab.
- The app respects its existing rules: a slot already booked by someone else is
  locked, and each player is capped at 2 sessions per day (you can still change
  the cap in `components/CourtSchedule.js` if you want).

---

## What changed in the code

| File | What it does |
| --- | --- |
| `lib/sheets.js` | **New.** Talks to Google Sheets (reads roster/sites/reservations, writes bookings). Falls back to the local JSON file if `.env.local` is missing. |
| `lib/sheetMappers.js` | **New.** Converts between spreadsheet rows and the app's data shape. |
| `lib/defaults.js` | **New.** The old hardcoded locations/courts/roster, kept as fallback values. |
| `pages/api/config.js` | **New.** Serves the roster + sites to the page from the spreadsheet. |
| `pages/api/reservations.js` | Updated to read/write the spreadsheet instead of only the local file. |
| `pages/index.js` | Loads the roster/sites from `/api/config` at startup. |
| `.env.example` | Template for your credentials (copy to `.env.local`). |

---

## Troubleshooting

**The app still shows the fake names.** The spreadsheet isn't configured or the
app hasn't been restarted since you added `.env.local`. Restart `npm run dev`,
and confirm the file `.env.local` exists with all three values.

**"Google Sheet is missing the 'Roster' tab" (or Sites/Reservations).** The tab
names don't match. Either rename your tabs to `Roster` / `Sites` /
`Reservations`, or set the `GOOGLE_SHEETS_*_TAB` env vars to your tab names.

**403 / "permission denied" / "The caller does not have permission".** The
spreadsheet hasn't been shared with the service account email. Recheck Step 3 —
it must be shared with the exact `client_email` from the JSON key, with
**Editor** access. (Also make sure you enabled the Google Sheets API in
Step 2.3.)

**401 / "invalid_grant" / private key errors.** The `GOOGLE_PRIVATE_KEY` in
`.env.local` isn't formatted right — it must be one line, double-quoted, with
literal `\n` characters. Also confirm the key belongs to the same service
account as `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

**"Unable to save reservation."** Usually a transient network blip or a Sheets
rate limit. Refresh and try again. (The free Sheets API quota is far more than
a single person scheduling will ever use.)

**Where does data live when I don't have `.env.local`?** In
`data/reservations.json` (the old behavior). Once `.env.local` is in place,
bookings go to the spreadsheet and the JSON file is no longer used.

**Deploying to Vercel/other hosting?** Set the same three variables as
environment variables in your hosting dashboard (Vercel: Project → Settings →
Environment Variables). The code is unchanged.

---

## FAQ

**Is my data safe?** The service account can only access the specific
spreadsheet you share with it. Your key file (`.env.local`) is excluded from
Git, so it never ends up in the repository.

**Can players book their own courts?** Not from this setup — the app stays
exactly as it is now: you're the only one who opens it, and you book on behalf
of players from the roster dropdown.

**What if my spreadsheet layout is different from these 3 tabs?** Tell me what
your tabs/columns look like — the mapper in `lib/sheetMappers.js` can be
adjusted to match your existing format, or you can create the 3 simple tabs
alongside your existing data without touching anything you already have.
