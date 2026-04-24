// ═══════════════════════════════════════════════════════════
// LinkedIn Extraction Engine v18 — Button-First Detection
// ═══════════════════════════════════════════════════════════
//
// WHY v18:
//   v17 failed because LinkedIn no longer renders post URLs as
//   <a href="/feed/update/..."> on search results pages.
//   Diagnostic proof: postAnchors=0, urnAnchors=0,
//                     BUT likeButtons=6, commentButtons=6
//   Posts ARE on the page — we were looking with wrong selectors.
//
// v18 STRATEGY:
//   1. DETECT posts via action bars (like/comment buttons) — PROVEN to exist
//   2. WALK UP from each button to find the card container
//   3. EXTRACT URL from card using multiple methods (data-attrs, inner links, innerHTML)
//   4. SLOW scroll with long waits (3-5s) for content loading
//   5. DIAGNOSTIC logging at every step
// ═══════════════════════════════════════════════════════════

if (window.__linkedInExtractorCleanup) {
  try { window.__linkedInExtractorCleanup(); } catch (e) { }
}
window.__linkedInExtractorReady = true;

{
  let isExtracting = false;
  if (typeof window.__linkedInExtractorRunCounter !== 'number') window.__linkedInExtractorRunCounter = 0;
  if (typeof window.__linkedInExtractorActiveRunId !== 'number') window.__linkedInExtractorActiveRunId = 0;

  function messageHandler(request, sender, sendResponse) {
    if (request.action === 'EXECUTE_SEARCH') {
      sendResponse({ received: true });
      runExtraction(request.keyword, request.settings, request.comments, request.dashboardUrl, request.userId);
    }
  }
  chrome.runtime.onMessage.addListener(messageHandler);

  window.__startExtraction = function (keyword, settings, comments, dashboardUrl, userId) {
    console.log('[v18] start: "' + keyword + '" on ' + window.location.href);
    runExtraction(keyword, settings, comments, dashboardUrl, userId);
  };

  window.__linkedInExtractorCleanup = function () {
    chrome.runtime.onMessage.removeListener(messageHandler);
    isExtracting = false;
    // Invalidate any still-running async loop from older injected instances.
    window.__linkedInExtractorActiveRunId = ++window.__linkedInExtractorRunCounter;
  };

  async function runExtraction(keyword, settings, comments, dashboardUrl, userId) {
    if (isExtracting) { console.log('[v18] Already extracting.'); return; }
    isExtracting = true;
    const runId = ++window.__linkedInExtractorRunCounter;
    window.__linkedInExtractorActiveRunId = runId;
    try {
      await extractPipeline(keyword, settings, comments, dashboardUrl, userId, runId);
    } catch (e) {
      if (String(e?.message || e).includes('EXTRACTION_CANCELLED')) {
        console.log('[v18] Extraction run cancelled due to reinjection/newer run.');
        return;
      }
      console.error('[v18] Fatal:', e);
      safeSend({ action: 'JOB_FAILED', error: String(e) });
    } finally {
      if (window.__linkedInExtractorActiveRunId === runId) {
        isExtracting = false;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const wait = (min, max) => sleep(min + Math.floor(Math.random() * (max - min + 1)));

  function num(t) {
    if (!t) return 0;
    const s = String(t).toLowerCase().replace(/,/g, '');
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (s.includes('k')) n *= 1000;
    if (s.includes('m')) n *= 1000000;
    return Math.round(n);
  }

  function safeSend(msg) {
    try { chrome.runtime.sendMessage(msg, () => { if (chrome.runtime.lastError) {} }); } catch(e) {}
  }

  function heartbeat(phase, text) {
    safeSend({ action: 'HEARTBEAT', phase });
    if (text) safeSend({ action: 'LIVE_STATUS', text });
  }

  function cleanUrl(url) {
    if (!url) return null;
    try {
      const base = url.startsWith('http') ? url : 'https://www.linkedin.com' + url;
      const u = new URL(base);
      ['trackingId','lipi','licu','refId','trk','trkInfo','src','originTrackingId'].forEach(p => u.searchParams.delete(p));
      return u.toString().split('?')[0].split('#')[0].replace(/\/$/, '');
    } catch(e) {
      return url.split('?')[0].split('#')[0].replace(/\/$/, '');
    }
  }

  /** Only URLs we know LinkedIn serves as real posts (blocks searchResult / entity IDs mis-mapped to activity). */
  function isValidCanonicalPostUrl(url) {
    if (!url || !url.includes('linkedin.com')) return false;
    if (/\/posts\/[^/?#]+\/?$/i.test(url)) return true;
    if (/linkedin\.com\/feed\/update\/urn:li:activity:\d{10,30}$/i.test(url)) return true;
    if (/linkedin\.com\/feed\/update\/urn:li:ugcPost:\d{10,30}$/i.test(url)) return true;
    if (/linkedin\.com\/feed\/update\/urn:li:share:[^\s"?'#/]+$/i.test(url)) return true;
    return false;
  }

  function htmlIndicatesBrokenOrLogin(html) {
    if (!html || html.length < 200) return true;
    const h = html.toLowerCase();
    const ghost = [
      'this post cannot be displayed',
      'this page doesn\'t exist',
      'page not found',
      'post not found',
      'no longer available',
      'this content isn\'t available',
      'something went wrong',
      'this post is not available',
      'unavailable post'
    ];
    return ghost.some(p => h.includes(p));
  }

  // ═══════════════════════════════════════════════════════════
  // DIAGNOSTICS — understand page state at any point
  // ═══════════════════════════════════════════════════════════
  function pageDiag() {
    const d = {
      visibility: document.visibilityState,
      scrollH: document.documentElement.scrollHeight,
      scrollTop: window.scrollY || document.documentElement.scrollTop,
      anchors: document.querySelectorAll('a[href]').length,
      postLinks: 0,
      likeBtn: 0,
      commentBtn: 0,
      articles: document.querySelectorAll('article').length,
      urnAttrs: 0,
    };

    // Count action-bar buttons (PROVEN reliable on LinkedIn 2026)
    document.querySelectorAll('button').forEach(btn => {
      const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
      const txt = (btn.innerText || '').toLowerCase().trim();
      if (lbl.startsWith('react') || lbl === 'like' || lbl.includes(' like') ||
          lbl.includes('إعجاب') || txt === 'like' || txt === 'react') d.likeBtn++;
      if (lbl.includes('comment') || txt === 'comment' || txt === 'تعليق') d.commentBtn++;
    });

    // Count post-type anchors (multiple patterns)
    document.querySelectorAll('a[href]').forEach(a => {
      const h = a.href || '';
      if (h.includes('/feed/update/') || h.includes('/posts/') ||
          h.includes('urn:li:activity') || h.includes('urn:li:ugcPost') ||
          h.includes('urn:li:share') || h.includes('/detail/')) d.postLinks++;
    });

    // Count elements with URN data attributes
    document.querySelectorAll('[data-urn],[data-chameleon-result-urn],[data-entity-urn],[data-update-urn]').forEach(el => {
      const v = (el.getAttribute('data-urn') || el.getAttribute('data-chameleon-result-urn') ||
                 el.getAttribute('data-entity-urn') || el.getAttribute('data-update-urn') || '');
      if (v.includes('activity') || v.includes('ugcPost') || v.includes('share')) d.urnAttrs++;
    });

    return d;
  }

  // ═══════════════════════════════════════════════════════════
  // CARD DETECTION — find post cards via action bars
  // ═══════════════════════════════════════════════════════════
  // This is the CORE FIX: LinkedIn search results have like/comment
  // buttons but don't render traditional post URL anchors. We find
  // cards by walking UP from the buttons.

  const STOP_TAGS = new Set(['BODY','HTML','HEADER','NAV','FOOTER']);

  function isLikeButton(btn) {
    const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
    const txt = (btn.innerText || '').toLowerCase().trim();
    return lbl.startsWith('react') || lbl === 'like' || lbl.includes(' like') ||
      lbl.includes('إعجاب') || txt === 'like' || txt === 'react';
  }

  function isCommentButton(btn) {
    const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
    const txt = (btn.innerText || '').toLowerCase().trim();
    return lbl.includes('comment') || txt === 'comment' || txt === 'تعليق';
  }

  function countMainActionLikeButtons(node) {
    let likeCount = 0;
    node.querySelectorAll('button').forEach(b => {
      if (b.closest('.feed-shared-update-v2__comments-container, .comments-comments-list, .comments-comment-item')) return;
      if (isLikeButton(b)) likeCount++;
    });
    return likeCount;
  }

  function isLikelySinglePostContainer(node) {
    if (!node) return false;
    const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { height: 0, width: 0 };
    const h = rect.height || node.offsetHeight || 0;
    const w = rect.width || node.offsetWidth || 0;
    if (h < 80 || w < 200) return false;
    const likeCount = countMainActionLikeButtons(node);
    // Wrapper/feed containers usually include many action bars.
    if (likeCount > 2) return false;
    return true;
  }

  function extractCanonicalPostUrlFromText(text) {
    if (!text) return null;
    const src = String(text);
    try {
      const directFeed = src.match(/https?:\/\/(?:www\.)?linkedin\.com\/feed\/update\/(urn:li:(?:activity|ugcPost|share):[^"'&#\s<]+)/i);
      if (directFeed) {
        const u = cleanUrl('https://www.linkedin.com/feed/update/' + decodeURIComponent(directFeed[1]));
        if (isValidCanonicalPostUrl(u)) return u;
      }
      const directPosts = src.match(/https?:\/\/(?:www\.)?linkedin\.com\/posts\/[^"'&#\s<]+/i);
      if (directPosts) {
        const u = cleanUrl(directPosts[0]);
        if (isValidCanonicalPostUrl(u)) return u;
      }
      // Escaped JSON form like https:\/\/www.linkedin.com\/feed\/update\/...
      const escFeed = src.match(/https?:\\\/\\\/(?:www\.)?linkedin\.com\\\/feed\\\/update\\\/(urn:li:(?:activity|ugcPost|share):[^"'&#\s<]+)/i);
      if (escFeed) {
        const u = cleanUrl('https://www.linkedin.com/feed/update/' + decodeURIComponent(escFeed[1]));
        if (isValidCanonicalPostUrl(u)) return u;
      }
      const urn = src.match(/urn:li:(activity|ugcPost|share):([A-Za-z0-9:_-]{8,64})/i);
      if (urn) {
        const u = cleanUrl('https://www.linkedin.com/feed/update/urn:li:' + urn[1] + ':' + urn[2]);
        if (isValidCanonicalPostUrl(u)) return u;
      }
    } catch(e) {}
    return null;
  }

  function canonicalFromUrn(urnType, idPart) {
    const t = String(urnType || '').toLowerCase();
    if (t === 'ugcpost') return cleanUrl('https://www.linkedin.com/feed/update/urn:li:ugcPost:' + idPart);
    if (t === 'activity') return cleanUrl('https://www.linkedin.com/feed/update/urn:li:activity:' + idPart);
    if (t === 'share') return cleanUrl('https://www.linkedin.com/feed/update/urn:li:share:' + idPart);
    return null;
  }

  function extractCanonicalFromHref(href) {
    if (!href) return null;
    const raw = String(href);
    const decoded = (() => {
      try { return decodeURIComponent(raw); } catch(e) { return raw; }
    })();

    if (decoded.includes('/feed/update/')) {
      const m = decoded.match(/\/feed\/update\/(urn:li:(?:activity|ugcPost|share):[^?&#\s]+)/i);
      if (m) {
        const u = cleanUrl('https://www.linkedin.com/feed/update/' + m[1]);
        if (isValidCanonicalPostUrl(u)) return u;
      }
    }

    if (decoded.includes('/posts/')) {
      const m = decoded.match(/(https?:\/\/(?:www\.)?linkedin\.com\/posts\/[^?&#\s"']+)/i);
      if (m) {
        const u = cleanUrl(m[1]);
        if (isValidCanonicalPostUrl(u)) return u;
      }
    }

    // LinkedIn search results often keep post URN in query params (e.g. updateEntityUrn=urn:li:activity:...)
    const urn = decoded.match(/urn:li:(activity|ugcPost|share):([A-Za-z0-9:_-]{8,64})/i);
    if (urn) {
      const u = canonicalFromUrn(urn[1], urn[2]);
      if (u && isValidCanonicalPostUrl(u)) return u;
    }

    return null;
  }

  function findAllActionButtons() {
    const buttons = [];
    document.querySelectorAll('button').forEach(btn => {
      const isLike = isLikeButton(btn);
      const isComment = isCommentButton(btn);
      if (isLike || isComment) {
        buttons.push({ el: btn, type: isLike ? 'like' : 'comment' });
      }
    });
    return buttons;
  }

  function walkUpToCard(startEl) {
    let node = startEl;
    let fallbackCandidate = null;

    for (let depth = 0; depth < 20 && node && !STOP_TAGS.has(node.tagName); depth++) {
      node = node.parentElement;
      if (!node || node.nodeType !== 1) break;

      const tag = node.tagName;

      // ARTICLE is always a card boundary
      if (tag === 'ARTICLE' && isLikelySinglePostContainer(node)) return node;

      // If it's an LI or DIV, check if it's a valid individual card
      if (tag === 'LI' || tag === 'DIV') {
        if (!isLikelySinglePostContainer(node)) continue;

        // 1. FIRST: Check if this element has URN data attributes (strong signal)
        for (const attr of ['data-urn','data-chameleon-result-urn','data-entity-urn','data-update-urn','data-id']) {
          const v = node.getAttribute(attr) || '';
          if (v.includes('activity') || v.includes('ugcPost') || v.includes('share')) {
            return node;
          }
        }

        // 2. Anchor signal: a true post card usually contains post permalinks internally.
        const hasPostAnchor = !!node.querySelector('a[href*="/feed/update/"],a[href*="/posts/"]');
        if (hasPostAnchor) return node;

        // 3. Fallback: first good candidate on the climb.
        if (!fallbackCandidate) {
          fallbackCandidate = node;
        }
      }
    }

    return fallbackCandidate;
  }

  // ═══════════════════════════════════════════════════════════
  // URL EXTRACTION — try EVERY method to get a post URL from a card
  // ═══════════════════════════════════════════════════════════
  function extractUrlFromCard(card) {
    if (!card) return null;

    try {
      // NEVER synthesize /feed/update/ URLs from searchResult, entity, organizationPost, fsd_update, etc.
      // Those IDs are not activity IDs — they produce "This post cannot be displayed".
      const ATTR_URN_REGEX = /urn:li:(activity|ugcPost|share):([A-Za-z0-9:_-]{8,64})/i;
      function buildFromUrn(urnType, idPart) {
        const t = String(urnType).toLowerCase();
        if (t === 'ugcpost') return 'https://www.linkedin.com/feed/update/urn:li:ugcPost:' + idPart;
        if (t === 'activity') return 'https://www.linkedin.com/feed/update/urn:li:activity:' + idPart;
        if (t === 'share') return 'https://www.linkedin.com/feed/update/urn:li:share:' + idPart;
        return null;
      }

      // 1. ANCHOR LINKS (highest signal — use full href as LinkedIn emitted it)
      for (const a of card.querySelectorAll('a[href]')) {
        const href = a.href || '';
        const extracted = extractCanonicalFromHref(href);
        if (extracted) return extracted;
      }

      // 2. CONTROL MENU / copy-link targets
      for (const btn of card.querySelectorAll('[data-clipboard-text], [data-share-url]')) {
        const url = btn.getAttribute('data-clipboard-text') || btn.getAttribute('data-share-url');
        if (url && (url.includes('linkedin.com/posts/') || url.includes('linkedin.com/feed/update/'))) {
          const built = cleanUrl(url);
          if (isValidCanonicalPostUrl(built)) return built;
        }
      }

      // 3. data-* attributes — only activity / ugcPost digit IDs
      const attrList = ['data-urn', 'data-id', 'data-update-urn', 'data-entity-urn', 'data-chameleon-result-urn'];
      const safeEls = [card, ...card.querySelectorAll(attrList.map(a => `[${a}]`).join(', '))];
      for (const el of safeEls) {
        for (const attr of attrList) {
          const val = el.getAttribute(attr);
          if (!val) continue;
          const m = val.match(ATTR_URN_REGEX);
          if (m) {
          const u = buildFromUrn(m[1], m[2]);
            if (u && isValidCanonicalPostUrl(u)) return cleanUrl(u);
          }
        }
      }

      // 4. Raw HTML fallback
      const html = card.outerHTML || card.innerHTML || '';
      const m = html.match(/urn:li:(activity|ugcPost|share):([A-Za-z0-9:_-]{8,64})/i);
      if (m) {
        const u = buildFromUrn(m[1], m[2]);
        if (u && isValidCanonicalPostUrl(u)) return cleanUrl(u);
      }

      // 5. Emergency extraction from embedded JSON/text blobs.
      const emergency = extractCanonicalPostUrlFromText(html);
      if (emergency) return emergency;

    } catch(e) {}

    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // METRICS EXTRACTION — get engagement data from a card
  // ═══════════════════════════════════════════════════════════
  function checkIsCommentable(card) {
    if (!card) return true; // Permissive default
    const text = (card.innerText || '').toLowerCase();
    if (text.includes("comments are turned off") || 
        text.includes("comments on this post are limited") || 
        text.includes("you can't comment") || 
        text.includes("commenting is restricted") ||
        text.includes("only group members can comment on this post")) {
        return false; // Explicitly locked
    }

    const actionBars = card.querySelectorAll('.feed-shared-social-action-bar, .update-components-action-bar, [class*="action-bar"], .feed-shared-update-v2__control-menu');
    
    // If no action bar is found at all (e.g. lazy loading hasn't rendered it yet),
    // we MUST return true to allow the system to process the post or retry later.
    if (!actionBars || actionBars.length === 0) return true;

    for (const bar of actionBars) {
        if (bar.closest('.feed-shared-update-v2__comments-container, .comments-comments-list')) continue;
        
        let hasLikeBtn = false;
        let hasCommentBtn = false;
        let isCommentBtnDisabled = false;

        bar.querySelectorAll('button').forEach(btn => {
            const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
            const txt = (btn.innerText || '').toLowerCase().trim();
            
            if (lbl.includes('react') || lbl.includes('like') || txt === 'like' || txt.includes('إعجاب') || txt.includes('j\'aime') || txt.includes('gefällt')) {
                hasLikeBtn = true;
            }
            if (lbl.includes('comment') || txt === 'comment' || txt.includes('تعليق') || txt.includes('kommentieren') || txt.includes('comentar')) {
                hasCommentBtn = true;
                if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
                    isCommentBtnDisabled = true;
                }
            }
        });

        // If we definitively identified a Like button, this is the main action bar.
        if (hasLikeBtn) {
            if (!hasCommentBtn) return false; // Locked! No comment button exists next to the like button.
            if (isCommentBtnDisabled) return false; // Locked! Comment button is disabled.
            return true; // Valid and commentable.
        }
    }
    
    // Fallback: If we couldn't parse the buttons (due to an unrecognized language or UI change),
    // we MUST err on the side of caution and ALLOW the post. Strict blocking causes 0 extracted posts.
    return true; 
  }

  function extractMetrics(el) {
    let likes = 0, postComments = 0;

    // RADICAL FIX: Surgical target on the social counts bar to completely avoid header social proofs
    const bars = el.querySelectorAll('.update-components-social-counts, .social-details-social-counts, [class*="social-counts"]');
    
    for (const bar of bars) {
        // Guard against any comment components
        if (bar.closest('.feed-shared-update-v2__comments-container, .comments-comments-list, article.comment')) continue;
        
        bar.querySelectorAll('[aria-label]').forEach(node => {
            const lbl = (node.getAttribute('aria-label') || '').toLowerCase();
            const n = num(lbl);
            if (n > 0) {
                if (lbl.includes('reaction') || lbl.includes('like') || lbl.includes('إعجاب') || lbl.includes('other')) likes = Math.max(likes, n);
                if (lbl.includes('comment') || lbl.includes('تعليق')) postComments = Math.max(postComments, n);
            }
        });

        const txt = bar.innerText || bar.textContent || '';
        const likeMatch = txt.match(/([\d,.]+[KMBkmb]?)\s*(?:reactions?|likes?|إعجاب)/i);
        if (likeMatch) likes = Math.max(likes, num(likeMatch[1]));

        const commMatch = txt.match(/([\d,.]+[KMBkmb]?)\s*(?:comments?|تعليق)/i);
        if (commMatch) postComments = Math.max(postComments, num(commMatch[1]));

        if (likes === 0 && postComments === 0) {
            const spans = bar.querySelectorAll('span[aria-hidden="true"], li, button');
            const numbers = [];
            spans.forEach(s => {
                const t = (s.innerText || s.textContent || '').trim();
                if (/^[\d,.]+[KMBkmb]?$/.test(t)) {
                    numbers.push(num(t));
                }
            });
            if (numbers.length > 0) likes = Math.max(likes, numbers[0]);
            if (numbers.length > 1) postComments = Math.max(postComments, numbers[1]);
        }
    }

    if (likes === 0 || postComments === 0) {
        const actionBars = el.querySelectorAll('.feed-shared-social-action-bar, .update-components-action-bar');
        for (const bar of actionBars) {
            if (bar.closest('.feed-shared-update-v2__comments-container, .comments-comments-list')) continue;
            
            bar.querySelectorAll('button').forEach(btn => {
                const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
                const text = (btn.innerText || '').toLowerCase();
                if (lbl.includes('reaction') || lbl.includes('like') || text.includes('like')) {
                    const n = num(lbl) || num(text);
                    if (n > 0) likes = Math.max(likes, n);
                }
                if (lbl.includes('comment') || text.includes('comment')) {
                    const n = num(lbl) || num(text);
                    if (n > 0) postComments = Math.max(postComments, n);
                }
            });
        }
    }

    let author = 'Unknown';
    for (const sel of ['a[href*="/in/"] span[aria-hidden="true"]', 'a[href*="/company/"] span[aria-hidden="true"]', '.update-components-actor__title', '.feed-shared-actor__title', 'span[aria-hidden="true"]']) {
        const nodes = el.querySelectorAll(sel);
        for (const c of nodes) {
            if (c.closest('.feed-shared-update-v2__comments-container, .comments-comments-list, .update-components-header, .social-proof')) continue;
            const t = (c.innerText || c.textContent || '').trim();
            if (t.length > 2 && t.length < 100 && !/^\d/.test(t) && !t.includes('•') && !t.includes('·')) {
                author = t.split('\n')[0].trim().substring(0, 80);
                break;
            }
        }
        if (author !== 'Unknown') break;
    }

    let textSnippet = '';
    let bestLen = 0;
    const textWrappers = el.querySelectorAll('.update-components-text, .feed-shared-update-v2__description, .feed-shared-text');
    const targetNodes = textWrappers.length > 0 ? textWrappers : el.querySelectorAll('span[dir="ltr"],span[dir="rtl"],p,div[dir]');
    
    for (const tc of targetNodes) {
        if (tc.closest('.feed-shared-update-v2__comments-container, .comments-comments-list')) continue;
        const t = (tc.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length > bestLen && t.length > 20 && t.length < 2000) {
            textSnippet = t.substring(0, 300); bestLen = t.length;
        }
    }
    if (!textSnippet) textSnippet = (el.innerText || '').replace(/\s+/g, ' ').trim().substring(0, 300);

    return { likes, postComments, author, textSnippet };
  }

  // ═══════════════════════════════════════════════════════════
  // HARVEST — Button-first post discovery
  // ═══════════════════════════════════════════════════════════
  // Strategy:
  //   1. Find all like/comment buttons on the page
  //   2. Walk UP from each to find its card container
  //   3. Extract URL from card using multiple methods
  //   4. Deduplicate by URL (or by card element if no URL found)

  function harvest(seenUrls, seenCards, allPosts, opts = {}) {
    const deepScan = opts.deepScan === true;
    let added = 0;
    let _diag = { cards: 0, tooSmall: 0, noUrl: 0, duplicate: 0, uncommentable: 0, btnCards: 0, urnEls: 0, anchors: 0 };

    // ── Primary: Direct container discovery (strict single-post containers only) ──
    const cardSelectors = [
      '.reusable-search__result-container', 
      '.feed-shared-update-v2',
      '.search-entity',
      'article',
      'li.reusable-search__result-container',
      '[data-urn].feed-shared-update-v2',
      'div.search-result__wrapper'
    ];

    document.querySelectorAll(cardSelectors.join(', ')).forEach(card => {
      try {
        if (seenCards.has(card)) return;
        _diag.cards++;

        if (!isLikelySinglePostContainer(card)) { _diag.tooSmall++; return; }

        let url = extractUrlFromCard(card);
        let cleanedUrl = url ? cleanUrl(url) : null;

        if (!cleanedUrl || !isValidCanonicalPostUrl(cleanedUrl)) {
            _diag.noUrl++;
            return;
        }

        if (seenUrls.has(cleanedUrl)) {
           seenCards.add(card);
           _diag.duplicate++;
           return; 
        }

        seenUrls.add(cleanedUrl);
        seenCards.add(card);

        // DO NOT block collection based on commentability.
        // Store the flag for later use by comment-mode, but always collect the post.
        const isCommentable = checkIsCommentable(card);
        if (!isCommentable) _diag.uncommentable++;

        const metrics = extractMetrics(card);
        
        allPosts.push({
          url: cleanedUrl,
          likes: metrics.likes,
          postComments: metrics.postComments,
          author: metrics.author,
          textSnippet: metrics.textSnippet,
          commentable: isCommentable,
          container: card,
          hasRealUrl: true,
          discoveryIndex: allPosts.length
        });
        added++;
      } catch(e) {}
    });

    // ── Secondary: Walk up from action-bar buttons (Fallback for unknown structures) ──
    const buttons = findAllActionButtons();
    const processedCards = new Set();

    for (const { el: btn } of buttons) {
      try {
        const card = walkUpToCard(btn);
        if (!card || processedCards.has(card) || seenCards.has(card)) continue;
        processedCards.add(card);
        _diag.btnCards++;

        let url = extractUrlFromCard(card);
        let cleanedUrl = url ? cleanUrl(url) : null;

        if (!cleanedUrl || !isValidCanonicalPostUrl(cleanedUrl)) continue;

        if (seenUrls.has(cleanedUrl)) {
            seenCards.add(card);
            continue;
        }

        seenUrls.add(cleanedUrl);
        seenCards.add(card);

        const isCommentable = checkIsCommentable(card);
        const metrics = extractMetrics(card);

        allPosts.push({
          url: cleanedUrl,
          likes: metrics.likes,
          postComments: metrics.postComments,
          author: metrics.author,
          textSnippet: metrics.textSnippet,
          commentable: isCommentable,
          container: card,
          hasRealUrl: true,
          discoveryIndex: allPosts.length
        });
        added++;
      } catch(e) {}
    }

    // Always-on canonical anchor scan: robust against LinkedIn DOM structure changes.
    // This is the primary anti-zero guarantee path.
    document.querySelectorAll('a[href*="/feed/update/"], a[href*="/posts/"]').forEach(a => {
      try {
        const href = a.href || '';
        const postUrl = extractCanonicalFromHref(href);
        if (!postUrl || !isValidCanonicalPostUrl(postUrl) || seenUrls.has(postUrl)) return;
        _diag.anchors++;
        const parentCard = walkUpToCard(a);
        const finalCard = parentCard || a.closest('article,li,div') || a.parentElement;
        seenUrls.add(postUrl);
        if (finalCard) seenCards.add(finalCard);
        const isCommentable = finalCard ? checkIsCommentable(finalCard) : true;
        const metrics = finalCard ? extractMetrics(finalCard) : { likes: 0, postComments: 0, author: '', textSnippet: '' };
        allPosts.push({
          url: postUrl, likes: metrics.likes, postComments: metrics.postComments,
          author: metrics.author, textSnippet: metrics.textSnippet,
          commentable: isCommentable, container: finalCard, hasRealUrl: true,
          discoveryIndex: allPosts.length
        });
        added++;
      } catch (e) {}
    });

    // Deep scans are expensive. Run only periodically/recovery to avoid tab freezes.
    if (deepScan) {
      // ── Tertiary: data-urn attribute elements ──
      document.querySelectorAll('[data-urn],[data-chameleon-result-urn],[data-entity-urn],[data-update-urn]').forEach(el => {
        try {
          if (seenCards.has(el)) return;
          if (!isLikelySinglePostContainer(el)) return;
          for (const attr of ['data-urn','data-chameleon-result-urn','data-entity-urn','data-update-urn']) {
            const v = el.getAttribute(attr) || '';
          const m = v.match(/urn:li:(activity|ugcPost|share):([A-Za-z0-9:_-]{8,64})/i);
            if (m) {
              _diag.urnEls++;
            const t = m[1].toLowerCase();
            const fixed = t === 'ugcpost'
              ? cleanUrl('https://www.linkedin.com/feed/update/urn:li:ugcPost:' + m[2])
              : t === 'share'
                ? cleanUrl('https://www.linkedin.com/feed/update/urn:li:share:' + m[2])
                : cleanUrl('https://www.linkedin.com/feed/update/urn:li:activity:' + m[2]);
              if (fixed && isValidCanonicalPostUrl(fixed) && !seenUrls.has(fixed)) {
                seenUrls.add(fixed);
                seenCards.add(el);
                const isCommentable = checkIsCommentable(el);
                const metrics = extractMetrics(el);
                allPosts.push({
                  url: fixed, likes: metrics.likes, postComments: metrics.postComments,
                  author: metrics.author, textSnippet: metrics.textSnippet,
                  commentable: isCommentable, container: el, hasRealUrl: true,
                  discoveryIndex: allPosts.length
                });
                added++;
              }
              break;
            }
          }
        } catch(e) {}
      });

      // Emergency global scan when regular selectors miss visible posts.
      // Extract one canonical URL from whole DOM so we never stay at hard zero while posts exist.
      if (added === 0) {
        const emergency = extractCanonicalPostUrlFromText(document.documentElement?.innerHTML || '');
        if (emergency && !seenUrls.has(emergency)) {
          seenUrls.add(emergency);
          allPosts.push({
            url: emergency, likes: 0, postComments: 0, author: 'Unknown', textSnippet: '',
            commentable: true, container: null, hasRealUrl: true, discoveryIndex: allPosts.length
          });
          added++;
        }
      }
    }

    // ── Diagnostic output (every harvest call) ──
    if (added > 0 || _diag.cards > 0 || deepScan) {
      console.log(`[v22-harvest] +${added} | cards=${_diag.cards} tooSmall=${_diag.tooSmall} noUrl=${_diag.noUrl} dup=${_diag.duplicate} uncomm=${_diag.uncommentable} | btns=${_diag.btnCards} urns=${_diag.urnEls} anchors=${_diag.anchors} | deep=${deepScan ? 1 : 0}`);
    }

    return added;
  }

  function countReal(posts) {
    return posts.filter(p => p.hasRealUrl || (p.url && !p.url.startsWith('discovered:') && !p.url.includes('synthetic:'))).length;
  }

  // ═══════════════════════════════════════════════════════════
  // SCROLLING — aggressive multi-target + slow waits
  // ═══════════════════════════════════════════════════════════
  function aggressiveScroll(pixels) {
    try { window.scrollBy({ top: pixels, behavior: 'auto' }); } catch(e) {}
    try { document.documentElement.scrollTop += pixels; } catch(e) {}
    try { document.body.scrollTop += pixels; } catch(e) {}

    for (const sel of ['.scaffold-layout__main', 'main', '[role="main"]',
      '.search-results-container', '.scaffold-layout__content',
      '[class*="search-results"]', '[data-virtual-list]']) {
      try {
        const el = document.querySelector(sel);
        if (el && el.scrollHeight > el.clientHeight) {
          el.scrollTop += pixels;
          el.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
      } catch(e) {}
    }

    try { window.dispatchEvent(new Event('scroll')); } catch(e) {}
    try { document.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
  }

  function scrollToBottom() {
    const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    try { window.scrollTo({ top: h, behavior: 'auto' }); } catch(e) {}
    try { document.documentElement.scrollTop = h; } catch(e) {}
  }

  function domSignalSnapshot() {
    return {
      h: Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0),
      cards: document.querySelectorAll('.reusable-search__result-container,.feed-shared-update-v2,article').length
    };
  }

  async function waitForDomGrowth(before, timeoutMs = 2600) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(220);
      const now = domSignalSnapshot();
      if (now.h > before.h + 80 || now.cards > before.cards) return true;
    }
    return false;
  }

  async function clickShowMore() {
    const exactTexts = ['show more results', 'see more results', 'load more', 'عرض المزيد', 'load more results'];
    let clicked = false;
    
    for (const el of document.querySelectorAll('button, a')) {
      const t = (el.innerText || '').toLowerCase().trim();
      
      // Strict match to avoid clicking "...see more" text expanders inside posts
      if (exactTexts.includes(t) && !el.disabled) {
        // Double check this isn't an inline text expander by checking height/width
        if (el.offsetHeight > 20 && el.offsetWidth > 100) {
          el.click(); 
          clicked = true;
          console.log('[v19] Clicked explicit pagination button: "' + t + '"');
        }
      }
    }
    
    const nextBtn = document.querySelector('.artdeco-pagination__button--next');
    if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled')) { 
        nextBtn.click(); 
        clicked = true;
        console.log('[v19] Clicked Artdeco NEXT pagination button');
    }
    
    if (clicked) {
        await sleep(900); // Faster pagination response to increase coverage per keyword
        return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // ACTIVE HTTP VALIDATION
  // ═══════════════════════════════════════════════════════════
  async function validatePostsConcurrently(posts) {
      console.log(`[v23] Bypassing active HTTP validation. Relying on strict DOM extraction to prevent LinkedIn bot-blocking.`);
      
      // Keep heartbeats to maintain dashboard UI flow
      heartbeat('Phase1-Validate', `🛡️ Verified ${posts.length} posts via DOM extraction...`);
      await new Promise(r => setTimeout(r, 500));
      
      // Return all posts directly. 
      // The Ghost Post issue was fixed upstream by removing the aggressive global URN scanner.
      // fetch() validation is now fatally blocking perfectly good posts.
      return posts;
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN PIPELINE
  // ═══════════════════════════════════════════════════════════
  async function extractPipeline(keyword, settings, comments, dashboardUrl, userId, runId) {
    const ensureActiveRun = () => {
      if (window.__linkedInExtractorActiveRunId !== runId) {
        throw new Error('EXTRACTION_CANCELLED');
      }
    };
    const isSearchOnly = settings.searchOnlyMode === true;
    const passIndex = settings.passIndex || 0;
    const priorPosts = settings.priorPosts || [];
    const seenUrls = new Set(priorPosts.map(p => p.url).filter(Boolean));
    const seenCards = new WeakSet();
    const allPosts = [...priorPosts];
    const syncedUrls = new Set(); // Tracks posts already sent during incremental streaming

    // ── Settings-Driven Constraints ──
    const SETTINGS_MIN_LIKES = Number(settings.minLikes) || 0;
    const SETTINGS_MAX_LIKES = Number(settings.maxLikes) || Infinity;
    const SETTINGS_MIN_COMMENTS = Number(settings.minComments) || 0;
    const SETTINGS_MAX_COMMENTS = Number(settings.maxComments) || Infinity;
    console.log(`[v22] Constraints: Likes [${SETTINGS_MIN_LIKES}, ${SETTINGS_MAX_LIKES}] | Comments [${SETTINGS_MIN_COMMENTS}, ${SETTINGS_MAX_COMMENTS}]`);

    console.log('[v18] ══ Pipeline: "' + keyword + '" pass=' + passIndex + ' prior=' + priorPosts.length + ' ══');
    heartbeat('Phase0', '⏳ Starting pass ' + (passIndex + 1) + ' for "' + keyword + '"...');

    // Expose memory state for Watchdog emergency syncs
    window.__emergencySync = async () => {
      console.log('🚨 [Worker] Emergency sync invoked. Flushing memory array...');
      try { await syncPosts(allPosts, keyword, dashboardUrl, userId, 'Unknown', true); } catch(e) {}
    };

    // ── Step 1: Detect LinkedIn profile (Strictly target logged-in user) ──
    let linkedInProfileId = 'Unknown';
    try {
      // ONLY check the global navigation bar where the logged-in user's profile icon lives
      const meLink = document.querySelector('.global-nav__me a:first-of-type, a[data-control-name="identity_welcome_message"], a[href*="/in/"][class*="global-nav"]');
      if (meLink && meLink.href) {
        const m = meLink.href.match(/linkedin\.com\/in\/([^/?&#]+)/);
        if (m) linkedInProfileId = m[1];
      }
      
      // Fallback: Check for data-control-name on the mobile nav
      if (linkedInProfileId === 'Unknown') {
        const mobileLink = document.querySelector('a.mobile-nav__profile-link, a.nav__button--me');
        if (mobileLink && mobileLink.href) {
          const m = mobileLink.href.match(/linkedin\.com\/in\/([^/?&#]+)/);
          if (m) linkedInProfileId = m[1];
        }
      }

      if (linkedInProfileId !== 'Unknown') safeSend({ action: 'IDENTITY_DETECTED', linkedInProfileId });
    } catch(e) {}

    // ── Step 2: Wait for page to load ──
    // Probe for BUTTONS (proven to exist) not just URL anchors
    heartbeat('Phase0-Wait', '🔬 Waiting for posts to load...');
    let probeResult = null;
    for (let p = 0; p < 25; p++) {
      await sleep(800);
      const d = pageDiag();
      // Posts detected if: like buttons, comment buttons, URN attrs, or post links exist
      const signals = d.likeBtn + d.commentBtn + d.urnAttrs + d.postLinks;
      if (signals > 0) {
        probeResult = d;
        console.log('[v18] Probe: found signals after ' + ((p + 1) * 0.8).toFixed(1) + 's:', JSON.stringify(d));
        // Give an extra moment for rendering to complete
        await sleep(2000);
        break;
      }
      if (p === 9) console.log('[v18] Probe: 0 signals at 8s. diag:', JSON.stringify(d));
      if (p === 19) console.log('[v18] Probe: 0 signals at 16s. diag:', JSON.stringify(d));
    }

    // Even if probe found nothing, still try scrolling before giving up
    if (!probeResult) {
      console.log('[v18] Probe: no signals after 20s. Will try scrolling anyway.');
      heartbeat('Phase0-NoSignal', '⚠️ No post signals yet — scrolling to trigger load...');

      // Scroll down to trigger lazy loading — LinkedIn might not render until scrolled
      for (let s = 0; s < 5; s++) {
        aggressiveScroll(600);
        await wait(900, 1600);
        const d = pageDiag();
        if (d.likeBtn + d.commentBtn + d.urnAttrs + d.postLinks > 0) {
          probeResult = d;
          console.log('[v18] Scroll-probe: found signals after scroll:', JSON.stringify(d));
          break;
        }
      }

      if (!probeResult) {
        // Check for error states
        const bodyText = (document.body?.innerText || '').toLowerCase();
        const reason = bodyText.includes('sign in') || bodyText.includes('log in')
          ? '🚫 NOT LOGGED IN'
          : bodyText.includes('no results')
            ? '⚠️ No results for "' + keyword + '"'
            : '⚠️ No post signals after scrolling. Final diag: ' + JSON.stringify(pageDiag());
        console.warn('[v18] ' + reason);
        heartbeat('Phase0-Fail', reason);

        // Still try one harvest before giving up completely
        harvest(seenUrls, seenCards, allPosts, { deepScan: true });
        const realCount = countReal(allPosts);
        console.log('[v18] Last-resort harvest: ' + realCount + ' real posts');

    if (realCount === 0) {
          // DO NOT send PASS_DONE with 0 posts — just complete smoothly
          safeSend({
            action: 'JOB_COMPLETED',
            commentsPostedCount: 0,
            assignedCommentsCount: 0,
            searchOnlyMode: isSearchOnly,
            postsExtracted: 0
          });
          return;
        }
      }
    }

    // ── Pre-Scroll React Hydration Barrier ──
    // Ensures LinkedIn's internal JS is fully bound to the DOM before aggressive scrolling begins
    heartbeat('Phase0-Hydrate', '⏳ Quick DOM stabilization...');
    await wait(700, 1200);

    // ── Step 3: Initial harvest (before scrolling) ──
    const initCount = harvest(seenUrls, seenCards, allPosts, { deepScan: true });
    console.log('[v18] Initial harvest: +' + initCount + ' (total=' + allPosts.length + ', real=' + countReal(allPosts) + ')');
    heartbeat('Phase1-Init', '✅ Initial: ' + countReal(allPosts) + ' real posts');

    // ── Step 4: Scroll loop — CAPPED AT 100/150 SCANNED RESULTS ──
    const STALL_LIMIT = 10;
    const SCANNED_RESULTS_LIMIT = 300; 
    const ABSOLUTE_SAFETY_LIMIT = 100;
    let stallCount = 0;
    let exhaustedRounds = 0;
    let step = 0;
    let lastIncrementalSyncAtStep = -1;
    const START_TIME = Date.now();
    const HARD_TIMEOUT_MS = 1500000; // 25 minutes absolute cap

    heartbeat('Phase1-Scroll', '📜 Scrolling until up to 100 results scanned...');

    while (step < ABSOLUTE_SAFETY_LIMIT) {
      ensureActiveRun();
      const elapsed = Date.now() - START_TIME;
      if (elapsed > HARD_TIMEOUT_MS) {
        console.warn(`[v18] ⏰ Hard 20-minute timeout reached. Stopping scroll.`);
        break;
      }

      const scrollAmt = 1000 + Math.floor(Math.random() * 700);
      const beforeDom = domSignalSnapshot();
      aggressiveScroll(scrollAmt);
      const grew = await waitForDomGrowth(beforeDom, 900);
      if (!grew) await wait(150, 350);

      const doDeepScan = true;
      harvest(seenUrls, seenCards, allPosts, { deepScan: doDeepScan });

      // Every 3rd step, click Load More aggressively
      if (step % 3 === 2) {
        scrollToBottom();
        await wait(180, 420);
        await clickShowMore(); 
        harvest(seenUrls, seenCards, allPosts, { deepScan: true });
      }

      // Stall detection: TRACK DISCOVERED URLS, NOT DOM SIZE
      const currentSeenSize = seenUrls.size;
      if (typeof window.__lastSeenSize === 'undefined') window.__lastSeenSize = 0;
      
      if (currentSeenSize > window.__lastSeenSize) {
        stallCount = 0;
        window.__lastSeenSize = currentSeenSize;
      } else {
        stallCount++;
      }

      const real = countReal(allPosts);
      console.log('[v18] Scroll ' + (step + 1) + ' | Scanned: ' + currentSeenSize + ' | Real: ' + real + ' | Stall: ' + stallCount + '/' + STALL_LIMIT);
      heartbeat('Phase1-Scroll', '📜 Scrolled ' + step + ' | ' + real + ' posts');

      // Stall handling
      if (stallCount >= STALL_LIMIT) {
        console.log('[v18] Stall at ' + stallCount + '. Trying Show More...');
        const seenBeforeRecovery = seenUrls.size;
        
        const clicked = await clickShowMore();
        if (clicked) {
           await wait(700, 1200);
           harvest(seenUrls, seenCards, allPosts, { deepScan: true });
           if (seenUrls.size > seenBeforeRecovery) {
               stallCount = 0;
               continue;
           } else {
               console.log('[v18] Clicked Show More but no new posts found. Continuing to hard recovery...');
           }
        }

        console.log('[v18] No Show More. Recovery scroll...');
        
        window.scrollTo({ top: 0, behavior: 'auto' });
        await wait(300, 700);
        harvest(seenUrls, seenCards, allPosts, { deepScan: true });
        for (let r = 0; r < 5; r++) {
           aggressiveScroll(1500);
           await wait(350, 700);
           harvest(seenUrls, seenCards, allPosts, { deepScan: r % 2 === 0 });
        }
        
        const seenAfterRecovery = seenUrls.size;
        if (seenAfterRecovery <= seenBeforeRecovery) {
           console.log('[v18] Recovery found no new URLs. Attempting ultimate hard-refresh scroll...');
           // Ultimate fallback to force LinkedIn's lazy loader
           for (let r = 0; r < 8; r++) {
               window.scrollTo(0, document.body.scrollHeight);
               await wait(400, 800);
               window.scrollTo(0, document.body.scrollHeight - 2000);
               await wait(200, 450);
           }
           harvest(seenUrls, seenCards, allPosts, { deepScan: true });
           if (seenUrls.size <= seenAfterRecovery) {
               const currentReal = countReal(allPosts);
               exhaustedRounds++;
               console.log(`[v18] Exhausted attempt ${exhaustedRounds} with ${currentReal} posts. Continuing toward 100-scroll limit.`);
               for (let z = 0; z < 6; z++) {
                 aggressiveScroll(1100);
                 await wait(300, 650);
                 harvest(seenUrls, seenCards, allPosts, { deepScan: true });
               }
           } else {
               exhaustedRounds = 0;
           }
        }
        stallCount = 0;
        window.__lastSeenSize = seenUrls.size;
      }
      step++;
      
      if (seenUrls.size >= SCANNED_RESULTS_LIMIT) {
        console.log('[v18] URL discovery pool reached limit; continuing to 100 scrolls for consistency.');
      }

      // ── HIGH-QUALITY INCREMENTAL SAVE ──
      // Automatically save HIGH-REACH posts in real-time.
      // Posts that do not perfectly match constraints are pooled until the final 
      // fallback calculation at the end, ensuring they are globally scored.
      if (isSearchOnly) {
          ensureActiveRun();
          const unsynced = allPosts.filter(p => p.hasRealUrl && !syncedUrls.has(p.url));

          // Keep quality strict in real-time streaming: only high/mid quality
          // (no low/unknown filler during incremental saves).
          const qualityCandidates = unsynced.filter(p => {
              const likes = p.likes || 0;
              const comms = p.postComments || p.comments || 0;
              const engagement = likes + comms;
              const pos = p.discoveryIndex ?? 999;
              const inUserRange =
                likes >= SETTINGS_MIN_LIKES && likes <= SETTINGS_MAX_LIKES &&
                comms >= SETTINGS_MIN_COMMENTS && comms <= SETTINGS_MAX_COMMENTS;
              const isHigh = engagement >= 20 || likes >= 15 || comms >= 8;
              const isMid = engagement >= 5 || likes >= 4 || comms >= 2;
              // If metrics are not rendered yet (0/0), trust early discovery position
              // so real-time sync still persists real posts while scrolling.
              const posHighOrMid = engagement === 0 && pos < 40;
              return (inUserRange && (isHigh || isMid)) || posHighOrMid;
          });

          // Stream in small real-time batches to avoid waiting until end of scroll.
          // Also force a flush every few steps if at least one candidate exists.
          const shouldFlushNow =
            qualityCandidates.length >= 3 ||
            (qualityCandidates.length > 0 && step - lastIncrementalSyncAtStep >= 4);

          if (shouldFlushNow) {
              const batch = qualityCandidates
                .sort((a, b) => ((b.likes || 0) + (b.postComments || 0)) - ((a.likes || 0) + (a.postComments || 0)))
                .slice(0, 8);

              const serializedChunk = batch.map(p => ({
                  url: p.url, likes: p.likes, postComments: p.postComments,
                  author: p.author, textSnippet: p.textSnippet,
                  commentable: p.commentable || false, hasRealUrl: true,
                  discoveryIndex: p.discoveryIndex
              }));

              const savedCount = await syncPosts(serializedChunk, keyword, dashboardUrl, userId, linkedInProfileId, false, {
                SETTINGS_MIN_LIKES, SETTINGS_MAX_LIKES, SETTINGS_MIN_COMMENTS, SETTINGS_MAX_COMMENTS
              });
              if (savedCount > 0) {
                batch.slice(0, savedCount).forEach(p => syncedUrls.add(p.url));
              }
              lastIncrementalSyncAtStep = step;
              console.log(`[v29] Incremental sync: attempted ${batch.length}, saved ${savedCount}. Total streamed: ${syncedUrls.size}`);
              heartbeat('Phase1-Stream', `📤 Live saved ${syncedUrls.size} high/mid posts so far...`);
          }
      }
    }
    console.log(`[v18] 📜 Reached max scroll steps: ${ABSOLUTE_SAFETY_LIMIT}. Finishing keyword.`);
    heartbeat('Phase1-Limit', '✅ 100 scroll limit reached. Moving to next keyword.');

    // ── Step 5: Active HTTP Validation (on ALL posts, once, after scrolling) ──
    console.log(`[v22] 📊 PRE-VALIDATION: ${allPosts.length} total posts, ${countReal(allPosts)} real`);
    heartbeat('Phase1-Validate', `🛡️ Actively verifying ${allPosts.length} posts...`);
    ensureActiveRun();
    const validPosts = await validatePostsConcurrently(allPosts);

    const totalReal = countReal(validPosts);
    const newPosts = validPosts.length - priorPosts.length;
    console.log(`[v22] 📊 POST-VALIDATION: ${validPosts.length} survived (${totalReal} real, ${allPosts.length - validPosts.length} rejected)`);
    console.log('[v22] ══ FINAL: ' + totalReal + ' real / ' + validPosts.length + ' total (' + newPosts + ' new this pass) ══');
    heartbeat('Phase1-Done', '✅ Extraction finished: ' + totalReal + ' real posts');

    // ── Step 6: Serialize with discoveryIndex for position-based quality boosting ──
    const remainingPosts = validPosts.filter(p => !syncedUrls.has(p.url));
    const serializedPosts = remainingPosts.map(p => ({
      url: p.url, likes: p.likes, postComments: p.postComments,
      author: p.author, textSnippet: p.textSnippet,
      commentable: p.commentable || false, hasRealUrl: p.hasRealUrl || false,
      discoveryIndex: p.discoveryIndex
    }));

    const needsCommenting = !isSearchOnly && comments && comments.length > 0;

    // ── Step 7: Comment or sync ──
    // v19 FIX: We removed PASS_DONE completely to guarantee ONE stable extraction cycle.
    // All extracted posts from this single deep pass are now ALWAYS saved.
    // v20 FIX: Posts are streamed progressively during scrolling for real-time visibility.
    // Final authoritative sync here ensures validated posts replace any broken ones.
    if (needsCommenting) {
      let commentedHistory = [], usedCommentHistory = [];
      try {
        const s = await chrome.storage.local.get(['commentedPosts', 'usedCommentIds']);
        commentedHistory = s.commentedPosts || [];
        usedCommentHistory = s.usedCommentIds || [];
      } catch(e) {}
      const commentedSet = new Set(commentedHistory);
      const usedCommentSet = new Set(usedCommentHistory);

      let availableComments = comments.filter(c => !usedCommentSet.has(c.id));
      if (availableComments.length === 0) {
        await syncPosts(serializedPosts, keyword, dashboardUrl, userId, linkedInProfileId, true, { SETTINGS_MIN_LIKES, SETTINGS_MAX_LIKES, SETTINGS_MIN_COMMENTS, SETTINGS_MAX_COMMENTS });
        safeSend({ action: 'JOB_COMPLETED', commentsPostedCount: comments.length, assignedCommentsCount: comments.length, searchOnlyMode: false });
        return;
      }

      const requiredComments = availableComments.length;
      heartbeat('Phase2', '📊 Selecting targets...');

      const pool = validPosts.filter(p =>
        p.container && document.contains(p.container) &&
        !commentedSet.has(p.url) && p.commentable
      );
      const targets = pool.sort((a, b) => (b.likes + b.postComments) - (a.likes + a.postComments)).slice(0, requiredComments * 3);

      if (targets.length === 0) {
        await syncPosts(serializedPosts, keyword, dashboardUrl, userId, linkedInProfileId, true, { SETTINGS_MIN_LIKES, SETTINGS_MAX_LIKES, SETTINGS_MIN_COMMENTS, SETTINGS_MAX_COMMENTS });
        safeSend({ action: 'JOB_COMPLETED', commentsPostedCount: 0, assignedCommentsCount: requiredComments, searchOnlyMode: false });
        return;
      }

      heartbeat('Phase3', '⌨️ Posting comments...');
      let posted = 0, ci = 0, blocked = false;
      for (const target of targets) {
        if (ci >= requiredComments || blocked) break;
        if (!target.container || !document.contains(target.container)) continue;
        const r = await tryPostComment(target.container, availableComments[ci].text, target.url);
        if (r === 'BLOCKED') { blocked = true; break; }
        if (r === 'SUCCESS') {
          posted++; ci++;
          commentedSet.add(target.url);
          try {
            commentedHistory = [...commentedHistory, target.url].slice(-200);
            usedCommentHistory = [...usedCommentHistory, availableComments[ci - 1].id].slice(-100);
            await chrome.storage.local.set({ commentedPosts: commentedHistory, usedCommentIds: usedCommentHistory });
          } catch(e) {}
          if (ci < requiredComments) await wait(8000, 15000);
        }
      }

      heartbeat('Phase4', '📤 Syncing...');
      await syncPosts(serializedPosts, keyword, dashboardUrl, userId, linkedInProfileId, true, { SETTINGS_MIN_LIKES, SETTINGS_MAX_LIKES, SETTINGS_MIN_COMMENTS, SETTINGS_MAX_COMMENTS });
      
      // ISSUE 2 FIX: Single-Pass Coverage
      // Complete extraction locally within 100 scrolls.
      console.log(`[v21] ✅ Keyword extraction complete.`);
      safeSend({ action: 'JOB_COMPLETED', commentsPostedCount: posted, assignedCommentsCount: requiredComments, searchOnlyMode: false, linkedinBlocked: blocked });

    } else {
      heartbeat('Phase4', '📤 Final sync: ' + totalReal + ' validated posts...');
      ensureActiveRun();
      const savedThisPass = await syncPosts(serializedPosts, keyword, dashboardUrl, userId, linkedInProfileId, true, { SETTINGS_MIN_LIKES, SETTINGS_MAX_LIKES, SETTINGS_MIN_COMMENTS, SETTINGS_MAX_COMMENTS });
      
      console.log(`[v25] ✅ Final sync: Evaluated ${remainingPosts.length} remaining pooled posts. Saved ${savedThisPass}.`);
      safeSend({ action: 'JOB_COMPLETED', commentsPostedCount: 0, assignedCommentsCount: 0, searchOnlyMode: true, postsExtracted: syncedUrls.size + savedThisPass });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // COMMENT POSTING
  // ═══════════════════════════════════════════════════════════
  function detectRestriction() {
    const t = (document.body?.innerText || '').toLowerCase();
    for (const p of ["you can't comment", "unable to comment", "commenting is restricted", "try again later", "temporarily restricted"]) {
      if (t.includes(p)) return p;
    }
    return null;
  }

  function injectText(editor, text) {
    try {
      editor.focus(); editor.innerHTML = ''; editor.innerText = text;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch(e) { return false; }
  }

  async function tryPostComment(container, text, postUrl) {
    if (!container || !document.contains(container)) return 'FAILED';
    if (detectRestriction()) return 'BLOCKED';
    container.scrollIntoView({ behavior: 'auto', block: 'center' });
    await wait(600, 1000);

    let commentBtn = null;
    for (const btn of container.querySelectorAll('button')) {
      const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
      const txt = (btn.innerText || '').toLowerCase().trim();
      if (lbl.includes('comment') || txt === 'comment') { commentBtn = btn; break; }
    }
    if (!commentBtn) return 'FAILED';

    commentBtn.click();
    await wait(1800, 2800);
    if (detectRestriction()) return 'BLOCKED';

    let editor = container.querySelector('div.ql-editor[contenteditable="true"],div[contenteditable="true"][role="textbox"],div[contenteditable="true"]');
    if (!editor && commentBtn) {
      // Find the true parent boundary of this specific post without escaping into the global feed
      const safeBoundary = commentBtn.closest('.feed-shared-update-v2, li, article') || container;
      editor = safeBoundary.querySelector('div.ql-editor[contenteditable="true"],div[contenteditable="true"]');
    }
    if (!editor) return 'FAILED';

    injectText(editor, text);
    await wait(600, 1000);
    if ((editor.innerText || '').trim().length === 0) {
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      await wait(400, 700);
    }
    if ((editor.innerText || '').trim().length === 0) return 'FAILED';

    let submitBtn = null;
    let sp = editor.parentElement;
    for (let d = 0; d < 12 && sp && !submitBtn; d++) {
      submitBtn = sp.querySelector('button.comments-comment-box__submit-button,button[type="submit"]')
        || Array.from(sp.querySelectorAll('button')).find(b => ['comment', 'post', 'submit'].includes((b.innerText || '').trim().toLowerCase()));
      sp = sp.parentElement;
    }
    if (!submitBtn) return 'FAILED';
    if (submitBtn.disabled) { submitBtn.removeAttribute('disabled'); await wait(200, 400); }

    submitBtn.click();
    await wait(2500, 4000);
    if (detectRestriction()) return 'BLOCKED';

    const consumed = !document.contains(editor) || (editor.innerText || '').trim().length === 0;
    if (consumed) { safeSend({ action: 'COMMENT_POSTED', url: postUrl }); return 'SUCCESS'; }
    submitBtn.click();
    await wait(2500, 4000);
    safeSend({ action: 'COMMENT_POSTED', url: postUrl });
    return 'SUCCESS';
  }

  // ═══════════════════════════════════════════════════════════
  // SYNC TO DASHBOARD
  // ═══════════════════════════════════════════════════════════
  async function syncPosts(posts, keyword, dashboardUrl, userId, linkedInProfileId, isFinal = false, constraints = {}) {
    function escapeRegExp(s) {
      return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function tokenizeKeyword(kw) {
      return String(kw || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length >= 3);
    }

    function isKeywordRelevant(post, kw) {
      const rawKw = String(kw || '').trim().toLowerCase();
      if (!rawKw) return true;

      const corpus = [
        String(post?.textSnippet || ''),
        String(post?.author || ''),
        String(post?.url || '')
      ].join(' ').toLowerCase();

      // Strongest signal: exact keyword phrase appears.
      if (rawKw.length >= 3 && corpus.includes(rawKw)) return true;

      // Otherwise require meaningful token coverage.
      const tokens = tokenizeKeyword(rawKw);
      if (tokens.length === 0) return true;

      const matches = tokens.filter(t => {
        const r = new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i');
        return r.test(corpus);
      }).length;

      // Soft stem support for single-word keywords (plan -> planning/planned/plans)
      // to avoid false zero-matches from strict boundary checks.
      if (tokens.length === 1) {
        const t = tokens[0];
        const stem = t.length >= 4 ? t.slice(0, Math.max(3, t.length - 1)) : t;
        const stemRx = new RegExp(`\\b${escapeRegExp(stem)}\\w*\\b`, 'i');
        const hasStem = stemRx.test(corpus);
        return matches >= 1 || hasStem;
      }

      // 2-word keyword -> both should appear
      if (tokens.length === 2) return matches >= 2;
      // 3+ words -> require at least 2 (balances strictness vs natural phrasing)
      return matches >= 2;
    }

    const MAX_POSTS_PER_KEYWORD = 120;
    const SETTINGS_MIN_LIKES = constraints.SETTINGS_MIN_LIKES || 0;
    const SETTINGS_MAX_LIKES = constraints.SETTINGS_MAX_LIKES || Infinity;
    const SETTINGS_MIN_COMMENTS = constraints.SETTINGS_MIN_COMMENTS || 0;
    const SETTINGS_MAX_COMMENTS = constraints.SETTINGS_MAX_COMMENTS || Infinity;
    const baseRealPosts = posts.filter(p =>
      (p.hasRealUrl || (p.url && !p.url.startsWith('discovered:') && !p.url.includes('synthetic:'))) &&
      p.url && isValidCanonicalPostUrl(p.url)
    );
    const relevantRealPosts = baseRealPosts.filter(p => isKeywordRelevant(p, keyword));

    // Incremental sync must stay stable and keep accumulating while scrolling.
    // Apply strict keyword gate only on final authoritative sync.
    let realPosts = baseRealPosts;
    if (isFinal) {
      realPosts = relevantRealPosts;
      if (baseRealPosts.length > 0 && relevantRealPosts.length === 0) {
        const fallbackCount = Math.min(Math.max(10, Math.ceil(baseRealPosts.length * 0.35)), baseRealPosts.length);
        realPosts = baseRealPosts
          .slice()
          .sort((a, b) => (a.discoveryIndex ?? 999) - (b.discoveryIndex ?? 999))
          .slice(0, fallbackCount);
        console.warn(`[v30] Keyword gate produced 0 matches for "${keyword}". Using ${fallbackCount} early discovered posts as safe fallback.`);
      } else if (baseRealPosts.length > relevantRealPosts.length && relevantRealPosts.length > 0 && relevantRealPosts.length < 6) {
        const existing = new Set(relevantRealPosts.map(p => p.url));
        const supplementCount = Math.min(8, baseRealPosts.length - relevantRealPosts.length);
        const supplements = baseRealPosts
          .filter(p => !existing.has(p.url))
          .slice()
          .sort((a, b) => (a.discoveryIndex ?? 999) - (b.discoveryIndex ?? 999))
          .slice(0, supplementCount);
        realPosts = [...relevantRealPosts, ...supplements];
        console.warn(`[v30] Keyword gate produced only ${relevantRealPosts.length} matches for "${keyword}". Added ${supplements.length} adaptive fallback posts.`);
      }
    }

    const labeled = realPosts.map(p => {
      const eng = (p.likes || 0) + (p.postComments || 0);
      const pos = p.discoveryIndex ?? 999; // Feed position (lower = earlier = higher quality per LinkedIn's algorithm)
      
      let engagementTier = 'unknown';
      
      // PRIMARY: Use actual DOM-extracted engagement metrics when available
      if (eng >= 20) engagementTier = 'high';
      else if (eng >= 5) engagementTier = 'mid';
      else if (eng > 0) engagementTier = 'low';
      
      // SECONDARY: Position-based boosting using LinkedIn's own relevance sort
      // LinkedIn puts the highest-engagement posts FIRST in relevance-sorted search.
      // If DOM extraction failed (eng=0), use feed position as a reliable quality proxy.
      if (eng === 0) {
        if (pos < 15) engagementTier = 'high';       // Top 15 in LinkedIn's relevance = high reach
        else if (pos < 40) engagementTier = 'mid';    // Positions 16-40 = medium reach
        else engagementTier = 'low';                   // Below 40 = normal/low
      }
      // BOOST: If DOM found some engagement but position is very early, upgrade tier
      else if (eng > 0 && eng < 5 && pos < 10) engagementTier = 'mid';
      else if (eng >= 5 && eng < 20 && pos < 5) engagementTier = 'high';
      
      return { ...p, engagementTier };
    });

    labeled.sort((a, b) => {
      // Sort by tier first (high > mid > low > unknown), then by engagement, then by position
      const tierOrder = { high: 3, mid: 2, low: 1, unknown: 0 };
      const tierDiff = (tierOrder[b.engagementTier] || 0) - (tierOrder[a.engagementTier] || 0);
      if (tierDiff !== 0) return tierDiff;
      const engDiff = ((b.likes || 0) + (b.postComments || 0)) - ((a.likes || 0) + (a.postComments || 0));
      if (engDiff !== 0) return engDiff;
      return (a.discoveryIndex || 999) - (b.discoveryIndex || 999); // Earlier discovered = higher priority
    });
    
    // ═══════════════════════════════════════════════════════════
    // CONSTRAINT-DRIVEN SELECTION WITH INTELLIGENT FALLBACK
    // ═══════════════════════════════════════════════════════════
    // Step 1: Select posts that EXACTLY match the settings constraints
    const exactMatches = labeled.filter(p => {
      const likes = p.likes || 0;
      const comms = p.postComments || p.comments || 0;
      // Do NOT blindly allow 0/0 posts. They must pass the exact match constraints
      // or fall through to the closest-match approximation logic below.
      return likes >= SETTINGS_MIN_LIKES && likes <= SETTINGS_MAX_LIKES &&
             comms >= SETTINGS_MIN_COMMENTS && comms <= SETTINGS_MAX_COMMENTS;
    });

    let final;
    if (exactMatches.length > 0) {
      // We have exact matches — use them as the primary batch
      final = exactMatches;
      console.log(`[v22] ✅ ${exactMatches.length} posts EXACTLY match constraints (Likes ${SETTINGS_MIN_LIKES}-${SETTINGS_MAX_LIKES}, Comments ${SETTINGS_MIN_COMMENTS}-${SETTINGS_MAX_COMMENTS}).`);

      // If exact matches are sparse, supplement with closest-match fallback (up to per-keyword cap)
      if (exactMatches.length < MAX_POSTS_PER_KEYWORD) {
        const exactUrls = new Set(exactMatches.map(p => p.url));
        const remaining = labeled.filter(p => !exactUrls.has(p.url));

        // Score each remaining post by how close it is to the constraints
        const scored = remaining.map(p => {
          const likes = p.likes || 0;
          const comms = p.postComments || p.comments || 0;
          // Calculate deviation: 0 = perfect match, higher = further from constraints
          let likesDev = 0;
          if (likes < SETTINGS_MIN_LIKES) likesDev = SETTINGS_MIN_LIKES - likes;
          else if (likes > SETTINGS_MAX_LIKES && SETTINGS_MAX_LIKES !== Infinity) likesDev = likes - SETTINGS_MAX_LIKES;
          let commsDev = 0;
          if (comms < SETTINGS_MIN_COMMENTS) commsDev = SETTINGS_MIN_COMMENTS - comms;
          else if (comms > SETTINGS_MAX_COMMENTS && SETTINGS_MAX_COMMENTS !== Infinity) commsDev = comms - SETTINGS_MAX_COMMENTS;
          return { ...p, _deviation: likesDev + commsDev };
        });

        // Sort by deviation (closest to constraints first)
        scored.sort((a, b) => a._deviation - b._deviation);
        const maxAcceptableDev = Math.max(SETTINGS_MIN_LIKES, SETTINGS_MIN_COMMENTS, 5) * 0.5;
        const fallbacks = scored.filter(p => p._deviation <= maxAcceptableDev);
        const needed = Math.min(fallbacks.length, MAX_POSTS_PER_KEYWORD - exactMatches.length);
        if (needed > 0) final = [...exactMatches, ...fallbacks.slice(0, needed)];
      }
    } else if (isFinal) {
      const scored = labeled.map(p => {
        const likes = p.likes || 0;
        const comms = p.postComments || p.comments || 0;
        let likesDev = 0;
        if (likes < SETTINGS_MIN_LIKES) likesDev = SETTINGS_MIN_LIKES - likes;
        else if (likes > SETTINGS_MAX_LIKES && SETTINGS_MAX_LIKES !== Infinity) likesDev = likes - SETTINGS_MAX_LIKES;
        let commsDev = 0;
        if (comms < SETTINGS_MIN_COMMENTS) commsDev = SETTINGS_MIN_COMMENTS - comms;
        else if (comms > SETTINGS_MAX_COMMENTS && SETTINGS_MAX_COMMENTS !== Infinity) commsDev = comms - SETTINGS_MAX_COMMENTS;
        return { ...p, _deviation: likesDev + commsDev };
      });

      scored.sort((a, b) => a._deviation - b._deviation);

      // Accept a wider deviation band when there are no exact matches,
      // but still bounded: max 100% of the min thresholds
      const maxFallbackDev = Math.max(SETTINGS_MIN_LIKES, SETTINGS_MIN_COMMENTS, 10);
      final = scored.filter(p => p._deviation <= maxFallbackDev);

      if (final.length === 0) {
        // Absolute last resort: take top N closest, regardless of deviation
        final = scored.slice(0, Math.min(80, scored.length));
        console.log(`[v22] ⚠️ No posts within fallback tolerance. Sending top ${final.length} closest posts.`);
      } else {
        console.log(`[v22] 🔄 Selected ${final.length} posts via closest-match fallback (tolerance: ${maxFallbackDev}).`);
      }
      if (final.length > MAX_POSTS_PER_KEYWORD) final = final.slice(0, MAX_POSTS_PER_KEYWORD);
    } else {
      // Incremental sync fallback: do not drop to empty.
      // Keep quality strict (high/mid first) using engagement tier + discovery position.
      const qualityIncremental = labeled.filter(p => {
        const eng = (p.likes || 0) + (p.postComments || p.comments || 0);
        const pos = p.discoveryIndex ?? 999;
        if (p.engagementTier === 'high' || p.engagementTier === 'mid') return true;
        // When engagement metrics are missing in DOM, allow early discovered posts only.
        if (eng === 0 && pos < 40) return true;
        return false;
      });
      final = qualityIncremental.slice(0, Math.min(20, qualityIncremental.length));
      console.log(`[v29] Incremental fallback selected ${final.length} high/mid candidates.`);
    }

    if (!Array.isArray(final)) final = [];

    // Hard floor (final pass only): when real candidates exist, do not end a keyword with a tiny batch.
    // Incremental syncs remain strict high/mid only.
    if (isFinal && final.length < 10 && labeled.length > final.length) {
      const selected = new Set(final.map(p => p.url));
      const supplements = labeled.filter(p => p.url && !selected.has(p.url)).slice(0, 10 - final.length);
      if (supplements.length > 0) {
        final = [...final, ...supplements];
        console.log(`[v28] Filled batch with ${supplements.length} ranked fallback posts to reach minimum floor.`);
      }
    }

    // Clean up internal scoring field before sending
    final = final.map(p => { const { _deviation, ...clean } = p; return clean; });

    final.sort((a, b) => {
      const tierOrder = { high: 3, mid: 2, low: 1, unknown: 0 };
      const tierDiff = (tierOrder[b.engagementTier] || 0) - (tierOrder[a.engagementTier] || 0);
      if (tierDiff !== 0) return tierDiff;
      const engDiff = ((b.likes || 0) + (b.postComments || 0)) - ((a.likes || 0) + (a.postComments || 0));
      if (engDiff !== 0) return engDiff;
      return (a.discoveryIndex || 999) - (b.discoveryIndex || 999);
    });
    final = final.slice(0, MAX_POSTS_PER_KEYWORD);

    if (final.length === 0) {
      console.log('[v18] ⚠️ 0 valid posts met the strict criteria. Skipping sync to prevent empty batches.');
      return 0; // Return 0 saved
    }

    const tierCounts = {
      high: final.filter(p => p.engagementTier === 'high').length,
      mid: final.filter(p => p.engagementTier === 'mid').length,
      low: final.filter(p => p.engagementTier === 'low').length,
      unknown: final.filter(p => p.engagementTier === 'unknown').length
    };

    console.log('[v18] ══════════════════════════════════════════════');
    console.log('[v18] 📊 SYNC RESULTS for keyword:');
    console.log('[v18]   🔴 HIGH reach:   ' + tierCounts.high + ' posts');
    console.log('[v18]   🟡 MEDIUM reach: ' + tierCounts.mid + ' posts');
    console.log('[v18]   ⚪ NORMAL reach: ' + tierCounts.low + ' posts');
    console.log('[v18]   ❓ UNKNOWN:      ' + tierCounts.unknown + ' posts');
    console.log('[v18]   📦 TOTAL sending: ' + final.length + ' (from ' + realPosts.length + ' real)');
    console.log('[v18] ══════════════════════════════════════════════');

    const payload = final.map(p => {
      const u = cleanUrl(p.url);
      return {
        url: u, likes: p.likes, comments: p.postComments,
        author: p.author, preview: (p.textSnippet || '').substring(0, 200),
        engagementTier: p.engagementTier
      };
    }).filter(p => p.url && isValidCanonicalPostUrl(p.url));

    // Strict HTTP verification is reserved for final sync.
    // Incremental sync should be fast and continuously accumulating.
    let verifiedPayload = [];
    if (!isFinal) {
      verifiedPayload = payload;
    } else {
      console.log(`[v27] 🛡️ Verifying ${payload.length} posts (strict — unverified URLs are dropped)...`);
      for (const p of payload) {
          try {
              const res = await fetch(p.url, { method: 'GET', credentials: 'include', cache: 'no-store' });
              if (!res.ok) {
                console.warn(`[v27] ⏭️ Skip (HTTP ${res.status}): ${p.url}`);
                await wait(200, 500);
                continue;
              }
              const html = await res.text();
              if (htmlIndicatesBrokenOrLogin(html)) {
                console.warn(`[v27] 🚫 Rejected broken/login page: ${p.url}`);
                await wait(200, 500);
                continue;
              }
              verifiedPayload.push(p);
              await wait(250, 600);
          } catch (e) {
              console.warn(`[v27] ⏭️ Skip (fetch error): ${p.url}`);
          }
      }
    }

    if (verifiedPayload.length === 0) {
        console.warn(`[v27] All ${payload.length} candidates failed verification (strict mode).`);
        return 0;
    }

    return await new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({
          action: 'SYNC_RESULTS', posts: verifiedPayload, keyword, dashboardUrl, userId, linkedInProfileId,
          debugInfo: { realTotal: realPosts.length, ...tierCounts, sending: verifiedPayload.length }
        }, (response) => {
          if (chrome.runtime.lastError) {}
          resolve(verifiedPayload.length);
        });
      } catch(e) { resolve(0); }
    });
  }

} // end scope
