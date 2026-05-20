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
  
  if (msg.action === 'DEBUG_LOG') {
    console.warn(msg.msg);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === 'KEEP_ALIVE') { sendResponse({ ok: true }); return false; }

  // ── RE_ENRICH: score individual post pages — separate from scraping pipeline ──
  if (msg.action === 'RE_ENRICH') {
    sendResponse({ ok: true, queued: (msg.posts || []).length });
    startEnrichSession(msg.posts || [], msg.dashboardUrl || S.dashboardUrl, msg.userId || S.userId, {
      autoDelete: msg.autoDelete,
      deleteThreshold: msg.deleteThreshold,
      currentKeyword: msg.currentKeyword
    });
    return false;
  }

  // Dashboard polls this for live progress (push via sendMessage is unreliable in MV3)
  if (msg.action === 'GET_ENRICH_STATUS') {
    sendResponse({
      running:        E.running,
      done:           E.progress?.done          || 0,
      total:          E.progress?.total         || 0,
      enriched:       E.progress?.enriched      || 0,
      failed:         E.progress?.failed        || 0,
      deleted:        E.progress?.deleted       || 0,
      nullCount:      E.progress?.nullCount     || 0,
      currentKeyword: E.progress?.currentKeyword || '',
    });
    return false;
  }

  // ENRICH_RESULT is handled inside enrichSinglePost() via a one-shot listener.
  if (msg.action === 'ENRICH_RESULT') { sendResponse({ ok: true }); return false; }
});

// ── Session lifecycle ─────────────────────────────────────────────────────────
async function startSession(msg) {
  S.state = 'STARTING';
  S.runId = Date.now(); // Always use a globally unique timestamp runId to avoid collisions across starts
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
  const oldRunId = S.runId;
  S.runId = Date.now();
  S.state = 'IDLE';
  broadcastStatus('Stopped (' + reason + ')');
  setBadge('', '#6b7280');
  // Signal any running content.js to stop immediately
  if (S.tabId) {
    chrome.scripting.executeScript({
      target: { tabId: S.tabId },
      func: (key) => { window[key] = true; },
      args: ['__nexoraStop_' + oldRunId],
    }).catch(() => {});
  }
}

// ── Keyword loop ──────────────────────────────────────────────────────────────
async function runKeyword() {
  if (S.state !== 'RUNNING') return;
  const kw = S.keywords[S.kwIndex];
  if (!kw) { finalizeSession(); return; }

  const targetUrl = 'https://www.linkedin.com/search/results/content/?keywords='
    + encodeURIComponent(kw) + '&origin=GLOBAL_SEARCH_HEADER';

  const myRunId = S.runId;

  // ── Navigate to the search URL ─────────────────────────────────────────────
  for (let navAttempt = 1; navAttempt <= 2; navAttempt++) {
    try {
      await chrome.tabs.update(S.tabId, { url: targetUrl, active: true });
      break;
    } catch (e) {
      console.warn('[BG] Tab update failed (attempt ' + navAttempt + '):', e.message);
      try {
        S.tabId = await resolveLinkedInTab();
        await chrome.tabs.update(S.tabId, { url: targetUrl, active: true });
        break;
      } catch (e2) {
        if (navAttempt === 2) {
          console.error('[BG] Cannot navigate LinkedIn tab:', e2.message);
          await stopSession('no_tab');
          return;
        }
      }
    }
  }

  // ── Wait for tab to finish loading the SEARCH page (not a redirect) ────────
  const finalUrl = await waitForSearchPage(S.tabId, targetUrl, 30000);
  console.log('[BG] Tab settled at:', finalUrl);

  if (S.state !== 'RUNNING' || S.runId !== myRunId) return;

  // ── Abort if LinkedIn redirected to login / checkpoint / feed ───────────────
  if (!finalUrl || !finalUrl.includes('/search/results/')) {
    const isLoginWall = finalUrl?.includes('/login') || finalUrl?.includes('/checkpoint') || finalUrl?.includes('/authwall');
    if (isLoginWall) {
      console.warn('[BG] LinkedIn is showing login/checkpoint for this account. Session may have expired.');
      broadcastStatus('⚠️ LinkedIn login required — please log in then retry.');
      await stopSession('login_wall');
      return;
    }
    // Non-search page (e.g., feed, profile) — wait a bit more and try again
    console.warn('[BG] Tab did not reach search page. Got:', finalUrl, '— waiting 5s and retrying inject.');
    await new Promise(r => setTimeout(r, 5000));
    if (S.state !== 'RUNNING' || S.runId !== myRunId) return;
  }

  broadcastStatus('Collecting URLs for: ' + kw);
  setBadge('ON', '#10b981');

  // Stamp config then inject URL collector
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Step 0: inject the network interceptor so it can capture scroll-triggered API calls
      await chrome.scripting.executeScript({ target: { tabId: S.tabId }, files: ['interceptor.js'] });

      // Step 1: stamp the config into the page context
      await chrome.scripting.executeScript({
        target: { tabId: S.tabId },
        func: (cfg) => {
          window.__nexoraCfg = cfg;
          window.__nexoraApiUrns = window.__nexoraApiUrns || new Set();
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

  // Check if auto-enrich is enabled
  chrome.storage.sync.get(['autoEnrich', 'dashboardUrl', 'userId', 'autoDelete', 'deleteThreshold'], (cfg) => {
    if (cfg.autoEnrich) {
      console.log('[BG] Auto-enrich enabled. Waiting 5s before starting...');
      setTimeout(() => {
        if (S.state === 'IDLE') { // Safe gate
          runAutoEnrich(cfg.dashboardUrl || S.dashboardUrl, cfg.userId || S.userId, {
            autoDelete: cfg.autoDelete,
            deleteThreshold: cfg.deleteThreshold
          });
        }
      }, 5000);
    }
  });
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

// waitForSearchPage: waits until the tab is 'complete' AND the URL looks like
// the expected search page. Handles LinkedIn SPA redirects by waiting for the
// URL to stabilise rather than just the first 'complete' event.
async function waitForSearchPage(tabId, expectedUrl, maxMs = 30000) {
  const deadline = Date.now() + maxMs;
  let lastUrl = '';

  // First, wait for the tab to reach 'complete' status
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(fn);
      resolve();
    }, Math.min(maxMs, 20000));

    function fn(id, info) {
      if (id !== tabId) return;
      if (info.url) lastUrl = info.url; // track every URL change
      if (info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(fn);
      clearTimeout(timer);
      setTimeout(resolve, 2500); // let React router finish
    }
    chrome.tabs.onUpdated.addListener(fn);
  });

  // Now poll the actual tab URL until it contains '/search/results/' or deadline
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url || '';
      if (url.includes('/search/results/')) return url;
      // If on login/checkpoint, return immediately so caller can abort
      if (url.includes('/login') || url.includes('/checkpoint') || url.includes('/authwall')) return url;
      // Still loading or redirecting — wait and poll again
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      return lastUrl; // tab may have closed
    }
  }

  // Timeout — return whatever URL the tab is at now
  try { const tab = await chrome.tabs.get(tabId); return tab.url || ''; } catch { return lastUrl; }
}

function waitForTabLoad(tabId, maxMs = 25000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, maxMs);
    function fn(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(fn);
      clearTimeout(timer);
      setTimeout(resolve, 2500);
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

chrome.tabs.onUpdated.addListener((tabId, info) => {
  // Detect if the active LinkedIn tab gets redirected to login mid-session
  if (tabId !== S.tabId || S.state !== 'RUNNING') return;
  const url = info.url || '';
  if (url && (url.includes('/login') || url.includes('/authwall') || url.includes('/checkpoint'))) {
    console.warn('[BG] LinkedIn session expired mid-run. Stopping.');
    broadcastStatus('⚠️ LinkedIn session expired — please log in and restart.');
    stopSession('session_expired');
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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── RE_ENRICH: post-by-post enrichment (completely separate from scraping) ──────
// E.progress is polled by the dashboard via GET_ENRICH_STATUS every 1.5s.
// Push-based sendMessage is unreliable from MV3 service worker to content scripts.
const E = { running: false, progress: null };

async function startEnrichSession(posts, dashboardUrl, userId, opts = {}) {
  if (E.running) {
    console.warn('[BG-ENRICH] Already running, ignoring duplicate request.');
    return;
  }
  E.running = true;
  E.progress = null;
  E.dashUrl  = dashboardUrl;
  E.userId   = userId;

  const { autoDelete = false, deleteThreshold = 10, currentKeyword = 'Multiple' } = opts;

  const total = posts.length;
  let enriched = 0, failed = 0, deleted = 0, nullCount = 0;
  console.log(`[BG-ENRICH] Starting enrichment for ${total} posts. Keyword: ${currentKeyword}`);
  broadcastStatus('Enriching 0/' + total + ' posts...');
  setBadge('...', '#f59e0b');

  // Write initial progress so first poll reflects correct total
  E.progress = { done: 0, total, enriched: 0, failed: 0, deleted: 0, nullCount: 0, currentKeyword };

  for (const post of posts) {
    if (!post.url || !post.urn) { failed++; continue; }

    try {
      const score = await enrichSinglePost(post.url, post.urn);
      if (score !== null) {
        await pushEnrichScore(post.urn, score);
        enriched++;
        console.log('[BG-ENRICH] ✓ ' + post.urn + ' → score=' + score);

        // Auto-delete guard: null scores are NEVER deleted
        if (autoDelete && score < deleteThreshold) {
          await deleteEnrichPost(post.urn);
          deleted++;
          console.log(`[BG-ENRICH] 🗑 Deleted ${post.urn} (score ${score} < ${deleteThreshold})`);
        }
      } else {
        nullCount++;
        console.log('[BG-ENRICH] ✕ ' + post.urn + ' → null (private/timeout)');
      }
    } catch (e) {
      failed++;
      console.warn('[BG-ENRICH] Error on ' + post.urn + ':', e.message);
    }

    const done = enriched + nullCount + failed;
    // Write to E.progress — dashboard polls this every 1.5s
    E.progress = { done, total, enriched, failed, deleted, nullCount, currentKeyword };
    broadcastStatus('Enriching ' + done + '/' + total + ' posts...');

    if (done < total) await sleep(2500);
  }

  E.running = false;
  const msg = `Enrichment complete: ${enriched} scored, ${deleted} deleted, ${nullCount} null.`;
  console.log('[BG-ENRICH] ' + msg);
  broadcastStatus(msg);
  setBadge(String(enriched), '#10b981');
  // Final push broadcast — fires once, so unreliability is acceptable
  chrome.runtime.sendMessage({
    action: 'ENRICH_DONE',
    enriched, failed, total, deleted, nullCount, currentKeyword
  }).catch(() => {});
}

async function enrichSinglePost(url, urn) {
  return new Promise(async (resolve) => {
    let tabId = null;
    let settled = false;

    function finish(score) {
      if (settled) return;
      settled = true;
      if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
      resolve(score);
    }

    // Hard timeout: if nothing reports back in 18s, give up
    const hardTimeout = setTimeout(() => finish(null), 18000);

    // One-shot ENRICH_RESULT listener for this specific tab
    function onMsg(msg, sender) {
      if (msg.action !== 'ENRICH_RESULT') return;
      if (tabId !== null && sender.tab?.id !== tabId) return;
      chrome.runtime.onMessage.removeListener(onMsg);
      clearTimeout(hardTimeout);
      finish(msg.score ?? null);
    }
    chrome.runtime.onMessage.addListener(onMsg);

    try {
      // Open the post URL in a background tab (user doesn't need to interact)
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;

      // Wait for the page to fully load
      await waitForTabLoad(tabId, 12000);

      // Stamp the target URN so enrich.js knows which post to report on
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (u) => { window.__nexoraEnrichUrn = u; },
        args: [urn],
      });

      // Inject interceptor first (catches any lazy-load API calls)
      await chrome.scripting.executeScript({ target: { tabId }, files: ['interceptor.js'] });
      // Small pause to let interceptor process any pending responses
      await sleep(800);
      // Inject the enrichment reader
      await chrome.scripting.executeScript({ target: { tabId }, files: ['enrich.js'] });

    } catch (e) {
      console.warn('[BG-ENRICH] Tab setup failed for ' + url + ':', e.message);
      chrome.runtime.onMessage.removeListener(onMsg);
      clearTimeout(hardTimeout);
      finish(null);
    }
  });
}

async function pushEnrichScore(urn, score) {
  const endpoint = E.dashUrl + '/api/extension/enrich';
  const resp = await fetch(endpoint, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-extension-token': E.userId },
    body: JSON.stringify({ urn, score }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error('Enrich API HTTP ' + resp.status + ': ' + body.substring(0, 100));
  }
}

async function deleteEnrichPost(urn) {
  const endpoint = E.dashUrl + '/api/extension/enrich?urn=' + encodeURIComponent(urn);
  const resp = await fetch(endpoint, {
    method: 'DELETE',
    headers: { 'x-extension-token': E.userId },
  });
  if (!resp.ok) {
    console.warn('[BG-ENRICH] Failed to delete ' + urn);
  }
}

async function runAutoEnrich(dashUrl, userId, opts) {
  if (E.running) return;
  console.log('[BG-ENRICH] Auto-enrich starting for keywords:', S.keywords);
  try {
    const kwParam = encodeURIComponent(S.keywords.join(','));
    const url = `${dashUrl}/api/extension/posts?unscored=true&keywords=${kwParam}`;
    const resp = await fetch(url, { headers: { 'x-extension-token': userId }});
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const posts = await resp.json();
    
    if (Array.isArray(posts) && posts.length > 0) {
      const queue = posts
        .filter(p => p.canonicalUrn && p.postUrl)
        .map(p => ({ urn: p.canonicalUrn, url: p.postUrl }));
      
      if (queue.length > 0) {
         startEnrichSession(queue, dashUrl, userId, {
           ...opts,
           currentKeyword: S.keywords.join(', ')
         });
      } else {
         console.log('[BG-ENRICH] No valid posts to auto-enrich.');
      }
    } else {
      console.log('[BG-ENRICH] Auto-enrich queue empty.');
    }
  } catch (e) {
    console.error('[BG-ENRICH] Auto-enrich fetch failed:', e.message);
  }
}
