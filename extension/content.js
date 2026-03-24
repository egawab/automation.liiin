// ═══════════════════════════════════════════════════════════
// LinkedIn Precision Extraction Engine v4 (Reverse-Handshake)
// Injected by background.js via chrome.scripting.executeScript
// ═══════════════════════════════════════════════════════════

if (!window.__linkedInListenersAdded) {
  window.__linkedInListenersAdded = true;
  window.__isExtracting = false;

  console.log("[Ext] 📡 Sending reverse-handshake to Worker...");
  console.log("[Ext] Timing: Handshake initiated at " + new Date().toLocaleTimeString());
  
  // PING BACKGROUND SCRIPT: "I am ready, give me the job payload"
  chrome.runtime.sendMessage({ action: 'CONTENT_SCRIPT_READY' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("[Ext] ❌ Worker unreachable:", chrome.runtime.lastError.message);
      return;
    }
    
    if (response && response.action === 'EXECUTE_SEARCH_PAYLOAD') {
      console.log(`[Ext] ✅ Received SEARCH_PAYLOAD at ${new Date().toLocaleTimeString()} for: "${response.keyword}"`);
      if (window.__isExtracting) return;
      window.__isExtracting = true;
      runExtraction(response.keyword, response.settings, response.dashboardUrl, response.userId);
    } else {
      console.log("[Ext] 💤 No payload received (Worker idle/WAIT).");
    }
  });

  async function runExtraction(keyword, settings, dashboardUrl, userId) {
    try { await extractPipeline(keyword, settings, dashboardUrl, userId); }
    catch (e) { 
      console.error("[Ext] ❌ Fatal Error:", e); 
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

    console.log(`[Ext] ═══ PIPELINE START ═══`);
    console.log(`[Ext] Keyword: "${keyword}" | Reach: minLikes=${minL}, minComments=${minC}`);

    // ── PHASE 1: Wait for hydration ──
    await wait(5000, 7000);

    // ── PHASE 2: Scroll to load content ──
    console.log(`[Ext] 📜 Phase 2: Scrolling 25 cycles...`);
    for (let i = 0; i < 25; i++) {
      window.scrollBy({ top: 800, behavior: 'smooth' });
      await wait(2000, 3500);
      const more = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.toLowerCase().includes('show more') ||
        b.innerText.toLowerCase().includes('see more') ||
        b.innerText.toLowerCase().includes('عرض المزيد')
      );
      if (more && more.offsetParent !== null) { more.click(); await wait(2000, 3000); }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await wait(2000, 3000);

    // ── PHASE 3: Discover containers ──
    const containers = [];
    ['.reusable-search__result-container', '.entity-result', '.search-results__list-item', '.artdeco-list__item', '.feed-shared-update-v2', 'li.artdeco-card', '[data-view-name="feed-full-update"]'].forEach(sel => {
        document.querySelectorAll(sel).forEach(el => { if (!containers.includes(el)) containers.push(el); });
    });

    if (containers.length === 0) {
      console.error(`[Ext] ❌ 0 containers found.`);
      await syncRelay([], "DEBUG_ZERO_CONTAINERS", keyword, dashboardUrl, userId, `URL:${window.location.href}|BODY_LEN:${document.body.innerText.length}`);
      chrome.runtime.sendMessage({ action: 'JOB_COMPLETED' });
      return;
    }

    // ── PHASE 4: Extract data ──
    const allPosts = [];
    const seenUrls = {};
    for (let i = 0; i < containers.length && allPosts.length < 100; i++) {
      const c = containers[i];
      let url = null;
      // Multi-strategy URL extraction
      const linkSelectors = ['a[href*="/feed/update/"]', 'a[href*="urn:li:activity:"]', 'a[href*="urn:li:ugcPost:"]', 'a.app-aware-link[href*="activity"]', 'a[href*="/posts/"]'];
      for (const sel of linkSelectors) {
         const el = c.querySelector(sel);
         if (el) { url = el.href.split('?')[0]; break; }
      }
      if (!url) {
         const html = c.innerHTML;
         const match = html.match(/urn:li:activity:\d+/) || html.match(/urn:li:ugcPost:\d+/);
         if (match) url = 'https://www.linkedin.com/feed/update/' + match[0];
      }

      if (!url || seenUrls[url]) continue;
      seenUrls[url] = true;

      // Likes/Comments
      let likes = 0, comments = 0;
      c.querySelectorAll('[aria-label]').forEach(e => {
         const l = e.getAttribute('aria-label').toLowerCase();
         if (l.includes('reaction') || l.includes('like') || l.includes('إعجاب')) likes = num(l);
         if (l.includes('comment') || l.includes('تعليق')) comments = num(l);
      });
      if (!likes) {
         const el = c.querySelector('.social-details-social-counts__reactions-count');
         if (el) likes = num(el.innerText);
      }
      if (!comments) {
         const el = c.querySelector('.social-details-social-counts__comments');
         if (el) comments = num(el.innerText);
      }

      const authorEl = c.querySelector('.update-components-actor__name, .entity-result__title-text, .update-components-actor__title');
      const author = authorEl ? authorEl.innerText.split('\n')[0].trim() : 'Unknown';
      const preview = (c.innerText || '').replace(/[\n\r]+/g, ' ').substring(0, 400).trim();

      allPosts.push({ url, likes, comments, author, preview });
    }

    if (allPosts.length === 0) {
      await syncRelay([], "DEBUG_ZERO_EXTRACTED", keyword, dashboardUrl, userId, `CONTAINERS:${containers.length}`);
      chrome.runtime.sendMessage({ action: 'JOB_COMPLETED' });
      return;
    }

    // ── PHASE 5: Filtering ──
    const tier1 = allPosts
      .filter(p => (p.likes || 0) >= minL && (p.comments || 0) >= minC)
      .sort((a, b) => ((b.likes || 0) + (b.comments || 0)) - ((a.likes || 0) + (a.comments || 0)));

    const tier1Urls = new Set(tier1.map(p => p.url));
    const tier2 = allPosts
      .filter(p => !tier1Urls.has(p.url))
      .sort((a, b) => {
         const distA = Math.max(0, minL - (a.likes || 0)) + Math.max(0, minC - (a.comments || 0));
         const distB = Math.max(0, minL - (b.likes || 0)) + Math.max(0, minC - (b.comments || 0));
         return distA - distB;
      });

    const final = [...tier1];
    if (final.length < MIN_POSTS) {
       for (const p of tier2) { if (final.length >= MIN_POSTS) break; final.push(p); }
    }

    // ── PHASE 6: Sync Relay ──
    if (final.length > 0) {
       await syncRelay(final, null, keyword, dashboardUrl, userId);
    } else {
       await syncRelay([], "DEBUG_FILTER_EMPTY", keyword, dashboardUrl, userId, `ALL:${allPosts.length}|minL:${minL}`);
    }

    chrome.runtime.sendMessage({ action: 'JOB_COMPLETED' });
    console.log(`[Ext] ═══ PIPELINE COMPLETE ═══`);
  }

  async function syncRelay(posts, debugInfo, keyword, dashboardUrl, userId) {
    // We send to background script instead of direct fetch
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ 
         action: 'SYNC_RESULTS', 
         posts, 
         keyword, 
         dashboardUrl, 
         userId, 
         debugInfo 
      }, () => resolve());
    });
  }

} // end guard

