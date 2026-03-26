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
    try {
      if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'START_POLLING' }, (response) => {
          console.log("[Nexora Bridge] Background worker acknowledged start command.", response);
          window.postMessage({ source: 'NEXORA_EXTENSION', action: 'ENGINE_STARTED_ACK' }, '*');
        });
      }
    } catch (e) {
      console.error("[Nexora Bridge] Failed to relay command to extension:", e);
    }
  }
});
