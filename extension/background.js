// background.js — Nexora Headless Scraper + Auto-Enrich + Auto-Delete
console.log('[BG] Nexora Headless Scraper v6 loaded');

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
  const MAX_PAGES = 15; // up to 150 posts
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
      console.log('[BG] Voyager start=' + start + ': +' + added + ' (total=' + urlMap.size + ')');
      if (added === 0) break;
    } catch (e) {
      console.warn('[BG] Voyager error:', e.message);
      break;
    }
    await sleep(1200);
  }
}

// ── Main fetch strategy per keyword ──────────────────────────────────────────
async function fetchPostsForKeyword(keyword) {
  const urlMap = new Map();
  const enc = encodeURIComponent;
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Step 1: Base HTML (always works + extracts queryId)
  const baseUrl = `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER`;
  const htmlText = await fetchHtml(baseUrl);
  extractPostsFromText(htmlText).forEach(p => { if (!urlMap.has(p.canonicalUrn)) urlMap.set(p.canonicalUrn, p); });
  console.log('[BG] Base HTML: ' + urlMap.size + ' posts kw=' + keyword);

  // Step 2: Voyager API via queryId (if present in HTML) → 100 posts
  const qidMatch = htmlText.match(/["']?(voyagerSearchDashClusters\.[a-f0-9]{32})["']?/);
  if (qidMatch) {
    console.log('[BG] queryId found → Voyager API pagination');
    const csrf = await getCsrfToken();
    await fetchViaVoyager(keyword, qidMatch[1], csrf, urlMap);
  } else {
    // Step 3: Fallback — multiple URL variants + hashtag
    console.log('[BG] Voyager queryId not found → fallback variants');
    const fallbackUrls = [
      `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&sortBy=date_posted`,
      `https://www.linkedin.com/search/results/content/?keywords=%23${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER`,
      `https://www.linkedin.com/search/results/content/?keywords=%23${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&sortBy=date_posted`,
      `https://www.linkedin.com/feed/hashtag/${slug}/`,
      `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&datePosted=past-24h`,
      `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&datePosted=past-week`,
      `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&datePosted=past-week&sortBy=date_posted`,
      `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&datePosted=past-month`,
      `https://www.linkedin.com/search/results/content/?keywords=${enc(keyword)}&origin=GLOBAL_SEARCH_HEADER&datePosted=past-month&sortBy=date_posted`,
    ];
    for (const url of fallbackUrls) {
      if (S.state !== 'RUNNING') break;
      const text = await fetchHtml(url);
      let added = 0;
      extractPostsFromText(text).forEach(p => { if (!urlMap.has(p.canonicalUrn)) { urlMap.set(p.canonicalUrn, p); added++; } });
      if (added > 0) console.log('[BG] +' + added + ' from: ' + url.split('?')[1]);
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
  const endpoint = S.dashboardUrl + '/api/extension/results';
  const headers = { 'Content-Type': 'application/json', 'x-extension-token': S.userId };
  const body = JSON.stringify({ posts, keyword: kw, source: 'search_only' });
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
  const resp = await fetch(S.dashboardUrl + '/api/extension/jobs', { headers: { 'x-extension-token': S.userId } });
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

// ── Auto-Enrich: open each post in background tab, inject enrich.js ───────────
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
    const hardTimeout = setTimeout(() => finish(null), 18000);

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
          setTimeout(r, 2000);
        }
        chrome.tabs.onUpdated.addListener(fn);
        setTimeout(r, 15000); // fallback
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

async function pushEnrichScore(urn, score) {
  try {
    await fetch(S.dashboardUrl + '/api/extension/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': S.userId },
      body: JSON.stringify({ canonicalUrn: urn, engagementScore: score })
    });
  } catch (e) { console.warn('[BG-ENRICH] score push error:', e.message); }
}

async function deleteEnrichPost(urn) {
  try {
    await fetch(S.dashboardUrl + '/api/extension/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': S.userId },
      body: JSON.stringify({ action: 'delete', canonicalUrn: urn })
    });
  } catch (e) { console.warn('[BG-ENRICH] delete error:', e.message); }
}

// ── Auto-Enrich Session ───────────────────────────────────────────────────────
async function startEnrichSession(posts, opts = {}) {
  if (E.running) { console.warn('[BG-ENRICH] Already running'); return; }
  E.running = true;
  const { autoDelete = false, deleteThreshold = 10 } = opts;
  const total = posts.length;
  let enriched = 0, deleted = 0, nullCount = 0, failed = 0;

  console.log('[BG-ENRICH] Starting enrichment for ' + total + ' posts');
  broadcastStatus('Enriching 0/' + total + '...');
  setBadge('...', '#f59e0b');

  for (const post of posts) {
    if (!post.url || !post.urn) { failed++; continue; }
    try {
      const score = await enrichSinglePost(post.url, post.urn);
      if (score !== null) {
        await pushEnrichScore(post.urn, score);
        enriched++;
        console.log('[BG-ENRICH] ✓ score=' + score + ' ' + post.urn);
        if (autoDelete && score < deleteThreshold) {
          await deleteEnrichPost(post.urn);
          deleted++;
          console.log('[BG-ENRICH] 🗑 Deleted (score=' + score + '<' + deleteThreshold + ')');
        }
      } else {
        nullCount++;
      }
    } catch (e) {
      failed++;
      console.warn('[BG-ENRICH] Error:', e.message);
    }
    const done = enriched + nullCount + failed;
    broadcastStatus('Enriching ' + done + '/' + total + '...');
    chrome.runtime.sendMessage({ action: 'ENRICH_PROGRESS', done, total, enriched, deleted, failed, nullCount }).catch(() => {});
    if (done < total) await sleep(2500);
  }

  E.running = false;
  console.log('[BG-ENRICH] Done. enriched=' + enriched + ' deleted=' + deleted + ' null=' + nullCount);
  broadcastStatus('Enrichment done! ' + enriched + ' scored, ' + deleted + ' deleted.');
  setBadge(String(enriched), '#3b82f6');
}

// ── Run Auto-Enrich after scraping completes ──────────────────────────────────
async function runAutoEnrich(autoDelete, deleteThreshold) {
  if (E.running) return;
  console.log('[BG-ENRICH] Auto-enrich: fetching unscored posts...');
  try {
    const kwParam = encodeURIComponent(S.keywords.join(','));
    const resp = await fetch(S.dashboardUrl + '/api/extension/posts?unscored=true&keywords=' + kwParam, {
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
  // Priority: msgEnrich (from START_ENGINE msg) > chrome.storage.sync > jobs API > default
  const storedCfg = await new Promise(resolve =>
    chrome.storage.sync.get(['autoEnrich', 'autoDelete', 'deleteThreshold'], resolve)
  );
  
  const resolveSetting = (msgVal, storedVal, apiVal, fallback) => {
    if (msgVal !== null && msgVal !== undefined) return msgVal;
    if (storedVal !== null && storedVal !== undefined) return storedVal;
    if (apiVal !== null && apiVal !== undefined) return apiVal;
    return fallback;
  };

  const autoEnrich      = resolveSetting(msgEnrich.autoEnrich, storedCfg.autoEnrich, settings.autoEnrich, false);
  const autoDelete      = resolveSetting(msgEnrich.autoDelete, storedCfg.autoDelete, settings.autoDelete, false);
  const deleteThreshold = Number(resolveSetting(msgEnrich.deleteThreshold, storedCfg.deleteThreshold, settings.deleteThreshold, 10)) || 10;


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

  // Re-read autoEnrich RIGHT NOW (user may have ticked it during scraping)
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
    S.dashboardUrl = msg.dashboardUrl || msg.cfg?.dashboardUrl || '';
    S.userId = msg.userId || msg.cfg?.userId || '';
    // Capture enrich settings sent directly from Dashboard UI (most reliable source)
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
      // Accept both {urn, url} (from Dashboard) and {canonicalUrn, postUrl} (legacy)
      const posts = (msg.posts || [])
        .map(p => ({ urn: p.urn || p.canonicalUrn, url: p.url || p.postUrl }))
        .filter(p => p.urn && p.url);
      console.log('[BG] RE_ENRICH received ' + (msg.posts||[]).length + ' posts, valid=' + posts.length);
      await startEnrichSession(posts, { autoDelete: msg.autoDelete, deleteThreshold: msg.deleteThreshold });
    })();
  }

  else if (msg.action === 'ENRICH_RESULT') { sendResponse({ ok: true }); }
  else if (msg.action === 'KEEP_ALIVE') { sendResponse({ ok: true }); }

  return true;
});
