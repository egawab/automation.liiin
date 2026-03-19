if (typeof window.isLinkedInWorkerLoaded === 'undefined') {
    window.isLinkedInWorkerLoaded = true;
    
    let isExtracting = false;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'EXECUTE_SEARCH') {
        // The new window.executeSearchAndExtract will handle the isExtracting check
        console.log(`[Ext-Worker] Received job for keyword: ${request.keyword}`);
        window.executeSearchAndExtract(request.keyword, request.settings, request.dashboardUrl, request.userId);
      }
    });

    // ... rest of functions ...

    window.executeSearchAndExtract = async function(keyword, settings, dashboardUrl, userId) {
      if (isExtracting) {
        console.log("[Ext-Worker] Already extracting, skipping...");
        return;
      }
      isExtracting = true;
      try {
        await executeSearchAndExtractInner(keyword, settings, dashboardUrl, userId);
      } finally {
        isExtracting = false;
      }
    };

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function humanDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await sleep(ms);
}

function parseNum(t) {
  if (!t) return 0;
  const c = String(t).toLowerCase().replace(/,/g, '').trim();
  const m = c.match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (c.indexOf('k') !== -1) n *= 1000;
  if (c.indexOf('m') !== -1) n *= 1000000;
  return Math.round(n);
}

function decodeTrackingScope(el) {
  try {
    const raw = el.getAttribute('data-view-tracking-scope');
    if (!raw) return null;
    const arr = JSON.parse(raw);
    const items = Array.isArray(arr) ? arr : [arr];
    for (const item of items) {
      const data = item?.breadcrumb?.content?.data;
      if (data && Array.isArray(data)) {
        const str = data.map(b => String.fromCharCode(b)).join('');
        const inner = JSON.parse(str);
        const urn = inner.updateUrn || (inner.controlledUpdateRegion && inner.controlledUpdateRegion.updateUrn);
        if (urn) return urn;
      }
      const value = item?.value;
      if (value && Array.isArray(value)) {
        const str2 = value.map(b => String.fromCharCode(b)).join('');
        const inner2 = JSON.parse(str2);
        const urn2 = inner2.updateUrn || (inner2.controlledUpdateRegion && inner2.controlledUpdateRegion.updateUrn);
        if (urn2) return urn2;
      }
    }
  } catch (e) { }
  return null;
}

async function executeSearchAndExtractInner(keyword, settings, dashboardUrl, userId) {
  try {
    console.log("[Ext-Worker] Waiting for contents to load...");
    await humanDelay(3000, 5000);

    // AUTO-TAB CORRECTION: Ensure we are on the "Posts" (Content) tab
    if (!window.location.href.includes('/content/')) {
        console.log("[Ext-Worker] Not on 'Posts' tab. Attempting to click 'Posts' filter...");
        const postButtons = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.includes('Posts'));
        if (postButtons.length > 0) {
            postButtons[0].click();
            console.log("[Ext-Worker] Clicked 'Posts' button. Waiting for reload...");
            await humanDelay(4000, 6000);
        } else {
            console.warn("[Ext-Worker] Could not find 'Posts' button. Proceeding with current view.");
        }
    }
    
    console.log("[Ext-Worker] Scrolling to load infinite content for MAXIMUM volume...");
    // Industrial Extraction: 20 human-like scrolls for maximum content depth
    for (let i = 0; i < 20; i++) {
        window.scrollBy({ top: window.innerHeight * 1.5, behavior: 'smooth' });
        await humanDelay(1500, 3000);
        // If "No more results" or "See more" appears, try to handle it
        const seeMore = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('See more') || b.innerText.includes('عرض المزيد'));
        if (seeMore) {
            seeMore.click();
            await humanDelay(2000, 3000);
        }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await humanDelay(1000, 2000);

    const TARGET_POSTS_MIN = 15; // User specifically asked for 10-20
    const MAX_POSTS_BUFFER = 50; 
    const results = [];
    const allCandidatePosts = [];
    const seen = {};
    let rawCount = 0;

    // NEW: Dashboard & Login check
    const isLoginPage = document.title.toLowerCase().includes('log in') || document.title.toLowerCase().includes('login') || !!document.querySelector('form.login__form');
    const hasMain = !!document.querySelector('.scaffold-layout__main, #main, .core-rail');
    console.log(`[Ext-Worker] Page Status: Title="${document.title}", Links=${document.links.length}, hasMain=${hasMain}, isLogin=${isLoginPage}`);
    
    if (isLoginPage) {
        console.error("[Ext-Worker] CRITICAL: You are NOT logged in to LinkedIn. Extraction aborted.");
        sendJobFailed("LinkedIn Login required.");
        return;
    }

    let containers = [];
    
    // Deep Scan Function: Search in a document/iframe
    function scanDoc(doc) {
        if (!doc) return;
        const primarySelectors = '.reusable-search__result-container, .entity-result, .search-results__list-item, .artdeco-list__item, [data-view-name="feed-full-update"], .feed-shared-update-v2, li.artdeco-card, [data-urn*="activity:"], [data-urn*="ugcPost:"]';
        const found = Array.from(doc.querySelectorAll(primarySelectors));
        
        // Strategy B: Component detection
        const actors = doc.querySelectorAll('.update-components-actor, .entity-result__actor-container, .update-components-actor__container');
        actors.forEach(actor => {
           let parent = actor.closest('li, div.artdeco-card, .reusable-search__result-container, .entity-result');
           if (parent && !found.includes(parent)) found.push(parent);
        });

        // Strategy C: Link-First discovery
        const links = doc.querySelectorAll('a[href*="activity"], a[href*="ugcPost"]');
        links.forEach(link => {
           let parent = link.closest('li, .entity-result, div.artdeco-card');
           if (parent && !found.includes(parent)) found.push(parent);
        });
        
        return found;
    }

    // 1. Scan Main Document
    containers = scanDoc(document);

    // Strategy D: Semantic Discovery (The Ultimate Hunter)
    const allDivs = document.querySelectorAll('div, li, article');
    allDivs.forEach(el => {
        if (containers.length >= MAX_POSTS_BUFFER) return;
        if (containers.includes(el)) return;
        
        const text = el.innerText || '';
        // Every search result post contains "Feed post" (EN) or "منشور" (AR) or actor degree
        const hasFeedLabel = text.includes('Feed post') || text.includes('منشور') || text.includes('الموجز');
        const hasActorDegree = text.match(/•\s+(1st|2nd|3rd\+|١|٢|٣)/); // Arabic digits support
        const hasSocialBars = (text.includes('Like') || text.includes('إعجاب')) && (text.includes('Comment') || text.includes('تعليق'));
        
        if ((hasFeedLabel && hasActorDegree) || (hasActorDegree && hasSocialBars)) {
             containers.push(el);
        }
    });

    // 2. Scan All Accessible IFrames
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(ifr => {
       try {
          const ifrDoc = ifr.contentDocument || ifr.contentWindow.document;
          const ifrFound = scanDoc(ifrDoc);
          if (ifrFound && ifrFound.length > 0) {
             containers = containers.concat(ifrFound);
          }
       } catch (e) {}
    });

    console.log(`[Ext-Worker] Total found containers (Semantic Audit): ${containers.length}`);
    
    if (containers.length === 0) {
      console.warn("[Ext-Worker] NO CONTAINERS FOUND! Sending forensic report...");
      const bodyText = document.body.innerText.substring(0, 1000).replace(/\n/g, ' ');
      const debugStr = `TITLE: ${document.title} | MAIN: ${hasMain} | LINKS: ${document.links.length} | TEXT: ${bodyText} | HTML: ${document.documentElement.innerHTML.substring(0, 1000)}`;
      await submitResultsToDashboard([], "DEBUG_EMPTY_PAGE", dashboardUrl, userId, debugStr);
    }

    // ... (Navigation already handled above) ...

    containers.forEach((container, idx) => {
      if (allCandidatePosts.length >= MAX_POSTS_BUFFER) return;
      
      let url = null;
      
      // Try tracking scope (High reliability)
      let scopeEls = [container].concat(Array.from(container.querySelectorAll('[data-view-tracking-scope]')));
      for (let i = 0; i < scopeEls.length; i++) {
        let urn = decodeTrackingScope(scopeEls[i]);
        if (urn && (urn.indexOf('urn:li:activity:') !== -1 || urn.indexOf('urn:li:ugcPost:') !== -1 || urn.indexOf('urn:li:share:') !== -1)) {
          url = 'https://www.linkedin.com/feed/update/' + urn;
          break;
        }
      }
      
      if (!url) {
        let link = container.querySelector('a[href*="/feed/update/"], a[href*="/update/urn:li:activity:"]');
        if (link) url = link.href.split('?')[0];
      }
      
      if (!url || seen[url]) return;
      seen[url] = true;
      rawCount++;

      let like = 0, comm = 0;
      let text = (container.innerText || '').replace(/[\n\r]/g, ' ');
      
      // Advanced Reach Extraction (Multilingual)
      try {
        let allLabels = Array.from(container.querySelectorAll('[aria-label]'));
        for (let l = 0; l < allLabels.length; l++) {
          let label = (allLabels[l].getAttribute('aria-label') || '').toLowerCase();
          // Reactions / Likes
          if (!like && (label.indexOf('reaction') !== -1 || label.indexOf('like') !== -1 || label.indexOf('إعجاب') !== -1)) {
            let ml = label.match(/(\d[\d,]*)/);
            if (ml) like = parseNum(ml[1]);
          }
          // Comments
          if (!comm && (label.indexOf('comment') !== -1 || label.indexOf('تعليق') !== -1)) {
            let mc = label.match(/(\d[\d,]*)/);
            if (mc) comm = parseNum(mc[1]);
          }
        }
        
        // Fallback to regex if labels failed
        if (!like) {
           let mLike = text.match(/(\d[\d,]*)\s*(reactions?|likes?|إعجاب|تفاعل)/i);
           if (mLike) like = parseNum(mLike[1]);
        }
        if (!comm) {
           let mComm = text.match(/(\d[\d,]*)\s*(comments?|تعليق)/i);
           if (mComm) comm = parseNum(mComm[1]);
        }
      } catch (e) {}

      // Author extraction
      let author = 'LinkedIn User';
      try {
          let actorEl = container.querySelector('.update-components-actor__name, .entity-result__title-text, .update-components-actor__title span, .update-components-actor__container [aria-hidden="true"]');
          if (actorEl) author = actorEl.innerText.split('\n')[0].trim();
      } catch(e) {}

      const postData = { 
        url, 
        likes: like, 
        comments: comm, 
        author, 
        preview: text.substring(0, 300).trim(), 
        // Quality Score: Prioritize engagement but allow "close" matches
        score: (like * 1) + (comm * 5) // Comments are rarer/more valuable
      };

      allCandidatePosts.push(postData);
    });

    // INDUSTRIAL SORTING & FILTERING
    const minL = settings.minLikes || 0;
    const minC = settings.minComments || 0;

    // 1. First, take posts that EXACTLY match criteria
    let perfectMatches = allCandidatePosts.filter(p => p.likes >= minL && p.comments >= minC);
    
    // 2. If we don't have enough, fill with the next "highest engagement" posts (Fuzzy matches)
    let finalResults = [];
    if (perfectMatches.length >= TARGET_POSTS_MIN) {
        console.log(`[Ext-Worker] Found ${perfectMatches.length} perfect matches. Returning top performance.`);
        perfectMatches.sort((a,b) => b.score - a.score);
        finalResults = perfectMatches.slice(0, 30);
    } else {
        console.log(`[Ext-Worker] Only found ${perfectMatches.length} perfect matches. Supplementing with closest high-reach posts.`);
        // Combine them, but prioritize perfect matches by putting them first
        const remainingBuffer = allCandidatePosts
            .filter(p => !perfectMatches.includes(p))
            .sort((a,b) => b.score - a.score);
        
        finalResults = perfectMatches.concat(remainingBuffer).slice(0, 25);
    }

    console.log(`[Ext-Worker] Done. Final Extraction Volume: ${finalResults.length} posts (Raw candidates: ${allCandidatePosts.length})`);

    if (finalResults.length > 0) {
      await submitResultsToDashboard(finalResults, keyword, dashboardUrl, userId);
    }

    sendJobCompleted();

  } catch (error) {
    console.error("[Ext-Worker] Fatal error during extraction:", error);
    chrome.runtime.sendMessage({ action: 'JOB_FAILED', error: String(error) });
  }
}

async function submitResultsToDashboard(posts, keyword, dashboardUrl, userId, debugInfo = null) {
  try {
    const response = await fetch(`${dashboardUrl}/api/extension/results`, {
      method: 'POST',
      headers: {
         'Content-Type': 'application/json',
         'x-extension-token': userId
      },
      body: JSON.stringify({ keyword, posts, debugInfo })
    });
    
    if (response.ok) {
       console.log("[Ext-Worker] Successfully synced posts to Dashboard.");
    } else {
       console.error("[Ext-Worker] Server rejected posts:", response.status);
    }
  } catch (err) {
    console.error("[Ext-Worker] Network error while submitting posts:", err);
  }
}

function sendJobCompleted() {
  chrome.runtime.sendMessage({ action: 'JOB_COMPLETED' });
}
} // End of isLinkedInWorkerLoaded check
