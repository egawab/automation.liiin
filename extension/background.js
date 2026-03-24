// ═══════════════════════════════════════════════════════════
// LinkedIn Safety Worker v6 — Hybrid Push+Pull Architecture
// ═══════════════════════════════════════════════════════════

console.log("[Worker] ═══ Safety Worker v6 (Hybrid) Initialized ═══");

let isJobRunning = false;
const pendingJobs = new Map(); // tabId → { payload, resolved }

// ── Persistent State ──
async function getState() {
  return chrome.storage.local.get({
    activeTabId: null,
    lastJobTime: 0,
    cooldownMs: 0,
    consecutiveCycles: 0,
    isPaused: false,
    wasDashboardActive: null
  });
}
async function saveState(updates) {
  await chrome.storage.local.set(updates);
}

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomCooldown() { return 600000 + Math.floor(Math.random() * 300000); }

function resetWorkerState() {
  isJobRunning = false;
  getState().then(state => {
    const next = randomCooldown();
    saveState({
      activeTabId: null,
      lastJobTime: Date.now(),
      cooldownMs: next,
      consecutiveCycles: state.consecutiveCycles + 1
    });
    console.log(`[Worker] Cycle #${state.consecutiveCycles + 1} done. Next cooldown: ${Math.round(next / 60000)} min.`);
  }).catch(console.error);
}

function resetWorkerStateSilent() {
  isJobRunning = false;
  saveState({ activeTabId: null, lastJobTime: Date.now() }).catch(console.error);
}

// ═══════════════════════════════════════════
// MAIN POLL — checks for jobs every minute
// ═══════════════════════════════════════════
async function checkJobs() {
  if (isJobRunning) return;
  isJobRunning = true;

  try {
    let state = await getState();
    const now = Date.now();
    const elapsed = now - state.lastJobTime;

    // Auto-Recovery after 2 hours idle
    if (state.lastJobTime > 0 && elapsed > 7200000) {
      await saveState({ consecutiveCycles: 0, isPaused: false });
      state = await getState();
    }

    // Cooldown guard
    if (state.lastJobTime > 0 && elapsed < state.cooldownMs) {
      sendHeartbeat("Sleeping", `${Math.ceil((state.cooldownMs - elapsed) / 60000)}m cooldown`);
      isJobRunning = false;
      return;
    }

    // Pause guard
    if (state.isPaused && elapsed < 600000) {
      sendHeartbeat("Paused", "Safety limit active");
      isJobRunning = false;
      return;
    }

    // Cleanup orphan tab
    if (state.activeTabId !== null) {
      try { await chrome.tabs.remove(state.activeTabId); } catch (e) {}
      await saveState({ activeTabId: null });
    }

    // Get config
    const config = await chrome.storage.sync.get(['dashboardUrl', 'userId', 'visibilityMode']);
    const { dashboardUrl, userId, visibilityMode = 'hidden' } = config;
    if (!dashboardUrl || !userId) { isJobRunning = false; return; }

    // Fetch jobs
    const baseUrl = dashboardUrl.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/api/extension/jobs`, {
      headers: { 'x-extension-token': userId, 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    // Dashboard toggle detection
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

    // Safety pause after 3 consecutive cycles
    if (state.consecutiveCycles >= 3 && !state.isPaused) {
      const cd = randomCooldown();
      await saveState({ isPaused: true, lastJobTime: now, cooldownMs: cd });
      sendHeartbeat("Paused", "Auto-paused after 3 cycles");
      isJobRunning = false;
      return;
    }

    // Pick keyword and build payload
    const keyword = data.keywords[Math.floor(Math.random() * data.keywords.length)].keyword;
    const payload = {
      action: 'EXECUTE_SEARCH',
      keyword,
      settings: data.settings || {},
      dashboardUrl: baseUrl,
      userId
    };

    console.log(`🚀 [Worker] Cycle #${state.consecutiveCycles + 1} for: "${keyword}"`);
    sendHeartbeat("Running", `Extracting: ${keyword}`);
    startScrapingCycle(payload, visibilityMode);

  } catch (error) {
    console.error("❌ [Worker] Poll error:", error.message);
    sendHeartbeat("Error", "Check connection/keys");
    isJobRunning = false;
  }
}

// ═══════════════════════════════════════════
// SCRAPING CYCLE — Hybrid Push+Pull
// ═══════════════════════════════════════════
async function startScrapingCycle(payload, visibilityMode) {
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(payload.keyword)}&origin=GLOBAL_SEARCH_HEADER`;

  try {
    // 1. Create tab
    const tab = await chrome.tabs.create({ url: searchUrl, active: visibilityMode === 'visible' });
    const tabId = tab.id;
    await saveState({ activeTabId: tabId });

    // Store payload for Pull fallback
    pendingJobs.set(tabId, { payload, resolved: false });
    console.log(`💉 [Worker] Tab ${tabId} created. Waiting for load...`);

    // 2. Wait for tab to finish loading (tabs.onUpdated)
    await waitForTabLoad(tabId, 30000); // 30s max wait for page load

    // 3. Inject content.js
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      console.log(`[Worker] ✅ content.js injected into tab ${tabId}`);
    } catch (e) {
      console.error(`[Worker] Injection failed: ${e.message}`);
      pendingJobs.delete(tabId);
      chrome.tabs.remove(tabId).catch(() => {});
      resetWorkerStateSilent();
      return;
    }

    // 4. PRIMARY: Push payload via sendMessage with 3 retries
    await sleep(1500); // Let script evaluate and register listener
    let pushSuccess = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      // Check if Pull already resolved it
      const job = pendingJobs.get(tabId);
      if (!job || job.resolved) {
        console.log(`[Worker] Pull-handshake already delivered payload. Skipping push.`);
        pushSuccess = true;
        break;
      }

      try {
        const response = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, payload, (res) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(res);
          });
        });

        if (response && response.received) {
          console.log(`✅ [Worker] Push delivery confirmed on attempt ${attempt}.`);
          const job = pendingJobs.get(tabId);
          if (job) job.resolved = true;
          pushSuccess = true;
          break;
        }
      } catch (e) {
        console.warn(`[Worker] Push attempt ${attempt}/3 failed: ${e.message}`);
      }

      if (attempt < 3) await sleep(2000); // Wait before retry
    }

    if (!pushSuccess) {
      // Check one final time if Pull resolved it
      const job = pendingJobs.get(tabId);
      if (job && job.resolved) {
        console.log(`✅ [Worker] Pull-handshake resolved after push failures.`);
      } else {
        console.warn(`⚠️ [Worker] Push failed. Waiting for Pull fallback (up to 30s)...`);
        // Give Pull fallback more time
        for (let w = 0; w < 15; w++) {
          await sleep(2000);
          const j = pendingJobs.get(tabId);
          if (!j || j.resolved) break;
        }
      }
    }

    // 5. ABSOLUTE TIMEOUT: If nothing worked after 90s total, kill tab
    const finalJob = pendingJobs.get(tabId);
    if (finalJob && !finalJob.resolved) {
      console.error(`❌ [Worker] ABSOLUTE TIMEOUT: Tab ${tabId} never connected. Killing.`);
      pendingJobs.delete(tabId);
      chrome.tabs.remove(tabId).catch(() => {});
      resetWorkerStateSilent();
    }
    // If resolved, the JOB_COMPLETED message will handle cleanup

  } catch (err) {
    console.error(`❌ [Worker] Cycle error: ${err.message}`);
    resetWorkerStateSilent();
  }
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(); }
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ═══════════════════════════════════════════
// GLOBAL MESSAGE ROUTER
// ═══════════════════════════════════════════
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // ── Pull Fallback: Content script announcing it's ready ──
  if (message.action === 'CONTENT_SCRIPT_READY') {
    if (tabId && pendingJobs.has(tabId)) {
      const job = pendingJobs.get(tabId);
      if (!job.resolved) {
        job.resolved = true;
        console.log(`✅ [Worker] Pull-handshake from tab ${tabId}. Sending payload.`);
        sendResponse(job.payload);
      } else {
        sendResponse({ action: 'ALREADY_DELIVERED' });
      }
    } else {
      sendResponse({ action: 'NO_JOB' });
    }
    return false;
  }

  // ── Result Relay: Content script sends extracted posts ──
  if (message.action === 'SYNC_RESULTS') {
    const { posts, keyword, dashboardUrl, userId, debugInfo } = message;
    console.log(`📤 [Worker] Relaying ${posts?.length || 0} posts for "${keyword}"...`);

    fetch(`${dashboardUrl}/api/extension/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
      body: JSON.stringify({ keyword, posts, debugInfo })
    })
    .then(r => console.log(`[Worker] Relay response: ${r.status}`))
    .catch(e => console.error("[Worker] Relay failed:", e));
    return false;
  }

  // ── Job Completion ──
  if (message.action === 'JOB_COMPLETED' || message.action === 'JOB_FAILED') {
    console.log(`🏁 [Worker] Tab ${tabId}: ${message.action}`);
    if (tabId) {
      pendingJobs.delete(tabId);
      chrome.tabs.remove(tabId).catch(() => {});
    }
    resetWorkerState();
    return false;
  }

  return false;
});

// ── Heartbeat ──
async function sendHeartbeat(status, msg) {
  try {
    const config = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
    if (!config.dashboardUrl || !config.userId) return;
    const state = await getState();
    await fetch(`${config.dashboardUrl.replace(/\/$/, '')}/api/extension/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': config.userId },
      body: JSON.stringify({ status, message: msg, cycles: state.consecutiveCycles, isPaused: state.isPaused })
    });
  } catch (e) {}
}

// ── Alarms & Startup ──
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
