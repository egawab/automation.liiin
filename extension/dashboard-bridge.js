// dashboard-bridge.js v6.4 — auto-retry + SW wake-up
(function () {
  if (window.__NexoraBridgeV6) return;
  window.__NexoraBridgeV6 = true;

  function canSend() {
    try {
      return typeof chrome !== 'undefined'
        && typeof chrome.runtime !== 'undefined'
        && typeof chrome.runtime.sendMessage === 'function'
        && !!chrome.runtime.id; // undefined = extension context invalidated
    } catch (_) { return false; }
  }

  function notifyDashboard(action, data) {
    window.postMessage(Object.assign({ source: 'NEXORA_EXTENSION', action }, data || {}), '*');
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
          const p = JSON.parse(atob(m[1].split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
          userId = p.userId || null;
        }
      } catch (_) {}
    }
    return { dashboardUrl, userId };
  }

  // Wake up the service worker by sending a KEEP_ALIVE ping
  function wakeUpSW(callback, retries) {
    retries = retries || 0;
    if (!canSend()) {
      if (retries >= 10) {
        const msg = 'Extension disconnected. Please refresh this page (F5) and try again.';
        console.error('[NexoraBridge] ' + msg);
        notifyDashboard('ENGINE_ERROR', { error: msg });
        return;
      }
      console.warn('[NexoraBridge] chrome.runtime not ready — retrying in 800ms... (' + retries + '/10)');
      setTimeout(() => wakeUpSW(callback, retries + 1), 800);
      return;
    }
    chrome.runtime.sendMessage({ action: 'KEEP_ALIVE' }, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn('[NexoraBridge] SW waking up, retry in 1s...', chrome.runtime.lastError.message);
        setTimeout(() => {
          if (canSend()) callback();
          else console.error('[NexoraBridge] SW failed to wake up.');
        }, 1000);
        return;
      }
      callback();
    });
  }

  function sendToBackground(msg, onReply) {
    if (!canSend()) {
      console.error('[NexoraBridge] chrome runtime unavailable. Reload the dashboard page.');
      notifyDashboard('ENGINE_ERROR', { error: 'Extension disconnected — please refresh the page and retry.' });
      return;
    }
    chrome.runtime.sendMessage(msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.error('[NexoraBridge] sendMessage error:', err.message);
        notifyDashboard('ENGINE_ERROR', { error: err.message });
        return;
      }
      if (onReply) onReply(resp);
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data || event.data.source !== 'NEXORA_DASHBOARD') return;
    const action = event.data.action;

    if (action === 'START_ENGINE') {
      const auth = extractAuth();
      console.log('[NexoraBridge] START_ENGINE — waking SW. Auth:', auth);
      wakeUpSW(() => {
        sendToBackground(
          { action: 'START_ENGINE', dashboardUrl: auth.dashboardUrl, userId: auth.userId },
          (resp) => {
            console.log('[NexoraBridge] START_ENGINE reply:', resp);
            notifyDashboard('ENGINE_STARTED_ACK', { keyword: 'starting' });
          }
        );
      });
    }

    if (action === 'STOP_ENGINE') {
      wakeUpSW(() => {
        sendToBackground({ action: 'STOP_ENGINE' }, () => {
          notifyDashboard('ENGINE_STOPPED_ACK');
        });
      });
    }

    if (action === 'RE_ENRICH') {
      const auth = extractAuth();
      const posts = event.data.posts || [];
      console.log('[NexoraBridge] RE_ENRICH — queuing ' + posts.length + ' posts.');
      wakeUpSW(() => {
        sendToBackground({
          action: 'RE_ENRICH',
          posts,
          dashboardUrl: auth.dashboardUrl,
          userId:       auth.userId,
          autoDelete:   event.data.autoDelete,
          deleteThreshold: event.data.deleteThreshold,
          currentKeyword: event.data.currentKeyword
        }, (resp) => {
          console.log('[NexoraBridge] RE_ENRICH queued:', resp);
        });
      });
    }

    if (action === 'SAVE_AUTO_ENRICH') {
      if (canSend() && chrome.storage && chrome.storage.sync) {
         chrome.storage.sync.set({
           autoEnrich: event.data.autoEnrich,
           autoDelete: event.data.autoDelete,
           deleteThreshold: event.data.deleteThreshold
         });
      }
    }

    if (action === 'GET_AUTO_ENRICH') {
      if (canSend() && chrome.storage && chrome.storage.sync) {
         chrome.storage.sync.get(['autoEnrich', 'autoDelete', 'deleteThreshold'], (cfg) => {
           notifyDashboard('AUTO_ENRICH_CFG', cfg);
         });
      }
    }
  });

  // Relay background → dashboard for enrich progress events
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'ENRICH_PROGRESS' || msg.action === 'ENRICH_DONE' || msg.action === 'ENRICH_KEYWORD_START') {
        notifyDashboard(msg.action, msg);
      }
    });
  }

  // Initial ping to confirm bridge + SW are alive
  setTimeout(() => {
    if (canSend()) {
      chrome.runtime.sendMessage({ action: 'KEEP_ALIVE' }, (r) => {
        if (chrome.runtime.lastError) {
          console.warn('[NexoraBridge] Initial ping failed (SW starting up):', chrome.runtime.lastError.message);
        } else {
          console.log('[NexoraBridge] v6.4 ready — SW alive.');
          notifyDashboard('EXTENSION_READY');
        }
      });
    } else {
      console.warn('[NexoraBridge] v6.4 loaded but chrome.runtime not yet available.');
    }
  }, 500);
})();
