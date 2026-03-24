// ═══════════════════════════════════════════════════════════
// LinkedIn Safety Worker v5 — Unified Message Bus
// ═══════════════════════════════════════════════════════════

console.log("[Worker] ═══ Safety Worker v5 Initialized ═══");

let isJobRunning = false;
const activeJobs = new Map(); // tabId -> payload

// ── State Management ──
async function getState() {
  const result = await chrome.storage.local.get({
    activeTabId: null,
    lastJobTime: 0,
    cooldownMs: 0,
    consecutiveCycles: 0,
    isPaused: false,
    wasDashboardActive: null
  });
  return result;
}

async function saveState(updates) {
  await chrome.storage.local.set(updates);
}

// ── Helpers ──
function randomCooldown() {
  return 600000 + Math.floor(Math.random() * 300000); // 10-15 min
}

function resetWorkerState() {
  isJobRunning = false;
  getState().then(state => {
    const nextCooldown = randomCooldown();
    saveState({
      activeTabId: null,
      lastJobTime: Date.now(),
      cooldownMs: nextCooldown,
      consecutiveCycles: state.consecutiveCycles + 1
    });
    console.log(`[Worker] Cycle #${state.consecutiveCycles + 1} done. Next cooldown: ${Math.round(nextCooldown / 60000)} min.`);
  }).catch(console.error);
}

function resetWorkerStateSilent() {
  isJobRunning = false;
  getState().then(state => {
    saveState({
      activeTabId: null,
      lastJobTime: Date.now()
    });
  }).catch(console.error);
}

// ── Main Poll ──
async function checkJobs() {
  if (isJobRunning) {
    console.log("⏳ [Worker] Job in progress, skipping poll.");
    return;
  }
  isJobRunning = true;

  try {
    let state = await getState();
    const now = Date.now();
    const elapsed = now - state.lastJobTime;

    // Reset if 2 hours passed
    if (state.lastJobTime > 0 && elapsed > 7200000) {
      await saveState({ consecutiveCycles: 0, isPaused: false });
      state = await getState();
    }

    // Cooldown check
    if (state.lastJobTime > 0 && elapsed < state.cooldownMs) {
      const remaining = Math.ceil((state.cooldownMs - elapsed) / 60000);
      sendHeartbeat("Sleeping", `${remaining}m cooldown`);
      isJobRunning = false;
      return;
    }

    // Pause check
    if (state.isPaused && elapsed < 600000) {
      sendHeartbeat("Paused", "Safety limit active");
      isJobRunning = false;
      return;
    }

    // Cleanup orphan tabs
    if (state.activeTabId !== null) {
      try { await chrome.tabs.remove(state.activeTabId); } catch (e) {}
      await saveState({ activeTabId: null });
    }

    const config = await chrome.storage.sync.get(['dashboardUrl', 'userId', 'visibilityMode']);
    const { dashboardUrl, userId, visibilityMode = 'hidden' } = config;
    if (!dashboardUrl || !userId) {
      isJobRunning = false;
      return;
    }

    const response = await fetch(`${dashboardUrl.replace(/\/$/, '')}/api/extension/jobs`, {
      headers: { 'x-extension-token': userId, 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const isActive = data.active === true;
    
    // Auto-resume if status changed
    if (state.wasDashboardActive === false && isActive) {
      await saveState({ consecutiveCycles: 0, isPaused: false });
      state = await getState();
    }
    await saveState({ wasDashboardActive: isActive });

    if (!isActive || !data.hasJobs || !data.keywords?.length) {
      sendHeartbeat("Idle", isActive ? "No jobs available" : "System Paused");
      isJobRunning = false;
      return;
    }

    // Forced Safety Pause
    if (state.consecutiveCycles >= 3 && !state.isPaused) {
      const nextCooldown = randomCooldown();
      await saveState({ isPaused: true, lastJobTime: now, cooldownMs: nextCooldown });
      sendHeartbeat("Paused", "Auto-paused after 3 cycles");
      isJobRunning = false;
      return;
    }

    const target = data.keywords[Math.floor(Math.random() * data.keywords.length)].keyword;
    const settings = data.settings || {};
    
    const payload = {
      action: 'EXECUTE_SEARCH_PAYLOAD',
      keyword: target,
      settings,
      dashboardUrl: dashboardUrl.replace(/\/$/, ''),
      userId
    };

    console.log(`🚀 [Worker] Starting cycle #${state.consecutiveCycles + 1} for: "${target}"`);
    sendHeartbeat("Running", `Extracting: ${target}`);
    
    // START scraping (async)
    startScrapingCycle(payload, visibilityMode);

  } catch (error) {
    console.error("❌ [Worker] Poll failed:", error.message);
    sendHeartbeat("Error", "Check connection/keys");
    isJobRunning = false;
  }
}

async function startScrapingCycle(payload, visibilityMode) {
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(payload.keyword)}&origin=GLOBAL_SEARCH_HEADER`;

  try {
    const tab = await chrome.tabs.create({ url: searchUrl, active: visibilityMode === 'visible' });
    const tabId = tab.id;
    await saveState({ activeTabId: tabId });

    // Store payload for the handshake
    activeJobs.set(tabId, payload);
    console.log(`💉 [Worker] Tab ${tabId} created. Waiting up to 60s for content script...`);

    // Extended polling for handshake (60 seconds)
    // We re-inject every 10 seconds in case LinkedIn reloads the DOM
    let totalWait = 0;
    while (totalWait < 60000 && activeJobs.has(tabId)) {
      if (totalWait % 10000 === 0) {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
          console.log(`[Worker] Injecting content.js into ${tabId}...`);
        } catch (e) {
          console.warn(`[Worker] Injection failed for tab ${tabId}: ${e.message}`);
        }
      }
      await new Promise(r => setTimeout(r, 2000));
      totalWait += 2000;
    }

    // Verify if it ever connected
    if (activeJobs.has(tabId)) {
       console.error(`❌ [Worker] Handshake TIMEOUT for tab ${tabId}. Closing.`);
       activeJobs.delete(tabId);
       chrome.tabs.remove(tabId).catch(() => {});
       resetWorkerStateSilent();
    }
  } catch (err) {
    console.error(`❌ [Worker] Cycle startup error: ${err.message}`);
    resetWorkerStateSilent();
  }
}

// ── Global Message Router ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // Handshake
  if (message.action === 'CONTENT_SCRIPT_READY') {
    if (tabId && activeJobs.has(tabId)) {
      const payload = activeJobs.get(tabId);
      console.log(`✅ [Worker] Handshake SUCCESS for tab ${tabId}. Payload sent.`);
      activeJobs.delete(tabId); // Consume payload
      sendResponse(payload);
    } else {
      sendResponse({ action: 'WAIT' });
    }
    return false;
  }

  // Result Relay
  if (message.action === 'SYNC_RESULTS') {
    const { posts, keyword, dashboardUrl, userId, debugInfo } = message;
    console.log(`📤 [Worker] Syncing ${posts?.length || 0} posts from tab ${tabId}...`);
    
    fetch(`${dashboardUrl}/api/extension/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
      body: JSON.stringify({ keyword, posts, debugInfo })
    }).catch(e => console.error("[Worker] Sync failed:", e));
    return false;
  }

  // Completion
  if (message.action === 'JOB_COMPLETED' || message.action === 'JOB_FAILED') {
    console.log(`🏁 [Worker] Tab ${tabId} reporting ${message.action}.`);
    if (tabId) {
      activeJobs.delete(tabId);
      chrome.tabs.remove(tabId).catch(() => {});
    }
    resetWorkerState();
    return false;
  }

  return false;
});

async function sendHeartbeat(status, message) {
  try {
    const config = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
    const { dashboardUrl, userId } = config;
    if (!dashboardUrl || !userId) return;
    const state = await getState();
    await fetch(`${dashboardUrl.replace(/\/$/, '')}/api/extension/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
      body: JSON.stringify({ status, message, cycles: state.consecutiveCycles, isPaused: state.isPaused })
    });
  } catch (e) {}
}

chrome.alarms.create('checkJobsAlarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkJobsAlarm') {
    checkJobs();
    sendHeartbeat("Online", "Worker active");
  }
});

chrome.runtime.onInstalled.addListener(() => {
  saveState({ lastJobTime: 0, consecutiveCycles: 0, isPaused: false });
  checkJobs();
});
chrome.runtime.onStartup.addListener(checkJobs);
