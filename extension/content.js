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
  // Use a dedicated per-run stop flag — NOT window.__nexoraCfg which can be
  // cleared by LinkedIn's SPA re-rendering the page between route changes.
  const stopKey  = '__nexoraStop_' + runId;
  window[stopKey] = false;
  const isActive = () => !window[stopKey];
  const canSend  = () => typeof chrome !== 'undefined' && !!chrome?.runtime?.sendMessage;

  console.log('[CS] URL Collector v2 start. kw="' + keyword + '" runId=' + runId);

  // ── URN helpers ────────────────────────────────────────────────────────────
  function extractUrn(s) {
    if (!s) return '';
    // Primary: explicit URN string
    const m = String(s).match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
    if (m) return 'urn:li:' + m[1] + ':' + m[2];
    // Secondary: activity-NNNN prefix pattern in URLs
    const p = String(s).match(/activity-([0-9]{10,25})/i);
    if (p) return 'urn:li:activity:' + p[1];
    // Fallback: ONLY fire for /posts/ paths that also contain -activity- in the slug.
    // This is the standard LinkedIn post permalink format and prevents false positives
    // from profile pages, hashtag pages, and other /posts/ URLs without a post ID.
    if ((s.includes('/posts/') || s.includes('feed/update') || s.includes('/detail/')) &&
        s.includes('-activity-')) {
      const idMatch = String(s).match(/([0-9]{10,25})/);
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

  // ── Deduped URL store ────────────────────────────────────────────────────────
  const urlMap = new Map(); // urn → { url, engagementScore }

  function addUrn(urn, engagementScore = null) {
    if (!urn) return;
    const url = urnToUrl(urn);
    if (!url) return;
    if (urlMap.has(urn)) {
      // Upgrade null → known score if we receive data from a later pass
      if (engagementScore !== null && urlMap.get(urn).engagementScore === null) {
        urlMap.get(urn).engagementScore = engagementScore;
      }
      return;
    }
    urlMap.set(urn, { url, engagementScore });
  }

  // ── DOM scan ───────────────────────────────────────────────────────────────
  function scanDOM() {
    const before = urlMap.size;

    // Pass 1 — Scan all anchors on the page for LinkedIn post links
    try {
      document.querySelectorAll('a').forEach(a => {
        const href = a.href || '';
        if (!href) return;
        const decoded = decodeURIComponent(href);
        // Skip known non-post LinkedIn URL patterns that generate false positives:
        // /safety/go/ = external link redirect wrapper (contains long tracking hashes)
        // /preload/   = connection pre-invitation URLs
        // pure /in/   = profile pages without an accompanying activity ID
        if (decoded.includes('/safety/go/') ||
            decoded.includes('/preload/') ||
            (decoded.includes('linkedin.com/in/') && !decoded.includes('activity'))) return;
        // Match only genuine post URL patterns
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

    // Pass 3a — Raw innerHTML scan (decoded URNs)
    try {
      const re = /urn:li:(activity|ugcPost|share):([0-9]{10,25})/g;
      const src = document.body.innerHTML || '';
      let m; re.lastIndex = 0;
      while ((m = re.exec(src)) !== null) addUrn('urn:li:' + m[1] + ':' + m[2]);
    } catch (_) {}

    // Pass 3b — URL-encoded URN scan (urn%3Ali%3Aactivity%3A...)
    // LinkedIn's new React layout stores URNs URL-encoded in HTML attributes and script tags
    try {
      const re = /urn%3Ali%3A(activity|ugcPost|share)%3A([0-9]{10,25})/gi;
      const src = document.body.innerHTML || '';
      let m; re.lastIndex = 0;
      while ((m = re.exec(src)) !== null) addUrn('urn:li:' + m[1] + ':' + m[2]);
    } catch (_) {}

    // Pass 3c — JSON-escaped URN scan (urn\\u003Ali\\u003A...)
    // React SSR sometimes stores URNs as unicode-escaped JSON
    try {
      const re = /urn(?:\\u003a|%3a|:)li(?:\\u003a|%3a|:)(activity|ugcPost|share)(?:\\u003a|%3a|:)([0-9]{10,25})/gi;
      const src = document.body.innerHTML || '';
      let m; re.lastIndex = 0;
      while ((m = re.exec(src)) !== null) addUrn('urn:li:' + m[1] + ':' + m[2]);
    } catch (_) {}

    // Pass 4 — Hidden <code> SSR elements (LinkedIn hydration state)
    // LinkedIn's new React SSR embeds initial state as JSON in <code id="bpr-guid-*"> elements
    try {
      document.querySelectorAll('code[id], code[style*="display:none"], code[style*="display: none"]').forEach(el => {
        const txt = el.textContent || '';
        if (txt.length < 50) return;
        // Extract any nested activity URNs within fs_feedUpdate or similar wrappers
        const re = /(?:activity|ugcPost|share)[%:\\u003a]+([0-9]{10,25})/gi;
        let m; re.lastIndex = 0;
        while ((m = re.exec(txt)) !== null) {
          const type = m[0].split(/[%:\\u003a]/)[0].toLowerCase();
          const knownType = type === 'ugcpost' ? 'ugcPost' : (type === 'share' ? 'share' : 'activity');
          addUrn('urn:li:' + knownType + ':' + m[1]);
        }
      });
    } catch (_) {}

    // Pass 5 — API-intercepted URNs with engagement scores (Map from interceptor.js)
    try {
      if (window.__nexoraApiUrns && window.__nexoraApiUrns.size > 0) {
        window.__nexoraApiUrns.forEach((score, urn) => addUrn(urn, score));
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

    // Window-level scroll (old scaffold layout)
    window.scrollBy({ top: scrollAmt, behavior: 'instant' });
    // NOTE: do NOT also set document.documentElement.scrollTop here —
    // it is the same as window.scrollY and would double-scroll the old layout.

    // Scroll inner containers (new React layout: main, #root, scaffold)
    // Also include SDUI layout containers (section[aria-label] and data-sdui-screen wrapper)
    const containers = [
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('.scaffold-layout-container__main'),
      document.getElementById('root'),
      document.querySelector('main'),
      // ── LinkedIn SDUI layout (server-driven UI, hashed CSS classes) ──
      document.querySelector('section[aria-label="Primary content"]'),
      document.querySelector('[data-sdui-screen]'),
      document.querySelector('[data-testid="lazy-column"]'),
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
      // ── LinkedIn SDUI layout ──
      document.querySelector('section[aria-label="Primary content"]'),
      document.querySelector('[data-sdui-screen]'),
      document.querySelector('[data-testid="lazy-column"]'),
    ];
    for (const el of containers) {
      if (el && el.scrollTop > y) y = el.scrollTop;
    }
    return y;
  }

  function atBottom() {
    const viewH = window.innerHeight || 800;

    // Check window scroll position
    const winH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const windowAtBottom = (window.scrollY + viewH) >= winH - 800;

    // Check inner containers (including SDUI layout containers)
    const scrollContainers = [
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('.scaffold-layout-container__main'),
      document.querySelector('main'),
      // ── LinkedIn SDUI layout ──
      document.querySelector('section[aria-label="Primary content"]'),
      document.querySelector('[data-sdui-screen]'),
      document.querySelector('[data-testid="lazy-column"]'),
    ].filter(el => el && el.scrollHeight > el.clientHeight + 100);

    // For old layout (window scrolls): use window bottom check.
    // For new layout (container scrolls, winH is tiny ~583px): use container check.
    if (scrollContainers.length === 0) {
      // Old layout — pure window scroll
      return windowAtBottom;
    }
    // New layout — check the container
    return scrollContainers.every(el => (el.scrollTop + el.clientHeight) >= el.scrollHeight - 400);
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

  // ── Wait for initial content ──────────────────────────────────────────────
  // 5s hard sleep — lets LinkedIn's React fetch+render complete before we scan.
  await new Promise(r => setTimeout(r, 5000));

  // Poll until URL count stabilizes (same for 2 checks) or timeout.
  // ALWAYS continue to the scroll phase even if we found 0 URLs —
  // LinkedIn lazy-loads results on scroll on the new React layout.
  let waited = 0;
  let lastCount = -1;
  let stableRounds = 0;

  while (waited < 15000 && isActive()) {
    scanDOM();
    const text = document.body.innerText || '';
    if (text.includes('No results found') || text.includes('try another search') || text.includes('No posts match')) {
      console.log('[CS] No results for this keyword.');
      break;
    }
    if (urlMap.size > 0 && urlMap.size === lastCount) {
      stableRounds++;
      if (stableRounds >= 2) {
        console.log('[CS] URL count stable at ' + urlMap.size + ' after ' + waited + 'ms.');
        break;
      }
    } else {
      stableRounds = 0;
    }
    lastCount = urlMap.size;
    await new Promise(r => setTimeout(r, 800));
    waited += 800;
  }
  // NOTE: do NOT return early here even if urls=0.
  // The scroll phase will lazy-load content on the new React layout.
  if (!isActive()) { window[stopKey] = true; window.__nexoraRunningId = null; return; }

  // First scan before scrolling
  scanDOM();

  // Diagnostic snapshot — show raw HTML from inside main to identify post ID storage format
  const mainEl = document.querySelector('main');
  const diagRawHtml = (mainEl ? mainEl.innerHTML : document.body.innerHTML).substring(0, 600).replace(/\s+/g, ' ');
  const diagApiUrns = (window.__nexoraApiUrns ? window.__nexoraApiUrns.size : 0);
  const diagCodeEls = document.querySelectorAll('code[id]').length;
  const diagMsg = `[CS-DIAG] urls=${urlMap.size} apiUrns=${diagApiUrns} codeEls=${diagCodeEls} | RAW: ${diagRawHtml}`;
  console.log(diagMsg);
  if (canSend()) chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: diagMsg }).catch(()=>{});

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

  if (!isActive()) { window[stopKey] = true; window.__nexoraRunningId = null; return; }

  // Final scan
  await sleep(1500);
  scanDOM();
  console.log('[CS] Final URL count: ' + urlMap.size);

  // Build payload — URL-dedup as second layer, carry engagement score per post.
  // engagementScore: number (sum of likes+comments+shares) or null (unscored).
  // Safe-default: null posts are ALWAYS included — never discarded for missing data.
  const seenUrls = new Set();
  const posts = Array.from(urlMap.entries())
    .map(([urn, { url, engagementScore }]) => ({ canonicalUrn: urn, url, source: 'search_only', engagementScore }))
    .filter(p => {
      if (seenUrls.has(p.url)) return false;
      seenUrls.add(p.url);
      return true;
    });

  const scored   = posts.filter(p => p.engagementScore !== null).length;
  const unscored = posts.length - scored;
  window[stopKey] = true;
  window.__nexoraRunningId = null;
  console.log(`[CS] DONE. Sending ${posts.length} URLs (scored=${scored} unscored=${unscored} url-dupes=${urlMap.size - posts.length}).`);

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
