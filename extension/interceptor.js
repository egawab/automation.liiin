/**
 * interceptor.js — LinkedIn Network Interception Layer v2
 * Runs in the page's MAIN world (injected via <script> tag from content.js).
 *
 * ARCHITECTURE: Dual-pass extraction
 * Pass 1 (Raw Text Regex): Scan the raw response body as a string with a single
 *   regex to find ALL activity URNs. This is O(n) and catches every post type
 *   (feed, repost, video, carousel, article) regardless of JSON nesting depth.
 *
 * Pass 2 (Windowed Metric Extraction): For each URN found, extract a ~800-char
 *   text window around it and regex-scan it for numLikes/numComments/count
 *   values. No recursive tree walking, no JSON object allocation per node.
 *
 * Pass 3 (Structured JSON Bonus): Also do a targeted structured parse on the
 *   full JSON for known high-confidence paths. Merges with Pass 1 results.
 */
(function () {
  'use strict';

  if (window.__LI_INTERCEPTOR_ACTIVE__) return;
  window.__LI_INTERCEPTOR_ACTIVE__ = true;

  // ── URL filter ──────────────────────────────────────────────────────────────
  const INTERCEPT_PATTERNS = [
    '/voyager/api/feed',
    '/voyager/api/search',
    '/voyager/api/graphql',
    '/graphql?',
    'graphql?queryId',
    'com.linkedin.voyager.feed',
    'feedUpdates',
    'search/hits',
    'dash/posts',
    'dash/feed',
    'socialActions',
    // Account B (newer LinkedIn variant) uses these endpoints:
    'dash/updates',
    'dash/feedUpdates',
    'fsd_update',
    'fsd_feedUpdate',
    'com.linkedin.voyager.dash.feed',
    'com.linkedin.voyager.dash.search',
  ];
  function shouldIntercept(url) {
    if (!url) return false;
    const u = String(url);
    return INTERCEPT_PATTERNS.some(p => u.includes(p));
  }

  // ── Persistent global dedup — never post the same URN twice ─────────────────
  // Module-level (not cleared per response) so duplicates across multiple API
  // calls are also filtered out.
  const _globalSeen = new Set();

  // ── URN patterns ────────────────────────────────────────────────────────────
  // P1: direct activity/ugcPost/share URNs (Account A / classic LinkedIn)
  const URN_GLOBAL_RE = /urn:li:(activity|ugcPost|share):(\d+)/gi;
  const URN_SINGLE_RE = /urn:li:(activity|ugcPost|share):(\d+)/i;
  // P2: fsd_update wrapper URNs (Account B / newer LinkedIn dash API)
  //   Format: urn:li:fsd_update:(urn:li:activity:1234567890123,FEED_DETAIL,...)
  //   or:     urn:li:fsd_update:urn:li:activity:1234567890123
  const FSD_GLOBAL_RE = /urn:li:fsd_update:[:(]urn:li:(activity|ugcPost|share):(\d+)/gi;
  const FSD_SINGLE_RE = /urn:li:fsd_update:[:(]urn:li:(activity|ugcPost|share):(\d+)/i;

  function urnToUrl(type, id) {
    const t = type.toLowerCase();
    if (t === 'ugcpost') return `https://www.linkedin.com/feed/update/urn:li:ugcPost:${id}/`;
    if (t === 'share')   return `https://www.linkedin.com/feed/update/urn:li:share:${id}/`;
    return `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`;
  }

  // ── Number parser — handles "1.2K", "1,247", "3M", plain ints ──────────────
  function parseCount(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return Math.floor(v);
    const s = String(v).replace(/,/g, '').trim().toUpperCase();
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1_000_000);
    return Math.floor(parseFloat(s)) || 0;
  }

  // ── Safe deep getter ─────────────────────────────────────────────────────────
  function dig(obj, ...keys) {
    for (const k of keys) { if (obj == null) return undefined; obj = obj[k]; }
    return obj;
  }

  // ── PASS 1+2: Raw text scan ──────────────────────────────────────────────────
  function rawTextScan(body) {
    const results = new Map();

    const processHit = (type, id, matchIndex) => {
      const url = urnToUrl(type, id);
      if (_globalSeen.has(url)) return;
      const start = Math.max(0, matchIndex - 400);
      const end   = Math.min(body.length, matchIndex + 800);
      const win   = body.slice(start, end);
      let likes = 0, comments = 0, reposts = 0, text = '', author = 'Unknown';
      const likesM  = win.match(/"(?:numLikes|totalReactionCount|likeCount|reactionCount)"\s*:\s*(\d+)/);
      if (likesM)  likes    = parseInt(likesM[1], 10);
      const commM   = win.match(/"(?:numComments|commentCount|totalCommentCount)"\s*:\s*(\d+)/);
      if (commM)   comments = parseInt(commM[1], 10);
      const shareM  = win.match(/"(?:numShares|repostCount|shareCount)"\s*:\s*(\d+)/);
      if (shareM)  reposts  = parseInt(shareM[1], 10);
      const textM   = win.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (textM)   text     = textM[1].replace(/\\n/g, ' ').replace(/\\u[\dA-Fa-f]{4}/g, '').substring(0, 600);
      const nameM   = win.match(/"(?:firstName|fullName|localizedName)"\s*:\s*"([^"]{1,60})"/);
      if (nameM)   author   = nameM[1];
      const existing = results.get(url);
      // Merge: keep highest likes value across multiple window hits for same URN
      if (existing) {
        existing.likes    = Math.max(existing.likes, likes);
        existing.comments = Math.max(existing.comments, comments);
        existing.reposts  = Math.max(existing.reposts, reposts);
        if (text.length > existing.text.length) existing.text = text;
      } else {
        results.set(url, { url, urn: `urn:li:${type}:${id}`, likes, comments, reposts, text, author, postedAtMs: 0, source: 'network' });
      }
    };

    // Pass 1: classic activity/ugcPost/share URNs (Account A)
    let m;
    URN_GLOBAL_RE.lastIndex = 0;
    while ((m = URN_GLOBAL_RE.exec(body)) !== null) processHit(m[1], m[2], m.index);

    // Pass 2: fsd_update wrapper URNs (Account B / newer LinkedIn dash API)
    FSD_GLOBAL_RE.lastIndex = 0;
    while ((m = FSD_GLOBAL_RE.exec(body)) !== null) processHit(m[1], m[2], m.index);

    if (results.size > 0) console.log(`[LI-Interceptor] rawTextScan: ${results.size} URNs (P1+fsd_update)`);
    return results;
  }

  // ── PASS 3: Structured JSON extraction (bonus — catches metric paths that ────
  // live at different nodes from the URN in the tree)
  function structuredScan(body, existingMap) {
    let json;
    try { json = JSON.parse(body); } catch (e) { return; }

    // LinkedIn wraps results in 'included', 'elements', 'data', or root arrays
    const pools = [];
    if (Array.isArray(json)) pools.push(...json);
    if (json && typeof json === 'object') {
      ['included', 'elements', 'data', 'results', 'hits', 'items'].forEach(k => {
        if (Array.isArray(json[k])) pools.push(...json[k]);
      });
      if (json.data && typeof json.data === 'object') {
        Object.values(json.data).forEach(v => { if (Array.isArray(v)) pools.push(...v); });
      }
    }

    for (const node of pools) {
      if (!node || typeof node !== 'object') continue;
      try {
        // Find URN in this node
        const urnRaw =
          node.updateUrn || node.entityUrn || node.dashEntityUrn ||
          node.urn || node.preDashEntityUrn ||
          // Account B fsd_update paths
          dig(node, 'updateV2', 'entityUrn') ||
          dig(node, 'updateV2', 'dashEntityUrn') ||
          dig(node, 'update', 'entityUrn') ||
          dig(node, 'entityResult', 'entityUrn') ||
          dig(node, 'socialContent', 'entityUrn') || '';

        // Try extracting from fsd_update wrapper first (Account B), then classic URN
        const urnStr = String(urnRaw);
        let mm = FSD_SINGLE_RE.exec(urnStr) || URN_SINGLE_RE.exec(urnStr);
        if (!mm) continue;
        const url = urnToUrl(mm[1], mm[2]);

        const likes = parseCount(
          dig(node, 'socialDetail', 'totalSocialActivityCounts', 'numLikes') ??
          dig(node, 'socialCounts', 'numLikes') ??
          dig(node, 'reactionSummary', 'count') ??
          dig(node, 'threadSocialActivityCounts', 'numLikes') ??
          dig(node, 'numLikes') ?? dig(node, 'likeCount') ?? 0
        );
        const comments = parseCount(
          dig(node, 'socialDetail', 'totalSocialActivityCounts', 'numComments') ??
          dig(node, 'socialCounts', 'numComments') ??
          dig(node, 'commentSummary', 'count') ??
          dig(node, 'numComments') ?? dig(node, 'commentCount') ?? 0
        );
        const reposts = parseCount(
          dig(node, 'socialDetail', 'totalSocialActivityCounts', 'numShares') ??
          dig(node, 'socialCounts', 'numShares') ??
          dig(node, 'numShares') ?? 0
        );
        const text = String(
          dig(node, 'commentary', 'text', 'text') ??
          dig(node, 'updateMetadata', 'shareCommentary', 'text') ??
          dig(node, 'content', 'article', 'title') ??
          dig(node, 'subject', 'text') ?? dig(node, 'text', 'text') ?? ''
        ).substring(0, 600);
        const author = String(
          dig(node, 'actor', 'name', 'text') ??
          dig(node, 'author', 'name', 'text') ??
          dig(node, 'miniProfile', 'firstName') ?? 'Unknown'
        ).substring(0, 80);
        const postedAtMs = parseCount(dig(node, 'createdAt') ?? dig(node, 'publishedAt') ?? 0);

        if (existingMap.has(url)) {
          // Upgrade raw-text result with structured data (usually more accurate)
          const ex = existingMap.get(url);
          ex.likes    = Math.max(ex.likes, likes);
          ex.comments = Math.max(ex.comments, comments);
          ex.reposts  = Math.max(ex.reposts, reposts);
          if (text.length > ex.text.length) ex.text = text;
          if (author !== 'Unknown') ex.author = author;
          if (postedAtMs > 0) ex.postedAtMs = postedAtMs;
        } else if (!_globalSeen.has(url)) {
          existingMap.set(url, { url, urn: String(urnRaw), likes, comments, reposts, text, author, postedAtMs, source: 'network' });
        }
      } catch (e) {}
    }
  }

  // ── Main response processor ──────────────────────────────────────────────────
  function processResponseBody(body, sourceUrl) {
    if (!body || body.length < 50) return;

    // Pass 1+2: raw text regex scan — O(n), catches every post type
    const map = rawTextScan(body);

    // Pass 3: structured JSON scan — merges/upgrades Pass 1 results
    if (body.length < 5_000_000) { // skip for absurdly large responses
      structuredScan(body, map);
    }

    if (map.size === 0) return;

    // Commit new URNs to global dedup set and send to content script
    const posts = [];
    map.forEach((post, url) => {
      if (_globalSeen.has(url)) return;
      _globalSeen.add(url);
      posts.push(post);
    });

    if (posts.length > 0) {
      window.postMessage({ type: '__LI_INTERCEPTED_POSTS__', posts, sourceUrl }, '*');
      console.log(`[LI-Interceptor] Captured ${posts.length} posts from ${sourceUrl.split('?')[0].split('/').slice(-2).join('/')}`);
    }
  }

  // ── Monkey-patch window.fetch ────────────────────────────────────────────────
  const _origFetch = window.fetch.bind(window);
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
    const prom = _origFetch(...args);
    if (shouldIntercept(url)) {
      prom.then(resp => {
        try { resp.clone().text().then(body => processResponseBody(body, url)).catch(() => {}); } catch (e) {}
      }).catch(() => {});
    }
    return prom;
  };

  // ── Monkey-patch XMLHttpRequest ──────────────────────────────────────────────
  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._interceptUrl = String(url || '');
    return _origOpen.apply(this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this._interceptUrl && shouldIntercept(this._interceptUrl)) {
      this.addEventListener('load', () => {
        try { processResponseBody(this.responseText, this._interceptUrl); } catch (e) {}
      }, { once: true });
    }
    return _origSend.apply(this, args);
  };

  console.log('[LI-Interceptor] v2 ✓ dual-pass fetch+XHR interception active on', location.href);
})();
