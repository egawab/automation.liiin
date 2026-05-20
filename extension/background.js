// background.js — Nexora Tab Scraper v4 (content.js injection)
// Navigates the tab, injects content.js which does the scroll/collect work,
// then receives FLUSH_POSTS and pushes to the DB.

console.log('[BG] Nexora Tab Scraper v4 loaded');

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

async function waitForTab(tabId, maxMs = 25000) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, maxMs);
    function fn(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(fn);
      clearTimeout(timer);
      setTimeout(resolve, 2500);
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

  const targetUrl = 'https://www.linkedin.com/search/results/content/?keywords='
    + encodeURIComponent(kw) + '&origin=GLOBAL_SEARCH_HEADER';

  console.log('[BG] Navigating to kw=' + kw);
  const myRunId = S.runId;

  try {
    await chrome.tabs.update(S.tabId, { url: targetUrl, active: true });
  } catch (_) {
    S.tabId = await resolveLinkedInTab();
    await chrome.tabs.update(S.tabId, { url: targetUrl, active: true });
  }

  await waitForTab(S.tabId, 25000);
  if (S.state !== 'RUNNING' || S.runId !== myRunId) return;

  // Stamp config into page so content.js can read it
  try {
    await chrome.scripting.executeScript({
      target: { tabId: S.tabId },
      func: (cfg) => { window.__nexoraCfg = cfg; },
      args: [{ runId: myRunId, keyword: kw }]
    });
    await new Promise(r => setTimeout(r, 200));
    // Inject the content script (does the scroll + collect + FLUSH_POSTS)
    await chrome.scripting.executeScript({ target: { tabId: S.tabId }, files: ['content.js'] });
    console.log('[BG] content.js injected for kw=' + kw);
  } catch (e) {
    console.warn('[BG] Inject failed:', e.message);
    advanceKeyword();
  }
  // content.js will send FLUSH_POSTS when done → handled in message listener
}

function advanceKeyword() {
  if (S.state !== 'RUNNING') return;
  S.kwIndex++;
  if (S.kwIndex >= S.keywords.length) {
    finalizeSession();
  } else {
    console.log('[BG] Advancing to kw=' + S.keywords[S.kwIndex]);
    setTimeout(() => { if (S.state === 'RUNNING') runKeyword().catch(e => console.error('[BG]', e.message)); }, 4000);
  }
}

function finalizeSession() {
  S.state = 'IDLE';
  console.log('[BG] All keywords done. totalSaved=' + S.totalSaved);
  broadcastStatus('Done! ' + S.totalSaved + ' posts saved.');
  setBadge(String(S.totalSaved), '#3b82f6');
}

// ── Broadcast / Badge ─────────────────────────────────────────────────────────
function broadcastStatus(msg) {
  chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', message: msg }).catch(() => {});
}
function setBadge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

// ── Messages ─────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'FLUSH_POSTS') {
    // content.js finished scrolling and collected posts
    const posts = msg.posts || [];
    const kw = msg.keyword || S.keywords[S.kwIndex] || '';
    console.log('[BG] FLUSH_POSTS count=' + posts.length + ' kw=' + kw);
    sendResponse({ ok: true });
    (async () => {
      if (posts.length > 0) {
        const saved = await pushToAPI(posts, kw);
        S.totalSaved += saved;
        console.log('[BG] Saved ' + saved + '/' + posts.length + ' kw=' + kw + ' total=' + S.totalSaved);
      } else {
        console.warn('[BG] kw=' + kw + ' found 0 posts');
      }
      setTimeout(() => advanceKeyword(), 3000);
    })();
    return true;
  }

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
    S.state = 'IDLE';
    if (S.tabId) {
      chrome.scripting.executeScript({
        target: { tabId: S.tabId },
        func: (key) => { window[key] = true; },
        args: ['__nexoraStop_' + S.runId]
      }).catch(() => {});
    }
    broadcastStatus('Stopped.');
    setBadge('', '#6b7280');
    sendResponse({ ok: true });
  }
  else if (msg.action === 'KEEP_ALIVE') { sendResponse({ ok: true }); }

  return true;
});
