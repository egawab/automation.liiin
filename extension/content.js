// content.js — Nexora URL Collector
// Collects LinkedIn post URLs only. No text. No analytics. No comments.
// Injected by background.js after stamping window.__nexoraCfg.
(async function () {
  const cfg = window.__nexoraCfg || {};
  const { runId, keyword } = cfg;

  if (!runId || !keyword) { console.warn('[CS] Missing config — aborting'); return; }
  if (window.__nexoraRunId === runId) { console.warn('[CS] Already running runId=' + runId); return; }
  window.__nexoraRunId = runId;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isActive = () => window.__nexoraRunId === runId;
  const canSend  = () => typeof chrome !== 'undefined' && !!chrome?.runtime?.sendMessage;

  console.log('[CS] URL Collector start. kw="' + keyword + '" runId=' + runId);

  // ── URN extraction helpers ───────────────────────────────────────────────────
  function extractUrn(s) {
    if (!s) return '';
    const m = String(s).match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
    if (m) return 'urn:li:' + m[1] + ':' + m[2];
    // Anchor href format: activity-XXXXXXX
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

  // ── URL Map (urn → url) ──────────────────────────────────────────────────────
  const urlMap = new Map(); // urn → canonical URL

  function addUrn(urn) {
    if (!urn || urlMap.has(urn)) return;
    const url = urnToUrl(urn);
    if (url) {
      urlMap.set(urn, url);
    }
  }

  // ── DOM scan — collect URLs from all layout variants ─────────────────────────
  function scanDOM() {
    // Pass 1: anchor hrefs (most reliable — direct post links)
    const ANCHOR_SELECTORS = [
      'a[href*="feed/update/urn:li:"]',
      'a[href*="/posts/"]',
      'a[href*="activity-"]',
    ];
    for (const sel of ANCHOR_SELECTORS) {
      try {
        document.querySelectorAll(sel).forEach(a => {
          addUrn(extractUrn(a.href));
        });
      } catch (_) {}
    }

    // Pass 2: data attributes (LinkedIn A/B layout variants)
    const DATA_ATTRS = [
      'data-urn',
      'data-activity-urn',
      'data-chameleon-result-urn',
      'data-entity-urn',
      'data-id',
    ];
    for (const attr of DATA_ATTRS) {
      try {
        document.querySelectorAll('[' + attr + ']').forEach(el => {
          addUrn(extractUrn(el.getAttribute(attr) || ''));
        });
      } catch (_) {}
    }

    // Pass 3: Raw innerHTML URN scan (catches any remaining format)
    try {
      const re = /urn:li:(activity|ugcPost|share):([0-9]{10,25})/g;
      let m;
      while ((m = re.exec(document.body.innerHTML)) !== null) {
        addUrn('urn:li:' + m[1] + ':' + m[2]);
      }
    } catch (_) {}
  }

  // ── Scroll utilities ─────────────────────────────────────────────────────────
  function getScrollEl() {
    const candidates = [
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('.scaffold-layout-container__main'),
      document.querySelector('main'),
      document.scrollingElement,
      document.documentElement,
    ];
    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight + 100) return el;
    }
    return document.documentElement;
  }

  function doScroll() {
    try {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    } catch (_) {}
    const el = getScrollEl();
    el.scrollTop += Math.floor(el.clientHeight * 0.85);
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    return el.scrollTop;
  }

  function atBottom() {
    const el = getScrollEl();
    if (el.scrollHeight < el.clientHeight * 1.3) return false;
    return (el.scrollTop + el.clientHeight) >= el.scrollHeight - 600;
  }

  function clickShowMore() {
    // LinkedIn "Show more results" pagination button
    const NEXT_SELS = [
      '.artdeco-pagination__button--next',
      'button[aria-label="Next"]',
      'button[aria-label="Go to next page"]',
    ];
    for (const s of NEXT_SELS) {
      const b = document.querySelector(s);
      if (b && !b.disabled) { b.click(); return true; }
    }
    // "Show more" style button
    const more = [...document.querySelectorAll('button,[role="button"]')]
      .find(b => /show more|load more|see more results/i.test(b.innerText || ''));
    if (more && !more.disabled) { more.click(); return true; }
    return false;
  }

  // ── Wait for initial page content ────────────────────────────────────────────
  await sleep(2500);
  let waited = 0;
  while (waited < 12000 && isActive()) {
    const el = getScrollEl();
    if (el.scrollHeight > el.clientHeight * 1.5) break;
    await sleep(500); waited += 500;
  }
  if (!isActive()) { window.__nexoraRunId = null; return; }

  // ── Scroll loop ──────────────────────────────────────────────────────────────
  const MAX_STEPS    = 60;
  const MIN_STEPS    = 6;
  const NO_PROG_MAX  = 8;

  let step = 0, noProgress = 0, lastTop = -1;

  while (step < MAX_STEPS && isActive()) {
    step++;
    const st = doScroll();
    await sleep(2600 + Math.floor(Math.random() * 1200));
    if (!isActive()) break;

    if (Math.abs(st - lastTop) > 60) { noProgress = 0; lastTop = st; }
    else noProgress++;

    scanDOM();
    console.log('[CS] step=' + step + ' urls=' + urlMap.size + ' noProg=' + noProgress);

    if (step >= MIN_STEPS && (noProgress >= NO_PROG_MAX || atBottom())) {
      if (clickShowMore()) { noProgress = 0; await sleep(3000); continue; }
      break;
    }
  }

  if (!isActive()) { window.__nexoraRunId = null; return; }

  // Final DOM scan after scrolling is done
  await sleep(1500);
  scanDOM();

  // ── Build output ─────────────────────────────────────────────────────────────
  // Only URL — no author, no text, no analytics
  const posts = Array.from(urlMap.entries()).map(([urn, url]) => ({
    canonicalUrn: urn,
    url:          url,
    postAuthor:   null,
    postPreview:  null,
    likes:        null,
    comments:     null,
    source:       'search_only',
  }));

  console.log('[CS] URL Collector done. Found ' + posts.length + ' unique post URLs.');
  window.__nexoraRunId = null;

  if (canSend() && posts.length > 0) {
    chrome.runtime.sendMessage({ action: 'FLUSH_POSTS', posts, runId, commentedUrns: [] })
      .then(r  => console.log('[CS] FLUSH_POSTS ACK:', JSON.stringify(r)))
      .catch(e => console.warn('[CS] FLUSH_POSTS failed:', e?.message));
  } else if (canSend()) {
    // Nothing found — still signal done so background can advance
    chrome.runtime.sendMessage({ action: 'FLUSH_POSTS', posts: [], runId, commentedUrns: [] }).catch(() => {});
  }
})();
