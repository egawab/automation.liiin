// import-session.js — Import full LinkedIn session from an existing browser.
// Collects all required LinkedIn session cookies, not just li_at.
// A partial cookie set (li_at only) causes redirect loops on search pages.
'use strict';

const readline = require('readline');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const COOKIE_FILE = path.join(__dirname, 'linkedin_cookies.json');
const PROFILE_DIR = path.join(os.homedir(), '.nexora_scraper', 'profile');

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

// LinkedIn requires these cookies for a complete session.
// Missing any of them causes redirect loops or partial failures.
const REQUIRED_COOKIES = [
  { name: 'li_at',      required: true,  desc: 'Main session token (most important)' },
  { name: 'JSESSIONID', required: true,  desc: 'Java session ID' },
  { name: 'bcookie',    required: false, desc: 'Browser fingerprint cookie' },
  { name: 'bscookie',   required: false, desc: 'Secure browser cookie' },
  { name: 'li_gc',      required: false, desc: 'Consent cookie' },
];

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Import LinkedIn Session                    ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('This imports your full LinkedIn session so the scraper');
  console.log('can use an account that is already logged in.');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('HOW TO OPEN THE COOKIE PANEL IN CHROME:');
  console.log('');
  console.log('  1. Open Chrome and go to:  https://www.linkedin.com');
  console.log('     (make sure you are already logged in)');
  console.log('');
  console.log('  2. Press F12  →  click the "Application" tab');
  console.log('     (click >> if you don\'t see it)');
  console.log('');
  console.log('  3. In the left panel:');
  console.log('     Storage → Cookies → https://www.linkedin.com');
  console.log('');
  console.log('  4. You will see a table of cookies.');
  console.log('     For each name below, click that row and copy');
  console.log('     the value shown in the "Cookie Value" box.');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const collected = [];

  for (const cookie of REQUIRED_COOKIES) {
    const label = cookie.required ? cookie.name + ' (required)' : cookie.name + ' (optional, press Enter to skip)';
    console.log('Cookie: ' + label);
    console.log('        ' + cookie.desc);
    const value = await ask('Value: ');
    const trimmed = value.trim();

    if (!trimmed && cookie.required) {
      console.error('\n[ERROR] ' + cookie.name + ' is required. Please try again.');
      rl.close(); process.exit(1);
    }

    if (trimmed) {
      collected.push({
        name:     cookie.name,
        value:    trimmed,
        domain:   '.linkedin.com',
        path:     '/',
        httpOnly: cookie.name === 'li_at' || cookie.name === 'JSESSIONID' || cookie.name === 'bscookie',
        secure:   true,
        sameSite: 'None',
      });
      console.log('  ✓ Saved\n');
    } else {
      console.log('  — Skipped\n');
    }
  }

  if (collected.length === 0) {
    console.error('[ERROR] No cookies collected. Exiting.');
    rl.close(); process.exit(1);
  }

  // Clear old profile so the injected cookies take effect cleanly
  console.log('Clearing previous LinkedIn session...');
  if (fs.existsSync(PROFILE_DIR)) {
    try {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
      console.log('[OK] Old session cleared.');
    } catch (e) {
      console.warn('[WARN] Could not clear old session: ' + e.message);
      console.warn('       Close the scraper browser window and try again.');
    }
  }

  // Save cookie file — scraper.js reads and injects this on next run
  fs.writeFileSync(COOKIE_FILE, JSON.stringify({ cookies: collected }, null, 2));
  console.log('[OK] ' + collected.length + ' cookies saved.');

  rl.close();
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Done! Double-click start.bat to run the     ║');
  console.log('║  scraper as this LinkedIn account.           ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
}

main().catch(e => { console.error('\n[FATAL] ' + e.message); process.exit(1); });
