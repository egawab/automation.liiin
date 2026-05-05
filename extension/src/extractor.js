/**
 * Nexora Extractor v4.0 — Null-Safe, Broader Selectors (SEARCH_B Rebuild)
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.0 changes:
 *  - extractText(): added [data-test-id*="commentary"], [class*="update-content"]
 *    and more fallback spans so SEARCH_B card text is captured from DOM.
 *  - extractAuthor(): added [data-member-id] direct text, [class*="actor-name"],
 *    and a broader span walk inside author links.
 *  - mergeWithNetworkData(): keeps LONGER text between DOM and network
 *    (not just "network wins if DOM is empty").
 *  - All null-safety preserved from v3.0.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraExtractor) return;

  const L = window.__NexoraLogger;
  const M = 'Extractor';

  // ── Null-Safe Parsers ───────────────────────────────────────────────────
  function parseCount(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number') return isNaN(raw) ? null : Math.round(raw);
    const s = String(raw).replace(/,/g, '').trim().toUpperCase();
    if (!s) return null;
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    if (s.includes('K')) n *= 1000;
    if (s.includes('M')) n *= 1_000_000;
    const result = Math.round(n);
    return isNaN(result) ? null : result;
  }

  function nullMax(a, b) {
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    return Math.max(a, b);
  }

  function isInsideComments(el) {
    try {
      if (el.closest('[aria-label*="Write a comment" i]')) return true;
      if (el.closest('[aria-label*="Add a comment" i]')) return true;
      if (el.closest('[data-test-id*="comment-"]')) return true;
      return false;
    } catch (e) { return false; }
  }

  // ── Engagement Extraction ───────────────────────────────────────────────
  function extractEngagement(card) {
    let likes = null, comments = null, shares = null;

    // Button aria-labels: "247 reactions", "18 comments", "5 reposts"
    card.querySelectorAll('button[aria-label], [role="button"][aria-label]').forEach(btn => {
      if (isInsideComments(btn)) return;
      const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
      const n = parseCount(lbl);
      if (n != null) {
        if (lbl.includes('reaction') || lbl.includes('like')) likes    = nullMax(likes, n);
        if (lbl.includes('comment'))                           comments = nullMax(comments, n);
        if (lbl.includes('share') || lbl.includes('repost'))  shares   = nullMax(shares, n);
      }
    });

    // Social proof text spans ("247 reactions • 18 comments")
    if (likes == null || comments == null) {
      const proofCandidates = card.querySelectorAll(
        '[aria-label*="reaction" i], [aria-label*="like" i], ' +
        'span[class*="social"], span[class*="reactions"]'
      );
      proofCandidates.forEach(el => {
        if (isInsideComments(el)) return;
        const t = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
        const rm = t.match(/([\d,.]+[KMk]?)\s*reactions?/i);
        const cm = t.match(/([\d,.]+[KMk]?)\s*comments?/i);
        if (rm && likes    == null) likes    = parseCount(rm[1]);
        if (cm && comments == null) comments = parseCount(cm[1]);
      });
    }

    // Explicit zero check
    if (likes == null) {
      const zeroEl = card.querySelector('[aria-label="0 reactions"], [aria-label="0 likes"]');
      if (zeroEl) likes = 0;
    }

    return { likes, comments, shares };
  }

  // ── Text Extraction ────────────────────────────────────────────────────
  function extractText(card) {
    // Ordered candidate pools — try more specific first
    const candidateSelectors = [
      // Semantic data-test-id (Voyager)
      '[data-test-id="main-feed-activity-card__commentary"]',
      '[data-test-id*="commentary"]',
      // Class-based (kept for reliability — class names are stable enough here)
      '.update-components-text',
      '[class*="commentary"]',
      '[class*="update-content"]',
      '[class*="feed-shared-text"]',
      // Direction attribute (multilingual text)
      'span[dir="ltr"]',
      'span[dir="rtl"]',
      // Generic paragraphs
      'p',
    ];

    let best = '';

    for (const sel of candidateSelectors) {
      const els = card.querySelectorAll(sel);
      for (const el of els) {
        if (isInsideComments(el)) continue;
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length > best.length && t.length >= 10 && t.length < 10000) {
          best = t;
        }
      }
      if (best.length >= 50) break; // good enough — stop early
    }

    return best || null;
  }

  // ── Author Extraction ──────────────────────────────────────────────────
  function extractAuthor(card) {
    const selectors = [
      // Most specific first
      'a[href*="/in/"] strong',
      'a[href*="/in/"] b',
      'a[href*="/in/"] [aria-hidden="true"]',
      '[data-member-id] > span:first-child',
      '[class*="actor-name"] span',
      '[class*="actor"] > span',
      '[class*="author"] > span',
      // Aria-label on the link itself
      'a[href*="/in/"][aria-label]',
      'a[href*="/company/"][aria-label]',
      // Full link text fallback
      'a[href*="/in/"]',
      'a[href*="/company/"]',
    ];

    for (const sel of selectors) {
      const el = card.querySelector(sel);
      if (!el) continue;

      // Prefer aria-label when it's a clean name
      const ariaLbl = (el.getAttribute('aria-label') || '').trim().split('\n')[0].split(' • ')[0];
      if (ariaLbl.length >= 2 && ariaLbl.length <= 80 && !/^\d/.test(ariaLbl)) {
        return ariaLbl;
      }

      // innerText of the element
      const txt = (el.innerText || el.textContent || '').trim().split('\n')[0];
      if (txt.length >= 2 && txt.length <= 80 && !/^\d/.test(txt)) {
        return txt;
      }
    }

    return null;
  }

  // ── Timestamp Extraction ────────────────────────────────────────────────
  function extractTimestamp(card) {
    const timeEl = card.querySelector('time[datetime]');
    if (timeEl) {
      const raw = timeEl.getAttribute('datetime') || '';
      const ms  = Date.parse(raw);
      if (!isNaN(ms)) return new Date(ms).toISOString();
    }
    return null;
  }

  // ── Media Type Detection ────────────────────────────────────────────────
  function detectMediaType(card) {
    if (card.querySelector('video'))                    return 'video';
    if (card.querySelector('img[src*="media"]'))        return 'image';
    if (card.querySelector('a[href*="/pulse/"]'))       return 'article';
    if (card.querySelector('[aria-label*="document" i]')) return 'document';
    return 'text';
  }

  // ── Main Extract ─────────────────────────────────────────────────────────
  function extractFromCard(card, opts = {}) {
    const postUrl    = window.__NexoraDomAdapter
      ? window.__NexoraDomAdapter.extractCanonicalUrl(card)
      : null;
    const engagement = extractEngagement(card);
    const postText   = extractText(card);
    const author     = extractAuthor(card);
    const timestamp  = extractTimestamp(card);

    let traceId = 'no-url';
    if (postUrl) {
      const tm = postUrl.match(/(?:activity|ugcPost|share):(\d{10,25})/);
      traceId  = tm ? tm[1] : postUrl.split('/').filter(Boolean).pop() || 'unknown';
    }

    return {
      post_url:          postUrl,
      post_text:         postText   || '',
      likes_count:       engagement.likes,
      comments_count:    engagement.comments,
      shares_count:      engagement.shares,
      author:            author     || '',
      timestamp:         timestamp,
      media_type:        detectMediaType(card),
      extraction_source: 'dom',
      layout_id:         opts.layoutId || 'UNKNOWN',
      _traceId:          traceId,
    };
  }

  // ── Non-Destructive Network Hydration ─────────────────────────────────
  // Merges network data into a DOM-extracted post.
  // Rule: NEVER overwrite a non-empty valid field with an empty/Unknown value.
  // Rule: For text, keep the LONGER of the two.
  function mergeWithNetworkData(domResult, networkPost) {
    if (!networkPost) return domResult;

    const merged = Object.assign({}, domResult);
    merged.extraction_source = 'merged';

    // Text: keep the LONGER of DOM vs network (both may have partial content)
    const domText = merged.post_text  || '';
    const netText = networkPost.text  || '';
    if (netText.length > domText.length) {
      merged.post_text = netText;
    }

    // Author: network wins only if DOM has no author
    const hasDomAuth = merged.author && merged.author !== '' && merged.author !== 'Unknown';
    const hasNetAuth = networkPost.author && networkPost.author !== '' && networkPost.author !== 'Unknown';
    if (!hasDomAuth && hasNetAuth) {
      merged.author = networkPost.author;
    }

    // Engagement: take best (non-null) from either source
    if (merged.likes_count == null && networkPost.likes != null) {
      merged.likes_count = networkPost.likes;
    }
    if (merged.comments_count == null && networkPost.comments != null) {
      merged.comments_count = networkPost.comments;
    }
    if (merged.shares_count == null && networkPost.reposts != null) {
      merged.shares_count = networkPost.reposts;
    }

    // Timestamp
    if (!merged.timestamp && networkPost.postedAtMs != null) {
      merged.timestamp = new Date(networkPost.postedAtMs).toISOString();
    }

    return merged;
  }

  window.__NexoraExtractor = {
    extractFromCard,
    mergeWithNetworkData,
    parseCount,
    nullMax,
  };

  console.log('[Nexora][Extractor v4.0] Broader selectors + longest-text merge ready.');
})();
