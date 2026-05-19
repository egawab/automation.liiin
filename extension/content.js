// content.js — Nexora URL Collector v2
// Injected by background.js via executeScript AFTER window.__nexoraCfg is stamped.
// Collects LinkedIn post URLs only. No text. No analytics. No comments.
(async function () {
  const cfg     = window.__nexoraCfg || {};
  const runId   = cfg.runId;
  const keyword = cfg.keyword;

  // ── Guard: abort if config missing ────────────────────────────────────────
  if (!runId || !keyword) {
    console.warn('[CS] Missing config — aborting. cfg:', JSON.stringify(cfg));
    return;
  }

  // ── Dedup guard: uses a SEPARATE flag from the cfg-stamping step ──────────
  // background.js stamps __nexoraCfg (not __nexoraRunId), so the flag below
  // is exclusively owned by this script and can't collide with the injector.
  const flagKey = '__nexoraActive_' + runId;
  if (window[flagKey]) {
    console.warn('[CS] Already running runId=' + runId);
    return;
  }
  window[flagKey] = true;

  const sleep    = ms => new Promise(r => setTimeout(r, ms));
  const isActive = () => !!window[flagKey];
  const canSend  = () => typeof chrome !== 'undefined' && !!chrome?.runtime?.sendMessage;

  console.log('[CS] URL Collector v2 start. kw="' + keyword + '" runId=' + runId);

  // ── URN helpers ────────────────────────────────────────────────────────────
  function extractUrn(s) {
    if (!s) return '';
    const m = String(s).match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
    if (m) return 'urn:li:' + m[1] + ':' + m[2];
    const p = String(s).match(/activity-([0-9]{10,25})/i);
    if (p) return 'urn:li:activity:' + p[1];
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

    // Pass 1 — anchors with LinkedIn post URL patterns
    const ANCHOR_SELS = [
      'a[href*="feed/update/urn%3Ali%3A"]',  // URL-encoded URN in href
      'a[href*="feed/update/urn:li:"]',       // raw URN in href
      'a[href*="/detail/"]',                  // LinkedIn detail links
    ];
    for (const sel of ANCHOR_SELS) {
      try {
        document.querySelectorAll(sel).forEach(a => addUrn(extractUrn(decodeURIComponent(a.href))));
      } catch (_) {}
    }

    // Pass 2 — data-urn / data-entity-urn attributes
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
          addUrn(extractUrn(el.getAttribute(attr) || ''));
        });
      } catch (_) {}
    }

    // Pass 3 — raw text scan: hit every <script> and data attribute blob
    // Uses textContent instead of innerHTML to avoid decoding overhead
    try {
      const re = /urn:li:(activity|ugcPost|share):([0-9]{10,25})/g;
      // Scan outerHTML of all likely containers (cheaper than full body)
      const containers = [
        ...document.querySelectorAll(
          '.search-results-container, .scaffold-finite-scroll__content, .artdeco-list, main'
        ),
        document.body, // fallback
      ];
      const seen = new Set();
      for (const el of containers) {
        if (seen.has(el)) continue;
        seen.add(el);
        let m;
        re.lastIndex = 0;
        const src = el.innerHTML;
        while ((m = re.exec(src)) !== null) {
          addUrn('urn:li:' + m[1] + ':' + m[2]);
        }
        break; // first match wins to avoid duplicating body scan
      }
    } catch (_) {}

    const added = urlMap.size - before;
    if (added > 0) console.log('[CS] scanDOM +' + added + ' total=' + urlMap.size);
  }

  // ── Scroll helpers ─────────────────────────────────────────────────────────
  // LinkedIn search results scroll via window, not a container element.
  // Always use window.scrollBy + dispatchEvent to trigger lazy loading.
  function doScroll() {
    const viewH = window.innerHeight || document.documentElement.clientHeight;
    const before = window.scrollY;
    window.scrollBy({ top: Math.floor(viewH * 0.8), behavior: 'smooth' });
    // Also fire on documentElement to catch any internal virtualized list
    document.documentElement.dispatchEvent(new Event('scroll', { bubbles: true }));
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    return window.scrollY;
  }

  function getScrollProgress() {
    const h = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    const viewH = window.innerHeight || document.documentElement.clientHeight;
    const y = window.scrollY;
    return { y, atBottom: (y + viewH) >= h - 800, pageH: h };
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

  // ── Wait for initial content ───────────────────────────────────────────────
  // Give LinkedIn's React router time to hydrate the search results page
  await sleep(3000);

  // Wait until the page has scrollable content (max 15s)
  let waited = 0;
  while (waited < 15000 && isActive()) {
    const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    if (h > window.innerHeight * 1.5) break;
    await sleep(600);
    waited += 600;
  }
  if (!isActive()) { window[flagKey] = false; return; }

  // First scan before scrolling
  scanDOM();
  console.log('[CS] After initial wait: urls=' + urlMap.size);

  // ── Scroll loop ────────────────────────────────────────────────────────────
  const MAX_STEPS   = 55;
  const MIN_STEPS   = 5;
  const NO_PROG_MAX = 6;   // consecutive steps with <100px scroll = done

  let step = 0;
  let noProgress = 0;
  let lastY = -1;

  while (step < MAX_STEPS && isActive()) {
    step++;

    const scrollY = doScroll();
    // Wait for lazy-loaded content to render
    await sleep(2800 + Math.floor(Math.random() * 1000));
    if (!isActive()) break;

    const { y, atBottom } = getScrollProgress();

    // Measure actual scroll movement (compare current y to last)
    const moved = Math.abs(y - lastY);
    if (moved > 80) {
      noProgress = 0;
      lastY = y;
    } else {
      noProgress++;
    }

    scanDOM();
    console.log('[CS] step=' + step + ' y=' + Math.round(y) + ' moved=' + Math.round(moved) + ' urls=' + urlMap.size + ' noProg=' + noProgress);

    if (step >= MIN_STEPS && (noProgress >= NO_PROG_MAX || atBottom)) {
      console.log('[CS] Scroll complete. atBottom=' + atBottom + ' noProgress=' + noProgress);
      if (clickShowMore()) {
        console.log('[CS] Clicked "Show more". Continuing.');
        noProgress = 0;
        await sleep(3500);
        continue;
      }
      break;
    }
  }

  if (!isActive()) { window[flagKey] = false; return; }

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

  window[flagKey] = false;
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
