// interceptor.js — MAIN world, document_start (declared in manifest.json)
// Hooks XHR + fetch before LinkedIn makes any requests.
// Dispatches __nexora_net__ CustomEvent to content.js (ISOLATED world).
(function () {
  if (window.__NexoraInterceptorV6) return;
  window.__NexoraInterceptorV6 = true;

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
    if (!body || body.length < 100) return;
    const first = body.trimStart()[0];
    if (first !== '{' && first !== '[') return;
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

  console.log('[Nexora] Interceptor v6 active (MAIN world)');
})();
