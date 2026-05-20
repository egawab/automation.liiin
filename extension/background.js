// background.js — Nexora Tab-Based Scraper v3
// Opens a LinkedIn tab, navigates, scrolls slowly, and collects post links from the rendered DOM.

console.log('[BG] Nexora Tab Scraper v3 loaded');

const S = {
  state: 'IDLE',
  tabId: null,
  runId: 0,
  totalSaved: 0,
  dashboardUrl: '',
  userId: '',
  keywords: [],
  kwIndex: 0,
};

// ── Keep-alive ────────────────────────────────────────────────────────────────
chrome.alarms.create('nexora_hb', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'nexora_hb' && S.state === 'RUNNING')
    console.log('[BG] hb state=RUNNING kw=' + (S.keywords[S.kwIndex] || ''));
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function extractUrn(s) {
  if (!s) return '';
  const m = String(s).match(/(?:urn:li:|urn%3Ali%3A)(activity|ugcPost|share)(?::|%3A)([0-9]{10,25})/i);
  if (m) return 'urn:li:' + m[1] + ':' + m[2];
  const p = String(s).match(/activity-([0-9]{10,25})/i);
  if (p) return 'urn:li:activity:' + p[1];
  return '';
}

function urnToUrl(urn) {
  if (!urn) return '';
  const m = urn.match(/urn:li:(ugcPost|activity|share):([0-9]+)/);
  if (!m) return '';
  if (m[1] === 'ugcPost') return 'https://www.linkedin.com/posts/' + m[2];
  return 'https://www.linkedin.com/feed/update/' + urn;
}

// ── Tab utilities ─────────────────────────────────────────────────────────────
async function resolveLinkedInTab() {
  const [t] = await chrome.tabs.query({ url: '*://*.linkedin.com/*', active: true });
  if (t) return t.id;
  const [t2] = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  if (t2) return t2.id;
  const t3 = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: true });
  await new Promise(r => setTimeout(r, 5000));
  return t3.id;
}

async function waitForTab(tabId, maxMs = 20000) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, maxMs);
    function fn(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(fn);
      clearTimeout(timer);
      setTimeout(resolve, 2500); // wait for React to paint
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

// ── Core: Scroll & Collect post links from rendered DOM ──────────────────────
async function collectPostsFromTab(tabId, keyword) {
  const urlMap = new Map(); // urn → url

  // Helper: run collector in the page and add results to urlMap
  async function sweep(label) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const found = [];

          // A tags with post URLs
          document.querySelectorAll('a[href]').forEach(a => {
            const h = a.href || '';
            if (h.includes('/feed/update/') || h.includes('/posts/') || h.includes('activity-'))
              found.push(h);
          });

          // Data attributes
          ['data-entity-urn','data-urn','data-activity-urn','data-chameleon-result-urn'].forEach(attr => {
            document.querySelectorAll('[' + attr + ']').forEach(el => {
              const v = el.getAttribute(attr);
              if (v) found.push(v);
            });
          });

          // Raw text scan of body for URN patterns
          const bodyText = document.body.innerHTML;
          const urnRe = /(?:urn:li:|urn%3Ali%3A)(activity|ugcPost|share)(?::|%3A)([0-9]{10,25})/gi;
          let m2; urnRe.lastIndex = 0;
          while ((m2 = urnRe.exec(bodyText)) !== null) {
            found.push('urn:li:' + m2[1] + ':' + m2[2]);
          }

          return found;
        }
      });
      const hrefs = results[0]?.result || [];
      let added = 0;
      hrefs.forEach(h => {
        if (!h) return;
        const decoded = decodeURIComponent(h);
        const urn = extractUrn(decoded) || extractUrn(h);
        if (!urn || urlMap.has(urn)) return;
        const url = urnToUrl(urn);
        if (!url) return;
        urlMap.set(urn, url);
        added++;
      });
      if (added > 0) console.log(`[BG] ${label}: +${added} posts (total=${urlMap.size}) kw=${keyword}`);
    } catch (e) {
      console.warn('[BG] sweep failed:', e.message);
    }
  }

  // Helper: scroll the page using ALL methods to ensure SDUI virtual scroller responds
  async function scrollDown(px) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (px) => {
          // Method 1: window scroll
          window.scrollBy(0, px);

          // Method 2: scrollingElement
          if (document.scrollingElement) document.scrollingElement.scrollTop += px;

          // Method 3: find the element with the most scrollable content
          let best = null;
          document.querySelectorAll('div, section, main, article').forEach(el => {
            if (el.scrollHeight > el.clientHeight + 100) {
              if (!best || el.scrollHeight > best.scrollHeight) best = el;
            }
          });
          if (best) best.scrollTop += px;

          // Method 4: WheelEvent on the lazy column (triggers SDUI virtual scroller)
          const lc = document.querySelector('[data-testid="lazy-column"]') || document.querySelector('main');
          if (lc) {
            lc.dispatchEvent(new WheelEvent('wheel', { deltaY: px, bubbles: true, cancelable: true }));
          }
        },
        args: [px]
      });
    } catch (e) {
      console.warn('[BG] scroll failed:', e.message);
    }
  }

  // Initial collect (page already rendered)
  await new Promise(r => setTimeout(r, 1000));
  await sweep('Initial');

  // Scroll-then-collect loop: 12 steps × ~400px = 4800px total (covers scrollH=3500)
  const STEPS = 12;
  const STEP_PX = 400;
  for (let step = 1; step <= STEPS; step++) {
    if (S.state !== 'RUNNING') break;
    await scrollDown(STEP_PX);
    await new Promise(r => setTimeout(r, 2000)); // wait for SDUI to render new posts
    await sweep(`Step ${step}/${STEPS}`);
  }

  return Array.from(urlMap.entries()).map(([canonicalUrn, url]) => ({
    canonicalUrn, url, source: 'search_only'
  }));
}


// ── DB Push ──────────────────────────────────────────────────────────────────
async function pushToAPI(posts, kw) {
  if (!posts || posts.length === 0) return 0;
  const endpoint = S.dashboardUrl + '/api/extension/results';
  const headers = { 'Content-Type': 'application/json', 'x-extension-token': S.userId };
  const body = JSON.stringify({ posts, keyword: kw, source: 'search_only' });
  try {
    let resp;
    try {
      resp = await fetch(endpoint, { method: 'POST', headers, body });
    } catch (_) {
      await new Promise(r => setTimeout(r, 3000));
      resp = await fetch(endpoint, { method: 'POST', headers, body });
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.warn('[BG] DB push failed HTTP ' + resp.status + ': ' + txt.slice(0, 200));
      return 0;
    }
    const data = await resp.json().catch(() => ({}));
    return (typeof data.createdCount === 'number') ? data.createdCount : posts.length;
  } catch (e) {
    console.warn('[BG] DB push error:', e.message);
    return 0;
  }
}

// ── Keyword Fetch ──────────────────────────────────────────────────────────────
async function fetchKeywords(dashUrl, userId) {
  const resp = await fetch(dashUrl + '/api/extension/jobs', { headers: { 'x-extension-token': userId } });
  if (!resp.ok) throw new Error('Jobs API ' + resp.status);
  const jobs = await resp.json();
  if (!jobs.active) throw new Error(jobs.message || 'System inactive.');
  let kws = [];
  if (jobs.settings?.searchConfigJson) {
    try {
      const cfg = JSON.parse(jobs.settings.searchConfigJson);
      if (Array.isArray(cfg)) kws.push(...cfg.flat().filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()));
    } catch (_) {}
  }
  if (kws.length === 0 && Array.isArray(jobs.keywords)) {
    kws.push(...jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean));
  }
  if (kws.length === 0) throw new Error('No keywords configured.');
  return [...new Set(kws)];
}

// ── Engine Loop ──────────────────────────────────────────────────────────────
async function runEngine() {
  console.log('[BG] RUNNING. keywords=' + JSON.stringify(S.keywords));
  S.tabId = await resolveLinkedInTab();

  while (S.kwIndex < S.keywords.length && S.state === 'RUNNING') {
    const kw = S.keywords[S.kwIndex];
    const targetUrl = 'https://www.linkedin.com/search/results/content/?keywords='
      + encodeURIComponent(kw) + '&origin=GLOBAL_SEARCH_HEADER';

    console.log(`[BG] Navigating to kw=${kw}`);

    try {
      await chrome.tabs.update(S.tabId, { url: targetUrl, active: true });
    } catch (_) {
      S.tabId = await resolveLinkedInTab();
      await chrome.tabs.update(S.tabId, { url: targetUrl, active: true });
    }

    await waitForTab(S.tabId, 20000);

    if (S.state !== 'RUNNING') break;

    const posts = await collectPostsFromTab(S.tabId, kw);
    console.log(`[BG] kw=${kw} found ${posts.length} unique posts`);

    if (posts.length > 0) {
      const saved = await pushToAPI(posts, kw);
      S.totalSaved += saved;
      console.log(`[BG] Saved ${saved}/${posts.length} kw=${kw} total=${S.totalSaved}`);
    } else {
      console.warn(`[BG] kw=${kw} found 0 posts`);
    }

    S.kwIndex++;
    if (S.kwIndex < S.keywords.length && S.state === 'RUNNING') {
      console.log(`[BG] Waiting 5s before next keyword...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  if (S.state === 'RUNNING') {
    console.log('[BG] All keywords done. totalSaved=' + S.totalSaved);
    S.state = 'IDLE';
    broadcastStatus('Done! ' + S.totalSaved + ' posts saved.');
    setBadge(String(S.totalSaved), '#3b82f6');
  }
}

// ── Broadcast / Badge ─────────────────────────────────────────────────────────
function broadcastStatus(msg) {
  chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', message: msg }).catch(() => {});
}
function setBadge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

// ── Messages ─────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'GET_STATUS' || msg.action === 'PING') {
    sendResponse({
      running: S.state === 'RUNNING',
      state: S.state,
      runId: S.runId,
      totalSaved: S.totalSaved,
      keyword: S.keywords[S.kwIndex] || null
    });
  }
  else if (msg.action === 'START_ENGINE' || msg.action === 'START_SESSION') {
    if (S.state === 'RUNNING') { sendResponse({ ok: false, reason: 'already_running' }); return true; }
    S.state = 'RUNNING';
    S.runId = Date.now();
    S.kwIndex = 0;
    S.totalSaved = 0;
    S.dashboardUrl = msg.dashboardUrl || msg.cfg?.dashboardUrl;
    S.userId = msg.userId || msg.cfg?.userId;
    sendResponse({ ok: true });
    (async () => {
      try {
        S.keywords = await fetchKeywords(S.dashboardUrl, S.userId);
        await runEngine();
      } catch (e) {
        console.error('[BG] Engine crash:', e.message);
        S.state = 'IDLE';
        broadcastStatus('Error: ' + e.message);
      }
    })();
  }
  else if (msg.action === 'STOP_ENGINE' || msg.action === 'STOP_SESSION') {
    S.state = 'IDLE';
    broadcastStatus('Stopped.');
    setBadge('', '#6b7280');
    sendResponse({ ok: true });
  }
  else if (msg.action === 'KEEP_ALIVE') { sendResponse({ ok: true }); }
  return true;
});
