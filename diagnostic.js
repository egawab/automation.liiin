(async () => {
  const R = { timestamp: new Date().toISOString(), sections: {} };

  // ── 1. What URN patterns actually exist in the raw HTML? ──────────────────
  const html = document.body.innerHTML || '';
  const urnSamples = {};
  const patterns = {
    'activity':       /urn:li:activity:(\d+)/gi,
    'ugcPost':        /urn:li:ugcPost:(\d+)/gi,
    'share':          /urn:li:share:(\d+)/gi,
    'fsd_update':     /urn:li:fsd_update:[^"'\s<>]{5,120}/gi,
    'fsd_feedUpdate': /urn:li:fsd_feedUpdate:[^"'\s<>]{5,120}/gi,
    'ANY_urn_li':     /urn:li:[a-zA-Z_]+:[^"'\s<>]{5,80}/gi,
  };
  for (const [name, re] of Object.entries(patterns)) {
    const allHits = [...html.matchAll(new RegExp(re.source, 'gi'))].map(m => m[0]);
    urnSamples[name] = { count: allHits.length, samples: allHits.slice(0, 4) };
  }
  R.sections.urn_scan = urnSamples;

  // ── 2. Scroll container detection ─────────────────────────────────────────
  R.sections.scroll_containers = [...document.querySelectorAll('div,section,main')]
    .filter(el => {
      try {
        const s = getComputedStyle(el);
        return (s.overflowY === 'scroll' || s.overflowY === 'auto')
          && el.scrollHeight > el.clientHeight * 1.3
          && el.clientHeight > 200;
      } catch(e) { return false; }
    })
    .map(el => ({
      tag: el.tagName, id: el.id || null,
      class: String(el.className || '').slice(0, 120),
      scrollH: el.scrollHeight, clientH: el.clientHeight
    }))
    .sort((a, b) => b.scrollH - a.scrollH)
    .slice(0, 5);

  // ── 3. Feed DOM structure — first 2 visible post cards ────────────────────
  const likeWords    = ['like','react','إعجاب',"j'aime",'me gusta','gefällt','beğen','curtir','tepki','réaction','curtir','mi piace'];
  const commentWords = ['comment','تعليق','yorum','commentaire','comentar','kommentar','commenta'];
  const allBtns = [...document.querySelectorAll('button[aria-label],[role="button"][aria-label]')];

  const foundCards = [];
  for (const btn of allBtns) {
    const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (!likeWords.some(w => lbl.includes(w))) continue;
    let el = btn.parentElement;
    for (let d = 0; d < 25 && el && el !== document.body; d++) {
      const inner = [...el.querySelectorAll('button[aria-label],[role="button"][aria-label]')];
      const hasLike    = inner.some(b => { const l = (b.getAttribute('aria-label')||'').toLowerCase(); return likeWords.some(w => l.includes(w)); });
      const hasComment = inner.some(b => { const l = (b.getAttribute('aria-label')||'').toLowerCase(); return commentWords.some(w => l.includes(w)); });
      if (hasLike && hasComment) {
        if (!foundCards.find(c => c.el === el)) foundCards.push({ el, depth: d });
        break;
      }
      el = el.parentElement;
    }
    if (foundCards.length >= 2) break;
  }

  R.sections.post_cards = foundCards.map((c, i) => {
    const el = c.el;
    const cardAttrs = {};
    for (const a of el.attributes) cardAttrs[a.name] = a.value.slice(0, 200);

    const childrenSample = [...el.children].slice(0, 5).map(ch => {
      const ca = {};
      for (const a of ch.attributes) ca[a.name] = a.value.slice(0, 200);
      return { tag: ch.tagName, class: String(ch.className || '').slice(0, 120), attrs: ca };
    });

    const dataAttrs = [];
    el.querySelectorAll('*').forEach(node => {
      for (const a of node.attributes) {
        if (a.name.startsWith('data-') && a.value.length > 5)
          dataAttrs.push({ attr: a.name, val: a.value.slice(0, 300), tag: node.tagName });
      }
    });

    return {
      card_index: i,
      tag: el.tagName,
      id: el.id || null,
      class: String(el.className || '').slice(0, 200),
      card_attrs: cardAttrs,
      children_sample: childrenSample,
      anchors_inside: [...el.querySelectorAll('a[href]')].slice(0, 5).map(a => a.href.slice(0, 200)),
      data_attrs_in_subtree: dataAttrs.slice(0, 25),
      inner_text_sample: String(el.innerText || '').slice(0, 400),
      depth_from_like_btn: c.depth
    };
  });

  // ── 4. Global LinkedIn state stores ───────────────────────────────────────
  const stores = {};

  // Redux
  try {
    const rs = window.__REDUX_STORE__ || window.Store || window.reduxStore;
    stores.redux = rs && rs.getState ? { found: true, topKeys: Object.keys(rs.getState()).slice(0, 20) } : { found: false };
  } catch(e) { stores.redux = { error: e.message }; }

  // LinkedIn-specific globals
  stores.linkedin_globals = Object.keys(window).filter(k =>
    k.includes('__') && /linkedin|li_|voyager|feed|nexora/i.test(k)
  ).slice(0, 20);

  // React fiber — walk looking for updateUrn / fsd_update
  try {
    const root = document.querySelector('main,[role="main"],.scaffold-layout__main') || document.body;
    const fk = Object.keys(root).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (fk) {
      const urnFinds = [];
      let fiber = root[fk];
      let safety = 0;
      while (fiber && safety++ < 500 && urnFinds.length < 5) {
        try {
          const s = JSON.stringify(fiber.memoizedProps || {}).slice(0, 600);
          if (/fsd_update|updateUrn|activity:\d|ugcPost:\d/.test(s)) urnFinds.push(s.slice(0, 300));
        } catch(e) {}
        fiber = fiber.child || fiber.sibling || (fiber.return ? fiber.return.sibling : null);
      }
      stores.react_fiber = { found: true, urn_findings: urnFinds };
    } else {
      stores.react_fiber = { found: false };
    }
  } catch(e) { stores.react_fiber = { error: e.message }; }

  // Apollo
  try {
    const ap = window.__APOLLO_CLIENT__ || window.apolloClient;
    stores.apollo = ap && ap.cache ? { found: true, sampleKeys: Object.keys(ap.cache.extract ? ap.cache.extract() : {}).slice(0, 10) } : { found: false };
  } catch(e) { stores.apollo = { error: e.message }; }

  // Our interceptor status
  stores.nexora_interceptor = {
    active: !!window.__LI_INTERCEPTOR_ACTIVE__,
    buffer_length: (window.__networkPostsBuffer || []).length,
    buffer_sample: (window.__networkPostsBuffer || []).slice(0, 2)
  };

  R.sections.global_stores = stores;

  // ── 5. First 20 button aria-labels ────────────────────────────────────────
  R.sections.button_aria_labels = allBtns.slice(0, 20).map(b => ({
    label: b.getAttribute('aria-label'),
    tag: b.tagName,
    class: String(b.className || '').slice(0, 80)
  }));

  // ── 6. Network interceptor: last 3 XHR/fetch URLs ─────────────────────────
  // Patch XMLHttpRequest to log the next 3 URLs (diagnostic only)
  const interceptedUrls = window.__diagInterceptedUrls = window.__diagInterceptedUrls || [];
  if (!window.__diagXhrPatched) {
    window.__diagXhrPatched = true;
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, url) {
      interceptedUrls.push({ method: m, url: String(url).slice(0, 200), t: Date.now() });
      if (interceptedUrls.length > 20) interceptedUrls.shift();
      return origOpen.apply(this, arguments);
    };
  }
  // Give it a moment then flush
  await new Promise(r => setTimeout(r, 100));
  R.sections.recent_xhr_urls = interceptedUrls.slice(-10);

  // ── OUTPUT ─────────────────────────────────────────────────────────────────
  const out = JSON.stringify(R, null, 2);
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  NEXORA DIAGNOSTIC REPORT — copy everything between the ═══  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(out);
  console.log('═════════════════════════ END OF REPORT ═══════════════════════');
  return R;
})();
