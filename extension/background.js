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
    await saveState({ isJobRunning: true, currentKeyword: kw, lastJobTime: Date.now() });

    console.log(`🚀 [Worker] Starting cycle #${cycleNum}/${kwObj.targetCycles || 1} for: "${kw}"`);
    await startScrapingCycle(kw, settings, keywordComments, dashboardUrl, userId);

  } catch (error) {
    console.error("❌ [Worker] Poll failed:", error.message);
  }
}

// ── Scraping Cycle (Navigation-Resilient v2) ──
async function startScrapingCycle(keyword, settings, comments, dashboardUrl, userId) {
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER`;
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

      // Send EXECUTE_SEARCH
      console.log("🚀 [Worker] Sending EXECUTE_SEARCH...");
      try {
        await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'EXECUTE_SEARCH', keyword, settings, comments, dashboardUrl, userId
          }, (res) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(res);
          });
        });
        console.log("✅ [Worker] Content script acknowledged.");
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
    cooldownMs: cd
  };

  if (incrementKeyword && state.currentKeyword) {
    const kc = state.keywordCycles || {};
    kc[state.currentKeyword] = (kc[state.currentKeyword] || 0) + 1;
    console.log(`[Worker] Keyword "${state.currentKeyword}" cycle ${kc[state.currentKeyword]} complete.`);
    updates.keywordCycles = kc;
    updates.currentKeyword = null;
  }

  await saveState(updates);
  console.log(`[Worker] Cycle done. Next cooldown: ${Math.round(cd / 60000)} min.`);
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

  if (message.action === 'COMMENT_POSTED') {
    loadState().then(async s => { // Added async
      const newCount = (s.dailyCommentsMade || 0) + 1;
      await saveState({ dailyCommentsMade: newCount });
      console.log(`💬 [Worker] Comment posted successfully. Daily quota: ${newCount}/15`);
      
      // Notify the user directly
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon-48.png', 
        title: 'Nexora AI Commenting',
        message: `Successfully posted comment #${newCount}/15 for today!`,
        priority: 2
      });

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
    
    // Safety Gap 1: Only count as a completed cycle if it actually did work AND finished all its exact assigned comments
    if (isSuccessfulCycle && message.searchOnlyMode === false) {
      const posted = message.commentsPostedCount || 0;
      const assigned = message.assignedCommentsCount || 1;
      
      if (posted < assigned) {
        console.warn(`[Worker] ⚠️ Cycle finished but only posted ${posted}/${assigned} assigned comments. Will NOT consume a cycle slot (it will partial-resume later).`);
        isSuccessfulCycle = false;
      } else {
        console.log(`[Worker] ✅ Cycle fully completed ${posted}/${assigned} comments. Counting as complete.`);
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
