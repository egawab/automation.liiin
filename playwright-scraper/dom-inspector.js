// dom-inspector.js — Run with the actual LinkedIn session to inspect real DOM structure
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
  
  // Go to marketing search
  await page.goto('https://www.linkedin.com/search/results/content/?keywords=marketing&origin=GLOBAL_SEARCH_HEADER', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });

  // Wait for content
  await page.waitForTimeout(6000);

  // Scroll slowly 3 times to trigger lazy loading
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(3000);
  }

  // Full DOM inspection
  const report = await page.evaluate(() => {
    // 1. Count known selectors
    const counts = {
      liContainers: document.querySelectorAll('li.reusable-search__result-container').length,
      dataUrnAny: document.querySelectorAll('[data-urn]').length,
      dataEntityUrn: document.querySelectorAll('[data-entity-urn]').length,
      occludable: document.querySelectorAll('.occludable-update').length,
      feedShared: document.querySelectorAll('.feed-shared-update-v2').length,
      expandableText: document.querySelectorAll('[data-testid="expandable-text-box"]').length,
      pDirAuto: document.querySelectorAll('p[dir="auto"]').length,
      postLinks: document.querySelectorAll('a[href*="/posts/"]').length,
      feedLinks: document.querySelectorAll('a[href*="feed/update"]').length,
    };

    // 2. Inspect actual <li> items that contain post links
    const postLiItems = Array.from(document.querySelectorAll('li')).filter(li =>
      li.querySelector('a[href*="/posts/"]') || li.querySelector('a[href*="feed/update"]')
    );

    const liSample = postLiItems.slice(0, 5).map(li => {
      const links = Array.from(li.querySelectorAll('a[href*="/posts/"], a[href*="feed/update"]'))
        .map(a => a.href.substring(0, 100));
      const expandables = Array.from(li.querySelectorAll('[data-testid="expandable-text-box"]')).length;
      const pDirAuto = Array.from(li.querySelectorAll('p[dir="auto"]')).length;
      const ariaLabels = Array.from(li.querySelectorAll('[aria-label]'))
        .filter(el => /\d+.*(reaction|comment|like)/i.test(el.getAttribute('aria-label') || ''))
        .map(el => el.getAttribute('aria-label'));
      return {
        tagName: li.tagName,
        className: li.className.substring(0, 100),
        innerTextLength: (li.innerText || '').length,
        ids19: (li.innerHTML.match(/[0-9]{19}/g) || []).slice(0, 3),
        postLinks: links.slice(0, 2),
        expandableCount: expandables,
        pDirAutoCount: pDirAuto,
        ariaLabels: ariaLabels.slice(0, 3),
        firstExpandableText: expandables > 0 ? (li.querySelector('[data-testid="expandable-text-box"]').innerText || '').substring(0, 100) : 'N/A',
      };
    });

    // 3. Check if any single <li> contains multiple post IDs (overlap problem)
    const overlapCheck = postLiItems.slice(0, 5).map(li => {
      const ids = (li.innerHTML.match(/[0-9]{19}/g) || []);
      const unique = [...new Set(ids)];
      return { className: li.className.substring(0, 60), uniqueIds: unique };
    });

    // 4. Engagement elements
    const engagements = Array.from(document.querySelectorAll('[aria-label]'))
      .filter(el => /(\d+.*reaction|\d+.*comment|\d+.*like)/i.test(el.getAttribute('aria-label') || ''))
      .slice(0, 8)
      .map(el => ({
        tag: el.tagName,
        label: el.getAttribute('aria-label'),
        parentClass: (el.parentElement?.className || '').substring(0, 80),
      }));

    // 5. Data-URN inspection
    const dataUrns = Array.from(document.querySelectorAll('[data-urn]'))
      .slice(0, 5)
      .map(el => ({
        tag: el.tagName,
        urn: el.getAttribute('data-urn'),
        className: el.className.substring(0, 80),
      }));

    return { counts, liSample, overlapCheck, engagements, dataUrns };
  });

  fs.writeFileSync('dom-report.json', JSON.stringify(report, null, 2));
  console.log('== DOM REPORT ==');
  console.log('Selector counts:', JSON.stringify(report.counts, null, 2));
  console.log('\nPost LI items found:', report.liSample.length);
  console.log('\nFirst LI sample:', JSON.stringify(report.liSample[0], null, 2));
  console.log('\nOverlap check (multiple IDs per li?):', JSON.stringify(report.overlapCheck, null, 2));
  console.log('\nEngagement elements:', JSON.stringify(report.engagements, null, 2));
  console.log('\nData-URN elements:', JSON.stringify(report.dataUrns, null, 2));
  console.log('\nFull report saved to dom-report.json');

  await browser.close();
})();
