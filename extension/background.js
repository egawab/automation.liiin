// background.js — Nexora Headless Scraper + Auto-Enrich + Auto-Delete  v7.0
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
};

const E = { running: false };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Keep-alive ────────────────────────────────────────────────────────────────
chrome.alarms.create('nexora_hb', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'nexora_hb' && S.state === 'RUNNING')
    console.log('[BG] hb state=RUNNING kw=' + (S.keywords[S.kwIndex] || ''));
});

// ── URN helpers ───────────────────────────────────────────────────────────────
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
  // FIX: ugcPost /posts/{number} is not a valid LinkedIn URL — use /feed/update/ for all types.
  // linkedin.com/posts/7459935... → 404. Correct: /feed/update/urn:li:ugcPost:7459935...
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

// ── CSRF Token ────────────────────────────────────────────────────────────────
function getCsrfToken() {
  return new Promise(resolve => {
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' }, c => {
      resolve(c ? c.value.replace(/"/g, '') : null);
    });
  });
}

// ── HTML fetch helper ─────────────────────────────────────────────────────────
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
    return res.text();
  } catch (e) {
    console.warn('[BG] fetchHtml error:', e.message);
    return '';
  }
}

// ── Voyager GraphQL paginator ─────────────────────────────────────────────────
async function fetchViaVoyager(keyword, queryId, csrf, urlMap) {
  const MAX_PAGES = 20; // up to 200 posts
  let success = false;
  for (let start = 0; start < MAX_PAGES * 10; start += 10) {
    if (S.state !== 'RUNNING') break;
    const apiUrl = `https://www.linkedin.com/voyager/api/graphql?variables=(count:10,keywords:${encodeURIComponent(keyword)},origin:GLOBAL_SEARCH_HEADER,q:blended,start:${start})&queryId=${queryId}`;
    try {
      const res = await fetch(apiUrl, {
        headers: {
          'accept': 'application/vnd.linkedin.normalized+json+2.1',
          'csrf-token': csrf || '',
          'x-restli-protocol-version': '2.0.0',
          'x-li-lang': 'en_US',
        }
      });
      if (!res.ok) { console.warn('[BG] Voyager HTTP ' + res.status + ' start=' + start); break; }
      const text = await res.text();
      const posts = extractPostsFromText(text);
      let added = 0;
      posts.forEach(p => { if (!urlMap.has(p.canonicalUrn)) { urlMap.set(p.canonicalUrn, p); added++; } });
      console.log('[BG] Voyager GraphQL start=' + start + ': +' + added + ' (total=' + urlMap.size + ')');
      if (added === 0) break;
      success = true;
    } catch (e) {
      console.warn('[BG] Voyager GraphQL error:', e.message);
      break;
    }
    await sleep(1200);
  }
  return success;
}

// ── Voyager REST search (no queryId needed) ───────────────────────────────────
async function fetchViaVoyagerRest(keyword, csrf, urlMap, sortBy) {
  const sort = sortBy || 'relevance';
  const MAX_PAGES = 15;
  let success = false;
  for (let start = 0; start < MAX_PAGES * 10; start += 10) {
    if (S.state !== 'RUNNING') break;
    // FIX: Use the correct Voyager search endpoint format (v2 style with proper filter encoding)
    const apiUrl = `https://www.linkedin.com/voyager/api/search/blended?count=10&keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER&q=blended&filters=List(resultType-%3ECONTENT)&start=${start}`;
    try {
      const res = await fetch(apiUrl, {
        headers: {
          'accept': 'application/json',
          'csrf-token': csrf || '',
          'x-restli-protocol-version': '2.0.0',
          'x-li-lang': 'en_US',
        }
      });
      if (!res.ok) { console.warn('[BG] VoyagerREST HTTP ' + res.status + ' start=' + start); break; }
      const text = await res.text();
      const posts = extractPostsFromText(text);
      let added = 0;
      posts.forEach(p => { if (!urlMap.has(p.canonicalUrn)) { urlMap.set(p.canonicalUrn, p); added++; } });
      console.log('[BG] VoyagerREST sort=' + sort + ' start=' + start + ': +' + added + ' (total=' + urlMap.size + ')');
      if (added === 0) break;
      success = true;
    } catch (e) {
      console.warn('[BG] VoyagerREST error:', e.message);
      break;
    }
    await sleep(1200);
  }
  return success;
}

// ── Tab-based scroll scraper — FIXED: incremental scroll, no scrollTo-bottom jump ────
// ROOT CAUSE FIX: The old code called window.scrollTo(scrollHeight) every iteration,
// making all iterations after the first no-ops (already at bottom). Now uses pure
// incremental scrollBy so LinkedIn's infinite-scroll observer fires on every iteration.
async function fetchViaScrollTab(keyword, urlMap) {
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER&sortBy=date_posted`;
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: searchUrl, active: false });
    tabId = tab.id;
    console.log('[BG] Scroll tab opened: ' + tabId + ' kw=' + keyword);

    // Wait for initial page render — LinkedIn React needs significant time in background tab
    await sleep(8000);

    // FIX: Pre-flight check — verify the page actually loaded content before scrolling.
    // When atBottom=true AND scrollY=0 AND scrollHeight < 2000, the page is empty/auth-walled.
    // In that case, wait an extra 5s and recheck before giving up on the tab.
    let preflightOk = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const pf = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({
            scrollHeight: document.documentElement.scrollHeight,
            textLen: (document.body?.innerText || '').length,
            url: window.location.href,
            title: document.title,
            urnCount: (document.body?.innerHTML || '').match(/urn:li:/g)?.length || 0,
          })
        });
        const pfi = pf?.[0]?.result || {};
        console.log('[BG] Preflight check #' + (attempt+1) + ': scrollH=' + pfi.scrollHeight +
          ' textLen=' + pfi.textLen + ' urns=' + pfi.urnCount + ' url=' + pfi.url);
        if (pfi.scrollHeight > 1500 || pfi.urnCount > 0 || pfi.textLen > 1000) {
          preflightOk = true;
          break;
        }
        console.log('[BG] Page not ready yet — waiting 5s more...');
        await sleep(5000);
      } catch (e) {
        console.warn('[BG] Preflight error:', e.message);
        break;
      }
    }

    if (!preflightOk) {
      console.warn('[BG] Scroll tab page never loaded usable content — skipping scroll loop.');
      return;
    }

    const MAX_SCROLLS = 30;
    const SCROLL_STEP = 800;
    const EMPTY_EXIT_THRESHOLD = 5;
    let consecutiveEmpty = 0;
    let lastScrollY = -1;

    for (let i = 0; i < MAX_SCROLLS; i++) {
      if (S.state !== 'RUNNING') break;

      let urnData = [];
      let pageInfo = { scrollY: 0, scrollHeight: 0, atBottom: false };
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (scrollStep) => {
            function normalizeDigits(s) {
              return (s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/,/g, '');
            }

            const foundPosts = new Map();

            // Method 1: data-urn containers with score extraction
            document.querySelectorAll('div[data-urn], div[data-chameleon-result-urn], div[data-id]').forEach(container => {
              const attr = container.getAttribute('data-urn') || container.getAttribute('data-chameleon-result-urn') || container.getAttribute('data-id');
              if (attr && attr.includes('urn:li:')) {
                let score = null;
                container.querySelectorAll('button[aria-label], span[aria-label]').forEach(el => {
                  const lbl = normalizeDigits(el.getAttribute('aria-label') || '');
                  const m = lbl.match(/(\d[\d,]*)\s*(reaction|like|comment|repost|share|إعجاب|تعليق|تفاعل)/i);
                  if (m && score === null) score = parseInt(m[1].replace(/,/g, ''), 10);
                });
                foundPosts.set(attr, { urn: attr, score });
              }
            });

            // Method 2: Post links (anchor hrefs)
            document.querySelectorAll('a[href*="/feed/update/"], a[href*="/posts/"]').forEach(a => {
              const urnMatch = a.href.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
              if (urnMatch) {
                const urn = 'urn:li:' + urnMatch[1] + ':' + urnMatch[2];
                if (!foundPosts.has(urn)) foundPosts.set(urn, { urn, score: null });
              }
            });

            // Method 3: Raw innerHTML regex scan for any URN
            const html = document.body.innerHTML || '';
            const URN_RE = /(?:urn:li:|urn%3Ali%3A)(activity|ugcPost|share)(?::|%3A)([0-9]{10,25})/gi;
            let m;
            while ((m = URN_RE.exec(html)) !== null) {
              const attr = 'urn:li:' + m[1].toLowerCase() + ':' + m[2];
              if (!foundPosts.has(attr)) foundPosts.set(attr, { urn: attr, score: null });
            }

            // Incremental scroll — no scrollTo(scrollHeight) jump
            window.scrollBy({ top: scrollStep, behavior: 'smooth' });
            const lc = document.querySelector('[data-testid="lazy-column"]') || document.querySelector('main') || document.body;
            if (lc) lc.dispatchEvent(new WheelEvent('wheel', { deltaY: scrollStep, bubbles: true, cancelable: true }));

            const sh = document.documentElement.scrollHeight;
            const sy = window.scrollY;
            const ih = window.innerHeight;
            // FIX: only consider atBottom if page has real content (scrollHeight > 1500)
            // This prevents triggering atBottom on empty/unloaded pages
            const atBottom = sh > 1500 && (sy + ih) >= sh - 200;

            return { posts: Array.from(foundPosts.values()), scrollY: sy, scrollHeight: sh, atBottom };
          },
          args: [SCROLL_STEP]
        });

        const result = results?.[0]?.result || { posts: [], scrollY: 0, scrollHeight: 0, atBottom: false };
        urnData = result.posts || [];
        pageInfo = { scrollY: result.scrollY, scrollHeight: result.scrollHeight, atBottom: result.atBottom };
      } catch (e) {
        console.warn('[BG] Scroll script error at scroll ' + i + ':', e.message);
        break;
      }

      let added = 0;
      for (const data of urnData) {
        const rawUrn = extractUrn(data.urn) || data.urn;
        if (!urlMap.has(rawUrn)) {
          const url = urnToUrl(rawUrn);
          if (url) {
            urlMap.set(rawUrn, { canonicalUrn: rawUrn, url, source: 'scroll', score: data.score });
            added++;
          }
        } else if (data.score !== null) {
          const existing = urlMap.get(rawUrn);
          if (existing.score === null || existing.score === undefined) existing.score = data.score;
        }
      }

      console.log('[BG] Scroll ' + (i + 1) + '/' + MAX_SCROLLS +
        ': DOM=' + urnData.length + ' urns, +' + added + ' new (total=' + urlMap.size + ')' +
        ' scrollY=' + pageInfo.scrollY + ' scrollH=' + pageInfo.scrollHeight + ' atBottom=' + pageInfo.atBottom);

      if (pageInfo.atBottom) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= EMPTY_EXIT_THRESHOLD) {
          console.log('[BG] True page bottom reached for ' + EMPTY_EXIT_THRESHOLD + ' consecutive scrolls — done.');
          break;
        }
      } else if (pageInfo.scrollY === lastScrollY && lastScrollY >= 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= EMPTY_EXIT_THRESHOLD) {
          console.log('[BG] Scroll stalled at scrollY=' + lastScrollY + ' — stopping.');
          break;
        }
      } else {
        consecutiveEmpty = 0;
      }

      lastScrollY = pageInfo.scrollY;
      await sleep(3500);
    }
  } catch (e) {
    console.warn('[BG] fetchViaScrollTab error:', e.message);
  } finally {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
    console.log('[BG] Scroll tab closed. Total=' + urlMap.size);
  }
}

// ── Main fetch strategy per keyword — EXPANDED with more variants ──────────────
async function fetchPostsForKeyword(keyword) {
  const urlMap = new Map();
  const enc = encodeURIComponent;
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]/g, '');
  const csrf = await getCsrfToken();

  // ── Step 1: Base HTML (fast baseline, always first) ──────────────────────────
  const baseUrl = `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER`;
  const htmlText = await fetchHtml(baseUrl);
  extractPostsFromText(htmlText).forEach(p => { if (!urlMap.has(p.canonicalUrn)) urlMap.set(p.canonicalUrn, p); });
  console.log('[BG] Base HTML: ' + urlMap.size + ' posts kw=' + keyword);

  // ── Step 2: Voyager REST (no queryId required — always runs) ─────────────────
  // FIX: This runs BEFORE the scroll tab and is no longer gated behind < 30.
  // Two sort orders: relevance + date_posted for maximum coverage.
  if (S.state === 'RUNNING') {
    console.log('[BG] Voyager REST relevance...');
    await fetchViaVoyagerRest(keyword, csrf, urlMap, 'relevance');
  }
  if (S.state === 'RUNNING') {
    console.log('[BG] Voyager REST date_posted...');
    await fetchViaVoyagerRest(keyword, csrf, urlMap, 'date_posted');
  }
  console.log('[BG] After Voyager REST: total=' + urlMap.size);

  // ── Step 3: Voyager GraphQL (if queryId found in HTML) ───────────────────────
  if (S.state === 'RUNNING') {
    const qidMatches = [...htmlText.matchAll(/[\"']?queryId[\"']?\s*:\s*[\"']([a-f0-9]{32})[\"']/gi)];
    const oldQidMatch = htmlText.match(/voyagerSearchDashClusters\.([a-f0-9]{32})/i);
    if (oldQidMatch) qidMatches.push([null, oldQidMatch[1]]);
    const uniqueQids = [...new Set(qidMatches.map(m => m[1]))];
    if (uniqueQids.length > 0) {
      console.log('[BG] Trying Voyager GraphQL with ' + uniqueQids.length + ' queryIds...');
      for (const qid of uniqueQids) {
        if (S.state !== 'RUNNING') break;
        const oldSize = urlMap.size;
        const ok = await fetchViaVoyager(keyword, qid, csrf, urlMap);
        if (ok && urlMap.size > oldSize) { console.log('[BG] GraphQL queryId SUCCESS! +' + (urlMap.size - oldSize)); break; }
      }
    }
  }

  // ── Step 4: PRIMARY — Scroll Tab (opens real LinkedIn tab, scrolls 30x) ──────
  // FIX: scroll tab now uses pure incremental scrollBy — no scrollTo-bottom jump.
  if (S.state === 'RUNNING') {
    await fetchViaScrollTab(keyword, urlMap);
    console.log('[BG] After scroll tab: total=' + urlMap.size);
  }

  // ── Step 5: HTML variants (always run — not gated, for maximum coverage) ─────
  if (S.state === 'RUNNING') {
    const fallbackVariants = [
      // Sorted by date
      { base: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&sortBy=date_posted` },
      // Past week
      { base: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&f_TPR=r604800` },
      // Past month
      { base: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&f_TPR=r2592000` },
      // Hashtag
      { base: `https://www.linkedin.com/search/results/content/?keywords=%23${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER` },
      // Hashtag past week
      { base: `https://www.linkedin.com/search/results/content/?keywords=%23${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&f_TPR=r604800` },
      // Hashtag feed
      { base: `https://www.linkedin.com/feed/hashtag/${slug}/` },
    ];
    for (const v of fallbackVariants) {
      if (S.state !== 'RUNNING') break;
      const text = await fetchHtml(v.base);
      let added = 0;
      extractPostsFromText(text).forEach(p => { if (!urlMap.has(p.canonicalUrn)) { urlMap.set(p.canonicalUrn, p); added++; } });
      if (added > 0) console.log('[BG] HTML variant +' + added + ' (total=' + urlMap.size + ')');
      await sleep(1500);
    }
  }

  const posts = Array.from(urlMap.values());
  console.log('[BG] ✅ kw=' + keyword + ' total=' + posts.length + ' posts');
  return posts;
}

// ── DB Push ───────────────────────────────────────────────────────────────────
async function pushToAPI(posts, kw) {
  if (!posts || posts.length === 0) return 0;

  const payloadPosts = posts.map(p => {
    const formatted = { canonicalUrn: p.canonicalUrn, url: p.url, source: p.source };
    if (p.score !== null && p.score !== undefined) formatted.engagementScore = p.score;
    return formatted;
  });

  const endpoint = S.dashboardUrl + '/api/extension/results';
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
async function fetchKeywords() {
  const url = S.dashboardUrl + '/api/extension/jobs';
  let resp;
  try {
    resp = await fetch(url, { headers: { 'x-extension-token': S.userId } });
  } catch (e) {
    throw new Error('Failed to connect to Dashboard API (' + url + '). Make sure the Dashboard is running and you are connected.');
  }

  if (!resp.ok) throw new Error('Jobs API ' + resp.status);
  const jobs = await resp.json();
  if (!jobs.active) throw new Error(jobs.message || 'System inactive.');
  let kws = [];
  if (jobs.settings?.searchConfigJson) {
    try {
      const cfg = JSON.parse(jobs.settings.searchConfigJson);
      if (Array.isArray(cfg)) kws.push(...cfg.flat().filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()));
    } catch (_) {}
  }
  if (kws.length === 0 && Array.isArray(jobs.keywords))
    kws.push(...jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean));
  if (kws.length === 0) throw new Error('No keywords configured.');
  return { keywords: [...new Set(kws)], settings: jobs.settings || {} };
}

// ── Auto-Enrich: open each post in background tab, inject enrich.js ──────────
async function enrichSinglePost(url, urn) {
  return new Promise(async (resolve) => {
    let tabId = null;
    let settled = false;
    function finish(score) {
      if (settled) return;
      settled = true;
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      resolve(score);
    }
    // FIX: Increased hard timeout 18s → 30s for slow-loading posts
    const hardTimeout = setTimeout(() => finish(null), 30000);

    function onMsg(msg, sender) {
      if (msg.action !== 'ENRICH_RESULT') return;
      if (tabId !== null && sender.tab?.id !== tabId) return;
      chrome.runtime.onMessage.removeListener(onMsg);
      clearTimeout(hardTimeout);
      finish(msg.score ?? null);
    }
    chrome.runtime.onMessage.addListener(onMsg);

    try {
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;
      await new Promise(r => {
        function fn(id, info) {
          if (id !== tabId || info.status !== 'complete') return;
          chrome.tabs.onUpdated.removeListener(fn);
          // FIX: Increased post-complete delay 2000ms → 4000ms for React render
          setTimeout(r, 4000);
        }
        chrome.tabs.onUpdated.addListener(fn);
        setTimeout(r, 18000); // fallback
      });
      if (!settled) {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (u) => { window.__nexoraEnrichUrn = u; },
          args: [urn]
        });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['enrich.js'] });
      }
    } catch (e) {
      clearTimeout(hardTimeout);
      finish(null);
    }
  });
}

async function pushEnrichScore(urn, score, force) {
  try {
    const res = await fetch(S.dashboardUrl + '/api/extension/enrich', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': S.userId },
      body: JSON.stringify({ urn, score, force: force || false })
    });
    if (!res.ok) console.warn('[BG-ENRICH] push HTTP', res.status);
  } catch (e) { console.warn('[BG-ENRICH] score push error:', e.message); }
}

async function deleteEnrichPost(urn) {
  try {
    const res = await fetch(S.dashboardUrl + '/api/extension/enrich?urn=' + encodeURIComponent(urn), {
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

      // ── Pass 1: Initial enrich ──────────────────────────────────────────────
      let score = await enrichSinglePost(post.url, post.urn);
      console.log('[BG-ENRICH] Pass1 score=' + score + ' urn=' + post.urn);

      // ── Pass 2: Retry if null (page may not have loaded in time) ────────────
      if (score === null) {
        console.log('[BG-ENRICH] Pass1 null — retrying in 6s... urn=' + post.urn);
        await sleep(6000);
        score = await enrichSinglePost(post.url, post.urn);
        console.log('[BG-ENRICH] Pass2 score=' + score + ' urn=' + post.urn);
      }

      // ── Score=0 safety: treat as uncertain, never delete ───────────────────
      // score=0 almost always means a DOM detection failure, not genuine zero engagement.
      if (score === 0) {
        console.log('[BG-ENRICH] ⚠ score=0 → uncertain sentinel (-1) — NOT deleting. urn=' + post.urn);
        await pushEnrichScore(post.urn, -1, true);
        uncertain++;
        const done = enriched + nullCount + failed + uncertain;
        broadcastStatus('Enriching ' + done + '/' + total + '...');
        chrome.runtime.sendMessage({ action: 'ENRICH_PROGRESS', done, total, enriched, deleted, failed, nullCount, uncertain }).catch(() => {});
        if (done < total) await sleep(2500);
        continue;
      }

      // ── Both passes null → uncertain sentinel ───────────────────────────────
      if (score === null) {
        console.log('[BG-ENRICH] ⚠ Both passes null → uncertain sentinel (-1). urn=' + post.urn);
        await pushEnrichScore(post.urn, -1, true);
        uncertain++;
        nullCount++;
        const done = enriched + nullCount + failed + uncertain;
        broadcastStatus('Enriching ' + done + '/' + total + '...');
        chrome.runtime.sendMessage({ action: 'ENRICH_PROGRESS', done, total, enriched, deleted, failed, nullCount, uncertain }).catch(() => {});
        if (done < total) await sleep(2500);
        continue;
      }

      // ── Valid score obtained — push to API ──────────────────────────────────
      await pushEnrichScore(post.urn, score, false);
      enriched++;
      console.log('[BG-ENRICH] ✓ score=' + score + ' ' + post.urn);

      // ── Auto-delete: only if score >= 1 AND below threshold ────────────────
      // NEVER delete score=0 (handled above as uncertain).
      // RE-CHECK BEFORE DELETE: run a second independent enrich pass to confirm
      // the score before permanently removing the post from the database.
      if (autoDelete && score >= 1 && score < deleteThreshold) {
        console.log('[BG-ENRICH] Score ' + score + ' < threshold ' + deleteThreshold + ' — running re-check before delete...');
        await sleep(4000); // give the tab pool time to settle
        const confirmScore = await enrichSinglePost(post.url, post.urn);
        console.log('[BG-ENRICH] Re-check score=' + confirmScore + ' urn=' + post.urn);

        if (confirmScore === null || confirmScore === 0) {
          // Re-check failed or returned 0 — mark uncertain, do NOT delete
          console.log('[BG-ENRICH] ⚠ Re-check null/0 — cannot confirm deletion. Marking uncertain. urn=' + post.urn);
          await pushEnrichScore(post.urn, -1, true);
          uncertain++;
        } else if (confirmScore >= deleteThreshold) {
          // Re-check returned a HIGHER score — original was wrong. Keep the post.
          console.log('[BG-ENRICH] ✅ Re-check score=' + confirmScore + ' >= threshold — keeping post (original score was wrong). urn=' + post.urn);
          await pushEnrichScore(post.urn, confirmScore, true);
        } else {
          // Both passes confirm score < threshold — safe to delete
          console.log('[BG-ENRICH] 🗑 Re-check confirmed score=' + confirmScore + ' < ' + deleteThreshold + ' — deleting. urn=' + post.urn);
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

// ── Run Auto-Enrich after scraping completes ──────────────────────────────────
async function runAutoEnrich(autoDelete, deleteThreshold) {
  if (E.running) return;
  console.log('[BG-ENRICH] Auto-enrich: fetching unscored posts...');
  try {
    const kwParam = encodeURIComponent(S.keywords.join(','));
    const resp = await fetch(S.dashboardUrl + '/api/extension/posts?unscored=true&includeUncertain=true&keywords=' + kwParam, {
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

// ── Main engine loop ──────────────────────────────────────────────────────────
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
  console.log('[BG] ✅ Scraping done. totalSaved=' + S.totalSaved);
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
    console.log('[BG-ENRICH] Auto-enrich enabled — starting in 5s...');
    await sleep(5000);
    await runAutoEnrich(doDel, doThresh);
  }
}

// ── Broadcast / Badge ─────────────────────────────────────────────────────────
function broadcastStatus(msg) {
  chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', message: msg }).catch(() => {});
}
function setBadge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

// ── Messages ──────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'GET_STATUS' || msg.action === 'PING') {
    sendResponse({ running: S.state === 'RUNNING', state: S.state, runId: S.runId, totalSaved: S.totalSaved, keyword: S.keywords[S.kwIndex] || null });
  }

  else if (msg.action === 'START_ENGINE' || msg.action === 'START_SESSION') {
    if (S.state === 'RUNNING') { sendResponse({ ok: false, reason: 'already_running' }); return true; }
    S.state = 'RUNNING';
    S.runId = Date.now();
    S.kwIndex = 0;
    S.totalSaved = 0;
    S.dashboardUrl = (msg.dashboardUrl || msg.cfg?.dashboardUrl || '').trim();
    S.userId = (msg.userId || msg.cfg?.userId || '').trim();

    if (!S.dashboardUrl || !S.dashboardUrl.startsWith('http')) {
      sendResponse({ ok: false, reason: 'Invalid or missing Dashboard URL. Please reconnect.' });
      S.state = 'IDLE';
      return true;
    }
    if (!S.userId) {
      sendResponse({ ok: false, reason: 'Missing User ID. Please reconnect.' });
      S.state = 'IDLE';
      return true;
    }

    const msgEnrich = {
      autoEnrich:      msg.autoEnrich      ?? null,
      autoDelete:      msg.autoDelete      ?? null,
      deleteThreshold: msg.deleteThreshold ?? null,
    };
    console.log('[BG] START_ENGINE received enrich cfg:', msgEnrich);
    sendResponse({ ok: true });
    (async () => {
      try {
        const { keywords, settings } = await fetchKeywords();
        S.keywords = keywords;
        await runEngine(settings, msgEnrich);
      } catch (e) {
        console.error('[BG] Engine error:', e.message);
        S.state = 'IDLE';
        broadcastStatus('Error: ' + e.message);
      }
    })();
  }

  else if (msg.action === 'STOP_ENGINE' || msg.action === 'STOP_SESSION') {
    S.state = 'IDLE';
    E.running = false;
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

  // FIX: Added FLUSH_POSTS handler — content.js can now send results that are processed
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
