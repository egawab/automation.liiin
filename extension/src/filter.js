/**
 * Nexora Filter v1.2  — STRICT NUMERIC FILTER
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure business logic. No DOM access. No side effects.
 *
 * Rule: pass = (likes_count != null) AND (likes_count >= LIKE_THRESHOLD)
 *
 * No exceptions. No fallbacks. No sniper passthrough. No unknown handling.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraFilter) return;

  const L = window.__NexoraLogger;
  const M = 'Filter';

  // ── Qualification logic ────────────────────────────────────────────────────
  function qualifies(post, config) {
    const threshold = (config && config.LIKE_THRESHOLD != null)
      ? Number(config.LIKE_THRESHOLD)
      : 10;

    // Must have a valid URL
    if (!post.post_url) {
      L && L.debug(M, `SKIP no_url: "${(post.post_text || '').slice(0, 40)}"`);
      return { pass: false, reason: 'no_url' };
    }

    // Null likes → REJECT (unknown engagement is not enough)
    if (post.likes_count == null) {
      L && L.debug(M, `SKIP null_likes: ${post.post_url}`);
      return { pass: false, reason: 'null_likes' };
    }

    // Below threshold → REJECT
    if (post.likes_count < threshold) {
      L && L.debug(M, `SKIP below_threshold: likes=${post.likes_count} < ${threshold} → ${post.post_url}`);
      return { pass: false, reason: `below_threshold(${post.likes_count}<${threshold})` };
    }

    // PASS
    L && L.debug(M, `PASS: likes=${post.likes_count} >= ${threshold} → ${post.post_url}`);
    return { pass: true, reason: 'qualified' };
  }

  // ── Batch filter — returns { passed, rejected } ────────────────────────────
  function applyBatch(posts, config) {
    const passed   = [];
    const rejected = [];
    for (const post of posts) {
      const result = qualifies(post, config);
      if (result.pass) { passed.push(post); } else { rejected.push({ post, reason: result.reason }); }
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

  window.__NexoraFilter = { qualifies, applyBatch, deduplicateByUrl };

})();
