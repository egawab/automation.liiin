/**
 * Nexora Filter v2.0  — PASS ALL (SEARCH_B Brute-Force Mode)
 * ─────────────────────────────────────────────────────────────────────────────
 * No filtering. Every post with a URL passes. No likes threshold.
 * No null-likes rejection. No below-threshold rejection.
 *
 * Rationale: SEARCH_B DOM cards rarely have likes in the DOM. Filtering by
 * likes causes nearly 100% rejection rate and 0 saved posts. The user wants
 * ALL posts collected — filtering is the dashboard's responsibility, not the
 * scraper's.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraFilter) return;

  const L = window.__NexoraLogger;
  const M = 'Filter';

  // ── Qualification logic — PASS EVERYTHING with a URL ─────────────────────
  function qualifies(post) {
    if (!post.post_url) {
      L && L.debug(M, `SKIP no_url: "${(post.post_text || '').slice(0, 40)}"`);
      return { pass: false, reason: 'no_url' };
    }
    // PASS — no engagement threshold, no null rejection
    L && L.debug(M, `PASS: ${post.post_url} (likes=${post.likes_count})`);
    return { pass: true, reason: 'has_url' };
  }

  // ── Batch filter ──────────────────────────────────────────────────────────
  function applyBatch(posts) {
    const passed   = [];
    const rejected = [];
    for (const post of posts) {
      const result = qualifies(post);
      if (result.pass) { passed.push(post); } else { rejected.push({ post, reason: result.reason }); }
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

})();
