const fs = require('fs');
// Check the latest debug HTML (might be for PHP or marketing)
const files = ['debug-main-recent.html', 'debug-main-relevance.html'];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const html = fs.readFileSync(f, 'utf8').substring(0, 300000);
  console.log('\n=== File:', f, '===');
  
  // Count key selectors
  const feedLinks = (html.match(/href="[^"]*feed\/update\/urn:li:/g) || []).length;
  const postLinks = (html.match(/href="[^"]*\/posts\//g) || []).length;
  const articleLinks = (html.match(/href="[^"]*\/pulse\//g) || []).length;
  const learningLinks = (html.match(/href="[^"]*\/learning\//g) || []).length;
  const expandables = (html.match(/data-testid="expandable-text-box"/g) || []).length;
  
  console.log('feed/update links:', feedLinks);
  console.log('/posts/ links:', postLinks);
  console.log('/pulse/ links:', articleLinks);
  console.log('/learning/ links:', learningLinks);
  console.log('expandable-text-box elements:', expandables);
  
  // Show sample hrefs
  const allHrefs = html.match(/href="https?:\/\/www\.linkedin\.com\/[^"]+"/g) || [];
  const unique = [...new Set(allHrefs.map(h => h.replace(/href="/, '').replace(/"$/, '').replace(/\?.*/, '').substring(0,80)))];
  console.log('\nSample LinkedIn URLs found:');
  unique.slice(0, 15).forEach(u => console.log(' ', u));
}
