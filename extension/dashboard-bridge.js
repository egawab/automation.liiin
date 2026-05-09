// dashboard-bridge.js v6.2
// Uses chrome.runtime.sendMessage (most reliable in MV3 content scripts).
// connect() was dropped — it silently fails when SW is in certain states.
(function () {
  if (window.__NexoraBridgeV6) return;
  window.__NexoraBridgeV6 = true;

  function notifyDashboard(action, data) {
    window.postMessage(Object.assign({ source: 'NEXORA_EXTENSION', action: action }, data || {}), '*');
  }

  function extractAuth() {
    const dashboardUrl = window.location.origin;
    let userId = null;
    try {
      const el = document.getElementById('nexora-connect-data');
      if (el && el.dataset.userId) userId = el.dataset.userId;
    } catch (_) {}
    if (!userId) {
      try {
        const m = document.cookie.match(/auth_token=([^;]+)/);
        if (m) {
          const p = JSON.parse(atob(m[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          userId = p.userId || null;
        }
      } catch (_) {}
    }
    return { dashboardUrl: dashboardUrl, userId: userId };
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data || event.data.source !== 'NEXORA_DASHBOARD') return;
    var action = event.data.action;

    if (action === 'START_ENGINE') {
      var auth = extractAuth();
      console.log('[NexoraBridge] START_ENGINE received. Auth:', auth);
      chrome.runtime.sendMessage(
        { action: 'START_ENGINE', dashboardUrl: auth.dashboardUrl, userId: auth.userId },
        function (resp) {
          var err = chrome.runtime.lastError;
          if (err) {
            console.error('[NexoraBridge] sendMessage failed:', err.message);
            notifyDashboard('ENGINE_ERROR', { error: err.message });
            return;
          }
          console.log('[NexoraBridge] Background replied:', resp);
          notifyDashboard('ENGINE_STARTED_ACK', { keyword: 'starting' });
        }
      );
    }

    if (action === 'STOP_ENGINE') {
      chrome.runtime.sendMessage({ action: 'STOP_ENGINE' }, function () {
        notifyDashboard('ENGINE_STOPPED_ACK');
      });
    }
  });

  notifyDashboard('EXTENSION_READY');
  console.log('[NexoraBridge] v6.2 ready (sendMessage mode).');
})();
