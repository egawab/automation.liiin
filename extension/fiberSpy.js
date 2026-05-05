// ── fiberSpy.js: MAIN World URN Harvester ──────────────────────────────────────
// Injected into the page's MAIN JavaScript world (not the isolated content script world).
// SOLE JOB: Extract post URNs from the React Fiber tree and DOM stamp them.
// Metrics extraction is handled by postScraper.js on the individual post pages.

(function () {
  if (window.__nexoraFiberSpyActive) return;
  window.__nexoraFiberSpyActive = true;

  console.log('[FiberSpy] ✅ MAIN world URN harvester active.');

  const URN_RE = /urn:li:(activity|ugcPost|share):(\d{7,30})/g;

  function canonicalFromUrn(type, id) {
    if (type === 'activity') return `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`;
    if (type === 'ugcPost')  return `https://www.linkedin.com/feed/update/urn:li:ugcPost:${id}/`;
    if (type === 'share')    return `https://www.linkedin.com/feed/update/urn:li:share:${id}/`;
    return null;
  }

  // Safe recursive string search — no JSON.stringify, no circular reference crashes
  function findUrnsInObj(obj, depth, foundUrls) {
    if (depth > 7 || obj == null) return;
    if (typeof obj === 'string') {
      URN_RE.lastIndex = 0;
      let m;
      while ((m = URN_RE.exec(obj)) !== null) {
        const url = canonicalFromUrn(m[1], m[2]);
        if (url) foundUrls.add(url);
      }
      return;
    }
    if (typeof obj !== 'object') return;
    for (const key in obj) {
      try {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        // Skip React internals that cause infinite loops
        if (key === 'return' || key === 'child' || key === 'sibling' ||
            key === '_owner' || key === '_store' || key === 'alternate') continue;
        findUrnsInObj(obj[key], depth + 1, foundUrls);
      } catch (e) {}
    }
  }

  function findFiberRoot() {
    // Try several stable entry points on the page
    const seeds = [
      ...document.querySelectorAll('button[aria-label]'),
      document.querySelector('main'),
      document.querySelector('[role="main"]'),
      document.body,
    ].filter(Boolean);

    for (const seed of seeds) {
      let el = seed;
      for (let d = 0; d < 30 && el && el !== document.documentElement; d++) {
        try {
          const fk = Object.keys(el).find(k =>
            k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
          );
          if (fk) return { el, fk };
        } catch (e) {}
        el = el.parentElement;
      }
    }
    return null;
  }

  const allSeenUrls = new Set(); // Global dedup across all scans

  function scanFiberTree() {
    const fiberRoot = findFiberRoot();
    if (!fiberRoot) {
      console.warn('[FiberSpy] ⚠️ No React fiber root found.');
      return;
    }

    const startFiber = fiberRoot.el[fiberRoot.fk];
    // Walk up to the true root of the component tree
    let topFiber = startFiber;
    for (let i = 0; i < 60 && topFiber && topFiber.return; i++) {
      topFiber = topFiber.return;
    }

    const newUrls = [];
    const visited = new WeakSet();
    const queue = [topFiber || startFiber];
    let scanned = 0;
    const MAX = 4000;

    while (queue.length > 0 && scanned < MAX) {
      const fiber = queue.shift();
      if (!fiber || typeof fiber !== 'object' || visited.has(fiber)) continue;
      visited.add(fiber);
      scanned++;

      const nodeUrls = new Set();

      // Scan memoizedProps
      if (fiber.memoizedProps) {
        try { findUrnsInObj(fiber.memoizedProps, 0, nodeUrls); } catch (e) {}
      }

      // Scan memoizedState linked list
      try {
        let state = fiber.memoizedState;
        let sl = 0;
        while (state && sl++ < 10) {
          if (state.memoizedState != null) {
            try { findUrnsInObj(state.memoizedState, 0, nodeUrls); } catch (e) {}
          }
          state = state.next;
        }
      } catch (e) {}

      // For each found URN: deduplicate, DOM stamp, and report
      nodeUrls.forEach(url => {
        if (allSeenUrls.has(url)) return;
        allSeenUrls.add(url);
        newUrls.push(url);

        // DOM STAMPING: find the nearest real DOM element in this fiber subtree
        // and stamp data-urn on it. This lets content.js DOM scrapers recognize it.
        let elFiber = fiber;
        let depth = 0;
        while (elFiber && depth < 15) {
          if (elFiber.stateNode && elFiber.stateNode.nodeType === 1) {
            try { elFiber.stateNode.setAttribute('data-urn', url); } catch (e) {}
            break;
          }
          elFiber = elFiber.child || elFiber.return;
          depth++;
        }
      });

      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }

    if (newUrls.length > 0) {
      console.log(`[FiberSpy] 🎯 ${newUrls.length} new URNs (total=${allSeenUrls.size}, scanned=${scanned} nodes)`);
      window.postMessage({ type: '__LI_FIBER_SPY_POSTS__', urls: newUrls }, '*');
    }
  }

  // Scan every 700ms
  setInterval(scanFiberTree, 700);
})();
