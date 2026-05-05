/**
 * Nexora Network Interceptor v3.0 — FULL-BODY SCAN (SEARCH_B Rebuild)
 * ─────────────────────────────────────────────────────────────────────────────
 * v3.0 Architecture:
 *  - FULL-BODY scan replaces windowed ±800/1500 char scan.
 *    RSC streams place URN and metadata in separate chunks; a local window
 *    around each URN miss cross-chunk metadata entirely. Full-body scan
 *    builds a complete URN→metadata map from the entire response body.
 *
 *  - Two-pass design per response body:
 *      Pass A: Extract ALL metric/text/author key→value pairs globally.
 *      Pass B: Find ALL URNs; map each URN to the global metadata.
 *
 *  - Removed _finalized Set. That gate blocked legitimate data upgrades.
 *    Deduplication is handled by the engine's enrichment store.
 *
 *  - Scans <code> elements (SEARCH_B pre-load data) via MutationObserver.
 *
 *  - Patches both fetch and XHR in MAIN world.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NEXORA_INTERCEPTOR_V3__) return;
  window.__NEXORA_INTERCEPTOR_V3__ = true;

  // ── URL filter ─────────────────────────────────────────────────────────────
  const INTERCEPT_PATTERNS = [
    '/flagship-web/rsc-action/',
    'contentSearchResults',
    'searchHomeRequestAction',
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
        u.endsWith('.png') || u.endsWith('.jpg') || u.endsWith('.woff2') ||
        u.endsWith('.woff')) return false;
    return INTERCEPT_PATTERNS.some(p => u.includes(p));
  }

  // ── URN patterns ───────────────────────────────────────────────────────────
  const URN_RE_GLOBAL  = /urn:li:(activity|ugcPost|share):(\d{10,25})/gi;
  const FSD_RE_GLOBAL  = /urn:li:fsd_(?:update|entityResult)[:(]urn:li:(activity|ugcPost|share):(\d{10,25})/gi;

  function buildUrl(type, id) {
    const t = (type || '').toLowerCase();
    if (t === 'ugcpost') return `https://www.linkedin.com/feed/update/urn:li:ugcPost:${id}`;
    if (t === 'share')   return `https://www.linkedin.com/feed/update/urn:li:share:${id}`;
    return `https://www.linkedin.com/feed/update/urn:li:activity:${id}`;
  }

  function parseCount(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isNaN(v) ? null : Math.floor(v);
    const s = String(v).replace(/,/g, '').trim().toUpperCase();
    if (!s) return null;
    if (s.endsWith('K')) { const n = Math.round(parseFloat(s) * 1000); return isNaN(n) ? null : n; }
    if (s.endsWith('M')) { const n = Math.round(parseFloat(s) * 1e6);  return isNaN(n) ? null : n; }
    const n = Math.floor(parseFloat(s));
    return isNaN(n) ? null : n;
  }

  function nullMax(a, b) {
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    return Math.max(a, b);
  }

  // ── PASS A: Extract global metadata from entire body ─────────────────────
  // Scans the FULL body for all key→value pairs once, building a metadata
  // object. This is O(n) on body length and avoids the cross-chunk miss.
  function extractGlobalMeta(body) {
    const meta = {
      likes:    null,
      comments: null,
      reposts:  null,
      texts:    [],       // all text candidates — we pick longest
      authors:  [],       // all author candidates
    };

    // ── Engagement metrics ───────────────────────────────────────────────
    // Likes: try many known key names, take the MAX found
    const likeKeys = [
      'numLikes','totalReactionCount','likeCount','reactionCount',
      'reaction_count','numReactions','totalLikeCount',
      'aggregatedReactionCount','totalReactions','aggregatedTotalReactions',
    ];
    for (const k of likeKeys) {
      const re = new RegExp(`"${k}"\\s*:\\s*(\\d+)`, 'g');
      let m;
      while ((m = re.exec(body)) !== null) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) meta.likes = meta.likes == null ? n : Math.max(meta.likes, n);
      }
    }

    // socialProofText fallback ("1,247 reactions")
    if (meta.likes == null) {
      const spRe = /"socialProofText"\s*:\s*"([^"]*)"/g;
      let m;
      while ((m = spRe.exec(body)) !== null) {
        const cnt = m[1].match(/([\d,]+)\s*reactions?/i);
        if (cnt) {
          const n = parseInt(cnt[1].replace(/,/g, ''), 10);
          if (!isNaN(n)) meta.likes = meta.likes == null ? n : Math.max(meta.likes, n);
        }
      }
    }

    // Inline "N reactions" text anywhere in body
    if (meta.likes == null) {
      const inlineRe = /([\d,]+)\s+reactions?\b/gi;
      let m;
      while ((m = inlineRe.exec(body)) !== null) {
        const n = parseInt(m[1].replace(/,/g, ''), 10);
        if (!isNaN(n) && n > 0) meta.likes = meta.likes == null ? n : Math.max(meta.likes, n);
      }
    }

    // Comments
    const commentKeys = ['numComments','commentCount','totalCommentCount','commentsCount','totalSocialCommentCount'];
    for (const k of commentKeys) {
      const re = new RegExp(`"${k}"\\s*:\\s*(\\d+)`, 'g');
      let m;
      while ((m = re.exec(body)) !== null) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) meta.comments = meta.comments == null ? n : Math.max(meta.comments, n);
      }
    }

    // Reposts/shares
    const shareKeys = ['numShares','repostCount','shareCount','sharesCount'];
    for (const k of shareKeys) {
      const re = new RegExp(`"${k}"\\s*:\\s*(\\d+)`, 'g');
      let m;
      while ((m = re.exec(body)) !== null) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) meta.reposts = meta.reposts == null ? n : Math.max(meta.reposts, n);
      }
    }

    // ── Text extraction ───────────────────────────────────────────────────
    // Priority 1: "summary":{"text":"..."} — RSC SEARCH_B post content
    {
      const re = /"summary"\s*:\s*\{[^{}]*?"text"\s*:\s*"((?:[^"\\]|\\.){20,})"/g;
      let m;
      while ((m = re.exec(body)) !== null) {
        meta.texts.push(m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"'));
      }
    }
    // Priority 2: "commentary":{"text":"..."}
    {
      const re = /"commentary"\s*:\s*\{[^{}]*?"text"\s*:\s*"((?:[^"\\]|\\.){20,})"/g;
      let m;
      while ((m = re.exec(body)) !== null) {
        meta.texts.push(m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"'));
      }
    }
    // Priority 3: "description":{"text":"..."}
    {
      const re = /"description"\s*:\s*\{[^{}]*?"text"\s*:\s*"((?:[^"\\]|\\.){20,})"/g;
      let m;
      while ((m = re.exec(body)) !== null) {
        meta.texts.push(m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"'));
      }
    }
    // Priority 4: bare "text":"..." (catch-all)
    {
      const re = /"text"\s*:\s*"((?:[^"\\]|\\.){20,})"/g;
      let m;
      while ((m = re.exec(body)) !== null) {
        const t = m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"');
        if (t.length >= 20 && t.length < 5000) meta.texts.push(t);
      }
    }

    // ── Author extraction ────────────────────────────────────────────────
    // P1: RSC "title":{"text":"Name"} — SEARCH_B entityResult
    {
      const re = /"title"\s*:\s*\{[^{}]*?"text"\s*:\s*"([^"]{2,80})"/g;
      let m;
      while ((m = re.exec(body)) !== null) {
        const c = m[1].trim();
        if (!/^\d/.test(c) && !c.includes('http') && !c.includes('linkedin')) {
          meta.authors.push(c);
        }
      }
    }
    // P2: "actorName":"Name"
    {
      const re = /"actorName"\s*:\s*"([^"]{2,80})"/g;
      let m;
      while ((m = re.exec(body)) !== null) meta.authors.push(m[1].trim());
    }
    // P3: Voyager "firstName"/"fullName"/"localizedName"
    {
      const re = /"(?:firstName|fullName|localizedName)"\s*:\s*"([^"]{1,60})"/g;
      let m;
      while ((m = re.exec(body)) !== null) meta.authors.push(m[1].trim());
    }
    // P4: "name":{"text":"Name"} (actor.name.text)
    {
      const re = /"name"\s*:\s*\{[^{}]*?"text"\s*:\s*"([^"]{2,80})"/g;
      let m;
      while ((m = re.exec(body)) !== null) {
        const c = m[1].trim();
        if (!/^\d/.test(c) && !c.includes('http')) meta.authors.push(c);
      }
    }

    return meta;
  }

  // ── PASS B: Find all URNs, assign global metadata ───────────────────────
  function processBody(body, sourceUrl) {
    if (!body || body.length < 50) return;

    // Extract global metadata once from full body
    const meta = extractGlobalMeta(body);

    // Pick best text (longest)
    const bestText = meta.texts.reduce((best, t) => t.length > best.length ? t : best, '');
    // Pick best author (first non-empty, non-numeric)
    const bestAuthor = meta.authors.find(a => a && a.length > 1 && !/^\d/.test(a)) || 'Unknown';

    // Collect all unique URN IDs from body
    const seen = new Set();
    const posts = [];

    function processMatch(type, id) {
      const url = buildUrl(type, id);
      if (seen.has(url)) return;
      seen.add(url);

      const post = {
        url,
        likes:    meta.likes,
        comments: meta.comments,
        reposts:  meta.reposts,
        text:     bestText.substring(0, 5000),
        author:   bestAuthor,
        source:   'network',
      };

      posts.push(post);
      console.log(`[Nexora][Interceptor v3.0] URN: ${id} likes=${meta.likes == null ? 'null' : meta.likes} author="${bestAuthor}" textLen=${bestText.length}`);
    }

    URN_RE_GLOBAL.lastIndex = 0;
    FSD_RE_GLOBAL.lastIndex = 0;

    let m;
    while ((m = URN_RE_GLOBAL.exec(body)) !== null) processMatch(m[1], m[2]);
    while ((m = FSD_RE_GLOBAL.exec(body)) !== null) processMatch(m[1], m[2]);

    if (posts.length === 0) return;

    // Publish to window global (for engine's network listener)
    window.__NexoraEmbeddedPosts = window.__NexoraEmbeddedPosts || [];
    window.__NexoraEmbeddedPosts.push(...posts);
    window.postMessage({ type: '__NEXORA_NETWORK_POSTS__', posts, sourceUrl }, '*');
    console.log(`[Nexora][Interceptor v3.0] ${posts.length} posts from ${(sourceUrl || '').split('?')[0].slice(-60)}`);
  }

  // ── Scan <code> elements (SEARCH_B pre-load) ─────────────────────────────
  const _scannedCodes = new WeakSet();

  function scanEmbeddedData() {
    let found = 0;
    document.querySelectorAll('code').forEach(el => {
      if (_scannedCodes.has(el)) return;
      _scannedCodes.add(el);
      try {
        const text = el.textContent || '';
        if (text.length > 80 && text.includes('urn:li:')) {
          processBody(text, 'bpr:' + (el.id || 'inline'));
          found++;
        }
      } catch (e) {}
    });
    if (found > 0) console.log(`[Nexora][Interceptor v3.0] Scanned ${found} <code> elements`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(scanEmbeddedData, 200));
  } else {
    setTimeout(scanEmbeddedData, 200);
  }

  // Watch for dynamically injected <code> blocks
  const _codeObserver = new MutationObserver(() => scanEmbeddedData());
  if (document.body) {
    _codeObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      _codeObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    });
  }

  // ── Patch fetch ────────────────────────────────────────────────────────────
  const _origFetch = window.fetch.bind(window);
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : ((args[0] || {}).url || '');
    const prom = _origFetch(...args);
    if (shouldIntercept(url)) {
      prom.then(resp => {
        try {
          resp.clone().text().then(b => {
            if (b && b.length > 50) processBody(b, url);
          }).catch(() => {});
        } catch (e) {}
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
        try {
          if (this.responseText && this.responseText.length > 50) {
            processBody(this.responseText, this._nexoraUrl);
          }
        } catch (e) {}
      }, { once: true });
    }
    return _origSend.apply(this, args);
  };

  console.log('[Nexora][Interceptor v3.0] FULL-BODY SCAN active on', location.href.slice(0, 80));
})();
