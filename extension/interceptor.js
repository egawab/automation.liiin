// interceptor.js — URSS Network Interceptor (data only, no merging)
// Layer: Network Interceptor. Captures raw LinkedIn API responses.
// Dispatches __nexora_net__ to content.js (ISOLATED world) which forwards to background.
(function () {
  if (window.__NexoraURSS_Interceptor) return;
  window.__NexoraURSS_Interceptor = true;

  function isTarget(url) {
    if (!url || typeof url !== 'string') return false;
    if (/\.(js|css|png|jpg|gif|woff2?|svg|ico|webp)(\?|$)/i.test(url)) return false;
    return (
      url.includes('/voyager/api/') ||
      url.includes('/graphql') ||
      url.includes('/feed/') ||
      url.includes('/search/') ||
      url.includes('/contentrecipe') ||
      url.includes('/updates')
    ) && url.includes('linkedin.com');
  }

  function dispatch(url, body) {
    if (!body || body.length < 200) return;
    const fc = body.trimStart()[0];
    if (fc !== '{' && fc !== '[') return;
    try {
      window.dispatchEvent(new CustomEvent('__nexora_net__', { detail: { url, body } }));
    } catch (_) {}
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
          try { dispatch(_url, xhr.responseText); } catch (_) {}
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
        resp.clone().text().then(body => dispatch(url, body)).catch(() => {});
      }
    } catch (_) {}
    return resp;
  };

  console.log('[Nexora] URSS Interceptor active');
})();
