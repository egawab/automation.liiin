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

// ── HTML Fetch ────────────────────────────────────────────────────────────────
async function fetchPostsForKeyword(keyword) {
  const url = 'https://www.linkedin.com/search/results/content/?keywords='
    + encodeURIComponent(keyword) + '&origin=GLOBAL_SEARCH_HEADER';

  console.log('[BG] Fetching: ' + url);

  try {
    const res = await fetch(url, {
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache'
      }
    });
    if (!res.ok) {
      console.warn('[BG] Fetch failed HTTP ' + res.status + ' for kw=' + keyword);
      return [];
    }
    const text = await res.text();
    const posts = extractPostsFromText(text);
    console.log('[BG] HTML fetch found ' + posts.length + ' posts for kw=' + keyword);
    return posts;
  } catch (e) {
    console.warn('[BG] Fetch error for kw=' + keyword + ':', e.message);
    return [];
  }
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
