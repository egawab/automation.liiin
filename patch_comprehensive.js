const fs = require('fs');

try {
  const bgPath = 'extension/background.js';
  const ctPath = 'extension/content.js';
  
  let bg = fs.readFileSync(bgPath, 'utf8');
  let ct = fs.readFileSync(ctPath, 'utf8');

  // --- 1. Fix fetchKeywordsArray to NOT use campaigns if searchOnly is true ---
  bg = bg.replace(
    `  if (Array.isArray(jobs.keywords)) {
    const campKw = jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean);
    allKw.push(...campKw);
  }`,
    `  const searchOnly = jobs.settings?.searchOnlyMode !== false;
  if (!searchOnly || allKw.length === 0) {
    if (Array.isArray(jobs.keywords)) {
      const campKw = jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean);
      allKw.push(...campKw);
    }
  }`
  );

  // --- 2. Fix launchEngine to attach AFTER navigation ---
  bg = bg.replace(
    `    try {
      await chrome.debugger.attach({ tabId: cdp.tabId }, '1.3');
      cdp.attached = true;
    } catch (e) {
      if (e.message?.toLowerCase().includes('already')) { cdp.attached = true; }
      else throw new Error('CDP attach failed: ' + e.message);
    }
    await chrome.debugger.sendCommand({ tabId: cdp.tabId }, 'Network.enable');
    const searchUrl = \`https://www.linkedin.com/search/results/content/?keywords=\${encodeURIComponent(cdp.keyword)}&origin=GLOBAL_SEARCH_HEADER\`;
    await chrome.tabs.update(cdp.tabId, { url: searchUrl, active: true });
    cdp.running = true;
    broadcast('EXTENSION_LIVE_STATUS', { text: \`Navigating...\` });

    await waitForTabLoad(cdp.tabId);`,
    `    const searchUrl = \`https://www.linkedin.com/search/results/content/?keywords=\${encodeURIComponent(cdp.keyword)}&origin=GLOBAL_SEARCH_HEADER\`;
    await chrome.tabs.update(cdp.tabId, { url: searchUrl, active: true });
    cdp.running = true;
    broadcast('EXTENSION_LIVE_STATUS', { text: \`Navigating...\` });

    await waitForTabLoad(cdp.tabId);

    try {
      await chrome.debugger.attach({ tabId: cdp.tabId }, '1.3');
      cdp.attached = true;
    } catch (e) {
      if (e.message?.toLowerCase().includes('already')) { cdp.attached = true; }
      else { console.warn('CDP attach failed:', e.message); cdp.attached = false; }
    }
    if (cdp.attached) {
      try { await chrome.debugger.sendCommand({ tabId: cdp.tabId }, 'Network.enable'); } catch (_) {}
    }`
  );

  // --- 3. Fix 1K / 1M parsing in EVAL_SCRIPT ---
  const evalParseFn = `
    function parseEng(str) {
      if (!str) return null;
      var s = str.toUpperCase().replace(/,/g, '');
      var m = s.match(/[\\d.]+/);
      if (!m) return null;
      var n = parseFloat(m[0]);
      if (s.indexOf('K') > -1) n *= 1000;
      if (s.indexOf('M') > -1) n *= 1000000;
      return Math.floor(n);
    }
  `;
  
  bg = bg.replace(
    `var likes = null;`,
    evalParseFn + `    var likes = null;`
  );
  
  bg = bg.replace(
    `        var nm = l.match(/([\\d,]+)/);
        if (nm) comments = parseInt(nm[1].replace(/,/g,''), 10);`,
    `        comments = parseEng(l);`
  );

  bg = bg.replace(
    `        var n = l.match(/([\\d,]+)/);
        if (n) likes = parseInt(n[1].replace(/,/g,''), 10);`,
    `        likes = parseEng(l);`
  );

  // Fix DOM fallback parsing in EVAL_SCRIPT
  bg = bg.replace(
    `        var bm = (best.innerText||'').match(/([\\d,]+)\\s*(reaction|like)/i);
        if (bm) likes = parseInt(bm[1].replace(/,/g,''), 10);`,
    `        var bm = (best.innerText||'').match(/([\\d.,]+[KkMm]?)\\s*(reaction|like)/i);
        if (bm) likes = parseEng(bm[1]);`
  );

  // --- 4. Fix 1K / 1M parsing in content.js ---
  const ctParseFn = `
  function parseEng(str) {
    if (!str) return null;
    var s = str.toUpperCase().replace(/,/g, '');
    var m = s.match(/[\\d.]+/);
    if (!m) return null;
    var n = parseFloat(m[0]);
    if (s.indexOf('K') > -1) n *= 1000;
    if (s.indexOf('M') > -1) n *= 1000000;
    return Math.floor(n);
  }
`;
  
  ct = ct.replace(
    `function extractPostsFromDOM() {`,
    ctParseFn + `\n  function extractPostsFromDOM() {`
  );

  ct = ct.replace(
    `          var n = l.match(/(\\d[\\d,]*)/);
          if (n) likes = parseInt(n[1].replace(/,/g,''), 10);`,
    `          likes = parseEng(l);`
  );

  ct = ct.replace(
    `        var bm = (best.innerText||'').match(/(\\d[\\d,]*)\\s*(reaction|like)/i);
        if (bm) likes = parseInt(bm[1].replace(/,/g,''), 10);`,
    `        var bm = (best.innerText||'').match(/([\\d.,]+[KkMm]?)\\s*(reaction|like)/i);
        if (bm) likes = parseEng(bm[1]);`
  );

  ct = ct.replace(
    `          var n = l.match(/(\\d[\\d,]*)/);
          if (n) comments = parseInt(n[1].replace(/,/g,''), 10);`,
    `          comments = parseEng(l);`
  );

  ct = ct.replace(
    `        var cm = (best.innerText||'').match(/(\\d[\\d,]*)\\s*comment/i);
        if (cm) comments = parseInt(cm[1].replace(/,/g,''), 10);`,
    `        var cm = (best.innerText||'').match(/([\\d.,]+[KkMm]?)\\s*comment/i);
        if (cm) comments = parseEng(cm[1]);`
  );

  fs.writeFileSync(bgPath, bg, 'utf8');
  fs.writeFileSync(ctPath, ct, 'utf8');

  console.log('Successfully applied comprehensive fixes!');
} catch (e) {
  console.error('Error patching:', e);
}
