// ═══════════════════════════════════════════════════════════
// LinkedIn Precision Extraction Engine v4 (Reverse-Handshake)
// Injected by background.js via chrome.scripting.executeScript
// ═══════════════════════════════════════════════════════════

if (!window.__linkedInListenersAdded) {
  window.__linkedInListenersAdded = true;
  window.__isExtracting = false;

  console.log("[Ext] 📡 Sending reverse-handshake to Worker...");
  
  // PING BACKGROUND SCRIPT: "I am ready, give me the job payload"
  chrome.runtime.sendMessage({ action: 'CONTENT_SCRIPT_READY' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("[Ext] ❌ Worker unreachable:", chrome.runtime.lastError.message);
      return;
    }
    
    if (response && response.action === 'EXECUTE_SEARCH_PAYLOAD') {
      console.log(`[Ext] ✅ Received SEARCH_PAYLOAD for: "${response.keyword}"`);
      
      if (window.__isExtracting) {
        console.log("[Ext] ⏭️ Already running, skip."); 
        return;
      }
      window.__isExtracting = true;
      
      runExtraction(response.keyword, response.settings, response.dashboardUrl, response.userId);
    }
  });

  async function runExtraction(keyword, settings, dashboardUrl, userId) {
    try { await extractPipeline(keyword, settings, dashboardUrl, userId); }
    catch (e) { 
      console.error("[Ext] ❌ Fatal:", e); 
      chrome.runtime.sendMessage({ action: 'JOB_FAILED', error: String(e) }); 
    }
    finally { window.__isExtracting = false; }
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

  async function extractPipeline(keyword, settings, dashboardUrl, userId) {
    const minL = settings.minLikes || 0;
    const minC = settings.minComments || 0;
    const MIN_POSTS = 10;
    const MAX_POSTS = 15;

    console.log(`[Ext] ═══ PIPELINE START ═══`);
    console.log(`[Ext] Keyword: "${keyword}" | Reach: minLikes=${minL}, minComments=${minC}`);
    console.log(`[Ext] Current URL: ${window.location.href}`);

    // ── PHASE 1: Wait for page + click Posts tab ──
    console.log(`[Ext] ⏳ Phase 1: Page hydration...`);
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
    for (let i = 0; i < 25; i++) {
      window.scrollBy({ top: 800, behavior: 'smooth' });
      await wait(2000, 3500);
      // Click "Show more results" if it appears
      const more = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.toLowerCase().includes('show more') ||
        b.innerText.toLowerCase().includes('see more') ||
        b.innerText.toLowerCase().includes('عرض المزيد')
      );
      if (more && more.offsetParent !== null) { more.click(); await wait(2000, 3000); }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await wait(2000, 3000);

    // ── PHASE 3: Discover post containers ──
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

      allPosts.push({ url, likes, comments, author, preview });
    }

    console.log(`[Ext]    Extracted: ${allPosts.length} unique posts (${noUrlCount} without original URL, ${dupCount} duplicates skipped)`);

    if (allPosts.length === 0) {
      console.error("[Ext] ❌ Extraction produced 0 posts from containers! Sending debug.");
      await syncToDashboard([], "DEBUG_ZERO_EXTRACTED", dashboardUrl, userId,
        `CONTAINERS:${containers.length}|NO_URL:${noUrlCount}|DUP:${dupCount}`);
      chrome.runtime.sendMessage({ action: 'JOB_COMPLETED' });
      return;
    }

    // ── PHASE 5: 3-Tier Precision Reach Filter ──
    console.log(`[Ext] 🎯 Phase 5: Applying 3-Tier reach filter...`);

    // Tier 1: EXACT match (likes >= minL AND comments >= minC)
    const tier1 = allPosts
      .filter(p => p.likes >= minL && p.comments >= minC)
      .sort((a, b) => {
        // HIGHEST reach first
        const reachA = (a.likes || 0) + (a.comments || 0);
        const reachB = (b.likes || 0) + (b.comments || 0);
        return reachB - reachA;
      });
    console.log(`[Ext]    Tier 1 (Exact Reach): ${tier1.length} posts`);

    // Tier 2: CLOSEST reach (doesn't meet criteria but ranked by proximity)
    const tier1Set = new Set(tier1.map(p => p.url || ""));
    const tier2 = allPosts
      .filter(p => !tier1Set.has(p.url))
      .sort((a, b) => {
        const dA = Math.max(0, minL - (a.likes || 0)) + Math.max(0, minC - (a.comments || 0));
        const dB = Math.max(0, minL - (b.likes || 0)) + Math.max(0, minC - (b.comments || 0));
        if (dA !== dB) return dA - dB;
        // Tie breaker highest reach
        const reachA = (a.likes || 0) + (a.comments || 0);
        const reachB = (b.likes || 0) + (b.comments || 0);
        return reachB - reachA;
      });
    console.log(`[Ext]    Tier 2 (Closest Reach): ${tier2.length} posts`);

    // Assemble final output
    const final = [];
    
    // UNLIMITED Exact Matches: push everything in Tier 1
    for (const p of tier1) { 
        final.push(p); 
    }
    
    // FALLBACK: Only if we are under MIN_POSTS, pad with Tier 2 up to at least MIN_POSTS
    if (final.length < MIN_POSTS) {
      for (const p of tier2) { 
        if (final.length >= MIN_POSTS) break; 
        final.push(p); 
      }
    }
    
    console.log(`[Ext] ✅ Final output: ${final.length} posts (${tier1.length} exact, ${final.length - tier1.length} closest)`);

    // ── PHASE 6: Sync to dashboard ──
    if (final.length > 0) {
      console.log(`[Ext] 📤 Phase 6: Syncing ${final.length} posts...`);
      await syncToDashboard(final, keyword, dashboardUrl, userId);
    } else {
      console.warn("[Ext] ⚠️ Zero posts after filtering!");
      await syncToDashboard([], "DEBUG_FILTER_EMPTY", dashboardUrl, userId,
        `ALL:${allPosts.length}|T1:${tier1.length}|T2:${tier2.length}|minL:${minL}|minC:${minC}`);
    }

    chrome.runtime.sendMessage({ action: 'JOB_COMPLETED' });
    console.log(`[Ext] ═══ PIPELINE COMPLETE ═══`);
  }

  async function syncToDashboard(posts, keyword, dashboardUrl, userId, debug = null) {
    try {
      const r = await fetch(`${dashboardUrl}/api/extension/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
        body: JSON.stringify({ keyword, posts, debugInfo: debug })
      });
      console.log(`[Ext] Sync response: ${r.status} ${r.statusText}`);
    } catch (e) { console.error("[Ext] Sync failed:", e); }
  }

} // end guard
