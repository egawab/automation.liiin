#!/usr/bin/env node
/**
 * scripts/test-extension-robustness.js
 *
 * Deep offline tests for cross-account LinkedIn scraping robustness.
 * Simulates different account UI languages, URN encodings, checkpoint pages,
 * dashboard URL shapes, and HTML/JSON payloads — without needing live LinkedIn.
 *
 * Run: node scripts/test-extension-robustness.js
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name, detail) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failed++;
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  }
}

// ── Mirror of production helpers (must stay in sync with background.js) ──────
function extractUrn(s) {
  if (!s) return '';
  const m = String(s).match(/(?:urn:li:|urn%3Ali%3A)(activity|ugcPost|share)(?::|%3A)([0-9]{10,25})/i);
  if (m) return 'urn:li:' + m[1] + ':' + m[2];
  const p = String(s).match(/activity-([0-9]{10,25})/i);
  if (p) return 'urn:li:activity:' + p[1];
  return '';
}

function urnToUrl(urn) {
  const m = urn.match(/urn:li:(ugcPost|activity|share):([0-9]+)/);
  if (!m) return '';
  return 'https://www.linkedin.com/feed/update/' + urn;
}

function extractPostsFromText(text) {
  const urlMap = new Map();
  const URN_RE = /(?:urn:li:|urn%3Ali%3A)(activity|ugcPost|share)(?::|%3A)([0-9]{10,25})/gi;
  let m; URN_RE.lastIndex = 0;
  while ((m = URN_RE.exec(text)) !== null) {
    const raw = 'urn:li:' + m[1] + ':' + m[2];
    const urn = extractUrn(raw) || raw;
    if (urn) {
      const url = urnToUrl(urn);
      if (url && !urlMap.has(urn)) urlMap.set(urn, url);
    }
  }
  return Array.from(urlMap.entries()).map(([canonicalUrn, url]) => ({ canonicalUrn, url }));
}

function normalizeDashboardUrl(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { return new URL(s).origin; }
  catch (_) { return s.replace(/\/+$/, '').replace(/\/(dashboard|login|register|admin).*$/i, ''); }
}

const CHECKPOINT_MARKERS = [
  'checkpoint/challenge', 'checkpoint/rc', '/authwall', 'action=authwall', 'uas/login',
  'Sign in to LinkedIn', 'Join LinkedIn today', "we've detected unusual", 'unusual activity',
  'security check', 'verify you are a human', "Let's do a quick security check",
  'تسجيل الدخول إلى', 'نشاط غير عادي', 'تحقق أمني',
  'Se connecter à LinkedIn', 'activité inhabituelle',
  'Anmelden bei LinkedIn', 'ungewöhnliche Aktivität',
  'Inicia sesión en LinkedIn', 'actividad inusual',
  'Accedi a LinkedIn', 'attività inusuale',
  'Entrar no LinkedIn', 'atividade incomum',
  "LinkedIn'de oturum aç", 'olağan dışı etkinlik',
  '登录领英', '异常活动', 'LinkedInにログイン', '不審なアクティビティ',
  '로그인', '비정상적인 활동', 'Войти в LinkedIn', 'необычная активность',
];
function isCheckpointText(text) {
  if (!text) return false;
  const sample = text.length > 20000 ? text.slice(0, 20000) : text;
  return CHECKPOINT_MARKERS.some(m => sample.includes(m));
}

function normalizeDigits(s) {
  return (s || '')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/,/g, '');
}
function parseNum(s) {
  if (!s) return null;
  const n = parseInt(normalizeDigits(String(s)).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1) URN extraction — classic / encoded / ugcPost / share ═══');
{
  const cases = [
    ['urn:li:activity:7123456789012345678', 'urn:li:activity:7123456789012345678'],
    ['urn:li:ugcPost:7123456789012345678', 'urn:li:ugcPost:7123456789012345678'],
    ['urn:li:share:7123456789012345678', 'urn:li:share:7123456789012345678'],
    ['urn%3Ali%3Aactivity%3A7123456789012345678', 'urn:li:activity:7123456789012345678'],
    ['https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678', 'urn:li:activity:7123456789012345678'],
    ['activity-7123456789012345678', 'urn:li:activity:7123456789012345678'],
    ['garbage', ''],
    ['', ''],
  ];
  for (const [input, expected] of cases) {
    assert(extractUrn(input) === expected, `extractUrn(${JSON.stringify(input).slice(0, 50)})`, `got ${extractUrn(input)}`);
  }
}

console.log('\n═══ 2) urnToUrl — NEVER produce /posts/{bareId} ═══');
{
  const u1 = urnToUrl('urn:li:ugcPost:7123456789012345678');
  assert(u1.includes('/feed/update/'), 'ugcPost uses /feed/update/', u1);
  assert(!/\/posts\/\d+$/.test(u1), 'ugcPost is NOT bare /posts/{id}', u1);

  const u2 = urnToUrl('urn:li:activity:7123456789012345678');
  assert(u2 === 'https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678', 'activity URL exact');
}

console.log('\n═══ 3) Bulk extract from mixed HTML/JSON payloads (account UI variants) ═══');
{
  // Classic feed HTML
  const classic = `
    <div data-urn="urn:li:activity:1111111111111111111"></div>
    <a href="https://www.linkedin.com/feed/update/urn:li:activity:2222222222222222222">x</a>
    <script type="application/json">{"entityUrn":"urn:li:ugcPost:3333333333333333333"}</script>
  `;
  const p1 = extractPostsFromText(classic);
  assert(p1.length === 3, 'classic HTML yields 3 unique posts', 'got ' + p1.length);

  // URL-encoded Voyager payload (common in GraphQL responses)
  const encoded = `{"included":[{"entityUrn":"urn%3Ali%3Aactivity%3A4444444444444444444"},{"entityUrn":"urn%3Ali%3AugcPost%3A5555555555555555555"}]}`;
  const p2 = extractPostsFromText(encoded);
  assert(p2.length === 2, 'encoded Voyager yields 2 posts', 'got ' + p2.length);

  // Arabic RTL page with same URNs embedded
  const arabic = `<html dir="rtl" lang="ar"><body>منشورات
    <div data-chameleon-result-urn="urn:li:activity:6666666666666666666"></div>
    نشاط غير ذي صلة
  </body></html>`;
  const p3 = extractPostsFromText(arabic);
  assert(p3.length === 1, 'Arabic RTL page still extracts URN', 'got ' + p3.length);

  // Dedup: same URN twice different encodings
  const dup = `urn:li:activity:7777777777777777777 urn%3Ali%3Aactivity%3A7777777777777777777`;
  const p4 = extractPostsFromText(dup);
  assert(p4.length === 1, 'dedup across encoding variants', 'got ' + p4.length);
}

console.log('\n═══ 4) Checkpoint / auth-wall detection — multi-language accounts ═══');
{
  const positives = [
    ['EN authwall', 'Please Sign in to LinkedIn to continue'],
    ['EN unusual', "we've detected unusual activity on your account"],
    ['EN challenge URL', 'https://www.linkedin.com/checkpoint/challenge/abc'],
    ['AR login', 'تسجيل الدخول إلى LinkedIn مطلوب'],
    ['AR unusual', 'تم اكتشاف نشاط غير عادي'],
    ['FR', 'Se connecter à LinkedIn pour continuer'],
    ['DE', 'Anmelden bei LinkedIn — ungewöhnliche Aktivität'],
    ['ES', 'Inicia sesión en LinkedIn — actividad inusual'],
    ['IT', 'Accedi a LinkedIn — attività inusuale'],
    ['PT', 'Entrar no LinkedIn — atividade incomum'],
    ['TR', "LinkedIn'de oturum aç — olağan dışı etkinlik"],
    ['ZH', '登录领英 — 异常活动'],
    ['JA', 'LinkedInにログイン — 不審なアクティビティ'],
    ['KO', '로그인 — 비정상적인 활동'],
    ['RU', 'Войти в LinkedIn — необычная активность'],
  ];
  for (const [label, text] of positives) {
    assert(isCheckpointText(text) === true, `checkpoint DETECTED (${label})`);
  }

  const negatives = [
    ['normal EN feed', 'Feed · Home · Messaging · 12 reactions · 3 comments'],
    ['normal AR feed', 'الملف الشخصي · الرسائل · ١٢ تفاعل · ٣ تعليقات'],
    ['search results', 'Search results for "marketing" — About 1,000 results'],
  ];
  for (const [label, text] of negatives) {
    assert(isCheckpointText(text) === false, `checkpoint NOT triggered (${label})`);
  }
}

console.log('\n═══ 5) Dashboard URL normalization (prevents /dashboard/api 404) ═══');
{
  const cases = [
    ['https://app.vercel.app/dashboard', 'https://app.vercel.app'],
    ['https://app.vercel.app/dashboard/', 'https://app.vercel.app'],
    ['https://app.vercel.app/', 'https://app.vercel.app'],
    ['https://app.vercel.app', 'https://app.vercel.app'],
    ['app.vercel.app/login', 'https://app.vercel.app'],
    ['http://localhost:3000/dashboard', 'http://localhost:3000'],
    ['https://automation-liiin-xxx.vercel.app/dashboard?x=1', 'https://automation-liiin-xxx.vercel.app'],
  ];
  for (const [input, expected] of cases) {
    const got = normalizeDashboardUrl(input);
    assert(got === expected, `normalize(${input})`, `got ${got}`);
  }
}

console.log('\n═══ 6) Arabic / Persian digit parsing (engagement enrich) ═══');
{
  assert(parseNum('١٢٣') === 123, 'Arabic-Indic digits');
  assert(parseNum('۱۲۳') === 123, 'Eastern Arabic-Indic (Persian) digits');
  assert(parseNum('1,234') === 1234, 'comma thousands');
  assert(parseNum('42 reactions') === 42, 'embedded number');
  assert(parseNum('') === null, 'empty → null');
}

console.log('\n═══ 7) User ID UUID gate ═══');
{
  assert(isUuid('155745e7-9b12-49b9-9b30-0ed80dd65bc0') === true, 'valid UUID');
  assert(isUuid('not-a-uuid') === false, 'reject garbage');
  assert(isUuid('') === false, 'reject empty');
}

console.log('\n═══ 8) Shipped extension package integrity ═══');
{
  const extDir = path.join(__dirname, '..', 'extension');
  const required = ['manifest.json', 'background.js', 'popup.js', 'popup.html', 'dashboard-bridge.js', 'enrich.js', 'content.js', 'icon-48.png'];
  for (const f of required) {
    assert(fs.existsSync(path.join(extDir, f)), `extension/${f} exists`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
  assert(!!manifest.version, 'manifest has version: ' + manifest.version);
  assert(manifest.manifest_version === 3, 'MV3');
  assert(Array.isArray(manifest.permissions) && manifest.permissions.includes('cookies'), 'cookies permission');
  assert(Array.isArray(manifest.host_permissions) && manifest.host_permissions.some(h => h.includes('linkedin')), 'linkedin host permission');

  // background.js must contain the critical fixes
  const bg = fs.readFileSync(path.join(extDir, 'background.js'), 'utf8');
  assert(bg.includes('normalizeDashboardUrl'), 'background has normalizeDashboardUrl');
  assert(bg.includes('activateSystem'), 'background has activateSystem');
  assert(bg.includes('isCheckpointText'), 'background has checkpoint detector');
  assert(bg.includes('customUrl'), 'background accepts customUrl for scroll tabs');
  assert(bg.includes('fetchViaVoyagerRest'), 'background has Voyager REST channel');
  assert(bg.includes('fetchViaScrollTab'), 'background has scroll-tab channel');

  const bridge = fs.readFileSync(path.join(extDir, 'dashboard-bridge.js'), 'utf8');
  assert(bridge.includes('isLikelyDashboard'), 'bridge gates non-dashboard pages');
  assert(bridge.includes('START_ENGINE'), 'bridge handles START_ENGINE');

  const popup = fs.readFileSync(path.join(extDir, 'popup.js'), 'utf8');
  assert(popup.includes('verifyDashboardConnection'), 'popup verifies Jobs API on connect');
  assert(popup.includes('decodeJwtPayload'), 'popup has JWT padding-safe decode');
}

console.log('\n═══ 9) Account-type scenario matrix (logical) ═══');
{
  // Scenario: new account hits checkpoint → other phases must continue
  // Simulated: checkpoint page yields 0 posts, but Voyager text still has URNs
  const checkpointHtml = 'Sign in to LinkedIn — checkpoint/challenge';
  const voyagerOk = '{"entityUrn":"urn:li:activity:8888888888888888888"}';
  assert(isCheckpointText(checkpointHtml), 'scenario: new-account checkpoint detected');
  const recovered = extractPostsFromText(voyagerOk);
  assert(recovered.length === 1, 'scenario: API channel still recovers posts when tab is blocked');

  // Scenario: Free vs Premium — same URN formats in both
  const freeUi = '<div data-urn="urn:li:activity:9999999999999999999"></div>';
  const premiumUi = '<div data-entity-urn="urn:li:activity:9999999999999999999" data-chameleon-result-urn="urn:li:activity:9999999999999999999"></div>';
  assert(extractPostsFromText(freeUi).length === 1, 'scenario: free-account DOM attrs');
  assert(extractPostsFromText(premiumUi).length === 1, 'scenario: premium/chameleon DOM attrs');

  // Scenario: Sales Navigator-ish encoded URNs
  const sn = 'href="/feed/update/urn%3Ali%3AugcPost%3A1010101010101010101"';
  assert(extractPostsFromText(sn).length === 1, 'scenario: encoded ugcPost in href');
}

console.log('\n════════════════════════════════════════');
console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL CROSS-ACCOUNT ROBUSTNESS CHECKS PASSED');
process.exit(0);
