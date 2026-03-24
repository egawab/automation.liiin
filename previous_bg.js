// ظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـ
// LinkedIn Safety Worker v3 ظ¤ Anti-Detection Scheduling
// ظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـ
// Rules:
// 1. ONE tab at a time (single-tab enforcement)
// 2. 10-15 min random cooldown between cycles
// 3. Auto-pause after 3 consecutive cycles
// 4. Resume only when user toggles Dashboard Start (systemActive offظْon)
// 5. Trickle mode: after pause, 1 cycle per ~10 min max
// ظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـظـ

// ظ¤ظ¤ State ظ¤ظ¤
let isJobRunning = false;
let activeTabId = null;           // Single-tab enforcement
let lastJobTime = 0;
let cooldownMs = 0;               // Randomized each cycle
let consecutiveCycles = 0;        // Auto-pause counter
let isPaused = false;             // True after 3 cycles ظْ needs dashboard restart
let wasDashboardActive = null;    // Track systemActive transitions for manual reset

console.log("[Worker] ظـظـظـ Safety Worker v3 Initialized ظـظـظـ");

// ظ¤ظ¤ Helpers ظ¤ظ¤
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

// ظ¤ظ¤ Main Poll ظ¤ظ¤
async function checkJobs() {
  // Gate 1: Already running
  if (isJobRunning) {
    console.log("ظ│ [Worker] Job in progress, skipping poll.");
    return;
  }

  // Gate 2: Cooldown timer
  const elapsed = Date.now() - lastJobTime;
  if (lastJobTime > 0 && elapsed < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - elapsed) / 60000);
    console.log(`≡اؤî [Worker] Cooldown active. ${remaining} min remaining.`);
    return;
  }

  // Gate 3: Auto-pause check
  if (isPaused) {
    // Trickle mode: after pause, allow 1 cycle per 10 min
    const trickleMs = 600000; // 10 min
    if (elapsed < trickleMs) {
      console.log(`ظ╕ي╕ [Worker] PAUSED after ${consecutiveCycles} cycles. Trickle mode: ${Math.ceil((trickleMs - elapsed) / 60000)} min left.`);
      return;
    }
    console.log("ظ╕ي╕ [Worker] Trickle mode: allowing 1 cycle.");
  }

  // Gate 4: Single tab ظ¤ ensure no stale tab
  if (activeTabId !== null) {
    try {
      await chrome.tabs.remove(activeTabId);
      console.log(`≡اد╣ [Worker] Cleaned stale tab ${activeTabId}.`);
    } catch (e) {}
    activeTabId = null;
  }

  // ظ¤ظ¤ Fetch jobs from dashboard ظ¤ظ¤
  const config = await chrome.storage.sync.get(['dashboardUrl', 'userId', 'visibilityMode']);
  const { dashboardUrl, userId, visibilityMode = 'hidden' } = config;
  if (!dashboardUrl || !userId) {
    console.warn("ظأبي╕ [Worker] Missing dashboardUrl or userId.");
    return;
  }

  try {
    const response = await fetch(`${dashboardUrl}/api/extension/jobs`, {
      headers: { 'x-extension-token': userId, 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    // ظ¤ظ¤ Dashboard Start/Stop detection (reset mechanism) ظ¤ظ¤
    const isActive = data.active === true;
    if (wasDashboardActive === false && isActive) {
      // User toggled Start on the Dashboard ظْ RESET pause
      console.log("≡ا¤ [Worker] Dashboard re-activated! Resetting cycle counter and pause.");
      consecutiveCycles = 0;
      isPaused = false;
    }
    wasDashboardActive = isActive;

    if (!isActive || !data.hasJobs || !data.keywords?.length) {
      console.log(`≡اء┤ [Worker] Idle. active=${isActive}, hasJobs=${data.hasJobs}`);
      return;
    }

    // ظ¤ظ¤ Auto-pause trigger (3 consecutive cycles) ظ¤ظ¤
    if (consecutiveCycles >= 3 && !isPaused) {
      isPaused = true;
      lastJobTime = Date.now();
      cooldownMs = randomCooldown();
      console.log(`ظ╕ي╕ [Worker] AUTO-PAUSED after ${consecutiveCycles} consecutive cycles.`);
      console.log(`ظ╕ي╕ [Worker] Toggle Dashboard OFF then ON to resume, or wait for trickle mode.`);
      return;
    }

    // ظ¤ظ¤ Start cycle ظ¤ظ¤
    isJobRunning = true;
    const kw = data.keywords[Math.floor(Math.random() * data.keywords.length)].keyword;
    const settings = data.settings || {};
    console.log(`≡اأ [Worker] Starting cycle #${consecutiveCycles + 1} for: "${kw}"`);
    await startScrapingCycle(kw, settings, dashboardUrl, userId, visibilityMode);

  } catch (error) {
    console.error("ظإî [Worker] Poll failed:", error.message);
  }
}

// ظ¤ظ¤ Scraping Cycle (unchanged logic, added single-tab tracking) ظ¤ظ¤
async function startScrapingCycle(keyword, settings, dashboardUrl, userId, visibilityMode) {
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER`;

  try {
    const tab = await chrome.tabs.create({
      url: searchUrl,
      active: visibilityMode === 'visible'
    });
    activeTabId = tab.id; // Track for single-tab enforcement

    console.log(`≡اْë [Worker] Tab ${tab.id} created. Waiting 4s for load...`);

    setTimeout(async () => {
      chrome.tabs.get(tab.id, async (t) => {
        if (chrome.runtime.lastError || !t) {
          console.warn("ظأبي╕ [Worker] Tab lost before injection.");
          resetWorkerState();
          return;
        }

        try {
          console.log("≡اؤبي╕ [Worker] Force-injecting content.js...");
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });

          setTimeout(() => {
            console.log("≡اأ [Worker] Sending EXECUTE_SEARCH...");
            chrome.tabs.sendMessage(tab.id, {
              action: 'EXECUTE_SEARCH', keyword, settings, dashboardUrl, userId
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.error("ظإî [Worker] Comm error:", chrome.runtime.lastError.message);
                chrome.tabs.remove(tab.id).catch(() => {});
                resetWorkerState();
              } else {
                console.log("ظ£à [Worker] Content script acknowledged.");
              }
            });
          }, 1000);

        } catch (e) {
          console.error("ظإî [Worker] Inject failed:", e.message);
          chrome.tabs.remove(tab.id).catch(() => {});
          resetWorkerState();
        }
      });
    }, 4000);

  } catch (err) {
    console.error("ظإî [Worker] Cycle failed:", err.message);
    resetWorkerState();
  }
}

// ظ¤ظ¤ Job Completion Handler ظ¤ظ¤
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'JOB_COMPLETED' || message.action === 'JOB_FAILED') {
    const status = message.action === 'JOB_COMPLETED' ? "ظ£à COMPLETED" : "ظإî FAILED";
    console.log(`≡ا [Worker] Job ${status}.`);

    // Close the job tab
    if (sender.tab?.id) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    }

    resetWorkerState();

    // Log next action
    if (consecutiveCycles >= 3) {
      console.log(`ظ╕ي╕ [Worker] Will auto-pause on next poll (${consecutiveCycles}/3 cycles).`);
    } else {
      console.log(`≡اؤî [Worker] Cooldown: ~${Math.round(cooldownMs / 60000)} min before next cycle.`);
    }
  }
});

// ظ¤ظ¤ Alarm: Poll every 1 min  ظ¤ظ¤
chrome.alarms.create('checkJobsAlarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkJobsAlarm') checkJobs();
});

// ظ¤ظ¤ Startup ظ¤ظ¤
chrome.runtime.onInstalled.addListener(() => {
  console.log("≡اأ [Worker] LinkedIn Safety Worker v3 installed.");
  checkJobs();
});
chrome.runtime.onStartup.addListener(() => {
  console.log("ظأآي╕ [Worker] Restarting...");
  checkJobs();
});
