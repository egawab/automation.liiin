// background.js — Nexora URL Collector Relay
// Single responsibility: find LinkedIn tab → navigate → inject content.js → relay FLUSH_POSTS to API.
// No comment mode. No multi-tab. No cron jobs. Just URL collection.
console.log('[BG] Nexora URL Collector loaded');

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  state:      'IDLE',   // IDLE | STARTING | RUNNING | DONE
  tabId:      null,
  runId:      0,
  totalSaved: 0,
  dashboardUrl: '',
  userId:     '',
  keywords:   [],
  kwIndex:    0,
};

// ── Keep-alive ────────────────────────────────────────────────────────────────
chrome.alarms.create('nexora_hb', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'nexora_hb' && (S.state === 'RUNNING' || S.state === 'STARTING'))
    console.log('[BG] hb state=' + S.state + ' kw=' + (S.keywords[S.kwIndex] || ''));
});

// ── Messages ──────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.action === 'START_ENGINE') {
    if (S.state === 'STARTING' || S.state === 'RUNNING') {
      sendResponse({ ok: false, reason: 'already_running' });
      return false;
    }
    (async () => {
      try {
        await startSession(msg);
        sendResponse({ ok: true });
      } catch (e) {
        console.error('[BG] START_ENGINE error:', e.message);
        S.state = 'IDLE';
        broadcastStatus('Error: ' + e.message);
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.action === 'STOP_ENGINE') {
    stopSession('user_stop').finally(() => sendResponse({ ok: true }));
    return true;
  }

  // content.js signals done
  if (msg.action === 'FLUSH_POSTS') {
    const msgRunId = msg.runId;
    if (S.state !== 'RUNNING') {
      sendResponse({ ok: false, reason: 'not_running' });
      return false;
    }
    if (msgRunId !== undefined && msgRunId !== S.runId) {
      sendResponse({ ok: false, reason: 'stale_runid' });
      return false;
    }
    (async () => {
      const posts = msg.posts || [];
      console.log('[BG] FLUSH_POSTS count=' + posts.length + ' kw=' + (S.keywords[S.kwIndex] || ''));
      try { await pushToAPI(posts); } catch (e) { console.warn('[BG] API flush failed:', e.message); }
      sendResponse({ ok: true });
      advanceKeyword();
    })();
    return true;
  }

  if (msg.action === 'GET_STATUS') {
    sendResponse({ running: S.state !== 'IDLE' && S.state !== 'DONE', state: S.state, totalSaved: S.totalSaved, keyword: S.keywords[S.kwIndex] || null });
    return false;
  }

  if (msg.action === 'KEEP_ALIVE') { sendResponse({ ok: true }); return false; }
});

// ── Session lifecycle ─────────────────────────────────────────────────────────
async function startSession(msg) {
  S.state = 'STARTING';
  S.runId++;
  S.totalSaved = 0;
  S.kwIndex = 0;
  console.log('[BG] startSession BEGIN runId=' + S.runId);

  const cfg = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
  S.dashboardUrl = msg.dashboardUrl || cfg.dashboardUrl || '';
  S.userId       = msg.userId       || cfg.userId       || '';
  if (!S.dashboardUrl || !S.userId) throw new Error('Not configured — connect via popup first.');

  S.keywords = await fetchKeywords(S.dashboardUrl, S.userId);
  if (!S.keywords.length) throw new Error('No keywords configured.');

  S.tabId = await resolveLinkedInTab();
  S.state = 'RUNNING';
  broadcastStatus('Starting: ' + S.keywords[0]);
  console.log('[BG] RUNNING. keywords=' + JSON.stringify(S.keywords));
  await runKeyword();
}

async function stopSession(reason) {
  console.warn('[BG] stopSession reason=' + reason);
  S.runId++;
  S.state = 'IDLE';
  broadcastStatus('Stopped (' + reason + ')');
  setBadge('', '#6b7280');
}

// ── Keyword loop ──────────────────────────────────────────────────────────────
async function runKeyword() {
  if (S.state !== 'RUNNING') return;
  const kw = S.keywords[S.kwIndex];
  if (!kw) { finalizeSession(); return; }

  const url = 'https://www.linkedin.com/search/results/content/?keywords='
    + encodeURIComponent(kw) + '&origin=GLOBAL_SEARCH_HEADER';

  const myRunId = S.runId;

  try {
    await chrome.tabs.update(S.tabId, { url, active: true });
  } catch (e) {
    try {
      S.tabId = await resolveLinkedInTab();
      await chrome.tabs.update(S.tabId, { url, active: true });
    } catch (e2) {
      console.error('[BG] Cannot get LinkedIn tab:', e2.message);
      await stopSession('no_tab');
      return;
    }
  }

  await waitForTabLoad(S.tabId);
  if (S.state !== 'RUNNING' || S.runId !== myRunId) return;

  broadcastStatus('Collecting URLs for: ' + kw);
  setBadge('ON', '#10b981');

  // Stamp config then inject URL collector
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Step 1: stamp the config into the page context
      await chrome.scripting.executeScript({
        target: { tabId: S.tabId },
        func: (cfg) => {
          // Only set __nexoraCfg — never touch __nexoraActive_* (owned by content.js)
          window.__nexoraCfg = cfg;
          console.log('[BG-inject] __nexoraCfg stamped. runId=' + cfg.runId + ' kw=' + cfg.keyword);
        },
        args: [{ runId: myRunId, keyword: kw, kwIndex: S.kwIndex, totalKeywords: S.keywords.length, searchOnlyMode: true }],
      });

      // Step 2: small pause to ensure the stamp is committed before content.js reads it
      await new Promise(r => setTimeout(r, 300));

      // Step 3: inject the collector script
      await chrome.scripting.executeScript({ target: { tabId: S.tabId }, files: ['content.js'] });
      console.log('[BG] content.js injected for kw=' + kw + ' (attempt ' + attempt + ')');
      return; // content.js takes over; sends FLUSH_POSTS when done
    } catch (e) {
      console.warn('[BG] Inject attempt ' + attempt + ' failed:', e.message);
      if (e.message.includes('Extension context invalidated')) return;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.error('[BG] All inject attempts failed. Advancing.');
  advanceKeyword();
}

function advanceKeyword() {
  if (S.state !== 'RUNNING') return;
  S.kwIndex++;
  if (S.kwIndex >= S.keywords.length) {
    finalizeSession();
  } else {
    console.log('[BG] Advancing to keyword index=' + S.kwIndex + ' kw=' + S.keywords[S.kwIndex]);
    // Short pause between keywords
    setTimeout(() => {
      if (S.state === 'RUNNING') runKeyword().catch(e => console.error('[BG] runKeyword:', e.message));
    }, 4000);
  }
}

function finalizeSession() {
  S.state = 'DONE';
  console.log('[BG] All keywords done. totalSaved=' + S.totalSaved);
  chrome.runtime.sendMessage({ action: 'SCRAPER_COMPLETE', totalSaved: S.totalSaved }).catch(() => {});
  broadcastStatus('Done! ' + S.totalSaved + ' URLs saved.');
  setBadge(String(S.totalSaved), '#3b82f6');
  S.state = 'IDLE';
}

// ── API push ──────────────────────────────────────────────────────────────────
async function pushToAPI(posts) {
  if (!posts.length) return;
  const kw = S.keywords[S.kwIndex] || '';
  const endpoint = S.dashboardUrl + '/api/extension/results';

  console.log('[BG] pushToAPI count=' + posts.length + ' source=search_only kw=' + kw);

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': S.userId },
      body: JSON.stringify({ posts, keyword: kw, source: 'search_only' }),
    });
  } catch (netErr) {
    await new Promise(r => setTimeout(r, 3000));
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': S.userId },
      body: JSON.stringify({ posts, keyword: kw, source: 'search_only' }),
    });
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error('HTTP ' + resp.status + ': ' + body.substring(0, 200));
  }

  const data = await resp.json().catch(() => ({}));
  const saved = data.createdCount ?? data.savedCount ?? posts.length;
  S.totalSaved += saved;
  console.log('[BG] Saved ' + saved + '/' + posts.length + ' total=' + S.totalSaved);
  broadcastStatus('Saved ' + S.totalSaved + ' URLs');
  setBadge(String(S.totalSaved), '#10b981');
}

// ── Keywords fetch ────────────────────────────────────────────────────────────
async function fetchKeywords(dashUrl, userId) {
  const resp = await fetch(dashUrl + '/api/extension/jobs', { headers: { 'x-extension-token': userId } });
  if (!resp.ok) throw new Error('Jobs API ' + resp.status);
  const jobs = await resp.json();
  if (!jobs.active) throw new Error(jobs.message || 'System inactive.');

  let kws = [];
  // Search-Only config (primary)
  if (jobs.settings?.searchConfigJson) {
    try {
      const cfg = JSON.parse(jobs.settings.searchConfigJson);
      if (Array.isArray(cfg))
        kws.push(...cfg.flat().filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()));
    } catch (_) {}
  }
  // Fall back to keyword campaigns
  if (kws.length === 0 && Array.isArray(jobs.keywords)) {
    kws.push(...jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean));
  }
  if (kws.length === 0) throw new Error('No keywords configured.');
  return [...new Set(kws)];
}

// ── Tab utilities ─────────────────────────────────────────────────────────────
async function resolveLinkedInTab() {
  // Prefer the currently focused LinkedIn tab
  const wins = await chrome.windows.getAll({ populate: false });
  const fw = wins.find(w => w.focused);
  if (fw) {
    const [t] = await chrome.tabs.query({ active: true, windowId: fw.id, url: '*://*.linkedin.com/*' });
    if (t) return t.id;
  }
  const [t2] = await chrome.tabs.query({ active: true, url: '*://*.linkedin.com/*' });
  if (t2) return t2.id;
  const [t3] = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  if (t3) return t3.id;
  // Last resort: open a new LinkedIn tab
  const t4 = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: true });
  await waitForTabLoad(t4.id, 15000);
  return t4.id;
}

function waitForTabLoad(tabId, maxMs = 25000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, maxMs);
    function fn(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(fn);
      clearTimeout(timer);
      setTimeout(resolve, 3000); // let page JS settle
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId !== S.tabId) return;
  if (S.state === 'RUNNING' || S.state === 'STARTING') {
    console.warn('[BG] LinkedIn tab closed during session');
    stopSession('tab_closed');
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function broadcastStatus(text) {
  chrome.runtime.sendMessage({ action: 'EXTENSION_LIVE_STATUS', text }).catch(() => {});
}
function setBadge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}
