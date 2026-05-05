/**
 * Nexora Observer v2.0 — Brute-Force Scroll with Clean Exhaustion Signal
 * ─────────────────────────────────────────────────────────────────────────────
 * v2.0 changes:
 *  - Kept brute-force scroll behavior from v1.4 (NO stall detection).
 *  - Added getStep() to public API (was missing, needed by engine status msgs).
 *  - onExhausted is called exactly once when MAX_SCROLL_STEPS is reached.
 *  - MutationObserver triggers harvest on new post nodes (retained).
 *  - Scroll container detection re-probed every 5 steps (LinkedIn SPA swaps).
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
  let _active       = false;
  let _scrollTimer  = null;
  let _scrollEl     = null;

  // ── Scroll container detection ────────────────────────────────────────────
  function detectScrollContainer() {
    const candidates = [
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('.scaffold-finite-scroll__content'),
      document.querySelector('.search-results-container'),
      document.querySelector('[role="main"]'),
      document.querySelector('main'),
      document.scrollingElement,
      document.documentElement,
      document.body,
    ];

    for (const el of candidates) {
      if (!el || el === window) continue;
      try {
        const before = el.scrollTop;
        el.scrollTop = before + 1;
        const after  = el.scrollTop;
        el.scrollTop = before;
        if (after > before) {
          L && L.info(M, `✓ Scroll container: ${el.tagName}${el.id ? '#' + el.id : ''}`);
          return el;
        }
      } catch (e) {}
    }

    L && L.warn(M, 'No scrollable container found — using documentElement');
    return document.documentElement;
  }

  function scrollPage(amount) {
    const el = _scrollEl;
    if (el) {
      try { el.scrollTop += amount; } catch (e) {}
    }
    // Always attempt window and body scrolls to guarantee movement (SPA containers change)
    try { window.scrollBy({ top: amount, behavior: 'instant' }); } catch (e) {}
    try { document.documentElement.scrollTop += amount; } catch(e) {}
    try { document.body.scrollTop += amount; } catch(e) {}
  }

  // ── MutationObserver — harvest on new post nodes ─────────────────────────
  function attachMutationObserver(container) {
    if (_mutationObs) { _mutationObs.disconnect(); _mutationObs = null; }
    _mutationObs = new MutationObserver(() => {
      if (!_active) return;
      doHarvest();
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

  // ── Scroll step ───────────────────────────────────────────────────────────
  function scrollStep() {
    if (!_active) return;

    _scrollStep++;
    const maxSteps = cfg().MAX_SCROLL_STEPS || 60;

    if (_scrollStep > maxSteps) {
      L && L.info(M, `Step cap reached (${maxSteps}). Exhausted.`);
      _active = false;
      if (_scrollTimer) { clearTimeout(_scrollTimer); _scrollTimer = null; }
      if (_mutationObs) { _mutationObs.disconnect(); _mutationObs = null; }
      _onExhausted && _onExhausted('max_steps');
      return;
    }

    // Re-probe scroll container every 5 steps (SPA can swap elements)
    if (_scrollStep % 5 === 1) {
      _scrollEl = detectScrollContainer();
    }

    // Natural scroll: 70–110% of viewport height
    const jitter = 0.70 + Math.random() * 0.40;
    const amount = Math.floor(window.innerHeight * jitter);

    L && L.debug(M, `Step ${_scrollStep}/${maxSteps} | ${amount}px`);
    scrollPage(amount);

    // Harvest after settle delay
    const settleMs = cfg().SCROLL_SETTLE_MS || 800;
    setTimeout(() => { if (_active) doHarvest(); }, settleMs);
  }

  // ── Called by engine after each harvest ───────────────────────────────────
  function onHarvestComplete(newCardsFound) {
    if (!_active) return;
    L && L.debug(M, `Harvest done: +${newCardsFound} | step=${_scrollStep}`);

    const base   = cfg().SCROLL_DELAY_MS || 1200;
    const jitter = Math.floor(Math.random() * 400) - 200;
    const delay  = Math.max(600, base + jitter);
    scheduleNextScroll(delay);
  }

  // ── Page readiness probe ──────────────────────────────────────────────────
  async function waitForPageReady(maxWaitMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const signals = document.querySelectorAll(
        'button[aria-label*="reaction" i], button[aria-label*="like" i], ' +
        '[data-urn], a[href*="/posts/"], a[href*="/feed/update/"], ' +
        'li[data-occludable-update-urn], time'
      ).length;
      if (signals > 0) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false; // proceed anyway
  }

  // ── Start / Stop ──────────────────────────────────────────────────────────
  async function start(onNewCards, onExhausted) {
    if (_active) stop();

    _onNewCards  = onNewCards;
    _onExhausted = onExhausted;
    _scrollStep  = 0;
    _active      = true;

    L && L.info(M, 'Observer v2.0 starting — waiting for page signals…');
    const isReady = await waitForPageReady();
    if (!isReady) L && L.warn(M, 'Page readiness timeout (15s). Proceeding anyway.');
    else          L && L.info(M, 'Page ready.');

    if (!_active) return;

    await new Promise(r => setTimeout(r, 500));

    _scrollEl = detectScrollContainer();

    const container = (window.__NexoraDomAdapter && window.__NexoraDomAdapter.getFeedContainer
      ? window.__NexoraDomAdapter.getFeedContainer()
      : null) || document.querySelector('[role="main"]') || document.body;

    attachMutationObserver(container);

    L && L.info(M, `Observer v2.0 started. MAX_SCROLL_STEPS=${cfg().MAX_SCROLL_STEPS || 60}`);

    // Initial harvest — posts already on screen
    setTimeout(() => { if (_active) doHarvest(); }, 300);
  }

  function stop() {
    _active = false;
    if (_scrollTimer)  { clearTimeout(_scrollTimer);      _scrollTimer  = null; }
    if (_mutationObs)  { _mutationObs.disconnect();       _mutationObs  = null; }
    L && L.info(M, `Observer stopped at step ${_scrollStep}`);
  }

  window.__NexoraObserver = {
    start,
    stop,
    scrollStep,
    onHarvestComplete,
    getStep:  () => _scrollStep,
    isActive: () => _active,
  };

  console.log('[Nexora][Observer v2.0] Brute-force scroll ready.');
})();
