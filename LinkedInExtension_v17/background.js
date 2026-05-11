// Nexora v16 – URN-link extraction (works on all LinkedIn layouts)
console.log('[Worker] Nexora v16');

const cdp = {
  tabId: null, attached: false, keyword: '',
  dashboardUrl: '', userId: '',
  store: new Map(), batchPending: [], totalSaved: 0,
  evalTimer: null, running: false,
  _lastApiReqs: new Set()
};

async function restoreSession() {
  try {
    const s = await chrome.storage.session.get(['cdpTabId','cdpKeyword','cdpDashUrl','cdpUserId']);
    if (!s.cdpTabId) return;
    try { await chrome.tabs.get(s.cdpTabId); } catch (_) { await chrome.storage.session.clear(); return; }
    cdp.tabId = s.cdpTabId; cdp.keyword = s.cdpKeyword || '';
    cdp.dashboardUrl = s.cdpDashUrl || ''; cdp.userId = s.cdpUserId || '';
  } catch (_) {}
}
restoreSession();

// ── تشغيل تلقائي عبر منبه داخلي ──────────────────────────────────────────
// يسأل الداشبورد كل 30 ثانية — لو systemActive=true يشغل الماكينة تلقائياً
// هذا يتجاوز مشكلة تصحية عامل الخدمة في المانيفست الثالث بالكامل
chrome.alarms.create('nexora_poll', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'nexora_poll') return;
  if (cdp.running) return; // شغال فعلاً
  const config = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
  if (!config.dashboardUrl || !config.userId) return;
  try {
    const resp = await fetch(`${config.dashboardUrl}/api/extension/jobs`, {
      headers: { 'x-extension-token': config.userId }
    });
    if (!resp.ok) return;
    const jobs = await resp.json();
    if (jobs.active & !cdp.running) {
      console.log('[Worker] Auto-start: systemActive=true detected.');
      cdp.dashboardUrl = config.dashboardUrl;
      cdp.userId = config.userId;
      await handleStartFast({ dashboardUrl: config.dashboardUrl, userId: config.userId });
      launchEngine().catch(e => console.error('[Worker] launch error:', e.message));
    }
  } catch(e) { /* API unreachable – skip */ }
});

// وصلة دائمة من الجسر — أكثر موثوقية من sendMessage أو storage في المانيفست الثالث
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'nexora_cmd') return;
  console.log('[Worker] Port connected from bridge.');
  port.onMessage.addListener((msg) => {
    if (msg.action !== 'START') return;
    console.log('[Worker] START command via port:', msg);
    handleStartFast(msg)
      .then(() => {
        port.postMessage({ ok: true, keyword: cdp.keyword || 'starting' });
        launchEngine().catch(e => {
          console.error('[Worker] launchEngine error:', e.message);
          broadcast('EXTENSION_LIVE_STATUS', { text: '❌ ' + e.message });
        });
      })
      .catch(e => {
        console.error('[Worker] handleStartFast error:', e.message);
        port.postMessage({ ok: false, error: e.message });
      });
  });
});

// احتفظ بـ storage.onChanged كخط احتياطي
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.nexora_cmd) return;
  const cmd = changes.nexora_cmd.newValue;
  if (!cmd || cmd.action !== 'START') return;
  console.log('[Worker] Storage command received (fallback):', cmd);
  handleStartFast(cmd).then(() => launchEngine()).catch(console.error);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START_ENGINE' || msg.action === 'START_POLLING') {
    // ⚠️ MV3 fix: respond SYNCHRONOUSLY before any await, then run engine async
    sendResponse({ ok: true, result: { keyword: cdp.keyword || 'starting...' } });
    handleStartFast(msg)
      .then(() => launchEngine())
      .catch(e => {
        console.error('[Worker] Start error:', e.message);
        broadcast('EXTENSION_LIVE_STATUS', { text: '❌ ' + e.message });
      });
    return false; // channel closed immediately – response already sent
  }
  if (msg.action === 'KEEP_ALIVE')    { sendResponse({ ok: true }); return false; }
  if (msg.action === 'GET_CDP_COUNT') { sendResponse({ count: cdp.totalSaved + cdp.batchPending.length }); return false; }
  if (msg.action === 'GET_STATUS')    { sendResponse({ running: cdp.running, keyword: cdp.keyword, totalSaved: cdp.totalSaved }); return false; }
  if (msg.action === 'CONTENT_SCROLL_COMPLETE') { finalFlush().catch(console.error); return false; }
  if (msg.action === 'SYNC_RESULTS') {
    syncBatch(msg.posts, msg.keyword || cdp.keyword)
      .then(n => sendResponse({ ok: true, savedCount: n }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

// Phase 1: fast – resolve keyword + tab, reply to message channel immediately
async function handleStartFast(msg) {
  if (cdp.running) {
    cdp.running = false; stopEvalLoop();
    await safeDetach().catch(() => {});
  }
  const config = await chrome.storage.sync.get(['dashboardUrl', 'userId']);
  cdp.dashboardUrl = msg.dashboardUrl || config.dashboardUrl;
  cdp.userId       = msg.userId       || config.userId;
  if (!cdp.dashboardUrl || !cdp.userId) throw new Error('Not connected.');

  let keyword = '';
  try {
    keyword = await fetchKeyword(cdp.dashboardUrl, cdp.userId);
  } catch (e) {
    const cached = await chrome.storage.local.get('lastKeyword');
    if (cached.lastKeyword) {
      keyword = cached.lastKeyword;
      console.warn('[Worker] fetchKeyword failed, using cached:', keyword);
    } else {
      broadcast('EXTENSION_LIVE_STATUS', { text: '\u274c Error: ' + e.message });
      throw e;
    }
  }
  cdp.keyword = keyword;
  await chrome.storage.local.set({ lastKeyword: keyword });
  cdp.store.clear(); cdp.batchPending = []; cdp.totalSaved = 0; cdp._lastApiReqs.clear();
  await chrome.storage.session.clear();

  const liTabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  const tab = liTabs[0] || await chrome.tabs.create({ url: 'about:blank', active: true });
  cdp.tabId = tab.id;
  console.log('[Worker] Phase1 done. keyword=' + keyword + ' tabId=' + cdp.tabId);
  return { keyword };
}

// Phase 2: slow – CDP attach, navigate, wait for load, start loop (runs after response sent)
async function launchEngine() {
  // Keep service worker alive via alarm during the long tab-load wait
  chrome.alarms.create('sw_keepalive', { periodInMinutes: 0.4 });
  try {
    try {
      await chrome.debugger.attach({ tabId: cdp.tabId }, '1.3');
      cdp.attached = true;
    } catch (e) {
      if (e.message?.toLowerCase().includes('already')) { cdp.attached = true; }
      else throw new Error('CDP attach failed: ' + e.message);
    }
    await chrome.debugger.sendCommand({ tabId: cdp.tabId }, 'Network.enable');
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(cdp.keyword)}&origin=GLOBAL_SEARCH_HEADER&`;
    await chrome.tabs.update(cdp.tabId, { url: searchUrl, active: true });
    await chrome.storage.session.set({ cdpTabId: cdp.tabId, cdpKeyword: cdp.keyword, cdpDashUrl: cdp.dashboardUrl, cdpUserId: cdp.userId });
    broadcast('EXTENSION_LIVE_STATUS', { text: '\u23f3 Loading LinkedIn...' });
    await waitForTabLoad(cdp.tabId);
    try {
      await chrome.scripting.executeScript({ target: { tabId: cdp.tabId }, files: ['content.js'] });
    } catch (e) { console.warn('[Worker] content.js inject warning:', e.message); }
    cdp.running = true;
    startEvalLoop();
    broadcast('EXTENSION_LIVE_STATUS', { text: '\u26a1 Engine running: "' + cdp.keyword + '"' });
    console.log('[Worker] Engine running.');
  } catch (e) {
    broadcast('EXTENSION_LIVE_STATUS', { text: '\u274c Launch failed: ' + e.message });
    console.error('[Worker] launchEngine error:', e);
  } finally {
    chrome.alarms.clear('sw_keepalive');
  }
}

// ── EVAL_SCRIPT ────────────────────────────────────────────────────────────
// Finds all LinkedIn post links in the DOM (always present in every layout).
// Each link contains the real URN and is inside the post card container.
const EVAL_SCRIPT = `(function(){
  var posts = [];
  var seen  = {};

  var postLinks = Array.from(document.querySelectorAll(
    'a[href*="feed/update/urn:li:"], a[href*="/posts/"]'
  ));

  postLinks.forEach(function(link){
    var href = link.href || '';
    var um = href.match(/urn:li:(activity|ugcPost|share):(\\d{10,25})/);
    if (!um) return;
    var urn = 'urn:li:' + um[1] + ':' + um[2];
    if (seen[urn]) return; seen[urn] = 1;

    // Walk up: find post card (>400 chars but <15000 to avoid page wrappers)
    var container = link, best = null;
    for (var i = 0; i < 25; i++) {
      container = container.parentElement;
      if (!container || container === document.body) break;
      var len = (container.innerText || '').trim().length;
      if (len > 400 & len < 15000) { best = container; break; }
    }
    if (!best) return;

    // Author: LinkedIn links the author name to their /in/username profile
    var authorEl = best.querySelector('a[href*="/in/"]');
    var author = authorEl ? (authorEl.innerText || '').trim().split('\\n')[0].substring(0, 100) : '';

    // Post text: LinkedIn wraps post content in dir="ltr" element
    var postEl = best.querySelector('[dir="ltr"]');
    var postText = postEl ? (postEl.innerText || '').trim() : '';
    if (!postText) postText = (best.innerText || '').trim().substring(0, 2000);

    // Reaction count
    var likes = null;
    Array.from(best.querySelectorAll('[aria-label]')).forEach(function(el){
      if (likes !== null) return;
      var l = el.getAttribute('aria-label') || '';
      if (/\\d/.test(l) & /(reaction|like)/i.test(l)) {
        var nm = l.match(/([\\d,]+)/);
        if (nm) likes = parseInt(nm[1].replace(/,/g,''), 10);
      }
    });
    if (likes === null) {
      var bm = (best.innerText || '').match(/([\\d,]+)\\s*(reactions?|likes?)/i);
      if (bm) likes = parseInt(bm[1].replace(/,/g,''), 10);
    }

    posts.push({ urn: urn, url: href,
      text: postText.substring(0, 3000), author: author,
      likes: likes, comments: null });
  });

  return JSON.stringify({ posts: posts, total: posts.length, linkCount: postLinks.length });
})()`;

// ── EVAL LOOP ─────────────────────────────────────────────────────────────
async function evaluatePageState() {
  if (!cdp.attached || !cdp.tabId) return 0;
  try {
    const r = await chrome.debugger.sendCommand({ tabId: cdp.tabId }, 'Runtime.evaluate',
      { expression: EVAL_SCRIPT, returnByValue: true, timeout: 12000 });
    if (!r?.result?.value) return 0;
    const parsed = JSON.parse(r.result.value);
    // Always log so we can debug
    console.log(`[EVAL] links=${parsed.linkCount} posts=${parsed.total} store=${cdp.store.size}`);
    let added = 0;
    for (const p of (parsed.posts || [])) {
      if (!p.urn) continue;
      if (cdp.store.has(p.urn)) {
        const ex = cdp.store.get(p.urn);
        let enriched = false;
        if (!ex.postText && p.text)                              { ex.postText = p.text; ex.preview = p.text; enriched = true; }
        if ((!ex.author || ex.author === 'Unknown') & p.author) { ex.author = p.author; enriched = true; }
        if (ex.likes === null && p.likes !== null)               { ex.likes = p.likes; enriched = true; }
        // Push to batch if enriched OR if it's a network-only post not yet pushed
        if (enriched || ex._networkOnly) {
          delete ex._networkOnly;
          cdp.batchPending.push({ ...ex }); added++;
        }
        continue;
      }
      const post = { canonicalUrn: p.urn, url: p.url, postText: p.text || '', preview: p.text || '',
        author: p.author || 'Unknown', likes: p.likes, comments: null,
        confidence: p.text ? 0.9 : 0.5, source: 'cdp_dom' };
      cdp.store.set(p.urn, post);
      cdp.batchPending.push(post);
      added++;
    }
    if (added > 0) {
      broadcast('EXTENSION_LIVE_STATUS', { text: `📦 ${cdp.store.size} found | 💾 ${cdp.totalSaved} saved` });
      await flushBatch();
    }
    return added;
  } catch (e) { console.error('[EVAL] error:', e.message); return 0; }
}

function startEvalLoop() {
  stopEvalLoop();
  evaluatePageState();
  cdp.evalTimer = setInterval(() => { if (!cdp.attached) { stopEvalLoop(); return; } evaluatePageState(); }, 4000);
}
function stopEvalLoop() { if (cdp.evalTimer) { clearInterval(cdp.evalTimer); cdp.evalTimer = null; } }

async function finalFlush() {
  stopEvalLoop();
  await sleep(1500);
  await evaluatePageState();
  await flushBatch();
  broadcast('SCRAPER_COMPLETE', { totalSaved: cdp.totalSaved });
  broadcast('EXTENSION_LIVE_STATUS', { text: `🎉 Done! ${cdp.totalSaved} posts saved.` });
  await safeDetach();
  await chrome.storage.session.clear();
  cdp.running = false;
}

// ── NETWORK INTERCEPTION ──────────────────────────────────────────────────
chrome.debugger.onEvent.addListener(async (src, method, params) => {
  if (src.tabId !== cdp.tabId || !cdp.running) return;
  if (method === 'Network.responseReceived') {
    const url = params?.response?.url || '';
    if (url.includes('linkedin.com') & !url.includes('.js') & !url.includes('.css')
        & !url.includes('.png') & !url.includes('.woff') & !url.includes('.ico')) {
      cdp._lastApiReqs.add(params.requestId);
    }
  }
  if (method === 'Network.loadingFinished' & cdp._lastApiReqs.has(params.requestId)) {
    cdp._lastApiReqs.delete(params.requestId);
    try {
      const r = await chrome.debugger.sendCommand({ tabId: cdp.tabId }, 'Network.getResponseBody', { requestId: params.requestId });
      const body = r.base64Encoded ? atob(r.body) : (r.body || '');
      if (body.length > 100) ingestNetworkBody(body);
    } catch (_) {}
  }
});

function ingestNetworkBody(body) {
  const MIN = 10;
  const postMap = {};

  // محاول JSON structured parsing
  try {
    let json = null;
    try { json = JSON.parse(body); } catch (_) {}
    if (json) {
      const items = [];
      // LinkedIn Voyager: json.included OR json.data.elements OR json.elements
      if (Array.isArray(json.included)) items.push(...json.included);
      if (Array.isArray(json.elements)) items.push(...json.elements);
      if (json.data?.elements) items.push(...(json.data.elements || []));

      for (const item of items) {
        const rawUrn = item.entityUrn || item.updateUrn || item.urn || '';
        const um = rawUrn.match(/urn:li:(activity|ugcPost|share):(\d{10,25})/);
        if (!um) continue;
        const urn = `urn:li:${um[1]}:${um[2]}`;

        // نص البوست: عدة مسارات محتملة في Voyager API
        const text =
          item.commentary?.text?.text ||
          item.commentary?.text ||
          item.value?.commentary?.text?.text ||
          item.resharedUpdate?.commentary?.text?.text ||
          item.specificContent?.['com.linkedin.ugc.ShareContent']?.shareCommentary?.text ||
          item.message?.text ||
          item.summary?.text ||
          item.description?.text ||
          '';

        // اسم صاحب البوست
        const author =
          item.actor?.name?.text ||
          item.actor?.nameV2?.text ||
          item.actor?.title?.text ||
          item.actor?.fullName ||
          item.author?.name ||
          '';

        // عدد التفاعلات
        const soc =
          item.socialDetail?.totalSocialActivityCounts ||
          item.value?.socialDetail?.totalSocialActivityCounts ||
          item.socialProofText ||
          {};
        const likes = typeof soc === 'object' ? (soc.numLikes ?? null) : null;
        const comments = typeof soc === 'object' ? (soc.numComments ?? null) : null;

        const url = item.navigationUrl || item.shareUrl || `https://www.linkedin.com/feed/update/${urn}`;
        postMap[urn] = { urn, text: String(text || ''), author: String(author || ''), url, likes, comments };
      }
    }
  } catch (_) {}

  // Regex scan: عشان كل اللي فاتنا في الـ JSON
  const re = /urn:li:(activity|ugcPost|share):(\d{10,25})/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const urn = `urn:li:${m[1]}:${m[2]}`;
    if (postMap[urn]?.text) continue; // عنده بيانات فعلاً
    const slice = body.substring(Math.max(0, m.index - 800), m.index + 5000);
    const lm = slice.match(/"numLikes"\s*:\s*(\d+)/);
    const cm = slice.match(/"numComments"\s*:\s*(\d+)/);
    // البحث عن نص البوست: كل حاجة أطول من 30 حرف
    const textMatches = [...slice.matchAll(/"text"\s*:\s*"([^"]{30,2000})"/g)];
    const tm = textMatches.sort((a,b) => b[1].length - a[1].length)[0];
    // اسم الشخص: fullName أو localizedName
    const am = slice.match(/"(?:fullName|localizedName|firstName|lastName)"\s*:\s*"([^"]{2,80})"/);
    const existingText = postMap[urn]?.text || '';
    const newText = tm ? tm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '';
    postMap[urn] = { urn, url: postMap[urn]?.url || `https://www.linkedin.com/feed/update/${urn}`,
      text: newText.length > existingText.length ? newText : existingText,
      author: postMap[urn]?.author || (am ? am[1] : ''),
      likes: lm ? parseInt(lm[1], 10) : (postMap[urn]?.likes ?? null),
      comments: cm ? parseInt(cm[1], 10) : (postMap[urn]?.comments ?? null) };
  }

  let added = 0;
  for (const [urn, p] of Object.entries(postMap)) {
    if (p.likes !== null && p.likes < MIN) continue;
    if (cdp.store.has(urn)) {
      const ex = cdp.store.get(urn);
      // فقط تحديث البيانات — الـ DOM eval هو اللي يعمل flush
      if (!ex.postText && p.text)   { ex.postText = p.text; ex.preview = p.text; }
      if (!ex.author   && p.author) ex.author = p.author;
      if (ex.likes === null && p.likes !== null) ex.likes = p.likes;
      continue;
    }
    // بوست جديد من الشبكة — يتخزن بس، مش يتبعت فوراً
    const post = { canonicalUrn: urn, url: p.url, postText: p.text || '', preview: p.text || '',
      author: p.author || 'Unknown', likes: p.likes, comments: p.comments,
      confidence: p.text ? 0.9 : 0.5, source: 'cdp_network', _networkOnly: true };
    cdp.store.set(urn, post);
    added++;
  }
  if (added > 0) {
    console.log(`[Network] stored ${added} – awaiting DOM enrichment`);
    // احتياطي: لو الـ DOM مش هيشوفهم، flush بعد 12 ثانية
    setTimeout(() => {
      let flushed = 0;
      for (const [, post] of cdp.store) {
        if (post._networkOnly) { delete post._networkOnly; cdp.batchPending.push({ ...post }); flushed++; }
      }
      if (flushed > 0) { console.log(`[Network] delayed-flush ${flushed}`); flushBatch().catch(console.error); }
    }, 12000);
  }
}

// ── FLUSH ─────────────────────────────────────────────────────────────────
async function flushBatch() {
  if (!cdp.batchPending.length) return 0;
  // Sort by likes descending so highest-reach posts reach the dashboard first
  cdp.batchPending.sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1));
  const CHUNK = 25; let synced = 0;
  while (cdp.batchPending.length > 0) {
    const chunk = cdp.batchPending.splice(0, CHUNK);
    try {
      const resp = await fetch(`${cdp.dashboardUrl}/api/extension/results`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-extension-token': cdp.userId },
        body: JSON.stringify({ posts: chunk, keyword: cdp.keyword, source: 'nexora_v16' })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) { cdp.batchPending.unshift(...chunk); break; }
      cdp.totalSaved += data.savedCount ?? chunk.length;
      synced += data.savedCount ?? chunk.length;
      console.log(`[Flush] ${data.savedCount}/${chunk.length} total=${cdp.totalSaved}`);
    } catch (e) { cdp.batchPending.unshift(...chunk); break; }
  }
  return synced;
}

async function syncBatch(posts, keyword) {
  const resp = await fetch(`${cdp.dashboardUrl}/api/extension/results`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-extension-token': cdp.userId },
    body: JSON.stringify({ posts, keyword, source: 'nexora_scraper' })
  });
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  return (await resp.json()).savedCount || posts.length;
}

// ── HELPERS ───────────────────────────────────────────────────────────────
async function safeDetach() {
  if (!cdp.attached || !cdp.tabId) return;
  try { await chrome.debugger.detach({ tabId: cdp.tabId }); } catch (_) {}
  cdp.attached = false;
}

function waitForTabLoad(tabId, maxMs = 28000) {
  return new Promise(resolve => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, maxMs);
    function fn(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(fn); clearTimeout(t);
      setTimeout(resolve, 4000);
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

async function fetchKeyword(dashboardUrl, userId) {
  const resp = await fetch(`${dashboardUrl}/api/extension/jobs`, { headers: { 'x-extension-token': userId } });
  if (!resp.ok) throw new Error(`Jobs API ${resp.status}`);
  const jobs = await resp.json();
  if (!jobs.active) throw new Error(jobs.message || 'System inactive');

  // لو في وضع البحث فقط → استخدم searchConfigJson أولاً
  const searchOnly = jobs.settings?.searchOnlyMode !== false; // الافتراضي: وضع البحث
  if (searchOnly & jobs.settings?.searchConfigJson) {
    try {
      const cfg = JSON.parse(jobs.settings.searchConfigJson);
      const kw = cfg.flat().find(k => typeof k === 'string' & k.trim());
      if (kw) { console.log('[Worker] Using searchConfig keyword:', kw.trim()); return kw.trim(); }
    } catch (_) {}
  }

  // لو مش في وضع البحث → استخدم كلمات الحملات
  if (Array.isArray(jobs.keywords) & jobs.keywords.length > 0) {
    const kw = jobs.keywords[0].keyword?.trim();
    if (kw) { console.log('[Worker] Using campaign keyword:', kw); return kw; }
  }

  // احتياطي: جرب searchConfigJson حتى لو مش search-only
  try {
    const cfg = JSON.parse(jobs.settings?.searchConfigJson || '[]');
    const kw = cfg.flat().find(k => typeof k === 'string' & k.trim());
    if (kw) return kw.trim();
  } catch (_) {}

  throw new Error('No keyword configured.');
}

function broadcast(action, data = {}) {
  if (action === 'EXTENSION_LIVE_STATUS') {
    chrome.action.setBadgeText({ text: cdp.totalSaved > 0 ? String(cdp.totalSaved) : '⚡' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  }
  if (action === 'SCRAPER_COMPLETE') {
    chrome.action.setBadgeText({ text: String(cdp.totalSaved) + '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
  }
  try { chrome.runtime.sendMessage({ action, ...data }); } catch (_) {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
chrome.debugger.onDetach.addListener(src => { if (src.tabId === cdp.tabId) { cdp.attached = false; cdp.running = false; stopEvalLoop(); } });
chrome.tabs.onRemoved.addListener(tabId => { if (tabId === cdp.tabId & cdp.attached) safeDetach(); });
