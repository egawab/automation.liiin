const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROFILE_DIR = path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');

(async () => {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 800 },
  });
  
  const page = browser.pages()[0] || await browser.newPage();
  await page.goto('https://www.linkedin.com/search/results/content/?keywords=marketing&origin=GLOBAL_SEARCH_HEADER');
  
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.scrollBy(0, 1000));
  await page.waitForTimeout(3000);
  
  const html = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('li.reusable-search__result-container, div.occludable-update')).map(el => el.outerHTML).join('\n\n\n\n');
  });
  
  fs.writeFileSync('debug-linkedin.html', html);
  console.log('Saved ' + html.length + ' bytes to debug-linkedin.html');
  
  await browser.close();
})();
