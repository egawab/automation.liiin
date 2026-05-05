/**
 * Nexora Core Engine v4.0 — Two-Phase Collect-Then-Flush (SEARCH_B Rebuild)
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.0 Architecture: Two-Phase Design
 *
 * PHASE 1 — COLLECTION (scroll steps 1–60):
 *   Maintain a central _enrichmentStore: Map<normalizedUrl, PostRecord>.
 *   On each harvest:
 *     1. Discover DOM cards → extract URL → add to store if new.
 *     2. Apply DOM extraction (text, author, engagement) to fill fields.
 *     3. Merge network data from _networkBuffer for matching URLs.
 *     4. Add network-only posts (no DOM card) directly to store.
 *   NOTHING is sent to Transport during this phase.
 *
 * PHASE 2 — FLUSH (after observer calls onExhausted):
 *   1. Wait a final settle window (2s) for any last network messages.
 *   2. Iterate _enrichmentStore.
 *   3. For each record: validate URL → buffer in Transport → flush.
 *   4. Network-only posts also flushed.
 *
 * Key guarantees:
 *   - A post seen at scroll step 3 gets network data from step 47.
 *   - No post is ever dropped for missing author/text/likes.
 *   - All 500+ posts (per run cap) are stored.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraEngine) return;

  const CFG  = () => window.__NexoraConfig         || {};
  const L    = () => window.__NexoraLogger         || { info(){}, warn(){}, error(){}, debug(){}, setDebug(){} };
  const DA   = () => window.__NexoraDomAdapter     || { discoverCards(){ return []; }, extractCanonicalUrl(){ return null; }, getFeedContainer(){ return document.body; } };
  const EX   = () => window.__NexoraExtractor      || { extractFromCard(){ return {}; }, mergeWithNetworkData(a){ return a; } };
  const FL   = () => window.__NexoraFilter         || { qualifies(p){ return { pass: !!p.post_url }; } };
  const TR   = () => window.__NexoraTransport      || { buffer(){}, flush(){}, configure(){}, reset(){}, getSentCount(){ return 0; } };
  const OBS  = () => window.__NexoraObserver       || { start(){}, stop(){}, onHarvestComplete(){} };

  const MODULE = 'Engine';

  // ── State ────────────────────────────────────────────────────────────────
  let _running        = false;
  let _keyword        = '';
  let _dashboardUrl   = '';
  let _userId         = '';
  let _profileId      = 'Unknown';
  let _heartbeatTimer = null;

  // Phase 1 state
  let _seenCardEls    = new WeakSet(); // DOM elements already processed
  let _enrichmentStore= new Map();     // normalizedUrl → PostRecord (central truth)
  let _networkBuffer  = [];            // incoming network posts not yet merged

  // ── Helpers ──────────────────────────────────────────────────────────────
  function safeSend(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
      });
    } catch (e) {}
  }

  function heartbeat(phase) { safeSend({ action: 'HEARTBEAT', phase }); }

  function status(text) {
    L().info(MODULE, text);
    safeSend({ action: 'LIVE_STATUS', text });
  }

  function startHeartbeat() {
    stopHeartbeat();
    _heartbeatTimer = setInterval(() => heartbeat('search_only'), 20000);
  }

  function stopHeartbeat() {
    if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  }

  // ── URL normalization ─────────────────────────────────────────────────────
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

  // ── Enrichment store operations ───────────────────────────────────────────
  // Non-destructive merge: never overwrite a non-empty field with empty/null.
  function mergeIntoStore(urlKey, incoming) {
    if (!urlKey) return;

    const existing = _enrichmentStore.get(urlKey);
    if (!existing) {
      _enrichmentStore.set(urlKey, { ...incoming });
      return;
    }

    // Text: keep longer
    const inText = incoming.post_text || incoming.text || '';
    const exText = existing.post_text || '';
    if (inText.length > exText.length) existing.post_text = inText;

    // Author: keep existing unless it's empty/Unknown
    const inAuth = incoming.author || '';
    const exAuth = existing.author || '';
    const exHasAuth = exAuth && exAuth !== 'Unknown' && exAuth !== '';
    const inHasAuth = inAuth && inAuth !== 'Unknown' && inAuth !== '';
    if (!exHasAuth && inHasAuth) existing.author = inAuth;

    // Engagement: take best (non-null)
    const inLikes    = incoming.likes_count    != null ? incoming.likes_count    : incoming.likes;
    const inComments = incoming.comments_count != null ? incoming.comments_count : incoming.comments;
    const inReposts  = incoming.shares_count   != null ? incoming.shares_count   : incoming.reposts;

    if (existing.likes_count    == null && inLikes    != null) existing.likes_count    = inLikes;
    if (existing.comments_count == null && inComments != null) existing.comments_count = inComments;
    if (existing.shares_count   == null && inReposts  != null) existing.shares_count   = inReposts;

    // Timestamp
    if (!existing.timestamp && incoming.timestamp) existing.timestamp = incoming.timestamp;
  }

  // Convert a raw network post (from interceptor) to our internal schema
  function networkPostToRecord(np, layout) {
    return {
      post_url:          normalizePostUrl(np.url),
      post_text:         np.text     || '',
      likes_count:       np.likes    != null ? np.likes    : null,
      comments_count:    np.comments != null ? np.comments : null,
      shares_count:      np.reposts  != null ? np.reposts  : null,
      author:            np.author   || '',
      timestamp:         np.postedAtMs ? new Date(np.postedAtMs).toISOString() : null,
      media_type:        'text',
      extraction_source: 'network',
      layout_id:         layout,
      keyword:           _keyword,
      session_id:        L().sessionId,
      _traceId:          np._traceId || '',
    };
  }

  // ── Network buffer drain: merge all buffered network posts into store ────
  function drainNetworkBuffer() {
    const layout = 'UNKNOWN';
    for (const np of _networkBuffer) {
      const urlKey = normalizePostUrl(np.url);
      if (!urlKey) continue;
      const record = networkPostToRecord(np, layout);
      mergeIntoStore(urlKey, record);
    }
    _networkBuffer = [];
  }

  // ── PHASE 1: Per-scroll harvest ───────────────────────────────────────────
  function harvest() {
    if (!_running) return;

    heartbeat('harvesting');

    const layout = 'SEARCH_B'; // always search results in this mode
    const cards  = DA().discoverCards(layout);

    for (const card of cards) {
      if (_seenCardEls.has(card)) continue;
      _seenCardEls.add(card);

      let post;
      try {
        post = EX().extractFromCard(card, { layoutId: layout });
      } catch (e) {
        L().warn(MODULE, 'extractFromCard threw', e.message);
        continue;
      }

      post.keyword    = _keyword;
      post.session_id = (L().sessionId || '');

      if (!post.post_url) continue;

      const urlKey   = normalizePostUrl(post.post_url);
      post.post_url  = urlKey;

      // Add to enrichment store (non-destructive merge)
      mergeIntoStore(urlKey, post);
    }

    // Drain any pending network posts into the store
    drainNetworkBuffer();

    const storeSize = _enrichmentStore.size;
    status(`🔍 "${_keyword}" — Step ${OBS().getStep()} | Store: ${storeSize} posts | DOM hits: ${cards.length}`);
    OBS().onHarvestComplete(cards.length);
  }

  // ── Interceptor: network listener ────────────────────────────────────────
  function attachNetworkListener() {
    if (window.__nexoraNetworkListenerAttached) return;
    window.__nexoraNetworkListenerAttached = true;

    window.addEventListener('message', (evt) => {
      if (!evt.data || evt.data.type !== '__NEXORA_NETWORK_POSTS__') return;
      const posts = evt.data.posts;
      if (!Array.isArray(posts)) return;

      // Push to buffer; if running, drain immediately
      _networkBuffer.push(...posts);
      L().debug(MODULE, `Network buffer +${posts.length}, total=${_networkBuffer.length}`);

      if (_running) {
        // Drain into store immediately rather than waiting for next harvest
        drainNetworkBuffer();
      }
    });
  }

  // ── Interceptor injection ─────────────────────────────────────────────────
  function injectInterceptor() {
    if (document.getElementById('nexora-interceptor-v3')) return;
    try {
      const s    = document.createElement('script');
      s.id       = 'nexora-interceptor-v3';
      s.src      = chrome.runtime.getURL('src/interceptor.js');
      s.onload   = () => L().info(MODULE, 'Network interceptor v3.0 injected (MAIN world)');
      s.onerror  = () => L().warn(MODULE, 'Interceptor injection failed');
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }

  // ── Profile ID detection ─────────────────────────────────────────────────
  function detectProfileId() {
    try {
      const meLink = document.querySelector(
        'a[href*="/in/"][aria-label*="me" i], a[data-test-app-aware-link][href*="/in/"]'
      );
      if (meLink) {
        const href = meLink.getAttribute('href') || '';
        const m    = href.match(/\/in\/([^/?#]+)/i);
        if (m) {
          _profileId = m[1];
          safeSend({ action: 'IDENTITY_DETECTED', linkedInProfileId: _profileId });
        }
      }
    } catch (e) {}
  }

  // ── PHASE 2: Final flush ─────────────────────────────────────────────────
  async function flushAllPosts() {
    L().info(MODULE, `Phase 2: Flushing ${_enrichmentStore.size} posts from enrichment store…`);

    // Final settle: wait 2s for any last-arriving network messages
    await new Promise(r => setTimeout(r, 2000));
    drainNetworkBuffer(); // one last drain

    const layout    = 'SEARCH_B';
    let   sentCount = 0;

    for (const [urlKey, record] of _enrichmentStore) {
      // Minimal gate: URL must be non-empty and look real
      const validation = FL().qualifies(record);
      if (!validation.pass) {
        L().debug(MODULE, `Skipped (${validation.reason}): ${urlKey.slice(-40)}`);
        continue;
      }

      // Ensure all required fields are present (even if empty)
      const finalPost = {
        post_url:          record.post_url          || urlKey,
        post_text:         record.post_text         || '',
        likes_count:       record.likes_count       != null ? record.likes_count    : null,
        comments_count:    record.comments_count    != null ? record.comments_count : null,
        shares_count:      record.shares_count      != null ? record.shares_count   : null,
        author:            record.author            || 'Unknown',
        timestamp:         record.timestamp         || null,
        media_type:        record.media_type        || 'text',
        extraction_source: record.extraction_source || 'unknown',
        layout_id:         record.layout_id         || layout,
        keyword:           _keyword,
        session_id:        record.session_id        || '',
        _traceId:          record._traceId          || urlKey.split(':').pop() || '?',
      };

      TR().buffer(finalPost);
      sentCount++;

      if (sentCount >= (CFG().MAX_POSTS_PER_RUN || 500)) {
        L().info(MODULE, `Hit MAX_POSTS_PER_RUN cap (${CFG().MAX_POSTS_PER_RUN || 500})`);
        break;
      }
    }

    L().info(MODULE, `Phase 2: Buffered ${sentCount} posts for transport`);

    try { await TR().flush(); } catch (e) { L().warn(MODULE, 'flush error', e.message); }

    return sentCount;
  }

  // ── Completion ───────────────────────────────────────────────────────────
  async function onExhausted(reason) {
    L().info(MODULE, `Observer exhausted: ${reason}. Entering Phase 2.`);
    await finish(reason);
  }

  async function finish(reason) {
    if (!_running) return;
    _running = false;

    stopHeartbeat();
    OBS().stop();

    status(`⏳ "${_keyword}" — Collecting final data…`);

    const sentCount = await flushAllPosts();

    L().info(MODULE, `Run complete. reason=${reason} store=${_enrichmentStore.size} sent=${sentCount}`);
    status(`✅ "${_keyword}" done — ${sentCount} posts stored`);

    if (sentCount === 0 && _enrichmentStore.size === 0) {
      safeSend({
        action:            'JOB_FAILED',
        searchOnlyMode:    true,
        postsExtracted:    0,
        qualifiedPosts:    0,
        keyword:           _keyword,
        linkedInProfileId: _profileId,
        reason:            'NO_CONTENT',
      });
      return;
    }

    safeSend({
      action:            'JOB_COMPLETED',
      searchOnlyMode:    true,
      postsExtracted:    _enrichmentStore.size,
      qualifiedPosts:    sentCount,
      keyword:           _keyword,
      linkedInProfileId: _profileId,
      reason,
    });
  }

  async function emergencySync() {
    L().info(MODULE, 'Emergency sync triggered');
    try { await TR().flush(); } catch (e) {}
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  async function start(keyword, settings, dashboardUrl, userId) {
    if (_running) {
      L().warn(MODULE, 'Already running — ignoring duplicate start');
      return;
    }

    _running         = true;
    _keyword         = keyword      || '';
    _dashboardUrl    = dashboardUrl || '';
    _userId          = userId       || '';
    _seenCardEls     = new WeakSet();
    _enrichmentStore = new Map();
    _networkBuffer   = [];

    // Force the correct settings for brute-force collection
    const forcedOverrides = {
      MAX_SCROLL_STEPS:      60,
      STALL_THRESHOLD:       999,
      LIKE_THRESHOLD:        0,
      INCLUDE_UNKNOWN_LIKES: true,
      MAX_POSTS_PER_RUN:     500,
    };

    if (settings && CFG().update) {
      const userOverrides = {};
      if (settings.maxPosts != null) userOverrides.MAX_POSTS_PER_RUN = Number(settings.maxPosts);
      CFG().update(userOverrides);
    }
    CFG().update && CFG().update(forcedOverrides);

    if (CFG().load) await CFG().load();
    CFG().update && CFG().update(forcedOverrides);

    L().info(MODULE, `Engine v4.0 (Two-Phase) starting: keyword="${_keyword}"`);
    status(`🚀 Starting collection for "${_keyword}"…`);

    TR().configure({
      keyword:           _keyword,
      dashboardUrl:      _dashboardUrl,
      userId:            _userId,
      linkedInProfileId: _profileId,
    });
    TR().reset();

    detectProfileId();
    injectInterceptor();
    attachNetworkListener();

    // Absorb any pre-existing intercepted posts (from <code> pre-load scan)
    const preScanned = window.__NexoraEmbeddedPosts || [];
    if (preScanned.length > 0) {
      _networkBuffer.push(...preScanned);
      window.__NexoraEmbeddedPosts = [];
      L().info(MODULE, `Absorbed ${preScanned.length} pre-scanned posts`);
    }

    // Wait briefly for page to settle, then start scrolling
    await new Promise(r => setTimeout(r, 1200));

    startHeartbeat();
    OBS().start(harvest, onExhausted);
  }

  function stop() {
    if (!_running) return;
    _running = false;
    stopHeartbeat();
    OBS().stop();
    TR().flush().catch(() => {});
  }

  window.__NexoraEngine = { start, stop, emergencySync };

  // Integrate with any legacy cleanup hooks
  window.__linkedInExtractorCleanup = window.__linkedInExtractorCleanup || function () {};
  const _prevCleanup = window.__linkedInExtractorCleanup;
  window.__linkedInExtractorCleanup = function () {
    try { _prevCleanup(); } catch (e) {}
    stop();
  };

  window.__emergencySync = emergencySync;

  console.log('[Nexora][Engine v4.0] Two-phase collect-then-flush ready.');
})();
