console.log("[POPUP] Script loaded!");

document.addEventListener('DOMContentLoaded', () => {
    const dashInput = document.getElementById('dashboardUrl');
    const userIdInput = document.getElementById('userId');
    const saveBtn = document.getElementById('saveBtn');
    const syncBtn = document.getElementById('syncBtn');
    const statusDiv = document.getElementById('status');
    const openTabBtn = document.getElementById('openTabBtn');
    const autoConnectBtn = document.getElementById('autoConnectBtn');
    const autoConnectStatus = document.getElementById('autoConnectStatus');

    // Diagnostic Check
    if (!saveBtn) console.error("[POPUP] ERROR: saveBtn not found in HTML!");
    if (!syncBtn) console.error("[POPUP] ERROR: syncBtn not found in HTML!");
    if (!dashInput) console.error("[POPUP] ERROR: dashboardUrl input not found!");
    
    // Setup Open in Full Tab
    if (openTabBtn) {
        if (window.innerWidth > 400) {
            openTabBtn.style.display = 'none';
        } else {
            openTabBtn.addEventListener('click', () => {
                chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
            });
        }
    }

    // Load existing settings
    chrome.storage.sync.get(['dashboardUrl', 'userId', 'visibilityMode'], (data) => {
      if (data.dashboardUrl && dashInput) dashInput.value = data.dashboardUrl;
      if (data.userId && userIdInput) userIdInput.value = data.userId;
      if (data.visibilityMode) {
          const radio = document.querySelector(`input[name="visibilityMode"][value="${data.visibilityMode}"]`);
          if (radio) radio.checked = true;
      }
      console.log("[POPUP] Settings loaded from storage.");

      // Show connected status if already configured
      if (data.dashboardUrl && data.userId && autoConnectStatus) {
        autoConnectStatus.style.color = '#10b981';
        autoConnectStatus.textContent = '✅ Already connected to ' + data.dashboardUrl;
      }
    });
  
    // Save Visibility Mode on Change
    document.querySelectorAll('input[name="visibilityMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            chrome.storage.sync.set({ visibilityMode: e.target.value });
        });
    });

    // ═══════════════════════════════════════
    // AUTO-CONNECT: Read from active tab's DOM
    // ═══════════════════════════════════════
    if (autoConnectBtn) {
      autoConnectBtn.addEventListener('click', async () => {
        autoConnectBtn.disabled = true;
        autoConnectBtn.textContent = '🔄 Connecting...';
        autoConnectStatus.textContent = '';
        autoConnectStatus.style.color = '#6b7280';

        try {
          // Get the current active tab
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab || !tab.id || !tab.url) {
            throw new Error('No active tab found');
          }

          const tabUrl = new URL(tab.url);
          const dashboardOrigin = tabUrl.origin;

          // Try to read the hidden DOM element from the page
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const el = document.getElementById('nexora-connect-data');
              if (el) {
                return {
                  userId: el.getAttribute('data-user-id'),
                  dashboardUrl: el.getAttribute('data-dashboard-url')
                };
              }
              return null;
            }
          });

          const pageData = results?.[0]?.result;

          if (pageData && pageData.userId && pageData.dashboardUrl) {
            // Success! Auto-fill from DOM element
            const url = pageData.dashboardUrl.replace(/\/$/, '');
            dashInput.value = url;
            userIdInput.value = pageData.userId;

            chrome.storage.sync.set({ dashboardUrl: url, userId: pageData.userId }, () => {
              chrome.runtime.sendMessage({ action: 'START_POLLING' });
              console.log("[POPUP] Auto-Connected via DOM element!");
            });

            autoConnectStatus.style.color = '#10b981';
            autoConnectStatus.textContent = '✅ Connected Successfully!';
            autoConnectBtn.textContent = '✅ Connected!';
            return;
          }

          // Fallback: Try fetching /api/connect from the tab's origin
          autoConnectStatus.textContent = '🔍 Trying API fallback...';
          const response = await fetch(`${dashboardOrigin}/api/connect`, {
            credentials: 'include'
          });

          if (response.ok) {
            const data = await response.json();
            if (data.userId && data.platformUrl) {
              const url = data.platformUrl.replace(/\/$/, '');
              dashInput.value = url;
              userIdInput.value = data.userId;

              chrome.storage.sync.set({ dashboardUrl: url, userId: data.userId }, () => {
                chrome.runtime.sendMessage({ action: 'START_POLLING' });
                console.log("[POPUP] Auto-Connected via API!");
              });

              autoConnectStatus.style.color = '#10b981';
              autoConnectStatus.textContent = '✅ Connected Successfully!';
              autoConnectBtn.textContent = '✅ Connected!';
              return;
            }
          }

          throw new Error('Could not detect Nexora dashboard on this page. Please navigate to your Dashboard first.');

        } catch (err) {
          console.error("[POPUP] Auto-connect failed:", err);
          autoConnectStatus.style.color = '#ef4444';
          autoConnectStatus.textContent = '❌ ' + (err.message || 'Connection failed. Use manual fields below.');
        } finally {
          setTimeout(() => {
            autoConnectBtn.disabled = false;
            if (!autoConnectBtn.textContent.includes('✅')) {
              autoConnectBtn.textContent = '🔗 Auto-Connect to Dashboard';
            }
          }, 3000);
        }
      });
    }

    // ═══════════════════════════════════════
    // MANUAL SAVE (existing — unchanged)
    // ═══════════════════════════════════════
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        let url = dashInput.value.trim();
        const uid = userIdInput.value.trim();
        
        if (!url || !uid) {
          statusDiv.style.color = 'red';
          statusDiv.textContent = 'Please fill both fields.';
          return;
        }

        if (url.endsWith('/')) url = url.slice(0, -1);
        
        chrome.storage.sync.set({ dashboardUrl: url, userId: uid }, () => {
          statusDiv.textContent = '✅ Settings Saved!';
          statusDiv.style.color = '#10b981';
          
          chrome.runtime.sendMessage({ action: 'START_POLLING' });
          console.log("[POPUP] Settings saved, signaling background.");
          setTimeout(() => { if(statusDiv) statusDiv.textContent = ''; }, 3000);
        });
      });
    }

    // Manual Sync Button (existing — unchanged)
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        console.log("[POPUP] Sync button clicked.");
        syncBtn.textContent = '🔄 Syncing...';
        syncBtn.disabled = true;
        
        chrome.runtime.sendMessage({ action: 'START_POLLING' });
        
        setTimeout(() => {
            if (syncBtn) {
              syncBtn.textContent = '🔄 Sync & Run Now';
              syncBtn.disabled = false;
            }
            window.close(); 
        }, 1500);
      });
    }
});
