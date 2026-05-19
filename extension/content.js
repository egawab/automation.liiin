// content.js — Nexora URL Collector v2
// Injected by background.js via executeScript AFTER window.__nexoraCfg is stamped.
// Collects LinkedIn post URLs only. No text. No analytics. No comments.
(async function () {
  const cfg     = window.__nexoraCfg || {};
  const runId   = cfg.runId;
  const keyword = cfg.keyword;

  // ── Guard: abort if config missing ─────────────────────────────────
  if (!runId || !keyword) {
    console.warn('[CS] Missing config — aborting. cfg:', JSON.stringify(cfg));
    return;
  }

  // ── Guard: abort if not on a LinkedIn search page ────────────────────
  const currentUrl = window.location.href;
  if (!currentUrl.includes('linkedin.com')) {
    console.warn('[CS] Not on LinkedIn. Aborting.');
    return;
  }
  if (currentUrl.includes('/login') || currentUrl.includes('/authwall') || currentUrl.includes('/checkpoint')) {
    console.warn('[CS] LinkedIn login wall detected. Aborting. URL:', currentUrl);
    return;
  }
  // If not on search page yet, give it up to 10s for the SPA to route there
  if (!currentUrl.includes('/search/results/')) {
    console.warn('[CS] Not on search results yet. URL:', currentUrl, '- waiting up to 10s...');
    let waited = 0;
    while (waited < 10000) {
      await new Promise(r => setTimeout(r, 500));
      waited += 500;
      const u = window.location.href;
      if (u.includes('/search/results/')) { console.log('[CS] Search page loaded.'); break; }
      if (u.includes('/login') || u.includes('/authwall') || u.includes('/checkpoint')) {
        console.warn('[CS] Redirected to login wall. Aborting.');
        return;
      }
    }
    if (!window.location.href.includes('/search/results/')) {
      console.warn('[CS] Timed out waiting for search page. Aborting.');
      return;
    }
  }

  // ── Dedup guard & lifecycle management ─────────────────────────────────────
  // If the exact same runId is already running, do not re-run.
  if (window.__nexoraRunningId === runId) {
    console.warn('[CS] Already running runId=' + runId);
    return;
  }
  window.__nexoraRunningId = runId;

  const sleep    = ms => new Promise(r => setTimeout(r, ms));
  // Smart lifecycle guard: if window.__nexoraCfg changes (e.g. background starts
  // a new keyword, session resets or stops), this running instance terminates immediately.
  const isActive = () => window.__nexoraCfg?.runId === runId;
  const canSend  = () => typeof chrome !== 'undefined' && !!chrome?.runtime?.sendMessage;

  console.log('[CS] URL Collector v2 start. kw="' + keyword + '" runId=' + runId);

  // ── URN helpers ────────────────────────────────────────────────────────────
  function extractUrn(s) {
    if (!s) return '';
    const m = String(s).match(/urn:li:(activity|ugcPost|share):([0-9]{18,22})/);
    if (m) return 'urn:li:' + m[1] + ':' + m[2];
    const p = String(s).match(/activity-([0-9]{18,22})/i);
    if (p) return 'urn:li:activity:' + p[1];
    
    // Aggressive fallback: if the string contains post-like paths, extract any 18-20 digit ID
    if (s.includes('/posts/') || s.includes('feed/update') || s.includes('/detail/')) {
      const idMatch = String(s).match(/([0-9]{18,22})/);
      if (idMatch) return 'urn:li:activity:' + idMatch[1];
    }
    return '';
  }

  function urnToUrl(urn) {
    if (!urn) return '';
    const m = urn.match(/urn:li:(ugcPost|activity|share):([0-9]+)/);
    if (!m) return '';
    if (m[1] === 'ugcPost') return 'https://www.linkedin.com/posts/' + m[2];
    return 'https://www.linkedin.com/feed/update/' + urn;
  }

  // ── Deduped URL store ──────────────────────────────────────────────────────
  const urlMap = new Map(); // urn → url

  function addUrn(urn) {
    if (!urn || urlMap.has(urn)) return;
    const url = urnToUrl(urn);
    if (url) urlMap.set(urn, url);
  }

  // ── DOM scan ───────────────────────────────────────────────────────────────
  function scanDOM() {
    const before = urlMap.size;

    // Pass 1 — Scan EVERY anchor on the page (extremely robust & fast)
    try {
      document.querySelectorAll('a').forEach(a => {
        const href = a.href || '';
        if (!href) return;
        const decoded = decodeURIComponent(href);
        // Look for any hrefs containing LinkedIn post indicators
        if (
          decoded.includes('feed/update') ||
          decoded.includes('/posts/') ||
          decoded.includes('/detail/') ||
          decoded.includes('activity-') ||
          decoded.includes('urn:li:')
        ) {
          addUrn(extractUrn(decoded));
        }
      });
    } catch (_) {}

    // Pass 2 — data-urn / data-entity-urn / data-activity-urn attributes
    const DATA_ATTRS = [
      'data-urn',
      'data-activity-urn',
      'data-entity-urn',
      'data-chameleon-result-urn',
      'data-id',
    ];
    for (const attr of DATA_ATTRS) {
      try {
        document.querySelectorAll('[' + attr + ']').forEach(el => {
          const val = el.getAttribute(attr) || '';
          if (val) addUrn(extractUrn(val));
        });
      } catch (_) {}
    }

    // Pass 3 — Raw innerHTML regex scan across the ENTIRE body
    // This is critical because LinkedIn's React hydration JSON is stored in <code> tags outside <main>
    try {
      const re = /urn:li:(activity|ugcPost|share):([0-9]{18,22})/g;
      const src = document.body.innerHTML || '';
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(src)) !== null) {
        addUrn('urn:li:' + m[1] + ':' + m[2]);
      }
    } catch (_) {}

    const added = urlMap.size - before;
    if (added > 0) console.log('[CS] scanDOM +' + added + ' total=' + urlMap.size);
  }

  // ── Scroll utilities ───────────────────────────────────────────────────
  // LinkedIn can render search results in two modes:
  //   1. Window-level scroll (most common on search results pages)
  //   2. Scaffold container scroll (.scaffold-layout__main or similar)
  // We measure BOTH and use whichever changed.
  function doScroll() {
    const viewH = window.innerHeight || 800;
    const scrollAmt = Math.floor(viewH * 0.80);

    // Window scroll (primary — works for old layout)
    window.scrollBy({ top: scrollAmt, behavior: 'instant' });

    // documentElement scroll (new React layout uses this)
    document.documentElement.scrollTop += scrollAmt;

    // Scroll known scaffold containers if present
    const containers = [
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('.scaffold-layout-container__main'),
      document.getElementById('root'),
      document.querySelector('main'),
    ];
    for (const el of containers) {
      if (el && el.scrollHeight > el.clientHeight + 100) {
        el.scrollTop += scrollAmt;
      }
    }

    document.documentElement.dispatchEvent(new Event('scroll', { bubbles: true }));
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  function getScrollY() {
    // Return the maximum scroll position across window + all known containers
    let y = window.scrollY || 0;
    if (document.documentElement.scrollTop > y) y = document.documentElement.scrollTop;
    const containers = [
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('.scaffold-layout-container__main'),
      document.getElementById('root'),
      document.querySelector('main'),
    ];
    for (const el of containers) {
      if (el && el.scrollTop > y) y = el.scrollTop;
    }
    return y;
  }

  function atBottom() {
    // Check both window and inner containers
    const winH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const viewH = window.innerHeight || 800;
    if ((window.scrollY + viewH) >= winH - 800) return true;

    const containers = [
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('.scaffold-layout-container__main'),
    ];
    for (const el of containers) {
      if (el && (el.scrollTop + el.clientHeight) >= el.scrollHeight - 400) return true;
    }
    return false;
  }

  function clickShowMore() {
    // Pagination "Next" button (search results mode)
    const NEXT_SELS = [
      '.artdeco-pagination__button--next:not([disabled])',
      'button[aria-label="Next"]:not([disabled])',
      'button[aria-label="Go to next page"]:not([disabled])',
    ];
    for (const s of NEXT_SELS) {
      const b = document.querySelector(s);
      if (b) { b.click(); return true; }
    }
    // "Show more" infinite-scroll trigger
    const more = [...document.querySelectorAll('button,[role="button"]')]
      .find(b => /show more|load more|see more results/i.test(b.innerText || ''));
    if (more && !more.disabled) { more.click(); return true; }
    return false;
  }

  // ── Wait for initial content ───────────────────────────────────────────────────
  // Give LinkedIn's React router + data fetch time to complete the first render.
  await new Promise(r => setTimeout(r, 4000));

  // Wait for URL count to STABILIZE (not just > 0). This prevents breaking out on
  // a single nav-link false-positive before the real search results have loaded.
  let waited = 0;
  let lastCount = -1;
  let stableRounds = 0;
  const STABLE_NEEDED = 2; // two consecutive identical scans = data is stable

  while (waited < 18000 && isActive()) {
    scanDOM();
    const text = document.body.innerText || '';

    // Hard-stop: no results for this keyword
    if (text.includes('No results found') || text.includes('try another search') || text.includes('No posts match')) {
      console.log('[CS] No results for this keyword.');
      break;
    }

    if (urlMap.size > 0 && urlMap.size === lastCount) {
      stableRounds++;
      if (stableRounds >= STABLE_NEEDED) {
        console.log('[CS] URL count stable at ' + urlMap.size + ' after ' + waited + 'ms. Starting scroll.');
        break;
      }
    } else {
      stableRounds = 0;
    }
    lastCount = urlMap.size;

    await new Promise(r => setTimeout(r, 800));
    waited += 800;
  }
  if (!isActive()) { window.__nexoraRunningId = null; return; }

  // First scan before scrolling
  scanDOM();
  
  // -- DIAGNOSTIC SNAPSHOT --
  const diagAnchors = Array.from(document.querySelectorAll('a')).slice(0, 5).map(a => a.href).join(' | ');
  const diagContainers = ['.scaffold-layout__main', '.search-results-container', 'main', '#main'].map(s => s + ':' + !!document.querySelector(s)).join(', ');
  const diagHtml = (document.body.innerHTML || '').substring(0, 300).replace(/\n/g, '');
  const diagMsg = `[CS-DIAG] urls=${urlMap.size} waited=${waited}ms | Containers: ${diagContainers} | Anchors: ${diagAnchors} | HTML: ${diagHtml}`;
  console.log(diagMsg);
  if (canSend()) {
    chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: diagMsg }).catch(()=>{});
  }

  // ── Scroll loop ─────────────────────────────────────────────────────
  const MAX_STEPS   = 55;
  const MIN_STEPS   = 5;
  const NO_PROG_MAX = 8;   // more tolerance for slow accounts

  let step = 0;
  let noProgress = 0;
  let lastY = -1;

  while (step < MAX_STEPS && isActive()) {
    step++;

    doScroll();
    // Wait for lazy-loaded content to render
    await new Promise(r => setTimeout(r, 2800 + Math.floor(Math.random() * 1000)));
    if (!isActive()) break;

    const y = getScrollY();
    const bottom = atBottom();

    const moved = Math.abs(y - lastY);
    if (moved > 50) {
      noProgress = 0;
      lastY = y;
    } else {
      noProgress++;
    }

    scanDOM();
    console.log('[CS] step=' + step + ' y=' + Math.round(y) + ' moved=' + Math.round(moved) + ' urls=' + urlMap.size + ' noProg=' + noProgress);

    if (step >= MIN_STEPS && (noProgress >= NO_PROG_MAX || bottom)) {
      console.log('[CS] Scroll complete. atBottom=' + bottom + ' noProgress=' + noProgress);
      if (clickShowMore()) {
        console.log('[CS] Clicked “Show more”. Continuing.');
        noProgress = 0;
        await new Promise(r => setTimeout(r, 3500));
        continue;
      }
      break;
    }
  }

  if (!isActive()) { window.__nexoraRunningId = null; return; }

  // Final scan after scroll done
  await sleep(1500);
  scanDOM();
  console.log('[CS] Final URL count: ' + urlMap.size);

  // ── Build & send payload ───────────────────────────────────────────────────
  const posts = Array.from(urlMap.entries()).map(([urn, url]) => ({
    canonicalUrn: urn,
    url,
    source: 'search_only',
  }));

  window.__nexoraRunningId = null;
  console.log('[CS] DONE. Sending ' + posts.length + ' URLs to background.');

  if (canSend()) {
    chrome.runtime.sendMessage({
      action: 'FLUSH_POSTS',
      posts,
      runId,
      commentedUrns: [],
    })
      .then(r  => console.log('[CS] FLUSH ACK:', JSON.stringify(r)))
      .catch(e => console.warn('[CS] FLUSH failed:', e?.message));
  }
})();
