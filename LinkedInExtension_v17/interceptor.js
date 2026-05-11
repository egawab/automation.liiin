// interceptor.js — injected at document_start in MAIN world
// Hooks XHR + fetch BEFORE LinkedIn makes any requests
// Also scans embedded <script> JSON at load time
(function () {
  if (window.__NexoraInterceptorActive) return;
  window.__NexoraInterceptorActive = true;

  // ── Dispatch to content.js (ISOLATED world) ──────────────────
  function dispatch(url, body) {
    try {
      window.dispatchEvent(new CustomEvent('__nexora_net__', {
        detail: { url: url || '', body }
      }));
    } catch (_) {}
  }

  // ── Filter: capture ANY LinkedIn API response that looks like JSON
  // Broad intentionally — let content.js parser decide what's useful
  function isCaptureable(url) {
    if (!url) return false;
    // Skip static assets
    if (/\.(js|css|png|jpg|gif|woff|svg|ico)(\?|$)/i.test(url)) return false;
    // Must be LinkedIn domain
    return url.includes('linkedin.com');
  }

  // ── XHR hook ─────────────────────────────────────────────────
  const OrigXHR = window.XMLHttpRequest;
  function NexoraXHR() {
    const xhr = new OrigXHR();
    const origOpen = xhr.open.bind(xhr);
    const origSend = xhr.send.bind(xhr);
    let _url = '';

    xhr.open = function (method, url) {
      _url = typeof url === 'string' ? url : '';
      return origOpen.apply(xhr, arguments);
    };

    xhr.send = function () {
      if (isCaptureable(_url)) {
        xhr.addEventListener('load', function () {
          try {
            const ct = xhr.getResponseHeader('content-type') || '';
            const body = xhr.responseText || '';
            // Only forward if it looks like JSON
            if ((ct.includes('json') || body.trimStart()[0] === '{' || body.trimStart()[0] === '[') && body.length > 100) {
              dispatch(_url, body);
            }
          } catch (_) {}
        });
      }
      return origSend.apply(xhr, arguments);
    };

    return xhr;
  }
  NexoraXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = NexoraXHR;

  // ── Fetch hook ────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (resource, init) {
    const resp = await origFetch(resource, init);
    try {
      const url = typeof resource === 'string' ? resource
        : (resource instanceof Request ? resource.url : '');
      if (isCaptureable(url)) {
        const ct = resp.headers.get('content-type') || '';
        if (ct.includes('json') || ct.includes('text')) {
          resp.clone().text().then(body => {
            if (body && body.length > 100) dispatch(url, body);
          }).catch(() => {});
        }
      }
    } catch (_) {}
    return resp;
  };

  // ── Scan embedded <script> tags for JSON post data ────────────
  // LinkedIn sometimes injects server data into <script type="application/json">
  // or <code> tags — this fires at DOMContentLoaded to catch SSR hydration data
  function scanScriptTags() {
    const selectors = [
      'script[type="application/json"]',
      'script[type="application/ld+json"]',
      'code[id^="bpr"]',
      'code[style*="display:none"]',
      'code[style*="display: none"]',
      '#__NEXT_DATA__',
      'script[id*="initial"]',
      'script[id*="data"]',
      'script[id*="state"]',
    ];

    let found = 0;
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        try {
          const body = (el.textContent || el.innerText || '').trim();
          if (body.length > 100 && (body[0] === '{' || body[0] === '[')) {
            dispatch('__script_tag__', body);
            found++;
          }
        } catch (_) {}
      }
    }

    // Also check window for common SSR state objects
    const STATE_KEYS = [
      '__INITIAL_STATE__', '__RELAY_STORE__', '__NEXT_DATA__',
      '__APP_STATE__', 'serverData', 'initialData', '__PRELOADED_STATE__',
    ];
    for (const k of STATE_KEYS) {
      try {
        if (window[k]) {
          const body = JSON.stringify(window[k]);
          if (body.length > 100) { dispatch('__window_state__:' + k, body); found++; }
        }
      } catch (_) {}
    }

    if (found > 0) console.log(`[Nexora Interceptor] Scanned ${found} embedded data sources`);
  }

  // Run script scan at DOMContentLoaded (after SSR data is injected)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanScriptTags, { once: true });
  } else {
    // Already loaded — run immediately (happens on SPA navigations)
    setTimeout(scanScriptTags, 0);
  }

  // Also run after 2s for lazy-injected data
  setTimeout(scanScriptTags, 2000);

  console.log('[Nexora Interceptor] v2 — document_start hooks active');
})();
