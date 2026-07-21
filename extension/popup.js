console.log("[POPUP] Nexora Pro loaded");

function normalizeDashboardUrl(raw) {
    if (!raw) return '';
    let s = String(raw).trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try { return new URL(s).origin; }
    catch (_) { return s.replace(/\/+$/, '').replace(/\/(dashboard|login|register|admin).*$/i, ''); }
}

function decodeJwtPayload(token) {
    try {
        const parts = String(token).split('.');
        if (parts.length < 2) return null;
        let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (payload.length % 4) payload += '=';
        return JSON.parse(atob(payload));
    } catch (_) { return null; }
}

async function verifyDashboardConnection(dashboardUrl, userId) {
    const url = normalizeDashboardUrl(dashboardUrl) + '/api/extension/jobs';
    const resp = await fetch(url, { headers: { 'x-extension-token': userId } });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    if (resp.status === 404) {
        const html404 = /<!DOCTYPE html|This page could not be found|404: NOT_FOUND/i.test(text);
        if (html404) throw new Error('API not found at ' + url + '. Wrong site URL, or server not deployed with extension APIs.');
        if (json?.error === 'User not found') throw new Error('User ID not found on this dashboard. Log in again and Auto-Connect.');
        throw new Error('Jobs API 404: ' + (json?.error || text.slice(0, 120)));
    }
    if (!resp.ok) throw new Error('Jobs API HTTP ' + resp.status + (json?.error ? (': ' + json.error) : ''));
    return json;
}

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
    const popupStartBtn  = document.getElementById('popupStartBtn');

    let currentDashboardUrl = '';
    let isRunning = false;
    // Prevent the 4s poll from wiping a just-started "Starting..." UI
    // before background has finished loading keywords.
    let uiLockedUntil = 0;
    const canSend = () => typeof chrome !== 'undefined' && !!chrome?.runtime?.sendMessage;

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
        syncStatusFromBackground();
    }

    loadInitialState();

    function applyStatus(resp) {
        if (!resp) return;
        const running = !!(resp.running || resp.state === 'RUNNING' || resp.state === 'STARTING');
        const cCom = document.getElementById('countComments');
        const cCyc = document.getElementById('countCycles');
        if (cCom) cCom.textContent = String(resp.totalSaved || resp.totalCommentsPosted || 0);
        if (cCyc) {
            const cur = (resp.cycleIndex || resp.kwIndex || 0) + (running ? 1 : 0);
            cCyc.textContent = `${cur}/${resp.targetCycles || resp.keywordCount || 1}`;
        }
        if (running) {
            setRunning(resp.keyword || '…');
            if (resp.message) statusSub.textContent = resp.message;
            else statusSub.textContent = `⚙ ${resp.state || 'RUNNING'} | Saved: ${resp.totalSaved || 0}`;
        } else if (Date.now() < uiLockedUntil) {
            // Keep the temporary "Starting..." UI — don't snap back to Ready.
        } else {
            setIdle();
            if (resp.lastError) statusSub.textContent = '❌ ' + resp.lastError;
        }
    }

    function syncStatusFromBackground() {
        if (!canSend()) return;
        chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (resp) => {
            if (chrome.runtime.lastError || !resp) return;
            applyStatus(resp);
        });
    }
    setTimeout(syncStatusFromBackground, 400);
    setInterval(syncStatusFromBackground, 2000);

    function setIdle() {
        isRunning = false;
        statusIndicator.className = 'status-indicator';
        statusCard.className      = 'glass-card status-card';
        statusIcon.textContent    = '💤';
        statusTitle.textContent   = 'Ready';
        statusSub.textContent     = 'Use START button below or Dashboard';
        if (popupStartBtn) {
            popupStartBtn.disabled = false;
            popupStartBtn.textContent = '🚀 START';
            popupStartBtn.style.background = 'var(--success)';
        }
    }

    function setRunning(keyword) {
        isRunning = true;
        statusIndicator.className = 'status-indicator active';
        statusCard.className      = 'glass-card status-card active';
        statusIcon.textContent    = '⚡';
        statusTitle.textContent   = 'Engine Active';
        statusSub.textContent     = `Searching: "${keyword || '...'}"`;
        if (currentKeyword && keyword) currentKeyword.textContent = keyword;
        if (popupStartBtn) {
            popupStartBtn.disabled = false;
            popupStartBtn.textContent = '⏹ STOP';
            popupStartBtn.style.background = 'var(--danger)';
        }
    }

    function setStarting() {
        uiLockedUntil = Date.now() + 15000;
        isRunning = true;
        statusIndicator.className = 'status-indicator active';
        statusCard.className      = 'glass-card status-card active';
        statusIcon.textContent    = '⚡';
        statusTitle.textContent   = 'Starting…';
        statusSub.textContent     = 'Connecting to dashboard & loading keywords…';
        if (popupStartBtn) {
            popupStartBtn.disabled = true;
            popupStartBtn.textContent = '⏳ Starting...';
            popupStartBtn.style.background = 'var(--warning)';
        }
    }

    if (popupStartBtn) {
        popupStartBtn.addEventListener('click', () => {
            if (isRunning) {
                popupStartBtn.disabled = true;
                popupStartBtn.textContent = '⏳ Stopping...';
                uiLockedUntil = 0;
                if (canSend()) {
                    chrome.runtime.sendMessage({ action: 'STOP_ENGINE' }, () => {
                        setIdle();
                        syncStatusFromBackground();
                    });
                } else {
                    setIdle();
                }
                return;
            }

            setStarting();
            chrome.storage.sync.get(['dashboardUrl', 'userId'], (cfg) => {
                if (!cfg.dashboardUrl || !cfg.userId) {
                    uiLockedUntil = 0;
                    setIdle();
                    statusSub.textContent = '❌ Not connected. Use Auto-Connect or enter URL + User ID.';
                    return;
                }
                if (!canSend()) {
                    uiLockedUntil = 0;
                    setIdle();
                    statusSub.textContent = '❌ Extension runtime unavailable. Reload the extension.';
                    return;
                }
                chrome.runtime.sendMessage(
                    { action: 'START_ENGINE', dashboardUrl: cfg.dashboardUrl, userId: cfg.userId },
                    (resp) => {
                        const err = chrome.runtime.lastError;
                        if (err) {
                            uiLockedUntil = 0;
                            setIdle();
                            statusSub.textContent = '❌ ' + err.message;
                            return;
                        }
                        if (!resp || resp.ok === false) {
                            uiLockedUntil = 0;
                            setIdle();
                            statusSub.textContent = '❌ ' + (resp?.reason || resp?.error || 'Start failed');
                            return;
                        }
                        // Keep "Starting…" locked briefly; poll will flip to Running
                        // once keywords load and state is confirmed RUNNING.
                        statusSub.textContent = '⚡ Engine started — collecting posts…';
                        setTimeout(syncStatusFromBackground, 800);
                    }
                );
            });
        });
    }

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
                const dashboardUrl = normalizeDashboardUrl(tabUrl.origin);
                setupMsg.textContent = '🔍 Reading auth token...';
                const cookie = await chrome.cookies.get({ url: dashboardUrl, name: 'auth_token' });
                if (cookie && cookie.value) {
                    const decoded = decodeJwtPayload(cookie.value);
                    if (decoded && decoded.userId) {
                        setupMsg.textContent = '🧪 Verifying API connection…';
                        await verifyDashboardConnection(dashboardUrl, decoded.userId);
                        chrome.storage.sync.set({ dashboardUrl, userId: decoded.userId }, () => {
                            setupMsg.style.color = '#10b981';
                            setupMsg.textContent = '✅ Connected! ' + dashboardUrl;
                            autoConnectBtn.textContent = '✅ Connected!';
                            setTimeout(loadInitialState, 800);
                        });
                        return;
                    }
                }
                // Fallback: read User ID from the dashboard DOM if cookie decode failed
                try {
                    const [{ result: domUserId }] = await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: () => {
                            const el = document.getElementById('nexora-connect-data');
                            return el?.dataset?.userId || '';
                        }
                    });
                    if (domUserId) {
                        setupMsg.textContent = '🧪 Verifying API connection…';
                        await verifyDashboardConnection(dashboardUrl, domUserId);
                        chrome.storage.sync.set({ dashboardUrl, userId: domUserId }, () => {
                            setupMsg.style.color = '#10b981';
                            setupMsg.textContent = '✅ Connected via page data!';
                            autoConnectBtn.textContent = '✅ Connected!';
                            setTimeout(loadInitialState, 800);
                        });
                        return;
                    }
                } catch (_) {}
                throw new Error('Not logged in. Open your Nexora Dashboard (while logged in) first.');
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

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            let url = normalizeDashboardUrl(dashInput.value.trim());
            const uid = userIdInput.value.trim();
            if (!url || !uid) {
                setupMsg.style.color = 'red';
                setupMsg.textContent = 'Fill both fields.';
                return;
            }
            setupMsg.textContent = '🧪 Verifying…';
            verifyDashboardConnection(url, uid).then(() => {
                chrome.storage.sync.set({ dashboardUrl: url, userId: uid }, loadInitialState);
            }).catch((err) => {
                setupMsg.style.color = '#ef4444';
                setupMsg.textContent = '❌ ' + err.message;
            });
            return;
        });
    }

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

    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'SCRAPER_COMPLETE') {
            uiLockedUntil = 0;
            setIdle();
            statusSub.textContent = `✅ Done! ${message.totalSaved || 0} posts collected.`;
        }
        if (message.action === 'STATUS_UPDATE' || message.action === 'EXTENSION_LIVE_STATUS') {
            const text = message.message || message.text || '';
            if (text) statusSub.textContent = text;
            if (/^Error:/i.test(text)) {
                uiLockedUntil = 0;
                setIdle();
                statusSub.textContent = '❌ ' + text.replace(/^Error:\s*/i, '');
            }
        }
        if (message.action === 'ENRICH_PROGRESS') {
            statusSub.textContent = `Enriching ${message.done || 0}/${message.total || 0}…`;
        }
    });
});
