// content.js v6.3 — Pure scroll engine.
// Fixes: longer settle, MIN_STEPS guard, page-readiness wait, robust atBottom.
(async function () {
  if (window.__NexoraScrollV6) {
    if (window.__NexoraScrollV6 === location.href) {
      // Already running on this URL — do nothing, let it finish
      return;
    }
    // Different URL — allow re-run
  }
  window.__NexoraScrollV6 = location.href;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));

  // ── Network bridge ────────────────────────────────────────────
  function onNetEvent(e) {
    const { url, body } = e.detail || {};
    if (body && body.length > 100) {
      chrome.runtime.sendMessage({ action: 'NET_BODY', url, body }).catch(() => {});
    }
  }
  window.removeEventListener('__nexora_net__', window.__nexoraNetHandler);
  window.__nexoraNetHandler = onNetEvent;
  window.addEventListener('__nexora_net__', onNetEvent);

  // ── Keep-alive ping ────────────────────────────────────────────
  const keepAlive = setInterval(() => {
    chrome.runtime.sendMessage({ action: 'KEEP_ALIVE' }).catch(() => clearInterval(keepAlive));
  }, 20000);

  // ── Scroll helpers ─────────────────────────────────────────────
  function doScroll() {
    window.scrollBy({ top: Math.floor(window.innerHeight * 0.85), behavior: 'smooth' });
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  function atBottom() {
    const sh = document.body.scrollHeight;
    const ih = window.innerHeight;
    const sy = window.scrollY;
    // Only trust "at bottom" if page has meaningfully rendered (height > 1.5x viewport)
    if (sh < ih * 1.5) return false;
    return (ih + sy) >= sh - 500;
  }

  function pageHasContent() {
    // Page is considered ready if scrollHeight > 1.5x viewport
    return document.body.scrollHeight > window.innerHeight * 1.5;
  }

  function clickNextOrMore() {
    const candidates = [
      '.artdeco-pagination__button--next',
      'button[aria-label="Next"]',
      'button[aria-label="Go to next page"]',
    ];
    for (const sel of candidates) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.click();
        console.log('[Scroll] Clicked pagination button:', sel);
        return true;
      }
    }
    const allBtns = [...document.querySelectorAll('button, [role="button"]')];
    const more = allBtns.find(b => /show more|load more|see more results/i.test(b.innerText || ''));
    if (more && !more.disabled) { more.click(); console.log('[Scroll] Clicked "show more"'); return true; }
    return false;
  }

  // ── Wait for page content to render ────────────────────────────
  // LinkedIn SPA can take 4-8s after tab.update "complete" to render search results.
  const MAX_WAIT_MS = 10000;
  const POLL_MS = 500;
  let waited = 0;
  await sleep(3000); // base settle time
  while (!pageHasContent() && waited < MAX_WAIT_MS) {
    await sleep(POLL_MS);
    waited += POLL_MS;
  }
  if (!pageHasContent()) {
    console.log('[Scroll] Page content never rendered (scrollHeight too small). Bailing.');
    clearInterval(keepAlive);
    window.removeEventListener('__nexora_net__', onNetEvent);
    chrome.runtime.sendMessage({ action: 'CONTENT_SCROLL_COMPLETE' }).catch(() => {});
    window.__NexoraScrollV6 = null;
    return;
  }
  console.log('[Scroll] Page ready. scrollHeight=', document.body.scrollHeight, 'waited=', waited, 'ms');

  // ── Main scroll loop ───────────────────────────────────────────
  const MAX_STEPS = 60;
  const MIN_STEPS = 6; // Never exit early before this many steps
  let step = 0;
  let noProgressCount = 0;
  let lastScrollY = -1;

  while (step < MAX_STEPS) {
    step++;
    doScroll();
    await sleep(rand(2200, 3800));

    const currentY = Math.round(window.scrollY);
    if (Math.abs(currentY - lastScrollY) < 80) {
      noProgressCount++;
    } else {
      noProgressCount = 0;
      lastScrollY = currentY;
    }

    // No-progress exit — but only after MIN_STEPS
    if (step >= MIN_STEPS && noProgressCount >= 5) {
      if (clickNextOrMore()) {
        noProgressCount = 0;
        await sleep(4000);
        continue;
      }
      console.log('[Scroll] No progress — stopping at step', step);
      break;
    }

    // Bottom check — only after MIN_STEPS
    if (step >= MIN_STEPS && atBottom()) {
      if (!clickNextOrMore()) {
        console.log('[Scroll] Hit bottom — stopping at step', step);
        break;
      }
      noProgressCount = 0;
      await sleep(4000);
    }
  }

  clearInterval(keepAlive);
  window.removeEventListener('__nexora_net__', onNetEvent);
  console.log('[Scroll] Complete. Steps:', step, 'Collected from:', location.href);
  chrome.runtime.sendMessage({ action: 'CONTENT_SCROLL_COMPLETE' }).catch(() => {});
  window.__NexoraScrollV6 = null;
})();
