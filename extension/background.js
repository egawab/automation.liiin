// background.js — Nexora v8.1 (Session Lock + Trace)
// Responsibilities: START/STOP, tab navigation, script injection, API flush.
// Scraping logic (scroll, DOM, network, reconciliation) lives entirely in content.js.
console.log('[BG] Nexora v8.1 loaded');

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  state: 'IDLE',      // IDLE | STARTING | RUNNING | WAITING | DONE
  tabId: null,
  runId: 0,           // incremented each session; content.js checks this to self-abort
  totalSaved: 0,
  dashboardUrl: '',
  userId: '',
  keywords: [],
  kwIndex: 0,
  jobsData: null,
  cycleIndex: 0,
  commentedUrns: [],
  totalCommentsPosted: 0,
};
// NOTE: STARTING is a new intermediate state that blocks duplicate STARTs during
// the async setup phase (fetchKeywords, resolveLinkedInTab). This closes the
// race window where a second START arrived before S.state became 'RUNNING'.

// ── Keep-alive (service worker won't go idle during a session) ────────────────
chrome.alarms.create('nexora_hb', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'nexora_hb') {
    if (S.state === 'RUNNING' || S.state === 'STARTING' || S.state === 'WAITING')
      console.log('[BG] hb state=' + S.state + ' saved=' + S.totalSaved + ' kw=' + (S.keywords[S.kwIndex] || ''));
  } else if (alarm.name.startsWith('nexora_cycle_')) {
    const rId = parseInt(alarm.name.split('_').pop(), 10);
    if (rId === S.runId && S.state === 'WAITING') {
      S.state = 'RUNNING';
      console.log('[BG] Waking up from cycle wait for runId=' + rId);
      runKeyword().catch(e => console.error('[BG] runKeyword post-alarm:', e.message));
    }
  }
});

// ── Single message handler ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.action === 'START_ENGINE') {
    // ── HARD SESSION LOCK ──────────────────────────────────────────────────────
    // If already starting or running, refuse entirely. Do NOT call stopSession().
    // This prevents dashboard + popup firing simultaneously from cascading.
    if (S.state === 'STARTING' || S.state === 'RUNNING') {
      console.warn('[LOCK] Ignoring duplicate START_ENGINE — state=' + S.state
        + ' runId=' + S.runId + ' kw=' + (S.keywords[S.kwIndex] || ''));
      sendResponse({ ok: false, reason: 'already_running' });
      return false;
    }
    (async () => {
      try {
        await startSession(msg);
        sendResponse({ ok: true });
      } catch (e) {
        console.error('[BG] START_ENGINE fatal:', e.message);
        S.state = 'IDLE';  // reset from STARTING if setup threw
        broadcastStatus('ERR: ' + e.message);
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.action === 'STOP_ENGINE') {
    stopSession('user_stop').finally(() => sendResponse({ ok: true }));
    return true;
  }

  // content.js sends this when scroll + extraction is complete for one keyword.
  // GUARD: validate runId to reject stale content.js from a previous session.
  if (msg.action === 'FLUSH_POSTS') {
    const msgRunId = msg.runId;
    if (S.state !== 'RUNNING') {
      console.warn('[LOCK] FLUSH_POSTS ignored — state=' + S.state + ' (session not running)');
      sendResponse({ ok: false, reason: 'not_running' });
      return false;
    }
    if (msgRunId !== undefined && msgRunId !== S.runId) {
      console.warn('[LOCK] FLUSH_POSTS ignored — stale runId=' + msgRunId + ' current=' + S.runId);
      sendResponse({ ok: false, reason: 'stale_runid' });
      return false;
    }
    (async () => {
      const posts = msg.posts || [];
      const newCommented = msg.commentedUrns || [];
      if (newCommented.length) {
        S.commentedUrns.push(...newCommented);
        S.totalCommentsPosted += newCommented.length;
      }
      console.log('[BG] FLUSH_POSTS count=' + posts.length + ' comments=' + newCommented.length + ' kw=' + (S.keywords[S.kwIndex] || '') + ' runId=' + S.runId);
      try { await pushToAPI(posts); } catch (e) { console.warn('[BG] API flush failed:', e.message); }
      sendResponse({ ok: true });
      advanceCycleOrKeyword();
    })();
    return true;
  }

  if (msg.action === 'GET_STATUS') {
    sendResponse({
      running: ['RUNNING', 'STARTING', 'WAITING'].includes(S.state),
      state: S.state,
      totalSaved: S.totalSaved,
      keyword: S.keywords[S.kwIndex] || null,
      cycleIndex: S.cycleIndex,
      targetCycles: S.jobsData?.keywords?.find(k => k.keyword === S.keywords[S.kwIndex])?.targetCycles || 1,
      totalCommentsPosted: S.totalCommentsPosted,
    });
    return false;
  }

  if (msg.action === 'KEEP_ALIVE') { sendResponse({ ok: true }); return false; }
});

// ── Session lifecycle ─────────────────────────────────────────────────────────
async function startSession(msg) {
  // Immediately claim the lock with STARTING — blocks any concurrent START
  S.state = 'STARTING';
  S.runId++;
  S.totalSaved = 0;
  S.kwIndex = 0;
  S.cycleIndex = 0;
  S.commentedUrns = [];
  S.totalCommentsPosted = 0;
  console.log('[BG] startSession BEGIN runId=' + S.runId);

  const cfg = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
  S.dashboardUrl = msg.dashboardUrl || cfg.dashboardUrl || '';
  S.userId       = msg.userId       || cfg.userId       || '';
  if (!S.dashboardUrl || !S.userId) throw new Error('Not configured — set Dashboard URL and User ID first.');

  S.keywords = await fetchKeywords(S.dashboardUrl, S.userId);
  if (!S.keywords.length) throw new Error('No keywords configured.');

  S.tabId = await resolveLinkedInTab();
  S.state = 'RUNNING';
  broadcastStatus('Starting: ' + S.keywords[0]);
  console.log('[BG] startSession RUNNING runId=' + S.runId + ' keywords=' + JSON.stringify(S.keywords));
  await runKeyword();
}

async function stopSession(reason) {
  reason = reason || 'unknown';
  console.warn('[BG] stopSession reason=' + reason + ' state=' + S.state + ' runId=' + S.runId);
  console.trace('[TRACE] stopSession called');      // temporary — identifies caller
  S.runId++;          // invalidates any in-flight content.js
  S.state = 'IDLE';
  broadcastStatus('Stopped (' + reason + ')');
  setBadge('', '#6b7280');
}

// ── Keyword loop ──────────────────────────────────────────────────────────────
async function runKeyword() {
  if (S.state !== 'RUNNING') {
    console.warn('[BG] runKeyword aborted — state=' + S.state);
    return;
  }
  const kw = S.keywords[S.kwIndex];
  if (!kw) { finalizeSession(); return; }

  console.log('[BG] runKeyword index=' + S.kwIndex + ' kw=' + kw + ' runId=' + S.runId);
  const url = 'https://www.linkedin.com/search/results/content/?keywords='
    + encodeURIComponent(kw) + '&origin=GLOBAL_SEARCH_HEADER';

  // Capture the runId at this moment; check it before every async step
  const myRunId = S.runId;

  try {
    await chrome.tabs.update(S.tabId, { url, active: true });
  } catch (e) {
    console.warn('[BG] tabs.update failed:', e.message);
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

  // Check if session was stopped or superseded during the tab load
  if (S.state !== 'RUNNING' || S.runId !== myRunId) {
    console.warn('[BG] runKeyword: session changed during tab load — aborting kw=' + kw);
    return;
  }

  broadcastStatus('Scraping: ' + kw);
  setBadge('ON', '#10b981');

  // Step 1: stamp runId + config into the page and inject content.js
  let injected = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const kwObj = S.jobsData?.keywords?.find(k => k.keyword === kw);
      const targetCycles = kwObj?.targetCycles || 1;
      const cycleComments = kwObj ? (S.jobsData?.comments || []).filter(c => c.keywordId === kwObj.id && c.cycleIndex === (S.cycleIndex + 1)) : [];
      
      await chrome.scripting.executeScript({
        target: { tabId: S.tabId },
        func: (cfg) => { window.__nexoraCfg = cfg; },
        args: [{ 
          runId: myRunId, 
          keyword: kw, 
          kwIndex: S.kwIndex, 
          totalKeywords: S.keywords.length,
          cycleIndex: S.cycleIndex,
          targetCycles: targetCycles,
          cycleComments: cycleComments,
          commentedUrns: S.commentedUrns,
          searchOnlyMode: S.jobsData?.settings?.searchOnlyMode ?? true,
        }],
      });

      await chrome.scripting.executeScript({ target: { tabId: S.tabId }, files: ['content.js'] });
      console.log(`[BG] content.js injected kw=${kw} runId=${myRunId} (attempt ${attempt})`);
      injected = true;
      break;
    } catch (e) {
      console.warn(`[BG] script inject failed attempt ${attempt}:`, e.message);
      if (e.message.includes('Extension context invalidated')) return; // Unrecoverable
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!injected) {
    console.error('[BG] Failed to inject scripts after 3 attempts.');
    advanceCycleOrKeyword();
  }
  // content.js now drives itself; sends FLUSH_POSTS(runId) when done.
}

function advanceCycleOrKeyword() {
  if (S.state !== 'RUNNING') {
    console.warn('[BG] advanceCycleOrKeyword skipped — state=' + S.state);
    return;
  }
  const kw = S.keywords[S.kwIndex];
  const kwObj = S.jobsData?.keywords?.find(k => k.keyword === kw);
  const targetCycles = kwObj?.targetCycles || 1;

  S.cycleIndex++;
  if (S.cycleIndex >= targetCycles) {
    S.kwIndex++;
    S.cycleIndex = 0;
    if (S.kwIndex >= S.keywords.length) {
      finalizeSession();
    } else {
      console.log('[BG] advancing to keyword index=' + S.kwIndex + ' kw=' + S.keywords[S.kwIndex]);
      setTimeout(() => {
        if (S.state === 'RUNNING') runKeyword().catch(e => console.error('[BG] runKeyword:', e.message));
      }, 4000);
    }
  } else {
    console.log(`[BG] advancing to cycle ${S.cycleIndex+1}/${targetCycles} for keyword ${kw}`);
    S.state = 'WAITING';
    broadcastStatus(`Waiting 15m for next cycle...`);
    chrome.alarms.create('nexora_cycle_' + S.runId, { delayInMinutes: 15 });
  }
}

function finalizeSession() {
  S.state = 'DONE';
  console.log('[BG] Session complete totalSaved=' + S.totalSaved);
  chrome.runtime.sendMessage({ action: 'SCRAPER_COMPLETE', totalSaved: S.totalSaved }).catch(() => {});
  broadcastStatus('Done! ' + S.totalSaved + ' posts saved.');
  setBadge(String(S.totalSaved), '#3b82f6');
  S.state = 'IDLE';
}

// ── API Flush ─────────────────────────────────────────────────────────────────
async function pushToAPI(posts) {
  if (!posts.length) return;
  const kw = S.keywords[S.kwIndex] || '';
  const endpoint = S.dashboardUrl + '/api/extension/results';

  // Detect if this is a search-only batch
  const source = (posts[0]?.source === 'search_only') ? 'search_only' : 'nexora_v8';
  console.log('[BG] pushToAPI count=' + posts.length + ' source=' + source);

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': S.userId },
      body: JSON.stringify({ posts, keyword: kw, source }),
    });
  } catch (netErr) {
    // One retry after 3s
    await new Promise(r => setTimeout(r, 3000));
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': S.userId },
      body: JSON.stringify({ posts, keyword: kw, source }),
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
  broadcastStatus('Saved ' + S.totalSaved + ' posts');
  setBadge(String(S.totalSaved), '#10b981');
}

// ── Keyword fetcher ───────────────────────────────────────────────────────────
async function fetchKeywords(dashUrl, userId) {
  const resp = await fetch(dashUrl + '/api/extension/jobs', { headers: { 'x-extension-token': userId } });
  if (!resp.ok) throw new Error('Jobs API ' + resp.status);
  const jobs = await resp.json();
  if (!jobs.active) throw new Error(jobs.message || 'System inactive.');
  
  S.jobsData = jobs;
  
  let kws = [];
  const searchOnly = jobs.settings?.searchOnlyMode !== false;

  if (searchOnly && jobs.settings?.searchConfigJson) {
    try {
      const cfg = JSON.parse(jobs.settings.searchConfigJson);
      if (Array.isArray(cfg)) kws.push(...cfg.flat().filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()));
    } catch (_) {}
  }
  
  if (!searchOnly || kws.length === 0) {
    if (Array.isArray(jobs.keywords)) kws.push(...jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean));
  }
  
  if (kws.length === 0) throw new Error('No keywords configured.');
  return [...new Set(kws)];
}

// ── Tab utilities ─────────────────────────────────────────────────────────────
async function resolveLinkedInTab() {
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
      setTimeout(resolve, 3000);  // let page JS settle before injecting
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

// ── Broadcast helpers ─────────────────────────────────────────────────────────
function broadcastStatus(text) {
  chrome.runtime.sendMessage({ action: 'EXTENSION_LIVE_STATUS', text }).catch(() => {});
}
function setBadge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}
