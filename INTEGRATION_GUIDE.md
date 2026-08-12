# Courtz App → Google Sheets Integration - DONE

Your app is now **patched to use Google Sheets**. It still works with fake data if you don't configure Sheets, so you won't break anything.

## What changed in your repo

- `lib/sheets.js` (NEW) - Handles Google Sheets read/write. Auto-detects Roster/Schedule tabs, supports 2 methods.
- `lib/reservations.js` - Now just re-exports from sheets.js (keeps old API)
- `lib/reservations_local.js` (NEW) - Your original file backup, used as fallback
- `pages/api/roster.js` (NEW) - `/api/roster` returns live roster from Sheet
- `pages/index.js` - Now fetches `/api/roster` on load, merges with reservations. Falls back to Alice/Becca... if Sheet not configured.
- `CourtzAppsScript.gs` (NEW) - Backend to paste into Google Sheets
- `.env.example` - Config template
- `package.json` - Added `googleapis` dependency (only needed for Method 2)

## EASIEST METHOD (Do this - 5 minutes): Apps Script Web App

This is best for you: single admin, no player logins, security not needed, read+write works with one deploy.

### Step 1: Prepare Sheet copy

Your copy ID: `1U3TcsbIhQ9lxeo0_LtHYTldIqbkWg2Je`

In that Sheet, create/fix tabs:

**Tab 1: "Roster"** (case-sensitive)
Headers row 1: `Name`
Rows:
```
Name
Alice Johnson
Becca Smith
... (your real players)
```
Or if you have more columns: `Name | Level | Phone | etc.` - first column is used.

**Tab 2: "Reservations"** (create if missing)
Headers row 1 EXACTLY:
```
location | date | courtId | slot | name
```
Example rows:
```
Barnes Tennis Center | 2026-08-11 | 4 | 8:00 AM–8:30 AM | Alice Johnson
Peninsula Tennis Club | 2026-08-11 | 7 | 10:00 AM–11:00 AM | Becca Smith
```

> If you already have a "Schedule" tab with different headers (e.g. Site, Date, Court...), the script will auto-detect it. But creating the 5-column Reservations tab is cleanest for the current app logic.

### Step 2: Add backend script

1. In the Sheet: **Extensions > Apps Script**
2. Delete any code, paste **entire `CourtzAppsScript.gs`** from this repo
3. Click **Save**

### Step 3: Deploy

1. **Deploy > New deployment**
2. ⚙️ > **Web app**
3. Description: `Courtz API v1`
4. Execute as: **Me** (your Gmail)
5. Who has access: **Anyone** (URL is secret, 60 chars)
6. **Deploy** > Authorize > Advanced > Go to Courtz... > Allow
7. **Copy Web App URL**: `https://script.google.com/macros/s/AKf.../exec`

### Step 4: Connect your Next.js app

In your project root (same folder as package.json):

```bash
cp .env.example .env.local
# Edit .env.local and set:
# SHEETS_WEBAPP_URL=https://script.google.com/macros/s/AKf.../exec
# GOOGLE_SHEETS_ID=1U3TcsbIhQ9lxeo0_LtHYTldIqbkWg2Je
```

Or create `.env.local` manually:
```
SHEETS_WEBAPP_URL=https://script.google.com/macros/s/YOUR_ID/exec
GOOGLE_SHEETS_ID=1U3TcsbIhQ9lxeo0_LtHYTldIqbkWg2Je
```

Then:
```bash
npm install
npm run dev
```

Visit `http://localhost:3000` - your roster dropdown now shows **real Sheet names**, and booking a court writes a row to the Sheet instantly.

### Step 5: Verify

Test Web App directly:
```
https://script.google.com/macros/s/YOUR_ID/exec?action=listTabs
→ {"success":true,"tabs":["Roster","Reservations",...]}

https://script.google.com/macros/s/YOUR_ID/exec?action=getAll
→ {"success":true,"roster":["Alice Johnson",...],"reservations":{...}}
```

If `listTabs` shows wrong names, edit `TAB_NAMES` at top of CourtzAppsScript.gs and re-deploy > New version.

## METHOD 2: Sheets API + Service Account (alternative)

If you prefer official API:

1. console.cloud.google.com → New project "Courtz" → Enable Google Sheets API + Drive API
2. IAM > Service Accounts > Create > Keys > Create JSON key → download
3. Open JSON, copy `client_email` and `private_key`
4. In your Sheet: **Share** → paste `client_email` → Editor
5. In your app `.env.local`:
```
GOOGLE_SERVICE_ACCOUNT_EMAIL=courtz@...iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_ID=1U3TcsbIhQ9lxeo0_LtHYTldIqbkWg2Je
SHEETS_WEBAPP_URL=
```
6. `npm install googleapis` (already added) → `npm run dev`

## How it works

- `lib/sheets.js` checks `SHEETS_WEBAPP_URL` first. If set, uses WebApp.
- Else checks `GOOGLE_SERVICE_ACCOUNT_EMAIL` → uses Sheets API.
- Else falls back to `lib/reservations_local.js` (writes to data/reservations.json) - so local dev still works.

You are the only admin, so `POST /api/reservations` (toggle) now writes to Sheet instead of JSON file. Players can't self-schedule? Your current UI still allows it, but you said you'll be only one accessing app - so just don't share player links. To lock it down further, we can add a simple `?adminKey=...` check - ask if you want it.

## Next: Point to your REAL Sheet

When ready to go live, just change `GOOGLE_SHEETS_ID` in `.env.local` to your real Sheet ID (not the copy) and re-deploy the Web App from the real Sheet.

## Reservations disappearing? (connection health)

The app now tells you when it is NOT connected to Google Sheets instead of
silently showing empty/fallback data: an amber banner appears on the home page
whenever `/api/schedule` could not reach a write-capable Sheets backend.

If you see that banner, check these in order:

1. **Verify the Apps Script deployment** — open this in a browser (replace with your URL):
   ```
   https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?action=ping
   ```
   Expect: `{"success":true,"version":"1.1","tabs":[...]}`
   - A Google **login page** or error page → the web app is not shared with "Anyone". Redeploy with **Who has access: Anyone**.
   - No `version` field, or an old version → the Sheet is running an old copy of the script. Paste the latest `CourtzAppsScript.gs` and redeploy.
2. **Redeploy correctly after editing the script** — in Apps Script: **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. This updates the existing `/exec` URL. ("New deployment" creates a *different* URL — then you must update `SHEETS_WEBAPP_URL` to match.)
3. **Check `SHEETS_WEBAPP_URL` in your host's env settings** (e.g. Vercel → Project → Settings → Environment Variables) — it must be the full `/exec` URL. Redeploy the app after changing env vars; serverless env changes do not apply to already-running builds.
4. **Local JSON fallback** — without a working WebApp/Service Account, the app writes to `data/reservations.json`, which is **ephemeral on Vercel** (lost on every deploy/cold start). That fallback exists only for local development; treat the banner as "fix the connection now".

## Questions?

- If your roster is on a tab named "Players" not "Roster", just tell me or change `TAB_NAMES.ROSTER` in CourtzAppsScript.gs
- If your schedule tab has different columns, paste a screenshot/header row and I'll adjust the parser
- Run `npm run build` before deploying to Vercel, set env vars in Vercel dashboard
