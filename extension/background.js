// background.js — Nexora Tab Scraper v5
// Fix: runId-gated FLUSH_POSTS + forced reload to kill stale content scripts

console.log('[BG] Nexora Tab Scraper v5 loaded');

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

// ── Keep-alive ────────────────────────────────────────────────────────────────
chrome.alarms.create('nexora_hb', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'nexora_hb' && S.state === 'RUNNING')
    console.log('[BG] hb state=RUNNING kw=' + (S.keywords[S.kwIndex] || ''));
});

// ── Helpers ──────────────────────────────────────────────────────────────────
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

// ── Tab utilities ─────────────────────────────────────────────────────────────
async function resolveLinkedInTab() {
  const [t] = await chrome.tabs.query({ url: '*://*.linkedin.com/*', active: true });
  if (t) return t.id;
  const [t2] = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  if (t2) return t2.id;
  const t3 = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: true });
  await new Promise(r => setTimeout(r, 5000));
  return t3.id;
}

function waitForTabLoad(tabId, maxMs = 25000) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, maxMs);
    function fn(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(fn);
      clearTimeout(timer);
      setTimeout(resolve, 2500); // extra wait for React paint
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

// ── DB Push ──────────────────────────────────────────────────────────────────
async function pushToAPI(posts, kw) {
  if (!posts || posts.length === 0) return 0;
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
      console.warn('[BG] DB push HTTP ' + resp.status);
      return 0;
    }
    const data = await resp.json().catch(() => ({}));
    return typeof data.createdCount === 'number' ? data.createdCount : posts.length;
  } catch (e) {
    console.warn('[BG] DB push error:', e.message);
    return 0;
  }
}

// ── Keyword Fetch ──────────────────────────────────────────────────────────────
async function fetchKeywords(dashUrl, userId) {
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
}

// ── Run one keyword ───────────────────────────────────────────────────────────
async function runKeyword() {
  if (S.state !== 'RUNNING') return;
  const kw = S.keywords[S.kwIndex];
  if (!kw) { finalizeSession(); return; }

  const myRunId = S.runId;
  const targetUrl = 'https://www.linkedin.com/search/results/content/?keywords='
    + encodeURIComponent(kw) + '&origin=GLOBAL_SEARCH_HEADER';

  console.log('[BG] Navigating to kw=' + kw);

  // ── Force full reload to kill any stale content.js from previous runs ──────
  try {
    await chrome.tabs.update(S.tabId, { url: targetUrl, active: true });
  } catch (_) {
    S.tabId = await resolveLinkedInTab();
    await chrome.tabs.update(S.tabId, { url: targetUrl, active: true });
  }
  await waitForTabLoad(S.tabId, 25000);

  if (S.state !== 'RUNNING' || S.runId !== myRunId) return;

  // ── Stamp config ─────────────────────────────────────────────────────────────
  try {
    await chrome.scripting.executeScript({
      target: { tabId: S.tabId },
      func: (cfg) => { window.__nexoraCfg = cfg; console.log('[CS] Config stamped:', cfg.runId); },
      args: [{ runId: myRunId, keyword: kw }]
    });
  } catch (e) {
    console.warn('[BG] Config stamp failed:', e.message);
    advanceKeyword();
    return;
  }

  // ── Wait for FLUSH_POSTS with THIS runId (one-shot listener, 50s timeout) ──
  const posts = await new Promise((resolve) => {
    const TIMEOUT_MS = 50000; // 12 steps × 2s + 2.5s initial + buffer
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; chrome.runtime.onMessage.removeListener(listener); resolve([]); }
    }, TIMEOUT_MS);

    function listener(msg, _sender, sendResponse) {
      if (msg.action !== 'FLUSH_POSTS') return false;
      if (msg.runId !== myRunId) {
        // Stale message from a previous content.js — ignore silently
        console.warn('[BG] Stale FLUSH_POSTS ignored (runId mismatch)');
        sendResponse({ ok: false, reason: 'stale' });
        return true;
      }
      if (!done) {
        done = true;
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        sendResponse({ ok: true });
        resolve(msg.posts || []);
      }
      return true;
    }

    chrome.runtime.onMessage.addListener(listener);

    // Inject content.js NOW (after listener is set up so we can't miss the message)
    chrome.scripting.executeScript({ target: { tabId: S.tabId }, files: ['content.js'] })
      .then(() => console.log('[BG] content.js injected for kw=' + kw))
      .catch(e => {
        console.warn('[BG] Inject failed:', e.message);
        if (!done) { done = true; clearTimeout(timer); chrome.runtime.onMessage.removeListener(listener); resolve([]); }
      });
  });

  if (S.state !== 'RUNNING' || S.runId !== myRunId) return;

  console.log('[BG] kw=' + kw + ' found ' + posts.length + ' posts');
  if (posts.length > 0) {
    const saved = await pushToAPI(posts, kw);
    S.totalSaved += saved;
    console.log('[BG] Saved ' + saved + '/' + posts.length + ' kw=' + kw + ' total=' + S.totalSaved);
  }

  advanceKeyword();
}

function advanceKeyword() {
  if (S.state !== 'RUNNING') return;
  S.kwIndex++;
  if (S.kwIndex >= S.keywords.length) {
    finalizeSession();
  } else {
    console.log('[BG] Next keyword: ' + S.keywords[S.kwIndex]);
    setTimeout(() => { if (S.state === 'RUNNING') runKeyword().catch(e => console.error('[BG]', e.message)); }, 3000);
  }
}

function finalizeSession() {
  S.state = 'IDLE';
  console.log('[BG] All keywords done. totalSaved=' + S.totalSaved);
  broadcastStatus('Done! ' + S.totalSaved + ' posts saved.');
  setBadge(String(S.totalSaved), '#3b82f6');
}

function broadcastStatus(msg) {
  chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', message: msg }).catch(() => {});
}
function setBadge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

// ── Messages ─────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'GET_STATUS' || msg.action === 'PING') {
    sendResponse({ running: S.state === 'RUNNING', state: S.state, runId: S.runId, totalSaved: S.totalSaved, keyword: S.keywords[S.kwIndex] || null });
  }
  else if (msg.action === 'START_ENGINE' || msg.action === 'START_SESSION') {
    if (S.state === 'RUNNING') { sendResponse({ ok: false, reason: 'already_running' }); return true; }
    sendResponse({ ok: true });
    (async () => {
      try {
        S.state = 'RUNNING';
        S.runId = Date.now();
        S.kwIndex = 0;
        S.totalSaved = 0;
        S.dashboardUrl = msg.dashboardUrl || msg.cfg?.dashboardUrl;
        S.userId = msg.userId || msg.cfg?.userId;
        S.keywords = await fetchKeywords(S.dashboardUrl, S.userId);
        console.log('[BG] RUNNING. keywords=' + JSON.stringify(S.keywords));
        S.tabId = await resolveLinkedInTab();
        await runKeyword();
      } catch (e) {
        console.error('[BG] Engine crash:', e.message);
        S.state = 'IDLE';
        broadcastStatus('Error: ' + e.message);
      }
    })();
  }
  else if (msg.action === 'STOP_ENGINE' || msg.action === 'STOP_SESSION') {
    const oldRunId = S.runId;
    S.runId = Date.now(); // invalidate any pending FLUSH_POSTS
    S.state = 'IDLE';
    if (S.tabId) {
      chrome.scripting.executeScript({
        target: { tabId: S.tabId },
        func: (key) => { window[key] = true; },
        args: ['__nexoraStop_' + oldRunId]
      }).catch(() => {});
    }
    broadcastStatus('Stopped.');
    setBadge('', '#6b7280');
    sendResponse({ ok: true });
  }
  else if (msg.action === 'KEEP_ALIVE') { sendResponse({ ok: true }); }
  else if (msg.action === 'FLUSH_POSTS') {
    // Only reached if no keyword-specific listener is active (e.g. very stale message)
    console.warn('[BG] Orphan FLUSH_POSTS ignored (no active listener), runId=' + msg.runId);
    sendResponse({ ok: false, reason: 'no_listener' });
  }

  return true;
});
