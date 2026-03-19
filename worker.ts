import { Browser, BrowserContext, Page } from 'playwright';
import { PrismaClient } from '@prisma/client';
import {
  setUserContext,
  setApiBaseUrl,
  broadcastStatus,
  broadcastLog,
  broadcastError,
  broadcastScreenshot
} from './lib/worker-broadcast';

// Use Stealth Plugin via playwright-extra
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const prisma = new PrismaClient();

// ============================================================================
// CONFIG & STATE
// ============================================================================

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let isSystemActive = true;

// Throttling for Datacenter Stability
const MAX_SEARCHES_PER_RUN = 2;
const MAX_POSTS_PER_RUN = 20;

// ============================================================================
// BROWSER LIFECYCLE (STABILITY OPTIMIZED)
// ============================================================================

async function launchBrowser(settings: any) {
  console.log('🛡️ Launching Stealth-Optimized Scraper...');
  
  // 🛡️ EXTRACT PROXY FROM ENV OR SETTINGS
  const proxyConfig = {
    server: `http://${process.env.PROXY_HOST || 'brd.superproxy.io'}:${process.env.PROXY_PORT || '33335'}`,
    username: process.env.PROXY_USER || 'brd-customer-hl_848e74c6-zone-datacenter_proxy1',
    password: process.env.PROXY_PASS || 'k2fui3km5bqg'
  };

  const launchOptions: any = {
    headless: process.env.HEADLESS !== 'false',
    proxy: proxyConfig,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080',
      '--lang=en-US'
    ]
  };

  console.log(`📡 Deployment Proxy: ${proxyConfig.server}`);
  browser = await chromium.launch(launchOptions);
  
  context = await browser!.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York'
  });

  // Inject Dedicated LinkedIn Cookies
  if (settings.linkedinSessionCookie) {
    const cookies = [
      {
        name: 'li_at',
        value: settings.linkedinSessionCookie,
        domain: '.www.linkedin.com',
        path: '/'
      }
    ];
    
    // Attempt extract JSESSIONID
    if (settings.linkedinSessionCookie.includes('JSESSIONID=')) {
        const jid = settings.linkedinSessionCookie.match(/JSESSIONID="?([^";s]+)"?/)?.[1];
        if (jid) {
            cookies.push({ name: 'JSESSIONID', value: jid, domain: '.www.linkedin.com', path: '/' });
        }
    }

    await context.addCookies(cookies);
    console.log('🔑 Session cookies injected.');
  }

  page = await context.newPage();

  // 🕵️ IP & NAVIGATION VERIFICATION
  try {
    await page.goto('https://api.ipify.org', { timeout: 30000 });
    const ip = await page.innerText('body');
    console.log(`✅ Verified Proxy IP: ${ip}`);
    await broadcastLog(`Proxy Active: ${ip}`);

    // STABILITY FLOW: FEED FIRST
    console.log('🎭 Stability Warm-up: Navigating to Feed...');
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    // Check for Redirects/Checkpoints Early
    const url = page.url();
    if (url.includes('/checkpoint/') || url.includes('/login')) {
      throw new Error(`SECURITY_TRIGGERED: ${url}`);
    }

    console.log('🕒 Simulating Human Browsing (15s)...');
    await humanScroll(3); // Slight scroll on feed
    await page.waitForTimeout(randomInt(10000, 20000));
    
  } catch (e: any) {
    console.error(`❌ Launch Verification Failed: ${e.message}`);
    await broadcastError(`Launch Error: ${e.message}`);
    throw e;
  }
}

async function closeBrowser() {
  if (browser) await browser.close();
  browser = null;
  context = null;
  page = null;
}

// ============================================================================
// STABILITY-FIRST SCRAPING
// ============================================================================

async function scrapeKeyword(keyword: string) {
  if (!page) return [];
  
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=SWITCH_SEARCH_VERTICAL`;
  console.log(`🔍 Navigating to Search: ${keyword}`);
  
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  // Detect Checkpoint after navigation
  if (page.url().includes('/checkpoint/')) {
    console.log('🚨 Checkpoint detected on search page!');
    await broadcastError('Search Checkpoint Triggered. Stopping.');
    return [];
  }

  await broadcastStatus(`Searching: ${keyword}`);
  await page.waitForTimeout(randomInt(5000, 8000));

  // Gradual Human Scrolling
  console.log('📜 Performing Gradual Human Scroll...');
  for (let i = 0; i < 10; i++) {
    await humanScroll(1);
    await page.waitForTimeout(randomInt(3000, 6000));
    
    // Check for "See more"
    const moreBtn = await page.$('button.search-results-bottom-pagination__button');
    if (moreBtn && await moreBtn.isVisible()) {
      await moreBtn.click();
      await page.waitForTimeout(randomInt(4000, 7000));
    }
  }

  // Extraction
  const posts = await page.evaluate(() => {
    const results: any[] = [];
    const containers = document.querySelectorAll('.reusable-search__result-container');
    
    containers.forEach((container, index) => {
      if (index >= 20) return; // Cap for stability
      const urlEl = container.querySelector('a[href*="/feed/update/"]') as HTMLAnchorElement;
      if (!urlEl) return;
      
      const url = urlEl.href.split('?')[0];
      const text = (container as HTMLElement).innerText;
      
      let likes = 0; let comments = 0;
      const likeMatch = text.match(/(\d[\d,]*)\s*(reactions|likes)/i);
      if (likeMatch) likes = parseInt(likeMatch[1].replace(/,/g, ''));
      const commMatch = text.match(/(\d[\d,]*)\s*comments/i);
      if (commMatch) comments = parseInt(commMatch[1].replace(/,/g, ''));
      
      results.push({ url, likes, comments, author: 'Post Author', preview: text.substring(0, 200) });
    });
    return results;
  });

  return posts.slice(0, MAX_POSTS_PER_RUN);
}

// ============================================================================
// HELPERS
// ============================================================================

async function humanScroll(times: number) {
  if (!page) return;
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => window.scrollBy({ top: 400 + Math.random() * 400, behavior: 'smooth' }));
    await page.waitForTimeout(randomInt(1500, 3000));
  }
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

// ============================================================================
// MAIN LOOP
// ============================================================================

async function runSovereignWorker() {
  console.log('🚀 Stability-Optimized Cloud Worker Starting...');
  
  while (isSystemActive) {
    try {
      const allSettings = await prisma.settings.findMany({
        where: { systemActive: true },
        include: { user: { include: { keywords: { where: { active: true } } } } }
      });

      if (allSettings.length === 0) {
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }

      for (const setting of allSettings) {
        const { user, userId } = setting;
        setUserContext(userId);
        if (!user.keywords || user.keywords.length === 0) continue;
        
        await launchBrowser(setting);
        
        let searchCount = 0;
        for (const kw of user.keywords) {
          if (searchCount >= MAX_SEARCHES_PER_RUN) break;
          
          const results = await scrapeKeyword(kw.keyword);
          console.log(`✅ Processed ${results.length} posts for ${kw.keyword}`);
          
          if (results.length > 0) {
            const apiUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
            await fetch(`${apiUrl}/api/extension/results`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-extension-token': userId },
              body: JSON.stringify({ keyword: kw.keyword, posts: results })
            });
          }
          
          searchCount++;
          await page!.waitForTimeout(randomInt(10000, 20000)); // Big pause between searches
        }
        
        await closeBrowser();
      }

      await new Promise(r => setTimeout(r, 300000)); // 5 min interval for datacenter safety
      
    } catch (error: any) {
      console.error('❌ Stability Error:', error.message);
      await closeBrowser();
      await new Promise(r => setTimeout(r, 60000));
    }
  }
}

runSovereignWorker();