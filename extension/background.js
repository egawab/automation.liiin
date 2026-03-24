// ═══════════════════════════════════════════════════════════
// LinkedIn Safety Worker v4 — Permanent Set-and-Forget
// ═══════════════════════════════════════════════════════════

console.log("[Worker] ═══ Safety Worker v4 Initialized ═══");

let isJobRunning = false; // Ephemeral flag to prevent duplicate runs in 1 session

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
  // 10-15 minutes, randomized each time
  return 600000 + Math.floor(Math.random() * 300000);
}

// Kept synchronous-looking to match original, but handles async storage internally
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
  // LOCK SYNCHRONOUSLY to prevent overlapping cycle fires during `await`
  isJobRunning = true;

  try {
    let state = await getState();
    const now = Date.now();
    const elapsed = now - state.lastJobTime;

    // ── Smart Recovery: If 2 hours passed since last job, reset cycles ──
    if (state.lastJobTime > 0 && elapsed > 7200000) { // 2 hours
      console.log("🔄 [Worker] Over 2 hours since last job. Resetting session safety counters.");
      await saveState({ consecutiveCycles: 0, isPaused: false });
      state = await getState();
    }

    // Gate 2: Cooldown timer
    if (state.lastJobTime > 0 && elapsed < state.cooldownMs) {
      const remaining = Math.ceil((state.cooldownMs - elapsed) / 60000);
      console.log(`🛌 [Worker] Cooldown active. ${remaining} min remaining.`);
      sendHeartbeat("Sleeping", `${remaining}m cooldown`);
      isJobRunning = false;
      return;
    }

    // Gate 3: Auto-pause check
    if (state.isPaused) {
      // Trickle mode: after pause, allow 1 cycle per 10 min
      const trickleMs = 600000; // 10 min
      if (elapsed < trickleMs) {
        console.log(`⏸️ [Worker] PAUSED. Trickle mode: ${Math.ceil((trickleMs - elapsed) / 60000)} min left.`);
        sendHeartbeat("Paused", "Safety limit reached - Trickle running");
        isJobRunning = false;
        return;
      }
      console.log("⏸️ [Worker] Trickle mode: allowing 1 cycle.");
    }

    // Gate 4: Single tab — ensure no stale tab
    if (state.activeTabId !== null) {
      try {
        await chrome.tabs.remove(state.activeTabId);
        console.log(`🧹 [Worker] Cleaned stale tab ${state.activeTabId}.`);
      } catch (e) {}
      await saveState({ activeTabId: null });
    }

    // ── Fetch jobs from dashboard ──
    const config = await chrome.storage.sync.get(['dashboardUrl', 'userId', 'visibilityMode']);
    const { dashboardUrl, userId, visibilityMode = 'hidden' } = config;
    if (!dashboardUrl || !userId) {
      console.warn("⚠️ [Worker] Missing dashboardUrl or userId.");
      isJobRunning = false;
      return;
    }

    const response = await fetch(`${dashboardUrl}/api/extension/jobs`, {
        headers: { 'x-extension-token': userId, 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    // ── Dashboard Start/Stop detection (reset mechanism) ──
    const isActive = data.active === true;
    if (state.wasDashboardActive === false && isActive) {
        console.log("🔄 [Worker] Dashboard re-activated! Resetting cycle counter and pause.");
        await saveState({ consecutiveCycles: 0, isPaused: false });
        state = await getState();
    }
    await saveState({ wasDashboardActive: isActive });

    if (!isActive || !data.hasJobs || !data.keywords?.length) {
        console.log(`😴 [Worker] Idle. active=${isActive}, hasJobs=${data.hasJobs}`);
        sendHeartbeat("Idle", isActive ? "No jobs available" : "System Paused");
        isJobRunning = false;
        return;
    }

    // ── Auto-pause trigger (3 consecutive cycles) ──
    if (state.consecutiveCycles >= 3 && !state.isPaused) {
        const nextCooldown = randomCooldown();
        await saveState({
          isPaused: true,
          lastJobTime: now,
          cooldownMs: nextCooldown
        });
        console.log(`⏸️ [Worker] AUTO-PAUSED after 3 consecutive cycles.`);
        sendHeartbeat("Paused", "Auto-paused after 3 cycles");
        isJobRunning = false;
        return;
    }

    // ── Start cycle ──
    const kw = data.keywords[Math.floor(Math.random() * data.keywords.length)].keyword;
    const settings = data.settings || {};
    console.log(`🚀 [Worker] Starting cycle #${state.consecutiveCycles + 1} for: "${kw}"`);
    sendHeartbeat("Running", `Extracting: ${kw}`);
      
    // Exact pipeline logic combined with robust polling
    startScrapingCycle(kw, settings, dashboardUrl, userId, visibilityMode);

  } catch (error) {
    console.error("❌ [Worker] Poll failed:", error.message);
    sendHeartbeat("Error", "Check connection/keys");
    isJobRunning = false; // release lock on error
  }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ── Scraping Cycle (Robust messaging loop to fix "Receiving end does not exist") ──
async function startScrapingCycle(keyword, settings, dashboardUrl, userId, visibilityMode) {
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER`;

  try {
    const tab = await chrome.tabs.create({
      url: searchUrl,
      active: visibilityMode === 'visible'
    });
    
    // Save to storage async
    saveState({ activeTabId: tab.id }).catch(console.error);
    console.log(`💉 [Worker] Tab ${tab.id} created. Beginning robust injection checking...`);

    // Give the page at least 3 seconds to initially populate the DOM
    await sleep(3000);

    let connected = false;
    let retries = 5;

    while (retries > 0 && !connected) {
      if (retries < 5) console.log(`🔄 [Worker] Retrying injection... (${retries} retries left)`);
      
      try {
        const t = await chrome.tabs.get(tab.id);
        if (!t) break;
        
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });

        // Wait a short moment for script to evaluate and addListener
        await sleep(1000);
        
        // Wrap sendMessage in a promise to try-catch it cleanly
        const response = await new Promise((resolve, reject) => {
           chrome.tabs.sendMessage(tab.id, {
              action: 'EXECUTE_SEARCH', keyword, settings, dashboardUrl, userId
           }, (res) => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve(res);
           });
        });

        if (response && response.received) {
           console.log("✅ [Worker] Content script acknowledged and connected.");
           connected = true;
           break;
        }

      } catch (e) {
         console.warn(`[Worker] Inject warning: ${e.message}`);
      }
      
      retries--;
      if (!connected) await sleep(3000); // 3-second penalty before retry
    }

    if (!connected) {
       console.error("❌ [Worker] Comm error: Failed to establish strict connection after 5 retries.");
       chrome.tabs.remove(tab.id).catch(() => {});
       resetWorkerStateSilent();
    }

  } catch (err) {
    console.error("❌ [Worker] Cycle failed:", err.message);
    resetWorkerStateSilent();
  }
}

// ── Job Completion Handler ──
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'JOB_COMPLETED' || message.action === 'JOB_FAILED') {
    const status = message.action === 'JOB_COMPLETED' ? "✅ COMPLETED" : "❌ FAILED";
    console.log(`🏁 [Worker] Job ${status}.`);

    // Close the job tab
    if (sender.tab?.id) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    }

    resetWorkerState();
    
    // Log next action
    getState().then(state => {
      if (state.consecutiveCycles >= 3) {
        console.log(`⏸️ [Worker] Will auto-pause on next poll (3/3 cycles).`);
      } else {
        console.log(`🛌 [Worker] Cooldown: ~${Math.round(state.cooldownMs / 60000)} min before next cycle.`);
      }
    });
    
    sendHeartbeat("Resting", `Job completed. Resting.`);
  }
});

// ── Heartbeat Function ──
async function sendHeartbeat(status, message) {
  const config = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
  const { dashboardUrl, userId } = config;
  if (!dashboardUrl || !userId) return;

  try {
    const state = await getState();
    await fetch(`${dashboardUrl}/api/extension/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
      body: JSON.stringify({ 
        status, 
        message, 
        cycles: state.consecutiveCycles,
        isPaused: state.isPaused
      })
    });
  } catch (e) {
    // Silent fail on heartbeat
  }
}

// ── Alarm: Poll every 1 min  ──
chrome.alarms.create('checkJobsAlarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkJobsAlarm') {
    checkJobs();
    // Independent heartbeat ping every 3 mins even if resting heavily
    sendHeartbeat("Online", "Worker active");
  }
});

// ── Startup ──
chrome.runtime.onInstalled.addListener(() => {
  console.log("🚀 [Worker] LinkedIn Safety Worker v4 installed.");
  checkJobs();
});
chrome.runtime.onStartup.addListener(() => {
  console.log("⚙️ [Worker] Restarting / Browser opened...");
  checkJobs();
});
