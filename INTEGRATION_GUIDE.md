# Courtz + Google Sheets (simple guide)

## What is already connected

Courtz now uses this Apps Script Web App for the **test copy** of the tournament Sheet:

```text
https://script.google.com/macros/s/AKfycbzlHIg__YqQdq9ohWvFdu9wCZZ27S5XPTYeBCV3y9IdDx1AZmZjs7vaV3rcZVz2lFaW6g/exec
```

The connection is built into the Next.js server, so a normal deployment of this branch connects to the test Sheet without another secret setting.

When Courtz opens, it asks the Sheet for two things:

1. The player list from the `Players` tab.
2. Existing reservations from each court-location tab.

When a reservation is booked or canceled, Courtz sends that change back to the same Sheet.

## How to test it

1. Open Courtz and wait for the green **Google Sheet connected** message.
2. Pick a player using the **Signed in as** search box.
3. Pick a day and location, then open a court.
4. Pick an open 30-minute time.
5. Look at the same date, court, and time in the copied Google Sheet. The player's name should be there.
6. In Courtz, tap that player's green **Your booking** time again and confirm the cancellation. The name should disappear from the Sheet.

Use an empty test time so an existing reservation is not disturbed. Cancel the test reservation when finished.

## Small recommended Google Script update

The currently deployed endpoint reports script version `1.1`. This repository contains version `1.2`, which fixes a few copied date cells that secretly say `2001` even though they belong to the 2026 tournament.

The app includes a compatibility fix, so the connection can be tested before doing this. Updating the Google script is still recommended:

1. Open the copied Google Sheet.
2. Click **Extensions → Apps Script**.
3. Replace the code there with all the code from `CourtzAppsScript.gs` in this repository.
4. Click **Save**.
5. Click **Deploy → Manage deployments**.
6. Click the pencil/edit button.
7. Choose **New version**, then click **Deploy**.

Keep these deployment choices:

- **Execute as:** Me
- **Who has access:** Anyone

To check it, open:

```text
https://script.google.com/macros/s/AKfycbzlHIg__YqQdq9ohWvFdu9wCZZ27S5XPTYeBCV3y9IdDx1AZmZjs7vaV3rcZVz2lFaW6g/exec?action=ping
```

It should show `"success":true` and, after the update, `"version":"1.2"`.

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
