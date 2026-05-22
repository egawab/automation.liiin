// enrich.js — Nexora Post Enrichment Content Script
// Injected into individual LinkedIn post pages during RE_ENRICH mode.
// DOES NOT touch or interfere with the main scraping pipeline.
(async function () {
  if (window.__nexoraEnrichDone) return;
  window.__nexoraEnrichDone = true;

  function canSend() {
    try {
      return typeof chrome !== 'undefined' && chrome.runtime?.id &&
        typeof chrome.runtime.sendMessage === 'function';
    } catch (_) { return false; }
  }

  function done(score, method) {
    const urn = window.__nexoraEnrichUrn || null;
    console.log('[ENRICH] result urn=' + urn + ' score=' + score + ' via=' + method);
    if (canSend()) {
      chrome.runtime.sendMessage({ action: 'ENRICH_RESULT', urn, score }).catch(() => {});
    }
  }

  // ── Strategy 1: Check interceptor Map (caught during page load API call) ──────
  function tryInterceptor(urn) {
    try {
      if (window.__nexoraApiUrns instanceof Map && urn && window.__nexoraApiUrns.has(urn)) {
        const score = window.__nexoraApiUrns.get(urn);
        if (score !== null && score !== undefined) return score;
      }
    } catch (_) {}
    return null;
  }

  // ── Strategy 2: Parse engagement counts from rendered DOM text ────────────────
  // LinkedIn always renders "X reactions", "Y comments", "Z reposts" as visible text.
  function tryDomText() {
    try {
      const text = document.body.innerText || '';
      if (text.length < 100) return null; // Page not loaded yet

      let total = 0;
      let found = false;

      const patterns = [
        /([0-9][0-9,]*)\s*reaction/i,
        /([0-9][0-9,]*)\s*like/i,
        /([0-9][0-9,]*)\s*comment/i,
        /([0-9][0-9,]*)\s*repost/i,
        /([0-9][0-9,]*)\s*share/i,
      ];

      const usedNumbers = new Set();
      for (const re of patterns) {
        const m = text.match(re);
        if (m) {
          const n = parseInt(m[1].replace(/,/g, ''), 10);
          if (!usedNumbers.has(m[1])) {
            usedNumbers.add(m[1]);
            total += n;
            found = true;
          }
        }
      }

      return found ? total : null; // null = page loaded but can't read score yet
    } catch (_) { return null; }
  }

  // ── Main wait loop ────────────────────────────────────────────────────────────
  // Polls both strategies every 500ms for up to 12 seconds.
  const urn = window.__nexoraEnrichUrn || null;
  const deadline = Date.now() + 12000;

  while (Date.now() < deadline) {
    // Strategy 1: interceptor
    const s1 = tryInterceptor(urn);
    if (s1 !== null) { done(s1, 'interceptor'); return; }

    // Strategy 2: DOM text
    const s2 = tryDomText();
    if (s2 !== null) { done(s2, 'dom'); return; }

    await new Promise(r => setTimeout(r, 500));
  }

  // Timeout — post is private, restricted, login-walled, or truly 0 engagement
  // Return null so auto-delete does NOT remove it (we can't confirm 0 score)
  done(null, 'timeout');
})();
