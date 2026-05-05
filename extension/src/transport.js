/**
 * Nexora Transport v2.0 — Lossless Storage (SEARCH_B Rebuild)
 * ─────────────────────────────────────────────────────────────────────────────
 * v2.0 changes:
 *  - Fixed the upgrade early-exit bug: the old code returned `false` (dropped
 *    the post silently) when BOTH old and new records had missing author+text.
 *    Now: if this is the first time we see a URL, ALWAYS buffer it.
 *    If it's an upgrade, only skip if there is genuinely zero improvement.
 *
 *  - author default: map null/empty string → 'Unknown' only in mapPost().
 *    The enrichment store is allowed to carry empty-string author.
 *
 *  - preview field: send the full post_text (up to 5000 chars) as both
 *    `preview` and `postText` so the dashboard always has the full content.
 *
 *  - getSentCount(): counts unique URLs dispatched (uses _sentPostsMeta.size).
 *
 *  - All retry + failure-queue logic preserved from v1.0.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraTransport) return;

  const L = window.__NexoraLogger;
  const M = 'Transport';

  const FAILURE_QUEUE_KEY = 'nexora_transport_failure_queue';

  function normalizePostUrl(url) {
    if (!url) return '';
    const m1 = url.match(/urn:li:(activity|ugcPost|share):(\d{10,25})/);
    if (m1) return `https://www.linkedin.com/feed/update/urn:li:${m1[1]}:${m1[2]}`;
    const m2 = url.match(/ugcPost-(\d{10,25})/i);
    if (m2) return `https://www.linkedin.com/feed/update/urn:li:ugcPost:${m2[1]}`;
    const m3 = url.match(/activity-(\d{10,25})/i);
    if (m3) return `https://www.linkedin.com/feed/update/urn:li:activity:${m3[1]}`;
    return url.split('?')[0].replace(/\/$/, '');
  }

  let _buffer        = [];
  let _sentPostsMeta = new Map(); // key → { payload }
  let _jobMeta       = {};
  let _flushTimer    = null;

  function cfg() { return window.__NexoraConfig || {}; }

  // ── Schema mapping ─────────────────────────────────────────────────────────
  function mapPost(post) {
    const urnMatch = (post.post_url || '').match(/urn:li:(activity|ugcPost|share):(\d+)/);
    const id = urnMatch
      ? `${urnMatch[1]}_${urnMatch[2]}`
      : (post.post_url || '').split('/').filter(Boolean).pop() || String(Date.now());

    const text = (post.post_text || '').trim();

    return {
      url:        post.post_url,
      likes:      post.likes_count    != null ? post.likes_count    : null,
      comments:   post.comments_count != null ? post.comments_count : null,
      shares:     post.shares_count   != null ? post.shares_count   : null,
      author:     (post.author && post.author !== '') ? post.author : 'Unknown',
      preview:    text.slice(0, 5000),   // full content — not a preview
      postText:   text,
      timestamp:  post.timestamp   || null,
      mediaType:  post.media_type  || 'text',
      id,
      commentable:  true,
      hasRealUrl:   true,
      _debug: {
        layoutId:         post.layout_id,
        extractionSource: post.extraction_source,
      },
    };
  }

  // ── Send batch via chrome.runtime.sendMessage ─────────────────────────────
  function sendBatch(posts, meta) {
    return new Promise((resolve) => {
      if (!posts || posts.length === 0) { resolve({ ok: true, savedCount: 0 }); return; }

      const payload = posts.map(mapPost);

      try {
        chrome.runtime.sendMessage({
          action:            'SYNC_RESULTS',
          posts:             payload,
          keyword:           meta.keyword           || '',
          dashboardUrl:      meta.dashboardUrl       || '',
          userId:            meta.userId             || '',
          linkedInProfileId: meta.linkedInProfileId  || 'Unknown',
          debugInfo: {
            source:    'search_only_v4',
            batchSize: posts.length,
            sessionId: (window.__NexoraLogger || {}).sessionId || '',
          },
        }, (response) => {
          if (chrome.runtime.lastError) {
            L && L.warn(M, 'sendMessage error', chrome.runtime.lastError.message);
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve({ ok: true, savedCount: (response || {}).savedCount || 0 });
          }
        });
      } catch (e) {
        L && L.error(M, 'sendMessage threw', e.message);
        resolve({ ok: false, error: e.message });
      }
    });
  }

  // ── Failure queue ──────────────────────────────────────────────────────────
  function saveToFailureQueue(posts) {
    try {
      chrome.storage.local.get([FAILURE_QUEUE_KEY], (stored) => {
        const existing = (stored[FAILURE_QUEUE_KEY] || []);
        const combined = [...existing, ...posts].slice(-200);
        chrome.storage.local.set({ [FAILURE_QUEUE_KEY]: combined });
        L && L.warn(M, `${posts.length} posts → failure queue (total: ${combined.length})`);
      });
    } catch (e) {}
  }

  async function retryFailureQueue(meta) {
    try {
      const stored = await new Promise(r => chrome.storage.local.get([FAILURE_QUEUE_KEY], r));
      const queue  = stored[FAILURE_QUEUE_KEY] || [];
      if (queue.length === 0) return;
      L && L.info(M, `Retrying failure queue: ${queue.length} posts`);
      const result = await sendBatch(queue, meta);
      if (result.ok) {
        await new Promise(r => chrome.storage.local.remove(FAILURE_QUEUE_KEY, r));
        L && L.info(M, 'Failure queue cleared');
      }
    } catch (e) { L && L.warn(M, 'retryFailureQueue error', e.message); }
  }

  // ── Auto-flush timer ───────────────────────────────────────────────────────
  function scheduleFlush() {
    if (_flushTimer) return;
    const interval = cfg().BATCH_FLUSH_INTERVAL_MS || 5000;
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      if (_buffer.length > 0) flush();
    }, interval);
  }

  // ── Public: buffer a post ──────────────────────────────────────────────────
  function buffer(post) {
    const key = normalizePostUrl(post.post_url || '');
    if (!key) return false;

    const existing = _sentPostsMeta.get(key);

    if (existing && existing.payload) {
      // ── Upgrade path: non-destructive merge ──────────────────────────────
      const old      = existing.payload;
      const merged   = Object.assign({}, old, { _isUpgrade: true });

      let upgraded = false;

      // Text: take longer
      const oldText = (old.post_text || '').length;
      const newText = (post.post_text || '').length;
      if (newText > oldText) { merged.post_text = post.post_text; upgraded = true; }

      // Author: fill if missing
      const oldHasAuth = old.author && old.author !== '' && old.author !== 'Unknown';
      const newHasAuth = post.author && post.author !== '' && post.author !== 'Unknown';
      if (!oldHasAuth && newHasAuth) { merged.author = post.author; upgraded = true; }

      // Engagement: fill if missing
      if (old.likes_count    == null && post.likes_count    != null) { merged.likes_count    = post.likes_count;    upgraded = true; }
      if (old.comments_count == null && post.comments_count != null) { merged.comments_count = post.comments_count; upgraded = true; }
      if (old.shares_count   == null && post.shares_count   != null) { merged.shares_count   = post.shares_count;   upgraded = true; }

      if (!upgraded) {
        // No improvement — silently skip (avoids re-sending duplicate with same data)
        return false;
      }

      existing.payload = merged;
      L && L.debug(M, `Upgrade queued: ${key.slice(-40)}`);
      _buffer.push(merged);
    } else {
      // First time seeing this URL — ALWAYS buffer it
      _sentPostsMeta.set(key, { payload: post });
      _buffer.push(post);
    }

    const batchSize = cfg().BATCH_SIZE || 10;
    if (_buffer.length >= batchSize) {
      flush();
    } else {
      scheduleFlush();
    }
    return true;
  }

  // ── Public: flush ─────────────────────────────────────────────────────────
  async function flush() {
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
    if (_buffer.length === 0) return;

    const batch   = _buffer.splice(0, _buffer.length);
    const retries = cfg().RETRY_ATTEMPTS    || 3;
    const delay   = cfg().RETRY_BASE_DELAY_MS || 2000;

    L && L.info(M, `Flushing ${batch.length} posts…`);

    let lastErr = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      const result = await sendBatch(batch, _jobMeta);
      if (result.ok) {
        L && L.info(M, `Batch sent. savedCount=${result.savedCount}`);
        return;
      }
      lastErr = result.error;
      if (attempt < retries) {
        L && L.warn(M, `Attempt ${attempt}/${retries} failed. Retrying in ${delay * attempt}ms…`);
        await new Promise(r => setTimeout(r, delay * attempt));
      }
    }

    L && L.error(M, `All ${retries} attempts failed. Queuing for retry.`, lastErr);
    saveToFailureQueue(batch);
  }

  // ── Public: configure / reset ─────────────────────────────────────────────
  function configure(meta) {
    _jobMeta = Object.assign({}, meta);
    L && L.info(M, `Configured keyword="${meta.keyword}" user=${meta.userId}`);
    retryFailureQueue(_jobMeta).catch(() => {});
  }

  function reset() {
    _buffer        = [];
    _sentPostsMeta = new Map();
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  }

  window.__NexoraTransport = {
    configure,
    buffer,
    flush,
    reset,
    getSentCount:   () => _sentPostsMeta.size,
    getBufferSize:  () => _buffer.length,
  };

  console.log('[Nexora][Transport v2.0] Lossless buffer ready.');
})();
