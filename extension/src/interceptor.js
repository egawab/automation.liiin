/**
 * Nexora Network Interceptor v2.3  — RSC FULL-METADATA FIX (SEARCH_B)
 * ─────────────────────────────────────────────────────────────────────────────
 * v2.3 SEARCH_B Output Layer Fix:
 *  - rawTextScan() window expanded: 800 chars before URN, 1500 after.
 *    RSC streams often place the URN and payload (author/text/metrics)
 *    far apart; the old ±400/800 window missed most metadata.
 *  - RSC-specific author patterns added:
 *      "title":{..."text":"<name>"} and "actorName":"<name>"
 *  - RSC-specific text patterns added:
 *      "summary":{..."text":"<content>"} / "commentary":{..."text":"..."}
 *      picks LONGEST matching "text" field (not first).
 *  - structuredScan() now resolves RSC entityResult paths:
 *      entityResult.title.text      → author
 *      entityResult.summary.text    → post text
 *      entityResult.socialProofText → reaction count fallback
 *  - All v2.2 improvements preserved (null-safe, _finalized deferral, etc.)
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NEXORA_INTERCEPTOR_ACTIVE__) return;
  window.__NEXORA_INTERCEPTOR_ACTIVE__ = true;

  const INTERCEPT_PATTERNS = [
    '/flagship-web/rsc-action/',
    'contentSearchResults',
    'searchHomeRequestAction',
    'updateSearchHistory',
    '/voyager/api/',
    '/graphql?', 'graphql?queryId',
    'feedUpdates', 'search/hits', 'searchHits', 'fsd_update',
    'numLikes', 'totalReactionCount', 'urn:li:activity',
    'aggregatedReactionCount', 'reactionCount', 'socialProofText',
  ];

  function shouldIntercept(url) {
    if (!url) return false;
    const u = String(url);
    if (!u.includes('linkedin.com') && !u.startsWith('/')) return false;
    if (u.includes('/static/') || u.endsWith('.js') || u.endsWith('.css') ||
        u.endsWith('.png') || u.endsWith('.jpg') || u.endsWith('.woff')) return false;
    return INTERCEPT_PATTERNS.some(p => u.includes(p));
  }

  // v2.2: Track URLs that have been emitted (locked) vs pending (upgradeable)
  const _finalized = new Set();

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

  // v2.2: null-safe — returns null for missing/unresolvable input (not 0)
  function parseCount(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isNaN(v) ? null : Math.floor(v);
    const s = String(v).replace(/,/g, '').trim().toUpperCase();
    if (!s) return null;
    if (s.endsWith('K')) { const n = Math.round(parseFloat(s) * 1000);   return isNaN(n) ? null : n; }
    if (s.endsWith('M')) { const n = Math.round(parseFloat(s) * 1e6);    return isNaN(n) ? null : n; }
    const n = Math.floor(parseFloat(s));
    return isNaN(n) ? null : n;
  }

  // Null-safe max: null is treated as "unknown", not zero
  function nullMax(a, b) {
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    return Math.max(a, b);
  }

  function dig(obj, ...keys) {
    for (const k of keys) { if (obj == null) return undefined; obj = obj[k]; }
    return obj;
  }

  // ── Pass 1+2: Raw text scan ────────────────────────────────────────────────
  // v2.3: window expanded + RSC-aware author/text extraction.
  function rawTextScan(body) {
    const results = new Map();

    function processHit(type, id, matchIndex) {
      const url = buildUrl(type, id);
      if (_finalized.has(url)) return;

      // v2.3: expanded window — RSC streams place URN and metadata far apart
      const start = Math.max(0, matchIndex - 800);
      const end   = Math.min(body.length, matchIndex + 1500);
      const win   = body.slice(start, end);

      let likes = null, comments = null, reposts = null;
      let text = '', author = 'Unknown';

      // ── Metrics ─────────────────────────────────────────────────────────
      const lm = win.match(/"(?:numLikes|totalReactionCount|likeCount|reactionCount|reaction_count|numReactions|totalLikeCount|aggregatedReactionCount|totalReactions)"\s*:\s*(\d+)/);
      if (lm) likes = parseInt(lm[1], 10);

      if (likes == null) {
        const lm2 = win.match(/"count"\s*:\s*(\d+)[^}]*"type"\s*:\s*"LIKE"/);
        if (lm2) likes = parseInt(lm2[1], 10);
      }
      if (likes == null) {
        const lm3 = win.match(/aggregatedTotalReactions":\s*(\d+)/);
        if (lm3) likes = parseInt(lm3[1], 10);
      }
      // socialProofText: e.g. "socialProofText":"1,247 reactions"
      if (likes == null) {
        const lm4 = win.match(/"socialProofText"\s*:\s*"([^"]*)"/);
        if (lm4) {
          const spMatch = lm4[1].match(/([\d,]+)\s*reactions?/i);
          if (spMatch) likes = parseInt(spMatch[1].replace(/,/g, ''), 10) || null;
        }
      }
      // Inline pattern: "247 reactions" anywhere in window
      if (likes == null) {
        const lm5 = win.match(/([\d,]+)\s+reactions?\b/i);
        if (lm5) { const n = parseInt(lm5[1].replace(/,/g, ''), 10); likes = isNaN(n) ? null : n; }
      }

      const cm = win.match(/"(?:numComments|commentCount|totalCommentCount|commentsCount)"\s*:\s*(\d+)/);
      if (cm) comments = parseInt(cm[1], 10);

      const sm = win.match(/"(?:numShares|repostCount|shareCount|sharesCount)"\s*:\s*(\d+)/);
      if (sm) reposts = parseInt(sm[1], 10);

      // ── Text extraction — RSC-aware, picks longest match ─────────────────
      // P1: "summary":{"textDirection":"...","text":"<post content>"}
      const summaryM = win.match(/"summary"\s*:\s*\{[^{}]*?"text"\s*:\s*"((?:[^"\\]|\\.){20,})"/);
      if (summaryM) text = summaryM[1].replace(/\\n/g, ' ').substring(0, 600);

      // P2: "commentary":{"text":"..."} or {"textDirection":"...","text":"..."}
      if (!text) {
        const commM = win.match(/"commentary"\s*:\s*\{[^{}]*?"text"\s*:\s*"((?:[^"\\]|\\.){20,})"/);
        if (commM) text = commM[1].replace(/\\n/g, ' ').substring(0, 600);
      }

      // P3: "description":{"text":"..."}
      if (!text) {
        const descM = win.match(/"description"\s*:\s*\{[^{}]*?"text"\s*:\s*"((?:[^"\\]|\\.){20,})"/);
        if (descM) text = descM[1].replace(/\\n/g, ' ').substring(0, 600);
      }

      // P4: longest bare "text":"..." (original fallback — no short values)
      if (!text) {
        const reText = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        let tm;
        while ((tm = reText.exec(win)) !== null) {
          const c = tm[1].replace(/\\n/g, ' ').substring(0, 600);
          if (c.length >= 20 && c.length > text.length) text = c;
        }
      }

      // ── Author extraction — RSC-aware ────────────────────────────────────
      // P1: RSC "title":{"textDirection":"...","text":"Author Name"}
      const rscTitle = win.match(/"title"\s*:\s*\{[^{}]*?"text"\s*:\s*"([^"]{2,80})"/);
      if (rscTitle) {
        const c = rscTitle[1].trim();
        if (!/^\d/.test(c) && !c.includes('http')) author = c;
      }
      // P2: "actorName":"Name" (RSC inline)
      if (author === 'Unknown') {
        const actorM = win.match(/"actorName"\s*:\s*"([^"]{2,80})"/);
        if (actorM) author = actorM[1].trim();
      }
      // P3: classic Voyager fields
      if (author === 'Unknown') {
        const nm = win.match(/"(?:firstName|fullName|localizedName)"\s*:\s*"([^"]{1,60})"/);
        if (nm) author = nm[1];
      }

      const existing = results.get(url);
      if (existing) {
        existing.likes    = nullMax(existing.likes, likes);
        existing.comments = nullMax(existing.comments, comments);
        existing.reposts  = nullMax(existing.reposts, reposts);
        if (text.length > (existing.text || '').length) existing.text = text;
        if (author !== 'Unknown') existing.author = author;
      } else {
        results.set(url, { url, likes, comments, reposts, text, author, source: 'network' });
        console.log(`[Nexora][RSC v2.3] URN: ${id} likes=${likes == null ? 'NULL' : likes} author="${author}" textLen=${text.length}`);
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
    try {
      const json = JSON.parse(body);
      if (Array.isArray(json)) pools.push(...json);
      if (json && typeof json === 'object') pools.push(json);
    } catch (e) {
      const lines = body.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const startIdx = line.indexOf('{') > -1 && line.indexOf('[') > -1
            ? Math.min(line.indexOf('{'), line.indexOf('['))
            : Math.max(line.indexOf('{'), line.indexOf('['));
          if (startIdx >= 0) {
            const json = JSON.parse(line.substring(startIdx));
            if (Array.isArray(json)) pools.push(...json);
            if (json && typeof json === 'object') pools.push(json);
          }
        } catch (err) {}
      }
    }
    if (pools.length === 0) return;

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
        if (_finalized.has(url)) continue;

        // v2.3: parseCount returns null for missing paths (Voyager + RSC)
        const likes = parseCount(
          dig(node, 'socialDetail', 'totalSocialActivityCounts', 'numLikes') ??
          dig(node, 'socialCounts', 'numLikes') ??
          dig(node, 'reactionSummary', 'count') ??
          dig(node, 'socialActivity', 'numLikes') ??
          dig(node, 'socialActivityCounts', 'numLikes') ??
          dig(node, 'aggregatedReactionCount') ??
          dig(node, 'totalReactions') ??
          dig(node, 'numLikes') ??
          // v2.3 RSC paths
          dig(node, 'entityResult', 'socialActivity', 'numLikes') ??
          dig(node, 'entityResult', 'socialActivity', 'totalSocialActivityCounts', 'numLikes') ?? null
        );

        // v2.3: RSC socialProofText fallback ("1,247 reactions")
        let likesFromProof = null;
        if (likes == null) {
          const spRaw = String(
            dig(node, 'socialProofText') ??
            dig(node, 'entityResult', 'socialProofText') ?? ''
          );
          const spM = spRaw.match(/([\d,]+)\s*reactions?/i);
          if (spM) likesFromProof = parseInt(spM[1].replace(/,/g, ''), 10) || null;
        }

        const comments = parseCount(
          dig(node, 'socialDetail', 'totalSocialActivityCounts', 'numComments') ??
          dig(node, 'socialCounts', 'numComments') ??
          dig(node, 'socialActivity', 'numComments') ??
          dig(node, 'numComments') ??
          dig(node, 'entityResult', 'socialActivity', 'numComments') ?? null
        );
        const reposts = parseCount(
          dig(node, 'socialDetail', 'totalSocialActivityCounts', 'numShares') ??
          dig(node, 'socialCounts', 'numShares') ??
          dig(node, 'socialActivity', 'numShares') ??
          dig(node, 'numShares') ??
          dig(node, 'entityResult', 'socialActivity', 'numShares') ?? null
        );

        // v2.3: text — Voyager paths first, then RSC entityResult paths
        const text = String(
          dig(node, 'commentary', 'text', 'text') ??
          dig(node, 'updateMetadata', 'shareCommentary', 'text') ??
          dig(node, 'content', 'article', 'title') ??
          dig(node, 'entityResult', 'summary', 'text') ??
          dig(node, 'entityResult', 'description', 'text') ??
          dig(node, 'summary', 'text') ??
          dig(node, 'description', 'text') ?? ''
        ).substring(0, 600);

        // v2.3: author — Voyager paths first, then RSC entityResult.title.text
        const author = String(
          dig(node, 'actor', 'name', 'text') ??
          dig(node, 'miniProfile', 'firstName') ??
          dig(node, 'entityResult', 'title', 'text') ??
          dig(node, 'title', 'text') ??
          dig(node, 'actorName') ?? 'Unknown'
        ).substring(0, 80);

        const postedAtMs = parseCount(dig(node, 'createdAt') ?? null);
        const resolvedLikes = nullMax(likes, likesFromProof);

        if (existingMap.has(url)) {
          const ex = existingMap.get(url);
          ex.likes    = nullMax(ex.likes, resolvedLikes);
          ex.comments = nullMax(ex.comments, comments);
          ex.reposts  = nullMax(ex.reposts, reposts);
          if (text.length > (ex.text || '').length) ex.text = text;
          if (author !== 'Unknown') ex.author = author;
          if (postedAtMs != null && postedAtMs > 0) ex.postedAtMs = postedAtMs;
        } else {
          existingMap.set(url, { url, likes: resolvedLikes, comments, reposts, text, author, postedAtMs, source: 'network' });
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
      // v2.2: emit upgrades if we now have a non-null likes for a finalized URL
      if (_finalized.has(url)) {
        if (post.likes != null && post.likes > 0) posts.push(post);
        return;
      }
      _finalized.add(url); // lock AFTER deciding to emit
      posts.push(post);
    });

    if (posts.length > 0) {
      window.__NexoraEmbeddedPosts = window.__NexoraEmbeddedPosts || [];
      window.__NexoraEmbeddedPosts.push(...posts);
      window.postMessage({ type: '__NEXORA_NETWORK_POSTS__', posts, sourceUrl }, '*');
      console.log(`[Nexora][Interceptor] ${posts.length} posts from ${sourceUrl.split('?')[0].slice(-50)}`);
    }
  }

  // ── Scan LinkedIn's embedded <code> elements (SEARCH_B pre-load) ─────────
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
    if (newFound > 0) console.log(`[Nexora][Interceptor] Scanned ${newFound} embedded <code> elements`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(scanEmbeddedData, 200));
  } else {
    setTimeout(scanEmbeddedData, 200);
  }

  const _codeObserver = new MutationObserver(() => scanEmbeddedData());
  document.addEventListener('DOMContentLoaded', () => {
    _codeObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  });

  // ── Patch fetch ────────────────────────────────────────────────────────────
  const _origFetch = window.fetch.bind(window);
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : ((args[0] || {}).url || '');
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

  console.log('[Nexora][Interceptor] v2.2 (null-safe) active on', location.href.slice(0, 60));
})();
