const fs = require('fs');

try {
  let bg = fs.readFileSync('extension/background.js', 'utf8');
  
  bg = bg.replace(/comments:\s*null,/, 'comments: p.comments,');
  
  fs.writeFileSync('extension/background.js', bg, 'utf8');
  console.log('Successfully patched comments hardcoding');
} catch(e) {
  console.error(e);
}
