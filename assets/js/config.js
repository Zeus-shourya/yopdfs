/* ==========================================================================
   YoPdfs — site configuration (edit this file, no build needed)
   ========================================================================== */
window.YP_CONFIG = {
  /* ---------------------------------------------------------------------
     BACKEND (accounts + data collection into a spreadsheet)
       "auto"  → on localhost uses the Python dev server's /api
                 (writes data/YoPdfs-Data.xlsx); elsewhere uses SHEETS_URL
                 if set, otherwise falls back to "local" (browser only).
       "sheets"→ always use the Google Apps Script web app in SHEETS_URL
       "api"   → always use API_URL (e.g. a hosted copy of server.py)
       "local" → no server; accounts live only in this browser
     See backend/SETUP.md.
     --------------------------------------------------------------------- */
  BACKEND: "auto",
  SHEETS_URL: "",          // e.g. "https://script.google.com/macros/s/AKfy.../exec"
  API_URL: "/api",

  /* Anonymous tool-usage events (tool name, file count, sizes, duration).
     File names and contents are never sent. */
  LOG_TOOL_USAGE: true,

  /* ---------------------------------------------------------------------
     ANALYTICS — leave blank to disable. YP.track() always pushes to
     window.dataLayer so Google Tag Manager can pick events up too.
     --------------------------------------------------------------------- */
  ANALYTICS: {
    GA4_ID: "",            // "G-XXXXXXXXXX"
    GTM_ID: ""             // "GTM-XXXXXXX"
  },

  /* ---------------------------------------------------------------------
     ADS — disabled by default. When enabled, slots marked
     <div class="ad-slot" data-ad="..."> render AdSense units.
     Paid plans never see ads.
     --------------------------------------------------------------------- */
  ADS: {
    ENABLED: false,
    ADSENSE_CLIENT: "",    // "ca-pub-XXXXXXXXXXXXXXXX"
    SLOTS: { "home-mid": "", "tool-below": "" }   // ad unit ids
  },

  /* ---------------------------------------------------------------------
     PLANS — architecture for future premium tiers. Limits are enforced
     by workspace.js (YP.limits()). Paid tiers show a waitlist until
     payments are connected.
     --------------------------------------------------------------------- */
  PLANS: {
    free:     { name: "Free",     price: { inr: 0,   usd: 0 },  maxFileMB: 250,  maxFiles: 50,  ads: true,  history: 20 },
    pro:      { name: "Pro",      price: { inr: 199, usd: 4 },  maxFileMB: 1024, maxFiles: 200, ads: false, history: 500, available: false },
    business: { name: "Business", price: { inr: 799, usd: 15 }, maxFileMB: 2048, maxFiles: 500, ads: false, history: 5000, seats: 5, available: false }
  },

  CONTACT_EMAIL: "hello@yopdfs.com"
};
