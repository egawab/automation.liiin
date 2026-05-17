const fs = require('fs');
const html = fs.readFileSync('debug-main-recent.html', 'utf8').substring(0, 500000);

// Find "1 reaction" context
const idx = html.indexOf('1 reaction');
if (idx !== -1) {
  console.log('Context around "1 reaction":');
  console.log(html.substring(Math.max(0, idx - 500), idx + 300));
}

// Find all number + reaction/comment patterns
const lines = html.split('<');
const engLines = lines.filter(l => /\d+.*reaction|\d+.*comment/i.test(l));
console.log('\nLines with reaction/comment numbers:');
engLines.slice(0, 10).forEach(l => console.log(' <' + l.substring(0, 150)));

// Find social counts - LinkedIn often uses specific classes for these
const socialCounts = html.match(/<span[^>]*>[\s\n]*[0-9]+[\s\n]*<\/span>/g) || [];
console.log('\nNumeric-only spans (potential counts):');
socialCounts.slice(0, 15).forEach(s => console.log(' ', s));
