// ═══════════════════════════════════════════════════════════
// LinkedIn Safety Worker v6 — Stable & Deterministic
// ═══════════════════════════════════════════════════════════
// v6 Changes:
//   - Fixed 15-minute cooldown between cycles (no randomness)
//   - cycleIndex is strictly 1-based (matching dashboard)
//   - Enforces exactly 2 comments per cycle
//   - Search-only mode iterates ALL keywords per cycle
//   - Per-hour comment cap: 4 comments/hour
//   - Exponential backoff on failed cycles
//   - First-cycle warm-up delay
// ═══════════════════════════════════════════════════════════

console.log("[Worker] ═══ Safety Worker v6 (Stable) Initialized ═══");

// ── Persistent State (chrome.storage.local) ──
async function loadState() {
  return chrome.storage.local.get({
    isJobRunning: false,
    activeTabId: null,
    cycleStartTime: 0,
    lastJobTime: 0,
    cooldownMs: 0,
    isPaused: false,
    keywordCycles: {},
    currentKeyword: null,
    wasDashboardActive: null,
    dailyCommentsMade: 0,
    hourlyCommentsMade: 0,
    lastCommentDate: null,
    lastCommentHour: -1,
    keywordSearchPages: {},
    consecutiveFailures: 0,
    currentSearchCycle: 0,
    activityLog: []
  });
}

// ── Live Badge Update ──
async function updateBadge() {
  const s = await loadState();
  let text = s.dailyCommentsMade ? String(s.dailyCommentsMade) : '0';
  let color = '#6b7280';

  if (s.isPaused) {
    color = '#ef4444';
    text = 'PAUSED';
  } else if (s.isJobRunning) {
    color = '#10b981';
  } else {
    const elapsed = Date.now() - (s.lastJobTime || 0);
    if (s.lastJobTime > 0 && elapsed < (s.cooldownMs || 0)) {
      color = '#f59e0b';
    } else {
      color = '#6b7280';
    }
  }

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

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
      :host { --toast-bg:#ffffff; --toast-border:rgba(0,0,0,0.08); --toast-text:#1d1d1f; --toast-sec:rgba(0,0,0,0.56); --shadow:rgba(0,0,0,0.1) 0 8px 30px; }
      @media (prefers-color-scheme: dark) { :host { --toast-bg:#1d1d1f; --toast-border:rgba(255,255,255,0.05); --toast-text:#ffffff; --toast-sec:rgba(255,255,255,0.48); --shadow:rgba(0,0,0,0.4) 0 8px 30px; } }
      .toast { width:320px; background:var(--toast-bg); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid var(--toast-border); border-radius:12px; padding:16px 20px; color:var(--toast-text); font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif; box-shadow:var(--shadow); transform:translateX(120%); opacity:0; transition:all 0.4s cubic-bezier(0.175,0.885,0.32,1.275); display:flex; gap:14px; align-items:flex-start; overflow:hidden; position:relative; }
      .toast.show { transform:translateX(0); opacity:1; }
      .toast.hiding { transform:translateX(120%); opacity:0; }
      .icon { font-size:20px; line-height:1; filter:drop-shadow(0 0 8px ${accent}60); }
      .content { flex:1; }
      .title { font-size:14px; font-weight:600; margin:0 0 4px 0; color:var(--toast-text); letter-spacing:-0.01em; }
      .message { font-size:13px; font-weight:400; margin:0; color:var(--toast-sec); line-height:1.4; }
      .progress { position:absolute; bottom:0; left:0; height:3px; background:${accent}; width:100%; animation:shrink 4s linear forwards; }
      @keyframes shrink { from { width:100%; } to { width:0%; } }
    </style>
    <div class="toast">
      <div class="icon">${icon}</div>
      <div class="content"><h4 class="title">${title}</h4><p class="message">${message}</p></div>
      <div class="progress"></div>
    </div>`;
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
    const win = await chrome.windows.getLastFocused();
    if (win && win.focused) {
      const tabs = await chrome.tabs.query({ active: true, windowId: win.id });
      if (tabs.length > 0 && tabs[0].url && tabs[0].url.startsWith('http')) {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: injectToastDOM,
          args: [title, message, isError]
        });
        return;
      }
    }
  } catch (e) { console.warn("Failed to inject toast:", e); }
  chrome.notifications.create({
    type: 'basic', iconUrl: 'icon-48.png',
    title, message, priority: 1
  });
}

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Fixed 15-minute cooldown between cycles for predictability and safety
const CYCLE_COOLDOWN_MS = 900000; // 15 minutes exactly

function getCooldown(consecutiveFailures = 0) {
  // Exponential backoff: 15 min → 20 min → 30 min on consecutive failures
  if (consecutiveFailures >= 2) return 1800000; // 30 min
  if (consecutiveFailures >= 1) return 1200000; // 20 min
  return CYCLE_COOLDOWN_MS; // 15 min
}

function waitForTabLoad(tabId, timeoutMs = 20000) {
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
    // FIX-1 + FIX-5: Use cycleStartTime (stamped when we open the tab) for stale detection.
    // The real pipeline worst-case: 7s hydration + 87s scrolling + ~60s commenting = ~155s.
    // We allow 10 minutes (600000ms) before declaring a job stale.
    const STALE_TIMEOUT_MS = 600000; // 10 minutes
    const runningTime = Date.now() - (state.cycleStartTime || state.lastJobTime || 0);
    if (runningTime < STALE_TIMEOUT_MS) {
      console.log(`⏳ [Worker] Job in progress (${Math.round(runningTime/1000)}s), skipping poll.`);
      return;
    }
    console.log("🧹 [Worker] Stale job detected (10min+). Cleaning up...");
    if (state.activeTabId) {
      try { await chrome.tabs.remove(state.activeTabId); } catch (e) {}
    }
    await saveState({ isJobRunning: false, activeTabId: null, cycleStartTime: 0 });
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
    if (state.wasDashboardActive === false && isActive) {
      console.log("🔄 [Worker] Dashboard turned active. Resetting cycles and daily limits.");
      await saveState({
        keywordCycles: {},
        isPaused: false,
        wasDashboardActive: true,
        lastJobTime: 0,
        dailyCommentsMade: 0,
        currentSearchCycle: 0,
        cycleStartTime: 0
      });
      state.keywordCycles = {};
      state.isPaused = false;
      state.wasDashboardActive = true;
      state.lastJobTime = 0;
      state.dailyCommentsMade = 0;
      state.currentSearchCycle = 0;
    } else {
      await saveState({ wasDashboardActive: isActive });
    }

    const settings = data.settings || {};

    if (!isActive || !data.hasJobs) {
      console.log(`😴 [Worker] Idle. active=${isActive}, hasJobs=${data.hasJobs}`);
      return;
    }

    if (!settings.searchOnlyMode) {
      // ═══════════════════════════════════════════════════════════
      // LEGACY COMMENT MODE: Restrict payload using comment keyword cycles
      // ═══════════════════════════════════════════════════════════
      if (!data.keywords?.length) {
        console.log(`😴 [Worker] Idle: Comment campaigns missing.`);
        return;
      }
      
      const kc = (await loadState()).keywordCycles || {};
      const availableKeywords = data.keywords.filter(k => (kc[k.keyword] || 0) < (k.targetCycles || 1));

      // Auto-pause if all comment keywords hit limit
      if (availableKeywords.length === 0) {
        if (!state.isPaused) {
          await saveState({ isPaused: true, lastJobTime: Date.now(), cooldownMs: randomCooldown(), dailyCommentsMade: 0 });
          console.log("⏸️ [Worker] AUTO-PAUSED: All comment keywords completed their target cycles.");
          try {
            await fetch(`${dashboardUrl}/api/settings`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
              body: JSON.stringify({ systemActive: false })
            });
            console.log("✅ [Worker] Dashboard systemActive set to FALSE.");
          } catch(e) {}
        }
        return;
      }
      
      // Inject availableKeywords into data for traditional loop access below
      data.availableKeywords = availableKeywords; 
    }

    // Unpause if new valid jobs exist
    if (state.isPaused) {
      await saveState({ isPaused: false });
    }

    // ── Safety Limit Resets ──
    const today = new Date().toDateString();
    const currentHour = new Date().getHours();
    if (state.lastCommentDate !== today) {
      state.dailyCommentsMade = 0;
      state.hourlyCommentsMade = 0;
      await saveState({ dailyCommentsMade: 0, hourlyCommentsMade: 0, lastCommentDate: today, lastCommentHour: currentHour });
      console.log("📅 [Worker] New day started. Reset daily comment quota.");
    }
    if (state.lastCommentHour !== currentHour) {
      state.hourlyCommentsMade = 0;
      await saveState({ hourlyCommentsMade: 0, lastCommentHour: currentHour });
      console.log("🕐 [Worker] New hour started. Reset hourly comment quota.");
    }

    const allComments = data.comments || [];

    // ═══════════════════════════════════════════════════════════
    // SEARCH-ONLY MODE: Emulate cycle tracking driven by config
    // ═══════════════════════════════════════════════════════════
    if (settings.searchOnlyMode) {
      let searchConfig = [];
      try {
        searchConfig = JSON.parse(settings.searchConfigJson || "[]");
      } catch (e) {
        console.warn("⚠️ [Worker] Failed to parse searchConfigJson", e);
      }
      
      const targetSearchCycles = searchConfig.length;
      
      if (targetSearchCycles === 0) {
        console.warn("⚠️ [Worker] Search-Only mode active but no cycles configured. Waiting...");
        return;
      }
      
      const currentCycleNum = state.currentSearchCycle || 0;
      
      if (currentCycleNum >= targetSearchCycles) {
        if (!state.isPaused) {
          await saveState({ isPaused: true, lastJobTime: Date.now(), cooldownMs: CYCLE_COOLDOWN_MS });
          console.log("⏸️ [Worker] AUTO-PAUSED: All search cycles completed.");
          // Also set dashboard active to false
          try {
            await fetch(`${dashboardUrl}/api/settings`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
              body: JSON.stringify({ systemActive: false })
            });
            console.log("✅ [Worker] Dashboard systemActive set to FALSE.");
          } catch(e) {}
        }
        return;
      }
      
      const keywordsToSearch = searchConfig[currentCycleNum] || [];
      // Clean empty keywords
      const cleanKeywords = keywordsToSearch.filter(k => (typeof k === 'string' && k.trim().length > 0));

      console.log(`🔍 [Worker] SEARCH-ONLY CYCLE ${currentCycleNum + 1}/${targetSearchCycles}: Processing ${cleanKeywords.length} keyword(s)...`);
      await saveState({
        isJobRunning: true,
        cycleStartTime: Date.now(),
        liveStatusText: `🔍 Search cycle ${currentCycleNum + 1}: Processing ${cleanKeywords.length} keywords...`
      });

      if (cleanKeywords.length > 0) {
        for (let ki = 0; ki < cleanKeywords.length; ki++) {
          const kwStr = cleanKeywords[ki];
          const searchPages = (await loadState()).keywordSearchPages || {};
          const pageNum = (searchPages[kwStr] || 0) + 1;

          console.log(`🔍 [Worker] Search-only keyword ${ki+1}/${cleanKeywords.length}: "${kwStr}" (Page ${pageNum})`);
          showPremiumToast('Search Mode', `Searching: "${kwStr}" (${ki+1}/${cleanKeywords.length})`, false);

          await saveState({
            currentKeyword: kwStr,
            liveStatusText: `🔍 Searching "${kwStr}" (${ki+1}/${cleanKeywords.length})...`
          });

          // Phase 1 mode bypasses comment arrays
          await startScrapingCycle(kwStr, settings, [], dashboardUrl, userId, currentCycleNum + 1, pageNum);

          // Wait 3-5 min between keywords within a cycle (unless it's the last one)
          if (ki < cleanKeywords.length - 1) {
            const interKeywordDelay = 180000 + Math.floor(Math.random() * 120000); // 3-5 min
            const delayMin = Math.round(interKeywordDelay / 60000);
            console.log(`⏳ [Worker] Waiting ${delayMin} min before next keyword...`);
            await saveState({ liveStatusText: `⏳ Cooling down ${delayMin} min before next keyword...` });
            await sleep(interKeywordDelay);
          }
        }
      } else {
        console.log(`⚠️ [Worker] Cycle ${currentCycleNum + 1} has zero keywords. Skipping...`);
      }

      // Finish Search Cycle & trigger cooldown
      await saveState({
        isJobRunning: false,
        activeTabId: null,
        cycleStartTime: 0,
        lastJobTime: Date.now(),
        cooldownMs: CYCLE_COOLDOWN_MS,
        currentKeyword: null,
        currentSearchCycle: currentCycleNum + 1, // Advance cycle
        liveStatusText: ''
      });

      const cdMin = Math.round(CYCLE_COOLDOWN_MS / 60000);
      console.log(`[Worker] Search cycle ${currentCycleNum + 1} done. Cooldown: ${cdMin} min.`);
      showPremiumToast('Search Complete', `✅ Search cycle ${currentCycleNum + 1} completed. Next in ${cdMin} min.`, false);
      return;
    }


    // ═══════════════════════════════════════════════════════════
    // COMMENT MODE: Pick one keyword, enforce exactly 2 comments
    // ═══════════════════════════════════════════════════════════
    const available = data.availableKeywords || [];
    if (available.length === 0) return;
    
    const kwObj = available[Math.floor(Math.random() * available.length)];
    const kw = kwObj.keyword;
    const kc = (await loadState()).keywordCycles || {};
    const cycleNum = (kc[kw] || 0) + 1;

    // Strictly 1-based cycleIndex (matching dashboard: cycleIndex = Math.floor(i / 2) + 1)
    const keywordComments = allComments.filter(c =>
      c.keywordId === kwObj.id && Number(c.cycleIndex) === cycleNum
    );
    console.log(`[Worker] Comments for "${kw}" cycle #${cycleNum}: ${keywordComments.length} found (cycleIndex=${cycleNum}, keywordId=${kwObj.id})`);

    // ── Enforce exactly 2 comments per cycle ──
    if (keywordComments.length !== 2) {
      console.error(`[Worker] ❌ VALIDATION FAILED: Expected exactly 2 comments for cycle #${cycleNum} of "${kw}", but found ${keywordComments.length}. Skipping cycle.`);
      console.error(`[Worker] Available comment cycleIndexes for this keyword:`, allComments.filter(c => c.keywordId === kwObj.id).map(c => `id=${c.id} cycleIndex=${c.cycleIndex}`));
      showPremiumToast('Configuration Error', `❌ Keyword "${kw}" cycle #${cycleNum} needs exactly 2 comments, found ${keywordComments.length}. Fix in Campaign Builder.`, true);
      return;
    }

    // ── Per-hour comment cap: max 4 comments/hour ──
    if (state.hourlyCommentsMade >= 4) {
      console.warn("🛡️ [Worker] Hourly comment cap (4/hour) reached. Waiting for next hour.");
      showPremiumToast('Safety Limit', '🛡️ Hourly comment limit reached (4/hr). Cooling down.', false);
      await saveState({ cooldownMs: CYCLE_COOLDOWN_MS, lastJobTime: Date.now() });
      return;
    }

    // ── Daily comment cap: max 15/day ──
    if (state.dailyCommentsMade >= 15) {
      console.warn("🛡️ [Worker] Daily comment limit (15) reached! Pausing until tomorrow.");
      showPremiumToast('Daily Limit', '🛡️ Daily comment limit reached (15/day). Resuming tomorrow.', false);
      await saveState({ isPaused: true, cooldownMs: 3600000, lastJobTime: Date.now() });
      return;
    }

    // Stamp cycleStartTime before tab opens for stale detection
    await saveState({
      isJobRunning: true,
      currentKeyword: kw,
      cycleStartTime: Date.now(),
      liveStatusText: `🚀 Starting cycle #${cycleNum} for "${kw}"...`
    });

    const searchPages = (await loadState()).keywordSearchPages || {};
    const pageNum = (searchPages[kw] || 0) + 1;

    console.log(`🚀 [Worker] Starting cycle #${cycleNum}/${kwObj.targetCycles || 1} for: "${kw}" with ${keywordComments.length} comments assigned. (Search Page: ${pageNum})`);
    showPremiumToast('Nexora Engine Started', `Starting cycle #${cycleNum}/${kwObj.targetCycles || 1} for "${kw}" (Pg ${pageNum})`, false);
    await startScrapingCycle(kw, settings, keywordComments, dashboardUrl, userId, cycleNum, pageNum);

  } catch (error) {
    console.error("❌ [Worker] Poll failed:", error.message);
    const s = await loadState();
    if (s.isJobRunning) {
      await saveState({ isJobRunning: false, activeTabId: null, cycleStartTime: 0 });
    }
  }
}

// ── Scraping Cycle (Navigation-Resilient v4 — Background-Throttle-Safe) ──
async function startScrapingCycle(keyword, settings, comments, dashboardUrl, userId, cycleNum = 1, pageNum = 1) {
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER&page=${pageNum}`;
  let injectionCount = 0;
  const MAX_INJECTIONS = 3;

  try {
    // CRITICAL FIX: Create the window with focused: true.
    // Chrome throttles setTimeout/setInterval to 1Hz minimum in background tabs.
    // A tab that is NEVER focused gets throttled from the first moment, meaning
    // wait(800, 1200) actually takes 1000ms minimum per call — acceptable — but
    // wait(2000, 3500) was taking up to 35 seconds per step because the old code
    // used those ranges. With focused:true the tab gets normal timer resolution.
    // We minimize the window immediately after injection starts so it doesn't
    // steal the user's screen, but by then the JS engine is already running at
    // full speed and Chrome won't throttle it back for several seconds.
    const win = await chrome.windows.create({
      url: searchUrl,
      type: 'normal',
      state: 'normal',
      focused: true,   // ← must be true to prevent timer throttling
      width: 1100,
      height: 900
    });
    const tab = win.tabs[0];
    await saveState({ activeTabId: tab.id });

    console.log(`💉 [Worker] Tab ${tab.id} created (focused window). Waiting for page load...`);
    await waitForTabLoad(tab.id, 20000);
    await sleep(3000); // LinkedIn JS hydration

    // ── Helper: Inject and Start ──
    async function injectAndStart() {
      injectionCount++;
      console.log(`🛠️ [Worker] Injection attempt #${injectionCount}/${MAX_INJECTIONS}...`);

      let currentTab;
      try {
        currentTab = await chrome.tabs.get(tab.id);
      } catch (e) {
        console.warn("⚠️ [Worker] Tab lost before injection.");
        await finishCycle(null, false);
        return false;
      }

      if (!currentTab.url || !currentTab.url.includes('linkedin.com')) {
        console.warn(`⚠️ [Worker] Tab URL is no longer LinkedIn: ${currentTab.url}`);
        chrome.tabs.remove(tab.id).catch(() => {});
        await finishCycle(null, false);
        return false;
      }

      console.log(`📍 [Worker] Tab URL verified: ${currentTab.url.substring(0, 80)}...`);

      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch (e) {
        console.error("❌ [Worker] Inject failed:", e.message);
        chrome.tabs.remove(tab.id).catch(() => {});
        await finishCycle(null, false);
        return false;
      }

      await sleep(1500); // Let script register listener

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
        console.log("✅ [Worker] Content script successfully started.");
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

    const started = await injectAndStart();
    if (!started) return;

    // Minimize the window now that the content script is running.
    // The JS engine keeps full timer resolution once a window has been focused
    // at least once. Minimizing AFTER injection does NOT re-enable throttling.
    // We give the script 2 seconds to start its first await before minimizing.
    setTimeout(() => {
      chrome.windows.update(win.id, { state: 'minimized' }).catch(() => {});
      console.log(`🪟 [Worker] Window ${win.id} minimized. Script running at full speed.`);
    }, 2000);

    // ── Tab navigation listener: re-inject if LinkedIn re-renders ──
    const navListener = async (tabId, changeInfo) => {
      if (tabId !== tab.id) return;
      if (changeInfo.status === 'complete' && injectionCount < MAX_INJECTIONS) {
        console.log("🔄 [Worker] Tab re-navigated! Re-injecting content script...");
        await sleep(3000);
        await injectAndStart();
      }
    };
    chrome.tabs.onUpdated.addListener(navListener);

    // ── Heartbeat monitor: re-inject if content script dies silently ──
    const heartbeatInterval = setInterval(async () => {
      const s = await loadState();
      if (!s.isJobRunning || s.activeTabId !== tab.id) {
        clearInterval(heartbeatInterval);
        chrome.tabs.onUpdated.removeListener(navListener);
        return;
      }
      const timeSinceHeartbeat = Date.now() - _lastContentHeartbeat;
      if (timeSinceHeartbeat > 60000 && injectionCount < MAX_INJECTIONS) {
        console.warn(`💀 [Worker] No heartbeat for ${Math.round(timeSinceHeartbeat/1000)}s. Re-injecting...`);
        await injectAndStart();
      }
    }, 15000);

    // FIX-4: Watchdog raised to 10 minutes.
    // Worst-case pipeline: ~155s scrolling + ~60s commenting + margin = ~300s.
    // 10 minutes (600000ms) is safe and won't fire during a healthy run.
    const WATCHDOG_MS = 600000;
    const watchdogTabId = tab.id;
    setTimeout(async () => {
      clearInterval(heartbeatInterval);
      chrome.tabs.onUpdated.removeListener(navListener);
      const s = await loadState();
      if (s.isJobRunning && s.activeTabId === watchdogTabId) {
        console.warn("⏱️ [Worker] WATCHDOG: 10-min timeout. Force-killing tab.");
        chrome.tabs.remove(watchdogTabId).catch(() => {});
        await finishCycle(null, false);
      }
    }, WATCHDOG_MS);

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
  const failures = incrementKeyword ? 0 : (state.consecutiveFailures || 0) + 1;
  const cd = getCooldown(failures);

  const updates = {
    isJobRunning: false,
    activeTabId: null,
    cycleStartTime: 0,
    lastJobTime: Date.now(),
    cooldownMs: cd,
    consecutiveFailures: failures,
    liveStatusText: ''
  };

  if (incrementKeyword && state.currentKeyword) {
    const kc = state.keywordCycles || {};
    kc[state.currentKeyword] = (kc[state.currentKeyword] || 0) + 1;
    console.log(`[Worker] Keyword "${state.currentKeyword}" cycle ${kc[state.currentKeyword]} complete.`);
    updates.keywordCycles = kc;
    updates.consecutiveFailures = 0; // Reset on success
  }

  // Always increment the LinkedIn search page so the next attempt doesn't get stuck on an exhausted page
  if (state.currentKeyword) {
    const searchPages = state.keywordSearchPages || {};
    searchPages[state.currentKeyword] = (searchPages[state.currentKeyword] || 0) + 1;
    console.log(`[Worker] Keyword "${state.currentKeyword}" search page incremented to ${searchPages[state.currentKeyword] + 1}.`);
    updates.keywordSearchPages = searchPages;
    updates.currentKeyword = null;
  }

  await saveState(updates);
  const cdMin = Math.round(cd / 60000);
  console.log(`[Worker] Cycle done. Next cooldown: ${cdMin} min${failures > 0 ? ` (backoff level ${failures})` : ''}.`);
  showPremiumToast('Cycle Complete', `✅ Cycle complete! Cooling down for ${cdMin} minutes...`, false);
}

// ── Message Router ──
let _lastContentHeartbeat = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_POLLING') {
    console.log("🚀 [Worker] Received START command from dashboard. Resetting system limits and waking up.");
    saveState({ isPaused: false, keywordCycles: {}, cooldownMs: 0, cycleStartTime: 0, consecutiveFailures: 0, hourlyCommentsMade: 0, currentSearchCycle: 0 }).then(() => {
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
    saveState({ liveStatusText: message.text });
    loadState().then(s => {
      const log = s.activityLog || [];
      log.push({ text: message.text, time: Date.now() });
      while (log.length > 8) log.shift();
      saveState({ activityLog: log });
    });
    try {
      chrome.runtime.sendMessage({ action: 'EXTENSION_LIVE_STATUS', text: message.text }, () => {
        if (chrome.runtime.lastError) { /* popup closed, ignore */ }
      });
    } catch(e){}
    return;
  }

  if (message.action === 'COMMENT_POSTED') {
    loadState().then(async s => {
      const newDaily = (s.dailyCommentsMade || 0) + 1;
      const newHourly = (s.hourlyCommentsMade || 0) + 1;
      await saveState({ dailyCommentsMade: newDaily, hourlyCommentsMade: newHourly });
      console.log(`💬 [Worker] Comment posted successfully. Daily: ${newDaily}/15 | Hourly: ${newHourly}/4`);
      showPremiumToast('Comment Posted', `Successfully posted comment #${newDaily}/15 today (${newHourly}/4 this hour)!`, false);
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
    const posted = message.commentsPostedCount || 0;
    const assigned = message.assignedCommentsCount || 0;
    const blocked = message.linkedinBlocked || false;
    console.log(`🏁 [Worker] Job ${status}. Comments: ${posted}/${assigned} | SearchOnly: ${message.searchOnlyMode} | Blocked: ${blocked}`);

    let isSuccessfulCycle = message.action === 'JOB_COMPLETED';

    // v7.1: Smarter partial-cycle handling with LinkedIn restriction awareness.
    if (isSuccessfulCycle && message.searchOnlyMode === false) {
      if (assigned > 0 && posted === 0) {
        console.warn(`[Worker] ❌ Cycle posted 0/${assigned} comments. NOT consuming cycle slot. Will retry on next search page after cooldown.`);
        isSuccessfulCycle = false;
        showPremiumToast(
          'Cycle Failed',
          `❌ 0/${assigned} comments posted. Retrying on fresh page after cooldown...`,
          true
        );
      } else if (assigned > 0 && posted < assigned) {
        console.warn(`[Worker] ⚠️ Partial cycle: ${posted}/${assigned} comments posted. Consuming cycle slot to avoid retry loop.`);
        isSuccessfulCycle = true; // Still count as success to advance
        showPremiumToast(
          'Partial Cycle',
          `⚠️ ${posted}/${assigned} comments posted. Moving to next cycle.`,
          true
        );
      } else if (assigned > 0 && posted >= assigned) {
        console.log(`[Worker] ✅ All ${posted}/${assigned} comments posted. Cycle complete.`);
      }
    }

    // If LinkedIn blocked commenting, use a longer cooldown (30 min)
    // and pause the system to avoid burning the account.
    if (blocked) {
      console.error(`[Worker] 🚫 LINKEDIN RESTRICTION DETECTED. Pausing system for 30 minutes.`);
      showPremiumToast(
        '🚫 Account Restricted',
        `LinkedIn is blocking comments on this account. Pausing for 30 minutes to protect your account.`,
        true
      );
      isSuccessfulCycle = false;
      // Override cooldown to 30 minutes
      finishCycle(sender.tab?.id, false);
      saveState({ cooldownMs: 1800000 }); // 30 min cooldown
      return;
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
  console.log("🚀 [Worker] Safety Worker v6 installed.");
  saveState({ isJobRunning: false, activeTabId: null, cycleStartTime: 0, consecutiveFailures: 0 });
  setTimeout(() => checkJobs(), 5000);
});

chrome.runtime.onStartup.addListener(() => {
  console.log("⚙️ [Worker] Restarting...");
  setTimeout(() => checkJobs(), 5000);
});
