# YoPdfs — accounts & data collection setup

YoPdfs keeps **files** on the user's device. Only **account and usage data**
(sign-ups, logins, which tool was used, contact messages, newsletter and
waitlist entries) is collected — into a spreadsheet.

There are two backends that speak the same protocol:

| Where the site runs | Backend | Spreadsheet |
| --- | --- | --- |
| Your computer (`py server.py`) | `server.py` | `data/YoPdfs-Data.xlsx` (real Excel file, updated live) |
| GitHub Pages / any static host | Google Apps Script | A Google Sheet → *File › Download › Microsoft Excel (.xlsx)* |

`assets/js/config.js` → `BACKEND: "auto"` picks the right one automatically:
localhost uses `server.py`; the live site uses `SHEETS_URL` once you set it.

---

## 1. Local: Excel file (already working)

```powershell
py server.py
```

* Site: <http://localhost:4431/>
* Data: `data/YoPdfs-Data.xlsx` — sheets **Users, Logins, ToolUsage, Contact, Newsletter, Waitlist**
* Admin page: <http://localhost:4431/admin/> — the admin key is printed in the console
  (stored in `data/admin.json`).
* If the workbook is open in Excel while someone signs up, the data is still saved
  to `data/store.json` and the workbook refreshes on the next write after you close it.
* `data/` is in `.gitignore` — it is never published.

## 2. Live site: Google Sheet (free, ~5 minutes)

1. Open <https://sheets.google.com> and create a blank sheet named **YoPdfs Data**.
2. **Extensions › Apps Script**. Delete the sample code and paste the whole of
   `backend/google-apps-script.gs`. Save.
3. In the function dropdown pick **setup** and press **▶ Run**. Approve the
   permissions (it only touches this spreadsheet and, for password resets, sends email).
4. **Project Settings › Script properties › Add property**
   * `ADMIN_KEY` = a long random password (used on `/admin/`)
   * `NOTIFY_EMAIL` = *(optional)* an address that receives contact-form messages
5. **Deploy › New deployment › Web app**
   * Execute as: **Me**
   * Who has access: **Anyone**
   * Copy the **Web app URL** (ends in `/exec`).
6. Paste it into `assets/js/config.js`:
   ```js
   SHEETS_URL: "https://script.google.com/macros/s/AKfy.../exec",
   ```
7. Publish the site. Sign up once on the live site and check that a row appears in **Users**.

To download everything as Excel: open the Sheet → **File › Download › Microsoft Excel**,
or use the site's `/admin/` page → *Download Excel (.xlsx)*.

> After editing the script later, use **Deploy › Manage deployments › Edit › New version**
> so the same URL serves the new code.

## Security notes

* Passwords are hashed in the browser (SHA-256 with the email as salt) and hashed
  again server-side with a random per-user salt. Hashes live in the hidden `_Auth`
  sheet and are never included in exports.
* Sessions are random 64-character tokens that expire after 30 days (`_Sessions`).
* No file names or file contents are ever sent — only tool name, file count, sizes,
  duration and device type.
* For a large user base, move to a real database (the protocol in `server.py` is a
  ready template for any backend).

## Future premium plans

`assets/js/config.js → PLANS` defines Free / Pro / Business limits (max file size,
files per batch, ads on/off). `workspace.js` enforces them through `YP.limits()`
using the signed-in user's `plan` column. To upgrade a user today, change their
**Plan** cell in the Users sheet to `pro` or `business`. Connect a payment
provider (e.g. Razorpay/Stripe) later to set that value automatically.

## Ads & analytics

Both are off by default. In `assets/js/config.js`:

* `ANALYTICS.GA4_ID` / `ANALYTICS.GTM_ID` — Google Analytics 4 / Tag Manager.
  Every important action already pushes a `yp_*` event to `dataLayer`
  (`yp_tool_complete`, `yp_file_download`, `yp_sign_up`, `yp_search`, …).
* `ADS.ENABLED`, `ADS.ADSENSE_CLIENT`, `ADS.SLOTS` — AdSense units render in the
  `.ad-slot` placeholders (home page and below every tool). Paid plans never see ads.
