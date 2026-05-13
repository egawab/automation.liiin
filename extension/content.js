// content.js — URSS Scroll Engine (navigation only, zero data collection)
// Layer: Scroll Engine. Responsibilities: scroll, paginate, signal completion.
(async function () {
  if (window.__NexoraURSS_Scroll) {
    if (window.__NexoraURSS_Scroll === location.href) return;
  }
  window.__NexoraURSS_Scroll = location.href;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canSend = () => typeof chrome !== 'undefined' && !!chrome?.runtime?.sendMessage;

  function getScrollEl() {
    const candidates = [
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('.scaffold-layout-container__main'),
      document.querySelector('main'),
      document.scrollingElement,
      document.documentElement
    ];
    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight + 100) return el;
    }
    return document.documentElement;
  }

  function doScroll() {
    const el = getScrollEl();
    el.scrollTop += Math.floor(el.clientHeight * 0.85);
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    return el.scrollTop;
  }

  function atBottom() {
    const el = getScrollEl();
    if (el.scrollHeight < el.clientHeight * 1.3) return false;
    return (el.scrollTop + el.clientHeight) >= el.scrollHeight - 600;
  }

  function pageHasContent() {
    const el = getScrollEl();
    return el.scrollHeight > el.clientHeight * 1.5;
  }

  function clickNext() {
    const sels = [
      '.artdeco-pagination__button--next',
      'button[aria-label="Next"]',
      'button[aria-label="Go to next page"]'
    ];
    for (const s of sels) {
      const b = document.querySelector(s);
      if (b && !b.disabled) { b.click(); return true; }
    }
    const more = [...document.querySelectorAll('button,[role="button"]')]
      .find(b => /show more|load more|see more/i.test(b.innerText || ''));
    if (more && !more.disabled) { more.click(); return true; }
    return false;
  }

  // Wait for page content
  const MAX_WAIT = 12000;
  let waited = 0;
  await sleep(2500);
  while (!pageHasContent() && waited < MAX_WAIT) {
    await sleep(500);
    waited += 500;
  }
  if (!pageHasContent()) {
    if (canSend()) chrome.runtime.sendMessage({ action: 'SCROLL_COMPLETE', reason: 'empty_page' }).catch(() => {});
    window.__NexoraURSS_Scroll = null;
    return;
  }

  const MAX_STEPS = 55, MIN_STEPS = 6, NO_PROG_MAX = 8;
  let step = 0, noProgress = 0, lastTop = -1;
  let stopReason = 'max_steps';

  while (step < MAX_STEPS) {
    step++;
    const st = doScroll();
    await sleep(2600 + Math.floor(Math.random() * 1200));

    if (Math.abs(st - lastTop) > 60) { noProgress = 0; lastTop = st; }
    else { noProgress++; }

    // Signal each step so background can collect DOM
    if (canSend()) chrome.runtime.sendMessage({ action: 'SCROLL_STEP', step }).catch(() => {});

    if (step >= MIN_STEPS) {
      if (noProgress >= NO_PROG_MAX || atBottom()) {
        if (clickNext()) { noProgress = 0; await sleep(4500); continue; }
        stopReason = atBottom() ? 'reached_bottom' : 'no_progress';
        break;
      }
    }
  }

  if (canSend()) chrome.runtime.sendMessage({ action: 'SCROLL_COMPLETE', reason: stopReason, steps: step }).catch(() => {});
  window.__NexoraURSS_Scroll = null;
})();
