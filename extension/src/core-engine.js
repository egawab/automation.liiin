/**
 * Nexora Core Engine v2.0  —  Brute-Force Search-Only Mode
 * ─────────────────────────────────────────────────────────────────────────────
 * v1.x had: pending maps, null-likes gating, stall counters, network buffer
 * re-queuing that blocked posts from being sent. Result: ~2 posts, stops at 9.
 *
 * v2.0 philosophy: DUMB AND AGGRESSIVE.
 *  - Every card found → immediately buffered for transport. No filtering.
 *  - Every network post → immediately buffered. No null-likes gating.
 *  - Observer runs ALL 60 steps. No stall-based early exit.
 *  - finish() only called when observer exhausts (max steps).
 *
 * Load order (injected by background.js):
 *   src/config.js → src/logger.js → src/layout-detector.js →
 *   src/dom-adapter.js → src/extractor.js → src/filter.js →
 *   src/transport.js → src/observer.js → src/core-engine.js
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  // ── Guard: prevent double-injection ───────────────────────────────────────
  if (window.__NexoraEngine) {
    console.log('[Nexora][Engine] Already active — skipping re-init.');
    return;
  }

  // ── Module references ─────────────────────────────────────────────────────
  const CFG  = () => window.__NexoraConfig         || {};
  const L    = () => window.__NexoraLogger         || { info(){}, warn(){}, error(){}, debug(){}, setDebug(){} };
  const LD   = () => window.__NexoraLayoutDetector || { detect(){ return 'UNKNOWN'; }, LAYOUTS: {} };
  const DA   = () => window.__NexoraDomAdapter     || { discoverCards(){ return []; }, extractCanonicalUrl(){ return null; } };
  const EX   = () => window.__NexoraExtractor      || { extractFromCard(){ return {}; }, mergeWithNetworkData(a){ return a; } };
  const TR   = () => window.__NexoraTransport      || { buffer(){}, flush(){}, configure(){}, reset(){}, getSentCount(){ return 0; } };
  const OBS  = () => window.__NexoraObserver       || { start(){}, stop(){}, onHarvestComplete(){} };

  const MODULE = 'Engine';

  // ── Engine state ──────────────────────────────────────────────────────────
  let _running        = false;
  let _keyword        = '';
  let _dashboardUrl   = '';
  let _userId         = '';
  let _profileId      = 'Unknown';
  let _seenCardEls    = new WeakSet();
  let _seenUrls       = new Set();
  let _totalFound     = 0;
  let _heartbeatTimer = null;
  let _networkBuffer  = [];   // posts received from interceptor
  let _harvestCount   = 0;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function safeSend(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => {
        if (chrome.runtime.lastError) { /* popup may be closed */ }
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
        // Trigger an immediate harvest whenever new network data arrives
        if (_running) setTimeout(() => harvest(), 100);
      }
    });
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

  // ── Core harvest — called after every scroll step ─────────────────────────
  // BRUTE FORCE: collect EVERYTHING. No filtering. No gating. No pending maps.
  function harvest() {
    if (!_running) return;

    heartbeat('harvesting');
    _harvestCount++;

    const layout = LD().detect();
    const cards  = DA().discoverCards(layout);
    let newThisRound = 0;

    // ── DOM harvest ───────────────────────────────────────────────────────
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

      // Attach metadata
      post.keyword    = _keyword;
      post.session_id = L().sessionId;

      // Skip if no URL at all (can't identify the post)
      if (!post.post_url) continue;

      // Dedup by URL
      const urlKey = (post.post_url || '').split('?')[0].replace(/\/$/, '');
      if (_seenUrls.has(urlKey)) continue;
      _seenUrls.add(urlKey);

      // Try to enrich with network data if available
      const netData = drainNetworkDataForUrl(post.post_url);
      if (netData) post = EX().mergeWithNetworkData(post, netData);

      _totalFound++;
      newThisRound++;

      // Send immediately — no filter, no threshold
      TR().buffer(post);

      if (_totalFound >= CFG().MAX_POSTS_PER_RUN) {
        L().info(MODULE, `Max posts/run (${CFG().MAX_POSTS_PER_RUN}) reached.`);
        finish('max_posts');
        return;
      }
    }

    // ── Network-only posts (not matched by DOM) ────────────────────────────
    // Drain ALL network buffer entries unconditionally. No null-likes gating.
    {
      const remaining = [];
      for (const np of _networkBuffer) {
        const urlKey = (np.url || '').split('?')[0].replace(/\/$/, '');

        // No URL → discard (can't save without URL)
        if (!urlKey) continue;

        // Consume: mark seen and emit synthetic post
        _seenUrls.add(urlKey);

        const syntheticPost = {
          post_url:          np.url,
          post_text:         np.text      || '',
          likes_count:       np.likes     != null ? np.likes     : null,
          comments_count:    np.comments  != null ? np.comments  : null,
          shares_count:      np.reposts   != null ? np.reposts   : null,
          author:            np.author    || 'Unknown',
          timestamp:         np.postedAtMs ? new Date(np.postedAtMs).toISOString() : null,
          media_type:        'text',
          extraction_source: 'network',
          layout_id:         layout,
          keyword:           _keyword,
          session_id:        L().sessionId,
        };

        _totalFound++;
        newThisRound++;

        TR().buffer(syntheticPost);

        if (_totalFound >= CFG().MAX_POSTS_PER_RUN) {
          _networkBuffer.length = 0;
          finish('max_posts');
          return;
        }
      }
      // Only keep entries that had no URL (truly useless)
      _networkBuffer.length = 0;
      _networkBuffer.push(...remaining);
    }

    // Diagnostic log every step
    status(`🔍 "${_keyword}" — Step ${OBS().getStep()} | Found: ${_totalFound} | DOM cards: ${cards.length} | Layout: ${layout}`);

    // Tell observer this harvest is done — it will schedule the next scroll
    OBS().onHarvestComplete(newThisRound);
  }

  // ── Drain network data for a URL (consume entry) ──────────────────────────
  function drainNetworkDataForUrl(url) {
    if (!url || _networkBuffer.length === 0) return null;
    const clean = url.split('?')[0].replace(/\/$/, '');
    const idx = _networkBuffer.findIndex(p => {
      const pu = (p.url || '').split('?')[0].replace(/\/$/, '');
      return pu === clean;
    });
    if (idx === -1) return null;
    return _networkBuffer.splice(idx, 1)[0]; // always consume
  }

  // ── Feed exhausted (called by observer after max steps) ────────────────────
  async function onExhausted(reason) {
    L().info(MODULE, `Observer exhausted: ${reason}`);
    finish('exhausted');
  }

  // ── Finish run ─────────────────────────────────────────────────────────────
  async function finish(reason) {
    if (!_running) return;
    _running = false;

    stopHeartbeat();
    OBS().stop();

    // Final flush of any remaining buffered posts
    try { await TR().flush(); } catch (e) {}

    const qualified = TR().getSentCount();
    L().info(MODULE, `Run complete. reason=${reason} found=${_totalFound} sent=${qualified}`);
    status(`✅ "${_keyword}" done — ${qualified} posts sent (${_totalFound} scanned, ${OBS().getStep()} steps)`);

    if (qualified === 0 && _totalFound === 0) {
      safeSend({
        action:           'JOB_FAILED',
        searchOnlyMode:   true,
        postsExtracted:   0,
        qualifiedPosts:   0,
        keyword:          _keyword,
        linkedInProfileId: _profileId,
        reason:           'NO_CONTENT',
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

    _running        = true;
    _keyword        = keyword      || '';
    _dashboardUrl   = dashboardUrl || '';
    _userId         = userId       || '';
    _seenCardEls    = new WeakSet();
    _seenUrls       = new Set();
    _totalFound     = 0;
    _networkBuffer  = [];
    _harvestCount   = 0;

    // Force brute-force config — ignore any user settings that would restrict
    const forcedOverrides = {
      MAX_SCROLL_STEPS:   60,   // Always run 60 steps
      STALL_THRESHOLD:    999,  // Effectively disabled
      LIKE_THRESHOLD:     0,    // Accept all posts
      INCLUDE_UNKNOWN_LIKES: true,
      SCROLL_DELAY_MS:    1200,
      SCROLL_SETTLE_MS:   800,
      MAX_POSTS_PER_RUN:  500,
    };

    // Apply any user settings first, then force our overrides on top
    if (settings && CFG().update) {
      const userOverrides = {};
      if (settings.maxPosts    != null) userOverrides.MAX_POSTS_PER_RUN = Number(settings.maxPosts);
      if (settings.debugMode   != null) userOverrides.DEBUG_MODE        = !!settings.debugMode;
      CFG().update(userOverrides);
    }
    CFG().update && CFG().update(forcedOverrides);

    // Load from storage (may override above, but forcedOverrides re-applied after)
    if (CFG().load) await CFG().load();
    // Re-apply critical brute-force overrides AFTER storage load
    CFG().update && CFG().update(forcedOverrides);

    if (CFG().DEBUG_MODE) L().setDebug(true);

    L().info(MODULE, `Engine v2.0 starting: keyword="${_keyword}" steps=${CFG().MAX_SCROLL_STEPS}`);
    status(`🚀 Starting extraction for "${_keyword}"…`);

    // Configure transport
    TR().configure({
      keyword:           _keyword,
      dashboardUrl:      _dashboardUrl,
      userId:            _userId,
      linkedInProfileId: _profileId,
    });
    TR().reset();

    detectProfileId();

    // Inject network interceptor + attach listener
    injectInterceptor();
    attachNetworkListener();

    // Drain any pre-scanned embedded posts
    const preScanned = window.__NexoraEmbeddedPosts || [];
    if (preScanned.length > 0) {
      _networkBuffer.push(...preScanned);
      window.__NexoraEmbeddedPosts = [];
      L().info(MODULE, `Loaded ${preScanned.length} pre-scanned embedded posts`);
    }

    // Detect layout — short timeout since SEARCH_B may not have data-urn yet
    const layoutId = await LD().detectAsync(10000);
    L().info(MODULE, `Layout detected: ${layoutId}`);
    await new Promise(r => setTimeout(r, 800)); // short stabilization pause

    // Start observer (drives scroll + harvest callbacks)
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

  // ── Expose on window ──────────────────────────────────────────────────────
  window.__NexoraEngine = { start, stop, emergencySync };

  // ── Cleanup hook for re-injection safety ──────────────────────────────────
  window.__linkedInExtractorCleanup = window.__linkedInExtractorCleanup || function () {};
  const _prevCleanup = window.__linkedInExtractorCleanup;
  window.__linkedInExtractorCleanup = function () {
    try { _prevCleanup(); } catch (e) {}
    stop();
  };

  window.__emergencySync = emergencySync;

  L().info(MODULE, 'Core Engine v2.0 ready (brute-force mode)');

})();
