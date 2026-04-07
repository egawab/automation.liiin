// ═══════════════════════════════════════════════════════════
// LinkedIn Precision Extraction Engine v4 (Re-Injectable)
// Injected by background.js via chrome.scripting.executeScript
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

  // Expose cleanup so next injection can remove this listener
  window.__linkedInExtractorCleanup = () => {
    chrome.runtime.onMessage.removeListener(messageHandler);
    console.log('[Ext] 🧹 Previous listener cleaned up.');
  };

  async function runExtraction(keyword, settings, comments, dashboardUrl, userId) {
    if (isExtracting) { console.log("[Ext] ⏭️ Already running, skip."); return; }
    isExtracting = true;
    try { await extractPipeline(keyword, settings, comments, dashboardUrl, userId); }
    catch (e) { console.error("[Ext] ❌ Fatal:", e); chrome.runtime.sendMessage({ action: 'JOB_FAILED', error: String(e) }); }
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

  // ─── Main Pipeline ───

  async function extractPipeline(keyword, settings, comments, dashboardUrl, userId) {
    const minL = settings.minLikes || 0;
    const minC = settings.minComments || 0;
    const MIN_POSTS = 10;

    console.log(`[Ext] ═══ PIPELINE START ═══`);
    console.log(`[Ext] Keyword: "${keyword}" | Reach: minLikes=${minL}, minComments=${minC}`);
    console.log(`[Ext] Current URL: ${window.location.href}`);

    // ── Heartbeat helper ──
    function heartbeat(phase) {
      try { chrome.runtime.sendMessage({ action: 'HEARTBEAT', phase }); } catch(e) {}
    }

    // ── PHASE 1: Wait for page + click Posts tab ──
    console.log(`[Ext] ⏳ Phase 1: Page hydration...`);
    heartbeat('Phase1-Hydration');
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
    heartbeat('Phase2-Scrolling');

    // Smart Scroll: Find LinkedIn's ACTUAL scrollable container
    function findScrollContainer() {
      // LinkedIn nests search results inside these containers with their own overflow
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
      // Fallback: search for any large scrollable div
      const allDivs = document.querySelectorAll('div[class*="scaffold"], div[class*="search"], main');
      for (const div of allDivs) {
        if (div.scrollHeight > div.clientHeight + 200) {
          console.log(`[Ext]    🎯 Found scrollable fallback: ${div.className.substring(0, 60)} (scrollH=${div.scrollHeight})`);
          return div;
        }
      }
      console.log(`[Ext]    ⚠️ No nested scroll container found. Using document.scrollingElement`);
      return document.scrollingElement || document.documentElement;
    }

    const scrollTarget = findScrollContainer();

    for (let i = 0; i < 25; i++) {
      // Smooth scroll the correct container
      scrollTarget.scroll({ top: scrollTarget.scrollTop + 800, behavior: 'smooth' });
      
      await wait(2000, 3500);

      // Send heartbeat every 5 scrolls to keep the monitor alive
      if (i % 5 === 4) heartbeat(`Phase2-Scroll-${i+1}/25`);

      // Click "Show more results" if it appears
      const more = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.toLowerCase().includes('show more') ||
        b.innerText.toLowerCase().includes('see more') ||
        b.innerText.toLowerCase().includes('عرض المزيد')
      );
      if (more && more.offsetParent !== null) { more.click(); await wait(2000, 3000); }
    }
    // Scroll back to top smoothly
    scrollTarget.scroll({ top: 0, behavior: 'smooth' });
    await wait(2000, 3000);

    // ── PHASE 3: Discover post containers ──
    heartbeat('Phase3-Discovery');
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

    // Strategy B: Actor component parents
    const actors = document.querySelectorAll('.update-components-actor, .update-components-actor__container');
    let stratBCount = 0;
    actors.forEach(actor => {
      const parent = actor.closest('li, div.artdeco-card, .reusable-search__result-container, .entity-result, article');
      if (parent && !containers.includes(parent)) { containers.push(parent); stratBCount++; }
    });
    console.log(`[Ext]    Strategy B (Actor parents): +${stratBCount}`);

    // Strategy C: Link-based discovery
    const activityLinks = document.querySelectorAll('a[href*="activity"], a[href*="ugcPost"]');
    let stratCCount = 0;
    activityLinks.forEach(link => {
      const parent = link.closest('li, .entity-result, div.artdeco-card, article, div[class*="update"]');
      if (parent && !containers.includes(parent)) { containers.push(parent); stratCCount++; }
    });
    console.log(`[Ext]    Strategy C (Link parents): +${stratCCount}`);

    // Strategy D: Semantic fallback
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
      console.log(`[Ext]    All links: ${document.links.length}`);
      console.log(`[Ext]    Sample text: ${document.body.innerText.substring(0, 500)}`);
      await syncToDashboard([], "DEBUG_ZERO_CONTAINERS", dashboardUrl, userId,
        `TITLE:${document.title}|URL:${window.location.href}|BODY_LEN:${document.body.innerText.length}|LINKS:${document.links.length}|SAMPLE:${document.body.innerText.substring(0, 300)}`);
      chrome.runtime.sendMessage({ action: 'JOB_COMPLETED' });
      return;
    }

    // ── PHASE 4: Extract data from each container ──
    console.log(`[Ext] 📊 Phase 4: Extracting data from ${containers.length} containers...`);
    const allPosts = [];
    const seenUrls = {};
    let noUrlCount = 0;
    let dupCount = 0;

    for (let i = 0; i < containers.length && allPosts.length < 100; i++) {
      const c = containers[i];

      // ── URL extraction: 6 strategies, NO fake URLs ──
      let url = null;

      // Strategy 1: Direct link selectors (most common)
      if (!url) {
        const link = c.querySelector('a[href*="/feed/update/"], a[href*="urn:li:activity:"], a[href*="urn:li:ugcPost:"]');
        if (link) url = link.href.split('?')[0];
      }

      // Strategy 2: app-aware-link with activity reference
      if (!url) {
        const link = c.querySelector('a.app-aware-link[href*="activity"]');
        if (link) url = link.href.split('?')[0];
      }

      // Strategy 3: data-urn attribute on container or child
      if (!url) {
        const urnEl = c.closest('[data-urn]') || c.querySelector('[data-urn]');
        const urn = urnEl?.getAttribute('data-urn');
        if (urn && (urn.includes('activity') || urn.includes('ugcPost'))) {
          url = 'https://www.linkedin.com/feed/update/' + urn;
        }
      }

      // Strategy 4: Scan ALL links for any containing activity/ugcPost URN
      if (!url) {
        const allLinks = c.querySelectorAll('a[href]');
        for (const a of allLinks) {
          const h = a.href;
          if (h.includes('activity:') || h.includes('ugcPost:') || h.includes('/feed/update/')) {
            url = h.split('?')[0];
            break;
          }
        }
      }

      // Strategy 5: LinkedIn /posts/ style URLs
      if (!url) {
        const postLink = c.querySelector('a[href*="/posts/"]');
        if (postLink) url = postLink.href.split('?')[0];
      }

      // Strategy 6: Decode tracking scope data for embedded URN
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

      // Strategy 7: Bulletproof HTML Regex Fallback
      if (!url) {
        const html = c.innerHTML;
        let match = html.match(/urn:li:activity:\d+/);
        if (!match) match = html.match(/urn:li:ugcPost:\d+/);
        if (match) {
          url = 'https://www.linkedin.com/feed/update/' + match[0];
        }
      }

      // ── SKIP posts without a real LinkedIn URL ──
      if (!url) { noUrlCount++; continue; }
      if (seenUrls[url]) { dupCount++; continue; }
      seenUrls[url] = true;

      // Engagement extraction
      let likes = 0, comments = 0;
      try {
        const labels = Array.from(c.querySelectorAll('[aria-label]')).map(e => e.getAttribute('aria-label').toLowerCase());
        for (const l of labels) {
          const n = num(l.match(/(\d[\d,]*k?m?)/)?.[0]);
          if (!likes && (l.includes('reaction') || l.includes('like') || l.includes('إعجاب'))) likes = n;
          if (!comments && (l.includes('comment') || l.includes('تعليق'))) comments = n;
        }
        if (!likes || !comments) {
          const texts = Array.from(c.querySelectorAll('button, span.social-details-social-counts__reactions-count, span')).map(e => e.innerText.toLowerCase().trim());
          for (const t of texts) {
            const n = num(t.match(/(\d[\d,]*k?m?)/)?.[0]);
            if (n > 0) {
              if (!likes && (t.includes('like') || t.includes('إعجاب') || t.includes('reaction'))) likes = n;
              if (!comments && (t.includes('comment') || t.includes('تعليق'))) comments = n;
            }
          }
        }
        // Fallback: try to find raw numbers near engagement buttons
        if (!likes) {
          const reactionCountEl = c.querySelector('.social-details-social-counts__reactions-count, [data-test-id="social-actions__reaction-count"]');
          if (reactionCountEl) likes = num(reactionCountEl.innerText);
        }
        if (!comments) {
          const commentCountEl = c.querySelector('.social-details-social-counts__comments, [data-test-id="social-actions__comments"]');
          if (commentCountEl) comments = num(commentCountEl.innerText);
        }
      } catch (e) {}

      // Author
      let author = 'Unknown';
      const authorEl = c.querySelector('.update-components-actor__name, .entity-result__title-text, .update-components-actor__title, .update-components-actor__meta a');
      if (authorEl) author = authorEl.innerText.split('\n')[0].trim().substring(0, 80);

      const preview = (c.innerText || '').replace(/[\n\r]+/g, ' ').substring(0, 400).trim();

      allPosts.push({ url, likes, commentsCount: comments, author, preview, element: c });
    }

    console.log(`[Ext]    Extracted: ${allPosts.length} unique posts (${noUrlCount} without original URL, ${dupCount} duplicates skipped)`);

    if (allPosts.length === 0) {
      console.error("[Ext] ❌ Extraction produced 0 posts from containers! Sending debug.");
      await syncToDashboard([], "DEBUG_ZERO_EXTRACTED", dashboardUrl, userId,
        `CONTAINERS:${containers.length}|NO_URL:${noUrlCount}|DUP:${dupCount}`);
      chrome.runtime.sendMessage({ action: 'JOB_COMPLETED' });
      return;
    }

    // ── PHASE 5: Flexible High-Reach Filter ──
    heartbeat('Phase5-Filtering');
    console.log(`[Ext] 🎯 Phase 5: Applying high-reach filter...`);

    // Tier 1: EXACT match — sorted by HIGHEST REACH (NaN-safe)
    const tier1 = allPosts
      .filter(p => (p.likes || 0) >= minL && (p.commentsCount || 0) >= minC)
      .sort((a, b) => {
        const rA = (a.likes || 0) + (a.commentsCount || 0);
        const rB = (b.likes || 0) + (b.commentsCount || 0);
        return rB - rA; // highest reach first
      });
    console.log(`[Ext]    Tier 1 (Exact Reach): ${tier1.length} posts`);

    // Tier 2: BEST AVAILABLE fallback (ranked strictly by highest reach, ignoring distance)
    const tier1Set = new Set(tier1.map(p => p.url));
    const tier2 = allPosts
      .filter(p => !tier1Set.has(p.url))
      // Strictly avoid 0-engagement trash in the fallback
      .filter(p => (p.likes || 0) > 0 || (p.commentsCount || 0) > 0)
      .sort((a, b) => {
        const rA = (a.likes || 0) + (a.commentsCount || 0);
        const rB = (b.likes || 0) + (b.commentsCount || 0);
        return rB - rA; 
      });
    console.log(`[Ext]    Tier 2 (Best Available Fallback): ${tier2.length} posts`);

    // Assemble final — ALL Tier 1, pad with Tier 2 if under MIN_POSTS
    const final = [];
    for (const p of tier1) { final.push(p); }
    if (final.length < MIN_POSTS) {
      for (const p of tier2) { if (final.length >= MIN_POSTS) break; final.push(p); }
    }
    console.log(`[Ext] ✅ Final output: ${final.length} posts (${tier1.length} exact, ${final.length - tier1.length} best available)`);

    let commentsPostedThisCycle = 0;

    // ── PHASE 5b: Autonomous Safe Commenting (Hybrid Relayer) ──
    if (!settings.searchOnlyMode && comments && comments.length > 0 && final.length > 0) {
      console.log(`[Ext] 🤖 Phase 5b: Safe Auto-Commenting enabled. Waiting 3s...`);
      await wait(3000, 5000);
      
      // ── NO-REPETITION: Load history of already-commented post URLs ──
      let commentedHistory = [];
      let usedCommentHistory = [];
      try {
        const stored = await chrome.storage.local.get(['commentedPosts', 'usedCommentTexts']);
        commentedHistory = stored.commentedPosts || [];
        usedCommentHistory = stored.usedCommentTexts || [];
      } catch(e) {}
      const commentedSet = new Set(commentedHistory);
      const usedCommentSet = new Set(usedCommentHistory);

      // Filter out posts we've already commented on in previous runs
      const freshPosts = final.filter(p => p.url && !commentedSet.has(p.url));
      console.log(`[Ext]    ${final.length} total → ${freshPosts.length} fresh (${commentedSet.size} in history)`);

      if (freshPosts.length === 0) {
        console.warn(`[Ext] ⚠️ Zero fresh posts remain! Skipping commenting phase for this cycle.`);
      } else {
        let targetPosts = freshPosts.slice(0, 2);

        // ── STRICT COMMENT MAPPING (No randomness) ──
        // The background worker already filters 'comments' to exactly the ones assigned to this cycle
        if (!comments || comments.length === 0) {
          console.warn(`[Ext] ⚠️ No comments mapped to this cycle! Skipping comment phase.`);
          targetPosts = []; // Clear target posts to skip commenting
        }

        let successfulTargetPosts = [];

        for (let idx = 0; idx < targetPosts.length; idx++) {
          const p = targetPosts[idx];
          if (!p.element) continue;

          // Strictly map the array: comment 0 -> post 0, comment 1 -> post 1
          let commentObj = comments[idx % comments.length];
          const textToType = commentObj.text;
          
          try {
          console.log(`[Ext] 🎯 Engaging with post by ${p.author}...`);
          p.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await wait(2000, 4000); // Read the post
          
          // 1. Click Comment Button (broad selectors)
          let commentBtn = p.element.querySelector('button.comment-button, button[aria-label*="Comment"], button[aria-label*="تعليق"]');
          if (!commentBtn) {
            commentBtn = Array.from(p.element.querySelectorAll('button')).find(b => {
              const label = (b.getAttribute('aria-label') || '').toLowerCase();
              const text = (b.innerText || '').toLowerCase();
              return label.includes('comment') || text.includes('comment') || label.includes('تعليق') || text.includes('تعليق');
            });
          }
          if (!commentBtn) { console.log("[Ext] ⏭️ No comment button found, skipping."); continue; }
          commentBtn.click();
          console.log("[Ext]    Comment button clicked. Waiting for editor...");
          await wait(2000, 3500); // Wait for editor to expand
          
          // 2. Find Editor Box (search post element first, then broader DOM)
          let editor = p.element.querySelector('div.ql-editor, div[role="textbox"], div[contenteditable="true"]');
          if (!editor) {
            // LinkedIn sometimes renders comment forms outside the post card
            const allEditors = document.querySelectorAll('div.ql-editor, div[role="textbox"], div[contenteditable="true"].comments-comment-texteditor__content');
            for (const e of allEditors) {
              if (e.offsetParent !== null && e.innerHTML.trim().length < 50) { editor = e; break; }
            }
          }
          if (!editor) { console.log("[Ext] ⏭️ No text editor found, skipping."); continue; }
          console.log("[Ext]    Editor found. Starting human typing...");
          
          // 3. Human Typewriter (char-by-char via execCommand on EDITOR focus)
          editor.focus();
          await wait(300, 600);
          // Select all existing content and delete it
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          await wait(300, 600);
          
          // Type each character with random human-like jitter
          for (let i = 0; i < textToType.length; i++) {
            editor.focus(); // Re-focus each time to prevent React detach issues
            document.execCommand('insertText', false, textToType[i]);
            // Random jitter: 40-150ms per keystroke (human range)
            await wait(40, 150);
          }
          console.log(`[Ext]    Typed ${textToType.length} chars. Reviewing...`);
          await wait(2000, 4000); // Pause to "review" the comment
          
          // 4. Find & Click Submit Button (5-layer detection)
          let submitBtn = null;
          
          // Layer 1: LinkedIn's known class on the post element
          submitBtn = p.element.querySelector('button.comments-comment-box__submit-button');
          
          // Layer 2: Traverse UP from editor to find enclosing form/container
          if (!submitBtn) {
            let parent = editor.parentElement;
            for (let depth = 0; depth < 10 && parent && !submitBtn; depth++) {
              submitBtn = parent.querySelector('button.comments-comment-box__submit-button');
              if (!submitBtn) submitBtn = parent.querySelector('button[type="submit"]');
              // Look for blue "Comment" button specifically
              if (!submitBtn) {
                submitBtn = Array.from(parent.querySelectorAll('button')).find(b => {
                  const txt = (b.innerText || '').trim().toLowerCase();
                  return (txt === 'comment' || txt === 'post' || txt === 'نشر' || txt === 'تعليق') && b.offsetParent !== null;
                });
              }
              parent = parent.parentElement;
            }
          }
          
          // Layer 3: Find any submit button using document-wide search
          if (!submitBtn) {
            const allBtns = document.querySelectorAll('button.comments-comment-box__submit-button');
            for (const btn of allBtns) {
              if (btn.offsetParent !== null) { submitBtn = btn; break; }
            }
          }
          
          // Layer 4: Any visible blue button labeled "Comment" on the entire page
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
          
          // Layer 5: Nuclear option — simulate Enter key on editor
          if (!submitBtn) {
            console.warn("[Ext] ⚠️ No submit button found via any selector. Trying Ctrl+Enter...");
            editor.focus();
            editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, bubbles: true }));
            await wait(1000, 2000);
            console.log(`[Ext] ✅ Comment submitted via Ctrl+Enter: "${textToType.substring(0, 30)}..."`);
            chrome.runtime.sendMessage({ action: 'COMMENT_POSTED', url: p.url });
          }
          
          if (submitBtn) {
            if (submitBtn.disabled) {
              console.warn(`[Ext] ⚠️ Submit button is disabled. Force-enabling...`);
              submitBtn.removeAttribute('disabled');
              submitBtn.classList.remove('artdeco-button--disabled');
              await wait(200, 500);
            }
            submitBtn.click();
            console.log(`[Ext] ✅ Comment Posted: "${textToType.substring(0, 30)}..."`);
            chrome.runtime.sendMessage({ action: 'COMMENT_POSTED', url: p.url });
            commentsPostedThisCycle++;
            successfulTargetPosts.push(p);
          }
          
          await wait(4000, 7000); // Rest before next action

          // 5. CLEANUP: Collapse this post's comment section so the next post's
          //    editor detection doesn't accidentally re-target this one.
          try {
            // Click the comment button again to toggle/collapse the editor
            const closeBtn = p.element.querySelector('button.comment-button, button[aria-label*="Comment"], button[aria-label*="تعليق"]');
            if (closeBtn) {
              closeBtn.click();
              console.log(`[Ext]    🧹 Collapsed comment section for post by ${p.author}.`);
              await wait(1000, 2000);
            }
          } catch (cleanupErr) { /* silently ignore cleanup failures */ }

        } catch (e) {
          console.error(`[Ext] ❌ Error Auto-Commenting:`, e);
        }
        } // closes for loop

        // ── Save newly commented URLs and used texts to history ──
        const newlyCommented = successfulTargetPosts.map(p => p.url).filter(Boolean);
        if (newlyCommented.length > 0) {
          const updatedPosts = [...commentedHistory, ...newlyCommented].slice(-200);
          const usedTexts = comments.map(c => c.text); // since we strictly mapped them 
          const updatedComments = [...usedCommentHistory, ...usedTexts].slice(-50);
          try { 
            await chrome.storage.local.set({ 
              commentedPosts: updatedPosts,
              usedCommentTexts: updatedComments 
            }); 
          } catch(e) {}
          console.log(`[Ext]    📝 Saved ${newlyCommented.length} URLs to history (total URLs: ${updatedPosts.length}, total Comments: ${updatedComments.length})`);
        }
      } // closes else block
    } else {
      console.log(`[Ext] 🛡️ Search-Only Mode Active OR No Comments found. Skipping engagement.`);
    }

    // ── PHASE 6: Sync to dashboard ──
    heartbeat('Phase6-Sync');
    if (final.length > 0) {
      console.log(`[Ext] 📤 Phase 6: Syncing ${final.length} posts...`);
      await syncToDashboard(final, keyword, dashboardUrl, userId);
    } else {
      console.warn("[Ext] ⚠️ Zero posts after filtering!");
      await syncToDashboard([], "DEBUG_FILTER_EMPTY", dashboardUrl, userId,
        `ALL:${allPosts.length}|T1:${tier1.length}|T2:${tier2.length}|minL:${minL}|minC:${minC}`);
    }

    chrome.runtime.sendMessage({ 
      action: 'JOB_COMPLETED', 
      commentsPostedCount: commentsPostedThisCycle,
      searchOnlyMode: settings.searchOnlyMode || false
    });
    console.log(`[Ext] ═══ PIPELINE COMPLETE ═══`);
  }

  async function syncToDashboard(posts, keyword, dashboardUrl, userId, debug = null) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'SYNC_RESULTS',
        posts, keyword, dashboardUrl, userId, debugInfo: debug
      }, () => resolve());
    });
  }

} // end scope
