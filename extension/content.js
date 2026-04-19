// ═══════════════════════════════════════════════════════════
// LinkedIn Precision Extraction Engine v7.5 (Safety-Hardened)
// ═══════════════════════════════════════════════════════════
// v7 Architecture:
//
// PHASE 1 — DEEP DISCOVERY SCROLL
//   Scroll 30 steps to collect a large candidate pool.
//   NO commenting during this phase. Ensures adequate post
//   discovery regardless of account/feed variation.
//
// PHASE 2 — RANKING & SELECTION
//   Apply reach criteria (minLikes, minComments).
//   Graceful degradation: if not enough strict matches,
//   fall back to highest-engagement available posts.
//   Guarantees the required number of comment targets.
//
// PHASE 3 — SEQUENTIAL COMMENTING
//   Comment on each selected target one at a time.
//   Container-scoped editor/submit detection only.
//   Post-submit verification before counting success.
//   One comment per post — enforced by URL dedup.
//
// PHASE 4 — SYNC & REPORT
//   Relay all discovered posts + results to dashboard.
// ═══════════════════════════════════════════════════════════

if (window.__linkedInExtractorCleanup) {
  try { window.__linkedInExtractorCleanup(); } catch(e) {}
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

  window.__startExtraction = function(keyword, settings, comments, dashboardUrl, userId) {
    console.log(`[Ext] ✅ Direct injection start for: "${keyword}"`);
    runExtraction(keyword, settings, comments, dashboardUrl, userId);
  };

  window.__linkedInExtractorCleanup = () => {
    chrome.runtime.onMessage.removeListener(messageHandler);
  };

  async function runExtraction(keyword, settings, comments, dashboardUrl, userId) {
    if (isExtracting) { console.log("[Ext] ⏭️ Already running, skip."); return; }
    isExtracting = true;
    try { await extractPipeline(keyword, settings, comments, dashboardUrl, userId); }
    catch (e) {
      console.error("[Ext] ❌ Fatal:", e);
      try { chrome.runtime.sendMessage({ action: 'JOB_FAILED', error: String(e) }, () => { if (chrome.runtime.lastError) {} }); } catch(x){}
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

  function safeSend(msg) {
    try { chrome.runtime.sendMessage(msg, () => { if (chrome.runtime.lastError) {} }); } catch(e) {}
  }

  function heartbeat(phase, statusMessage) {
    safeSend({ action: 'HEARTBEAT', phase });
    if (statusMessage) safeSend({ action: 'LIVE_STATUS', text: statusMessage });
  }

  // ─── Background-safe text injection ───
  function injectTextIntoEditor(editor, text) {
    try {
      editor.focus();
      editor.innerHTML = '';
      editor.innerText = text;

      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true,
        inputType: 'insertText', data: text
      }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));

      console.log(`[Ext]    ✅ Text injected (${text.length} chars)`);
      return true;
    } catch(e) {
      console.warn('[Ext]    ⚠️ injectTextIntoEditor error:', e.message);
      return false;
    }
  }

  // ─── Extract URN from a container element ───
  // v7.1: Also handles data-chameleon-result-urn and data-view-tracking-scope
  function extractUrn(el) {
    try {
      // Method 1: Direct data-urn attribute
      const directUrn = el.getAttribute('data-urn') || '';
      if (directUrn.includes('activity:') || directUrn.includes('ugcPost:')) return directUrn;

      // Method 2: data-chameleon-result-urn (modern LinkedIn search results)
      const chameleonUrn = el.getAttribute('data-chameleon-result-urn') || '';
      if (chameleonUrn.includes('activity:') || chameleonUrn.includes('ugcPost:') || chameleonUrn.includes('share:')) return chameleonUrn;

      // Method 3: Child element with data-urn
      const urnEl = el.querySelector('[data-urn*="activity:"], [data-urn*="ugcPost:"]');
      if (urnEl) return urnEl.getAttribute('data-urn');

      // Method 4: Child element with data-chameleon-result-urn
      const chameleonEl = el.querySelector('[data-chameleon-result-urn]');
      if (chameleonEl) {
        const cUrn = chameleonEl.getAttribute('data-chameleon-result-urn') || '';
        if (cUrn.includes('activity:') || cUrn.includes('ugcPost:') || cUrn.includes('share:')) return cUrn;
      }

      // Method 5: data-view-tracking-scope (breadcrumb-encoded URN)
      const trackingEls = [el, ...el.querySelectorAll('[data-view-tracking-scope]')];
      for (const tel of trackingEls) {
        try {
          const raw = tel.getAttribute('data-view-tracking-scope');
          if (!raw) continue;
          const arr = JSON.parse(raw);
          const items = Array.isArray(arr) ? arr : [arr];
          for (const item of items) {
            // Try breadcrumb.content.data format
            const data = item?.breadcrumb?.content?.data;
            if (data && Array.isArray(data)) {
              const str = data.map(b => String.fromCharCode(b)).join('');
              const inner = JSON.parse(str);
              const urn = inner.updateUrn || inner?.controlledUpdateRegion?.updateUrn;
              if (urn) return urn;
            }
            // Try value format
            const value = item?.value;
            if (value && Array.isArray(value)) {
              const str2 = value.map(b => String.fromCharCode(b)).join('');
              const inner2 = JSON.parse(str2);
              const urn2 = inner2.updateUrn || inner2?.controlledUpdateRegion?.updateUrn;
              if (urn2) return urn2;
            }
          }
        } catch(e) { /* tracking scope parse failed, continue */ }
      }

      // Method 6: Anchor link with /feed/update/
      const link = el.querySelector('a[href*="/feed/update/"], a[href*="urn:li:activity:"], a[href*="urn:li:ugcPost:"]');
      if (link) {
        const match = link.href.match(/urn:li:(activity|ugcPost):\d+/);
        if (match) return match[0];
      }

      // Method 7: Any anchor with activity/ugcPost/share or /posts/ in href
      const allLinks = el.querySelectorAll('a[href]');
      for (const a of allLinks) {
        const href = a.href || '';
        const m = href.match(/urn:li:(activity|ugcPost|share):\d+/);
        if (m) return m[0];
        // Check for SEO-friendly /posts/ URLs
        if (href.includes('/posts/') || href.includes('-activity-') || href.includes('-ugcPost-')) {
          return href.split('?')[0]; // Return the direct URL
        }
      }

      // Method 8: Brute-force innerHTML scan (last resort)
      const html = el.innerHTML || '';
      const m = html.match(/urn:li:(activity|ugcPost):\d+/);
      if (m) return m[0];
      
      // If no valid URL can be constructed, we must cleanly abort this node
      // rather than injecting broken fallback hashes into the database.
      return null;
    } catch(e) { return null; }
  }

  function urnToUrl(urn) {
    if (!urn) return null;
    if (urn.startsWith('http')) return urn.split('?')[0];
    return 'https://www.linkedin.com/feed/update/' + urn;
  }

  // ─── Age Parser Helper ───
  function parseAgeToHours(ageStr) {
    if (!ageStr) return 9999;
    const s = ageStr.toLowerCase().replace(/[^a-z0-9]/g, '');
    const m = s.match(/(\d+)(m|h|d|w|mo|y)/);
    if (!m) return 9999;
    const val = parseInt(m[1]);
    const unit = m[2];
    if (unit === 'm') return Math.max(0.1, val / 60);
    if (unit === 'h') return val;
    if (unit === 'd') return val * 24;
    if (unit === 'w') return val * 168;
    if (unit === 'mo') return val * 720;
    if (unit === 'y') return val * 8760;
    return 9999;
  }

  // ─── Extract engagement metrics from a container ───
  function extractMetrics(container) {
    let likes = 0, postComments = 0, author = 'Unknown', ageHours = 9999, textSnippet = '';
    try {
      const labels = Array.from(container.querySelectorAll('[aria-label]'));
      for (const el of labels) {
        const l = (el.getAttribute('aria-label') || '').toLowerCase();
        const n = num(l.match(/(\d[\d,]*k?m?)/)?.[0]);
        if (!likes        && (l.includes('reaction') || l.includes('like')    || l.includes('إعجاب'))) likes = n;
        if (!postComments && (l.includes('comment')  || l.includes('تعليق'))) postComments = n;
      }

      // Try multiple author selectors (different LinkedIn layouts)
      const authorSelectors = [
        '.update-components-actor__name',
        '.entity-result__title-text',
        '.update-components-actor__title',
        '.feed-shared-actor__name',
        '.feed-shared-actor__title',
        'span.feed-shared-actor__name',
        'a.app-aware-link span[dir="ltr"]',
        '.update-components-actor__meta-link span',
      ];
      for (const sel of authorSelectors) {
        const ae = container.querySelector(sel);
        if (ae && ae.innerText.trim().length > 0) {
          author = ae.innerText.split('\n')[0].trim().substring(0, 80);
          break;
        }
      }

      // Fallback: take the first bold/strong text or the first line of text
      if (author === 'Unknown') {
        const boldEl = container.querySelector('strong, b, [class*="actor"], [class*="author"]');
        if (boldEl && boldEl.innerText.trim().length > 2) {
          author = boldEl.innerText.split('\n')[0].trim().substring(0, 80);
        }
      }

      // Engagement fallback: parse from visible text if aria-labels failed
      if (likes === 0 && postComments === 0) {
        const text = (container.innerText || '').replace(/[\n\r]/g, ' ');
        const mLike = text.match(/(\d[\d,]*)\s*(reactions?|likes?)/i);
        if (mLike) likes = num(mLike[1]);
        const mComm = text.match(/(\d[\d,]*)\s*comments?/i);
        if (mComm) postComments = num(mComm[1]);
      }
      
      // Extract Post Body / Preview text
      try {
        const textEls = container.querySelectorAll('.feed-shared-update-v2__commentary, .update-components-text .break-words, .feed-shared-text, .update-components-text, .feed-shared-update-v2__description, .entity-result__content-summary');
        for (const el of textEls) {
           if (el.innerText && el.innerText.trim().length > 10) {
              textSnippet = el.innerText.replace(/[\n\r]+/g, ' ').trim().substring(0, 400);
              break;
           }
        }
        if (!textSnippet) {
           textSnippet = (container.innerText || '').replace(/[\n\r]+/g, ' ').trim().substring(0, 400);
        }
      } catch(e) {}

      // Extract Age (Recency)
      const fragments = (container.innerText || '').toLowerCase().split(/(?:•|·|\n|\r)/).map(s => s.trim());
      for (const f of fragments) {
        if (/^\d+\s*(m|h|d|w|mo|y)[a-z]*\s*(ago)?$/.test(f) || /^\d+[smhdwymo]+$/.test(f)) {
          ageHours = parseAgeToHours(f);
          break;
        }
      }
      
      // If innerText failed, try reading aria-hidden spans directly
      if (ageHours === 9999) {
         const timeSpans = container.querySelectorAll('.update-components-actor__sub-description span[aria-hidden="true"], .feed-shared-actor__sub-description span[aria-hidden="true"], [class*="timestamp"]');
         for (const span of timeSpans) {
            const txt = (span.innerText || '').toLowerCase().trim();
            if (/^\d+\s*(m|h|d|w|mo|y)[a-z]*/.test(txt)) {
               ageHours = parseAgeToHours(txt);
               break;
            }
         }
      }

      // If we completely fail to parse the age, assume it's recent (24h) 
      // rather than old (9999) to avoid discarding perfectly good commentable posts.
      if (ageHours === 9999) {
        ageHours = 24;
      }

    } catch(e) {}
    return { likes, postComments, author, ageHours, textSnippet };
  }

  // ─── Container selectors used across phases ───
  // v7.1: Added [role="listitem"], [data-chameleon-result-urn], li.artdeco-card
  // to cover all known LinkedIn search result layouts.
  const CONTAINER_SELECTORS = [
    '.reusable-search__result-container',
    '[data-view-name="feed-full-update"]',
    '[data-urn*="activity:"]',
    '[data-urn*="ugcPost:"]',
    '.entity-result',
    '.feed-shared-update-v2',
    '[role="listitem"]',
    '[data-chameleon-result-urn]',
    'li.artdeco-card',
  ];

  // ─── Find scroll container ───
  function findScrollContainer() {
    const candidates = [
      '.scaffold-layout__main',
      '.scaffold-layout__list',
      '.search-results-container',
      '.scaffold-layout__content',
      'main'
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight) return el;
    }
    return document.scrollingElement || document.documentElement;
  }

  // ─── Detect LinkedIn restriction banners ───
  // Returns true if LinkedIn is blocking comments on this account.
  function detectLinkedInRestriction() {
    const pageText = (document.body?.innerText || '').toLowerCase();
    const restrictionPhrases = [
      "you can't comment right now",
      "you can\'t comment right now",
      "unable to comment",
      "commenting is restricted",
      "try again later",
      "temporarily restricted",
      "account has been restricted",
      "we restrict certain actions",
      "لا يمكنك التعليق",
      "محظور مؤقتاً"
    ];
    for (const phrase of restrictionPhrases) {
      if (pageText.includes(phrase)) return phrase;
    }

    // Also check for error toasts / alert banners
    const alerts = document.querySelectorAll(
      '.artdeco-toast-item, .artdeco-inline-feedback, [role="alert"], .msg-overlay-bubble-header, .artdeco-modal__content'
    );
    for (const alert of alerts) {
      const alertText = (alert.innerText || '').toLowerCase();
      for (const phrase of restrictionPhrases) {
        if (alertText.includes(phrase)) return phrase;
      }
    }

    return null;
  }

  // ─── Try to post a comment on a live container element ───
  // v7.1: Container-scoped only. No global DOM fallbacks.
  // Returns: 'SUCCESS' | 'FAILED' | 'BLOCKED'
  //   BLOCKED = LinkedIn is restricting this account. Caller should abort all commenting.
  async function tryPostComment(container, textToType, postUrl) {
    if (!container || !document.contains(container)) {
      console.log('[Ext]    ⏭️ Container not in DOM.');
      return 'FAILED';
    }

    // Pre-check: is the account already restricted?
    const preRestriction = detectLinkedInRestriction();
    if (preRestriction) {
      console.error(`[Ext]    🚫 LINKEDIN RESTRICTION DETECTED: "${preRestriction}". Aborting.`);
      return 'BLOCKED';
    }

    // 1. Scroll into view
    container.scrollIntoView({ behavior: 'auto', block: 'center' });
    window.dispatchEvent(new Event('scroll'));
    document.querySelectorAll('.scaffold-layout__main, .search-results-container, main').forEach(sc => {
      try { sc.dispatchEvent(new Event('scroll')); } catch(e) {}
    });
    await wait(1000, 1500);

    // 2. Find Comment button — container-scoped
    let commentBtn =
      container.querySelector('button.comment-button') ||
      container.querySelector('button[aria-label*="Comment"]') ||
      container.querySelector('button[aria-label*="comment"]') ||
      container.querySelector('button[aria-label*="تعليق"]');

    if (!commentBtn) {
      commentBtn = Array.from(container.querySelectorAll('button')).find(b => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        const text  = (b.innerText || '').toLowerCase().trim();
        return label.includes('comment') || text === 'comment' ||
               label.includes('تعليق')  || text === 'تعليق';
      });
    }

    if (!commentBtn) {
      console.log('[Ext]    ⏭️ No comment button found in container.');
      return 'FAILED';
    }

    commentBtn.click();
    console.log('[Ext]    Comment button clicked. Waiting for editor...');
    await wait(2000, 3000);

    // Check for restriction after clicking (LinkedIn may show it now)
    const clickRestriction = detectLinkedInRestriction();
    if (clickRestriction) {
      console.error(`[Ext]    🚫 LINKEDIN RESTRICTION after click: "${clickRestriction}". Aborting.`);
      return 'BLOCKED';
    }

    // 3. Find editor — container-scoped first, then walk up max 10 parents
    let editor = null;
    let editorScope = container;

    // Try container first
    editor =
      editorScope.querySelector('div.ql-editor[contenteditable="true"]') ||
      editorScope.querySelector('div[contenteditable="true"][role="textbox"]') ||
      editorScope.querySelector('div[contenteditable="true"].comments-comment-texteditor__content') ||
      editorScope.querySelector('div[contenteditable="true"]');

    // Walk up parents if not found (LinkedIn sometimes renders editor in a parent wrapper)
    if (!editor) {
      let parent = container.parentElement;
      for (let depth = 0; depth < 10 && parent && !editor; depth++) {
        editor =
          parent.querySelector('div.ql-editor[contenteditable="true"]') ||
          parent.querySelector('div[contenteditable="true"][role="textbox"]') ||
          parent.querySelector('div[contenteditable="true"].comments-comment-texteditor__content');
        if (editor) {
          editorScope = parent;
          console.log(`[Ext]    Found editor ${depth+1} levels above container.`);
        }
        parent = parent.parentElement;
      }
    }

    if (!editor) {
      console.log('[Ext]    ⏭️ No editor found after clicking comment button.');
      try { commentBtn.click(); } catch(e) {} // Try to close
      return 'FAILED';
    }

    // 4. Inject text
    injectTextIntoEditor(editor, textToType);
    await wait(1000, 1500);

    // Verify text actually landed
    let currentText = (editor.innerText || editor.textContent || '').trim();
    if (currentText.length === 0) {
      console.warn('[Ext]    ⚠️ Text not found after injection. Retrying with execCommand...');
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, textToType);
      await wait(800, 1200);
      currentText = (editor.innerText || editor.textContent || '').trim();
    }

    if (currentText.length === 0) {
      console.warn('[Ext]    ❌ Text injection failed completely. Skipping this post.');
      return 'FAILED';
    }

    await wait(800, 1200); // Brief review pause

    // 5. Find submit button — scoped to editorScope (container or nearest parent with editor)
    let submitBtn = null;

    // Layer 1: Known LinkedIn submit class inside editorScope
    submitBtn = editorScope.querySelector('button.comments-comment-box__submit-button');

    // Layer 2: Walk up from editor (max 10 levels)
    if (!submitBtn) {
      let parent = editor.parentElement;
      for (let depth = 0; depth < 10 && parent && !submitBtn; depth++) {
        submitBtn =
          parent.querySelector('button.comments-comment-box__submit-button') ||
          parent.querySelector('button[type="submit"]');
        if (!submitBtn) {
          submitBtn = Array.from(parent.querySelectorAll('button')).find(b => {
            const txt = (b.innerText || '').trim().toLowerCase();
            return txt === 'comment' || txt === 'post' || txt === 'نشر' || txt === 'تعليق' ||
                   txt === 'submit';
          });
        }
        parent = parent.parentElement;
      }
    }

    if (!submitBtn) {
      console.warn('[Ext]    ❌ No submit button found within scope. Skipping this post.');
      return 'FAILED';
    }

    // Force-enable if disabled
    if (submitBtn.disabled || submitBtn.getAttribute('disabled') !== null) {
      console.warn('[Ext]    ⚠️ Submit disabled — force-enabling...');
      submitBtn.removeAttribute('disabled');
      submitBtn.classList.remove('artdeco-button--disabled');
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true,
        inputType: 'insertText', data: textToType
      }));
      await wait(500, 800);
    }

    // 6. Click submit
    submitBtn.click();
    console.log(`[Ext]    Submit button clicked. Verifying...`);
    await wait(2500, 3500);

    // 7. Check for LinkedIn restriction AFTER submit
    const postSubmitRestriction = detectLinkedInRestriction();
    if (postSubmitRestriction) {
      console.error(`[Ext]    🚫 LINKEDIN BLOCKED COMMENT: "${postSubmitRestriction}". Account is restricted.`);
      safeSend({ action: 'LIVE_STATUS', text: `🚫 LinkedIn restriction: "${postSubmitRestriction}". Aborting cycle.` });
      return 'BLOCKED';
    }

    // 8. Post-submit verification: Physical DOM match required
    //    LinkedIn clears the editor after a successful comment post, but also on silent errors.
    //    We must physically query the container to ensure the text actually materialized.
    const textWasConsumed = !document.contains(editor) || (editor.innerText || editor.textContent || '').trim().length === 0;
    
    // Safety delay to allow LinkedIn to render the new comment node
    await wait(3000, 5000);
    
    let commentVerifiedInDom = false;
    try {
      // Search all comment nodes within the overarching container
      const commentNodes = Array.from(container.querySelectorAll('.comments-comment-item, .update-components-comment, article'));
      for (const node of commentNodes) {
        const nodeText = (node.innerText || node.textContent || '');
        // Do a clean check matching the injected string
        if (nodeText.includes(textToType.trim()) && !node.contains(editor)) {
          commentVerifiedInDom = true;
          break;
        }
      }
      
      // Fallback: If LinkedIn's tree structure shifted, search the raw text content of the entire container,
      // but only if the editor itself no longer contains it.
      if (!commentVerifiedInDom && textWasConsumed) {
         const fullText = (container.innerText || container.textContent || '');
         if (fullText.includes(textToType.trim())) {
           commentVerifiedInDom = true;
         }
      }
    } catch(e) {}

    if (commentVerifiedInDom) {
      console.log(`[Ext]    ✅ Comment PHYISCALLY VERIFIED in DOM on ${postUrl}`);
      safeSend({ action: 'COMMENT_POSTED', url: postUrl });
      return 'SUCCESS';
    } 
    
    if (!textWasConsumed && !commentVerifiedInDom) {
      // Retry: try clicking submit once more
      console.warn('[Ext]    ⚠️ Editor still has text — retrying submit...');
      try {
        submitBtn.click();
        await wait(3500, 5500);

        // Check for restriction again after retry
        const retryRestriction = detectLinkedInRestriction();
        if (retryRestriction) {
          console.error(`[Ext]    🚫 LINKEDIN BLOCKED on retry: "${retryRestriction}".`);
          return 'BLOCKED';
        }

        // Final verification pass
        let retryVerified = false;
        const retryNodes = Array.from(container.querySelectorAll('.comments-comment-item, .update-components-comment, article'));
        for (const node of retryNodes) {
          if ((node.innerText || node.textContent || '').includes(textToType.trim()) && !node.contains(editor)) {
            retryVerified = true; break;
          }
        }
        if (retryVerified) {
          console.log(`[Ext]    ✅ Comment PHYISCALLY VERIFIED on retry for ${postUrl}`);
          safeSend({ action: 'COMMENT_POSTED', url: postUrl });
          return 'SUCCESS';
        }
      } catch(e) {}
    }

    console.warn('[Ext]    ❌ Comment purely failed. It did not appear in the DOM. Marking FAILED.');
    return 'FAILED';
  }

  // ─── Main Pipeline (v7: 4-Phase Deterministic) ───

  async function extractPipeline(keyword, settings, comments, dashboardUrl, userId) {
    const minL = settings.minLikes || 0;
    const minC = settings.minComments || 0;

    console.log(`[Ext] ═══ PIPELINE v7 (DETERMINISTIC) START ═══`);
    console.log(`[Ext] Keyword: "${keyword}" | minLikes=${minL} | minComments=${minC}`);
    console.log(`[Ext] Assigned comments: ${comments ? comments.length : 0}`);
    console.log(`[Ext] URL: ${window.location.href}`);

    // ── Page hydration (fast) ──
    heartbeat('Phase0-Hydration', '⏳ Hydrating page...');
    await wait(1000, 1500);

    // ── Pre-Extraction Identity Binding ──
    let linkedInProfileId = 'Unknown';
    try {
      const meLink = document.querySelector('a.global-nav__primary-link--me');
      if (meLink && meLink.href) {
        // e.g. https://www.linkedin.com/in/john-doe-12345/
        const match = meLink.href.match(/\/in\/([^\/\?]+)/);
        if (match) {
          linkedInProfileId = match[1];
          console.log(`[Ext] 🔗 LinkedIn Profile Auto-Detected: ${linkedInProfileId}`);
          try { chrome.runtime.sendMessage({ action: 'IDENTITY_DETECTED', linkedInProfileId }); } catch(e) {}
        }
      }
    } catch(e) {}
    // If we fail to get it from the link, it might be heavily cached. We will pass it as null or Unknown.

    if (!window.location.href.includes('/content/')) {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.innerText.trim() === 'Posts' || b.innerText.includes('Posts'));
      if (btn) {
        console.log('[Ext]    Clicking "Posts" filter...');
        btn.click();
        await wait(3000, 4000);
      }
    }

    // ── Load comment history ──
    let commentedHistory    = [];
    let usedCommentHistory  = [];
    try {
      const stored = await chrome.storage.local.get(['commentedPosts', 'usedCommentIds']);
      commentedHistory    = stored.commentedPosts  || [];
      usedCommentHistory  = stored.usedCommentIds  || [];
    } catch(e) {}
    const commentedSet   = new Set(commentedHistory);
    const usedCommentSet = new Set(usedCommentHistory);

    const needsCommenting = !settings.searchOnlyMode && comments && comments.length > 0;
    let availableComments = needsCommenting
      ? comments.filter(c => !usedCommentSet.has(c.id))
      : [];

    if (needsCommenting && availableComments.length === 0) {
      console.log('[Ext] ✅ All assigned comments already posted.');
      safeSend({ action: 'JOB_COMPLETED', commentsPostedCount: comments.length, assignedCommentsCount: comments.length, searchOnlyMode: false });
      return;
    }

    const requiredComments = availableComments.length;
    console.log(`[Ext]    Comments to place: ${requiredComments}`);

    const scrollTarget = findScrollContainer();

    // ══════════════════════════════════════════════════════════════
    // PHASE 1: DEEP DISCOVERY SCROLL (HUNT MODE for Proven Reach)
    // ══════════════════════════════════════════════════════════════
    console.log(`[Ext] ═══ PHASE 1: Deep Discovery Scroll (Hunt Mode) ═══`);
    heartbeat('Phase1-Discovery', '🔍 Phase 1: Deep hunting for high-quality posts...');

    const allPosts = []; // { url, likes, postComments, author, container }
    const seenUrns = new Set();

    const MAX_SCROLLS = 100; // Increased significantly to guarantee volume
    const SCROLL_AMOUNT = 1200;
    
    // Baseline definition of "High Quality / Proven Performer"
    // At least 10 combined engagements, or matching user's strict min requests if higher.
    const BASELINE_ENGAGEMENT = Math.max(10, minL + minC);
    
    let step = 0;
    let highQualityCount = 0;
    
    while (step < MAX_SCROLLS) {
      // Scroll
      if (typeof scrollTarget.scrollBy === 'function') {
        scrollTarget.scrollBy({ top: SCROLL_AMOUNT, behavior: 'auto' });
      } else {
        scrollTarget.scrollTop += SCROLL_AMOUNT;
      }
      window.dispatchEvent(new Event('scroll'));
      scrollTarget.dispatchEvent(new Event('scroll'));

      // Wait (pacing for network requests)
      await wait(1200, 2500);

      // Heartbeat every 5 steps
      if (step % 5 === 4) {
        heartbeat(`Phase1-Scroll-${step+1}/${MAX_SCROLLS}`, `🔍 Hunting: ${step+1}/${MAX_SCROLLS} (Found ${highQualityCount} high-quality / ${allPosts.length} total)...`);
      }

      // Click "Show more" / "See more" buttons
      const more = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.toLowerCase().includes('show more') ||
        b.innerText.toLowerCase().includes('see more')  ||
        b.innerText.toLowerCase().includes('عرض المزيد')
      );
      if (more) { more.click(); await wait(600, 1000); }

      // Collect newly visible post containers
      const visibleContainers = [];
      for (const sel of CONTAINER_SELECTORS) {
        document.querySelectorAll(sel).forEach(el => {
          if (!visibleContainers.includes(el)) visibleContainers.push(el);
        });
      }

      for (const container of visibleContainers) {
        const urn = extractUrn(container);
        if (!urn || seenUrns.has(urn)) continue;
        seenUrns.add(urn);

        let postUrl = urnToUrl(urn);
        if (!postUrl && urn.startsWith('http')) {
           postUrl = urn; // Urn extraction returned absolute URL early
        }
        if (!postUrl) continue;

        const metrics = extractMetrics(container);

        // v7.2: Comment permission pre-check
        // Detect if the post has a visible, enabled comment button
        let commentable = false;
        try {
          let cBtn =
            container.querySelector('button.comment-button, [role="button"].comment-button') ||
            container.querySelector('button[aria-label*="Comment"], [role="button"][aria-label*="Comment"]') ||
            container.querySelector('button[aria-label*="comment"], [role="button"][aria-label*="comment"]') ||
            container.querySelector('button[aria-label*="\u062a\u0639\u0644\u064a\u0642"], [role="button"][aria-label*="\u062a\u0639\u0644\u064a\u0642"]');
            
          if (!cBtn) {
            cBtn = Array.from(container.querySelectorAll('button, [role="button"]')).find(b => {
              const label = (b.getAttribute('aria-label') || '').toLowerCase();
              const text  = (b.innerText || '').toLowerCase().trim();
              return label.includes('comment') || text === 'comment' ||
                     label.includes('\u062a\u0639\u0644\u064a\u0642')  || text === '\u062a\u0639\u0644\u064a\u0642';
            });
          }
          // Check if button exists and is not disabled
          if (cBtn && !cBtn.disabled && cBtn.getAttribute('disabled') === null && cBtn.getAttribute('aria-disabled') !== 'true') {
            commentable = true;
          }
        } catch(e) {}

        allPosts.push({
          url: postUrl,
          likes: metrics.likes,
          postComments: metrics.postComments,
          author: metrics.author,
          ageHours: metrics.ageHours,
          textSnippet: metrics.textSnippet,
          container: container,
          urn: urn,
          commentable: commentable
        });
        
        if (metrics.likes + metrics.postComments >= BASELINE_ENGAGEMENT) {
          highQualityCount++;
        }
      }
      
      // Early exit if we have found extensive, strong volume of PROVEN PERFORMERS
      const REQUIRED_VOLUME = needsCommenting ? Math.max(requiredComments * 5, 20) : 50; 
      if (highQualityCount >= REQUIRED_VOLUME && step >= 25) {
        console.log(`[Ext] 🎯 Suitable strong volume found (${highQualityCount} high-quality posts). Concluding Hunt Mode.`);
        break;
      }
      
      const noMoreBtn = document.querySelector('.search-no-results__container');
      if (noMoreBtn) {
        console.log('[Ext] Hit End of Feed bounds.');
        break;
      }
      
      step++;
    }

    console.log(`[Ext] 📊 Phase 1 complete: Discovered ${allPosts.length} total posts (${highQualityCount} High-Quality).`);
    heartbeat('Phase1-Done', `✅ Discovery complete: ${allPosts.length} posts found.`);

    // ── DIAGNOSTIC: If zero posts found, dump DOM structure to help debug ──
    if (allPosts.length === 0) {
      console.warn('[Ext] ⚠️ ZERO POSTS DISCOVERED. Running DOM diagnostic...');
      console.warn(`[Ext] DIAG: Current URL = ${window.location.href}`);
      console.warn(`[Ext] DIAG: Page title = ${document.title}`);
      console.warn(`[Ext] DIAG: Body text length = ${(document.body?.innerText || '').length}`);
      const diagnosticSelectors = [
        '.reusable-search__result-container',
        '[data-view-name="feed-full-update"]',
        '[data-urn*="activity:"]',
        '[data-urn*="ugcPost:"]',
        '.entity-result',
        '.feed-shared-update-v2',
        '[role="listitem"]',
        '.artdeco-card',
        'li.artdeco-card',
        '.search-results-container',
        '.scaffold-layout__main',
        '[data-chameleon-result-urn]',
        '.search-reusables__primary-filter',
        '.search-no-results__container',
        '.search-results__cluster-bottom-banner',
      ];
      for (const sel of diagnosticSelectors) {
        const count = document.querySelectorAll(sel).length;
        if (count > 0) console.warn(`[Ext] DIAG: "${sel}" → ${count} elements`);
      }
      // Log first 500 chars of any [role=main] or main element
      const mainEl = document.querySelector('[role="main"], main');
      if (mainEl) {
        console.warn(`[Ext] DIAG: main content (500 chars): ${(mainEl.innerText || '').substring(0, 500)}`);
      }
      // Check for login wall / restriction
      const bodyText = (document.body?.innerText || '').toLowerCase();
      if (bodyText.includes('sign in') || bodyText.includes('join now') || bodyText.includes('log in')) {
        console.error('[Ext] DIAG: 🚫 LOGIN WALL DETECTED — LinkedIn is not authenticated in this tab!');
      }
      if (bodyText.includes('no results') || bodyText.includes('لا توجد نتائج')) {
        console.warn('[Ext] DIAG: LinkedIn returned "No results" for this search query.');
      }
      safeSend({ action: 'LIVE_STATUS', text: '⚠️ Zero posts discovered. Check console for diagnostics.' });
      
      // Early abort to prevent cascading Phase 2/3 errors
      safeSend({ action: 'JOB_COMPLETED', commentsPostedCount: 0, assignedCommentsCount: requiredComments, searchOnlyMode: false });
      return;
    }

    // ══════════════════════════════════════════════════════════════
    // PHASE 2: RANKING & SELECTION
    // ══════════════════════════════════════════════════════════════
    if (needsCommenting) {
      console.log(`[Ext] \u2550\u2550\u2550 PHASE 2: Ranking & Selection \u2550\u2550\u2550`);
      heartbeat('Phase2-Selection', '\ud83d\udcca Phase 2: Filtering & selecting targets...');

      // Filter out previously commented posts
      const uncommented = allPosts.filter(p => !commentedSet.has(p.url));
      console.log(`[Ext]    Uncommented candidates: ${uncommented.length}/${allPosts.length}`);

      // v7.3: Hard limit of 1 month (744 hours) + must be commentable
      const MAX_AGE_HOURS = 744;
      const validPool = uncommented.filter(p => p.commentable && p.ageHours <= MAX_AGE_HOURS);
      console.log(`[Ext]    Commentable AND <= 1 month old: ${validPool.length}/${uncommented.length}`);

      // Sort function: Recency bracket first, then highest engagement
      function rankPosts(a, b) {
        const aBracket = a.ageHours <= 24 ? 1 : (a.ageHours <= 168 ? 2 : 3);
        const bBracket = b.ageHours <= 24 ? 1 : (b.ageHours <= 168 ? 2 : 3);
        
        if (aBracket !== bBracket) return aBracket - bBracket; // Newer bracket first
        
        const aEng = a.likes + a.postComments;
        const bEng = b.likes + b.postComments;
        if (bEng !== aEng) return bEng - aEng; // Highest engagement first
        
        return a.ageHours - b.ageHours; // Exact age tiebreaker
      }

      // Apply strict reach criteria on the valid pool. MUST have strong engagement.
      const strictMatches = validPool.filter(p =>
        p.likes >= minL && p.postComments >= minC && (p.likes + p.postComments) >= BASELINE_ENGAGEMENT
      );
      console.log(`[Ext]    Strict reach matches (likes≥${minL}, comments≥${minC}, baseline≥${BASELINE_ENGAGEMENT}): ${strictMatches.length}`);

      const targetCount = Math.min(requiredComments * 3, Math.max(requiredComments, validPool.length));
      let targets = [];

      if (strictMatches.length >= requiredComments) {
        // Enough strict matches
        targets = strictMatches.sort(rankPosts).slice(0, targetCount);
        console.log(`[Ext]    ✅ Using ${targets.length} strict-match targets.`);
      } else {
        // BEST-EFFORT RECOVERY (Per User Requirement)
        // If we don't have enough strict matches, NEVER fail out. Backfill with the absolute highest engaged 
        // leftovers available in the pool so that operation always successfully executes on best-available reach.
        console.warn(`[Ext]    ⚠️ Only ${strictMatches.length} strict matches. Need ${requiredComments}. Applying Best-Effort Fallback to highest-reach alternatives...`);

        const strictUrls = new Set(strictMatches.map(p => p.url));
        const remainingValid = validPool
          .filter(p => !strictUrls.has(p.url))
          .sort(rankPosts); // rankPosts sorts by largest engagement automatically

        // Grab exactly what we need to meet the target count Buffer
        const needed = targetCount - strictMatches.length;
        
        targets = [
          ...strictMatches.sort(rankPosts),
          ...remainingValid.slice(0, needed)
        ];

        console.log(`[Ext]    ✅ Recovered ${targets.length} Best-Effort targets to ensure execution does not fail.`);
      }

      if (targets.length === 0) {
        console.warn(`[Ext]    ❌ Zero commentable targets found. Reporting failure.`);
        safeSend({
          action: 'JOB_COMPLETED',
          commentsPostedCount: 0,
          assignedCommentsCount: requiredComments,
          searchOnlyMode: false
        });
        // Still sync posts
        await syncAllPosts(allPosts, keyword, dashboardUrl, userId, minL, minC);
        return;
      }

      // Log target summary
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        console.log(`[Ext]    Target ${i+1}: ${t.author} | Age: ${t.ageHours < 9999 ? t.ageHours+'h' : 'unk'} | L:${t.likes} C:${t.postComments} | ${t.url.substring(0, 50)}`);
      }

      // ══════════════════════════════════════════════════════════════
      // PHASE 3: SEQUENTIAL COMMENTING
      // ══════════════════════════════════════════════════════════════
      console.log(`[Ext] ═══ PHASE 3: Sequential Commenting ═══`);
      heartbeat('Phase3-Commenting', `⌨️ Phase 3: Posting ${requiredComments} comments...`);

      let commentsPostedThisCycle = 0;
      let commentIdx = 0;
      let targetIdx = 0;
      let linkedinBlocked = false;

      while (commentIdx < requiredComments && targetIdx < targets.length) {
        const target = targets[targetIdx];
        targetIdx++;

        // Check if container is still in DOM (LinkedIn's virtualizer may have evicted it)
        if (!document.contains(target.container)) {
          console.log(`[Ext]    ⚠️ Target ${targetIdx} evicted from DOM. Re-locating...`);

          // Try to find it again by URN
          let relocated = null;
          for (const sel of CONTAINER_SELECTORS) {
            const candidates = document.querySelectorAll(sel);
            for (const c of candidates) {
              const urn = extractUrn(c);
              if (urn === target.urn) {
                relocated = c;
                break;
              }
            }
            if (relocated) break;
          }

          if (!relocated) {
            // Scroll to top and try again — LinkedIn may reload earlier posts
            console.log(`[Ext]    Scrolling to top to re-render post...`);
            scrollTarget.scroll({ top: 0, behavior: 'auto' });
            await wait(2000, 3000);

            // Scroll back down slowly to find the post
            for (let s = 0; s < 15; s++) {
              scrollTarget.scrollBy({ top: 1200, behavior: 'auto' });
              await wait(500, 800);
              for (const sel of CONTAINER_SELECTORS) {
                const candidates = document.querySelectorAll(sel);
                for (const c of candidates) {
                  const urn = extractUrn(c);
                  if (urn === target.urn) { relocated = c; break; }
                }
                if (relocated) break;
              }
              if (relocated) break;
            }
          }

          if (relocated) {
            target.container = relocated;
            console.log(`[Ext]    ✅ Re-located target in DOM.`);
          } else {
            console.warn(`[Ext]    ❌ Could not re-locate target. Skipping.`);
            continue;
          }
        }

        const commentObj = availableComments[commentIdx];
        console.log(`[Ext] 🎯 Comment ${commentIdx+1}/${requiredComments} → "${target.author}" (L:${target.likes} C:${target.postComments})`);
        heartbeat('Phase3-Typing', `⌨️ Comment ${commentIdx+1}/${requiredComments}: Engaging ${target.author}...`);

        const result = await tryPostComment(target.container, commentObj.text, target.url);

        if (result === 'BLOCKED') {
          console.error(`[Ext] 🚫 ACCOUNT RESTRICTED by LinkedIn. Aborting ALL commenting immediately.`);
          heartbeat('Phase3-Blocked', '🚫 LinkedIn restriction detected. Stopping cycle.');
          safeSend({ action: 'LIVE_STATUS', text: '🚫 LinkedIn is blocking comments on this account. Cycle aborted.' });
          linkedinBlocked = true;
          break;
        } else if (result === 'SUCCESS') {
          commentsPostedThisCycle++;
          commentIdx++;
          commentedSet.add(target.url);

          // Persist immediately
          try {
            commentedHistory   = [...commentedHistory,   target.url].slice(-200);
            usedCommentHistory = [...usedCommentHistory, commentObj.id].slice(-100);
            await chrome.storage.local.set({ commentedPosts: commentedHistory, usedCommentIds: usedCommentHistory });
          } catch(e) {}

          console.log(`[Ext] ✅ ${commentsPostedThisCycle}/${requiredComments} comments placed.`);

          // Human-like pause between comments (8-15 seconds for safety)
          if (commentIdx < requiredComments) {
            await wait(8000, 15000);
          }
        } else {
          console.log(`[Ext]    ⏭️ Failed on target ${targetIdx}. Trying next candidate.`);
        }
      }

      // ── If still short, attempt emergency pass on any live DOM posts ──
      // Skip entirely if account is blocked by LinkedIn
      if (commentsPostedThisCycle < requiredComments && !linkedinBlocked) {
        const stillNeeded = requiredComments - commentsPostedThisCycle;
        console.warn(`[Ext] 🔁 Emergency pass: ${stillNeeded} comment(s) still needed.`);
        heartbeat('Phase3-Emergency', `🔁 Emergency: ${stillNeeded} comment(s) remaining...`);

        // Scroll to top and do a fresh scan
        scrollTarget.scroll({ top: 0, behavior: 'auto' });
        await wait(2000, 3000);

        // Gather any live containers not yet commented
        // v7.2: Only include commentable posts with some engagement
        const emergencyPool = [];
        for (const sel of CONTAINER_SELECTORS) {
          document.querySelectorAll(sel).forEach(el => {
            const urn = extractUrn(el);
            const url = urnToUrl(urn);
            if (url && !commentedSet.has(url) && !emergencyPool.some(e => e.url === url)) {
              const metrics = extractMetrics(el);

              // Check if comment button exists
              let hasCommentBtn = false;
              try {
                let cBtn =
                  el.querySelector('button.comment-button, [role="button"].comment-button') ||
                  el.querySelector('button[aria-label*="Comment"], [role="button"][aria-label*="Comment"]') ||
                  el.querySelector('button[aria-label*="comment"], [role="button"][aria-label*="comment"]') ||
                  el.querySelector('button[aria-label*="\u062a\u0639\u0644\u064a\u0642"], [role="button"][aria-label*="\u062a\u0639\u0644\u064a\u0642"]');
                if (!cBtn) {
                  cBtn = Array.from(el.querySelectorAll('button, [role="button"]')).find(b => {
                    const text  = (b.innerText || '').toLowerCase().trim();
                    return text === 'comment' || text === '\u062a\u0639\u0644\u064a\u0642';
                  });
                }
                if (cBtn && !cBtn.disabled && cBtn.getAttribute('disabled') === null && cBtn.getAttribute('aria-disabled') !== 'true') {
                  hasCommentBtn = true;
                }
              } catch(e) {}

              if (hasCommentBtn && metrics.ageHours <= 744) {
                emergencyPool.push({ container: el, url, ...metrics });
              } else {
                console.log(`[Ext]    Emergency skip: ${url.substring(0, 50)} (no btn or >1mo old)`);
              }
            }
          });
        }

        // Emergency pool also uses Recency + Engagement sorting
        emergencyPool.sort((a, b) => {
          const aBracket = a.ageHours <= 24 ? 1 : (a.ageHours <= 168 ? 2 : 3);
          const bBracket = b.ageHours <= 24 ? 1 : (b.ageHours <= 168 ? 2 : 3);
          if (aBracket !== bBracket) return aBracket - bBracket;
          return (b.likes + b.postComments) - (a.likes + a.postComments);
        });
        console.log(`[Ext]    Emergency pool: ${emergencyPool.length} validated candidates.`);

        for (const candidate of emergencyPool) {
          if (commentIdx >= requiredComments) break;

          const commentObj = availableComments[commentIdx];
          console.log(`[Ext]    Emergency: comment ${commentIdx+1} → ${candidate.author} (L:${candidate.likes} C:${candidate.postComments})`);

          const result = await tryPostComment(candidate.container, commentObj.text, candidate.url);
          if (result === 'BLOCKED') {
            console.error(`[Ext] 🚫 ACCOUNT RESTRICTED during emergency pass. Aborting.`);
            linkedinBlocked = true;
            break;
          }
          if (result === 'SUCCESS') {
            commentsPostedThisCycle++;
            commentIdx++;
            commentedSet.add(candidate.url);
            try {
              commentedHistory   = [...commentedHistory,   candidate.url].slice(-200);
              usedCommentHistory = [...usedCommentHistory, commentObj.id].slice(-100);
              await chrome.storage.local.set({ commentedPosts: commentedHistory, usedCommentIds: usedCommentHistory });
            } catch(e) {}
            console.log(`[Ext] ✅ Emergency: ${commentsPostedThisCycle}/${requiredComments} comments placed.`);
            if (commentIdx < requiredComments) await wait(8000, 15000);
          }
        }
      }

      console.log(`[Ext] 📊 Phase 3 complete: ${commentsPostedThisCycle}/${requiredComments} comments posted.`);

      // ══════════════════════════════════════════════════════════════
      // PHASE 4: SYNC & REPORT
      // ══════════════════════════════════════════════════════════════
      console.log(`[Ext] ═══ PHASE 4: Sync & Report ═══`);
      heartbeat('Phase4-Sync', '📤 Phase 4: Syncing results...');

      await syncAllPosts(allPosts, keyword, dashboardUrl, userId, minL, minC, linkedInProfileId);

      console.log(`[Ext] ═══ PIPELINE v7 COMPLETE: ${commentsPostedThisCycle}/${requiredComments} comments posted ═══`);

      safeSend({
        action: 'JOB_COMPLETED',
        commentsPostedCount: commentsPostedThisCycle,
        assignedCommentsCount: requiredComments,
        searchOnlyMode: false,
        linkedinBlocked: linkedinBlocked
      });

    } else {
      // Search-only mode: just sync posts
      console.log(`[Ext] 📜 Search-only mode. Syncing ${allPosts.length} discovered posts.`);
      await syncAllPosts(allPosts, keyword, dashboardUrl, userId, minL, minC, linkedInProfileId);
      safeSend({
        action: 'JOB_COMPLETED',
        commentsPostedCount: 0,
        assignedCommentsCount: 0,
        searchOnlyMode: true
      });
    }
  }

  // ─── Sync helper ───
  async function syncAllPosts(allPosts, keyword, dashboardUrl, userId, minL, minC, linkedInProfileId) {
    const syncData = allPosts.map(p => ({
      url: p.url,
      likes: p.likes,
      comments: p.postComments,
      author: p.author,
      preview: (p.textSnippet || '').substring(0, 200) // Truncate to prevent Chrome IPC overflow
    }));

    // Sort ALL data by total engagement (likes + comments) descending so the best rise to top
    syncData.sort((a, b) => ((b.likes || 0) + (b.comments || 0)) - ((a.likes || 0) + (a.comments || 0)));

    // v7.8 Quality-First Pipeline: Try to strip generic junk
    const BASELINE_ENGAGEMENT = Math.max(10, minL + minC);
    const premiumData = syncData.filter(p => (p.likes || 0) + (p.comments || 0) >= BASELINE_ENGAGEMENT);
    
    // Best-Effort Recovery: If premium data filtering resulted in an unacceptably low volume (e.g. < 5 posts),
    // default to capturing the absolute best 100 available from the generic pool rather than returning empty.
    let finalSync = [];
    if (premiumData.length >= 5) {
      finalSync = premiumData.slice(0, 100);
      console.log(`[Ext] 📜 Extracted ${finalSync.length} Ultra-Premium results.`);
    } else {
      // At bare minimum, NEVER include posts with literal zero reach to ensure quality standards
      finalSync = syncData.filter(p => (p.likes || 0) + (p.comments || 0) > 0).slice(0, 100);
      console.log(`[Ext] 📜 Premium pool critically low. Recovered ${finalSync.length} Best-Effort Alternative results (excluding zero-reach).`);
    }

    if (finalSync.length > 0) {
      await syncToDashboard(finalSync, keyword, dashboardUrl, userId, linkedInProfileId);
    } else {
      await syncToDashboard([], 'DEBUG_FILTER_EMPTY', dashboardUrl, userId, linkedInProfileId, `ALL:${syncData.length}`);
    }
  }

  async function syncToDashboard(posts, keyword, dashboardUrl, userId, linkedInProfileId, debug) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({
          action: 'SYNC_RESULTS',
          posts, keyword, dashboardUrl, userId, linkedInProfileId, debugInfo: debug || null
        }, () => {
          if (chrome.runtime.lastError) {}
          resolve();
        });
      } catch (err) { resolve(); }
    });
  }

} // end scope
