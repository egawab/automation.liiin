// dashboard-bridge.js v6.1 — Reconnect-safe port, supports START + STOP.
// Auth is resolved by background.js from chrome.storage.sync (set via popup auto-connect).
// Bridge's only job: relay commands from dashboard page → background port.
(function () {
  if (window.__NexoraBridgeV6) return;
  window.__NexoraBridgeV6 = true;

  let _port = null;

  // Best-effort auth extraction — background falls back to chrome.storage.sync if null
  function extractAuth() {
    const dashboardUrl = window.location.origin;
    let userId = null;

    // Try 1: Read from DOM element injected by the dashboard React app
    try {
      const el = document.getElementById('nexora-connect-data');
      if (el && el.dataset.userId) userId = el.dataset.userId;
    } catch (_) {}

    // Try 2: Read from document.cookie (only works if cookie is NOT HttpOnly)
    if (!userId) {
      try {
        const match = document.cookie.match(/auth_token=([^;]+)/);
        if (match) {
          const payload = JSON.parse(atob(match[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          userId = payload.userId || null;
        }
      } catch (_) {}
    }

    return { dashboardUrl, userId };
  }

  function notifyDashboard(action, data = {}) {
    window.postMessage({ source: 'NEXORA_EXTENSION', action, ...data }, '*');
  }

  function disconnect() {
    if (_port) { try { _port.disconnect(); } catch (_) {} _port = null; }
  }

  function connect(onConnected) {
    disconnect();
    try {
      _port = chrome.runtime.connect({ name: 'nexora_cmd' });

      _port.onMessage.addListener((msg) => {
        if (msg.type === 'ACK_START') {
          notifyDashboard('ENGINE_STARTED_ACK', { keyword: msg.keyword });
        } else if (msg.type === 'ACK_STOP') {
          notifyDashboard('ENGINE_STOPPED_ACK');
        } else if (msg.type === 'STATUS') {
          notifyDashboard('ENGINE_STATUS', msg);
        } else if (msg.type === 'ERROR') {
          notifyDashboard('ENGINE_ERROR', { error: msg.error });
          console.warn('[NexoraBridge] Engine error:', msg.error);
        }
      });

      _port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        _port = null;
        if (err) {
          console.warn('[NexoraBridge] Port disconnected:', err.message);
          if (err.message && err.message.includes('context invalidated')) {
            notifyDashboard('ENGINE_ERROR', { error: 'Extension reloaded — please refresh this page.' });
          } else {
            notifyDashboard('ENGINE_DISCONNECTED');
          }
        }
      });

      if (onConnected) onConnected(_port);
    } catch (e) {
      console.error('[NexoraBridge] connect() failed:', e.message);
      notifyDashboard('ENGINE_ERROR', { error: e.message });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'NEXORA_DASHBOARD') return;
    const { action } = event.data;

    if (action === 'START_ENGINE') {
      const auth = extractAuth();
      // NOTE: Do NOT guard on auth.userId here.
      // background.js will resolve userId from chrome.storage.sync (set by popup auto-connect).
      // Passing null is safe — background handles the fallback.
      connect(port => {
        port.postMessage({
          action: 'START',
          dashboardUrl: auth.dashboardUrl,
          userId: auth.userId  // may be null; background falls back to storage
        });
      });
    }

    if (action === 'STOP_ENGINE') {
      if (_port) {
        _port.postMessage({ action: 'STOP' });
      } else {
        notifyDashboard('ENGINE_STOPPED_ACK');
      }
    }

    if (action === 'GET_STATUS') {
      if (_port) {
        _port.postMessage({ action: 'GET_STATUS' });
      }
    }
  });

  // Signal readiness to the dashboard
  notifyDashboard('EXTENSION_READY');
  console.log('[NexoraBridge] v6.1 ready — auth resolved by background from storage.');
})();
