// dashboard-bridge.js
// Injected into localhost:3000 and *.vercel.app to allow the Nexora Dashboard to communicate with the Chrome Extension.

console.log("[Nexora Bridge] Initialized. Listening for dashboard commands.");

// 1. Tell the dashboard we are installed (so it knows the extension is active)
window.postMessage({ source: 'NEXORA_EXTENSION', action: 'EXTENSION_READY' }, '*');

// 2. Listen for messages from the Dashboard page
window.addEventListener('message', (event) => {
  // We only accept messages from ourselves (the same page)
  if (event.source !== window || !event.data || event.data.source !== 'NEXORA_DASHBOARD') {
    return;
  }

  // Dashboard clicked 'START' or 'SYNC'
  if (event.data.action === 'START_ENGINE') {
    console.log("[Nexora Bridge] Received START_ENGINE from Dashboard! Relaying to background worker...");
    
    // Auto-heal payload
    const dashboardUrl = window.location.origin;
    let userId = null;
    const match = document.cookie.match(/(?:(?:^|.*;\s*)auth_token\s*\=\s*([^;]*).*$)|^.*$/);
    if (match && match[1]) {
      try {
        const decoded = JSON.parse(atob(match[1].split('.')[1]));
        userId = decoded.userId;
      } catch(e) { userId = match[1]; }
    }

    try {
      if (chrome && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'START_POLLING', dashboardUrl, userId }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn("[Nexora Bridge] Extension context error (safe to ignore):", chrome.runtime.lastError.message);
            return;
          }
          console.log("[Nexora Bridge] Background worker acknowledged start command.", response);
          window.postMessage({ source: 'NEXORA_EXTENSION', action: 'ENGINE_STARTED_ACK' }, '*');
        });
      }
    } catch (e) {
      console.warn("[Nexora Bridge] Extension not available:", e.message);
    }
  }
});
