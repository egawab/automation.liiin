// ── postScraper.js: Single Post Page Metrics Extractor ──────────────────────────
// Injected by background.js into a background tab loaded to a specific post URL.
// The single-post page has a STATIC, NON-VIRTUALIZED DOM.
// This script extracts likes, comments, text, and author and returns them
// synchronously so background.js can evaluate the QualGate.
//
// It is injected via chrome.scripting.executeScript({ func: scrapePostPage })
// and its return value is read directly in background.js.

function scrapePostPage() {
  const result = {
    likes: 0,
    postComments: 0,
    postShares: 0,
    textSnippet: '',
    author: 'Unknown',
    mediaType: 'text',
    ok: false
  };

  try {
    // ── Likes ──────────────────────────────────────────────────────────────────
    // LinkedIn renders likes as a button with aria-label like "47 reactions"
    // or as a span inside the social counts bar.
    const likeSelectors = [
      '[aria-label*="reaction"]',
      '[aria-label*="like"]',
      '.social-counts-reactions',
      '.social-detail-social-counts__reactions-count',
      'button[aria-label*="Like"]',
      'span[data-num-reactions]',
    ];

    for (const sel of likeSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        // Skip elements inside comments section
        if (el.closest('.comments-comments-list, .comments-comment-item')) continue;
        const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
        const numAttr = el.getAttribute('data-num-reactions');
        const n = numAttr ? parseInt(numAttr, 10) : parseInt((label.match(/(\d[\d,]*)/)||[])[1]?.replace(/,/g,'') || '0', 10);
        if (n > result.likes) result.likes = n;
      }
    }

    // ── Comments ──────────────────────────────────────────────────────────────
    const commentSelectors = [
      '[aria-label*="comment"]',
      '.social-details-social-counts__comments',
      '.comments-comments-list__load-more-comments-button',
      'button[aria-label*="comment"]',
    ];
    for (const sel of commentSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest('.comments-comments-list, .comments-comment-item')) continue;
        const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
        if (!label.includes('comment')) continue;
        const n = parseInt((label.match(/(\d[\d,]*)/)||[])[1]?.replace(/,/g,'') || '0', 10);
        if (n > result.postComments) result.postComments = n;
      }
    }

    // ── Text Snippet ──────────────────────────────────────────────────────────
    // On post pages, the main post text lives in a specific container.
    const textSelectors = [
      '.feed-shared-update-v2__description',
      '.update-components-text',
      '[data-test-id="main-feed-activity-card__commentary"]',
      'article .feed-shared-text-view',
      '.attributed-text-segment-list__content',
      'div[dir="ltr"]',
    ];
    for (const sel of textSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 20) {
        result.textSnippet = el.textContent.trim().slice(0, 300);
        break;
      }
    }

    // ── Author ────────────────────────────────────────────────────────────────
    const authorSelectors = [
      '.update-components-actor__name',
      '.feed-shared-actor__name',
      '.feed-shared-actor__title',
      'a.app-aware-link[href*="/in/"]',
    ];
    for (const sel of authorSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 1) {
        result.author = el.textContent.trim().slice(0, 80);
        break;
      }
    }

    // ── Media Type ────────────────────────────────────────────────────────────
    if (document.querySelector('video, .linkedin-video-player-wrapper')) {
      result.mediaType = 'video';
    } else if (document.querySelector('.feed-shared-image, .update-components-image')) {
      result.mediaType = 'image';
    } else if (document.querySelector('.feed-shared-article, .update-components-article')) {
      result.mediaType = 'article';
    }

    result.ok = true;
    console.log(`[PostScraper] ✅ Scraped: likes=${result.likes}, comments=${result.postComments}, text="${result.textSnippet.slice(0,50)}"`);
  } catch (e) {
    console.error('[PostScraper] ❌ Error:', e.message);
    result.ok = false;
  }

  return result;
}
