const fs = require('fs');

try {
  const ctPath = 'extension/content.js';
  let ct = fs.readFileSync(ctPath, 'utf8');

  ct = ct.replace(
    `if (window.__NexoraScrollerActive) return;
  window.__NexoraScrollerActive = true;`,
    `if (window.__NexoraScrollerActive) {
    if (window.__NexoraScrollerUrl === location.href) return;
    // URL changed, allow restart!
    console.log('[SCROLL] Restarting for new URL');
    if (window.__NexoraExtractInterval) clearInterval(window.__NexoraExtractInterval);
  }
  window.__NexoraScrollerActive = true;
  window.__NexoraScrollerUrl = location.href;`
  );

  ct = ct.replace(
    `var extractInterval = setInterval(function(){`,
    `window.__NexoraExtractInterval = setInterval(function(){`
  );

  fs.writeFileSync(ctPath, ct, 'utf8');
  console.log('Successfully patched content.js SPA issue!');
} catch (e) {
  console.error('Error patching:', e);
}
