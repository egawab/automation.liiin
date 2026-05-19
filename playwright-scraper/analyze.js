const fs = require('fs');
const html = fs.readFileSync('debug-main-relevance_all.html', 'utf8');
console.log('feed-shared-update-v2:', html.split('feed-shared-update-v2').length - 1);
console.log('expandable-text-box:', html.split('expandable-text-box').length - 1);
console.log('urn:li:activity:', html.split('urn:li:activity:').length - 1);
console.log('search-results-container:', html.split('search-results-container').length - 1);
console.log('componentkey:', html.split('componentkey').length - 1);
