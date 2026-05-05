/**
 * Nexora DOM Adapter v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * All DOM interaction in one place. Zero CSS class-name selectors.
 * Uses only: role, aria-*, data-urn/entity-urn/update-urn, semantic elements.
 *
 * Exposes four card-discovery strategies (tried in priority order):
 *   1. containerAttr  — [role=article][data-urn] and similar (fastest)
 *   2. urnAttr        — any element with data-* containing urn:li:
 *   3. buttonWalkup   — find engagement buttons → walk up to card boundary
 *   4. deepTreeWalker — TreeWalker over all element attributes (nuclear)
 *
 * discoverCards() runs strategies in order, deduplicates, and returns
 * the union of all found cards.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraDomAdapter) return;

  const L   = window.__NexoraLogger;
  const M   = 'DomAdapter';
  const cfg = () => window.__NexoraConfig || {};

  const STOP_TAGS = new Set(['BODY', 'HTML', 'HEADER', 'NAV', 'FOOTER', 'ASIDE']);
  const URN_RE    = /urn:li:(activity|ugcPost|share):(\d{10,25})/i;
  const FSD_RE    = /urn:li:fsd_update:[:(]urn:li:(activity|ugcPost|share):(\d{10,25})/i;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getUrnFromElement(el) {
    if (!el || el.nodeType !== 1) return '';
    return (
      el.getAttribute('data-urn') ||
      el.getAttribute('data-entity-urn') ||
      el.getAttribute('data-update-urn') ||
      el.getAttribute('data-chameleon-result-urn') ||
      ''
    );
  }

  function isPostUrn(urn) {
    return URN_RE.test(urn) || FSD_RE.test(urn);
  }

  function isPostCard(el) {
    if (!el || el.nodeType !== 1) return false;
    if (isPostUrn(getUrnFromElement(el))) return true;
    if (el.getAttribute('role') === 'article') return true;
    const dvn = el.getAttribute('data-view-name') || '';
    return dvn === 'feed-full-update' || dvn.includes('search-entity-result');
  }

  function isSponsored(el) {
    if (!el) return false;
    // Check aria-label on card and immediate children (avoid full subtree scan)
    const check = (e) => {
      const lbl = (e.getAttribute('aria-label') || '').toLowerCase();
      return lbl.includes('promoted') || lbl.includes('sponsored');
    };
    if (check(el)) return true;
    for (const child of el.children) { if (check(child)) return true; }
    // Visible text heuristic (cheap slice)
    const snippet = (el.textContent || '').slice(0, 300).toLowerCase();
    return /\bpromoted\b|\bsponsored\b/.test(snippet);
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) { return true; } // assume visible on error
  }

  function walkUpToCard(startEl) {
    let node = startEl ? startEl.parentElement : null;
    for (let d = 0; d < 25 && node && !STOP_TAGS.has(node.tagName); d++) {
      if (isPostCard(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  // Count main-action like buttons inside a node (excluding comment sections)
  function countLikeButtons(node) {
    const likeSignals = cfg().LIKE_SIGNALS || ['reaction', 'like'];
    let n = 0;
    node.querySelectorAll('button[aria-label]').forEach(btn => {
      // Skip buttons nested in comments
      if (btn.closest('[aria-label*="Write a comment" i], [aria-label*="Reply" i]')) return;
      const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (likeSignals.some(s => lbl.includes(s))) n++;
    });
    return n;
  }

  // ── Strategy 1: Direct attribute container query ───────────────────────────
  function strategyContainerAttr() {
    const found = [];
    const selectors = (cfg().SELECTORS || {}).POST_CONTAINERS || [
      '[role="article"][data-urn]',
      '[data-view-name="feed-full-update"]',
      '[role="article"][data-entity-urn]',
      '[role="article"]',
      '[data-update-urn]',
    ];
    const seen = new Set();
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach(el => {
          if (!seen.has(el)) { seen.add(el); found.push(el); }
        });
      } catch (e) {}
    }
    L && L.debug(M, `S1 containerAttr: ${found.length}`);
    return found;
  }

  // ── Strategy 2: URN attribute scan ────────────────────────────────────────
  function strategyUrnAttr() {
    const found = [];
    const seen = new Set();
    const attrSel = '[data-urn],[data-entity-urn],[data-update-urn],[data-chameleon-result-urn]';
    document.querySelectorAll(attrSel).forEach(el => {
      if (!isPostUrn(getUrnFromElement(el))) return;
      const card = walkUpToCard(el) || el;
      if (!seen.has(card)) { seen.add(card); found.push(card); }
    });
    L && L.debug(M, `S2 urnAttr: ${found.length}`);
    return found;
  }

  // ── Strategy 3: Engagement button walk-up (SEARCH_B fix v1.2) ───────────
  // v1.1 bug: likeCount >= 1 fired on the FIRST parent node (the tiny reaction
  //   bar DIV itself), returning an element with no post URL or text.
  // v1.2 fix: Walk all 25 levels. Accept a node only if it's big enough to
  //   be a real post container (scrollHeight > 120 AND 2+ anchor tags).
  function strategyButtonWalkup() {
    const found = [];
    const seen = new Set();
    const likeSignals    = cfg().LIKE_SIGNALS    || ['reaction', 'like'];
    const commentSignals = cfg().COMMENT_SIGNALS || ['comment'];

    document.querySelectorAll('button[aria-label]').forEach(btn => {
      const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
      const isEngagement = likeSignals.some(s => lbl.includes(s)) ||
                           commentSignals.some(s => lbl.includes(s));
      if (!isEngagement) return;

      // Priority 1: Walk ALL ancestor <li> elements and take the OUTERMOST
      // one with substantial text content (> 120 chars).
      //
      // SEARCH_B DOM structure:
      //   <li class="post-card">           ← we want THIS (full post text)
      //     <div>post content…</div>
      //     <ul class="reaction-bar">
      //       <li>                         ← btn.closest('li') returns THIS (wrong)
      //         <button aria-label="React Like">…</button>
      //       </li>
      //     </ul>
      //   </li>
      //
      // Fix: keep walking past reaction list items by looking for the outermost
      // ancestor li that has real content.
      {
        let ancestor = btn.parentElement;
        let postCardLi = null;
        while (ancestor && !STOP_TAGS.has(ancestor.tagName)) {
          if (ancestor.tagName === 'LI') {
            const textLen = (ancestor.textContent || '').replace(/\s+/g, ' ').trim().length;
            if (textLen > 120) {
              postCardLi = ancestor; // keep walking — want the OUTERMOST valid li
            }
          }
          ancestor = ancestor.parentElement;
        }
        if (postCardLi && !seen.has(postCardLi)) {
          seen.add(postCardLi);
          found.push(postCardLi);
          return;
        }
      }

      // Priority 2: walk up to find a node with a post link anchor
      // Also accept any a[href*="activity:"] or data-href containing URNs
      let node = btn.parentElement;
      let bestCandidate = null;

      for (let d = 0; d < 25 && node && !STOP_TAGS.has(node.tagName); d++) {
        const postAnchor = node.querySelector(
          'a[href*="/feed/update/"], a[href*="/posts/"], a[href*="activity:"]'
        );
        if (postAnchor) {
          if (!seen.has(node)) { seen.add(node); found.push(node); }
          return;
        }
        // Track first node that is large enough to be a full post card
        // scrollHeight >= 0 ensures we don't reject unloaded cards
        // gate on having multiple anchors or engagement buttons
        if (!bestCandidate &&
            node.scrollHeight >= 0 &&
            (node.querySelectorAll('a[href]').length >= 2 ||
             node.querySelectorAll('button[aria-label]').length >= 1)) {
          bestCandidate = node;
        }
        node = node.parentElement;
      }

      // Fall back to best size-based candidate if no post link found
      if (bestCandidate && !seen.has(bestCandidate)) {
        seen.add(bestCandidate);
        found.push(bestCandidate);
      }
    });
    L && L.debug(M, `S3 buttonWalkup: ${found.length}`);
    return found;
  }

  // ── Strategy 4: Deep TreeWalker attribute scan (nuclear fallback) ──────────
  function strategyDeepTreeWalker(rootEl) {
    const found = [];
    const seen  = new Set();
    rootEl = rootEl || document.body;
    try {
      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT, null, false);
      let node = walker.currentNode;
      while (node) {
        if (node.attributes) {
          for (let i = 0; i < node.attributes.length; i++) {
            const val = node.attributes[i].value || '';
            if (URN_RE.test(val) || FSD_RE.test(val)) {
              const card = walkUpToCard(node) || node;
              if (!seen.has(card)) { seen.add(card); found.push(card); }
              break; // one match per element is enough
            }
          }
        }
        node = walker.nextNode();
      }
    } catch (e) { L && L.warn(M, 'S4 deepTreeWalker error', e.message); }
    L && L.debug(M, `S4 deepTreeWalker: ${found.length}`);
    return found;
  }

  // ── Main discovery function ────────────────────────────────────────────────
  function discoverCards(layout) {
    const LAYOUTS = (window.__NexoraLayoutDetector || {}).LAYOUTS || {};
    const dedupMap = new Map(); // card element → true

    // Always run S1 + S2
    [...strategyContainerAttr(), ...strategyUrnAttr()].forEach(c => dedupMap.set(c, true));

    // S3 for Layout B (no data-urn) or UNKNOWN
    if (layout === LAYOUTS.SEARCH_B || layout === LAYOUTS.UNKNOWN || dedupMap.size === 0) {
      strategyButtonWalkup().forEach(c => dedupMap.set(c, true));
    }

    // S4 only if still nothing found
    if (dedupMap.size === 0) {
      strategyDeepTreeWalker().forEach(c => dedupMap.set(c, true));
    }

    // Filter: attached to DOM, visible, not sponsored
    const cards = Array.from(dedupMap.keys()).filter(c => {
      if (!document.contains(c)) return false;
      if (isSponsored(c)) {
        L && L.debug(M, 'Skipping sponsored card');
        return false;
      }
      return true;
    });

    L && L.info(M, `discoverCards → ${cards.length} (layout=${layout})`);
    return cards;
  }

  // ── Feed container (for observer attachment) ──────────────────────────────
  function getFeedContainer() {
    const sels = ((cfg().SELECTORS || {}).FEED_CONTAINER) || ['[role="main"]', 'main'];
    for (const sel of sels) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (e) {}
    }
    return document.body;
  }

  // ── Post anchor → canonical URL ───────────────────────────────────────────
  function extractCanonicalUrl(card) {
    if (!card) return null;

    function buildUrl(type, id) {
      const t = type.toLowerCase();
      if (t === 'ugcpost') return `https://www.linkedin.com/feed/update/urn:li:ugcPost:${id}`;
      if (t === 'share')   return `https://www.linkedin.com/feed/update/urn:li:share:${id}`;
      return `https://www.linkedin.com/feed/update/urn:li:activity:${id}`;
    }

    function cleanUrl(u) {
      try {
        const parsed = new URL(u.startsWith('http') ? u : 'https://www.linkedin.com' + u);
        ['trackingId','lipi','licu','refId','trk','trkInfo','src'].forEach(p => parsed.searchParams.delete(p));
        return parsed.toString().split('?')[0].split('#')[0].replace(/\/$/, '');
      } catch (e) { return u.split('?')[0].split('#')[0].replace(/\/$/, ''); }
    }

    function isValid(u) {
      if (!u || !u.includes('linkedin.com')) return false;
      return /\/(posts|feed\/update)\/[^?#]+/.test(u);
    }

    // 1. Direct anchor hrefs (inside card)
    for (const a of card.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (href.includes('/feed/update/') || href.includes('/posts/')) {
        const u = cleanUrl(href.startsWith('http') ? href : 'https://www.linkedin.com' + href);
        if (isValid(u)) return u;
      }
    }

    // 2. Data-* URN attributes — scan card + ancestors + descendants
    const nodes = [card];
    // Walk up: SEARCH_B — the <li> ancestor may have data-urn or tracking attrs
    let ancestor = card.parentElement;
    for (let i = 0; i < 8 && ancestor && !STOP_TAGS.has(ancestor.tagName); i++) {
      nodes.push(ancestor);
      ancestor = ancestor.parentElement;
    }
    card.querySelectorAll('[data-urn],[data-entity-urn],[data-update-urn],[data-view-tracking-scope]')
        .forEach(n => nodes.push(n));

    for (const node of nodes) {
      const attrs = node.attributes || [];
      for (let i = 0; i < attrs.length; i++) {
        const val = (attrs[i].value || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        let m = FSD_RE.exec(val) || URN_RE.exec(val);
        if (m) {
          const u = buildUrl(m[1], m[2]);
          if (isValid(u)) return cleanUrl(u);
        }
      }
    }

    // 3. SEARCH_B fallback: scan closest <li> anchor tags and URN attrs
    const liScope = card.closest('li');
    if (liScope && liScope !== card) {
      for (const a of liScope.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || '';
        if (href.includes('/feed/update/') || href.includes('/posts/')) {
          const u = cleanUrl(href.startsWith('http') ? href : 'https://www.linkedin.com' + href);
          if (isValid(u)) return u;
        }
      }
    }

    // 4. Nuclear: TreeWalker over ALL attributes in the card subtree
    // Catches any attribute name LinkedIn uses (data-chameleon-result-urn,
    // data-tracking-control-name, inline JSON, etc.) that we don't know about.
    try {
      const scope = liScope || card;
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT, null, false);
      let node = walker.currentNode;
      while (node) {
        const attrs = node.attributes || [];
        for (let i = 0; i < attrs.length; i++) {
          const raw = attrs[i].value || '';
          if (raw.length < 10) continue;
          // Decode HTML entities that LinkedIn often encodes in data attributes
          const val = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                         .replace(/&amp;/g, '&').replace(/\\u0022/g, '"');
          let m = FSD_RE.exec(val) || URN_RE.exec(val);
          if (m) {
            const u = buildUrl(m[1], m[2]);
            if (isValid(u)) return cleanUrl(u);
          }
        }
        // Also check href for broader patterns (activity: in any form)
        const href = node.getAttribute && node.getAttribute('href');
        if (href && (href.includes('activity:') || href.includes('ugcPost:') || href.includes('share:'))) {
          const full = href.startsWith('http') ? href : 'https://www.linkedin.com' + href;
          try { const u = cleanUrl(full); if (isValid(u)) return u; } catch(e) {}
        }
        node = walker.nextNode();
      }
    } catch (e) {}

    return null;
  }


  // ── Public API ─────────────────────────────────────────────────────────────
  window.__NexoraDomAdapter = {
    discoverCards,
    getFeedContainer,
    extractCanonicalUrl,
    isPostCard,
    isSponsored,
    isVisible,
    walkUpToCard,
    getUrnFromElement,
    // expose strategies for targeted use
    strategies: {
      containerAttr: strategyContainerAttr,
      urnAttr:       strategyUrnAttr,
      buttonWalkup:  strategyButtonWalkup,
      deepTreeWalker: strategyDeepTreeWalker,
    },
  };

})();
