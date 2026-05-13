// interceptor.js — URSS Network Interceptor (MAIN world, document_start)
// Captures LinkedIn API XHR/fetch responses and dispatches to content.js (ISOLATED world).
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
    console.log('[INT] captured', url.substring(0, 80), 'len=', body.length);
    try {
      console.log('[INT] dispatching __nexora_net__');
      window.dispatchEvent(new CustomEvent('__nexora_net__', { detail: { url, body } }));
    } catch (e) {
      console.warn('[INT] dispatch error:', e);
    }
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
        resp.clone().text().then(body => dispatch(url, body)).catch(e => console.warn('[INT] fetch text err:', e));
      }
    } catch (e) { console.warn('[INT] fetch hook err:', e); }
    return resp;
  };

  console.log('[INT] URSS Interceptor v7.1 active (MAIN world) on', location.href);
})();
