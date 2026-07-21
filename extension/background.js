// background.js â€” Nexora Headless Scraper + Auto-Enrich + Auto-Delete  v7.0
// FIXES: scroll mechanics, extraction volume, enrich retry, auto-delete safety, uncertain sentinel
console.log('[BG] Nexora Headless Scraper v7 loaded');

const S = {
  state: 'IDLE',
  tabId: null,
  runId: 0,
  totalSaved: 0,
  dashboardUrl: '',
  userId: '',
  keywords: [],
  kwIndex: 0,
  lastError: '',
  lastMessage: '',
};

const E = { running: false };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Strip paths/trailing slashes so we never hit /dashboard/api/... (classic 404). */
function normalizeDashboardUrl(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    // Always origin only — never keep /dashboard or other paths.
    return u.origin;
  } catch (_) {
    return s.replace(/\/+$/, '').replace(/\/(dashboard|login|register|admin).*$/i, '');
  }
}

function apiUrl(path) {
  const base = normalizeDashboardUrl(S.dashboardUrl);
  const p = path.startsWith('/') ? path : '/' + path;
  return base + p;
}

// ── Checkpoint / auth-wall detector — account & language agnostic ───────────
// LinkedIn shows a challenge/login/"unusual activity" interstitial instead of
// real results for some accounts (new accounts, flagged accounts, different
// regions/UI languages). If we don't recognize this, the scraper silently
// "finds nothing" on that account and looks broken/inconsistent. Matching a
// wide multi-language marker set makes behaviour the same on every account.
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

// â”€â”€ Keep-alive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
chrome.alarms.create('nexora_hb', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'nexora_hb') return;
  if (S.state === 'RUNNING' || E.running) {
    console.log('[BG] hb state=' + S.state + ' kw=' + (S.keywords[S.kwIndex] || '') + ' saved=' + S.totalSaved);
    chrome.storage.local.set({ nexoraHbAt: Date.now(), nexoraState: S.state }).catch(() => {});
  }
});

// â”€â”€ URN helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // FIX: ugcPost /posts/{number} is not a valid LinkedIn URL â€” use /feed/update/ for all types.
  // linkedin.com/posts/7459935... â†’ 404. Correct: /feed/update/urn:li:ugcPost:7459935...
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
  return Array.from(urlMap.entries()).map(([canonicalUrn, url]) => ({ canonicalUrn, url, source: 'search_only' }));
}

// â”€â”€ CSRF Token â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getCsrfToken() {
  return new Promise(resolve => {
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' }, c => {
      resolve(c ? c.value.replace(/"/g, '') : null);
    });
  });
}

// â”€â”€ HTML fetch helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache'
      }
    });
    if (!res.ok) { console.warn('[BG] HTML ' + res.status + ' ' + url); return ''; }
    const text = await res.text();
    if (isCheckpointText(text)) {
      console.warn('[BG] HTML fetch hit a checkpoint/auth-wall page for this account — ' + url);
    }
    return text;
  } catch (e) {
    console.warn('[BG] fetchHtml error:', e.message);
    return '';
  }
}

// â”€â”€ Voyager GraphQL paginator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchViaVoyager(keyword, queryId, csrf, urlMap) {
  const MAX_PAGES = 60; // raised cap — no artificial ceiling on volume, just a safety bound
  let success = false;
  let emptyStreak = 0;
  for (let start = 0; start < MAX_PAGES * 10; start += 10) {
    if (S.state !== 'RUNNING') break;
    const apiUrl = `https://www.linkedin.com/voyager/api/graphql?variables=(count:10,keywords:${encodeURIComponent(keyword)},origin:GLOBAL_SEARCH_HEADER,q:blended,start:${start})&queryId=${queryId}`;
    let text = null;
    for (let retry = 0; retry < 3; retry++) {
      try {
        const res = await fetch(apiUrl, {
          headers: {
            'accept': 'application/vnd.linkedin.normalized+json+2.1',
            'csrf-token': csrf || '',
            'x-restli-protocol-version': '2.0.0',
            'x-li-lang': 'en_US',
          }
        });
        if (res.ok) { text = await res.text(); break; }
        if (res.status === 401 || res.status === 403) {
          console.warn('[BG] Voyager HTTP ' + res.status + ' start=' + start + ' — auth/csrf rejected on this account, stopping this channel.');
          break;
        }
        // Transient (429/5xx/999 etc.) — retry with backoff instead of giving up on the account.
        console.warn('[BG] Voyager HTTP ' + res.status + ' start=' + start + ' — retry ' + (retry + 1) + '/3');
        await sleep(2000 * (retry + 1));
      } catch (e) {
        console.warn('[BG] Voyager GraphQL error (retry ' + (retry + 1) + '/3):', e.message);
        await sleep(2000 * (retry + 1));
      }
    }
    if (text === null) break;
    if (isCheckpointText(text)) { console.warn('[BG] Voyager GraphQL checkpoint page — stopping this channel for kw="' + keyword + '"'); break; }
    const posts = extractPostsFromText(text);
    let added = 0;
    posts.forEach(p => { if (!urlMap.has(p.canonicalUrn)) { urlMap.set(p.canonicalUrn, p); added++; } });
    console.log('[BG] Voyager GraphQL start=' + start + ': +' + added + ' (total=' + urlMap.size + ')');
    if (added === 0) {
      emptyStreak++;
      if (emptyStreak >= 2) break; // two consecutive empty pages = genuinely exhausted
    } else {
      emptyStreak = 0;
      success = true;
    }
    await sleep(1200);
  }
  return success;
}

// â”€â”€ Voyager REST search (no queryId needed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchViaVoyagerRest(keyword, csrf, urlMap, sortBy) {
  const sort = sortBy || 'relevance';
  const MAX_PAGES = 40; // raised cap — let it exhaust naturally instead of stopping early
  let success = false;
  let emptyStreak = 0;
  for (let start = 0; start < MAX_PAGES * 10; start += 10) {
    if (S.state !== 'RUNNING') break;
    // FIX: Use the correct Voyager search endpoint format (v2 style with proper filter encoding)
    const apiUrl = `https://www.linkedin.com/voyager/api/search/blended?count=10&keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER&q=blended&filters=List(resultType-%3ECONTENT)&start=${start}`;
    let text = null;
    for (let retry = 0; retry < 3; retry++) {
      try {
        const res = await fetch(apiUrl, {
          headers: {
            'accept': 'application/json',
            'csrf-token': csrf || '',
            'x-restli-protocol-version': '2.0.0',
            'x-li-lang': 'en_US',
          }
        });
        if (res.ok) { text = await res.text(); break; }
        if (res.status === 401 || res.status === 403) {
          console.warn('[BG] VoyagerREST HTTP ' + res.status + ' start=' + start + ' — auth/csrf rejected on this account, stopping this channel.');
          break;
        }
        console.warn('[BG] VoyagerREST HTTP ' + res.status + ' start=' + start + ' — retry ' + (retry + 1) + '/3');
        await sleep(2000 * (retry + 1));
      } catch (e) {
        console.warn('[BG] VoyagerREST error (retry ' + (retry + 1) + '/3):', e.message);
        await sleep(2000 * (retry + 1));
      }
    }
    if (text === null) break;
    if (isCheckpointText(text)) { console.warn('[BG] VoyagerREST checkpoint page — stopping this channel for kw="' + keyword + '"'); break; }
    const posts = extractPostsFromText(text);
    let added = 0;
    posts.forEach(p => { if (!urlMap.has(p.canonicalUrn)) { urlMap.set(p.canonicalUrn, p); added++; } });
    console.log('[BG] VoyagerREST sort=' + sort + ' start=' + start + ': +' + added + ' (total=' + urlMap.size + ')');
    if (added === 0) {
      emptyStreak++;
      if (emptyStreak >= 2) break;
    } else {
      emptyStreak = 0;
      success = true;
    }
    await sleep(1200);
  }
  return success;
}

// â”€â”€ Tab-based scroll scraper â€” MAXIMUM VOLUME MODE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Opens a real LinkedIn tab and scrolls aggressively to trigger infinite-scroll.
// sortMode: 'date_posted' | 'relevance'
async function fetchViaScrollTab(keyword, urlMap, sortMode, customUrl) {
  const sort = sortMode || 'date_posted';
  // BUGFIX: this function used to ignore any 4th argument, so every caller that
  // passed a distinct time-filtered URL (week/month/boost) silently fell back to
  // the same plain, unfiltered search — three "different" tabs were actually
  // running the identical query. customUrl now takes priority so each tab
  // genuinely covers a different slice of results (real extra volume).
  const searchUrl = customUrl || `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER&sortBy=${sort}`;
  let tabId = null;
  const before = urlMap.size;
  try {
    const tab = await chrome.tabs.create({ url: searchUrl, active: false });
    tabId = tab.id;
    console.log('[BG] ScrollTab[' + sort + '] opened: ' + tabId + ' kw=' + keyword);

    // Wait for initial render
    await new Promise(r => {
      function fn(id, info) {
        if (id !== tabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(fn);
        setTimeout(r, 6000); // 6s settle for SDUI render
      }
      chrome.tabs.onUpdated.addListener(fn);
      setTimeout(r, 20000);
    });

    // Pre-flight: verify page has content. Kept deliberately permissive — a
    // sparse-but-real result set must never be treated as "failed", and a
    // checkpoint/auth-wall page gets one retry before we give up on this tab
    // (both phases exist purely so behaviour stays consistent account-to-account).
    let preflightOk = false;
    let checkpointDetected = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const pf = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({
            sh: document.documentElement.scrollHeight,
            len: (document.body?.innerText || '').length,
            urns: (document.body?.innerHTML || '').match(/urn:li:/g)?.length || 0,
            url: window.location.href,
            sample: (document.body?.innerText || '').slice(0, 4000),
          })
        });
        const p = pf?.[0]?.result || {};
        console.log('[BG] Preflight[' + sort + '] #' + (attempt+1) + ': sh=' + p.sh + ' len=' + p.len + ' urns=' + p.urns + ' url=' + p.url);
        if (isCheckpointText(p.sample) || isCheckpointText(p.url)) {
          checkpointDetected = true;
          console.warn('[BG] Preflight[' + sort + '] checkpoint/auth-wall detected on this account — will retry once after a cool-down.');
          break;
        }
        // Lowered thresholds: any real sign of content is enough — never skip
        // a legitimately small result set just because it is small.
        if (p.sh > 800 || p.urns > 0 || p.len > 500) { preflightOk = true; break; }
        await sleep(4000);
      } catch (e) { break; }
    }

    if (checkpointDetected) {
      await sleep(15000);
      try {
        await chrome.tabs.update(tabId, { url: searchUrl });
        await sleep(8000);
        const retry = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => (document.body?.innerText || '').slice(0, 4000)
        });
        const retryText = retry?.[0]?.result || '';
        if (!isCheckpointText(retryText)) {
          preflightOk = true;
          console.log('[BG] ScrollTab[' + sort + '] checkpoint cleared after retry — proceeding normally.');
        } else {
          console.warn('[BG] ScrollTab[' + sort + '] checkpoint persists on this account/session — skipping this tab only; other collection phases still run.');
        }
      } catch (_) {}
    }

    if (!preflightOk) {
      console.warn('[BG] ScrollTab[' + sort + '] page never loaded/unavailable — skipping (other phases unaffected).');
      return;
    }

    const MAX_SCROLLS = 80;         // pushed further — exhaust results rather than cap them
    const SCROLL_STEP = 600;        // smaller steps = more observer triggers
    const STALL_EXIT = 12;          // more patience before declaring "no more results"
    const STALL_RETRY = 5;          // retry scroll on stall before giving up
    let consecutiveStall = 0;
    let lastScrollY = -1;
    let stallRetries = 0;

    for (let i = 0; i < MAX_SCROLLS; i++) {
      if (S.state !== 'RUNNING') break;

      let urnData = [];
      let pageInfo = { scrollY: 0, scrollHeight: 0, atBottom: false };

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (step) => {
            function norm(s) {
              return (s || '').replace(/[\u0660-\u0669]/g, d => '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'.indexOf(d)).replace(/,/g, '');
            }
            const found = new Map();

            // Layer 1: data-urn containers
            document.querySelectorAll('[data-urn],[data-chameleon-result-urn],[data-entity-urn],[data-id]').forEach(el => {
              ['data-urn','data-chameleon-result-urn','data-entity-urn','data-id'].forEach(attr => {
                const v = el.getAttribute(attr);
                if (v && v.includes('urn:li:') && !found.has(v)) found.set(v, { urn: v, score: null });
              });
            });

            // Layer 2: anchor hrefs with full URN
            document.querySelectorAll('a[href*="feed/update"],a[href*="urn:li:"]').forEach(a => {
              const m = a.href.match(/urn:li:(activity|ugcPost|share):(\d{10,25})/);
              if (m) { const u = 'urn:li:' + m[1] + ':' + m[2]; if (!found.has(u)) found.set(u, { urn: u, score: null }); }
            });

            // Layer 3: raw HTML regex (catches encoded and unencoded URNs)
            const html = document.body.innerHTML || '';
            const RE = /(?:urn:li:|urn%3Ali%3A)(activity|ugcPost|share)(?::|%3A)(\d{10,25})/gi;
            let m;
            while ((m = RE.exec(html)) !== null) {
              const u = 'urn:li:' + m[1].toLowerCase() + ':' + m[2];
              if (!found.has(u)) found.set(u, { urn: u, score: null });
            }

            // Layer 4: JSON-LD and script tags
            document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]').forEach(s => {
              const RE2 = /urn:li:(activity|ugcPost|share):(\d{10,25})/gi;
              let m2;
              while ((m2 = RE2.exec(s.textContent || '')) !== null) {
                const u = 'urn:li:' + m2[1].toLowerCase() + ':' + m2[2];
                if (!found.has(u)) found.set(u, { urn: u, score: null });
              }
            });

            // Aggressive scroll: multiple techniques to trigger infinite-scroll observer
            const el = document.querySelector('[data-testid="lazy-column"]') || document.querySelector('.scaffold-finite-scroll__content') || document.querySelector('main') || document.body;
            window.scrollBy({ top: step, behavior: 'smooth' });
            el.dispatchEvent(new WheelEvent('wheel', { deltaY: step, bubbles: true, cancelable: true }));
            // Simulate keyboard scroll (some SDUI virtualizers listen to this)
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));

            const sh = document.documentElement.scrollHeight;
            const sy = window.scrollY;
            const ih = window.innerHeight;
            const atBottom = sh > 2000 && (sy + ih) >= sh - 300;

            return { posts: Array.from(found.values()), scrollY: sy, scrollHeight: sh, atBottom, url: window.location.href };
          },
          args: [SCROLL_STEP]
        });

        const res = results?.[0]?.result || { posts: [], scrollY: 0, scrollHeight: 0, atBottom: false, url: '' };
        // Mid-scroll redirect to a checkpoint page — bail immediately, no point scrolling it.
        if (/checkpoint|authwall|uas\/login/i.test(res.url || '')) {
          console.warn('[BG] Scroll[' + sort + '] redirected to a checkpoint mid-run — stopping this tab early (other phases unaffected).');
          break;
        }
        urnData = res.posts || [];
        pageInfo = { scrollY: res.scrollY, scrollHeight: res.scrollHeight, atBottom: res.atBottom };
      } catch (e) {
        console.warn('[BG] Scroll script error i=' + i + ':', e.message);
        break;
      }

      let added = 0;
      for (const d of urnData) {
        const raw = extractUrn(d.urn) || d.urn;
        if (raw && !urlMap.has(raw)) {
          const url = urnToUrl(raw);
          if (url) { urlMap.set(raw, { canonicalUrn: raw, url, source: 'scroll_' + sort }); added++; }
        }
      }

      console.log('[BG] Scroll[' + sort + '] ' + (i+1) + '/' + MAX_SCROLLS + ': DOM=' + urnData.length + ' +' + added + ' new (total=' + urlMap.size + ') scrollY=' + pageInfo.scrollY + ' sh=' + pageInfo.scrollHeight + ' atBottom=' + pageInfo.atBottom);

      // Stall detection with retry
      const isStalled = pageInfo.atBottom || (pageInfo.scrollY === lastScrollY && lastScrollY >= 0);
      if (isStalled) {
        consecutiveStall++;
        if (consecutiveStall < STALL_EXIT) {
          // Before giving up, try a bigger jump to unstick
          if (stallRetries < STALL_RETRY) {
            stallRetries++;
            console.log('[BG] Stall retry #' + stallRetries + ' â€” jumping 2000px to unstick...');
            try {
              await chrome.scripting.executeScript({
                target: { tabId },
                func: () => { window.scrollBy({ top: 2000, behavior: 'smooth' }); }
              });
            } catch (_) {}
            consecutiveStall = 0;
            await sleep(4000);
            continue;
          }
        }
        if (consecutiveStall >= STALL_EXIT) {
          console.log('[BG] Scroll[' + sort + '] stalled for ' + STALL_EXIT + ' iters â€” done. +' + (urlMap.size - before) + ' new posts.');
          break;
        }
      } else {
        consecutiveStall = 0;
        stallRetries = 0;
      }

      lastScrollY = pageInfo.scrollY;
      await sleep(3000); // 3s between scrolls â€” enough for lazy-loader
    }
  } catch (e) {
    console.warn('[BG] fetchViaScrollTab[' + sort + '] error:', e.message);
  } finally {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
    console.log('[BG] ScrollTab[' + sort + '] closed. +' + (urlMap.size - before) + ' from this tab. Total=' + urlMap.size);
  }
}

// â”€â”€ Multi-page HTML fetch with pagination â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchHtmlVariant(url, urlMap, label) {
  try {
    const text = await fetchHtml(url);
    if (!text) return 0;
    let added = 0;
    extractPostsFromText(text).forEach(p => {
      if (!urlMap.has(p.canonicalUrn)) { urlMap.set(p.canonicalUrn, p); added++; }
    });
    if (added > 0) console.log('[BG] HTML[' + label + '] +' + added + ' (total=' + urlMap.size + ')');
    return added;
  } catch (_) { return 0; }
}

// ── Main fetch strategy per keyword — MAXIMUM RAW VOLUME, NO FILTERING ───────
// PHILOSOPHY (per user requirement): collect every reachable post for the
// keyword, with zero quality/engagement gating. No minLikes/minComments/date
// restriction is ever applied to what gets saved — that is handled (if at
// all) later, manually, by the user. Every phase below is a different,
// independent discovery channel (API + real browser tabs + HTML sweeps) so
// that if one channel is blocked/rate-limited/unavailable on a given
// account, the others still deliver results — this is what keeps behaviour
// consistent across completely different accounts, regions and UI languages.
async function fetchPostsForKeyword(keyword) {
  const urlMap = new Map();
  const enc = encodeURIComponent;
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]/g, '');
  const csrf = await getCsrfToken();
  const base = 'https://www.linkedin.com/search/results/content/';

  console.log('[BG] === Max-volume extraction for keyword: "' + keyword + '" ===');
  broadcastStatus('Searching "' + keyword + '"...');

  // -- PHASE 1: Voyager REST search API --
  if (S.state === 'RUNNING') {
    console.log('[BG] Phase 1: Voyager REST...');
    await fetchViaVoyagerRest(keyword, csrf, urlMap, 'relevance');
    console.log('[BG] Phase 1 done: ' + urlMap.size + ' posts');
  }

  // -- PHASE 2: Voyager GraphQL (from HTML queryId) --
  if (S.state === 'RUNNING') {
    const baseHtml = await fetchHtml(base + '?keywords=' + enc(keyword) + '&origin=GLOBAL_SEARCH_HEADER');
    extractPostsFromText(baseHtml).forEach(p => { if (!urlMap.has(p.canonicalUrn)) urlMap.set(p.canonicalUrn, p); });
    const qids = [...new Set([
      ...[...baseHtml.matchAll(/["']?queryId["']?\s*:\s*["']([a-f0-9]{32})["']/gi)].map(m => m[1]),
      ...(baseHtml.match(/voyagerSearchDashClusters\.([a-f0-9]{32})/i) ? [baseHtml.match(/voyagerSearchDashClusters\.([a-f0-9]{32})/i)[1]] : []),
    ])];
    for (const qid of qids) {
      if (S.state !== 'RUNNING') break;
      await fetchViaVoyager(keyword, qid, csrf, urlMap);
    }
    console.log('[BG] Phase 2 done: ' + urlMap.size + ' posts');
  }

  // -- PHASE 3: Parallel real-browser scroll tabs across distinct slices --
  // Each tab now genuinely hits a different URL (bug in fetchViaScrollTab
  // meant these used to be duplicates of each other — fixed above). Mixing
  // relevance windows with a pure date_posted/no-filter tab means we catch
  // both "high engagement" AND "freshest, not-yet-engaged" posts — no bias.
  if (S.state === 'RUNNING') {
    console.log('[BG] Phase 3: Parallel scroll tabs (week / month / freshest)...');
    const weekUrl    = base + '?keywords=' + enc(keyword) + '&origin=GLOBAL_SEARCH_HEADER&f_TPR=r604800';
    const monthUrl   = base + '?keywords=' + enc(keyword) + '&origin=GLOBAL_SEARCH_HEADER&f_TPR=r2592000';
    const freshestUrl = base + '?keywords=' + enc(keyword) + '&origin=GLOBAL_SEARCH_HEADER&sortBy=date_posted';
    await Promise.all([
      fetchViaScrollTab(keyword, urlMap, 'relevance', weekUrl),
      fetchViaScrollTab(keyword, urlMap, 'relevance', monthUrl),
      fetchViaScrollTab(keyword, urlMap, 'date_posted', freshestUrl),
    ]);
    console.log('[BG] Phase 3 done: ' + urlMap.size + ' posts');
    broadcastStatus('"' + keyword + '": ' + urlMap.size + ' posts found so far...');
  }

  // -- PHASE 4: Wide HTML variant sweep (no engagement bias, maximum breadth) --
  if (S.state === 'RUNNING') {
    console.log('[BG] Phase 4: Wide HTML variant sweep (deep pagination + all time windows)...');
    const variants = [
      // Time windows, relevance sort (default)
      { url: base + '?keywords=' + enc(keyword) + '&f_TPR=r86400',     label: 'rel-24h'   },
      { url: base + '?keywords=' + enc(keyword) + '&f_TPR=r604800',    label: 'rel-week'  },
      { url: base + '?keywords=' + enc(keyword) + '&f_TPR=r2592000',   label: 'rel-month' },
      { url: base + '?keywords=' + enc(keyword) + '&f_TPR=r7776000',   label: 'rel-3mo'   },
      { url: base + '?keywords=' + enc(keyword) + '&f_TPR=r15552000',  label: 'rel-6mo'   },
      // Same time windows, date_posted sort — catches freshest/no-engagement posts too
      { url: base + '?keywords=' + enc(keyword) + '&f_TPR=r604800&sortBy=date_posted',   label: 'date-week'  },
      { url: base + '?keywords=' + enc(keyword) + '&f_TPR=r2592000&sortBy=date_posted',  label: 'date-month' },
      { url: base + '?keywords=' + enc(keyword) + '&f_TPR=r7776000&sortBy=date_posted',  label: 'date-3mo'   },
      // Deep pagination — pages 2-25 (LinkedIn's realistic practical ceiling per query)
      ...Array.from({ length: 24 }, (_, i) => i + 2).map(p => ({
        url: base + '?keywords=' + enc(keyword) + '&start=' + ((p - 1) * 10),
        label: 'page' + p,
      })),
      // Hashtag variants
      { url: base + '?keywords=%23' + enc(keyword) + '&origin=GLOBAL_SEARCH_HEADER', label: 'hashtag'       },
      { url: base + '?keywords=%23' + enc(keyword) + '&f_TPR=r604800',               label: 'hashtag-week'  },
      { url: base + '?keywords=%23' + enc(keyword) + '&f_TPR=r2592000',              label: 'hashtag-month' },
      { url: 'https://www.linkedin.com/feed/hashtag/' + slug + '/',                  label: 'hashtag-feed'  },
      // Quoted exact phrase
      { url: base + '?keywords=' + enc('"' + keyword + '"'),                      label: 'quoted'        },
      { url: base + '?keywords=' + enc('"' + keyword + '"') + '&f_TPR=r2592000',   label: 'quoted-month'  },
      // Content suffix variants — widen the net beyond the literal keyword
      { url: base + '?keywords=' + enc(keyword + ' tips'),     label: 'tips'     },
      { url: base + '?keywords=' + enc(keyword + ' strategy'), label: 'strategy' },
      { url: base + '?keywords=' + enc(keyword + ' how to'),   label: 'howto'    },
      { url: base + '?keywords=' + enc(keyword + ' growth'),   label: 'growth'   },
      { url: base + '?keywords=' + enc(keyword + ' lessons'),  label: 'lessons'  },
      // Region variants (extra coverage, additive — never exclusionary)
      { url: base + '?keywords=' + enc(keyword) + '&f_CR=101282230',                 label: 'uae'       },
      { url: base + '?keywords=' + enc(keyword) + '&f_CR=101165590',                 label: 'sa'        },
      { url: base + '?keywords=' + enc(keyword) + '&f_CR=101282230&f_TPR=r2592000',  label: 'uae-month' },
      { url: base + '?keywords=' + enc(keyword) + '&f_CR=101165590&f_TPR=r2592000',  label: 'sa-month'  },
    ];
    for (let i = 0; i < variants.length; i += 3) {
      if (S.state !== 'RUNNING') break;
      const batch = variants.slice(i, i + 3);
      await Promise.all(batch.map(v => fetchHtmlVariant(v.url, urlMap, v.label)));
      await sleep(1200);
    }
    console.log('[BG] Phase 4 done: ' + urlMap.size + ' posts');
    broadcastStatus('"' + keyword + '": ' + urlMap.size + ' posts found so far...');
  }

  // -- PHASE 5: Deep scroll boost — ALWAYS runs (no volume gate) --
  // Covers the 3-6 month window that Phase 3 doesn't scroll through, so every
  // account gets the same exhaustive final pass regardless of how much the
  // earlier phases already found.
  if (S.state === 'RUNNING') {
    console.log('[BG] Phase 5: Deep scroll boost (3-6mo window, unconditional)...');
    const boostUrl = base + '?keywords=' + enc(keyword) + '&origin=GLOBAL_SEARCH_HEADER&f_TPR=r15552000';
    await fetchViaScrollTab(keyword, urlMap, 'relevance', boostUrl);
    console.log('[BG] Phase 5 done: ' + urlMap.size + ' posts');
  }

  const posts = Array.from(urlMap.values());
  console.log('[BG] === kw="' + keyword + '" TOTAL=' + posts.length + ' posts extracted ===');
  broadcastStatus('"' + keyword + '": ' + posts.length + ' posts collected.');
  return posts;
}

// â”€â”€ DB Push â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function pushToAPI(posts, kw) {
  if (!posts || posts.length === 0) return 0;

  const payloadPosts = posts.map(p => {
    const formatted = { canonicalUrn: p.canonicalUrn, url: p.url, source: p.source };
    if (p.score !== null && p.score !== undefined) formatted.engagementScore = p.score;
    return formatted;
  });

  const endpoint = apiUrl('/api/extension/results');
  const headers = { 'Content-Type': 'application/json', 'x-extension-token': S.userId };
  const body = JSON.stringify({ posts: payloadPosts, keyword: kw, source: 'search_only' });
  try {
    let resp;
    try { resp = await fetch(endpoint, { method: 'POST', headers, body }); }
    catch (_) { await sleep(3000); resp = await fetch(endpoint, { method: 'POST', headers, body }); }
    if (!resp.ok) { console.warn('[BG] DB push HTTP ' + resp.status); return 0; }
    const data = await resp.json().catch(() => ({}));
    return typeof data.createdCount === 'number' ? data.createdCount : posts.length;
  } catch (e) {
    console.warn('[BG] DB push error:', e.message);
    return 0;
  }
}

// ── Keyword Fetch ─────────────────────────────────────────────────────────────
async function activateSystem() {
  // Popup START used to fail silently when systemActive=false in the DB.
  // Auto-flip it on so pressing Start always actually runs.
  const url = apiUrl('/api/settings');
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-extension-token': S.userId,
      },
      body: JSON.stringify({ systemActive: true, searchOnlyMode: true }),
    });
    if (!resp.ok) {
      console.warn('[BG] activateSystem HTTP ' + resp.status);
      return false;
    }
    console.log('[BG] systemActive forced ON via /api/settings');
    return true;
  } catch (e) {
    console.warn('[BG] activateSystem error:', e.message);
    return false;
  }
}

async function diagnoseHttpError(resp, label, url) {
  let bodyText = '';
  try { bodyText = await resp.text(); } catch (_) {}
  let json = null;
  try { json = JSON.parse(bodyText); } catch (_) {}

  if (resp.status === 404) {
    const looksLikeNext404 = /<!DOCTYPE html|This page could not be found|404: NOT_FOUND/i.test(bodyText);
    if (looksLikeNext404) {
      return label + ' 404 at ' + url + ' — wrong Dashboard URL, or this deployment does not have /api/extension/jobs yet. Re-open the real Nexora dashboard and Auto-Connect again.';
    }
    if (json?.error === 'User not found' || /user not found/i.test(bodyText)) {
      return 'User ID not found in the database. You are connected to the wrong account/environment. Disconnect → open Dashboard → Auto-Connect again.';
    }
    return label + ' HTTP 404 at ' + url + (json?.error ? (' — ' + json.error) : '') + '. Check Dashboard URL + User ID.';
  }
  if (resp.status === 401) {
    return label + ' unauthorized (401). Reconnect with Auto-Connect.';
  }
  return label + ' HTTP ' + resp.status + (json?.error ? (' — ' + json.error) : '') + ' @ ' + url;
}

async function fetchKeywords() {
  S.dashboardUrl = normalizeDashboardUrl(S.dashboardUrl);
  const url = apiUrl('/api/extension/jobs');
  console.log('[BG] fetchKeywords →', url, 'userId=', (S.userId || '').slice(0, 8) + '…');
  broadcastStatus('Contacting dashboard…');

  let resp;
  try {
    resp = await fetch(url, { headers: { 'x-extension-token': S.userId } });
  } catch (e) {
    throw new Error('Cannot reach Dashboard at ' + S.dashboardUrl + ' — is it open/running? (' + e.message + ')');
  }

  if (!resp.ok) {
    throw new Error(await diagnoseHttpError(resp, 'Jobs API', url));
  }
  let jobs = await resp.json();

  // If system was paused, auto-activate and retry once (this is the #1 reason
  // Start appeared to "cancel itself" with no visible work).
  if (!jobs.active && !jobs.subscriptionExpired) {
    console.warn('[BG] Jobs inactive ("' + (jobs.message || '') + '") — activating system and retrying…');
    broadcastStatus('System was paused — activating…');
    await activateSystem();
    await sleep(800);
    resp = await fetch(url, { headers: { 'x-extension-token': S.userId } });
    if (!resp.ok) throw new Error(await diagnoseHttpError(resp, 'Jobs API', url));
    jobs = await resp.json();
  }

  if (!jobs.active) {
    throw new Error(jobs.message || 'System inactive. Open the Dashboard, save keywords, then press START again.');
  }

  let kws = [];
  if (jobs.settings?.searchConfigJson) {
    try {
      const cfg = JSON.parse(jobs.settings.searchConfigJson);
      if (Array.isArray(cfg)) kws.push(...cfg.flat(Infinity).filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()));
    } catch (_) {}
  }
  if (kws.length === 0 && Array.isArray(jobs.keywords))
    kws.push(...jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean));
  if (kws.length === 0) throw new Error('No keywords configured. Paste keywords in Dashboard → Save, then Start.');
  return { keywords: [...new Set(kws)], settings: jobs.settings || {} };
}

// ── Auto-Enrich: open each post in background tab, inject enrich.js ──────────
// Returns { score: number|null, method: string, isFallback: boolean }
// isFallback=true means score came from tier5 text-regex and must NEVER trigger deletion.
async function enrichSinglePost(url, urn) {
  const NULL_RESULT = { score: null, method: 'null', isFallback: false };
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;

    // Wait for page load complete + 5s settle for React SDUI hydration
    await new Promise(r => {
      function fn(id, info) {
        if (id !== tabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(fn);
        setTimeout(r, 5000);
      }
      chrome.tabs.onUpdated.addListener(fn);
      setTimeout(r, 18000); // hard fallback
    });

    if (!tabId) return NULL_RESULT;

    // Set URN and reset result flag BEFORE injecting enrich.js
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (u) => {
        window.__nexoraEnrichUrn = u;
        window.__nexoraEnrichResult = null;
        window.__nexoraEnrichDone = false;
      },
      args: [urn]
    });

    // Inject enrich.js — it will use MutationObserver to wait for the social bar,
    // then write {score, method, isFallback, done} to window.__nexoraEnrichResult.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['enrich.js'] });

    // Poll for result. enrich.js v8 can take up to 30s for MutationObserver wait
    // + 3 tier attempts, so we poll up to 50 times (75 seconds total).
    const POLL_MS  = 1500;
    const POLL_MAX = 50; // 50 * 1500ms = 75s
    for (let i = 0; i < POLL_MAX; i++) {
      await sleep(POLL_MS);
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.__nexoraEnrichResult || null
        });
        const result = results?.[0]?.result;
        if (result && result.done === true) {
          const s   = result.score;
          const m   = result.method   || 'unknown';
          const fb  = result.isFallback || false;
          console.log('[BG-ENRICH] Poll[' + (i+1) + '] score=' + s + ' via=' + m + (fb ? ' [FALLBACK]' : '') + ' urn=' + urn);
          return { score: (typeof s === 'number') ? s : null, method: m, isFallback: fb };
        }
        if (i % 5 === 0) console.log('[BG-ENRICH] Poll[' + (i+1) + '] waiting... urn=' + urn);
      } catch (e) {
        console.warn('[BG-ENRICH] Poll error (tab closed?): ' + e.message);
        return NULL_RESULT;
      }
    }

    console.warn('[BG-ENRICH] Poll timeout urn=' + urn);
    return NULL_RESULT;
  } catch (e) {
    console.warn('[BG-ENRICH] enrichSinglePost error:', e.message);
    return NULL_RESULT;
  } finally {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function pushEnrichScore(urn, score, force) {
  try {
    const res = await fetch(apiUrl('/api/extension/enrich'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': S.userId },
      body: JSON.stringify({ urn, score, force: force || false })
    });
    if (!res.ok) console.warn('[BG-ENRICH] push HTTP', res.status);
  } catch (e) { console.warn('[BG-ENRICH] score push error:', e.message); }
}

async function deleteEnrichPost(urn) {
  try {
    const res = await fetch(apiUrl('/api/extension/enrich?urn=' + encodeURIComponent(urn)), {
      method: 'DELETE',
      headers: { 'x-extension-token': S.userId }
    });
    if (!res.ok) console.warn('[BG-ENRICH] delete HTTP', res.status);
  } catch (e) { console.warn('[BG-ENRICH] delete error:', e.message); }
}

// ── Auto-Enrich Session — retry logic, re-check-before-delete, uncertain sentinel ──
async function startEnrichSession(posts, opts = {}) {
  if (E.running) { console.warn('[BG-ENRICH] Already running'); return; }
  E.running = true;
  const { autoDelete = false, deleteThreshold = 10 } = opts;
  const total = posts.length;
  let enriched = 0, deleted = 0, nullCount = 0, failed = 0, uncertain = 0;

  console.log('[BG-ENRICH] Starting enrichment for ' + total + ' posts. autoDelete=' + autoDelete + ' threshold=' + deleteThreshold);
  broadcastStatus('Enriching 0/' + total + '...');
  setBadge('...', '#f59e0b');

  for (const post of posts) {
    if (!post.url || !post.urn) { failed++; continue; }
    try {
      // ── Pass 1: Initial enrich ─────────────────────────────────────────────
      let res1 = await enrichSinglePost(post.url, post.urn);
      console.log('[BG-ENRICH] Pass1 score=' + res1.score + ' via=' + res1.method + (res1.isFallback ? ' [FALLBACK]' : '') + ' urn=' + post.urn);

      // ── Pass 2: Retry if null ─────────────────────────────────────────────
      if (res1.score === null) {
        console.log('[BG-ENRICH] Pass1 null — retrying in 6s... urn=' + post.urn);
        await sleep(6000);
        res1 = await enrichSinglePost(post.url, post.urn);
        console.log('[BG-ENRICH] Pass2 score=' + res1.score + ' via=' + res1.method + (res1.isFallback ? ' [FALLBACK]' : '') + ' urn=' + post.urn);
      }

      const { score, method, isFallback } = res1;

      // ── Tier5 fallback guard: NEVER delete based on text-regex ─────────────
      if (isFallback) {
        console.log('[BG-ENRICH] ⚑  Score=' + score + ' via=' + method + ' [FALLBACK] — marking uncertain, NOT deleting. urn=' + post.urn);
        await pushEnrichScore(post.urn, -1, true);
        uncertain++;
        const done = enriched + nullCount + failed + uncertain;
        broadcastStatus('Enriching ' + done + '/' + total + '...');
        chrome.runtime.sendMessage({ action: 'ENRICH_PROGRESS', done, total, enriched, deleted, failed, nullCount, uncertain }).catch(() => {});
        if (done < total) await sleep(2500);
        continue;
      }

      // ── score=0 safety: uncertain, never delete ────────────────────────────
      if (score === 0) {
        console.log('[BG-ENRICH] ⚑  score=0 → uncertain (-1) — NOT deleting. urn=' + post.urn);
        await pushEnrichScore(post.urn, -1, true);
        uncertain++;
        const done0 = enriched + nullCount + failed + uncertain;
        broadcastStatus('Enriching ' + done0 + '/' + total + '...');
        chrome.runtime.sendMessage({ action: 'ENRICH_PROGRESS', done: done0, total, enriched, deleted, failed, nullCount, uncertain }).catch(() => {});
        if (done0 < total) await sleep(2500);
        continue;
      }
      // ── Both passes null → uncertain sentinel ──────────────────────────────
      if (score === null) {
        console.log('[BG-ENRICH] ⚑  Both passes null → uncertain (-1). urn=' + post.urn);
        await pushEnrichScore(post.urn, -1, true);
        uncertain++;
        nullCount++;
        const done = enriched + nullCount + failed + uncertain;
        broadcastStatus('Enriching ' + done + '/' + total + '...');
        chrome.runtime.sendMessage({ action: 'ENRICH_PROGRESS', done, total, enriched, deleted, failed, nullCount, uncertain }).catch(() => {});
        if (done < total) await sleep(2500);
        continue;
      }

      // â”€â”€ Valid score obtained â€” push to API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      await pushEnrichScore(post.urn, score, false);
      enriched++;
      console.log('[BG-ENRICH] âœ“ score=' + score + ' ' + post.urn);

      // â”€â”€ Auto-delete: only if score >= 1 AND below threshold â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // NEVER delete score=0 (handled above as uncertain).
      // RE-CHECK BEFORE DELETE: run a second independent enrich pass to confirm
      // the score before permanently removing the post from the database.
      if (autoDelete && score >= 1 && score < deleteThreshold) {
        console.log('[BG-ENRICH] Score ' + score + ' < threshold ' + deleteThreshold + ' — running re-check before delete...');
        await sleep(4000); // give the tab pool time to settle
        const res2 = await enrichSinglePost(post.url, post.urn);
        console.log('[BG-ENRICH] Re-check score=' + res2.score + ' via=' + res2.method + (res2.isFallback ? ' [FALLBACK]' : '') + ' urn=' + post.urn);

        if (res2.score === null || res2.score === 0 || res2.isFallback) {
          console.log('[BG-ENRICH] ⚑  Re-check null/0/fallback — cannot confirm deletion. Marking uncertain. urn=' + post.urn);
          await pushEnrichScore(post.urn, -1, true);
          uncertain++;
        } else if (res2.score >= deleteThreshold) {
          console.log('[BG-ENRICH] ✅ Re-check score=' + res2.score + ' >= threshold — keeping post. urn=' + post.urn);
          await pushEnrichScore(post.urn, res2.score, true);
        } else {
          console.log('[BG-ENRICH] 🗑 Re-check confirmed score=' + res2.score + ' < ' + deleteThreshold + ' — deleting. urn=' + post.urn);
          await deleteEnrichPost(post.urn);
          deleted++;
        }
      }

    } catch (e) {
      failed++;
      console.warn('[BG-ENRICH] Error:', e.message);
    }
    const done = enriched + nullCount + failed + uncertain;
    broadcastStatus('Enriching ' + done + '/' + total + '...');
    chrome.runtime.sendMessage({ action: 'ENRICH_PROGRESS', done, total, enriched, deleted, failed, nullCount, uncertain }).catch(() => {});
    if (done < total) await sleep(2500);
  }

  E.running = false;
  console.log('[BG-ENRICH] Done. enriched=' + enriched + ' deleted=' + deleted + ' uncertain=' + uncertain + ' null=' + nullCount + ' failed=' + failed);
  broadcastStatus('Enrichment done! ' + enriched + ' scored, ' + deleted + ' deleted, ' + uncertain + ' uncertain.');
  setBadge(String(enriched), '#3b82f6');
}

// â”€â”€ Run Auto-Enrich after scraping completes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function runAutoEnrich(autoDelete, deleteThreshold) {
  if (E.running) return;
  console.log('[BG-ENRICH] Auto-enrich: fetching unscored posts...');
  try {
    const kwParam = encodeURIComponent(S.keywords.join(','));
    const resp = await fetch(apiUrl('/api/extension/posts?unscored=true&includeUncertain=true&keywords=' + kwParam), {
      headers: { 'x-extension-token': S.userId }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const posts = await resp.json();
    if (!Array.isArray(posts) || posts.length === 0) { console.log('[BG-ENRICH] No unscored posts found.'); return; }
    const queue = posts.filter(p => p.canonicalUrn && p.postUrl).map(p => ({ urn: p.canonicalUrn, url: p.postUrl }));
    if (queue.length === 0) { console.log('[BG-ENRICH] Queue empty after filter.'); return; }
    console.log('[BG-ENRICH] Queuing ' + queue.length + ' posts for enrichment');
    await startEnrichSession(queue, { autoDelete, deleteThreshold });
  } catch (e) {
    console.error('[BG-ENRICH] Auto-enrich error:', e.message);
  }
}

// â”€â”€ Main engine loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function runEngine(settings, msgEnrich = {}) {
  const autoEnrich      = settings.autoEnrich ?? false;
  const autoDelete      = settings.autoDelete ?? false;
  const deleteThreshold = Number(settings.deleteThreshold) || 10;

  console.log('[BG] RUNNING. keywords=' + JSON.stringify(S.keywords));
  console.log('[BG] autoEnrich=' + autoEnrich + ' autoDelete=' + autoDelete + ' threshold=' + deleteThreshold);

  for (S.kwIndex = 0; S.kwIndex < S.keywords.length; S.kwIndex++) {
    if (S.state !== 'RUNNING') break;
    const kw = S.keywords[S.kwIndex];
    const posts = await fetchPostsForKeyword(kw);
    if (posts.length > 0) {
      const saved = await pushToAPI(posts, kw);
      S.totalSaved += saved;
      console.log('[BG] Saved ' + saved + '/' + posts.length + ' kw=' + kw + ' total=' + S.totalSaved);
    } else {
      console.warn('[BG] 0 posts for kw=' + kw);
    }
    if (S.kwIndex < S.keywords.length - 1 && S.state === 'RUNNING') {
      console.log('[BG] 5s delay before next keyword...');
      await sleep(5000);
    }
  }

  if (S.state !== 'RUNNING') return;

  S.state = 'IDLE';
  console.log('[BG] âœ… Scraping done. totalSaved=' + S.totalSaved);
  broadcastStatus('Scraping done! ' + S.totalSaved + ' posts saved.');
  setBadge(String(S.totalSaved), '#3b82f6');

  const freshCfg = await new Promise(resolve =>
    chrome.storage.sync.get(['autoEnrich', 'autoDelete', 'deleteThreshold'], resolve)
  );
  const doEnrich   = freshCfg.autoEnrich    ?? autoEnrich;
  const doDel      = freshCfg.autoDelete    ?? autoDelete;
  const doThresh   = Number(freshCfg.deleteThreshold ?? deleteThreshold) || 10;
  console.log('[BG] Post-scrape check: autoEnrich=' + doEnrich + ' autoDelete=' + doDel);

  if (doEnrich) {
    console.log('[BG-ENRICH] Auto-enrich enabled â€” starting in 5s...');
    await sleep(5000);
    await runAutoEnrich(doDel, doThresh);
  }
}

// â”€â”€ Broadcast / Badge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function broadcastStatus(msg) {
  S.lastMessage = msg || '';
  if (/^Error:/i.test(S.lastMessage)) S.lastError = S.lastMessage.replace(/^Error:\s*/i, '');
  chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', message: msg }).catch(() => {});
}
function setBadge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

function statusPayload() {
  return {
    running: S.state === 'RUNNING',
    state: S.state,
    runId: S.runId,
    totalSaved: S.totalSaved,
    keyword: S.keywords[S.kwIndex] || null,
    keywordCount: S.keywords.length,
    kwIndex: S.kwIndex,
    lastError: S.lastError || null,
    message: S.lastMessage || null,
  };
}

async function resolveAuth(msg) {
  let dashboardUrl = normalizeDashboardUrl(msg.dashboardUrl || msg.cfg?.dashboardUrl || S.dashboardUrl || '');
  let userId = (msg.userId || msg.cfg?.userId || S.userId || '').trim();
  if ((!dashboardUrl || !userId) && chrome.storage?.sync) {
    const stored = await new Promise(resolve => chrome.storage.sync.get(['dashboardUrl', 'userId'], resolve));
    if (!dashboardUrl) dashboardUrl = normalizeDashboardUrl(stored.dashboardUrl || '');
    if (!userId) userId = (stored.userId || '').trim();
  }
  return { dashboardUrl, userId };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'GET_STATUS' || msg.action === 'PING') {
    sendResponse(statusPayload());
  }

  else if (msg.action === 'START_ENGINE' || msg.action === 'START_SESSION') {
    if (S.state === 'RUNNING') { sendResponse({ ok: false, reason: 'already_running' }); return true; }

    const msgEnrich = {
      autoEnrich:      msg.autoEnrich      ?? null,
      autoDelete:      msg.autoDelete      ?? null,
      deleteThreshold: msg.deleteThreshold ?? null,
    };

    // Acknowledge immediately so the popup/dashboard never sees a "cancelled" silence
    // while we resolve auth + keywords. Real failures are pushed via STATUS_UPDATE.
    S.state = 'RUNNING';
    S.runId = Date.now();
    S.kwIndex = 0;
    S.totalSaved = 0;
    S.lastError = '';
    S.lastMessage = 'Starting engine…';
    S.keywords = [];
    S.dashboardUrl = normalizeDashboardUrl(msg.dashboardUrl || msg.cfg?.dashboardUrl || S.dashboardUrl || '');
    S.userId = (msg.userId || msg.cfg?.userId || S.userId || '').trim();
    setBadge('…', '#f59e0b');
    sendResponse({ ok: true });
    broadcastStatus('Starting engine…');

    (async () => {
      try {
        const auth = await resolveAuth(msg);
        S.dashboardUrl = normalizeDashboardUrl(auth.dashboardUrl);
        S.userId = (auth.userId || '').trim();

        if (!S.dashboardUrl || !S.dashboardUrl.startsWith('http')) {
          throw new Error('Invalid or missing Dashboard URL. Please reconnect (Auto-Connect).');
        }
        if (!S.userId) {
          throw new Error('Missing User ID. Open Dashboard and Auto-Connect first.');
        }
        // UUID sanity check — catches garbage from bad JWT decode / wrong paste
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(S.userId)) {
          throw new Error('User ID looks invalid (' + S.userId.slice(0, 20) + '…). Disconnect and Auto-Connect again from the Dashboard page.');
        }

        chrome.storage.sync.set({ dashboardUrl: S.dashboardUrl, userId: S.userId }).catch(() => {});
        console.log('[BG] START_ENGINE url=' + S.dashboardUrl + ' user=' + S.userId.slice(0, 8) + '…');
        broadcastStatus('Connected to ' + S.dashboardUrl);

        const { keywords, settings } = await fetchKeywords();
        if (S.state !== 'RUNNING') return; // stopped while loading
        S.keywords = keywords;
        broadcastStatus('Loaded ' + keywords.length + ' keyword(s). Searching…');
        setBadge('ON', '#22c55e');
        await runEngine(settings, msgEnrich);
        chrome.runtime.sendMessage({ action: 'SCRAPER_COMPLETE', totalSaved: S.totalSaved }).catch(() => {});
      } catch (e) {
        console.error('[BG] Engine error:', e.message);
        S.state = 'IDLE';
        S.lastError = e.message || String(e);
        setBadge('ERR', '#ef4444');
        broadcastStatus('Error: ' + S.lastError);
      }
    })();
    return true;
  }

  else if (msg.action === 'STOP_ENGINE' || msg.action === 'STOP_SESSION') {
    S.state = 'IDLE';
    E.running = false;
    S.lastMessage = 'Stopped.';
    broadcastStatus('Stopped.');
    setBadge('', '#6b7280');
    sendResponse({ ok: true });
  }

  else if (msg.action === 'RE_ENRICH') {
    sendResponse({ ok: true });
    (async () => {
      const posts = (msg.posts || [])
        .map(p => ({ urn: p.urn || p.canonicalUrn, url: p.url || p.postUrl }))
        .filter(p => p.urn && p.url);
      console.log('[BG] RE_ENRICH received ' + (msg.posts||[]).length + ' posts, valid=' + posts.length);
      await startEnrichSession(posts, { autoDelete: msg.autoDelete, deleteThreshold: msg.deleteThreshold });
    })();
  }

  // FIX: Added FLUSH_POSTS handler â€” content.js can now send results that are processed
  else if (msg.action === 'FLUSH_POSTS') {
    sendResponse({ ok: true });
    if (!msg.posts || !Array.isArray(msg.posts)) return;
    console.log('[BG] FLUSH_POSTS from content.js: ' + msg.posts.length + ' posts for kw="' + msg.keyword + '"');
    // Note: these posts are not in the urlMap at this point (they come from a content script).
    // Push them directly to the API.
    (async () => {
      if (msg.posts.length > 0 && S.dashboardUrl && S.userId) {
        await pushToAPI(msg.posts, msg.keyword || '');
      }
    })();
  }

  else if (msg.action === 'ENRICH_RESULT') { sendResponse({ ok: true }); }
  else if (msg.action === 'KEEP_ALIVE') { sendResponse({ ok: true }); }

  return true;
});
