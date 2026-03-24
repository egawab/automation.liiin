// ═══════════════════════════════════════════════════════════
// LinkedIn Safety Worker v5 — Unified Message Bus
// ═══════════════════════════════════════════════════════════

console.log("[Worker] ═══ Safety Worker v5 Initialized ═══");

let isJobRunning = false;
let currentJobPayload = null; // Stores payload for the reverse-handshake

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
  return 600000 + Math.floor(Math.random() * 300000);
}

function resetWorkerState() {
  isJobRunning = false;
  currentJobPayload = null;
  
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
  currentJobPayload = null;
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

    // Smart Recovery
    if (state.lastJobTime > 0 && elapsed > 7200000) {
      await saveState({ consecutiveCycles: 0, isPaused: false });
      state = await getState();
    }

    // Cooldown
    if (state.lastJobTime > 0 && elapsed < state.cooldownMs) {
      const remaining = Math.ceil((state.cooldownMs - elapsed) / 60000);
      sendHeartbeat("Sleeping", `${remaining}m cooldown`);
      isJobRunning = false;
      return;
    }

    // Pause
    if (state.isPaused) {
      const trickleMs = 600000;
      if (elapsed < trickleMs) {
        sendHeartbeat("Paused", "Safety limit - Trickle Running");
        isJobRunning = false;
        return;
      }
    }

    // Single Tab
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

    if (state.consecutiveCycles >= 3 && !state.isPaused) {
      const nextCooldown = randomCooldown();
      await saveState({ isPaused: true, lastJobTime: now, cooldownMs: nextCooldown });
      sendHeartbeat("Paused", "Auto-paused after 3 cycles");
      isJobRunning = false;
      return;
    }

    const kw = data.keywords[Math.floor(Math.random() * data.keywords.length)].keyword;
    const settings = data.settings || {};
    
    // Preparation for Handshake
    currentJobPayload = {
      action: 'EXECUTE_SEARCH_PAYLOAD',
      keyword: kw,
      settings,
      dashboardUrl: dashboardUrl.replace(/\/$/, ''),
      userId
    };

    console.log(`🚀 [Worker] Starting cycle #${state.consecutiveCycles + 1} for: "${kw}"`);
    sendHeartbeat("Running", `Extracting: ${kw}`);
    
    startScrapingCycle(currentJobPayload, visibilityMode);

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
    saveState({ activeTabId: tab.id }).catch(() => {});

    // Try injecting until connected or retries hit
    let injectRetries = 3;
    while (injectRetries > 0 && currentJobPayload) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch (e) {}
      await new Promise(r => setTimeout(r, 4000));
      injectRetries--;
    }

    if (currentJobPayload) {
       console.error("❌ [Worker] Comm error: Handshake never completed.");
       chrome.tabs.remove(tab.id).catch(() => {});
       resetWorkerStateSilent();
    }
  } catch (err) {
    resetWorkerStateSilent();
  }
}

// ── Global Message Router ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // 1. Handshake Request
  if (message.action === 'CONTENT_SCRIPT_READY') {
    if (currentJobPayload && tabId) {
      console.log(`✅ [Worker] Handshake from tab ${tabId}. Returning payload.`);
      sendResponse(currentJobPayload);
      currentJobPayload = null; // Payload consumed
    } else {
      sendResponse({ action: 'WAIT' });
    }
    return false;
  }

  // 2. Results Sync (Relayed via background to ensure completion)
  if (message.action === 'SYNC_RESULTS') {
    const { posts, keyword, dashboardUrl, userId, debugInfo } = message;
    console.log(`📤 [Worker] Relaying ${posts?.length || 0} results to Dashboard...`);
    
    fetch(`${dashboardUrl}/api/extension/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
      body: JSON.stringify({ keyword, posts, debugInfo })
    }).catch(e => console.error("[Worker] Relay failed:", e));

    return false;
  }

  // 3. Status Reporting
  if (message.action === 'JOB_COMPLETED' || message.action === 'JOB_FAILED') {
    console.log(`🏁 [Worker] Job ${message.action}.`);
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
    resetWorkerState();
    return false;
  }

  return false;
});

async function sendHeartbeat(status, message) {
  const config = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
  const { dashboardUrl, userId } = config;
  if (!dashboardUrl || !userId) return;
  try {
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

chrome.runtime.onInstalled.addListener(checkJobs);
chrome.runtime.onStartup.addListener(checkJobs);
