// scraper.js — Nexora Playwright Scraper v1.0
// Replaces the Chrome Extension. Uses CDP-level network interception.
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const CONFIG_PATH = path.join(__dirname, 'config.json');

let profileName = 'profile';
const profileArg = process.argv.find(arg => arg.startsWith('--profile='));
if (profileArg) {
  profileName = profileArg.split('=')[1].replace(/[^a-zA-Z0-9_-]/g, '') || 'profile';
}

const PROFILE_DIR = path.join(os.homedir(), '.nexora_scraper', profileName);
const REAL_CHROME_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Google', 'Chrome', 'User Data'
);
const USE_REAL_CHROME = process.argv.includes('--real-chrome');

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg) {
  console.log('[' + new Date().toLocaleTimeString() + '] ' + msg);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('[ERROR] config.json not found. Please run install.bat first.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function apiFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        json: () => JSON.parse(data),
        text: () => data,
      }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => reject(new Error('Request timed out: ' + url)));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function waitForEnter() {
  return new Promise(resolve => {
    process.stdout.write('Press ENTER to continue...');
    process.stdin.once('data', resolve);
  });
}

// No network interception needed for visual extraction.

// Template string DOM_FN removed since we use actual domExtractor function now.

// ── Real DOM extractor function (used via page.evaluate(domExtractor)) ──────────
function domExtractor() {
  const records = [];
  const seen = {};
  
  function parseNum(s) {
    if (!s) return 0;
    let x = String(s).toUpperCase().replace(/,/g, '');
    const arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    for (let i = 0; i < arabicNumbers.length; i++) {
      x = x.replace(new RegExp(arabicNumbers[i], 'g'), String(i));
    }
    const n = parseFloat((x.match(/[0-9.]+/) || [])[0]);
    if (isNaN(n)) return 0;
    if (x.includes('K') || x.includes('ألف')) return Math.floor(n * 1000);
    if (x.includes('M') || x.includes('مليون')) return Math.floor(n * 1000000);
    return Math.floor(n);
  }

  function extractEngagement(card) {
    let likes = 0, comments = 0, isPoll = false;
    // Strategy 1: aria-label on reaction/comment buttons
    card.querySelectorAll('[aria-label]').forEach(el => {
      const a = (el.getAttribute('aria-label') || '').toLowerCase();
      if (/\d/.test(a) || /[٠-٩]/.test(a)) {
        if (/(reaction|like|reacted|إعجاب|تفاعل)/i.test(a)) likes = Math.max(likes, parseNum(a));
        if (/(comment|تعليق)/i.test(a)) comments = Math.max(comments, parseNum(a));
        if (/(vote|تصويت)/i.test(a)) isPoll = true;
      }
    });
    // Strategy 2: text inside spans/buttons that contains engagement numbers
    if (likes === 0 && comments === 0) {
      const rawText = (card.innerText || '');
      const likeMatch = rawText.match(/([\d,.]+[KkMm]?|[٠-٩,.]+[KkMm]?)\s*(Like|like|Reaction|reaction|Reacted|reacted|إعجاب|تفاعل)s?/);
      if (likeMatch) likes = parseNum(likeMatch[1]);
      const commentMatch = rawText.match(/([\d,.]+[KkMm]?|[٠-٩,.]+[KkMm]?)\s*(Comment|comment|تعليق)s?/);
      if (commentMatch) comments = parseNum(commentMatch[1]);
      if (/(vote|تصويت)/i.test(rawText)) isPoll = true;
    }
    return { likes, comments, isPoll };
  }

  function extractText(card) {
    // Try known post text selectors first (most reliable)
    const CSS = [
      '[data-testid="expandable-text-box"]',
      '.feed-shared-update-v2__commentary',
      '.update-components-text__text-view',
      '.update-components-text',
      '.feed-shared-inline-show-more-text',
      '.feed-shared-text',
      'p[dir="auto"]',
      '[dir="ltr"]',
    ];
    let txt = '';
    for (const s of CSS) {
      try {
        card.querySelectorAll(s).forEach(d => {
          if (d.closest('button,header,nav,aside,footer')) return;
          const t = (d.innerText || '').trim();
          if (t.length > txt.length) txt = t;
        });
        if (txt.length > 60) break;
      } catch (_) {}
    }
    // Fallback: use innerText but clean it aggressively
    if (txt.length < 15) {
      txt = (card.innerText || '').trim();
    }
    // Strip navigation, engagement counters, action buttons
    return txt
      .replace(/^(Home|My Network|Jobs|Messaging|Notifications|Me|Work|Business).*$/igm, '')
      .replace(/^(Like|Comment|Repost|Send|Share|Follow|Connect|View|See more|Show more|Load more).*$/igm, '')
      .replace(/^\s*[\d,.]+[KkMm]?\s*(reactions?|likes?|comments?|reposts?|votes?).*$/igm, '')
      .replace(/^.*notifications?\s+Skip to main content.*$/igm, '') // aggressive noise filter
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .substring(0, 3000);
  }

  function processCard(card, urn) {
    if (!urn || seen[urn]) return;
    seen[urn] = true;
    const eng = extractEngagement(card);
    const text = extractText(card);
    if (text.length < 10) return; // skip empty cards
    records.push({ 
      urn, 
      url: 'https://www.linkedin.com/feed/update/' + urn, 
      text, 
      author: 'Unknown', 
      likes: eng.likes, 
      comments: eng.comments,
      isPoll: eng.isPoll
    });
  }

  // Common URN extractor for any string
  function findUrn(str) {
    if (!str) return null;
    const m = str.match(/urn:li:(activity|ugcPost|share|update):[0-9]{15,25}/);
    if (m) return m[0];
    const m2 = str.match(/(activity|ugcPost|share|update)-([0-9]{15,25})/i);
    if (m2) return 'urn:li:activity:' + m2[2];
    return null;
  }

  // Build URN from a 19-digit ID and its type context
  function buildUrn(id, context) {
    if (!id) return null;
    if (context && /ugcPost|userGeneratedContent/i.test(context)) return 'urn:li:ugcPost:' + id;
    if (context && /share/i.test(context)) return 'urn:li:share:' + id;
    return 'urn:li:activity:' + id;
  }

  // Walk UP from an element to find the largest isolated post container
  // (outermost container that still has exactly 1 expandable text box — includes engagement bar)
  function isolateCard(el) {
    let card = el;
    let bestCard = el;
    for (let i = 0; i < 25 && card.parentElement && card.parentElement !== document.body; i++) {
      card = card.parentElement;
      const boxCount = card.querySelectorAll('[data-testid="expandable-text-box"]').length;
      const textLen = (card.innerText || '').length;
      if (boxCount === 1 && textLen < 12000) {
        bestCard = card; // keep going up — we want the LARGEST single-post container (includes engagement)
      }
      if (boxCount > 1) break; // second post found — stop, return last valid
      if (textLen > 12000) break; // too big
    }
    return bestCard;
  }

  // ── EXTRACTION STRATEGIES (based on real LinkedIn DOM, 2025) ──

  // Strategy 0 (PRIMARY): Start from expandable-text-box → extract URN from componentkey attribute.
  // This works even when LinkedIn hides all permalink links (e.g. in recent/date_posted view).
  try {
    document.querySelectorAll('[data-testid="expandable-text-box"]').forEach(el => {
      // The parent <p> element typically has a componentkey with the 19-digit post ID
      const p = el.closest('p') || el.parentElement;
      const componentKey = (p && (p.getAttribute('componentkey') || p.getAttribute('data-componentkey'))) || '';
      const html = componentKey || el.parentElement.outerHTML || '';
      const idMatch = html.match(/([0-9]{19})/);
      if (!idMatch) return;
      let urn = buildUrn(idMatch[1], html);
      if (!urn) return;

      const card = isolateCard(el);

      // ── Permalink reliability fix ─────────────────────────────────────────
      // ugcPost URNs sometimes produce "This post cannot be displayed" on LinkedIn.
      // activity URNs always work. If the isolated card HTML contains an explicit
      // activity URN, upgrade to it so the saved permalink is always openable.
      if (urn.includes('ugcPost')) {
        const cardHtml = card.outerHTML || '';
        const actMatch = cardHtml.match(/urn:li:activity:([0-9]{15,25})/);
        if (actMatch) {
          const activityUrn = 'urn:li:activity:' + actMatch[1];
          if (seen[activityUrn]) return; // already processed via its activity URN
          urn = activityUrn;             // upgrade — better permalink
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      if (seen[urn]) return;
      processCard(card, urn);
    });
  } catch (_) {}


  // Strategy 1: feed/update permalink links (works when LinkedIn includes them)
  try {
    document.querySelectorAll('a[href*="feed/update/urn:li:"]').forEach(a => {
      const urn = findUrn(a.href || '');
      if (!urn || seen[urn]) return;
      const card = isolateCard(a);
      processCard(card, urn);
    });
  } catch (_) {}

  // Strategy 2: data-urn attributes (LinkedIn feed / older layouts)
  try {
    const selectors = ['[data-urn*="urn:li:"]', '[data-entity-urn*="urn:li:"]', '[data-activity-urn]', '[data-id*="urn:li:"]'];
    for (const s of selectors) {
      document.querySelectorAll(s).forEach(el => {
        const raw = el.getAttribute('data-urn') || el.getAttribute('data-entity-urn') || el.getAttribute('data-activity-urn') || el.getAttribute('data-id') || '';
        const urn = findUrn(raw);
        if (!urn || seen[urn]) return;
        const card = isolateCard(el);
        processCard(card, urn);
      });
    }
  } catch (_) {}

  return records;
}

// ── Merge DOM record into postsMap ─────────────────────────────────────────────
function mergeDOM(rec, postsMap) {
  if (!rec.urn) return;
  const old = postsMap[rec.urn] || {};
  postsMap[rec.urn] = {
    canonicalUrn: rec.urn,
    url: rec.url || old.url,
    postUrl: old.postUrl, // Keep network URL if we had it
    postText: rec.text.length > (old.postText || '').length ? rec.text : old.postText,
    authorName: (old.authorName && old.authorName !== 'Unknown') ? old.authorName : rec.author,
    likes: Math.max(rec.likes || 0, old.likes || 0),
    comments: Math.max(rec.comments || 0, old.comments || 0),
    isPoll: rec.isPoll || old.isPoll || false,
    source: old.source || 'dom',
  };
}

// ── Fetch keywords from dashboard ─────────────────────────────────────────────
async function fetchKeywords(dashUrl, userId) {
  const resp = await apiFetch(dashUrl + '/api/extension/jobs', {
    headers: { 'x-extension-token': userId },
  });
  if (!resp.ok) throw new Error('Dashboard API ' + resp.status + ' — check your config.');
  const jobs = resp.json();
  if (!jobs.active) throw new Error(jobs.message || 'System inactive in dashboard settings.');
  let kws = [];
  if (jobs.settings?.searchConfigJson) {
    try {
      const cfg = JSON.parse(jobs.settings.searchConfigJson);
      if (Array.isArray(cfg)) kws.push(...cfg.flat().filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()));
    } catch (_) { }
  }
  if (kws.length === 0 && Array.isArray(jobs.keywords)) {
    kws.push(...jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean));
  }
  if (kws.length === 0) throw new Error('No keywords configured in dashboard.');
  return [...new Set(kws)];
}

// ── Filter and rank posts by engagement ─────────────────────────────────────
// Engagement filter: sum of likes + comments must be >= 10, and post must have text
function filterAndRankPosts(posts, runSeenUrns) {
  const filtered = posts.filter(p => {
    if (!p.canonicalUrn) return false;
    
    // Drop polls/vote posts
    if (p.isPoll) {
      log('[DROP] ' + p.canonicalUrn + ' | poll/vote post ignored');
      return false;
    }

    // Skip posts already captured under a different keyword this run
    if (runSeenUrns && runSeenUrns.has(p.canonicalUrn)) {
      log('[SKIP] ' + p.canonicalUrn + ' | already captured under another keyword');
      return false;
    }

    // Require post text (no preview = no save)
    const text = (p.postText || '').trim();
    if (text.length < 20) {
      log('[DROP] ' + p.canonicalUrn + ' | no post text (would show No preview)');
      return false;
    }

    const likes = p.likes || 0;
    const comments = p.comments || 0;
    const totalEng = likes + comments;
    
    if (totalEng >= 10) {
      log('[KEEP] ' + p.canonicalUrn + ' | likes=' + likes + ' comments=' + comments);
      if (runSeenUrns) runSeenUrns.add(p.canonicalUrn);
      return true;
    } else {
      log('[DROP] ' + p.canonicalUrn + ' | total engagement=' + totalEng + ' (needs 10+)');
      return false;
    }
  });

  // Sort highest engagement first
  filtered.sort((a, b) => ((b.likes||0) + (b.comments||0)) - ((a.likes||0) + (a.comments||0)));
  return filtered;
}

// ── Push results ──────────────────────────────────────────────────────────────
async function pushToAPI(posts, keyword, dashUrl, userId) {
  if (!posts.length) { log('No posts to save for: ' + keyword); return 0; }

  // Map internal fields to the API contract:
  // postText (internal) → postPreview (API) for the dashboard snippet
  const payload = posts.map(p => {
    // p.url is usually the DOM permalink (highly reliable)
    // p.postUrl is the network permalink (constructed from URN)
    // We prioritize p.url first, because the DOM always provides the right activity URN wrapper!
    let finalUrl = p.url || p.postUrl || ('https://www.linkedin.com/feed/update/' + p.canonicalUrn);
    if (p.canonicalUrn && p.canonicalUrn.includes('ugcPost') && finalUrl.includes('ugcPost')) {
      const idMatch = p.canonicalUrn.match(/\d{10,25}/);
      if (idMatch) finalUrl = 'https://www.linkedin.com/posts/' + idMatch[0];
    }
    return {
      ...p,
      url: finalUrl,
      postPreview: (p.postText || '').substring(0, 500) || undefined,
    };
  });

  const resp = await apiFetch(dashUrl + '/api/extension/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
    body: JSON.stringify({ posts: payload, keyword, source: 'nexora_playwright_v1' }),
  });
  if (!resp.ok) throw new Error('API error ' + resp.status + ': ' + resp.text().substring(0, 200));
  const data = resp.json();
  const created = data.createdCount ?? 0;
  const updated = data.updatedCount ?? 0;
  const totalProcessed = (data.createdCount !== undefined) ? (created + updated) : (data.savedCount ?? posts.length);
  for (const p of payload) log('[SAVED] ' + p.canonicalUrn + ' preview=' + (p.postPreview || '').substring(0, 40).replace(/\n/g, ' '));
  log('✓ Saved ' + totalProcessed + '/' + posts.length + ' posts (New: ' + created + ', Updated: ' + updated + ')  [keyword: ' + keyword + ']');
  return totalProcessed;
}

// ── Safe navigation (tolerates LinkedIn's SPA navigation and redirect loops) ────
async function safeGoto(page, url, opts = {}) {
  const RECOVERABLE = [
    'ERR_HTTP_RESPONSE_CODE_FAILURE',
    'ERR_ABORTED',
    'ERR_TOO_MANY_REDIRECTS',
  ];

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000, ...opts });
  } catch (e) {
    const msg = e.message || '';
    const isRecoverable = RECOVERABLE.some(code => msg.includes(code));
    if (!isRecoverable) throw e;

    log('[WARN] Navigation issue (' + (RECOVERABLE.find(c => msg.includes(c)) || 'unknown') + ')');

    // ERR_ABORTED is very common on LinkedIn's SPA — the page is still loading.
    // Wait for the DOM to stabilize before continuing.
    if (msg.includes('ERR_ABORTED')) {
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
        log('[RECOVERY] Page stabilized after ERR_ABORTED.');
      } catch (_) {
        log('[WARN] Page did not stabilize, continuing anyway.');
      }
    }

    // Redirect loop usually means session state is broken for this URL.
    // Reset by going to the feed first, then retry once.
    if (msg.includes('ERR_TOO_MANY_REDIRECTS')) {
      log('[RECOVERY] Navigating to feed to reset session state...');
      try {
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);
        // Retry the original URL once
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000, ...opts });
      } catch (_) {
        log('[WARN] Recovery attempt failed — continuing with current page state.');
      }
    }
  }

  await page.waitForTimeout(2500);
}

// ── Ensure LinkedIn is logged in ──────────────────────────────────────────────
async function ensureLoggedIn(page) {
  const cookieFile = path.join(__dirname, 'linkedin_cookies.json');

  if (!USE_REAL_CHROME && fs.existsSync(cookieFile)) {
    try {
      const { cookies } = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
      if (Array.isArray(cookies) && cookies.length > 0) {
        await page.context().addCookies(cookies);
        log('Session cookie injected from import file.');
      }
    } catch (e) {
      log('[WARN] Could not inject cookie file: ' + e.message);
    }
  }

  log('Checking LinkedIn session...');

  // Try navigating to feed — detect stale cookies (redirect loop)
  let feedUrl = '';
  try {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    feedUrl = page.url();
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('ERR_TOO_MANY_REDIRECTS')) {
      log('[WARN] Stale session detected — clearing cookies and prompting login.');
      await page.context().clearCookies();
      if (fs.existsSync(cookieFile)) {
        try { fs.unlinkSync(cookieFile); log('Deleted stale linkedin_cookies.json.'); } catch (_) {}
      }
      try {
        await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
      } catch (_) {}
    }
    feedUrl = page.url();
  }

  if (feedUrl.includes('/login') || feedUrl.includes('/checkpoint') || feedUrl.includes('/authwall') || feedUrl.includes('chrome-error')) {
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ACTION REQUIRED:');
    console.log('  Please log into LinkedIn in the browser window.');
    console.log('  Once you see your feed, come back here and press ENTER.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    await waitForEnter();
    const url2 = page.url();
    if (url2.includes('/login') || url2.includes('/checkpoint')) {
      throw new Error('Not logged in. Please run start.bat again and complete login.');
    }
  }
  log('LinkedIn session: OK ✓');
}


// ── Scrape one keyword (2 URL variants: relevance + recent) ──────────
async function scrapeKeyword(page, keyword, postsMap) {
  const base = 'https://www.linkedin.com/search/results/content/?keywords='
    + encodeURIComponent(keyword);

  // Run 2 variants: general relevance, then past month relevance
  const variants = [
    { url: base + '&origin=GLOBAL_SEARCH_HEADER', label: 'relevance_all' },
    { url: base + '&datePosted=%22past-month%22', label: 'relevance_month' },
  ];

  log('');
  log('── Keyword: "' + keyword + '" ──────────────────────────────');

  const beforeCount = Object.keys(postsMap).length;

  for (const { url: variantUrl, label } of variants) {
    log('[' + label + '] Navigating to: ' + variantUrl);
    await safeGoto(page, variantUrl);
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/authwall') || currentUrl.includes('chrome-error')) {
      log('[WARN] [' + label + '] Redirected to login — skipping.');
      continue;
    }
    log('[' + label + '] Landed on: ' + currentUrl);

    // Wait for any post content to appear (up to 12 seconds)
    let contentReady = false;
    const CONTENT_SELECTORS = [
      'a[href*="feed/update/urn:li:"]',
      '[data-urn*="urn:li:activity:"]',
      '[data-urn*="urn:li:ugcPost:"]',
      '.reusable-search__result-container',
      '.occludable-update',
    ];
    const waitStart = Date.now();
    while (Date.now() - waitStart < 12000) {
      try {
        for (const s of CONTENT_SELECTORS) {
          const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, s);
          if (count > 0) { contentReady = true; log('[' + label + '] Content ready (' + count + ' via ' + s + ')'); break; }
        }
      } catch (_) {}
      if (contentReady) break;
      await page.waitForTimeout(1000);
    }
    if (!contentReady) log('[WARN] [' + label + '] No content detected — will attempt extraction anyway.');

    // Scroll loop — patient, high-yield settings
    const MAX_STEPS = 150;
    const MIN_STEPS = 3;
    const MAX_STALL = 15;   // more patience = more posts loaded
    let step = 0, scrollStall = 0, postStall = 0, lastTop = -1, lastCount = Object.keys(postsMap).length;

    while (step < MAX_STEPS) {
      step++;

      // Debug dump on step 2
      if (step === 2) {
        try {
          const mainHtml = await page.evaluate(() => {
            const main = document.querySelector('.scaffold-layout__main') || document.querySelector('main') || document.body;
            return main.innerHTML;
          });
          require('fs').writeFileSync('debug-main-' + label + '.html', mainHtml);
          log('[DEBUG] Dumped main HTML to debug-main-' + label + '.html');
        } catch(e) {}
      }

      // Scroll
      let scrollTop = lastTop;
      try {
        scrollTop = await page.evaluate(() => {
          const amount = Math.floor(window.innerHeight * 0.75);
          window.scrollBy({ top: amount, behavior: 'smooth' });
          const el = document.querySelector('.scaffold-layout__main')
            || document.querySelector('main')
            || document.querySelector('.scaffold-layout-container__main');
          if (el && el.scrollHeight > el.clientHeight + 100) el.scrollTop += amount;
          document.body.scrollTop += amount;
          return Math.max(
            Math.round(window.scrollY || window.pageYOffset || 0),
            Math.round(document.documentElement.scrollTop || 0),
            Math.round(document.body.scrollTop || 0),
            el ? Math.round(el.scrollTop) : 0
          );
        });
      } catch (e) {
        log('[WARN] Scroll failed (' + e.message.substring(0, 60) + '), skipping step.');
        await page.waitForTimeout(2000);
        continue;
      }

      // Wait longer so LinkedIn has time to lazy-load new posts
      await page.waitForTimeout(4000 + Math.floor(Math.random() * 2000));

      // Extract posts
      try {
        const domRecs = await page.evaluate(domExtractor);
        for (const r of (Array.isArray(domRecs) ? domRecs : [])) mergeDOM(r, postsMap);
      } catch (e) {
        log('[WARN] domExtractor failed (' + e.message.substring(0, 60) + '), skipping.');
      }

      const total = Object.keys(postsMap).length;
      log('[' + label + '] Step ' + step + ' | scroll=' + scrollTop + ' | posts=' + total + ' | sStall=' + scrollStall + ' pStall=' + postStall);

      if (Math.abs(scrollTop - lastTop) < 60) scrollStall++; else { scrollStall = 0; lastTop = scrollTop; }
      if (total === lastCount) postStall++; else { postStall = 0; lastCount = total; }

      // If stalled on posts, try clicking "Show more results" button before giving up
      if (postStall > 0 && postStall % 3 === 0) {
        try {
          const clicked = await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button')];
            const loadMore = btns.find(b => /(show more|load more|see more results)/i.test(b.innerText || ''));
            if (loadMore) { loadMore.click(); return true; }
            return false;
          });
          if (clicked) { log('[' + label + '] Clicked "show more" button.'); await page.waitForTimeout(3000); }
        } catch (_) {}
      }

      let atBottom = false;
      try {
        atBottom = await page.evaluate(() => {
          const el = document.querySelector('.scaffold-layout__main') || document.querySelector('main');
          if (el && el.scrollHeight > el.clientHeight + 100) return (el.scrollTop + el.clientHeight) >= el.scrollHeight - 600;
          const scrollY = window.scrollY || window.pageYOffset || 0;
          return (scrollY + window.innerHeight) >= Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - 600;
        });
      } catch (_) {}

      const stalled = step >= MIN_STEPS && (postStall >= MAX_STALL || scrollStall >= MAX_STALL || atBottom);
      if (stalled) {
        log('[' + label + '] Done scrolling (stalled or at bottom).');
        break;
      }
    }

    // Final extraction pass
    await page.waitForTimeout(2000);
    try {
      const finalRecs = await page.evaluate(domExtractor);
      for (const r of (Array.isArray(finalRecs) ? finalRecs : [])) mergeDOM(r, postsMap);
    } catch (_) {}

    const variantCount = Object.keys(postsMap).length - beforeCount;
    log('[' + label + '] Variant done: ' + Object.keys(postsMap).length + ' posts total (+' + variantCount + ' so far)');
  } // end variants loop

  const afterCount = Object.keys(postsMap).length;
  log('Keyword "' + keyword + '" complete: ' + afterCount + ' posts collected (+' + (afterCount - beforeCount) + ' new)');
  return afterCount;
}



// ── Windows toast notification ────────────────────────────────────────────────
function showNotification(title, msg) {
  try {
    const { execSync } = require('child_process');
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      $n = New-Object System.Windows.Forms.NotifyIcon;
      $n.Icon = [System.Drawing.SystemIcons]::Information;
      $n.Visible = $true;
      $n.ShowBalloonTip(5000, '${title.replace(/'/g, '')}', '${msg.replace(/'/g, '')}', [System.Windows.Forms.ToolTipIcon]::Info);
      Start-Sleep -Seconds 6;
      $n.Dispose();
    `;
    execSync('powershell -WindowStyle Hidden -Command "' + ps.replace(/\n/g, ' ') + '"', { timeout: 10000 });
  } catch (_) { }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     Nexora Playwright Scraper  v1.0          ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  const config = loadConfig();
  const { dashboardUrl, headless = false, chromeProfile = 'Default' } = config;
  // userId is resolved dynamically from the active LinkedIn session (no hardcoding)
  let userId = config.userId || null;  // optional fallback only

  if (!dashboardUrl) {
    console.error('[ERROR] dashboardUrl missing in config.json. Please run install.bat again.');
    process.exit(1);
  }

  log('Dashboard: ' + dashboardUrl);
  log('User ID:   ' + userId);
  log('Mode:      ' + (headless ? 'Headless (silent)' : 'Visible browser'));
  console.log('');

  // Determine which profile to use
  let activeProfile;
  if (USE_REAL_CHROME) {
    activeProfile = REAL_CHROME_DIR;
    log('Chrome profile: ' + chromeProfile);

    // Fix Chrome exit_type BEFORE launch so it doesn't show "Restore pages?" dialog.
    // taskkill sets exit_type to "Crashed"; we reset it to "Normal" here.
    const prefsPath = path.join(REAL_CHROME_DIR, chromeProfile, 'Preferences');
    if (fs.existsSync(prefsPath)) {
      try {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        if (!prefs.profile) prefs.profile = {};
        prefs.profile.exit_type = 'Normal';
        prefs.profile.crashed = false;
        fs.writeFileSync(prefsPath, JSON.stringify(prefs));
        log('Chrome exit_type set to Normal — restore dialog suppressed.');
      } catch (e) {
        log('[WARN] Could not patch Chrome preferences: ' + e.message);
      }
    }
  } else {
    activeProfile = PROFILE_DIR;
    fs.mkdirSync(activeProfile, { recursive: true });
  }

  let browser, page;
  try {
    if (USE_REAL_CHROME) {
      // ── Dedicated Stealth Profile via CDP ──────────────────────────────────
      // To prevent killing the user's main Chrome and to avoid App-Bound Encryption
      // cookie invalidation, we use a dedicated scraper profile directory but launch
      // it via spawn() to maintain 100% stealth (no Playwright automation flags).
      const { spawn } = require('child_process');
      const SCRAPER_PROFILE = path.join(os.homedir(), '.nexora_scraper', profileName === 'profile' ? 'stealth_profile' : profileName + '_stealth');
      fs.mkdirSync(SCRAPER_PROFILE, { recursive: true });

      // Find Chrome exe
      const chromePaths = [
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ];
      const chromeExe = chromePaths.find(p => fs.existsSync(p));
      if (!chromeExe) throw new Error('Google Chrome not found. Please install Chrome.');

      // Patch Preferences to suppress "Restore pages?" crash dialog
      const prefsPath = path.join(SCRAPER_PROFILE, 'Default', 'Preferences');
      if (fs.existsSync(prefsPath)) {
        try {
          const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
          if (!prefs.profile) prefs.profile = {};
          prefs.profile.exit_type = 'Normal';
          prefs.profile.crashed = false;
          fs.writeFileSync(prefsPath, JSON.stringify(prefs));
        } catch (_) { }
      }

      log('Launching isolated stealth browser...');
      const chromeProc = spawn(chromeExe, [
        '--remote-debugging-port=9222',
        '--remote-debugging-address=127.0.0.1',
        '--user-data-dir=' + SCRAPER_PROFILE,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-mode',
        '--disable-extensions', // speed up and prevent interference
        'about:blank'
      ], { stdio: ['ignore', 'ignore', 'pipe'] });

      chromeProc.stderr.on('data', d => { const m = d.toString().trim(); if (m && !m.includes('TensorFlow') && !m.includes('gcm')) log('[Chrome] ' + m.substring(0, 120)); });
      chromeProc.on('error', e => log('[Chrome error] ' + e.message));

      // Poll for CDP readiness
      log('Connecting to browser engine...');
      const waitStart = Date.now();
      let cdpReady = false;
      while (Date.now() - waitStart < 15000) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const txt = await new Promise((res, rej) => {
            http.get('http://127.0.0.1:9222/json/version', r => {
              let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
            }).on('error', rej);
          });
          if (txt.includes('webSocketDebuggerUrl') || txt.includes('Browser')) { cdpReady = true; break; }
        } catch (_) { }
      }
      if (!cdpReady) throw new Error('Could not connect to browser engine within 15s.');

      await new Promise(r => setTimeout(r, 1000));
      browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
      log('Connected \u2713');
      const ctx = browser.contexts()[0];
      page = await ctx.newPage();






    } else {
      // ── Isolated scraper profile (start.bat mode) ──────────────────────────
      fs.mkdirSync(PROFILE_DIR, { recursive: true });
      let usingChrome = false;
      for (const channel of ['chrome', null]) {
        try {
          browser = await chromium.launchPersistentContext(PROFILE_DIR, {
            headless,
            args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
            viewport: { width: 1280, height: 900 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            ...(channel ? { channel } : {}),
          });
          usingChrome = (channel === 'chrome');
          break;
        } catch (e) {
          if (channel === null) throw e;
          log('[INFO] System Chrome not found \u2014 using bundled Chromium...');
        }
      }
      log('Browser: ' + (usingChrome ? 'System Chrome \u2713' : 'Bundled Chromium'));
      await new Promise(r => setTimeout(r, 1000));
      const pages = browser.pages();
      page = pages.find(p => { const u = p.url(); return u && !u.startsWith('about:') && !u.startsWith('chrome://'); })
        || await browser.newPage();
    }

    // Stealth: remove webdriver flag
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });


    // Check login
    await ensureLoggedIn(page);

    // ── Network Extraction (Handles Obfuscated UI) ───────────────────────────
    let activePostsMap = null;
    page.on('response', async (res) => {
      if (!activePostsMap) return;
      try {
        const url = res.url();
        if (!url.includes('/voyager/api/') && !url.includes('/graphql') && !url.includes('/search/')) return;
        const body = await res.text();
        if (!body || body.length < 200) return;
        const fc = body.trimStart()[0];
        if (fc !== '{' && fc !== '[') return;
        let json;
        try { json = JSON.parse(body); } catch (_) { return; }

        function pe(v) { return typeof v === 'number' ? v : 0; }
        function walk(obj) {
          if (!obj || typeof obj !== 'object') return;
          let rawUrn = String(obj.updateUrn || obj.entityUrn || obj.urn || '');
          
          // Upgrade ugcPost to activity if possible to prevent "Post cannot be displayed"
          if (rawUrn.includes('ugcPost')) {
            const str = JSON.stringify(obj);
            const actMatch = str.match(/urn:li:activity:([0-9]{15,25})/);
            if (actMatch) rawUrn = actMatch[0];
          }

          const m = rawUrn.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
          if (m) {
            const urn = 'urn:li:' + m[1] + ':' + m[2];
            let bestText = '';
            function extractText(o) {
              if (!o || typeof o !== 'object') return;
              if (typeof o.text === 'string' && o.text.length > bestText.length) bestText = o.text;
              if (typeof o.text?.text === 'string' && o.text.text.length > bestText.length) bestText = o.text.text;
              if (Array.isArray(o)) o.forEach(extractText);
              else Object.values(o).forEach(extractText);
            }
            extractText(obj);
            const text = bestText.substring(0, 5000);

            let bestAuthor = '';
            function extractAuthor(o) {
              if (!o || typeof o !== 'object') return;
              const name = o.actor?.name?.text || o.actor?.nameV2?.text || o.actor?.fullName;
              if (typeof name === 'string' && name.length > bestAuthor.length) bestAuthor = name;
              if (Array.isArray(o)) o.forEach(extractAuthor);
              else Object.values(o).forEach(extractAuthor);
            }
            extractAuthor(obj);
            const author = bestAuthor.substring(0, 100);
            const soc    = obj.socialDetail || {};
            const activityCounts = soc.totalSocialActivityCounts || obj.totalSocialActivityCounts || obj || {};
            
            if (!activePostsMap[urn]) {
              // Always use the canonical feed/update format because /posts/{id} can fail
              // for ugcPosts if they don't have a corresponding activity ID.
              let url = 'https://www.linkedin.com/feed/update/' + urn;
              activePostsMap[urn] = { 
                canonicalUrn: urn, 
                postUrl: url,
                source: 'network' 
              };
            }
            const p = activePostsMap[urn];
            if (text && !p.postText) p.postText = text;
            if (author && !p.authorName) p.authorName = author;
            
            // Detect polls
            if (JSON.stringify(obj).includes('"voteCount"') || JSON.stringify(obj).includes('"pollId"')) {
              p.isPoll = true;
            }
            
            const likes = pe(activityCounts.numLikes);
            const comments = pe(activityCounts.numComments);
            if (likes > 0) p.likes = Math.max(p.likes || 0, likes);
            if (comments > 0) p.comments = Math.max(p.comments || 0, comments);
          }
          if (Array.isArray(obj)) { for (const x of obj) walk(x); }
          else { for (const k in obj) walk(obj[k]); }
        }
        walk(json);
      } catch (e) {
        // ignore
      }
    });


    // ── Dynamic user resolution ──────────────────────────────────────────────
    // Read the li_at cookie from the live LinkedIn session, then ask the
    // dashboard which userId owns that session. This means no hardcoded
    // userId — the scraper always routes to whoever is currently logged in.
    log('');
    log('Identifying account from LinkedIn session...');
    try {
      const cookies = await page.context().cookies('https://www.linkedin.com');
      const liAt = (cookies.find(c => c.name === 'li_at') || {}).value;
      if (liAt) {
        const whoResp = await apiFetch(dashboardUrl + '/api/extension/who-am-i', {
          headers: { 'x-linkedin-cookie': liAt },
        });
        if (whoResp.ok) {
          const who = whoResp.json();
          if (who.found && who.userId) {
            userId = who.userId;
            log('Session identified ✓  (userId resolved from active LinkedIn session)');
          } else {
            log('[WARN] ' + (who.error || 'Session not linked to any dashboard account.'));
            log('[WARN] Go to Dashboard → Settings → save your LinkedIn session cookie.');
          }
        } else {
          log('[WARN] who-am-i returned ' + whoResp.status);
        }
      } else {
        log('[WARN] li_at cookie not found — is LinkedIn properly logged in?');
      }
    } catch (e) {
      log('[WARN] Could not resolve identity: ' + e.message);
    }

    if (!userId) {
      throw new Error('Could not determine userId. Link your LinkedIn session in Dashboard → Settings, or add userId to config.json as a fallback.');
    }
    log('Active userId: ' + userId);
    // Fetch keywords
    log('');
    log('Fetching keywords from dashboard...');
    let keywords = await fetchKeywords(dashboardUrl, userId);
    log('Keywords: ' + keywords.join(', '));

    // Scrape each keyword
    let totalSaved = 0;
    const runSeenUrns = new Set(); // Track URNs across all keywords to prevent duplicates
    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      log('');
      log('Keyword ' + (i + 1) + ' of ' + keywords.length);

      const postsMap = {};
      activePostsMap = postsMap;
      await scrapeKeyword(page, kw, postsMap);
      activePostsMap = null;

      const allPosts = Object.values(postsMap);
      const posts = filterAndRankPosts(allPosts, runSeenUrns);
      log('Engagement filter: ' + allPosts.length + ' raw → ' + posts.length + ' qualified posts');
      if (posts.length > 0) {
        try {
          const saved = await pushToAPI(posts, kw, dashboardUrl, userId);
          totalSaved += saved;
        } catch (e) {
          log('[ERROR] Failed to save posts: ' + e.message);
        }
      } else {
        log('No qualifying posts for keyword: ' + kw);
      }

      // Pause between keywords to look human
      if (i < keywords.length - 1) {
        log('Pausing 5s before next keyword...');
        await page.waitForTimeout(5000);
      }
    }

    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  Done!  Total posts saved: ' + String(totalSaved).padEnd(17) + '║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    showNotification('Nexora Scraper', 'Done! ' + totalSaved + ' posts saved to your dashboard.');

  } catch (e) {
    console.error('');
    console.error('[FATAL ERROR] ' + e.message);
    console.error('');
    console.error('Common fixes:');
    console.error('  • Check your Dashboard URL and User ID in config.json');
    console.error('  • Make sure you are logged into LinkedIn');
    console.error('  • Run install.bat again if this is a fresh install');
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => { });
  }
})();
