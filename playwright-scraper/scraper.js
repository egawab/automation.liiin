// scraper.js — Nexora Playwright Scraper v1.0
// Replaces the Chrome Extension. Uses CDP-level network interception.
'use strict';

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const https = require('https');
const http  = require('http');

const CONFIG_PATH    = path.join(__dirname, 'config.json');
const PROFILE_DIR    = path.join(os.homedir(), '.nexora_scraper', 'profile');
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
    const u   = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + u.search,
      method:   opts.method || 'GET',
      headers:  opts.headers || {},
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({
        ok:   res.statusCode >= 200 && res.statusCode < 300,
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

// ── Parse engagement number (e.g. "1.2K" → 1200) ─────────────────────────────
function pe(s) {
  if (s == null) return 0;
  const x = String(s).toUpperCase().replace(/,/g, '');
  const n = parseFloat((x.match(/[0-9.]+/) || [])[0]);
  if (isNaN(n)) return 0;
  if (x.includes('K')) return Math.floor(n * 1000);
  if (x.includes('M')) return Math.floor(n * 1000000);
  return Math.floor(n);
}

// ── Network response → postsMap ───────────────────────────────────────────────
function ingestBody(body, postsMap) {
  let json;
  try { json = JSON.parse(body); } catch (_) { return; }
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    const rawUrn = String(obj.entityUrn || obj.updateUrn || obj.urn || '');
    const m = rawUrn.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
    if (m) {
      const urn = 'urn:li:' + m[1] + ':' + m[2];

      // Try every known text field path LinkedIn has ever used
      const text = String(
        obj.commentary?.text?.text ||
        obj.commentary?.text ||
        obj.specificContent?.['com.linkedin.ugc.ShareContent']?.shareCommentary?.text ||
        obj.content?.article?.description ||
        obj.content?.article?.title ||
        obj.resharedUpdate?.commentary?.text?.text ||
        obj.resharedUpdate?.commentary?.text ||
        obj.text?.text ||
        obj.text ||
        obj.description?.text ||
        obj.description ||
        // Search result formats:
        (typeof obj.summary === 'string' ? obj.summary : (obj.summary?.text || '')) ||
        obj.snippet?.text ||
        obj.snippet ||
        obj.headline?.text ||
        obj.insight?.text ||
        obj.insightText?.text ||
        ''
      ).substring(0, 5000);

      let authorObj =
        obj.actor?.name?.text ||
        obj.actor?.nameV2?.text ||
        obj.actor?.fullName ||
        // Search result formats:
        obj.title?.text ||          // search results put author name in title.text
        obj.actorName ||
        obj.primarySubtitle?.text || // sometimes the name is in the subtitle
        null;
      if (!authorObj && obj.author && (obj.author.firstName || obj.author.lastName)) {
        authorObj = [obj.author.firstName, obj.author.lastName].filter(Boolean).join(' ');
      }
      const author = String(authorObj || '').trim().substring(0, 100);


      const soc      = obj.socialDetail || obj.totalSocialActivityCounts || {};
      const likes    = pe(soc.numLikes    ?? obj.numLikes);
      const comments = pe(soc.numComments ?? obj.numComments);
      const old      = postsMap[urn] || {};

      postsMap[urn] = {
        canonicalUrn: urn,
        url:      old.url || ('https://www.linkedin.com/feed/update/' + urn),
        postText: text.length > (old.postText || '').length ? text : (old.postText || ''),
        author:   (author && author !== 'Unknown' && author !== 'undefined undefined' && author.length > 1) ? author : (old.author || 'Unknown'),
        likes:    Math.max(old.likes || 0, likes),
        comments: Math.max(old.comments || 0, comments),
        source:   'network',
      };
    }
    if (Array.isArray(obj)) { for (const item of obj) walk(item); }
    else { for (const k of Object.keys(obj)) { if (typeof obj[k] === 'object' && k !== 'paging') walk(obj[k]); } }
  }
  walk(json);
}

// ── DOM extractor (runs inside page via evaluate) ─────────────────────────────
const DOM_FN = `() => {
  const records = [], seen = {};
  function pe(s) {
    if (!s) return 0;
    const x = String(s).toUpperCase().replace(/,/g,'');
    const n = parseFloat((x.match(/[0-9]+\\.?[0-9]*/) || [])[0]);
    if (isNaN(n)) return 0;
    if (x.indexOf('K')>-1) return Math.floor(n*1000);
    if (x.indexOf('M')>-1) return Math.floor(n*1000000);
    return Math.floor(n);
  }
  function xUrn(s) {
    const m = String(s||'').match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
    if (m) return 'urn:li:'+m[1]+':'+m[2];
    const p = String(s||'').match(/activity-([0-9]{10,25})/i);
    if (p) return 'urn:li:activity:'+p[1];
    return '';
  }
  function getEng(el) {
    let lk=0, cm=0;
    try {
      el.querySelectorAll('[aria-label]').forEach(x => {
        const a = x.getAttribute('aria-label')||'';
        if (/[0-9]/.test(a) && /(reaction|like|reacted)/i.test(a)) lk=Math.max(lk,pe(a));
        if (/[0-9]/.test(a) && /comment/i.test(a)) cm=Math.max(cm,pe(a));
      });
      el.querySelectorAll('span,button').forEach(x => {
        if (x.children.length>3) return;
        const n=(x.innerText||'').trim();
        const r=n.match(/([0-9][0-9,.]*[KkMm]?)\\s*(reaction|like|reacted)/i); if(r) lk=Math.max(lk,pe(r[1]));
        const c=n.match(/([0-9][0-9,.]*[KkMm]?)\\s*comment/i);               if(c) cm=Math.max(cm,pe(c[1]));
      });
    } catch(_){}
    return {likes:lk, comments:cm};
  }
  function getText(el) {
    // Priority: try known LinkedIn content selectors first
    const selectors = [
      '.update-components-text__text-view',
      '.update-components-text',
      '.feed-shared-inline-show-more-text',
      '.feed-shared-update-v2__description',
      '.feed-shared-text',
      '.break-words',
      '.entity-result__summary',
      '.entity-result__content-primary'
    ];
    let txt = '';
    for (const s of selectors) {
      try {
        el.querySelectorAll(s).forEach(d => {
          const t = (d.innerText || d.textContent || '').trim();
          if (t.length > txt.length) txt = t;
        });
      } catch(_){}
    }
    // Fallback: use textContent (works even when innerText returns empty)
    if (txt.length < 20) {
      try {
        const raw = (el.textContent || '').replace(/[\\r\\n\\t]+/g, ' ').replace(/  +/g, ' ').trim();
        if (raw.length > txt.length) txt = raw;
      } catch(_){}
    }
    return txt.substring(0, 3000);
  }
  function getAuthor(el) {
    // Try multiple LinkedIn actor selectors in priority order
    const authorSelectors = [
      '.update-components-actor__name span[aria-hidden="true"]',
      '.update-components-actor__name',
      '.entity-result__title-text a span[aria-hidden="true"]',
      '.entity-result__title-text a',
      '.app-aware-link .visually-hidden',
    ];
    for (const s of authorSelectors) {
      try {
        const el2 = el.querySelector(s);
        if (el2) {
          const t = (el2.innerText || el2.textContent || '').trim().split('\\n')[0].trim();
          if (t && t.length > 1 && !/^(Unknown|View|Follow)$/i.test(t)) return t.substring(0, 100);
        }
      } catch(_){}
    }
    // Fallback to href-based search
    const a = el.querySelector('a[href*="/in/"],a[href*="/company/"]');
    if (!a) return 'Unknown';
    const aria = (a.getAttribute('aria-label') || '')
      .replace(/^[Vv]iew\\s+(?:company:\\s*)?/i, '')
      .replace(/\\s*[\\u2019']s\\s.*/i, '')
      .replace(/\\s*(profile|page|company)\\s*$/i, '').trim();
    if (aria && aria.length > 1 && !/^(Unknown|View)$/i.test(aria)) return aria.substring(0, 100);
    const linkText = (a.innerText || a.textContent || '').trim().split('\\n')[0] || 'Unknown';
    return linkText.substring(0, 100);
  }
  function walkCard(anchorEl, urn, href) {
    let c = anchorEl, best = null;
    for(let i = 0; i < 30; i++){
      c = c.parentElement; if(!c || c === document.body) break;
      const l = Math.max((c.innerText||'').trim().length, (c.textContent||'').trim().length);
      if(l >= 20000) break;  // overshot into page shell
      if(l > 300) { best = c; break; }  // real card with content
      if(l > 50 && !best) best = c;     // fallback if nothing bigger found
    }
    if(!best) return;
    seen[urn]=1;
    const eng=getEng(best);
    records.push({urn, url:href, text:getText(best).substring(0,3000), author:getAuthor(best), likes:eng.likes, comments:eng.comments});
  }
  try {
    document.querySelectorAll('a[href]').forEach(a=>{
      if(!a.href||(!(a.href.includes('feed/update/urn:li:'))&&!a.href.includes('/posts/'))) return;
      const urn=xUrn(a.href); if(!urn||seen[urn]) return;
      walkCard(a,urn,a.href);
    });
  } catch(_){}
  try {
    ['data-urn','data-activity-urn','data-chameleon-result-urn','data-entity-urn'].forEach(attr=>{
      document.querySelectorAll('['+attr+']').forEach(el=>{
        const urn=xUrn(el.getAttribute(attr)||''); if(!urn||seen[urn]) return;
        // Walk UP the tree to find a real card with visible text (same as walkCard)
        // Needed because LinkedIn often puts data-urn on an invisible wrapper div
        let c = el;
        for (let i = 0; i < 15; i++) {
          if (!c.parentElement || c.parentElement === document.body) break;
          c = c.parentElement;
          const l = (c.innerText||'').trim().length;
          if (l > 50 && l < 20000) break;  // found the real card
        }
        seen[urn]=1;
        const eng=getEng(c);
        records.push({urn, url:'', text:getText(c).substring(0,3000), author:getAuthor(c), likes:eng.likes, comments:eng.comments});
      });
    });
    
    document.querySelectorAll('.reusable-search__result-container, .feed-shared-update-v2, .occludable-update').forEach(el => {
      let urn = '';
      const m = el.innerHTML.match(/urn:li:(activity|ugcPost|share):[0-9]+/);
      if (m) urn = m[0];
      if (!urn) {
        const a = el.querySelector('a[href*="urn:li:"]');
        if (a) urn = xUrn(a.href);
      }
      if (!urn || seen[urn]) return;
      seen[urn] = 1;
      const eng = getEng(el);
      records.push({urn, url:'', text:getText(el).substring(0,3000), author:getAuthor(el), likes:eng.likes, comments:eng.comments});
    });
  } catch(_){}
  return records;
}`;

// ── Merge DOM record into postsMap ─────────────────────────────────────────────
function mergeDOM(rec, postsMap) {
  if (!rec.urn) return;
  const old = postsMap[rec.urn] || {};
  postsMap[rec.urn] = {
    canonicalUrn: rec.urn,
    url:      rec.url || old.url || ('https://www.linkedin.com/feed/update/' + rec.urn),
    postText: rec.text.length > (old.postText || '').length ? rec.text : (old.postText || ''),
    author:   (old.author && old.author !== 'Unknown') ? old.author : rec.author,
    likes:    Math.max(old.likes || 0, rec.likes || 0),
    comments: Math.max(old.comments || 0, rec.comments || 0),
    source:   old.source || 'dom',
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
    } catch (_) {}
  }
  if (kws.length === 0 && Array.isArray(jobs.keywords)) {
    kws.push(...jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean));
  }
  if (kws.length === 0) throw new Error('No keywords configured in dashboard.');
  return [...new Set(kws)];
}

// ── Filter and rank posts by engagement ─────────────────────────────────────
// Tiered quality filter: balances volume vs quality.
// Rule priority (checked in order):
//   1. No URN          → always drop (can't deduplicate)
//   2. Zero engagement → always drop (no signal at all)
//   3. Has comment(s)  → always keep (comments = strong high-intent signal)
//   4. Likes >= 3      → keep       (meaningful reach, even without comments)
//   5. Likes 1–2       → drop       (too weak; likely bots or low-visibility posts)
function filterAndRankPosts(posts) {
  const score = (p) => (p.likes || 0) + (p.comments || 0) * 3;

  const filtered = posts.filter(p => {
    const urn      = p.canonicalUrn;
    const likes    = p.likes    || 0;
    const comments = p.comments || 0;
    const tag      = `[likes=${likes} comments=${comments}]`;

    log('[EXTRACTED] ' + (urn || '(no-urn)') + ' | likes=' + likes + ' comments=' + comments + ' author=' + (p.author || '?') + ' textLen=' + (p.postText || '').length);

    // Rule 1: must have a URN for deduplication
    if (!urn) { log('[DROP] (no-urn) ' + (p.postText || '').substring(0, 40) + ' -> no canonicalUrn'); return false; }

    // Rule 2: completely dead post — no engagement at all
    if (likes === 0 && comments === 0) { log('[DROP] ' + urn + ' ' + tag + ' -> zero engagement'); return false; }

    // Rule 3: any comment = strong intent signal → always keep
    if (comments >= 1) { log('[VALIDATION PASS] ' + urn + ' ' + tag + ' -> has comments'); return true; }

    // Rule 4: meaningful like-reach (3+ likes, no comments)
    if (likes >= 3) { log('[VALIDATION PASS] ' + urn + ' ' + tag + ' -> reach ok'); return true; }

    // Rule 5: 1-2 likes with no comments = too weak
    log('[DROP] ' + urn + ' ' + tag + ' -> low signal (< 3 likes, 0 comments)');
    return false;
  });

  // Sort highest-engagement first
  filtered.sort((a, b) => score(b) - score(a));
  return filtered;
}

// ── Push results ──────────────────────────────────────────────────────────────
async function pushToAPI(posts, keyword, dashUrl, userId) {
  if (!posts.length) { log('No posts to save for: ' + keyword); return 0; }

  // Map internal fields to the API contract:
  // postText (internal) → postPreview (API) for the dashboard snippet
  const payload = posts.map(p => ({
    ...p,
    postPreview: (p.postText || '').substring(0, 500) || undefined,
  }));

  const resp = await apiFetch(dashUrl + '/api/extension/results', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
    body:    JSON.stringify({ posts: payload, keyword, source: 'nexora_playwright_v1' }),
  });
  if (!resp.ok) throw new Error('API error ' + resp.status + ': ' + resp.text().substring(0, 200));
  const data = resp.json();
  const created = data.createdCount ?? 0;
  const updated = data.updatedCount ?? 0;
  const totalProcessed = (data.createdCount !== undefined) ? (created + updated) : (data.savedCount ?? posts.length);
  for (const p of payload) log('[SAVED] ' + p.canonicalUrn + ' preview=' + (p.postPreview||'').substring(0,40).replace(/\n/g,' '));
  log('✓ Saved ' + totalProcessed + '/' + posts.length + ' posts (New: ' + created + ', Updated: ' + updated + ')  [keyword: ' + keyword + ']');
  return totalProcessed;
}

// ── Safe navigation (tolerates LinkedIn's 999 and redirect-loop responses) ─────
async function safeGoto(page, url, opts = {}) {
  const RECOVERABLE = [
    'ERR_HTTP_RESPONSE_CODE_FAILURE',
    'ERR_ABORTED',
    'ERR_TOO_MANY_REDIRECTS',
  ];

  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 30000, ...opts });
  } catch (e) {
    const msg = e.message || '';
    const isRecoverable = RECOVERABLE.some(code => msg.includes(code));
    if (!isRecoverable) throw e;

    log('[WARN] Navigation issue (' + (RECOVERABLE.find(c => msg.includes(c)) || 'unknown') + ')');

    // Redirect loop usually means session state is broken for this URL.
    // Reset by going to the feed first, then retry once.
    if (msg.includes('ERR_TOO_MANY_REDIRECTS')) {
      log('[RECOVERY] Navigating to feed to reset session state...');
      try {
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'commit', timeout: 20000 });
        await page.waitForTimeout(3000);
        // Retry the original URL once
        await page.goto(url, { waitUntil: 'commit', timeout: 30000, ...opts });
      } catch (_) {
        log('[WARN] Recovery attempt failed — continuing with current page state.');
      }
    }
  }

  await page.waitForTimeout(1500);
}

// ── Ensure LinkedIn is logged in ──────────────────────────────────────────────
async function ensureLoggedIn(page) {
  // If the user ran import-session.bat, inject the saved cookie first.
  // This lets us use an already-logged-in account without entering credentials.
  // BUT do NOT do this if USE_REAL_CHROME is active, because we already copied
  // the real, live session files. Injecting a stale cookie file here destroys
  // the live session and causes ERR_TOO_MANY_REDIRECTS loops.
  if (!USE_REAL_CHROME) {
    const cookieFile = path.join(__dirname, 'linkedin_cookies.json');
    if (fs.existsSync(cookieFile)) {
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
  }

  log('Checking LinkedIn session...');
  await safeGoto(page, 'https://www.linkedin.com/feed/');
  const url = page.url();
  if (url.includes('/login') || url.includes('/checkpoint') || url.includes('/authwall')) {
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ACTION REQUIRED:');
    console.log('  Please log into LinkedIn in the browser window.');
    console.log('  Once you are logged in and see your feed, come back');
    console.log('  here and press ENTER to continue.');
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


// ── Scrape one keyword (3 URL variants to maximise yield per keyword) ──────────
async function scrapeKeyword(page, keyword, postsMap) {
  // LinkedIn returns DIFFERENT result sets for different sort/date params.
  // Running all three variants and merging into one shared postsMap can
  // 2-3x the unique posts collected, especially for accounts with fewer results.
  const base = 'https://www.linkedin.com/search/results/content/?keywords='
             + encodeURIComponent(keyword);
  const urlVariants = [
    { url: base + '&origin=GLOBAL_SEARCH_HEADER',                       label: 'relevance' },
    { url: base + '&origin=GLOBAL_SEARCH_HEADER&sortBy=date_posted',    label: 'recent'    },
    { url: base + '&origin=GLOBAL_SEARCH_HEADER&datePosted=past-month', label: 'month'     },
  ];

  log('');
  log('── Keyword: "' + keyword + '" ──────────────────────────────');

  // Single network listener shared across all variants
  const onResponse = async (response) => {
    const rUrl = response.url();
    if (!rUrl.includes('linkedin.com')) return;
    if (/(\\.js|\\.css|\\.png|\\.jpg|\\.gif|\\.woff|\\.svg)(\?|$)/i.test(rUrl)) return;
    if (!rUrl.includes('voyager/api') && !rUrl.includes('/feed/') && !rUrl.includes('/search/') && !rUrl.includes('/updates') && !rUrl.includes('contentrecipe')) return;
    try {
      const body = await response.text();
      if (body.length < 200) return;
      const fc = body.trimStart()[0];
      if (fc !== '{' && fc !== '[') return;
      ingestBody(body, postsMap);
    } catch (_) {}
  };
  page.on('response', onResponse);

  try {
    for (const { url: searchUrl, label } of urlVariants) {
      const beforeCount = Object.keys(postsMap).length;
      log('Variant [' + label + '] navigating...');
      await safeGoto(page, searchUrl);

      // Wait for feed to render
      let waited = 0;
      while (waited < 12000) {
        const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
        const clientH = await page.evaluate(() => document.documentElement.clientHeight);
        if (scrollH > clientH * 1.5) break;
        await page.waitForTimeout(500);
        waited += 500;
      }

      // Scroll loop — dual stagnation tracking
      const MAX_STEPS = 50;
      const MIN_STEPS = 8;
      const MAX_STALL = 7;
      let step = 0, scrollStall = 0, postStall = 0, lastTop = -1, lastCount = Object.keys(postsMap).length;

      while (step < MAX_STEPS) {
        step++;
        const scrollTop = await page.evaluate(() => {
          const amount = Math.floor(window.innerHeight * 0.80);
          window.scrollBy({ top: amount, behavior: 'instant' });
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

        await page.waitForTimeout(2500 + Math.floor(Math.random() * 1500));

        const domRecs = await page.evaluate('(' + DOM_FN + ')()');
        for (const r of (Array.isArray(domRecs) ? domRecs : [])) mergeDOM(r, postsMap);

        const total = Object.keys(postsMap).length;
        log('[' + label + '] Step ' + step + ' | scroll=' + scrollTop + ' | posts=' + total + ' | sStall=' + scrollStall + ' pStall=' + postStall);

        if (Math.abs(scrollTop - lastTop) < 60) scrollStall++; else { scrollStall = 0; lastTop = scrollTop; }
        if (total === lastCount) postStall++;                   else { postStall   = 0; lastCount = total;   }

        const atBottom = await page.evaluate(() => {
          const el = document.querySelector('.scaffold-layout__main') || document.querySelector('main');
          if (el && el.scrollHeight > el.clientHeight + 100) return (el.scrollTop + el.clientHeight) >= el.scrollHeight - 800;
          const scrollY = window.scrollY || window.pageYOffset || 0;
          return (scrollY + window.innerHeight) >= Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - 800;
        });

        const stalled = step >= MIN_STEPS && (postStall >= MAX_STALL || scrollStall >= MAX_STALL || atBottom);
        if (stalled) {
          const reason = atBottom ? 'atBottom' : (postStall >= MAX_STALL ? 'pStall' : 'sStall');
          const clicked = await page.evaluate(() => {
            const btn = document.querySelector('.artdeco-pagination__button--next')
                     || document.querySelector('button[aria-label="Next"]')
                     || document.querySelector('button[aria-label="Go to next page"]')
                     || Array.from(document.querySelectorAll('button')).find(b => (b.innerText||'').trim().toLowerCase() === 'next');
            if (btn && !btn.disabled) { btn.click(); return true; }
            return false;
          });
          if (clicked) {
            log('[' + label + '] Next page (' + reason + ')');
            scrollStall = 0; postStall = 0;
            await page.waitForTimeout(5000);
            continue;
          }
          log('[' + label + '] done (' + reason + ', no Next btn)');
          break;
        }
      }

      // Final DOM pass for this variant
      await page.waitForTimeout(2000);
      const finalRecs = await page.evaluate('(' + DOM_FN + ')()');
      for (const r of (Array.isArray(finalRecs) ? finalRecs : [])) mergeDOM(r, postsMap);

      const afterCount = Object.keys(postsMap).length;
      log('[' + label + '] +' + (afterCount - beforeCount) + ' new (total=' + afterCount + ')');

      // Skip remaining variants if we already have a strong yield
      if (afterCount >= 25) { log('Good yield — skipping remaining variants.'); break; }
      await page.waitForTimeout(2000);
    }
  } finally {
    page.off('response', onResponse);
  }

  const count = Object.keys(postsMap).length;
  log('Keyword "' + keyword + '" complete: ' + count + ' posts collected');
  return count;
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
  } catch (_) {}
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
        prefs.profile.crashed   = false;
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
      const SCRAPER_PROFILE = path.join(os.homedir(), '.nexora_scraper', 'stealth_profile');
      fs.mkdirSync(SCRAPER_PROFILE, { recursive: true });

      // Find Chrome exe
      const chromePaths = [
        path.join(process.env['ProgramFiles']      || 'C:\\Program Files',       'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['LOCALAPPDATA']      || '',                         'Google', 'Chrome', 'Application', 'chrome.exe'),
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
          prefs.profile.crashed   = false;
          fs.writeFileSync(prefsPath, JSON.stringify(prefs));
        } catch (_) {}
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
        } catch (_) {}
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
    const keywords = await fetchKeywords(dashboardUrl, userId);
    log('Keywords: ' + keywords.join(', '));

    // Scrape each keyword
    let totalSaved = 0;
    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      log('');
      log('Keyword ' + (i + 1) + ' of ' + keywords.length);

      const postsMap = {};
      await scrapeKeyword(page, kw, postsMap);

      const allPosts = Object.values(postsMap);
      const posts    = filterAndRankPosts(allPosts);
      log('Engagement filter: ' + allPosts.length + ' raw → ' + posts.length + ' qualified posts');
      if (posts.length > 0) {
        try {
          const saved = await pushToAPI(posts, kw, dashboardUrl, userId);
          totalSaved += saved;
        } catch (e) {
          log('[ERROR] Failed to save posts: ' + e.message);
        }
      } else {
        log('No qualifying posts for keyword: ' + kw + ' (all had zero engagement)');
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
    if (browser) await browser.close().catch(() => {});
  }
})();
