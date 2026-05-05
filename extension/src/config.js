/**
 * Nexora Config Layer v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all configurable values.
 * No other module hardcodes selectors, thresholds, or timing values.
 * Loaded from chrome.storage.sync on init; defaults are used as fallback.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (window.__NexoraConfig) return; // singleton guard

  const DEFAULTS = {

    // ── Filter ───────────────────────────────────────────────────────────────
    LIKE_THRESHOLD: 10,          // Keep posts with likes_count >= this value
    INCLUDE_UNKNOWN_LIKES: true, // Include posts where likes couldn't be read (rely on network data)

    // ── Extraction limits ─────────────────────────────────────────────────────
    MAX_POSTS_PER_RUN: 60,       // Hard cap on posts collected per keyword run
    MAX_SCROLL_STEPS: 100,       // Max scroll iterations before declaring exhausted
    STALL_THRESHOLD: 15,         // Consecutive empty scrolls → feed exhausted

    // ── Timing ────────────────────────────────────────────────────────────────
    // Observer v1.1: timer-driven scroll — no debounce blocking
    SCROLL_DELAY_MS: 1500,       // Fixed delay between scroll steps (±200ms jitter)
    SCROLL_SETTLE_MS: 500,       // Wait after scroll before harvesting
    MIN_DELAY_MS: 600,           // Minimum floor (safety clamp)
    MAX_DELAY_MS: 1500,          // Not used by observer v1.1 directly
    BATCH_FLUSH_INTERVAL_MS: 5000,

    // ── Transport ─────────────────────────────────────────────────────────────
    BATCH_SIZE: 10,
    RETRY_ATTEMPTS: 3,
    RETRY_BASE_DELAY_MS: 2000,

    // ── Observability ─────────────────────────────────────────────────────────
    DEBUG_MODE: false,
    HIGHLIGHT_POSTS: false,      // Outline detected post cards in DOM

    // ── Selector fallback chains ───────────────────────────────────────────────
    // Rules: NO CSS class names. Only role, aria-*, data-*, semantic elements.
    // Each chain is tried in order; first match wins.
    SELECTORS: {

      // Post card containers
      POST_CONTAINERS: [
        '[role="article"][data-urn]',
        '[data-view-name="feed-full-update"]',
        '[role="article"][data-entity-urn]',
        '[role="article"]',
        '[data-update-urn]',
        '[data-chameleon-result-urn]',
      ],

      // Feed/results scroll container
      FEED_CONTAINER: [
        '[role="main"]',
        'main',
        '[tabindex="-1"][role="main"]',
      ],

      // Like / reaction buttons (for button-walk-up card detection)
      LIKE_BUTTON: [
        'button[aria-label*="reaction" i]',
        'button[aria-label*="like" i]',
        'button[aria-label*="React" i]',
        '[role="button"][aria-label*="reaction" i]',
      ],

      // Social counts elements (for metrics extraction)
      SOCIAL_COUNTS: [
        '[aria-label*="reaction" i]',
        '[aria-label*="like" i]',
        '[aria-label*="comment" i]',
      ],

      // Post body text
      POST_TEXT: [
        '[data-test-id="main-feed-activity-card__commentary"]',
        '[dir="ltr"][data-tracking-control-name]',
        'span[dir="ltr"]',
        'span[dir="rtl"]',
      ],

      // Author name
      AUTHOR: [
        '[data-member-id] [aria-hidden="true"]',
        'a[href*="/in/"] [aria-hidden="true"]',
        'a[href*="/company/"] [aria-hidden="true"]',
        'a[data-member-id]',
      ],

      // Timestamp
      TIMESTAMP: [
        'time[datetime]',
        '[aria-label*="ago" i]',
      ],
    },

    // ── Language signals (for multilingual button detection) ──────────────────
    LIKE_SIGNALS: [
      'react', 'like', 'إعجاب', "j'aime", 'curtir', 'gefällt', 'me gusta',
      'beğen', 'suka', 'vind ik leuk', 'mi piace', 'lubię', 'synes godt',
      'réaction', 'reação', 'tepki', 'reaction', 'reageer',
    ],

    COMMENT_SIGNALS: [
      'comment', 'تعليق', 'commenter', 'comentar', 'kommentieren',
      'yorum', 'komentar', 'commenta', 'skomentuj', 'kommentaa',
    ],

    // ── URN patterns ──────────────────────────────────────────────────────────
    URN_RE_STR: 'urn:li:(activity|ugcPost|share):(\\d{10,25})',
    FSD_URN_RE_STR: 'urn:li:fsd_update:[:(]urn:li:(activity|ugcPost|share):(\\d{10,25})',
  };

  // Deep-merge helper (non-recursive for simplicity)
  function merge(base, overrides) {
    const out = Object.assign({}, base);
    for (const key in overrides) {
      if (overrides[key] !== null && typeof overrides[key] === 'object' && !Array.isArray(overrides[key])) {
        out[key] = Object.assign({}, base[key] || {}, overrides[key]);
      } else {
        out[key] = overrides[key];
      }
    }
    return out;
  }

  window.__NexoraConfig = Object.assign({}, DEFAULTS);

  // Load overrides from chrome.storage.sync
  window.__NexoraConfig.load = function () {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.sync.get(['nexoraConfig'], (stored) => {
            if (stored && stored.nexoraConfig) {
              window.__NexoraConfig = merge(window.__NexoraConfig, stored.nexoraConfig);
            }
            resolve(window.__NexoraConfig);
          });
        } else {
          resolve(window.__NexoraConfig);
        }
      } catch (e) {
        resolve(window.__NexoraConfig);
      }
    });
  };

  window.__NexoraConfig.update = function (overrides) {
    window.__NexoraConfig = merge(window.__NexoraConfig, overrides);
  };

})();
