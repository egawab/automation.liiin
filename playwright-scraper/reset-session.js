// reset-session.js — Clears the LinkedIn browser session completely.
// Uses the exact same profile path as scraper.js to guarantee a match.
'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

const PROFILE_DIR = path.join(os.homedir(), '.nexora_scraper', 'profile');

console.log('');
console.log('Profile path: ' + PROFILE_DIR);

if (fs.existsSync(PROFILE_DIR)) {
  try {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    // Verify it's actually gone
    if (fs.existsSync(PROFILE_DIR)) {
      console.error('[ERROR] Could not delete profile folder.');
      console.error('        Make sure the scraper browser window is fully closed and try again.');
      process.exit(1);
    }
    console.log('[OK] LinkedIn session cleared.');
  } catch (e) {
    console.error('[ERROR] ' + e.message);
    console.error('        Close any open scraper browser windows and try again.');
    process.exit(1);
  }
} else {
  console.log('[OK] No session found — already clean.');
}

console.log('');
console.log('Done. Run start.bat to log in with a new LinkedIn account.');
console.log('');
