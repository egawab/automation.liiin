// interceptor.js — URSS Network Interceptor (MAIN world, document_start)
// Captures LinkedIn API XHR/fetch responses and dispatches to content.js (ISOLATED world).
(function () {
  if (window.__NexoraURSS_Interceptor) return;
  window.__NexoraURSS_Interceptor = true;

  function isTarget(url) {
    if (!url || typeof url !== 'string') return false;
    if (!/linkedin\.com/i.test(url)) return false;
    // Exclude static assets
    if (/\.(js|css|png|jpg|gif|woff2?|svg|ico|webp)(\?|$)/i.test(url)) return false;
    // Exclude analytics/tracking endpoints that won't have post data
    if (url.includes('analytics') || url.includes('tracking') || url.includes('utag') || url.includes('tms')) return false;
    return true; // capture ALL other linkedin.com requests
  }

  const URN_RE = /urn:li:(activity|ugcPost|share):([0-9]{10,25})/g;

  // Extract engagement score from a text window near a URN.
  // Uses regex instead of JSON.parse — resilient to truncated/aborted responses.
  // Returns null (safe-default: keep post) if no engagement fields are found.
  function extractEngagement(text) {
    try {
      let total = 0;
      let found = false;
      const fields = [
        /\"numLikes\"\s*:\s*(\d+)/,
        /\"numComments\"\s*:\s*(\d+)/,
        /\"numShares\"\s*:\s*(\d+)/,
        /\"reactionCount\"\s*:\s*(\d+)/,
        /\"totalSocialActivityCount\"\s*:\s*(\d+)/,
        /\"count\"\s*:\s*(\d+)/,
      ];
      for (const re of fields) {
        const m = text.match(re);
        if (m) { total += parseInt(m[1], 10); found = true; }
      }
      return found ? total : null;
    } catch (_) { return null; }
  }

  function dispatch(url, body) {
    if (!body || body.length < 200) return;
    const fc = body.trimStart()[0];
    if (fc !== '{' && fc !== '[') return;
    // Store as Map(urn → engagementScore|null) — content.js harvests this
    window.__nexoraApiUrns = window.__nexoraApiUrns || new Map();
    URN_RE.lastIndex = 0;
    let m;
    let found = 0;
    while ((m = URN_RE.exec(body)) !== null) {
      const urn = 'urn:li:' + m[1] + ':' + m[2];
      // Extract engagement from the ~3000 chars surrounding this URN
      const nearby = body.slice(Math.max(0, m.index - 200), Math.min(body.length, m.index + 3000));
      const score = extractEngagement(nearby);
      if (!window.__nexoraApiUrns.has(urn)) {
        window.__nexoraApiUrns.set(urn, score);
      } else if (score !== null && window.__nexoraApiUrns.get(urn) === null) {
        // Upgrade null → known score if a later response provides it
        window.__nexoraApiUrns.set(urn, score);
      }
      found++;
    }
    if (found > 0) console.log('[INT] captured ' + found + ' URNs from', url.substring(0, 80));
    try {
      window.dispatchEvent(new CustomEvent('__nexora_net__', { detail: { url, body } }));
    } catch (e) {}
  }

  // XHR hook
  const OrigXHR = window.XMLHttpRequest;
  function NexoraXHR() {
    const xhr = new OrigXHR();
    let _url = '';
    const origOpen = xhr.open.bind(xhr);
    xhr.open = function (m, url) { _url = url || ''; return origOpen.apply(xhr, arguments); };
    const origSend = xhr.send.bind(xhr);
    xhr.send = function () {
      if (isTarget(_url)) {
        xhr.addEventListener('load', function () {
          try { dispatch(_url, xhr.responseText); } catch (e) { console.warn('[INT] XHR dispatch err:', e); }
        });
      }
      return origSend.apply(xhr, arguments);
    };
    return xhr;
  }
  NexoraXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = NexoraXHR;

  // Fetch hook
  const origFetch = window.fetch;
  window.fetch = async function (resource, init) {
    const resp = await origFetch(resource, init);
    try {
      const url = typeof resource === 'string' ? resource
        : (resource instanceof Request ? resource.url : '');
      if (isTarget(url)) {
          resp.clone().text()
            .then(body => dispatch(url, body))
            .catch(e => {
              // AbortError / TypeError are expected — LinkedIn cancels in-flight
              // requests during scroll. Do not log these as they create noise.
              if (e?.name !== 'AbortError' && e?.name !== 'TypeError') {
                console.warn('[INT] fetch text err:', e?.name, e?.message);
              }
            });
        }
    } catch (e) { console.warn('[INT] fetch hook err:', e); }
    return resp;
  };

  console.log('[INT] URSS Interceptor v7.1 active (MAIN world) on', location.href);
})();
