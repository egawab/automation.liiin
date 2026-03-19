// LinkedIn Auto-Search Worker - Background Service
// Polls the server periodically for new jobs without closing

chrome.runtime.onInstalled.addListener(() => {
  console.log("LinkedIn Auto-Search Worker Installed");
  setupPolling();
});

chrome.runtime.onStartup.addListener(() => {
  setupPolling();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_POLLING') {
    console.log("Got start polling signal from popup");
    setupPolling();
    checkJobs(); // Immediate trigger
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pollJobsAlarm') {
    checkJobs();
  }
});

function setupPolling() {
  chrome.alarms.get('pollJobsAlarm', (alarm) => {
    if (!alarm) {
      // Poll every 20 seconds (0.33 minutes) for a more immediate experience
      chrome.alarms.create('pollJobsAlarm', { periodInMinutes: 0.33 });
    }
  });
}

let isJobRunning = false;

async function checkJobs() {
  if (isJobRunning) {
    console.log("⏳ [WORKER] Task in progress, skipping poll...");
    return;
  }

  chrome.storage.sync.get(['dashboardUrl', 'userId'], async (result) => {
    const { dashboardUrl, userId } = result;
    
    if (!dashboardUrl || !userId) {
       console.log("❌ [CONFIG] Missing Dashboard URL or User ID. Please check the extension popup.");
       return;
    }

    // Heartbeat to show it's alive
    console.log("💓 [HEARTBEAT] Extension is active and listening for your commands...");

    try {
      const apiUrl = `${dashboardUrl}/api/extension/jobs`;
      console.log(`📡 [NETWORK] Polling: ${apiUrl} ...`);
      
      const resp = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'x-extension-token': userId,
          'Cache-Control': 'no-cache'
        }
      });
      
      console.log(`📥 [RESPONSE] Status: ${resp.status} ${resp.statusText}`);
      
      if (!resp.ok) {
        const errText = await resp.text();
        console.error("❌ [SERVER ERROR]", errText);
        return;
      }
      
      const data = await resp.json();
      console.log("📊 [DATA RECEIVED]", data);
      
      if (data.active && data.hasJobs && data.keywords && data.keywords.length > 0) {
        console.log(`🚀 [JOB FOUND] Starting cycle for: ${data.keywords[0].keyword}`);
        startJobCycle(dashboardUrl, userId, data.keywords, data.settings);
      } else {
         console.log(`😴 [IDLE] No jobs found. SystemActive: ${data.active}, hasJobs: ${data.hasJobs}`);
      }
    } catch (e) {
      console.error("🔥 [NETWORK FAIL] Could not reach your dashboard. Check your URL and Internet connection.", e);
    }
  });
}

function startJobCycle(dashboardUrl, userId, keywords, settings) {
  isJobRunning = true;
  
  // Pick one random active keyword to simulate human focus per cycle
  const kwObj = keywords[Math.floor(Math.random() * keywords.length)];
  const keyword = kwObj.keyword;
  
  console.log(`Starting job cycle for keyword: ${keyword}`);
  
  // Open a new LinkedIn Search tab
  // We make it active: true so the browser doesn't throttle background scripts/scrolls
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER`;
  
  chrome.tabs.create({ url: searchUrl, active: true }, async (tab) => {
    const activeTabId = tab.id;
    
    // Modern Programmatic Injection & Execution
    // We wait 5 seconds for the page shell to load
    setTimeout(async () => {
      try {
        console.log(`💉 [INJECT] Injecting & Triggering on tab ${activeTabId}...`);
        
        // Signal Start to Dashboard
        fetch(`${dashboardUrl}/api/extension/results`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
          body: JSON.stringify({ keyword, posts: [], debugInfo: `START_CYCLE: ${keyword}` })
        }).catch(()=>{});

        // 1. Inject the library
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          files: ['content.js']
        });

    // 2. Trigger via Message (Add 2s delay to ensure listener is ready)
    setTimeout(() => {
        console.log("🚀 [TRIGGER] Sending EXECUTE_SEARCH command...");
        chrome.tabs.sendMessage(activeTabId, {
          action: 'EXECUTE_SEARCH',
          keyword,
          settings,
          dashboardUrl,
          userId
        }).then(() => {
          console.log("✅ [SUCCESS] Content script confirmed receipt!");
        }).catch(err => {
          console.warn("⚠️ [RETRY] Message failed, trying one more time...", err);
          chrome.tabs.sendMessage(activeTabId, {
              action: 'EXECUTE_SEARCH',
              keyword,
              settings,
              dashboardUrl,
              userId
          }).catch(()=>{});
        });
    }, 2000);

  } catch (err) {
    console.error("❌ [RUN-ERROR] Critical failure:", err);
    chrome.tabs.remove(activeTabId).catch(()=>{});
    isJobRunning = false;
  }
}, 5000); 
});
}

// Listen for completion results from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'JOB_COMPLETED' || request.action === 'JOB_FAILED') {
    
    if (sender.tab && sender.tab.id) {
       console.log(`Job cycle finished (${request.action}). Closing automated tab.`);
       chrome.tabs.remove(sender.tab.id).catch(() => {});
    }
    
    // Wait an additional human delay before allowing another job
    setTimeout(() => {
      isJobRunning = false;
      console.log("Worker is free for next job cycle.");
    }, 10000);
  }
});
