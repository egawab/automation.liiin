// dashboard-bridge.js – Nexora v17
// يستخدم connect() بدلاً من sendMessage لضمان تصحية عامل الخدمة دائماً

console.warn("[Nexora Bridge] Initialized.");

window.postMessage({ source: 'NEXORA_EXTENSION', action: 'EXTENSION_READY' }, '*');

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.source !== 'NEXORA_DASHBOARD') return;

  if (event.data.action === 'START_ENGINE') {
    console.warn("[Nexora Bridge] START_ENGINE received. Connecting to worker...");

    const dashboardUrl = window.location.origin;
    let userId = null;
    try {
      const match = document.cookie.match(/auth_token=([^;]+)/);
      if (match) {
        const decoded = JSON.parse(atob(match[1].split('.')[1]));
        userId = decoded.userId || null;
      }
    } catch(e) {}

    try {
      // connect() يضمن تصحية عامل الخدمة — أكثر موثوقية من sendMessage
      const port = chrome.runtime.connect({ name: 'nexora_cmd' });

      port.onMessage.addListener((msg) => {
        console.warn("[Nexora Bridge] Worker replied:", msg);
        window.postMessage({
          source: 'NEXORA_EXTENSION',
          action: msg.ok ? 'ENGINE_STARTED_ACK' : 'ENGINE_ERROR',
          keyword: msg.keyword,
          error: msg.error
        }, '*');
        port.disconnect();
      });

      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          console.error("[Nexora Bridge] Port error:", chrome.runtime.lastError.message);
          window.postMessage({ source: 'NEXORA_EXTENSION', action: 'ENGINE_ERROR',
            error: 'Extension disconnected' }, '*');
        }
      });

      port.postMessage({ action: 'START', dashboardUrl, userId });
      console.warn("[Nexora Bridge] Command sent via port.");

    } catch(e) {
      console.error("[Nexora Bridge] connect() failed:", e.message);
      if (e.message.includes('Extension context invalidated')) {
        console.warn("[Nexora Bridge] Extension was updated. Reloading page to inject new script...");
        window.location.reload();
      } else {
        window.postMessage({ source: 'NEXORA_EXTENSION', action: 'ENGINE_ERROR', error: e.message }, '*');
      }
    }
  }
});
