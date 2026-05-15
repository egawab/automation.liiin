NEXORA PLAYWRIGHT SCRAPER — Quick Guide
========================================

FIRST TIME:
  1. Double-click  install.bat
  2. If prompted, install Node.js from https://nodejs.org (free)
  3. Follow the on-screen questions (Dashboard URL + User ID)
  4. If asked to log into LinkedIn — do so, then press Enter

EVERY TIME YOU WANT TO SCRAPE:
  Double-click  start.bat
  A browser window opens, scrolls LinkedIn, posts results to your dashboard.

AUTO-SCHEDULE (set during install):
  If you chose daily auto-run, the scraper runs at 9 AM every day.
  You don't need to do anything.

TO REMOVE AUTO-SCHEDULE:
  Double-click  uninstall.bat

TO CHANGE SETTINGS:
  Run install.bat again, or edit config.json in Notepad.

HEADLESS (SILENT) MODE:
  In config.json, set "headless": true
  The browser will run invisibly in the background.

TROUBLESHOOTING:
  - "config.json not found"  → run install.bat
  - "node_modules not found" → run install.bat
  - LinkedIn asks to log in  → log in, then press Enter in the terminal
  - 0 posts saved            → check dashboard settings have keywords configured
  - API error 401            → check your User ID in config.json

FILES:
  scraper.js    Main scraper (do not edit unless you know what you're doing)
  setup.js      Config wizard (called by install.bat)
  config.json   Your settings (Dashboard URL, User ID, headless mode)
  install.bat   One-time setup
  start.bat     Run the scraper
  uninstall.bat Remove the scheduled task
