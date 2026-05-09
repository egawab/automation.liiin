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

// ── Start Session ────────────────────────────────────────────────────────
async function startSession(msg, port) {
  setState('INITIALIZING');
  S.sessionId = Math.random().toString(36).slice(2);
  S.totalSaved = 0;
  S.store.clear(); // Clear URN store for new session
  S.batch = []; S.retryQueue = [];

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
async function runKeyword() {
  const kw = S.kwQueue.current;
  if (!kw) { finalizeSession(); return; }
  log('INFO', 'KW', 'Running keyword', kw);
  broadcast('EXTENSION_LIVE_STATUS', { text: `⚡ Keyword: "${kw}"` });

  const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(kw)}&origin=GLOBAL_SEARCH_HEADER`;
  setState('NAVIGATING');
  await chrome.tabs.update(S.tabId, { url, active: true });
  await waitForTabLoad(S.tabId);

  setState('ATTACHING');
  if (!S.attached) {
    try {
      await chrome.debugger.attach({ tabId: S.tabId }, '1.3');
      S.attached = true;
    } catch (e) {
      if (e.message?.toLowerCase().includes('already')) { S.attached = true; }
      else { log('WARN', 'CDP', 'Attach failed', e.message); }
    }
  }
  if (S.attached) {
    try { await chrome.debugger.sendCommand({ tabId: S.tabId }, 'Network.enable'); } catch (_) {}
  }

  setState('SCRAPING');
  try {
    await chrome.scripting.executeScript({ target: { tabId: S.tabId }, files: ['content.js'] });
  } catch (e) { log('WARN', 'INJECT', 'content.js inject warning', e.message); }

  startEval();
  broadcast('EXTENSION_LIVE_STATUS', { text: `🔍 Scraping: "${kw}"` });
}

// ── CDP Eval Loop ────────────────────────────────────────────────────────
const EVAL = `(function(){
  var posts=[],seen={};
  function pe(s){if(!s)return null;var x=String(s).toUpperCase().replace(/,/g,'');var n=parseFloat((x.match(/[0-9.]+/)||[])[0]);if(isNaN(n))return null;if(x.indexOf('K')>-1)n*=1000;if(x.indexOf('M')>-1)n*=1000000;return Math.floor(n);}
  function extractUrn(s){if(!s)return '';var m=String(s).match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);if(m)return 'urn:li:'+m[1]+':'+m[2];var p2=String(s).match(/activity-([0-9]{10,25})/i);if(p2)return 'urn:li:activity:'+p2[1];return '';}
  function extractPost(urn,container,href){
    if(!container||seen[urn])return;seen[urn]=1;
    var ae=container.querySelector('a[href*="/in/"]');
    var author=ae?(ae.innerText||'').trim().split('\n')[0].substring(0,100):'';
    var txt='';
    var sels=['[dir="ltr"]','.feed-shared-update-v2__description','.update-components-text','.break-words','.feed-shared-text','.attributed-text-segment-list__content','.feed-shared-inline-show-more-text','.feed-shared-update-v2__commentary'];
    sels.forEach(function(sel){try{Array.from(container.querySelectorAll(sel)).forEach(function(d){var t=(d.innerText||'').trim();if(t.length>txt.length)txt=t;});}catch(e){}});
    if(txt.length<20)txt=(container.innerText||'').replace(/\s+/g,' ').trim().substring(0,3000);
    var likes=null,comments=null;
    try{Array.from(container.querySelectorAll('[aria-label]')).forEach(function(el){var l=el.getAttribute('aria-label')||'';if(/[0-9]/.test(l)&&/(reaction|like)/i.test(l)&&likes===null)likes=pe(l);if(/[0-9]/.test(l)&&/comment/i.test(l)&&comments===null)comments=pe(l);});}catch(e){}
    posts.push({urn:urn,url:href||('https://www.linkedin.com/feed/update/'+urn),text:txt.substring(0,3000),author:author,likes:likes,comments:comments});
  }
  function findCard(el,urn){var c=el;for(var i=0;i<20;i++){c=c.parentElement;if(!c||c===document.body)break;var l=(c.innerText||'').trim().length;if(l>30&&l<20000){extractPost(urn,c,'');return;}}}
  try{Array.from(document.querySelectorAll('a[href]')).filter(function(a){return a.href&&(a.href.indexOf('feed/update/urn:li:')>-1||a.href.indexOf('/posts/')>-1);}).forEach(function(link){var urn=extractUrn(link.href);if(!urn||seen[urn])return;var c=link;for(var i=0;i<25;i++){c=c.parentElement;if(!c||c===document.body)break;var l=(c.innerText||'').trim().length;if(l>30&&l<20000){extractPost(urn,c,link.href);break;}}});}catch(e){}
  try{['data-urn','data-activity-urn','data-chameleon-result-urn','data-id'].forEach(function(attr){Array.from(document.querySelectorAll('['+attr+']')).forEach(function(el){var urn=extractUrn(el.getAttribute(attr)||'');if(!urn||seen[urn])return;findCard(el,urn);});});}catch(e){}
  return JSON.stringify({posts:posts,count:posts.length});
})()`;


function startEval() {
  stopEval();
  runEval();
  S.evalTimer = setInterval(runEval, 3500);
}
function stopEval() { if (S.evalTimer) { clearInterval(S.evalTimer); S.evalTimer = null; } }

async function runEval() {
  if (!S.attached || !S.tabId || S.state !== 'SCRAPING') return;
  try {
    const r = await chrome.debugger.sendCommand({ tabId: S.tabId }, 'Runtime.evaluate',
      { expression: EVAL, returnByValue: true, timeout: 10000 });
    if (!r?.result?.value) return;
    const { posts } = JSON.parse(r.result.value);
    let added = 0;
    for (const p of (posts || [])) {
      if (!p.urn) continue;
      if (S.store.has(p.urn)) {
        // Enrich existing entry — track if anything changed
        const ex = S.store.get(p.urn);
        let changed = false;
        if (p.text && p.text.length > (ex.postText || '').length) { ex.postText = p.text; ex.preview = p.text; changed = true; }
        if (p.author && (!ex.author || ex.author === 'Unknown')) { ex.author = p.author; changed = true; }
        if (p.likes !== null && ex.likes === null) { ex.likes = p.likes; changed = true; }
        if (p.comments !== null && ex.comments === null) { ex.comments = p.comments; changed = true; }
        // Re-push snapshot so the enriched version reaches the API via upsert
        if (changed) { S.batch.push({ ...ex }); added++; }
      } else {
        const post = {
          canonicalUrn: p.urn, url: p.url, postText: p.text || '', preview: p.text || '',
          author: p.author || 'Unknown', likes: p.likes, comments: p.comments, source: 'eval'
        };
        S.store.set(p.urn, post);
        S.batch.push({ ...post }); added++;
      }
    }
    if (added > 0) {
      broadcast('EXTENSION_LIVE_STATUS', { text: `📦 ${S.store.size} found | 💾 ${S.totalSaved} saved` });
      flushBatch().catch(() => {});
    }
  } catch (e) { log('WARN', 'EVAL', 'Eval error', e.message); }
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
    if (S.state === 'SCRAPING') finalizeKeyword().catch(e => log('ERROR', 'KW', 'finalizeKeyword error', e.message));
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
  if (!S.batch.length) return;
  const chunk = S.batch.splice(0, S.batch.length);
  try {
    await pushToAPI(chunk);
  } catch (_) {
    S.retryQueue.push(...chunk);
  }
}

async function flushAll() {
  stopEval();
  await runEval();
  // Final reconciliation: push the CURRENT enriched state of every store entry.
  // This guarantees the API receives the most hydrated version of each post,
  // even if enrichment happened after the initial batch flush.
  for (const [, post] of S.store) {
    S.batch.push({ ...post });
  }
  await flushBatch();
  // Drain retry queue with backoff
  if (S.retryQueue.length > 0) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await sleep(attempt * 2000);
      const retry = S.retryQueue.splice(0, S.retryQueue.length);
      try { await pushToAPI(retry); break; } catch (_) { S.retryQueue.push(...retry); }
    }
  }
}

async function pushToAPI(posts) {
  if (!posts.length) return;
  const resp = await fetch(`${S.dashboardUrl}/api/extension/results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-extension-token': S.userId },
    body: JSON.stringify({ posts, keyword: S.kwQueue?.current || '', source: 'nexora_v6' })
  });
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  const data = await resp.json().catch(() => ({}));
  const n = data.savedCount ?? posts.length;
  S.totalSaved += n;
  log('INFO', 'FLUSH', `Saved ${n}/${posts.length} total=${S.totalSaved}`);
  broadcast('EXTENSION_LIVE_STATUS', { text: `📦 ${S.store.size} found | 💾 ${S.totalSaved} saved` });
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
  stopEval(); S.attached = false; S.tabId = null;
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
