const fs = require('fs');

try {
  let bg = fs.readFileSync('extension/background.js', 'utf8');

  const newNetworkParser = `function ingestNetworkBody(body) {
  try {
    let json = JSON.parse(body);
    let postMap = {};

    function parseEng(str) {
      if (!str) return null;
      var s = String(str).toUpperCase().replace(/,/g, '');
      var m = s.match(/[0-9.]+/);
      if (!m) return null;
      var n = parseFloat(m[0]);
      if (s.indexOf('K') > -1) n *= 1000;
      if (s.indexOf('M') > -1) n *= 1000000;
      return Math.floor(n);
    }

    function extractPostData(obj) {
      if (!obj || typeof obj !== 'object') return;

      // Check if this object contains a URN
      let rawUrn = obj.entityUrn || obj.updateUrn || obj.urn || '';
      let um = rawUrn.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
      
      if (um) {
        let urn = 'urn:li:' + um[1] + ':' + um[2];
        if (!postMap[urn]) {
          postMap[urn] = { urn: urn, url: 'https://www.linkedin.com/feed/update/' + urn, text: '', author: '', likes: null, comments: null };
        }
        
        let p = postMap[urn];

        // Text
        let txt = obj.commentary?.text?.text || obj.commentary?.text || obj.text || obj.summary || obj.description || '';
        if (typeof txt === 'string' && txt.length > p.text.length) p.text = txt.substring(0, 5000);

        // Author
        let auth = obj.actor?.name?.text || obj.actor?.nameV2?.text || obj.actor?.title?.text || obj.actor?.fullName || obj.author?.name || '';
        if (typeof auth === 'string' && auth.length > p.author.length) p.author = auth.substring(0, 100);

        // Engagement
        let soc = obj.socialDetail || obj.socialActivityCounts || obj.totalSocialActivityCounts || obj.socialProofText || {};
        if (typeof soc === 'string') {
           // Maybe a string like "1,200 Likes"
           let l = soc.match(/([0-9.,]+[KkMm]?)\\s*(reaction|like)/i);
           if (l && p.likes === null) p.likes = parseEng(l[1]);
           let c = soc.match(/([0-9.,]+[KkMm]?)\\s*comment/i);
           if (c && p.comments === null) p.comments = parseEng(c[1]);
        } else {
           if (soc.numLikes !== undefined && p.likes === null) p.likes = parseEng(soc.numLikes);
           if (soc.numComments !== undefined && p.comments === null) p.comments = parseEng(soc.numComments);
           
           if (soc.totalSocialActivityCounts) {
             let t = soc.totalSocialActivityCounts;
             if (t.numLikes !== undefined && p.likes === null) p.likes = parseEng(t.numLikes);
             if (t.numComments !== undefined && p.comments === null) p.comments = parseEng(t.numComments);
           }
        }
        
        // Sometimes likes are directly on the object
        if (obj.numLikes !== undefined && p.likes === null) p.likes = parseEng(obj.numLikes);
        if (obj.numComments !== undefined && p.comments === null) p.comments = parseEng(obj.numComments);
      }

      // Recurse into children
      if (Array.isArray(obj)) {
        for (let i=0; i<obj.length; i++) extractPostData(obj[i]);
      } else {
        let keys = Object.keys(obj);
        for (let i=0; i<keys.length; i++) {
          let k = keys[i];
          if (k !== 'paging' && k !== 'metadata' && typeof obj[k] === 'object') {
            extractPostData(obj[k]);
          }
        }
      }
    }

    extractPostData(json);

    // Filter and add to store
    let enriched = 0;
    for (let urn in postMap) {
      let p = postMap[urn];
      // Only add if it has some text or engagement
      if (p.text.length > 10 || p.likes !== null || p.comments !== null) {
        let existing = cdp.store.get(urn);
        if (existing) {
          if (p.text && p.text.length > (existing.postText || '').length) {
            existing.postText = p.text;
            existing.preview = p.text;
          }
          if (p.likes !== null) existing.likes = p.likes;
          if (p.comments !== null) existing.comments = p.comments;
          if (p.author && p.author.length > 2) existing.author = p.author;
        } else {
          let np = {
            canonicalUrn: urn, url: p.url, postText: p.text, preview: p.text,
            author: p.author || 'Unknown', likes: p.likes, comments: p.comments,
            confidence: p.text ? 0.95 : 0.4, source: 'network_recursive'
          };
          cdp.store.set(urn, np);
          cdp.batchPending.push(np);
          enriched++;
        }
      }
    }

    if (enriched > 0) {
      console.log('[NETWORK] Recursive parser added', enriched, 'posts -> flushing');
      flushBatch().catch(console.error);
    }
  } catch (e) {
    console.error('[NETWORK] Parse error:', e);
  }
}`;

  let startIndex = bg.indexOf('function ingestNetworkBody(body) {');
  if (startIndex === -1) throw new Error('Could not find ingestNetworkBody');
  
  // Find the end of ingestNetworkBody. We will just use regex to replace everything up to the next top-level function or end of file.
  // The next top-level function is `async function flushBatch()`
  let endIndex = bg.indexOf('async function flushBatch()', startIndex);
  if (endIndex === -1) throw new Error('Could not find flushBatch');
  
  bg = bg.substring(0, startIndex) + newNetworkParser + '\n\n' + bg.substring(endIndex);
  
  fs.writeFileSync('extension/background.js', bg, 'utf8');
  console.log('Successfully replaced ingestNetworkBody with recursive parser.');
} catch(e) {
  console.error(e);
}
