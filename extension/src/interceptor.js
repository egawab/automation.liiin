/**
 * Nexora Network Interceptor v2.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs in the page's MAIN world (injected via <script> tag by core-engine.js).
 * Monkey-patches fetch + XHR to intercept LinkedIn's Voyager/GraphQL API calls.
 *
 * Strategy:
 *  Pass 1 — Raw regex scan: finds ALL activity URNs in the response body.
 *            O(n) string scan, catches every post type regardless of nesting.
 *  Pass 2 — Windowed metric extraction: for each URN, scan a ±800-char window
 *            for numLikes / numComments values.
 *  Pass 3 — Structured JSON scan: targeted parse for known metric paths.
 *            Merges/upgrades Pass 1 results with higher-confidence values.
 *
 * Results posted to content-script world via:
 *   window.postMessage({ type: '__NEXORA_NETWORK_POSTS__', posts: [...] }, '*')
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NEXORA_INTERCEPTOR_ACTIVE__) return;
  window.__NEXORA_INTERCEPTOR_ACTIVE__ = true;

  // ── URL filter — intercept ALL LinkedIn data endpoints ─────────────────────
  const INTERCEPT_PATTERNS = [
    // LinkedIn's NEW RSC (React Server Components) architecture — SEARCH_B uses this
    '/flagship-web/rsc-action/',
    'contentSearchResults',      // pagination for content search results
    'searchHomeRequestAction',   // initial search request
    'updateSearchHistory',       // search tracking (may contain post data)
    // Legacy Voyager API (SEARCH_A, feed, etc.)
    '/voyager/api/',
    // GraphQL
    '/graphql?', 'graphql?queryId',
    // Specific payload signals (as a catch-all for any unknown endpoint)
    'feedUpdates', 'search/hits', 'searchHits', 'fsd_update',
    'numLikes', 'totalReactionCount', 'urn:li:activity',
  ];

  function shouldIntercept(url) {
    if (!url) return false;
    const u = String(url);
    // Must be LinkedIn domain or relative path
    if (!u.includes('linkedin.com') && !u.startsWith('/')) return false;
    // Skip obvious non-data assets
    if (u.includes('/static/') || u.endsWith('.js') || u.endsWith('.css') ||
        u.endsWith('.png') || u.endsWith('.jpg') || u.endsWith('.woff')) return false;
    return INTERCEPT_PATTERNS.some(p => u.includes(p));
  }

  // ── Global dedup — never emit the same URN twice ───────────────────────────
  const _seen = new Set();

  // ── URN patterns ──────────────────────────────────────────────────────────
  const URN_RE     = /urn:li:(activity|ugcPost|share):(\d{10,25})/gi;
  const URN_SINGLE = /urn:li:(activity|ugcPost|share):(\d{10,25})/i;
  const FSD_RE     = /urn:li:fsd_update:[:(]urn:li:(activity|ugcPost|share):(\d{10,25})/gi;
  const FSD_SINGLE = /urn:li:fsd_update:[:(]urn:li:(activity|ugcPost|share):(\d{10,25})/i;

  function buildUrl(type, id) {
    const t = type.toLowerCase();
    if (t === 'ugcpost') return `https://www.linkedin.com/feed/update/urn:li:ugcPost:${id}`;
    if (t === 'share')   return `https://www.linkedin.com/feed/update/urn:li:share:${id}`;
    return `https://www.linkedin.com/feed/update/urn:li:activity:${id}`;
  }

  function parseCount(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return Math.floor(v);
    const s = String(v).replace(/,/g, '').trim().toUpperCase();
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1_000_000);
    return Math.floor(parseFloat(s)) || 0;
  }

  function dig(obj, ...keys) {
    for (const k of keys) { if (obj == null) return undefined; obj = obj[k]; }
    return obj;
  }

  // ── Pass 1+2: Raw text scan ────────────────────────────────────────────────
  function rawTextScan(body) {
    const results = new Map();

    function processHit(type, id, matchIndex) {
      const url = buildUrl(type, id);
      if (_seen.has(url)) return;

      const start = Math.max(0, matchIndex - 400);
      const end   = Math.min(body.length, matchIndex + 800);
      const win   = body.slice(start, end);

      let likes = 0, comments = 0, reposts = 0, text = '', author = 'Unknown';

      // Broader metric field names — LinkedIn search uses different names than feed
      const lm = win.match(/"(?:numLikes|totalReactionCount|likeCount|reactionCount|reaction_count|numReactions|totalLikeCount)"\s*:\s*(\d+)/);
      if (lm) likes = parseInt(lm[1], 10);
      // Fallback: look for aggregate reaction count pattern
      if (likes === 0) {
        const lm2 = win.match(/"count"\s*:\s*(\d+)[^}]*"type"\s*:\s*"LIKE"/);
        const lm3 = win.match(/aggregatedTotalReactions":\s*(\d+)/);
        if (lm2) likes = parseInt(lm2[1], 10);
        else if (lm3) likes = parseInt(lm3[1], 10);
      }
      const cm = win.match(/"(?:numComments|commentCount|totalCommentCount|commentsCount)"\s*:\s*(\d+)/);
      if (cm) comments = parseInt(cm[1], 10);
      const sm = win.match(/"(?:numShares|repostCount|shareCount|sharesCount)"\s*:\s*(\d+)/);
      if (sm) reposts = parseInt(sm[1], 10);
      const tm = win.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (tm) text = tm[1].replace(/\\n/g, ' ').substring(0, 600);
      const nm = win.match(/"(?:firstName|fullName|localizedName)"\s*:\s*"([^"]{1,60})"/);
      if (nm) author = nm[1];

      const existing = results.get(url);
      if (existing) {
        existing.likes    = Math.max(existing.likes, likes);
        existing.comments = Math.max(existing.comments, comments);
        existing.reposts  = Math.max(existing.reposts, reposts);
        if (text.length > existing.text.length) existing.text = text;
      } else {
        results.set(url, { url, likes, comments, reposts, text, author, source: 'network' });
        // UNCONDITIONAL DIAGNOSTIC: Log the chunk so we can see the exact RSC JSON format
        console.log(`[Nexora][RSC] Found URN: ${id}. Extracted likes=${likes}. Chunk:`, win.replace(/\n/g, ' '));
      }
    }

    URN_RE.lastIndex = 0;
    let m;
    while ((m = URN_RE.exec(body)) !== null) processHit(m[1], m[2], m.index);

    FSD_RE.lastIndex = 0;
    while ((m = FSD_RE.exec(body)) !== null) processHit(m[1], m[2], m.index);

    return results;
  }

  // ── Pass 3: Structured JSON scan ──────────────────────────────────────────
  function structuredScan(body, existingMap) {
    const pools = [];
    
    // Try parsing as standard JSON first
    try { 
      const json = JSON.parse(body);
      if (Array.isArray(json)) pools.push(...json);
      if (json && typeof json === 'object') pools.push(json);
    } catch (e) {
      // If standard parse fails, it might be an RSC stream (line-delimited JSON)
      const lines = body.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          // RSC lines often look like `0:["$", ...]` or just raw JSON arrays
          // We can strip the leading `0:` if present, or just try to match the first [ or {
          const startIdx = line.indexOf('{') > -1 && line.indexOf('[') > -1 
            ? Math.min(line.indexOf('{'), line.indexOf('['))
            : Math.max(line.indexOf('{'), line.indexOf('['));
            
          if (startIdx >= 0) {
            const cleanLine = line.substring(startIdx);
            const json = JSON.parse(cleanLine);
            if (Array.isArray(json)) pools.push(...json);
            if (json && typeof json === 'object') pools.push(json);
          }
        } catch (err) {}
      }
    }
    
    if (pools.length === 0) return;

    // Expand nested arrays/objects inside the pools
    const expandedPools = [];
    for (const json of pools) {
      expandedPools.push(json);
      if (json && typeof json === 'object') {
        ['included', 'elements', 'data', 'results', 'hits', 'items'].forEach(k => {
          if (Array.isArray(json[k])) expandedPools.push(...json[k]);
        });
        if (json.data && typeof json.data === 'object') {
          Object.values(json.data).forEach(v => { if (Array.isArray(v)) expandedPools.push(...v); });
        }
      }
    }

    for (const node of expandedPools) {
      if (!node || typeof node !== 'object') continue;
      try {
        const urnRaw = String(
          node.updateUrn || node.entityUrn || node.dashEntityUrn || node.urn ||
          node.targetUrn || node.objectUrn ||
          dig(node, 'updateV2', 'entityUrn') ||
          dig(node, 'entityResult', 'entityUrn') ||
          dig(node, 'template', 'updateV2', 'entityUrn') ||
          dig(node, 'socialActivity', 'entityUrn') || ''
        );

        const mm = FSD_SINGLE.exec(urnRaw) || URN_SINGLE.exec(urnRaw);
        if (!mm) continue;
        const url = buildUrl(mm[1], mm[2]);

        const likes = parseCount(
          dig(node, 'socialDetail', 'totalSocialActivityCounts', 'numLikes') ??
          dig(node, 'socialCounts', 'numLikes') ??
          dig(node, 'reactionSummary', 'count') ??
          dig(node, 'socialActivity', 'numLikes') ??
          dig(node, 'socialActivityCounts', 'numLikes') ??
          dig(node, 'numLikes') ?? 0
        );
        const comments = parseCount(
          dig(node, 'socialDetail', 'totalSocialActivityCounts', 'numComments') ??
          dig(node, 'socialCounts', 'numComments') ??
          dig(node, 'socialActivity', 'numComments') ??
          dig(node, 'numComments') ?? 0
        );
        const reposts = parseCount(
          dig(node, 'socialDetail', 'totalSocialActivityCounts', 'numShares') ??
          dig(node, 'socialCounts', 'numShares') ??
          dig(node, 'socialActivity', 'numShares') ??
          dig(node, 'numShares') ?? 0
        );
        const text = String(
          dig(node, 'commentary', 'text', 'text') ??
          dig(node, 'updateMetadata', 'shareCommentary', 'text') ??
          dig(node, 'content', 'article', 'title') ?? ''
        ).substring(0, 600);
        const author = String(
          dig(node, 'actor', 'name', 'text') ??
          dig(node, 'miniProfile', 'firstName') ?? 'Unknown'
        ).substring(0, 80);
        const postedAtMs = parseCount(dig(node, 'createdAt') ?? 0);

        if (existingMap.has(url)) {
          const ex = existingMap.get(url);
          ex.likes    = Math.max(ex.likes, likes);
          ex.comments = Math.max(ex.comments, comments);
          ex.reposts  = Math.max(ex.reposts, reposts);
          if (text.length > ex.text.length) ex.text = text;
          if (author !== 'Unknown') ex.author = author;
          if (postedAtMs > 0) ex.postedAtMs = postedAtMs;
        } else if (!_seen.has(url)) {
          existingMap.set(url, { url, likes, comments, reposts, text, author, postedAtMs, source: 'network' });
        }
      } catch (e) {}
    }
  }

  // ── Process a captured response body ─────────────────────────────────────
  function processBody(body, sourceUrl) {
    if (!body || body.length < 50) return;

    const map = rawTextScan(body);
    if (body.length < 5_000_000) structuredScan(body, map);
    if (map.size === 0) return;

    const posts = [];
    map.forEach((post, url) => {
      if (_seen.has(url)) return;
      _seen.add(url);
      posts.push(post);
    });

    if (posts.length > 0) {
      // Store in global so core-engine can read them at startup (avoids timing race)
      window.__NexoraEmbeddedPosts = window.__NexoraEmbeddedPosts || [];
      window.__NexoraEmbeddedPosts.push(...posts);
      window.postMessage({ type: '__NEXORA_NETWORK_POSTS__', posts, sourceUrl }, '*');
      console.log(`[Nexora][Interceptor] ${posts.length} posts from ${sourceUrl.split('?')[0].slice(-50)}`);
    }
  }

  // ── Scan LinkedIn's embedded Voyager cache (<code id="bpr-*"> elements) ───
  // LinkedIn SEARCH_B pre-loads all search results as JSON in <code> elements
  // in the initial HTML — no fetch calls are made. We must read these directly.
  const _scannedCodes = new WeakSet();

  function scanEmbeddedData() {
    let newFound = 0;
    document.querySelectorAll('code').forEach(el => {
      if (_scannedCodes.has(el)) return;
      _scannedCodes.add(el);
      try {
        const text = el.textContent || '';
        if (text.length > 80 && text.includes('urn:li:')) {
          processBody(text, 'bpr:' + (el.id || 'inline'));
          newFound++;
        }
      } catch (e) {}
    });
    if (newFound > 0) {
      console.log(`[Nexora][Interceptor] Scanned ${newFound} embedded <code> elements`);
    }
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(scanEmbeddedData, 200));
  } else {
    setTimeout(scanEmbeddedData, 200);
  }

  // Watch for new <code> elements added by LinkedIn's SPA as more results load
  const _codeObserver = new MutationObserver(() => scanEmbeddedData());
  document.addEventListener('DOMContentLoaded', () => {
    _codeObserver.observe(document.body || document.documentElement, {
      childList: true, subtree: true
    });
  });

  // ── Patch fetch ────────────────────────────────────────────────────────────
  const _origFetch = window.fetch.bind(window);
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : ((args[0] || {}).url || '');
    // Log ALL LinkedIn fetch calls so we can see what endpoints are hit
    if (url && (url.includes('linkedin.com') || url.startsWith('/'))) {
      console.log('[Nexora][Fetch]', url.substring(0, 120));
    }
    const prom = _origFetch(...args);
    if (shouldIntercept(url)) {
      prom.then(resp => {
        try { resp.clone().text().then(b => processBody(b, url)).catch(() => {}); } catch (e) {}
      }).catch(() => {});
    }
    return prom;
  };

  // ── Patch XHR ─────────────────────────────────────────────────────────────
  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._nexoraUrl = String(url || '');
    return _origOpen.apply(this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this._nexoraUrl && shouldIntercept(this._nexoraUrl)) {
      this.addEventListener('load', () => {
        try { processBody(this.responseText, this._nexoraUrl); } catch (e) {}
      }, { once: true });
    }
    return _origSend.apply(this, args);
  };

  console.log('[Nexora][Interceptor] v2.1 active on', location.href.slice(0, 60));
})();
