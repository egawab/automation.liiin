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
};

const E = { running: false };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// â”€â”€ Keep-alive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
chrome.alarms.create('nexora_hb', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'nexora_hb' && S.state === 'RUNNING')
    console.log('[BG] hb state=RUNNING kw=' + (S.keywords[S.kwIndex] || ''));
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
    return res.text();
  } catch (e) {
    console.warn('[BG] fetchHtml error:', e.message);
    return '';
  }
}

// â”€â”€ Voyager GraphQL paginator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Voyager REST search (no queryId needed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Tab-based scroll scraper â€” MAXIMUM VOLUME MODE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Opens a real LinkedIn tab and scrolls aggressively to trigger infinite-scroll.
// sortMode: 'date_posted' | 'relevance'
async function fetchViaScrollTab(keyword, urlMap, sortMode) {
  const sort = sortMode || 'date_posted';
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER&sortBy=${sort}`;
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

    // Pre-flight: verify page has content
    let preflightOk = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const pf = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({
            sh: document.documentElement.scrollHeight,
            len: (document.body?.innerText || '').length,
            urns: (document.body?.innerHTML || '').match(/urn:li:/g)?.length || 0,
            url: window.location.href,
          })
        });
        const p = pf?.[0]?.result || {};
        console.log('[BG] Preflight[' + sort + '] #' + (attempt+1) + ': sh=' + p.sh + ' len=' + p.len + ' urns=' + p.urns + ' url=' + p.url);
        if (p.sh > 2000 || p.urns > 0 || p.len > 2000) { preflightOk = true; break; }
        await sleep(5000);
      } catch (e) { break; }
    }

    if (!preflightOk) {
      console.warn('[BG] ScrollTab[' + sort + '] page never loaded â€” skipping.');
      return;
    }

    const MAX_SCROLLS = 50;         // was 30 â€” push harder
    const SCROLL_STEP = 600;        // smaller steps = more observer triggers
    const STALL_EXIT = 8;           // exit after 8 consecutive stalls
    const STALL_RETRY = 3;          // retry scroll on stall before giving up
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

            return { posts: Array.from(found.values()), scrollY: sy, scrollHeight: sh, atBottom };
          },
          args: [SCROLL_STEP]
        });

        const res = results?.[0]?.result || { posts: [], scrollY: 0, scrollHeight: 0, atBottom: false };
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

// â”€â”€ Main fetch strategy per keyword â€” MAXIMUM VOLUME â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchPostsForKeyword(keyword) {
  const urlMap = new Map();
  const enc = encodeURIComponent;
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]/g, '');
  const csrf = await getCsrfToken();

  console.log('[BG] â•گâ•گâ•گ Starting MAX-VOLUME extraction for keyword: "' + keyword + '" â•گâ•گâ•گ');

  // â”€â”€ PHASE 1: Parallel Voyager REST (relevance + date simultaneously) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (S.state === 'RUNNING') {
    console.log('[BG] Phase 1: Voyager REST (both sort orders in parallel)...');
    await Promise.all([
      fetchViaVoyagerRest(keyword, csrf, urlMap, 'relevance'),
      fetchViaVoyagerRest(keyword, csrf, urlMap, 'date_posted'),
    ]);
    console.log('[BG] Phase 1 done: ' + urlMap.size + ' posts');
  }

  // â”€â”€ PHASE 2: Voyager GraphQL (from HTML queryId) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (S.state === 'RUNNING') {
    const baseHtml = await fetchHtml(`https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER`);
    extractPostsFromText(baseHtml).forEach(p => { if (!urlMap.has(p.canonicalUrn)) urlMap.set(p.canonicalUrn, p); });
    const qids = [...new Set([
      ...[...baseHtml.matchAll(/[\"']?queryId[\"']?\s*:\s*[\"']([a-f0-9]{32})[\"']/gi)].map(m => m[1]),
      ...(baseHtml.match(/voyagerSearchDashClusters\.([a-f0-9]{32})/i) ? [baseHtml.match(/voyagerSearchDashClusters\.([a-f0-9]{32})/i)[1]] : []),
    ])];
    if (qids.length > 0) {
      for (const qid of qids) {
        if (S.state !== 'RUNNING') break;
        await fetchViaVoyager(keyword, qid, csrf, urlMap);
      }
    }
    console.log('[BG] Phase 2 done: ' + urlMap.size + ' posts');
  }

  // â”€â”€ PHASE 3: Dual parallel scroll tabs (date + relevance simultaneously) â”€â”€â”€â”€â”€â”€
  if (S.state === 'RUNNING') {
    console.log('[BG] Phase 3: Dual scroll tabs (date + relevance in parallel)...');
    await Promise.all([
      fetchViaScrollTab(keyword, urlMap, 'date_posted'),
      fetchViaScrollTab(keyword, urlMap, 'relevance'),
    ]);
    console.log('[BG] Phase 3 done: ' + urlMap.size + ' posts');
  }

  // â”€â”€ PHASE 4: Aggressive HTML variant sweep â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (S.state === 'RUNNING') {
    console.log('[BG] Phase 4: HTML variant sweep...');
    const DATE_RANGES = [
      'r86400',    // past 24h
      'r604800',   // past week
      'r2592000',  // past month
      'r7776000',  // past 3 months
    ];
    const variants = [
      // Date-sorted + date filters
      ...DATE_RANGES.map(r => ({ url: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&sortBy=date_posted&f_TPR=${r}`, label: 'date+' + r })),
      // Relevance + date filters
      ...DATE_RANGES.map(r => ({ url: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&f_TPR=${r}`, label: 'rel+' + r })),
      // Hashtag variants
      { url: `https://www.linkedin.com/search/results/content/?keywords=%23${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER`, label: 'hashtag' },
      { url: `https://www.linkedin.com/search/results/content/?keywords=%23${enc(keyword)}&sortBy=date_posted`, label: 'hashtag+date' },
      { url: `https://www.linkedin.com/search/results/content/?keywords=%23${enc(keyword)}&f_TPR=r604800`, label: 'hashtag+week' },
      { url: `https://www.linkedin.com/feed/hashtag/${slug}/`, label: 'hashtag-feed' },
      // People writing about topic
      { url: `https://www.linkedin.com/search/results/people/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER`, label: 'people' },
      // Quoted exact phrase
      { url: `https://www.linkedin.com/search/results/content/?keywords=${enc('"' + keyword + '"')}&sortBy=date_posted`, label: 'quoted' },
      // With common suffixes for broader reach
      { url: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword + ' tips')}&sortBy=date_posted`, label: 'tips' },
      { url: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword + ' strategy')}&sortBy=date_posted`, label: 'strategy' },
      { url: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword + ' 2024')}&sortBy=date_posted`, label: '2024' },
      { url: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword + ' 2025')}&sortBy=date_posted`, label: '2025' },
      // Language variants (Arabic + English)
      { url: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&sortBy=date_posted&f_C=&f_CR=101282230`, label: 'uae' },
      { url: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&sortBy=date_posted&f_CR=101165590`, label: 'sa' },
      // Pagination pages 2-5 (each page = 10 more posts)
      ...[2,3,4,5].map(p => ({ url: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&start=${(p-1)*10}`, label: 'page' + p })),
      ...[2,3,4,5].map(p => ({ url: `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&sortBy=date_posted&start=${(p-1)*10}`, label: 'date-page' + p })),
    ];

    // Batch in groups of 3 to avoid hammering LinkedIn
    for (let i = 0; i < variants.length; i += 3) {
      if (S.state !== 'RUNNING') break;
      const batch = variants.slice(i, i + 3);
      await Promise.all(batch.map(v => fetchHtmlVariant(v.url, urlMap, v.label)));
      await sleep(1200);
    }
    console.log('[BG] Phase 4 done: ' + urlMap.size + ' posts');
  }

  // â”€â”€ PHASE 5: Second scroll pass on date_posted (catches newly loaded content) â”€
  // Run a second pass on the scroll tab after all other strategies have run.
  // LinkedIn may have more content indexed now that we've touched its search APIs.
  if (S.state === 'RUNNING' && urlMap.size < 100) {
    console.log('[BG] Phase 5: Second scroll pass (volume=' + urlMap.size + ' < 100, boosting)...');
    await fetchViaScrollTab(keyword, urlMap, 'date_posted');
    console.log('[BG] Phase 5 done: ' + urlMap.size + ' posts');
  }

  const posts = Array.from(urlMap.values());
  console.log('[BG] â•گâ•گâ•گ kw="' + keyword + '" TOTAL=' + posts.length + ' posts extracted â•گâ•گâ•گ');
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

// â”€â”€ Keyword Fetch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Auto-Enrich: open each post in background tab, inject enrich.js â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ARCHITECTURE FIX: Use executeScript polling (direct return value) instead of
// chrome.runtime.sendMessage / onMessage listener pattern.
//
// ROOT CAUSE of previous 16/18 null results:
//   Hard timeout (30s) fired BEFORE enrich.js could complete because:
//   - Tab load wait: up to 18s
//   - Post-complete settle: 4s
//   - enrich.js polling: up to 20s
//   Total needed: 42s > 30s hard timeout â†’ tab closed â†’ message never received.
//
// NEW FLOW:
//   1. Create tab, wait for load + settle
//   2. Set window.__nexoraEnrichUrn, reset window.__nexoraEnrichResult = null
//   3. Inject enrich.js (which writes result to window.__nexoraEnrichResult when done)
//   4. Poll window.__nexoraEnrichResult via executeScript every 1500ms (max 25 attempts = 37.5s)
//   5. Return score as direct return value â€” no message passing, no listener, no race.
async function enrichSinglePost(url, urn) {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;

    // Wait for page load (status=complete) + settle time for React to render
    await new Promise(r => {
      function fn(id, info) {
        if (id !== tabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(fn);
        setTimeout(r, 5000); // 5s settle (was 4s, increased for slower SDUI renders)
      }
      chrome.tabs.onUpdated.addListener(fn);
      setTimeout(r, 18000); // hard load fallback: if complete never fires, continue anyway
    });

    if (!tabId) return null;

    // Set URN and reset result flag BEFORE injecting enrich.js
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (u) => {
        window.__nexoraEnrichUrn = u;
        window.__nexoraEnrichResult = null; // reset from any previous run
        window.__nexoraEnrichDone = false;  // allow re-injection
      },
      args: [urn]
    });

    // Inject enrich.js â€” it will scan the DOM and write to window.__nexoraEnrichResult
    await chrome.scripting.executeScript({ target: { tabId }, files: ['enrich.js'] });

    // Poll window.__nexoraEnrichResult via executeScript return value.
    // This is race-condition-free: no message listener, no service-worker-sleep issues.
    const POLL_MS = 1500;
    const POLL_MAX = 25; // 25 * 1500ms = 37.5 seconds of polling
    for (let i = 0; i < POLL_MAX; i++) {
      await sleep(POLL_MS);
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.__nexoraEnrichResult || null
        });
        const result = results?.[0]?.result;
        if (result && result.done === true) {
          const s = result.score;
          console.log('[BG-ENRICH] Poll[' + (i+1) + '] result: score=' + s + ' via=' + result.method + ' urn=' + urn);
          return (typeof s === 'number') ? s : null;
        }
        if (i % 5 === 0) console.log('[BG-ENRICH] Poll[' + (i+1) + '] waiting... urn=' + urn);
      } catch (e) {
        // Tab closed or navigated away â€” stop polling
        console.warn('[BG-ENRICH] Poll error (tab closed?): ' + e.message + ' urn=' + urn);
        return null;
      }
    }

    console.warn('[BG-ENRICH] Poll timeout after ' + (POLL_MAX * POLL_MS / 1000) + 's urn=' + urn);
    return null;
  } catch (e) {
    console.warn('[BG-ENRICH] enrichSinglePost error:', e.message);
    return null;
  } finally {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
  }
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

// â”€â”€ Auto-Enrich Session â€” retry logic, re-check-before-delete, uncertain sentinel â”€â”€
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

      // â”€â”€ Pass 1: Initial enrich â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let score = await enrichSinglePost(post.url, post.urn);
      console.log('[BG-ENRICH] Pass1 score=' + score + ' urn=' + post.urn);

      // â”€â”€ Pass 2: Retry if null (page may not have loaded in time) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (score === null) {
        console.log('[BG-ENRICH] Pass1 null â€” retrying in 6s... urn=' + post.urn);
        await sleep(6000);
        score = await enrichSinglePost(post.url, post.urn);
        console.log('[BG-ENRICH] Pass2 score=' + score + ' urn=' + post.urn);
      }

      // â”€â”€ Score=0 safety: treat as uncertain, never delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // score=0 almost always means a DOM detection failure, not genuine zero engagement.
      if (score === 0) {
        console.log('[BG-ENRICH] âڑ  score=0 â†’ uncertain sentinel (-1) â€” NOT deleting. urn=' + post.urn);
        await pushEnrichScore(post.urn, -1, true);
        uncertain++;
        const done = enriched + nullCount + failed + uncertain;
        broadcastStatus('Enriching ' + done + '/' + total + '...');
        chrome.runtime.sendMessage({ action: 'ENRICH_PROGRESS', done, total, enriched, deleted, failed, nullCount, uncertain }).catch(() => {});
        if (done < total) await sleep(2500);
        continue;
      }

      // â”€â”€ Both passes null â†’ uncertain sentinel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (score === null) {
        console.log('[BG-ENRICH] âڑ  Both passes null â†’ uncertain sentinel (-1). urn=' + post.urn);
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
        console.log('[BG-ENRICH] Score ' + score + ' < threshold ' + deleteThreshold + ' â€” running re-check before delete...');
        await sleep(4000); // give the tab pool time to settle
        const confirmScore = await enrichSinglePost(post.url, post.urn);
        console.log('[BG-ENRICH] Re-check score=' + confirmScore + ' urn=' + post.urn);

        if (confirmScore === null || confirmScore === 0) {
          // Re-check failed or returned 0 â€” mark uncertain, do NOT delete
          console.log('[BG-ENRICH] âڑ  Re-check null/0 â€” cannot confirm deletion. Marking uncertain. urn=' + post.urn);
          await pushEnrichScore(post.urn, -1, true);
          uncertain++;
        } else if (confirmScore >= deleteThreshold) {
          // Re-check returned a HIGHER score â€” original was wrong. Keep the post.
          console.log('[BG-ENRICH] âœ… Re-check score=' + confirmScore + ' >= threshold â€” keeping post (original score was wrong). urn=' + post.urn);
          await pushEnrichScore(post.urn, confirmScore, true);
        } else {
          // Both passes confirm score < threshold â€” safe to delete
          console.log('[BG-ENRICH] ًں—‘ Re-check confirmed score=' + confirmScore + ' < ' + deleteThreshold + ' â€” deleting. urn=' + post.urn);
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
  chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', message: msg }).catch(() => {});
}
function setBadge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

// â”€â”€ Messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
