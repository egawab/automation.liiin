# Search-Only Worker: Step-by-Step Testing Procedure

This guide walks you through running your first safe test of the search-only worker with conservative limits.

---

## Pre-Test Checklist

Before starting, ensure:

- [ ] You have a **LinkedIn account** (ideally secondary/burner, not primary)
- [ ] The account has been used **manually** for at least a few days (no recent automation)
- [ ] You're running during **work hours** (09:00–18:00) on a **weekday**
- [ ] `DATABASE_URL` is set in `.env`
- [ ] The dashboard is running (`npm run dev`)

---

## Step 1: Start the Dashboard

1. Open a terminal in the project folder.
2. Run:
   ```bash
   npm run dev
   ```
3. Open http://localhost:3000 in your browser.
4. Log in to the dashboard (or register if needed).
5. Go to **Settings**.

---

## Step 2: Configure Conservative Limits

1. In **Settings**, find the **Conservative Search Limits** section.
2. Confirm these values (or set them):
   - **Max Searches/Hour:** 6
   - **Max Searches/Day:** 20
   - **Min Delay (min):** 5
   - **Keywords/Cycle:** 3
   - **Work hours only:** ON
   - **Skip weekends:** ON
   - **Start hour:** 9
   - **End hour:** 18
3. Ensure **Search-Only Mode** is **ON**.
4. Set **engagement thresholds** (e.g. Min Likes: 10, Min Comments: 2).
5. Click **Save Settings**.

---

## Step 3: Get Your LinkedIn Session Cookie

### 3a. Log into LinkedIn

1. In your normal browser (Chrome/Edge/Firefox), go to https://www.linkedin.com.
2. Log in with your LinkedIn account.
3. Use LinkedIn for a few minutes (scroll feed, view a profile) so the session looks normal.
4. Stay on LinkedIn; keep the tab open.

### 3b. Extract the `li_at` cookie

1. Open **Developer Tools** (F12 or right‑click → Inspect).
2. Go to **Application** (Chrome) or **Storage** (Firefox).
3. In the left panel, open **Cookies** → **https://www.linkedin.com**.
4. Find the cookie named **`li_at`**.
5. Copy the **Value** (long string starting with `AQED...`).
6. Do not share this value; it grants full access to your LinkedIn account.

### 3c. Paste the cookie into the dashboard

1. In the dashboard, go to **Settings**.
2. Find **LinkedIn Session Cookie**.
3. Paste the `li_at` value into the field.
4. Click **Save Settings**.

---

## Step 4: Add Keywords and Verify Setup

### 4a. Add keywords

1. Go to the **Keywords** tab.
2. Add **1 keyword** for the first test (e.g. `AI automation` or `product management`).
3. Activate it.

### 4b. Confirm configuration

- **Settings:** Search-Only ON, cookie set, conservative limits as in Step 2.
- **Keywords:** 1 active keyword.
- **Dashboard:** Accessible at http://localhost:3000.
- **Worker:** Not running yet.

---

## Step 5: Start the Search-Only Worker

1. Open a **new terminal** (keep the dashboard running).
2. Go to the project folder:
   ```bash
   cd path/to/clonelink
   ```
3. Start the search-only worker:
   ```bash
   npm run worker:search
   ```
4. You should see:
   - A browser window (headed mode).
   - Console output such as: `LinkedIn Search-Only Worker - Starting...`
5. In the dashboard, click **Start** (or ensure **System Active** is ON) so the worker processes your account.

### What the worker does

1. Loads your settings and cookie.
2. Opens a browser and logs into LinkedIn using the cookie.
3. Checks work hours and search limits.
4. Runs one search for your keyword.
5. Filters posts by engagement.
6. Saves matching posts to the database.
7. Waits 5–10 minutes before the next search (or next cycle).

---

## Step 6: Verify the Session and Cookie

### During startup

- Watch the worker console for:
  - `Authenticating LinkedIn session...`
  - `LinkedIn authentication successful`
- If you see `LinkedIn authentication failed`, the cookie is invalid or expired. Repeat Step 3.

### In the browser window

- The worker opens a Chrome window and navigates to LinkedIn.
- You should see your LinkedIn feed (logged in), not a login or CAPTCHA page.
- If you see CAPTCHA or checkpoint, stop the worker and refresh the cookie later.

---

## Step 7: Run the First Search

1. Leave the worker running.
2. The first search should run within a few minutes of starting.
3. In the console, look for:
   - `Keyword: "your-keyword"`
   - `Navigating to search page...`
   - `Extracted X posts`
   - `Saved X new posts to dashboard`

---

## Step 8: Confirm Posts in the Dashboard

1. Go to the **Saved Posts** tab.
2. You should see posts found by the worker.
3. Each row should include:
   - Post URL
   - Author
   - Preview
   - Likes and comments
   - Keyword
4. Click a post URL to open it in your browser and confirm it’s correct.
5. Check the **Activity** feed for search-related entries.

---

## Step 9: Monitor During the Test

### Console

- **Normal:** `Searching for...`, `Found X posts`, `Saved X new posts`.
- **CAPTCHA:** `CAPTCHA DETECTED`, `Please solve it manually`.
- **Limits:** `Hourly limit reached`, `Daily limit reached`.
- **Work hours:** `Outside work hours. Waiting...`.

### Browser

- LinkedIn feed or search results = normal.
- CAPTCHA or verification page = stop and handle manually.

### Dashboard

- **Saved Posts:** New posts appear.
- **Activity:** Search actions logged.
- **System status:** Active when running.

### If CAPTCHA appears

1. Stop the worker (Ctrl+C in the terminal).
2. Solve the CAPTCHA manually in the browser.
3. Wait 24–48 hours before running the worker again.
4. On restart, consider reducing limits (e.g. 3 searches/hour, 10/day).
5. Do not restart immediately after CAPTCHA.

---

## Step 10: When It’s Safe to Increase Usage

### First test success criteria

- No CAPTCHA.
- Authentication works.
- 1 search completes and saves posts.
- Posts appear correctly in the dashboard.

### If the first test is successful

1. **Same day:** Keep limits as-is. Run 2–3 more cycles to confirm stability.
2. **Next day:** You can try 2 keywords per cycle instead of 1.
3. **Week 1:** Stay within 6 searches/hour and 20/day.
4. **Week 2+:** If there’s no CAPTCHA, you can:
   - Add a third keyword.
   - Optionally increase to 8–10 searches/hour and 30–40/day.
   - Keep at least 5 minutes between searches.

### Do not increase usage if

- CAPTCHA has appeared.
- Authentication fails.
- LinkedIn shows warnings or restrictions.
- The account was recently flagged.

---

## Quick Reference

| Action                  | Command / Location                         |
|-------------------------|--------------------------------------------|
| Start dashboard         | `npm run dev`                              |
| Start search-only worker| `npm run worker:search`                    |
| Stop worker             | Ctrl+C in worker terminal                  |
| Cookie location         | DevTools → Application → Cookies → li_at   |
| Saved posts             | Dashboard → Saved Posts tab                |
| Settings                | Dashboard → Settings                       |

---

## Troubleshooting

| Issue                      | Action                                                                 |
|----------------------------|------------------------------------------------------------------------|
| Auth failed                | Refresh the cookie; log in manually in a normal browser first.         |
| No posts found             | Broaden filters (lower Min Likes/Comments) or try another keyword.     |
| CAPTCHA                    | Stop worker, solve CAPTCHA, wait 24–48h, lower limits, retry.          |
| Outside work hours         | Run between 09:00–18:00 on weekdays, or disable work hours in settings.|
| Daily limit reached        | Wait until the next day or raise `maxSearchesPerDay` cautiously.       |
| Worker exits immediately   | Check DATABASE_URL, ensure System Active is ON, verify cookie.         |

---

## Summary

1. Configure conservative limits and Search-Only mode.
2. Get a fresh `li_at` cookie from manual LinkedIn use.
3. Add 1 keyword and start the worker with `npm run worker:search`.
4. Confirm authentication and that posts are saved.
5. Monitor for CAPTCHA and limits; stop if CAPTCHA appears.
6. Increase usage slowly only after a stable, CAPTCHA‑free period.
