/**
 * Nexora Core Engine v1.0  —  Search-Only Mode
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates all modules. Injected into the LinkedIn page by background.js
 * ONLY for SEARCH_ONLY mode. Comment-campaign mode still uses content.js.
 *
 * Load order (injected by background.js as a files[] array):
 *   src/config.js → src/logger.js → src/layout-detector.js →
 *   src/dom-adapter.js → src/extractor.js → src/filter.js →
 *   src/transport.js → src/observer.js → src/core-engine.js
 *
 * The network interceptor (src/interceptor.js) is injected into the MAIN
 * world separately via a <script> tag created here.
 *
 * Entry point called by background.js:
 *   window.__NexoraEngine.start(keyword, settings, dashboardUrl, userId)
 *
 * Sends to background.js:
 *   HEARTBEAT    — keep-alive every ~20s
 *   LIVE_STATUS  — human-readable status updates
 *   SYNC_RESULTS — batched qualified posts (via transport.js)
 *   JOB_COMPLETED / JOB_FAILED — terminal signals
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  // ── Guard: prevent double-injection ───────────────────────────────────────
  if (window.__NexoraEngine) {
    console.log('[Nexora][Engine] Already active — skipping re-init.');
    return;
  }

  // ── Module references (loaded before this file) ───────────────────────────
  const CFG  = () => window.__NexoraConfig        || {};
  const L    = () => window.__NexoraLogger        || { info(){}, warn(){}, error(){}, debug(){}, setDebug(){} };
  const LD   = () => window.__NexoraLayoutDetector|| { detect(){ return 'UNKNOWN'; }, LAYOUTS: {} };
  const DA   = () => window.__NexoraDomAdapter    || { discoverCards(){ return []; }, extractCanonicalUrl(){ return null; } };
  const EX   = () => window.__NexoraExtractor     || { extractFromCard(){ return {}; }, mergeWithNetworkData(a){ return a; } };
  const FT   = () => window.__NexoraFilter        || { applyBatch(p){ return { passed: p, rejected: [] }; }, deduplicateByUrl(p){ return p; } };
  const TR   = () => window.__NexoraTransport     || { buffer(){}, flush(){}, configure(){}, reset(){}, getSentCount(){ return 0; } };
  const OBS  = () => window.__NexoraObserver      || { start(){}, stop(){}, onHarvestComplete(){} };

  const MODULE = 'Engine';

  // ── Engine state ──────────────────────────────────────────────────────────
  let _running       = false;
  let _keyword       = '';
  let _dashboardUrl  = '';
  let _userId        = '';
  let _profileId     = 'Unknown';
  let _seenCardEls   = new WeakSet();   // processed card DOM elements
  let _seenUrls      = new Set();       // dedup by URL across entire run
  let _totalFound    = 0;
  let _heartbeatTimer= null;
  let _networkBuffer = [];              // posts from interceptor
  let _harvestCount  = 0;              // diagnostic: count harvests

  // ── Helpers ───────────────────────────────────────────────────────────────
  function safeSend(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => {
        if (chrome.runtime.lastError) { /* popup may be closed */ }
      });
    } catch (e) {}
  }

  function heartbeat(phase) {
    safeSend({ action: 'HEARTBEAT', phase });
  }

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

  // ── Inject network interceptor into MAIN world ─────────────────────────────
  function injectInterceptor() {
    if (document.getElementById('nexora-interceptor-v2')) return;
    try {
      const s = document.createElement('script');
      s.id  = 'nexora-interceptor-v2';
      s.src = chrome.runtime.getURL('src/interceptor.js');
      s.onload  = () => L().info(MODULE, 'Network interceptor injected (MAIN world)');
      s.onerror = () => L().warn(MODULE, 'Interceptor injection failed — network data unavailable');
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      L().warn(MODULE, 'Could not inject interceptor', e.message);
    }
  }

  // ── Network buffer listener ────────────────────────────────────────────────
  function attachNetworkListener() {
    if (window.__nexoraNetworkListenerAttached) return;
    window.__nexoraNetworkListenerAttached = true;
    window.addEventListener('message', (evt) => {
      if (!evt.data || evt.data.type !== '__NEXORA_NETWORK_POSTS__') return;
      const posts = evt.data.posts;
      if (Array.isArray(posts)) {
        _networkBuffer.push(...posts);
        L().debug(MODULE, `Network buffer +${posts.length} (total=${_networkBuffer.length})`);
        // SEARCH_B fix: immediately process network data — don't wait for the
        // next scroll cycle. Network posts for SEARCH_B arrive asynchronously
        // (after LinkedIn's API responds) and would otherwise be missed.
        if (_running) {
          setTimeout(() => harvest(), 150);
        }
      }
    });
  }

  // ── Find network data for a given URL ────────────────────────────────────
  // v1.1: Only CONSUME (splice) the entry when it has real likes data.
  // If likes is null, the entry is KEPT in the buffer so the pending-upgrade
  // cycle can retry it on the next harvest — fixes the timing race where DOM
  // harvest runs before the RSC response has populated the metric fields.
  function drainNetworkDataForUrl(url) {
    if (!url || _networkBuffer.length === 0) return null;
    const clean = url.split('?')[0].replace(/\/$/, '');
    const idx = _networkBuffer.findIndex(p => {
      const pu = (p.url || '').split('?')[0].replace(/\/$/, '');
      return pu === clean;
    });
    if (idx === -1) return null;
    const found = _networkBuffer[idx];
    // Only consume if the entry carries real metric data.
    // Null-likes entries stay in the buffer for the pending upgrade cycle.
    if (found.likes != null) {
      _networkBuffer.splice(idx, 1);
    }
    return found;
  }

  // ── Detect LinkedIn profile identity ─────────────────────────────────────
  function detectProfileId() {
    try {
      const meLink = document.querySelector('a[href*="/in/"][aria-label*="me" i], a[data-test-app-aware-link][href*="/in/"]');
      if (meLink) {
        const href = meLink.getAttribute('href') || '';
        const m = href.match(/\/in\/([^/?#]+)/i);
        if (m) {
          _profileId = m[1];
          safeSend({ action: 'IDENTITY_DETECTED', linkedInProfileId: _profileId });
          L().info(MODULE, `Profile ID: ${_profileId}`);
        }
      }
    } catch (e) {}
  }

  // ── Core harvest function — called by observer on every DOM change ─────────
  function harvest() {
    if (!_running) return;

    heartbeat('harvesting');
    _harvestCount++;

    const layout = LD().detect();
    const cards  = DA().discoverCards(layout);
    let newCardsThisRound = 0;

    // ── SEARCH_B diagnostic: log DOM structure on first harvest ────────────
    if (_harvestCount === 1) {
      L().info(MODULE, `[Diag] layout=${layout} url=${location.href.slice(0,80)}`);
      L().info(MODULE, `[Diag] cards found=${cards.length}`);
      L().info(MODULE, `[Diag] scrollY=${window.pageYOffset} docH=${document.documentElement.scrollHeight} winH=${window.innerHeight}`);
      L().info(MODULE, `[Diag] scrollingEl=${document.scrollingElement ? document.scrollingElement.tagName : 'none'}`);
      if (cards.length > 0) {
        const c = cards[0];
        const url = DA().extractCanonicalUrl(c);
        const firstLbl = (c.querySelector('[aria-label]') || {}).getAttribute && c.querySelector('[aria-label]').getAttribute('aria-label');
        const anchorCount = c.querySelectorAll('a[href]').length;
        L().info(MODULE, `[Diag] card[0] tag=${c.tagName} scrollH=${c.scrollHeight} anchors=${anchorCount} url=${url || 'NULL'} firstAriaLabel="${(firstLbl||'').slice(0,60)}"`);
        // Also log all anchor hrefs in the card so we can see what URLs are present
        const allHrefs = Array.from(c.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).filter(Boolean).slice(0, 5);
        L().info(MODULE, `[Diag] card[0] hrefs: ${JSON.stringify(allHrefs)}`);
      }
    }

    for (const card of cards) {
      // Skip already-processed cards
      if (_seenCardEls.has(card)) continue;
      _seenCardEls.add(card);

      // Extract raw data
      let post;
      try {
        post = EX().extractFromCard(card, { layoutId: layout });
      } catch (e) {
        L().warn(MODULE, 'extractFromCard threw', e.message);
        continue;
      }

      // Merge with network-intercepted data (better metrics)
      if (post.post_url) {
        const netData = drainNetworkDataForUrl(post.post_url);
        if (netData) post = EX().mergeWithNetworkData(post, netData);
      }

      // Attach keyword + session metadata
      post.keyword    = _keyword;
      post.session_id = L().sessionId;

      // Deduplicate by URL
      const urlKey = (post.post_url || '').split('?')[0].replace(/\/$/, '');
      if (urlKey && _seenUrls.has(urlKey)) continue;
      if (urlKey) _seenUrls.add(urlKey);

      _totalFound++;
      newCardsThisRound++;

      // Always add to WeakSet — prevents the same element being counted
      // multiple times which would inflate _totalFound and trigger premature stop.
      _seenCardEls.add(card);

      // Visual highlight in debug mode
      if (CFG().HIGHLIGHT_POSTS) {
        L().highlight(card, '#10b981', `✓ ${post.likes_count}`);
      }

      // Buffer for sending
      TR().buffer(post);

      // Hard cap
      if (_totalFound >= CFG().MAX_POSTS_PER_RUN) {
        L().info(MODULE, `Max posts/run reached (${CFG().MAX_POSTS_PER_RUN}). Finishing.`);
        finish('max_posts');
        return;
      }
    }

    // ── Network buffer flush ───────────────────────────────────────────────
    if (_networkBuffer.length > 0) {
      const networkOnly = _networkBuffer.splice(0, _networkBuffer.length);

      for (const np of networkOnly) {
        const urlKey = (np.url || '').split('?')[0].replace(/\/$/, '');
        if (!urlKey) continue;

        // ── new URL only seen in network stream ─────────────────────
        if (_seenUrls.has(urlKey)) continue;
        _seenUrls.add(urlKey);

        const syntheticPost = {
          post_url:          np.url,
          post_text:         np.text     || '',
          likes_count:       np.likes    != null ? np.likes    : null,
          comments_count:    np.comments != null ? np.comments : null,
          shares_count:      np.reposts  != null ? np.reposts  : null,
          author:            np.author   || 'Unknown',
          timestamp:         np.postedAtMs ? new Date(np.postedAtMs).toISOString() : null,
          media_type:        'text',
          extraction_source: 'network',
          layout_id:         layout,
          keyword:           _keyword,
          session_id:        L().sessionId,
        };

        _totalFound++;
        newCardsThisRound++;

        TR().buffer(syntheticPost);

        if (_totalFound >= CFG().MAX_POSTS_PER_RUN) {
          finish('max_posts');
          return;
        }
      }
    }

    const qualified = TR().getSentCount() + TR().getBufferSize();
    status(`🔍 "${_keyword}" — Step ${OBS().getStep()} | Found: ${_totalFound} | Qualified: ${qualified} | Layout: ${layout}`);

    OBS().onHarvestComplete(newCardsThisRound);
  }

  // ── Feed exhausted ─────────────────────────────────────────────────────────
  async function onExhausted(reason) {
    L().info(MODULE, `Feed exhausted: ${reason}`);
    finish('exhausted');
  }

  // ── Finish run ─────────────────────────────────────────────────────────────
  async function finish(reason) {
    if (!_running) return;
    _running = false;

    stopHeartbeat();
    OBS().stop();

    // Final flush
    try { await TR().flush(); } catch (e) {}

    const qualified = TR().getSentCount();
    L().info(MODULE, `Run complete. reason=${reason} found=${_totalFound} qualified=${qualified}`);
    status(`✅ "${_keyword}" done — ${qualified} posts sent (${_totalFound} scanned)`);

    if (qualified === 0 && _totalFound === 0) {
      safeSend({
        action:          'JOB_FAILED',
        searchOnlyMode:  true,
        postsExtracted:  0,
        qualifiedPosts:  0,
        keyword:         _keyword,
        linkedInProfileId: _profileId,
        reason:          'NO_CONTENT',
      });
      return;
    }

    safeSend({
      action:            'JOB_COMPLETED',
      searchOnlyMode:    true,
      postsExtracted:    _totalFound,
      qualifiedPosts:    qualified,
      keyword:           _keyword,
      linkedInProfileId: _profileId,
      reason,
    });
  }

  // ── Emergency sync (called by background.js watchdog) ─────────────────────
  async function emergencySync() {
    L().warn(MODULE, 'Emergency sync triggered by watchdog');
    try { await TR().flush(); } catch (e) {}
  }

  // ── Public start function ─────────────────────────────────────────────────
  async function start(keyword, settings, dashboardUrl, userId) {
    if (_running) {
      L().warn(MODULE, 'Already running — ignoring duplicate start()');
      return;
    }

    _running       = true;
    _keyword       = keyword       || '';
    _dashboardUrl  = dashboardUrl  || '';
    _userId        = userId        || '';
    _seenCardEls   = new WeakSet();
    _seenUrls      = new Set();
    _totalFound    = 0;
    _networkBuffer = [];

    // Apply settings overrides to config
    if (settings) {
      const overrides = {};
      if (settings.likeThreshold != null)  overrides.LIKE_THRESHOLD   = Number(settings.likeThreshold);
      if (settings.maxPosts != null)        overrides.MAX_POSTS_PER_RUN = Number(settings.maxPosts);
      if (settings.debugMode != null)       overrides.DEBUG_MODE        = !!settings.debugMode;
      if (settings.highlightPosts != null)  overrides.HIGHLIGHT_POSTS   = !!settings.highlightPosts;
      CFG().update && CFG().update(overrides);
    }

    // Load config from storage (may override above)
    if (CFG().load) await CFG().load();

    // Enable debug logging if configured
    if (CFG().DEBUG_MODE) L().setDebug(true);

    L().info(MODULE, `Starting search-only run: keyword="${_keyword}" threshold=${CFG().LIKE_THRESHOLD}`);
    status(`🚀 Starting extraction for "${_keyword}"…`);

    // Configure transport
    TR().configure({
      keyword:           _keyword,
      dashboardUrl:      _dashboardUrl,
      userId:            _userId,
      linkedInProfileId: _profileId,
    });
    TR().reset();

    // Detect LinkedIn profile
    detectProfileId();

    // Inject network interceptor into MAIN world (fallback if content_script failed)
    injectInterceptor();
    attachNetworkListener();

    // Drain any posts the interceptor already scanned from embedded <code> elements.
    // The interceptor runs at document_start and stores pre-scanned posts in this
    // global BEFORE core-engine starts listening to postMessage.
    const preScanned = window.__NexoraEmbeddedPosts || [];
    if (preScanned.length > 0) {
      _networkBuffer.push(...preScanned);
      window.__NexoraEmbeddedPosts = []; // clear so we don't re-add on future calls
      L().info(MODULE, `Loaded ${preScanned.length} pre-scanned embedded posts into buffer`);
    }

    // Wait for layout detection before starting observer
    const layoutId = await LD().detectAsync(20000);
    L().info(MODULE, `Layout detected as ${layoutId}`);
    await new Promise(r => setTimeout(r, 1000)); // stabilization pause

    // Start observer (MutationObserver + intelligent scroll)
    startHeartbeat();
    OBS().start(harvest, onExhausted);
  }

  function stop() {
    if (!_running) return;
    _running = false;
    stopHeartbeat();
    OBS().stop();
    TR().flush().catch(() => {});
    L().info(MODULE, 'Stopped by external call');
  }

  // ── Expose on window (called by background.js) ────────────────────────────
  window.__NexoraEngine = { start, stop, emergencySync };

  // ── Register cleanup for re-injection safety ──────────────────────────────
  window.__linkedInExtractorCleanup = window.__linkedInExtractorCleanup || function () {};
  const _prevCleanup = window.__linkedInExtractorCleanup;
  window.__linkedInExtractorCleanup = function () {
    try { _prevCleanup(); } catch (e) {}
    stop();
  };

  // ── Emergency sync hook (used by background.js watchdog) ─────────────────
  window.__emergencySync = emergencySync;

  L().info(MODULE, 'Core Engine v1.0 ready');

})();
