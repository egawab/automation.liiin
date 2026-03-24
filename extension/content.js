if (typeof window.isLinkedInWorkerLoaded === 'undefined') {
    window.isLinkedInWorkerLoaded = true;
    
    let isExtracting = false;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'EXECUTE_SEARCH') {
        // Essential: Respond immediately to keep the port open
        sendResponse({ received: true });
        
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
    
    // NEW: Dashboard & Login check
    const isLoginPage = document.title.toLowerCase().includes('log in') || document.title.toLowerCase().includes('login') || !!document.querySelector('form.login__form');
    const hasMain = !!document.querySelector('.scaffold-layout__main, #main, .core-rail');
    console.log(`[Ext-Worker] Page Status: Title="${document.title}", Links=${document.links.length}, hasMain=${hasMain}, isLogin=${isLoginPage}`);
    
    if (isLoginPage) {
        console.error("[Ext-Worker] CRITICAL: You are NOT logged in to LinkedIn. Extraction aborted.");
        sendJobFailed("LinkedIn Login required.");
        return;
    }

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

    console.info("🚀 [Ext-Worker] STARTING PROFESSIONAL EXTRACTION...");
    
    // Optimized: 12 scrolls is enough for high-quality reach filtering
    for (let i = 0; i < 12; i++) {
        console.info(`🔄 [Ext-Worker] Scrolling cycle ${i+1}/12...`);
        window.scrollBy({ top: 900, behavior: 'smooth' });
        await humanDelay(3500, 5500); // More time for hydration
        
        const seeMore = Array.from(document.querySelectorAll('button')).find(b => 
            b.innerText.toLowerCase().includes('see more') || 
            b.innerText.toLowerCase().includes('عرض المزيد')
        );
        if (seeMore && seeMore.offsetParent !== null) {
            seeMore.click();
            await humanDelay(3000, 5000);
        }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await humanDelay(1500, 2500);

    const TARGET_POSTS_MIN = 12; 
    const MAX_POSTS_BUFFER = 100; // Increased back to 100 for better data pool
    const allCandidatePosts = [];
    const seen = {};

    let containers = scanDoc(document);
    console.info(`🎯 [Ext-Worker] Initial scan found ${containers.length} containers.`);

    // If NO containers found, send a diagnostic report so we know why!
    if (containers.length === 0) {
      console.warn("⚠️ [Ext-Worker] NO CONTAINERS FOUND! Sending forensic report...");
      const bodyText = document.body.innerText.substring(0, 1000).replace(/\n/g, ' ');
      const debugStr = `TITLE: ${document.title} | URL: ${window.location.href} | TEXT: ${bodyText}`;
      await submitResultsToDashboard([], "DEBUG_EMPTY_PAGE", dashboardUrl, userId, debugStr);
    }

    // Strategy D: Semantic Discovery (The Ultimate Hunter)
    const allDivs = document.querySelectorAll('div, li, article');
    allDivs.forEach(el => {
        if (allCandidatePosts.length >= MAX_POSTS_BUFFER) return;
        if (containers.includes(el)) return;
        
        const text = el.innerText || '';
        // Every search result post contains markers
        const hasFeedLabel = text.includes('Feed post') || text.includes('منشور') || text.includes('الموجز');
        const hasSocialBars = (text.includes('Like') || text.includes('إعجاب')) && (text.includes('Comment') || text.includes('تعليق'));
        
        if (hasFeedLabel || hasSocialBars) {
             if (!containers.includes(el)) containers.push(el);
        }
    });

    containers.forEach((container) => {
      if (allCandidatePosts.length >= MAX_POSTS_BUFFER) return;
      
      let url = null;
      const urlSelectors = ['a[href*="/feed/update/"]', 'a[href*="/update/urn:li:activity:"]', 'a.app-aware-link[href*="activity"]'];
      for (const sel of urlSelectors) {
          const link = container.querySelector(sel);
          if (link) { url = link.href.split('?')[0]; break; }
      }
      
      if (!url) {
        let urn = decodeTrackingScope(container);
        if (urn) url = 'https://www.linkedin.com/feed/update/' + urn;
      }
      
      if (!url || seen[url]) return;
      seen[url] = true;

      let like = 0, comm = 0;
      let text = (container.innerText || '').replace(/[\n\r]/g, ' ');
      
      try {
        const socialLabels = Array.from(container.querySelectorAll('[aria-label]'))
            .map(el => el.getAttribute('aria-label').toLowerCase());
            
        for (const label of socialLabels) {
            const num = parseNum(label.match(/(\d[\d,]*k?m?)/)?.[0]);
            if (!like && (label.includes('reaction') || label.includes('like') || label.includes('إعجاب'))) like = num;
            if (!comm && (label.includes('comment') || label.includes('تعليق'))) comm = num;
        }

        if (!like || !comm) {
            const engageText = Array.from(container.querySelectorAll('button, span, a'))
                .map(el => el.innerText.toLowerCase());
            for (const bText of engageText) {
                const num = parseNum(bText.match(/(\d[\d,]*k?m?)/)?.[0]);
                if (!like && (bText.includes('إعجاب') || bText.includes('reaction'))) like = num;
                if (!comm && (bText.includes('تعليق') || bText.includes('comment'))) comm = num;
            }
        }
      } catch (e) {}

      let author = 'LinkedIn User';
      const authorEl = container.querySelector('.update-components-actor__name, .entity-result__title-text, .update-components-actor__title');
      if (authorEl) author = authorEl.innerText.split('\n')[0].trim();

      allCandidatePosts.push({ 
        url, likes: like, comments: comm, author, preview: text.substring(0, 400).trim(),
        score: (like * 1) + (comm * 5)
      });
    });

    const minL = settings.minLikes || 0;
    const minC = settings.minComments || 0;

    // GREEDY FILTERING: Prioritize perfect matches, then best available
    const perfectMatches = allCandidatePosts.filter(p => p.likes >= minL && p.comments >= minC)
        .sort((a,b) => b.score - a.score);
    
    // Fallback: If no perfect matches, take anything that has at least 10% of target
    const relevantBackups = allCandidatePosts
        .filter(p => !perfectMatches.includes(p))
        .filter(p => p.likes >= (minL * 0.1) || p.comments >= (minC * 0.1)) 
        .sort((a,b) => b.score - a.score);

    // Ultimate fallback: Just take the top 10 if we have NOTHING
    const fallbackResults = (perfectMatches.length + relevantBackups.length === 0) 
        ? allCandidatePosts.sort((a,b) => b.score - a.score).slice(0, 10)
        : [];

    const finalResults = [...perfectMatches, ...relevantBackups, ...fallbackResults].slice(0, 25);

    console.info(`🏁 [Ext-Worker] EXTRACTION DONE. Found ${perfectMatches.length} high-reach matches. Total bundle: ${finalResults.length}`);

    if (finalResults.length > 0) {
      console.info("📤 [Ext-Worker] Syncing results to Dashboard...");
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
