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
  };

  async function runExtraction(keyword, settings, comments, dashboardUrl, userId) {
    if (isExtracting) { console.log('[v18] Already extracting.'); return; }
    isExtracting = true;
    try {
      await extractPipeline(keyword, settings, comments, dashboardUrl, userId);
    } catch (e) {
      console.error('[v18] Fatal:', e);
      safeSend({ action: 'JOB_FAILED', error: String(e) });
    } finally {
      isExtracting = false;
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

  function findAllActionButtons() {
    const buttons = [];
    document.querySelectorAll('button').forEach(btn => {
      const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
      const txt = (btn.innerText || '').toLowerCase().trim();
      const isLike = lbl.startsWith('react') || lbl === 'like' || lbl.includes(' like') ||
                     lbl.includes('إعجاب') || txt === 'like' || txt === 'react';
      const isComment = lbl.includes('comment') || txt === 'comment' || txt === 'تعليق';
      if (isLike || isComment) {
        buttons.push({ el: btn, type: isLike ? 'like' : 'comment' });
      }
    });
    return buttons;
  }

  function walkUpToCard(startEl) {
    let node = startEl;
    let bestCandidate = null;
    let bestHeight = 0;

    for (let depth = 0; depth < 20 && node && !STOP_TAGS.has(node.tagName); depth++) {
      node = node.parentElement;
      if (!node || node.nodeType !== 1) break;

      const tag = node.tagName;

      // ARTICLE is always a card boundary
      if (tag === 'ARTICLE') return node;

      // If it's an LI or DIV, check if it's a valid individual card
      if (tag === 'LI' || tag === 'DIV') {
        const h = node.offsetHeight || 0;
        const w = node.offsetWidth || 0;

        if (h > 80 && w > 200) {
          // 1. FIRST: Check if this element has URN data attributes (strong signal)
          for (const attr of ['data-urn','data-chameleon-result-urn','data-entity-urn','data-update-urn','data-id']) {
            const v = node.getAttribute(attr) || '';
            // STRICTLY POST-LEVEL URNS ONLY
            if (v.includes('activity') || v.includes('ugcPost') || v.includes('share')) {
              return node; // Definite card
            }
          }

          // 2. BOUNDARY CHECK: How many like buttons are inside this container?
          // If a container has 3+ like buttons, it is definitely the parent feed wrapper, NOT a single post.
          let likeCount = 0;
          node.querySelectorAll('button').forEach(b => {
             // CRITICAL: Do not count like buttons that belong to injected comments
             if (b.closest('.feed-shared-update-v2__comments-container, .comments-comments-list, .comments-comment-item')) return;

             const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
             if (lbl.startsWith('react') || lbl === 'like' || lbl.includes('إعجاب') || (b.innerText||'').toLowerCase().trim() === 'like') {
                 likeCount++;
             }
          });
          
          if (likeCount > 2) {
            // We've hit the feed list wrapper! 
            // Return the best candidate we found BEFORE hitting this wrapper.
            return bestCandidate; 
          }

          // Track the best candidate (largest container that IS NOT the feed wrapper)
          if (h > bestHeight) {
            bestCandidate = node;
            bestHeight = h;
          }
        }
      }
    }

    return bestCandidate;
  }

  // ═══════════════════════════════════════════════════════════
  // URL EXTRACTION — try EVERY method to get a post URL from a card
  // ═══════════════════════════════════════════════════════════
  function extractUrlFromCard(card) {
    if (!card) return null;

    try {
      // Method 1: Explicit URN attributes
      const urnEls = [card, ...card.querySelectorAll('[data-urn],[data-chameleon-result-urn],[data-entity-urn],[data-update-urn],[data-search-result-urn]')];
      for (const el of urnEls) {
        for (const attr of el.attributes) { // Check all attributes natively
          if (!attr.value) continue;
          const v = attr.value;
          const m = v.match(/urn:li:(?:activity|ugcPost|share|update):\d{18,22}/i);
          if (m) return 'https://www.linkedin.com/feed/update/' + m[0];
          
          if (v.match(/^(?:activity|ugcPost|share|update):\d{18,22}$/i)) {
            return 'https://www.linkedin.com/feed/update/urn:li:' + v;
          }
        }
      }

      // Method 2: Standard anchor links
      for (const a of card.querySelectorAll('a[href]')) {
        const href = a.href || '';
        if (href.includes('/feed/update/')) {
          const m = href.match(/\/feed\/update\/(urn:li:[^?&#\s"']+)/);
          if (m) return cleanUrl('https://www.linkedin.com/feed/update/' + decodeURIComponent(m[1]));
        }
        if (href.includes('/posts/')) {
          const m = href.match(/(https?:\/\/(?:www\.)?linkedin\.com\/posts\/[^?&#\s"']+)/);
          if (m) return cleanUrl(m[1]);
        }
        const urnM = href.match(/urn:li:(?:activity|ugcPost|share|update):\d{18,22}/i);
        if (urnM) return 'https://www.linkedin.com/feed/update/' + urnM[0];
      }

      // Method 3: "Copy link to post" or "Share" buttons
      for (const btn of card.querySelectorAll('[data-clipboard-text], [data-share-url], .feed-shared-control-menu__item, button')) {
        const url = btn.getAttribute('data-clipboard-text') || btn.getAttribute('data-share-url');
        if (url && (url.includes('linkedin.com/posts/') || url.includes('linkedin.com/feed/'))) {
          return cleanUrl(url);
        }
      }

      // Method 4: Aggressive DOM Attribute Scan (Find 19-digit numbers near 'activity' in ANY attribute)
      const regex19 = /(\d{18,22})/;
      const allEls = card.querySelectorAll('*');
      for (const el of allEls) {
        for (const attr of el.attributes) {
           if (attr.value && attr.value.length >= 18) {
              const v = attr.value.toLowerCase();
              // ONLY match post-level URNs
              if (v.includes('activity') || v.includes('ugcpost') || v.includes('share') || v.includes('update')) {
                 const m = v.match(/urn:li:(activity|ugcpost|share|update):(\d{18,22})/i);
                 if (m) return 'https://www.linkedin.com/feed/update/urn:li:' + m[1] + ':' + m[2];
                 
                 const m19 = v.match(regex19);
                 if (m19 && v.includes('activity')) return 'https://www.linkedin.com/feed/update/urn:li:activity:' + m19[1];
              }
           }
        }
      }

      // Method 5: Aggressive innerHTML match 
      const html = card.innerHTML || '';
      const urnRegex = /urn:li:(activity|ugcPost|share|update):(\d{18,22})/gi;
      let match = urnRegex.exec(html);
      if (match) return 'https://www.linkedin.com/feed/update/urn:li:' + match[1] + ':' + match[2];

      const bareRegex = /(?:activity|ugcPost|share|update)[^a-zA-Z0-9]?(\d{18,22})/gi;
      match = bareRegex.exec(html);
      if (match) return 'https://www.linkedin.com/feed/update/urn:li:activity:' + match[1];

    } catch(e) {}

    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // METRICS EXTRACTION — get engagement data from a card
  // ═══════════════════════════════════════════════════════════
  function checkIsCommentable(card) {
    if (!card) return true; // Permissive default
    const text = (card.innerText || '').toLowerCase();
    if (text.includes("comments are turned off") || text.includes("comments on this post are limited") || text.includes("you can't comment") || text.includes("commenting is restricted")) {
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

  function harvest(seenUrls, seenCards, allPosts) {
    let added = 0;

    // ── Primary: Direct Container Discovery (MOST RELIABLE) ──
    const cardSelectors = [
      '.reusable-search__result-container', 
      '.feed-shared-update-v2',
      '.search-entity',
      'article',
      '[data-urn]:not(button):not(a):not(span)', // any container block with a URN
      '[data-id]:not(button):not(a)'
    ];

    document.querySelectorAll(cardSelectors.join(', ')).forEach(card => {
      try {
        if (seenCards.has(card)) return;

        // Ensure this is actually a substantial card (relaxed rule to catch more valid content)
        if (card.offsetHeight < 40 || card.offsetWidth < 150) return;

        const url = extractUrlFromCard(card);
        const cleanedUrl = url ? cleanUrl(url) : null;

        // If we found a real URL, this is definitively a post card
        if (cleanedUrl) {
          if (seenUrls.has(cleanedUrl)) {
             seenCards.add(card); // Don't process this physical card again
             return; 
          }

          seenUrls.add(cleanedUrl);
          seenCards.add(card);

          if (!checkIsCommentable(card)) {
             console.log('[v18] Excluded locked/uncommentable post:', cleanedUrl);
             return;
          }

          seenUrls.add(cleanedUrl);
          seenCards.add(card);

          const metrics = extractMetrics(card);
          
          allPosts.push({
            url: cleanedUrl,
            likes: metrics.likes,
            postComments: metrics.postComments,
            author: metrics.author,
            textSnippet: metrics.textSnippet,
            commentable: true,
            container: card,
            hasRealUrl: true,
            discoveryIndex: allPosts.length // Track feed position for quality ranking
          });
          added++;
        }
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

        const url = extractUrlFromCard(card);
        const cleanedUrl = url ? cleanUrl(url) : null;

        // STRICT FILTER: If we cannot extract a real post URL, this is almost certainly
        // a COMMENT container (which has its own Like button). We MUST reject it.
        // Allowing comments balloons the array and stops the scroll loop prematurely.
        if (!cleanedUrl) continue;

        // Skip if we've seen this URL
        if (seenUrls.has(cleanedUrl)) {
            seenCards.add(card);
            continue;
        }

        // Mark as seen
        seenUrls.add(cleanedUrl);
        seenCards.add(card);

        if (!checkIsCommentable(card)) {
            console.log('[v18] Excluded locked/uncommentable post:', cleanedUrl);
            continue;
        }

        const metrics = extractMetrics(card);

        allPosts.push({
          url: cleanedUrl,
          likes: metrics.likes,
          postComments: metrics.postComments,
          author: metrics.author,
          textSnippet: metrics.textSnippet,
          commentable: true,
          container: card,
          hasRealUrl: true,
          discoveryIndex: allPosts.length
        });
        added++;
      } catch(e) {}
    }

    // ── Secondary: data-urn attribute elements ──
    document.querySelectorAll('[data-urn],[data-chameleon-result-urn],[data-entity-urn],[data-update-urn]').forEach(el => {
      try {
        if (seenCards.has(el)) return;
        for (const attr of ['data-urn','data-chameleon-result-urn','data-entity-urn','data-update-urn']) {
          const v = el.getAttribute(attr) || '';
          const m = v.match(/urn:li:(?:activity|ugcPost|share):\d{10,22}/);
          if (m) {
            const url = cleanUrl('https://www.linkedin.com/feed/update/' + m[0]);
            if (url && !seenUrls.has(url)) {
              seenUrls.add(url);
              seenCards.add(el);
              if (!checkIsCommentable(el)) {
                  console.log('[v18] Excluded locked/uncommentable post:', url);
                  break;
              }
              const metrics = extractMetrics(el);
              allPosts.push({
                url, likes: metrics.likes, postComments: metrics.postComments,
                author: metrics.author, textSnippet: metrics.textSnippet,
                commentable: true, container: el, hasRealUrl: true,
                discoveryIndex: allPosts.length
              });
              added++;
            }
            break;
          }
        }
      } catch(e) {}
    });

    // ── Tertiary: Traditional anchor-href walk (in case LinkedIn uses old format) ──
    document.querySelectorAll('a[href]').forEach(a => {
      try {
        const href = a.href || '';
        let postUrl = null;

        if (href.includes('/feed/update/')) {
          const m = href.match(/\/feed\/update\/(urn:li:[^?&#\s]+)/);
          if (m) postUrl = cleanUrl('https://www.linkedin.com/feed/update/' + decodeURIComponent(m[1]));
        } else if (href.includes('/posts/')) {
          const m = href.match(/(https?:\/\/(?:www\.)?linkedin\.com\/posts\/[^?&#\s]+)/);
          if (m) postUrl = cleanUrl(m[1]);
        }

        if (!postUrl || seenUrls.has(postUrl)) {
            if (card) seenCards.add(card);
            return;
        }

        const finalCard = card || a.parentElement;
        seenUrls.add(postUrl);
        if (card) seenCards.add(card);

        if (!checkIsCommentable(finalCard)) {
            console.log('[v18] Excluded locked/uncommentable post:', postUrl);
            return;
        }
        const metrics = extractMetrics(finalCard);
        allPosts.push({
          url: postUrl, likes: metrics.likes, postComments: metrics.postComments,
          author: metrics.author, textSnippet: metrics.textSnippet,
          commentable: true, container: card, hasRealUrl: true,
          discoveryIndex: allPosts.length
        });
        added++;
      } catch(e) {}
    });

    return added;
  }

  function countReal(posts) {
    return posts.filter(p => p.hasRealUrl || (p.url && !p.url.startsWith('discovered:') && !p.url.includes('synthetic:'))).length;
  }

  // ═══════════════════════════════════════════════════════════
  // SCROLLING — aggressive multi-target + slow waits
  // ═══════════════════════════════════════════════════════════
  function aggressiveScroll(pixels) {
    try { window.scrollBy({ top: pixels, behavior: 'smooth' }); } catch(e) {}
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
    try { window.scrollTo({ top: h, behavior: 'smooth' }); } catch(e) {}
    try { document.documentElement.scrollTop = h; } catch(e) {}
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
    
    const nextBtn = document.querySelector('.artdeco-pagination__button--next:not([disabled])');
    if (nextBtn) { 
        nextBtn.click(); 
        clicked = true;
        console.log('[v19] Clicked Artdeco NEXT pagination button');
    }
    
    if (clicked) {
        await sleep(3000); // Wait for newly triggered content to load
        return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN PIPELINE
  // ═══════════════════════════════════════════════════════════
  async function extractPipeline(keyword, settings, comments, dashboardUrl, userId) {
    const isSearchOnly = settings.searchOnlyMode === true;
    const passIndex = settings.passIndex || 0;
    const priorPosts = settings.priorPosts || [];
    const seenUrls = new Set(priorPosts.map(p => p.url).filter(Boolean));
    const seenCards = new WeakSet();
    const allPosts = [...priorPosts];

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
        await wait(3000, 4000);
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
        harvest(seenUrls, seenCards, allPosts);
        const realCount = countReal(allPosts);
        console.log('[v18] Last-resort harvest: ' + realCount + ' real posts');

        if (realCount === 0) {
          // DO NOT send PASS_DONE with 0 posts — just complete with failure info
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
    heartbeat('Phase0-Hydrate', '⏳ Stabilizing DOM binding to prevent race conditions...');
    await wait(4000, 5000);

    // ── Step 3: Initial harvest (before scrolling) ──
    const initCount = harvest(seenUrls, seenCards, allPosts);
    console.log('[v18] Initial harvest: +' + initCount + ' (total=' + allPosts.length + ', real=' + countReal(allPosts) + ')');
    heartbeat('Phase1-Init', '✅ Initial: ' + countReal(allPosts) + ' real posts');

    // ── Step 4: Scroll loop — CAPPED AT 150 COLLECTED POSTS ──
    const STALL_LIMIT = 8;
    const ABSOLUTE_SAFETY_LIMIT = 400; // Physical scroll step safety stop
    const COLLECTED_POSTS_LIMIT = 150; // Strict limit: 150 VALID posts collected per keyword
    const MAX_URLS_SCANNED = 500; // Hard safety cap on total URLs seen (prevents runaway)
    let stallCount = 0;
    let step = 0;

    heartbeat('Phase1-Scroll', '📜 Scrolling until 150 posts collected or feed exhaustion...');

    while (step < ABSOLUTE_SAFETY_LIMIT && allPosts.length < COLLECTED_POSTS_LIMIT && seenUrls.size < MAX_URLS_SCANNED) {
      const scrollAmt = 700 + Math.floor(Math.random() * 500);
      aggressiveScroll(scrollAmt);

      // ULTRA-FASTER wait — Bare minimum for React to paint DOM elements
      await wait(600, 1000);

      // Harvest
      const before = allPosts.length;
      harvest(seenUrls, seenCards, allPosts);

      // Every 3rd step, click Load More aggressively
      if (step % 3 === 2) {
        scrollToBottom();
        await wait(800, 1200);
        await clickShowMore(); 
        harvest(seenUrls, seenCards, allPosts);
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
      console.log('[v18] Scroll ' + (step + 1) + ' | URLs: ' + currentSeenSize + ' | Collected: ' + allPosts.length + '/' + COLLECTED_POSTS_LIMIT + ' | Real: ' + real + ' | Stall: ' + stallCount + '/' + STALL_LIMIT);
      if (step % 5 === 0) heartbeat('Phase1-Scroll', '📜 Scrolled ' + step + ' | ' + allPosts.length + '/' + COLLECTED_POSTS_LIMIT + ' collected');

      // Stall handling
      if (stallCount >= STALL_LIMIT) {
        console.log('[v18] Stall at ' + stallCount + '. Trying Show More...');
        const clicked = await clickShowMore();
        if (clicked) {
           stallCount = 0;
           await wait(1500, 2500);
           harvest(seenUrls, seenCards, allPosts);
           continue;
        }

        console.log('[v18] No Show More. Recovery scroll...');
        const seenBeforeRecovery = seenUrls.size;
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await wait(1000, 2000);
        harvest(seenUrls, seenCards, allPosts);
        for (let r = 0; r < 5; r++) {
           aggressiveScroll(1500);
           await wait(1000, 1500);
           harvest(seenUrls, seenCards, allPosts);
        }
        
        const seenAfterRecovery = seenUrls.size;
        if (seenAfterRecovery <= seenBeforeRecovery) {
           console.log('[v18] Recovery found no new URLs. Page physically exhausted.');
           break;
        }
        stallCount = 0;
        window.__lastSeenSize = seenAfterRecovery;
      }
      step++;
      
      if (allPosts.length >= COLLECTED_POSTS_LIMIT) {
        console.log('[v18] ✅ Limit reached: ' + allPosts.length + ' posts collected (from ' + seenUrls.size + ' URLs scanned). Finishing keyword.');
        heartbeat('Phase1-Limit', '✅ ' + allPosts.length + ' posts collected. Moving to next keyword.');
      } else if (seenUrls.size >= MAX_URLS_SCANNED) {
        console.log('[v18] ⚠️ Safety cap: ' + seenUrls.size + ' URLs scanned. Collected ' + allPosts.length + ' posts. Finishing keyword.');
        heartbeat('Phase1-Limit', '⚠️ URL cap reached. ' + allPosts.length + ' posts collected.');
      }
      
      // ── INCREMENTAL SAVE (CRASH PROTECTOR) ──
      if (step > 0 && step % 15 === 0) {
        console.log('[v18] 💾 Incremental Backup: Saving progress at Step ' + step);
        heartbeat('Phase1-Backup', '💾 Syncing partial progress...');
        // Non-destructive push. Backend UPSERT dynamically handles exact-key overwriting gracefully.
        try { await syncPosts(allPosts, keyword, dashboardUrl, userId, linkedInProfileId, false); } catch(e) {}
      }
    }

    // ── Step 5: Results ──
    const totalReal = countReal(allPosts);
    const newPosts = allPosts.length - priorPosts.length;
    console.log('[v18] ══ FINAL: ' + totalReal + ' real / ' + allPosts.length + ' total (' + newPosts + ' new this pass) ══');
    heartbeat('Phase1-Done', '✅ Pass ' + (passIndex + 1) + ': ' + totalReal + ' real posts');

    if (totalReal < 5) {
      heartbeat('Phase1-Low', '⚠️ Low yield: ' + totalReal + ' posts');
    }

    // ── Step 6: Serialize ──
    const serializedPosts = allPosts.map(p => ({
      url: p.url, likes: p.likes, postComments: p.postComments,
      author: p.author, textSnippet: p.textSnippet,
      commentable: p.commentable || false, hasRealUrl: p.hasRealUrl || false
    }));

    const needsCommenting = !isSearchOnly && comments && comments.length > 0;

    // ── Step 7: Comment or sync ──
    // v19 FIX: We removed PASS_DONE completely to guarantee ONE stable extraction cycle.
    // All extracted posts from this single deep pass are now ALWAYS saved.
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
        await syncPosts(serializedPosts, keyword, dashboardUrl, userId, linkedInProfileId, true);
        safeSend({ action: 'JOB_COMPLETED', commentsPostedCount: comments.length, assignedCommentsCount: comments.length, searchOnlyMode: false });
        return;
      }

      const requiredComments = availableComments.length;
      heartbeat('Phase2', '📊 Selecting targets...');

      const pool = allPosts.filter(p =>
        p.container && document.contains(p.container) &&
        !commentedSet.has(p.url) && p.commentable
      );
      const targets = pool.sort((a, b) => (b.likes + b.postComments) - (a.likes + a.postComments)).slice(0, requiredComments * 3);

      if (targets.length === 0) {
        await syncPosts(serializedPosts, keyword, dashboardUrl, userId, linkedInProfileId, true);
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
      await syncPosts(serializedPosts, keyword, dashboardUrl, userId, linkedInProfileId, true);
      safeSend({ action: 'JOB_COMPLETED', commentsPostedCount: posted, assignedCommentsCount: requiredComments, searchOnlyMode: false, linkedinBlocked: blocked });

    } else {
      heartbeat('Phase4', '📤 Syncing ' + totalReal + ' real posts...');
      await syncPosts(serializedPosts, keyword, dashboardUrl, userId, linkedInProfileId, true);
      safeSend({ action: 'JOB_COMPLETED', commentsPostedCount: 0, assignedCommentsCount: 0, searchOnlyMode: true, postsExtracted: totalReal });
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
  async function syncPosts(posts, keyword, dashboardUrl, userId, linkedInProfileId, isFinal = false) {
    const realPosts = posts.filter(p => p.hasRealUrl || (p.url && !p.url.startsWith('discovered:') && !p.url.includes('synthetic:')));

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
    
    // STRICT QUALITY FILTERING (PER USER REQUEST)
    // Only transmit High and Medium reach posts. Drop Low and Unknown completely.
    let final = labeled.filter(p => p.engagementTier === 'high' || p.engagementTier === 'mid');
    
    // Best-effort fallback: if strict filtering leaves us with 0 posts but we found some, keep top 3
    if (final.length === 0 && labeled.length > 0) {
        console.log('[v18] No high/mid posts found. Falling back to best available 3 posts.');
        final = labeled.slice(0, 3);
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

    const payload = final.map(p => ({
      url: p.url, likes: p.likes, comments: p.postComments,
      author: p.author, preview: (p.textSnippet || '').substring(0, 200),
      engagementTier: p.engagementTier
    }));

    await new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({
          action: 'SYNC_RESULTS', posts: payload, keyword, dashboardUrl, userId, linkedInProfileId,
          debugInfo: { realTotal: realPosts.length, ...tierCounts, sending: final.length }
        }, () => { if (chrome.runtime.lastError) {} resolve(); });
      } catch(e) { resolve(); }
    });
  }

} // end scope
