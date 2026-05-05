/**
 * Nexora Filter v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure business logic. No DOM access. No side effects.
 * Applies qualification rules to extracted post objects.
 *
 * Primary rule: likes_count >= LIKE_THRESHOLD (default 10)
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraFilter) return;

  const L = window.__NexoraLogger;
  const M = 'Filter';

  // ── Qualification logic ────────────────────────────────────────────────────
  function qualifies(post, config) {
    const threshold          = (config && config.LIKE_THRESHOLD) || 10;
    const includeUnknown     = (config && config.INCLUDE_UNKNOWN_LIKES) || false;

    // Must have a valid URL
    if (!post.post_url) {
      L && L.debug(M, `SKIP no_url: "${(post.post_text || '').slice(0, 40)}"`);
      return { pass: false, reason: 'no_url' };
    }

    // Likes unknown
    if (post.likes_count === 0 && !includeUnknown) {
      // If the extraction source is 'merged' or we have a non-zero comments count,
      // treat 0 likes as genuinely 0 rather than extraction failure.
      // Otherwise, it might be a rendering gap — skip conservatively.
      if (post.extraction_source !== 'merged' && post.comments_count === 0) {
        L && L.debug(M, `SKIP unknown_likes: ${post.post_url}`);
        return { pass: false, reason: 'unknown_likes' };
      }
    }

    // Primary filter: likes >= threshold
    if (post.likes_count < threshold) {
      L && L.debug(M, `SKIP below_threshold: likes=${post.likes_count} < ${threshold} → ${post.post_url}`);
      return { pass: false, reason: `below_threshold(${post.likes_count}<${threshold})` };
    }

    L && L.debug(M, `PASS: likes=${post.likes_count} ≥ ${threshold} → ${post.post_url}`);
    return { pass: true, reason: 'qualified' };
  }

  // ── Batch filter — returns { passed, rejected } ────────────────────────────
  function applyBatch(posts, config) {
    const passed   = [];
    const rejected = [];

    for (const post of posts) {
      const result = qualifies(post, config);
      if (result.pass) {
        passed.push(post);
      } else {
        rejected.push({ post, reason: result.reason });
      }
    }

    L && L.info(M, `Batch: ${passed.length} passed / ${rejected.length} rejected (threshold=${(config || {}).LIKE_THRESHOLD || 10})`);
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

  // ── Public API ─────────────────────────────────────────────────────────────
  window.__NexoraFilter = {
    qualifies,
    applyBatch,
    deduplicateByUrl,
  };

})();
