// ═══════════════════════════════════════════════════════════
// LinkedIn Safety Worker v3 — Anti-Detection Scheduling
// ═══════════════════════════════════════════════════════════
// Rules:
// 1. ONE tab at a time (single-tab enforcement)
// 2. 10-15 min random cooldown between cycles
// 3. Auto-pause after 3 consecutive cycles
// 4. Resume only when user toggles Dashboard Start (systemActive off→on)
// 5. Trickle mode: after pause, 1 cycle per ~10 min max
// ═══════════════════════════════════════════════════════════

// ── State ──
let isJobRunning = false;
let activeTabId = null;           // Single-tab enforcement
let lastJobTime = 0;
let cooldownMs = 0;               // Randomized each cycle
let consecutiveCycles = 0;        // Auto-pause counter
let isPaused = false;             // True after 3 cycles → needs dashboard restart
let wasDashboardActive = null;    // Track systemActive transitions for manual reset

console.log("[Worker] ═══ Safety Worker v3 Initialized ═══");

// ── Helpers ──
function randomCooldown() {
  // 10-15 minutes, randomized each time
  return 600000 + Math.floor(Math.random() * 300000);
}

function resetWorkerState() {
  isJobRunning = false;
  activeTabId = null;
  lastJobTime = Date.now();
  cooldownMs = randomCooldown();
  consecutiveCycles++;
  console.log(`[Worker] Cycle #${consecutiveCycles} done. Next cooldown: ${Math.round(cooldownMs / 60000)} min.`);
}

// ── Main Poll ──
async function checkJobs() {
  // Gate 1: Already running
  if (isJobRunning) {
    console.log("⏳ [Worker] Job in progress, skipping poll.");
    return;
  }

  // Gate 2: Cooldown timer
  const elapsed = Date.now() - lastJobTime;
  if (lastJobTime > 0 && elapsed < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - elapsed) / 60000);
    console.log(`🛌 [Worker] Cooldown active. ${remaining} min remaining.`);
    return;
  }

  // Gate 3: Auto-pause check
  if (isPaused) {
    // Trickle mode: after pause, allow 1 cycle per 10 min
    const trickleMs = 600000; // 10 min
    if (elapsed < trickleMs) {
      console.log(`⏸️ [Worker] PAUSED after ${consecutiveCycles} cycles. Trickle mode: ${Math.ceil((trickleMs - elapsed) / 60000)} min left.`);
      return;
    }
    console.log("⏸️ [Worker] Trickle mode: allowing 1 cycle.");
  }

  // Gate 4: Single tab — ensure no stale tab
  if (activeTabId !== null) {
    try {
      await chrome.tabs.remove(activeTabId);
      console.log(`🧹 [Worker] Cleaned stale tab ${activeTabId}.`);
    } catch (e) {}
    activeTabId = null;
  }

  // ── Fetch jobs from dashboard ──
  const config = await chrome.storage.sync.get(['dashboardUrl', 'userId', 'visibilityMode']);
  const { dashboardUrl, userId, visibilityMode = 'hidden' } = config;
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

    // ── Dashboard Start/Stop detection (reset mechanism) ──
    const isActive = data.active === true;
    if (wasDashboardActive === false && isActive) {
      // User toggled Start on the Dashboard → RESET pause
      console.log("🔄 [Worker] Dashboard re-activated! Resetting cycle counter and pause.");
      consecutiveCycles = 0;
      isPaused = false;
    }
    wasDashboardActive = isActive;

    if (!isActive || !data.hasJobs || !data.keywords?.length) {
      console.log(`😴 [Worker] Idle. active=${isActive}, hasJobs=${data.hasJobs}`);
      return;
    }

    // ── Auto-pause trigger (3 consecutive cycles) ──
    if (consecutiveCycles >= 3 && !isPaused) {
      isPaused = true;
      lastJobTime = Date.now();
      cooldownMs = randomCooldown();
      console.log(`⏸️ [Worker] AUTO-PAUSED after ${consecutiveCycles} consecutive cycles.`);
      console.log(`⏸️ [Worker] Toggle Dashboard OFF then ON to resume, or wait for trickle mode.`);
      return;
    }

    // ── Start cycle ──
    isJobRunning = true;
    const kw = data.keywords[Math.floor(Math.random() * data.keywords.length)].keyword;
    const settings = data.settings || {};
    console.log(`🚀 [Worker] Starting cycle #${consecutiveCycles + 1} for: "${kw}"`);
    await startScrapingCycle(kw, settings, dashboardUrl, userId, visibilityMode);

  } catch (error) {
    console.error("❌ [Worker] Poll failed:", error.message);
  }
}

// ── Scraping Cycle (unchanged logic, added single-tab tracking) ──
async function startScrapingCycle(keyword, settings, dashboardUrl, userId, visibilityMode) {
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER`;

  try {
    const tab = await chrome.tabs.create({
      url: searchUrl,
      active: visibilityMode === 'visible'
    });
    activeTabId = tab.id; // Track for single-tab enforcement

    console.log(`💉 [Worker] Tab ${tab.id} created. Waiting 4s for load...`);

    setTimeout(async () => {
      chrome.tabs.get(tab.id, async (t) => {
        if (chrome.runtime.lastError || !t) {
          console.warn("⚠️ [Worker] Tab lost before injection.");
          resetWorkerState();
          return;
        }

        try {
          console.log("🛠️ [Worker] Force-injecting content.js...");
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });

          setTimeout(() => {
            console.log("🚀 [Worker] Sending EXECUTE_SEARCH...");
            chrome.tabs.sendMessage(tab.id, {
              action: 'EXECUTE_SEARCH', keyword, settings, dashboardUrl, userId
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.error("❌ [Worker] Comm error:", chrome.runtime.lastError.message);
                chrome.tabs.remove(tab.id).catch(() => {});
                resetWorkerState();
              } else {
                console.log("✅ [Worker] Content script acknowledged.");
              }
            });
          }, 1000);

        } catch (e) {
          console.error("❌ [Worker] Inject failed:", e.message);
          chrome.tabs.remove(tab.id).catch(() => {});
          resetWorkerState();
        }
      });
    }, 4000);

  } catch (err) {
    console.error("❌ [Worker] Cycle failed:", err.message);
    resetWorkerState();
  }
}

// ── Job Completion Handler ──
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'SYNC_RESULTS') {
    const { posts, keyword, dashboardUrl, userId, debugInfo } = message;
    console.log(`📤 [Worker] Relaying ${posts?.length || 0} posts to dashboard...`);
    fetch(`${dashboardUrl}/api/extension/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
      body: JSON.stringify({ keyword, posts, debugInfo })
    }).catch(e => console.error("❌ [Worker] Relay failed:", e));
    return;
  }

  if (message.action === 'JOB_COMPLETED' || message.action === 'JOB_FAILED') {
    const status = message.action === 'JOB_COMPLETED' ? "✅ COMPLETED" : "❌ FAILED";
    console.log(`🏁 [Worker] Job ${status}.`);

    // Close the job tab
    if (sender.tab?.id) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    }

    resetWorkerState();

    // Log next action
    if (consecutiveCycles >= 3) {
      console.log(`⏸️ [Worker] Will auto-pause on next poll (${consecutiveCycles}/3 cycles).`);
    } else {
      console.log(`🛌 [Worker] Cooldown: ~${Math.round(cooldownMs / 60000)} min before next cycle.`);
    }
  }
});

// ── Alarm: Poll every 1 min  ──
chrome.alarms.create('checkJobsAlarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkJobsAlarm') checkJobs();
});

// ── Startup ──
chrome.runtime.onInstalled.addListener(() => {
  console.log("🚀 [Worker] LinkedIn Safety Worker v3 installed.");
  checkJobs();
});
chrome.runtime.onStartup.addListener(() => {
  console.log("⚙️ [Worker] Restarting...");
  checkJobs();
});
