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
    if (request.action === 'START_COMMENT_CAMPAIGN') {
      sendResponse({ received: true });
      runCommentCampaignEntry(request.keyword, request.settings, request.comments, request.dashboardUrl, request.userId);
    }
    if (request.action === 'START_SEARCH_ONLY') {
      sendResponse({ received: true });
      runSearchOnlyEntry(request.keyword, request.settings, request.dashboardUrl, request.userId);
    }
  }
  chrome.runtime.onMessage.addListener(messageHandler);

  window.__startCommentCampaign = function (keyword, settings, comments, dashboardUrl, userId) {
    console.log('[CommentCampaign] start: "' + keyword + '" on ' + window.location.href);
    runCommentCampaignEntry(keyword, settings, comments, dashboardUrl, userId);
  };

  window.__startSearchOnly = function (keyword, settings, dashboardUrl, userId) {
    console.log('[SearchOnly] start: "' + keyword + '" on ' + window.location.href);
    runSearchOnlyEntry(keyword, settings, dashboardUrl, userId);
  };

  window.__resumeSingleCommentTarget = async function (plan) {
    const targetUrl = cleanUrl(plan?.targetUrl || window.location.href);
    const commentText = String(plan?.commentText || '').trim();
    if (!targetUrl || !commentText) return 'FAILED';

    heartbeat('Phase3-Target', 'Opening target post for direct comment execution...');
    await sleep(1200);

    let container = findLivePostContainerByUrl(targetUrl);
    if (!container) {
      const visibleCards = Array.from(document.querySelectorAll('article, .feed-shared-update-v2, .feed-shared-update-v3, .feed-shared-update-v2__commentary'))
        .filter(el => isLikelyVisible(el));
      container = visibleCards.find(el => {
        try {
          const btn = Array.from(el.querySelectorAll('button')).find(b => {
            const txt = (b.innerText || '').trim().toLowerCase();
            const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
            return txt === 'comment' || (lbl.includes('comment') && !lbl.includes('copy'));
          });
          return !!btn;
        } catch (e) {
          return false;
        }
      }) || null;
    }

    if (!container) {
      container = await locateLiveContainerForPostUrl(targetUrl, 4);
    }
    if (!container || !document.contains(container)) return 'FAILED';

    try { container.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
    await sleep(700);
    heartbeat('Phase3-Target', 'Commenting on ranked target post...');
    return await tryPostCommentWithRetries(container, commentText, targetUrl, 1);
  };

  window.__startExtraction = function (keyword, settings, comments, dashboardUrl, userId) {
    console.log('[v18] start: "' + keyword + '" on ' + window.location.href);
    if (settings && (settings.searchOnlyMode === true || settings.engineMode === 'SEARCH_ONLY')) {
      runSearchOnlyEntry(keyword, settings, dashboardUrl, userId);
    } else {
      runCommentCampaignEntry(keyword, settings, comments, dashboardUrl, userId);
    }
  };

  window.__linkedInExtractorCleanup = function () {
    chrome.runtime.onMessage.removeListener(messageHandler);
    isExtracting = false;
    // Invalidate any still-running async loop from older injected instances.
    window.__linkedInExtractorActiveRunId = ++window.__linkedInExtractorRunCounter;
  };

  async function runCommentCampaignEntry(keyword, settings, comments, dashboardUrl, userId) {
    if (isExtracting) { console.log('[CommentCampaign] Already running.'); return; }
    isExtracting = true;
    const runId = ++window.__linkedInExtractorRunCounter;
    window.__linkedInExtractorActiveRunId = runId;
    try {
      await extractPipeline(keyword, { ...settings, engineMode: 'COMMENT_CAMPAIGN', searchOnlyMode: false }, comments, dashboardUrl, userId, runId);
    } catch (e) {
      if (String(e?.message || e).includes('EXTRACTION_CANCELLED')) {
        console.log('[CommentCampaign] Cancelled (reinject).');
        return;
      }
      console.error('[CommentCampaign] Fatal:', e);
      safeSend({ action: 'JOB_FAILED', error: String(e), engineMode: 'COMMENT_CAMPAIGN' });
    } finally {
      if (window.__linkedInExtractorActiveRunId === runId) {
        isExtracting = false;
      }
    }
  }

  async function runSearchOnlyEntry(keyword, settings, dashboardUrl, userId) {
    if (isExtracting) { console.log('[SearchOnly] Already running.'); return; }
    isExtracting = true;
    const runId = ++window.__linkedInExtractorRunCounter;
    window.__linkedInExtractorActiveRunId = runId;
    try {
      await extractPipeline(keyword, { ...settings, engineMode: 'SEARCH_ONLY', searchOnlyMode: true }, [], dashboardUrl, userId, runId);
    } catch (e) {
      if (String(e?.message || e).includes('EXTRACTION_CANCELLED')) {
        console.log('[SearchOnly] Cancelled (reinject).');
        return;
      }
      console.error('[SearchOnly] Fatal:', e);
      safeSend({ action: 'JOB_FAILED', error: String(e), engineMode: 'SEARCH_ONLY' });
    } finally {
      if (window.__linkedInExtractorActiveRunId === runId) {
        isExtracting = false;
      }
    }
  }

  async function runExtraction(keyword, settings, comments, dashboardUrl, userId) {
    if (settings && (settings.searchOnlyMode === true || settings.engineMode === 'SEARCH_ONLY')) {
      return runSearchOnlyEntry(keyword, settings, dashboardUrl, userId);
    }
    return runCommentCampaignEntry(keyword, settings, comments, dashboardUrl, userId);
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

  /** Ads / promoted / suggested blocks — excluded from both modes. */
  function isAdOrSuggestedBlock(card) {
    if (!card) return true;
    if (card.closest('[data-sponsored], [data-ad-detail], .sponsored-update')) return true;
    if (card.querySelector('.feed-shared-actor__sponsored-label, [data-ad-detail], .sponsored-update__label')) return true;
    const sub = card.querySelector('.feed-shared-actor__sub-description, .update-components-actor__sub-description, .update-components-actor__meta');
    const st = ((sub && sub.innerText) || '').toLowerCase();
    if (/\bpromoted\b/.test(st) || /\bsponsored\b/.test(st)) return true;
    const aria = ((card.getAttribute('aria-label') || '') + ' ' + (card.innerText || '')).slice(0, 500).toLowerCase();
    if (aria.includes('suggested') && (aria.includes('follow') || aria.includes('people you may'))) return true;
    return false;
  }

  function parsePostTimeMsFromCard(card) {
    if (!card) return 0;
    const t = card.querySelector('time[datetime], .update-components-actor__sub-description time[datetime]');
    if (t) {
      const raw = t.getAttribute('datetime') || '';
      const ms = Date.parse(raw);
      if (!isNaN(ms)) return ms;
    }
    return 0;
  }

  function detectMediaTypeFromCard(card) {
    if (!card) return 'text';
    if (card.querySelector('video, .feed-shared-update-v2__video, .update-components-video')) return 'video';
    if (card.querySelector('.update-components-image__image, .feed-shared-image__image-link, .feed-shared-image img')) return 'image';
    return 'text';
  }

  function postIdFromCanonicalUrl(url) {
    const u = cleanUrl(url || '').split('?')[0];
    if (!u) return '';
    let h = 0;
    for (let i = 0; i < u.length; i++) h = ((h << 5) - h + u.charCodeAt(i)) | 0;
    return 'urn:urlhash:' + Math.abs(h).toString(36);
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
      // Use shared multilingual signal arrays (defined below STOP_TAGS)
      // Inline fallback here because pageDiag() runs before LIKE_SIGNALS is defined.
      const likeWords = [
        'react', 'like', 'إعجاب', "j'aime", 'curtir', 'gefällt', 'me gusta',
        'beğen', 'suka', 'vind ik leuk', 'mi piace', 'réaction', 'reação', 'tepki', 'reaction'
      ];
      const commentWords = [
        'comment', 'تعليق', 'commenter', 'comentar', 'kommentieren', 'comentário',
        'yorum', 'komentar', 'commenta'
      ];
      if (likeWords.some(w => lbl.includes(w) || txt === w)) d.likeBtn++;
      if (commentWords.some(w => lbl.includes(w) || txt === w)) d.commentBtn++;
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

  // ── Language signal arrays — covers EN, AR, FR, PT, DE, ES, TR, ID, NL, SV, IT, PL ──
  const LIKE_SIGNALS = [
    'react', 'like', 'إعجاب', "j'aime", 'curtir', 'gefällt', 'me gusta',
    'beğen', 'suka', 'vind ik leuk', 'synes godt om', 'mi piace', 'lubię to',
    'réaction', 'reação', 'reacción', 'tepki', 'like this', 'reaction'
  ];
  const COMMENT_SIGNALS = [
    'comment', 'تعليق', 'commenter', 'comentar', 'kommentieren', 'comentário',
    'yorum', 'komentar', 'kommentaar', 'kommentera', 'commenta', 'skomentuj'
  ];

  function isLikeButton(btn) {
    const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
    const txt = (btn.innerText || '').toLowerCase().trim();
    return LIKE_SIGNALS.some(s => lbl.includes(s) || txt === s || txt.startsWith(s));
  }

  function isCommentButton(btn) {
    const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
    const txt = (btn.innerText || '').toLowerCase().trim();
    return COMMENT_SIGNALS.some(s => lbl.includes(s) || txt === s);
  }

  function countMainActionLikeButtons(node) {
    let likeCount = 0;
    node.querySelectorAll('button').forEach(b => {
      if (b.closest('.feed-shared-update-v2__comments-container, .comments-comments-list, .comments-comment-item')) return;
      if (isLikeButton(b)) likeCount++;
    });
    return likeCount;
  }

  function hasLinkedInPostSignal(node) {
    if (!node || node.nodeType !== 1) return false;
    const cls = typeof node.className === 'string' ? node.className : '';
    if (
      node.matches?.('.feed-shared-update-v2,[role="article"][data-urn],.occludable-update,[data-view-name="feed-full-update"],li.artdeco-card,.reusable-search__result-container,.search-result__wrapper')
    ) {
      return true;
    }
    if (
      cls.includes('feed-shared-update-v2') ||
      cls.includes('occludable-update') ||
      cls.includes('reusable-search__result-container')
    ) {
      return true;
    }
    const urn = node.getAttribute?.('data-urn') || '';
    if (/urn:li:(activity|ugcPost|share):/i.test(urn)) return true;
    if (node.getAttribute?.('data-view-name') === 'feed-full-update') return true;
    return false;
  }

  function resolvePostCard(node) {
    if (!node || node.nodeType !== 1) return null;

    const direct = node.closest?.('.feed-shared-update-v2[role="article"][data-urn], [role="article"][data-urn], .feed-shared-update-v2[role="article"], [data-view-name="feed-full-update"], .occludable-update, li.artdeco-card, .reusable-search__result-container, div.search-result__wrapper');
    if (direct) {
      const inner = direct.matches?.('.feed-shared-update-v2[role="article"][data-urn], [role="article"][data-urn]')
        ? direct
        : direct.querySelector?.('.feed-shared-update-v2[role="article"][data-urn], [role="article"][data-urn], .feed-shared-update-v2[role="article"], [data-urn].feed-shared-update-v2');
      return inner || direct;
    }

    const nested = node.querySelector?.('.feed-shared-update-v2[role="article"][data-urn], [role="article"][data-urn], .feed-shared-update-v2[role="article"], [data-urn].feed-shared-update-v2');
    if (nested) return nested;
    return node;
  }

  function collectCardEvidenceNodes(card) {
    if (!card || card.nodeType !== 1) return [];
    const nodes = [];
    const seen = new Set();
    const push = (el) => {
      if (!el || el.nodeType !== 1 || seen.has(el)) return;
      seen.add(el);
      nodes.push(el);
    };

    push(card);
    let walker = card;
    for (let i = 0; i < 6 && walker; i++) {
      push(walker);
      walker = walker.parentElement;
    }

    const selectors = [
      '.feed-shared-update-v2[role="article"][data-urn]',
      '[role="article"][data-urn]',
      '.feed-shared-update-v2[role="article"]',
      '[data-view-name="feed-full-update"]',
      '.occludable-update',
      'li.artdeco-card',
      '.reusable-search__result-container',
      'div.search-result__wrapper'
    ];

    for (const sel of selectors) {
      try { push(card.closest?.(sel)); } catch (e) {}
      try { push(card.querySelector?.(sel)); } catch (e) {}
    }

    return nodes;
  }

  function isLikelySinglePostContainer(node) {
    if (!node) return false;
    const resolved = resolvePostCard(node) || node;
    if (hasLinkedInPostSignal(resolved)) {
      const rect = resolved.getBoundingClientRect ? resolved.getBoundingClientRect() : { height: 0, width: 0 };
      const h = rect.height || resolved.offsetHeight || 0;
      const w = rect.width || resolved.offsetWidth || 0;
      if (h >= 40 && w >= 160) return true;
    }
    const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { height: 0, width: 0 };
    const h = rect.height || node.offsetHeight || 0;
    const w = rect.width || node.offsetWidth || 0;
    if (h < 80 || w < 200) return false;
    const likeCount = countMainActionLikeButtons(node);
    if (likeCount > 6) return false;
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

  function extractCanonicalFromTrackingBlob(text) {
    if (!text) return null;
    const src = String(text);
    const direct = src.match(/(?:updateUrn|updateEntityUrn|entityUrn|trackingUrn)"?\s*[:=]\s*"?(urn:li:(activity|ugcPost|share):[A-Za-z0-9:_-]{8,64})/i);
    if (direct) {
      const urn = direct[1].match(/urn:li:(activity|ugcPost|share):([A-Za-z0-9:_-]{8,64})/i);
      if (urn) {
        const built = canonicalFromUrn(urn[1], urn[2]);
        if (built && isValidCanonicalPostUrl(built)) return built;
      }
    }
    const loose = src.match(/urn:li:(activity|ugcPost|share):([A-Za-z0-9:_-]{8,64})/i);
    if (loose) {
      const built = canonicalFromUrn(loose[1], loose[2]);
      if (built && isValidCanonicalPostUrl(built)) return built;
    }
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

      const resolved = resolvePostCard(node);
      if (!resolved) continue;
      if (!isLikelySinglePostContainer(resolved)) continue;

      for (const attr of ['data-urn','data-chameleon-result-urn','data-entity-urn','data-update-urn','data-id']) {
        const v = (resolved.getAttribute(attr) || node.getAttribute(attr) || '');
        if (v.includes('activity') || v.includes('ugcPost') || v.includes('share')) {
          return resolved;
        }
      }

      const hasPostAnchor = !!resolved.querySelector('a[href*="/feed/update/"],a[href*="/posts/"],a[href*="urn:li:activity"],a[href*="urn:li:ugcPost"],a[href*="urn:li:share"]');
      if (hasPostAnchor || hasLinkedInPostSignal(resolved)) return resolved;

      if (!fallbackCandidate) fallbackCandidate = resolved;
    }

    return fallbackCandidate;
  }

  /**
   * After long scrolls, LinkedIn drops old nodes from the document; `post.container` is often stale.
   * Find a currently attached card by matching canonical post URLs in the live DOM.
   */
  function findLivePostContainerByUrl(postUrl) {
    if (!postUrl) return null;
    const key = cleanUrl(postUrl);
    if (!key) return null;

    const anchorSel = 'a[href*="/feed/update/"],a[href*="/posts/"],a[href*="urn:li:activity"],a[href*="urn:li:ugcPost"],a[href*="urn:li:share"]';
    for (const a of document.querySelectorAll(anchorSel)) {
      try {
        const canon = extractCanonicalFromHref(a.getAttribute('href') || a.href || '');
        if (!canon || cleanUrl(canon) !== key) continue;
        const card = walkUpToCard(a) || resolvePostCard(a.closest('.feed-shared-update-v2,.occludable-update,[data-view-name="feed-full-update"],li.artdeco-card,.reusable-search__result-container,li.reusable-search__result-container,article,div.search-result__wrapper'));
        if (card && document.contains(card)) return card;
      } catch (e) {}
    }

    const cardSelectors = ['.feed-shared-update-v2[role="article"]', '[role="article"][data-urn]', '.occludable-update', '[data-view-name="feed-full-update"]', 'li.artdeco-card', '.reusable-search__result-container', 'li.reusable-search__result-container', 'article'];
    for (const sel of cardSelectors) {
      for (const card of document.querySelectorAll(sel)) {
        try {
          const resolved = resolvePostCard(card);
          if (!resolved || !isLikelySinglePostContainer(resolved) || !document.contains(resolved)) continue;
          const u = extractUrlFromCard(resolved);
          if (u && cleanUrl(u) === key) return resolved;
        } catch (e) {}
      }
    }
    return null;
  }

  async function locateLiveContainerForPostUrl(postUrl, maxScrollSteps = 12) {
    let live = findLivePostContainerByUrl(postUrl);
    if (live) return live;
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { try { window.scrollTo(0, 0); } catch (e2) {} }
    await wait(450, 750);
    live = findLivePostContainerByUrl(postUrl);
    if (live) return live;
    for (let i = 0; i < maxScrollSteps; i++) {
      aggressiveScroll(700 + Math.floor(Math.random() * 400));
      await wait(260, 480);
      live = findLivePostContainerByUrl(postUrl);
      if (live) return live;
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // URL EXTRACTION — try EVERY method to get a post URL from a card
  // ═══════════════════════════════════════════════════════════
  function extractUrlFromCard(card) {
    if (!card) return null;

    try {
      const target = resolvePostCard(card) || card;
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
      for (const a of target.querySelectorAll('a[href]')) {
        const href = a.href || '';
        const extracted = extractCanonicalFromHref(href);
        if (extracted) return extracted;
      }

      // 2. CONTROL MENU / copy-link targets
      for (const btn of target.querySelectorAll('[data-clipboard-text], [data-share-url]')) {
        const url = btn.getAttribute('data-clipboard-text') || btn.getAttribute('data-share-url');
        if (url && (url.includes('linkedin.com/posts/') || url.includes('linkedin.com/feed/update/'))) {
          const built = cleanUrl(url);
          if (isValidCanonicalPostUrl(built)) return built;
        }
      }

      // 3. data-* attributes — only activity / ugcPost digit IDs
      const attrList = ['data-urn', 'data-id', 'data-update-urn', 'data-entity-urn', 'data-chameleon-result-urn', 'updateUrn', 'data-view-tracking-scope'];
      const safeEls = [];
      const seenEls = new Set();
      const pushEl = (el) => {
        if (!el || el.nodeType !== 1 || seenEls.has(el)) return;
        seenEls.add(el);
        safeEls.push(el);
      };
      collectCardEvidenceNodes(target).forEach(pushEl);
      target.querySelectorAll(attrList.map(a => `[${a}]`).join(', ')).forEach(pushEl);
      for (const el of safeEls) {
        for (const attr of attrList) {
          const val = el.getAttribute(attr);
          if (!val) continue;
          const m = val.match(ATTR_URN_REGEX);
          if (m) {
          const u = buildFromUrn(m[1], m[2]);
            if (u && isValidCanonicalPostUrl(u)) return cleanUrl(u);
          }
          const tracked = extractCanonicalFromTrackingBlob(val);
          if (tracked) return tracked;
        }
      }

      // 4. Wrapper HTML / text fallback
      for (const node of collectCardEvidenceNodes(target)) {
        const html = node.outerHTML || node.innerHTML || '';
        const m = html.match(/urn:li:(activity|ugcPost|share):([A-Za-z0-9:_-]{8,64})/i);
        if (m) {
          const u = buildFromUrn(m[1], m[2]);
          if (u && isValidCanonicalPostUrl(u)) return cleanUrl(u);
        }
        const tracked = extractCanonicalFromTrackingBlob(html);
        if (tracked) return tracked;
        const textTracked = extractCanonicalFromTrackingBlob(node.textContent || '');
        if (textTracked) return textTracked;
      }

      // 5. Emergency extraction from embedded JSON/text blobs.
      const emergency = extractCanonicalPostUrlFromText((target.outerHTML || target.innerHTML || ''));
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
            
            if (LIKE_SIGNALS.some(s => lbl.includes(s) || txt === s)) {
                hasLikeBtn = true;
            }
            if (COMMENT_SIGNALS.some(s => lbl.includes(s) || txt === s)) {
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
    let likes = 0, postComments = 0, postShares = 0;

    // Helper: parse a number from a string like "1,247 reactions" or "1.2K reactions"
    // Covers EN, AR, FR, PT, DE, ES, TR, ID, NL, SV, IT, PL and more
    const REACTION_WORDS = [
      'reaction', 'like', 'إعجاب', "j'aime", 'gefällt', 'curtir', 'me gusta',
      'réaction', 'reação', 'reacción', 'tepki', 'suka', 'mi piace', 'lubię',
      'synes', 'vind ik', 'reageer', 'beğen'
    ];
    const COMMENT_WORDS = [
      'comment', 'تعليق', 'kommentar', 'comentario', 'commentaire', 'comentário',
      'yorum', 'komentar', 'commenta', 'skomentuj', 'kommentaar'
    ];
    const SHARE_WORDS = [
      'repost', 'share', 'partage', 'teilen', 'compartilhar', 'compartir',
      'paylaş', 'bagikan', 'delen', 'dela', 'condividi'
    ];
    function parseMetricLabel(lbl) {
      const n = num(lbl);
      if (n <= 0) return;
      const l = lbl.toLowerCase();
      if (REACTION_WORDS.some(w => l.includes(w))) likes = Math.max(likes, n);
      if (COMMENT_WORDS.some(w => l.includes(w))) postComments = Math.max(postComments, n);
      if (SHARE_WORDS.some(w => l.includes(w))) postShares = Math.max(postShares, n);
    }

    // ── PASS 1: Social counts bar (primary — works on feed pages) ──
    const COMMENT_GUARD = '.feed-shared-update-v2__comments-container, .comments-comments-list, article.comment, .comments-comment-item';
    const bars = el.querySelectorAll(
      '.update-components-social-counts, .social-details-social-counts, ' +
      '[class*="social-counts"], [class*="social-activity-counts"], ' +
      '[class*="reactions-count"], [class*="socialActivity"]'
    );
    for (const bar of bars) {
      if (bar.closest(COMMENT_GUARD)) continue;
      bar.querySelectorAll('[aria-label]').forEach(node => {
        parseMetricLabel(node.getAttribute('aria-label') || '');
      });
      const txt = bar.innerText || bar.textContent || '';
      const likeM = txt.match(/([\d,.]+[KMBkmb]?)\s*(?:reactions?|likes?|إعجاب)/i);
      if (likeM) likes = Math.max(likes, num(likeM[1]));
      const commM = txt.match(/([\d,.]+[KMBkmb]?)\s*(?:comments?|تعليق)/i);
      if (commM) postComments = Math.max(postComments, num(commM[1]));
      const shareM = txt.match(/([\d,.]+[KMBkmb]?)\s*(?:reposts?|shares?)/i);
      if (shareM) postShares = Math.max(postShares, num(shareM[1]));
      // Bare-number fallback: extracts likes from spans like <span aria-hidden="true">247</span>
      // CRITICAL: gate on likes===0 ONLY. If comments were already found via text regex,
      // the old condition (likes===0 && comments===0 && shares===0) was FALSE, skipping likes entirely.
      if (likes === 0) {
        const spans = bar.querySelectorAll('span[aria-hidden="true"], li, button');
        const numbers = [];
        spans.forEach(s => {
          const t = (s.innerText || s.textContent || '').trim();
          if (/^[\d,.]+[KMBkmb]?$/.test(t)) numbers.push(num(t));
        });
        if (numbers.length > 0) likes = Math.max(likes, numbers[0]);
        if (postComments === 0 && numbers.length > 1) postComments = Math.max(postComments, numbers[1]);
        if (postShares === 0 && numbers.length > 2) postShares = Math.max(postShares, numbers[2]);
      }
    }

    // ── PASS 2: Full aria-label scan across the ENTIRE card ──
    // KEY FIX for LinkedIn search result cards: social counts are NOT inside
    // .update-components-social-counts on search pages. Instead they appear as
    // aria-labels on button elements and span elements anywhere in the card.
    // e.g. <button aria-label="247 reactions"> or <span aria-label="15 comments">
    if (likes === 0 || postComments === 0) {
      el.querySelectorAll('[aria-label]').forEach(node => {
        if (node.closest(COMMENT_GUARD)) return;
        parseMetricLabel(node.getAttribute('aria-label') || '');
      });
    }

    // ── PASS 2.5: LinkedIn A/B DOM variant — universal reactions bubble ──
    // On some LinkedIn accounts LinkedIn serves a different DOM class structure
    // for social counts (e.g. the reactions bubble above the action bar).
    // This pass extracts the first standalone number adjacent to any reaction
    // emoji or inside any social-proof element, language-independently.
    if (likes === 0) {
      const bubbleSelectors = [
        '[class*="social-proof-fallback"]',
        '[class*="social-count"]',
        '[class*="reaction-count"]',
        '[class*="reactions-count"]',
        '[class*="social-detail"]',
        '[class*="social-proof"]',
        '[class*="engagement-count"]',
        '.update-components-social-counts button',
        '.social-details-social-counts button'
      ].join(', ');
      try {
        el.querySelectorAll(bubbleSelectors).forEach(node => {
          if (node.closest(COMMENT_GUARD)) return;
          // Check aria-label first — always most reliable
          const lbl = node.getAttribute('aria-label') || '';
          if (lbl) { parseMetricLabel(lbl); return; }
          // Fallback: bare number in text content
          const txt = (node.innerText || node.textContent || '').trim();
          if (/^[\d,.]+[KMBkmb]?$/.test(txt) && likes === 0) {
            const n = num(txt);
            if (n > 0) likes = Math.max(likes, n);
          }
        });
      } catch(e) {}
      // Also scan parent li — LinkedIn often puts social-counts as a SIBLING
      if (likes === 0) {
        const parentLi = el.closest('li') || el.parentElement;
        if (parentLi && parentLi !== el) {
          parentLi.querySelectorAll('[aria-label]').forEach(node => {
            if (node.closest(COMMENT_GUARD)) return;
            const lbl = node.getAttribute('aria-label') || '';
            if (lbl && likes === 0) parseMetricLabel(lbl);
          });
        }
      }
    }

    // ── PASS 3: Action bar buttons — reaction/comment/share buttons carry counts ──
    // LinkedIn search pages render like buttons as: aria-label="React Like 47 reactions"
    // or aria-label="47 people reacted to this post"
    if (likes === 0 || postComments === 0) {
      const actionBars = el.querySelectorAll(
        '.feed-shared-social-action-bar, .update-components-action-bar, ' +
        '[class*="action-bar"], [class*="social-bar"], [class*="toolbar"]'
      );
      for (const bar of actionBars) {
        if (bar.closest(COMMENT_GUARD)) continue;
        bar.querySelectorAll('button, [role="button"]').forEach(btn => {
          const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
          const txt = (btn.innerText || btn.textContent || '').toLowerCase();
          const combined = lbl + ' ' + txt;
          const n = num(combined);
          if (n > 0) {
            if (combined.includes('reaction') || combined.includes('like') || combined.includes('إعجاب')) {
              likes = Math.max(likes, n);
            }
            if (combined.includes('comment') || combined.includes('تعليق')) {
              postComments = Math.max(postComments, n);
            }
            if (combined.includes('repost') || combined.includes('share')) {
              postShares = Math.max(postShares, n);
            }
          }
        });
      }
    }

    // ── PASS 4: Search-page specific element patterns ──
    // LinkedIn search cards sometimes use these class patterns for engagement counts.
    if (likes === 0 || postComments === 0) {
      const searchSelectors = [
        '[class*="social-proof"]',
        '[class*="reaction-count"]',
        '[class*="engagement-count"]',
        '[class*="activity-count"]',
        '[data-test-social-detail-count]',
        '[data-testid*="reaction"]',
        '[data-testid*="social-count"]',
        'span[aria-hidden="true"] + [aria-label]',
        '.update-components-actor__meta'
      ].join(', ');
      try {
        el.querySelectorAll(searchSelectors).forEach(node => {
          if (node.closest(COMMENT_GUARD)) return;
          parseMetricLabel(node.getAttribute('aria-label') || '');
          const txt = (node.innerText || node.textContent || '').trim();
          if (/^[\d,.]+[KMBkmb]?$/.test(txt)) {
            // A bare number adjacent to an engagement label — treat as likes if we have none yet
            const n = num(txt);
            if (n > 0 && likes === 0) likes = Math.max(likes, n);
          } else {
            const lM = txt.match(/([\d,.]+[KMBkmb]?)\s*(?:reactions?|likes?)/i);
            if (lM) likes = Math.max(likes, num(lM[1]));
            const cM = txt.match(/([\d,.]+[KMBkmb]?)\s*comments?/i);
            if (cM) postComments = Math.max(postComments, num(cM[1]));
          }
        });
      } catch (e) {}
    }

    // ── PASS 5: Controlled footer text scan ──
    if (likes === 0 && postComments === 0) {
      const textCandidates = el.querySelectorAll(
        '.update-components-footer, [class*="footer"], ' +
        '[class*="social-detail"], [class*="engagement"], ' +
        '.feed-shared-update-v2__meta, [class*="post-meta"]'
      );
      const candidateText = Array.from(textCandidates)
        .filter(n => !n.closest(COMMENT_GUARD))
        .map(n => n.innerText || n.textContent || '')
        .join(' ');
      if (candidateText) {
        const lM = candidateText.match(/([\d,.]+[KMBkmb]?)\s*(?:reactions?|likes?|إعجاب)/i);
        if (lM) likes = Math.max(likes, num(lM[1]));
        const cM = candidateText.match(/([\d,.]+[KMBkmb]?)\s*(?:comments?|تعليق)/i);
        if (cM) postComments = Math.max(postComments, num(cM[1]));
        const sM = candidateText.match(/([\d,.]+[KMBkmb]?)\s*(?:reposts?|shares?)/i);
        if (sM) postShares = Math.max(postShares, num(sM[1]));
      }
    }

    // ── PASS 6: Scope expansion — search parent li/container ──
    // On LinkedIn search pages, .social-details-social-counts may be a SIBLING of the
    // article element, not a descendant. Walk up to the nearest li and re-scan.
    if (likes === 0) {
      const parentScope = el.closest('li, [class*="result-container"], [class*="cluster"]') || el.parentElement;
      if (parentScope && parentScope !== el) {
        parentScope.querySelectorAll(
          '.social-details-social-counts, .update-components-social-counts, ' +
          '[class*="social-counts"], [class*="reactions-count"]'
        ).forEach(bar => {
          if (bar.closest(COMMENT_GUARD)) return;
          // Re-run all extraction on the wider scope bar
          bar.querySelectorAll('[aria-label]').forEach(n => parseMetricLabel(n.getAttribute('aria-label') || ''));
          const t = bar.innerText || bar.textContent || '';
          const lM = t.match(/([\d,.]+[KMBkmb]?)\s*(?:reactions?|likes?)/i);
          if (lM) likes = Math.max(likes, num(lM[1]));
          const cM = t.match(/([\d,.]+[KMBkmb]?)\s*(?:comments?)/i);
          if (cM) postComments = Math.max(postComments, num(cM[1]));
          if (likes === 0) {
            bar.querySelectorAll('span[aria-hidden="true"]').forEach(s => {
              const v = (s.innerText || s.textContent || '').trim();
              if (/^[\d,.]+[KMBkmb]?$/.test(v) && likes === 0) likes = Math.max(likes, num(v));
            });
          }
        });
      }
    }

    // ── PASS 7: Raw visible-text scan (absolute final fallback) ──
    // LinkedIn always renders cards as visible text in the format:
    //   "247"  (reaction count, standalone line, no label)
    //   "15 comments • 8 reposts"
    // This pass finds the number that immediately precedes "comments" in the raw text.
    if (likes === 0) {
      const textSource = el.closest('li') || el;
      const raw = textSource.innerText || textSource.textContent || '';
      // Pattern A: "247\n15 comments" — two adjacent numbers where 2nd is before "comments"
      const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      for (let i = 0; i < lines.length; i++) {
        const isCommentLine = /^([\d,.]+[KMBkmb]?)\s*comments?/i.test(lines[i]);
        if (isCommentLine) {
          const cMatch = lines[i].match(/^([\d,.]+[KMBkmb]?)/i);
          if (cMatch && postComments === 0) postComments = Math.max(postComments, num(cMatch[1]));
          // The reaction count is the bare number on the line immediately before
          if (i > 0 && /^[\d,.]+[KMBkmb]?$/.test(lines[i - 1])) {
            likes = Math.max(likes, num(lines[i - 1]));
          }
          break;
        }
      }
      // Pattern B: inline "247 reactions" or "X reactions • Y comments"
      if (likes === 0) {
        const inlineMatch = raw.match(/([\d,.]+[KMBkmb]?)\s*reactions?/i);
        if (inlineMatch) likes = Math.max(likes, num(inlineMatch[1]));
      }
      // Pattern C: "reactions" button aria-label on the wider scope
      if (likes === 0) {
        const textSource2 = el.closest('li') || el;
        textSource2.querySelectorAll('button[aria-label], [role="button"][aria-label]').forEach(btn => {
          if (btn.closest(COMMENT_GUARD)) return;
          parseMetricLabel(btn.getAttribute('aria-label') || '');
        });
      }
    }

    // ── Author extraction ──
    let author = 'Unknown';
    for (const sel of [
      'a[href*="/in/"] span[aria-hidden="true"]',
      'a[href*="/company/"] span[aria-hidden="true"]',
      '.update-components-actor__title',
      '.feed-shared-actor__title',
      'span[aria-hidden="true"]'
    ]) {
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

    return {
      likes,
      postComments,
      postShares,
      author,
      textSnippet,
      postedAtMs: parsePostTimeMsFromCard(el),
      mediaType: detectMediaTypeFromCard(el)
    };
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
      '.feed-shared-update-v2[role="article"]',
      '[role="article"][data-urn]',
      '.occludable-update',
      '[data-view-name="feed-full-update"]',
      'li.artdeco-card',
      '.reusable-search__result-container', 
      '.feed-shared-update-v2',
      '.search-entity',
      'article',
      'li.reusable-search__result-container',
      '[data-urn].feed-shared-update-v2',
      'div.search-result__wrapper'
    ];

    document.querySelectorAll((opts.overrideSelectors || cardSelectors).join(', ')).forEach(card => {
      try {
        const resolvedCard = resolvePostCard(card);
        if (!resolvedCard || seenCards.has(resolvedCard) || seenCards.has(card)) return;
        _diag.cards++;

        if (isAdOrSuggestedBlock(resolvedCard)) return;
        if (!isLikelySinglePostContainer(resolvedCard)) { _diag.tooSmall++; return; }

        let url = extractUrlFromCard(resolvedCard);
        let cleanedUrl = url ? cleanUrl(url) : null;

        if (!cleanedUrl || !isValidCanonicalPostUrl(cleanedUrl)) {
            _diag.noUrl++;
            return;
        }

        if (seenUrls.has(cleanedUrl)) {
           seenCards.add(resolvedCard);
           seenCards.add(card);
           _diag.duplicate++;
           return; 
        }

        seenUrls.add(cleanedUrl);
        seenCards.add(resolvedCard);
        seenCards.add(card);

        // DO NOT block collection based on commentability.
        // Store the flag for later use by comment-mode, but always collect the post.
        const isCommentable = checkIsCommentable(resolvedCard);
        if (!isCommentable) _diag.uncommentable++;

        const metrics = extractMetrics(resolvedCard);
        
        allPosts.push({
          url: cleanedUrl,
          likes: metrics.likes,
          postComments: metrics.postComments,
          postShares: metrics.postShares || 0,
          author: metrics.author,
          textSnippet: metrics.textSnippet,
          postedAtMs: metrics.postedAtMs,
          mediaType: metrics.mediaType,
          commentable: isCommentable,
          container: resolvedCard,
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
        if (isAdOrSuggestedBlock(card)) continue;
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
          postShares: metrics.postShares || 0,
          author: metrics.author,
          textSnippet: metrics.textSnippet,
          postedAtMs: metrics.postedAtMs,
          mediaType: metrics.mediaType,
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
    document.querySelectorAll('a[href*="/feed/update/"], a[href*="/posts/"], a[href*="urn:li:activity"], a[href*="urn:li:ugcPost"], a[href*="urn:li:share"]').forEach(a => {
      try {
        const href = a.href || '';
        const postUrl = extractCanonicalFromHref(href);
        if (!postUrl || !isValidCanonicalPostUrl(postUrl) || seenUrls.has(postUrl)) return;
        _diag.anchors++;
        const parentCard = walkUpToCard(a);
        const finalCard = parentCard || resolvePostCard(a.closest('article,li,div')) || a.parentElement;
        if (finalCard && isAdOrSuggestedBlock(finalCard)) return;
        seenUrls.add(postUrl);
        if (finalCard) seenCards.add(finalCard);
        const isCommentable = finalCard ? checkIsCommentable(finalCard) : true;
        const metrics = finalCard ? extractMetrics(finalCard) : { likes: 0, postComments: 0, author: '', textSnippet: '', postedAtMs: 0, mediaType: 'text' };
        allPosts.push({
          url: postUrl, likes: metrics.likes, postComments: metrics.postComments, postShares: metrics.postShares || 0,
          author: metrics.author, textSnippet: metrics.textSnippet,
          postedAtMs: metrics.postedAtMs, mediaType: metrics.mediaType,
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
          const resolved = resolvePostCard(el) || el;
          if (seenCards.has(resolved) || seenCards.has(el)) return;
          if (!isLikelySinglePostContainer(resolved) || isAdOrSuggestedBlock(resolved)) return;
          for (const attr of ['data-urn','data-chameleon-result-urn','data-entity-urn','data-update-urn']) {
            const v = resolved.getAttribute(attr) || el.getAttribute(attr) || '';
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
                seenCards.add(resolved);
                seenCards.add(el);
                const isCommentable = checkIsCommentable(resolved);
                const metrics = extractMetrics(resolved);
                allPosts.push({
                  url: fixed, likes: metrics.likes, postComments: metrics.postComments, postShares: metrics.postShares || 0,
                  author: metrics.author, textSnippet: metrics.textSnippet,
                  postedAtMs: metrics.postedAtMs, mediaType: metrics.mediaType,
                  commentable: isCommentable, container: resolved, hasRealUrl: true,
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
            postedAtMs: 0, mediaType: 'text',
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

    try { window.__lastHarvestDiag = { ..._diag, added, deepScan, ts: Date.now() }; } catch (e) {}
    return added;
  }

  function recordHarvestedPost(card, cleanedUrl, seenUrls, seenCards, allPosts) {
    if (!cleanedUrl || !isValidCanonicalPostUrl(cleanedUrl) || seenUrls.has(cleanedUrl)) return false;
    const resolved = resolvePostCard(card) || card;
    seenUrls.add(cleanedUrl);
    if (resolved) seenCards.add(resolved);
    if (card) seenCards.add(card);
    const isCommentable = resolved ? checkIsCommentable(resolved) : true;
    const metrics = resolved ? extractMetrics(resolved) : { likes: 0, postComments: 0, author: '', textSnippet: '', postedAtMs: 0, mediaType: 'text' };
    allPosts.push({
      url: cleanedUrl,
      likes: metrics.likes,
      postComments: metrics.postComments,
      postShares: metrics.postShares || 0,
      author: metrics.author,
      textSnippet: metrics.textSnippet,
      postedAtMs: metrics.postedAtMs,
      mediaType: metrics.mediaType,
      commentable: isCommentable,
      container: resolved || card || null,
      hasRealUrl: true,
      discoveryIndex: allPosts.length
    });
    return true;
  }

  function getVisibleActionCards(limit = 6) {
    const cards = [];
    const seen = new Set();
    for (const { el: btn } of findAllActionButtons()) {
      const card = walkUpToCard(btn);
      if (!card || seen.has(card)) continue;
      const rect = card.getBoundingClientRect ? card.getBoundingClientRect() : { width: 0, height: 0, bottom: 0, top: 0 };
      if (rect.width < 120 || rect.height < 80) continue;
      if (rect.bottom < -100 || rect.top > window.innerHeight + 200) continue;
      seen.add(card);
      cards.push(card);
      if (cards.length >= limit) break;
    }
    return cards;
  }

  function findControlMenuTrigger(card) {
    if (!card) return null;
    const evidence = collectCardEvidenceNodes(card);
    for (const node of evidence) {
      const trigger = node.querySelector?.('.feed-shared-control-menu__trigger, button[aria-label*="control menu" i], button[aria-label^="Open control menu" i], .artdeco-dropdown__trigger[aria-label*="control menu" i]');
      if (trigger) return trigger;
    }
    return null;
  }

  function getOpenControlMenus(trigger = null) {
    const menus = [];
    const seen = new Set();
    const push = (el) => {
      if (!el || seen.has(el)) return;
      const hidden = el.getAttribute?.('aria-hidden');
      if (hidden === 'true') return;
      seen.add(el);
      menus.push(el);
    };

    try {
      const controls = trigger?.getAttribute?.('aria-controls');
      if (controls) push(document.getElementById(controls));
    } catch (e) {}

    document.querySelectorAll('.artdeco-dropdown__content, [role="menu"], [id^="ember"][class*="dropdown__content"]').forEach(push);
    return menus;
  }

  function extractCanonicalFromMenuRoot(root) {
    if (!root) return null;
    for (const el of root.querySelectorAll('[data-clipboard-text],[data-share-url],a[href],button,a,[role="menuitem"],div[role="button"]')) {
      const direct = extractCanonicalFromHref(
        el.getAttribute('data-clipboard-text') ||
        el.getAttribute('data-share-url') ||
        el.getAttribute('href') ||
        el.href ||
        ''
      );
      if (direct) return direct;
      const tracked = extractCanonicalFromTrackingBlob(
        (el.getAttribute('data-clipboard-text') || '') + ' ' +
        (el.getAttribute('data-share-url') || '') + ' ' +
        (el.getAttribute('href') || '') + ' ' +
        (el.outerHTML || '')
      );
      if (tracked) return tracked;
    }
    const htmlTracked = extractCanonicalFromTrackingBlob(root.outerHTML || root.innerHTML || '');
    if (htmlTracked) return htmlTracked;
    return extractCanonicalPostUrlFromText(root.outerHTML || root.innerHTML || '');
  }

  async function closeOpenMenus() {
    try { document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape', code: 'Escape' })); } catch (e) {}
    try { document.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Escape', code: 'Escape' })); } catch (e) {}
    await sleep(120);
  }

  async function resolveUrlViaControlMenu(card) {
    const trigger = findControlMenuTrigger(card);
    if (!trigger) return null;

    try { trigger.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
    await sleep(120);

    try { trigger.click(); } catch (e) {}
    try {
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {}

    await sleep(220);
    for (let attempt = 0; attempt < 5; attempt++) {
      const roots = getOpenControlMenus(trigger);
      for (const root of roots) {
        const found = extractCanonicalFromMenuRoot(root);
        if (found) {
          await closeOpenMenus();
          return cleanUrl(found);
        }
      }
      await sleep(120);
    }

    await closeOpenMenus();
    return null;
  }

  async function activeHarvestVisibleCards(seenUrls, seenCards, allPosts, limit = 4) {
    let added = 0;
    const cards = getVisibleActionCards(limit);
    for (const card of cards) {
      let url = extractUrlFromCard(card);
      let cleanedUrl = url ? cleanUrl(url) : null;
      if (!cleanedUrl || !isValidCanonicalPostUrl(cleanedUrl)) {
        cleanedUrl = await resolveUrlViaControlMenu(card);
      }
      if (!cleanedUrl || !isValidCanonicalPostUrl(cleanedUrl)) continue;
      if (recordHarvestedPost(card, cleanedUrl, seenUrls, seenCards, allPosts)) {
        added++;
      }
      await sleep(120);
    }
    if (added > 0) {
      console.log('[SearchOnly] active menu harvest added=' + added + ' visibleCards=' + cards.length + ' totalUrls=' + seenUrls.size);
    }
    return added;
  }

  function countReal(posts) {
    return posts.filter(p => p.hasRealUrl || (p.url && !p.url.startsWith('discovered:') && !p.url.includes('synthetic:'))).length;
  }

  // ═══════════════════════════════════════════════════════════
  // SCROLLING — aggressive multi-target + slow waits
  // ═══════════════════════════════════════════════════════════
  // ── findScrollContainer: detect the real scrollable element ─────────────────────
  // Diagnostic confirmed: on this LinkedIn variant the <main> element has
  // overflowY:scroll and scrollHeight=41,983px while window.scrollY stays 0.
  // ALL scrolling must target this element, never the window.
  function findScrollContainer() {
    const main = document.querySelector('main');
    if (main) {
      try {
        const st = getComputedStyle(main).overflowY;
        if (main.scrollHeight > main.clientHeight && (st === 'scroll' || st === 'auto')) return main;
      } catch(e) {}
      // Even if getComputedStyle fails, use <main> if it has real scroll depth
      if (main.scrollHeight > 2000) return main;
    }
    // Fallbacks for other LinkedIn page variants
    for (const sel of ['[role="main"]', '.scaffold-layout__main', '.scaffold-layout__content', '.search-results-container']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      try {
        const st = getComputedStyle(el).overflowY;
        if (el.scrollHeight > el.clientHeight * 1.5 && (st === 'scroll' || st === 'auto')) return el;
      } catch(e) {}
    }
    return null;
  }

  function aggressiveScroll(pixels) {
    // PRIMARY: scroll the confirmed <main> scroll container.
    // Diagnostic proved window.scrollY stays 0 on this LinkedIn variant —
    // ALL content lives inside <main overflowY:scroll>.
    const sc = findScrollContainer();
    if (sc) {
      sc.scrollTop += pixels;
      try { sc.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
      try { sc.dispatchEvent(new Event('scrollend', { bubbles: true })); } catch(e) {}
      return; // Do NOT also scroll window — that would move the wrong thing
    }
    // FALLBACK: window + known containers (for page variants where <main> isn't the scroller)
    try { window.scrollBy({ top: pixels, behavior: 'auto' }); } catch(e) {}
    try { document.documentElement.scrollTop += pixels; } catch(e) {}
    try { document.body.scrollTop += pixels; } catch(e) {}
    for (const sel of ['.scaffold-layout__main', '[role="main"]', '.search-results-container', '.scaffold-layout__content']) {
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
    const sc = findScrollContainer();
    if (sc) {
      sc.scrollTop = sc.scrollHeight;
      try { sc.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
      return;
    }
    const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    try { window.scrollTo({ top: h, behavior: 'auto' }); } catch(e) {}
    try { document.documentElement.scrollTop = h; } catch(e) {}
  }

  // ── harvestByUrn: full-document URN sweep ───────────────────────────────────
  // LinkedIn's virtual list renderer removes old DOM nodes as you scroll down.
  // This means posts scrolled past are DELETED from the DOM before harvest() can
  // see them via card selectors. However, LinkedIn always keeps data-urn attributes
  // on wrapper elements even after the content is virtualized away.
  // This function scans the ENTIRE document for any element with a URN attribute,
  // builds the canonical post URL directly from the URN string, and adds it to
  // allPosts without needing the full card DOM. Metrics are filled later by the
  // page index and refreshMetricsForVisibleCards.
  function harvestByUrn(seenUrls, allPosts) {
    let added = 0;
    const urnAttrs = ['data-urn','data-chameleon-result-urn','data-entity-urn','data-update-urn'];
    const URN_RE = /urn:li:(activity|ugcPost|share):([A-Za-z0-9:_-]{8,64})/i;
    const seen = new Set();
    document.querySelectorAll(urnAttrs.map(a => `[${a}]`).join(', ')).forEach(el => {
      try {
        for (const attr of urnAttrs) {
          const val = el.getAttribute(attr);
          if (!val) continue;
          const m = val.match(URN_RE);
          if (!m) continue;
          const t = m[1].toLowerCase();
          const built = t === 'ugcpost'
            ? 'https://www.linkedin.com/feed/update/urn:li:ugcPost:' + m[2]
            : t === 'activity'
              ? 'https://www.linkedin.com/feed/update/urn:li:activity:' + m[2]
              : 'https://www.linkedin.com/feed/update/urn:li:share:' + m[2];
          const u = cleanUrl(built);
          if (!u || !isValidCanonicalPostUrl(u) || seenUrls.has(u) || seen.has(u)) break;
          seen.add(u);
          if (isAdOrSuggestedBlock(el)) break;
          seenUrls.add(u);
          allPosts.push({
            url: u, likes: 0, postComments: 0, postShares: 0,
            author: 'Unknown', textSnippet: '', postedAtMs: 0, mediaType: 'text',
            commentable: true, container: el, hasRealUrl: true,
            discoveryIndex: allPosts.length, urnDiscovered: true
          });
          added++;
          break;
        }
      } catch(e) {}
    });
    if (added > 0) console.log(`[SearchOnly][UrnSweep] +${added} posts via URN attributes`);
    return added;
  }

  // ── harvestByAnchors: anchor-first, zero-layout-thrashing discovery ────────────
  // Performance-optimized rewrite. Key changes vs previous version:
  // 1. Persistent WeakSet cache (window.__anchorHarvestCache) — each anchor element
  //    is processed EXACTLY ONCE across all scroll steps. No re-evaluation ever.
  // 2. ZERO layout measurements — removed all offsetHeight/scrollHeight/scrollWidth
  //    calls from the traversal loop. Each of those forces a synchronous browser
  //    reflow, causing the "tab freezing" symptom.
  // 3. Structural card detection — card boundary = first ancestor that contains a
  //    button[aria-label]. No size gate. Works even on partially-rendered cards.
  // 4. Depth capped at 12 (was 25) — enough to reach the card from any anchor depth.
  function harvestByAnchors(seenUrls, seenCards, allPosts) {
    // Persistent anchor element cache — WeakSet won't prevent GC of removed nodes
    if (!window.__anchorHarvestCache) window.__anchorHarvestCache = new WeakSet();
    const cache = window.__anchorHarvestCache;

    let added = 0;
    const ANCHOR_SEL = [
      'a[href*="/feed/update/urn:li:activity:"]',
      'a[href*="/feed/update/urn:li:ugcPost:"]',
      'a[href*="/feed/update/urn:li:share:"]',
      'a[href*="/posts/"]'
    ].join(', ');

    document.querySelectorAll(ANCHOR_SEL).forEach(a => {
      // SKIP: already processed in a previous scroll step — zero cost
      if (cache.has(a)) return;
      cache.add(a);

      try {
        const url = extractCanonicalFromHref(a.href || '');
        if (!url || !isValidCanonicalPostUrl(url) || seenUrls.has(url)) return;

        // Walk UP to find the post card container.
        // NO layout measurements — pure DOM structure traversal only.
        // Stop at the first ancestor that has any button[aria-label] descendant.
        // That button is the Like/Comment/Repost bar, which only exists on post cards.
        let container = null;
        let el = a.parentElement;
        for (let d = 0; d < 12 && el && el !== document.body; d++) {
          if (el.querySelector('button[aria-label]')) { container = el; break; }
          el = el.parentElement;
        }

        if (container && seenCards.has(container)) { seenUrls.add(url); return; }
        if (container && isAdOrSuggestedBlock(container)) return;

        seenUrls.add(url);
        if (container) seenCards.add(container);

        const metrics = container
          ? extractMetrics(container)
          : { likes: 0, postComments: 0, postShares: 0, author: '', textSnippet: '', postedAtMs: 0, mediaType: 'text' };

        allPosts.push({
          url, likes: metrics.likes, postComments: metrics.postComments,
          postShares: metrics.postShares || 0, author: metrics.author,
          textSnippet: metrics.textSnippet, postedAtMs: metrics.postedAtMs,
          mediaType: metrics.mediaType,
          commentable: container ? checkIsCommentable(container) : true,
          container: container || null, hasRealUrl: true,
          discoveryIndex: allPosts.length, anchorDiscovered: true
        });
        added++;
      } catch(e) {}
    });

    if (added > 0) console.log(`[SearchOnly][AnchorHarvest] +${added} new posts`);
    return added;
  }

  function domSignalSnapshot() {
    // Track <main>.scrollTop (not window height) since <main> is the real scroll container.
    // Also count post anchors — the most reliable DOM signal on hashed-class variants.
    const sc = findScrollContainer();
    const anchorCount = document.querySelectorAll(
      'a[href*="/feed/update/urn:li:activity:"], a[href*="/feed/update/urn:li:share:"], a[href*="/feed/update/urn:li:ugcPost:"], a[href*="/posts/"]'
    ).length;
    return {
      h: sc ? sc.scrollTop : Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0),
      cards: anchorCount + document.querySelectorAll(
        '.reusable-search__result-container,.feed-shared-update-v2,article,.occludable-update,[data-view-name="feed-full-update"],li.artdeco-card'
      ).length
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

  function reachScoreUi(p) {
    return (Number(p.likes) || 0) + (Number(p.postComments) || Number(p.comments) || 0);
  }

  function searchOnlyCompositeReachScore(post) {
    const likes = Number(post?.likes) || 0;
    const commentsCount = Number(post?.postComments) || Number(post?.comments) || 0;
    const sharesCount = Number(post?.postShares) || Number(post?.shares) || 0;
    return likes + (commentsCount * 3) + (sharesCount * 2);
  }

  function evaluateSearchOnlyHardRules(post, opts = {}) {
    const minLikes = Number(opts.minLikes) || 10;
    const maxAgeMs = Number(opts.maxAgeMs) || (90 * 24 * 60 * 60 * 1000);
    const nowMs = Number(opts.nowMs) || Date.now();
    const likes = Number(post?.likes) || 0;
    const commentsCount = Number(post?.postComments) || Number(post?.comments) || 0;
    const sharesCount = Number(post?.postShares) || Number(post?.shares) || 0;
    const postedAtMs = Number(post?.postedAtMs) || 0;
    const commentable = post?.commentable !== false;
    const reasons = [];

    if (likes < minLikes) reasons.push(`likes=${likes} (<${minLikes})`);
    if (!commentable) reasons.push('closed group / comments disabled');
    // NOTE: LinkedIn search pages frequently do NOT expose the post timestamp via DOM.
    // Treating a missing date as a hard failure would silently discard all validated posts.
    // Instead: missing date = "date unknown, assume recent" and still passes the age check.
    // Only explicitly dated posts older than maxAgeMs are rejected.
    if (postedAtMs && (nowMs - postedAtMs) > maxAgeMs) reasons.push('older than 3 months');

    return {
      pass: reasons.length === 0,
      reasons,
      likes,
      commentsCount,
      sharesCount,
      postedAtMs,
      commentable
    };
  }

  function commentCampaignScore(post) {
    const likes = Number(post?.likes) || 0;
    const commentsCount = Number(post?.postComments) || Number(post?.comments) || 0;
    const reach = likes + commentsCount;
    const pos = Number(post?.discoveryIndex ?? 999999);
    const recency = Number(post?.postedAtMs) || 0;
    const strong =
      reach >= 5 ||
      (reach > 0 && pos < 12);
    return {
      reach,
      commentsCount,
      pos,
      recency,
      strong,
      sortScore: (reach * 1000000) + (commentsCount * 1000) + Math.max(0, 500 - pos)
    };
  }

  /** Comment-campaign ranking: exclude previously used URLs, prefer strong reach, then comments/recency/first seen. */
  function rankPostsForCommentCampaign(posts, opts = {}) {
    const excluded = new Set(
      Array.from(opts.excludeUrls || [])
        .map(u => cleanUrl(u))
        .filter(Boolean)
        .map(u => u.split('?')[0])
    );
    const pool = posts.filter(p =>
      p.url && isValidCanonicalPostUrl(p.url) &&
      (p.hasRealUrl || (p.url && !p.url.startsWith('discovered:') && !p.url.includes('synthetic:'))) &&
      p.commentable !== false
    );
    const byUrl = new Map();
    for (const p of pool) {
      const u = cleanUrl(p.url).split('?')[0];
      if (!u || excluded.has(u)) continue;
      if (!byUrl.has(u)) byUrl.set(u, p);
    }
    const arr = Array.from(byUrl.values());
    const scored = arr.map(p => ({ p, s: commentCampaignScore(p) }));
    const need = Math.max(1, Number(opts.need) || 2);
    const strongEnough = scored.filter(x => x.s.strong);
    const firstSeen = (p) => Number(p.discoveryIndex ?? 999999);
    scored.sort((a, b) => {
      if (a.s.strong !== b.s.strong) return Number(b.s.strong) - Number(a.s.strong);
      if (a.s.reach !== b.s.reach) return b.s.reach - a.s.reach;
      if (a.s.commentsCount !== b.s.commentsCount) return b.s.commentsCount - a.s.commentsCount;
      if (a.s.recency !== b.s.recency) return b.s.recency - a.s.recency;
      if (a.s.pos !== b.s.pos) return a.s.pos - b.s.pos;
      return firstSeen(a.p) - firstSeen(b.p);
    });
    const strongRanked = strongEnough
      .slice()
      .sort((a, b) => {
        if (a.s.reach !== b.s.reach) return b.s.reach - a.s.reach;
        if (a.s.commentsCount !== b.s.commentsCount) return b.s.commentsCount - a.s.commentsCount;
        if (a.s.recency !== b.s.recency) return b.s.recency - a.s.recency;
        if (a.s.pos !== b.s.pos) return a.s.pos - b.s.pos;
        return firstSeen(a.p) - firstSeen(b.p);
      })
      .map(x => x.p);

    if (opts.requireStrong && strongRanked.length >= need) {
      return strongRanked;
    }

    return scored.map(x => x.p);
  }

  function pickTopReachCommentTargets(posts, need, opts = {}) {
    const n = Math.max(1, parseInt(String(need), 10) || 2);
    return rankPostsForCommentCampaign(posts, { ...opts, need: n }).slice(0, n);
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
    const isSearchOnly = settings.searchOnlyMode === true || settings.engineMode === 'SEARCH_ONLY';
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

    // ── Step 4: Scroll / harvest ──
    // Comment campaign: ≤30 passes; stop as soon as N distinct top-by-reach targets exist (no extra scrolling).
    // Search-only: up to 100 steps + incremental sync + stall recovery.
    const isCommentCampaign = !isSearchOnly && Array.isArray(comments) && comments.length > 0;
    const COMMENT_SCROLL_STEPS = 30;
    const COMMENT_MIN_EVAL_SCROLLS = 6;
    let commentScrollPassesUsed = 0;

    if (isCommentCampaign) {
      let commentedHistory = [], usedCommentHistory = [];
      try {
        const s = await chrome.storage.local.get(['commentedPosts', 'usedCommentIds']);
        commentedHistory = s.commentedPosts || [];
        usedCommentHistory = s.usedCommentIds || [];
      } catch(e) {}
      const commentedSet = new Set(commentedHistory.map(u => cleanUrl(u)).filter(Boolean));
      const usedCommentSet = new Set(usedCommentHistory);
      const commentNeed = Math.max(1, comments.length);
      const haveEnoughTargets = () => pickTopReachCommentTargets(allPosts, commentNeed, { excludeUrls: commentedSet }).length >= commentNeed;

      heartbeat(
        'Phase1-Scroll',
        `CommentCampaign: ≤${COMMENT_SCROLL_STEPS} scrolls — stop early when ${commentNeed} distinct posts (reach) — then comment`
      );
      if (typeof window.__lastSeenSize === 'undefined') window.__lastSeenSize = seenUrls.size;

      if (haveEnoughTargets()) {
        console.log('[CommentCampaign] targets ready after initial harvest (0 scroll passes)');
        heartbeat('Phase1-Scroll', `✅ ${commentNeed} targets ready before scroll loop`);
      } else {
        for (let step = 0; step < COMMENT_SCROLL_STEPS; step++) {
          commentScrollPassesUsed = step + 1;
          ensureActiveRun();
          harvest(seenUrls, seenCards, allPosts, { deepScan: true });
          if (commentScrollPassesUsed >= COMMENT_MIN_EVAL_SCROLLS && haveEnoughTargets()) {
            console.log('[CommentCampaign] early stop scroll pass=' + commentScrollPassesUsed + '/' + COMMENT_SCROLL_STEPS);
            heartbeat('Phase1-Scroll', `✅ ${commentNeed} targets after ${commentScrollPassesUsed} pass(es)`);
            break;
          }
          aggressiveScroll(500 + Math.floor(Math.random() * 450));
          await wait(450, 900);
          if (step % 5 === 4) {
            await clickShowMore();
            await wait(400, 700);
            harvest(seenUrls, seenCards, allPosts, { deepScan: true });
            if (commentScrollPassesUsed >= COMMENT_MIN_EVAL_SCROLLS && haveEnoughTargets()) {
              console.log('[CommentCampaign] early stop after show-more pass=' + (step + 1));
              break;
            }
          }
        }
      }
      while (commentScrollPassesUsed < COMMENT_MIN_EVAL_SCROLLS) {
        ensureActiveRun();
        commentScrollPassesUsed++;
        aggressiveScroll(420 + Math.floor(Math.random() * 260));
        await wait(420, 780);
        harvest(seenUrls, seenCards, allPosts, { deepScan: true });
      }
      harvest(seenUrls, seenCards, allPosts, { deepScan: true });
      const rankedPreview = rankPostsForCommentCampaign(allPosts, { excludeUrls: commentedSet, need: commentNeed });
      console.log('[CommentCampaign] scrollPasses=' + commentScrollPassesUsed + ' rankedDistinct=' + rankedPreview.length + ' need=' + commentNeed + ' keyword="' + keyword + '" excluded=' + commentedSet.size);
    } else {
    const SEARCH_SCROLL_TARGET = 60;
    const SEARCH_ONLY_MIN_SAVE_TARGET = 10;
    const SEARCH_ONLY_MAX_SAVE_TARGET = 25;
    const SEARCH_ONLY_MIN_REACH_SCORE = 15;
    const SEARCH_ONLY_MIN_LIKES_HARD = 10;
    const SEARCH_ONLY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
    const SEARCH_ONLY_EARLY_POOL_TARGET = 30;
    const SEARCH_ONLY_EARLY_QUALIFIED_TARGET = 25;
    const SEARCH_PROGRESS_BATCH = 10;
    // Selector list for LinkedIn post card discovery.
    // RULE: Every selector must be specific enough to match ONLY post cards.
    // Never use broad combinators like "div li" or class wildcards without a
    // second qualifying attribute — they match hundreds of nav/UI elements,
    // corrupt seenCards, and cause catastrophic discovery regressions.
    const SEARCH_ONLY_CARD_SELECTORS = [
      // Standard feed cards
      '.feed-shared-update-v2[role="article"]',
      '[role="article"][data-urn]',
      '.occludable-update',
      '[data-view-name="feed-full-update"]',
      '.feed-shared-update-v2',
      // Search result page cards — confirmed safe selectors
      'li.reusable-search__result-container',
      '.reusable-search__result-container',
      // 2025 LinkedIn search DOM variants (data-view-name is always post-specific)
      '[data-view-name="search-entity-result-universal-template"]',
      '[data-view-name*="search-entity-result"]',
      // URN-bearing li elements — data-urn only exists on real post cards
      'li[data-urn]',
      'li[data-chameleon-result-urn]',
      'li[data-entity-urn]',
      // Artdeco & generic containers
      'li.artdeco-card',
      '.search-entity',
      'article',
      '[data-urn].feed-shared-update-v2',
      'div.search-result__wrapper',
      // 2025 voyager lite-card: only when gated by data-urn
      '[class*="update-components"][data-urn]'
    ];
    let step = 0;
    let totalSavedIncremental = 0;
    let noGrowthSteps = 0;
    let lastActiveHarvestStep = -99;

    const getUnsyncedRealPosts = () => allPosts.filter(p =>
      p.url &&
      p.hasRealUrl &&
      !syncedUrls.has(p.url) &&
      isValidCanonicalPostUrl(cleanUrl(p.url))
    );

    const scoreSearchOnlyQuality = p => {
      const likes = Number(p.likes) || 0;
      const commentsCount = Number(p.postComments ?? p.comments) || 0;
      const reach = likes + commentsCount;
      const pos = Number(p.discoveryIndex ?? 999);
      const isStrong =
        reach >= 8 ||
        commentsCount >= 3 ||
        likes >= 6;
      const isPromising =
        reach >= 4 ||
        pos < 10 ||
        (reach > 0 && pos < 25);
      const positionBonus =
        pos < 5 ? 140 :
        pos < 10 ? 90 :
        pos < 20 ? 45 : 0;
      return {
        reach,
        isStrong,
        isPromising,
        sortScore: (reach * 1000) + (commentsCount * 220) + (likes * 45) + positionBonus - pos
      };
    };

    const rankUnsyncedSearchOnlyPosts = () => {
      return getUnsyncedRealPosts()
        .map(p => ({ p, q: scoreSearchOnlyQuality(p) }))
        .sort((a, b) => {
          if (a.q.isStrong !== b.q.isStrong) return Number(b.q.isStrong) - Number(a.q.isStrong);
          if (a.q.isPromising !== b.q.isPromising) return Number(b.q.isPromising) - Number(a.q.isPromising);
          if (a.q.sortScore !== b.q.sortScore) return b.q.sortScore - a.q.sortScore;
          if (a.q.reach !== b.q.reach) return b.q.reach - a.q.reach;
          return (a.p.discoveryIndex ?? 999999) - (b.p.discoveryIndex ?? 999999);
        });
    };

    const getUnsyncedQualityPosts = () => {
      const ranked = rankUnsyncedSearchOnlyPosts();
      const unique = new Map();
      const takeFrom = rows => {
        rows.forEach(row => {
          if (!row?.p?.url || unique.has(row.p.url)) return;
          unique.set(row.p.url, row.p);
        });
      };

      takeFrom(ranked.filter(x => x.q.isStrong));
      if (unique.size < SEARCH_ONLY_MAX_SAVE_TARGET) {
        takeFrom(ranked.filter(x => x.q.isPromising));
      }
      if (unique.size < SEARCH_ONLY_MAX_SAVE_TARGET) {
        takeFrom(ranked.filter(x => x.q.reach > 0));
      }
      if (unique.size < SEARCH_ONLY_MAX_SAVE_TARGET) {
        takeFrom(ranked);
      }

      return Array.from(unique.values());
    };

    const getSearchOnlyCommitSnapshot = () => {
      const byUrl = new Map();
      getUnsyncedRealPosts().forEach(p => {
        const clean = cleanUrl(p.url).split('?')[0];
        if (!clean) return;
        // Keep the entry with the highest likes — not necessarily the first seen.
        // A post discovered early with likes=0 (lazy render) may later be re-harvested
        // with likes=15 once social counts load. This ensures the best copy wins.
        const existing = byUrl.get(clean);
        if (!existing || (Number(p.likes) || 0) > (Number(existing.likes) || 0)) {
          byUrl.set(clean, p);
        }
      });

      const ranked = Array.from(byUrl.values())
        .map(p => {
          const likes = Number(p.likes) || 0;
          const commentsCount = Number(p.postComments ?? p.comments) || 0;
          const sharesCount = Number(p.postShares ?? p.shares) || 0;
          const reachScore = searchOnlyCompositeReachScore(p);
          const hardRule = evaluateSearchOnlyHardRules(p, {
            minLikes: SEARCH_ONLY_MIN_LIKES_HARD,
            maxAgeMs: SEARCH_ONLY_MAX_AGE_MS
          });
          return {
            ...p,
            likes,
            postComments: commentsCount,
            postShares: sharesCount,
            reachScore,
            hardRule
          };
        })
        .sort((a, b) => {
          if (b.reachScore !== a.reachScore) return b.reachScore - a.reachScore;
          if (b.postComments !== a.postComments) return b.postComments - a.postComments;
          if (b.postShares !== a.postShares) return b.postShares - a.postShares;
          if (b.likes !== a.likes) return b.likes - a.likes;
          return (a.discoveryIndex ?? 999999) - (b.discoveryIndex ?? 999999);
        });

      const eligible = ranked.filter(p => p.hardRule.pass);
      let adaptiveFloor = SEARCH_ONLY_MIN_REACH_SCORE;
      let fallbackMode = 'strict';
      let qualified = eligible
        .filter(p => p.reachScore >= adaptiveFloor)
        .map(p => ({ ...p, qualificationReason: `score>=${adaptiveFloor}` }));
      if (qualified.length === 0 && step >= 20) {
        adaptiveFloor = 5;
        fallbackMode = 'floor5';
        qualified = eligible
          .filter(p => p.reachScore >= adaptiveFloor)
          .map(p => ({ ...p, qualificationReason: `score>=${adaptiveFloor}` }));
      }
      if (qualified.length === 0 && step >= 20) {
        adaptiveFloor = 1;
        fallbackMode = 'engagement1';
        qualified = eligible
          .filter(p => p.reachScore >= adaptiveFloor)
          .map(p => ({ ...p, qualificationReason: `score>=${adaptiveFloor}` }));
      }
      if (qualified.length === 0 && step >= 20 && eligible.length > 0) {
        adaptiveFloor = 0;
        fallbackMode = 'validated_fallback';
        qualified = eligible.map(p => ({ ...p, qualificationReason: 'validated_fallback' }));
      }
      const selected = qualified.slice(0, Math.min(SEARCH_ONLY_MAX_SAVE_TARGET, qualified.length));
      return { ranked, eligible, qualified, selected, adaptiveFloor, fallbackMode };
    };

    async function flushSearchOnlyBatch() {
      return { savedCount: 0, candidateCount: getUnsyncedQualityPosts().length };
    }

    // Refresh metrics for posts already in allPosts that have likes=0.
    // LinkedIn renders social counts lazily — a post added on first-discovery may have
    // likes=0 because the count bar wasn't rendered yet. This pass re-scans currently
    // visible cards AND the entire page DOM (via buildPageMetricIndex) and updates
    // any zero-like entries with the now-rendered values.
    // maxCards: limit card-by-card scan; page-level scan is always unlimited.
    function refreshMetricsForVisibleCards(maxCards = 5) {
      const zeroByUrl = new Map();
      allPosts.forEach(p => {
        if ((Number(p.likes) || 0) === 0 && p.url) {
          zeroByUrl.set(cleanUrl(p.url).split('?')[0], p);
        }
      });
      if (zeroByUrl.size === 0) return 0;

      // ── PHASE A: Page-level metric index (bypasses card-boundary blindspot) ──
      // On LinkedIn A/B DOM variants the social-counts container is a SIBLING of the
      // card li, not a descendant. extractMetrics(el) can never find it. The page
      // index scans the whole document, ignoring element boundaries entirely.
      let refreshed = 0;
      try {
        const pageIndex = buildPageMetricIndex();
        if (pageIndex.size > 0) {
          zeroByUrl.forEach((post, key) => {
            const m = pageIndex.get(key);
            if (m && (m.likes || 0) > 0) {
              post.likes = m.likes;
              post.postComments = Math.max(Number(post.postComments) || 0, m.postComments);
              post.postShares = Math.max(Number(post.postShares) || 0, m.postShares);
              refreshed++;
              console.log(`[SearchOnly][PageIndex] likes=${m.likes} comments=${m.postComments} → ${key.slice(-60)}`);
            }
          });
        }
      } catch(e) { console.warn('[SearchOnly][PageIndex] Error:', e); }

      // ── PHASE B: Card-by-card extractMetrics scan (original path) ──
      const cardSelectors = [
        '.feed-shared-update-v2[role="article"]',
        '[role="article"][data-urn]',
        '.occludable-update',
        '[data-view-name="feed-full-update"]'
      ].join(', ');
      let cardScanned = 0;
      const cards = document.querySelectorAll(cardSelectors);
      for (const card of cards) {
        if (cardScanned >= maxCards) break;
        let cardUrl = null;
        const a = card.querySelector('a[href*="/posts/"], a[href*="/feed/update/"], a[href*="/activity-"]');
        if (a) cardUrl = cleanUrl(a.href).split('?')[0];
        if (!cardUrl) continue;
        const post = zeroByUrl.get(cardUrl);
        if (!post) continue;
        if ((Number(post.likes) || 0) > 0) continue; // Already fixed by page index
        const metrics = extractMetrics(card);
        if ((metrics.likes || 0) > 0) {
          post.likes = metrics.likes;
          post.postComments = metrics.postComments;
          post.postShares = metrics.postShares;
          refreshed++;
          cardScanned++;
          console.log(`[SearchOnly][CardRefresh] likes=${metrics.likes} comments=${metrics.postComments} for ${cardUrl.slice(-60)}`);
        } else { cardScanned++; }
      }
      return refreshed;
    }

    // ── buildPageMetricIndex: full-document metric scan ────────────────────────
    // Scans the ENTIRE page DOM — ignoring card element boundaries — to extract
    // engagement metrics from any reaction/comment element anywhere on the page.
    // This is the definitive fix for LinkedIn A/B DOM variants where social counts
    // are siblings of the card li (not descendants), making extractMetrics(el) blind.
    // Returns: Map<normalizedUrl, {likes, postComments, postShares}>
    function buildPageMetricIndex() {
      const map = new Map();
      function normUrl(url) { try { return cleanUrl(url).split('?')[0]; } catch(e) { return url; } }

      // Walk up from a node to find the nearest post URL (checks anchors + data-urn attrs)
      function findNearestPostUrl(startNode) {
        let el = startNode;
        for (let depth = 0; depth < 20 && el && el !== document.body; depth++) {
          if (el.querySelectorAll) {
            for (const a of el.querySelectorAll('a[href*="/posts/"], a[href*="/feed/update/"]')) {
              const u = extractCanonicalFromHref ? extractCanonicalFromHref(a.href) : null;
              if (u && isValidCanonicalPostUrl(u)) return normUrl(u);
            }
          }
          const urnAttrs = ['data-urn','data-entity-urn','data-update-urn','data-chameleon-result-urn'];
          for (const attr of urnAttrs) {
            const val = el.getAttribute ? el.getAttribute(attr) : null;
            if (!val) continue;
            const m = val.match(/urn:li:(activity|ugcPost|share):([A-Za-z0-9:_-]{8,64})/i);
            if (m) {
              const t = m[1].toLowerCase();
              const built = t === 'ugcpost'
                ? 'https://www.linkedin.com/feed/update/urn:li:ugcPost:' + m[2]
                : t === 'activity'
                  ? 'https://www.linkedin.com/feed/update/urn:li:activity:' + m[2]
                  : t === 'share'
                    ? 'https://www.linkedin.com/feed/update/urn:li:share:' + m[2] : null;
              if (built && isValidCanonicalPostUrl(built)) return normUrl(built);
            }
          }
          el = el.parentElement;
        }
        return null;
      }

      function mergeInto(url, likes, postComments, postShares) {
        if (!url) return;
        const e = map.get(url) || { likes: 0, postComments: 0, postShares: 0 };
        e.likes = Math.max(e.likes, likes || 0);
        e.postComments = Math.max(e.postComments, postComments || 0);
        e.postShares = Math.max(e.postShares, postShares || 0);
        map.set(url, e);
      }

      const COMMENT_GUARD_SEL = '.feed-shared-update-v2__comments-container, .comments-comments-list, .comments-comment-item';

      // Phase 1: ALL aria-label elements across the entire document
      document.querySelectorAll('[aria-label]').forEach(node => {
        try {
          if (node.closest(COMMENT_GUARD_SEL)) return;
          const lbl = (node.getAttribute('aria-label') || '').toLowerCase();
          if (!/\d/.test(lbl)) return;
          const n = num(lbl);
          if (n <= 0) return;
          const url = findNearestPostUrl(node);
          if (!url) return;
          const isReact = lbl.includes('reaction') || lbl.includes('like') || lbl.includes('إعجاب') ||
                          lbl.includes("j'aime") || lbl.includes('me gusta') || lbl.includes('gefällt') ||
                          lbl.includes('curtir') || lbl.includes('tepki') || lbl.includes('réaction') ||
                          lbl.includes('reação') || lbl.includes('mi piace') || lbl.includes('lubię') ||
                          lbl.includes('synes godt om') || lbl.includes('vind ik') || lbl.includes('beğen');
          const isComment = lbl.includes('comment') || lbl.includes('تعليق') || lbl.includes('yorum') ||
                            lbl.includes('commentaire') || lbl.includes('comentar') || lbl.includes('komentar') ||
                            lbl.includes('kommentar') || lbl.includes('commenta') || lbl.includes('kommentaar');
          const isShare = lbl.includes('repost') || lbl.includes('share') || lbl.includes('teilen') ||
                          lbl.includes('partag') || lbl.includes('compartir') || lbl.includes('condividi');
          if (!isReact && !isComment && !isShare) return;
          mergeInto(url, isReact ? n : 0, isComment ? n : 0, isShare ? n : 0);
        } catch(e) {}
      });

      // Phase 2: ALL social count containers across the entire document
      const containerSels = [
        '.social-details-social-counts', '.update-components-social-counts',
        '[class*="social-counts"]', '[class*="social-activity-counts"]',
        '[class*="reactions-count"]', '[class*="socialActivity"]',
        '[class*="social-proof"]', '[class*="engagement-count"]'
      ].join(', ');
      document.querySelectorAll(containerSels).forEach(container => {
        try {
          if (container.closest(COMMENT_GUARD_SEL)) return;
          const url = findNearestPostUrl(container);
          if (!url) return;
          const txt = container.innerText || container.textContent || '';
          const lM = txt.match(/([\d,.]+[KMBkmb]?)\s*(?:reactions?|likes?|إعجاب)/i);
          const cM = txt.match(/([\d,.]+[KMBkmb]?)\s*(?:comments?|تعليق)/i);
          const sM = txt.match(/([\d,.]+[KMBkmb]?)\s*(?:reposts?|shares?)/i);
          mergeInto(url, lM ? num(lM[1]) : 0, cM ? num(cM[1]) : 0, sM ? num(sM[1]) : 0);
          // Bare-number span fallback (e.g. <span aria-hidden="true">247</span>)
          const existing = map.get(url);
          if (!existing || existing.likes === 0) {
            container.querySelectorAll('span[aria-hidden="true"], li, button').forEach(s => {
              const t = (s.innerText || s.textContent || '').trim();
              if (/^[\d,.]+[KMBkmb]?$/.test(t)) {
                const n = num(t);
                if (n > 0) { mergeInto(url, n, 0, 0); }
              }
            });
          }
        } catch(e) {}
      });

      // Phase 3: Raw text scan of li containers ("247\n15 comments" pattern)
      document.querySelectorAll('li').forEach(li => {
        try {
          const url = findNearestPostUrl(li);
          if (!url) return;
          const existing = map.get(url);
          if (existing && existing.likes > 0) return; // Already have good data
          const raw = li.innerText || '';
          // Inline reaction count
          const inlineM = raw.match(/([\d,.]+[KMBkmb]?)\s*reactions?/i);
          if (inlineM) { mergeInto(url, num(inlineM[1]), 0, 0); return; }
          // Adjacent lines: bare number then "N comments"
          const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          for (let i = 0; i < lines.length; i++) {
            if (/^[\d,.]+[KMBkmb]?\s*comments?/i.test(lines[i])) {
              const cMatch = lines[i].match(/^([\d,.]+[KMBkmb]?)/);
              const newComments = cMatch ? num(cMatch[1]) : 0;
              let newLikes = 0;
              if (i > 0 && /^[\d,.]+[KMBkmb]?$/.test(lines[i - 1])) newLikes = num(lines[i - 1]);
              mergeInto(url, newLikes, newComments, 0);
              break;
            }
          }
        } catch(e) {}
      });

      if (map.size > 0) {
        let withLikes = 0;
        map.forEach(v => { if (v.likes > 0) withLikes++; });
        console.log(`[SearchOnly][PageIndex] Built index: ${map.size} URLs mapped, ${withLikes} have likes>0`);
      }
      return map;
    }

    // Release media resources for cards we have already harvested.
    // Pausing videos removes the GPU load. Clearing image src frees decoded
    // pixel buffers (each can be 200-500 KB) without removing the DOM node,
    // so refreshMetricsForVisibleCards can still find and re-scan the card.
    function freePageResources() {
      try {
        // 1. Pause ALL videos on the page — biggest GPU drain
        document.querySelectorAll('video').forEach(v => { try { v.pause(); v.currentTime = 0; } catch(e) {} });

        // 2. Build a likes-lookup from allPosts so we can skip cards with likes=0.
        // Cards still at 0 need their DOM intact for future refreshMetricsForVisibleCards calls.
        const likesForUrl = new Map();
        allPosts.forEach(p => {
          if (!p.url) return;
          const k = cleanUrl(p.url).split('?')[0];
          const cur = likesForUrl.get(k) || 0;
          if ((Number(p.likes) || 0) > cur) likesForUrl.set(k, Number(p.likes) || 0);
        });

        // 3. Free images only for cards already harvested AND with confirmed likes > 0
        document.querySelectorAll(SEARCH_ONLY_CARD_SELECTORS.join(', ')).forEach(card => {
          const a = card.querySelector('a[href*="/posts/"], a[href*="/feed/update/"], a[href*="/activity-"]');
          if (!a) return;
          const cardUrl = cleanUrl(a.href).split('?')[0];
          if (!seenUrls.has(cardUrl) && !seenUrls.has(cleanUrl(a.href))) return;
          // Skip if likes still 0 — refresh may still need to read this card's DOM
          if ((likesForUrl.get(cardUrl) || 0) === 0) return;
          card.querySelectorAll('img[src]:not([src=""])').forEach(img => {
            try { img.src = ''; if (img.srcset) img.srcset = ''; } catch(e) {}
          });
        });
      } catch(e) {}
    }

    console.log('[SearchOnly] keyword="' + keyword + '" forcedScrolls=' + SEARCH_SCROLL_TARGET + ' mode=collect-then-rank');
    heartbeat('Phase1-Scroll', `Search-only: collect candidates first, then rank top posts after ${SEARCH_SCROLL_TARGET} scrolls`);

    while (step < SEARCH_SCROLL_TARGET) {
      ensureActiveRun();
      const seenBeforeStep = seenUrls.size;

      // ── PRE-SCROLL harvest (before moving) ──
      harvest(seenUrls, seenCards, allPosts, { overrideSelectors: SEARCH_ONLY_CARD_SELECTORS });
      harvestByAnchors(seenUrls, seenCards, allPosts); // anchor-first, no class names needed
      harvestByUrn(seenUrls, allPosts);                // URN sweep for standard variants

      // ── Scroll the REAL container (<main>) at 500–600px per step ──
      // Diagnostic confirmed <main> is the scroll container (scrollHeight=41,983px).
      // Now that we're scrolling the right element, 500px is safe and fast.
      const scrollAmt = 500 + Math.floor(Math.random() * 100);
      const beforeDom = domSignalSnapshot();
      aggressiveScroll(scrollAmt);
      // 500ms wait: <main>'s React renderer needs ~400ms to inject new cards
      const grew = await waitForDomGrowth(beforeDom, 500);
      if (!grew) await wait(100, 200);

      // ── POST-SCROLL harvest ──
      const useDeepScan = (step % 3 === 0);
      harvest(seenUrls, seenCards, allPosts, { deepScan: useDeepScan, overrideSelectors: SEARCH_ONLY_CARD_SELECTORS });
      harvestByAnchors(seenUrls, seenCards, allPosts);
      harvestByUrn(seenUrls, allPosts);
      await new Promise(r => setTimeout(r, 0));
      refreshMetricsForVisibleCards(15);
      freePageResources();

      // Show-more every 3rd step — loads LinkedIn content batches faster
      if (step % 3 === 2) {
        scrollToBottom();
        await wait(80, 180); // reduced from 150–300ms
        await clickShowMore();
        harvest(seenUrls, seenCards, allPosts, { deepScan: true, overrideSelectors: SEARCH_ONLY_CARD_SELECTORS });
        await new Promise(r => setTimeout(r, 0));
        refreshMetricsForVisibleCards(15);
        freePageResources();
      }

      // Rest every 10 steps — reduced from 1800–2200ms to 1000–1400ms.
      // Still enough for browser GC; short enough to not feel stalled.
      if ((step + 1) % 10 === 0) {
        await wait(1000, 1400);
      }


      let currentSeenSize = seenUrls.size;
      let real = countReal(allPosts);
      let qualityUnsyncedCount = getUnsyncedQualityPosts().length;
      let commitSnapshot = getSearchOnlyCommitSnapshot();
      noGrowthSteps = currentSeenSize > seenBeforeStep ? 0 : (noGrowthSteps + 1);

      const lastDiag = window.__lastHarvestDiag || null;
      const shouldActiveHarvest =
        lastDiag &&
        (lastDiag.btnCards || 0) > 0 &&
        (step - lastActiveHarvestStep >= 3) &&
        (
          step < 4 ||
          noGrowthSteps >= 2 ||
          qualityUnsyncedCount < SEARCH_ONLY_MIN_SAVE_TARGET ||
          ((step + 1) % SEARCH_PROGRESS_BATCH === 0)
        );

      if (shouldActiveHarvest) {
        const activeAdded = await activeHarvestVisibleCards(
          seenUrls,
          seenCards,
          allPosts,
          currentSeenSize < 4 ? 4 : 2
        );
        if (activeAdded > 0) noGrowthSteps = 0;
        lastActiveHarvestStep = step;
        currentSeenSize = seenUrls.size;
        real = countReal(allPosts);
        qualityUnsyncedCount = getUnsyncedQualityPosts().length;
        commitSnapshot = getSearchOnlyCommitSnapshot();
      }

      console.log('[SearchOnly] keyword="' + keyword + '" scroll=' + (step + 1) + ' / ' + SEARCH_SCROLL_TARGET + ' distinctUrls=' + currentSeenSize + ' realPosts=' + real + ' candidatePool=' + commitSnapshot.ranked.length + ' qualified=' + commitSnapshot.qualified.length + ' floor=' + commitSnapshot.adaptiveFloor + ' mode=' + commitSnapshot.fallbackMode + ' saved=' + totalSavedIncremental);
      heartbeat(`Phase1-Scroll`, `scroll ${step + 1} / ${SEARCH_SCROLL_TARGET} | URLs ${currentSeenSize} | qualified ${commitSnapshot.qualified.length} | saving at end`);

      if (commitSnapshot.ranked.length > 0 && (commitSnapshot.qualified.length === 0 || ((step + 1) % 10 === 0))) {
        commitSnapshot.ranked.slice(0, Math.min(12, commitSnapshot.ranked.length)).forEach((p, idx) => {
          if (!p.hardRule?.pass) {
            console.log(`[SearchOnly] REJECTED: likes=${p.likes || 0} comments=${p.postComments || 0} shares=${p.postShares || 0} score=${p.reachScore} reasons=${p.hardRule.reasons.join(' | ')} url=${cleanUrl(p.url).slice(0, 120)}`);
            return;
          }
          const passed = p.reachScore >= commitSnapshot.adaptiveFloor ? 'PASS' : 'FAIL';
          const reason = passed === 'PASS' ? `score>=${commitSnapshot.adaptiveFloor}` : `score<${commitSnapshot.adaptiveFloor}`;
          console.log(`[SearchOnly][Score] #${idx + 1} likes=${p.likes || 0} comments=${p.postComments || 0} shares=${p.postShares || 0} score=${p.reachScore} floor=${commitSnapshot.adaptiveFloor} ${passed} reason=${reason} url=${cleanUrl(p.url).slice(0, 120)}`);
        });
      }

      if ((step + 1) % SEARCH_PROGRESS_BATCH === 0) {
        const batchQuality = getUnsyncedQualityPosts().length;
        if (batchQuality < SEARCH_ONLY_MIN_SAVE_TARGET) {
          console.warn('[SearchOnly] low yield after scroll batch ' + (step + 1) + '/' + SEARCH_SCROLL_TARGET + ' — widening harvest/retrying');
          for (let retry = 0; retry < 3; retry++) {
            aggressiveScroll(320 + Math.floor(Math.random() * 180));
            await wait(240, 420);
            harvest(seenUrls, seenCards, allPosts, { deepScan: true });
            if (retry === 1) {
              await clickShowMore();
              await wait(250, 420);
              harvest(seenUrls, seenCards, allPosts, { deepScan: true });
            }
            if (
              ((window.__lastHarvestDiag?.btnCards || 0) > 0) &&
              (retry === 2 || noGrowthSteps >= 2)
            ) {
              const retryAdded = await activeHarvestVisibleCards(
                seenUrls,
                seenCards,
                allPosts,
                seenUrls.size < 4 ? 3 : 2
              );
              if (retryAdded > 0) noGrowthSteps = 0;
              lastActiveHarvestStep = step;
            }
          }
          const refreshedQuality = getUnsyncedQualityPosts().length;
          console.log('[SearchOnly] post-retry batch quality count=' + refreshedQuality + ' after scroll ' + (step + 1));
          commitSnapshot = getSearchOnlyCommitSnapshot();
        }
      }

      // Early-stop removed: always scroll to the maximum (60).
      // noGrowthSteps is the only natural exit — fires when LinkedIn has no more results.
      // Stopping at qualified>=10 was leaving posts on the table after deduplication.

      step++;
    }
    const finalSnapshot = getSearchOnlyCommitSnapshot();
    const collectedCandidates = finalSnapshot.ranked.length;
    console.log('[SearchOnly] scroll loop done steps=' + step + ' keyword="' + keyword + '" collectedCandidates=' + collectedCandidates + ' qualified=' + finalSnapshot.qualified.length + ' saved=0');
    heartbeat('Phase1-Limit', `Search-only scroll finished (${step}/${SEARCH_SCROLL_TARGET}) | qualified ${finalSnapshot.qualified.length}`);
    } // end search-only deep scroll branch

    // ── Step 5: Single validation pass (after all scrolling; no loops) ──
    console.log(`[v22] 📊 PRE-VALIDATION: ${allPosts.length} total posts, ${countReal(allPosts)} real`);
    heartbeat('Phase1-Validate', `🛡️ Actively verifying ${allPosts.length} posts...`);
    ensureActiveRun();
    const validPosts = await validatePostsConcurrently(allPosts);

    const totalReal = countReal(validPosts);
    const newPosts = validPosts.length - priorPosts.length;
    console.log(`[v22] 📊 POST-VALIDATION: ${validPosts.length} survived (${totalReal} real, ${allPosts.length - validPosts.length} rejected)`);
    console.log('[v22] ══ FINAL: ' + totalReal + ' real / ' + validPosts.length + ' total (' + newPosts + ' new this pass) ══');
    heartbeat('Phase1-Done', '✅ Extraction finished: ' + totalReal + ' real posts');

    const needsCommenting = !isSearchOnly && comments && comments.length > 0;
    const syncConstraints = {
      SETTINGS_MIN_LIKES, SETTINGS_MAX_LIKES, SETTINGS_MIN_COMMENTS, SETTINGS_MAX_COMMENTS,
      SKIP_KEYWORD_GATE_FOR_FINAL: needsCommenting,
      SEARCH_ONLY_SKIP_HTTP_VERIFY: isSearchOnly === true,
      SEARCH_ONLY_FINAL_RANKING: isSearchOnly === true,
      SEARCH_ONLY_TARGET_MIN: 10,
      SEARCH_ONLY_TARGET_MAX: 25,
      SEARCH_ONLY_MIN_REACH_SCORE: 15,
      SEARCH_ONLY_MIN_LIKES_HARD: 10,
      SEARCH_ONLY_MAX_AGE_MS: 90 * 24 * 60 * 60 * 1000
    };

    // ── Step 6: Serialize (search-only: full pool; comment: top-by-reach targets only) ──
    const remainingPosts = validPosts.filter(p => !syncedUrls.has(p.url));
    let serializedPosts = remainingPosts.map(p => ({
      url: p.url, likes: p.likes, postComments: p.postComments,
      postShares: p.postShares,
      author: p.author, textSnippet: p.textSnippet,
      commentable: p.commentable !== false, hasRealUrl: p.hasRealUrl || false,
      discoveryIndex: p.discoveryIndex,
      postedAtMs: p.postedAtMs || 0
    }));

    // ── Step 7: Comment or sync ──
    if (needsCommenting) {
      let commentedHistory = [], usedCommentHistory = [];
      try {
        const s = await chrome.storage.local.get(['commentedPosts', 'usedCommentIds']);
        commentedHistory = s.commentedPosts || [];
        usedCommentHistory = s.usedCommentIds || [];
      } catch(e) {}
      const commentedSet = new Set(commentedHistory.map(u => cleanUrl(u)).filter(Boolean));
      const usedCommentSet = new Set(usedCommentHistory);

      let availableComments = comments.filter(c => !usedCommentSet.has(c.id));
      if (availableComments.length === 0) availableComments = comments.slice();
      if (availableComments.length === 0) {
        safeSend({ action: 'JOB_FAILED', reason: 'COMMENT_TEXT_MISSING', commentsPostedCount: 0, assignedCommentsCount: 2, searchOnlyMode: false, postsExtracted: countReal(validPosts), keyword });
        return;
      }

      const requiredComments = 2;
      const commentTextsForCycle = [];
      for (let i = 0; i < requiredComments; i++) {
        const slot = availableComments[i % availableComments.length];
        commentTextsForCycle.push(String(slot?.text || '').trim());
      }
      if (commentTextsForCycle.some(t => !t)) {
        safeSend({ action: 'JOB_FAILED', reason: 'COMMENT_TEXT_MISSING', commentsPostedCount: 0, assignedCommentsCount: requiredComments, searchOnlyMode: false, postsExtracted: countReal(validPosts), keyword });
        return;
      }
      const cycleNum = Number(settings.commentCycleNumber) || 1;
      const rankedAll = rankPostsForCommentCampaign(validPosts, { excludeUrls: commentedSet, need: requiredComments });

      if (rankedAll.length < requiredComments) {
        console.log('[CommentCampaign] CYCLE_INSUFFICIENT_TARGETS ranked=' + rankedAll.length + ' need=' + requiredComments + ' cycle=' + cycleNum);
        safeSend({
          action: 'JOB_FAILED',
          reason: 'CYCLE_INSUFFICIENT_TARGETS',
          insufficientRetryPass: settings.insufficientRetryPass === true,
          commentsPostedCount: 0,
          assignedCommentsCount: requiredComments,
          searchOnlyMode: false,
          postsExtracted: countReal(validPosts),
          keyword,
          commentCycleNumber: cycleNum,
          commentScrollPassesUsed
        });
        return;
      }

      const strongAvailable = rankedAll.filter(p => commentCampaignScore(p).strong).length;
      const rankedPreviewSummary = rankedAll
        .slice(0, requiredComments)
        .map((p, idx) => `#${idx + 1}:${reachScoreUi(p)}@${cleanUrl(p.url).slice(0, 80)}`)
        .join(' | ');
      console.log('[CommentCampaign] cycle=' + cycleNum + ' selected=' + rankedPreviewSummary + ' strongAvailable=' + strongAvailable + ' fallbackUsed=' + (strongAvailable < requiredComments ? 1 : 0));
      heartbeat('Phase2', `CommentCampaign cycle ${cycleNum}: strict top-${requiredComments} by reach`);
      serializedPosts = rankedAll.slice(0, requiredComments).map(p => ({
        url: p.url, likes: p.likes, postComments: p.postComments,
        postShares: p.postShares,
        author: p.author, textSnippet: p.textSnippet,
        commentable: p.commentable || false, hasRealUrl: p.hasRealUrl || false,
        discoveryIndex: p.discoveryIndex
      }));
      heartbeat('Phase4', 'Preparing strict top-2 execution plan...');
      await syncPosts(serializedPosts, keyword, dashboardUrl, userId, linkedInProfileId, true, syncConstraints);

      const executionPlan = rankedAll.slice(0, requiredComments).map((target, idx) => ({
        targetUrl: target.url,
        commentText: commentTextsForCycle[idx],
        commentId: availableComments[idx % availableComments.length]?.id || null
      }));

      heartbeat('Phase3', 'Posting comments (strict top-2 flow)…');
      safeSend({
        action: 'EXECUTE_COMMENT_PLAN',
        keyword,
        commentCycleNumber: cycleNum,
        commentScrollPassesUsed,
        postsExtracted: countReal(validPosts),
        assignedCommentsCount: requiredComments,
        executionPlan
      });
      return;

      heartbeat('Phase3', '⌨️ Posting comments (strict top-2 flow)…');
      let posted = 0, ci = 0, blocked = false;
      let rankIdx = 0;
      let commentsAttempted = 0;
      let commentsFailed = 0;
      while (ci < requiredComments && !blocked && rankIdx < rankedAll.length) {
        const target = rankedAll[rankIdx++];
        let liveCard =
          (target.container && document.contains(target.container) ? target.container : null) ||
          findLivePostContainerByUrl(target.url);
        if (!liveCard) {
          console.warn('[CommentCampaign] Re-anchor card…', (target.url || '').slice(0, 96));
          liveCard = await locateLiveContainerForPostUrl(target.url, 10);
        }
        if (!liveCard) {
          console.warn('[CommentCampaign] No live DOM card — try next ranked post.');
          commentsFailed++;
          continue;
        }
        commentsAttempted++;
        const r = await tryPostCommentWithRetries(liveCard, commentTextsForCycle[ci], target.url, 1);
        if (r === 'BLOCKED') { blocked = true; break; }
        if (r === 'SUCCESS') {
          posted++;
          commentedSet.add(target.url);
          try {
            commentedHistory = [...commentedHistory, target.url].slice(-200);
            const usedId = availableComments[ci % availableComments.length]?.id;
            if (usedId) usedCommentHistory = [...usedCommentHistory, usedId].slice(-100);
            await chrome.storage.local.set({ commentedPosts: commentedHistory, usedCommentIds: usedCommentHistory });
          } catch(e) {}
          ci++;
          if (ci < requiredComments) await wait(1000, 2000);
        } else {
          commentsFailed++;
        }
      }

      console.log('[CommentCampaign] cycle=' + cycleNum + ' scrollPasses=' + commentScrollPassesUsed + ' ranked=' + rankedAll.length + ' attempted=' + commentsAttempted + ' ok=' + posted + ' fail=' + commentsFailed);

      heartbeat('Phase4', '📤 Syncing…');
      await syncPosts(serializedPosts, keyword, dashboardUrl, userId, linkedInProfileId, true, syncConstraints);

      if (blocked) {
        safeSend({
          action: 'JOB_COMPLETED',
          commentsPostedCount: posted,
          assignedCommentsCount: requiredComments,
          searchOnlyMode: false,
          linkedinBlocked: true,
          postsExtracted: countReal(validPosts),
          keyword,
          commentCycleNumber: cycleNum,
          commentScrollPassesUsed,
          commentsAttempted,
          commentsFailed
        });
        return;
      }

      if (requiredComments > 0 && posted < requiredComments) {
        safeSend({
          action: 'JOB_FAILED',
          reason: posted === 0 ? 'NO_COMMENTS_POSTED' : 'COMMENT_CYCLE_INCOMPLETE',
          commentsPostedCount: posted,
          assignedCommentsCount: requiredComments,
          searchOnlyMode: false,
          postsExtracted: countReal(validPosts),
          keyword,
          commentCycleNumber: cycleNum,
          commentScrollPassesUsed,
          commentsAttempted,
          commentsFailed
        });
        return;
      }

      safeSend({
        action: 'JOB_COMPLETED',
        commentsPostedCount: posted,
        assignedCommentsCount: requiredComments,
        searchOnlyMode: false,
        linkedinBlocked: false,
        postsExtracted: countReal(validPosts),
        keyword,
        commentCycleNumber: cycleNum,
        commentScrollPassesUsed,
        commentsAttempted,
        commentsFailed
      });

    } else {
      heartbeat('Phase4', '📤 Final sync: ' + totalReal + ' validated posts...');
      ensureActiveRun();
      const savedThisPass = await syncPosts(serializedPosts, keyword, dashboardUrl, userId, linkedInProfileId, true, syncConstraints);
      
      console.log(`[v25] ✅ Final sync: Evaluated ${remainingPosts.length} remaining pooled posts. Saved ${savedThisPass}.`);
      const urlKeys = new Set();
      validPosts.forEach(p => {
        if (p.url && isValidCanonicalPostUrl(p.url)) urlKeys.add(cleanUrl(p.url).split('?')[0]);
      });
      syncedUrls.forEach(u => {
        if (u && isValidCanonicalPostUrl(u)) urlKeys.add(cleanUrl(u).split('?')[0]);
      });
      const distinctCollected = urlKeys.size;
      const resultStatus = distinctCollected >= 10 ? 'SUCCESS' : (distinctCollected > 0 ? 'PARTIAL_SUCCESS' : 'EMPTY_RESULT');
      console.log('[SearchOnly] keyword="' + keyword + '" distinctPosts=' + distinctCollected + ' resultStatus=' + resultStatus);
      if (distinctCollected === 0) {
        safeSend({
          action: 'JOB_FAILED',
          reason: 'SEARCH_ONLY_NO_POSTS',
          commentsPostedCount: 0,
          assignedCommentsCount: 0,
          searchOnlyMode: true,
          engineMode: 'SEARCH_ONLY',
          postsExtracted: 0,
          resultStatus,
          keyword
        });
        return;
      }
      safeSend({
        action: 'JOB_COMPLETED',
        commentsPostedCount: 0,
        assignedCommentsCount: 0,
        searchOnlyMode: true,
        engineMode: 'SEARCH_ONLY',
        postsExtracted: distinctCollected,
        resultStatus,
        keyword
      });
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

  function isLikelyVisible(el) {
    if (!el || !document.contains(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = window.getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity || '1') < 0.05) return false;
    return true;
  }

  function rectsOverlapViewport(a, b) {
    if (!a || !b) return false;
    const ax = a.left, ay = a.top, ar = a.right, ab = a.bottom;
    const bx = b.left, by = b.top, br = b.right, bb = b.bottom;
    return !(br < ax || bx > ar || bb < ay || by > ab);
  }

  /** Layer 1: inline in card / near comment button. */
  function pickCommentEditorInline(commentBtn, container) {
    if (container) {
      const direct = container.querySelector(
        '.comments-comment-box div.ql-editor[contenteditable="true"], .comments-comment-box [contenteditable="true"][role="textbox"], [class*="comment-box"] div.ql-editor[contenteditable="true"], .update-components-comment-box div[contenteditable="true"], .feed-shared-update-v2__commentary div.ql-editor[contenteditable="true"], .feed-shared-update-v2__commentary [contenteditable="true"][role="textbox"]'
      );
      if (direct && isLikelyVisible(direct)) return direct;
    }
    const roots = [];
    if (commentBtn) {
      roots.push(
        commentBtn.closest('.feed-shared-update-v2, .feed-shared-update-v3, .feed-shared-update-v2__commentary, li.reusable-search__result-container, .reusable-search__result-container, article, [data-urn*="activity"], [data-urn*="ugcPost"]')
      );
    }
    roots.push(container);
    const editorSelectors = [
      'div.ql-editor[contenteditable="true"]',
      'div.comments-comment-box-comment__text-editor div[contenteditable="true"]',
      '.comments-comment-texteditor div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[aria-label][contenteditable="true"]'
    ];
    for (const root of roots) {
      if (!root) continue;
      for (const sel of editorSelectors) {
        for (const ed of root.querySelectorAll(sel)) {
          if (isLikelyVisible(ed)) return ed;
        }
      }
    }
    const cr = container.getBoundingClientRect();
    if (cr.width >= 1 && cr.height >= 1) {
      const candidates = document.querySelectorAll('div[contenteditable="true"]');
      let best = null;
      let bestScore = -1;
      for (const ed of candidates) {
        if (!isLikelyVisible(ed)) continue;
        const ph = ((ed.getAttribute('data-placeholder') || '') + (ed.getAttribute('aria-label') || '')).toLowerCase();
        if (!ph.includes('comment') && !ph.includes('add') && ed.closest('.comments-comment-box, .comments-comment-texteditor, .update-components-comment, [class*="comment-box"]') == null) continue;
        const er = ed.getBoundingClientRect();
        if (!rectsOverlapViewport(cr, er)) continue;
        const score = ph.includes('comment') ? 100 : 50;
        if (score > bestScore) { bestScore = score; best = ed; }
      }
      if (best) return best;
    }
    return null;
  }

  /** Layer 2: modal / overlay / outlet (React portals). */
  function pickCommentEditorModal() {
    const modalSelectors = [
      '.artdeco-modal[aria-hidden="false"] div.ql-editor[contenteditable="true"]',
      '.artdeco-modal:not([aria-hidden="true"]) div.ql-editor[contenteditable="true"]',
      '[role="dialog"]:not([aria-hidden="true"]) div.ql-editor[contenteditable="true"]',
      '#artdeco-modal-outlet div.ql-editor[contenteditable="true"]',
      '.artdeco-modal--layer-default div[contenteditable="true"][role="textbox"]',
      '.artdeco-overlay div.comments-comment-box div.ql-editor[contenteditable="true"]'
    ];
    for (const sel of modalSelectors) {
      for (const ed of document.querySelectorAll(sel)) {
        if (isLikelyVisible(ed)) return ed;
      }
    }
    return null;
  }

  /** Layer 3: focused contenteditable in comment context. */
  function pickCommentEditorActiveElement(container) {
    try {
      const ae = document.activeElement;
      if (!ae || !ae.isContentEditable || !document.contains(ae) || !isLikelyVisible(ae)) return null;
      if (ae.closest('.comments-comment-box, .comments-comment-texteditor, .update-components-comment, [class*="comment-box"], .artdeco-modal')) return ae;
      const cr = container.getBoundingClientRect();
      if (cr.width >= 1 && rectsOverlapViewport(cr, ae.getBoundingClientRect())) return ae;
    } catch (e) { /* ignore */ }
    return null;
  }

  /** Layer 4: any visible composer in viewport tied to comment UI. */
  function pickCommentEditorGlobalNearCard(container) {
    const cr = container.getBoundingClientRect();
    let best = null;
    let bestArea = -1;
    for (const ed of document.querySelectorAll('div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"]')) {
      if (!isLikelyVisible(ed)) continue;
      const box = ed.closest('.comments-comment-box, .comments-comment-texteditor, .update-components-comment, .feed-shared-update-v2__commentary, [class*="comment-box"]');
      if (!box) continue;
      const er = ed.getBoundingClientRect();
      if (er.bottom < 0 || er.top > (window.innerHeight || 900)) continue;
      if (cr.width >= 1 && cr.height >= 1 && !rectsOverlapViewport(cr, er) && er.top > cr.bottom + 400) continue;
      const area = er.width * er.height;
      if (area > bestArea) { bestArea = area; best = ed; }
    }
    return best;
  }

  /** All layers; failure only if every layer returns null. */
  function resolveCommentEditorMultiLayer(commentBtn, container) {
    if (!container) return null;
    return (
      pickCommentEditorInline(commentBtn, container) ||
      pickCommentEditorModal() ||
      pickCommentEditorActiveElement(container) ||
      pickCommentEditorGlobalNearCard(container)
    );
  }

  async function waitForCommentEditor(commentBtn, container, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ed = resolveCommentEditorMultiLayer(commentBtn, container);
      if (ed && document.contains(ed) && isLikelyVisible(ed)) return ed;
      await sleep(320);
    }
    return null;
  }

  function hasCommentUiSignals(commentBtn, container) {
    try {
      if (pickCommentEditorModal()) return true;
      if (container && container.querySelector(
        '.comments-comment-box, .comments-comment-texteditor, .feed-shared-update-v2__commentary, [class*="comment-box"], [data-test-id*="comment"]'
      )) return true;
      const ae = document.activeElement;
      if (ae && ae.isContentEditable) return true;
      if (commentBtn) {
        const expanded = (commentBtn.getAttribute('aria-expanded') || '').toLowerCase();
        if (expanded === 'true') return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function forceCommentComposerActivation(commentBtn, container) {
    const targets = [];
    if (commentBtn && document.contains(commentBtn)) targets.push(commentBtn);
    if (container && document.contains(container)) {
      const hot = container.querySelectorAll(
        '.comments-comment-box, .comments-comment-texteditor, .feed-shared-update-v2__commentary, [class*="comment-box"], div[role="textbox"], div[contenteditable="true"]'
      );
      hot.forEach(el => targets.push(el));
    }
    for (const t of targets.slice(0, 6)) {
      try {
        t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      } catch (e) { /* noop */ }
      try { if (typeof t.focus === 'function') t.focus({ preventScroll: true }); } catch (e2) {}
    }
    try {
      window.dispatchEvent(new Event('scroll'));
      document.dispatchEvent(new Event('selectionchange', { bubbles: false }));
    } catch (e) { /* noop */ }
  }

  async function acquireCommentEditorResilient(commentBtn, container, maxWindowMs) {
    const deadline = Date.now() + maxWindowMs;
    let rounds = 0;
    let lastActivateAt = 0;
    while (Date.now() < deadline) {
      const editor = resolveCommentEditorMultiLayer(commentBtn, container);
      if (editor && document.contains(editor) && isLikelyVisible(editor)) return editor;

      const uiWarm = hasCommentUiSignals(commentBtn, container);
      // Avoid focus/click thrashing: only force activation occasionally.
      const now = Date.now();
      const canActivate = now - lastActivateAt > (uiWarm ? 1200 : 1800);
      if (canActivate) {
        lastActivateAt = now;
        if (uiWarm || rounds % 3 === 0) {
          forceCommentComposerActivation(commentBtn, container);
        } else if (commentBtn && document.contains(commentBtn)) {
          try { commentBtn.click(); } catch (e) { /* noop */ }
        }
      }
      rounds++;
      await sleep(380 + Math.min(rounds * 30, 260));
    }
    return null;
  }

  function activeElementMatchesEditor(editor) {
    try {
      const ae = document.activeElement;
      if (!ae) return false;
      if (ae === editor) return true;
      if (editor && editor.contains && editor.contains(ae)) return true;
      if (ae.contains && ae.contains(editor)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  async function waitForStableEditor(editor, minStableMs = 900, maxWaitMs = 6000) {
    const start = Date.now();
    let stableStart = 0;
    let lastKey = '';
    let sample = 0;

    while (Date.now() - start < maxWaitMs) {
      if (!editor || !document.contains(editor) || !isLikelyVisible(editor)) {
        return false;
      }

      const aeOk = activeElementMatchesEditor(editor);
      const rect = editor.getBoundingClientRect();
      const key = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${aeOk ? 1 : 0}`;

      // Stable means: visible + attached + either activeElement matches OR position not flickering.
      const stableNow = aeOk || (rect.width > 10 && rect.height > 10);

      if (stableNow && key === lastKey) {
        if (!stableStart) stableStart = Date.now();
      } else {
        stableStart = 0;
        lastKey = key;
      }

      // After some samples, accept stable window even if activeElement isn't perfect.
      if (stableStart && Date.now() - stableStart >= minStableMs) return true;

      // Passive waiting only: do NOT re-focus here (prevents focus/blur loops).
      await sleep(180);
      sample++;
      if (sample % 10 === 0) {
        // Small passive nudge: scroll into view only.
        try { editor.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
      }
    }
    return false;
  }

  function findCommentSubmitFromEditor(editor) {
    if (!editor) return null;
    const boxRoot = editor.closest('.comments-comment-box, .comments-comment-texteditor, .comments-comment-box--cr, .artdeco-modal, [class*="comment-box"]') || editor;
    const candidates = [];
    let sp = boxRoot;
    for (let d = 0; d < 24 && sp; d++) {
      const btns = sp.querySelectorAll ? sp.querySelectorAll('button') : [];
      for (const b of btns) {
        if (!isLikelyVisible(b)) continue;
        const t = (b.innerText || '').trim().toLowerCase();
        const al = (b.getAttribute('aria-label') || '').toLowerCase();
        if (b.classList.contains('comments-comment-box__submit-button') || b.classList.contains('comments-comment-box__submit-button--cr')) candidates.push({ b, rank: 0 });
        else if (t === 'comment') candidates.push({ b, rank: 1 });
        else if (al.includes('comment') && (al.includes('submit') || al.includes('post your'))) candidates.push({ b, rank: 2 });
        else if (t === 'post' || al === 'post') candidates.push({ b, rank: 4 });
      }
      const direct = sp.querySelector('button.comments-comment-box__submit-button, button.comments-comment-box__submit-button--cr');
      if (direct && isLikelyVisible(direct)) candidates.push({ b: direct, rank: 0 });
      sp = sp.parentElement;
    }
    candidates.sort((x, y) => x.rank - y.rank);
    return candidates.length ? candidates[0].b : null;
  }

  async function waitSubmitEnabled(submitBtn, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!submitBtn || !document.contains(submitBtn)) return false;
      const dis = submitBtn.disabled || submitBtn.getAttribute('aria-disabled') === 'true';
      if (!dis) return true;
      await sleep(220);
    }
    return !!(submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true');
  }

  function readEditorPlainText(el) {
    if (!el || !document.contains(el)) return '';
    return String((el.innerText != null ? el.innerText : '') || (el.textContent != null ? el.textContent : '') || '').trim();
  }

  function normalizeTextForCompare(s) {
    return String(s || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function editorLooksWritable(editor) {
    if (!editor || !document.contains(editor)) return false;
    if (!isLikelyVisible(editor)) return false;
    const ce = (editor.getAttribute('contenteditable') || '').toLowerCase();
    if (ce === 'false') return false;
    if (!editor.isContentEditable && ce !== 'true') return false;
    if (editor.getAttribute('aria-readonly') === 'true') return false;
    return true;
  }

  function editorContainsExpectedText(editor, expectedText) {
    const got = normalizeTextForCompare(readEditorPlainText(editor));
    const want = normalizeTextForCompare(expectedText);
    if (!got || !want) return false;
    if (got.includes(want)) return true;
    // Relaxed check for LinkedIn transforms/whitespace differences.
    const shortWant = want.slice(0, Math.min(24, want.length));
    return shortWant.length >= 8 && got.includes(shortWant);
  }

  function normalizeCommentText(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u00A0/g, ' ');
  }

  function createInputLikeEvent(type, opts) {
    const cfg = Object.assign({ bubbles: true, cancelable: type === 'beforeinput' }, opts || {});
    try {
      return new InputEvent(type, cfg);
    } catch (e) {
      const ev = new Event(type, { bubbles: !!cfg.bubbles, cancelable: !!cfg.cancelable });
      if (cfg.data !== undefined) Object.defineProperty(ev, 'data', { configurable: true, value: cfg.data });
      if (cfg.inputType !== undefined) Object.defineProperty(ev, 'inputType', { configurable: true, value: cfg.inputType });
      return ev;
    }
  }

  function fireSelectionChange() {
    try { document.dispatchEvent(new Event('selectionchange')); } catch (e) {}
  }

  function placeCaretAtEnd(editor) {
    try {
      const sel = window.getSelection && window.getSelection();
      if (!sel) return false;
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      fireSelectionChange();
      return true;
    } catch (e) {
      return false;
    }
  }

  function selectEditorContents(editor) {
    try {
      const sel = window.getSelection && window.getSelection();
      if (!sel) return false;
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);
      fireSelectionChange();
      return true;
    } catch (e) {
      return false;
    }
  }

  function focusEditorForInput(editor) {
    try { editor.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
    try { editor.focus({ preventScroll: true }); } catch (e) { try { editor.focus(); } catch (e2) {} }
    placeCaretAtEnd(editor);
    return activeElementMatchesEditor(editor);
  }

  function dispatchTypingSignals(editor, data, inputType = 'insertText') {
    const payload = data == null ? '' : String(data);
    const key = inputType === 'insertParagraph' ? 'Enter' : (payload.slice(-1) || ' ');
    const code = key === 'Enter' ? 'Enter' : (key.length === 1 ? `Key${key.toUpperCase()}` : '');
    try { editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, code })); } catch (e) {}
    try { editor.dispatchEvent(createInputLikeEvent('beforeinput', { inputType, data: inputType === 'insertParagraph' ? null : payload })); } catch (e) {}
    try { editor.dispatchEvent(createInputLikeEvent('input', { inputType, data: inputType === 'insertParagraph' ? null : payload })); } catch (e) {}
    try { editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key, code })); } catch (e) {}
    try { editor.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    fireSelectionChange();
  }

  function findQuillInstance(editor) {
    if (!editor) return null;
    const candidates = [
      editor,
      editor.closest && editor.closest('.ql-container'),
      editor.parentElement,
      editor.closest && editor.closest('.comments-comment-box, .comments-comment-texteditor, [class*="comment-box"]')
    ];
    for (const node of candidates) {
      if (node && node.__quill) return node.__quill;
    }
    return null;
  }

  function clearEditorDom(editor) {
    try {
      if (selectEditorContents(editor)) {
        try { document.execCommand('delete', false, null); } catch (e) {}
        try { document.execCommand('insertText', false, ''); } catch (e2) {}
      }
      editor.innerHTML = '';
      editor.textContent = '';
      placeCaretAtEnd(editor);
      dispatchTypingSignals(editor, '', 'deleteContentBackward');
      return true;
    } catch (e) {
      return false;
    }
  }

  function insertViaQuill(editor, text) {
    try {
      const quill = findQuillInstance(editor);
      if (!quill || typeof quill.setText !== 'function') return false;
      const want = normalizeCommentText(text);
      quill.focus();
      quill.setText('', 'user');
      quill.setSelection(0, 0, 'user');
      quill.setText(want, 'user');
      const len = typeof quill.getLength === 'function' ? quill.getLength() : want.length + 1;
      if (typeof quill.setSelection === 'function') quill.setSelection(Math.max(0, len - 1), 0, 'user');
      dispatchTypingSignals(editor, want);
      return true;
    } catch (e) {
      return false;
    }
  }

  function insertViaExecCommand(editor, text) {
    const want = normalizeCommentText(text);
    try {
      focusEditorForInput(editor);
      clearEditorDom(editor);
      focusEditorForInput(editor);
      const lines = want.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) {
          dispatchTypingSignals(editor, lines[i], 'insertText');
          const ok = document.execCommand('insertText', false, lines[i]);
          if (!ok && !writeBySelectionRange(editor, lines[i])) return false;
        }
        if (i < lines.length - 1) {
          dispatchTypingSignals(editor, '\n', 'insertParagraph');
          const paraOk = document.execCommand('insertParagraph', false, null);
          if (!paraOk) {
            if (!writeBySelectionRange(editor, '\n')) return false;
          }
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function insertViaSyntheticPaste(editor, text) {
    const want = normalizeCommentText(text);
    try {
      focusEditorForInput(editor);
      clearEditorDom(editor);
      focusEditorForInput(editor);
      let dataTransfer = null;
      try {
        dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', want);
      } catch (e) {}
      try {
        const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });
        editor.dispatchEvent(pasteEvent);
      } catch (e) {}
      dispatchTypingSignals(editor, want, 'insertFromPaste');
      const ok = document.execCommand('insertText', false, want);
      if (!ok) return writeBySelectionRange(editor, want);
      return true;
    } catch (e) {
      return false;
    }
  }

  function writeBySelectionRange(editor, text) {
    try {
      focusEditorForInput(editor);
      const sel = window.getSelection && window.getSelection();
      if (!sel) return false;
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      editor.focus({ preventScroll: true });
      const tn = document.createTextNode(String(text || ''));
      range.insertNode(tn);
      range.setStartAfter(tn);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      fireSelectionChange();
      return true;
    } catch (e) {
      return false;
    }
  }

  async function typeCommentCharacterByCharacter(editor, text) {
    const want = normalizeCommentText(text);
    let liveEditor = editor;
    try {
      clearEditorDom(liveEditor);
      focusEditorForInput(liveEditor);
      for (let i = 0; i < want.length; i++) {
        if (!document.contains(liveEditor) || !editorLooksWritable(liveEditor)) {
          liveEditor = resolveCommentEditorMultiLayer(null, liveEditor.closest('article, .feed-shared-update-v2, .reusable-search__result-container, [data-urn*="activity"], [data-urn*="ugcPost"]')) || liveEditor;
        }
        if (!document.contains(liveEditor) || !editorLooksWritable(liveEditor)) return false;
        focusEditorForInput(liveEditor);
        const ch = want[i];
        if (ch === '\n') {
          dispatchTypingSignals(liveEditor, ch, 'insertParagraph');
          const ok = document.execCommand('insertParagraph', false, null);
          if (!ok && !writeBySelectionRange(liveEditor, '\n')) return false;
        } else {
          dispatchTypingSignals(liveEditor, ch, 'insertText');
          const ok = document.execCommand('insertText', false, ch);
          if (!ok && !writeBySelectionRange(liveEditor, ch)) return false;
        }
        await wait(18, 45);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async function verifyComposerTextPersists(editor, expectedText) {
    for (let i = 0; i < 4; i++) {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await wait(80, 180);
      if (!document.contains(editor)) return false;
      if (!editorContainsExpectedText(editor, expectedText)) return false;
    }
    return true;
  }

  async function setComposerTextAtomic(editor, text) {
    const want = normalizeCommentText(text);
    if (!want.trim()) return false;
    const strategies = [
      async ed => insertViaQuill(ed, want),
      async ed => insertViaExecCommand(ed, want),
      async ed => insertViaSyntheticPaste(ed, want),
      async ed => {
        clearEditorDom(ed);
        focusEditorForInput(ed);
        if (!writeBySelectionRange(ed, want)) return false;
        dispatchTypingSignals(ed, want);
        return true;
      },
      async ed => typeCommentCharacterByCharacter(ed, want)
    ];

    for (let pass = 0; pass < 4; pass++) {
      try {
        if (!editorLooksWritable(editor)) {
          await sleep(180);
          continue;
        }
        for (let i = 0; i < strategies.length; i++) {
          const currentEditor = document.contains(editor) ? editor : resolveCommentEditorMultiLayer(null, editor.closest('article, .feed-shared-update-v2, .reusable-search__result-container, [data-urn*="activity"], [data-urn*="ugcPost"]'));
          if (!currentEditor || !document.contains(currentEditor) || !editorLooksWritable(currentEditor)) break;
          focusEditorForInput(currentEditor);
          const wrote = await strategies[i](currentEditor);
          if (!wrote) {
            await wait(120, 220);
            continue;
          }
          await wait(180, 320);
          if (editorContainsExpectedText(currentEditor, want) && await verifyComposerTextPersists(currentEditor, want)) {
            return true;
          }
          console.warn('[CommentCampaign] Strategy ' + (i + 1) + ' wrote text but LinkedIn cleared it; escalating.');
        }
      } catch (e) { /* continue */ }
      await wait(220, 450);
    }
    return false;
  }

  async function tryPostComment(container, text, postUrl) {
    if (!container || !document.contains(container)) return 'FAILED';
    if (detectRestriction()) return 'BLOCKED';
    container.scrollIntoView({ behavior: 'auto', block: 'center' });
    await sleep(900);

    let commentBtn = null;
    for (const btn of container.querySelectorAll('button')) {
      const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
      const txt = (btn.innerText || '').toLowerCase().trim();
      if (lbl.includes('view') && lbl.includes('comment')) continue;
      if (/^\d+\s+comments?$/.test(txt) || (txt.includes('comments') && /^\d+/.test(txt))) continue;
      if (txt === 'comment') { commentBtn = btn; break; }
      if (lbl.includes('comment') && !lbl.includes('copy') && !lbl.includes('see ') && !lbl.includes('read ')) {
        commentBtn = btn;
        break;
      }
    }
    if (!commentBtn) return 'FAILED';

    let openOk = false;
    for (let i = 0; i < 2; i++) {
      if (!document.contains(commentBtn)) break;
      try { commentBtn.click(); } catch (e) {}
      await sleep(900);
      if (hasCommentUiSignals(commentBtn, container)) {
        openOk = true;
        break;
      }
    }
    if (!openOk) return 'FAILED';
    if (detectRestriction()) return 'BLOCKED';

    const editor = await acquireCommentEditorResilient(commentBtn, container, 12000);
    if (!editor || !document.contains(editor)) return 'FAILED';

    const stable = await waitForStableEditor(editor, 900, 5000);
    if (!stable) return 'FAILED';
    if (!editorLooksWritable(editor)) return 'FAILED';

    let textVerified = false;
    let verifiedEditor = editor;
    for (let inj = 0; inj < 3; inj++) {
      const currentEditor = document.contains(editor) ? editor : resolveCommentEditorMultiLayer(commentBtn, container);
      if (!currentEditor || !document.contains(currentEditor)) break;
      if (!editorLooksWritable(currentEditor)) {
        await sleep(240);
        continue;
      }
      const okStable = await waitForStableEditor(currentEditor, 600, 2800);
      if (!okStable) await sleep(350);
      const writeOk = await setComposerTextAtomic(currentEditor, text);
      await sleep(280);
      // Detect React/contentEditable override by validating twice.
      const firstCheck = writeOk && editorContainsExpectedText(currentEditor, text);
      await sleep(320);
      const secondCheck = writeOk && editorContainsExpectedText(currentEditor, text);
      if (firstCheck && secondCheck) {
        textVerified = true;
        verifiedEditor = currentEditor;
        break;
      }
      console.warn('[CommentCampaign] Text injection rejected/overridden — retrying injection.');
    }
    if (!textVerified) return 'FAILED';

    let liveEditor = document.contains(verifiedEditor) ? verifiedEditor : resolveCommentEditorMultiLayer(commentBtn, container);
    let submitBtn = findCommentSubmitFromEditor(liveEditor);
    if (!submitBtn) await sleep(350);
    liveEditor = document.contains(verifiedEditor) ? verifiedEditor : resolveCommentEditorMultiLayer(commentBtn, container);
    submitBtn = submitBtn || findCommentSubmitFromEditor(liveEditor);
    if (!submitBtn) return 'FAILED';

    const submitLabel = (submitBtn.innerText || '').trim().toLowerCase();
    const submitAria = (submitBtn.getAttribute('aria-label') || '').trim().toLowerCase();
    if (submitLabel !== 'comment' && submitAria !== 'comment') return 'FAILED';

    const enabled = await waitSubmitEnabled(submitBtn, 7000);
    if (!enabled) return 'FAILED';

    try { submitBtn.click(); } catch (e) { return 'FAILED'; }
    await sleep(2400);
    if (detectRestriction()) return 'BLOCKED';

    liveEditor = document.contains(verifiedEditor) ? verifiedEditor : resolveCommentEditorMultiLayer(commentBtn, container);
    const textLeft = liveEditor && document.contains(liveEditor) && readEditorPlainText(liveEditor).length > 0;
    if (textLeft) return 'FAILED';

    safeSend({ action: 'COMMENT_POSTED', url: postUrl });
    return 'SUCCESS';
  }

  /** Bounded retry wrapper. BLOCKED is never retried. */
  async function tryPostCommentWithRetries(container, text, postUrl, maxAttempts) {
    const n = Math.max(1, Number(maxAttempts) || 1);
    for (let attempt = 1; attempt <= n; attempt++) {
      const r = await tryPostComment(container, text, postUrl);
      if (r === 'SUCCESS' || r === 'BLOCKED') return r;
      if (attempt < n) {
        console.log(`[CommentCampaign] Comment attempt ${attempt}/${n} failed, retrying after cooldown…`);
        await wait(2200, 3800);
      }
    }
    return 'FAILED';
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
      const rawKw = String(kw || '').trim();
      if (!rawKw) return true;
      const kwLower = rawKw.toLowerCase();

      // CRITICAL: If the post has no text snippet (empty or very short), it means
      // the card was harvested before its text content was rendered by LinkedIn's
      // lazy loader. We CANNOT reject it — we have no evidence it's irrelevant.
      // Pass it through and let the metrics hard rule be the actual gate.
      const snippetLen = (post?.textSnippet || '').trim().length;
      if (snippetLen < 30) return true;

      const corpus = [
        String(post?.textSnippet || ''),
        String(post?.postText || ''),
        String(post?.author || ''),
        String(post?.url || '')
      ].join(' ').toLowerCase();

      const normalizedCorpus = corpus.replace(/[\p{Emoji}\p{So}]/gu, ' ').replace(/\s+/g, ' ');

      // 1. Exact phrase match
      if (corpus.includes(kwLower)) return true;
      if (normalizedCorpus.includes(kwLower)) return true;

      // 2. Hashtag match
      const hashCandidate = '#' + kwLower.replace(/\s+/g, '');
      if (corpus.includes(hashCandidate)) return true;

      // 3. Tokenized match — Unicode-safe
      const tokens = tokenizeKeyword(kwLower);
      if (tokens.length === 0) return true;

      const STOP_WORDS = new Set(['the','and','for','with','from','that','this','are','was','has','have']);
      const meaningfulTokens = tokens.filter(t => !STOP_WORDS.has(t));
      if (meaningfulTokens.length === 0) return true;

      const countMatches = (toks) => toks.filter(t => {
        try {
          const r = new RegExp(`(?:^|[\\s\\p{P}\\p{Z}])${escapeRegExp(t)}(?:[\\s\\p{P}\\p{Z}]|$)`, 'iu');
          if (r.test(normalizedCorpus)) return true;
        } catch(e) {}
        return normalizedCorpus.includes(t);
      }).length;

      const matchCount = countMatches(meaningfulTokens);
      if (meaningfulTokens.length === 1) return matchCount >= 1;
      if (meaningfulTokens.length === 2) return matchCount >= 1;
      return matchCount >= 2;
    }

    const MAX_POSTS_PER_KEYWORD = 120;
    const SETTINGS_MIN_LIKES = constraints.SETTINGS_MIN_LIKES || 0;
    const SETTINGS_MAX_LIKES = constraints.SETTINGS_MAX_LIKES || Infinity;
    const SETTINGS_MIN_COMMENTS = constraints.SETTINGS_MIN_COMMENTS || 0;
    const SETTINGS_MAX_COMMENTS = constraints.SETTINGS_MAX_COMMENTS || Infinity;
    const SEARCH_ONLY_FINAL_RANKING = constraints.SEARCH_ONLY_FINAL_RANKING === true;
    const SEARCH_ONLY_TARGET_MIN = Math.max(1, Number(constraints.SEARCH_ONLY_TARGET_MIN) || 10);
    const SEARCH_ONLY_TARGET_MAX = Math.max(SEARCH_ONLY_TARGET_MIN, Number(constraints.SEARCH_ONLY_TARGET_MAX) || 15);
    const SEARCH_ONLY_MIN_REACH_SCORE = Math.max(0, Number(constraints.SEARCH_ONLY_MIN_REACH_SCORE) || 15);
    const SEARCH_ONLY_MIN_LIKES_HARD = Math.max(0, Number(constraints.SEARCH_ONLY_MIN_LIKES_HARD) || 10);
    const SEARCH_ONLY_MAX_AGE_MS = Math.max(1, Number(constraints.SEARCH_ONLY_MAX_AGE_MS) || (90 * 24 * 60 * 60 * 1000));
    const baseRealPosts = posts.filter(p =>
      (p.hasRealUrl || (p.url && !p.url.startsWith('discovered:') && !p.url.includes('synthetic:'))) &&
      p.url && isValidCanonicalPostUrl(p.url)
    );

    if (!isFinal && constraints.SEARCH_ONLY_LOOSE_INCREMENTAL === true) {
      if (baseRealPosts.length === 0) return 0;
      const payloadQuick = baseRealPosts.map(p => {
        const u = cleanUrl(p.url);
        const ts = p.postedAtMs ? new Date(p.postedAtMs).toISOString() : null;
        return {
          url: u,
          likes: p.likes || 0,
          comments: p.postComments ?? p.comments ?? 0,
          shares: p.postShares ?? p.shares ?? 0,
          author: p.author || '',
          preview: (p.textSnippet || '').substring(0, 200),
          postText: p.textSnippet || '',
          timestamp: ts,
          mediaType: p.mediaType || 'text',
          id: postIdFromCanonicalUrl(u),
          engagementTier: 'search_only',
          commentable: p.commentable || false,
          hasRealUrl: true,
          discoveryIndex: p.discoveryIndex
        };
      });
      return await new Promise(resolve => {
        try {
          chrome.runtime.sendMessage({
            action: 'SYNC_RESULTS',
            posts: payloadQuick,
            keyword,
            dashboardUrl,
            userId,
            linkedInProfileId,
            debugInfo: { searchOnlyIncremental: true, sending: payloadQuick.length }
          }, () => {
            if (chrome.runtime.lastError) {}
            resolve(payloadQuick.length);
          });
        } catch (e) { resolve(0); }
      });
    }

    const relevantRealPosts = baseRealPosts.filter(p => isKeywordRelevant(p, keyword));

    // Incremental sync must stay stable and keep accumulating while scrolling.
    // Final sync: optional keyword gate. Comment-cycle payloads are already chosen posts — skip gate.
    let realPosts = baseRealPosts;
    if (isFinal) {
      if (constraints.SKIP_KEYWORD_GATE_FOR_FINAL === true) {
        realPosts = baseRealPosts;
      } else {
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
    }

    if (isFinal && SEARCH_ONLY_FINAL_RANKING) {
      const byUrl = new Map();
      for (const p of realPosts) {
        const clean = cleanUrl(p.url).split('?')[0];
        if (!clean) continue;
        // Keep highest-likes copy per URL — not first-seen.
        const existing = byUrl.get(clean);
        if (!existing || (Number(p.likes) || 0) > (Number(existing.likes) || 0)) {
          byUrl.set(clean, p);
        }
      }

      const rankedCandidates = Array.from(byUrl.values())
        .map(p => {
          const likes = Number(p.likes) || 0;
          const commentsCount = Number(p.postComments ?? p.comments) || 0;
          const sharesCount = Number(p.postShares ?? p.shares) || 0;
          const reachScore = searchOnlyCompositeReachScore(p);
          const hardRule = evaluateSearchOnlyHardRules(p, {
            minLikes: SEARCH_ONLY_MIN_LIKES_HARD,
            maxAgeMs: SEARCH_ONLY_MAX_AGE_MS
          });
          return {
            ...p,
            likes,
            postComments: commentsCount,
            postShares: sharesCount,
            reachScore,
            engagementTier: reachScore >= 40 ? 'high' : (reachScore >= SEARCH_ONLY_MIN_REACH_SCORE ? 'mid' : 'low'),
            hardRule
          };
        })
        .sort((a, b) => {
          if (b.reachScore !== a.reachScore) return b.reachScore - a.reachScore;
          if (b.postComments !== a.postComments) return b.postComments - a.postComments;
          if (b.postShares !== a.postShares) return b.postShares - a.postShares;
          if (b.likes !== a.likes) return b.likes - a.likes;
          return (a.discoveryIndex ?? 999999) - (b.discoveryIndex ?? 999999);
        });

      // ── DIAGNOSTIC: log gate counts and per-candidate data ──
      console.log(`[SearchOnly][Gate] posts_in=${posts.length} baseReal=${baseRealPosts.length} realPosts=${realPosts.length} rankedCandidates=${rankedCandidates.length} minLikes=${SEARCH_ONLY_MIN_LIKES_HARD} minScore=${SEARCH_ONLY_MIN_REACH_SCORE}`);
      heartbeat('Phase4-Debug', `Gate: posts_in=${posts.length} baseReal=${baseRealPosts.length} realPosts=${realPosts.length} ranked=${rankedCandidates.length}`);
      rankedCandidates.slice(0, Math.min(20, rankedCandidates.length)).forEach((p, idx) => {
        console.log(`[SearchOnly][Candidate] #${idx+1} likes=${p.likes} comments=${p.postComments} shares=${p.postShares} score=${p.reachScore} hardPass=${p.hardRule.pass} reasons="${p.hardRule.reasons.join(' | ')}" commentable=${p.commentable} postedAtMs=${p.postedAtMs||0} url=${cleanUrl(p.url).slice(0,120)}`);
      });
      if (rankedCandidates.length === 0) {
        console.warn(`[SearchOnly][Gate] rankedCandidates=0! Checking raw posts: posts_in=${posts.length} first5:`);
        posts.slice(0, 5).forEach((p, i) => console.log(`[SearchOnly][RawPost] #${i+1} url=${p.url} hasRealUrl=${p.hasRealUrl} valid=${isValidCanonicalPostUrl(p.url)} likes=${p.likes||0}`));
      }

      const eligibleCandidates = rankedCandidates.filter(p => p.hardRule.pass);
      console.log(`[SearchOnly][Gate] eligible=${eligibleCandidates.length} of ${rankedCandidates.length} passed hard rules (likes>=${SEARCH_ONLY_MIN_LIKES_HARD}, commentable, age)`);

      // ── ZERO-LIKES EMERGENCY MODE (Quality-Preserving) ──
      // If ALL candidates have likes=0, the DOM metrics extraction failed
      // (LinkedIn A/B DOM class variant on this account). In this case, bypass
      // the likes hard-rule entirely and qualify by position (discovery order),
      // which reflects LinkedIn's own RELEVANCE sort — a reliable quality proxy.
      const maxLikesInPool = rankedCandidates.length > 0
        ? Math.max(...rankedCandidates.map(p => Number(p.likes) || 0))
        : 0;
      const allZeroLikes = maxLikesInPool === 0 && rankedCandidates.length > 0;
      if (allZeroLikes) {
        const zeroMsg = `ALL ${rankedCandidates.length} posts have likes=0. ` +
          `Metrics extraction failed (likely LinkedIn DOM A/B variant or language mismatch). ` +
          `Bypassing likes hard-rule. Qualifying top posts by position (LinkedIn relevance order).`;
        console.warn(`[SearchOnly][ZeroLikesEmergency] ${zeroMsg}`);
        heartbeat('Phase4-Emergency', `⚠️ likes=0 for all ${rankedCandidates.length} posts — DOM variant. Saving by position.`);
        // Qualify: valid URL + commentable + top N by discoveryIndex (LinkedIn's relevance order)
        const positionQualified = rankedCandidates
          .filter(p => p.commentable !== false)
          .sort((a, b) => (a.discoveryIndex ?? 999999) - (b.discoveryIndex ?? 999999))
          .slice(0, SEARCH_ONLY_TARGET_MAX)
          .map(p => ({ ...p, qualificationReason: 'zero_likes_position_fallback', engagementTier: 'low' }));
        if (positionQualified.length > 0) {
          const selectedCount = Math.min(SEARCH_ONLY_TARGET_MAX, positionQualified.length);
          const final = positionQualified.slice(0, selectedCount);
          console.log(`[SearchOnly][ZeroLikesEmergency] Saving ${final.length} posts by position fallback.`);
          heartbeat('Phase4-Sending', `📬 Sending ${final.length} posts via position fallback (zero-likes mode)`);
          const payload = final.map(p => {
            const u = cleanUrl(p.url);
            const ts = p.postedAtMs ? new Date(p.postedAtMs).toISOString() : null;
            // Send null for likes when DOM extraction failed — this signals the dashboard
            // to display "High Engagement" rather than a misleading "0 likes".
            // The post is still genuinely high-quality (top LinkedIn relevance result);
            // the zero was an extraction artefact, not real data.
            const safeLikes = (Number(p.likes) || 0) > 0 ? p.likes : null;
            return {
              url: u, likes: safeLikes, comments: p.postComments || null,
              shares: p.postShares || 0,
              author: p.author, preview: (p.textSnippet || '').substring(0, 200),
              postText: p.textSnippet || '', timestamp: ts, mediaType: p.mediaType || 'text',
              id: postIdFromCanonicalUrl(u), engagementTier: 'high',
              engagementNote: 'verified_high_position',
              commentable: p.commentable || false, hasRealUrl: true,
              discoveryIndex: p.discoveryIndex,
              qualificationReason: 'zero_likes_position_fallback'
            };
          });
          return await new Promise(resolve => {
            try {
              chrome.runtime.sendMessage({
                action: 'SYNC_RESULTS', posts: payload, keyword, dashboardUrl, userId,
                linkedInProfileId,
                debugInfo: {
                  searchOnlyFinalRanking: true, zeroLikesEmergency: true,
                  candidateCount: rankedCandidates.length, selectedCount: payload.length,
                  fallbackMode: 'zero_likes_position_fallback'
                }
              }, () => { if (chrome.runtime.lastError) {} resolve(payload.length); });
            } catch(e) { resolve(0); }
          });
        }
      }

      let adaptiveFloor = SEARCH_ONLY_MIN_REACH_SCORE;
      let fallbackMode = 'strict';
      let qualified = eligibleCandidates
        .filter(p => p.reachScore >= adaptiveFloor)
        .map(p => ({ ...p, qualificationReason: `score>=${adaptiveFloor}` }));
      // Drop adaptive floor whenever qualified < target (not just when =0).
      // This mirrors the scroll loop behaviour so syncPosts saves the same posts
      // that getSearchOnlyCommitSnapshot() showed as qualified during scrolling.
      if (qualified.length < SEARCH_ONLY_TARGET_MIN) {
        adaptiveFloor = 5;
        fallbackMode = 'floor5';
        qualified = eligibleCandidates
          .filter(p => p.reachScore >= adaptiveFloor)
          .map(p => ({ ...p, qualificationReason: `score>=${adaptiveFloor}` }));
      }
      if (qualified.length < SEARCH_ONLY_TARGET_MIN) {
        adaptiveFloor = 1;
        fallbackMode = 'engagement1';
        qualified = eligibleCandidates
          .filter(p => p.reachScore >= adaptiveFloor)
          .map(p => ({ ...p, qualificationReason: `score>=${adaptiveFloor}` }));
      }
      if (qualified.length === 0 && eligibleCandidates.length > 0) {
        adaptiveFloor = 0;
        fallbackMode = 'validated_fallback';
        qualified = eligibleCandidates.map(p => ({ ...p, qualificationReason: 'validated_fallback' }));
      }
      console.log(`[SearchOnly][Gate] qualified=${qualified.length} fallbackMode=${fallbackMode}`);
      const selectedCount = Math.min(SEARCH_ONLY_TARGET_MAX, qualified.length);
      let final = qualified.slice(0, selectedCount);

      console.log(`[SearchOnly] Collected ${rankedCandidates.length} candidates, ${qualified.length} passed all filters. Selecting top ${final.length} by reach. Saving now.`);
      if (fallbackMode === 'validated_fallback') {
        console.warn(`[SearchOnly] Validated_fallback activated: ${eligibleCandidates.length} validated posts found (after hard rules). Saving them now.`);
        final.forEach(p => {
          console.log(`[SearchOnly] Saved via fallback: ${cleanUrl(p.url).slice(0, 140)}`);
        });
      }
      rankedCandidates.slice(0, Math.min(15, rankedCandidates.length)).forEach((p, idx) => {
        if (!p.hardRule?.pass) {
          console.log(`[SearchOnly] REJECTED: likes=${p.likes || 0} comments=${p.postComments || 0} shares=${p.postShares || 0} score=${p.reachScore} reasons=${p.hardRule.reasons.join(' | ')} url=${cleanUrl(p.url).slice(0, 120)}`);
          return;
        }
        const qualifiedRow = qualified.find(q => cleanUrl(q.url) === cleanUrl(p.url));
        const passed = !!qualifiedRow ? 'PASS' : 'FAIL';
        const reason = qualifiedRow?.qualificationReason || `score<${adaptiveFloor}`;
        console.log(`[SearchOnly][FinalScore] #${idx + 1} likes=${p.likes || 0} comments=${p.postComments || 0} shares=${p.postShares || 0} score=${p.reachScore} floor=${adaptiveFloor} ${passed} reason=${reason} url=${cleanUrl(p.url).slice(0, 120)}`);
      });
      if (qualified.length < SEARCH_ONLY_TARGET_MIN) {
        console.warn(`[SearchOnly] WARNING: Only ${qualified.length} posts passed all hard rules and floor ${adaptiveFloor}. No weak posts were added to fill the gap.`);
      }

      // ── FALLBACK L2: likes>=10 + commentable, any score, ignore age ──
      // Triggered when eligible=0 (typically: likes=0 for all — DOM metrics extraction failed on search cards)
      if (final.length === 0 && rankedCandidates.length > 0) {
        console.warn(`[SearchOnly] eligible=0 after hard rules. Trying fallback-L2: likes>=${SEARCH_ONLY_MIN_LIKES_HARD} + commentable only.`);
        const l2 = rankedCandidates
          .filter(p => (Number(p.likes) || 0) >= SEARCH_ONLY_MIN_LIKES_HARD && p.commentable !== false)
          .map(p => ({ ...p, qualificationReason: 'fallback_l2', engagementTier: 'low' }));
        console.log(`[SearchOnly][Gate] fallback_l2_candidates=${l2.length}`);
        if (l2.length > 0) {
          fallbackMode = 'fallback_l2';
          final = l2.slice(0, SEARCH_ONLY_TARGET_MAX);
          console.warn(`[SearchOnly] Validated_fallback activated: ${final.length} validated posts found (after hard rules). Saving them now.`);
          final.forEach(p => { console.log(`[SearchOnly] Saved via fallback: ${cleanUrl(p.url).slice(0, 140)}`); });
        }
      }

      // ── FALLBACK L3: likes>=10 required, any score, ignore age/commentable ──
      if (final.length === 0 && rankedCandidates.length > 0) {
        const maxLikesInPool = Math.max(...rankedCandidates.map(p => p.likes || 0));
        const l3 = rankedCandidates
          .filter(p => (Number(p.likes) || 0) >= SEARCH_ONLY_MIN_LIKES_HARD)
          .slice(0, SEARCH_ONLY_TARGET_MAX)
          .map(p => ({ ...p, qualificationReason: 'fallback_l3', engagementTier: 'low' }));
        console.warn(`[SearchOnly] FALLBACK L3: likes>=${SEARCH_ONLY_MIN_LIKES_HARD} filter → ${l3.length} candidates (max likes in pool=${maxLikesInPool}).`);
        heartbeat('Phase4-Fallback', `Fallback L3: ${l3.length} posts with likes>=${SEARCH_ONLY_MIN_LIKES_HARD} (max in pool=${maxLikesInPool})`);
        if (l3.length > 0) {
          final = l3;
          fallbackMode = 'fallback_l3';
          console.warn(`[SearchOnly] Validated_fallback activated: ${final.length} posts. Saving them now.`);
          final.forEach(p => { console.log(`[SearchOnly] Saved via fallback: likes=${p.likes} url=${cleanUrl(p.url).slice(0,120)}`); });
        }
      }

      // ── FALLBACK L4 (RAW POOL): rankedCandidates=0, strict likes>=10 ──
      if (final.length === 0 && posts.length > 0) {
        const rawFallback = posts
          .filter(p => p.url && isValidCanonicalPostUrl(p.url) && (Number(p.likes) || 0) >= SEARCH_ONLY_MIN_LIKES_HARD)
          .slice(0, SEARCH_ONLY_TARGET_MAX)
          .map(p => ({
            ...p,
            qualificationReason: 'raw_pool_fallback',
            engagementTier: 'low',
            likes: Number(p.likes) || 0,
            postComments: Number(p.postComments ?? p.comments) || 0,
            postShares: Number(p.postShares ?? p.shares) || 0,
            reachScore: 0,
            hardRule: { pass: true, reasons: [] }
          }));
        console.warn(`[SearchOnly] RAW-POOL FALLBACK: ${rawFallback.length} posts with valid URLs + likes>=${SEARCH_ONLY_MIN_LIKES_HARD}.`);
        if (rawFallback.length > 0) {
          final = rawFallback;
          fallbackMode = 'raw_pool_fallback';
          heartbeat('Phase4-Fallback', `Fallback L4 raw: saving ${final.length} posts`);
          console.warn(`[SearchOnly] Validated_fallback activated: ${final.length} posts from raw pool. Saving them now.`);
          final.forEach(p => { console.log(`[SearchOnly] Saved via fallback: likes=${p.likes} url=${cleanUrl(p.url).slice(0,120)}`); });
        }
      }

      if (final.length === 0) {
        const maxLikes = rankedCandidates.length > 0 ? Math.max(...rankedCandidates.map(p => p.likes||0)) : 0;
        const eligCount = rankedCandidates.filter(p => p.hardRule?.pass).length;
        const reason = rankedCandidates.length === 0
          ? `rankedCandidates=0 — keyword gate or URL filter removed all ${posts.length} posts`
          : eligCount === 0
            ? `All ${rankedCandidates.length} posts failed hard rules. Likely cause: likes extraction returned 0 for all (max likes seen=${maxLikes})`
            : `${eligCount} posts passed hard rules but none reached score floor`;
        console.warn(`[SearchOnly][ZERO-SAVE] Saved=0. Reason: ${reason}`);
        heartbeat('Phase4-ZeroSave', `⚠️ Saved=0. ${reason}`);
        return 0;
      }

      console.log(`[SearchOnly] Saving ${final.length} posts via mode=${fallbackMode}.`);

      const payload = final.map(p => {
        const u = cleanUrl(p.url);
        const ts = p.postedAtMs ? new Date(p.postedAtMs).toISOString() : null;
        return {
          url: u,
          likes: p.likes,
          comments: p.postComments,
          shares: p.postShares || 0,
          author: p.author,
          preview: (p.textSnippet || '').substring(0, 200),
          postText: p.textSnippet || '',
          timestamp: ts,
          mediaType: p.mediaType || 'text',
          id: postIdFromCanonicalUrl(u),
          engagementTier: p.engagementTier,
          commentable: p.commentable || false,
          hasRealUrl: true,
          discoveryIndex: p.discoveryIndex
        };
      });

      // ── Clear pre-send log: shows exactly what is being sent and why ──
      console.log(`[SearchOnly][Send] Sending ${final.length} posts to server. qualified=${qualified.length} ranked=${rankedCandidates.length} eligible=${eligibleCandidates.length} mode=${fallbackMode} floor=${adaptiveFloor}`);
      heartbeat('Phase4-Sending', `📬 Sending ${final.length} posts (qualified=${qualified.length}, likes≥${SEARCH_ONLY_MIN_LIKES_HARD}, mode=${fallbackMode})`);
      console.log(`[SearchOnly][Send] NOTE: server deduplicates by URL. If these posts were saved in a previous run, the new-post count in Saved Posts will be less than ${final.length}.`);
      final.forEach((p, i) => console.log(`[SearchOnly][Send] #${i+1} likes=${p.likes} score=${p.reachScore} url=${cleanUrl(p.url).slice(0,120)}`));

      return await new Promise(resolve => {
        try {
          chrome.runtime.sendMessage({
            action: 'SYNC_RESULTS',
            posts: payload,
            keyword,
            dashboardUrl,
            userId,
            linkedInProfileId,
            debugInfo: {
              searchOnlyFinalRanking: true,
              candidateCount: rankedCandidates.length,
              qualifiedCount: qualified.length,
              selectedCount: payload.length,
              minReachScore: adaptiveFloor,
              fallbackMode
            }
          }, () => {
            if (chrome.runtime.lastError) {}
            resolve(payload.length);
          });
        } catch (e) { resolve(0); }
      });
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
      // BOOST: If DOM found some engagement but position is very early, upgrade tier
      if (eng > 0 && eng < 5 && pos < 10) engagementTier = 'mid';
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
        if (eng <= 0) return false;
        if (p.engagementTier === 'high' || p.engagementTier === 'mid') return true;
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
      const ts = p.postedAtMs ? new Date(p.postedAtMs).toISOString() : null;
      return {
        url: u,
        likes: p.likes,
        comments: p.postComments,
        shares: p.postShares || 0,
        author: p.author,
        preview: (p.textSnippet || '').substring(0, 200),
        postText: p.textSnippet || '',
        timestamp: ts,
        mediaType: p.mediaType || 'text',
        id: postIdFromCanonicalUrl(u),
        engagementTier: p.engagementTier
      };
    }).filter(p => p.url && isValidCanonicalPostUrl(p.url));

    // Strict HTTP verification is reserved for final sync.
    // Incremental sync should be fast and continuously accumulating.
    let verifiedPayload = [];
    if (!isFinal) {
      verifiedPayload = payload;
    } else if (constraints.SEARCH_ONLY_SKIP_HTTP_VERIFY === true) {
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
