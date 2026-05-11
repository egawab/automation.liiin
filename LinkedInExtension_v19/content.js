// content.js v15 â€” Scroll controller + interceptor bridge
(async function () {
  if (window.__NexoraScrollerActive) return;
  window.__NexoraScrollerActive = true;
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
  function extractPostsFromDOM() {
    var posts = [], seen = {};

    // البحث عن طريق روابط البوستات (أضمن طريقة لأن الرابط دايماً جوه كارت البوست نفسه)
    var allLinks = Array.from(document.querySelectorAll('a[href]'));
    
    allLinks.forEach(function(link) {
      var dec = '';
      try { dec = decodeURIComponent(link.href || ''); } catch(e) { dec = link.href || ''; }
      
      // لازم الرابط يكون لبوست
      if (!dec.includes('urn:li:activity') && !dec.includes('urn:li:ugcPost') && !dec.includes('/posts/') && !dec.includes('feed/update/')) return;
      
      var um = dec.match(/urn:li:(activity|ugcPost|share):(\d{10,25})/);
      if (!um) return;
      var urn = 'urn:li:' + um[1] + ':' + um[2];
      
      if (seen[urn]) return;
      
      // نطلع لفوق لحد ما نلاقي الكارت اللي شايل البوست (لازم يكون فيه نص كفاية)
      var node = link, best = null;
      for (var i = 0; i < 35; i++) {
        node = node.parentElement;
        if (!node || node === document.body) break;
        var len = (node.innerText || '').length;
        // الكارت لازم يكون فيه تفاصيل (أكتر من 50 حرف)
        if (len > 50 && len < 50000) { 
          // نتأكد إن ده الكارت الأكبر الممكن قبل الصفحة كلها
          best = node; 
        }
      }
      
      if (!best) return;
      
      seen[urn] = 1;

      var author = '', postText = '', likes = null;
      
      // 1. استخراج الاسم
      var aEl = best.querySelector('a[href*="/in/"], a[href*="/company/"]');
      if (aEl) author = (aEl.innerText||'').split('\n')[0].replace(/\s+/g,' ').trim().substring(0,100);
      if (!author) { 
        var s = best.querySelector('.update-components-actor__name, .app-aware-link span[aria-hidden="true"], strong'); 
        if (s) author = (s.innerText||'').trim().substring(0,100); 
      }

      // 2. استخراج النص (أطول حاجة جوه dir=ltr أو text-view-model)
      var textCandidates = Array.from(best.querySelectorAll('[dir="ltr"], .break-words, .update-components-text, .search-result__snippets'));
      textCandidates.forEach(function(d) {
        var t = (d.innerText||'').trim();
        if (t.length > postText.length) postText = t;
      });
      // Fallback للنص
      if (postText.length < 10) {
        postText = (best.innerText||'').replace(/\s+/g,' ').trim().substring(0, 3000);
      }

      // 3. استخراج اللايكات
      Array.from(best.querySelectorAll('[aria-label]')).forEach(function(x) {
        if (likes !== null) return;
        var l = x.getAttribute('aria-label') || '';
        if (/\d/.test(l) && /(reaction|like)/i.test(l)) {
          var n = l.match(/(\d[\d,]*)/);
          if (n) likes = parseInt(n[1].replace(/,/g,''), 10);
        }
      });
      if (likes === null) {
        var bm = (best.innerText||'').match(/(\d[\d,]*)\s*(reaction|like)/i);
        if (bm) likes = parseInt(bm[1].replace(/,/g,''), 10);
      }

      posts.push({
        urn: urn,
        url: 'https://www.linkedin.com/feed/update/' + urn,
        text: postText.substring(0, 3000),
        author: author,
        likes: likes,
        comments: null
      });
    });

    return posts;
  }

  // أرسل كل 3.5 ثانية
  var extractInterval = setInterval(function(){
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

  function status(t) { try { chrome.runtime.sendMessage({ action: 'EXTENSION_LIVE_STATUS', text: t }); } catch (_) {} }

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
      if (count >= 30 || step >= MAX_STEPS - 5) { console.log('[SCROLL] Done â€” sufficient posts'); break; }
      sameCount = 0;
    }

    doScroll();
    await randWait();

    if (distBottom() < 300) {
      if (!clickShowMore() && count >= 30) break;
      await sleep(3000);
    }
  }

  clearInterval(keepAlive);
  status(`Scroll complete â€” finalizingâ€¦`);
  await sleep(1000);
  chrome.runtime.sendMessage({ action: 'CONTENT_SCROLL_COMPLETE' });
  window.__NexoraScrollerActive = false;
})();
