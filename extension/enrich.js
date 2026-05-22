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

  // ── Strategy 2: Parse engagement counts from DOM nodes ───────────────────────
  // Looks specifically at LinkedIn's social count elements and supports Arabic/English.
  function tryDomText() {
    try {
      const text = document.body.innerText || '';
      if (text.length < 500) return null; // Page not loaded yet

      let total = 0;
      let found = false;
      const usedNumbers = new Set();

      // Convert Arabic digits to English for parsing
      function normalizeDigits(s) {
        return (s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/,/g, '');
      }

      // 1. Look for specific LinkedIn social count elements
      const countNodes = document.querySelectorAll(`
        .social-details-social-counts__reactions-count, 
        .social-details-social-counts__comments, 
        .social-details-social-counts__count-value, 
        [data-test-id="social-actions__reaction-count"], 
        [data-test-id="social-actions__comments-count"],
        .update-components-social-counts__reactions-count,
        .update-components-social-counts__comments-count,
        button[aria-label*="reaction"], 
        button[aria-label*="comment"],
        button[aria-label*="إعجاب"],
        button[aria-label*="تعليق"]
      `);

      if (countNodes.length > 0) {
        countNodes.forEach(node => {
          const txt = normalizeDigits(node.getAttribute('aria-label') || node.innerText || '');
          const m = txt.match(/([0-9]+)/);
          if (m) {
            const n = parseInt(m[1], 10);
            if (!usedNumbers.has(n)) {
              usedNumbers.add(n);
              total += n;
              found = true;
            }
          }
        });
      }

      // 2. Fallback: if no specific nodes, look globally using bilingual regex
      if (!found) {
        const normText = normalizeDigits(text);
        const patterns = [
          /([0-9]+)\s*(?:reaction|إعجاب|تفاعل)/i,
          /([0-9]+)\s*(?:like|لايك)/i,
          /([0-9]+)\s*(?:comment|تعليق)/i,
          /([0-9]+)\s*(?:repost|إعادة نشر)/i,
          /([0-9]+)\s*(?:share|مشاركة)/i,
        ];
        for (const re of patterns) {
          const m = normText.match(re);
          if (m) {
            const n = parseInt(m[1], 10);
            if (!usedNumbers.has(n)) {
              usedNumbers.add(n);
              total += n;
              found = true;
            }
          }
        }
      }

      // If page is fully loaded and no numbers found at all -> genuinely 0 reach
      if (!found && text.length > 1000 && !text.includes('Sign in') && !text.includes('Join LinkedIn')) {
        return 0;
      }

      return found ? total : null;
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
