const fs = require('fs');

try {
  const bgPath = 'extension/background.js';
  const ctPath = 'extension/content.js';
  
  let bg = fs.readFileSync(bgPath, 'utf8');
  let ct = fs.readFileSync(ctPath, 'utf8');

  // --- 1. Fix Network Interceptor ---
  bg = bg.replace(
    `if (method === 'Network.responseReceived' && params.response.url.includes('graphql')) {`,
    `if (method === 'Network.responseReceived' && (params.response.url.includes('graphql') || params.response.url.includes('voyager/api/search/'))) {`
  );

  // --- 2. Fix EVAL_SCRIPT Character Limit ---
  bg = bg.replace(
    `if (len > 400 & len < 15000) { best = container; break; }`,
    `if (len > 80 && len < 15000) { best = container; break; }`
  );

  // --- 3. Fix Infinite Loop ---
  // In handleStartFast, generate hash and check
  const hashLogic = `
  const currentHash = JSON.stringify(jobs.keywords || []) + (jobs.settings?.searchConfigJson || '');
  if (cdp.lastRunHash === currentHash) {
    console.log('[Worker] Skipping auto-start: cycle already completed for this configuration.');
    return { ok: true };
  }
  cdp.lastRunHash = currentHash;
`;

  bg = bg.replace(
    `  const jobs = msg.jobs || await (await fetch(cdp.dashboardUrl + '/api/extension/jobs', { headers: { 'x-extension-token': cdp.userId } })).json();
  if (!jobs.active) return { error: 'System inactive' };`,
    `  const jobs = msg.jobs || await (await fetch(cdp.dashboardUrl + '/api/extension/jobs', { headers: { 'x-extension-token': cdp.userId } })).json();
  if (!jobs.active) {
    cdp.lastRunHash = null; // Clear hash on stop
    return { error: 'System inactive' };
  }
  ${hashLogic}`
  );

  // also in the nexora_poll alarm
  bg = bg.replace(
    `const jobs = await resp.json();
  if (jobs.active & !cdp.running) {`,
    `const jobs = await resp.json();
  if (!jobs.active) cdp.lastRunHash = null;
  if (jobs.active && !cdp.running) {
    const currentHash = JSON.stringify(jobs.keywords || []) + (jobs.settings?.searchConfigJson || '');
    if (cdp.lastRunHash === currentHash) return; // Do not auto-restart completed jobs`
  );


  // --- 4. Fix content.js DOM Selector for Search Pages ---
  ct = ct.replace(
    `Array.from(document.querySelectorAll('.feed-shared-update-v2')).forEach(function(el) {`,
    `Array.from(document.querySelectorAll('.feed-shared-update-v2, .search-result__wrapper, .search-results-container .search-result__occluded-item')).forEach(function(el) {`
  );

  fs.writeFileSync(bgPath, bg, 'utf8');
  fs.writeFileSync(ctPath, ct, 'utf8');
  console.log('Successfully applied final fixes!');
} catch (e) {
  console.error('Error patching:', e);
}
