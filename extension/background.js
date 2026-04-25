// ═══════════════════════════════════════════════════════════
// LinkedIn Safety Worker v10 — Deep Extraction Support
// ═══════════════════════════════════════════════════════════
// v10 Changes from v9:
//
//   FIX 1 — STALE_TIMEOUT and WATCHDOG raised to 30 min:
//     content.js v14 runs up to 120 main scroll steps (was 60) +
//     3 expansion rounds of 40-60 steps each + time-filter injections.
//     Total worst-case runtime: ~25-28 min. Raised both the stale
//     job guard and the watchdog timer to 30 min to allow complete runs.
//
//   FIX 2 — SEARCH_INTER_KEYWORD_MS raised to 20s:
//     v14 extraction takes longer per keyword due to deeper scrolling.
//     Giving 20s between keywords in the same group (was 15s) avoids
//     overlapping tab creation.
//
//   All v9 architecture preserved:
//     - 3-keyword cooldown grouping
//     - Single START_POLLING listener
//     - Mutex-safe checkJobs
//     - Comment mode unchanged
// ═══════════════════════════════════════════════════════════

console.log("[Worker] ═══ Safety Worker v11 (Multi-Pass Deep Extraction) Initialized ═══");

// ── Persistent State (chrome.storage.local) ──
if (!self.__nexoraControlledNavTabs) self.__nexoraControlledNavTabs = new Set();
if (!self.__globalSyncedUrlsByKeyword) self.__globalSyncedUrlsByKeyword = new Map();

function isControlledNavigation(tabId) {
  return !!(tabId && self.__nexoraControlledNavTabs && self.__nexoraControlledNavTabs.has(tabId));
}

function setControlledNavigation(tabId, enabled) {
  if (!tabId || !self.__nexoraControlledNavTabs) return;
  if (enabled) self.__nexoraControlledNavTabs.add(tabId);
  else self.__nexoraControlledNavTabs.delete(tabId);
}

let cachedDeviceFingerprint = null;
async function getExtensionFingerprint() {
  if (cachedDeviceFingerprint) return cachedDeviceFingerprint;
  try {
    const { extFingerprint } = await chrome.storage.local.get(['extFingerprint']);
    if (extFingerprint) {
      cachedDeviceFingerprint = extFingerprint;
      return cachedDeviceFingerprint;
    }
    const offscreen = new OffscreenCanvas(200, 50);
    const ctx = offscreen.getContext('2d');
    ctx.textBaseline = "top"; ctx.font = "14px 'Arial'"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f60"; ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069"; ctx.fillText("Nexora 😃", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)"; ctx.fillText("Nexora 😃", 4, 17);
    const blob = await offscreen.convertToBlob();
    const buffer = await blob.arrayBuffer();
    const nav = navigator;
    const rawString = nav.userAgent + '|' + nav.language + '|' + (nav.hardwareConcurrency || '');
    const txtBuf = new TextEncoder().encode(rawString);
    const combined = new Uint8Array(buffer.byteLength + txtBuf.byteLength);
    combined.set(new Uint8Array(buffer), 0);
    combined.set(txtBuf, buffer.byteLength);
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    cachedDeviceFingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({ extFingerprint: cachedDeviceFingerprint });
    return cachedDeviceFingerprint;
  } catch (e) {
    return 'fallback_ext_' + Math.random().toString(36);
  }
}

async function loadState() {
  return chrome.storage.local.get({
    isJobRunning: false,
    activeTabId: null,
    activeWindowId: null,
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
    currentSearchKeywordIndex: 0,
    activityLog: [],
    pendingCommentInsufficientRetry: null
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
    color = (s.lastJobTime > 0 && elapsed < (s.cooldownMs || 0)) ? '#f59e0b' : '#6b7280';
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

// ── Cooldown Config ──
// v9 FIX 2: 3-keyword grouping cooldown system
// SEARCH_INTER_KEYWORD_MS: short pause between keywords within a group of 3
// SEARCH_KEYWORD_COOLDOWN_MS: cooldown applied after every 3 keywords
// SEARCH_FULL_CYCLE_COOLDOWN_MS: cooldown after all keywords are done
const SEARCH_INTER_KEYWORD_MS = 60000;       // 1 min between keywords within a group
const SEARCH_KEYWORD_COOLDOWN_MS = 900000;   // 15 min cooldown every 3 keywords (User requested rule)
const SEARCH_FULL_CYCLE_COOLDOWN_MS = 1200000; // 20 min after all keywords done
const COMMENT_CYCLE_COOLDOWN_MS = 900000;    // 15 min (comment mode — unchanged)

// v9 FIX 2: Determine cooldown based on keyword position
function getCooldown(kwIndex, totalKeywords, consecutiveFailures = 0, searchOnlyMode = false) {
  if (searchOnlyMode) {
    // Apply group cooldown every 3 keywords
    const isGroupBoundary = kwIndex > 0 && kwIndex % 3 === 0;
    if (isGroupBoundary || consecutiveFailures >= 2) {
      const base = SEARCH_KEYWORD_COOLDOWN_MS;
      if (consecutiveFailures >= 2) return base * 2;
      if (consecutiveFailures >= 1) return Math.round(base * 1.5);
      return base;
    }
    // Within a group: short inter-keyword pause
    return SEARCH_INTER_KEYWORD_MS;
  }
  // Comment mode: exponential backoff as before
  if (consecutiveFailures >= 2) return 1800000;
  if (consecutiveFailures >= 1) return 1200000;
  return COMMENT_CYCLE_COOLDOWN_MS;
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

async function navigateTabControlled(tabId, url, timeoutMs = 30000) {
  setControlledNavigation(tabId, true);
  try {
    await chrome.tabs.update(tabId, { url });
    await waitForTabLoad(tabId, timeoutMs);
    await sleep(1800);
  } finally {
    setControlledNavigation(tabId, false);
  }
}

async function injectContentScriptOnly(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await sleep(900);
}

async function runCommentExecutionPlan(tabId, plan) {
  const executionPlan = Array.isArray(plan?.executionPlan) ? plan.executionPlan : [];
  const keyword = plan?.keyword || '';
  const assignedCommentsCount = Number(plan?.assignedCommentsCount) || executionPlan.length || 2;
  const postsExtracted = Number(plan?.postsExtracted) || 0;
  const commentCycleNumber = Number(plan?.commentCycleNumber) || 1;
  const commentScrollPassesUsed = Number(plan?.commentScrollPassesUsed) || 0;

  let posted = 0;
  let commentsAttempted = 0;
  let commentsFailed = 0;
  let blocked = false;
  const stateSnapshot = await chrome.storage.local.get(['commentedPosts', 'usedCommentIds']);
  let commentedPosts = Array.isArray(stateSnapshot.commentedPosts) ? stateSnapshot.commentedPosts.slice() : [];
  let usedCommentIds = Array.isArray(stateSnapshot.usedCommentIds) ? stateSnapshot.usedCommentIds.slice() : [];

  for (let i = 0; i < executionPlan.length; i++) {
    const target = executionPlan[i];
    if (!target?.targetUrl || !target?.commentText) {
      commentsFailed++;
      continue;
    }
    commentsAttempted++;
    console.log(`[Worker] Direct target execution ${i + 1}/${executionPlan.length}: ${target.targetUrl}`);
    try {
      await navigateTabControlled(tabId, target.targetUrl, 35000);
      await injectContentScriptOnly(tabId);
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (payload) => {
          if (!window.__resumeSingleCommentTarget) throw new Error('Direct comment executor missing.');
          return await window.__resumeSingleCommentTarget(payload);
        },
        args: [{ targetUrl: target.targetUrl, commentText: target.commentText }]
      });
      const outcome = results && results[0] ? results[0].result : 'FAILED';
      if (outcome === 'BLOCKED') {
        blocked = true;
        break;
      }
      if (outcome === 'SUCCESS') {
        posted++;
        commentedPosts = [...commentedPosts, target.targetUrl].slice(-200);
        if (target.commentId) usedCommentIds = [...usedCommentIds, target.commentId].slice(-100);
        await chrome.storage.local.set({ commentedPosts, usedCommentIds });
      } else {
        commentsFailed++;
      }
      await sleep(1200);
    } catch (e) {
      commentsFailed++;
      console.error(`[Worker] Direct target execution failed for ${target.targetUrl}:`, e.message);
    }
  }

  return {
    blocked,
    posted,
    commentsAttempted,
    commentsFailed,
    assignedCommentsCount,
    keyword,
    postsExtracted,
    commentCycleNumber,
    commentScrollPassesUsed
  };
}

async function tabExists(tabId) {
  if (!tabId) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    return !!tab;
  } catch (e) {
    return false;
  }
}

// ── Main Poll (with mutex) ──
let checkJobsLock = false;

async function checkJobs() {
  if (checkJobsLock) return; // v9 FIX 4: reentrant-safe
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
    // v10: Raised STALE_TIMEOUT to 30 min for deep multi-round extraction (content.js v14)
    const STALE_TIMEOUT_MS = 1800000; // 30 min
    const runningTime = Date.now() - (state.cycleStartTime || state.lastJobTime || 0);

    if (runningTime < STALE_TIMEOUT_MS) {
      const alive = await tabExists(state.activeTabId);
      if (!alive && state.activeTabId !== null) {
        console.warn(`🧹 [Worker] Active tab ${state.activeTabId} no longer exists. Cleaning up early.`);
        await saveState({ isJobRunning: false, activeTabId: null, cycleStartTime: 0 });
        // Fall through to restart cycle
      } else {
        console.log(`⏳ [Worker] Job in progress (${Math.round(runningTime / 1000)}s), skipping poll.`);
        return;
      }
    } else {
      console.log("🧹 [Worker] Stale job detected (15min+). Cleaning up...");
      if (state.activeTabId) {
        try { await chrome.tabs.remove(state.activeTabId); } catch (e) { }
      }
      await saveState({ isJobRunning: false, activeTabId: null, cycleStartTime: 0 });
    }
  }

  // Gate 2: Cooldown timer
  const elapsed = Date.now() - state.lastJobTime;
  if (state.lastJobTime > 0 && elapsed < state.cooldownMs) {
    const remaining = Math.ceil((state.cooldownMs - elapsed) / 60000);
    console.log(`🛌 [Worker] Cooldown active. ${remaining} min remaining.`);
    return;
  }

  // Gate 3: Paused
  if (state.isPaused) {
    const trickleMs = 600000;
    if (elapsed < trickleMs) {
      console.log(`⏸️ [Worker] PAUSED. Trickle: ${Math.ceil((trickleMs - elapsed) / 60000)} min left.`);
      return;
    }
  }

  // Gate 4: Clean any stale tab (safety net)
  if (state.activeTabId !== null) {
    try { await chrome.tabs.remove(state.activeTabId); console.log(`🧹 [Worker] Cleaned stale tab ${state.activeTabId}.`); } catch (e) { }
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
    const deviceId = await getExtensionFingerprint();
    const response = await fetch(`${dashboardUrl}/api/extension/jobs`, {
      headers: { 'x-extension-token': userId, 'x-device-id': deviceId, 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    const isActive = data.active === true;
    if (state.wasDashboardActive === false && isActive) {
      console.log("🔄 [Worker] Dashboard turned active. Full reset.");
      await saveState({
        keywordCycles: {},
        keywordSearchPages: {},
        isPaused: false,
        wasDashboardActive: true,
        lastJobTime: 0,
        dailyCommentsMade: 0,
        currentSearchCycle: 0,
        currentSearchKeywordIndex: 0,
        cycleStartTime: 0,
        consecutiveFailures: 0
      });
      state.keywordCycles = {};
      state.keywordSearchPages = {};
      state.isPaused = false;
      state.wasDashboardActive = true;
      state.lastJobTime = 0;
      state.dailyCommentsMade = 0;
      state.currentSearchCycle = 0;
      state.currentSearchKeywordIndex = 0;
    } else {
      await saveState({ wasDashboardActive: isActive });
    }

    const settings = data.settings || {};

    if (!isActive || !data.hasJobs) {
      console.log(`😴 [Worker] Idle. active=${isActive}, hasJobs=${data.hasJobs}`);
      return;
    }

    if (!settings.searchOnlyMode) {
      if (!data.keywords?.length) {
        console.log(`😴 [Worker] Idle: Comment campaigns missing.`);
        return;
      }
      const kc = (await loadState()).keywordCycles || {};
      const availableKeywords = data.keywords.filter(k => (kc[k.keyword] || 0) < (k.targetCycles || 1));

      if (availableKeywords.length === 0) {
        if (!state.isPaused) {
          const fallbackCooldown = COMMENT_CYCLE_COOLDOWN_MS + Math.floor(Math.random() * 300000);
          await saveState({ isPaused: true, lastJobTime: Date.now(), cooldownMs: fallbackCooldown, dailyCommentsMade: 0 });
          console.log("⏸️ [Worker] AUTO-PAUSED: All comment keywords completed.");
          try {
            await fetch(`${dashboardUrl}/api/settings`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
              body: JSON.stringify({ systemActive: false })
            });
          } catch (e) { }
        }
        return;
      }
      data.availableKeywords = availableKeywords;
    }

    if (state.isPaused) {
      await saveState({ isPaused: false });
    }

    // ── Safety Limit Resets ──
    const today = new Date().toDateString();
    const currentHour = new Date().getHours();
    const freshState = await loadState();
    if (freshState.lastCommentDate !== today) {
      await saveState({ dailyCommentsMade: 0, hourlyCommentsMade: 0, lastCommentDate: today, lastCommentHour: currentHour });
      console.log("📅 [Worker] New day. Reset daily comment quota.");
    }
    if (freshState.lastCommentHour !== currentHour) {
      await saveState({ hourlyCommentsMade: 0, lastCommentHour: currentHour });
      console.log("🕐 [Worker] New hour. Reset hourly comment quota.");
    }

    const allComments = data.comments || [];

    // ═══════════════════════════════════════════════════════════
    // SEARCH-ONLY MODE — Sequential Keyword Queue (v9)
    // ═══════════════════════════════════════════════════════════
    if (settings.searchOnlyMode) {
      let allKeywords = [];
      try {
        allKeywords = JSON.parse(settings.searchConfigJson || "[]")
          .flat(Infinity)
          .filter(k => typeof k === 'string' && k.trim().length > 0)
          .map(k => k.trim());
      } catch (e) {
        console.warn("⚠️ [Worker] Failed to parse searchConfigJson:", e.message);
      }

      if (allKeywords.length === 0) {
        console.warn("⚠️ [Worker] Search-Only: no keywords configured.");
        return;
      }

      const kwIndex = (await loadState()).currentSearchKeywordIndex || 0;

      // All keywords done → full cycle complete
      if (kwIndex >= allKeywords.length) {
        const cyclesDone = ((await loadState()).currentSearchCycle || 0) + 1;
        await saveState({
          isJobRunning: false,
          activeTabId: null,
          cycleStartTime: 0,
          lastJobTime: Date.now(),
          cooldownMs: SEARCH_FULL_CYCLE_COOLDOWN_MS,
          currentKeyword: null,
          currentSearchKeywordIndex: 0,
          currentSearchCycle: cyclesDone,
          keywordSearchPages: {},
          isPaused: true,
          liveStatusText: ''
        });
        const cdMin = Math.round(SEARCH_FULL_CYCLE_COOLDOWN_MS / 60000);
        console.log(`[Worker] ✅ All ${allKeywords.length} keywords done. Cycle ${cyclesDone} complete. Pausing ${cdMin} min.`);
        showPremiumToast('All Keywords Done', `✅ Cycle ${cyclesDone} complete! ${allKeywords.length} keywords searched. Resuming in ${cdMin} min.`, false);
        try {
          await fetch(`${dashboardUrl}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
            body: JSON.stringify({ systemActive: false })
          });
        } catch (e) { }
        return;
      }

      const kwStr = allKeywords[kwIndex];
      const pageNum = 1; // content.js handles all pagination internally
      try {
        if (self.__globalSyncedUrlsByKeyword) self.__globalSyncedUrlsByKeyword.delete(kwStr);
      } catch (e) {}

      // v9 FIX 2: Log group position for visibility
      const groupNum = Math.floor(kwIndex / 3) + 1;
      const posInGroup = (kwIndex % 3) + 1;
      console.log(`🔍 [Worker] Search-only: keyword ${kwIndex + 1}/${allKeywords.length} (Group ${groupNum}, #${posInGroup}/3): "${kwStr}"`);
      showPremiumToast('Search Mode', `🔍 Keyword ${kwIndex + 1}/${allKeywords.length}: "${kwStr}"`, false);

      await saveState({
        isJobRunning: true,
        cycleStartTime: Date.now(),
        currentKeyword: kwStr,
        liveStatusText: `🔍 Searching "${kwStr}" (${kwIndex + 1}/${allKeywords.length})...`
      });
      // Save settings for PASS_DONE handler
      await chrome.storage.local.set({
        jobSettings: { ...settings, engineMode: 'SEARCH_ONLY', searchOnlyMode: true },
        jobComments: []
      });

      const currentCycle = ((await loadState()).currentSearchCycle || 0) + 1;
      startScrapingCycle(kwStr, settings, [], dashboardUrl, userId, currentCycle, pageNum, 0, []);
      return;
    }

    // ═══════════════════════════════════════════════════════════
    // COMMENT MODE (unchanged from v8)
    // ═══════════════════════════════════════════════════════════
    const available = data.availableKeywords || [];
    if (available.length === 0) return;

    const stPick = await loadState();
    const forcedRetryKw = stPick.pendingCommentInsufficientRetry || null;
    let kwObj = forcedRetryKw
      ? available.find(k => k.keyword === forcedRetryKw)
      : null;
    if (!kwObj) {
      kwObj = available[Math.floor(Math.random() * available.length)];
    }
    const kw = kwObj.keyword;
    const kc = (await loadState()).keywordCycles || {};
    const cycleNum = (kc[kw] || 0) + 1;
    const commentsPerCycle = Math.max(1, Number(kwObj.commentsPerCycle) || Number(settings.commentsPerCycle) || 2);
    const insufficientRetryPass = !!(forcedRetryKw && forcedRetryKw === kw);

    const keywordComments = allComments.filter(c =>
      c.keywordId === kwObj.id && Number(c.cycleIndex) === cycleNum
    );
    console.log(`[Worker] Comments for "${kw}" cycle #${cycleNum}: ${keywordComments.length} found (expect ${commentsPerCycle})`);

    if (keywordComments.length !== commentsPerCycle) {
      console.error(`[Worker] ❌ VALIDATION FAILED: Expected ${commentsPerCycle} comments for cycle #${cycleNum} of "${kw}", found ${keywordComments.length}.`);
      showPremiumToast('Configuration Error', `❌ "${kw}" cycle #${cycleNum} needs ${commentsPerCycle} comments, found ${keywordComments.length}.`, true);
      return;
    }

    const cState = await loadState();

    if (cState.hourlyCommentsMade >= 12) {
      console.warn("🛡️ [Worker] Hourly comment cap (12/hr) reached.");
      showPremiumToast('Safety Limit', '🛡️ Hourly limit reached. Cooling down.', false);
      await saveState({ cooldownMs: COMMENT_CYCLE_COOLDOWN_MS, lastJobTime: Date.now() });
      return;
    }

    if (cState.dailyCommentsMade >= 15) {
      console.warn("🛡️ [Worker] Daily comment limit (15) reached.");
      showPremiumToast('Daily Limit', '🛡️ Daily limit reached. Resuming tomorrow.', false);
      await saveState({ isPaused: true, cooldownMs: 3600000, lastJobTime: Date.now() });
      return;
    }

    await saveState({
      isJobRunning: true,
      currentKeyword: kw,
      cycleStartTime: Date.now(),
      liveStatusText: `🚀 Starting cycle #${cycleNum} for "${kw}"...`,
      ...(insufficientRetryPass ? { pendingCommentInsufficientRetry: null } : {})
    });

    const searchPages = (await loadState()).keywordSearchPages || {};
    const pageNum = (searchPages[kw] || 0) + 1;

    const commentSurface = kwObj.surface === 'feed' ? 'feed' : 'search_posts';
    const jobSettings = {
      ...settings,
      engineMode: 'COMMENT_CAMPAIGN',
      searchOnlyMode: false,
      commentSurface,
      commentCycleNumber: cycleNum,
      insufficientRetryPass
    };

    console.log(`🚀 [Worker] Comment cycle #${cycleNum}/${kwObj.targetCycles || 1} for: "${kw}" (Page ${pageNum}) surface=${commentSurface}`);
    showPremiumToast('Nexora Engine', `Starting cycle #${cycleNum} for "${kw}" (Pg ${pageNum})`, false);
    await startScrapingCycle(kw, jobSettings, keywordComments, dashboardUrl, userId, cycleNum, pageNum);

  } catch (error) {
    console.error("❌ [Worker] Poll failed:", error.message);
    const s = await loadState();
    if (s.isJobRunning) {
      await saveState({ isJobRunning: false, activeTabId: null, cycleStartTime: 0 });
    }
  }
}

// ── Scraping Cycle (Single-Tab, Navigation-Resilient) ──
// passIndex: 0 = relevance URL (all time ranges), 1 = date URL (recent)
// priorPosts: serialized posts from pass 0, forwarded to content.js for pass 1
async function startScrapingCycle(keyword, settings, comments, dashboardUrl, userId, cycleNum = 1, pageNum = 1, passIndex = 0, priorPosts = []) {
  const isSearchOnlyJob = settings.searchOnlyMode === true || settings.engineMode === 'SEARCH_ONLY';
  const searchPostsUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER`;
  const feedUrl = 'https://www.linkedin.com/feed/';
  const searchUrl = isSearchOnlyJob
    ? searchPostsUrl
    : (settings.commentSurface === 'feed' ? feedUrl : searchPostsUrl);
  let injectionCount = 0;
  const MAX_INJECTIONS = 3;

  try {
    // Open ONE focused window — prevents timer throttling
    const win = await chrome.windows.create({
      url: searchUrl,
      type: 'normal',
      state: 'normal',
      focused: true,
      width: 1100,
      height: 900
    });
    const tab = win.tabs[0];
    await saveState({ activeTabId: tab.id, activeWindowId: win.id });

    console.log(`💉 [Worker] Tab ${tab.id} created for "${keyword}". Waiting for load...`);
    await waitForTabLoad(tab.id, 20000);
    await sleep(1500);

    let isInjecting = false;
    async function injectAndStart() {
      if (isInjecting) {
        console.log("🛠️ [Worker] Injection already in progress. Guard preventing loop.");
        return false;
      }
      isInjecting = true;
      try {
        injectionCount++;
        console.log(`🛠️ [Worker] Injection attempt #${injectionCount}/${MAX_INJECTIONS}...`);

        const alive = await tabExists(tab.id);
        if (!alive) {
          console.warn("⚠️ [Worker] Tab lost before injection.");
          await finishCycle(null, false, settings.searchOnlyMode);
          return false;
        }

        let currentTab;
        try {
          currentTab = await chrome.tabs.get(tab.id);
        } catch (e) {
          console.warn("⚠️ [Worker] Failed to get tab info:", e.message);
          await finishCycle(null, false, settings.searchOnlyMode);
          return false;
        }

        if (!currentTab.url || !currentTab.url.includes('linkedin.com')) {
          console.warn(`⚠️ [Worker] Tab URL not LinkedIn: ${currentTab.url}`);
          chrome.tabs.remove(tab.id).catch(() => { });
          await finishCycle(null, false, settings.searchOnlyMode);
          return false;
        }

        console.log(`📍 [Worker] Tab verified: ${currentTab.url.substring(0, 80)}...`);

        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        } catch (e) {
          console.error("❌ [Worker] Inject failed:", e.message);
          chrome.tabs.remove(tab.id).catch(() => { });
          await finishCycle(null, false, settings.searchOnlyMode);
          return false;
        }

        await sleep(1500);

        console.log("🚀 [Worker] Starting extraction...");
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (k, s, c, du, u, useSearchOnly) => {
              const merged = { ...s };
              if (useSearchOnly) {
                if (window.__startSearchOnly) window.__startSearchOnly(k, merged, du, u);
                else if (window.__startExtraction) window.__startExtraction(k, merged, [], du, u);
                else throw new Error('Search-only starter not defined on window.');
              } else {
                if (window.__startCommentCampaign) window.__startCommentCampaign(k, merged, c, du, u);
                else if (window.__startExtraction) window.__startExtraction(k, merged, c, du, u);
                else throw new Error('Comment-campaign starter not defined on window.');
              }
            },
            args: [keyword, { ...settings, passIndex, priorPosts }, comments, dashboardUrl, userId, isSearchOnlyJob]
          });
          console.log("✅ [Worker] Content script started.");
          _lastContentHeartbeat = Date.now();
          return true;
        } catch (e) {
          console.error(`❌ [Worker] Comm error on attempt #${injectionCount}:`, e.message);
          if (injectionCount < MAX_INJECTIONS) {
            console.log("🔄 [Worker] Retrying injection...");
            await sleep(5000);
            isInjecting = false;
            return injectAndStart();
          }
          chrome.tabs.remove(tab.id).catch(() => { });
          await finishCycle(null, false, settings.searchOnlyMode);
          return false;
        }
      } finally {
        isInjecting = false;
      }
    }

    const started = await injectAndStart();
    if (!started) return;

    // CRITICAL: Do NOT minimize — minimized tabs have document.visibilityState='hidden'
    // which disables IntersectionObserver, killing LinkedIn's infinite scroll loader.
    // Instead: shrink the window and unfocus it. It stays "visible" to Chrome's engine
    // so IntersectionObserver fires and LinkedIn loads new post cards.
    setTimeout(async () => {
      try {
        await chrome.windows.update(win.id, {
          state: 'normal',
          focused: false,
          width: 800,
          height: 600
        });
        console.log(`🪟 [Worker] Window ${win.id} unfocused (800x600, visible to renderer).`);
      } catch(e) {
        console.log(`🪟 [Worker] Window unfocus failed (non-fatal):`, e.message);
      }
    }, 3000);

    // Re-inject on tab navigation
    // IMPORTANT: Do NOT re-inject for pass-driven navigations — those are handled
    // by the PASS_DONE message handler which injects content.js itself.
    // Only re-inject on unexpected navigations (e.g. LinkedIn redirects).
    const navListener = async (tabId, changeInfo) => {
      if (tabId !== tab.id) return;
      if (changeInfo.status === 'complete' && !isControlledNavigation(tabId) && injectionCount < MAX_INJECTIONS) {
        const newTab = await chrome.tabs.get(tabId).catch(() => null);
        if (!newTab) return;
        // Treat ANY LinkedIn content-search URL as same-run navigation.
        // Pagination/sort/query changes can remove/alter origin params and should NOT restart extraction.
        const url = String(newTab.url || '');
        const isLinkedInHost = /https?:\/\/(?:www\.)?linkedin\.com\//i.test(url);
        const isContentSearchUrl = /linkedin\.com\/search\/results\/content\//i.test(url);
        const isAllowedInRun = isLinkedInHost && isContentSearchUrl;

        if (!isAllowedInRun) {
          console.log("🔄 [Worker] Unexpected navigation detected. Re-injecting...");
          await sleep(3000);
          await injectAndStart();
        } else {
          console.log("🔄 [Worker] In-run content-search navigation detected — skipping auto re-inject.");
        }
      }
    };
    chrome.tabs.onUpdated.addListener(navListener);

    // Heartbeat monitor
    const heartbeatInterval = setInterval(async () => {
      const s = await loadState();
      if (!s.isJobRunning || s.activeTabId !== tab.id) {
        clearInterval(heartbeatInterval);
        chrome.tabs.onUpdated.removeListener(navListener);
        return;
      }

      // Keep worker renderer alive in background mode.
      // If the worker window gets minimized, restore it to normal (unfocused) so scrolling/extraction continues.
      try {
        if (s.activeWindowId) {
          const w = await chrome.windows.get(s.activeWindowId);
          if (w && w.state === 'minimized') {
            await chrome.windows.update(s.activeWindowId, {
              state: 'normal',
              focused: false,
              width: 800,
              height: 600
            });
            console.log(`🪟 [Worker] Restored minimized worker window ${s.activeWindowId} to keep extraction active.`);
          }
        }
      } catch (e) {
        // Non-fatal: window may be closed by user.
      }

      const timeSinceHeartbeat = Date.now() - _lastContentHeartbeat;
      if (timeSinceHeartbeat > 90000 && !isControlledNavigation(tab.id) && injectionCount < MAX_INJECTIONS) {
        // v9: Raised re-inject threshold from 60s to 90s (content.js v10 pauses up to 3.5s/step × 5 = 17s between heartbeats)
        console.warn(`💀 [Worker] No heartbeat for ${Math.round(timeSinceHeartbeat / 1000)}s. Re-injecting...`);
        await injectAndStart();
      }
    }, 20000);

    // v10: Watchdog raised to 30 min for deep multi-round extraction (content.js v14)
    const WATCHDOG_MS = 1800000;
    const watchdogTabId = tab.id;
    setTimeout(async () => {
      clearInterval(heartbeatInterval);
      chrome.tabs.onUpdated.removeListener(navListener);
      const s = await loadState();
      if (s.isJobRunning && s.activeTabId === watchdogTabId) {
        console.warn("⏱️ [Worker] WATCHDOG: 30-min timeout reached. Triggering emergency memory flush...");
        
        try {
          // Force content.js to dump all un-synced posts to the backend API before dying
          await chrome.scripting.executeScript({
            target: { tabId: watchdogTabId },
            func: () => { if (window.__emergencySync) window.__emergencySync(); }
          });
          // Give the fetch operation inside background.js a few seconds to buffer the incoming DB write
          await sleep(4000); 
        } catch(e) {
          console.warn("⏱️ [Worker] Error during emergency sync:", e.message);
        }

        console.warn("⏱️ [Worker] WATCHDOG: Emergency sync complete. Force-killing tab.");
        chrome.tabs.remove(watchdogTabId).catch(() => { });
        await finishCycle(null, false, settings.searchOnlyMode);
      }
    }, WATCHDOG_MS);

  } catch (err) {
    console.error("❌ [Worker] Cycle failed:", err.message);
    await finishCycle(null, false, settings.searchOnlyMode);
  }
}

// ── Finish Cycle ──
// v9 FIX 2: Uses position-aware cooldown (3-keyword grouping for search mode)
async function finishCycle(tabId, incrementKeyword = true, searchOnlyMode = false) {
  if (tabId) {
    try { await chrome.tabs.remove(tabId); } catch (e) { }
  }

  const state = await loadState();
  const failures = incrementKeyword ? 0 : (state.consecutiveFailures || 0) + 1;

  // Get next keyword index for cooldown calculation
  const nextKwIndex = (state.currentSearchKeywordIndex || 0) + 1;

  const cd = getCooldown(nextKwIndex, 999 /* totalKeywords not needed for grouping */, failures, searchOnlyMode);

  const updates = {
    isJobRunning: false,
    activeTabId: null,
    activeWindowId: null,
    cycleStartTime: 0,
    lastJobTime: Date.now(),
    cooldownMs: cd,
    consecutiveFailures: failures,
    liveStatusText: ''
  };

  if (state.currentKeyword) {
    if (searchOnlyMode) {
      if (incrementKeyword) {
        updates.currentSearchKeywordIndex = nextKwIndex;
        updates.currentKeyword = null;
        const searchPages = state.keywordSearchPages || {};
        delete searchPages[state.currentKeyword];
        updates.keywordSearchPages = searchPages;

        // Log with group context
        const groupBoundary = nextKwIndex > 0 && nextKwIndex % 3 === 0;
        const cdSec = Math.round(cd / 1000);
        const cdLabel = cd >= 60000 ? `${Math.round(cd / 60000)} min` : `${cdSec}s`;
        console.log(`[Worker] ✅ "${state.currentKeyword}" done. → Keyword ${nextKwIndex}. Cooldown: ${cdLabel}${groupBoundary ? ' (GROUP BOUNDARY)' : ''}.`);
      } else {
        console.log(`[Worker] 🔄 Retrying "${state.currentKeyword}" on next cycle due to failure/0 posts.`);
      }
    } else {
      // Comment mode — only advance keyword cycle / clear keyword on real success (same idea as search-only retry).
      if (incrementKeyword) {
        updates.currentSearchKeywordIndex = nextKwIndex;
        updates.currentKeyword = null;
        const searchPages = state.keywordSearchPages || {};
        delete searchPages[state.currentKeyword];
        updates.keywordSearchPages = searchPages;

        const kc = state.keywordCycles || {};
        kc[state.currentKeyword] = (kc[state.currentKeyword] || 0) + 1;
        updates.keywordCycles = kc;
        updates.consecutiveFailures = 0;
        console.log(`[Worker] ✅ "${state.currentKeyword}" cycle → ${kc[state.currentKeyword]}.`);
      } else {
        console.log(`[Worker] 🔄 Comment job failed or 0 comments posted; "${state.currentKeyword}" cycle not advanced — will retry after cooldown.`);
      }
    }
  }

  await saveState(updates);
  const cdMin = Math.round(cd / 60000);
  const cdSec = Math.round(cd / 1000);
  const cdLabel = cd >= 60000 ? `${cdMin} min` : `${cdSec}s`;
  console.log(`[Worker] Cycle done. Cooldown: ${cdLabel}${failures > 0 ? ` (backoff level ${failures})` : ''}.`);
  showPremiumToast('Cycle Complete', `✅ Done! Cooling ${cdLabel} before next keyword...`, false);
}

async function handleTerminalJobResult(message, senderTabId) {
  const status = message.action === 'JOB_COMPLETED' ? "✅ COMPLETED" : "❌ FAILED";
  const posted = message.commentsPostedCount || 0;
  const assigned = message.assignedCommentsCount || 0;
  const blocked = message.linkedinBlocked || false;
  const isSearchOnly = message.searchOnlyMode === true;

  console.log(`📐 [Worker] Job ${status}. Real posts extracted: ${message.postsExtracted || 'N/A'} | SearchOnly: ${isSearchOnly} | Blocked: ${blocked}${message.reason ? ` | reason=${message.reason}` : ''}${message.resultStatus ? ` | result=${message.resultStatus}` : ''}`);

  let isSuccessfulCycle = message.action === 'JOB_COMPLETED';

  if (message.action === 'JOB_FAILED' && message.reason === 'CYCLE_INSUFFICIENT_TARGETS') {
    const st = await loadState();
    const kw = message.keyword || st.currentKeyword;
    if (message.insufficientRetryPass) {
      await saveState({ pendingCommentInsufficientRetry: null });
      console.log(`[Worker] Comment campaign: insufficient targets after retry for "${kw}" — advancing.`);
      showPremiumToast('Campaign', `Insufficient posts after retry for "${kw}".`, true);
    } else if (kw) {
      await saveState({ pendingCommentInsufficientRetry: kw });
      console.log(`[Worker] Comment campaign: scheduling one retry for "${kw}" (insufficient targets).`);
      showPremiumToast('Campaign', `Not enough posts — retrying once for "${kw}".`, false);
    }
    await finishCycle(senderTabId ?? st.activeTabId, message.insufficientRetryPass === true, false);
    return;
  }

  if (isSuccessfulCycle && !isSearchOnly && assigned > 0 && posted < assigned) {
    console.log(`[Worker] ✅ Partial comments: ${posted}/${assigned} — cycle complete.`);
    showPremiumToast('Partial comments', `Posted ${posted}/${assigned}. Cycle complete.`, false);
  }

  if (message.action === 'JOB_FAILED' && !isSearchOnly && message.reason === 'NO_COMMENTS_POSTED') {
    showPremiumToast('Comments not posted', 'No comments were posted this run; same cycle will retry after cooldown.', true);
  }

  if (blocked) {
    console.error(`[Worker] 🚫 LINKEDIN RESTRICTION DETECTED. Pausing 30 min.`);
    showPremiumToast('🚫 Account Restricted', `LinkedIn blocking comments. Pausing 30 min.`, true);
    const s = await loadState();
    await finishCycle(senderTabId ?? s.activeTabId, false, isSearchOnly);
    await saveState({ cooldownMs: 1800000 });
    return;
  }

  const s = await loadState();
  await finishCycle(senderTabId ?? s.activeTabId, isSuccessfulCycle, isSearchOnly);
}

// ── Message Router ──
// v9 FIX 3: Single listener handles all message types including both START_POLLING sources
let _lastContentHeartbeat = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── START_POLLING (from popup OR from dashboard-bridge) ──
  if (message.action === 'START_COMMENT_CAMPAIGN' || message.action === 'START_SEARCH_ONLY') {
    console.log(`🚀 [Worker] ${message.action} received.`);
    if (sendResponse) sendResponse({ ok: true, ack: true });
    const triggerStart = () => {
      try { self.__globalSyncedUrlsByKeyword = new Map(); } catch (e) {}
      chrome.storage.local.set({
        isPaused: false,
        keywordCycles: {},
        keywordSearchPages: {},
        cooldownMs: 0,
        cycleStartTime: 0,
        consecutiveFailures: 0,
        hourlyCommentsMade: 0,
        currentSearchCycle: 0,
        currentSearchKeywordIndex: 0,
        wasDashboardActive: false,
        pendingCommentInsufficientRetry: null
      }, () => {
        setTimeout(() => checkJobs(), 50);
      });
    };
    if (message.dashboardUrl && message.userId) {
      chrome.storage.sync.set({ dashboardUrl: message.dashboardUrl, userId: message.userId }, triggerStart);
    } else {
      triggerStart();
    }
    return true;
  }

  if (message.action === 'START_POLLING') {
    console.log("🚀 [Worker] START command received.");
    if (sendResponse) sendResponse({ ok: true, ack: true });

    const triggerStart = () => {
      try { self.__globalSyncedUrlsByKeyword = new Map(); } catch (e) {}
      chrome.storage.local.set({
        isPaused: false,
        keywordCycles: {},
        keywordSearchPages: {},
        cooldownMs: 0,
        cycleStartTime: 0,
        consecutiveFailures: 0,
        hourlyCommentsMade: 0,
        currentSearchCycle: 0,
        currentSearchKeywordIndex: 0,
        wasDashboardActive: false,
        pendingCommentInsufficientRetry: null
      }, () => {
        setTimeout(() => checkJobs(), 50);
      });
    };

    if (message.dashboardUrl && message.userId) {
      chrome.storage.sync.set({ dashboardUrl: message.dashboardUrl, userId: message.userId }, triggerStart);
    } else {
      triggerStart();
    }
    return true;
  }

  if (message.action === 'HEARTBEAT') {
    _lastContentHeartbeat = Date.now();
    console.log(`💓 [Worker] Heartbeat (Phase: ${message.phase || '?'})`);
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
        if (chrome.runtime.lastError) { /* popup closed */ }
      });
    } catch (e) { }
    return;
  }

  if (message.action === 'EXECUTE_COMMENT_PLAN') {
    if (sendResponse) sendResponse({ ok: true, accepted: true });
    (async () => {
      const s = await loadState();
      const tabId = sender.tab?.id || s.activeTabId;
      if (!tabId) {
        await handleTerminalJobResult({
          action: 'JOB_FAILED',
          reason: 'NO_ACTIVE_TAB_FOR_COMMENT_EXECUTION',
          commentsPostedCount: 0,
          assignedCommentsCount: message.assignedCommentsCount || 0,
          searchOnlyMode: false,
          postsExtracted: message.postsExtracted || 0,
          keyword: message.keyword,
          commentCycleNumber: message.commentCycleNumber || 1,
          commentScrollPassesUsed: message.commentScrollPassesUsed || 0,
          commentsAttempted: 0,
          commentsFailed: message.assignedCommentsCount || 0
        }, null);
        return;
      }

      const result = await runCommentExecutionPlan(tabId, message);
      console.log('[Worker] Direct comment execution summary:', JSON.stringify(result));

      await handleTerminalJobResult({
        action: result.blocked
          ? 'JOB_COMPLETED'
          : (result.assignedCommentsCount > 0 && result.posted < result.assignedCommentsCount ? 'JOB_FAILED' : 'JOB_COMPLETED'),
        reason: result.blocked
          ? undefined
          : (result.posted === 0 ? 'NO_COMMENTS_POSTED' : (result.posted < result.assignedCommentsCount ? 'COMMENT_CYCLE_INCOMPLETE' : undefined)),
        commentsPostedCount: result.posted,
        assignedCommentsCount: result.assignedCommentsCount,
        searchOnlyMode: false,
        linkedinBlocked: result.blocked,
        postsExtracted: result.postsExtracted,
        keyword: result.keyword,
        commentCycleNumber: result.commentCycleNumber,
        commentScrollPassesUsed: result.commentScrollPassesUsed,
        commentsAttempted: result.commentsAttempted,
        commentsFailed: result.commentsFailed
      }, tabId);
    })().catch(async (e) => {
      console.error('[Worker] EXECUTE_COMMENT_PLAN failed:', e.message);
      await handleTerminalJobResult({
        action: 'JOB_FAILED',
        reason: 'COMMENT_EXECUTION_CRASHED',
        commentsPostedCount: 0,
        assignedCommentsCount: message.assignedCommentsCount || 0,
        searchOnlyMode: false,
        postsExtracted: message.postsExtracted || 0,
        keyword: message.keyword,
        commentCycleNumber: message.commentCycleNumber || 1,
        commentScrollPassesUsed: message.commentScrollPassesUsed || 0,
        commentsAttempted: 0,
        commentsFailed: message.assignedCommentsCount || 0
      }, sender.tab?.id || null);
    });
    return true;
  }

  if (message.action === 'COMMENT_POSTED') {
    loadState().then(async s => {
      const newDaily = (s.dailyCommentsMade || 0) + 1;
      const newHourly = (s.hourlyCommentsMade || 0) + 1;
      await saveState({ dailyCommentsMade: newDaily, hourlyCommentsMade: newHourly });
      console.log(`💬 [Worker] Comment posted. Daily: ${newDaily}/15 | Hourly: ${newHourly}/12`);
      showPremiumToast('Comment Posted', `Comment #${newDaily}/15 today (${newHourly}/12 this hour)!`, false);
      const config = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
      if (config.dashboardUrl && config.userId) {
        const deviceId = await getExtensionFingerprint();
        fetch(`${config.dashboardUrl}/api/extension/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-extension-token': config.userId, 'x-device-id': deviceId },
          body: JSON.stringify({ action: 'COMMENT', postUrl: message.url || 'LinkedIn Post', comment: 'Commented successfully.' })
        }).catch(e => console.error("❌ [Worker] Action log failed:", e));
      }
      if (sendResponse) sendResponse({ ok: true });
    });
    return true;
  }

  if (message.action === 'IDENTITY_DETECTED') {
    chrome.storage.local.set({ linkedInProfileId: message.linkedInProfileId });
    if (sendResponse) sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'SYNC_RESULTS') {
    const { posts, keyword, dashboardUrl, userId, linkedInProfileId, debugInfo } = message;
    
    // Dedupe per keyword run so one keyword cannot suppress another.
    if (!self.__globalSyncedUrlsByKeyword) self.__globalSyncedUrlsByKeyword = new Map();
    const keywordKey = String(keyword || '__global__');
    if (!self.__globalSyncedUrlsByKeyword.has(keywordKey)) {
      self.__globalSyncedUrlsByKeyword.set(keywordKey, new Set());
    }
    const keywordSeen = self.__globalSyncedUrlsByKeyword.get(keywordKey);
    const uniquePosts = posts.filter(p => {
       if (!p.url) return false;
       const clean = p.url.split('?')[0];
       if (keywordSeen.has(clean)) return false;
       keywordSeen.add(clean);
       return true;
    });

    console.log(`📤 [Worker] Relaying ${uniquePosts.length} unique posts (filtered from ${posts.length}) for "${keyword}"...`);
    
    // Empty batch prevention
    if (uniquePosts.length === 0) {
        console.warn(`[Worker] SYNC_RESULTS received 0 unique posts. Skipping relay.`);
        if (sendResponse) sendResponse({ ok: true, savedCount: 0 });
        return true;
    }

    (async () => {
      let savedCount = 0;
      let success = false;
      let lastError = null;
      try {
        const deviceId = await getExtensionFingerprint();
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`[Worker] Sync attempt ${attempt}/3...`);
            const response = await fetch(`${dashboardUrl}/api/extension/results`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-extension-token': userId, 'x-device-id': deviceId },
              body: JSON.stringify({ keyword, posts: uniquePosts, linkedInProfileId, debugInfo })
            });
            
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${await response.text().catch(()=>'')}`);
            }
            
            const result = await response.json().catch(() => ({}));
            savedCount = result.savedCount || 0;
            console.log(`✅ [Worker] Database sync successful. ${result.savedCount || 0} NEW + ${result.updatedCount || 0} UPDATED = ${posts.length} total relayed.`);
            if (result.errors && result.errors.length > 0) {
                console.error(`❌ [Worker] API reported ${result.errors.length} Prisma errors:`, result.errors);
            }
            success = true;
            break;
          } catch (e) {
            lastError = e;
            console.error(`⚠️ [Worker] Sync attempt ${attempt} failed:`, e.message);
            if (attempt < 3) await sleep(2000 * attempt);
          }
        }
        
        if (!success) {
          console.error("❌ [Worker] CRITICAL SYNC FAILURE. Data could not be saved to dashboard:", lastError);
        }
      } catch (err) {
        console.error("❌ [Worker] Error preparing sync:", err);
      }
      
      if (sendResponse) sendResponse({ ok: success, savedCount });
    })();
    return true;
  }

  if (message.action === 'PASS_DONE') {
    const { passIndex, posts, keyword, linkedInProfileId, filterParam, totalSaved } = message;
    const realCount = (posts || []).filter(p => p.url && !p.url.includes('synthetic:')).length;
    const highConf = (posts || []).filter(p => (p.likes||0) + (p.postComments||0) > 0).length;
    console.log(`📄 [Worker] PASS_DONE pass=${passIndex} | ${posts?.length || 0} total (${realCount} real, ${highConf} high-conf) | filterParam=${filterParam || 'none'} | saved=${totalSaved || 0}`);

    loadState().then(async s => {
      if (!s.isJobRunning) { console.warn('[Worker] PASS_DONE received but job not running. Ignoring.'); return; }
      const config = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
      const settingsData = await chrome.storage.local.get(['jobSettings', 'jobComments']);
      const jobSettings = settingsData.jobSettings || {};
      const jobComments = settingsData.jobComments || [];

      console.log(`[Worker] PASS_DONE: Multi-pass disabled. Treating pass as final.`);
      await finishCycle(sender.tab?.id ?? s.activeTabId, true, jobSettings.searchOnlyMode);
    });
    if (sendResponse) sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'JOB_COMPLETED' || message.action === 'JOB_FAILED') {
    handleTerminalJobResult(message, sender.tab?.id || null).catch(e => {
      console.error('[Worker] Terminal result handling failed:', e.message);
    });
    return;
    const status = message.action === 'JOB_COMPLETED' ? "✅ COMPLETED" : "❌ FAILED";
    const posted = message.commentsPostedCount || 0;
    const assigned = message.assignedCommentsCount || 0;
    const blocked = message.linkedinBlocked || false;
    const isSearchOnly = message.searchOnlyMode === true;

    console.log(`🏁 [Worker] Job ${status}. Real posts extracted: ${message.postsExtracted || 'N/A'} | SearchOnly: ${isSearchOnly} | Blocked: ${blocked}${message.reason ? ` | reason=${message.reason}` : ''}${message.resultStatus ? ` | result=${message.resultStatus}` : ''}`);

    let isSuccessfulCycle = message.action === 'JOB_COMPLETED';

    if (message.action === 'JOB_FAILED' && message.reason === 'CYCLE_INSUFFICIENT_TARGETS') {
      (async () => {
        const st = await loadState();
        const kw = message.keyword || st.currentKeyword;
        if (message.insufficientRetryPass) {
          await saveState({ pendingCommentInsufficientRetry: null });
          console.log(`[Worker] Comment campaign: insufficient targets after retry for "${kw}" — advancing.`);
          showPremiumToast('Campaign', `Insufficient posts after retry for "${kw}".`, true);
        } else if (kw) {
          await saveState({ pendingCommentInsufficientRetry: kw });
          console.log(`[Worker] Comment campaign: scheduling one retry for "${kw}" (insufficient targets).`);
          showPremiumToast('Campaign', `Not enough posts — retrying once for "${kw}".`, false);
        }
        await finishCycle(sender.tab?.id ?? st.activeTabId, message.insufficientRetryPass === true, false);
      })();
      return;
    }

    if (isSuccessfulCycle && !isSearchOnly) {
      if (assigned > 0 && posted < assigned) {
        console.log(`[Worker] ✅ Partial comments: ${posted}/${assigned} — cycle complete.`);
        showPremiumToast('Partial comments', `Posted ${posted}/${assigned}. Cycle complete.`, false);
      }
    }

    if (message.action === 'JOB_FAILED' && !isSearchOnly && message.reason === 'NO_COMMENTS_POSTED') {
      showPremiumToast('Comments not posted', 'No comments were posted this run; same cycle will retry after cooldown.', true);
    }

    if (blocked) {
      console.error(`[Worker] 🚫 LINKEDIN RESTRICTION DETECTED. Pausing 30 min.`);
      showPremiumToast('🚫 Account Restricted', `LinkedIn blocking comments. Pausing 30 min.`, true);
      loadState().then(s => finishCycle(sender.tab?.id ?? s.activeTabId, false, isSearchOnly));
      saveState({ cooldownMs: 1800000 });
      return;
    }

    loadState().then(s => finishCycle(sender.tab?.id ?? s.activeTabId, isSuccessfulCycle, isSearchOnly));
  }
});

// ── Alarm + Startup ──
chrome.alarms.create('checkJobsAlarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkJobsAlarm') checkJobs();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("🚀 [Worker] v11 installed.");
  saveState({ isJobRunning: false, activeTabId: null, cycleStartTime: 0, consecutiveFailures: 0 });
  setTimeout(() => checkJobs(), 5000);
});

chrome.runtime.onStartup.addListener(() => {
  console.log("⚙️ [Worker] Restarting...");
  setTimeout(() => checkJobs(), 5000);
});
