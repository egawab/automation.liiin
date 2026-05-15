// pick-profile.js — Chrome profile selector for Nexora Scraper
// Reads all Chrome profiles, shows names/accounts, saves selection to config.
'use strict';

const readline = require('readline');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CONFIG_PATH   = path.join(__dirname, 'config.json');
const CHROME_BASE   = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Google', 'Chrome', 'User Data'
);

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

// ── Read Chrome profile info from Preferences file ────────────────────────────
function readProfile(profileDir) {
  const prefsPath = path.join(CHROME_BASE, profileDir, 'Preferences');
  if (!fs.existsSync(prefsPath)) return null;
  try {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    const name  = prefs?.profile?.name || profileDir;
    // account_info holds the Google accounts signed into this profile
    const accounts = (prefs?.account_info || []).map(a => a.email).filter(Boolean);
    const email = accounts[0] || '(no Google account)';
    return { dir: profileDir, name, email };
  } catch (_) { return null; }
}

// ── Scan for all Chrome profiles ──────────────────────────────────────────────
function findProfiles() {
  if (!fs.existsSync(CHROME_BASE)) return [];
  const profileDirs = fs.readdirSync(CHROME_BASE).filter(d => {
    if (!/^(Default|Profile \d+)$/i.test(d)) return false;
    return fs.statSync(path.join(CHROME_BASE, d)).isDirectory();
  });
  return profileDirs.map(readProfile).filter(Boolean);
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Select Chrome Profile                      ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  if (!fs.existsSync(CHROME_BASE)) {
    console.error('[ERROR] Chrome not found at: ' + CHROME_BASE);
    console.error('        Make sure Google Chrome is installed.');
    rl.close(); process.exit(1);
  }

  const profiles = findProfiles();
  if (profiles.length === 0) {
    console.error('[ERROR] No Chrome profiles found.');
    rl.close(); process.exit(1);
  }

  // Load current config to show which profile is currently selected
  let existing = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
  }

  console.log('  Your Chrome profiles:\n');
  profiles.forEach((p, i) => {
    const current = existing.chromeProfile === p.dir ? ' ← current' : '';
    console.log('  [' + (i + 1) + '] ' + p.name.padEnd(25) + p.email + current);
    console.log('      Folder: ' + p.dir);
    console.log('');
  });

  // Default to the currently-selected profile index if one is set
  const currentIdx = profiles.findIndex(p => p.dir === existing.chromeProfile);
  const defaultPrompt = currentIdx >= 0 ? ' [default=' + (currentIdx + 1) + ']' : '';

  const choice = await ask('Enter number to select' + defaultPrompt + ': ');
  const idx    = choice.trim() ? parseInt(choice.trim(), 10) - 1 : currentIdx;

  if (isNaN(idx) || idx < 0 || idx >= profiles.length) {
    console.error('[ERROR] Invalid selection.');
    rl.close(); process.exit(1);
  }

  const selected = profiles[idx];

  // Save to config.json
  existing.chromeProfile = selected.dir;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, 2));

  rl.close();
  console.log('');
  console.log('  ✓ Selected: ' + selected.name + ' (' + selected.email + ')');
  console.log('  ✓ Profile folder: ' + selected.dir);
  console.log('  ✓ Saved to config.json');
  console.log('');
}

main().catch(e => { console.error('\n[FATAL] ' + e.message); process.exit(1); });
