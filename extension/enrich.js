// enrich.js — Nexora Post Enrichment v8.0
// ARCHITECTURE: MutationObserver waits for the LinkedIn social bar before running tiers.
// Tier5 (text-regex) is flagged as isFallback=true — background.js will treat it as uncertain.
// Deep diagnostics log all aria-label values and DOM state when tiers fail.
(async function () {
  if (window.__nexoraEnrichDone) return;
  window.__nexoraEnrichDone = true;

  const CALIBRATION = true;
  const t0 = Date.now();
  function ts()   { return '[+' + (Date.now() - t0) + 'ms]'; }
  function dbg()  { if (CALIBRATION) console.log('[ENRICH-DBG]', ts(), ...arguments); }
  function warn() { console.warn('[ENRICH-WARN]', ts(), ...arguments); }

  // ── Send final result ─────────────────────────────────────────────────────
  // isFallback=true means background.js must NOT delete based on this score.
  function done(score, method, meta) {
    const urn = window.__nexoraEnrichUrn || null;
    const isFallback = !!(meta && meta.isFallback);
    console.log('[ENRICH] FINAL urn=' + urn + ' score=' + score + ' via=' + method + (isFallback ? ' [FALLBACK]' : ''));
    if (CALIBRATION) {
      console.log('[ENRICH-CALIBRATION] URN=' + urn + ' Score=' + score + ' Method=' + method + ' URL=' + window.location.href + ' Elapsed=' + (Date.now()-t0) + 'ms');
    }
    try { chrome.runtime.sendMessage({ action: 'ENRICH_RESULT', urn, score }).catch(() => {}); } catch (_) {}
    window.__nexoraEnrichResult = { score, method, isFallback, done: true, ts: Date.now() };
  }

  // ── Digit normalizer ──────────────────────────────────────────────────────
  function normalizeDigits(s) {
    return (s || '')
      .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/,/g, '');
  }
  function parseNum(s) {
    if (!s) return null;
    const n = parseInt(normalizeDigits(String(s)).replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  // ── Auth-wall detector ────────────────────────────────────────────────────
  const REDIRECT_MARKERS = [
    'Sign in', 'Join LinkedIn', 'Log in', 'Sign up',
    'تسجيل الدخول', 'انضم إلى لينكدإن', 'سجّل الدخول',
    'Se connecter', 'Rejoindre LinkedIn', 'Iniciar sesión',
    'Anmelden', 'Entrar', 'Continue to LinkedIn',
    'Agree & Join', 'موافقة والانضمام',
    'authwall', 'auth-wall', 'checkpoint',
  ];
  function isRedirectPage() {
    const text = document.body?.innerText || '';
    const url  = window.location.href;
    return REDIRECT_MARKERS.some(m => text.includes(m) || url.includes(m.toLowerCase().replace(/\s/g, '')));
  }

  // ── MutationObserver: wait for LinkedIn social bar ────────────────────────
  // Waits for at least one button/span/a with an aria-label containing a
  // social keyword (reaction, comment, etc.) to appear in the DOM.
  // This replaces the fixed 20s polling loop — fires immediately when LinkedIn
  // hydrates the social action bar, even in background tabs.
  const SOCIAL_RE = /reaction|like|comment|repost|share|إعجاب|تعليق|تفاعل/i;
  function hasSocialBar() {
    const els = document.querySelectorAll('button[aria-label], span[aria-label], a[aria-label]');
    for (const el of els) {
      if (SOCIAL_RE.test(el.getAttribute('aria-label') || '')) return true;
    }
    return false;
  }
  function waitForSocialBar(timeoutMs) {
    return new Promise(resolve => {
      if (hasSocialBar()) { resolve('already-present'); return; }
      if (!document.body)  { resolve('no-body'); return; }
      const timer = setTimeout(() => { obs.disconnect(); resolve('timeout'); }, timeoutMs);
      const obs = new MutationObserver(() => {
        if (hasSocialBar()) { clearTimeout(timer); obs.disconnect(); resolve('mutation-found'); }
      });
      // attributes filter on aria-label catches SDUI lazy-setting
      obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });
    });
  }

  // ── Deep diagnostics — logs when tiers fail so we can debug ───────────────
  function logDeepDiagnostics(label) {
    if (!CALIBRATION) return;
    dbg('── DEEP DIAGNOSTICS [' + label + '] ───────────────────────────────');
    dbg('  URL          :', window.location.href);
    dbg('  Title        :', document.title);
    dbg('  readyState   :', document.readyState);
    const allAria = Array.from(document.querySelectorAll('[aria-label]'));
    dbg('  aria-label # :', allAria.length);
    allAria.slice(0, 25).forEach((el, i) =>
      dbg('  aria[' + i + '] <' + el.tagName + '> "' + (el.getAttribute('aria-label') || '').slice(0, 80) + '"'));
    dbg('  [data-urn]   :', document.querySelectorAll('[data-urn]').length);
    dbg('  button#      :', document.querySelectorAll('button').length);
    dbg('  DOM nodes    :', document.querySelectorAll('*').length);
    // Check known social bar selectors
    [
      '.social-details-social-counts',
      '.feed-shared-social-action-bar',
      '[data-test-id="social-actions"]',
      '.update-components-social-counts',
      '.social-details-social-activity',
    ].forEach(sel => dbg('  ' + (document.querySelector(sel) ? 'FOUND  ' : 'MISSING') + ' ' + sel));
    // Shadow DOM check
    const shadows = Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot).length;
    dbg('  shadowRoots  :', shadows);
    const text = document.body?.innerText || '';
    dbg('  innerText len:', text.length);
    dbg('  text[0:500]  :', JSON.stringify(text.slice(0, 500)));
    dbg('──────────────────────────────────────────────────────────────────');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 1 — aria-label scan (most reliable)
  // ════════════════════════════════════════════════════════════════════════════
  function tryTier1AriaLabel() {
    dbg('── Tier 1: aria-label scan');
    const candidates = Array.from(document.querySelectorAll('button[aria-label], span[aria-label], a[aria-label]'));
    dbg('  candidates:', candidates.length);
    const PATTERNS = [
      { kw: /reaction|إعجاب|تفاعل|réaction|reacción|Reaktion|reação/i, type: 'reaction' },
      { kw: /like|أعجبني/i,                                             type: 'like'     },
      { kw: /comment|تعليق|commentaire|comentario|Kommentar|comentário/i, type: 'comment'  },
      { kw: /repost|إعادة نشر|repartage|reposteo|Repost/i,              type: 'repost'   },
      { kw: /people reacted|شخص|أشخاص/i,                               type: 'reaction' },
    ];
    const found = {};
    for (const el of candidates) {
      const raw = el.getAttribute('aria-label') || '';
      const norm = normalizeDigits(raw);
      for (const { kw, type } of PATTERNS) {
        if (kw.test(norm)) {
          const m = norm.match(/(\d[\d,.]*)/);
          if (m) {
            const n = parseNum(m[1]);
            if (n !== null) {
              dbg('  T1 match type=' + type + ' n=' + n + ' raw="' + raw.slice(0, 60) + '"');
              if (!(type in found) || n > found[type]) found[type] = n;
            }
          }
        }
      }
    }
    const types = Object.keys(found);
    if (types.length === 0) { dbg('  T1: no matches'); return null; }
    const total = types.reduce((s, t) => s + found[t], 0);
    dbg('  T1 SUCCESS total=' + total + ' breakdown=' + JSON.stringify(found));
    return { score: total, meta: { tier: 1, breakdown: found } };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 2 — data-* attribute scan
  // ════════════════════════════════════════════════════════════════════════════
  function tryTier2DataAttributes() {
    dbg('── Tier 2: data-attribute scan');
    const ATTRS = ['data-reaction-count','data-num-reactions','data-likes-count',
                   'data-comments-count','data-reposts-count','data-total-reactions','data-social-count'];
    const found = {};
    for (const attr of ATTRS) {
      document.querySelectorAll('[' + attr + ']').forEach(el => {
        const n = parseNum(el.getAttribute(attr) || '');
        if (n !== null && (!(attr in found) || n > found[attr])) found[attr] = n;
      });
    }
    const keys = Object.keys(found);
    if (keys.length === 0) { dbg('  T2: no matches'); return null; }
    const total = keys.reduce((s, k) => s + found[k], 0);
    dbg('  T2 SUCCESS total=' + total);
    return { score: total, meta: { tier: 2, breakdown: found } };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 3 — CSS class selectors
  // ════════════════════════════════════════════════════════════════════════════
  function tryTier3CssSelectors() {
    dbg('── Tier 3: CSS selector scan');
    const SELECTORS = [
      '.social-details-social-counts__reactions-count',
      '.social-details-social-counts__comments',
      '.social-details-social-counts__count-value',
      '.social-details-social-counts__social-proof-text',
      '.update-components-social-counts__reactions-count',
      '.update-components-social-counts__comments-count',
      '[data-test-id="social-actions__reaction-count"]',
      '[data-test-id="social-actions__comments-count"]',
      '.social-details-social-activity',
      '.reactions-reactions-count',
    ];
    const allNodes = [];
    for (const sel of SELECTORS) {
      try { allNodes.push(...Array.from(document.querySelectorAll(sel))); } catch (_) {}
    }
    if (allNodes.length === 0) { dbg('  T3: no CSS matches'); return null; }
    const seen = new Set();
    let total = 0;
    const details = [];
    allNodes.forEach(node => {
      if (seen.has(node)) return; seen.add(node);
      const raw = normalizeDigits(node.getAttribute('aria-label') || node.innerText || '');
      const m = raw.match(/(\d[\d,.]*)/);
      if (m) {
        const n = parseNum(m[1]);
        if (n !== null) { total += n; details.push({ n, text: raw.trim().slice(0, 40) }); }
      }
    });
    if (details.length === 0) { dbg('  T3: nodes found but no numbers'); return null; }
    dbg('  T3 SUCCESS total=' + total);
    return { score: total, meta: { tier: 3, details } };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 4 — structural proximity scan
  // ════════════════════════════════════════════════════════════════════════════
  function tryTier4StructuralScan() {
    dbg('── Tier 4: structural scan');
    const SOCIAL_KW = /reaction|like|comment|repost|share|إعجاب|تعليق|تفاعل/i;
    const results = [];
    for (const el of document.querySelectorAll('button, span.t-normal, span.t-12')) {
      const label = el.getAttribute('aria-label') || '';
      const norm  = normalizeDigits((el.innerText || '').trim());
      if (/^\d[\d,.]*$/.test(norm) && SOCIAL_KW.test(label)) {
        const n = parseNum(norm);
        if (n !== null) results.push({ n, label });
      }
    }
    if (results.length === 0) { dbg('  T4: no matches'); return null; }
    const seenLabels = new Set();
    let total = 0;
    for (const r of results) {
      const key = r.label.toLowerCase().replace(/\d+/g, '').trim().slice(0, 20);
      if (!seenLabels.has(key)) { seenLabels.add(key); total += r.n; }
    }
    dbg('  T4 SUCCESS total=' + total);
    return { score: total, meta: { tier: 4, results } };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 5 — narrowed innerText regex (LAST RESORT — flagged as isFallback)
  // ════════════════════════════════════════════════════════════════════════════
  function tryTier5NarrowedText() {
    dbg('── Tier 5: narrowed text regex [FALLBACK]');
    const text = normalizeDigits(document.body?.innerText || '').slice(0, 3000);
    const PATTERNS = [
      { re: /(?:(\d[\d,.]*)[\s\u00a0]*(?:reaction|إعجاب|تفاعل|réaction|reacción|Reaktion))|(?:(?:reaction|إعجاب|تفاعل|réaction|reacción|Reaktion)[\s\u00a0]*(\d[\d,.]*))/i, type: 'reaction' },
      { re: /(?:(\d[\d,.]*)[\s\u00a0]*(?:like|أعجبني))|(?:(?:like|أعجبني)[\s\u00a0]*(\d[\d,.]*))/i,                                      type: 'like'     },
      { re: /(?:(\d[\d,.]*)[\s\u00a0]*(?:comment|تعليق|commentaire|comentario|Kommentar))|(?:(?:comment|تعليق|commentaire|comentario|Kommentar)[\s\u00a0]*(\d[\d,.]*))/i,   type: 'comment'  },
      { re: /(?:(\d[\d,.]*)[\s\u00a0]*(?:repost|إعادة نشر))|(?:(?:repost|إعادة نشر)[\s\u00a0]*(\d[\d,.]*))/i,                                type: 'repost'   },
      { re: /(?:(\d[\d,.]*)[\s\u00a0]*(?:people reacted))|(?:(?:people reacted)[\s\u00a0]*(\d[\d,.]*))/i,                                   type: 'reaction' },
    ];
    const found = {};
    for (const { re, type } of PATTERNS) {
      const m = text.match(re);
      if (m) { 
        const n = parseNum(m[1] || m[2]); 
        if (n !== null && (!(type in found) || n > found[type])) found[type] = n; 
      }
    }
    const types = Object.keys(found);
    if (types.length === 0) { dbg('  T5: no matches'); return null; }
    const total = types.reduce((s, t) => s + found[t], 0);
    dbg('  T5 [FALLBACK] total=' + total + ' breakdown=' + JSON.stringify(found));
    return { score: total, meta: { tier: 5, breakdown: found, isFallback: true } };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // API interceptor (highest confidence, pre-hydration)
  // ════════════════════════════════════════════════════════════════════════════
  function tryInterceptor(urn) {
    try {
      if (window.__nexoraApiUrns instanceof Map && urn && window.__nexoraApiUrns.has(urn)) {
        const score = window.__nexoraApiUrns.get(urn);
        if (score !== null && score !== undefined) { dbg('Interceptor HIT score=' + score); return score; }
      }
    } catch (_) {}
    return null;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MAIN — MutationObserver-driven detection
  // ════════════════════════════════════════════════════════════════════════════
  const urn = window.__nexoraEnrichUrn || null;
  dbg('Enrich v8 started. URN=' + urn + ' URL=' + window.location.href);

  // 1. Fast-path: interceptor (fires before DOM is ready)
  const interceptorScore = tryInterceptor(urn);
  if (interceptorScore !== null) { done(interceptorScore, 'interceptor', {}); return; }

  // 2. Immediate auth-wall check
  if (isRedirectPage()) { warn('Auth wall (immediate)'); done(null, 'redirect-wall', {}); return; }

  // 3. Wait for LinkedIn social bar via MutationObserver (up to 30s)
  //    MutationObserver fires the instant the social bar is inserted —
  //    far more reliable than polling in background tabs where timer precision drops.
  dbg('Waiting for social bar (MutationObserver, 30s max)...');
  const barStatus = await waitForSocialBar(30000);
  dbg('Social bar wait result: ' + barStatus);

  // 4. Re-check auth wall after wait (page may have redirected during hydration)
  if (isRedirectPage()) { warn('Auth wall (post-wait)'); done(null, 'redirect-wall', {}); return; }

  // 5. Run deep diagnostics (always, so we can see what the page looks like)
  logDeepDiagnostics(barStatus);

  // 6. Run tiers up to 3 times (with 1.5s pause between attempts)
  //    If bar timed out, only 1 attempt (page probably didn't hydrate).
  const maxAttempts = (barStatus === 'timeout' || barStatus === 'no-body') ? 1 : 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    dbg('── Tier pass #' + (attempt + 1) + '/' + maxAttempts);

    // Re-check interceptor on each attempt (API data might arrive late)
    const ic = tryInterceptor(urn);
    if (ic !== null) { done(ic, 'interceptor', { attempt }); return; }

    const t1 = tryTier1AriaLabel();
    if (t1) { done(t1.score, 'tier1-aria-label', { ...t1.meta, attempt }); return; }

    const t2 = tryTier2DataAttributes();
    if (t2) { done(t2.score, 'tier2-data-attrs', { ...t2.meta, attempt }); return; }

    const t3 = tryTier3CssSelectors();
    if (t3) { done(t3.score, 'tier3-css', { ...t3.meta, attempt }); return; }

    const t4 = tryTier4StructuralScan();
    if (t4) { done(t4.score, 'tier4-structural', { ...t4.meta, attempt }); return; }

    // Tier 5 — flagged as fallback: background.js will NOT delete based on this
    const t5 = tryTier5NarrowedText();
    if (t5) { done(t5.score, 'tier5-text-regex', { ...t5.meta, attempt, isFallback: true }); return; }

    dbg('All tiers null on attempt #' + (attempt + 1));
    if (attempt < maxAttempts - 1) {
      dbg('Waiting 1500ms before next attempt...');
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // 7. Complete failure — return null so background.js marks as uncertain (never deletes)
  warn('All tiers failed after ' + maxAttempts + ' attempts — returning null (uncertain).');
  done(null, 'all-tiers-failed', { barStatus, maxAttempts });
})();
