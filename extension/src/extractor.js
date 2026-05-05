/**
 * Nexora Extractor v1.1  — NULL-SAFE
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure functions. Extracts structured data from a card DOM element.
 * No DOM queries outside the given card. No side effects.
 *
 * v1.1 SEARCH_B Fix:
 *  - parseCount() returns null for missing/unextractable input (not 0).
 *    This lets the filter distinguish "confirmed zero likes" from "unknown likes".
 *  - extractEngagement() returns { likes: null, ... } when ALL five DOM
 *    priorities fail — never returns 0 as a default.
 *  - mergeWithNetworkData() uses null-safe logic: picks the first non-null
 *    value between DOM and network, so a real network value (e.g. 47) is
 *    never discarded by Math.max(domValue=0, networkValue=47) logic when
 *    the DOM value happened to be null.
 *
 * Output schema (normalized, always consistent):
 * {
 *   post_url:         string | null,
 *   post_text:        string,
 *   likes_count:      number | null,   ← null = extraction failed (unknown)
 *   comments_count:   number | null,
 *   author:           string,
 *   timestamp:        string | null,   // ISO 8601
 *   media_type:       'text' | 'image' | 'video' | 'article' | 'document',
 *   extraction_source: string,         // 'dom' | 'network' | 'merged'
 *   layout_id:        string,
 *   _raw: { ... }                      // raw extracted values for debugging
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraExtractor) return;

  const L   = window.__NexoraLogger;
  const M   = 'Extractor';

  // ── Number parser — handles "1.2K", "1,247", "3M", plain ints ─────────────
  // v1.1: returns null for null/undefined input (not 0) so callers can
  // distinguish "extraction failed" from "confirmed zero engagement".
  function parseCount(raw) {
    if (raw == null) return null;                       // ← NULL-SAFE: unknown, not zero
    if (typeof raw === 'number') {
      if (isNaN(raw)) return null;
      return Math.min(Math.round(raw), 9_999_999);
    }
    const s = String(raw).replace(/,/g, '').trim().toUpperCase();
    if (!s) return null;
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    if (s.includes('K')) n *= 1000;
    if (s.includes('M')) n *= 1_000_000;
    const result = Math.min(Math.round(n), 9_999_999);
    return isNaN(result) ? null : result;
  }

  // ── Null-safe numeric max — ignores null operands ──────────────────────────
  // Returns null only when BOTH operands are null.
  function nullMax(a, b) {
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    return Math.max(a, b);
  }

  // Comment-area guard selector (prevents picking up comment likes/counts).
  // IMPORTANT: do NOT add 'article[data-test-id]' here — that matches the
  // SEARCH_B post card itself and causes ALL text inside to be filtered out.
  const COMMENT_GUARD = [
    '[aria-label*="Write a comment" i]',
    '[data-test-id*="comment-input"]',
    '[data-test-id*="social-detail"]',
    '.comments-comment-list',
  ].join(', ');

  function isInsideComments(el) {
    try { return !!el.closest(COMMENT_GUARD); } catch (e) { return false; }
  }

  // ── Multilingual reaction / comment / share word lists ────────────────────
  const REACTION_WORDS = [
    'reaction', 'like', 'إعجاب', "j'aime", 'gefällt', 'curtir', 'me gusta',
    'réaction', 'reação', 'reacción', 'tepki', 'suka', 'mi piace',
    'synes', 'vind ik', 'reageer', 'beğen', 'lubię',
  ];
  const COMMENT_WORDS = [
    'comment', 'تعليق', 'kommentar', 'comentario', 'commentaire', 'comentário',
    'yorum', 'komentar', 'commenta', 'skomentuj', 'kommentaar',
  ];
  const SHARE_WORDS = [
    'repost', 'share', 'partage', 'teilen', 'compartilhar', 'compartir',
    'paylaş', 'bagikan', 'delen', 'dela', 'condividi',
  ];

  // classifyLabel returns updated state — uses nullMax so null is never
  // promoted to 0 and a real number is never lost.
  function classifyLabel(label, current) {
    const l = label.toLowerCase();
    // Try to extract a number from the label string
    const cleaned = label.replace(/,/g, '').trim().toUpperCase();
    const numMatch = cleaned.match(/(\d+(?:\.\d+)?[KMkm]?)/);
    if (!numMatch) return current;
    let n = parseFloat(numMatch[1]);
    if (cleaned.includes('K') || cleaned.includes('k')) n *= 1000;
    if (cleaned.includes('M') || cleaned.includes('m')) n *= 1_000_000;
    n = Math.round(n);
    if (!n || isNaN(n) || n <= 0) return current;

    const out = Object.assign({}, current);
    if (REACTION_WORDS.some(w => l.includes(w))) out.likes    = nullMax(out.likes, n);
    if (COMMENT_WORDS.some(w =>  l.includes(w))) out.comments = nullMax(out.comments, n);
    if (SHARE_WORDS.some(w =>    l.includes(w))) out.shares   = nullMax(out.shares, n);
    return out;
  }

  // ── Engagement extraction ─────────────────────────────────────────────────
  // Five-priority chain. Returns null for any metric that could not be read.
  // NEVER returns 0 as a default — 0 only appears when a counter is visibly
  // showing "0" in the DOM.
  function extractEngagement(card) {
    // Start with null = unknown for every field
    let state = { likes: null, comments: null, shares: null };
    let source = 'none';

    // Priority 1: aria-label on any non-comment element (most reliable, language-agnostic)
    card.querySelectorAll('[aria-label]').forEach(el => {
      if (isInsideComments(el)) return;
      const lbl = el.getAttribute('aria-label') || '';
      if (!lbl) return;
      const prev = state.likes;
      state = classifyLabel(lbl, state);
      if (state.likes !== prev && state.likes != null) source = 'aria-label';
    });

    // Priority 2: visible text in reaction/like-labeled zones
    if (state.likes == null) {
      card.querySelectorAll('[aria-label*="reaction" i],[aria-label*="like" i]').forEach(el => {
        if (isInsideComments(el)) return;
        const txt = (el.textContent || '').trim();
        const n = parseCount(txt);
        if (n != null && n > 0) {
          state.likes = nullMax(state.likes, n);
          source = 'text-regex';
        }
      });
    }

    // Priority 3: bare numbers inside known count zones
    if (state.likes == null) {
      const countZone = card.querySelector('[data-test-id*="reaction-count"],[data-test-id*="social-count"]');
      if (countZone) {
        const n = parseCount((countZone.textContent || '').trim());
        if (n != null && n > 0) { state.likes = n; source = 'count-zone'; }
      }
    }

    // Priority 4: line-by-line text scan ("247\n15 comments")
    if (state.likes == null) {
      const root = card.closest('li') || card;
      const lines = (root.innerText || root.textContent || '')
        .split('\n').map(l => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const isCommentLine = /^[\d,.]+[KMk]?\s*comments?/i.test(lines[i]);
        if (isCommentLine) {
          const cm = lines[i].match(/^([\d,.]+[KMk]?)/i);
          if (cm && state.comments == null) state.comments = parseCount(cm[1]);
          if (i > 0 && /^[\d,.]+[KMk]?$/.test(lines[i - 1])) {
            const n = parseCount(lines[i - 1]);
            if (n != null) { state.likes = n; source = 'text-scan'; }
          }
          break;
        }
      }
    }

    // Priority 5: SEARCH_B "247 reactions • 18 comments" inline text
    if (state.likes == null || state.comments == null) {
      const proofText = card.querySelector('[class*="social-proof"], [class*="socialProof"]');
      if (proofText) {
        const t = proofText.textContent || '';
        const rm = t.match(/([\d,.]+[KMk]?)\s*reactions?/i);
        const cm2 = t.match(/([\d,.]+[KMk]?)\s*comments?/i);
        if (rm && state.likes == null) { state.likes = parseCount(rm[1]); source = 'social-proof'; }
        if (cm2 && state.comments == null) { state.comments = parseCount(cm2[1]); }
      }
    }

    // Priority 6: inline text "247 reactions" pattern
    if (state.likes == null) {
      const rawText = (card.textContent || '').slice(0, 800);
      const m = rawText.match(/([\d,.]+[KMk]?)\s*(?:reactions?|likes?)/i);
      if (m) {
        const n = parseCount(m[1]);
        if (n != null) { state.likes = n; source = 'inline-text'; }
      }
    }

    // ── SEARCH_B explicit-zero detection ──────────────────────────────────────
    // If ALL priorities failed (likes=null) AND the card has visible reaction
    // buttons, it could be a genuine 0-likes post rather than an extraction
    // gap. We check for explicit "0" or the absence of any numeric counter.
    // We do NOT convert null → 0 here; that conversion happens only when
    // a reaction button with aria-label="0 reactions" is present.
    if (state.likes == null) {
      const explicitZero = card.querySelector(
        '[aria-label="0 reactions"],[aria-label="0 likes"],[aria-label*="reaction" i]'
      );
      if (explicitZero) {
        const lbl = (explicitZero.getAttribute('aria-label') || '').trim();
        if (/^0\s+/i.test(lbl)) {
          state.likes = 0;   // confirmed zero
          source = 'explicit-zero';
        }
      }
    }

    L && L.debug(M, `Engagement: likes=${state.likes == null ? 'NULL' : state.likes} src=${source}`);
    return { ...state, _source: source };
  }

  // ── Post text extraction ───────────────────────────────────────────────────
  function extractText(card) {
    const candidates = [
      ...card.querySelectorAll('.update-components-text span, .feed-shared-update-v2__description span'),
      ...card.querySelectorAll('[class*="commentary"] span, [class*="description"] span'),
      ...card.querySelectorAll('span[dir="ltr"], span[dir="rtl"]'),
      ...card.querySelectorAll('[data-test-id="main-feed-activity-card__commentary"]'),
      ...card.querySelectorAll('p'),
    ];

    let best = '';
    for (const el of candidates) {
      if (isInsideComments(el)) continue;
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > best.length && t.length > 20 && t.length < 3000) best = t;
    }

    if (!best || best.length < 20) {
      // 🔴 HARD FAILURE FIX: NEVER allow empty text if innerText exists
      best = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
    }

    return best.slice(0, 3000); // Allow longer text
  }

  // ── Author extraction ──────────────────────────────────────────────────────
  function extractAuthor(card) {
    // Ordered from most-specific to broadest. Works for both SEARCH_A and SEARCH_B.
    const authSelectors = [
      'a[href*="/in/"] strong',
      'a[href*="/in/"] b',
      '[class*="actor"] span',
      '[class*="author"] span',
      'a[href*="/in/"] span[aria-hidden="true"]',
      'a[href*="/company/"] span[aria-hidden="true"]',
      // SEARCH_B: author name is often in aria-label of the profile link
      'a[href*="/in/"][aria-label]',
      'a[href*="/company/"][aria-label]',
      '[data-member-id]',
      'a[href*="/in/"]',
      'a[href*="/company/"]',
    ];
    for (const sel of authSelectors) {
      try {
        const el = card.querySelector(sel);
        if (!el) continue;
        // Prefer aria-label (SEARCH_B often encodes name there)
        const ariaLbl = (el.getAttribute('aria-label') || '').trim().split('\n')[0];
        if (ariaLbl.length > 1 && ariaLbl.length < 100 && !/^\d/.test(ariaLbl)) return ariaLbl.slice(0, 80);
        const t = (el.innerText || el.textContent || '').trim().split('\n')[0];
        if (t.length > 1 && t.length < 100 && !/^\d/.test(t)) return t.slice(0, 80);
      } catch (e) {}
    }

    // 🔴 HARD FAILURE FIX: NEVER return "Unknown" if author is present in DOM subtree
    const allLinks = card.querySelectorAll('a[href*="/in/"], a[href*="/company/"]');
    for (const link of allLinks) {
      const ariaLbl = (link.getAttribute('aria-label') || '').trim().split('\n')[0];
      if (ariaLbl.length > 2 && ariaLbl.length < 100 && !/^\d/.test(ariaLbl)) return ariaLbl.slice(0, 80);

      const txt = (link.innerText || link.textContent || '').trim().split('\n')[0];
      if (txt.length > 2 && txt.length < 100 && !/^\d/.test(txt)) return txt.slice(0, 80);
    }

    return 'Unknown';
  }

  // ── Timestamp extraction ───────────────────────────────────────────────────
  function extractTimestamp(card) {
    const timeEl = card.querySelector('time[datetime]');
    if (timeEl) {
      const raw = timeEl.getAttribute('datetime') || '';
      const ms = Date.parse(raw);
      if (!isNaN(ms)) return new Date(ms).toISOString();
    }
    return null;
  }

  // ── Media type detection ───────────────────────────────────────────────────
  function detectMediaType(card) {
    if (card.querySelector('video')) return 'video';
    if (card.querySelector('img[src*="media"]')) return 'image';
    if (card.querySelector('a[href*="/pulse/"]')) return 'article';
    if (card.querySelector('[aria-label*="document" i],[data-test-id*="document"]')) return 'document';
    return 'text';
  }

  // ── Main extract function ──────────────────────────────────────────────────
  function extractFromCard(card, opts = {}) {
    const layoutId  = opts.layoutId || 'UNKNOWN';
    const postUrl   = (window.__NexoraDomAdapter || {}).extractCanonicalUrl
      ? window.__NexoraDomAdapter.extractCanonicalUrl(card)
      : null;

    const engagement = extractEngagement(card);
    const postText   = extractText(card);
    const author     = extractAuthor(card);

    // ── Derive a stable traceId from the activity/ugcPost ID in the URL ──────
    let traceId = 'no-url';
    if (postUrl) {
      const tm = postUrl.match(/(?:activity|ugcPost|share):(\d{10,25})/);
      traceId = tm ? tm[1] : postUrl.split('/').filter(Boolean).pop() || 'unknown';
    }

    // ── L1 Forensic log ──────────────────────────────────────────────────────
    // Init global stats tracker if first post on page
    if (!window.__pipelineStats) {
      window.__pipelineStats = { total: 0, domFail: 0, networkFail: 0, transportFail: 0, hydrated: 0 };
    }
    window.__pipelineStats.total++;
    const l1Complete = [postText, author !== 'Unknown' ? author : '', engagement.likes, engagement.comments]
      .filter(v => v !== null && v !== undefined && v !== '').length;
    const l1Score = l1Complete / 4;
    if (l1Score < 0.5) window.__pipelineStats.domFail++;

    console.log('[L1-EXTRACTOR]', {
      traceId,
      url:              postUrl,
      text:             postText ? postText.slice(0, 80) + '…' : '',
      author,
      likes:            engagement.likes,
      comments:         engagement.comments,
      completenessScore: l1Score,
      status:           (!postText || author === 'Unknown') ? 'BROKEN_DOM_EXTRACTION' : 'OK',
    });

    const result = {
      post_url:          postUrl,
      post_text:         postText,
      likes_count:       engagement.likes,
      comments_count:    engagement.comments,
      shares_count:      engagement.shares,
      author,
      timestamp:         extractTimestamp(card),
      media_type:        detectMediaType(card),
      extraction_source: 'dom',
      layout_id:         layoutId,
      _traceId:          traceId,
      _raw: {
        likesSource: engagement._source,
        hasUrl:      !!postUrl,
      },
    };

    L && L.debug(M, `Extracted: url=${postUrl ? '✓' : '✗'} likes=${result.likes_count == null ? 'NULL' : result.likes_count} author="${result.author}"`);
    return result;
  }

  function mergeWithNetworkData(domResult, networkPost) {
    if (!networkPost) return domResult;

    // 🔴 GLOBAL PIPELINE CONSISTENCY RULE: STRICT NON-DESTRUCTIVE MERGE
    // NEVER overwrite valid fields with null/undefined
    // Only fill missing fields, never replace existing ones
    const merged = Object.assign({}, domResult);
    merged.extraction_source = 'merged';

    const hasDomText = !!(merged.post_text && merged.post_text.length > 20);
    const hasNetText = !!(networkPost.text && networkPost.text.length > 20);
    if (!hasDomText && hasNetText) {
      merged.post_text = networkPost.text;
    }

    const hasDomAuth = merged.author && merged.author !== 'Unknown';
    const hasNetAuth = networkPost.author && networkPost.author !== 'Unknown';
    if (!hasDomAuth && hasNetAuth) {
      merged.author = networkPost.author;
    }

    if (merged.likes_count == null && networkPost.likes != null) {
      merged.likes_count = networkPost.likes;
    }
    
    if (merged.comments_count == null && networkPost.comments != null) {
      merged.comments_count = networkPost.comments;
    }
    
    if (merged.shares_count == null && networkPost.reposts != null) {
      merged.shares_count = networkPost.reposts;
    }

    return merged;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.__NexoraExtractor = {
    extractFromCard,
    mergeWithNetworkData,
    parseCount,        // exposed for use in filter
    nullMax,           // exposed for use in core-engine
    extractEngagement,
    extractText,
    extractAuthor,
  };

})();
