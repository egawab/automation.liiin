const fs = require('fs');

try {
  // Fix popup.js
  const popupPath = 'extension/popup.js';
  let popup = fs.readFileSync(popupPath, 'utf8');
  popup = popup.replace(
    `setMsg(\`⚙️ Running: "\${resp.keyword}" | Saved: \${resp.totalSaved}\`, '#10b981');`,
    `statusSub.textContent = \`⚙️ Running: "\${resp.keyword}" | Saved: \${resp.totalSaved}\`;`
  );
  fs.writeFileSync(popupPath, popup, 'utf8');

  // Fix background.js unhandled promises in broadcast
  const bgPath = 'extension/background.js';
  let bg = fs.readFileSync(bgPath, 'utf8');
  bg = bg.replace(
    `try { chrome.runtime.sendMessage({ action, ...data }); } catch (_) {}`,
    `chrome.runtime.sendMessage({ action, ...data }).catch(() => {});`
  );
  
  // Fix content.js unhandled promises
  const ctPath = 'extension/content.js';
  let ct = fs.readFileSync(ctPath, 'utf8');
  ct = ct.replace(
    `function status(t) { try { chrome.runtime.sendMessage({ action: 'EXTENSION_LIVE_STATUS', text: t }); } catch (_) {} }`,
    `function status(t) { chrome.runtime.sendMessage({ action: 'EXTENSION_LIVE_STATUS', text: t }).catch(() => {}); }`
  );
  
  fs.writeFileSync(bgPath, bg, 'utf8');
  fs.writeFileSync(ctPath, ct, 'utf8');
  
  console.log('Patched promise rejections and setMsg!');
} catch (e) {
  console.error('Error patching:', e);
}
