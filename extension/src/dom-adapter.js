/**
 * Nexora DOM Adapter v4.0 — Structural Discovery (SEARCH_B Rebuild)
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.0 changes from v3.0:
 *  - REMOVED offsetHeight >= 150 guard. SEARCH_B cards are thin; this filter
 *    silently dropped all of them.
 *  - REMOVED timeCount <= 3 guard. Reposts legitimately have multiple <time>
 *    elements; the old guard would stop walking up at the first repost.
 *  - REMOVED hasMeaningfulText requirement from discovery. Text extraction
 *    is the extractor's job, not discovery's. Discovery only confirms
 *    structural presence (time + author link = valid candidate).
 *  - Replaced class-based text selectors with structural ones only.
 *  - All logic is purely structural — no CSS class names used.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraDomAdapter) return;

  const L = window.__NexoraLogger;
  const M = 'DomAdapter';

  // Stop walking up when we hit these major structural elements
  const STOP_TAGS = new Set(['BODY', 'HTML', 'MAIN', 'HEADER', 'NAV', 'FOOTER', 'ASIDE']);

  // Maximum DOM walk depth — prevent walking into the full page wrapper
  const MAX_WALK_DEPTH = 25;

  // Comment section guards — reject nodes that live inside comment threads
  function isInsideCommentSection(el) {
    try {
      // LinkedIn comment boxes and comment lists
      if (el.closest('[aria-label*="Write a comment" i]')) return true;
      if (el.closest('[aria-label*="Add a comment" i]')) return true;
      if (el.closest('[data-test-id*="comment-"]')) return true;
      // Comment list container (class-based guard — kept because it's structural enough)
      let p = el.parentElement;
      let depth = 0;
      while (p && depth < 8) {
        const cls = (p.getAttribute('class') || '').toLowerCase();
        if (cls.includes('comments-comment-list') || cls.includes('comment-list')) return true;
        p = p.parentElement;
        depth++;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // Detect sponsored/promoted posts — skip them
  function isSponsored(el) {
    if (!el) return false;
    const lbl = (el.getAttribute('aria-label') || '').toLowerCase();
    if (lbl.includes('promoted') || lbl.includes('sponsored')) return true;
    // Check shallow children only (not full subtree — too slow)
    for (const child of el.children) {
      const cLbl = (child.getAttribute('aria-label') || '').toLowerCase();
      if (cLbl.includes('promoted') || cLbl.includes('sponsored')) return true;
    }
    // Snippet check on first 300 chars of text content
    const snippet = (el.textContent || '').slice(0, 300).toLowerCase();
    return /\bpromoted\b|\bsponsored\b/.test(snippet);
  }

  // ── Core Discovery ───────────────────────────────────────────────────────
  function discoverCards() {
    const found    = [];
    const seenSet  = new Set();

    // Anchor on every <time> element or action button — every real post has one.
    // Walk UP until we find a node that also contains an author link.
    // That ancestor is the post card.
    const timeNodes = document.querySelectorAll(
      'time, button[aria-label*="react" i], button[aria-label*="like" i], button[aria-label*="comment" i]'
    );

    for (const timeNode of timeNodes) {
      if (isInsideCommentSection(timeNode)) continue;

      let node  = timeNode.parentElement;
      let depth = 0;
      let bestCandidate = null;

      while (node && depth < MAX_WALK_DEPTH && !STOP_TAGS.has(node.tagName)) {
        // A valid post container must have at least one author link
        const authorLink =
          node.querySelector('a[href*="/in/"]') ||
          node.querySelector('a[href*="/company/"]');

        if (authorLink) {
          // Mark as candidate — keep walking to find the outermost reasonable container.
          // Stop when we'd walk into the global feed wrapper (has many, many <time> elements).
          const timesHere = node.querySelectorAll('time').length;

          if (timesHere <= 8) {
            // Still a reasonable post-level container (reposts can have 2-4 times)
            bestCandidate = node;
          } else {
            // Too many <time> elements — we've walked into the feed list itself.
            break;
          }
        }

        node = node.parentElement;
        depth++;
      }

      if (!bestCandidate) continue;
      if (isInsideCommentSection(bestCandidate)) continue;
      if (isSponsored(bestCandidate)) continue;
      if (seenSet.has(bestCandidate)) continue;

      // Deduplication: if an existing candidate contains this one (or vice versa), keep outermost
      let dominated = false;
      for (let i = 0; i < found.length; i++) {
        const existing = found[i];
        if (existing.contains(bestCandidate)) {
          // existing is higher up — bestCandidate is dominated, skip
          dominated = true;
          break;
        }
        if (bestCandidate.contains(existing)) {
          // bestCandidate is higher up — replace existing with this one
          seenSet.delete(existing);
          found[i] = bestCandidate;
          seenSet.add(bestCandidate);
          dominated = true; // already added
          break;
        }
      }

      if (!dominated) {
        seenSet.add(bestCandidate);
        found.push(bestCandidate);
      }
    }

    L && L.info(M, `Discovered ${found.length} post candidates`);
    return found;
  }

  // ── Feed Container ───────────────────────────────────────────────────────
  function getFeedContainer() {
    return (
      document.querySelector('[role="main"]') ||
      document.querySelector('main') ||
      document.body
    );
  }

  // ── Canonical URL Extraction ─────────────────────────────────────────────
  function extractCanonicalUrl(card) {
    if (!card) return null;

    function buildUrl(type, id) {
      const t = (type || '').toLowerCase();
      if (t === 'ugcpost') return `https://www.linkedin.com/feed/update/urn:li:ugcPost:${id}`;
      if (t === 'share')   return `https://www.linkedin.com/feed/update/urn:li:share:${id}`;
      return `https://www.linkedin.com/feed/update/urn:li:activity:${id}`;
    }

    function cleanUrl(u) {
      try {
        const parsed = new URL(u.startsWith('http') ? u : 'https://www.linkedin.com' + u);
        ['trackingId','lipi','licu','refId','trk','trkInfo','src'].forEach(p => parsed.searchParams.delete(p));
        return parsed.toString().split('?')[0].split('#')[0].replace(/\/$/, '');
      } catch (e) {
        return u.split('?')[0].split('#')[0].replace(/\/$/, '');
      }
    }

    function isValidPostUrl(u) {
      if (!u || !u.includes('linkedin.com')) return false;
      return /\/(posts|feed\/update)\/[^?#]+/.test(u);
    }

    const URN_RE  = /urn:li:(activity|ugcPost|share):(\d{10,25})/i;
    const FSD_RE  = /urn:li:fsd_(?:update|entityResult)[:(]urn:li:(activity|ugcPost|share):(\d{10,25})/i;

    // 1. Direct href from <a> tags pointing to posts/feed
    for (const a of card.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (href.includes('/feed/update/') || href.includes('/posts/')) {
        const full = href.startsWith('http') ? href : 'https://www.linkedin.com' + href;
        const u = cleanUrl(full);
        if (isValidPostUrl(u)) return u;
      }
    }

    // 2. Data attributes containing URNs
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT, null, false);
    let node = walker.currentNode;
    while (node) {
      const attrs = node.attributes || [];
      for (let i = 0; i < attrs.length; i++) {
        const val = attrs[i].value || '';
        const m = FSD_RE.exec(val) || URN_RE.exec(val);
        if (m) {
          const u = buildUrl(m[1], m[2]);
          if (isValidPostUrl(u)) return cleanUrl(u);
        }
      }
      // Also scan href for URN-style patterns
      const href = node.getAttribute && node.getAttribute('href');
      if (href && (href.includes('activity:') || href.includes('ugcPost:') || href.includes('share:'))) {
        const full = href.startsWith('http') ? href : 'https://www.linkedin.com' + href;
        try {
          const u = cleanUrl(full);
          if (isValidPostUrl(u)) return u;
        } catch (e) {}
      }
      node = walker.nextNode();
    }

    return null;
  }

  window.__NexoraDomAdapter = {
    discoverCards,
    getFeedContainer,
    extractCanonicalUrl,
  };

  console.log('[Nexora][DomAdapter v4.0] Structural discovery (no height/class guards) ready.');
})();
