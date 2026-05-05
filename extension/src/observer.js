/**
 * Nexora Observer v1.4  —  Brute-Force Scroll (SEARCH_B Fix)
 * ─────────────────────────────────────────────────────────────────────────────
 * v1.3 bug: stall detection stopped the loop at ~step 9-20 when SEARCH_B
 *   returned 0 DOM cards per scroll (async content, virtual DOM recycling).
 *
 * v1.4 fix (BRUTE FORCE):
 *   - Stall detection REMOVED entirely. Loop NEVER stops early.
 *   - Only stop condition: step >= MAX_SCROLL_STEPS (default 60).
 *   - Scroll runs unconditionally regardless of cards found or not.
 *   - MutationObserver retained only for harvest triggering (not for scroll control).
 *   - Scroll container detection retained from v1.3.
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
  let _scrollEl     = null;  // the confirmed scrollable element

  // ── Find the REAL scrollable container by probing each candidate ──────────
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
        const after = el.scrollTop;
        el.scrollTop = before;
        if (after > before) {
          L && L.info(M, `✓ Scroll container: ${el.tagName}${el.id ? '#'+el.id : ''}${el.className ? '.'+String(el.className).split(' ')[0] : ''}`);
          return el;
        }
      } catch (e) {}
    }

    L && L.warn(M, 'No scrollable container found — using documentElement');
    return document.documentElement;
  }

  // ── Scroll the detected container ─────────────────────────────────────────
  function scrollPage(amount) {
    const el = _scrollEl;
    if (!el) return;
    try {
      el.scrollTop += amount;
    } catch (e) {
      try { window.scrollBy({ top: amount, behavior: 'instant' }); } catch (e2) {}
    }
  }

  // ── Re-detect scroll container every 5 steps ──────────────────────────────
  function refreshScrollContainer() {
    _scrollEl = detectScrollContainer();
  }

  // ── MutationObserver — triggers extra harvests on DOM changes ─────────────
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
    const maxSteps = cfg().MAX_SCROLL_STEPS || 60;

    // ONLY stop when we hit the step cap — NO stall detection, NO early exit
    if (_scrollStep > maxSteps) {
      L && L.info(M, `Reached max scroll steps (${maxSteps}). Done.`);
      _onExhausted && _onExhausted('max_steps');
      return;
    }

    // Re-probe scroll container every 5 steps (LinkedIn SPA can swap elements)
    if (_scrollStep % 5 === 1) refreshScrollContainer();

    // Natural scroll: 70–110% of viewport height
    const jitter = 0.70 + Math.random() * 0.40;
    const amount = Math.floor(window.innerHeight * jitter);

    L && L.debug(M, `Step ${_scrollStep}/${maxSteps} | ${amount}px | container=${_scrollEl ? _scrollEl.tagName : '?'}`);
    scrollPage(amount);

    // Harvest after settle delay
    const settleMs = cfg().SCROLL_SETTLE_MS || 800;
    setTimeout(() => { if (_active) doHarvest(); }, settleMs);
  }

  // ── Called by engine after each harvest — ALWAYS schedules next scroll ────
  // No stall counter, no conditional. We scroll no matter what.
  function onHarvestComplete(newCardsFound) {
    if (!_active) return;

    // Log for diagnostics but DO NOT use for stop decisions
    L && L.debug(M, `Harvest complete: +${newCardsFound} cards | step=${_scrollStep}`);

    const base   = cfg().SCROLL_DELAY_MS || 1200;
    const jitter = Math.floor(Math.random() * 400) - 200;
    const delay  = Math.max(600, base + jitter);
    scheduleNextScroll(delay);
  }

  // ── Page Readiness Probe ──────────────────────────────────────────────────
  // Wait briefly but don't block too long — SEARCH_B loads content asynchronously
  async function waitForPageReady(maxWaitMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const signals = document.querySelectorAll(
        'button[aria-label*="reaction" i], button[aria-label*="like" i], ' +
        '[data-urn], a[href*="/posts/"], a[href*="/feed/update/"], li[data-occludable-update-urn]'
      ).length;
      if (signals > 0) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    // Proceed anyway — don't block indefinitely
    return false;
  }

  async function start(onNewCards, onExhausted) {
    if (_active) stop();

    _onNewCards  = onNewCards;
    _onExhausted = onExhausted;
    _scrollStep  = 0;
    _active      = true;

    L && L.info(M, 'Observer v1.4 (brute-force) starting — waiting for page signals...');
    const isReady = await waitForPageReady();
    if (!isReady) {
      L && L.warn(M, 'Page readiness timeout (15s). Proceeding anyway.');
    } else {
      L && L.info(M, 'Page ready.');
    }

    if (!_active) return;

    // Short stabilization delay
    await new Promise(r => setTimeout(r, 500));

    _scrollEl = detectScrollContainer();

    const adapter   = window.__NexoraDomAdapter;
    const container = (adapter && adapter.getFeedContainer && adapter.getFeedContainer())
                      || document.querySelector('[role="main"]')
                      || document.body;

    attachMutationObserver(container);

    L && L.info(M, `Observer v1.4 started. MAX_SCROLL_STEPS=${cfg().MAX_SCROLL_STEPS || 60}`);

    // Initial harvest (posts already on screen)
    setTimeout(() => { if (_active) doHarvest(); }, 200);
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
