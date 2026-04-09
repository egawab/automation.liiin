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
        
        if (state.isPaused) {
            statusDot.classList.add('pulse-red');
            statusTitle.textContent = 'Engine Paused';
            statusSub.textContent = 'Click Start to resume automation';
            playPauseBtn.className = 'btn btn-success';
            playPauseBtn.innerHTML = '▶ START ENGINE';
            return;
        }

        if (state.isJobRunning) {
            statusDot.classList.add('pulse-green');
            statusTitle.textContent = 'Engine Active';
            statusSub.textContent = 'Currently scanning and commenting';
            playPauseBtn.className = 'btn btn-danger';
            playPauseBtn.innerHTML = '⏸ PAUSE ENGINE';
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
            return;
        }

        // Default Idle
        statusDot.classList.add('pulse-orange');
        statusTitle.textContent = 'Idle';
        statusSub.textContent = 'Waiting to trigger net cycle';
        playPauseBtn.className = 'btn btn-danger';
        playPauseBtn.innerHTML = '⏸ PAUSE ENGINE';
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

});
