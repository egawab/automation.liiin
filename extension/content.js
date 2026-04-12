// ═══════════════════════════════════════════════════════════
// LinkedIn Precision Extraction Engine v5 (Re-Injectable)
// Injected by background.js via chrome.scripting.executeScript
// ═══════════════════════════════════════════════════════════
// Fixes applied:
// FIX-A: DOM virtualization — never store element references across phases.
//        At comment time, re-query by URL (data-urn / link) so the element
//        is always live, not a detached stale reference.
// FIX-B: Per-comment retry loop — if a post fails (no button, no editor,
//        detached element) we try the NEXT post for THE SAME comment before
//        giving up. commentIdx only advances on confirmed success.
// FIX-C: Incomplete-cycle signal — if we exhaust all candidate posts and
//        still haven't placed all comments, we send JOB_COMPLETED with the
//        real counts so background.js (FIX-3) can decide not to consume the
//        cycle slot.
// FIX-D: Scroll-to-post re-query — instead of scrollIntoView on a stale
//        element reference, we scroll to position by re-finding the element
//        right before clicking, giving LinkedIn time to mount it.
// ═══════════════════════════════════════════════════════════

// Clean up any previous injection's listener before registering fresh
if (window.__linkedInExtractorCleanup) {
  try { window.__linkedInExtractorCleanup(); } catch(e) {}
}
window.__linkedInExtractorReady = true;

{
  let isExtracting = false;

  function messageHandler(request, sender, sendResponse) {
    if (request.action === 'EXECUTE_SEARCH') {
      sendResponse({ received: true });
      console.log(`[Ext] ✅ Received EXECUTE_SEARCH for: "${request.keyword}"`);
      runExtraction(request.keyword, request.settings, request.comments, request.dashboardUrl, request.userId);
    }
  }
  chrome.runtime.onMessage.addListener(messageHandler);

  // Expose global for direct injection (bypasses message race conditions)
  window.__startExtraction = function(keyword, settings, comments, dashboardUrl, userId) {
    console.log(`[Ext] ✅ Direct injection start for: "${keyword}"`);
    runExtraction(keyword, settings, comments, dashboardUrl, userId);
  };

  // Expose cleanup so next injection can remove this listener
  window.__linkedInExtractorCleanup = () => {
    chrome.runtime.onMessage.removeListener(messageHandler);
    console.log('[Ext] 🧹 Previous listener cleaned up.');
  };

  async function runExtraction(keyword, settings, comments, dashboardUrl, userId) {
    if (isExtracting) { console.log("[Ext] ⏭️ Already running, skip."); return; }
    isExtracting = true;
    try { await extractPipeline(keyword, settings, comments, dashboardUrl, userId); }
    catch (e) {
      console.error("[Ext] ❌ Fatal:", e);
      try {
        chrome.runtime.sendMessage({ action: 'JOB_FAILED', error: String(e) }, () => {
          if (chrome.runtime.lastError) { /* ignore */ }
        });
      } catch(x){}
    }
    finally { isExtracting = false; }
  }

  // ─── Helpers ───

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  async function wait(min, max) { await sleep(Math.floor(Math.random() * (max - min + 1)) + min); }

  function num(t) {
    if (!t) return 0;
    const s = String(t).toLowerCase().replace(/,/g, '').trim();
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (s.includes('k')) n *= 1000;
    if (s.includes('m')) n *= 1000000;
    return Math.round(n);
  }

  // ─── FIX-A: Live element lookup by URL ───
  // Instead of storing a stale DOM reference, call this right before interacting
  // with a post. It re-queries the live DOM using the post's URL/URN.
  function findLivePostElement(postUrl) {
    if (!postUrl) return null;

    // Extract the URN from the URL (handles both activity: and ugcPost: forms)
    const urnMatch = postUrl.match(/urn:li:(activity|ugcPost):\d+/);
    const urn = urnMatch ? urnMatch[0] : null;

    // Strategy 1: data-urn attribute on a container
    if (urn) {
      const byUrn = document.querySelector(`[data-urn="${urn}"]`);
      if (byUrn) return byUrn;

      // Strategy 2: parent of any element with matching data-urn
      const inner = document.querySelector(`[data-urn*="${urn}"]`);
      if (inner) {
        const parent = inner.closest('li, div.artdeco-card, .reusable-search__result-container, .entity-result, article, [data-view-name="feed-full-update"]');
        if (parent) return parent;
        return inner;
      }
    }

    // Strategy 3: find the anchor with this href, then walk up to the post card
    const encodedUrn = urn ? encodeURIComponent(urn) : null;
    const selectors = encodedUrn
      ? [`a[href*="${urn}"]`, `a[href*="${encodedUrn}"]`]
      : [`a[href*="${postUrl}"]`];

    for (const sel of selectors) {
      try {
        const link = document.querySelector(sel);
        if (link) {
          const card = link.closest('li, div.artdeco-card, .reusable-search__result-container, .entity-result, article, [data-view-name="feed-full-update"]');
          if (card) return card;
        }
      } catch(e) {}
    }

    // Strategy 4: scan all containers for a link containing this URL's path
    const path = postUrl.replace('https://www.linkedin.com', '');
    const allLinks = document.querySelectorAll('a[href]');
    for (const a of allLinks) {
      if (a.href && a.href.includes(path.split('?')[0])) {
        const card = a.closest('li, div.artdeco-card, .reusable-search__result-container, .entity-result, article');
        if (card) return card;
      }
    }

    return null;
  }

  // ─── Main Pipeline ───

  async function extractPipeline(keyword, settings, comments, dashboardUrl, userId) {
    const minL = settings.minLikes || 0;
    const minC = settings.minComments || 0;
    const MIN_POSTS = 10;

    console.log(`[Ext] ═══ PIPELINE START ═══`);
    console.log(`[Ext] Keyword: "${keyword}" | Reach: minLikes=${minL}, minComments=${minC}`);
    console.log(`[Ext] Assigned comments: ${comments ? comments.length : 0}`);
    console.log(`[Ext] Current URL: ${window.location.href}`);

    // ── Safe message sender ──
    function safeSend(msg) {
      try {
        chrome.runtime.sendMessage(msg, () => {
          if (chrome.runtime.lastError) { /* silently ignore */ }
        });
      } catch(e) {}
    }

    // ── Heartbeat & Status helper ──
    function heartbeat(phase, statusMessage = '') {
      safeSend({ action: 'HEARTBEAT', phase });
      if (statusMessage) {
        safeSend({ action: 'LIVE_STATUS', text: statusMessage });
      }
    }

    // ── PHASE 1: Wait for page + click Posts tab ──
    console.log(`[Ext] ⏳ Phase 1: Page hydration...`);
    heartbeat('Phase1-Hydration', '⏳ Hydrating page and matching assets...');
    await wait(5000, 7000);

    if (!window.location.href.includes('/content/')) {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.innerText.trim() === 'Posts' || b.innerText.includes('Posts'));
      if (btn) {
        console.log('[Ext]    Clicking "Posts" filter button...');
        btn.click();
        await wait(5000, 7000);
      }
    }

    // ── PHASE 2: Scroll to load content ──
    console.log(`[Ext] 📜 Phase 2: Scrolling 25 cycles...`);
    heartbeat('Phase2-Scrolling', '📜 Initializing scrolling bypass...');

    function findScrollContainer() {
      const candidates = [
        '.scaffold-layout__main',
        '.scaffold-layout__list',
        '.search-results-container',
        '.scaffold-layout__content',
        'main.scaffold-layout__main'
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el && el.scrollHeight > el.clientHeight) {
          console.log(`[Ext]    🎯 Found scrollable container: ${sel} (scrollH=${el.scrollHeight}, clientH=${el.clientHeight})`);
          return el;
        }
      }
      const allDivs = document.querySelectorAll('div[class*="scaffold"], div[class*="search"], main');
      for (const div of allDivs) {
        if (div.scrollHeight > div.clientHeight + 200) {
          console.log(`[Ext]    🎯 Found scrollable fallback: ${div.className.substring(0, 60)}`);
          return div;
        }
      }
      console.log(`[Ext]    ⚠️ No nested scroll container found. Using document.scrollingElement`);
      return document.scrollingElement || document.documentElement;
    }

    const scrollTarget = findScrollContainer();

    for (let i = 0; i < 25; i++) {
      if (typeof scrollTarget.scrollBy === 'function') {
        scrollTarget.scrollBy({ top: 1200, behavior: 'auto' });
      } else {
        scrollTarget.scrollTop += 1200;
      }
      window.dispatchEvent(new Event('scroll'));
      scrollTarget.dispatchEvent(new Event('scroll'));
      await wait(2000, 3500);
      if (i % 5 === 4) heartbeat(`Phase2-Scroll-${i+1}/25`, `📜 Scrolling feed: ${i+1}/25...`);

      const more = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.toLowerCase().includes('show more') ||
        b.innerText.toLowerCase().includes('see more') ||
        b.innerText.toLowerCase().includes('عرض المزيد')
      );
      if (more && more.offsetParent !== null) { more.click(); await wait(2000, 3000); }
    }
    scrollTarget.scroll({ top: 0, behavior: 'auto' });
    await wait(2000, 3000);

    // ── PHASE 3: Discover post containers ──
    heartbeat('Phase3-Discovery', '🔍 Scanning DOM for post containers...');
    console.log(`[Ext] 🔍 Phase 3: Discovering containers...`);

    // Strategy A: Primary CSS selectors
    const selA = [
      '.reusable-search__result-container',
      '.entity-result',
      '.search-results__list-item',
      '.artdeco-list__item',
      '.feed-shared-update-v2',
      'li.artdeco-card',
      '[data-view-name="feed-full-update"]',
      '[data-urn*="activity:"]',
      '[data-urn*="ugcPost:"]'
    ];
    let containers = [];
    for (const sel of selA) {
      const found = document.querySelectorAll(sel);
      found.forEach(el => { if (!containers.includes(el)) containers.push(el); });
    }
    console.log(`[Ext]    Strategy A (CSS selectors): ${containers.length}`);

    const actors = document.querySelectorAll('.update-components-actor, .update-components-actor__container');
    let stratBCount = 0;
    actors.forEach(actor => {
      const parent = actor.closest('li, div.artdeco-card, .reusable-search__result-container, .entity-result, article');
      if (parent && !containers.includes(parent)) { containers.push(parent); stratBCount++; }
    });
    console.log(`[Ext]    Strategy B (Actor parents): +${stratBCount}`);

    const activityLinks = document.querySelectorAll('a[href*="activity"], a[href*="ugcPost"]');
    let stratCCount = 0;
    activityLinks.forEach(link => {
      const parent = link.closest('li, .entity-result, div.artdeco-card, article, div[class*="update"]');
      if (parent && !containers.includes(parent)) { containers.push(parent); stratCCount++; }
    });
    console.log(`[Ext]    Strategy C (Link parents): +${stratCCount}`);

    let stratDCount = 0;
    document.querySelectorAll('div, li, article').forEach(el => {
      if (containers.includes(el) || containers.length >= 150) return;
      const t = el.innerText || '';
      const hasEngagement = (t.includes('Like') || t.includes('إعجاب')) && (t.includes('Comment') || t.includes('تعليق'));
      if (hasEngagement && t.length > 200 && t.length < 10000) {
        containers.push(el);
        stratDCount++;
      }
    });
    console.log(`[Ext]    Strategy D (Semantic): +${stratDCount}`);
    console.log(`[Ext]    TOTAL CONTAINERS: ${containers.length}`);

    if (containers.length === 0) {
      console.error(`[Ext] ❌ ZERO containers! DOM diagnostic:`);
      console.log(`[Ext]    Title: ${document.title}`);
      console.log(`[Ext]    URL: ${window.location.href}`);
      console.log(`[Ext]    Body length: ${document.body.innerText.length}`);
      await syncToDashboard([], "DEBUG_ZERO_CONTAINERS", dashboardUrl, userId,
        `TITLE:${document.title}|URL:${window.location.href}|BODY_LEN:${document.body.innerText.length}|LINKS:${document.links.length}|SAMPLE:${document.body.innerText.substring(0, 300)}`);
      safeSend({ action: 'JOB_COMPLETED', commentsPostedCount: 0, assignedCommentsCount: comments ? comments.length : 0, searchOnlyMode: settings.searchOnlyMode || false });
      return;
    }

    // ── PHASE 4: Extract data from each container ──
    heartbeat('Phase4-Extract', `📊 Extracting metadata from ${containers.length} potentials...`);
    console.log(`[Ext] 📊 Phase 4: Extracting data from ${containers.length} containers...`);
    const allPosts = [];
    const seenUrls = {};
    let noUrlCount = 0;
    let dupCount = 0;

    for (let i = 0; i < containers.length && allPosts.length < 100; i++) {
      const c = containers[i];
      let url = null;

      // URL extraction strategies (unchanged — proven to work)
      if (!url) {
        const link = c.querySelector('a[href*="/feed/update/"], a[href*="urn:li:activity:"], a[href*="urn:li:ugcPost:"]');
        if (link) url = link.href.split('?')[0];
      }
      if (!url) {
        const link = c.querySelector('a.app-aware-link[href*="activity"]');
        if (link) url = link.href.split('?')[0];
      }
      if (!url) {
        const urnEl = c.closest('[data-urn]') || c.querySelector('[data-urn]');
        const urn = urnEl?.getAttribute('data-urn');
        if (urn && (urn.includes('activity') || urn.includes('ugcPost'))) {
          url = 'https://www.linkedin.com/feed/update/' + urn;
        }
      }
      if (!url) {
        const allLinks = c.querySelectorAll('a[href]');
        for (const a of allLinks) {
          const h = a.href;
          if (h.includes('activity:') || h.includes('ugcPost:') || h.includes('/feed/update/')) {
            url = h.split('?')[0]; break;
          }
        }
      }
      if (!url) {
        const postLink = c.querySelector('a[href*="/posts/"]');
        if (postLink) url = postLink.href.split('?')[0];
      }
      if (!url) {
        try {
          const trackingEl = c.querySelector('[data-view-tracking-scope]') || (c.hasAttribute('data-view-tracking-scope') ? c : null);
          if (trackingEl) {
            const raw = trackingEl.getAttribute('data-view-tracking-scope');
            const arr = JSON.parse(raw);
            const items = Array.isArray(arr) ? arr : [arr];
            for (const item of items) {
              const data = item?.breadcrumb?.content?.data;
              if (data && Array.isArray(data)) {
                const str = data.map(b => String.fromCharCode(b)).join('');
                const inner = JSON.parse(str);
                const urn = inner.updateUrn || inner?.controlledUpdateRegion?.updateUrn;
                if (urn) { url = 'https://www.linkedin.com/feed/update/' + urn; break; }
              }
            }
          }
        } catch (e) {}
      }
      if (!url) {
        const html = c.innerHTML;
        let match = html.match(/urn:li:activity:\d+/);
        if (!match) match = html.match(/urn:li:ugcPost:\d+/);
        if (match) url = 'https://www.linkedin.com/feed/update/' + match[0];
      }

      if (!url) { noUrlCount++; continue; }
      if (seenUrls[url]) { dupCount++; continue; }
      seenUrls[url] = true;

      // Engagement extraction
      let likes = 0, commentsCount = 0;
      try {
        const labels = Array.from(c.querySelectorAll('[aria-label]')).map(e => e.getAttribute('aria-label').toLowerCase());
        for (const l of labels) {
          const n = num(l.match(/(\d[\d,]*k?m?)/)?.[0]);
          if (!likes && (l.includes('reaction') || l.includes('like') || l.includes('إعجاب'))) likes = n;
          if (!commentsCount && (l.includes('comment') || l.includes('تعليق'))) commentsCount = n;
        }
        if (!likes || !commentsCount) {
          const texts = Array.from(c.querySelectorAll('button, span.social-details-social-counts__reactions-count, span')).map(e => e.innerText.toLowerCase().trim());
          for (const t of texts) {
            const n = num(t.match(/(\d[\d,]*k?m?)/)?.[0]);
            if (n > 0) {
              if (!likes && (t.includes('like') || t.includes('إعجاب') || t.includes('reaction'))) likes = n;
              if (!commentsCount && (t.includes('comment') || t.includes('تعليق'))) commentsCount = n;
            }
          }
        }
        if (!likes) {
          const reactionCountEl = c.querySelector('.social-details-social-counts__reactions-count, [data-test-id="social-actions__reaction-count"]');
          if (reactionCountEl) likes = num(reactionCountEl.innerText);
        }
        if (!commentsCount) {
          const commentCountEl = c.querySelector('.social-details-social-counts__comments, [data-test-id="social-actions__comments"]');
          if (commentCountEl) commentsCount = num(commentCountEl.innerText);
        }
      } catch (e) {}

      let author = 'Unknown';
      const authorEl = c.querySelector('.update-components-actor__name, .entity-result__title-text, .update-components-actor__title, .update-components-actor__meta a');
      if (authorEl) author = authorEl.innerText.split('\n')[0].trim().substring(0, 80);

      const preview = (c.innerText || '').replace(/[\n\r]+/g, ' ').substring(0, 400).trim();

      // FIX-A: Store only the URL (and metadata) — NOT the element reference.
      // The element will be re-queried live at comment time via findLivePostElement().
      allPosts.push({ url, likes, commentsCount, author, preview });
    }

    console.log(`[Ext]    Extracted: ${allPosts.length} unique posts (${noUrlCount} without URL, ${dupCount} duplicates skipped)`);

    if (allPosts.length === 0) {
      console.error("[Ext] ❌ Extraction produced 0 posts from containers! Sending debug.");
      await syncToDashboard([], "DEBUG_ZERO_EXTRACTED", dashboardUrl, userId,
        `CONTAINERS:${containers.length}|NO_URL:${noUrlCount}|DUP:${dupCount}`);
      safeSend({ action: 'JOB_COMPLETED', commentsPostedCount: 0, assignedCommentsCount: comments ? comments.length : 0, searchOnlyMode: settings.searchOnlyMode || false });
      return;
    }

    // ── PHASE 5: Flexible High-Reach Filter ──
    heartbeat('Phase5-Filtering');
    console.log(`[Ext] 🎯 Phase 5: Applying high-reach filter...`);

    const tier1 = allPosts
      .filter(p => (p.likes || 0) >= minL && (p.commentsCount || 0) >= minC)
      .sort((a, b) => ((b.likes || 0) + (b.commentsCount || 0)) - ((a.likes || 0) + (a.commentsCount || 0)));
    console.log(`[Ext]    Tier 1 (Exact Reach): ${tier1.length} posts`);

    const tier1Set = new Set(tier1.map(p => p.url));
    const tier2 = allPosts
      .filter(p => !tier1Set.has(p.url))
      .filter(p => (p.likes || 0) > 0 || (p.commentsCount || 0) > 0)
      .sort((a, b) => ((b.likes || 0) + (b.commentsCount || 0)) - ((a.likes || 0) + (a.commentsCount || 0)));
    console.log(`[Ext]    Tier 2 (Best Available Fallback): ${tier2.length} posts`);

    const final = [...tier1];
    if (final.length < MIN_POSTS) {
      for (const p of tier2) { if (final.length >= MIN_POSTS) break; final.push(p); }
    }
    console.log(`[Ext] ✅ Final output: ${final.length} posts (${tier1.length} exact, ${final.length - tier1.length} best available)`);

    let commentsPostedThisCycle = 0;
    let availableComments = comments || [];

    // ── PHASE 5b: Autonomous Safe Commenting ──
    if (!settings.searchOnlyMode && comments && comments.length > 0 && final.length > 0) {
      heartbeat('Phase5-AutoComment', `🤖 Analyzing and mapping comments to fresh targets...`);
      console.log(`[Ext] 🤖 Phase 5b: Safe Auto-Commenting enabled. Waiting 3s...`);
      await wait(3000, 5000);

      // ── NO-REPETITION: Load history of already-commented post URLs ──
      let commentedHistory = [];
      let usedCommentHistory = [];
      try {
        const stored = await chrome.storage.local.get(['commentedPosts', 'usedCommentIds']);
        commentedHistory = stored.commentedPosts || [];
        usedCommentHistory = stored.usedCommentIds || [];
      } catch(e) {}
      const commentedSet = new Set(commentedHistory);
      const usedCommentSet = new Set(usedCommentHistory);

      const freshPosts = final.filter(p => p.url && !commentedSet.has(p.url));
      console.log(`[Ext]    ${final.length} total → ${freshPosts.length} fresh (${commentedSet.size} in history)`);

      availableComments = comments.filter(c => !usedCommentSet.has(c.id));

      if (availableComments.length === 0) {
        console.log(`[Ext] ✅ All assigned comments for this cycle are already posted.`);
        safeSend({
          action: 'JOB_COMPLETED',
          commentsPostedCount: comments.length,
          assignedCommentsCount: comments.length,
          searchOnlyMode: false
        });
        return;
      }

      if (freshPosts.length === 0) {
        console.warn(`[Ext] ⚠️ Zero fresh posts remain! Cannot place comments this cycle.`);
        // FIX-C: Report accurately so background.js doesn't consume the cycle slot
        safeSend({
          action: 'JOB_COMPLETED',
          commentsPostedCount: 0,
          assignedCommentsCount: availableComments.length,
          searchOnlyMode: false
        });
        return;
      }

      const commentsNeeded = availableComments.length;
      const successfulTargetPosts = [];
      console.log(`[Ext]    Attempting ${commentsNeeded} comments across ${freshPosts.length} candidate posts...`);

      // ── FIX-B + FIX-A: Per-comment outer loop, per-post inner loop ──
      // Outer loop: iterate over COMMENTS (commentIdx). Each comment must be placed.
      // Inner loop: iterate over POSTS until one accepts the comment.
      // commentIdx only advances after a CONFIRMED post (button clicked or Ctrl+Enter sent).
      // FIX-A: element is re-queried live (findLivePostElement) right before each interaction.

      let postCursor = 0; // tracks which post to try next across all comment attempts

      for (let commentIdx = 0; commentIdx < commentsNeeded; commentIdx++) {
        const commentObj = availableComments[commentIdx];
        const textToType = commentObj.text;
        let commentPlaced = false;

        console.log(`[Ext] 📝 Attempting to place comment ${commentIdx + 1}/${commentsNeeded}: "${textToType.substring(0, 40)}..."`);

        // Try each remaining candidate post for this comment
        while (postCursor < freshPosts.length && !commentPlaced) {
          const p = freshPosts[postCursor];
          postCursor++;

          console.log(`[Ext] 🎯 Trying post ${postCursor}/${freshPosts.length} by ${p.author} for comment ${commentIdx + 1}...`);

          try {
            heartbeat('Phase5-Typing', `⌨️ Comment ${commentIdx+1}/${commentsNeeded}: Scrolling to post by ${p.author}...`);

            // FIX-A + FIX-D: Re-query the live element right now (not a stored reference)
            let liveEl = findLivePostElement(p.url);

            if (!liveEl) {
              // Element not in DOM yet — try scrolling to approximate position to trigger lazy load
              console.log(`[Ext]    ⚠️ Post element not in live DOM. Triggering scroll to load it...`);
              scrollTarget.scrollBy({ top: 800, behavior: 'auto' });
              window.dispatchEvent(new Event('scroll'));
              await wait(2000, 3000);
              liveEl = findLivePostElement(p.url);
            }

            if (!liveEl) {
              console.log(`[Ext]    ⏭️ Post by ${p.author} still not in live DOM after scroll. Trying next post.`);
              continue;
            }

            // Scroll to the live element
            liveEl.scrollIntoView({ behavior: 'auto', block: 'center' });
            window.dispatchEvent(new Event('scroll'));
            document.querySelectorAll('.scaffold-layout__main, .search-results-container').forEach(sc => {
              sc.dispatchEvent(new Event('scroll'));
            });
            await wait(2000, 4000); // Give React time to re-mount virtualized children

            // Re-query element AGAIN after scroll (LinkedIn may have re-rendered it)
            liveEl = findLivePostElement(p.url) || liveEl;

            // 1. Click Comment Button
            let commentBtn = liveEl.querySelector('button.comment-button, button[aria-label*="Comment"], button[aria-label*="تعليق"]');
            if (!commentBtn) {
              commentBtn = Array.from(liveEl.querySelectorAll('button')).find(b => {
                const label = (b.getAttribute('aria-label') || '').toLowerCase();
                const text = (b.innerText || '').toLowerCase();
                return label.includes('comment') || text.includes('comment') || label.includes('تعليق') || text.includes('تعليق');
              });
            }
            if (!commentBtn) {
              console.log(`[Ext]    ⏭️ No comment button on post by ${p.author}. Trying next post.`);
              continue;
            }

            commentBtn.click();
            heartbeat('Phase5-Editor', `💬 Comment ${commentIdx+1}/${commentsNeeded}: Opening editor...`);
            console.log("[Ext]    Comment button clicked. Waiting for editor...");
            await wait(2000, 3500);

            // 2. Find Editor Box — re-query liveEl after click (LinkedIn may remount)
            liveEl = findLivePostElement(p.url) || liveEl;
            let editor = liveEl.querySelector('div.ql-editor, div[role="textbox"], div[contenteditable="true"]');
            if (!editor) {
              const allEditors = document.querySelectorAll('div.ql-editor, div[role="textbox"], div[contenteditable="true"].comments-comment-texteditor__content');
              for (const e of allEditors) {
                if (e.offsetParent !== null && e.innerHTML.trim().length < 50) { editor = e; break; }
              }
            }
            if (!editor) {
              console.log(`[Ext]    ⏭️ No text editor on post by ${p.author}. Trying next post.`);
              // Try to close the comment box we may have opened
              try { commentBtn.click(); } catch(e) {}
              continue;
            }

            heartbeat('Phase5-Typing', `⌨️ Comment ${commentIdx+1}/${commentsNeeded}: Typing ${textToType.length} chars...`);
            console.log("[Ext]    Editor found. Starting human typing...");

            // 3. Human Typewriter + Fallback React Injection
            editor.focus();
            await wait(300, 600);

            // Clear any existing content
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
            await wait(300, 600);

            for (let i = 0; i < textToType.length; i++) {
              editor.focus();
              document.execCommand('insertText', false, textToType[i]);
              await wait(40, 150);
            }

            // Background tab fallback: execCommand may miss characters when tab is unfocused
            if (!editor.innerText || editor.innerText.trim().length === 0 || editor.innerText.trim() !== textToType.trim()) {
              console.warn("[Ext] ⚠️ ExecCommand missed characters (tab unfocused). Injecting via innerHTML...");
              editor.innerHTML = `<p>${textToType}</p>`;
            }

            // Force React to recognize the input
            const inputEvent = new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: textToType });
            editor.dispatchEvent(inputEvent);

            console.log(`[Ext]    Typed ${textToType.length} chars. Reviewing...`);
            heartbeat('Phase5-Submit', `✅ Comment ${commentIdx+1}/${commentsNeeded}: Submitting...`);
            await wait(2000, 4000);

            // 4. Find & Click Submit Button (5-layer detection)
            // Re-query liveEl one final time before hunting for submit button
            liveEl = findLivePostElement(p.url) || liveEl;
            let submitBtn = null;

            submitBtn = liveEl.querySelector('button.comments-comment-box__submit-button');

            if (!submitBtn) {
              let parent = editor.parentElement;
              for (let depth = 0; depth < 10 && parent && !submitBtn; depth++) {
                submitBtn = parent.querySelector('button.comments-comment-box__submit-button');
                if (!submitBtn) submitBtn = parent.querySelector('button[type="submit"]');
                if (!submitBtn) {
                  submitBtn = Array.from(parent.querySelectorAll('button')).find(b => {
                    const txt = (b.innerText || '').trim().toLowerCase();
                    return (txt === 'comment' || txt === 'post' || txt === 'نشر' || txt === 'تعليق') && b.offsetParent !== null;
                  });
                }
                parent = parent.parentElement;
              }
            }

            if (!submitBtn) {
              const allBtns = document.querySelectorAll('button.comments-comment-box__submit-button');
              for (const btn of allBtns) {
                if (btn.offsetParent !== null) { submitBtn = btn; break; }
              }
            }

            if (!submitBtn) {
              const allBtns = Array.from(document.querySelectorAll('button'));
              submitBtn = allBtns.find(b => {
                if (b.offsetParent === null) return false;
                const txt = (b.innerText || '').trim().toLowerCase();
                const label = (b.getAttribute('aria-label') || '').toLowerCase();
                const isBlue = b.className.includes('primary') || getComputedStyle(b).backgroundColor.includes('0, 119, 181') || getComputedStyle(b).backgroundColor.includes('10, 102, 194');
                return (txt === 'comment' && isBlue) || txt === 'post' || txt === 'نشر' ||
                  label.includes('post comment') || label.includes('submit comment');
              });
            }

            // Layer 5: Nuclear — Ctrl+Enter
            if (!submitBtn) {
              console.warn("[Ext] ⚠️ No submit button found. Trying Ctrl+Enter...");
              editor.focus();
              editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, bubbles: true }));
              await wait(1500, 2500);
              console.log(`[Ext] ✅ Comment submitted via Ctrl+Enter: "${textToType.substring(0, 30)}..."`);
              safeSend({ action: 'COMMENT_POSTED', url: p.url });
              commentsPostedThisCycle++;
              p.commentId = commentObj.id;
              successfulTargetPosts.push(p);
              commentPlaced = true;
            }

            if (submitBtn) {
              if (submitBtn.disabled) {
                console.warn(`[Ext] ⚠️ Submit button is disabled. Force-enabling...`);
                submitBtn.removeAttribute('disabled');
                submitBtn.classList.remove('artdeco-button--disabled');
                await wait(200, 500);
              }
              submitBtn.click();
              console.log(`[Ext] ✅ Comment ${commentIdx+1} Posted on post by ${p.author}: "${textToType.substring(0, 30)}..."`);
              safeSend({ action: 'COMMENT_POSTED', url: p.url });
              commentsPostedThisCycle++;
              p.commentId = commentObj.id;
              successfulTargetPosts.push(p);
              commentPlaced = true;
            }

            if (commentPlaced) {
              await wait(4000, 7000); // Rest before next comment
              heartbeat('Phase5-Done', `✅ Comment ${commentIdx+1}/${commentsNeeded} posted successfully!`);

              // Collapse this post's comment section
              try {
                liveEl = findLivePostElement(p.url) || liveEl;
                const closeBtn = liveEl.querySelector('button.comment-button, button[aria-label*="Comment"], button[aria-label*="تعليق"]');
                if (closeBtn) {
                  closeBtn.click();
                  console.log(`[Ext]    🧹 Collapsed comment section for post by ${p.author}.`);
                  await wait(1000, 2000);
                }
              } catch (cleanupErr) { /* silently ignore */ }
            }

          } catch (e) {
            console.error(`[Ext] ❌ Error on post by ${p.author}:`, e.message || e);
            // Don't increment commentIdx — this post failed, try the next one
          }
        } // end while (postCursor < freshPosts.length && !commentPlaced)

        if (!commentPlaced) {
          // FIX-C: We exhausted all candidate posts for this comment
          console.warn(`[Ext] ⚠️ Could not place comment ${commentIdx+1}/${commentsNeeded} — no suitable post found after trying ${postCursor} candidates.`);
          // Break: no point trying remaining comments if we're out of posts
          break;
        }
      } // end for (commentIdx)

      // ── Save history ──
      const newlyCommented = successfulTargetPosts.map(p => p.url).filter(Boolean);
      if (newlyCommented.length > 0) {
        const updatedPosts = [...commentedHistory, ...newlyCommented].slice(-200);
        const usedIds = successfulTargetPosts.map(p => p.commentId).filter(Boolean);
        const updatedComments = [...usedCommentHistory, ...usedIds].slice(-100);
        try {
          await chrome.storage.local.set({
            commentedPosts: updatedPosts,
            usedCommentIds: updatedComments
          });
        } catch(e) {}
        console.log(`[Ext]    📝 Saved ${newlyCommented.length} URLs to history.`);
      }

      // FIX-C: Report exact counts to background.js so it can decide whether to
      // consume the cycle slot (it will only do so if posted >= assigned).
      console.log(`[Ext] 📊 Comment result: ${commentsPostedThisCycle}/${availableComments.length} placed.`);

    } else {
      console.log(`[Ext] 🛡️ Search-Only Mode OR no comments assigned. Skipping engagement.`);
    }

    // ── PHASE 6: Sync to dashboard ──
    heartbeat('Phase6-Sync', '📤 Syncing extraction results to dashboard...');
    if (final.length > 0) {
      console.log(`[Ext] 📤 Phase 6: Syncing ${final.length} posts...`);
      await syncToDashboard(final, keyword, dashboardUrl, userId);
    } else {
      console.warn("[Ext] ⚠️ Zero posts after filtering!");
      await syncToDashboard([], "DEBUG_FILTER_EMPTY", dashboardUrl, userId,
        `ALL:${allPosts.length}|T1:${tier1.length}|T2:${tier2.length}|minL:${minL}|minC:${minC}`);
    }

    // FIX-C: Send accurate counts. background.js v5 requires posted >= assigned
    // before it counts this as a successful cycle.
    safeSend({
      action: 'JOB_COMPLETED',
      commentsPostedCount: commentsPostedThisCycle,
      assignedCommentsCount: availableComments.length,
      searchOnlyMode: settings.searchOnlyMode || false
    });
    console.log(`[Ext] ═══ PIPELINE COMPLETE: ${commentsPostedThisCycle}/${availableComments.length} comments posted ═══`);
  }

  async function syncToDashboard(posts, keyword, dashboardUrl, userId, debug = null) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({
          action: 'SYNC_RESULTS',
          posts, keyword, dashboardUrl, userId, debugInfo: debug
        }, () => {
          if (chrome.runtime.lastError) {
            console.warn("[Ext] Sync message failed safely:", chrome.runtime.lastError.message);
          }
          resolve();
        });
      } catch (err) {
        console.warn("[Ext] Catch sync error safely:", err.message);
        resolve();
      }
    });
  }

} // end scope
