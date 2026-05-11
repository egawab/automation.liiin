const fs = require('fs');
const bgPath = 'extension/background.js';
const ctPath = 'extension/content.js';

try {
  let bg = fs.readFileSync(bgPath, 'utf8');

  // 1. Update CDP state
  bg = bg.replace(
    `tabId: null, attached: false, keyword: '',`,
    `tabId: null, attached: false, keyword: '', allKeywords: [], keywordIndex: 0, cycleMode: false,`
  );

  // 2. In handleStartFast
  bg = bg.replace(
    `let keyword = '';
  try {
    keyword = await fetchKeyword(cdp.dashboardUrl, cdp.userId);`,
    `let keywords = [];
  try {
    keywords = await fetchKeywordsArray(cdp.dashboardUrl, cdp.userId);`
  );

  bg = bg.replace(
    `    const cached = await chrome.storage.local.get('lastKeyword');
    if (cached.lastKeyword) {
      keyword = cached.lastKeyword;
      console.warn('[Worker] fetchKeyword failed, using cached:', keyword);
    } else {`,
    `    const cached = await chrome.storage.local.get('lastKeywords');
    if (cached.lastKeywords && cached.lastKeywords.length > 0) {
      keywords = cached.lastKeywords;
      console.warn('[Worker] fetchKeywords failed, using cached:', keywords);
    } else {`
  );

  bg = bg.replace(
    `  cdp.keyword = keyword;
  await chrome.storage.local.set({ lastKeyword: keyword });`,
    `  cdp.allKeywords = keywords;
  cdp.keywordIndex = 0;
  cdp.keyword = keywords[0] || 'linkedin';
  cdp.cycleMode = keywords.length > 1;
  await chrome.storage.local.set({ lastKeywords: keywords, lastKeyword: cdp.keyword });`
  );

  bg = bg.replace(`return { keyword };`, `return { keyword: cdp.keyword };`);

  // 3. fetchKeyword -> fetchKeywordsArray
  bg = bg.replace(`async function fetchKeyword(dashboardUrl, userId) {`, `async function fetchKeywordsArray(dashboardUrl, userId) {`);

  bg = bg.replace(
    `  // 1. أولوية مطلقة: searchConfigJson لو هو Search Only Mode
  const searchOnly = jobs.settings?.searchOnlyMode !== false;
  if (searchOnly && jobs.settings?.searchConfigJson) {
    try {
      const cfg = JSON.parse(jobs.settings.searchConfigJson);
      if (Array.isArray(cfg)) {
         const kw = cfg.flat().find(k => typeof k === 'string' && k.trim());
         if (kw) {
           console.log('[Worker] Selected keyword from searchConfigJson:', kw.trim());
           return kw.trim();
         }
      }
    } catch (e) {
      console.warn('[Worker] Failed to parse searchConfigJson:', e);
    }
  }

  // 2. محاولة ثانية: كلمات الحملات
  if (Array.isArray(jobs.keywords) && jobs.keywords.length > 0) {
    const kw = jobs.keywords[0].keyword?.trim();
    if (kw) {
      console.log('[Worker] Selected keyword from Campaigns:', kw);
      return kw;
    }
  }

  // 3. Fallback: افتح searchConfigJson حتى لو مش searchOnly
  try {
    const cfg = JSON.parse(jobs.settings?.searchConfigJson || '[]');
    if (Array.isArray(cfg)) {
        const kw = cfg.flat().find(k => typeof k === 'string' && k.trim());
        if (kw) return kw.trim();
    }
  } catch (_) {}

  throw new Error('No keyword configured in dashboard.');`,
    `  let allKw = [];
  try {
    if (jobs.settings?.searchConfigJson) {
      const cfg = JSON.parse(jobs.settings.searchConfigJson);
      if (Array.isArray(cfg)) {
         const valid = cfg.flat().filter(k => typeof k === 'string' && k.trim());
         allKw.push(...valid.map(k => k.trim()));
      }
    }
  } catch(e) {}
  
  if (Array.isArray(jobs.keywords)) {
    const campKw = jobs.keywords.map(k => k.keyword?.trim()).filter(Boolean);
    allKw.push(...campKw);
  }
  
  if (allKw.length === 0) throw new Error('No keywords configured in dashboard.');
  return [...new Set(allKw)];`
  );

  // 4. finalFlush -> cycle support
  bg = bg.replace(
    `async function finalFlush() {
  stopEvalLoop();
  await sleep(1500);
  await evaluatePageState();
  await flushBatch();
  broadcast('SCRAPER_COMPLETE', { totalSaved: cdp.totalSaved });
  broadcast('EXTENSION_LIVE_STATUS', { text: \`🎉 Done! \${cdp.totalSaved} posts saved.\` });
  await safeDetach();
  await chrome.storage.session.clear();
  cdp.running = false;
}`,
    `async function finalFlush() {
  stopEvalLoop();
  await sleep(1500);
  await evaluatePageState();
  await flushBatch();
  
  // CYCLING LOGIC
  cdp.keywordIndex++;
  if (cdp.allKeywords && cdp.keywordIndex < cdp.allKeywords.length) {
    cdp.keyword = cdp.allKeywords[cdp.keywordIndex];
    broadcast('EXTENSION_LIVE_STATUS', { text: \`🔄 Switching to keyword: "\${cdp.keyword}"\` });
    console.log('[Worker] Cycling to next keyword:', cdp.keyword);
    // Short wait before next cycle
    await sleep(6000);
    // Run next cycle without resetting tab or store
    launchEngine().catch(e => console.error('[Worker] launchEngine cycle error:', e));
    return;
  }
  
  // Done with all keywords or cycleMode off
  broadcast('SCRAPER_COMPLETE', { totalSaved: cdp.totalSaved });
  broadcast('EXTENSION_LIVE_STATUS', { text: \`🎉 Done! \${cdp.totalSaved} posts saved.\` });
  await safeDetach();
  await chrome.storage.session.clear();
  cdp.running = false;
  cdp.keywordIndex = 0;
}`
  );

  // 5. Fix \`ingestNetworkBody\` - remove minimum likes filter and delay flush
  bg = bg.replace(`  const MIN = 10;\n`, ``);
  bg = bg.replace(`    if (p.likes !== null && p.likes < MIN) continue;\n`, `    // MIN engagement filter moved to flushBatch\n`);
  
  bg = bg.replace(
    `setTimeout(() => {
      let flushed = 0;
      for (const [, post] of cdp.store) {
        if (post._networkOnly) { delete post._networkOnly; cdp.batchPending.push({ ...post }); flushed++; }
      }
      if (flushed > 0) { console.log(\`[Network] delayed-flush \${flushed}\`); flushBatch().catch(console.error); }
    }, 12000);`,
    `setTimeout(() => {
      let flushed = 0;
      for (const [, post] of cdp.store) {
        if (post._networkOnly && post.postText && post.postText.length > 20) { 
           delete post._networkOnly; 
           post._flushed = true;
           cdp.batchPending.push({ ...post }); 
           flushed++; 
        }
      }
      if (flushed > 0) { console.log(\`[Network] delayed-flush \${flushed}\`); flushBatch().catch(console.error); }
    }, 25000);`
  );

  // 6. Fix \`flushBatch\` to add MIN engagement logic
  bg = bg.replace(
    `  // Sort by likes descending so highest-reach posts reach the dashboard first
  cdp.batchPending.sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1));`,
    `  // Filter posts with < 10 total engagement before sending
  const MIN_ENGAGEMENT = 10;
  cdp.batchPending = cdp.batchPending.filter(p => {
    const total = (p.likes || 0) + (p.comments || 0);
    return total >= MIN_ENGAGEMENT;
  });

  // Sort by likes descending so highest-reach posts reach the dashboard first
  cdp.batchPending.sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1));`
  );

  // 7. Fix evaluatePageState duplicate push
  bg = bg.replace(
    `        // Push to batch if enriched OR if it's a network-only post not yet pushed
        if (enriched || ex._networkOnly) {
          delete ex._networkOnly;
          cdp.batchPending.push({ ...ex }); added++;
        }`,
    `        // Push to batch if enriched OR if it's a network-only post not yet pushed
        if ((enriched || ex._networkOnly) && !ex._flushed) {
          delete ex._networkOnly;
          ex._flushed = true; // prevent duplicate push
          cdp.batchPending.push({ ...ex }); added++;
        }`
  );

  bg = bg.replace(`      cdp.batchPending.push(post);`, `      post._flushed = true; cdp.batchPending.push(post);`);

  // 8. Fix EVAL_SCRIPT text & comments
  bg = bg.replace(
    `    posts.push({ urn: urn, url: href,
      text: postText.substring(0, 3000), author: author,
      likes: likes, comments: null });`,
    `    // Comments count
    var comments = null;
    Array.from(best.querySelectorAll('[aria-label]')).forEach(function(el){
      var l = el.getAttribute('aria-label') || '';
      if (/\\d/.test(l) && /comment/i.test(l)) {
        var nm = l.match(/([\\d,]+)/);
        if (nm) comments = parseInt(nm[1].replace(/,/g,''), 10);
      }
    });

    posts.push({ urn: urn, url: href,
      text: postText.substring(0, 3000), author: author,
      likes: likes, comments: comments });`
  );

  bg = bg.replace(
    `    // Post text: LinkedIn wraps post content in dir="ltr" element
    var postEl = best.querySelector('[dir="ltr"]');
    var postText = postEl ? (postEl.innerText || '').trim() : '';
    if (!postText) postText = (best.innerText || '').trim().substring(0, 2000);`,
    `    // Post text: Expand selectors
    var postText = '';
    var textCandidates = Array.from(best.querySelectorAll('[dir="ltr"], .feed-shared-update-v2__description, .update-components-text, .search-result__snippets, .break-words'));
    textCandidates.forEach(function(d) {
      var t = (d.innerText||'').trim();
      if (t.length > postText.length) postText = t;
    });
    if (postText.length < 10) postText = (best.innerText || '').replace(/\\s+/g, ' ').trim().substring(0, 3000);`
  );

  // One more fix: content.js comment extraction missing!
  let ct = fs.readFileSync(ctPath, 'utf8');
  ct = ct.replace(
    `      posts.push({
        urn: urn,
        url: 'https://www.linkedin.com/feed/update/' + urn,
        text: postText.substring(0, 3000),
        author: author,
        likes: likes,
        comments: null
      });`,
    `      var comments = null;
      Array.from(best.querySelectorAll('[aria-label]')).forEach(function(x) {
        if (comments !== null) return;
        var l = x.getAttribute('aria-label') || '';
        if (/\\d/.test(l) && /comment/i.test(l)) {
          var n = l.match(/(\\d[\\d,]*)/);
          if (n) comments = parseInt(n[1].replace(/,/g,''), 10);
        }
      });
      if (comments === null) {
        var cm = (best.innerText||'').match(/(\\d[\\d,]*)\\s*comment/i);
        if (cm) comments = parseInt(cm[1].replace(/,/g,''), 10);
      }

      posts.push({
        urn: urn,
        url: 'https://www.linkedin.com/feed/update/' + urn,
        text: postText.substring(0, 3000),
        author: author,
        likes: likes,
        comments: comments
      });`
  );

  fs.writeFileSync(bgPath, bg, 'utf8');
  fs.writeFileSync(ctPath, ct, 'utf8');
  console.log('Successfully patched background.js and content.js!');
} catch (e) {
  console.error('Error patching:', e);
}
