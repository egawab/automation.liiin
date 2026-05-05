/**
 * Nexora Filter v4.0 — URL-Only Pipeline Gate (SEARCH_B Rebuild)
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.0 Architecture Change:
 *
 *  The v3.0 filter required author + timestamp + text (≥20 chars) INSIDE the
 *  scraping pipeline. This was the #1 cause of data loss: posts were rejected
 *  BEFORE network hydration had a chance to fill those fields.
 *
 *  v4.0 Rule: A post is valid if and only if it has a non-empty post_url.
 *  Everything else (author, text, engagement) is stored as-is — even if null.
 *
 *  UI-level filtering (likes >= 10, author != Unknown, etc.) lives ONLY in
 *  the SavedPostsPanel component, as required by the architecture spec.
 *
 *  The batch helpers and deduplication utilities are preserved unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraFilter) return;

  const L = window.__NexoraLogger;
  const M = 'Filter';

  // ── Pipeline Gate: URL presence only ─────────────────────────────────────
  function qualifies(post) {
    if (!post) {
      L && L.debug(M, 'REJECTED: null post object');
      return { pass: false, reason: 'null_post' };
    }

    const url = (post.post_url || '').trim();
    if (!url) {
      L && L.debug(M, 'REJECTED: Missing or empty post_url');
      return { pass: false, reason: 'no_url' };
    }

    // Must look like a real LinkedIn post URL (not synthetic/discovered prefixes)
    if (url.startsWith('discovered:') || url.startsWith('synthetic:') || url.startsWith('_nosurl_')) {
      L && L.debug(M, `REJECTED: Non-real URL prefix: ${url.slice(0, 40)}`);
      return { pass: false, reason: 'synthetic_url' };
    }

    // PASS — store unconditionally. All other fields (author, text, likes) may be null.
    return { pass: true, reason: 'url_present' };
  }

  // ── Batch filter ──────────────────────────────────────────────────────────
  function applyBatch(posts) {
    const passed   = [];
    const rejected = [];
    for (const post of posts) {
      const result = qualifies(post);
      if (result.pass) {
        passed.push(post);
      } else {
        rejected.push({ post, reason: result.reason });
      }
    }
    L && L.info(M, `Batch: ${passed.length} passed / ${rejected.length} rejected`);
    return { passed, rejected };
  }

  // ── URL deduplication ──────────────────────────────────────────────────────
  function deduplicateByUrl(posts, seenUrlSet) {
    const unique = [];
    for (const post of posts) {
      const key = (post.post_url || '').split('?')[0].replace(/\/$/, '');
      if (!key || seenUrlSet.has(key)) continue;
      seenUrlSet.add(key);
      unique.push(post);
    }
    return unique;
  }

  window.__NexoraFilter = { qualifies, applyBatch, deduplicateByUrl };

  console.log('[Nexora][Filter v4.0] URL-only pipeline gate ready.');
})();
