/**
 * Nexora Extractor v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure functions. Extracts structured data from a card DOM element.
 * No DOM queries outside the given card. No side effects.
 *
 * Output schema (normalized, always consistent):
 * {
 *   post_url:         string | null,
 *   post_text:        string,
 *   likes_count:      number,
 *   comments_count:   number,
 *   author:           string,
 *   timestamp:        string | null,  // ISO 8601
 *   media_type:       'text' | 'image' | 'video' | 'article' | 'document',
 *   extraction_source: string,        // 'dom' | 'network' | 'merged'
 *   layout_id:        string,
 *   _raw: { ... }                     // raw extracted values for debugging
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraExtractor) return;

  const L   = window.__NexoraLogger;
  const M   = 'Extractor';

  // ── Number parser — handles "1.2K", "1,247", "3M", plain ints ─────────────
  function parseCount(raw) {
    if (raw == null) return 0;
    if (typeof raw === 'number') return Math.min(Math.round(raw), 9_999_999);
    const s = String(raw).replace(/,/g, '').trim().toUpperCase();
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (s.includes('K')) n *= 1000;
    if (s.includes('M')) n *= 1_000_000;
    return Math.min(Math.round(n), 9_999_999);
  }

  // Comment-area guard selector (prevents picking up comment likes/counts)
  const COMMENT_GUARD = [
    '[aria-label*="Write a comment" i]',
    '[data-test-id*="comment"]',
    'article[data-test-id]',  // individual comment articles
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

  function classifyLabel(label, current) {
    const l = label.toLowerCase();
    const n = parseCount(label);
    if (n <= 0) return current;
    const out = Object.assign({}, current);
    if (REACTION_WORDS.some(w => l.includes(w))) out.likes    = Math.max(out.likes, n);
    if (COMMENT_WORDS.some(w =>  l.includes(w))) out.comments = Math.max(out.comments, n);
    if (SHARE_WORDS.some(w =>    l.includes(w))) out.shares   = Math.max(out.shares, n);
    return out;
  }

  // ── Likes extraction ───────────────────────────────────────────────────────
  // Five-priority chain. Logs which priority produced the value.
  function extractEngagement(card) {
    let state = { likes: 0, comments: 0, shares: 0 };
    let source = 'none';

    // Priority 1: aria-label on any non-comment element (most reliable, language-agnostic)
    card.querySelectorAll('[aria-label]').forEach(el => {
      if (isInsideComments(el)) return;
      const lbl = el.getAttribute('aria-label') || '';
      if (!lbl) return;
      const prev = state.likes;
      state = classifyLabel(lbl, state);
      if (state.likes > prev) source = 'aria-label';
    });

    // Priority 2: visible text regex in social-count zones
    if (state.likes === 0) {
      card.querySelectorAll('[aria-label*="reaction" i],[aria-label*="like" i]').forEach(el => {
        if (isInsideComments(el)) return;
        const txt = (el.textContent || '').trim();
        const n = parseCount(txt);
        if (n > 0) { state.likes = Math.max(state.likes, n); source = 'text-regex'; }
      });
    }

    // Priority 3: bare numbers adjacent to reaction emoji / inside known count zones
    if (state.likes === 0) {
      const countZone = card.querySelector('[data-test-id*="reaction-count"],[data-test-id*="social-count"]');
      if (countZone) {
        const n = parseCount((countZone.textContent || '').trim());
        if (n > 0) { state.likes = n; source = 'count-zone'; }
      }
    }

    // Priority 4: line-by-line text scan ("247\n15 comments")
    if (state.likes === 0) {
      const root = card.closest('li') || card;
      const lines = (root.innerText || root.textContent || '')
        .split('\n').map(l => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const isCommentLine = /^[\d,.]+[KMk]?\s*comments?/i.test(lines[i]);
        if (isCommentLine) {
          const cm = lines[i].match(/^([\d,.]+[KMk]?)/i);
          if (cm && state.comments === 0) state.comments = parseCount(cm[1]);
          if (i > 0 && /^[\d,.]+[KMk]?$/.test(lines[i - 1])) {
            state.likes = parseCount(lines[i - 1]);
            source = 'text-scan';
          }
          break;
        }
      }
    }

    // Priority 5: inline text "247 reactions" pattern
    if (state.likes === 0) {
      const rawText = (card.textContent || '').slice(0, 800);
      const m = rawText.match(/([\d,.]+[KMk]?)\s*(?:reactions?|likes?)/i);
      if (m) { state.likes = parseCount(m[1]); source = 'inline-text'; }
    }

    L && L.debug(M, `Engagement: likes=${state.likes} src=${source}`);
    return { ...state, _source: source };
  }

  // ── Post text extraction ───────────────────────────────────────────────────
  function extractText(card) {
    // Semantic: look for directional text spans (en / rtl languages)
    const candidates = [
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

    // Fallback: broadest text on the card (trimmed)
    if (!best) {
      best = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    }

    return best.slice(0, 500);
  }

  // ── Author extraction ──────────────────────────────────────────────────────
  function extractAuthor(card) {
    // Prefer aria-hidden="true" spans inside profile links (removes screen-reader dups)
    for (const sel of [
      'a[href*="/in/"] span[aria-hidden="true"]',
      'a[href*="/company/"] span[aria-hidden="true"]',
      '[data-member-id]',
      'a[href*="/in/"]',
      'a[href*="/company/"]',
    ]) {
      try {
        const el = card.querySelector(sel);
        if (!el) continue;
        const t = (el.innerText || el.textContent || '').trim().split('\n')[0];
        if (t.length > 1 && t.length < 100 && !/^\d/.test(t)) return t.slice(0, 80);
      } catch (e) {}
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
    // Article signals
    if (card.querySelector('a[href*="/pulse/"]')) return 'article';
    // Document / PDF share
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

    const result = {
      post_url:          postUrl,
      post_text:         extractText(card),
      likes_count:       engagement.likes,
      comments_count:    engagement.comments,
      shares_count:      engagement.shares,
      author:            extractAuthor(card),
      timestamp:         extractTimestamp(card),
      media_type:        detectMediaType(card),
      extraction_source: 'dom',
      layout_id:         layoutId,
      _raw: {
        likesSource: engagement._source,
        hasUrl:      !!postUrl,
      },
    };

    L && L.debug(M, `Extracted: url=${postUrl ? '✓' : '✗'} likes=${result.likes_count} author="${result.author}"`);
    return result;
  }

  // ── Merge DOM result with network-intercepted data ─────────────────────────
  // Network data is more reliable for likes; DOM data is better for text.
  function mergeWithNetworkData(domResult, networkPost) {
    if (!networkPost) return domResult;
    return Object.assign({}, domResult, {
      likes_count:       Math.max(domResult.likes_count,    networkPost.likes    || 0),
      comments_count:    Math.max(domResult.comments_count, networkPost.comments || 0),
      shares_count:      Math.max(domResult.shares_count,   networkPost.reposts  || 0),
      post_text:         (networkPost.text && networkPost.text.length > domResult.post_text.length)
                           ? networkPost.text
                           : domResult.post_text,
      author:            networkPost.author && networkPost.author !== 'Unknown'
                           ? networkPost.author
                           : domResult.author,
      extraction_source: 'merged',
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.__NexoraExtractor = {
    extractFromCard,
    mergeWithNetworkData,
    parseCount,    // exposed for use in filter
    extractEngagement,
    extractText,
    extractAuthor,
  };

})();
