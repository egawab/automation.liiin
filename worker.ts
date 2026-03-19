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

const SLEEP_SHORT = 2000;
const SLEEP_LONG = 5000;

// ============================================================================
// BROWSER LIFECYCLE
// ============================================================================

async function launchBrowser(settings: any) {
  console.log('🌐 Launching Industrial Cloud Scraper...');
  
  // 🛡️ INDUSTRIAL PROXY SETTINGS
  const proxyConfig = {
    server: 'http://brd.superproxy.io:33335',
    username: 'brd-customer-hl_848e74c6-zone-datacenter_proxy1',
    password: 'k2fui3km5bqg'
  };

  const launchOptions: any = {
    headless: process.env.HEADLESS !== 'false',
    proxy: proxyConfig,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080'
    ]
  };

  console.log(`📡 Connecting through Proxy: ${proxyConfig.server}`);
  browser = await chromium.launch(launchOptions);
  
  context = await browser!.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });

  // Inject Cookies for Authentication (li_at + JSESSIONID)
  if (settings.linkedinSessionCookie) {
    const cookies = [
      {
        name: 'li_at',
        value: settings.linkedinSessionCookie,
        domain: '.www.linkedin.com',
        path: '/'
      }
    ];
    
    // Attempt to extract JSESSIONID if present in a larger cookie string
    if (settings.linkedinSessionCookie.includes('JSESSIONID=')) {
        const jid = settings.linkedinSessionCookie.match(/JSESSIONID="?([^";s]+)"?/)?.[1];
        if (jid) {
            cookies.push({
                name: 'JSESSIONID',
                value: jid,
                domain: '.www.linkedin.com',
                path: '/'
            });
        }
    }

    await context.addCookies(cookies);
    console.log('🔑 Session cookies injected.');
  }

  page = await context.newPage();

  // 🕵️ PHASE 0: FORENSIC VERIFICATION
  try {
    console.log('🕵️ Verification Phase: Checking IP and Connectivity...');
    await page.goto('https://api.ipify.org', { timeout: 30000 });
    const ip = await page.innerText('body');
    console.log(`✅ Using Proxy IP: ${ip}`);
    await broadcastLog(`Cloud Scraper Active - Proxy IP: ${ip}`);

    console.log('🕵️ Checking LinkedIn Session Health...');
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const currentUrl = page.url();
    
    if (currentUrl.includes('/checkpoint/') || currentUrl.includes('/login')) {
      console.log(`🚨 ALERT: Security Checkpoint detected! URL: ${currentUrl}`);
      await broadcastError(`Security Checkpoint Triggered! Session may need refresh. URL: ${currentUrl}`);
    } else {
      console.log('✅ LinkedIn Feed loaded successfully. Session is healthy.');
      await broadcastStatus('LinkedIn Session: Healthy & Verified');
    }
  } catch (e: any) {
    console.log(`⚠️ Verification failed: ${e.message}`);
    await broadcastError(`Cloud connectivity check failed: ${e.message}`);
  }
}

async function closeBrowser() {
  if (browser) await browser.close();
  browser = null;
  context = null;
  page = null;
}

// ============================================================================
// SCRAPING LOGIC
// ============================================================================

async function scrapeKeyword(keyword: string) {
  if (!page) return [];
  
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=SWITCH_SEARCH_VERTICAL`;
  console.log(`🔍 Navigating to: ${keyword}`);
  
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await broadcastStatus(`Searching: ${keyword}`);
  
  // Wait for results
  try {
    await page.waitForSelector('.reusable-search__result-container', { timeout: 15000 });
  } catch (e) {
    console.log('⚠️ No results appeared or timeout.');
    return [];
  }

  // Industrial Deep Scrolling (20 iterations)
  console.log('📜 Performing Industrial Deep Scroll...');
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(1500);
    
    // Click "See more results" if it exists
    const moreBtn = await page.$('button.search-results-bottom-pagination__button');
    if (moreBtn) await moreBtn.click();
  }

  // Extraction (Ported from extension/content.js logic)
  const posts = await page.evaluate(() => {
    const results: any[] = [];
    const containers = document.querySelectorAll('.reusable-search__result-container');
    
    containers.forEach(container => {
      const urlEl = container.querySelector('a[href*="/feed/update/"]') as HTMLAnchorElement;
      if (!urlEl) return;
      
      const url = urlEl.href.split('?')[0];
      const text = (container as HTMLElement).innerText;
      
      // Reach Parsing
      let likes = 0;
      let comments = 0;
      
      const likeMatch = text.match(/(\d[\d,]*)\s*(reactions|likes)/i);
      if (likeMatch) likes = parseInt(likeMatch[1].replace(/,/g, ''));
      
      const commMatch = text.match(/(\d[\d,]*)\s*comments/i);
      if (commMatch) comments = parseInt(commMatch[1].replace(/,/g, ''));
      
      results.push({
        url,
        likes,
        comments,
        author: 'Post Author',
        preview: text.substring(0, 200)
      });
    });
    
    return results;
  });

  return posts;
}

// ============================================================================
// MAIN LOOP
// ============================================================================

async function runSovereignWorker() {
  console.log('🚀 Sovereign Cloud Worker initialized.');
  
  while (isSystemActive) {
    try {
      // 1. Fetch ALL users that have systemActive = true
      const allSettings = await prisma.settings.findMany({
        where: { systemActive: true },
        include: { user: { include: { keywords: { where: { active: true } } } } }
      });

      if (allSettings.length === 0) {
        console.log('😴 No active users found. Sleeping...');
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }

      for (const setting of allSettings) {
        const { user, userId } = setting;
        setUserContext(userId);
        
        if (!user.keywords || user.keywords.length === 0) continue;
        
        await launchBrowser(setting);
        
        for (const kw of user.keywords) {
          const results = await scrapeKeyword(kw.keyword);
          console.log(`✅ Extracted ${results.length} posts for ${kw.keyword}`);
          
          if (results.length > 0) {
            // Send results to our own API
            const apiUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
            await fetch(`${apiUrl}/api/extension/results`, {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json',
                'x-extension-token': userId
              },
              body: JSON.stringify({
                keyword: kw.keyword,
                posts: results
              })
            });
          }
          
          // Wait between keywords to look human
          await new Promise(r => setTimeout(r, randomInt(15000, 30000)));
        }
        
        await closeBrowser();
      }

      // Cycle Delay
      await new Promise(r => setTimeout(r, 60000));
      
    } catch (error) {
      console.error('❌ Worker Loop Error:', error);
      await closeBrowser();
      await new Promise(r => setTimeout(r, 60000));
    }
  }
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

runSovereignWorker();