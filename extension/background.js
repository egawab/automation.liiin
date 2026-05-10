// Nexora background.js v6 — FSM Session Manager
// Single command channel (port only). Alarm = keep-alive only.
console.log('[BG] Nexora v6 loaded');

// ── Structured Logger ────────────────────────────────────────────────────
const LOG = [];
function log(level, mod, msg, data) {
  const e = { ts: Date.now(), level, mod, msg, data };
  LOG.push(e); if (LOG.length > 300) LOG.shift();
  console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](`[${mod}] ${msg}`, data || '');
}

// ── Session State (FSM) ──────────────────────────────────────────────────
// States: IDLE | INITIALIZING | ATTACHING | NAVIGATING | SCRAPING | FLUSHING | DONE
const S = {
  state: 'IDLE',
  tabId: null,
  attached: false,
  dashboardUrl: '',
  userId: '',
  kwQueue: null,       // KeywordQueue instance
  store: new Map(),    // URN → post record (persists across keywords)
  batch: [],           // pending posts to flush
  retryQueue: [],      // posts that failed API submission
  totalSaved: 0,
  evalTimer: null,
  sessionId: null,
};

function setState(next) {
  log('INFO', 'FSM', `${S.state} → ${next}`);
  S.state = next;
  broadcastStatus();
}

// ── Keyword Queue ────────────────────────────────────────────────────────
class KeywordQueue {
  constructor(kws) { this._q = [...kws]; this._done = []; this.current = null; }
  advance() { if (this.current) this._done.push(this.current); this.current = this._q.shift() || null; return this.current; }
  hasMore() { return this._q.length > 0; }
  status() { return { current: this.current, remaining: this._q.length, done: this._done.length }; }
}

// ── Keep-Alive Alarm (heartbeat only) ────────────────────────────────────
chrome.alarms.create('nexora_heartbeat', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'nexora_heartbeat') return;
  // Keep service worker alive only. Never start/restart sessions.
  if (S.state !== 'IDLE' && S.state !== 'DONE') {
    log('INFO', 'HB', `Heartbeat — state=${S.state} saved=${S.totalSaved}`);
  }
});

// ── Port Command Channel (ONLY command entry point) ──────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'nexora_cmd') return;
  log('INFO', 'PORT', 'Port connected');
  // Immediately update badge so user can see the command reached background
  chrome.action.setBadgeText({ text: '...' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' }).catch(() => {});

  port.onMessage.addListener(async (msg) => {
    if (msg.action === 'START') {
      if (S.state !== 'IDLE' && S.state !== 'DONE') {
        await stopSession();
      }
      try {
        await startSession(msg, port);
      } catch (e) {
        log('ERROR', 'PORT', 'startSession failed', e.message);
        safePortMsg(port, { type: 'ERROR', error: e.message });
        chrome.action.setBadgeText({ text: 'ERR' }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }).catch(() => {});
        broadcast('EXTENSION_LIVE_STATUS', { text: '❌ ' + e.message });
      }
    } else if (msg.action === 'STOP') {
      await stopSession();
      safePortMsg(port, { type: 'ACK_STOP' });
    } else if (msg.action === 'GET_STATUS') {
      safePortMsg(port, { type: 'STATUS', state: S.state, saved: S.totalSaved, kw: S.kwQueue?.current });
    }
  });

  port.onDisconnect.addListener(() => { log('INFO', 'PORT', 'Port disconnected'); });
});

function safePortMsg(port, msg) { if (!port) return; try { port.postMessage(msg); } catch (_) {} }

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise(function(_, rej) { setTimeout(function() { rej(new Error(label + ' timed out after ' + ms + 'ms')); }, ms); })
  ]);
}

// ── Start Session ────────────────────────────────────────────────────────
async function startSession(msg, port) {
  setState('INITIALIZING');
  S.sessionId = Math.random().toString(36).slice(2);
  S.totalSaved = 0;
  S.store.clear();
  S.batch = []; S.retryQueue = [];
  S.flushedUrns = new Set();
  S.diagProfile = null;   // filled by runDiagProbe()
  S.activeEval = null;    // built by buildEval() from diagProfile

  const cfg = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
  S.dashboardUrl = msg.dashboardUrl || cfg.dashboardUrl || '';
  S.userId = msg.userId || cfg.userId || '';
  if (!S.dashboardUrl || !S.userId) throw new Error('Not configured — set Dashboard URL and User ID first.');

  const kws = await fetchKeywords(S.dashboardUrl, S.userId);
  S.kwQueue = new KeywordQueue(kws);
  S.kwQueue.advance();
  if (!S.kwQueue.current) throw new Error('No keywords configured in dashboard.');

  log('INFO', 'SESSION', 'Starting', { keywords: kws, sessionId: S.sessionId });
  safePortMsg(port, { type: 'ACK_START', keyword: S.kwQueue.current });

  S.tabId = await resolveLinkedInTab();
  runKeyword().catch(e => log('ERROR', 'SESSION', 'runKeyword crashed', e.message));
}

async function stopSession() {
  log('WARN', 'SESSION', 'Stopping session', { state: S.state });
  stopEval();
  await safeDetach();
  S.batch = []; S.retryQueue = [];
  setState('IDLE');
}

// ── Keyword Execution ────────────────────────────────────────────────────
// CDP SCROLL ENGINE — replaces content.js scroll dependency
// Injected into background.js via build script

async function cdpExec(expr) {
  if (!S.attached || !S.tabId) return null;
  try {
    const r = await chrome.debugger.sendCommand({ tabId: S.tabId }, 'Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: false, timeout: 8000 });
    if (r && r.result && r.result.value !== undefined) return r.result.value;
    return null;
  } catch (_) { return null; }
}

// Finds LinkedIn's actual scrollable container (body:overflow:hidden, content scrolls inside)
const FIND_SCROLL_EL = `(function(){
  var candidates = [
    document.querySelector('.scaffold-layout__main'),
    document.querySelector('.scaffold-layout-container__main'),
    document.querySelector('main'),
    document.querySelector('[class*="scaffold"][class*="main"]'),
    document.querySelector('.application-outlet'),
    document.scrollingElement,
    document.documentElement
  ];
  for(var i=0;i<candidates.length;i++){
    var el=candidates[i];
    if(el && el.scrollHeight > el.clientHeight+100){return JSON.stringify({sh:el.scrollHeight,ch:el.clientHeight,st:el.scrollTop,sel:el.tagName+(el.className?'.'+el.className.trim().split(' ')[0]:'')});}
  }
  return JSON.stringify({sh:document.body.scrollHeight,ch:window.innerHeight,st:window.scrollY,sel:'body-fallback'});
})()`;

const DO_SCROLL = `(function(){
  var candidates = [
    document.querySelector('.scaffold-layout__main'),
    document.querySelector('.scaffold-layout-container__main'),
    document.querySelector('main'),
    document.querySelector('[class*="scaffold"][class*="main"]'),
    document.querySelector('.application-outlet'),
    document.scrollingElement,
    document.documentElement
  ];
  for(var i=0;i<candidates.length;i++){
    var el=candidates[i];
    if(el && el.scrollHeight > el.clientHeight+100){
      el.scrollBy({top:Math.floor(el.clientHeight*0.85),behavior:'smooth'});
      el.dispatchEvent(new Event('scroll',{bubbles:true}));
      window.dispatchEvent(new Event('scroll',{bubbles:true}));
      return el.scrollTop;
    }
  }
  window.scrollBy({top:Math.floor(window.innerHeight*0.85),behavior:'smooth'});
  return window.scrollY;
})()`;

async function waitForPageReady(maxMs) {
  maxMs = maxMs || 15000;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const raw = await cdpExec(FIND_SCROLL_EL);
    const rs  = await cdpExec('document.readyState');
    if (raw) {
      try {
        const m = JSON.parse(raw);
        if (rs === 'complete' && m.sh > m.ch * 1.3) {
          log('INFO', 'READY', 'Page ready via ' + m.sel + ' sh=' + m.sh + ' ch=' + m.ch + ' in ' + (Date.now()-start) + 'ms');
          return m;
        }
      } catch(_) {}
    }
    await sleep(600);
  }
  // Timeout — diagnose
  const raw2 = await cdpExec(FIND_SCROLL_EL);
  const diagTitle = await cdpExec('document.title');
  const diagText  = await cdpExec('(document.body&&document.body.innerText||"").replace(/\\s+/g," ").trim().substring(0,300)');
  log('WARN', 'READY', 'Timeout. title="' + diagTitle + '" metrics=' + raw2);
  log('WARN', 'READY', 'Page text sample: ' + diagText);
  broadcast('EXTENSION_LIVE_STATUS', { text: 'WARN: page slow — title=' + diagTitle });
  return null;
}

async function cdpScrollEngine(kw) {
  const MAX_STEPS = 55, MIN_STEPS = 6, NO_PROG_MAX = 5;
  let step = 0, noProgress = 0, lastSt = -1, scrolledAtAll = false;
  let stopReason = 'max_steps';

  const ready = await waitForPageReady(14000);
  broadcast('EXTENSION_LIVE_STATUS', { text: 'Scrolling: "' + kw + '"' });

  // Check scroll container metrics
  const initRaw = await cdpExec(FIND_SCROLL_EL);
  let initMetrics = null;
  try { initMetrics = initRaw ? JSON.parse(initRaw) : null; } catch(_) {}
  if (initMetrics) log('INFO', 'SCROLL', 'Container: ' + initMetrics.sel + ' sh=' + initMetrics.sh + ' ch=' + initMetrics.ch);

  // Early exit only if clearly empty (no container found with content)
  if (!ready && initMetrics && initMetrics.sh < initMetrics.ch * 1.2) {
    log('WARN', 'SCROLL', 'ABORT: no scrollable content found. Container=' + JSON.stringify(initMetrics));
    broadcast('EXTENSION_LIVE_STATUS', { text: 'Skip: page has no content — check LinkedIn tab login' });
    return 'empty_page';
  }

  // ── Compatibility Probe: detect layout, score strategies, build optimized extractor ──
  await runDiagProbe();
  const CLICK_NEXT = '(function(){var ss=[".artdeco-pagination__button--next","button[aria-label=\'Next\']","button[aria-label=\'Go to next page\']"];for(var i=0;i<ss.length;i++){var b=document.querySelector(ss[i]);if(b&&!b.disabled){b.click();return true;}}var bs=Array.from(document.querySelectorAll("button,[role=\'button\']"));var m=bs.find(function(b){return /show more|load more|see more/i.test(b.innerText||"");});if(m&&!m.disabled){m.click();return true;}return false;})()';

  while (step < MAX_STEPS && S.state === 'SCRAPING' && S.tabId) {
    step++;
    await cdpExec(DO_SCROLL);
    await sleep(2600 + Math.floor(Math.random() * 1200));

    const raw = await cdpExec(FIND_SCROLL_EL);
    let m = { sh: 0, ch: 900, st: 0 };
    try { if (raw) m = JSON.parse(raw); } catch(_) {}

    // Hard abort if tab died (sh=0 means renderer is gone)
    if (!S.tabId || (m.sh === 0 && step > 1)) {
      log('WARN', 'SCROLL', 'Tab gone mid-scroll — aborting at step ' + step);
      stopReason = 'tab_removed'; break;
    }
    const currentSt = Math.round(m.st);

    if (Math.abs(currentSt - lastSt) > 60) { scrolledAtAll = true; noProgress = 0; lastSt = currentSt; }
    else { noProgress++; }

    log('INFO', 'SCROLL', 'step=' + step + ' scrollTop=' + currentSt + ' sh=' + m.sh + ' ch=' + m.ch + ' noProg=' + noProgress);
    broadcast('EXTENSION_LIVE_STATUS', { text: S.store.size + ' found | step ' + step + '/' + MAX_STEPS });

    // Extra hydration wait on step 1 — React needs time to render cards/engagement after initial load
    if (step === 1) await sleep(2000);
    await runEval();

    const atBottom = m.sh > m.ch * 1.3 && (m.ch + currentSt) >= m.sh - 600;

    if (step >= MIN_STEPS && (noProgress >= NO_PROG_MAX || atBottom)) {
      const clicked = await cdpExec(CLICK_NEXT);
      if (clicked) { noProgress = 0; await sleep(4500); continue; }
      stopReason = atBottom ? 'reached_bottom' : 'no_scroll_progress';
      break;
    }
  }

  if (step >= MAX_STEPS) stopReason = 'max_steps';
  const summary = 'steps=' + step + ' scrolled=' + scrolledAtAll + ' reason=' + stopReason + ' posts=' + S.store.size;
  log('INFO', 'SCROLL', 'DONE ' + summary);
  broadcast('EXTENSION_LIVE_STATUS', { text: 'Scroll done: ' + stopReason + ' | ' + S.store.size + ' posts' });

  if (!scrolledAtAll) {
    log('WARN', 'WATCHDOG', 'Scroll position never changed — page may be blocked or empty');
    broadcast('EXTENSION_LIVE_STATUS', { text: 'WARN: No scroll movement — check LinkedIn tab is loaded' });
  }
  return stopReason;
}

async function runKeyword() {
  const kw = S.kwQueue.current;
  if (!kw) { finalizeSession(); return; }
  log('INFO', 'KW', 'Starting keyword: ' + kw);

  const url = 'https://www.linkedin.com/search/results/content/?keywords=' + encodeURIComponent(kw) + '&origin=GLOBAL_SEARCH_HEADER';
  setState('NAVIGATING');
  await chrome.tabs.update(S.tabId, { url: url, active: true });
  await waitForTabLoad(S.tabId);

  setState('ATTACHING');

  // Verify tab is on LinkedIn before attaching
  var tabInfo = null;
  try { tabInfo = await withTimeout(chrome.tabs.get(S.tabId), 3000, 'tabs.get'); } catch(ex) { log('WARN','TAB','tabs.get: '+ex.message); }
  if (tabInfo) {
    var tabUrl = tabInfo.url || '';
    log('INFO','TAB','URL before attach: ' + tabUrl.substring(0,80));
    if (tabUrl.length > 0 && !tabUrl.includes('linkedin.com') && !tabUrl.startsWith('about:') && !tabUrl.startsWith('chrome')) {
      log('WARN','TAB','Tab not on LinkedIn ('+tabUrl+') — aborting keyword');
      finalizeKeyword().catch(function(ex2){ log('ERROR','KW','finalizeKeyword:'+ex2.message); });
      return;
    }
  }

  // Attach debugger with hard timeout
  if (!S.attached) {
    try {
      await withTimeout(chrome.debugger.attach({tabId:S.tabId},'1.3'), 6000, 'debugger.attach');
      S.attached = true;
      log('INFO','CDP','Debugger attached OK');
    } catch(ex) {
      var em = ex.message || '';
      if (em.includes('already') || em.includes('Another')) { S.attached = true; log('INFO','CDP','Already attached'); }
      else { log('WARN','CDP','Attach issue: '+em+' — proceeding without debugger'); }
    }
  } else {
    log('INFO','CDP','Re-using existing debugger attachment');
  }

  if (S.attached) {
    // Skip Network.enable — too heavy on LinkedIn renderer (causes Aw Snap crashes).
    // CDP is only used for Runtime.evaluate (scroll + EVAL). Network capture via content.js only.
    try { await withTimeout(chrome.debugger.sendCommand({tabId:S.tabId},'Runtime.enable'), 4000, 'Runtime.enable'); log('INFO','CDP','Runtime.enable OK'); } catch(ex){ log('WARN','CDP','Runtime.enable: '+ex.message); }
  }

  // content.js: fire-and-forget network bridge — do NOT await (it's a long-running async IIFE)
  chrome.scripting.executeScript({target:{tabId:S.tabId},files:['content.js']})
    .then(function(){ log('INFO','INJECT','content.js injected'); })
    .catch(function(ex){ log('WARN','INJECT','content.js skipped: '+ex.message); });
  await sleep(300); // brief pause so content.js registers its listeners

  log('INFO','KW','Entering SCRAPING');
  setState('SCRAPING');
  await cdpScrollEngine(kw);

  if (S.state === 'SCRAPING') {
    finalizeKeyword().catch(function(e) { log('ERROR', 'KW', 'finalizeKeyword: ' + e.message); });
  }
}

// ── Compatibility Probe + Adaptive EVAL Builder ─────────────────────────

// DIAG_PROBE: runs once to detect layout/selector availability
const DIAG_PROBE = [
  '(function(){',
  'function c(s){try{return document.querySelectorAll(s).length;}catch(e){return 0;}}',
  'var feedLinks=Array.from(document.querySelectorAll("a[href]")).filter(function(a){return a.href&&(a.href.indexOf("feed/update/urn:li:")>-1||a.href.indexOf("/posts/")>-1);}).length;',
  'var dataUrn=c("[data-urn]"),dataEntityUrn=c("[data-entity-urn]"),dataChameleon=c("[data-chameleon-result-urn]");',
  'var feedCards=c(".feed-shared-update-v2,.update-components-update-v2");',
  'var articleCards=c("article,.reusable-search__result-container");',
  'var socialSpans=c("span[class*=social-count],li[class*=social-count],span[class*=reaction-count]");',
  'var socialCounts=c(".social-details-social-counts");',
  'var engAria=Array.from(document.querySelectorAll("[aria-label]")).filter(function(x){var a=x.getAttribute("aria-label")||"";return /[0-9]/.test(a)&&/(reaction|like|comment)/i.test(a);}).length;',
  'var engButtons=Array.from(document.querySelectorAll("button")).filter(function(b){var t=(b.innerText||"").trim();return /^[0-9]/.test(t)&&/(like|reaction|comment)/i.test(t);}).length;',
  'var textLtr=c("[dir=\\"ltr\\"]"),textBreak=c(".break-words"),textFeed=c(".feed-shared-update-v2__description"),textUpdate=c(".update-components-text");',
  'var bodyLen=document.body.innerText.length;',
  'var sample="";try{var fc=document.querySelector("[data-urn],[data-entity-urn],.feed-shared-update-v2,article");if(fc)sample=(fc.innerText||"").trim().substring(0,100);}catch(e){}',
  'return JSON.stringify({feedLinks:feedLinks,dataUrn:dataUrn,dataEntityUrn:dataEntityUrn,dataChameleon:dataChameleon,feedCards:feedCards,articleCards:articleCards,socialSpans:socialSpans,socialCounts:socialCounts,engAria:engAria,engButtons:engButtons,textLtr:textLtr,textBreak:textBreak,textFeed:textFeed,textUpdate:textUpdate,bodyLen:bodyLen,sample:sample});',
  '})()'
].join('\n');

// buildEval(profile): generates an account-optimized EVAL expression
function buildEval(profile) {
  const p = profile || {};
  const minCard = (p.articleCards > 0 || p.dataUrn > 0) ? 30 : 40;
  const strategy = p._strategy || 'FEED_CLASSIC';

  const lines = [
    '(function(){',
    'var posts=[],seen={},debugLog=[];',
    // Normalize Arabic-Indic → Western digits before any parsing
    'function norm(s){return String(s||"").replace(/[\\u0660-\\u0669]/g,function(c){return c.charCodeAt(0)-0x660;}).replace(/[\\u06F0-\\u06F9]/g,function(c){return c.charCodeAt(0)-0x6F0;});}',
    // pe(): parse any localized number, always returns int >= 0
    'function pe(s){if(!s)return 0;var x=norm(s).toUpperCase().replace(/,/g,"").replace(/\\./g,".");var n=parseFloat((x.match(/[0-9]+\\.?[0-9]*/)||[])[0]);if(isNaN(n))return 0;if(x.indexOf("K")>-1)n*=1000;if(x.indexOf("M")>-1)n*=1000000;return Math.floor(n);}',
    'function xUrn(s){if(!s)return "";var m=String(s).match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);if(m)return "urn:li:"+m[1]+":"+m[2];var p=String(s).match(/activity-([0-9]{10,25})/i);if(p)return "urn:li:activity:"+p[1];return "";}',
    // Engagement: 4-strategy locale-agnostic extraction
    'function getEng(el){',
    '  var lk=0,cm=0;',
    // S1: social-details-social-counts — positional (first number = reactions, second = comments)
    '  try{var sdc=el.querySelector(".social-details-social-counts,.update-components-social-counts");',
    '    if(sdc){var nums=[];Array.from(sdc.querySelectorAll("span,button,li")).forEach(function(x){',
    '      var t=norm((x.innerText||"").trim());if(/^[0-9]+$/.test(t)&&t.length<9){var n=parseInt(t,10);if(n>0&&nums.indexOf(n)<0)nums.push(n);}',
    '    });if(nums[0])lk=nums[0];if(nums[1])cm=nums[1];}}catch(e){}',
    // S2: aria-label scan — works for any language using norm() first
    '  if(!lk&&!cm)try{Array.from(el.querySelectorAll("[aria-label]")).forEach(function(x){',
    '    var raw=x.getAttribute("aria-label")||"";var a=norm(raw);',
    '    if(/[0-9]/.test(a)&&/(reaction|like|reacted|تفاعل|إعجاب|\\u0631\\u062F\\u0648\\u062F)/i.test(raw))lk=Math.max(lk,pe(a));',
    '    if(/[0-9]/.test(a)&&/(comment|تعليق)/i.test(raw))cm=Math.max(cm,pe(a));',
    '  });}catch(e){}',
    // S3: button text — e.g. "27 Likes" or "٢٧ إعجاب"
    '  if(!lk&&!cm)try{Array.from(el.querySelectorAll("button")).forEach(function(b){',
    '    var raw=(b.innerText||"").trim();var t=norm(raw);',
    '    if(/[0-9]/.test(t)&&/(like|reaction|تفاعل|إعجاب)/i.test(raw))lk=Math.max(lk,pe(t));',
    '    if(/[0-9]/.test(t)&&/(comment|تعليق)/i.test(raw))cm=Math.max(cm,pe(t));',
    '  });}catch(e){}',
    // S4: pure-number spans — any span whose entire text is digits (1–8 chars) near bottom of card
    '  if(!lk&&!cm)try{var nums2=[];Array.from(el.querySelectorAll("span")).forEach(function(x){',
    '    var t=norm((x.innerText||"").trim());if(/^[0-9]{1,8}$/.test(t)){var n=parseInt(t,10);if(n>0&&nums2.indexOf(n)<0)nums2.push(n);}',
    '  });if(nums2.length>=2){lk=nums2[0];cm=nums2[1];}else if(nums2.length===1)lk=nums2[0];}catch(e){}',
    '  return {likes:lk,comments:cm};}',
    // Text extraction (RTL-safe: also checks dir=rtl)
    'function getText(el){var txt="";var ss=["[dir=\\"ltr\\"]","[dir=\\"rtl\\"]",".feed-shared-update-v2__description",".update-components-text",".break-words",".attributed-text-segment-list__content",".feed-shared-text",".feed-shared-inline-show-more-text"];ss.forEach(function(s){try{Array.from(el.querySelectorAll(s)).forEach(function(d){var t=(d.innerText||"").trim();if(t.length>txt.length)txt=t;});}catch(e){}});if(txt.length<20)txt=(el.innerText||"").replace(/\\s+/g," ").trim().substring(0,3000);return txt;}',
    'function getAuthor(el){var a=el.querySelector("a[href*=\\"/in/\\"]");return a?(a.innerText||"").trim().replace(/[\\r\\n].*/,"").substring(0,100):"Unknown";}',
    'function xPost(urn,el,href){if(!el||seen[urn])return;seen[urn]=1;var eng=getEng(el);var txt=getText(el);var auth=getAuthor(el);',
    '  if(debugLog.length<3)debugLog.push({urn:urn.slice(-12),textLen:txt.length,author:auth.substring(0,20),likes:eng.likes,comments:eng.comments,cls:(el.className||"").substring(0,40),ariaLabels:Array.from(el.querySelectorAll("[aria-label]")).map(function(x){return x.getAttribute("aria-label");}).filter(Boolean).slice(0,6)});',
    '  posts.push({urn:urn,url:href||("https://www.linkedin.com/feed/update/"+urn),text:txt.substring(0,3000),author:auth,likes:eng.likes,comments:eng.comments});}',
    // card(): walk up, prefer container that has [aria-label] elements (engagement is always aria-labeled)
    'function card(el,urn){',
    '  var c=el,firstHit=null;',
    '  for(var i=0;i<30;i++){',
    '    c=c.parentElement;if(!c||c===document.body)break;',
    '    var l=(c.innerText||"").trim().length;',
    '    if(l>' + minCard + '&&l<15000){',
    '      if(!firstHit)firstHit=c;',
    '      if(c.querySelectorAll("[aria-label]").length>0){xPost(urn,c,"");return;}', // has engagement → use it
    '    }',
    '    if(l>=15000)break;', // too large = feed container, stop
    '  }',
    '  if(firstHit)xPost(urn,firstHit,"");', // fallback: smallest qualifying container
    '}',
    // Method 1: feed/update and /posts/ href links (with engagement-aware inline walker)
    'try{Array.from(document.querySelectorAll("a[href]")).filter(function(a){return a.href&&(a.href.indexOf("feed/update/urn:li:")>-1||a.href.indexOf("/posts/")>-1);}).forEach(function(lnk){var urn=xUrn(lnk.href);if(!urn||seen[urn])return;var c=lnk,fh=null;for(var i=0;i<30;i++){c=c.parentElement;if(!c||c===document.body)break;var l=(c.innerText||"").trim().length;if(l>' + minCard + '&&l<15000){if(!fh)fh=c;if(c.querySelectorAll("[aria-label]").length>0){xPost(urn,c,lnk.href);fh=null;break;}}if(l>=15000)break;}if(fh)xPost(urn,fh,lnk.href);});}catch(e){}',
    // Method 2: data-urn attributes
    'try{["data-urn","data-activity-urn","data-chameleon-result-urn","data-entity-urn","data-id"].forEach(function(attr){Array.from(document.querySelectorAll("["+attr+"]")).forEach(function(el){var urn=xUrn(el.getAttribute(attr)||"");if(!urn||seen[urn])return;card(el,urn);});});}catch(e){}',
    // Method 3: activity- href links
    'try{Array.from(document.querySelectorAll("a[href*=activity-]")).forEach(function(a){var urn=xUrn(a.href);if(!urn||seen[urn])return;card(a,urn);});}catch(e){}',
    // Method 4: scan class-based containers for URNs embedded in innerHTML (covers React-rendered search cards with no href)
    'try{Array.from(document.querySelectorAll("[class*=occludable],[class*=update-v2],[class*=feed-shared],[class*=search-result]")).forEach(function(el){var h=el.innerHTML||"";var m=h.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);if(!m)return;var urn="urn:li:"+m[1]+":"+m[2];if(seen[urn])return;var l=(el.innerText||"").trim().length;if(l>' + minCard + '&&l<15000)xPost(urn,el,"");else card(el,urn);});}catch(e){}',
    'return JSON.stringify({posts:posts,count:posts.length,strategy:"' + strategy + '",debug:debugLog});',
    '})()'
  ];
  return lines.filter(Boolean).join('\n');
}

// scoreAndSelectStrategy(profile): pick best extraction approach
function scoreAndSelectStrategy(p) {
  const scores = {
    FEED_CLASSIC:   (p.feedLinks * 15) + (p.feedCards * 12) + (p.engAria * 4) + (p.textFeed * 6),
    SEARCH_MODERN:  (p.dataUrn * 15)   + (p.dataEntityUrn * 15) + (p.dataChameleon * 12) + (p.socialSpans * 8),
    SEARCH_DENSE:   (p.articleCards * 10) + (p.feedLinks * 6)   + (p.dataUrn * 6) + (p.engButtons * 5),
  };
  // Guarantee a minimum so FEED_CLASSIC wins when all counts are 0
  scores.FEED_CLASSIC = Math.max(scores.FEED_CLASSIC, 5);
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return { strategy: sorted[0][0], scores };
}

// runDiagProbe(): full compatibility analysis — sets S.diagProfile and S.activeEval
async function runDiagProbe() {
  try {
    const r = await chrome.debugger.sendCommand({ tabId: S.tabId }, 'Runtime.evaluate',
      { expression: DIAG_PROBE, returnByValue: true, timeout: 8000 });
    if (!r?.result?.value) { log('WARN', 'PROBE', 'Probe returned no value'); S.activeEval = buildEval(null); return; }
    const profile = JSON.parse(r.result.value);
    const { strategy, scores } = scoreAndSelectStrategy(profile);
    profile._strategy = strategy;
    S.diagProfile = profile;
    S.activeEval = buildEval(profile);

    // ── Structured Diagnostic Report ──────────────────────────────────────
    const issues = [];
    if (profile.feedLinks < 2 && profile.dataUrn < 2 && profile.dataChameleon < 2) issues.push('LOW_URN_SIGNALS: few post identifiers found — may capture fewer posts');
    if (profile.engAria === 0 && profile.socialSpans === 0 && profile.engButtons === 0) issues.push('NO_ENGAGEMENT_ELEMENTS: engagement counts not visible in DOM');
    if (profile.bodyLen < 2000) issues.push('LOW_BODY_TEXT: page may not be fully loaded');
    if (!profile.sample) issues.push('NO_SAMPLE_POST: no post card detected at probe time');

    const report = {
      strategy, scores,
      selectors: {
        feedLinks: profile.feedLinks, dataUrn: profile.dataUrn,
        dataEntityUrn: profile.dataEntityUrn, dataChameleon: profile.dataChameleon,
        feedCards: profile.feedCards, articleCards: profile.articleCards,
        socialSpans: profile.socialSpans, socialCounts: profile.socialCounts,
        engAria: profile.engAria, engButtons: profile.engButtons,
        textLtr: profile.textLtr, textBreak: profile.textBreak,
      },
      bodyLen: profile.bodyLen,
      samplePost: profile.sample || '(none)',
      issues: issues.length ? issues : ['none'],
    };
    log('INFO', 'PROBE', 'NEXORA COMPATIBILITY REPORT\n' + JSON.stringify(report, null, 2));
    broadcast('EXTENSION_LIVE_STATUS', { text: '🔬 Strategy: ' + strategy });
  } catch (e) {
    log('WARN', 'PROBE', 'Probe failed: ' + e.message + ' — using default EVAL');
    S.activeEval = buildEval(null);
  }
}

// ── CDP Eval Loop ────────────────────────────────────────────────────────

// Fallback EVAL (FEED_CLASSIC baseline — used if probe hasn't run yet)
const EVAL = [
  '(function(){',
  'var posts=[],seen={};',
  // pe(): parse engagement number, ALWAYS returns integer >= 0 (never null)
  'function pe(s){if(!s)return 0;var x=String(s).toUpperCase().replace(/,/g,"").replace(/\\./g,".");var n=parseFloat((x.match(/[0-9]+\\.?[0-9]*/)||[])[0]);if(isNaN(n))return 0;if(x.indexOf("K")>-1)n*=1000;if(x.indexOf("M")>-1)n*=1000000;return Math.floor(n);}',
  'function xUrn(s){if(!s)return "";var m=String(s).match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);if(m)return "urn:li:"+m[1]+":"+m[2];var p=String(s).match(/activity-([0-9]{10,25})/i);if(p)return "urn:li:activity:"+p[1];return "";}',
  'function getEngagement(el){',
  '  var lk=0,cm=0,found=false;',
  '  // Strategy 1: aria-label on any element (reactions/likes/comments)',
  '  try{Array.from(el.querySelectorAll("[aria-label]")).forEach(function(x){',
  '    var a=x.getAttribute("aria-label")||"";',
  '    if(/[0-9]/.test(a)&&/(reaction|like|reacted)/i.test(a)){lk=Math.max(lk,pe(a));found=true;}',
  '    if(/[0-9]/.test(a)&&/comment/i.test(a)){cm=Math.max(cm,pe(a));found=true;}',
  '  });}catch(e){}',
  '  // Strategy 2: social count spans (new LinkedIn feed UI)',
  '  try{Array.from(el.querySelectorAll("span[class*=social-count],span[class*=reaction-count],li[class*=social-count]")).forEach(function(x){',
  '    var t=(x.innerText||"").trim();',
  '    var parent=(x.closest("[aria-label]"))||x;',
  '    var label=parent.getAttribute?parent.getAttribute("aria-label")||"": "";',
  '    if(/(reaction|like)/i.test(label+t)){lk=Math.max(lk,pe(label||t));found=true;}',
  '    if(/comment/i.test(label+t)){cm=Math.max(cm,pe(label||t));found=true;}',
  '  });}catch(e){}',
  '  // Strategy 3: button innerText with counts (e.g. "26 Likes" "4 Comments")',
  '  try{Array.from(el.querySelectorAll("button")).forEach(function(b){',
  '    var t=(b.innerText||"").trim();',
  '    if(/^[0-9]/.test(t)&&/(like|reaction)/i.test(t)){lk=Math.max(lk,pe(t));found=true;}',
  '    if(/^[0-9]/.test(t)&&/comment/i.test(t)){cm=Math.max(cm,pe(t));found=true;}',
  '  });}catch(e){}',
  '  // Strategy 4: social-proof text spans (search results variant)',
  '  try{Array.from(el.querySelectorAll("span[class*=social-proof],span[class*=reactions-count]")).forEach(function(x){',
  '    var t=(x.innerText||"").replace(/,/g,"").trim();',
  '    if(/[0-9]/.test(t)){lk=Math.max(lk,pe(t));found=true;}',
  '  });}catch(e){}',
  '  return {likes:lk,comments:cm};',
  '}',
  'function xPost(urn,el,href){',
  '  if(!el||seen[urn])return;seen[urn]=1;',
  '  var ae=el.querySelector("a[href*=\\"/in/\\"]");',
  '  var author=ae?(ae.innerText||"").trim().replace(/[\\r\\n].*/,"").substring(0,100):"";',
  '  var txt="";',
  '  var ss=["[dir=\\"ltr\\"]",".feed-shared-update-v2__description",".update-components-text",".break-words",".feed-shared-text",".attributed-text-segment-list__content",".feed-shared-inline-show-more-text"];',
  '  ss.forEach(function(s){try{Array.from(el.querySelectorAll(s)).forEach(function(d){var t=(d.innerText||"").trim();if(t.length>txt.length)txt=t;});}catch(e){}});',
  '  if(txt.length<20)txt=(el.innerText||"").replace(/\\s+/g," ").trim().substring(0,3000);',
  '  var eng=getEngagement(el);',
  // Always push with 0 defaults — never null
  '  posts.push({urn:urn,url:href||("https://www.linkedin.com/feed/update/"+urn),text:txt.substring(0,3000),author:author||"Unknown",likes:eng.likes,comments:eng.comments});',
  '}',
  'function card(el,urn){var c=el;for(var i=0;i<20;i++){c=c.parentElement;if(!c||c===document.body)break;var l=(c.innerText||"").trim().length;if(l>40&&l<20000){xPost(urn,c,"");return;}}}',
  // Method 1: href links
  'try{Array.from(document.querySelectorAll("a[href]")).filter(function(a){return a.href&&(a.href.indexOf("feed/update/urn:li:")>-1||a.href.indexOf("/posts/")>-1);}).forEach(function(lnk){var urn=xUrn(lnk.href);if(!urn||seen[urn])return;var c=lnk;for(var i=0;i<25;i++){c=c.parentElement;if(!c||c===document.body)break;var l=(c.innerText||"").trim().length;if(l>40&&l<20000){xPost(urn,c,lnk.href);break;}}});}catch(e){}',
  // Method 2: data-urn attributes
  'try{["data-urn","data-activity-urn","data-chameleon-result-urn","data-entity-urn","data-id"].forEach(function(attr){Array.from(document.querySelectorAll("["+attr+"]")).forEach(function(el){var urn=xUrn(el.getAttribute(attr)||"");if(!urn||seen[urn])return;card(el,urn);});});}catch(e){}',
  'return JSON.stringify({posts:posts,count:posts.length});',
  '})()'
].join('\n');



function startEval() {
  stopEval();
  runEval();
  S.evalTimer = setInterval(runEval, 3500);
}
function stopEval() { if (S.evalTimer) { clearInterval(S.evalTimer); S.evalTimer = null; } }

async function runEval() {
  if (!S.attached || !S.tabId || S.state !== 'SCRAPING') return;
  const expr = S.activeEval || EVAL;  // use probe-optimized EVAL if available
  try {
    const r = await chrome.debugger.sendCommand({ tabId: S.tabId }, 'Runtime.evaluate',
      { expression: expr, returnByValue: true, timeout: 10000 });
    // Log raw result on first few calls to diagnose issues
    if (S.store.size === 0) {
      const raw = r && r.result ? r.result.value : null;
      const exType = r && r.exceptionDetails ? JSON.stringify(r.exceptionDetails).substring(0,200) : 'none';
      log('INFO', 'EVAL', 'strategy=' + (S.diagProfile?._strategy||'fallback') + ' type=' + (r&&r.result?r.result.type:'null') + ' exception=' + exType + ' valueLen=' + (raw?String(raw).length:0));
    }
    if (!r?.result?.value) return;
    const parsed = JSON.parse(r.result.value);
    const posts = parsed.posts || [];
    const debugCards = parsed.debug || [];
    if (S.store.size === 0) log('INFO', 'EVAL', 'EVAL[' + (parsed.strategy||'?') + '] returned ' + posts.length + ' posts');
    // Log per-card debug on first run
    if (debugCards.length > 0 && S.store.size === 0) {
      log('INFO', 'EVAL', 'Card debug: ' + JSON.stringify(debugCards));
    }
    let added = 0;
    for (const p of (posts || [])) {
      if (!p.urn) continue;
      // Normalize schema: always 0 not null
      const likes    = typeof p.likes    === 'number' ? p.likes    : 0;
      const comments = typeof p.comments === 'number' ? p.comments : 0;
      const author   = p.author || 'Unknown';
      const text     = p.text   || '';
      if (S.store.has(p.urn)) {
        const ex = S.store.get(p.urn);
        let changed = false;
        if (text.length > (ex.postText || '').length) { ex.postText = text; ex.preview = text; changed = true; }
        if (author !== 'Unknown' && ex.author === 'Unknown') { ex.author = author; changed = true; }
        if (likes > (ex.likes || 0)) { ex.likes = likes; changed = true; }
        if (comments > (ex.comments || 0)) { ex.comments = comments; changed = true; }
        if (changed) { S.batch.push({ ...ex }); added++; }
      } else {
        const post = {
          canonicalUrn: p.urn, url: p.url,
          postText: text, preview: text,
          author, likes, comments,
          source: 'eval'
        };
        S.store.set(p.urn, post);
        S.batch.push({ ...post }); added++;
      }
    }
    if (added > 0) {
      broadcast('EXTENSION_LIVE_STATUS', { text: `📦 ${S.store.size} found | 💾 ${S.totalSaved} saved` });
      flushBatch().catch(() => {});
    }
  } catch (e) { log('WARN', 'EVAL', 'Eval error: ' + e.message); }
}

// ── Network Body Ingestion ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // START via sendMessage (used by bridge and popup)
  if (msg.action === 'START_ENGINE') {
    (async () => {
      try {
        if (S.state !== 'IDLE' && S.state !== 'DONE') await stopSession();
        await startSession(msg, null);
      } catch (e) {
        log('ERROR', 'MSG', 'START_ENGINE failed', e.message);
        chrome.action.setBadgeText({ text: 'ERR' }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }).catch(() => {});
        broadcast('EXTENSION_LIVE_STATUS', { text: '\u274c ' + e.message });
      }
    })();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === 'STOP_ENGINE') {
    stopSession().finally(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'NET_BODY') {
    ingestBody(msg.body);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === 'CONTENT_SCROLL_COMPLETE') {
    // Legacy: content.js scroll complete. CDP engine now handles finalization directly.
    log('INFO', 'MSG', 'CONTENT_SCROLL_COMPLETE received (ignored — CDP engine owns finalization)');
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === 'KEEP_ALIVE') { sendResponse({ ok: true }); return false; }
  if (msg.action === 'GET_STATUS') {
    sendResponse({ running: S.state === 'SCRAPING' || S.state === 'NAVIGATING' || S.state === 'FLUSHING', state: S.state, totalSaved: S.totalSaved, keyword: S.kwQueue?.current });
    return false;
  }
});

// Also handle CDP network events (debugger)
chrome.debugger.onEvent.addListener(async (src, method, params) => {
  if (src.tabId !== S.tabId || S.state !== 'SCRAPING') return;
  if (method === 'Network.loadingFinished') {
    try {
      const r = await chrome.debugger.sendCommand({ tabId: S.tabId }, 'Network.getResponseBody', { requestId: params.requestId });
      const body = r.base64Encoded ? atob(r.body) : (r.body || '');
      if (body.length > 100) ingestBody(body);
    } catch (_) {}
  }
});

function ingestBody(body) {
  if (!body) return;
  const fc = body.trimStart()[0];
  if (fc !== '{' && fc !== '[') return;
  try {
    const json = JSON.parse(body);
    const postMap = {};
    function pe(s) {
      if (s == null) return null;
      const x = String(s).toUpperCase().replace(/,/g, '');
      const n = parseFloat((x.match(/[0-9.]+/) || [])[0]);
      if (isNaN(n)) return null;
      if (x.includes('K')) return Math.floor(n * 1000);
      if (x.includes('M')) return Math.floor(n * 1000000);
      return Math.floor(n);
    }
    function walk(obj) {
      if (!obj || typeof obj !== 'object') return;
      const rawUrn = String(obj.entityUrn || obj.updateUrn || obj.urn || '');
      const m = rawUrn.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
      if (m) {
        const urn = `urn:li:${m[1]}:${m[2]}`;
        if (!postMap[urn]) postMap[urn] = { urn, text: '', author: '', likes: null, comments: null };
        const p = postMap[urn];
        const txt = obj.commentary?.text?.text || obj.commentary?.text || obj.text || obj.summary || '';
        if (typeof txt === 'string' && txt.length > p.text.length) p.text = txt.substring(0, 5000);
        const auth = obj.actor?.name?.text || obj.actor?.nameV2?.text || obj.actor?.fullName || '';
        if (typeof auth === 'string' && auth.length > p.author.length) p.author = auth.substring(0, 100);
        const soc = obj.socialDetail || obj.totalSocialActivityCounts || {};
        if (soc.numLikes != null && p.likes === null) p.likes = pe(soc.numLikes);
        if (soc.numComments != null && p.comments === null) p.comments = pe(soc.numComments);
        if (obj.numLikes != null && p.likes === null) p.likes = pe(obj.numLikes);
        if (obj.numComments != null && p.comments === null) p.comments = pe(obj.numComments);
      }
      if (Array.isArray(obj)) { for (const item of obj) walk(item); }
      else { for (const k of Object.keys(obj)) { if (typeof obj[k] === 'object' && k !== 'paging') walk(obj[k]); } }
    }
    walk(json);
    let enriched = 0;
    for (const urn in postMap) {
      const p = postMap[urn];
      // No filtering — dashboard decides what to display (Q2 decision)
      if (S.store.has(urn)) {
        const ex = S.store.get(urn);
        let changed = false;
        if (p.text && p.text.length > (ex.postText || '').length) { ex.postText = p.text; ex.preview = p.text; changed = true; }
        if (p.likes !== null) { ex.likes = p.likes; changed = true; }
        if (p.comments !== null) { ex.comments = p.comments; changed = true; }
        if (p.author && p.author.length > 1) { ex.author = p.author; changed = true; }
        // Re-push enriched snapshot so API receives the latest merged data
        if (changed) { S.batch.push({ ...ex }); enriched++; }
      } else {
        const np = { canonicalUrn: urn, url: `https://www.linkedin.com/feed/update/${urn}`, postText: p.text, preview: p.text, author: p.author || 'Unknown', likes: p.likes, comments: p.comments, source: 'network' };
        S.store.set(urn, np); S.batch.push({ ...np }); enriched++;
      }
    }
    if (enriched > 0) flushBatch().catch(() => {});
  } catch (_) {}
}

// ── Persistence ──────────────────────────────────────────────────────────
async function flushBatch() {
  log('INFO', 'FLUSH', 'flushBatch called — batch=' + S.batch.length);
  if (!S.batch.length) return;
  const chunk = S.batch.splice(0, S.batch.length);
  log('INFO', 'FLUSH', 'Flushing ' + chunk.length + ' posts to API...');
  try {
    await pushToAPI(chunk);
  } catch (e) {
    log('ERROR', 'FLUSH', 'flushBatch FAILED: ' + e.message + ' — ' + chunk.length + ' posts to retry');
    S.retryQueue.push(...chunk);
  }
}

async function flushAll() {
  stopEval();
  log('INFO', 'FLUSH', 'flushAll start — store=' + S.store.size + ' batch=' + S.batch.length + ' retry=' + S.retryQueue.length + ' flushed=' + S.flushedUrns.size);
  // Only push posts that haven’t been flushed yet (new enrichments or network-only posts)
  for (const [urn, post] of S.store) {
    if (!S.flushedUrns.has(urn)) S.batch.push({ ...post });
  }
  log('INFO', 'FLUSH', 'flushAll after reconcile — batch=' + S.batch.length);
  await flushBatch();
  // Drain retry queue with backoff
  if (S.retryQueue.length > 0) {
    log('WARN', 'FLUSH', 'Retrying ' + S.retryQueue.length + ' failed posts...');
    for (let attempt = 1; attempt <= 3; attempt++) {
      await sleep(attempt * 2000);
      const retry = S.retryQueue.splice(0, S.retryQueue.length);
      try { await pushToAPI(retry); log('INFO', 'FLUSH', 'Retry attempt ' + attempt + ' succeeded'); break; }
      catch (e) { log('WARN', 'FLUSH', 'Retry attempt ' + attempt + ' failed: ' + e.message); S.retryQueue.push(...retry); }
    }
  }
}

async function pushToAPI(posts) {
  if (!posts.length) return;
  const endpoint = S.dashboardUrl + '/api/extension/results';
  log('INFO', 'API', 'POST ' + posts.length + ' posts | url=' + endpoint.substring(0,60) + ' | userId=' + (S.userId||'').substring(0,8) + '...');
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-extension-token': S.userId },
      body: JSON.stringify({ posts, keyword: S.kwQueue?.current || '', source: 'nexora_v6' })
    });
  } catch (netErr) {
    log('WARN', 'API', 'Network error: ' + netErr.message);
    throw netErr;
  }
  log('INFO', 'API', 'Response: HTTP ' + resp.status + ' ' + resp.statusText);
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '(no body)');
    const msg = 'HTTP ' + resp.status + ': ' + errBody.substring(0, 300);
    log('WARN', 'API', 'API error: ' + msg);
    throw new Error(msg);
  }
  const data = await resp.json().catch(() => ({}));
  // Use createdCount (new rows only) so re-flushes of enriched posts don't inflate totalSaved
  const created = data.createdCount ?? data.savedCount ?? posts.length;
  S.totalSaved += created;
  // Mark these URNs as flushed so flushAll won't re-send them
  for (const p of posts) { if (p.canonicalUrn) S.flushedUrns.add(p.canonicalUrn); }
  log('INFO', 'FLUSH', 'Saved ' + created + '/' + posts.length + ' new | total=' + S.totalSaved);
  broadcast('EXTENSION_LIVE_STATUS', { text: '\u2705 Saved ' + S.totalSaved + ' posts' });
}


// ── Keyword Lifecycle ────────────────────────────────────────────────────
async function finalizeKeyword() {
  setState('FLUSHING');
  stopEval();
  await sleep(1500);
  await flushAll();
  log('INFO', 'KW', 'Keyword complete', S.kwQueue.status());
  if (S.kwQueue.hasMore()) {
    S.kwQueue.advance();
    await sleep(4000);
    setState('NAVIGATING');
    await runKeyword();
  } else {
    finalizeSession();
  }
}

function finalizeSession() {
  setState('DONE');
  log('INFO', 'SESSION', 'All keywords done', { totalSaved: S.totalSaved });
  broadcast('SCRAPER_COMPLETE', { totalSaved: S.totalSaved });
  broadcast('EXTENSION_LIVE_STATUS', { text: `✅ Done! ${S.totalSaved} posts saved.` });
  safeDetach();
  setState('IDLE');
}

// ── Tab + CDP Lifecycle ───────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== S.tabId) return;
  log('WARN', 'TAB', 'Tab removed during session', { state: S.state });
  if (S.state === 'IDLE' || S.state === 'DONE') return;
  stopEval();
  S.attached = false;
  S.tabId = null;  // ← scroll loop checks this to abort immediately
  flushAll().finally(() => setState('IDLE'));
});

chrome.debugger.onDetach.addListener((src, reason) => {
  if (src.tabId !== S.tabId) return;
  log('WARN', 'CDP', 'Debugger detached', reason);
  S.attached = false;
  if (S.state === 'SCRAPING') stopEval();
});

async function safeDetach() {
  if (!S.attached || !S.tabId) return;
  try { await chrome.debugger.detach({ tabId: S.tabId }); } catch (_) {}
  S.attached = false;
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function resolveLinkedInTab() {
  const wins = await chrome.windows.getAll({ populate: false });
  const fwId = wins.find(w => w.focused)?.id;
  if (fwId) {
    const [t] = await chrome.tabs.query({ active: true, windowId: fwId, url: '*://*.linkedin.com/*' });
    if (t) return t.id;
  }
  const [t2] = await chrome.tabs.query({ active: true, url: '*://*.linkedin.com/*' });
  if (t2) return t2.id;
  const [t3] = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  if (t3) return t3.id;
  const t4 = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: true });
  await waitForTabLoad(t4.id, 15000);
  return t4.id;
}

function waitForTabLoad(tabId, maxMs = 25000) {
  return new Promise(resolve => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, maxMs);
    function fn(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(fn); clearTimeout(t);
      setTimeout(resolve, 5000); // extra settle time for LinkedIn SPA
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

async function fetchKeywords(dashUrl, userId) {
  const resp = await fetch(`${dashUrl}/api/extension/jobs`, { headers: { 'x-extension-token': userId } });
  if (!resp.ok) throw new Error(`Jobs API ${resp.status}`);
  const jobs = await resp.json();
  if (!jobs.active) throw new Error(jobs.message || 'System inactive in dashboard.');
  let kws = [];
  if (jobs.settings?.searchConfigJson) {
    try {
      const cfg = JSON.parse(jobs.settings.searchConfigJson);
      if (Array.isArray(cfg)) kws.push(...cfg.flat().filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()));
    } catch (_) {}
  }
  const searchOnly = jobs.settings?.searchOnlyMode !== false;
  if (!searchOnly || kws.length === 0) {
    if (Array.isArray(jobs.keywords)) kws.push(...jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean));
  }
  if (kws.length === 0) throw new Error('No keywords configured. Add keywords in dashboard settings.');
  return [...new Set(kws)];
}

function broadcast(action, data = {}) {
  if (action === 'EXTENSION_LIVE_STATUS') {
    chrome.action.setBadgeText({ text: S.totalSaved > 0 ? String(S.totalSaved) : '⚡' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' }).catch(() => {});
  }
  if (action === 'SCRAPER_COMPLETE') {
    chrome.action.setBadgeText({ text: `${S.totalSaved}✓` }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' }).catch(() => {});
  }
  chrome.runtime.sendMessage({ action, ...data }).catch(() => {});
}

function broadcastStatus() {
  broadcast('EXTENSION_LIVE_STATUS', { text: `State: ${S.state}` });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
