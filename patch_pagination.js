const fs = require('fs');

try {
  let bg = fs.readFileSync('extension/background.js', 'utf8');
  let ct = fs.readFileSync('extension/content.js', 'utf8');

  const clickLogic = `
    var nextBtn = document.querySelector('.artdeco-pagination__button--next, button[aria-label="Next"]');
    if (nextBtn && !nextBtn.disabled) {
      var rect = nextBtn.getBoundingClientRect();
      if (rect.top >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + 500) {
        try { nextBtn.click(); } catch(e){}
      } else {
        window.scrollBy(0, 1000);
      }
    } else {
      window.scrollBy(0, 800);
    }
  `;

  // In background.js
  bg = bg.replace(/var nextBtn = document\.querySelector[\s\S]*?try \{ nextBtn\.click\(\); \} catch\(e\)\{\}\n    \}/, clickLogic);

  // In content.js
  ct = ct.replace(/var nextBtn = document\.querySelector[\s\S]*?try \{ nextBtn\.click\(\); \} catch\(e\)\{\}\n    \}/, clickLogic);

  fs.writeFileSync('extension/background.js', bg, 'utf8');
  fs.writeFileSync('extension/content.js', ct, 'utf8');
  console.log('Successfully patched pagination logic');
} catch(e) {
  console.error(e);
}
