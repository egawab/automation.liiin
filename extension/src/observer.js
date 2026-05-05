/**
 * Nexora Observer v1.3  —  Tested Inner-Container Scroll
 * ─────────────────────────────────────────────────────────────────────────────
 * v1.2 bug: keyboard fallback fired because pageYOffset never moved.
 *   LinkedIn SEARCH_B has overflow:hidden on <html>/<body> — the feed sits
 *   inside an inner div with its own scrollTop. Checking window.pageYOffset
 *   to verify scroll progress was wrong.
 *
 * v1.3 fix:
 *   - Detects the REAL scroll container by actually incrementing scrollTop
 *     and checking if it changed (definitive test, no computed-style guessing)
 *   - Scrolls ONLY that container (no more simultaneous multi-target spam)
 *   - Keyboard fallback removed entirely
 *   - Smooth scroll replaced with instant (SPA pages often break smooth)
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraObserver) return;

  const L = window.__NexoraLogger;
  const M = 'Observer';

  function cfg() { return window.__NexoraConfig || {}; }

  let _mutationObs  = null;
  let _onNewCards   = null;
  let _onExhausted  = null;
  let _scrollStep   = 0;
  let _stallCount   = 0;
  let _active       = false;
  let _scrollTimer  = null;
  let _scrollEl     = null;  // the confirmed scrollable element

  // ── Find the REAL scrollable container by probing each candidate ──────────
  // Incrementally test scrollTop changes — definitive, no computed-style guessing
  function detectScrollContainer() {
    const candidates = [
      // LinkedIn-specific class names (last resort but reliable when present)
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('.scaffold-finite-scroll__content'),
      document.querySelector('.search-results-container'),
      document.querySelector('[role="main"]'),
      document.querySelector('main'),
      // Generic fallbacks
      document.scrollingElement,
      document.documentElement,
      document.body,
    ];

    for (const el of candidates) {
      if (!el || el === window) continue;
      try {
        const before = el.scrollTop;
        el.scrollTop = before + 1;          // probe: try to scroll 1px
        const after = el.scrollTop;
        el.scrollTop = before;              // restore immediately
        if (after > before) {
          L && L.info(M, `✓ Scroll container found: ${el.tagName}${el.id ? '#'+el.id : ''}${el.className ? '.'+String(el.className).split(' ')[0] : ''}`);
          return el;
        }
      } catch (e) {}
    }

    // If nothing scrolled yet (page not loaded enough), default to documentElement
    L && L.warn(M, 'No scrollable container found — using documentElement');
    return document.documentElement;
  }

  // ── Scroll the detected container ─────────────────────────────────────────
  function scrollPage(amount) {
    const el = _scrollEl;
    if (!el) return;

    // Use instant behavior — LinkedIn SPA often breaks smooth scrollBy timing
    try {
      el.scrollTop += amount;
    } catch (e) {
      try { window.scrollBy({ top: amount, behavior: 'instant' }); } catch (e2) {}
    }
  }

  // ── Re-detect scroll container on each step (LinkedIn SPA may swap elements)
  function refreshScrollContainer() {
    _scrollEl = detectScrollContainer();
  }

  // ── MutationObserver — early trigger on real post additions only ───────────
  function attachMutationObserver(container) {
    if (_mutationObs) { _mutationObs.disconnect(); _mutationObs = null; }
    _mutationObs = new MutationObserver((mutations) => {
      if (!_active) return;
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (
            node.getAttribute('role') === 'article' ||
            node.tagName === 'LI' ||
            node.querySelector('li, [role="article"]')
          ) {
            doHarvest();
            return;
          }
        }
      }
    });
    _mutationObs.observe(container, { childList: true, subtree: true });
    L && L.info(M, 'MutationObserver attached');
  }

  function doHarvest() {
    if (!_active || !_onNewCards) return;
    _onNewCards();
  }

  function scheduleNextScroll(delay) {
    if (_scrollTimer) clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(() => { if (_active) scrollStep(); }, delay);
  }

  function scrollStep() {
    if (!_active) return;

    _scrollStep++;
    const maxSteps       = cfg().MAX_SCROLL_STEPS  || 150;
    const stallThreshold = cfg().STALL_THRESHOLD   || 20;

    if (_scrollStep > maxSteps) {
      L && L.info(M, `Max scroll steps (${maxSteps}). Done.`);
      _onExhausted && _onExhausted('max_steps');
      return;
    }
    if (_stallCount >= stallThreshold) {
      L && L.info(M, `Feed stalled (${_stallCount}). Done.`);
      _onExhausted && _onExhausted('stall');
      return;
    }

    // Re-probe scroll container every 5 steps (LinkedIn SPA can swap elements)
    if (_scrollStep % 5 === 1) refreshScrollContainer();

    // Natural scroll: 70–110% of viewport height with jitter
    const jitter = 0.70 + Math.random() * 0.40;
    const amount = Math.floor(window.innerHeight * jitter);

    L && L.debug(M, `Scroll step ${_scrollStep} | ${amount}px | stall=${_stallCount} | target=${_scrollEl ? _scrollEl.tagName : '?'}`);
    scrollPage(amount);

    // Harvest after settle
    const settleMs = cfg().SCROLL_SETTLE_MS || 500;
    setTimeout(() => { if (_active) doHarvest(); }, settleMs);
  }

  function onHarvestComplete(newCardsFound) {
    if (!_active) return;

    if (newCardsFound > 0) {
      _stallCount = 0;
    } else {
      _stallCount++;
    }

    const base   = cfg().SCROLL_DELAY_MS || 1400;
    const jitter = Math.floor(Math.random() * 400) - 200;
    const delay  = Math.max(800, base + jitter);
    scheduleNextScroll(delay);
  }

  // ── Page Readiness Probe ──────────────────────────────────────────────────
  async function waitForPageReady(maxWaitMs = 25000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const signals = document.querySelectorAll('button[aria-label*="reaction" i], button[aria-label*="like" i], [data-urn], a[href*="/posts/"], a[href*="/feed/update/"]').length;
      if (signals > 0) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  async function start(onNewCards, onExhausted) {
    if (_active) stop();

    _onNewCards  = onNewCards;
    _onExhausted = onExhausted;
    _scrollStep  = 0;
    _stallCount  = 0;
    _active      = true;

    L && L.info(M, 'Waiting for page readiness signals...');
    const isReady = await waitForPageReady();
    if (!isReady) {
      L && L.warn(M, 'Page readiness timeout (25s). Proceeding anyway.');
    } else {
      L && L.info(M, 'Page ready. Initializing observer.');
    }
    
    if (!_active) return; // In case stop() was called during wait

    // Stabilization delay
    await new Promise(r => setTimeout(r, 500));

    _scrollEl = detectScrollContainer();

    const adapter   = window.__NexoraDomAdapter;
    const container = (adapter && adapter.getFeedContainer && adapter.getFeedContainer())
                      || document.querySelector('[role="main"]')
                      || document.body;

    attachMutationObserver(container);

    L && L.info(M, 'Observer v1.3 started (inner-container scroll)');

    // Initial harvest (posts already on screen)
    setTimeout(() => { if (_active) doHarvest(); }, 100);
  }

  function stop() {
    _active = false;
    if (_scrollTimer) { clearTimeout(_scrollTimer); _scrollTimer = null; }
    if (_mutationObs) { _mutationObs.disconnect(); _mutationObs = null; }
    L && L.info(M, `Observer stopped at step ${_scrollStep}`);
  }

  window.__NexoraObserver = {
    start, stop, scrollStep, onHarvestComplete,
    getStep:  () => _scrollStep,
    isActive: () => _active,
  };

})();
