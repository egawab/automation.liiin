const fs = require('fs');

try {
  let bg = fs.readFileSync('extension/background.js', 'utf8');
  let ct = fs.readFileSync('extension/content.js', 'utf8');

  const evalScriptFix = `const EVAL_SCRIPT = \`(function(){
    var posts = [];
    var seen  = {};
  
    var allLinks = Array.from(document.querySelectorAll('a[href]'));
    var postLinks = allLinks.filter(function(a) {
      return a.href && (a.href.indexOf('feed/update/urn:li:') > -1 || a.href.indexOf('/posts/') > -1);
    });
  
    postLinks.forEach(function(link){
      var href = link.href || '';
      var urn = '';
      var um = href.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
      if (um) {
        urn = 'urn:li:' + um[1] + ':' + um[2];
      } else {
        var pm = href.match(/activity-([0-9]{10,25})/);
        if (pm) urn = 'urn:li:activity:' + pm[1];
      }
      if (!urn) return;
      if (seen[urn]) return; seen[urn] = 1;
  
      // Walk up: find post card (>30 chars to allow short posts)
      var container = link, best = null;
      for (var i = 0; i < 25; i++) {
        container = container.parentElement;
        if (!container || container === document.body) break;
        var len = (container.innerText || '').trim().length;
        if (len > 30 && len < 15000) { best = container; break; }
      }
      if (!best) return;
  
      // Author
      var authorEl = best.querySelector('a[href*="/in/"]');
      var author = authorEl ? (authorEl.innerText || '').trim().split('\\\\n')[0].substring(0, 100) : '';
  
      // Post text
      var postText = '';
      var textCandidates = Array.from(best.querySelectorAll('[dir="ltr"], .feed-shared-update-v2__description, .update-components-text, .search-result__snippets, .break-words'));
      textCandidates.forEach(function(d) {
        var t = (d.innerText||'').trim();
        if (t.length > postText.length) postText = t;
      });
      if (postText.length < 10) postText = (best.innerText || '').replace(/\\s+/g, ' ').trim().substring(0, 3000);
  
      // Parse Number Utility
      function parseEng(str) {
        if (!str) return null;
        var s = str.toUpperCase().replace(/,/g, '');
        var m = s.match(/[0-9.]+/);
        if (!m) return null;
        var n = parseFloat(m[0]);
        if (s.indexOf('K') > -1) n *= 1000;
        if (s.indexOf('M') > -1) n *= 1000000;
        return Math.floor(n);
      }

      // Likes
      var likes = null;
      Array.from(best.querySelectorAll('[aria-label]')).forEach(function(el){
        if (likes !== null) return;
        var l = el.getAttribute('aria-label') || '';
        if (/[0-9]/.test(l) && /(reaction|like)/i.test(l)) {
          likes = parseEng(l);
        }
      });
      if (likes === null) {
        var bm = (best.innerText || '').match(/([0-9.,]+[KkMm]?)\\s*(reactions?|likes?)/i);
        if (bm) likes = parseEng(bm[1]);
      }
  
      // Comments
      var comments = null;
      Array.from(best.querySelectorAll('[aria-label]')).forEach(function(el){
        if (comments !== null) return;
        var l = el.getAttribute('aria-label') || '';
        if (/[0-9]/.test(l) && /comment/i.test(l)) {
          comments = parseEng(l);
        }
      });
      if (comments === null) {
        var cm = (best.innerText || '').match(/([0-9.,]+[KkMm]?)\\s*comment/i);
        if (cm) comments = parseEng(cm[1]);
      }

      posts.push({ urn: urn, url: href,
        text: postText.substring(0, 3000), author: author,
        likes: likes, comments: comments });
    });

    // Pagination Clicker! If we are near the bottom of search results, click "Next"
    var nextBtn = document.querySelector('.artdeco-pagination__button--next, button[aria-label="Next"]');
    var isScrolledToBottom = (window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 800);
    if (nextBtn && !nextBtn.disabled && isScrolledToBottom) {
      try { nextBtn.click(); } catch(e){}
    }

    return posts;
  })();\`;`;

  bg = bg.replace(/const EVAL_SCRIPT = `\(function\(\)\{[\s\S]*?\}\)\(\);`;/, evalScriptFix);


  const contentExtractFix = `function extractPostsFromDOM() {
    var posts = [];
    var seen = new Set();
    
    var allLinks = Array.from(document.querySelectorAll('a[href]'));
    var postLinks = allLinks.filter(function(a) {
      return a.href && (a.href.indexOf('feed/update/urn:li:') > -1 || a.href.indexOf('/posts/') > -1);
    });

    postLinks.forEach(function(link) {
      var href = link.href || '';
      var urn = '';
      var um = href.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
      if (um) {
        urn = 'urn:li:' + um[1] + ':' + um[2];
      } else {
        var pm = href.match(/activity-([0-9]{10,25})/);
        if (pm) urn = 'urn:li:activity:' + pm[1];
      }
      if (!urn) return;
      if (seen.has(urn)) return;
      seen.add(urn);

      // Walk up
      var container = link, best = null;
      for (var i = 0; i < 25; i++) {
        container = container.parentElement;
        if (!container || container === document.body) break;
        var len = (container.innerText || '').trim().length;
        if (len > 30 && len < 15000) { best = container; break; }
      }
      if (!best) return;

      var authorEl = best.querySelector('a[href*="/in/"]');
      var author = authorEl ? (authorEl.innerText || '').trim().split('\\n')[0].substring(0, 100) : '';

      var postText = '';
      var textCandidates = Array.from(best.querySelectorAll('[dir="ltr"], .feed-shared-update-v2__description, .update-components-text, .search-result__snippets, .break-words'));
      textCandidates.forEach(function(d) {
        var t = (d.innerText||'').trim();
        if (t.length > postText.length) postText = t;
      });
      if (postText.length < 10) postText = (best.innerText || '').replace(/\\s+/g, ' ').trim().substring(0, 3000);

      function parseEng(str) {
        if (!str) return null;
        var s = str.toUpperCase().replace(/,/g, '');
        var m = s.match(/[0-9.]+/);
        if (!m) return null;
        var n = parseFloat(m[0]);
        if (s.indexOf('K') > -1) n *= 1000;
        if (s.indexOf('M') > -1) n *= 1000000;
        return Math.floor(n);
      }

      var likes = null;
      Array.from(best.querySelectorAll('[aria-label]')).forEach(function(el){
        if (likes !== null) return;
        var l = el.getAttribute('aria-label') || '';
        if (/[0-9]/.test(l) && /(reaction|like)/i.test(l)) {
          likes = parseEng(l);
        }
      });
      if (likes === null) {
        var bm = (best.innerText||'').match(/([0-9.,]+[KkMm]?)\\s*(reactions?|likes?)/i);
        if (bm) likes = parseEng(bm[1]);
      }

      var comments = null;
      Array.from(best.querySelectorAll('[aria-label]')).forEach(function(el){
        if (comments !== null) return;
        var l = el.getAttribute('aria-label') || '';
        if (/[0-9]/.test(l) && /comment/i.test(l)) {
          comments = parseEng(l);
        }
      });
      if (comments === null) {
        var cm = (best.innerText||'').match(/([0-9.,]+[KkMm]?)\\s*comment/i);
        if (cm) comments = parseEng(cm[1]);
      }

      posts.push({
        urn: urn,
        url: href,
        text: postText.substring(0, 3000),
        author: author,
        likes: likes,
        comments: comments
      });
    });

    var nextBtn = document.querySelector('.artdeco-pagination__button--next, button[aria-label="Next"]');
    var isScrolledToBottom = (window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 800);
    if (nextBtn && !nextBtn.disabled && isScrolledToBottom) {
      try { nextBtn.click(); } catch(e){}
    }

    return posts;
  }`;

  ct = ct.replace(/function extractPostsFromDOM\(\) \{[\s\S]*?return posts;\s*\}/, contentExtractFix);

  // Set minimum engagement to 0 so all matching posts are saved
  bg = bg.replace(/const MIN_ENGAGEMENT = 10;/, 'const MIN_ENGAGEMENT = 0;');

  // Now, to handle Pagination looping gracefully in background.js:
  // background.js does "step < MAX_STEPS", scrolling down. The DOM eval will click "next" automatically.
  // We should increase wait time slightly after clicking next so the page can load.
  // We'll let DOM observer handle it, but wait, if it clicks next, the page doesn't fully reload, it just fetches new results.
  // A 2 second pause is usually enough. The background loop already has a random 2-4 second wait.

  fs.writeFileSync('extension/background.js', bg, 'utf8');
  fs.writeFileSync('extension/content.js', ct, 'utf8');
  console.log('Engine patch applied successfully');
} catch(e) {
  console.error(e);
}
