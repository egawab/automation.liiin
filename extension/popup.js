console.log("[POPUP] Nexora Pro loaded");

document.addEventListener('DOMContentLoaded', () => {
    const setupView      = document.getElementById('setupView');
    const dashboardView  = document.getElementById('dashboardView');
    const autoConnectBtn = document.getElementById('autoConnectBtn');
    const setupMsg       = document.getElementById('setupMsg');
    const dashInput      = document.getElementById('dashboardUrl');
    const userIdInput    = document.getElementById('userId');
    const saveBtn        = document.getElementById('saveBtn');
    const disconnectBtn  = document.getElementById('disconnectBtn');
    const openDashboardBtn = document.getElementById('openDashboardBtn');
    const statusTitle    = document.getElementById('statusTitle');
    const statusSub      = document.getElementById('statusSub');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusCard     = document.getElementById('statusCard');
    const statusIcon     = document.getElementById('statusIcon');
    const currentKeyword = document.getElementById('currentKeyword');

    let currentDashboardUrl = '';
    let isRunning = false;

    // ── Load state ──────────────────────────────────────────────
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
        setIdle();
    }

    loadInitialState();

    // ── Check if engine already running (started from dashboard) ────────
    function syncStatusFromBackground() {
        chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (resp) => {
            if (chrome.runtime.lastError || !resp) return;
            if (resp.running && resp.keyword) {
                setRunning(resp.keyword);
                statusSub.textContent = `⚙️ ${resp.state} | Saved: ${resp.totalSaved}`;
            } else {
                setIdle();
            }
        });
    }
    setTimeout(syncStatusFromBackground, 600);
    setInterval(syncStatusFromBackground, 4000);

    function setIdle() {
        isRunning = false;
        statusIndicator.className = 'status-indicator';
        statusCard.className      = 'glass-card status-card';
        statusIcon.textContent    = '💤';
        statusTitle.textContent   = 'Ready';
        statusSub.textContent     = 'Use START button below or Dashboard';
        const sb = document.getElementById('popupStartBtn');
        if (sb) { sb.textContent = '🚀 START'; sb.style.background = 'var(--success)'; }
    }

    function setRunning(keyword) {
        isRunning = true;
        statusIndicator.className = 'status-indicator active';
        statusCard.className      = 'glass-card status-card active';
        statusIcon.textContent    = '⚡';
        statusTitle.textContent   = 'Engine Active';
        statusSub.textContent     = `Searching: "${keyword || '...'}"`;
        if (currentKeyword && keyword) currentKeyword.textContent = keyword;
        const sb = document.getElementById('popupStartBtn');
        if (sb) { sb.textContent = '⏹ STOP'; sb.style.background = 'var(--danger)'; }
    }

    // ── Direct Start/Stop from Popup ────────────────────────────
    const popupStartBtn = document.getElementById('popupStartBtn');
    if (popupStartBtn) {
        popupStartBtn.addEventListener('click', () => {
            if (isRunning) {
                popupStartBtn.textContent = '⏳ Stopping...';
                chrome.runtime.sendMessage({ action: 'STOP_ENGINE' }, () => { syncStatusFromBackground(); });
            } else {
                popupStartBtn.textContent = '⏳ Starting...';
                chrome.storage.sync.get(['dashboardUrl', 'userId'], (cfg) => {
                    chrome.runtime.sendMessage(
                        { action: 'START_ENGINE', dashboardUrl: cfg.dashboardUrl, userId: cfg.userId },
                        (resp) => {
                            const err = chrome.runtime.lastError;
                            if (err) { statusSub.textContent = '❌ ' + err.message; setIdle(); return; }
                            statusSub.textContent = '⚡ Starting engine...';
                        }
                    );
                });
            }
        });
    }


    // ── Auto Connect ────────────────────────────────────────────
    if (autoConnectBtn) {
        autoConnectBtn.addEventListener('click', async () => {
            autoConnectBtn.disabled = true;
            autoConnectBtn.textContent = '🔄 Connecting...';
            setupMsg.textContent = '';
            setupMsg.style.color = '#6b7280';
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab || !tab.url) throw new Error('No active tab found.');
                if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
                    throw new Error('Please open your Dashboard page first.');
                }
                const tabUrl = new URL(tab.url);
                const dashboardUrl = tabUrl.origin;
                setupMsg.textContent = '🔍 Reading auth token...';
                const cookie = await chrome.cookies.get({ url: dashboardUrl, name: 'auth_token' });
                if (cookie && cookie.value) {
                    const parts = cookie.value.split('.');
                    if (parts.length === 3) {
                        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                        const decoded = JSON.parse(atob(payload));
                        if (decoded.userId) {
                            chrome.storage.sync.set({ dashboardUrl, userId: decoded.userId }, () => {
                                setupMsg.style.color = '#10b981';
                                setupMsg.textContent = '✅ Connected!';
                                autoConnectBtn.textContent = '✅ Connected!';
                                setTimeout(loadInitialState, 800);
                            });
                            return;
                        }
                    }
                }
                throw new Error('Not logged in. Open Dashboard first.');
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

    // ── Manual Save ─────────────────────────────────────────────
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            let url = dashInput.value.trim();
            const uid = userIdInput.value.trim();
            if (!url || !uid) {
                setupMsg.style.color = 'red';
                setupMsg.textContent = 'Fill both fields.';
                return;
            }
            if (url.endsWith('/')) url = url.slice(0, -1);
            chrome.storage.sync.set({ dashboardUrl: url, userId: uid }, loadInitialState);
        });
    }


    // ── Disconnect ──────────────────────────────────────────────
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', () => {
            chrome.storage.sync.clear(() => {
                chrome.storage.local.clear(() => {
                    loadInitialState();
                });
            });
        });
    }

    // ── Open Dashboard ──────────────────────────────────────────
    if (openDashboardBtn) {
        openDashboardBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentDashboardUrl) chrome.tabs.create({ url: currentDashboardUrl });
        });
    }

    // ── Messages from content.js / background ───────────────────
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'SCRAPER_COMPLETE') {
            setIdle();
            const total = message.totalSaved || 0;
            statusSub.textContent = `✅ Done! ${total} posts collected.`;
        }
        if (message.action === 'EXTENSION_LIVE_STATUS') {
            statusSub.textContent = message.text || '';
        }
    });
});
