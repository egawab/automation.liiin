// setup.js — Nexora Playwright Scraper — First-Time Setup
// Auto-extracts User ID from dashboard session cookie.
// User only needs to type the Dashboard URL. Nothing else.
'use strict';

const readline = require('readline');
const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

// ── Decode JWT without external deps ─────────────────────────────────────────
function decodeJwt(token) {
  try {
    const seg    = token.split('.')[1];
    if (!seg) return null;
    const base64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch (_) { return null; }
}

// ── Extract User ID from Playwright browser context ───────────────────────────
async function extractUserId(context, dashboardUrl) {
  // Method 1: auth_token cookie (httpOnly — only Playwright can read this)
  const cookies = await context.cookies();
  for (const c of cookies) {
    if (c.name === 'auth_token') {
      const p = decodeJwt(c.value);
      if (p?.userId) return p.userId;
    }
  }

  // Method 2: call /api/auth/me or similar endpoint using the logged-in session
  const page = context.pages()[0] || await context.newPage();
  try {
    const resp = await page.goto(dashboardUrl + '/api/auth/me',
      { waitUntil: 'domcontentloaded', timeout: 10000 });
    if (resp?.ok()) {
      const json = JSON.parse(await resp.text());
      if (json.userId) return json.userId;
      if (json.user?.id) return json.user.id;
    }
  } catch (_) {}

  // Method 3: DOM / localStorage on the dashboard page
  try {
    await page.goto(dashboardUrl + '/dashboard',
      { waitUntil: 'domcontentloaded', timeout: 15000 });
    const uid = await page.evaluate(() => {
      const el = document.getElementById('nexora-connect-data');
      if (el?.dataset?.userId) return el.dataset.userId;
      for (const key of Object.keys(localStorage)) {
        try {
          const v = JSON.parse(localStorage.getItem(key));
          if (v?.userId) return v.userId;
          if (v?.user?.id) return v.user.id;
        } catch (_) {}
      }
      return null;
    });
    if (uid) return uid;
  } catch (_) {}

  return null;
}

// ── Wait for login using pure polling — NO readline involvement ───────────────
// Using ask() / readline inside here caused a dangling listener that froze
// all subsequent prompts. Pure setTimeout polling avoids this completely.
async function waitForLogin(page) {
  const loggedIn = async () => {
    try {
      const url = page.url();
      if (/\/(dashboard|home|posts|settings|feed)/.test(url)) return true;
      const cookies = await page.context().cookies();
      return cookies.some(c => c.name === 'auth_token');
    } catch (_) { return false; }
  };

  if (await loggedIn()) return; // already in

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ACTION REQUIRED:');
  console.log('  Log into your Nexora dashboard in the browser window.');
  console.log('  This terminal will continue automatically once done.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const TIMEOUT = 5 * 60 * 1000;
  const start   = Date.now();
  let dots = 0;

  while (Date.now() - start < TIMEOUT) {
    await new Promise(r => setTimeout(r, 2000));
    if (await loggedIn()) {
      console.log('\n  ✓ Login detected — continuing...\n');
      return;
    }
    process.stdout.write('.');
    dots++;
    if (dots % 15 === 0) process.stdout.write('\n');
  }

  throw new Error('Login timed out after 5 minutes. Please run install.bat again.');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Nexora Scraper — First-Time Setup          ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('You only need to do this ONCE.\n');

  let existing = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
    console.log('Existing config found. Press Enter to keep current values.\n');
  }

  // ── Step 1: Dashboard URL ─────────────────────────────────────────────────
  let dashboardUrl = await ask(
    'Dashboard URL (e.g. https://yourapp.vercel.app)' +
    (existing.dashboardUrl ? ' [' + existing.dashboardUrl + ']' : '') + ':\n> '
  );
  dashboardUrl = (dashboardUrl.trim() || existing.dashboardUrl || '').replace(/\/$/, '');
  if (!dashboardUrl) { console.error('\n[ERROR] Dashboard URL is required.'); rl.close(); process.exit(1); }

  // ── Step 2: Auto-extract User ID via Playwright ───────────────────────────
  console.log('');
  console.log('Opening your dashboard to read your User ID automatically...');
  console.log('(A browser window will appear — this only takes a moment)');
  console.log('');

  const { chromium } = require('playwright');
  let browser, userId;

  try {
    browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page    = await context.newPage();

    await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForLogin(page);

    console.log('Extracting User ID from session...');
    userId = await extractUserId(context, dashboardUrl);
    await browser.close();
    browser = null;

    if (userId) {
      console.log('✓ User ID detected: ' + userId.substring(0, 8) + '...' + userId.slice(-4));
    } else {
      console.log('[!] Could not auto-detect User ID.');
    }
  } catch (e) {
    if (browser) { await browser.close().catch(() => {}); browser = null; }
    console.error('[WARNING] Browser auto-detection failed: ' + e.message);
  }

  // Fallback: ask manually
  if (!userId) {
    console.log('');
    console.log('Please find your User ID in your dashboard Settings page.');
    const manual = await ask(
      'Paste your User ID' +
      (existing.userId ? ' [' + existing.userId + ']' : '') + ':\n> '
    );
    userId = manual.trim() || existing.userId || '';
  }

  if (!userId) { console.error('\n[ERROR] User ID is required.'); rl.close(); process.exit(1); }

  // ── Step 3: Validate connection ────────────────────────────────────────────
  console.log('\nValidating connection to dashboard API...');
  try {
    const mod  = dashboardUrl.startsWith('https') ? require('https') : require('http');
    const u    = new URL(dashboardUrl + '/api/extension/jobs');
    await new Promise((resolve, reject) => {
      const req = mod.request({
        hostname: u.hostname,
        port:     u.port || (u.protocol === 'https:' ? 443 : 80),
        path:     u.pathname,
        method:   'GET',
        headers:  { 'x-extension-token': userId },
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          if (res.statusCode === 401) return reject(new Error('User ID rejected (401). Check your User ID.'));
          if (res.statusCode === 404) return reject(new Error('Dashboard URL not found (404).'));
          resolve();
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => reject(new Error('Timed out. Check your Dashboard URL.')));
      req.end();
    });
    console.log('✓ Dashboard connection verified!');
  } catch (e) {
    console.error('\n[WARNING] Validation failed: ' + e.message);
    const cont = await ask('Continue anyway? [y/N]: ');
    if (cont.trim().toLowerCase() !== 'y') { rl.close(); process.exit(1); }
  }

  // ── Step 4: Display mode ───────────────────────────────────────────────────
  console.log('');
  console.log('Browser display mode during scraping:');
  console.log('  [1] Visible   — you can watch it work (recommended for first run)');
  console.log('  [2] Invisible — runs silently in the background');
  const modeChoice = await ask('Choose [1 or 2, default=1]: ');
  const headless   = modeChoice.trim() === '2';

  // ── Step 5: Daily auto-schedule ────────────────────────────────────────────
  console.log('');
  console.log('Auto-schedule (optional):');
  console.log('  Runs the scraper automatically every day at 9:00 AM.');
  const schedChoice = await ask('Set up daily auto-run? [y/N]: ');
  if (schedChoice.trim().toLowerCase() === 'y') {
    const bat = path.join(__dirname, 'start.bat');
    try {
      require('child_process').execSync(
        `schtasks /Create /TN "NexoraScraper" /TR "\\"${bat}\\"" /SC DAILY /ST 09:00 /F /RL HIGHEST`,
        { stdio: 'pipe' }
      );
      console.log('✓ Scheduled task created — will run daily at 9:00 AM.');
      console.log('  To remove it, double-click uninstall.bat.');
    } catch (e) {
      console.warn('[WARNING] Could not create task: ' + (e.stderr?.toString() || e.message));
      console.warn('  You can still run manually with start.bat.');
    }
  }

  // ── Save config ────────────────────────────────────────────────────────────
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ dashboardUrl, userId, headless }, null, 2));
  console.log('\n✓ Configuration saved to config.json');

  rl.close();
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Setup complete!                             ║');
  console.log('║  Double-click start.bat to run the scraper. ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
}

main().catch(e => { console.error('\n[FATAL] ' + e.message); process.exit(1); });
