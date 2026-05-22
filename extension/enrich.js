// enrich.js — Nexora Post Enrichment v7.0
// 5-tier score detection | calibration logging | uncertain sentinel | retry/recheck
// Injected into individual LinkedIn post pages during enrich mode.
(async function () {
  if (window.__nexoraEnrichDone) return;
  window.__nexoraEnrichDone = true;

  const CALIBRATION = true; // Always log full diagnostics

  // ── Logging ──────────────────────────────────────────────────────────────────
  const t0 = Date.now();
  function ts() { return '[+' + (Date.now() - t0) + 'ms]'; }
  function dbg(...args) {
    if (CALIBRATION) console.log('[ENRICH-DBG]', ts(), ...args);
  }
  function warn(...args) {
    console.warn('[ENRICH-WARN]', ts(), ...args);
  }

  // ── Runtime check ─────────────────────────────────────────────────────────────
  function canSend() {
    try {
      return typeof chrome !== 'undefined' && chrome.runtime?.id &&
        typeof chrome.runtime.sendMessage === 'function';
    } catch (_) { return false; }
  }

  // ── Send final result ─────────────────────────────────────────────────────────
  function done(score, method, meta) {
    const urn = window.__nexoraEnrichUrn || null;
    console.log('[ENRICH] FINAL urn=' + urn + ' score=' + score + ' via=' + method, meta || '');
    if (CALIBRATION) {
      console.log('[ENRICH-CALIBRATION] ── Result Summary ─────────────────────────────');
      console.log('[ENRICH-CALIBRATION]  URN      :', urn);
      console.log('[ENRICH-CALIBRATION]  Score    :', score);
      console.log('[ENRICH-CALIBRATION]  Method   :', method);
      console.log('[ENRICH-CALIBRATION]  URL      :', window.location.href);
      console.log('[ENRICH-CALIBRATION]  Elapsed  :', (Date.now() - t0) + 'ms');
      if (meta) console.log('[ENRICH-CALIBRATION]  Meta     :', JSON.stringify(meta));
      console.log('[ENRICH-CALIBRATION] ──────────────────────────────────────────────');
    }
    if (canSend()) {
      chrome.runtime.sendMessage({ action: 'ENRICH_RESULT', urn, score }).catch(() => {});
    }
    // PRIMARY: write to window property so background.js can poll via executeScript.
    // This is timing-race-free and does not depend on the service worker being awake.
    window.__nexoraEnrichResult = { score, method, done: true, ts: Date.now() };
  }

  // ── Arabic/Persian digit normalizer ─────────────────────────────────────────
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

  // ── Redirect / Login-wall detector ───────────────────────────────────────────
  // Returns true if the page is a redirect/auth wall — score must be null (not 0).
  // Covers English, Arabic, French, Spanish, German, Portuguese.
  const REDIRECT_MARKERS = [
    'Sign in', 'Join LinkedIn', 'Log in', 'Sign up',
    'تسجيل الدخول', 'انضم إلى لينكدإن', 'سجّل الدخول',
    'Se connecter', 'Rejoindre LinkedIn',
    'Iniciar sesión', 'Unirse a LinkedIn',
    'Anmelden', 'Bei LinkedIn anmelden',
    'Entrar', 'Entrar no LinkedIn',
    'Continue to LinkedIn', 'Continue with LinkedIn',
    'Agree & Join', 'موافقة والانضمام',
    'authwall', 'auth-wall', 'checkpoint',
  ];

  function isRedirectPage() {
    const text = document.body?.innerText || '';
    const url  = window.location.href;
    const hit  = REDIRECT_MARKERS.find(m => text.includes(m) || url.includes(m.toLowerCase().replace(/\s/g, '')));
    if (hit) {
      dbg('🔒 Redirect/auth-wall detected via marker:', hit);
      return true;
    }
    return false;
  }

  // ── Page-loaded heuristic ────────────────────────────────────────────────────
  function isPageLoaded() {
    const text = document.body?.innerText || '';
    const len = text.length;
    const hasContent = len > 500;
    const hasFeed = !!document.querySelector(
      '[data-urn], .feed-shared-update-v2, article, .occludable-update, .ember-view'
    );
    dbg('isPageLoaded: textLen=' + len + ' hasContent=' + hasContent + ' hasFeed=' + hasFeed);
    return hasContent || hasFeed;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 1 — aria-label attribute scan (most reliable, class-name-independent)
  // LinkedIn always sets aria-label on social count buttons regardless of SDUI version.
  // ════════════════════════════════════════════════════════════════════════════
  function tryTier1AriaLabel() {
    dbg('── Tier 1: aria-label scan ─────────────────────────────');
    const candidates = Array.from(document.querySelectorAll('button[aria-label], span[aria-label], a[aria-label]'));
    dbg('Tier 1: found ' + candidates.length + ' aria-label elements');

    const PATTERNS = [
      { re: /(\d[\d,.]*)\s*(reaction|إعجاب|تفاعل|reaction|réaction|reacción|Reaktion|reação)/i, type: 'reaction' },
      { re: /(\d[\d,.]*)\s*(like|like|أعجبني)/i, type: 'like' },
      { re: /(\d[\d,.]*)\s*(comment|تعليق|commentaire|comentario|Kommentar|comentário)/i, type: 'comment' },
      { re: /(\d[\d,.]*)\s*(repost|إعادة نشر|repartage|reposteo|Repost|repostagem)/i, type: 'repost' },
      // Inverted: "View N reactions"  / "N people reacted"
      { re: /(\d[\d,.]*)\s*(people reacted|شخص|أشخاص)\s*(reacted)?/i, type: 'reaction' },
      { re: /View\s+(\d[\d,.]*)\s*(reaction|comment|repost)/i, type: 'view' },
    ];

    const found = {}; // type → number (avoid double-counting same type)

    for (const el of candidates) {
      const raw = el.getAttribute('aria-label') || '';
      const normalized = normalizeDigits(raw);
      for (const { re, type } of PATTERNS) {
        const m = normalized.match(re);
        if (m) {
          const n = parseNum(m[1]);
          if (n !== null) {
            dbg('Tier 1 match: type=' + type + ' n=' + n + ' raw="' + raw + '"');
            if (!(type in found) || n > found[type]) found[type] = n; // keep highest for each type
          }
        }
      }
    }

    const types = Object.keys(found);
    if (types.length === 0) {
      dbg('Tier 1: no matches');
      return null;
    }
    const total = types.reduce((sum, t) => sum + found[t], 0);
    dbg('Tier 1 SUCCESS: types=' + JSON.stringify(found) + ' total=' + total);
    return { score: total, meta: { tier: 1, breakdown: found } };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 2 — data-* attribute scan
  // Some LinkedIn SDUI builds embed counts as data attributes on containers.
  // ════════════════════════════════════════════════════════════════════════════
  function tryTier2DataAttributes() {
    dbg('── Tier 2: data-attribute scan ────────────────────────');
    const ATTRS = [
      'data-reaction-count', 'data-num-reactions', 'data-likes-count',
      'data-comments-count', 'data-reposts-count', 'data-total-reactions',
      'data-social-count',
    ];
    let total = 0;
    const found = {};

    for (const attr of ATTRS) {
      const els = document.querySelectorAll('[' + attr + ']');
      els.forEach(el => {
        const raw = el.getAttribute(attr) || '';
        const n = parseNum(raw);
        if (n !== null) {
          dbg('Tier 2 match: attr=' + attr + ' n=' + n);
          if (!(attr in found) || n > found[attr]) found[attr] = n;
        }
      });
    }

    const keys = Object.keys(found);
    if (keys.length === 0) {
      dbg('Tier 2: no matches');
      return null;
    }
    total = keys.reduce((sum, k) => sum + found[k], 0);
    dbg('Tier 2 SUCCESS: attrs=' + JSON.stringify(found) + ' total=' + total);
    return { score: total, meta: { tier: 2, breakdown: found } };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 3 — known CSS class selectors (may fail if LinkedIn changes classes,
  //          but kept as a middle tier for stability)
  // FIX: Each matched DOM element is counted independently (no value-dedup bug).
  // ════════════════════════════════════════════════════════════════════════════
  function tryTier3CssSelectors() {
    dbg('── Tier 3: CSS selector scan ──────────────────────────');
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
      '.comments-comments-count',
    ];

    const allNodes = [];
    for (const sel of SELECTORS) {
      try {
        const nodes = Array.from(document.querySelectorAll(sel));
        if (nodes.length > 0) dbg('Tier 3 selector "' + sel + '" matched ' + nodes.length + ' nodes');
        allNodes.push(...nodes);
      } catch (_) {}
    }

    if (allNodes.length === 0) {
      dbg('Tier 3: no CSS matches');
      return null;
    }

    // FIX: Dedup by DOM element reference, NOT by numeric value
    const seenElements = new Set();
    let total = 0;
    const details = [];

    allNodes.forEach(node => {
      if (seenElements.has(node)) return;
      seenElements.add(node);
      const raw = normalizeDigits(node.getAttribute('aria-label') || node.innerText || '');
      const m = raw.match(/(\d[\d,.]*)/);
      if (m) {
        const n = parseNum(m[1]);
        if (n !== null) {
          total += n;
          details.push({ text: raw.trim().slice(0, 40), n });
          dbg('Tier 3 node: n=' + n + ' text="' + raw.trim().slice(0, 60) + '"');
        }
      }
    });

    if (details.length === 0) {
      dbg('Tier 3: nodes found but no numbers extracted');
      return null;
    }
    dbg('Tier 3 SUCCESS: details=' + JSON.stringify(details) + ' total=' + total);
    return { score: total, meta: { tier: 3, details } };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 4 — structural proximity scan
  // Finds the social-action bar by DOM structure (sibling/parent of post content)
  // and reads purely numeric child text nodes. Class-name-independent.
  // ════════════════════════════════════════════════════════════════════════════
  function tryTier4StructuralScan() {
    dbg('── Tier 4: structural proximity scan ─────────────────');

    // LinkedIn's post page: the action bar is a div/ul containing buttons
    // that have only a number as their visible text + an icon.
    // Strategy: find elements whose entire innerText is just a number,
    // inside elements that also contain aria-label with social keywords.
    const SOCIAL_KEYWORDS = /reaction|like|comment|repost|share|إعجاب|تعليق|تفاعل/i;
    const results = [];

    const allButtons = Array.from(document.querySelectorAll('button, span.t-normal, span.t-12'));
    dbg('Tier 4: scanning ' + allButtons.length + ' buttons/spans');

    for (const el of allButtons) {
      const label = el.getAttribute('aria-label') || '';
      const inner = (el.innerText || '').trim();
      // Check if element text is purely numeric
      const norm = normalizeDigits(inner);
      const numOnly = /^\d[\d,.]*$/.test(norm);
      const n = parseNum(norm);
      if (numOnly && n !== null && SOCIAL_KEYWORDS.test(label)) {
        dbg('Tier 4 match: n=' + n + ' label="' + label.slice(0, 60) + '"');
        results.push({ n, label });
      }
    }

    if (results.length === 0) {
      dbg('Tier 4: no matches');
      return null;
    }

    // Sum unique labels (don't double-count same label type)
    const seenLabels = new Set();
    let total = 0;
    for (const r of results) {
      const key = r.label.toLowerCase().replace(/\d+/g, '').trim().slice(0, 20);
      if (!seenLabels.has(key)) {
        seenLabels.add(key);
        total += r.n;
      }
    }
    dbg('Tier 4 SUCCESS: results=' + JSON.stringify(results) + ' total=' + total);
    return { score: total, meta: { tier: 4, results } };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 5 — narrowed innerText regex (last resort)
  // Only scans the FIRST 3000 chars of body.innerText (post header area)
  // to avoid picking up engagement numbers from recommended posts below.
  // FIX: was scanning entire body text, picking up wrong post's numbers.
  // ════════════════════════════════════════════════════════════════════════════
  function tryTier5NarrowedText() {
    dbg('── Tier 5: narrowed innerText regex ──────────────────');
    const fullText = normalizeDigits(document.body?.innerText || '');
    // Only look at first 3000 characters — post + its immediate social bar
    const text = fullText.slice(0, 3000);
    dbg('Tier 5: scanning first ' + text.length + ' chars of innerText');

    const PATTERNS = [
      { re: /(\d[\d,.]*)\s*(?:reaction|إعجاب|تفاعل|réaction|reacción|Reaktion|reação)/i, type: 'reaction' },
      { re: /(\d[\d,.]*)\s*(?:like|أعجبني)/i, type: 'like' },
      { re: /(\d[\d,.]*)\s*(?:comment|تعليق|commentaire|comentario|Kommentar|comentário)/i, type: 'comment' },
      { re: /(\d[\d,.]*)\s*(?:repost|إعادة نشر)/i, type: 'repost' },
      { re: /(\d[\d,.]*)\s*(?:people reacted)/i, type: 'reaction' },
    ];

    const found = {};
    for (const { re, type } of PATTERNS) {
      const m = text.match(re);
      if (m) {
        const n = parseNum(m[1]);
        if (n !== null) {
          dbg('Tier 5 match: type=' + type + ' n=' + n + ' match="' + m[0] + '"');
          if (!(type in found) || n > found[type]) found[type] = n;
        }
      }
    }

    const types = Object.keys(found);
    if (types.length === 0) {
      dbg('Tier 5: no matches in first 3000 chars');
      return null;
    }
    const total = types.reduce((sum, t) => sum + found[t], 0);
    dbg('Tier 5 SUCCESS: types=' + JSON.stringify(found) + ' total=' + total);
    return { score: total, meta: { tier: 5, breakdown: found } };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STRATEGY 1 — API interceptor (highest confidence)
  // Catches the engagement count from LinkedIn's own API response during page load.
  // ════════════════════════════════════════════════════════════════════════════
  function tryInterceptor(urn) {
    try {
      if (window.__nexoraApiUrns instanceof Map && urn && window.__nexoraApiUrns.has(urn)) {
        const score = window.__nexoraApiUrns.get(urn);
        if (score !== null && score !== undefined) {
          dbg('Interceptor HIT: urn=' + urn + ' score=' + score);
          return score;
        }
      }
    } catch (_) {}
    return null;
  }

  // ── Page diagnostics snapshot ─────────────────────────────────────────────
  function logPageDiagnostics() {
    if (!CALIBRATION) return;
    const text = document.body?.innerText || '';
    dbg('── Page Diagnostics ──────────────────────────────────');
    dbg('URL          :', window.location.href);
    dbg('Title        :', document.title);
    dbg('innerText len:', text.length);
    dbg('DOM nodes    :', document.querySelectorAll('*').length);
    dbg('data-urn els :', document.querySelectorAll('[data-urn]').length);
    dbg('button els   :', document.querySelectorAll('button').length);
    dbg('aria-label   :', document.querySelectorAll('[aria-label]').length);
    dbg('readyState   :', document.readyState);
    // Log first 300 chars of innerText for context
    dbg('Text preview :', JSON.stringify(text.slice(0, 300)));
    dbg('─────────────────────────────────────────────────────');
  }

  // ── Main detection loop ───────────────────────────────────────────────────
  const urn = window.__nexoraEnrichUrn || null;
  dbg('Enrich started. URN=' + urn);

  // Total polling window: 20 seconds (was 12)
  const deadline = Date.now() + 20000;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    dbg('─── Poll attempt #' + attempt + ' (' + (Date.now() - t0) + 'ms elapsed) ───────────────────');

    // Check interceptor first (fastest, most accurate)
    const interceptorScore = tryInterceptor(urn);
    if (interceptorScore !== null) {
      done(interceptorScore, 'interceptor', { attempt });
      return;
    }

    // Check if page is even loaded yet
    if (!isPageLoaded()) {
      dbg('Page not loaded yet — waiting...');
      await new Promise(r => setTimeout(r, 800));
      continue;
    }

    // Check for redirect/auth-wall (return null — not 0)
    if (isRedirectPage()) {
      warn('Auth wall detected — returning null (not 0) to prevent false delete');
      if (CALIBRATION) logPageDiagnostics();
      done(null, 'redirect-wall', { attempt });
      return;
    }

    // Run full page diagnostics on first loaded attempt
    if (attempt <= 2) logPageDiagnostics();

    // Run tiers in priority order — use first one that succeeds
    const tier1 = tryTier1AriaLabel();
    if (tier1 !== null) { done(tier1.score, 'tier1-aria-label', { ...tier1.meta, attempt }); return; }

    const tier2 = tryTier2DataAttributes();
    if (tier2 !== null) { done(tier2.score, 'tier2-data-attrs', { ...tier2.meta, attempt }); return; }

    const tier3 = tryTier3CssSelectors();
    if (tier3 !== null) { done(tier3.score, 'tier3-css', { ...tier3.meta, attempt }); return; }

    const tier4 = tryTier4StructuralScan();
    if (tier4 !== null) { done(tier4.score, 'tier4-structural', { ...tier4.meta, attempt }); return; }

    const tier5 = tryTier5NarrowedText();
    if (tier5 !== null) { done(tier5.score, 'tier5-text-regex', { ...tier5.meta, attempt }); return; }

    dbg('All tiers returned null — waiting 700ms before next poll...');
    await new Promise(r => setTimeout(r, 700));
  }

  // ── Timed out — page could not be read ────────────────────────────────────
  // CRITICAL: return null (not 0) so background.js marks this as uncertain (-1)
  // and does NOT delete it. Score of 0 is reserved for posts that DEFINITELY
  // have zero engagement AND were detected cleanly.
  warn('20s timeout — returning null. Post will be marked uncertain (-1), NOT deleted.');
  if (CALIBRATION) logPageDiagnostics();
  done(null, 'timeout-20s', { attempt });
})();
