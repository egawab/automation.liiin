/**
 * interceptor.js — LinkedIn Network Interception Layer
 * Runs in the page's MAIN world (injected via <script> tag from content.js).
 * Monkey-patches window.fetch and XMLHttpRequest to intercept LinkedIn's
 * Voyager/GraphQL API responses and extract post data without any DOM parsing.
 *
 * Sends clean post objects to content.js via window.postMessage.
 */
(function () {
  'use strict';

  if (window.__LI_INTERCEPTOR_ACTIVE__) return; // Prevent double-injection
  window.__LI_INTERCEPTOR_ACTIVE__ = true;

  // ── URL filter: only intercept LinkedIn's feed/search/graphql API calls ────
  const INTERCEPT_PATTERNS = [
    '/voyager/api/feed',
    '/voyager/api/search',
    '/voyager/api/graphql',
    '/graphql?',
    'graphql?queryId',
    'com.linkedin.voyager.feed',
    'feedUpdates',
    'search/hits',
  ];

  function shouldIntercept(url) {
    if (!url) return false;
    const u = String(url);
    return INTERCEPT_PATTERNS.some(p => u.includes(p));
  }

  // ── URN → canonical URL builder ────────────────────────────────────────────
  const URN_RE = /urn:li:(activity|ugcPost|share):([\w:_-]+)/i;
  function urnToUrl(urn) {
    const m = String(urn || '').match(URN_RE);
    if (!m) return null;
    const type = m[1]; const id = m[2];
    if (type.toLowerCase() === 'ugcpost') return `https://www.linkedin.com/feed/update/urn:li:ugcPost:${id}/`;
    if (type.toLowerCase() === 'share')   return `https://www.linkedin.com/feed/update/urn:li:share:${id}/`;
    return `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`;
  }

  // ── Safe deep value getter ─────────────────────────────────────────────────
  function dig(obj, ...keys) {
    for (const key of keys) {
      if (obj == null) return undefined;
      obj = obj[key];
    }
    return obj;
  }

  // ── Parse a number that could be "1.2K", "1,247", "3M", or just a number ─
  function parseCount(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return Math.floor(v);
    const s = String(v).replace(/,/g, '').trim().toUpperCase();
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
    return Math.floor(parseFloat(s)) || 0;
  }

  // ── Extract a single post object from any JSON node that carries a URN ────
  function extractPost(node) {
    if (!node || typeof node !== 'object') return null;

    // Find the URN — try every known field name LinkedIn has ever used
    const urnRaw =
      node.updateUrn || node.entityUrn || node.dashEntityUrn ||
      node.urn || node.id ||
      dig(node, 'update', 'entityUrn') ||
      dig(node, 'entityResult', 'entityUrn') ||
      dig(node, 'preDashEntityUrn') ||
      '';

    if (!URN_RE.test(String(urnRaw))) return null;
    const url = urnToUrl(urnRaw);
    if (!url) return null;

    // ── Likes / reactions ──────────────────────────────────────────────────
    const likes = parseCount(
      dig(node, 'socialDetail', 'totalSocialActivityCounts', 'numLikes') ??
      dig(node, 'socialCounts', 'numLikes') ??
      dig(node, 'reactionSummary', 'count') ??
      dig(node, 'numLikes') ??
      dig(node, 'likeCount') ??
      dig(node, 'totalReactionCount') ??
      dig(node, 'threadSocialActivityCounts', 'numLikes') ??
      0
    );

    // ── Comments ───────────────────────────────────────────────────────────
    const comments = parseCount(
      dig(node, 'socialDetail', 'totalSocialActivityCounts', 'numComments') ??
      dig(node, 'socialCounts', 'numComments') ??
      dig(node, 'commentSummary', 'count') ??
      dig(node, 'numComments') ??
      dig(node, 'commentCount') ??
      dig(node, 'threadSocialActivityCounts', 'numComments') ??
      0
    );

    // ── Reposts ────────────────────────────────────────────────────────────
    const reposts = parseCount(
      dig(node, 'socialDetail', 'totalSocialActivityCounts', 'numShares') ??
      dig(node, 'socialCounts', 'numShares') ??
      dig(node, 'numShares') ??
      0
    );

    // ── Post text ──────────────────────────────────────────────────────────
    const text = String(
      dig(node, 'commentary', 'text', 'text') ??
      dig(node, 'updateMetadata', 'shareCommentary', 'text') ??
      dig(node, 'content', 'article', 'title') ??
      dig(node, 'subject', 'text') ??
      dig(node, 'postBody', 'text') ??
      dig(node, 'text', 'text') ??
      dig(node, 'content', 'description', 'text') ??
      dig(node, 'title', 'text') ??
      ''
    ).substring(0, 600);

    // ── Author ─────────────────────────────────────────────────────────────
    const author = String(
      dig(node, 'actor', 'name', 'text') ??
      dig(node, 'author', 'name', 'text') ??
      dig(node, 'actor', 'description', 'text') ??
      dig(node, 'miniProfile', 'firstName') ??
      'Unknown'
    ).substring(0, 80);

    // ── Timestamp ──────────────────────────────────────────────────────────
    const postedAtMs = parseCount(
      dig(node, 'actor', 'subDescription', 'accessibilityText') ??
      dig(node, 'createdAt') ??
      dig(node, 'publishedAt') ??
      0
    );

    return { url, urn: String(urnRaw), likes, comments, reposts, text, author, postedAtMs, source: 'network' };
  }

  // ── Walk the entire parsed JSON tree and collect all post-like nodes ───────
  // LinkedIn responses nest post data at many different depths and under many
  // different key names. We walk the entire tree rather than hardcoding paths.
  const _seen = new Set(); // Deduplicate within this response

  function walkAndCollect(obj, depth, results) {
    if (!obj || typeof obj !== 'object' || depth > 20) return;
    if (Array.isArray(obj)) {
      for (const item of obj) walkAndCollect(item, depth + 1, results);
      return;
    }
    // Try to extract a post from this node
    const post = extractPost(obj);
    if (post && !_seen.has(post.url)) {
      _seen.add(post.url);
      results.push(post);
    }
    // Recurse into children
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === 'object') walkAndCollect(val, depth + 1, results);
    }
  }

  function processResponseBody(body, sourceUrl) {
    let json;
    try { json = JSON.parse(body); } catch (e) { return; }
    _seen.clear();
    const results = [];
    walkAndCollect(json, 0, results);
    if (results.length > 0) {
      window.postMessage({ type: '__LI_INTERCEPTED_POSTS__', posts: results, sourceUrl }, '*');
      console.log(`[LI-Interceptor] Captured ${results.length} posts from ${sourceUrl.split('?')[0]}`);
    }
  }

  // ── Monkey-patch window.fetch ──────────────────────────────────────────────
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

  // ── Monkey-patch XMLHttpRequest ────────────────────────────────────────────
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

  console.log('[LI-Interceptor] ✓ fetch + XHR interception active on', location.href);
})();
