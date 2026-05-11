const fs = require('fs');

try {
  const bgPath = 'extension/background.js';
  let bg = fs.readFileSync(bgPath, 'utf8');

  // Replace tab creation logic in handleStartFast
  bg = bg.replace(
    `const liTabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  const tab = liTabs[0] || await chrome.tabs.create({ url: 'about:blank', active: true });
  cdp.tabId = tab.id;`,
    `const liTabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  let tab = liTabs[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: true });
    // Wait for the LinkedIn process to initialize before CDP attach to prevent cross-origin detach
    await waitForTabLoad(tab.id, 15000); 
  }
  cdp.tabId = tab.id;`
  );

  // In launchEngine, if chrome.tabs.update detaches the debugger due to process swap, 
  // we could also catch it by attaching AFTER the update, but we need Network events.
  // The above fix should prevent process swap.

  fs.writeFileSync(bgPath, bg, 'utf8');
  console.log('Successfully patched tab issue!');
} catch (e) {
  console.error('Error patching:', e);
}
