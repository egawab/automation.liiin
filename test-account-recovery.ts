/**
 * LinkedIn Account Recovery Test Script
 * 
 * This script helps you test if your LinkedIn account can recover from CAPTCHA flags.
 * It runs ultra-conservative tests and monitors for CAPTCHA triggers.
 * 
 * Usage: npx tsx test-account-recovery.ts
 */

import 'dotenv/config';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import readline from 'readline';

// ============================================================================
// CONFIGURATION
// ============================================================================

const TEST_CONFIG = {
  // Ultra-conservative settings
  SEARCH_KEYWORD: 'AI automation',
  MAX_POSTS_TO_FIND: 5, // Very low limit for testing
  TEST_DURATION_MINUTES: 5, // Short test duration
  
  // Delays (longer than production)
  INITIAL_DELAY_MS: 5000, // Wait 5s after page load
  SCROLL_DELAY_MS: 3000, // Wait 3s between scrolls
  
  // LinkedIn cookie (will prompt user)
  LINKEDIN_COOKIE: '',
};

// ============================================================================
// STATE
// ============================================================================

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let captchaDetected = false;
let testStartTime: number = 0;

// ============================================================================
// CONSOLE COLORS
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message: string) {
  log(`✅ ${message}`, colors.green);
}

function logError(message: string) {
  log(`❌ ${message}`, colors.red);
}

function logWarning(message: string) {
  log(`⚠️  ${message}`, colors.yellow);
}

function logInfo(message: string) {
  log(`ℹ️  ${message}`, colors.cyan);
}

function logSection(title: string) {
  console.log('\n' + '='.repeat(80));
  log(title, colors.bright + colors.magenta);
  console.log('='.repeat(80) + '\n');
}

// ============================================================================
// USER INPUT
// ============================================================================

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ============================================================================
// CAPTCHA DETECTION
// ============================================================================

async function detectCaptcha(): Promise<boolean> {
  if (!page) return false;

  try {
    const hasCaptcha = await page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      const captchaKeywords = [
        'captcha',
        'challenge',
        'verify you',
        'security check',
        'unusual activity',
        'prove you\'re not a robot',
        'recaptcha',
        'please verify',
      ];

      // Check for CAPTCHA keywords
      const hasKeyword = captchaKeywords.some(keyword => bodyText.includes(keyword));
      
      // Check for checkpoint URL
      const isCheckpoint = window.location.pathname.includes('/checkpoint');
      
      // Check for CAPTCHA iframe
      const hasCaptchaFrame = document.querySelector('iframe[src*="captcha"], iframe[src*="recaptcha"]');
      
      return hasKeyword || isCheckpoint || !!hasCaptchaFrame;
    });

    if (hasCaptcha && !captchaDetected) {
      captchaDetected = true;
      logError('CAPTCHA DETECTED!');
      await takeScreenshot('captcha-detected');
    }

    return hasCaptcha;

  } catch (error) {
    return false;
  }
}

// ============================================================================
// SCREENSHOT
// ============================================================================

async function takeScreenshot(name: string) {
  if (!page) return;

  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const filename = `screenshot-${name}-${timestamp}.png`;
    
    await page.screenshot({ 
      path: filename,
      fullPage: true 
    });
    
    logInfo(`Screenshot saved: ${filename}`);
  } catch (error) {
    logWarning('Failed to take screenshot');
  }
}

// ============================================================================
// BROWSER INITIALIZATION
// ============================================================================

async function initializeBrowser() {
  logSection('PHASE 1: Browser Initialization');

  logInfo('Launching stealth browser...');

  browser = await chromium.launch({
    headless: false, // Visible browser
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080',
    ]
  });

  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  // Stealth scripts
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false
    });

    (window as any).chrome = {
      runtime: {}
    };

    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
  });

  page = await context.newPage();
  page.on('dialog', dialog => dialog.dismiss().catch(() => {}));

  logSuccess('Browser initialized successfully');
}

// ============================================================================
// AUTHENTICATION TEST
// ============================================================================

async function testAuthentication(cookie: string): Promise<boolean> {
  if (!page || !context) return false;

  logSection('PHASE 2: Authentication Test');

  try {
    // Set LinkedIn cookie
    logInfo('Setting LinkedIn session cookie...');
    await context.addCookies([{
      name: 'li_at',
      value: cookie,
      domain: '.linkedin.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    }]);

    logInfo('Navigating to LinkedIn feed...');
    await page.goto('https://www.linkedin.com/feed', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(5000);

    // Check for CAPTCHA immediately
    if (await detectCaptcha()) {
      logError('CAPTCHA detected on feed page');
      logError('Your account is still flagged');
      await takeScreenshot('auth-failed-captcha');
      return false;
    }

    // Check if authenticated
    const currentUrl = page.url();
    logInfo(`Current URL: ${currentUrl}`);

    if (currentUrl.includes('/login') || currentUrl.includes('/uas/login')) {
      logError('Redirected to login page - cookie invalid or expired');
      await takeScreenshot('auth-failed-login');
      return false;
    }

    if (currentUrl.includes('/checkpoint')) {
      logError('Redirected to checkpoint - account flagged');
      await takeScreenshot('auth-failed-checkpoint');
      return false;
    }

    // Check for nav elements
    const isAuthenticated = await page.evaluate(() => {
      const hasNav = document.querySelector('nav[aria-label="Primary Navigation"], .global-nav');
      return !!hasNav;
    });

    if (isAuthenticated) {
      logSuccess('Authentication successful!');
      await takeScreenshot('auth-success');
      return true;
    } else {
      logError('Authentication failed - no navigation elements found');
      await takeScreenshot('auth-failed-no-nav');
      return false;
    }

  } catch (error: any) {
    logError(`Authentication error: ${error.message}`);
    return false;
  }
}

// ============================================================================
// SEARCH TEST
// ============================================================================

async function testSearch(keyword: string): Promise<boolean> {
  if (!page) return false;

  logSection('PHASE 3: Search Test');

  try {
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}`;
    
    logInfo(`Searching for: "${keyword}"`);
    logInfo('Navigating to search page...');

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(TEST_CONFIG.INITIAL_DELAY_MS);

    // Check for CAPTCHA after search
    if (await detectCaptcha()) {
      logError('CAPTCHA detected during search');
      return false;
    }

    // Simulate human scrolling
    logInfo('Simulating human scrolling...');
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        window.scrollBy({
          top: Math.random() * 400 + 200,
          behavior: 'smooth'
        });
      });
      
      await page.waitForTimeout(TEST_CONFIG.SCROLL_DELAY_MS);

      // Check for CAPTCHA after each scroll
      if (await detectCaptcha()) {
        logError('CAPTCHA detected during scrolling');
        return false;
      }
    }

    // Extract posts
    logInfo('Extracting post data...');
    
    const posts = await page.evaluate(() => {
      const results: any[] = [];
      const postElements = document.querySelectorAll(
        '.reusable-search__result-container, .search-results-container .feed-shared-update-v2'
      );

      postElements.forEach((element, index) => {
        if (index >= 5) return; // Limit to 5 posts

        try {
          const link = element.querySelector('a[href*="/feed/update/"]');
          const postUrl = link?.getAttribute('href') || '';
          
          if (postUrl && postUrl.includes('linkedin.com')) {
            results.push({
              url: postUrl,
              found: true
            });
          }
        } catch (err) {
          // Skip
        }
      });

      return results;
    });

    if (posts.length > 0) {
      logSuccess(`Found ${posts.length} posts`);
      logInfo('Sample post URLs:');
      posts.slice(0, 3).forEach((post, i) => {
        console.log(`   ${i + 1}. ${post.url}`);
      });
      await takeScreenshot('search-success');
      return true;
    } else {
      logWarning('No posts found (might be search results issue, not necessarily CAPTCHA)');
      await takeScreenshot('search-no-results');
      return true; // Not necessarily a failure
    }

  } catch (error: any) {
    logError(`Search error: ${error.message}`);
    return false;
  }
}

// ============================================================================
// MAIN TEST
// ============================================================================

async function runRecoveryTest() {
  testStartTime = Date.now();

  // Welcome screen
  logSection('LinkedIn Account Recovery Test');
  console.log('This script will test if your LinkedIn account can handle automation.\n');
  console.log('The test will:');
  console.log('  1. Initialize a stealth browser');
  console.log('  2. Test authentication with your cookie');
  console.log('  3. Perform a conservative search test');
  console.log('  4. Monitor for CAPTCHA at each step\n');
  console.log('If CAPTCHA is detected at ANY point, the test will stop immediately.\n');

  // Get cookie from user
  const cookie = await promptUser('Enter your LinkedIn session cookie (li_at value): ');
  
  if (!cookie || cookie.length < 20) {
    logError('Invalid cookie provided. Exiting.');
    process.exit(1);
  }

  TEST_CONFIG.LINKEDIN_COOKIE = cookie;

  console.log('\n');
  logInfo('Starting test in 3 seconds...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    // Phase 1: Browser init
    await initializeBrowser();
    
    if (captchaDetected) {
      logError('Test failed at browser initialization');
      return;
    }

    // Phase 2: Authentication
    const authSuccess = await testAuthentication(TEST_CONFIG.LINKEDIN_COOKIE);
    
    if (!authSuccess || captchaDetected) {
      logError('Test failed at authentication phase');
      logWarning('Your account is still flagged or cookie is invalid');
      logInfo('Recommendation: Wait 24-48 hours and try again, or create new account');
      return;
    }

    // Phase 3: Search test
    const searchSuccess = await testSearch(TEST_CONFIG.SEARCH_KEYWORD);
    
    if (!searchSuccess || captchaDetected) {
      logError('Test failed at search phase');
      logWarning('Your account can authenticate but search triggers CAPTCHA');
      logInfo('Recommendation: Wait 3-7 days for full recovery, or create new account');
      return;
    }

    // Success!
    logSection('TEST RESULTS');
    logSuccess('All tests passed!');
    logSuccess('Your account appears to be recovering');
    console.log('\n');
    logInfo('Next steps:');
    console.log('  1. Try running the worker with ultra-conservative settings');
    console.log('  2. Use only 1 keyword');
    console.log('  3. Set high Min Likes threshold (100+)');
    console.log('  4. Run for maximum 30 minutes');
    console.log('  5. Monitor closely for any CAPTCHA');
    console.log('\n');
    logWarning('Remember: If CAPTCHA appears during worker, stop immediately!');

  } catch (error: any) {
    logError(`Test error: ${error.message}`);
  } finally {
    const testDuration = Math.round((Date.now() - testStartTime) / 1000);
    logInfo(`Total test duration: ${testDuration} seconds`);
    
    await cleanup();
  }
}

// ============================================================================
// CLEANUP
// ============================================================================

async function cleanup() {
  logInfo('Cleaning up...');

  if (page) {
    await page.close().catch(() => {});
  }

  if (context) {
    await context.close().catch(() => {});
  }

  if (browser) {
    await browser.close().catch(() => {});
  }

  logSuccess('Cleanup complete');
}

// ============================================================================
// SIGNAL HANDLERS
// ============================================================================

process.on('SIGINT', async () => {
  console.log('\n\n');
  logWarning('Test interrupted by user');
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n');
  logWarning('Test terminated');
  await cleanup();
  process.exit(0);
});

// ============================================================================
// RUN
// ============================================================================

runRecoveryTest().catch(async (error) => {
  logError(`Fatal error: ${error.message}`);
  await cleanup();
  process.exit(1);
});
