if (typeof window.isLinkedInWorkerLoaded === 'undefined') {
    window.isLinkedInWorkerLoaded = true;
    
    let isExtracting = false;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'EXECUTE_SEARCH') {
        sendResponse({ received: true });
        console.log(`[Ext-Worker] Received job for keyword: ${request.keyword}`);
        window.executeSearchAndExtract(request.keyword, request.settings, request.dashboardUrl, request.userId);
      }
    });

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
    }
  } catch (e) { }
  return null;
}

async function executeSearchAndExtractInner(keyword, settings, dashboardUrl, userId) {
  try {
    console.log("[Ext-Worker] Waiting for contents to load...");
    await humanDelay(5000, 7000);

    // Ensure we are on the "Posts" filter
    if (!window.location.href.includes('/content/')) {
        const postBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Posts'));
        if (postBtn) {
            postBtn.click();
            await humanDelay(5000, 7000);
        }
    }

    console.info("🚀 [Ext-Worker] STARTING HIGH-VOLUME EXTRACTION...");
    
    // Industrial Scrolling: 25 cycles for maximum content
    for (let i = 0; i < 25; i++) {
        window.scrollBy({ top: 900, behavior: 'smooth' });
        await humanDelay(2000, 4000);
        
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
    await humanDelay(2000, 3000);

    const allCandidatePosts = [];
    const seen = {};
    const MAX_BUFFER = 100;

    // Discovery Strategy: Selectors + Semantic
    const primarySelectors = '.reusable-search__result-container, .entity-result, .search-results__list-item, .artdeco-list__item, [data-view-name="feed-full-update"], .feed-shared-update-v2, li.artdeco-card';
    let containers = Array.from(document.querySelectorAll(primarySelectors));
    
    // Semantic scan to ensure we miss nothing
    document.querySelectorAll('div, li, article').forEach(el => {
        if (containers.includes(el)) return;
        const text = el.innerText || '';
        if ((text.includes('Like') || text.includes('إعجاب')) && (text.includes('Comment') || text.includes('تعليق')) && text.length > 300) {
            containers.push(el);
        }
    });

    console.log(`🎯 [Ext-Worker] Scan found ${containers.length} potential posts.`);

    containers.forEach((container) => {
      if (allCandidatePosts.length >= MAX_BUFFER) return;
      
      let url = null;
      const link = container.querySelector('a[href*="/feed/update/"], a[href*="/update/urn:li:activity:"], a.app-aware-link[href*="activity"]');
      if (link) url = link.href.split('?')[0];

      if (!url) {
        let urn = decodeTrackingScope(container);
        if (urn) url = 'https://www.linkedin.com/feed/update/' + urn;
      }
      
      if (!url || seen[url]) return;
      seen[url] = true;

      let like = 0, comm = 0;
      let text = (container.innerText || '').replace(/[\n\r]/g, ' ');
      
      // Engagement extraction
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

      let author = 'LinkedIn Member';
      const authorEl = container.querySelector('.update-components-actor__name, .entity-result__title-text, .update-components-actor__title');
      if (authorEl) author = authorEl.innerText.split('\n')[0].trim();

      allCandidatePosts.push({ 
        url, likes: like, comments: comm, author, preview: text.substring(0, 400).trim(),
        score: (like * 1) + (comm * 5)
      });
    });

    // FINAL GREEDY FILTER: Send everything found, let dashboard handle display
    const finalResults = allCandidatePosts.sort((a,b) => b.score - a.score).slice(0, 30);

    console.info(`🏁 [Ext-Worker] EXTRACTION DONE. Found ${finalResults.length} posts.`);

    if (finalResults.length > 0) {
      await submitResultsToDashboard(finalResults, keyword, dashboardUrl, userId);
    } else {
      console.warn("⚠️ [Ext-Worker] ZERO RESULTS! Sending debug report.");
      await submitResultsToDashboard([], "DEBUG_EMPTY_PAGE", dashboardUrl, userId, `TITLE: ${document.title} | URL: ${window.location.href}`);
    }

    sendJobCompleted();

  } catch (error) {
    console.error("[Ext-Worker] Fatal error:", error);
    chrome.runtime.sendMessage({ action: 'JOB_FAILED', error: String(error) });
  }
}

async function submitResultsToDashboard(posts, keyword, dashboardUrl, userId, debugInfo = null) {
  try {
    await fetch(`${dashboardUrl}/api/extension/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
      body: JSON.stringify({ keyword, posts, debugInfo })
    });
  } catch (err) { console.error("[Ext-Worker] Sync Error:", err); }
}

function sendJobCompleted() {
  chrome.runtime.sendMessage({ action: 'JOB_COMPLETED' });
}
}
