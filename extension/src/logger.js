/**
 * Nexora Logger v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Structured, leveled logging with optional visual post highlighting.
 * All modules call this — never console.log directly.
 *
 * Usage:
 *   const L = window.__NexoraLogger;
 *   L.info('MyModule', 'Message', { optional: 'data' });
 *   L.highlight(domElement, '#00ff00', 'PostCard');
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraLogger) return;

  const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

  const STYLES = {
    DEBUG: 'color:#6b7280;font-weight:400',
    INFO:  'color:#0071e3;font-weight:400',
    WARN:  'color:#ff9f0a;font-weight:600',
    ERROR: 'color:#ff3b30;font-weight:700',
  };

  // Short session ID to correlate logs from one run
  const SESSION_ID = Math.random().toString(36).slice(2, 7).toUpperCase();

  let _level = LEVELS.INFO;
  const _errors = [];

  // ── Core log function ──────────────────────────────────────────────────────
  function log(levelName, module, msg, data) {
    if (LEVELS[levelName] < _level) return;

    const prefix = `[Nexora][${SESSION_ID}][${module}] ${msg}`;

    if (data !== undefined) {
      console.groupCollapsed(`%c${prefix}`, STYLES[levelName]);
      console.log(data);
      console.groupEnd();
    } else {
      console.log(`%c${prefix}`, STYLES[levelName]);
    }

    if (levelName === 'ERROR') {
      _errors.push({ t: Date.now(), module, msg, data });
      if (_errors.length > 100) _errors.shift();
    }
  }

  // ── Visual DOM highlighting (debug mode only) ──────────────────────────────
  function highlight(el, color = '#0071e3', label = '') {
    if (!el || el.nodeType !== 1) return;
    try {
      if (el.hasAttribute('data-nexora-hi')) return; // already done
      el.setAttribute('data-nexora-hi', '1');
      el.style.outline = `2px solid ${color}`;
      el.style.outlineOffset = '2px';
      if (label) {
        const badge = document.createElement('span');
        badge.textContent = label;
        badge.style.cssText = [
          'position:absolute',
          'top:0',
          'left:0',
          `background:${color}`,
          'color:#fff',
          'font-size:9px',
          'padding:1px 4px',
          'z-index:2147483647',
          'pointer-events:none',
          'font-family:monospace',
          'border-radius:0 0 4px 0',
        ].join(';');
        const prev = el.style.position;
        if (!prev || prev === 'static') el.style.position = 'relative';
        el.appendChild(badge);
      }
    } catch (e) { /* non-fatal */ }
  }

  function clearHighlights() {
    document.querySelectorAll('[data-nexora-hi]').forEach(el => {
      try {
        el.removeAttribute('data-nexora-hi');
        el.style.outline = '';
        el.style.outlineOffset = '';
        el.querySelectorAll('span[style*="z-index:2147483647"]').forEach(b => b.remove());
      } catch (e) {}
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.__NexoraLogger = {
    debug:   (m, msg, d) => log('DEBUG', m, msg, d),
    info:    (m, msg, d) => log('INFO',  m, msg, d),
    warn:    (m, msg, d) => log('WARN',  m, msg, d),
    error:   (m, msg, d) => log('ERROR', m, msg, d),

    setLevel:  (name) => { _level = LEVELS[name] ?? LEVELS.INFO; },
    setDebug:  (on)   => { _level = on ? LEVELS.DEBUG : LEVELS.INFO; },

    highlight,
    clearHighlights,
    getErrors: () => _errors.slice(),
    sessionId: SESSION_ID,
  };

})();
