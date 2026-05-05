/**
 * Nexora Transport v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends qualified posts to background.js (which relays to the API).
 * Content scripts cannot make cross-origin requests directly.
 *
 * Features:
 *  - Buffering: accumulates posts until BATCH_SIZE or manual flush
 *  - Retry: up to RETRY_ATTEMPTS with exponential backoff (via background)
 *  - Failure queue: posts that fail all retries go to chrome.storage.local
 *  - Dedup: tracks sent URLs in-session to prevent double-sends
 *
 * Maps internal schema → background.js SYNC_RESULTS payload.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraTransport) return;

  const L = window.__NexoraLogger;
  const M = 'Transport';

  const FAILURE_QUEUE_KEY = 'nexora_transport_failure_queue';

  let _buffer     = [];     // pending posts not yet sent
  let _sentPostsMeta = new Map(); // in-session dedup with quality tracking
  let _jobMeta    = {};     // { keyword, dashboardUrl, userId, linkedInProfileId }
  let _flushTimer = null;

  function cfg() { return window.__NexoraConfig || {}; }

  // ── Schema mapping (internal → background.js SYNC_RESULTS payload) ─────────
  function mapPost(post) {
    const urnMatch = (post.post_url || '').match(/urn:li:(activity|ugcPost|share):(\d+)/);
    const id = urnMatch
      ? `${urnMatch[1]}_${urnMatch[2]}`
      : (post.post_url || '').split('/').filter(Boolean).pop() || String(Date.now());

    return {
      url:               post.post_url,
      likes:             post.likes_count    != null ? post.likes_count    : null,
      comments:          post.comments_count != null ? post.comments_count : null,
      shares:            post.shares_count   != null ? post.shares_count   : null,
      author:            post.author         || 'Unknown',
      preview:           (post.post_text || '').slice(0, 5000), // Dashboard expects full text here
      postText:          post.post_text      || '',
      timestamp:         post.timestamp      || null,
      mediaType:         post.media_type     || 'text',
      id,
      commentable:       true,
      hasRealUrl:        true,
      _debug: {
        layoutId:         post.layout_id,
        extractionSource: post.extraction_source,
      },
    };
  }

  // ── Send a batch via chrome.runtime.sendMessage ────────────────────────────
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
            source:       'search_only_v2',
            batchSize:    posts.length,
            sessionId:    (window.__NexoraLogger || {}).sessionId || '',
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

  // ── Save failed posts to chrome.storage.local for next-session retry ────────
  function saveToFailureQueue(posts) {
    try {
      chrome.storage.local.get([FAILURE_QUEUE_KEY], (stored) => {
        const existing = (stored[FAILURE_QUEUE_KEY] || []);
        const combined = [...existing, ...posts].slice(-200); // cap at 200
        chrome.storage.local.set({ [FAILURE_QUEUE_KEY]: combined });
        L && L.warn(M, `${posts.length} posts → failure queue (total: ${combined.length})`);
      });
    } catch (e) {}
  }

  // ── Drain and retry the failure queue ─────────────────────────────────────
  async function retryFailureQueue(meta) {
    try {
      const stored = await new Promise(r => chrome.storage.local.get([FAILURE_QUEUE_KEY], r));
      const queue = stored[FAILURE_QUEUE_KEY] || [];
      if (queue.length === 0) return;
      L && L.info(M, `Retrying failure queue: ${queue.length} posts`);
      const result = await sendBatch(queue, meta);
      if (result.ok) {
        await new Promise(r => chrome.storage.local.remove(FAILURE_QUEUE_KEY, r));
        L && L.info(M, `Failure queue cleared after successful retry`);
      }
    } catch (e) { L && L.warn(M, 'retryFailureQueue error', e.message); }
  }

  // ── Schedule auto-flush ────────────────────────────────────────────────────
  function scheduleFlush() {
    if (_flushTimer) return;
    const interval = cfg().BATCH_FLUSH_INTERVAL_MS || 5000;
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      if (_buffer.length > 0) flush();
    }, interval);
  }

  // ── Public: buffer a post ─────────────────────────────────────────────────
  function buffer(post) {
    // Posts without a URL get a synthetic dedup key so they are not silently dropped.
    // The dashboard receives them and can filter/display as appropriate.
    let key = (post.post_url || '').split('?')[0].replace(/\/$/, '');
    if (!key) key = `_nosurl_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    const hasEngagement = post.likes_count != null || post.comments_count != null;
    const hasText = post.post_text && post.post_text.length > 20;

    const existing = _sentPostsMeta.get(key);
    if (existing) {
       // Only allow sending again if this is a substantial upgrade
       if (!existing.hasEngagement && hasEngagement) {
           L && L.debug(M, `Upgrading previously sent post (engagement data found): ${key}`);
       } else if (!existing.hasText && hasText) {
           L && L.debug(M, `Upgrading previously sent post (text data found): ${key}`);
       } else {
           return false; // ignore
       }
    }

    _sentPostsMeta.set(key, { hasEngagement, hasText });
    _buffer.push(post);

    const batchSize = cfg().BATCH_SIZE || 10;
    if (_buffer.length >= batchSize) {
      flush();
    } else {
      scheduleFlush();
    }
    return true;
  }

  // ── Public: flush buffer immediately ─────────────────────────────────────
  async function flush() {
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
    if (_buffer.length === 0) return;

    const batch = _buffer.splice(0, _buffer.length);
    L && L.info(M, `Flushing ${batch.length} posts…`);

    const retries = cfg().RETRY_ATTEMPTS || 3;
    const baseDelay = cfg().RETRY_BASE_DELAY_MS || 2000;
    let lastErr = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const result = await sendBatch(batch, _jobMeta);
      if (result.ok) {
        L && L.info(M, `Batch sent. savedCount=${result.savedCount}`);
        return;
      }
      lastErr = result.error;
      if (attempt < retries) {
        const delay = baseDelay * attempt;
        L && L.warn(M, `Attempt ${attempt}/${retries} failed. Retrying in ${delay}ms…`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    L && L.error(M, `All ${retries} attempts failed. Sending to failure queue.`, lastErr);
    saveToFailureQueue(batch);
  }

  // ── Public: configure job metadata ───────────────────────────────────────
  function configure(meta) {
    _jobMeta = Object.assign({}, meta);
    L && L.info(M, `Configured for keyword="${meta.keyword}" user=${meta.userId}`);
    // Retry any persisted failures from previous runs
    retryFailureQueue(_jobMeta).catch(() => {});
  }

  // ── Public: reset for new run ─────────────────────────────────────────────
  function reset() {
    _buffer   = [];
    _sentPostsMeta = new Map();
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.__NexoraTransport = {
    configure,
    buffer,
    flush,
    reset,
    getSentCount: () => _sentPostsMeta.size,
    getBufferSize: () => _buffer.length,
  };

})();
