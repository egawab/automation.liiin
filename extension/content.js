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
        await doExtraction(keyword, settings, dashboardUrl, userId);
      } finally {
        isExtracting = false;
      }
    };

// ─────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function humanDelay(min, max) {
  await sleep(Math.floor(Math.random() * (max - min + 1)) + min);
}

function parseNum(t) {
  if (!t) return 0;
  const c = String(t).toLowerCase().replace(/,/g, '').trim();
  const m = c.match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (c.includes('k')) n *= 1000;
  if (c.includes('m')) n *= 1000000;
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
        const urn = inner.updateUrn || inner?.controlledUpdateRegion?.updateUrn;
        if (urn) return urn;
      }
    }
  } catch (e) {}
  return null;
}

// ─────────────────────────────────────────────────────
// MAIN EXTRACTION ENGINE
// ─────────────────────────────────────────────────────

async function doExtraction(keyword, settings, dashboardUrl, userId) {
  const MIN_POSTS = 10;
  const MAX_POSTS = 15;
  const minL = settings.minLikes || 0;
  const minC = settings.minComments || 0;

  try {
    console.log(`[Ext-Worker] ⏳ Page hydration (5-7s)...`);
    await humanDelay(5000, 7000);

    // Click "Posts" filter if not already on it
    if (!window.location.href.includes('/content/')) {
      const postBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Posts'));
      if (postBtn) { postBtn.click(); await humanDelay(5000, 7000); }
    }

    // ── PHASE 1: SCROLL TO LOAD CONTENT ──
    console.log(`[Ext-Worker] 🚀 Phase 1: Scrolling 25 cycles to load content...`);
    for (let i = 0; i < 25; i++) {
      window.scrollBy({ top: 900, behavior: 'smooth' });
      await humanDelay(2000, 4000);
      const seeMore = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.toLowerCase().includes('see more') || b.innerText.toLowerCase().includes('عرض المزيد')
      );
      if (seeMore && seeMore.offsetParent !== null) { seeMore.click(); await humanDelay(3000, 5000); }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await humanDelay(2000, 3000);

    // ── PHASE 2: DISCOVER ALL POST CONTAINERS ──
    console.log(`[Ext-Worker] 🔍 Phase 2: Discovering post containers...`);
    const primarySelectors = '.reusable-search__result-container, .entity-result, .search-results__list-item, .artdeco-list__item, [data-view-name="feed-full-update"], .feed-shared-update-v2, li.artdeco-card';
    let containers = Array.from(document.querySelectorAll(primarySelectors));

    // Semantic fallback: find divs that look like posts
    document.querySelectorAll('div, li, article').forEach(el => {
      if (containers.includes(el)) return;
      const t = el.innerText || '';
      if ((t.includes('Like') || t.includes('إعجاب')) && (t.includes('Comment') || t.includes('تعليق')) && t.length > 300) {
        containers.push(el);
      }
    });
    console.log(`[Ext-Worker]    Found ${containers.length} raw containers.`);

    // ── PHASE 3: EXTRACT DATA FROM EACH CONTAINER ──
    console.log(`[Ext-Worker] 📊 Phase 3: Extracting engagement data...`);
    const allPosts = [];
    const seen = {};

    for (const container of containers) {
      if (allPosts.length >= 100) break; // hard cap on scan buffer

      // URL extraction
      let url = null;
      const link = container.querySelector('a[href*="/feed/update/"], a[href*="/update/urn:li:activity:"], a.app-aware-link[href*="activity"]');
      if (link) url = link.href.split('?')[0];
      if (!url) {
        const urn = decodeTrackingScope(container);
        if (urn) url = 'https://www.linkedin.com/feed/update/' + urn;
      }
      if (!url || seen[url]) continue;
      seen[url] = true;

      // Engagement extraction
      let likes = 0, comments = 0;
      const ariaLabels = Array.from(container.querySelectorAll('[aria-label]'))
        .map(el => el.getAttribute('aria-label').toLowerCase());
      for (const label of ariaLabels) {
        const num = parseNum(label.match(/(\d[\d,]*k?m?)/)?.[0]);
        if (!likes && (label.includes('reaction') || label.includes('like') || label.includes('إعجاب'))) likes = num;
        if (!comments && (label.includes('comment') || label.includes('تعليق'))) comments = num;
      }
      if (!likes || !comments) {
        const btnTexts = Array.from(container.querySelectorAll('button, span, a')).map(el => el.innerText.toLowerCase());
        for (const bt of btnTexts) {
          const num = parseNum(bt.match(/(\d[\d,]*k?m?)/)?.[0]);
          if (!likes && (bt.includes('إعجاب') || bt.includes('reaction'))) likes = num;
          if (!comments && (bt.includes('تعليق') || bt.includes('comment'))) comments = num;
        }
      }

      // Author extraction
      let author = 'LinkedIn Member';
      const authorEl = container.querySelector('.update-components-actor__name, .entity-result__title-text, .update-components-actor__title');
      if (authorEl) author = authorEl.innerText.split('\n')[0].trim();

      const preview = (container.innerText || '').replace(/[\n\r]/g, ' ').substring(0, 400).trim();

      allPosts.push({ url, likes, comments, author, preview });
    }

    console.log(`[Ext-Worker]    Extracted ${allPosts.length} unique posts with engagement data.`);

    // ── PHASE 4: 3-TIER PRECISION REACH FILTER ──
    console.log(`[Ext-Worker] 🎯 Phase 4: Applying Precision Reach Filter (minLikes=${minL}, minComments=${minC})...`);

    // Tier 1: EXACT MATCH — likes >= minLikes AND comments >= minComments
    const tier1 = allPosts.filter(p => p.likes >= minL && p.comments >= minC);
    // Sort Tier 1 by closest distance to target (prefer posts closest to your criteria, not wildly above)
    tier1.sort((a, b) => {
      const distA = Math.abs(a.likes - minL) + Math.abs(a.comments - minC);
      const distB = Math.abs(b.likes - minL) + Math.abs(b.comments - minC);
      return distA - distB;
    });

    // Tier 2: CLOSEST REACH — posts that don't fully match, sorted by distance to target
    const tier1Urls = new Set(tier1.map(p => p.url));
    const tier2 = allPosts.filter(p => !tier1Urls.has(p.url));
    tier2.sort((a, b) => {
      const distA = Math.abs(a.likes - minL) + Math.abs(a.comments - minC);
      const distB = Math.abs(b.likes - minL) + Math.abs(b.comments - minC);
      return distA - distB;
    });

    // Tier 3: BEST AVAILABLE — by raw engagement score
    const tier3 = [...tier2].sort((a, b) => (b.likes + b.comments * 5) - (a.likes + a.comments * 5));

    // ── PHASE 5: ASSEMBLE FINAL RESULTS (10-15 posts) ──
    const finalResults = [];
    // Step 1: Add all Tier 1 (exact matches) up to MAX_POSTS
    for (const p of tier1) {
      if (finalResults.length >= MAX_POSTS) break;
      finalResults.push(p);
    }
    // Step 2: If under MIN_POSTS, fill from Tier 2 (closest reach)
    if (finalResults.length < MIN_POSTS) {
      for (const p of tier2) {
        if (finalResults.length >= MAX_POSTS) break;
        if (finalResults.some(r => r.url === p.url)) continue;
        finalResults.push(p);
      }
    }
    // Step 3: If STILL under MIN_POSTS, fill from Tier 3 (best engagement)
    if (finalResults.length < MIN_POSTS) {
      for (const p of tier3) {
        if (finalResults.length >= MIN_POSTS) break;
        if (finalResults.some(r => r.url === p.url)) continue;
        finalResults.push(p);
      }
    }

    const exactCount = Math.min(tier1.length, MAX_POSTS);
    console.log(`[Ext-Worker] ✅ Phase 5: Final Results = ${finalResults.length} posts.`);
    console.log(`[Ext-Worker]    Tier 1 (Exact Reach): ${exactCount}`);
    console.log(`[Ext-Worker]    Tier 2 (Closest Reach): ${finalResults.length - exactCount}`);

    // ── PHASE 6: SUBMIT TO DASHBOARD ──
    if (finalResults.length > 0) {
      console.log(`[Ext-Worker] 📤 Phase 6: Syncing ${finalResults.length} posts to Dashboard...`);
      await submitResults(finalResults, keyword, dashboardUrl, userId);
    } else {
      console.warn("[Ext-Worker] ⚠️ ZERO results after filtering! Sending debug info.");
      await submitResults([], "DEBUG_EMPTY", dashboardUrl, userId, `TITLE: ${document.title} | URL: ${window.location.href}`);
    }

    chrome.runtime.sendMessage({ action: 'JOB_COMPLETED' });

  } catch (error) {
    console.error("[Ext-Worker] ❌ Fatal error:", error);
    chrome.runtime.sendMessage({ action: 'JOB_FAILED', error: String(error) });
  }
}

// ─────────────────────────────────────────────────────
// DASHBOARD SYNC
// ─────────────────────────────────────────────────────

async function submitResults(posts, keyword, dashboardUrl, userId, debugInfo = null) {
  try {
    const res = await fetch(`${dashboardUrl}/api/extension/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
      body: JSON.stringify({ keyword, posts, debugInfo })
    });
    if (res.ok) console.log(`[Ext-Worker] ✅ Synced ${posts.length} posts successfully.`);
    else console.error(`[Ext-Worker] ❌ Server error: ${res.status}`);
  } catch (err) {
    console.error("[Ext-Worker] ❌ Network sync error:", err);
  }
}

} // end isLinkedInWorkerLoaded guard
