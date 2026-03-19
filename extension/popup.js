console.log("[POPUP] Script loaded!");

document.addEventListener('DOMContentLoaded', () => {
    const dashInput = document.getElementById('dashboardUrl');
    const userIdInput = document.getElementById('userId');
    const saveBtn = document.getElementById('saveBtn');
    const syncBtn = document.getElementById('syncBtn'); // Manual ID check
    const statusDiv = document.getElementById('status');

    // Diagnostic Check
    if (!saveBtn) console.error("[POPUP] ERROR: saveBtn not found in HTML!");
    if (!syncBtn) console.error("[POPUP] ERROR: syncBtn not found in HTML!");
    if (!dashInput) console.error("[POPUP] ERROR: dashboardUrl input not found!");

    // Load existing settings
    chrome.storage.sync.get(['dashboardUrl', 'userId'], (result) => {
      if (result.dashboardUrl && dashInput) dashInput.value = result.dashboardUrl;
      if (result.userId && userIdInput) userIdInput.value = result.userId;
      console.log("[POPUP] Settings loaded from storage.");
    });
  
    // Save settings
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

    // Manual Sync Button
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
