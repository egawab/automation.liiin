// dom-inspector2.js — Deep structural analysis
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROFILE_DIR = path.join(os.homedir(), '.nexora_scraper', 'profile');

(async () => {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const page = browser.pages()[0] || await browser.newPage();
  await page.goto('https://www.linkedin.com/search/results/content/?keywords=marketing&origin=GLOBAL_SEARCH_HEADER', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(6000);
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 600)); await page.waitForTimeout(3000); }

  const report = await page.evaluate(() => {
    // For each feedLink, trace the ancestor chain and find text/engagement nearby
    const feedLinks = Array.from(document.querySelectorAll('a[href*="feed/update/urn:li:"]'));
    
    const perPost = feedLinks.slice(0, 5).map(a => {
      const urn = (a.href.match(/urn:li:(activity|ugcPost|share):[0-9]{10,25}/) || [])[0];
      
      // Trace ancestors: tag+class for each level up
      const ancestors = [];
      let el = a.parentElement;
      for (let i = 0; i < 25 && el && el !== document.body; i++) {
        ancestors.push({
          level: i,
          tag: el.tagName,
          className: el.className.substring(0, 80),
          childCount: el.children.length,
          hasExpandable: el.querySelector('[data-testid="expandable-text-box"]') !== null,
          expandableCount: el.querySelectorAll('[data-testid="expandable-text-box"]').length,
          hasAriaEngagement: Array.from(el.querySelectorAll('[aria-label]')).some(x => /\d+.*(reaction|comment|like)/i.test(x.getAttribute('aria-label') || '')),
          textLen: (el.innerText || '').length,
        });
        // Stop when we find something that isolates this post
        if (i > 2 && el.querySelectorAll('a[href*="feed/update/urn:li:"]').length === 1) {
          ancestors.push({ NOTE: 'SINGLE-POST BOUNDARY FOUND HERE at level ' + i });
          break;
        }
        el = el.parentElement;
      }
      
      // Find the first ancestor that ONLY contains this one post link
      let isolatedContainer = a.parentElement;
      let isolatedLevel = 0;
      let el2 = a.parentElement;
      for (let i = 0; i < 25 && el2 && el2 !== document.body; i++) {
        const postLinksCount = el2.querySelectorAll('a[href*="feed/update/urn:li:"]').length;
        if (postLinksCount === 1) { isolatedContainer = el2; isolatedLevel = i; }
        el2 = el2.parentElement;
      }
      
      const expandableInContainer = isolatedContainer.querySelectorAll('[data-testid="expandable-text-box"]');
      const engagementInContainer = Array.from(isolatedContainer.querySelectorAll('[aria-label]'))
        .filter(el => /\d+.*(reaction|comment|like)/i.test(el.getAttribute('aria-label') || ''))
        .map(el => el.getAttribute('aria-label'));

      return {
        urn,
        href: a.href.substring(0, 100),
        isolatedAtLevel: isolatedLevel,
        isolatedContainerClass: isolatedContainer.className.substring(0, 100),
        isolatedContainerTag: isolatedContainer.tagName,
        expandableCount: expandableInContainer.length,
        firstExpandableText: expandableInContainer[0] ? (expandableInContainer[0].innerText || '').substring(0, 150) : 'NONE',
        engagements: engagementInContainer,
        ancestors: ancestors.slice(0, 8),
      };
    });

    return perPost;
  });

  fs.writeFileSync('dom-report2.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('\nFull report saved to dom-report2.json');
  await browser.close();
})();
