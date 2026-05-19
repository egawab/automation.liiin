// content.js — Nexora v8 (Content-Script-Centric)
// Single execution context. Single scroll loop. Single data store.
// NO CDP. NO dual scroll. NO buffer phases.
// Injected dynamically by background.js after window.__nexoraCfg is stamped.
(async function () {
  const cfg = window.__nexoraCfg || {};
  const { runId, keyword, kwIndex, totalKeywords } = cfg;

  if (!runId || !keyword) { console.warn('[CS] Missing config — aborting'); return; }
  // Prevent duplicate runs of the same session
  if (window.__nexoraRunId === runId) { console.warn('[CS] Already running runId=' + runId); return; }
  window.__nexoraRunId = runId;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isActive = () => window.__nexoraRunId === runId;
  const canSend  = () => typeof chrome !== 'undefined' && !!chrome?.runtime?.sendMessage;

  // SEARCH-ONLY MODE
  if (cfg.searchOnlyMode) {
    const MIN_ENG = 10, MAX_ENG = 100;
    const lm = {};
    function pe2(s){if(s==null)return 0;const x=String(s).toUpperCase().replace(/,/g,"");const n=parseFloat((x.match(/[0-9.]+/)||[])[0]);if(isNaN(n))return 0;if(x.includes("K"))return Math.floor(n*1000);if(x.includes("M"))return Math.floor(n*1000000);return Math.floor(n);}
    function xUrn(s){const m=String(s||"").match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);if(m)return "urn:li:"+m[1]+":"+m[2];const p=String(s||"").match(/activity-([0-9]{10,25})/i);if(p)return "urn:li:activity:"+p[1];return "";}
    function urnUrl(urn){const m=urn.match(/urn:li:(ugcPost|activity|share):([0-9]+)/);if(!m)return "";return m[1]==="ugcPost"?"https://www.linkedin.com/posts/"+m[2]:"https://www.linkedin.com/feed/update/"+urn;}
    function addUrn(urn,lk,cm){if(!urn)return;if(!lm[urn])lm[urn]={url:urnUrl(urn),likes:0,comments:0};lm[urn].likes=Math.max(lm[urn].likes,lk||0);lm[urn].comments=Math.max(lm[urn].comments,cm||0);}
    function ingestSO(body){let j;try{j=JSON.parse(body);}catch(_){return;}
      function w(o){if(!o||typeof o!=="object")return;const raw=String(o.entityUrn||o.updateUrn||o.urn||"");const m=raw.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);if(m){const u="urn:li:"+m[1]+":"+m[2];const soc=o.socialDetail||o.totalSocialActivityCounts||{};addUrn(u,pe2(soc.numLikes??o.numLikes),pe2(soc.numComments??o.numComments));}if(Array.isArray(o)){for(const i of o)w(i);}else{for(const k of Object.keys(o)){if(typeof o[k]==="object"&&k!=="paging")w(o[k]);}}}w(j);}
    function domSO(){["a[href*='feed/update/urn:li:']","a[href*='/posts/']"].forEach(sel=>{Array.from(document.querySelectorAll(sel)).forEach(a=>{const u=xUrn(a.href);if(u)addUrn(u,0,0);});});["data-urn","data-activity-urn","data-entity-urn"].forEach(at=>{Array.from(document.querySelectorAll("["+at+"]")).forEach(el=>{const u=xUrn(el.getAttribute(at)||'');if(u)addUrn(u,0,0);});});}
    function onNet(e){const{body}=e.detail||{};if(!body||body.length<100||!isActive())return;const fc=body.trimStart()[0];if(fc!=="{"&&fc!=="[")return;ingestSO(body);}
    if(window.__nexoraNetHandler)window.removeEventListener("__nexora_net__",window.__nexoraNetHandler);
    window.__nexoraNetHandler=onNet;window.addEventListener("__nexora_net__",onNet);
    function getEl(){const cs=[document.querySelector(".scaffold-layout__main"),document.querySelector("main"),document.scrollingElement,document.documentElement];for(const e of cs)if(e&&e.scrollHeight>e.clientHeight+100)return e;return document.documentElement;}
    function doScroll(){const el=getEl();el.scrollTop+=Math.floor(el.clientHeight*0.85);el.dispatchEvent(new Event("scroll",{bubbles:true}));window.dispatchEvent(new Event("scroll",{bubbles:true}));return el.scrollTop;}
    function atBot(){const el=getEl();if(el.scrollHeight<el.clientHeight*1.3)return false;return(el.scrollTop+el.clientHeight)>=el.scrollHeight-600;}
    await sleep(2500);
    for(let w2=0;w2<12000&&isActive();w2+=500){if(getEl().scrollHeight>getEl().clientHeight*1.5)break;await sleep(500);}
    if(!isActive()){window.__nexoraRunId=null;return;}
    let step=0,noP=0,lastT=-1;
    while(step<40&&isActive()){step++;const st=doScroll();await sleep(2400+Math.floor(Math.random()*900));if(!isActive())break;if(Math.abs(st-lastT)>60){noP=0;lastT=st;}else noP++;domSO();console.log("[CS-SO] step="+step+" links="+Object.keys(lm).length);if(step>=5&&(noP>=7||atBot()))break;}
    if(!isActive()){window.__nexoraRunId=null;return;}
    await sleep(2000);domSO();
    // Send ALL found links — dashboard filters by engagement
    const qualified=Object.entries(lm).map(([urn,p])=>({canonicalUrn:urn,url:p.url,postAuthor:null,postPreview:null,likes:p.likes,comments:p.comments,source:"search_only"}));
    console.log("[CS-SO] total="+Object.keys(lm).length+" qualified="+qualified.length);
    window.removeEventListener("__nexora_net__",onNet);window.__nexoraNetHandler=null;window.__nexoraRunId=null;
    if(canSend())chrome.runtime.sendMessage({action:"FLUSH_POSTS",posts:qualified,runId,commentedUrns:[]}).catch(()=>{});
    return;
  }
  // END SEARCH-ONLY

  console.log('[CS] v8 start kw="' + keyword + '" runId=' + runId + ' (' + (kwIndex + 1) + '/' + totalKeywords + ')');

  // ── Live Post Store ────────────────────────────────────────────────────────
  // Single source of truth. Updated in-place as network + DOM data arrive.
  const postsMap = {};

  function longerText(a, b) { a = a || ''; b = b || ''; return b.length > a.length ? b : a; }
  function bestAuthor(preferred, fallback) {
    return (preferred && preferred !== 'Unknown' && preferred.length > 1) ? preferred : (fallback || 'Unknown');
  }

  function mergeNet(urn, inc) {
    if (!urn) return;
    const old = postsMap[urn] || {};
    postsMap[urn] = {
      canonicalUrn: urn,
      url:      old.url || ('https://www.linkedin.com/feed/update/' + urn),
      postText: longerText(old.postText, inc.text),
      preview:  longerText(old.preview,  inc.text),
      author:   bestAuthor(inc.author, old.author),   // network author preferred
      likes:    Math.max(old.likes    || 0, inc.likes    || 0),
      comments: Math.max(old.comments || 0, inc.comments || 0),
      source:   'network',
    };
  }

  function mergeDOM(urn, stableKey, inc) {
    const key = urn || stableKey;
    if (!key) return;
    const old = postsMap[key] || {};
    postsMap[key] = {
      canonicalUrn: urn || old.canonicalUrn || null,
      stableKey:    stableKey || old.stableKey || null,
      url:      inc.url || old.url || (urn ? 'https://www.linkedin.com/feed/update/' + urn : ''),
      postText: longerText(old.postText, inc.text),
      preview:  longerText(old.preview,  inc.text),
      // Network author takes priority; DOM only fills "Unknown" gaps
      author:   bestAuthor(old.author, inc.author),
      // Engagement never downgrades
      likes:    Math.max(old.likes    || 0, inc.likes    || 0),
      comments: Math.max(old.comments || 0, inc.comments || 0),
      source:   old.source || 'dom',
    };
  }

  // ── Network Ingestor (parses LinkedIn API JSON) ────────────────────────────
  function pe(s) {
    if (s == null) return 0;
    const x = String(s).toUpperCase().replace(/,/g, '');
    const n = parseFloat((x.match(/[0-9.]+/) || [])[0]);
    if (isNaN(n)) return 0;
    if (x.includes('K')) return Math.floor(n * 1000);
    if (x.includes('M')) return Math.floor(n * 1000000);
    return Math.floor(n);
  }

  function ingestBody(body) {
    let json;
    try { json = JSON.parse(body); } catch (_) { return; }
    function walk(obj) {
      if (!obj || typeof obj !== 'object') return;
      const rawUrn = String(obj.entityUrn || obj.updateUrn || obj.urn || '');
      const m = rawUrn.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
      if (m) {
        const urn = 'urn:li:' + m[1] + ':' + m[2];
        const text = String(
          (typeof obj.commentary?.text?.text === 'string' ? obj.commentary.text.text  :
           typeof obj.commentary?.text      === 'string' ? obj.commentary.text        :
           typeof obj.text                  === 'string' ? obj.text                   :
           typeof obj.summary               === 'string' ? obj.summary                : '')
        ).substring(0, 5000);
        const author = String(obj.actor?.name?.text || obj.actor?.nameV2?.text || obj.actor?.fullName || '').substring(0, 100);
        const soc    = obj.socialDetail || obj.totalSocialActivityCounts || {};
        mergeNet(urn, {
          text,
          author,
          likes:    pe(soc.numLikes    != null ? soc.numLikes    : obj.numLikes),
          comments: pe(soc.numComments != null ? soc.numComments : obj.numComments),
        });
      }
      if (Array.isArray(obj)) { for (const item of obj) walk(item); }
      else { for (const k of Object.keys(obj)) { if (typeof obj[k] === 'object' && k !== 'paging') walk(obj[k]); } }
    }
    walk(json);
  }

  // ── Network Bridge ─────────────────────────────────────────────────────────
  // interceptor.js (MAIN world) dispatches CustomEvent; we catch it here.
  function onNetEvent(e) {
    const { url, body } = e.detail || {};
    if (!body || body.length < 200) return;
    if (!isActive()) return;
    const fc = body.trimStart()[0];
    if (fc !== '{' && fc !== '[') return;
    console.log('[CS] NET captured url=' + (url || '').substring(0, 80) + ' len=' + body.length);
    ingestBody(body);
  }
  if (window.__nexoraNetHandler) window.removeEventListener('__nexora_net__', window.__nexoraNetHandler);
  window.__nexoraNetHandler = onNetEvent;
  window.addEventListener('__nexora_net__', onNetEvent);
  console.log('[CS] NET-BRIDGE registered on', location.href);

  // ── DOM Extractor ──────────────────────────────────────────────────────────
  function extractDOM() {
    const records = [];
    const seen    = {};

    function norm(s) {
      return String(s || '')
        .replace(/[\u0660-\u0669]/g, c => c.charCodeAt(0) - 0x660)
        .replace(/[\u06F0-\u06F9]/g, c => c.charCodeAt(0) - 0x6F0);
    }
    function pe2(s) {
      if (!s) return 0;
      const x = norm(s).toUpperCase().replace(/,/g, '');
      const n = parseFloat((x.match(/[0-9]+\.?[0-9]*/) || [])[0]);
      if (isNaN(n)) return 0;
      if (x.indexOf('K') > -1) return Math.floor(n * 1000);
      if (x.indexOf('M') > -1) return Math.floor(n * 1000000);
      return Math.floor(n);
    }
    function xUrn(s) {
      if (!s) return '';
      const m = String(s).match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
      if (m) return 'urn:li:' + m[1] + ':' + m[2];
      const p = String(s).match(/activity-([0-9]{10,25})/i);
      if (p) return 'urn:li:activity:' + p[1];
      return '';
    }
    function stableKey(a, t) {
      return encodeURIComponent((a || '').toLowerCase().trim()) + '::'
           + ((t || '').substring(0, 80).toLowerCase().replace(/\s+/g, '_'));
    }
    function getEng(el) {
      let lk = 0, cm = 0;
      try {
        Array.from(el.querySelectorAll('span,div,li,a')).forEach(x => {
          if (x.children.length > 5) return;
          const n = norm((x.innerText || '').trim());
          const r = n.match(/([0-9][0-9,.]*[KkMm]?)\s*(reaction|like|reacted)/i);
          if (r) lk = Math.max(lk, pe2(r[1]));
          const c2 = n.match(/([0-9][0-9,.]*[KkMm]?)\s*(comment)/i);
          if (c2) cm = Math.max(cm, pe2(c2[1]));
        });
      } catch (_) {}
      try {
        Array.from(el.querySelectorAll('[aria-label]')).forEach(x => {
          const a = norm(x.getAttribute('aria-label') || '');
          if (/[0-9]/.test(a) && /(reaction|like|reacted)/i.test(a)) lk = Math.max(lk, pe2(a));
          if (/[0-9]/.test(a) && /(comment)/i.test(a))               cm = Math.max(cm, pe2(a));
        });
      } catch (_) {}
      try {
        const sdc = el.querySelector('.social-details-social-counts,.update-components-social-counts');
        if (sdc) {
          const nums = [];
          Array.from(sdc.querySelectorAll('span,button,li')).forEach(x => {
            const t = norm((x.innerText || '').trim().replace(/,/g, ''));
            if (/^[0-9]{1,8}$/.test(t)) { const n = parseInt(t, 10); if (n > 0 && !nums.includes(n)) nums.push(n); }
          });
          if (nums[0]) lk = Math.max(lk, nums[0]);
          if (nums[1]) cm = Math.max(cm, nums[1]);
        }
      } catch (_) {}
      return { likes: lk, comments: cm };
    }
    function getText(el) {
      let txt = '';
      const skip = /^(Pause|Skip Forward|Skip Backward|Unmute|Current Time|Duration)/i;
      ['.update-components-text', '.feed-shared-update-v2__description',
       '.attributed-text-segment-list__content', '.break-words', '.feed-shared-text']
      .forEach(s => {
        try {
          Array.from(el.querySelectorAll(s)).forEach(d => {
            const t = (d.innerText || '').trim();
            if (t.length > txt.length && !skip.test(t)) txt = t;
          });
        } catch (_) {}
      });
      try {
        Array.from(el.querySelectorAll('[dir]')).forEach(d => {
          const t = (d.innerText || '').trim();
          if (t.length > txt.length && !skip.test(t)) txt = t;
        });
      } catch (_) {}
      if (txt.length < 20) {
        const raw = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (!skip.test(raw)) txt = raw.substring(0, 3000);
      }
      return txt;
    }
    function getAuthor(el) {
      const a = el.querySelector('a[href*="/in/"],a[href*="/company/"]');
      if (!a) return 'Unknown';
      const aria = a.getAttribute('aria-label') || '';
      if (aria) {
        const cl = aria
          .replace(/^[Vv]iew\s+(?:company:\s*)?/i, '')
          .replace(/\s*['\u2019\u2018\u02BC]s\s.*/i, '')
          .replace(/\s*(profile|page|company)\s*$/i, '')
          .replace(/\s+(Verified|Top Voice|\d.*)$/i, '')
          .trim();
        if (cl && cl.length > 1 && !/^(Unknown|View)$/i.test(cl)) return cl.substring(0, 100);
      }
      const name = (a.innerText || '').trim().split('\n')[0]
        .replace(/^[Vv]iew\s+/i, '').replace(/\s*(profile|page)\s*$/i, '').trim().substring(0, 100);
      if (name.length > 1) return name;
      const img = a.querySelector('img[alt]');
      return img ? (img.getAttribute('alt') || '').trim().substring(0, 100) : 'Unknown';
    }
    function walkCard(el, urn, href) {
      let c = el, fh = null, li = null;
      for (let i = 0; i < 35; i++) {
        c = c.parentElement;
        if (!c || c === document.body) break;
        const l = (c.innerText || '').trim().length;
        if (l > 20 && l < 25000) { if (!fh) fh = c; if (c.tagName === 'LI') { li = c; break; } }
        if (l >= 25000) break;
      }
      const container = li || fh;
      if (!container) return;
      const eng  = getEng(container);
      const txt  = getText(container);
      const auth = getAuthor(container);
      const key  = urn || ('STABLE::' + stableKey(auth, txt));
      if (seen[key]) return;
      seen[key] = 1;
      records.push({ urn: urn || null, stableKey: key, url: href || (urn ? 'https://www.linkedin.com/feed/update/' + urn : ''), text: txt.substring(0, 3000), author: auth, likes: eng.likes, comments: eng.comments });
    }

    // Pass 1: post anchor links
    try {
      Array.from(document.querySelectorAll('a[href]'))
        .filter(a => a.href && (a.href.includes('feed/update/urn:li:') || a.href.includes('/posts/')))
        .forEach(lnk => { const urn = xUrn(lnk.href); if (!urn || seen[urn]) return; walkCard(lnk, urn, lnk.href); });
    } catch (_) {}
    // Pass 2: data attributes
    try {
      ['data-urn', 'data-activity-urn', 'data-chameleon-result-urn', 'data-entity-urn', 'data-id'].forEach(attr => {
        Array.from(document.querySelectorAll('[' + attr + ']')).forEach(el => {
          const urn = xUrn(el.getAttribute(attr) || '');
          if (!urn || seen[urn]) return;
          walkCard(el, urn, '');
        });
      });
    } catch (_) {}
    // Pass 3: innerHTML URN scan
    try {
      const urx = /urn:li:(activity|ugcPost|share):([0-9]{10,25})/g;
      const uq = []; let m4;
      while ((m4 = urx.exec(document.body.innerHTML)) !== null) {
        const u = 'urn:li:' + m4[1] + ':' + m4[2];
        if (!seen[u] && !uq.includes(u)) uq.push(u);
      }
      uq.forEach(urn => {
        if (seen[urn]) return;
        const aid = urn.split(':').pop();
        const el  = document.querySelector('[data-urn*=":' + aid + '"],[data-entity-urn*=":' + aid + '"],[href*="activity-' + aid + '"]');
        if (el) walkCard(el, urn, '');
      });
    } catch (_) {}

    return records;
  }

  // ── Scroll Engine (single, authoritative) ──────────────────────────────────
  function getScrollEl() {
    const cs = [
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('.scaffold-layout-container__main'),
      document.querySelector('main'),
      document.scrollingElement,
      document.documentElement,
    ];
    for (const el of cs) { if (el && el.scrollHeight > el.clientHeight + 100) return el; }
    return document.documentElement;
  }
  function doScroll() {
    try { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); } catch (_) {}
    const el = getScrollEl();
    el.scrollTop += Math.floor(el.clientHeight * 0.85);
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    return el.scrollTop;
  }
  function atBottom() {
    const el = getScrollEl();
    if (el.scrollHeight < el.clientHeight * 1.3) return false;
    return (el.scrollTop + el.clientHeight) >= el.scrollHeight - 600;
  }
  function clickNext() {
    const sels = ['.artdeco-pagination__button--next', 'button[aria-label="Next"]', 'button[aria-label="Go to next page"]'];
    for (const s of sels) { const b = document.querySelector(s); if (b && !b.disabled) { b.click(); return true; } }
    const more = [...document.querySelectorAll('button,[role="button"]')].find(b => /show more|load more|see more/i.test(b.innerText || ''));
    if (more && !more.disabled) { more.click(); return true; }
    return false;
  }

  // ── Wait for page content ──────────────────────────────────────────────────
  await sleep(2500);
  let waited = 0;
  while (waited < 12000 && isActive()) {
    const el = getScrollEl();
    if (el.scrollHeight > el.clientHeight * 1.5) break;
    await sleep(500); waited += 500;
  }
  if (!isActive()) { console.log('[CS] Aborted during page wait (stale runId)'); return; }
  const el = getScrollEl();
  if (el.scrollHeight <= el.clientHeight * 1.3) {
    console.warn('[CS] Page appears empty — sending empty FLUSH_POSTS runId=' + runId);
    window.removeEventListener('__nexora_net__', onNetEvent);
    window.__nexoraNetHandler = null;
    window.__nexoraRunId = null;
    if (canSend()) chrome.runtime.sendMessage({ action: 'FLUSH_POSTS', posts: [], runId }).catch(() => {});
    return;
  }

  // ── Scroll Loop ────────────────────────────────────────────────────────────
  const MAX_STEPS = 55, MIN_STEPS = 6, NO_PROG_MAX = 8;
  let step = 0, noProgress = 0, lastTop = -1, stopReason = 'max_steps';

  while (step < MAX_STEPS && isActive()) {
    step++;
    const st = doScroll();
    await sleep(2600 + Math.floor(Math.random() * 1200));

    if (!isActive()) { stopReason = 'cancelled'; break; }

    if (Math.abs(st - lastTop) > 60) { noProgress = 0; lastTop = st; }
    else { noProgress++; }

    // DOM extraction after every scroll step
    const domRecs = extractDOM();
    for (const rec of domRecs) mergeDOM(rec.urn, rec.stableKey, rec);
    console.log('[CS] step=' + step + ' st=' + st + ' noProg=' + noProgress
      + ' dom=' + domRecs.length + ' postsMap=' + Object.keys(postsMap).length);

    if (step >= MIN_STEPS && (noProgress >= NO_PROG_MAX || atBottom())) {
      if (clickNext()) { noProgress = 0; await sleep(4500); continue; }
      stopReason = atBottom() ? 'reached_bottom' : 'no_scroll_progress';
      break;
    }
  }

  if (!isActive()) { console.log('[CS] Session cancelled during scroll'); return; }

  // ── Network idle wait (let late packets arrive) ────────────────────────────
  console.log('[CS] Scroll done reason=' + stopReason + ' — waiting 2s for network idle');
  await sleep(2000);

  // ── Final DOM pass ─────────────────────────────────────────────────────────
  const finalRecs = extractDOM();
  for (const rec of finalRecs) mergeDOM(rec.urn, rec.stableKey, rec);

  // ── Comment Automation ─────────────────────────────────────────────────────
  async function performComments() {
    if (!cfg.cycleComments || cfg.cycleComments.length === 0) return [];
    console.log('[CS] Starting comment campaign. Comments:', cfg.cycleComments);
    const commentedUrns = cfg.commentedUrns || [];
    
    let allPosts = Object.values(postsMap)
      .filter(p => p.canonicalUrn && !commentedUrns.includes(p.canonicalUrn))
      .sort((a, b) => ((b.likes || 0) + (b.comments || 0)) - ((a.likes || 0) + (a.comments || 0)));
      
    const targetCount = cfg.cycleComments.length;
    const selectedPosts = [];
    const domContainers = [];
    
    for (const p of allPosts) {
      if (selectedPosts.length >= targetCount) break;
      const aid = p.canonicalUrn.split(':').pop();
      const els = Array.from(document.querySelectorAll(`[data-urn*=":${aid}"], [data-entity-urn*=":${aid}"]`));
      let container = null;
      for (let c of els) {
        for (let i=0; i<35; i++) {
          if (!c || c === document.body) break;
          const len = (c.innerText || '').length;
          if (len > 20 && c.tagName === 'LI') { container = c; break; }
          c = c.parentElement;
        }
        if (container) break;
      }
      if (container) {
        selectedPosts.push(p);
        domContainers.push(container);
      }
    }
    
    console.log(`[CS] Selected ${selectedPosts.length} top reach posts for commenting.`);
    const newCommented = [];
    
    for (let i = 0; i < selectedPosts.length; i++) {
      const p = selectedPosts[i];
      const container = domContainers[i];
      const commentText = cfg.cycleComments[i]?.text;
      if (!commentText) continue;
      
      try {
        console.log(`[CS] Commenting on ${p.canonicalUrn} (Likes: ${p.likes}, Comments: ${p.comments})`);
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(1500);
        
        let editor = container.querySelector('div.ql-editor, div[role="textbox"]');
        if (!editor) {
           const btns = Array.from(container.querySelectorAll('button'));
           const commentBtn = btns.find(b => {
              const aria = (b.getAttribute('aria-label') || '').toLowerCase();
              return aria.includes('comment') || aria.includes('تعليق');
           });
           if (commentBtn) {
              commentBtn.click();
              await sleep(2500);
              editor = container.querySelector('div.ql-editor, div[role="textbox"]');
           }
        }
        
        if (!editor) { console.warn('[CS] Editor not found for', p.canonicalUrn); continue; }
        
        editor.focus();
        await sleep(500);
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, commentText);
        
        await sleep(1500);
        
        const submitBtn = container.querySelector('button.comments-comment-box__submit-button');
        if (submitBtn && !submitBtn.disabled) {
           submitBtn.click();
           newCommented.push(p.canonicalUrn);
           console.log(`[CS] Comment successfully posted on ${p.canonicalUrn}`);
           await sleep(4000); 
        } else {
           console.warn('[CS] Submit button not found or disabled for', p.canonicalUrn);
        }
      } catch (e) {
        console.error('[CS] Error commenting on', p.canonicalUrn, e);
      }
    }
    return newCommented;
  }

  const newlyCommentedUrns = await performComments();

  // ── Flush ──────────────────────────────────────────────────────────────────
  window.removeEventListener('__nexora_net__', onNetEvent);
  window.__nexoraNetHandler = null;

  // Release the run lock BEFORE sending so that if background rejects us,
  // a new injection for the same page can still start cleanly.
  window.__nexoraRunId = null;

  const posts = Object.values(postsMap);
  console.log('[CS] Flushing posts=' + posts.length + ' kw="' + keyword + '" runId=' + runId);

  if (canSend()) {
    // Include runId so background can reject stale sessions
    chrome.runtime.sendMessage({ action: 'FLUSH_POSTS', posts, runId, commentedUrns: newlyCommentedUrns })
      .then(r  => console.log('[CS] FLUSH_POSTS ACK:', JSON.stringify(r)))
      .catch(e => console.warn('[CS] FLUSH_POSTS send failed:', e?.message));
  }
})();
