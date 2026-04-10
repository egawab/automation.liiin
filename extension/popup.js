console.log("[POPUP] Nexora Pro Script loaded!");

document.addEventListener('DOMContentLoaded', () => {
    // Views
    const setupView = document.getElementById('setupView');
    const dashboardView = document.getElementById('dashboardView');

    // Setup Elements
    const autoConnectBtn = document.getElementById('autoConnectBtn');
    const setupMsg = document.getElementById('setupMsg');
    const dashInput = document.getElementById('dashboardUrl');
    const userIdInput = document.getElementById('userId');
    const saveBtn = document.getElementById('saveBtn');

    // Dashboard Elements
    const disconnectBtn = document.getElementById('disconnectBtn');
    const openDashboardBtn = document.getElementById('openDashboardBtn');
    const statusDot = document.getElementById('statusDot');
    const statusTitle = document.getElementById('statusTitle');
    const statusSub = document.getElementById('statusSub');
    const countComments = document.getElementById('countComments');
    const countCycles = document.getElementById('countCycles');
    const currentKeyword = document.getElementById('currentKeyword');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const actionMsg = document.getElementById('actionMsg');

    let currentDashboardUrl = '';

    // ==========================================
    // VIEW ROUTING & STATE INITIALIZATION
    // ==========================================
    function loadInitialState() {
        chrome.storage.sync.get(['dashboardUrl', 'userId'], (syncData) => {
            if (syncData.dashboardUrl && syncData.userId) {
                currentDashboardUrl = syncData.dashboardUrl;
                showDashboardView();
            } else {
                showSetupView();
            }
        });
    }

    function showSetupView() {
        setupView.classList.remove('hidden');
        dashboardView.classList.add('hidden');
        disconnectBtn.classList.add('hidden');
    }

    function showDashboardView() {
        setupView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        disconnectBtn.classList.remove('hidden');
        refreshDashboardStats();
    }

    loadInitialState();

    // ==========================================
    // 1. SETUP VIEW LOGIC
    // ==========================================
    
    // Auto-Connect (Seamless Flow)
    if (autoConnectBtn) {
      autoConnectBtn.addEventListener('click', async () => {
        autoConnectBtn.disabled = true;
        autoConnectBtn.textContent = '🔄 Connecting...';
        setupMsg.textContent = '';
        setupMsg.style.color = '#6b7280';

        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab || !tab.id || !tab.url) throw new Error('No active tab found. Open your Nexora dashboard first.');

          // Validate URL is not a chrome:// or edge:// internal page
          if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
            throw new Error('Please navigate to your Nexora Dashboard page first, then click Auto-Connect.');
          }

          const tabUrl = new URL(tab.url);
          const dashboardUrl = tabUrl.origin;
          setupMsg.textContent = '🔍 Reading auth credentials...';

          // Strategy: Read the auth_token cookie directly from the dashboard domain
          // Then decode the JWT payload to extract the userId — zero network calls needed
          const cookie = await chrome.cookies.get({ url: dashboardUrl, name: 'auth_token' });

          if (cookie && cookie.value) {
            // Decode JWT payload (middle segment, base64url encoded)
            try {
              const parts = cookie.value.split('.');
              if (parts.length === 3) {
                // Decode base64url → base64 → string
                const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                const decoded = JSON.parse(atob(payload));
                
                if (decoded.userId) {
                  console.log('[POPUP] Auto-Connect: Cookie strategy succeeded. userId:', decoded.userId);
                  chrome.storage.sync.set({ dashboardUrl: dashboardUrl, userId: decoded.userId }, () => {
                    setupMsg.style.color = '#10b981';
                    setupMsg.textContent = '✅ Connected Successfully!';
                    autoConnectBtn.textContent = '✅ Connected!';
                    setTimeout(() => loadInitialState(), 800);
                  });
                  return;
                }
              }
            } catch (decodeErr) {
              console.warn('[POPUP] JWT decode failed:', decodeErr.message);
            }
          }

          // Fallback: DOM element detection (if dashboard has the hidden connect element)
          setupMsg.textContent = '🔍 Scanning page...';
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                const el = document.getElementById('nexora-connect-data');
                if (el) {
                  const uid = el.getAttribute('data-user-id');
                  const durl = el.getAttribute('data-dashboard-url');
                  if (uid && uid.length > 5) return { userId: uid, dashboardUrl: durl };
                }
                return null;
              }
            });
            const domData = results?.[0]?.result;
            if (domData && domData.userId) {
              console.log('[POPUP] Auto-Connect: DOM fallback succeeded.');
              chrome.storage.sync.set({ dashboardUrl: domData.dashboardUrl, userId: domData.userId }, () => {
                setupMsg.style.color = '#10b981';
                setupMsg.textContent = '✅ Connected Successfully!';
                autoConnectBtn.textContent = '✅ Connected!';
                setTimeout(() => loadInitialState(), 800);
              });
              return;
            }
          } catch (domErr) {
            console.warn('[POPUP] DOM fallback failed:', domErr.message);
          }

          throw new Error('Not logged in. Please log in to your Nexora Dashboard first, then try Auto-Connect again.');
        } catch (err) {
          setupMsg.style.color = '#ef4444';
          setupMsg.textContent = '❌ ' + err.message;
          setTimeout(() => {
            autoConnectBtn.disabled = false;
            autoConnectBtn.textContent = '🔗 Auto-Connect';
          }, 3000);
        }
      });
    }

    // Manual Save
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        let url = dashInput.value.trim();
        const uid = userIdInput.value.trim();
        if (!url || !uid) { setupMsg.style.color = 'red'; setupMsg.textContent = 'Fill both fields.'; return; }
        if (url.endsWith('/')) url = url.slice(0, -1);
        
        chrome.storage.sync.set({ dashboardUrl: url, userId: uid }, () => {
          loadInitialState();
        });
      });
    }

    // ==========================================
    // 2. DASHBOARD VIEW LOGIC
    // ==========================================

    function refreshDashboardStats() {
      chrome.storage.local.get({
        isJobRunning: false,
        isPaused: false,
        cooldownMs: 0,
        lastJobTime: 0,
        currentKeyword: null,
        dailyCommentsMade: 0,
        keywordCycles: {}
      }, updateDashboardUI);
    }

    function updateDashboardUI(state) {
        // Comments Counter
        countComments.textContent = `${state.dailyCommentsMade || 0}/15`;

        // Keyword & Cycles
        if (state.currentKeyword) {
            currentKeyword.textContent = state.currentKeyword;
            const cycles = state.keywordCycles[state.currentKeyword] || 0;
            countCycles.textContent = `${cycles}/3`;
        } else {
            currentKeyword.textContent = 'Waiting for jobs...';
            countCycles.textContent = '-/3';
        }

        // Status Logic
        statusDot.className = 'pulse-dot';
        const liveStatusEl = document.getElementById('liveStatusText');
        const terminalHud = document.getElementById('terminalHud');
        
        if (state.isPaused) {
            statusDot.classList.add('pulse-red');
            statusTitle.textContent = 'Engine Paused';
            statusSub.textContent = 'Click Start to resume automation';
            playPauseBtn.className = 'btn btn-success';
            playPauseBtn.innerHTML = '▶ START ENGINE';
            if (terminalHud) terminalHud.style.display = 'none';
            return;
        }

        if (state.isJobRunning) {
            statusDot.classList.add('pulse-green');
            statusTitle.textContent = 'Engine Active';
            statusSub.textContent = 'Currently scanning and commenting';
            playPauseBtn.className = 'btn btn-danger';
            playPauseBtn.innerHTML = '⏸ PAUSE ENGINE';
            if (terminalHud) {
                terminalHud.style.display = 'block';
                if (liveStatusEl) liveStatusEl.textContent = state.liveStatusText || 'Initializing components...';
            }
            return;
        }

        // Cooldown or Idle check
        const elapsed = Date.now() - state.lastJobTime;
        if (state.lastJobTime > 0 && elapsed < state.cooldownMs) {
            statusDot.classList.add('pulse-orange');
            statusTitle.textContent = 'Engine Resting';
            const left = Math.ceil((state.cooldownMs - elapsed)/60000);
            statusSub.textContent = `Cooling down safely (${left}m left)`;
            playPauseBtn.className = 'btn btn-danger';
            playPauseBtn.innerHTML = '⏸ PAUSE ENGINE';
            if (terminalHud) {
                terminalHud.style.display = 'block';
                if (liveStatusEl) liveStatusEl.innerHTML = `<span style="color:#f59e0b;">Waiting for cooldown... resuming in ${left}m.</span>`;
            }
            return;
        }

        // Default Idle
        statusDot.classList.add('pulse-orange');
        statusTitle.textContent = 'Idle';
        statusSub.textContent = 'Waiting to trigger net cycle';
        playPauseBtn.className = 'btn btn-danger';
        playPauseBtn.innerHTML = '⏸ PAUSE ENGINE';
        if (terminalHud) {
            terminalHud.style.display = 'block';
            if (liveStatusEl) liveStatusEl.textContent = 'Waiting for jobs...';
        }
    }

    // Live update when background changes storage
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') refreshDashboardStats();
    });

    // Play/Pause Action
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', () => {
            chrome.storage.local.get(['isPaused'], (state) => {
                const newState = !state.isPaused;
                // If unpausing, let's reset cooldown so it can start immediately
                const updates = { isPaused: newState };
                if (!newState) {
                  updates.lastJobTime = 0; // immediate trigger
                  updates.cooldownMs = 0;
                }
                chrome.storage.local.set(updates, () => {
                  actionMsg.textContent = newState ? 'Engine paused manually.' : 'Engine started!';
                  setTimeout(() => actionMsg.textContent = '', 2000);
                });
            });
        });
    }

    // Header Actions
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', () => {
            chrome.storage.sync.clear(() => {
                chrome.storage.local.clear(() => {
                    loadInitialState();
                });
            });
        });
    }

    if (openDashboardBtn) {
        openDashboardBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentDashboardUrl) chrome.tabs.create({ url: currentDashboardUrl });
        });
    }

    // Live terminal listening
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'EXTENSION_LIVE_STATUS') {
            const liveStatusEl = document.getElementById('liveStatusText');
            if (liveStatusEl) {
                liveStatusEl.textContent = message.text;
                // Add tiny flash effect to indicate it updated
                liveStatusEl.style.opacity = '0.5';
                setTimeout(() => liveStatusEl.style.opacity = '1', 100);
            }
        }
    });

});
