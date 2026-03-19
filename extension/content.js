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
    
    console.log("[Ext-Worker] Scrolling to load infinite content...");
    // Perform 5 human-like scrolls for deep extraction
    for (let i = 0; i < 5; i++) {
        window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'smooth' });
        await humanDelay(2000, 4500);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await humanDelay(1000, 2000);

    const MAX_POSTS = 20;
    const results = [];
    const seen = {};
    let staleCount = 0;

    // NEW: Login/Security wall diagnostic
    const isLoginPage = document.title.toLowerCase().includes('log in') || document.title.toLowerCase().includes('login') || !!document.querySelector('form.login__form');
    console.log(`[Ext-Worker] Page Status: Title="${document.title}", Links=${document.links.length}, isLogin=${isLoginPage}`);
    
    if (isLoginPage) {
        console.error("[Ext-Worker] CRITICAL: You are NOT logged in to LinkedIn or were redirected to the Login page. Extraction aborted.");
        sendJobFailed("LinkedIn Login required or redirect occurred.");
        return;
    }

    let containers = [];
    
    // Strategy A: Direct class/attribute matches
    const primarySelectors = '.reusable-search__result-container, .entity-result, .search-results__list-item, .artdeco-list__item, [data-view-name="feed-full-update"], .feed-shared-update-v2, li.artdeco-card, [data-urn*="activity:"], [data-urn*="ugcPost:"]';
    containers = Array.from(document.querySelectorAll(primarySelectors));

    // Strategy B: Component detection
    const actorContainers = document.querySelectorAll('.update-components-actor, .entity-result__actor-container, .update-components-actor__container');
    actorContainers.forEach(actor => {
       let parent = actor.closest('li, div.artdeco-card, .reusable-search__result-container, .entity-result');
       if (parent && !containers.includes(parent)) containers.push(parent);
    });

    // Strategy C: Link-First discovery
    const activityLinks = document.querySelectorAll('a[href*="activity"], a[href*="ugcPost"]');
    activityLinks.forEach(link => {
       let parent = link.closest('li, .entity-result, div.artdeco-card');
       if (parent && !containers.includes(parent)) containers.push(parent);
    });
    
    console.log(`[Ext-Worker] Found ${containers.length} potential post containers (A+B+C Discovery).`);
    
    if (containers.length === 0) {
      console.warn("[Ext-Worker] NO CONTAINERS FOUND! Capturing page snippet for debug...");
      const debugStr = `TITLE: ${document.title} | LINKS: ${document.links.length} | HTML: ${document.documentElement.innerHTML.substring(0, 2000)}`;
      await submitResultsToDashboard([], "DEBUG_EMPTY_PAGE", dashboardUrl, userId, debugStr);
    }

    let rawCount = 0;
    containers.forEach((container, idx) => {
      if (results.length >= MAX_POSTS) return;
      
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
      
      // Try data-urn directly
      if (!url) {
        let urnEl = container.getAttribute('data-urn') || container.querySelector('[data-urn]')?.getAttribute('data-urn');
        if (urnEl && (urnEl.includes('activity:') || urnEl.includes('ugcPost:'))) {
            url = 'https://www.linkedin.com/feed/update/' + (urnEl.includes('activity:') ? urnEl.split('activity:')[1].split(')')[0] : urnEl);
        }
      }

      // Try links directly (Secondary reliability)
      if (!url) {
        let link = container.querySelector('a[href*="/feed/update/"], a[href*="/update/urn:li:activity:"]');
        if (link) url = link.href.split('?')[0];
      }
      
      if (!url || seen[url]) return;
      seen[url] = true;
      rawCount++;

      let like = 0, comm = 0;
      let text = (container.innerText || '').replace(/[\n\r]/g, ' ');

      try {
        let mLike = text.match(/(\d[\d,]*)\s*(reactions?|likes?)/i);
        if (mLike) like = parseNum(mLike[1]);
        let mComm = text.match(/(\d[\d,]*)\s*comments?/i);
        if (mComm) comm = parseNum(mComm[1]);

        if (!like || !comm) {
          let allLabels = Array.from(container.querySelectorAll('[aria-label]'));
          for (let l = 0; l < allLabels.length; l++) {
            let label = (allLabels[l].getAttribute('aria-label') || '').toLowerCase();
            if (!like && (label.indexOf('reaction') !== -1 || label.indexOf('like') !== -1)) {
              let ml = label.match(/(\d[\d,]*)/);
              if (ml) like = parseNum(ml[1]);
            }
            if (!comm && label.indexOf('comment') !== -1) {
              let mc = label.match(/(\d[\d,]*)/);
              if (mc) comm = parseNum(mc[1]);
            }
          }
        }
      } catch (e) {}

      console.log(`[Ext-Worker] Checking post ${rawCount}: L=${like}, C=${comm} | URL: ${url}`);

      // Optional: Stale check (older than 6mo)
      let dateText = '';
      try {
        let dateEl = container.querySelector('.update-components-actor__sub-description, .entity-result__simple-insight, .entity-result__caption');
        dateText = (dateEl ? dateEl.innerText : '').toLowerCase();
        let m = dateText.match(/(\d+)mo/);
        if (m && parseInt(m[1]) > 6) staleCount++;
        if (dateText.indexOf('y') !== -1) staleCount++;
      } catch(e) {}

      // Filter based on user settings
      if (like >= (settings.minLikes || 0) && comm >= (settings.minComments || 0)) {
         results.push({ url, likes: like, comments: comm, author: 'Hidden', preview: text.substring(0, 100) });
      }
    });

    console.log(`[Ext-Worker] Extraction complete. Found ${results.length} valid posts.`);

    if (results.length > 0) {
      await submitResultsToDashboard(results, keyword, dashboardUrl, userId);
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
