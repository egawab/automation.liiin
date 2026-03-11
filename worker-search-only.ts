/**
 * LinkedIn Search-Only Worker - CAPTCHA-Resistant Edition
 * 
 * This worker ONLY searches and saves post links - NO auto-commenting.
 * Designed to minimize CAPTCHA triggers through:
 * - Advanced stealth configuration
 * - Human-like behavior patterns
 * - Slower, randomized timing
 * - CAPTCHA detection and pause
 * 
 * Flow:
 * 1. Search LinkedIn for keywords
 * 2. Extract posts with engagement metrics
 * 3. Filter by reach criteria
 * 4. Save filtered post links to database
 * 5. User manually opens links from dashboard
 */

import 'dotenv/config';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { PrismaClient } from '@prisma/client';
import {
  setUserContext,
  setApiBaseUrl,
  broadcastStatus,
  broadcastAction,
  broadcastLog,
  broadcastError,
  broadcastScreenshot
} from './lib/worker-broadcast';

const prisma = new PrismaClient();

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface WorkerSettings {
  userId: string;
  linkedinSessionCookie: string;
  platformUrl: string;
  minLikes: number;
  maxLikes: number;
  minComments: number;
  maxComments: number;
  systemActive: boolean;
  searchOnlyMode: boolean;
  workHoursOnly: boolean;
  workHoursStart: number;
  workHoursEnd: number;
  skipWeekends: boolean;
  maxSearchesPerHour: number;
  maxSearchesPerDay: number;
  minDelayBetweenSearchesMinutes: number;
  maxKeywordsPerCycle: number;
}

interface KeywordData {
  id: string;
  keyword: string;
}

interface PostCandidate {
  url: string;
  author?: string;
  preview?: string;
  likes: number;
  comments: number;
}

// ============================================================================
// WORKER STATE
// ============================================================================

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let isRunning = false;
let currentUserId: string | null = null;
let currentSessionCookie: string | null = null;
let isAuthenticated = false;

// ============================================================================
// MAIN WORKER LOOP
// ============================================================================

async function main() {
  console.log('\n🔍 LinkedIn Search-Only Worker - Starting...\n');
  console.log('📋 Mode: Search and save links ONLY (no auto-commenting)\n');

  await broadcastStatus('Starting search-only worker...');

  while (true) {
    try {
      // Fetch settings
      const settings = await getActiveUserSettings();

      if (!settings || !settings.systemActive) {
        if (isRunning) {
          console.log('⏸️  No active users. Pausing worker...\n');
          await cleanup();
        }
        await sleep(5000);
        continue;
      }

      // Check if search-only mode is enabled
      if (!settings.searchOnlyMode) {
        console.log('⚠️  Search-only mode is disabled. Please enable it in settings.\n');
        await broadcastError('Search-only mode is disabled. Enable it in dashboard settings.');
        await sleep(10000);
        continue;
      }

      // Check work hours (skip if outside working hours)
      if (settings.workHoursOnly && !isWithinWorkHours(settings)) {
        const msg = 'Outside work hours. Waiting until next work period...';
        console.log(`⏰ ${msg}\n`);
        await broadcastStatus(msg);
        await sleep(300000); // Check again in 5 minutes
        continue;
      }

      // Check daily search limit
      const searchesToday = await getSearchCountInPeriod(settings.userId, 'day');
      if (searchesToday >= settings.maxSearchesPerDay) {
        const msg = `Daily limit reached (${searchesToday}/${settings.maxSearchesPerDay}). Resuming tomorrow.`;
        console.log(`⏹️  ${msg}\n`);
        await broadcastStatus(msg);
        await sleep(3600000); // Check again in 1 hour
        continue;
      }

      // Check hourly search limit
      const searchesThisHour = await getSearchCountInPeriod(settings.userId, 'hour');
      if (searchesThisHour >= settings.maxSearchesPerHour) {
        const msg = `Hourly limit reached (${searchesThisHour}/${settings.maxSearchesPerHour}). Waiting...`;
        console.log(`⏳ ${msg}\n`);
        await broadcastStatus(msg);
        await sleep(600000); // Wait 10 minutes before retry
        continue;
      }

      // Set user context for broadcasts
      setUserContext(settings.userId);
      // Ensure broadcasts go to the correct deployed dashboard URL (prevents 404s)
      if (settings.platformUrl && settings.platformUrl.trim()) {
        setApiBaseUrl(settings.platformUrl.trim());
      } else if (process.env.NEXT_PUBLIC_APP_URL) {
        setApiBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
      }

      // Initialize browser if needed
      if (!browser || currentUserId !== settings.userId || currentSessionCookie !== settings.linkedinSessionCookie) {
        console.log('🔄 User/session changed. Reinitializing browser...\n');
        
        if (browser) await cleanup();
        
        currentUserId = settings.userId;
        currentSessionCookie = settings.linkedinSessionCookie;
        
        await initializeBrowser();
        
        const authenticated = await authenticateLinkedIn(settings.linkedinSessionCookie);
        if (!authenticated) {
          await broadcastError('LinkedIn authentication failed. Please update your session cookie.');
          await sleep(30000);
          continue;
        }
        
        isAuthenticated = true;
        await broadcastStatus('✅ Authenticated - Ready to search');
      }

      // Fetch active keywords (limit to maxKeywordsPerCycle for safety)
      let keywords = await getActiveKeywords(settings.userId);
      keywords = keywords.slice(0, settings.maxKeywordsPerCycle);
      
      if (keywords.length === 0) {
        console.log('⚠️  No active keywords. Waiting...\n');
        await broadcastLog('No active keywords configured. Add keywords in dashboard.');
        await sleep(10000);
        continue;
      }

      console.log(`📊 Processing ${keywords.length} keyword(s) (max ${settings.maxKeywordsPerCycle} per cycle)...\n`);
      await broadcastStatus(`Searching ${keywords.length} keyword(s)...`);

      // Process each keyword
      for (const keyword of keywords) {
        // Re-check limits before each search
        if (await getSearchCountInPeriod(settings.userId, 'hour') >= settings.maxSearchesPerHour) {
          console.log('⏹️  Hourly limit reached. Stopping cycle.\n');
          break;
        }
        if (await getSearchCountInPeriod(settings.userId, 'day') >= settings.maxSearchesPerDay) {
          console.log('⏹️  Daily limit reached. Stopping cycle.\n');
          break;
        }

        // Check if system is still active
        const stillActive = await isSystemStillActive(settings.userId);
        if (!stillActive) {
          console.log('⏹️  System deactivated by user. Stopping...\n');
          break;
        }

        await processKeyword(keyword, settings);
        
        // Conservative delay between searches (5-10 minutes)
        const delayMinutes = settings.minDelayBetweenSearchesMinutes;
        const delaySeconds = randomBetween(delayMinutes * 60, (delayMinutes + 5) * 60);
        console.log(`⏱️  Waiting ${Math.round(delaySeconds / 60)} min before next search (conservative mode)...\n`);
        await sleep(delaySeconds * 1000);
      }

      // Longer delay between cycles (10-15 minutes in conservative mode)
      const cycleDelayMinutes = randomBetween(10, 15);
      console.log(`\n✅ Cycle complete. Next cycle in ${cycleDelayMinutes} minutes.\n`);
      await broadcastStatus(`Cycle complete. Next run in ${cycleDelayMinutes}m`);
      await sleep(cycleDelayMinutes * 60 * 1000);

    } catch (error: any) {
      console.error('❌ Worker error:', error.message);
      await broadcastError(`Worker error: ${error.message}`);
      
      // Check for CAPTCHA / anti-bot signals and respond based on severity
      const detection = await detectCaptcha();
      if (detection.level === 'hard') {
        await handleCaptcha(detection);
      } else if (detection.level === 'soft') {
        console.log('⚠️ Soft anti-bot signal after error:', detection.reason);
        await broadcastLog('Soft anti-bot signal after error. Cooling down briefly.', 'warn');
        await sleep(180000); // 3 minute cool-down on soft signal
      } else {
        await sleep(60000); // Wait 1 minute on generic error
      }
    }
  }
}

// ============================================================================
// KEYWORD PROCESSING
// ============================================================================

async function processKeyword(keyword: KeywordData, settings: WorkerSettings) {
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 Keyword: "${keyword.keyword}"`);
    console.log(`${'='.repeat(80)}\n`);

    await broadcastLog(`Searching for: "${keyword.keyword}"`);

    // Search LinkedIn
    const posts = await searchLinkedInPosts(keyword.keyword);

    // Log this search for rate limit tracking
    await logSearch(settings.userId, keyword.keyword);

    if (posts.length === 0) {
      console.log('❌ No posts found\n');
      await broadcastLog(`No posts found for "${keyword.keyword}"`);
      return;
    }

    console.log(`📊 Found ${posts.length} posts\n`);

    // Filter by reach criteria (strict matches)
    const strictMatches = posts.filter(post => 
      post.likes >= settings.minLikes &&
      post.likes <= settings.maxLikes &&
      post.comments >= settings.minComments &&
      post.comments <= settings.maxComments
    );

    console.log(`✅ ${strictMatches.length} posts match reach criteria\n`);
    await broadcastLog(`Found ${strictMatches.length} matching posts for "${keyword.keyword}"`);

    let postsToSave: PostCandidate[] = strictMatches;
    let usedFallback = false;

    // If no strict matches, fall back to closest posts by reach
    if (postsToSave.length === 0) {
      console.log('⚠️  No posts match your reach criteria exactly. Using closest posts by reach instead.\n');
      postsToSave = getClosestByReach(posts, settings, 10); // up to 10 closest posts
      usedFallback = postsToSave.length > 0;
      if (usedFallback) {
        await broadcastLog(
          `No strict matches for "${keyword.keyword}". Using ${postsToSave.length} closest posts by reach instead.`,
          'warn'
        );
      } else {
        await broadcastLog(
          `No posts with meaningful engagement for "${keyword.keyword}" (all zero likes/comments).`,
          'warn'
        );
      }
    }

    if (postsToSave.length === 0) {
      console.log('⚠️  No posts with meaningful engagement to save\n');
      return;
    }

    // Save all selected posts to database
    let savedCount = 0;
    for (const post of postsToSave) {
      const saved = await savePostToDatabase(post, keyword.keyword, settings.userId);
      if (saved) savedCount++;
    }

    console.log(`💾 Saved ${savedCount} new posts to dashboard\n`);
    await broadcastLog(
      `${usedFallback ? '✅ Saved closest-by-reach posts' : '✅ Saved strict matches'} for "${keyword.keyword}" (${savedCount} saved)`
    );

  } catch (error: any) {
    console.error(`❌ Error processing keyword "${keyword.keyword}":`, error.message);
    await broadcastError(`Failed to process "${keyword.keyword}": ${error.message}`);
  }
}

// ============================================================================
// LINKEDIN SEARCH
// ============================================================================

async function searchLinkedInPosts(keyword: string): Promise<PostCandidate[]> {
  if (!page) throw new Error('Browser not initialized');

  try {
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&sortBy=date_posted`;
    
    console.log(`🔍 Navigating to search page...`);
    
    // Human-like navigation with random delay
    await humanDelay(2000, 4000);
    
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for results to load
    await humanDelay(3000, 5000);

    // Random scroll to simulate human behavior
    await humanScroll(page);

    // Check for CAPTCHA / anti-bot signals
    const detection = await detectCaptcha();
    if (detection.level === 'hard') {
      console.log('🚨 Hard CAPTCHA / checkpoint detected during search:', detection.reason);
      await broadcastError(`Hard CAPTCHA detected during search: ${detection.reason}`);
      throw new Error('HARD_CAPTCHA_DETECTED_DURING_SEARCH');
    } else if (detection.level === 'soft') {
      console.log('⚠️ Soft anti-bot signal detected during search:', detection.reason);
      await broadcastLog('Soft anti-bot signal detected during search. Backing off but continuing.', 'warn');
      // Extra conservative backoff on soft signals
      await humanDelay(60000, 120000);
    }

    // Extract post data
    console.log(`📊 Extracting post data...`);
    
    const posts = await page.evaluate(() => {
      const results: any[] = [];
      
      // Try multiple selectors for LinkedIn's dynamic structure
      const postElements = document.querySelectorAll(
        '.reusable-search__result-container, .search-results-container .feed-shared-update-v2, [data-id^="urn:li:activity"]'
      );

      postElements.forEach((element, index) => {
        if (index >= 30) return; // Limit to 30 posts per keyword for safety

        try {
          // Extract post URL
          let postUrl = '';
          
          // Method 1: data-urn attribute
          const urn = element.getAttribute('data-urn') || element.getAttribute('data-id');
          if (urn) {
            const urnId = urn.split(':').pop();
            postUrl = `https://www.linkedin.com/feed/update/${urn}`;
          }
          
          // Method 2: Link in title/content
          if (!postUrl) {
            const link = element.querySelector('a[href*="/feed/update/"], a[href*="linkedin.com/posts/"]');
            if (link) {
              postUrl = link.getAttribute('href') || '';
              if (postUrl && !postUrl.startsWith('http')) {
                postUrl = 'https://www.linkedin.com' + postUrl;
              }
            }
          }

          if (!postUrl || !postUrl.includes('linkedin.com')) return;

          // Extract author
          const authorElement = element.querySelector('.update-components-actor__name, .feed-shared-actor__name');
          const author = authorElement?.textContent?.trim() || 'Unknown';

          // Extract post preview
          const previewElement = element.querySelector('.feed-shared-text, .update-components-text');
          const preview = previewElement?.textContent?.trim().substring(0, 200) || '';

          // Extract engagement metrics
          const socialCounts = element.querySelector('.social-details-social-counts');
          
          let likes = 0;
          let comments = 0;

          if (socialCounts) {
            // Try to find likes
            const likesText = socialCounts.textContent || '';
            const likesMatch = likesText.match(/(\d+(?:,\d+)?)\s*(?:reaction|like)/i);
            if (likesMatch) {
              likes = parseInt(likesMatch[1].replace(/,/g, ''));
            }

            // Try to find comments
            const commentsMatch = likesText.match(/(\d+(?:,\d+)?)\s*comment/i);
            if (commentsMatch) {
              comments = parseInt(commentsMatch[1].replace(/,/g, ''));
            }
          }

          results.push({
            url: postUrl,
            author,
            preview,
            likes,
            comments
          });

        } catch (err) {
          // Skip this post on error
        }
      });

      return results;
    });

    console.log(`✅ Extracted ${posts.length} posts\n`);
    
    // Log sample post for debugging
    if (posts.length > 0) {
      console.log('📋 Sample post:');
      console.log(`   Author: ${posts[0].author}`);
      console.log(`   Likes: ${posts[0].likes} | Comments: ${posts[0].comments}`);
      console.log(`   URL: ${posts[0].url}\n`);
    }

    return posts;

  } catch (error: any) {
    console.error('❌ Search error:', error.message);
    throw error;
  }
}

// ============================================================================
// RATE LIMITING & WORK HOURS
// ============================================================================

function isWithinWorkHours(settings: WorkerSettings): boolean {
  const now = new Date();
  
  if (settings.skipWeekends) {
    const day = now.getDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return false;
  }

  if (!settings.workHoursOnly) return true;

  const hour = now.getHours();
  return hour >= settings.workHoursStart && hour < settings.workHoursEnd;
}

async function getSearchCountInPeriod(userId: string, period: 'hour' | 'day'): Promise<number> {
  const since = new Date();
  if (period === 'hour') {
    since.setHours(since.getHours() - 1);
  } else {
    since.setDate(since.getDate() - 1);
  }

  const count = await prisma.log.count({
    where: {
      userId,
      action: 'SEARCH',
      timestamp: { gte: since }
    }
  });
  return count;
}

async function logSearch(userId: string, keyword: string): Promise<void> {
  try {
    await prisma.log.create({
      data: {
        userId,
        action: 'SEARCH',
        postUrl: `search:${keyword}`
      }
    });
  } catch (err) {
    console.error('Failed to log search:', err);
  }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function savePostToDatabase(post: PostCandidate, keyword: string, userId: string): Promise<boolean> {
  try {
    // Check if post already exists
    const existing = await prisma.savedPost.findFirst({
      where: {
        userId,
        postUrl: post.url
      }
    });

    if (existing) {
      return false; // Already saved
    }

    // Save new post
    await prisma.savedPost.create({
      data: {
        userId,
        postUrl: post.url,
        postAuthor: post.author,
        postPreview: post.preview,
        likes: post.likes,
        comments: post.comments,
        keyword,
        visited: false
      }
    });

    return true;

  } catch (error: any) {
    console.error('❌ Database save error:', error.message);
    return false;
  }
}

// Select up to maxCount posts closest to the target reach (minLikes/minComments)
function getClosestByReach(
  posts: PostCandidate[],
  settings: WorkerSettings,
  maxCount: number
): PostCandidate[] {
  const targetLikes = settings.minLikes;
  const targetComments = settings.minComments;

  return posts
    // Exclude posts with zero engagement (likely low-value or noise)
    .filter(p => p.likes > 0 || p.comments > 0)
    .map(p => {
      const likeDiff = Math.abs(p.likes - targetLikes);
      const commentDiff = Math.abs(p.comments - targetComments);
      const distance = likeDiff + commentDiff;
      return { post: p, distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxCount)
    .map(x => x.post);
}

// ============================================================================
// BROWSER MANAGEMENT WITH STEALTH
// ============================================================================

async function initializeBrowser() {
  console.log('🌐 Initializing stealth browser...\n');

  browser = await chromium.launch({
    headless: false, // Visible browser reduces suspicion
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      // Appear more human-like
      '--window-size=1920,1080',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });

  // Create stealth context
  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    permissions: [],
    // Add realistic browser properties
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    colorScheme: 'light'
  });

  // Advanced stealth scripts
  await context.addInitScript(() => {
    // Hide webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false
    });

    // Fix Chrome detection
    (window as any).chrome = {
      runtime: {}
    };

    // Add realistic plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });

    // Fix permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) => (
      parameters.name === 'notifications' 
        ? Promise.resolve({ state: 'denied' } as PermissionStatus)
        : originalQuery(parameters)
    );

    // Add realistic language
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
  });

  page = await context.newPage();

  // Dismiss any dialogs
  page.on('dialog', dialog => dialog.dismiss().catch(() => {}));

  isRunning = true;
  console.log('✅ Stealth browser initialized\n');
}

async function authenticateLinkedIn(sessionCookie: string): Promise<boolean> {
  if (!page || !context) throw new Error('Browser not initialized');

  try {
    console.log('🔐 Authenticating LinkedIn session...');

    // Set LinkedIn cookie
    await context.addCookies([{
      name: 'li_at',
      value: sessionCookie,
      domain: '.linkedin.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    }]);

    console.log('   Set LinkedIn session cookie');

    // Navigate to feed with human-like delay
    await humanDelay(2000, 4000);
    
    await page.goto('https://www.linkedin.com/feed', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await humanDelay(3000, 5000);

    // Check authentication
    const currentUrl = page.url();
    const isAuthenticated = await page.evaluate(() => {
      if (!window.location.hostname.includes('linkedin.com')) return false;
      if (window.location.pathname.includes('/login')) return false;
      if (window.location.pathname.includes('/checkpoint')) return false;
      
      // Check for navigation elements
      const hasNav = document.querySelector('nav[aria-label="Primary Navigation"], .global-nav');
      return !!hasNav;
    });

    if (isAuthenticated) {
      console.log('✅ LinkedIn authentication successful\n');
      await broadcastScreenshot(page, 'Authenticated on LinkedIn');

      // Warm up session with human-like browsing before searches
      await warmUpSession();

      return true;
    } else {
      console.log('❌ LinkedIn authentication failed\n');
      await broadcastScreenshot(page, 'Authentication failed');
      return false;
    }

  } catch (error: any) {
    console.error('❌ Authentication error:', error.message);
    return false;
  }
}

// ============================================================================
// CAPTCHA DETECTION & HANDLING
// ============================================================================

type CaptchaLevel = 'none' | 'soft' | 'hard';

interface CaptchaDetection {
  level: CaptchaLevel;
  reason: string;
  url?: string;
  title?: string;
  snippet?: string;
}

async function detectCaptcha(): Promise<CaptchaDetection> {
  if (!page) {
    return { level: 'none', reason: 'no-page' };
  }

  try {
    const info = await page.evaluate(() => {
      const url = window.location.href;
      const path = window.location.pathname;
      const title = document.title || '';
      const rawText = (document.body?.innerText || '').toLowerCase();
      const textSnippet = rawText.slice(0, 800);

      const isCheckpoint =
        path.includes('/checkpoint') ||
        path.includes('/authwall') ||
        url.includes('checkpoint') ||
        url.includes('authwall');

      const hasCaptchaElement = !!document.querySelector(
        'iframe[src*=\"captcha\"], iframe[src*=\"recaptcha\"], div[id*=\"captcha\"], div[class*=\"captcha\"]'
      );

      const strongPhrases = [
        "let's do a quick security check",
        'unusual activity on your account',
        'to help keep your account safe',
        'we detected suspicious activity',
        'we’ve detected suspicious activity',
        'to continue, please verify your identity'
      ];

      const hasStrongPhrase = strongPhrases.some((phrase) =>
        rawText.includes(phrase.toLowerCase())
      );

      return {
        url,
        path,
        title,
        textSnippet,
        isCheckpoint,
        hasCaptchaElement,
        hasStrongPhrase
      };
    });

    let level: CaptchaLevel = 'none';
    let reason = 'no captcha indicators';

    if (info.isCheckpoint || info.hasCaptchaElement) {
      level = 'hard';
      reason = 'checkpoint or captcha element detected';
    } else if (info.hasStrongPhrase) {
      level = 'soft';
      reason = 'strong anti-bot phrase detected';
    }

    if (level !== 'none') {
      console.log('\\n🚨 CAPTCHA / anti-bot signal detected');
      console.log(`   URL: ${info.url}`);
      console.log(`   Title: ${info.title}`);
      console.log(`   Reason: ${reason}`);
      console.log('   Snippet:', info.textSnippet?.slice(0, 200), '\\n');

      await broadcastScreenshot(page, 'CAPTCHA / anti-bot signal detected').catch(() => {});
      await broadcastLog(
        `CAPTCHA / anti-bot signal (${level}): ${reason} at ${info.url}`,
        level === 'hard' ? 'error' : 'warn'
      ).catch(() => {});
    }

    return {
      level,
      reason,
      url: info.url,
      title: info.title,
      snippet: info.textSnippet
    };
  } catch (err: any) {
    console.error('detectCaptcha error:', err?.message || err);
    return { level: 'none', reason: 'detection-error' };
  }
}

async function handleCaptcha(detection: CaptchaDetection) {
  console.log('\\n🚨 HARD CAPTCHA / CHECKPOINT DETECTED\\n');
  console.log('   The system has paused to avoid further detection.');
  console.log('   Please check the browser window for any security prompts or challenges.');
  console.log('   A longer cool-down will be applied before resuming.\\n');

  await broadcastError(
    `⚠️ Hard CAPTCHA detected (${detection.reason}). Worker entering extended cool-down.`
  );

  // Longer cool-down for hard blocks (e.g. 20 minutes)
  const cooldownMinutes = 20;
  await broadcastStatus(`Hard CAPTCHA cool-down for ${cooldownMinutes} minutes`);
  await sleep(cooldownMinutes * 60 * 1000);

  console.log('⏰ Exiting hard CAPTCHA cool-down. Worker will cautiously resume.\n');
  await broadcastStatus('Exiting hard CAPTCHA cool-down. Worker will cautiously resume.');
}

// ============================================================================
// HUMAN-LIKE BEHAVIOR UTILITIES
// ============================================================================

async function humanDelay(minMs: number, maxMs: number) {
  const delay = randomBetween(minMs, maxMs);
  await sleep(delay);
}

async function humanScroll(page: Page) {
  try {
    // Random scroll patterns
    const scrollCount = randomBetween(2, 5);
    
    for (let i = 0; i < scrollCount; i++) {
      const scrollAmount = randomBetween(200, 600);
      await page.evaluate((amount) => {
        window.scrollBy({
          top: amount,
          behavior: 'smooth'
        });
      }, scrollAmount);
      
      await humanDelay(500, 1500);
    }
    
    // Scroll back up
    await page.evaluate(() => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
    
  } catch {
    // Ignore scroll errors
  }
}

async function warmUpSession() {
  if (!page) return;

  try {
    console.log('🧊 Warming up LinkedIn session on feed...');

    // Scroll the feed a bit to look like a real user
    await humanScroll(page);
    await humanDelay(3000, 6000);

    // Optionally open 1–2 posts or profiles in the same tab
    const candidateLinks = await page.$$(
      'a[href*="/feed/update/"], a[href*="/in/"]:not([href*="miniProfileUrn"])'
    );

    const maxToOpen = Math.min(2, candidateLinks.length);
    for (let i = 0; i < maxToOpen; i++) {
      const link = candidateLinks[i];
      try {
        await link.click({ button: 'left' });
        await humanDelay(3000, 6000);
        await humanScroll(page);
        await humanDelay(2000, 4000);
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await humanDelay(2000, 4000);
      } catch {
        // Ignore single-link failures and continue
      }
    }

    console.log('✅ Warm-up sequence complete.\n');
  } catch (err: any) {
    console.log('Warm-up sequence error (non-fatal):', err?.message || err);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function cleanup() {
  console.log('\n🧹 Cleaning up...');

  if (page) {
    await page.close().catch(() => {});
    page = null;
  }

  if (context) {
    await context.close().catch(() => {});
    context = null;
  }

  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }

  await prisma.$disconnect();

  isRunning = false;
  isAuthenticated = false;
  
  console.log('✅ Cleanup complete\n');
}

// ============================================================================
// DATABASE QUERIES
// ============================================================================

async function getActiveUserSettings(): Promise<WorkerSettings | null> {
  const settings = await prisma.settings.findFirst({
    where: { systemActive: true },
    include: { user: true }
  });

  if (!settings) return null;

  return {
    userId: settings.userId,
    linkedinSessionCookie: settings.linkedinSessionCookie,
    platformUrl: settings.platformUrl,
    minLikes: settings.minLikes,
    maxLikes: settings.maxLikes,
    minComments: settings.minComments,
    maxComments: settings.maxComments,
    systemActive: settings.systemActive,
    searchOnlyMode: settings.searchOnlyMode,
    workHoursOnly: settings.workHoursOnly ?? true,
    workHoursStart: settings.workHoursStart ?? 9,
    workHoursEnd: settings.workHoursEnd ?? 18,
    skipWeekends: settings.skipWeekends ?? true,
    maxSearchesPerHour: settings.maxSearchesPerHour ?? 6,
    maxSearchesPerDay: settings.maxSearchesPerDay ?? 20,
    minDelayBetweenSearchesMinutes: settings.minDelayBetweenSearchesMinutes ?? 5,
    maxKeywordsPerCycle: settings.maxKeywordsPerCycle ?? 3
  };
}

async function getActiveKeywords(userId: string): Promise<KeywordData[]> {
  const keywords = await prisma.keyword.findMany({
    where: {
      userId,
      active: true
    }
  });

  return keywords.map(k => ({
    id: k.id,
    keyword: k.keyword
  }));
}

async function isSystemStillActive(userId: string): Promise<boolean> {
  const settings = await prisma.settings.findUnique({
    where: { userId }
  });

  return settings?.systemActive ?? false;
}

// ============================================================================
// STARTUP
// ============================================================================

process.on('SIGINT', async () => {
  console.log('\n\n⏹️  Shutdown signal received...');
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n⏹️  Shutdown signal received...');
  await cleanup();
  process.exit(0);
});

main().catch(async (error) => {
  console.error('💥 Fatal error:', error);
  await cleanup();
  process.exit(1);
});
