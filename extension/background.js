// ═══════════════════════════════════════════════════════════
// LinkedIn Safety Worker v4 — Persistent State + Single Tab
// ═══════════════════════════════════════════════════════════
// Hard Limits:
// 1. MAX 3 cycles per keyword (persisted — survives restarts)
// 2. 10-15 min random cooldown between cycles
// 3. ONE tab at a time (persisted — cleans stale tabs on restart)
// 4. FULL STOP when all keywords finish 3 cycles
// 5. Manual reset: toggle Dashboard OFF → ON
// ═══════════════════════════════════════════════════════════

console.log("[Worker] ═══ Safety Worker v4 (Persistent) Initialized ═══");


// ── Persistent State (chrome.storage.local) ──
async function loadState() {
  return chrome.storage.local.get({
    isJobRunning: false,
    activeTabId: null,
    lastJobTime: 0,
    cooldownMs: 0,
    isPaused: false,
    keywordCycles: {},
    currentKeyword: null,
    wasDashboardActive: null,
    dailyCommentsMade: 0,
    lastCommentDate: null
  });
}

// ── Live Badge Update ──
async function updateBadge() {
  const s = await loadState();
  let text = s.dailyCommentsMade ? String(s.dailyCommentsMade) : '0';
  let color = '#6b7280'; // default

  if (s.isPaused) {
    color = '#ef4444'; // Red
    text = 'PAUSED';
  } else if (s.isJobRunning) {
    color = '#10b981'; // Green
  } else {
    // Cooldown or Idle
    const elapsed = Date.now() - (s.lastJobTime || 0);
    if (s.lastJobTime > 0 && elapsed < (s.cooldownMs || 0)) {
      color = '#f59e0b'; // Orange
    } else {
      color = '#6b7280'; // Gray (Idle)
    }
  }

  // Set text and color (Badge API)
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// Call whenever state changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') updateBadge();
});

async function saveState(updates) {
  await chrome.storage.local.set(updates);
}

// ── Premium In-Page Toast Notifications ──
function injectToastDOM(title, message, isError) {
  let container = document.getElementById('nexora-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'nexora-toast-container';
    container.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 2147483647; display: flex; flex-direction: column; gap: 12px; pointer-events: none;';
    (document.body || document.documentElement).appendChild(container);
  }
  
  const host = document.createElement('div');
  container.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  
  const accent = isError ? '#ff3b30' : '#0071e3';
  const icon = isError ? '⚠️' : '✨';
  
  shadow.innerHTML = `
    <style>
      :host {
        --toast-bg: #ffffff;
        --toast-border: rgba(0, 0, 0, 0.08);
        --toast-text: #1d1d1f;
        --toast-sec: rgba(0, 0, 0, 0.56);
        --shadow: rgba(0, 0, 0, 0.1) 0 8px 30px;
      }
      @media (prefers-color-scheme: dark) {
        :host {
          --toast-bg: #1d1d1f;
          --toast-border: rgba(255, 255, 255, 0.05);
          --toast-text: #ffffff;
          --toast-sec: rgba(255, 255, 255, 0.48);
          --shadow: rgba(0, 0, 0, 0.4) 0 8px 30px;
        }
      }
      .toast {
        width: 320px;
        background: var(--toast-bg);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid var(--toast-border);
        border-radius: 12px;
        padding: 16px 20px;
        color: var(--toast-text);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
        box-shadow: var(--shadow);
        transform: translateX(120%);
        opacity: 0;
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        display: flex;
        gap: 14px;
        align-items: flex-start;
        overflow: hidden;
        position: relative;
      }
      .toast.show { transform: translateX(0); opacity: 1; }
      .toast.hiding { transform: translateX(120%); opacity: 0; }
      .icon { font-size: 20px; line-height: 1; filter: drop-shadow(0 0 8px ${accent}60); }
      .content { flex: 1; }
      .title { font-size: 14px; font-weight: 600; margin: 0 0 4px 0; color: var(--toast-text); letter-spacing: -0.01em; }
      .message { font-size: 13px; font-weight: 400; margin: 0; color: var(--toast-sec); line-height: 1.4; }
      .progress {
        position: absolute; bottom: 0; left: 0; height: 3px; background: ${accent}; width: 100%;
        animation: shrink 4s linear forwards;
      }
      @keyframes shrink { from { width: 100%; } to { width: 0%; } }
    </style>
    <div class="toast">
      <div class="icon">${icon}</div>
      <div class="content">
        <h4 class="title">${title}</h4>
        <p class="message">${message}</p>
      </div>
      <div class="progress"></div>
    </div>
  `;
  
  const toastEl = shadow.querySelector('.toast');
  requestAnimationFrame(() => requestAnimationFrame(() => toastEl.classList.add('show')));
  setTimeout(() => {
    toastEl.classList.remove('show');
    toastEl.classList.add('hiding');
    setTimeout(() => { host.remove(); if (container.childElementCount === 0) container.remove(); }, 500);
  }, 4000);
}

async function showPremiumToast(title, message, isError = false) {
  try {
    // 1. Check if the user is currently focused on Chrome. 
    // If Chrome is minimized or unfocused, we SKIP DOM injection to guarantee OS-level global visibility.
    const win = await chrome.windows.getLastFocused();
    
    if (win && win.focused) {
      const tabs = await chrome.tabs.query({ active: true, windowId: win.id });
      if (tabs.length > 0 && tabs[0].url && tabs[0].url.startsWith('http')) {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: injectToastDOM,
          args: [title, message, isError]
        });
        return; // Success, premium toast injected
      }
    }
  } catch (e) { console.warn("Failed to inject toast:", e); }
  
  // 2. Fallback to Native OS Notification if Chrome is unfocused OR if we are on a protected chrome:// tab
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon-48.png',
    title: title,
    message: message,
    priority: 1
  });
}

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function randomCooldown() {
  return 600000 + Math.floor(Math.random() * 300000); // 10-15 min
}

function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    }, timeoutMs);
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        if (!settled) { settled = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); }
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ── Main Poll (with mutex) ──
let checkJobsLock = false;

async function checkJobs() {
  if (checkJobsLock) return;
  checkJobsLock = true;
  try {
    await _checkJobsInner();
  } finally {
    checkJobsLock = false;
  }
}

async function _checkJobsInner() {
  const state = await loadState();

  // Gate 1: Already running
  if (state.isJobRunning) {
    // Safety: if running for more than 5 minutes, assume it's stale (worker restarted mid-cycle)
    const runningTime = Date.now() - (state.lastJobTime || 0);
    if (runningTime < 300000) {
      console.log("⏳ [Worker] Job in progress, skipping poll.");
      return;
    }
    // Stale job — clear it
    console.log("🧹 [Worker] Stale job detected (5min+). Cleaning up...");
    if (state.activeTabId) {
      try { await chrome.tabs.remove(state.activeTabId); } catch (e) {}
    }
    await saveState({ isJobRunning: false, activeTabId: null });
  }

  // Gate 2: Cooldown timer
  const elapsed = Date.now() - state.lastJobTime;
  if (state.lastJobTime > 0 && elapsed < state.cooldownMs) {
    const remaining = Math.ceil((state.cooldownMs - elapsed) / 60000);
    console.log(`🛌 [Worker] Cooldown active. ${remaining} min remaining.`);
    return;
  }

  // Gate 3: Auto-pause check
  if (state.isPaused) {
    const trickleMs = 600000;
    if (elapsed < trickleMs) {
      console.log(`⏸️ [Worker] PAUSED. Trickle mode: ${Math.ceil((trickleMs - elapsed) / 60000)} min left.`);
      return;
    }
  }

  // Gate 4: Clean any stale tab
  if (state.activeTabId !== null) {
    try {
      await chrome.tabs.remove(state.activeTabId);
      console.log(`🧹 [Worker] Cleaned stale tab ${state.activeTabId}.`);
    } catch (e) {}
    await saveState({ activeTabId: null });
  }

  // ── Fetch jobs ──
  const config = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
  const { dashboardUrl, userId } = config;
  if (!dashboardUrl || !userId) {
    console.warn("⚠️ [Worker] Missing dashboardUrl or userId.");
    return;
  }

  try {
    const response = await fetch(`${dashboardUrl}/api/extension/jobs`, {
      headers: { 'x-extension-token': userId, 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    // Dashboard Start/Stop detection
    const isActive = data.active === true;
    if (state.wasDashboardActive === false && isActive) { // Clean slate on dashboard restart
      console.log("🔄 [Worker] Dashboard turned active. Resetting cycles and daily limits.");
      await saveState({
        keywordCycles: {},
        isPaused: false,
        wasDashboardActive: true,
        lastJobTime: 0,
        dailyCommentsMade: 0
      });
      // Update local state object to reflect changes for current run
      state.keywordCycles = {};
      state.isPaused = false;
      state.wasDashboardActive = true;
      state.lastJobTime = 0;
      state.dailyCommentsMade = 0;
    } else {
      await saveState({ wasDashboardActive: isActive });
    }

    if (!isActive || !data.hasJobs || !data.keywords?.length) {
      console.log(`😴 [Worker] Idle. active=${isActive}, hasJobs=${data.hasJobs}`);
      return;
    }

    // Filter keywords that haven't hit their dynamic cycle limit
    const kc = (await loadState()).keywordCycles || {};
    const availableKeywords = data.keywords.filter(k => (kc[k.keyword] || 0) < (k.targetCycles || 1));

    // Auto-pause if all keywords hit limit
    if (availableKeywords.length === 0) {
      if (!state.isPaused) {
        await saveState({ isPaused: true, lastJobTime: Date.now(), cooldownMs: randomCooldown(), dailyCommentsMade: 0 });
        console.log("⏸️ [Worker] AUTO-PAUSED: All keywords completed their target cycles.");
        console.log("⏸️ [Worker] Deactivating system on the dashboard...");
        // Deactivate the dashboard toggle via API so the system truly stops
        try {
          await fetch(`${dashboardUrl}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
            body: JSON.stringify({ systemActive: false })
          });
          console.log("✅ [Worker] Dashboard systemActive set to FALSE. Engine fully stopped.");
        } catch(e) {
          console.error("❌ [Worker] Failed to deactivate dashboard:", e.message);
        }
      }
      return;
    }

    // Unpause if new keywords available
    if (state.isPaused) {
      await saveState({ isPaused: false });
    }

    // ── Start cycle ──
    const kwObj = availableKeywords[Math.floor(Math.random() * availableKeywords.length)];
    const kw = kwObj.keyword;
    const cycleNum = (kc[kw] || 0) + 1;

    // ── Daily Safety Limit Check ──
    const today = new Date().toDateString();
    if (state.lastCommentDate !== today) {
      state.dailyCommentsMade = 0;
      await saveState({ dailyCommentsMade: 0, lastCommentDate: today });
      console.log("📅 [Worker] New day started. Reset daily comment quota.");
    }
    
    const settings = data.settings || {};
    const allComments = data.comments || [];
    
    // STRICT ASSIGNMENT: Filter comments specifically for this keyword AND this exact cycle
    const keywordComments = allComments.filter(c => c.keywordId === kwObj.id && Number(c.cycleIndex) === cycleNum);
    
    if (state.dailyCommentsMade >= 15 && !settings.searchOnlyMode) {
      console.warn("🛡️ [Worker] Daily comment limit (15) reached! Forcing Search-Only mode for the rest of today.");
      settings.searchOnlyMode = true;
    }

    // Mark as running BEFORE creating tab
    await saveState({ isJobRunning: true, currentKeyword: kw, lastJobTime: Date.now(), liveStatusText: `🚀 Starting cycle #${cycleNum} for "${kw}"...` });

    console.log(`🚀 [Worker] Starting cycle #${cycleNum}/${kwObj.targetCycles || 1} for: "${kw}"`);
    showPremiumToast('Nexora Engine Started', `Starting cycle #${cycleNum}/${kwObj.targetCycles || 1} for "${kw}"`, false);
    await startScrapingCycle(kw, settings, keywordComments, dashboardUrl, userId, cycleNum);

  } catch (error) {
    console.error("❌ [Worker] Poll failed:", error.message);
  }
}

// ── Scraping Cycle (Navigation-Resilient v2) ──
async function startScrapingCycle(keyword, settings, comments, dashboardUrl, userId, cycleNum = 1) {
  // Use cycleNum to naturally paginate through LinkedIn search results! 
  // This guarantees each cycle gets completely fresh posts and bypasses the 0/X skip bug.
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER&page=${cycleNum}`;
  let injectionCount = 0;
  const MAX_INJECTIONS = 3;

  try {
    // 🚀 NEW: Spawn in a completely separate window. 
    // This tricks Chrome into treating the tab as "Active" in its own context, 
    // bypassing the extreme throttling applied to background tabs in the main window.
    const win = await chrome.windows.create({ 
      url: searchUrl, 
      type: 'normal',
      state: 'normal',
      focused: false, // Don't steal user focus immediately
      width: 1100,
      height: 900
    });
    const tab = win.tabs[0];
    await saveState({ activeTabId: tab.id });

    console.log(`💉 [Worker] Tab ${tab.id} created. Waiting for page load...`);

    // Wait for page to fully load
    await waitForTabLoad(tab.id, 15000);
    await sleep(3000); // LinkedIn JS hydration

    // ── Helper: Inject and Start ──
    async function injectAndStart() {
      injectionCount++;
      console.log(`🛠️ [Worker] Injection attempt #${injectionCount}/${MAX_INJECTIONS}...`);

      // Verify tab still exists
      let currentTab;
      try {
        currentTab = await chrome.tabs.get(tab.id);
      } catch (e) {
        console.warn("⚠️ [Worker] Tab lost before injection.");
        await finishCycle(null, false);
        return false;
      }

      // Verify URL is still LinkedIn (not a redirect to login/captcha/etc)
      if (!currentTab.url || !currentTab.url.includes('linkedin.com')) {
        console.warn(`⚠️ [Worker] Tab URL is no longer LinkedIn: ${currentTab.url}`);
        chrome.tabs.remove(tab.id).catch(() => {});
        await finishCycle(null, false);
        return false;
      }

      console.log(`📍 [Worker] Tab URL verified: ${currentTab.url.substring(0, 80)}...`);

      // Inject content script
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch (e) {
        console.error("❌ [Worker] Inject failed:", e.message);
        chrome.tabs.remove(tab.id).catch(() => {});
        await finishCycle(null, false);
        return false;
      }

      await sleep(1500); // Let script register listener

      // Send EXECUTE_SEARCH robustly via direct function execution instead of messaging
      console.log("🚀 [Worker] Starting extraction via direct execution...");
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (k, s, c, du, u) => {
            if (window.__startExtraction) {
              window.__startExtraction(k, s, c, du, u);
            } else {
              throw new Error("Extractor function not defined on window.");
            }
          },
          args: [keyword, settings, comments, dashboardUrl, userId]
        });
        console.log("✅ [Worker] Content script successfully executed phase bypass.");
        _lastContentHeartbeat = Date.now();
        return true;
      } catch (e) {
        console.error(`❌ [Worker] Comm error on attempt #${injectionCount}:`, e.message);
        if (injectionCount < MAX_INJECTIONS) {
          console.log("🔄 [Worker] Will retry injection after navigation settles...");
          await sleep(5000);
          return injectAndStart(); // Retry
        }
        chrome.tabs.remove(tab.id).catch(() => {});
        await finishCycle(null, false);
        return false;
      }
    }

    // ── First injection attempt ──
    const started = await injectAndStart();
    if (!started) return;

    // ── Tab navigation listener: re-inject if LinkedIn re-renders ──
    const navListener = async (tabId, changeInfo) => {
      if (tabId !== tab.id) return;
      if (changeInfo.status === 'complete' && injectionCount < MAX_INJECTIONS) {
        // The tab URL reloaded — LinkedIn did a silent navigation
        console.log("🔄 [Worker] Tab re-navigated! Re-injecting content script...");
        await sleep(3000); // Let the new page hydrate
        await injectAndStart();
      }
    };
    chrome.tabs.onUpdated.addListener(navListener);

    // ── Heartbeat monitor: re-inject if content script dies silently ──
    const heartbeatInterval = setInterval(async () => {
      const s = await loadState();
      if (!s.isJobRunning || s.activeTabId !== tab.id) {
        // Job already finished, cleanup
        clearInterval(heartbeatInterval);
        chrome.tabs.onUpdated.removeListener(navListener);
        return;
      }

      const timeSinceHeartbeat = Date.now() - _lastContentHeartbeat;
      if (timeSinceHeartbeat > 45000 && injectionCount < MAX_INJECTIONS) {
        // No heartbeat for 45 seconds — script likely died
        console.warn(`💀 [Worker] No heartbeat for ${Math.round(timeSinceHeartbeat/1000)}s. Script may be dead. Re-injecting...`);
        await injectAndStart();
      }
    }, 15000); // Check every 15 seconds

    // ── 4-minute watchdog (extended from 3 for slower accounts) ──
    const watchdogTabId = tab.id;
    setTimeout(async () => {
      clearInterval(heartbeatInterval);
      chrome.tabs.onUpdated.removeListener(navListener);
      const s = await loadState();
      if (s.isJobRunning && s.activeTabId === watchdogTabId) {
        console.warn("⏱️ [Worker] WATCHDOG: 4-min timeout. Force-killing tab.");
        chrome.tabs.remove(watchdogTabId).catch(() => {});
        await finishCycle(null, false);
      }
    }, 240000); // 4 minutes

  } catch (err) {
    console.error("❌ [Worker] Cycle failed:", err.message);
    await finishCycle(null, false);
  }
}

// ── Finish Cycle (persists everything) ──
async function finishCycle(tabId, incrementKeyword = true) {
  if (tabId) {
    try { await chrome.tabs.remove(tabId); } catch (e) {}
  }

  const state = await loadState();
  const cd = randomCooldown();
  const updates = {
    isJobRunning: false,
    activeTabId: null,
    lastJobTime: Date.now(),
    cooldownMs: cd,
    liveStatusText: ''
  };

  if (incrementKeyword && state.currentKeyword) {
    const kc = state.keywordCycles || {};
    kc[state.currentKeyword] = (kc[state.currentKeyword] || 0) + 1;
    console.log(`[Worker] Keyword "${state.currentKeyword}" cycle ${kc[state.currentKeyword]} complete.`);
    updates.keywordCycles = kc;
    updates.currentKeyword = null;
  }

  await saveState(updates);
  const cdMin = Math.round(cd / 60000);
  console.log(`[Worker] Cycle done. Next cooldown: ${cdMin} min.`);
  showPremiumToast('Cycle Complete', `✅ Cycle complete! Cooling down for ${cdMin} minutes...`, false);
}

// ── Message Router ──
// Track heartbeat time globally for the heartbeat monitor in startScrapingCycle
let _lastContentHeartbeat = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_POLLING') {
    console.log("🚀 [Worker] Received START command from dashboard. Resetting system limits and waking up.");
    // Clear out the dynamic limits so the pilot can run fresh!
    saveState({ isPaused: false, keywordCycles: {}, cooldownMs: 0 }).then(() => {
      checkJobs(); 
    });
    if (sendResponse) sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'HEARTBEAT') {
    _lastContentHeartbeat = Date.now();
    console.log(`💓 [Worker] Heartbeat from content script (Phase: ${message.phase || '?'})`);
    return;
  }

  if (message.action === 'LIVE_STATUS') {
    // Save current status text for popup display
    saveState({ liveStatusText: message.text });
    
    // Append to activity log (rolling last 8 entries) for the popup Activity Timeline
    loadState().then(s => {
      const log = s.activityLog || [];
      log.push({ text: message.text, time: Date.now() });
      // Keep only last 8 entries
      while (log.length > 8) log.shift();
      saveState({ activityLog: log });
    });

    // Forward to popup if open (will silently fail if popup is closed)
    try { 
      chrome.runtime.sendMessage({ action: 'EXTENSION_LIVE_STATUS', text: message.text }, () => {
        if (chrome.runtime.lastError) { /* popup closed, ignore */ }
      }); 
    } catch(e){}
    return;
  }

  if (message.action === 'COMMENT_POSTED') {
    loadState().then(async s => { // Added async
      const newCount = (s.dailyCommentsMade || 0) + 1;
      await saveState({ dailyCommentsMade: newCount });
      console.log(`💬 [Worker] Comment posted successfully. Daily quota: ${newCount}/15`);
      
      // Notify the user directly via Premium Toast
      showPremiumToast('Comment Posted', `Successfully posted comment #${newCount}/15 for today!`, false);

      // 🔥 Send the real-time action to the dashboard Live Feed
      const config = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
      if (config.dashboardUrl && config.userId) {
        fetch(`${config.dashboardUrl}/api/extension/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-extension-token': config.userId },
          body: JSON.stringify({
            action: 'COMMENT',
            postUrl: message.url || 'LinkedIn Post',
            comment: 'Commented successfully on targeted post.'
          })
        }).catch(e => console.error("❌ [Worker] Action Log relay failed:", e));
      }
      
      if (sendResponse) sendResponse({ ok: true });
    });
    return true;
  }

  if (message.action === 'SYNC_RESULTS') {
    const { posts, keyword, dashboardUrl, userId, debugInfo } = message;
    console.log(`📤 [Worker] Relaying ${posts?.length || 0} posts...`);
    fetch(`${dashboardUrl}/api/extension/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
      body: JSON.stringify({ keyword, posts, debugInfo })
    }).catch(e => console.error("❌ [Worker] Relay failed:", e));
    
    if (sendResponse) sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'JOB_COMPLETED' || message.action === 'JOB_FAILED') {
    const status = message.action === 'JOB_COMPLETED' ? "✅ COMPLETED" : "❌ FAILED";
    console.log(`🏁 [Worker] Job ${status}.`);
    
    let isSuccessfulCycle = message.action === 'JOB_COMPLETED';
    
    // Safety Gap 1: Count cycle as done if it posted at least SOME comments.
    // The fallback pool system already tries ALL available posts, so if it still
    // couldn't place all comments, retrying the same cycle won't help — it'll just loop forever.
    if (isSuccessfulCycle && message.searchOnlyMode === false) {
      const posted = message.commentsPostedCount || 0;
      const assigned = message.assignedCommentsCount || 1;
      
      if (posted === 0 && assigned > 0) {
        // Only refuse to count the cycle if ZERO comments were placed
        console.warn(`[Worker] ⚠️ Cycle posted 0/${assigned} comments. Will NOT consume a cycle slot.`);
        isSuccessfulCycle = false;
      } else {
        console.log(`[Worker] ✅ Cycle completed with ${posted}/${assigned} comments. Counting as done.`);
      }
    }

    finishCycle(sender.tab?.id, isSuccessfulCycle);
  }
});

// ── Alarm + Startup ──
chrome.alarms.create('checkJobsAlarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkJobsAlarm') checkJobs();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("🚀 [Worker] Safety Worker v4 installed.");
  // Clean any stale state from previous install
  saveState({ isJobRunning: false, activeTabId: null });
  setTimeout(() => checkJobs(), 5000);
});

chrome.runtime.onStartup.addListener(() => {
  console.log("⚙️ [Worker] Restarting...");
  setTimeout(() => checkJobs(), 5000);
});
