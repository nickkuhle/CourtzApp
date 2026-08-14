# Deploying Courtz to Vercel — step-by-step guide

This guide walks you through putting Courtz on the internet with Vercel.
You already have a Vercel account and a GitHub repo (`nickkuhle/CourtzApp`),
so this should take about **10 minutes**.

> No changes to your Google Apps Script are needed for this update. The app
> talks to the same `/exec` URL as before. You only need to redeploy the
> Apps Script if you later edit `CourtzAppsScript.gs` yourself (instructions
> for that are in [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)).

---

## Part 1 — One-time setup (do this once)

### Step 1. Merge the new code into `main`

1. Open the pull request for this update on GitHub and click **Merge pull
   request**. (If you are reading this from `main`, this is already done.)
2. Make sure the **main** branch contains this `DEPLOYMENT.md` file — that is
   how you know you are on the right branch.

### Step 2. Import the project into Vercel

1. Go to [vercel.com](https://vercel.com) and log in.
2. Click **Add New…** → **Project**.
3. If you haven't connected GitHub to Vercel before, click **Import Git
   Repository** → **Connect GitHub** and follow the prompts.
4. In the list of your GitHub repositories, find **CourtzApp** and click
   **Import**.
5. Vercel will automatically detect the project as **Next.js**. Don't change
   the defaults (build command `next build`, output directory `.next`).

### Step 3. (Optional but recommended) Add an environment variable

The app already knows your Apps Script URL because it is saved inside the
code. Adding it as an environment variable means you can switch the Google
Sheet later without touching the code.

1. Still on the import screen, open **Environment Variables**.
2. Add:
   - **Name:** `SHEETS_WEBAPP_URL`
   - **Value:** `https://script.google.com/macros/s/AKfycbzlHIg__YqQdq9ohWvFdu9wCZZ27S5XPTYeBCV3y9IdDx1AZmZjs7vaV3rcZVz2lFaW6g/exec`
3. (Optional, only if you set a staff code in the Apps Script) Add:
   - **Name:** `STAFF_APPROVAL_CODE`
   - **Value:** the exact staff code you set in the Apps Script
     *Project Settings → Script properties*.

### Step 4. Deploy

1. Click **Deploy**.
2. Wait for the build to finish (about 1–2 minutes). You'll see confetti and
   a **Congratulations** screen.
3. Click **Visit** (or the preview image) to open your live app.

### Step 5. Verify it works

1. The page should load with the tournament colors and court cards.
2. Under the top bar you should see the green message
   **“Google Sheet connected — reservations are up to date.”**
   - If you see the yellow warning instead, the app cannot reach your
     Google Sheet — see “Troubleshooting” below.
3. Book a practice court for **today** for one player and confirm it appears
   in your Google Sheet. Cancel it to put the sheet back the way it was.

### Step 6. (Optional) Use a friendlier web address

1. In the Vercel project, open **Settings → Domains**.
2. Add a domain you own (for example `courtz.usta.com`) and follow Vercel's
   instructions to point the DNS at Vercel. If you don't have a domain, the
   `*.vercel.app` address works fine forever.

---

## Part 2 — Everyday use

- **The site updates itself from the Google Sheet.** Every time the page
  loads (and every time someone returns to the tab), it re-reads the Sheet.
  You never redeploy just because the sheet changed.
- **Making future code changes:** any commit merged to `main` is built and
  published by Vercel automatically. You don't click anything in Vercel.
- **Booking rules:** today + tomorrow only, max 2 practice sessions per
  player per day, 4 players per 30-minute slot — all enforced again on the
  server, so nobody can bypass them from the browser.

## Part 3 — Troubleshooting

### Yellow banner: “The Google Sheet is not connected”

1. Open your Google Sheet → **Extensions → Apps Script**.
2. Click **Deploy → Manage deployments** and confirm there is a *Web app*
   deployment whose **Who has access** is **Anyone**.
3. If there isn't: **Deploy → New deployment → Web app**, set
   **Execute as: Me**, **Who has access: Anyone**, then **Deploy**.
4. Copy the new `/exec` URL.
5. In Vercel: **Settings → Environment Variables**, update
   `SHEETS_WEBAPP_URL` to the new URL, then **Deployments → Redeploy**
   (the three-dots menu next to the latest deployment).
6. Google also requires the person opening the Apps Script editor to be the
   same account that owns the Sheet. If a different Google account opened the
   editor, the web app won't see the data.

### “Sheets WebApp returned non-JSON”

This is the same problem as above: the Apps Script is redirecting to a
Google login page because the web app is not deployed with access
**Anyone**, or the URL is mistyped. Follow the steps above.

### Bookings are slow the first time after a quiet period

Vercel keeps the app "asleep" when nobody visits and the Google Apps Script
also needs a moment to wake up. The first page load after a break can take a
few seconds; after that it is fast. This is normal for a free serverless
setup.

### I made a mistake — how do I go back?

In Vercel, open **Deployments**, find a previous deployment, open its
three-dots menu and click **Promote to Production**. That instantly restores
that older version.

---

## What this update changed under the hood

- **On-court names:** player names are no longer crammed into the service
  boxes. Each quadrant between the service line and baseline shows one
  **last name** (deuce and ad, on both sides of the net). Hovering a name
  shows the full name.
- **Site overview:** a new toggle above the courts shows a color-coded map
  of every court × every 30-minute slot for the selected day and site.
  Green = open, amber = space left, red = full, gray = ended. The bottom row
  counts courts with space left, so a red **0** means the whole site is
  booked at that time. Tap any square to jump into that court's schedule.
- **Speed:** Tailwind CSS is now compiled at build time instead of being
  compiled inside every visitor's browser. The first screen paints much
  faster, the page no longer depends on a third-party CDN, and the
  JavaScript your browser downloads is smaller.
- **Security:** the site now sends a Content-Security-Policy and other
  hardening headers, booking writes are rate-limited, and oversized or
  malformed requests are rejected earlier.
