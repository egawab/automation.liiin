$contentFile = 'c:\Users\lenovo\Downloads\clonelink\extension\content.js'
$c = Get-Content $contentFile -Raw

$newDoScroll = @'
  function doScroll() {
    // 1. Aggressive DOM container scroll
    var allEls = document.querySelectorAll('*');
    for (var i=0; i<allEls.length; i++) {
      var el = allEls[i];
      if (el.scrollHeight > el.clientHeight + 10) {
        var style = window.getComputedStyle(el);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          el.scrollTop = el.scrollHeight;
          el.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
      }
    }

    // 2. Last Item scrollIntoView
    try {
      var lists = document.querySelectorAll('ul');
      for (var i=0; i<lists.length; i++) {
        var items = lists[i].querySelectorAll('li');
        if (items.length > 0) {
          items[items.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      }
    } catch(e) {}

    // 3. Window scroll
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

    // 4. Global events
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
  }
'@

$c = $c -replace '(?s)function doScroll\(\) \{.*?(?=function distBottom\(\))', "$newDoScroll`r`n`r`n  "
[System.IO.File]::WriteAllText($contentFile, $c)

$bgFile = 'c:\Users\lenovo\Downloads\clonelink\extension\background.js'
$b = Get-Content $bgFile -Raw

$newEvalScript = @'
const EVAL_SCRIPT = `(function(){
  var posts = [];
  var seenKeys = {};
  var candidates = Array.from(document.querySelectorAll('.reusable-search__result-container, .search-result__occluded-item, .entity-result, [data-view-name="search-entity-result"], .update-components-update-v2, article, li'));
  
  for (var i = 0; i < candidates.length; i++) {
    var el = candidates[i];
    var text = (el.innerText || '').trim();
    if (text.length < 20) continue;
    if (text.includes("Accessibility") && text.includes("Help Center")) continue;
    if (el.querySelector('nav')) continue;
    if (text.length > 4000 && el.tagName !== 'ARTICLE') continue;

    var lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    var author = lines[0] ? lines[0].substring(0, 100) : 'Unknown';
    
    var urn = null;
    var url = '';
    
    var urnAttr = el.getAttribute('data-entity-urn') || el.getAttribute('data-urn') || el.getAttribute('data-view-urn');
    var um = urnAttr ? urnAttr.match(/urn:li:(activity|ugcPost|share):\d+/) : null;
    if (um) urn = um[0];
    
    if (!urn) {
      var links = Array.from(el.querySelectorAll('a[href]'));
      for (var j = 0; j < links.length; j++) {
        var href = links[j].href;
        var hm = href.match(/urn:li:(activity|ugcPost|share):\d+/);
        if (hm) { urn = hm[0]; url = href; break; }
        if (href.indexOf('/posts/') > -1 || href.indexOf('/feed/update/') > -1) { url = href; }
      }
    }
    
    if (!urn) {
      var textKey = text.substring(0, 60);
      var hash = 0;
      for (var k = 0; k < textKey.length; k++) {
        hash = ((hash << 5) - hash) + textKey.charCodeAt(k);
        hash |= 0; 
      }
      urn = 'urn:li:activity:synthetic_' + Math.abs(hash);
    }
    
    if (seenKeys[urn]) continue;
    seenKeys[urn] = 1;
    
    posts.push({
      urn: urn,
      text: text.substring(0, 3000),
      author: author,
      likes: null, comments: null,
      url: url || 'https://www.linkedin.com/feed/update/' + urn
    });
  }
  return JSON.stringify({ posts: posts, total: posts.length });
})()`;
'@

$b = $b -replace '(?s)const EVAL_SCRIPT = \(function\(\) \{.*?\}\)\(\);', $newEvalScript
[System.IO.File]::WriteAllText($bgFile, $b)

Write-Host "Patched successfully!"
