// background.js — Nexora Headless API Scraper
// Bypasses SDUI completely by fetching search results directly from LinkedIn servers.

console.log('[BG] Nexora Headless API Scraper loaded');

const S = {
  state: 'IDLE',
  runId: 0,
  totalSaved: 0,
  dashboardUrl: '',
  userId: '',
  keywords: [],
  kwIndex: 0,
  pageIndex: 0,
  maxPages: 12, // 12 pages = ~120 posts
  abortController: null
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function getCsrfToken() {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' }, (cookie) => {
      resolve(cookie ? cookie.value.replace(/"/g, '') : null);
    });
  });
}

function extractUrn(s) {
  if (!s) return '';
  const m = String(s).match(/(?:urn:li:|urn%3Ali%3A)(activity|ugcPost|share)(?::|%3A)([0-9]{10,25})/i);
  if (m) return 'urn:li:' + m[1] + ':' + m[2];
  const p = String(s).match(/activity-([0-9]{10,25})/i);
  if (p) return 'urn:li:activity:' + p[1];
  return '';
}

function urnToUrl(urn) {
  if (!urn) return '';
  const m = urn.match(/urn:li:(ugcPost|activity|share):([0-9]+)/);
  if (!m) return '';
  if (m[1] === 'ugcPost') return 'https://www.linkedin.com/posts/' + m[2];
  return 'https://www.linkedin.com/feed/update/' + urn;
}

async function extractPostsFromText(text) {
  const URN_RE = /(?:urn:li:|urn%3Ali%3A)(activity|ugcPost|share)(?::|%3A)([0-9]{10,25})/gi;
  const urlMap = new Map();
  let m;
  URN_RE.lastIndex = 0;
  while ((m = URN_RE.exec(text)) !== null) {
    const urn = extractUrn(m[0]);
    if (urn) {
      urlMap.set(urn, urnToUrl(urn));
    }
  }
  return Array.from(urlMap.entries()).map(([urn, url]) => ({
    canonicalUrn: urn,
    url: url,
    source: 'headless_api'
  }));
}

// ── Headless Fetching ────────────────────────────────────────────────────────
async function fetchPageHeadless(keyword, start) {
  const csrf = await getCsrfToken();
  if (!csrf) {
    console.warn('[BG] No JSESSIONID found. User might be logged out.');
  }

  // Strategy 1: Voyager Blended Search API (Fastest, raw JSON)
  try {
    const apiUrl = `https://www.linkedin.com/voyager/api/search/blended?count=10&filters=List(resultType-%3ECONTENT)&keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER&q=all&start=${start}`;
    console.log(`[BG] Fetching API: ${apiUrl}`);
    
    const apiRes = await fetch(apiUrl, {
      signal: S.abortController.signal,
      headers: {
        'csrf-token': csrf || '',
        'accept': 'application/vnd.linkedin.normalized+json+2.1',
        'x-restli-protocol-version': '2.0.0'
      }
    });

    if (apiRes.ok) {
      const text = await apiRes.text();
      const posts = await extractPostsFromText(text);
      if (posts.length > 0) {
        console.log(`[BG] API Success: Found ${posts.length} posts for ${keyword} (start=${start})`);
        return posts;
      }
    } else {
      console.warn(`[BG] API returned ${apiRes.status}`);
    }
  } catch (err) {
    console.warn(`[BG] API Error: ${err.message}`);
  }

  // Strategy 2: HTML Fetch Fallback (Bulletproof SSR Extraction)
  console.log(`[BG] Falling back to HTML Fetch for ${keyword} (start=${start})`);
  try {
    const htmlUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&start=${start}`;
    const htmlRes = await fetch(htmlUrl, {
      signal: S.abortController.signal,
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9'
      }
    });

    if (htmlRes.ok) {
      const text = await htmlRes.text();
      const posts = await extractPostsFromText(text);
      console.log(`[BG] HTML Success: Found ${posts.length} posts for ${keyword} (start=${start})`);
      return posts;
    }
  } catch (err) {
    console.warn(`[BG] HTML Error: ${err.message}`);
  }

  return [];
}

// ── DB Push ──────────────────────────────────────────────────────────────────
async function pushToAPI(posts, kw) {
  if (!posts || posts.length === 0) return;
  console.log(`[BG] pushToAPI count=${posts.length} kw=${kw}`);
  const endpoint = S.dashboardUrl + '/api/extension/results';
  const headers = { 'Content-Type': 'application/json', 'x-extension-token': S.userId };
  const body = JSON.stringify({ posts, keyword: kw, source: 'search_only' });
  try {
    let resp;
    try {
      resp = await fetch(endpoint, { method: 'POST', headers, body });
    } catch (_) {
      // One retry after 3s on network error
      await new Promise(r => setTimeout(r, 3000));
      resp = await fetch(endpoint, { method: 'POST', headers, body });
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.warn('[BG] DB push failed HTTP ' + resp.status + ': ' + txt.substring(0, 200));
      return;
    }
    const data = await resp.json().catch(() => ({}));
    const saved = data.createdCount ?? data.savedCount ?? posts.length;
    S.totalSaved += saved;
    console.log(`[BG] Saved ${saved}/${posts.length} total=${S.totalSaved}`);
  } catch (e) {
    console.warn('[BG] DB push error:', e.message);
  }
}

// ── Engine Loop ──────────────────────────────────────────────────────────────
async function runHeadlessLoop() {
  while (S.kwIndex < S.keywords.length && S.state === 'RUNNING') {
    const kw = S.keywords[S.kwIndex];
    
    while (S.pageIndex < S.maxPages && S.state === 'RUNNING') {
      const start = S.pageIndex * 10;
      console.log(`[BG] Processing: kw=${kw} page=${S.pageIndex + 1}/${S.maxPages} (start=${start})`);
      
      const posts = await fetchPageHeadless(kw, start);
      
      if (posts.length > 0) {
        await pushToAPI(posts, kw);
        S.totalSaved += posts.length;
      } else {
        console.log(`[BG] No posts found on page ${S.pageIndex + 1}. Ending keyword early.`);
        break; // No more results for this keyword
      }

      S.pageIndex++;
      
      // Delay between pages to avoid rate limiting
      if (S.pageIndex < S.maxPages) {
        await new Promise(r => setTimeout(r, 4000 + Math.random() * 2000));
      }
    }

    S.kwIndex++;
    S.pageIndex = 0;
  }

  if (S.state === 'RUNNING') {
    console.log(`[BG] All keywords done. totalSaved=${S.totalSaved}`);
    S.state = 'IDLE';
    S.dashboardUrl && chrome.tabs.create({ url: S.dashboardUrl });
  }
}

// ── Keyword Fetch ──────────────────────────────────────────────────────────────
async function fetchKeywords(dashUrl, userId) {
  try {
    const resp = await fetch(dashUrl + '/api/extension/jobs', { headers: { 'x-extension-token': userId } });
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
    if (kws.length === 0 && Array.isArray(jobs.keywords)) {
      kws.push(...jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean));
    }
    if (kws.length === 0) throw new Error('No keywords configured.');
    return [...new Set(kws)];
  } catch (e) {
    console.error('[BG] Failed to fetch keywords:', e);
    return [];
  }
}

// ── Messages ─────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'GET_STATUS' || msg.action === 'PING') {
    sendResponse({ 
      running: S.state !== 'IDLE' && S.state !== 'DONE', 
      state: S.state, 
      runId: S.runId, 
      totalSaved: S.totalSaved, 
      keyword: S.keywords[S.kwIndex] || null 
    });
  }
  else if (msg.action === 'START_ENGINE' || msg.action === 'START_SESSION') {
    console.log('[BG] START_ENGINE', msg);
    if (S.state === 'RUNNING') {
      if (S.abortController) S.abortController.abort();
    }
    
    S.state = 'RUNNING';
    S.runId = Date.now();
    S.dashboardUrl = msg.dashboardUrl || msg.cfg?.dashboardUrl;
    S.userId = msg.userId || msg.cfg?.userId;
    S.kwIndex = 0;
    S.pageIndex = 0;
    S.totalSaved = 0;
    S.abortController = new AbortController();
    
    sendResponse({ ok: true });
    
    // Start engine asynchronously
    (async () => {
      try {
        if (!msg.cfg?.keywords) {
          S.keywords = await fetchKeywords(S.dashboardUrl, S.userId);
        } else {
          S.keywords = msg.cfg.keywords;
        }
        
        if (!S.keywords || S.keywords.length === 0) {
          console.warn('[BG] No keywords found.');
          S.state = 'IDLE';
          return;
        }
        
        await runHeadlessLoop();
      } catch (e) {
        console.error('[BG] Engine crash:', e);
        S.state = 'IDLE';
      }
    })();
  }
  else if (msg.action === 'STOP_ENGINE' || msg.action === 'STOP_SESSION') {
    console.log('[BG] STOP_ENGINE');
    S.state = 'IDLE';
    if (S.abortController) S.abortController.abort();
    sendResponse({ ok: true });
  }
  else if (msg.action === 'KEEP_ALIVE') {
    sendResponse({ ok: true });
  }
  return true;
});
