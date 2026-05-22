// content.js — Nexora Simple Scroll Collector (Tab Context, no SW lifetime limit)
(async function () {
  const cfg = window.__nexoraCfg;
  if (!cfg || !cfg.runId || !cfg.keyword) {
    console.warn('[CS] No config found, aborting.');
    return;
  }

  const runId   = cfg.runId;
  const keyword = cfg.keyword;
  const stopKey = '__nexoraStop_' + runId;
  const isActive = () => !window[stopKey];

  console.log('[CS] Scroll Collector started. kw="' + keyword + '" runId=' + runId);

  // ── URN helpers ─────────────────────────────────────────────────────────────
  function extractUrn(s) {
    if (!s) return '';
    const m = String(s).match(/(?:urn:li:|urn%3Ali%3A)(activity|ugcPost|share)(?::|%3A)([0-9]{10,25})/i);
    if (m) return 'urn:li:' + m[1] + ':' + m[2];
    const p = String(s).match(/activity-([0-9]{10,25})/i);
    if (p) return 'urn:li:activity:' + p[1];
    return '';
  }

  function urnToUrl(urn) {
    const m = urn.match(/urn:li:(ugcPost|activity|share):([0-9]+)/);
    if (!m) return '';
    // FIX: /posts/{number} is not a valid LinkedIn URL. Use /feed/update/ for ALL URN types.
    return 'https://www.linkedin.com/feed/update/' + urn;
  }

  // ── Deduped store ────────────────────────────────────────────────────────────
  const urlMap = new Map(); // urn → url

  function addUrn(urn) {
    if (!urn || urlMap.has(urn)) return;
    const url = urnToUrl(urn);
    if (url) urlMap.set(urn, url);
  }

  // ── Collect: anchors + data attrs + raw innerHTML ──────────────────────────
  function collectAll() {
    const before = urlMap.size;

    // A tags
    document.querySelectorAll('a[href]').forEach(a => {
      const h = a.href || '';
      if (h.includes('/feed/update/') || h.includes('/posts/') || h.includes('activity-'))
        addUrn(extractUrn(decodeURIComponent(h)) || extractUrn(h));
    });

    // Data attributes
    ['data-entity-urn','data-urn','data-activity-urn','data-chameleon-result-urn'].forEach(attr => {
      document.querySelectorAll('[' + attr + ']').forEach(el => addUrn(extractUrn(el.getAttribute(attr) || '')));
    });

    // Raw innerHTML URN scan
    const re = /(?:urn:li:|urn%3Ali%3A)(activity|ugcPost|share)(?::|%3A)([0-9]{10,25})/gi;
    let m; re.lastIndex = 0;
    const html = document.body.innerHTML;
    while ((m = re.exec(html)) !== null) addUrn('urn:li:' + m[1] + ':' + m[2]);

    return urlMap.size - before;
  }

  // ── Scroll: try every method ────────────────────────────────────────────────
  function scrollDown(px) {
    window.scrollBy(0, px);
    if (document.scrollingElement) document.scrollingElement.scrollTop += px;

    // Biggest scrollable container
    let best = null;
    document.querySelectorAll('div,main,section,article').forEach(el => {
      if (el.scrollHeight > el.clientHeight + 200)
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
    });
    if (best) best.scrollTop += px;

    // WheelEvent on LazyColumn (SDUI virtual scroller trigger)
    const lc = document.querySelector('[data-testid="lazy-column"]') || document.querySelector('main');
    if (lc) lc.dispatchEvent(new WheelEvent('wheel', { deltaY: px, bubbles: true, cancelable: true }));
  }

  // ── Main loop ────────────────────────────────────────────────────────────────
  // Wait for page to fully render
  await new Promise(r => setTimeout(r, 2500));

  // Initial collect
  let added = collectAll();
  if (added > 0) console.log('[CS] Initial: +' + added + ' posts (total=' + urlMap.size + ')');

  // Scroll loop: 12 steps × 400px = 4800px (covers SDUI scrollH ~3500)
  const STEPS = 12;
  for (let step = 1; step <= STEPS; step++) {
    if (!isActive()) break;
    scrollDown(400);
    await new Promise(r => setTimeout(r, 2000));
    added = collectAll();
    if (added > 0) console.log('[CS] Step ' + step + '/' + STEPS + ': +' + added + ' posts (total=' + urlMap.size + ')');
  }

  // ── Flush results to background.js ──────────────────────────────────────────
  const posts = Array.from(urlMap.entries()).map(([canonicalUrn, url]) => ({ canonicalUrn, url, source: 'search_only' }));
  console.log('[CS] Done. Sending ' + posts.length + ' posts to background for kw="' + keyword + '"');

  try {
    chrome.runtime.sendMessage({ action: 'FLUSH_POSTS', runId, keyword, posts });
  } catch (e) {
    console.warn('[CS] sendMessage failed:', e.message);
  }
})();
