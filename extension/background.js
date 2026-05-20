// background.js — Nexora Headless Scraper (Final Clean Version)
// Fetches LinkedIn search page HTML directly (no tab/DOM needed).
// Gets ~5-10 posts per keyword from LinkedIn's SSR HTML. No pagination (SDUI ignores start=).

console.log('[BG] Nexora Headless Scraper loaded');

const S = {
  state: 'IDLE',
  runId: 0,
  totalSaved: 0,
  dashboardUrl: '',
  userId: '',
  keywords: [],
  kwIndex: 0,
};

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
  if (m[1] === 'ugcPost') return 'https://www.linkedin.com/posts/' + m[2];
  return 'https://www.linkedin.com/feed/update/' + urn;
}

function extractPostsFromText(text) {
  const urlMap = new Map();
  const URN_RE = /(?:urn:li:|urn%3Ali%3A)(activity|ugcPost|share)(?::|%3A)([0-9]{10,25})/gi;
  let m; URN_RE.lastIndex = 0;
  while ((m = URN_RE.exec(text)) !== null) {
    const raw = 'urn:li:' + m[1] + ':' + m[2];
    const urn = extractUrn(raw) || raw;
    if (urn && !urlMap.has(urn)) {
      const url = urnToUrl(urn);
      if (url) urlMap.set(urn, url);
    }
  }
  return Array.from(urlMap.entries()).map(([canonicalUrn, url]) => ({ canonicalUrn, url, source: 'search_only' }));
}

// ── CSRF Token ───────────────────────────────────────────────────────────────
function getCsrfToken() {
  return new Promise(resolve => {
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' }, c => {
      resolve(c ? c.value.replace(/"/g, '') : null);
    });
  });
}

// ── Fetch HTML helper ─────────────────────────────────────────────────────────
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache'
    }
  });
  if (!res.ok) { console.warn('[BG] HTML fetch HTTP ' + res.status + ' ' + url); return ''; }
  return res.text();
}

// ── Voyager GraphQL API (10 posts per call, paginated) ────────────────────────
async function fetchViaVoyager(keyword, queryId, csrf, urlMap) {
  const MAX_PAGES = 6; // up to 60 posts
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
      if (!res.ok) { console.warn('[BG] Voyager API HTTP ' + res.status + ' start=' + start); break; }
      const text = await res.text();
      const posts = extractPostsFromText(text);
      let added = 0;
      posts.forEach(p => { if (!urlMap.has(p.canonicalUrn)) { urlMap.set(p.canonicalUrn, p); added++; } });
      console.log('[BG] Voyager start=' + start + ': +' + added + ' new (total=' + urlMap.size + ')');
      if (added === 0) break; // no new posts — stop paginating
    } catch (e) {
      console.warn('[BG] Voyager error:', e.message);
      break;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

// ── Main fetch strategy for one keyword ──────────────────────────────────────
async function fetchPostsForKeyword(keyword) {
  const urlMap = new Map();
  const enc = encodeURIComponent;
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]/g, '');

  // ── Step 1: Base HTML fetch (always works, gets ~5 SSR posts + queryId) ────
  const baseUrl = `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER`;
  const htmlText = await fetchHtml(baseUrl);
  extractPostsFromText(htmlText).forEach(p => { if (!urlMap.has(p.canonicalUrn)) urlMap.set(p.canonicalUrn, p); });
  console.log('[BG] Base HTML: ' + urlMap.size + ' posts for kw=' + keyword);

  // ── Step 2: Try to extract Voyager queryId and paginate the real API ────────
  const qidMatch = htmlText.match(/["']?(voyagerSearchDashClusters\.[a-f0-9]{32})["']?/);
  if (qidMatch) {
    console.log('[BG] queryId found: ' + qidMatch[1] + ' — using Voyager API');
    const csrf = await getCsrfToken();
    await fetchViaVoyager(keyword, qidMatch[1], csrf, urlMap);
  } else {
    console.log('[BG] No queryId in HTML — using fallback URL variants');
    // ── Step 3: Fallback — try more URL variants for extra SSR posts ─────────
    const fallbackUrls = [
      `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&sortBy=date_posted`,
      `https://www.linkedin.com/search/results/content/?keywords=%23${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER`,
      `https://www.linkedin.com/feed/hashtag/${slug}/`,
      `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&datePosted=past-24h`,
      `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&datePosted=past-week&sortBy=date_posted`,
    ];
    for (const url of fallbackUrls) {
      if (S.state !== 'RUNNING') break;
      const text = await fetchHtml(url).catch(() => '');
      let added = 0;
      extractPostsFromText(text).forEach(p => {
        if (!urlMap.has(p.canonicalUrn)) { urlMap.set(p.canonicalUrn, p); added++; }
      });
      if (added > 0) console.log('[BG] +' + added + ' from: ' + url.split('?')[1]);
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  const posts = Array.from(urlMap.values());
  console.log('[BG] ✅ Total unique posts for kw=' + keyword + ': ' + posts.length);
  return posts;
}


// ── DB Push ──────────────────────────────────────────────────────────────────
async function pushToAPI(posts, kw) {
  if (!posts || posts.length === 0) return 0;
  console.log('[BG] Pushing ' + posts.length + ' posts for kw=' + kw);
  const endpoint = S.dashboardUrl + '/api/extension/results';
  const headers = { 'Content-Type': 'application/json', 'x-extension-token': S.userId };
  const body = JSON.stringify({ posts, keyword: kw, source: 'search_only' });
  try {
    let resp;
    try {
      resp = await fetch(endpoint, { method: 'POST', headers, body });
    } catch (_) {
      await new Promise(r => setTimeout(r, 3000));
      resp = await fetch(endpoint, { method: 'POST', headers, body });
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.warn('[BG] DB push failed HTTP ' + resp.status + ': ' + txt.slice(0, 200));
      return 0;
    }
    const data = await resp.json().catch(() => ({}));
    return typeof data.createdCount === 'number' ? data.createdCount : posts.length;
  } catch (e) {
    console.warn('[BG] DB push error:', e.message);
    return 0;
  }
}

// ── Keyword Fetch ─────────────────────────────────────────────────────────────
async function fetchKeywords() {
  const resp = await fetch(S.dashboardUrl + '/api/extension/jobs', {
    headers: { 'x-extension-token': S.userId }
  });
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
}

// ── Main engine loop ──────────────────────────────────────────────────────────
async function runEngine() {
  console.log('[BG] RUNNING. keywords=' + JSON.stringify(S.keywords));

  for (S.kwIndex = 0; S.kwIndex < S.keywords.length; S.kwIndex++) {
    if (S.state !== 'RUNNING') break;
    const kw = S.keywords[S.kwIndex];

    const posts = await fetchPostsForKeyword(kw);

    if (posts.length > 0) {
      const saved = await pushToAPI(posts, kw);
      S.totalSaved += saved;
      console.log('[BG] Saved ' + saved + '/' + posts.length + ' kw=' + kw + ' total=' + S.totalSaved);
    } else {
      console.warn('[BG] 0 posts found for kw=' + kw);
    }

    // Delay between keywords (anti-rate-limit)
    if (S.kwIndex < S.keywords.length - 1 && S.state === 'RUNNING') {
      console.log('[BG] Waiting 5s before next keyword...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  if (S.state === 'RUNNING') {
    S.state = 'IDLE';
    console.log('[BG] All keywords done. totalSaved=' + S.totalSaved);
    broadcastStatus('Done! ' + S.totalSaved + ' posts saved.');
    setBadge(String(S.totalSaved), '#3b82f6');
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
    sendResponse({
      running: S.state === 'RUNNING',
      state: S.state,
      runId: S.runId,
      totalSaved: S.totalSaved,
      keyword: S.keywords[S.kwIndex] || null
    });
  }

  else if (msg.action === 'START_ENGINE' || msg.action === 'START_SESSION') {
    if (S.state === 'RUNNING') { sendResponse({ ok: false, reason: 'already_running' }); return true; }
    S.state = 'RUNNING';
    S.runId = Date.now();
    S.kwIndex = 0;
    S.totalSaved = 0;
    S.dashboardUrl = msg.dashboardUrl || msg.cfg?.dashboardUrl || '';
    S.userId = msg.userId || msg.cfg?.userId || '';
    sendResponse({ ok: true });
    (async () => {
      try {
        S.keywords = await fetchKeywords();
        await runEngine();
      } catch (e) {
        console.error('[BG] Engine error:', e.message);
        S.state = 'IDLE';
        broadcastStatus('Error: ' + e.message);
      }
    })();
  }

  else if (msg.action === 'STOP_ENGINE' || msg.action === 'STOP_SESSION') {
    S.state = 'IDLE';
    broadcastStatus('Stopped.');
    setBadge('', '#6b7280');
    sendResponse({ ok: true });
  }

  else if (msg.action === 'KEEP_ALIVE') {
    sendResponse({ ok: true });
  }

  return true;
});
