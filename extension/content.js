// content.js v6 — Pure scroll engine. No DOM extraction. No getCdpCount pings.
// Injected by background.js via chrome.scripting.executeScript after page load.
(async function () {
  if (window.__NexoraScrollV6) {
    if (window.__NexoraScrollV6 === location.href) return;
    clearInterval(window.__NexoraScrollTimer);
  }
  window.__NexoraScrollV6 = location.href;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));

  // ── Network bridge: forward interceptor events to background ──────────
  function onNetEvent(e) {
    const { url, body } = e.detail || {};
    if (body && body.length > 100) {
      chrome.runtime.sendMessage({ action: 'NET_BODY', url, body }).catch(() => {});
    }
  }
  window.removeEventListener('__nexora_net__', window.__nexoraNetHandler);
  window.__nexoraNetHandler = onNetEvent;
  window.addEventListener('__nexora_net__', onNetEvent);

  // ── Keep-alive ping to prevent SW suspension ──────────────────────────
  const keepAlive = setInterval(() => {
    chrome.runtime.sendMessage({ action: 'KEEP_ALIVE' }).catch(() => clearInterval(keepAlive));
  }, 20000);

  // ── Scroll helpers ─────────────────────────────────────────────────────
  function doScroll() {
    window.scrollBy({ top: Math.floor(window.innerHeight * 0.85), behavior: 'smooth' });
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  function atBottom() {
    return (window.innerHeight + window.scrollY) >= document.body.scrollHeight - 400;
  }

  function clickNextOrMore() {
    const candidates = [
      '.artdeco-pagination__button--next',
      'button[aria-label="Next"]',
    ];
    for (const sel of candidates) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.click();
        console.log('[Scroll] Clicked Next/pagination button');
        return true;
      }
    }
    const allBtns = [...document.querySelectorAll('button, [role="button"]')];
    const more = allBtns.find(b => /show more|load more|see more/i.test(b.innerText || ''));
    if (more) { more.click(); return true; }
    return false;
  }

  // ── Main scroll loop ───────────────────────────────────────────────────
  const MAX_STEPS = 60;
  let step = 0;
  let noProgressCount = 0;
  let lastScrollY = -1;

  await sleep(2000); // let page settle after navigation

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

    if (noProgressCount >= 5) {
      if (clickNextOrMore()) {
        noProgressCount = 0;
        await sleep(3000);
        continue;
      }
      console.log('[Scroll] No progress detected — stopping early at step', step);
      break;
    }

    if (atBottom()) {
      if (!clickNextOrMore()) {
        console.log('[Scroll] Hit bottom — stopping at step', step);
        break;
      }
      noProgressCount = 0;
      await sleep(3000);
    }
  }

  clearInterval(keepAlive);
  window.removeEventListener('__nexora_net__', onNetEvent);
  console.log('[Scroll] Complete. Steps:', step);
  chrome.runtime.sendMessage({ action: 'CONTENT_SCROLL_COMPLETE' }).catch(() => {});
  window.__NexoraScrollV6 = null;
})();
