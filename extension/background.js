// Nexora background.js — URSS v7 (Unified Reconciliation Scraping System)
// 3-layer: DOM Collector | Network Interceptor | Scroll Engine
// Buffer Layer: S.buffer only. S.store: final output, written ONLY by reconcile().
console.log("[BG] Nexora URSS v7 loaded");

const LOG = [];
function log(level, mod, msg, data) {
  const e = { ts: Date.now(), level, mod, msg, data };
  LOG.push(e); if (LOG.length > 300) LOG.shift();
  console[level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log"](`[${mod}] ${msg}`, data || "");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Session State ─────────────────────────────────────────────────────────────
const S = {
  state: "IDLE", tabId: null, attached: false,
  dashboardUrl: "", userId: "",
  kwQueue: null,
  buffer: { dom: [], network: [] },  // ONLY staging area — no direct store writes
  store: new Map(),                   // ONLY written by reconcile()
  totalSaved: 0,
  flushedUrns: new Set(),
  sessionId: null,
  scrollRunning: false,          // lock: prevents duplicate scroll loops
  lastNetworkActivity: 0,        // timestamp of last network event (for idle detection)
};

function setState(next) {
  log("INFO", "FSM", S.state + " -> " + next);
  S.state = next;
  broadcastStatus();
}

class KeywordQueue {
  constructor(kws) { this._q = [...kws]; this._done = []; this.current = null; }
  advance() { if (this.current) this._done.push(this.current); this.current = this._q.shift() || null; return this.current; }
  hasMore() { return this._q.length > 0; }
  status() { return { current: this.current, remaining: this._q.length, done: this._done.length }; }
}

// ── Keep-alive ────────────────────────────────────────────────────────────────
chrome.alarms.create("nexora_heartbeat", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "nexora_heartbeat") return;
  if (S.state !== "IDLE" && S.state !== "DONE")
    log("INFO", "HB", "state=" + S.state + " saved=" + S.totalSaved);
});

// ── Port channel ──────────────────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "nexora_cmd") return;
  port.onMessage.addListener(async (msg) => {
    if (msg.action === "START") {
      if (S.state !== "IDLE" && S.state !== "DONE") await stopSession();
      try { await startSession(msg, port); }
      catch (e) { safePortMsg(port, { type: "ERROR", error: e.message }); broadcast("EXTENSION_LIVE_STATUS", { text: "ERR: " + e.message }); }
    } else if (msg.action === "STOP") {
      await stopSession(); safePortMsg(port, { type: "ACK_STOP" });
    } else if (msg.action === "GET_STATUS") {
      safePortMsg(port, { type: "STATUS", state: S.state, saved: S.totalSaved, kw: S.kwQueue?.current });
    }
  });
  port.onDisconnect.addListener(() => log("INFO", "PORT", "disconnected"));
});

function safePortMsg(port, msg) { if (!port) return; try { port.postMessage(msg); } catch (_) {} }
function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(label + " timed out")), ms))]);
}

// ── Message channel ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "START_ENGINE") {
    (async () => {
      try { if (S.state !== "IDLE" && S.state !== "DONE") await stopSession(); await startSession(msg, null); }
      catch (e) { log("ERROR", "MSG", "START_ENGINE: " + e.message); broadcast("EXTENSION_LIVE_STATUS", { text: "ERR: " + e.message }); }
    })();
    sendResponse({ ok: true }); return false;
  }
  if (msg.action === "STOP_ENGINE") { stopSession().finally(() => sendResponse({ ok: true })); return true; }
  if (msg.action === "NET_BODY") {
    log("INFO", "NET", "[BG] network message received url=" + (msg.url || "").substring(0, 60) + " len=" + (msg.body || "").length);
    ingestBody(msg.body);
    S.lastNetworkActivity = Date.now();
    log("INFO", "NET", "[BG] network buffered buffer.network.length=" + S.buffer.network.length);
    sendResponse({ ok: true }); return false;
  }
  if (msg.action === "KEEP_ALIVE") { sendResponse({ ok: true }); return false; }
  if (msg.action === "SCROLL_STEP") { sendResponse({ ok: true }); return false; }
  if (msg.action === "SCROLL_COMPLETE") { log("INFO", "MSG", "SCROLL_COMPLETE (content.js)"); sendResponse({ ok: true }); return false; }
  if (msg.action === "GET_STATUS") {
    sendResponse({ running: ["SCRAPING","NAVIGATING","FLUSHING"].includes(S.state), state: S.state, totalSaved: S.totalSaved, keyword: S.kwQueue?.current });
    return false;
  }
});

// CDP network fallback
chrome.debugger.onEvent.addListener(async (src, method, params) => {
  if (src.tabId !== S.tabId || S.state !== "SCRAPING") return;
  if (method === "Network.loadingFinished") {
    try {
      const r = await chrome.debugger.sendCommand({ tabId: S.tabId }, "Network.getResponseBody", { requestId: params.requestId });
      const body = r.base64Encoded ? atob(r.body) : (r.body || "");
      if (body.length > 200) ingestBody(body);
    } catch (_) {}
  }
});

// ── Session ───────────────────────────────────────────────────────────────────
async function startSession(msg, port) {
  setState("INITIALIZING");
  S.sessionId = Math.random().toString(36).slice(2);
  S.totalSaved = 0; S.store.clear();
  S.buffer = { dom: [], network: [] };
  S.flushedUrns = new Set();

  const cfg = await chrome.storage.sync.get(["dashboardUrl", "userId"]);
  S.dashboardUrl = msg.dashboardUrl || cfg.dashboardUrl || "";
  S.userId = msg.userId || cfg.userId || "";
  if (!S.dashboardUrl || !S.userId) throw new Error("Not configured — set Dashboard URL and User ID first.");

  const kws = await fetchKeywords(S.dashboardUrl, S.userId);
  S.kwQueue = new KeywordQueue(kws);
  S.kwQueue.advance();
  if (!S.kwQueue.current) throw new Error("No keywords configured in dashboard.");

  log("INFO", "SESSION", "Starting", { keywords: kws, sessionId: S.sessionId });
  safePortMsg(port, { type: "ACK_START", keyword: S.kwQueue.current });
  S.tabId = await resolveLinkedInTab();
  runKeyword().catch(e => log("ERROR", "SESSION", "runKeyword crashed: " + e.message));
}

async function stopSession() {
  log("WARN", "SESSION", "Stopping", { state: S.state });
  await safeDetach();
  S.buffer = { dom: [], network: [] };
  setState("IDLE");
}

// ── CDP Helpers ───────────────────────────────────────────────────────────────
async function cdpExec(expr) {
  if (!S.attached || !S.tabId) return null;
  try {
    const r = await chrome.debugger.sendCommand({ tabId: S.tabId }, "Runtime.evaluate",
      { expression: expr, returnByValue: true, awaitPromise: false, timeout: 8000 });
    if (r && r.result && r.result.value !== undefined) return r.result.value;
    return null;
  } catch (_) { return null; }
}

const FIND_SCROLL_EL = `(function(){
  var cs=[document.querySelector('.scaffold-layout__main'),document.querySelector('.scaffold-layout-container__main'),document.querySelector('main'),document.scrollingElement,document.documentElement];
  for(var i=0;i<cs.length;i++){var el=cs[i];if(el&&el.scrollHeight>el.clientHeight+100){return JSON.stringify({sh:el.scrollHeight,ch:el.clientHeight,st:el.scrollTop,sel:el.tagName});}}
  return JSON.stringify({sh:document.body.scrollHeight,ch:window.innerHeight,st:window.scrollY,sel:'body'});
})()`;

const DO_SCROLL = `(function(){
  try{if(document.activeElement&&document.activeElement!==document.body)document.activeElement.blur();}catch(e){}
  var cs=[document.querySelector('.scaffold-layout__main'),document.querySelector('.scaffold-layout-container__main'),document.querySelector('main'),document.scrollingElement,document.documentElement];
  for(var i=0;i<cs.length;i++){var el=cs[i];if(el&&el.scrollHeight>el.clientHeight+100){el.scrollTop+=Math.floor(el.clientHeight*0.85);el.dispatchEvent(new Event('scroll',{bubbles:true}));window.dispatchEvent(new Event('scroll',{bubbles:true}));return el.scrollTop;}}
  window.scrollBy(0,Math.floor(window.innerHeight*0.85));return window.scrollY;
})()`;

const CLICK_NEXT = `(function(){
  var ss=['.artdeco-pagination__button--next','button[aria-label="Next"]','button[aria-label="Go to next page"]'];
  for(var i=0;i<ss.length;i++){var b=document.querySelector(ss[i]);if(b&&!b.disabled){b.click();return true;}}
  var m=Array.from(document.querySelectorAll('button,[role="button"]')).find(function(b){return /show more|load more|see more/i.test(b.innerText||'');});
  if(m&&!m.disabled){m.click();return true;}return false;
})()`;

async function waitForPageReady(maxMs) {
  maxMs = maxMs || 14000;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const raw = await cdpExec(FIND_SCROLL_EL);
    const rs = await cdpExec("document.readyState");
    if (raw) { try { const m = JSON.parse(raw); if (rs === "complete" && m.sh > m.ch * 1.3) { log("INFO","READY","sh="+m.sh); return m; } } catch(_){} }
    await sleep(600);
  }
  log("WARN", "READY", "Timeout title=" + await cdpExec("document.title"));
  return null;
}

// ── LAYER 1: DOM Collector — writes ONLY to S.buffer.dom ─────────────────────
// Uses backtick template literal to safely embed inner JS with double-quotes.
const DOM_COLLECTOR = `(function(){
  var records=[],seen={};
  function norm(s){return String(s||"").replace(/[\u0660-\u0669]/g,function(c){return c.charCodeAt(0)-0x660;}).replace(/[\u06F0-\u06F9]/g,function(c){return c.charCodeAt(0)-0x6F0;});}
  function pe(s){if(!s)return 0;var x=norm(s).toUpperCase().replace(/,/g,"");var n=parseFloat((x.match(/[0-9]+\\.?[0-9]*/)||[])[0]);if(isNaN(n))return 0;if(x.indexOf("K")>-1)n*=1000;if(x.indexOf("M")>-1)n*=1000000;return Math.floor(n);}
  function xUrn(s){if(!s)return "";var m=String(s).match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);if(m)return "urn:li:"+m[1]+":"+m[2];var p=String(s).match(/activity-([0-9]{10,25})/i);if(p)return "urn:li:activity:"+p[1];return "";}
  function stableKey(a,t){return encodeURIComponent((a||"").toLowerCase().trim())+"::"+((t||"").substring(0,80).toLowerCase().replace(/\\s+/g,"_"));}
  function getEng(el){var lk=0,cm=0;
    try{Array.from(el.querySelectorAll("span,div,li,a")).forEach(function(x){if(x.children.length>5)return;var n=norm((x.innerText||"").trim());var r=n.match(/([0-9][0-9,.]*[KkMm]?)\\s*(reaction|like|reacted)/i);if(r)lk=Math.max(lk,pe(r[1]));var c2=n.match(/([0-9][0-9,.]*[KkMm]?)\\s*(comment)/i);if(c2)cm=Math.max(cm,pe(c2[1]));});}catch(e){}
    try{Array.from(el.querySelectorAll("[aria-label]")).forEach(function(x){var a=norm(x.getAttribute("aria-label")||"");if(/[0-9]/.test(a)&&/(reaction|like|reacted)/i.test(a))lk=Math.max(lk,pe(a));if(/[0-9]/.test(a)&&/(comment)/i.test(a))cm=Math.max(cm,pe(a));});}catch(e){}
    try{Array.from(el.querySelectorAll("button")).forEach(function(b){var t=norm((b.innerText||"").trim());if(/[0-9]/.test(t)&&/(like|reaction)/i.test(t))lk=Math.max(lk,pe(t));if(/[0-9]/.test(t)&&/(comment)/i.test(t))cm=Math.max(cm,pe(t));});}catch(e){}
    try{var sdc=el.querySelector(".social-details-social-counts,.update-components-social-counts");if(sdc){var nums=[];Array.from(sdc.querySelectorAll("span,button,li")).forEach(function(x){var t=norm((x.innerText||"").trim().replace(/,/g,""));if(/^[0-9]{1,8}$/.test(t)){var n=parseInt(t,10);if(n>0&&nums.indexOf(n)<0)nums.push(n);}});if(nums[0])lk=Math.max(lk,nums[0]);if(nums[1])cm=Math.max(cm,nums[1]);}}catch(e){}
    return {likes:lk,comments:cm};}
  function getText(el){var txt="";var skip=/^(Pause|Skip Forward|Skip Backward|Unmute|Current Time|Duration)/i;
    var ss=[".update-components-text",".feed-shared-update-v2__description",".attributed-text-segment-list__content",".break-words",".feed-shared-text"];
    ss.forEach(function(s){try{Array.from(el.querySelectorAll(s)).forEach(function(d){var t=(d.innerText||"").trim();if(t.length>txt.length&&!skip.test(t))txt=t;});}catch(e){}});
    try{Array.from(el.querySelectorAll("[dir]")).forEach(function(d){var t=(d.innerText||"").trim();if(t.length>txt.length&&!skip.test(t))txt=t;});}catch(e){}
    if(txt.length<20){var raw=(el.innerText||"").replace(/\\s+/g," ").trim();if(!skip.test(raw))txt=raw.substring(0,3000);}return txt;}
  function getAuthor(el){var a=el.querySelector('a[href*="/in/"],a[href*="/company/"]');if(!a)return "Unknown";
    var aria=a.getAttribute("aria-label")||"";
    if(aria){
      var cl=aria
        .replace(/^[Vv]iew\s+(?:company:\s*)?/i,"")
        .replace(/\s*[''\u2019\u2018\u02BC]s\s.*/i,"")
        .replace(/\s*(profile|page|company)\s*$/i,"")
        .replace(/\s+(Verified|Top Voice|\d.*)$/i,"")
        .trim();
      if(cl&&cl.length>1&&!/^(Unknown|View)$/i.test(cl))return cl.substring(0,100);
    }
    var name=(a.innerText||"").trim().split("\n")[0].replace(/^[Vv]iew\s+/i,"").replace(/\s*(profile|page)\s*$/i,"").trim().substring(0,100);if(name.length>1)return name;
    var img=a.querySelector("img[alt]");if(img)return(img.getAttribute("alt")||"").trim().substring(0,100);return "Unknown";}
  function addRec(urn,el,href){if(!el)return;var key=urn||"";if(key&&seen[key])return;if(key)seen[key]=1;
    var eng=getEng(el);var txt=getText(el);var auth=getAuthor(el);
    if(!urn&&auth&&txt){key="STABLE::"+stableKey(auth,txt);if(seen[key])return;seen[key]=1;}
    if(!key)return;
    records.push({urn:urn||null,stableKey:key,url:href||(urn?"https://www.linkedin.com/feed/update/"+urn:""),text:txt.substring(0,3000),author:auth,likes:eng.likes,comments:eng.comments,source:"dom"});}
  function walkCard(el,urn,href){var c=el,fh=null,li=null;for(var i=0;i<35;i++){c=c.parentElement;if(!c||c===document.body)break;var l=(c.innerText||"").trim().length;if(l>20&&l<25000){if(!fh)fh=c;if(c.tagName==="LI"){li=c;break;}}if(l>=25000)break;}addRec(urn,li||fh,href||"");}
  try{Array.from(document.querySelectorAll("a[href]")).filter(function(a){return a.href&&(a.href.indexOf("feed/update/urn:li:")>-1||a.href.indexOf("/posts/")>-1);}).forEach(function(lnk){var urn=xUrn(lnk.href);if(!urn||seen[urn])return;walkCard(lnk,urn,lnk.href);});}catch(e){}
  try{["data-urn","data-activity-urn","data-chameleon-result-urn","data-entity-urn","data-id"].forEach(function(attr){Array.from(document.querySelectorAll("["+attr+"]")).forEach(function(el){var urn=xUrn(el.getAttribute(attr)||"");if(!urn||seen[urn])return;walkCard(el,urn,"");});});}catch(e){}
  try{var allH=document.body.innerHTML;var urx=/urn:li:(activity|ugcPost|share):([0-9]{10,25})/g;var m4,uq=[];while((m4=urx.exec(allH))!==null){var u="urn:li:"+m4[1]+":"+m4[2];if(!seen[u]&&uq.indexOf(u)<0)uq.push(u);}uq.forEach(function(urn){if(seen[urn])return;var aid=urn.split(":").pop();var el=document.querySelector("[data-urn*=':"+aid+"'],[data-entity-urn*=':"+aid+"'],[href*='activity-"+aid+"']");if(el)walkCard(el,urn,"");});}catch(e){}
  return JSON.stringify({records:records,count:records.length});
})()`;

async function collectDOM() {
  if (!S.attached || !S.tabId || S.state !== "SCRAPING") return;
  try {
    const r = await chrome.debugger.sendCommand({ tabId: S.tabId }, "Runtime.evaluate",
      { expression: DOM_COLLECTOR, returnByValue: true, timeout: 12000 });
    if (!r?.result?.value) return;
    const parsed = JSON.parse(r.result.value);
    const recs = parsed.records || [];
    for (const rec of recs) S.buffer.dom.push(rec);  // ONLY writes to buffer.dom
    log("INFO", "DOM", "Collected " + recs.length + " records (buffer.dom=" + S.buffer.dom.length + ")");
    broadcast("EXTENSION_LIVE_STATUS", { text: "DOM:" + recs.length + " Net:" + S.buffer.network.length });
  } catch (e) { log("WARN", "DOM", "collectDOM error: " + e.message); }
}

// ── LAYER 1: Network Ingestor — writes ONLY to S.buffer.network ───────────────
function ingestBody(body) {
  if (!body) return;
  const fc = body.trimStart()[0];
  if (fc !== "{" && fc !== "[") return;
  let json; try { json = JSON.parse(body); } catch (_) { return; }
  function pe(s) {
    if (s == null) return null;
    const x = String(s).toUpperCase().replace(/,/g, "");
    const n = parseFloat((x.match(/[0-9.]+/) || [])[0]);
    if (isNaN(n)) return null;
    if (x.includes("K")) return Math.floor(n * 1000);
    if (x.includes("M")) return Math.floor(n * 1000000);
    return Math.floor(n);
  }
  function walk(obj) {
    if (!obj || typeof obj !== "object") return;
    const rawUrn = String(obj.entityUrn || obj.updateUrn || obj.urn || "");
    const m = rawUrn.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
    if (m) {
      const urn = "urn:li:" + m[1] + ":" + m[2];
      const txt = typeof obj.commentary?.text?.text === "string" ? obj.commentary.text.text :
                  typeof obj.commentary?.text === "string" ? obj.commentary.text :
                  typeof obj.text === "string" ? obj.text :
                  typeof obj.summary === "string" ? obj.summary : "";
      const auth = String(obj.actor?.name?.text || obj.actor?.nameV2?.text || obj.actor?.fullName || "");
      const soc = obj.socialDetail || obj.totalSocialActivityCounts || {};
      const lk = pe(soc.numLikes != null ? soc.numLikes : obj.numLikes != null ? obj.numLikes : null);
      const cm = pe(soc.numComments != null ? soc.numComments : obj.numComments != null ? obj.numComments : null);
      S.buffer.network.push({ urn, text: txt.substring(0, 5000), author: auth.substring(0, 100), likes: lk, comments: cm, source: "network" });
    }
    if (Array.isArray(obj)) { for (const item of obj) walk(item); }
    else { for (const k of Object.keys(obj)) { if (typeof obj[k] === "object" && k !== "paging") walk(obj[k]); } }
  }
  walk(json);
}

// ── Reconciliation Engine — ONLY writer to S.store ────────────────────────────
function reconcile() {
  log("INFO", "RECONCILE", "Start dom=" + S.buffer.dom.length + " network=" + S.buffer.network.length);
  if (S.buffer.network.length === 0) {
    log("WARN", "RECONCILE", "[WARN] Network layer inactive — running DOM-only fallback. Check: interceptor.js loaded in MAIN world? content.js __nexora_net__ listener registered?");
    broadcast("EXTENSION_LIVE_STATUS", { text: "⚠️ Network inactive — DOM-only mode" });
  }
  const netByUrn = new Map();
  for (const rec of S.buffer.network) {
    if (!rec.urn) continue;
    const ex = netByUrn.get(rec.urn);
    if (!ex) { netByUrn.set(rec.urn, { ...rec }); continue; }
    if (rec.likes !== null && (ex.likes === null || rec.likes > ex.likes)) ex.likes = rec.likes;
    if (rec.comments !== null && (ex.comments === null || rec.comments > ex.comments)) ex.comments = rec.comments;
    if (rec.text && rec.text.length > ex.text.length) ex.text = rec.text;
    if (rec.author && rec.author.length > 1 && ex.author.length < 2) ex.author = rec.author;
  }
  const domByUrn = new Map();
  const domByStable = new Map();
  for (const rec of S.buffer.dom) {
    if (rec.urn) {
      const ex = domByUrn.get(rec.urn);
      if (!ex) { domByUrn.set(rec.urn, { ...rec }); continue; }
      if (rec.likes > (ex.likes || 0)) ex.likes = rec.likes;
      if (rec.comments > (ex.comments || 0)) ex.comments = rec.comments;
      if (rec.text && rec.text.length > ex.text.length) ex.text = rec.text;
      if (rec.author && rec.author !== "Unknown" && ex.author === "Unknown") ex.author = rec.author;
    } else if (rec.stableKey) {
      const ex = domByStable.get(rec.stableKey);
      if (!ex) { domByStable.set(rec.stableKey, { ...rec }); continue; }
      if (rec.likes > (ex.likes || 0)) ex.likes = rec.likes;
      if (rec.comments > (ex.comments || 0)) ex.comments = rec.comments;
      if (rec.text && rec.text.length > ex.text.length) ex.text = rec.text;
    }
  }
  const allUrns = new Set([...netByUrn.keys(), ...domByUrn.keys()]);
  for (const urn of allUrns) {
    const net = netByUrn.get(urn); const dom = domByUrn.get(urn);
    let likes = (S.store.get(urn)?.likes) || 0;
    let comments = (S.store.get(urn)?.comments) || 0;
    if (dom) { if (dom.likes > likes) likes = dom.likes; if (dom.comments > comments) comments = dom.comments; }
    if (net) {
      if (net.likes !== null && net.likes >= 0) likes = Math.max(likes, net.likes);
      if (net.comments !== null && net.comments >= 0) comments = Math.max(comments, net.comments);
    }
    const texts = [dom?.text || "", net?.text || "", S.store.get(urn)?.postText || ""];
    const postText = texts.reduce((a, b) => b.length > a.length ? b : a, "");
    let author = S.store.get(urn)?.author || "Unknown";
    if (dom?.author && dom.author !== "Unknown") author = dom.author;
    if (net?.author && net.author.length > 1) author = net.author;
    const url = S.store.get(urn)?.url || dom?.url || ("https://www.linkedin.com/feed/update/" + urn);
    S.store.set(urn, { canonicalUrn: urn, url, postText: postText.substring(0, 3000), preview: postText.substring(0, 3000), author, likes: likes > 0 ? likes : null, comments: comments > 0 ? comments : null, source: net ? "network+dom" : "dom" });
  }
  for (const [stableKey, rec] of domByStable) {
    if (S.store.has(stableKey)) continue;
    S.store.set(stableKey, { canonicalUrn: null, stableKey, url: rec.url || "", postText: (rec.text || "").substring(0, 3000), preview: (rec.text || "").substring(0, 3000), author: rec.author || "Unknown", likes: rec.likes > 0 ? rec.likes : null, comments: rec.comments > 0 ? rec.comments : null, source: "dom-stable" });
  }
  log("INFO", "RECONCILE", "Done S.store=" + S.store.size);
  S.buffer = { dom: [], network: [] };
}

// ── Scroll Engine — navigation only ──────────────────────────────────────────
async function cdpScrollEngine(kw) {
  // Scroll lock: prevent duplicate concurrent scroll loops
  if (S.scrollRunning) {
    log("WARN", "SCROLL", "cdpScrollEngine called but scroll already running — ignoring duplicate");
    return "duplicate_ignored";
  }
  S.scrollRunning = true;
  const MAX_STEPS = 55, MIN_STEPS = 6, NO_PROG_MAX = 8;
  let step = 0, noProgress = 0, lastSt = -1, scrolledAtAll = false, stopReason = "max_steps";
  try {
    await waitForPageReady(14000);
    broadcast("EXTENSION_LIVE_STATUS", { text: "Scrolling: " + kw });
    const initRaw = await cdpExec(FIND_SCROLL_EL);
    let initM = null; try { if (initRaw) initM = JSON.parse(initRaw); } catch (_) {}
    if (initM) log("INFO", "SCROLL", "Container sh=" + initM.sh + " ch=" + initM.ch);
    if (initM && initM.sh < initM.ch * 1.2) { broadcast("EXTENSION_LIVE_STATUS", { text: "Skip: no content" }); return "empty_page"; }
    while (step < MAX_STEPS && S.state === "SCRAPING" && S.tabId) {
      step++;
      await cdpExec(DO_SCROLL);
      await sleep(2600 + Math.floor(Math.random() * 1200));
      const raw = await cdpExec(FIND_SCROLL_EL);
      let m = { sh: 0, ch: 900, st: 0 }; try { if (raw) m = JSON.parse(raw); } catch (_) {}
      if (!S.tabId || (m.sh === 0 && step > 1)) { stopReason = "tab_removed"; break; }
      const st = Math.round(m.st);
      if (Math.abs(st - lastSt) > 60) { scrolledAtAll = true; noProgress = 0; lastSt = st; } else { noProgress++; }
      log("INFO", "SCROLL", "step=" + step + " st=" + st + " noProg=" + noProgress + " net=" + S.buffer.network.length);
      broadcast("EXTENSION_LIVE_STATUS", { text: "DOM:" + S.buffer.dom.length + " Net:" + S.buffer.network.length + " | step " + step + "/" + MAX_STEPS });
      await collectDOM();
      const atBottom = m.sh > m.ch * 1.3 && (m.ch + st) >= m.sh - 600;
      if (step >= MIN_STEPS && (noProgress >= NO_PROG_MAX || atBottom)) {
        const clicked = await cdpExec(CLICK_NEXT);
        if (clicked) { noProgress = 0; await sleep(4500); continue; }
        stopReason = atBottom ? "reached_bottom" : "no_scroll_progress"; break;
      }
    }
    if (step >= MAX_STEPS) stopReason = "max_steps";
    log("INFO", "SCROLL", "DONE steps=" + step + " scrolled=" + scrolledAtAll + " reason=" + stopReason);
    broadcast("EXTENSION_LIVE_STATUS", { text: "Scroll done: " + stopReason });
  } finally {
    S.scrollRunning = false; // always release lock
  }
  return stopReason;
}

async function runKeyword() {
  const kw = S.kwQueue.current;
  if (!kw) { finalizeSession(); return; }
  log("INFO", "KW", "Starting: " + kw);
  const url = "https://www.linkedin.com/search/results/content/?keywords=" + encodeURIComponent(kw) + "&origin=GLOBAL_SEARCH_HEADER";
  setState("NAVIGATING");
  await chrome.tabs.update(S.tabId, { url, active: true });
  await waitForTabLoad(S.tabId);
  setState("ATTACHING");
  let tabInfo = null;
  try { tabInfo = await withTimeout(chrome.tabs.get(S.tabId), 3000, "tabs.get"); } catch (ex) {}
  if (tabInfo) {
    const tabUrl = tabInfo.url || "";
    if (tabUrl.length > 0 && !tabUrl.includes("linkedin.com") && !tabUrl.startsWith("about:") && !tabUrl.startsWith("chrome")) {
      log("WARN", "TAB", "Not on LinkedIn"); finalizeKeyword().catch(ex => log("ERROR", "KW", ex.message)); return;
    }
  }
  if (!S.attached) {
    try { await withTimeout(chrome.debugger.attach({ tabId: S.tabId }, "1.3"), 6000, "debugger.attach"); S.attached = true; }
    catch (ex) { const em = ex.message || ""; if (em.includes("already") || em.includes("Another")) S.attached = true; else log("WARN", "CDP", "Attach: " + em); }
  }
  if (S.attached) { try { await withTimeout(chrome.debugger.sendCommand({ tabId: S.tabId }, "Runtime.enable"), 4000, "Runtime.enable"); } catch (ex) {} }
  chrome.scripting.executeScript({ target: { tabId: S.tabId }, files: ["content.js"] }).then(() => log("INFO", "INJECT", "content.js injected")).catch(ex => log("WARN", "INJECT", ex.message));
  await sleep(300);
  setState("SCRAPING");
  S.buffer = { dom: [], network: [] };
  await cdpScrollEngine(kw);
  if (S.state === "SCRAPING") finalizeKeyword().catch(e => log("ERROR", "KW", e.message));
}

async function finalizeKeyword() {
  setState("FLUSHING");
  // Network idle detection: wait until no new network events for IDLE_MS, max MAX_WAIT_MS
  const IDLE_MS = 1500, MAX_WAIT_MS = 8000;
  const waitStart = Date.now();
  S.lastNetworkActivity = S.lastNetworkActivity || 0;
  log("INFO", "RECONCILE", "Waiting for network idle (idle=" + IDLE_MS + "ms max=" + MAX_WAIT_MS + "ms)...");
  while (Date.now() - waitStart < MAX_WAIT_MS) {
    await sleep(300);
    const idleFor = Date.now() - S.lastNetworkActivity;
    if (S.lastNetworkActivity > 0 && idleFor >= IDLE_MS) {
      log("INFO", "RECONCILE", "Network idle for " + idleFor + "ms — proceeding");
      break;
    }
    if (S.lastNetworkActivity === 0 && (Date.now() - waitStart) > 2000) {
      log("WARN", "RECONCILE", "No network activity detected at all after 2s — proceeding with DOM-only");
      break;
    }
  }
  log("INFO", "RECONCILE", "Stabilization complete. dom=" + S.buffer.dom.length + " network=" + S.buffer.network.length);
  reconcile();
  await flushAll();
  log("INFO", "KW", "Complete", S.kwQueue.status());
  if (S.kwQueue.hasMore()) { S.kwQueue.advance(); await sleep(4000); setState("NAVIGATING"); await runKeyword(); }
  else finalizeSession();
}

function finalizeSession() {
  setState("DONE");
  log("INFO", "SESSION", "All done", { totalSaved: S.totalSaved });
  broadcast("SCRAPER_COMPLETE", { totalSaved: S.totalSaved });
  broadcast("EXTENSION_LIVE_STATUS", { text: "Done! " + S.totalSaved + " posts saved." });
  safeDetach(); setState("IDLE");
}

async function flushAll() {
  log("INFO", "FLUSH", "start store=" + S.store.size);
  const toFlush = [];
  for (const [key, post] of S.store) { if (!S.flushedUrns.has(key)) toFlush.push({ ...post }); }
  if (!toFlush.length) { log("INFO", "FLUSH", "Nothing new"); return; }
  await flushBatch(toFlush);
}

async function flushBatch(chunk) {
  if (!chunk || !chunk.length) return;
  try { await pushToAPI(chunk); }
  catch (e) {
    for (let i = 1; i <= 3; i++) {
      await sleep(i * 2000);
      try { await pushToAPI(chunk); log("INFO", "FLUSH", "Retry " + i + " OK"); return; }
      catch (e2) { log("WARN", "FLUSH", "Retry " + i + " failed: " + e2.message); }
    }
  }
}

async function pushToAPI(posts) {
  if (!posts.length) return;
  const endpoint = S.dashboardUrl + "/api/extension/results";
  const sample = posts.slice(0, 3).map(p => ({ urn: p.canonicalUrn, author: p.author, likes: p.likes, comments: p.comments, textLen: (p.postText || "").length }));
  log("INFO", "API", "POST " + posts.length + ". Sample: " + JSON.stringify(sample));
  let resp;
  try { resp = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-extension-token": S.userId }, body: JSON.stringify({ posts, keyword: S.kwQueue?.current || "", source: "nexora_urss_v7" }) }); }
  catch (netErr) { throw netErr; }
  if (!resp.ok) { const errBody = await resp.text().catch(() => "(no body)"); throw new Error("HTTP " + resp.status + ": " + errBody.substring(0, 300)); }
  const data = await resp.json().catch(() => ({}));
  const created = data.createdCount ?? data.savedCount ?? posts.length;
  S.totalSaved += created;
  for (const p of posts) { const key = p.canonicalUrn || p.stableKey; if (key) S.flushedUrns.add(key); }
  log("INFO", "FLUSH", "Saved " + created + "/" + posts.length + " total=" + S.totalSaved);
  if (data.createdUrns?.length) data.createdUrns.forEach(u => log("INFO", "DB_NEW", u));
  broadcast("EXTENSION_LIVE_STATUS", { text: "Saved " + S.totalSaved + " posts" });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== S.tabId) return;
  if (S.state === "IDLE" || S.state === "DONE") return;
  S.attached = false; S.tabId = null;
  reconcile(); flushAll().finally(() => setState("IDLE"));
});

chrome.debugger.onDetach.addListener((src, reason) => {
  if (src.tabId !== S.tabId) return;
  log("WARN", "CDP", "Detached: " + reason); S.attached = false;
});

async function safeDetach() {
  if (!S.attached || !S.tabId) return;
  try { await chrome.debugger.detach({ tabId: S.tabId }); } catch (_) {}
  S.attached = false;
}

async function resolveLinkedInTab() {
  const wins = await chrome.windows.getAll({ populate: false });
  const fwId = wins.find(w => w.focused)?.id;
  if (fwId) { const [t] = await chrome.tabs.query({ active: true, windowId: fwId, url: "*://*.linkedin.com/*" }); if (t) return t.id; }
  const [t2] = await chrome.tabs.query({ active: true, url: "*://*.linkedin.com/*" }); if (t2) return t2.id;
  const [t3] = await chrome.tabs.query({ url: "*://*.linkedin.com/*" }); if (t3) return t3.id;
  const t4 = await chrome.tabs.create({ url: "https://www.linkedin.com/feed/", active: true });
  await waitForTabLoad(t4.id, 15000); return t4.id;
}

function waitForTabLoad(tabId, maxMs = 25000) {
  return new Promise(resolve => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, maxMs);
    function fn(id, info) {
      if (id !== tabId || info.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(fn); clearTimeout(t); setTimeout(resolve, 5000);
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

async function fetchKeywords(dashUrl, userId) {
  const resp = await fetch(dashUrl + "/api/extension/jobs", { headers: { "x-extension-token": userId } });
  if (!resp.ok) throw new Error("Jobs API " + resp.status);
  const jobs = await resp.json();
  if (!jobs.active) throw new Error(jobs.message || "System inactive.");
  let kws = [];
  if (jobs.settings?.searchConfigJson) {
    try { const cfg = JSON.parse(jobs.settings.searchConfigJson); if (Array.isArray(cfg)) kws.push(...cfg.flat().filter(k => typeof k === "string" && k.trim()).map(k => k.trim())); } catch (_) {}
  }
  const searchOnly = jobs.settings?.searchOnlyMode !== false;
  if (!searchOnly || kws.length === 0) {
    if (Array.isArray(jobs.keywords)) kws.push(...jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean));
  }
  if (kws.length === 0) throw new Error("No keywords configured.");
  return [...new Set(kws)];
}

function broadcast(action, data = {}) {
  if (action === "EXTENSION_LIVE_STATUS") {
    chrome.action.setBadgeText({ text: S.totalSaved > 0 ? String(S.totalSaved) : "ON" }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: "#10b981" }).catch(() => {});
  }
  if (action === "SCRAPER_COMPLETE") {
    chrome.action.setBadgeText({ text: S.totalSaved + "OK" }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" }).catch(() => {});
  }
  if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) chrome.runtime.sendMessage({ action, ...data }).catch(() => {});
}

function broadcastStatus() { broadcast("EXTENSION_LIVE_STATUS", { text: "State: " + S.state }); }
