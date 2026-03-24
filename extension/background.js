// LinkedIn Auto-Search Worker - Professional Edition 🛡️
// Handles background polling, safety cooldowns, and stealth extraction.

let isJobRunning = false;
let isResting = false; 
let lastJobTime = 0;

console.log("[Ext-Background] Professional Worker Initialized.");

/**
 * Main polling function
 * Checks dashboard for new keyword jobs
 */
async function checkJobs() {
  if (isJobRunning) {
    console.log("⏳ [WORKER] Task in progress, skipping poll...");
    return;
  }
  
  // Safety Rest Period (5-10 mins) check
  const now = Date.now();
  const COOLDOWN_MS = 300000; // 5 minutes floor
  if (isResting && (now - lastJobTime < COOLDOWN_MS)) {
      const waitMins = Math.ceil((COOLDOWN_MS - (now - lastJobTime)) / 60000);
      console.log(`🛌 [RESTING] Safety cooldown active. Waiting ${waitMins} more mins.`);
      return;
  }
  isResting = false;

  const config = await chrome.storage.sync.get(['dashboardUrl', 'userId', 'visibilityMode']);
  const { dashboardUrl, userId, visibilityMode = 'hidden' } = config;

  if (!dashboardUrl || !userId) {
    console.warn("⚠️ [CONFIG] Missing dashboardUrl or userId. Set them in the popup.");
    return;
  }

  try {
    console.log(`📡 [NETWORK] Polling Dashboard for active jobs...`);
    const response = await fetch(`${dashboardUrl}/api/extension/jobs`, {
        headers: { 'x-extension-token': userId, 'Cache-Control': 'no-cache' }
    });
    
    if (response.status === 401) {
        console.error("❌ [AUTH] Dashboard rejected API key. Check User ID.");
        return;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    console.log(`📥 [RESPONSE] Data:`, data);

    if (data.active && data.hasJobs && data.keywords?.length > 0) {
      isJobRunning = true;
      // Randomize keyword selection for human-like behavior if multiple exist
      const kw = data.keywords[Math.floor(Math.random() * data.keywords.length)].keyword;
      const settings = data.settings || {};
      
      console.log(`🚀 [JOB FOUND] Starting cycle for: ${kw}`);
      await startScrapingCycle(kw, settings, dashboardUrl, userId, visibilityMode);
    } else {
      console.log(`😴 [IDLE] No active tasks. SystemActive=${data.active}, hasJobs=${data.hasJobs}`);
    }
  } catch (error) {
    console.error("❌ [NETWORK] Polling failed:", error.message);
  }
}

/**
 * Executes a single scraping task in a dedicated tab
 */
async function startScrapingCycle(keyword, settings, dashboardUrl, userId, visibilityMode) {
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER`;
  
  try {
    // Visibility Mode: 'hidden' means the tab is created in background (active: false)
    const tab = await chrome.tabs.create({ 
        url: searchUrl, 
        active: visibilityMode === 'visible' 
    });
    
    console.log(`💉 [INJECT] Waiting for tab ${tab.id} to stabilize (4s)...`);
    
    setTimeout(async () => {
        // Double Check: Has the user/LinkedIn closed the tab already?
        chrome.tabs.get(tab.id, async (t) => {
            if (chrome.runtime.lastError || !t) {
                console.warn("⚠️ [TAB-LOST] Job tab closed before injection started.");
                resetWorkerState();
                return;
            }

            try {
                // NEW: FORCE Injection to ensure content.js is 100% active before messaging
                console.log("🛠️ [FORCE] Injecting Content Script manually...");
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });

                // Small delay to allow script to boot
                setTimeout(() => {
                    console.log("🚀 [TRIGGER] Sending EXECUTE_SEARCH to content script...");
                    chrome.tabs.sendMessage(tab.id, { 
                        action: 'EXECUTE_SEARCH', 
                        keyword, settings, dashboardUrl, userId 
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                           console.error("❌ [COMM-ERROR] Content script failed to respond.", chrome.runtime.lastError.message);
                           chrome.tabs.remove(tab.id).catch(() => {});
                           resetWorkerState();
                        } else {
                           console.log("✅ [SUCCESS] Content script acknowledged job start.");
                        }
                    });
                }, 1000);

            } catch (injectErr) {
                console.error("❌ [INJECT-FAIL] Could not force inject script:", injectErr.message);
                chrome.tabs.remove(tab.id).catch(() => {});
                resetWorkerState();
            }
        });
    }, 4000); 

  } catch (err) {
    console.error("❌ [CYCLE-ERROR] Failed to start job cycle:", err.message);
    resetWorkerState();
  }
}

function resetWorkerState() {
    isJobRunning = false;
    isResting = true;
    lastJobTime = Date.now();
}

/**
 * Handles job completion signals from the content script
 */
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'JOB_COMPLETED' || message.action === 'JOB_FAILED') {
    const status = message.action === 'JOB_COMPLETED' ? "COMPLETED" : "FAILED";
    console.log(`🏁 [FINISH] Job ${status}. Reason/Error: ${message.error || 'None'}`);
    
    if (sender.tab?.id) {
       console.log("🧹 [CLEANUP] Removing automated tab.");
       chrome.tabs.remove(sender.tab.id).catch(() => {});
    }
    
    resetWorkerState();
    console.log("🛌 [COOLDOWN] Entering mandatory resting period.");
  }
});

// Periodic Poll: Every 1 min (Resting period logic determines if we actually fetch)
chrome.alarms.create('checkJobsAlarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkJobsAlarm') checkJobs();
});

// Handlers for Startup
chrome.runtime.onInstalled.addListener(() => {
  console.log("🚀 [INSTALLED] LinkedIn Automation Pro v2 ready.");
  checkJobs();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("⚙️ [STARTUP] Restarting worker...");
  checkJobs();
});
