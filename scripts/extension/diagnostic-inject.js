// diagnostic-inject.js — run via chrome.scripting.executeScript
// Returns a full dump of what LinkedIn Account B actually contains
(function() {
  const report = { timestamp: Date.now(), sections: {} };

  // 1. All window keys that contain URN-like data
  const urnKeys = [];
  const urnAnyRe = /urn:li:[a-zA-Z_]+[:(]/;
  for (const k of Object.keys(window)) {
    try {
      const v = window[k];
      if (!v || typeof v === 'function') continue;
      const s = typeof v === 'string' ? v : JSON.stringify(v).substring(0, 5000);
      if (urnAnyRe.test(s)) urnKeys.push({ key: k, type: typeof v, snippet: s.substring(0, 300) });
    } catch (_) {}
  }
  report.sections.windowKeysWithUrns = urnKeys;

  // 2. Top-level window keys (non-function, non-primitive) — shows what globals exist
  const globalObjs = [];
  for (const k of Object.keys(window)) {
    try {
      const v = window[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const keys = Object.keys(v).slice(0, 20);
        globalObjs.push({ key: k, childKeys: keys });
      }
    } catch (_) {}
  }
  report.sections.globalObjects = globalObjs.slice(0, 50);

  // 3. DOM summary — what selectors exist on this page
  const domCheck = {
    dataUrn: document.querySelectorAll('[data-urn]').length,
    dataEntityUrn: document.querySelectorAll('[data-entity-urn]').length,
    dataId: document.querySelectorAll('[data-id]').length,
    articleCount: document.querySelectorAll('article').length,
    searchResult: document.querySelectorAll('[class*="search-result"]').length,
    entityResult: document.querySelectorAll('[class*="entity-result"]').length,
    feedUpdate: document.querySelectorAll('[class*="feed-update"],[class*="feed-shared"]').length,
    reusableSearch: document.querySelectorAll('.reusable-search__result-container').length,
    listItems: document.querySelectorAll('li[class*="result"]').length,
    mainContent: (document.querySelector('#main') || document.querySelector('main'))?.innerHTML.length || 0,
    pageTitle: document.title,
    url: location.href,
    bodyTextSample: document.body.innerText.substring(0, 500),
  };
  report.sections.dom = domCheck;

  // 4. React detection
  const reactInfo = { found: false, version: null, rootKeys: [] };
  try {
    // React 16-18: look for __reactFiber or __reactInternalInstance
    const anyEl = document.querySelector('div,main,section');
    if (anyEl) {
      const fk = Object.keys(anyEl).find(k => k.startsWith('__react'));
      if (fk) {
        reactInfo.found = true;
        reactInfo.fiberKey = fk;
        const fiber = anyEl[fk];
        if (fiber) {
          reactInfo.fiberType = fiber.type?.name || fiber.type || 'unknown';
          // Walk up to find root context
          let f = fiber;
          for (let i = 0; i < 20 && f; i++, f = f.return) {
            if (f.memoizedProps) {
              const pk = Object.keys(f.memoizedProps).slice(0, 10);
              reactInfo.rootKeys.push({ depth: i, props: pk });
            }
          }
        }
      }
    }
    // Check for React in window
    if (window.React) { reactInfo.found = true; reactInfo.version = window.React.version; }
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) { reactInfo.found = true; reactInfo.devtools = true; }
  } catch(e) { reactInfo.error = e.message; }
  report.sections.react = reactInfo;

  // 5. Scan ALL window strings for any LinkedIn URN format (not just activity)
  const allUrnPatterns = new Set();
  const anyUrnRe = /urn:li:([a-zA-Z_]+)[:(]([^"',\s\\]{5,50})/g;
  try {
    // Sample body text
    const bodyText = document.body.innerHTML.substring(0, 100000);
    let m;
    while ((m = anyUrnRe.exec(bodyText)) !== null) {
      allUrnPatterns.add(`urn:li:${m[1]}:${m[2].substring(0, 40)}`);
      if (allUrnPatterns.size > 100) break;
    }
  } catch (_) {}
  report.sections.urnPatternsInDom = [...allUrnPatterns];

  // 6. Check script tags for embedded data
  const scriptData = [];
  for (const s of document.querySelectorAll('script')) {
    const t = (s.textContent || '').trim();
    if (t.length > 200 && (t.includes('urn:li:') || t.includes('"activity"') || t.includes('"commentary"'))) {
      scriptData.push({ id: s.id, type: s.type, dataSnippet: t.substring(0, 500) });
    }
  }
  report.sections.scriptTagsWithData = scriptData.slice(0, 10);

  // 7. localStorage / sessionStorage keys
  try {
    report.sections.localStorageKeys = Object.keys(localStorage).slice(0, 30);
    report.sections.sessionStorageKeys = Object.keys(sessionStorage).slice(0, 30);
  } catch (_) {}

  console.log('[NEXORA DIAGNOSTIC] Full report:', JSON.stringify(report, null, 2));
  console.log('[NEXORA DIAGNOSTIC] URN types found in DOM:', [...allUrnPatterns].slice(0, 20));
  console.log('[NEXORA DIAGNOSTIC] DOM data-urn count:', domCheck.dataUrn);
  console.log('[NEXORA DIAGNOSTIC] Window keys with URNs:', urnKeys.map(k => k.key));

  return JSON.stringify(report);
})();
