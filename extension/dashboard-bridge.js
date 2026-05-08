// dashboard-bridge.js v6 — Reconnect-safe port, supports START + STOP.
// Injected as content_script on dashboard pages.
(function () {
  if (window.__NexoraBridgeV6) return;
  window.__NexoraBridgeV6 = true;

  let _port = null;

  function extractAuth() {
    const dashboardUrl = window.location.origin;
    let userId = null;
    try {
      const match = document.cookie.match(/auth_token=([^;]+)/);
      if (match) {
        const payload = JSON.parse(atob(match[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        userId = payload.userId || null;
      }
    } catch (_) {}
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
      if (!auth.userId) {
        notifyDashboard('ENGINE_ERROR', { error: 'Not authenticated — open Dashboard and log in first.' });
        return;
      }
      connect(port => {
        port.postMessage({ action: 'START', dashboardUrl: auth.dashboardUrl, userId: auth.userId });
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
  console.log('[NexoraBridge] v6 ready.');
})();
