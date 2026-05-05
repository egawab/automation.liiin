/**
 * Nexora Layout Detector v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects LinkedIn DOM layout variant at runtime.
 * Returns a layout ID that the DOM Adapter uses to pick its discovery strategy.
 *
 * Layout Registry:
 *  SEARCH_A — Search results page; cards carry [data-urn] or [data-view-name]
 *  SEARCH_B — Search results page; fsd_update URNs; no data-urn on card roots
 *  FEED     — Home feed (/feed/); role=article cards
 *  UNKNOWN  — None matched; all strategies attempted in parallel
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraLayoutDetector) return;

  const L = window.__NexoraLogger;
  const M = 'LayoutDetector';

  const LAYOUTS = {
    SEARCH_A: 'SEARCH_A',
    SEARCH_B: 'SEARCH_B',
    FEED:     'FEED',
    UNKNOWN:  'UNKNOWN',
  };

  // Detection matrix — evaluated in order; first passing test wins.
  // Each entry: { id, test(), description }
  const MATRIX = [
    {
      id: LAYOUTS.SEARCH_A,
      description: 'Search results with data-urn cards',
      test() {
        if (!/\/search\/results\/content\//i.test(location.href)) return false;
        // Layout A signal: cards have data-urn / data-view-name stamped by LinkedIn
        return (
          document.querySelector('[data-view-name="feed-full-update"]') !== null ||
          document.querySelector('[data-urn*="urn:li:activity"]') !== null ||
          document.querySelector('[data-urn*="urn:li:ugcPost"]') !== null ||
          document.querySelector('[data-entity-urn*="urn:li:activity"]') !== null
        );
      },
    },
    {
      id: LAYOUTS.SEARCH_B,
      description: 'Search results — button-based detection (no data-urn on cards)',
      test() {
        if (!/\/search\/results\/content\//i.test(location.href)) return false;
        // Layout B: engagement buttons exist but cards lack data-urn stamping
        const btns = document.querySelectorAll('button[aria-label]');
        let likeCount = 0, commentCount = 0;
        const cfg = window.__NexoraConfig || {};
        const likeSignals   = cfg.LIKE_SIGNALS    || ['reaction', 'like'];
        const commentSignals = cfg.COMMENT_SIGNALS || ['comment'];
        btns.forEach(b => {
          const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
          if (likeSignals.some(s   => lbl.includes(s))) likeCount++;
          if (commentSignals.some(s => lbl.includes(s))) commentCount++;
        });
        return likeCount >= 2 || commentCount >= 2;
      },
    },
    {
      id: LAYOUTS.FEED,
      description: 'Home feed (/feed/)',
      test() {
        return /\/(feed|home)\/?(\?|#|$)/i.test(location.pathname);
      },
    },
  ];

  let _cached    = null;
  let _cachedAt  = 0;
  const TTL_MS   = 2000; // Re-detect every 2 s at most

  function detect(force = false) {
    const now = Date.now();
    if (!force && _cached && (now - _cachedAt) < TTL_MS) return _cached;

    for (const entry of MATRIX) {
      let matched = false;
      try { matched = entry.test(); } catch (e) {
        L && L.warn(M, `Test threw for ${entry.id}`, e.message);
      }
      if (matched) {
        if (_cached !== entry.id) {
          L && L.info(M, `Layout → ${entry.id} (${entry.description})`);
        }
        _cached   = entry.id;
        _cachedAt = now;
        return entry.id;
      }
    }

    if (_cached !== LAYOUTS.UNKNOWN) {
      L && L.warn(M, `Layout → UNKNOWN  url=${location.href.slice(0, 80)}`);
    }
    
    // FAST PATH: If we are on a search page but no DOM signals match yet, 
    // it's almost certainly SEARCH_B still loading its complex DOM.
    if (/\/search\/results\/content\//i.test(location.href)) {
      L && L.info(M, `Layout → SEARCH_B (URL fast path fallback)`);
      _cached = LAYOUTS.SEARCH_B;
      _cachedAt = now;
      return LAYOUTS.SEARCH_B;
    }

    _cached   = LAYOUTS.UNKNOWN;
    _cachedAt = now;
    return LAYOUTS.UNKNOWN;
  }

  // Helper to wait until a definitive layout is found (non-UNKNOWN)
  async function detectAsync(maxWaitMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const l = detect(true); // force check
      if (l !== LAYOUTS.UNKNOWN) return l;
      await new Promise(r => setTimeout(r, 500));
    }
    L && L.warn(M, `detectAsync timed out after ${maxWaitMs}ms, returning UNKNOWN`);
    return detect(true);
  }

  window.__NexoraLayoutDetector = { detect, detectAsync, LAYOUTS };

})();
