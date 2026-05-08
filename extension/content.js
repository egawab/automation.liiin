// content.js v15 â€” Scroll controller + interceptor bridge
(async function () {
  if (window.__NexoraScrollerActive) {
    if (window.__NexoraScrollerUrl === location.href) return;
    // URL changed, allow restart!
    console.log('[SCROLL] Restarting for new URL');
    if (window.__NexoraExtractInterval) clearInterval(window.__NexoraExtractInterval);
  }
  window.__NexoraScrollerActive = true;
  window.__NexoraScrollerUrl = location.href;
  console.log("[SCROLL] v15 active");

  // â”€â”€ Bridge: forward interceptor.js (MAIN world) network bodies to background
  window.addEventListener('__nexora_net__', (e) => {
    try {
      const { body } = e.detail || {};
      if (body && body.length > 50) {
        chrome.runtime.sendMessage({ action: 'CDP_RAW_BODY', body }).catch(() => {});
      }
    } catch (_) {}
  });
  console.log('[SCROLL] Interceptor bridge active');
    // ── DOM Extraction Loop ─────────────────────────────────────────────────
  
  function parseEng(str) {
    if (!str) return null;
    var s = str.toUpperCase().replace(/,/g, '');
    var m = s.match(/[\d.]+/);
    if (!m) return null;
    var n = parseFloat(m[0]);
    if (s.indexOf('K') > -1) n *= 1000;
    if (s.indexOf('M') > -1) n *= 1000000;
    return Math.floor(n);
  }

  function extractPostsFromDOM() {
    var posts = [];
    var seen = new Set();
    
    var allLinks = Array.from(document.querySelectorAll('a[href]'));
    var postLinks = allLinks.filter(function(a) {
      return a.href && (a.href.indexOf('feed/update/urn:li:') > -1 || a.href.indexOf('/posts/') > -1);
    });

    postLinks.forEach(function(link) {
      var href = link.href || '';
      var urn = '';
      var um = href.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
      if (um) {
        urn = 'urn:li:' + um[1] + ':' + um[2];
      } else {
        var pm = href.match(/activity-([0-9]{10,25})/);
        if (pm) urn = 'urn:li:activity:' + pm[1];
      }
      if (!urn) return;
      if (seen.has(urn)) return;
      seen.add(urn);

      // Walk up
      var container = link, best = null;
      for (var i = 0; i < 25; i++) {
        container = container.parentElement;
        if (!container || container === document.body) break;
        var len = (container.innerText || '').trim().length;
        if (len > 30 && len < 15000) { best = container; break; }
      }
      if (!best) return;

      var authorEl = best.querySelector('a[href*="/in/"]');
      var author = authorEl ? (authorEl.innerText || '').trim().split('\n')[0].substring(0, 100) : '';

      var postText = '';
      var textCandidates = Array.from(best.querySelectorAll('[dir="ltr"], .feed-shared-update-v2__description, .update-components-text, .search-result__snippets, .break-words'));
      textCandidates.forEach(function(d) {
        var t = (d.innerText||'').trim();
        if (t.length > postText.length) postText = t;
      });
      if (postText.length < 10) postText = (best.innerText || '').replace(/\s+/g, ' ').trim().substring(0, 3000);

      function parseEng(str) {
        if (!str) return null;
        var s = str.toUpperCase().replace(/,/g, '');
        var m = s.match(/[0-9.]+/);
        if (!m) return null;
        var n = parseFloat(m[0]);
        if (s.indexOf('K') > -1) n *= 1000;
        if (s.indexOf('M') > -1) n *= 1000000;
        return Math.floor(n);
      }

      var likes = null;
      Array.from(best.querySelectorAll('[aria-label]')).forEach(function(el){
        if (likes !== null) return;
        var l = el.getAttribute('aria-label') || '';
        if (/[0-9]/.test(l) && /(reaction|like)/i.test(l)) {
          likes = parseEng(l);
        }
      });
      if (likes === null) {
        var bm = (best.innerText||'').match(/([0-9.,]+[KkMm]?)\s*(reactions?|likes?)/i);
        if (bm) likes = parseEng(bm[1]);
      }

      var comments = null;
      Array.from(best.querySelectorAll('[aria-label]')).forEach(function(el){
        if (comments !== null) return;
        var l = el.getAttribute('aria-label') || '';
        if (/[0-9]/.test(l) && /comment/i.test(l)) {
          comments = parseEng(l);
        }
      });
      if (comments === null) {
        var cm = (best.innerText||'').match(/([0-9.,]+[KkMm]?)\s*comment/i);
        if (cm) comments = parseEng(cm[1]);
      }

      posts.push({
        urn: urn,
        url: href,
        text: postText.substring(0, 3000),
        author: author,
        likes: likes,
        comments: comments
      });
    });

    
    var nextBtn = document.querySelector('.artdeco-pagination__button--next, button[aria-label="Next"]');
    if (nextBtn && !nextBtn.disabled) {
      var rect = nextBtn.getBoundingClientRect();
      if (rect.top >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + 500) {
        try { nextBtn.click(); } catch(e){}
      } else {
        window.scrollBy(0, 1000);
      }
    } else {
      window.scrollBy(0, 800);
    }
  

    return posts;
  }

  // أرسل كل 3.5 ثانية
  window.__NexoraExtractInterval = setInterval(function(){
    try {
      var posts = extractPostsFromDOM();
      if (posts.length > 0) {
        chrome.runtime.sendMessage({action:'DOM_POSTS', posts:posts}).catch(function(){});
        console.log('[DOM] Extracted', posts.length, 'posts');
      }
    } catch(_) {}
  }, 3500);


  const MAX_STEPS = 80, SCROLL_PX = Math.floor(window.innerHeight * 0.82);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const randWait = () => sleep(2200 + Math.floor(Math.random() * 1800));

  // Keep-alive: ping background every 2s to prevent SW suspension
  const keepAlive = setInterval(() => {
    chrome.runtime.sendMessage({ action: 'KEEP_ALIVE' }).catch(() => clearInterval(keepAlive));
  }, 2000);

  function status(t) { chrome.runtime.sendMessage({ action: 'EXTENSION_LIVE_STATUS', text: t }).catch(() => {}); }

  async function getCdpCount() {
    return new Promise(res => {
      try { chrome.runtime.sendMessage({ action: 'GET_CDP_COUNT' }, r => res(r?.count ?? 0)); }
      catch (_) { res(0); }
    });
  }

  // â”€â”€ Service Worker cache dump â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function dumpSwCache() {
    try {
      if (!('caches' in window)) return 0;
      const names = await caches.keys();
      console.log(`[SCROLL] SW caches: ${JSON.stringify(names)}`);
      let sent = 0;
      for (const name of names) {
        const cache = await caches.open(name);
        const reqs = await cache.keys();
        console.log(`[SCROLL] Cache "${name}": ${reqs.length} entries`);
        for (const req of reqs) {
          const url = req.url || '';
          if (!/linkedin\.com/i.test(url)) continue;
          if (/\.(js|css|png|jpg|gif|woff|svg|ico|webp)(\?|$)/i.test(url)) continue;
          try {
            const resp = await cache.match(req);
            if (!resp) continue;
            const ct = resp.headers.get('content-type') || '';
            if (!ct.includes('json') && !ct.includes('text')) continue;
            const body = await resp.text();
            if (!body || body.length < 50) continue;
            chrome.runtime.sendMessage({ action: 'CDP_RAW_BODY', body, url });
            sent++;
          } catch (_) {}
        }
      }
      console.log(`[SCROLL] SW cache: ${sent} responses forwarded`);
      return sent;
    } catch (e) { console.warn('[SCROLL] SW cache error:', e.message); return 0; }
  }

  // â”€â”€ Scroll helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let _sc = null;

  // LinkedIn SDUI search results scroll container selectors (ranked by specificity)
  const CONTAINER_SELECTORS = [
    '.search-results-container',
    '.reusable-search__entity-result-list',
    '.scaffold-finite-scroll__content',
    '.scaffold-layout__main',
    '[data-view-name="search-results"]',
    'main',
  ];

  function findContainer() {
    for (const s of CONTAINER_SELECTORS) {
      const el = document.querySelector(s);
      if (!el) continue;
      const st = window.getComputedStyle(el);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 100) return el;
    }
    return null;
  }

  function doScroll() {
    // Scroll smoothly by one viewport — لينكدان بيلود البوستات lazily
    window.scrollBy({ top: Math.floor(window.innerHeight * 0.85), behavior: 'smooth' });
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    // لو عندنا container محدد، اسكروله برضه
    if (_sc) {
      _sc.scrollTop += Math.floor(_sc.clientHeight * 0.85);
      _sc.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
  }

  function distBottom() {
    if (_sc) return _sc.scrollHeight - _sc.scrollTop - _sc.clientHeight;
    return document.body.scrollHeight - window.scrollY - window.innerHeight;
  }

  function clickShowMore() {
    const candidates = [...document.querySelectorAll('button, a, [role="button"]')];
    const btn = candidates.find(b => {
      const t = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim();
      return /show more|load more|see more results|view more|next page/i.test(t);
    });
    if (btn) {
      btn.click();
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      console.log('[SCROLL] Clicked:', btn.innerText?.trim());
      return true;
    }
    return false;
  }


  // â”€â”€ MAIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const kw = new URL(location.href).searchParams.get('keywords') || 'posts';
  status(`Initializing for "${kw}"â€¦`);
  await sleep(2000);
  _sc = findContainer();

  // Dump SW cache at startup â€” background extracts posts from these
  status('Reading cacheâ€¦');
  await dumpSwCache();

  // Wait briefly for background Runtime.evaluate to run
  await sleep(2000);

  let step = 0, sameCount = 0, lastCount = 0;

  while (step < MAX_STEPS) {
    step++;
    const count = await getCdpCount();
    console.log(`[SCROLL] Step ${step}/${MAX_STEPS} | CDP count: ${count}`);
    status(`Step ${step}/${MAX_STEPS} | Posts: ${count}`);

    await sleep(700);
    if (count === lastCount) sameCount++;
    else { sameCount = 0; lastCount = count; }

    if (sameCount >= 12) {
      if (clickShowMore()) { sameCount = 0; await sleep(3500); continue; }
      if (count >= 20 || step >= MAX_STEPS - 5) { console.log('[SCROLL] Done â€” sufficient posts'); break; }
      sameCount = 0;
    }

    doScroll();
    await randWait();

    if (distBottom() < 300) {
      if (!clickShowMore() && count >= 20) break;
      await sleep(3000);
    }
  }

  clearInterval(keepAlive);
  status(`Scroll complete â€” finalizingâ€¦`);
  await sleep(1000);
  chrome.runtime.sendMessage({ action: 'CONTENT_SCROLL_COMPLETE' });
  window.__NexoraScrollerActive = false;
})();
