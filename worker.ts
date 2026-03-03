/**
 * LinkedIn Automation Worker - Complete Rebuild
 * 
 * Architecture:
 * - Strict keyword-comment matching (no cross-contamination)
 * - Transparent post selection (closest to minimum reach)
 * - Verified success only (comment must appear in DOM)
 * - Real-time dashboard updates (live SSE streaming)
 * - Headed browser mode (visible automation)
 * 
 * Flow:
 * 1. Fetch active keywords with their comments
 * 2. For each keyword:
 *    - Search LinkedIn
 *    - Collect posts with engagement metrics
 *    - Filter by reach (min/max likes & comments)
 *    - Select closest to minimum reach
 *    - Post comment (type, submit, verify)
 *    - Broadcast success/failure in real-time
 * 3. Wait 2 seconds between keywords
 * 4. Repeat cycle
 */

import 'dotenv/config'; // MUST be first — loads DATABASE_URL before PrismaClient initializes
import { chromium, Browser, Page } from 'playwright';
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
}

interface KeywordData {
  id: string;
  keyword: string;
  comments: CommentData[];
}

interface CommentData {
  id: string;
  text: string;
}

interface PostCandidate {
  url: string;
  likes: number;
  comments: number;
  distance: number; // Distance from minimum reach
}

interface ProcessingResult {
  success: boolean;
  keyword: string;
  commentText?: string;
  postUrl?: string;
  commentUrl?: string;
  reason?: string;
  selectedPost?: {
    likes: number;
    comments: number;
  };
}

// ============================================================================
// WORKER STATE
// ============================================================================

let browser: Browser | null = null;
let page: Page | null = null;
let isRunning = false;
let currentUserId: string | null = null;
let currentSessionCookie: string | null = null; // Track current session
let isAuthenticated = false; // Global auth state

// ============================================================================
// MAIN WORKER LOOP
// ============================================================================

async function main() {
  console.log('\n🚀 LinkedIn Automation Worker - Starting...\n');

  try {
    // Initialize browser
    await initializeBrowser();

    // Main loop
    while (isRunning) {
      try {
        // Fetch active user settings
        const settings = await getActiveUserSettings();

        if (!settings) {
          console.log('⏸️  No active user found. Waiting...');
          isAuthenticated = false;
          await sleep(10000); // Wait 10 seconds
          continue;
        }

        // Check if user or session changed - recreate browser context if needed
        const sessionChanged = currentUserId !== settings.userId ||
          currentSessionCookie !== settings.linkedinSessionCookie;

        if (sessionChanged && currentUserId !== null) {
          console.log('🔄 User or session changed. Recreating browser context...');
          await recreateBrowserContext();
          isAuthenticated = false; // Force re-auth on session change
        }

        // Set user context for broadcasts
        currentUserId = settings.userId;
        currentSessionCookie = settings.linkedinSessionCookie;
        setUserContext(settings.userId);
        if (settings.platformUrl) {
          setApiBaseUrl(settings.platformUrl);
        }

        // Authenticate only once per session (not every cycle)
        if (!isAuthenticated) {
          const authenticated = await authenticateLinkedIn(settings.linkedinSessionCookie);
          if (!authenticated) {
            await broadcastError('LinkedIn authentication failed. Please update your session cookie.');
            await sleep(60000); // Wait 1 minute before retry
            continue;
          }
          isAuthenticated = true;
        }

        await broadcastStatus('RUNNING', { message: 'Worker is active and processing keywords' });

        // Fetch active keywords with their comments
        const keywords = await getActiveKeywords(settings.userId);

        if (keywords.length === 0) {
          console.log('⏸️  No active keywords found. Waiting...');
          await broadcastLog('No active keywords found. Add keywords to start automation.');
          await sleep(5000); // Wait 5 seconds
          continue;
        }

        console.log(`\n📋 Found ${keywords.length} active keyword(s) to process\n`);

        // Process each keyword
        for (const keyword of keywords) {
          // Safety check: Ensure page is still valid
          if (!page || page.isClosed()) {
            console.log('   ⚠️ Browser page closed during cycle. Recreating context...');
            await recreateBrowserContext();
            isAuthenticated = false; // Need re-auth
            await authenticateLinkedIn(settings.linkedinSessionCookie);
            isAuthenticated = true;
          }

          // Check if still active
          const stillActive = await isSystemStillActive(settings.userId);
          if (!stillActive) {
            console.log('⏸️  System deactivated by user. Stopping...');
            await broadcastStatus('STOPPED', { message: 'Worker stopped by user' });
            isRunning = false;
            break;
          }

          // Process single keyword
          const result = await processKeyword(keyword, settings);

          // Log result to database
          await logResult(result, settings.userId);

          // Broadcast result
          if (result.success) {
            await broadcastAction('COMMENT_POSTED', {
              keyword: result.keyword,
              postUrl: result.postUrl,
              commentUrl: result.commentUrl,
              commentText: result.commentText,
              selectedPost: result.selectedPost
            });
          } else {
            await broadcastError(`Failed to process keyword "${result.keyword}": ${result.reason}`);
          }

          // Wait 2 seconds before next keyword
          await sleep(2000);
        }

        console.log('\n✅ Cycle complete. Starting next cycle...\n');
        await sleep(2000); // Max 2 seconds between cycles

      } catch (error: any) {
        console.error('❌ Error in worker loop:', error);
        await broadcastError(`Worker error: ${error.message}`);
        await sleep(5000); // Wait 5 seconds on error
      }
    }

  } catch (error: any) {
    console.error('❌ Fatal worker error:', error);
    await broadcastError(`Fatal error: ${error.message}`);
  } finally {
    await cleanup();
  }
}

// ============================================================================
// KEYWORD PROCESSING
// ============================================================================

async function processKeyword(
  keywordData: KeywordData,
  settings: WorkerSettings
): Promise<ProcessingResult> {
  const { keyword, comments } = keywordData;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📍 Processing Keyword: "${keyword}"`);
  console.log(`${'='.repeat(80)}\n`);

  try {
    // Validate keyword has comments
    if (comments.length === 0) {
      console.log(`⚠️  No comments found for keyword "${keyword}". Skipping.`);
      return {
        success: false,
        keyword,
        reason: 'No comments associated with this keyword'
      };
    }

    // Broadcast action
    await broadcastAction('PROCESSING_KEYWORD', { keyword, commentCount: comments.length });

    // Step 1: Search LinkedIn for keyword
    console.log(`🔍 Searching LinkedIn for: "${keyword}"`);
    await broadcastLog(`Searching LinkedIn for keyword: "${keyword}"`);

    const posts = await searchLinkedInPosts(keyword);

    if (posts.length === 0) {
      console.log(`⚠️  No posts found for keyword "${keyword}". Skipping.`);
      await broadcastLog(`No posts found for keyword "${keyword}"`, 'warn');
      return {
        success: false,
        keyword,
        reason: 'No posts found on LinkedIn for this keyword'
      };
    }

    console.log(`✅ Found ${posts.length} posts`);

    // Step 2: Filter posts by reach criteria
    console.log(`\n📊 Filtering posts by reach criteria:`);
    console.log(`   Min Likes: ${settings.minLikes} | Max Likes: ${settings.maxLikes}`);
    console.log(`   Min Comments: ${settings.minComments} | Max Comments: ${settings.maxComments}`);

    const filteredPosts = filterPostsByReach(posts, settings);

    // Step 3: Select best post (closest to minimum reach)
    const selectedPost = selectBestPost(filteredPosts, posts, settings);

    if (!selectedPost) {
      console.log(`⚠️  No suitable post found after filtering. Skipping.`);
      await broadcastLog(`No posts matched reach criteria for "${keyword}"`, 'warn');
      return {
        success: false,
        keyword,
        reason: 'No posts matched the reach criteria'
      };
    }

    console.log(`\n✅ Selected Post:`);
    console.log(`   URL: ${selectedPost.url}`);
    console.log(`   Likes: ${selectedPost.likes} | Comments: ${selectedPost.comments}`);
    console.log(`   Distance from minimum: ${selectedPost.distance.toFixed(2)}`);

    // Step 4: Select random comment from keyword's comments
    const randomComment = comments[Math.floor(Math.random() * comments.length)];
    console.log(`\n💬 Selected Comment: "${randomComment.text.substring(0, 50)}..."`);

    // Step 5: Post comment and verify
    await broadcastLog(`Posting comment on selected post...`);
    const commentResult = await postAndVerifyComment(selectedPost.url, randomComment.text);

    if (!commentResult.success) {
      console.log(`❌ Failed to post comment: ${commentResult.reason}`);
      return {
        success: false,
        keyword,
        commentText: randomComment.text,
        postUrl: selectedPost.url,
        reason: commentResult.reason
      };
    }

    console.log(`\n✅ SUCCESS! Comment posted and verified`);
    console.log(`   Post URL: ${selectedPost.url}`);
    console.log(`   Comment URL: ${commentResult.commentUrl}`);

    // Update comment usage count
    await prisma.comment.update({
      where: { id: randomComment.id },
      data: { timesUsed: { increment: 1 } }
    });

    return {
      success: true,
      keyword,
      commentText: randomComment.text,
      postUrl: selectedPost.url,
      commentUrl: commentResult.commentUrl,
      selectedPost: {
        likes: selectedPost.likes,
        comments: selectedPost.comments
      }
    };

  } catch (error: any) {
    console.error(`❌ Error processing keyword "${keyword}":`, error);
    return {
      success: false,
      keyword,
      reason: error.message
    };
  }
}

// ============================================================================
// LINKEDIN AUTOMATION FUNCTIONS
// ============================================================================

async function searchLinkedInPosts(keyword: string): Promise<PostCandidate[]> {
  // Stability check: Ensure browser and page are healthy
  if (!browser || !page || page.isClosed()) {
    console.log('   ⚠️ Browser or page invalid for search. Re-initializing...');
    await recreateBrowserContext().catch(() => { });
    if (!page) throw new Error('Could not initialize page for search');
  }

  try {
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&sortBy=date_posted`;
    console.log(`\n🔍 Searching LinkedIn for: "${keyword}"`);
    console.log(`   Navigating to: ${searchUrl}`);

    // Navigate - 'commit' fires immediately when HTTP headers arrive, avoids hanging on slow pages
    await page.goto(searchUrl, { waitUntil: 'commit', timeout: 30000 }).catch(err => {
      if (err.message.includes('closed') || err.message.includes('context')) {
        throw new Error('BROWSER_CLOSED');
      }
      // Timeout or other nav error — page may still have partially loaded, continue anyway
      console.log(`   ⚠️ Navigation note: ${err.message.split('\n')[0]}`);
    });

    // Wait for the main results container to appear
    await page.waitForSelector('.reusable-search__result-container, .entity-result, [data-chameleon-result-urn]', { timeout: 20000 })
      .catch(() => console.log('   ⚠️ Result containers not found in 20s, attempting extraction anyway...'));

    await sleep(1000);

    // Scroll down to trigger lazy-loading of results
    console.log(`   Scrolling to load more results...`);
    for (let i = 0; i < 5; i++) {
      await page.evaluate('window.scrollBy(0, 1000)').catch(() => { });
      await sleep(1200);

      // Click "More results" button if present
      const moreBtn = await page.$('button.search-results-bottom-pagination__button, button[aria-label="See more results"]').catch(() => null);
      if (moreBtn) {
        console.log(`   [Scroll] Clicking "See more results"...`);
        await moreBtn.click().catch(() => { });
        await sleep(2000);
      }
    }

    // Capture state for diagnostics
    await broadcastScreenshot(page, `Search: ${keyword}`);

    // SUPER SCRAPER SCRIPT - Extremely resilient extraction
    const superScraper = `
      (function() {
        var results = [];
        var seenUrls = {};
        
        function parseNum(t) {
          if (!t) return 0;
          var c = t.toLowerCase().replace(/,/g, '').trim();
          var match = c.match(/([\\d\\.\\,]+)/);
          if (!match) return 0;
          var n = parseFloat(match[1].replace(/,/g, ''));
          if (c.indexOf('k') !== -1) n *= 1000;
          if (c.indexOf('m') !== -1) n *= 1000000;
          return Math.round(n);
        }

        // --- PHASE 1: Container-based extraction (The Best Way) ---
        var containers = Array.from(document.querySelectorAll('.reusable-search__result-container, .entity-result, [data-chameleon-result-urn], .search-results__cluster-item, .feed-shared-update-v2, [data-testid="update-card"]'));
        
        containers.forEach(function(container) {
          var link = container.querySelector('a[href*="/posts/"], a[href*="/feed/update/"], a[href*="activity"]');
          if (!link) {
            var allLinks = Array.from(container.querySelectorAll('a[href]'));
            link = allLinks.find(function(a) { 
               var h = a.getAttribute('href') || '';
               return h.includes('/posts/') || h.includes('/feed/update/') || h.includes('activity');
            });
          }
          if (!link) return;

          var href = link.getAttribute('href') || '';
          if (href.indexOf('http') !== 0) href = 'https://www.linkedin.com' + href;
          href = href.split('?')[0].split('&')[0];
          
          if (seenUrls[href]) return;
          seenUrls[href] = true;

          var likes = 0, comments = 0;
          var socialElements = Array.from(container.querySelectorAll('button, span[aria-label], .social-details-social-counts__item, .entity-result__content-summary'));
          socialElements.forEach(function(el) {
            var label = (el.getAttribute('aria-label') || '').toLowerCase();
            var text = (el.textContent || '').toLowerCase();
            if (label.indexOf('reaction') !== -1 || label.indexOf('like') !== -1 || text.indexOf('reaction') !== -1 || text.indexOf('like') !== -1) {
              likes = Math.max(likes, parseNum(label) || parseNum(text));
            }
            if (label.indexOf('comment') !== -1 || text.indexOf('comment') !== -1) {
              comments = Math.max(comments, parseNum(label) || parseNum(text));
            }
          });
          results.push({ url: href, likes: likes, comments: comments, method: 'container' });
        });

        // --- PHASE 2: Link-based Fallback (If containers fail) ---
        if (results.length === 0) {
          var allLinks = Array.from(document.querySelectorAll('a[href*="/posts/"], a[href*="/feed/update/"], a[href*="activity"]'));
          allLinks.forEach(function(link) {
            var href = link.getAttribute('href') || '';
            if (href.indexOf('http') !== 0) href = 'https://www.linkedin.com' + href;
            href = href.split('?')[0].split('&')[0];
            if (seenUrls[href]) return;
            seenUrls[href] = true;

            // Try to find engagement by going up to a common parent
            var parent = link;
            for (var i = 0; i < 8; i++) {
              if (!parent.parentElement) break;
              parent = parent.parentElement;
              if (parent.tagName === 'LI' || parent.tagName === 'ARTICLE' || parent.classList.contains('entity-result')) break;
            }
            
            var l = 0, c = 0;
            var text = parent.innerText || '';
            var rMatch = text.match(/([\\d\\.\\,km]+)\\s*(reaction|like)/i);
            if (rMatch) l = parseNum(rMatch[1]);
            var cMatch = text.match(/([\\d\\.\\,km]+)\\s*comment/i);
            if (cMatch) c = parseNum(cMatch[1]);
            
            results.push({ url: href, likes: l, comments: c, method: 'link-fallback' });
          });
        }

        window.__scraperDiagnostics = {
          containerCount: containers.length,
          totalExtracted: results.length,
          pageTitle: document.title,
          noResultsFound: !!document.querySelector('.search-relevance-no-results, .artdeco-empty-state')
        };

        return results;
      })()
    `;

    const rawPosts: any[] = await page.evaluate(superScraper).catch(err => {
      console.log(`   ❌ Scraper script error: ${err.message}`);
      return [];
    });

    const diag: any = await page.evaluate('window.__scraperDiagnostics').catch(() => ({}));

    console.log(`\n📊 Scraper Metrics:`);
    console.log(`   Containers detected: ${diag.containerCount || 0}`);
    console.log(`   Posts extracted: ${diag.totalExtracted || 0}`);
    if (diag.noResultsFound) console.log(`   ⚠️ LinkedIn reports: "No results found"`);

    if (rawPosts.length > 0) {
      console.log(`   Sample matching posts:`);
      rawPosts.slice(0, 5).forEach((p, i) => {
        console.log(`      [${i + 1}] 👍 ${p.likes} | 💬 ${p.comments} | ${p.url} (${p.method})`);
      });
    } else {
      console.log(`   ⚠️ No posts found for this keyword.`);
      // Check for CAPTCHA
      const hasCaptcha = await page.evaluate('document.body.innerText.includes("CAPTCHA") || !!document.querySelector("iframe[src*=\'captcha\']")');
      if (hasCaptcha) console.log(`   🚨 CAPTCHA detected! Automation blocked.`);
    }

    return rawPosts.map(p => ({ ...p, distance: 0 }));

  } catch (error: any) {
    if (error.message === 'BROWSER_CLOSED' || error.message.includes('Target closed') || error.message.includes('context was destroyed')) {
      console.error(`   ❌ Browser context failed. Attempting recovery...`);
      await recreateBrowserContext().catch(() => { });
      return [];
    }
    console.error(`   ❌ Search error:`, error.message);
    return [];
  }
}

async function postAndVerifyComment(postUrl: string, commentText: string): Promise<{ success: boolean; commentUrl?: string; reason?: string }> {
  if (!page) throw new Error('Browser page not initialized');

  try {
    console.log(`\n📝 Posting comment to: ${postUrl}`);

    // Navigate to post
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    await broadcastScreenshot(page, 'Navigated to post');

    // Click comment button
    const commentButton = await page.$('button[aria-label*="Comment"]');
    if (!commentButton) {
      return { success: false, reason: 'Comment button not found' };
    }

    await commentButton.click();
    await sleep(1000);

    // Wait for comment editor
    const editorSelector = 'div.ql-editor[contenteditable="true"]';
    await page.waitForSelector(editorSelector, { timeout: 10000 });

    const editor = await page.$(editorSelector);
    if (!editor) {
      return { success: false, reason: 'Comment editor not found' };
    }

    // Type comment (character by character for visibility)
    console.log(`   Typing comment...`);
    await editor.click();
    await page.keyboard.type(commentText, { delay: 50 }); // 50ms delay between characters
    await sleep(1000);

    await broadcastScreenshot(page, 'Comment typed');

    // Submit comment
    const submitButton = await page.$('button.comments-comment-box__submit-button:not([disabled])');
    if (!submitButton) {
      return { success: false, reason: 'Submit button not found or disabled' };
    }

    console.log(`   Submitting comment...`);
    await submitButton.click();
    await sleep(3000); // Wait for LinkedIn to process

    await broadcastScreenshot(page, 'Comment submitted');

    // Verify comment appears in DOM
    console.log(`   Verifying comment in DOM...`);
    const verificationResult = await verifyCommentInDOM(commentText);

    if (!verificationResult.found) {
      return { success: false, reason: 'Comment not found in DOM after submission' };
    }

    console.log(`   ✅ Comment verified in DOM!`);

    // Extract comment URL (permalink)
    const commentUrl = await extractCommentUrl(commentText);

    return {
      success: true,
      commentUrl: commentUrl || postUrl // Fallback to post URL if permalink not found
    };

  } catch (error: any) {
    console.error(`   ❌ Error posting comment:`, error.message);
    return { success: false, reason: error.message };
  }
}

async function verifyCommentInDOM(commentText: string): Promise<{ found: boolean }> {
  if (!page) return { found: false };

  try {
    const startTime = Date.now();
    const maxWaitTime = 15000; // Wait up to 15 seconds for comment to appear dynamically

    while (Date.now() - startTime < maxWaitTime) {
      // Small interval between polls
      await sleep(1000);

      const commentElements = await page.$$('div.comments-comment-item');

      for (const commentElement of commentElements) {
        const text = await commentElement.textContent();
        if (text && text.includes(commentText)) {
          return { found: true };
        }
      }
    }

    return { found: false };
  } catch (error) {
    return { found: false };
  }
}

async function extractCommentUrl(commentText: string): Promise<string | null> {
  if (!page) return null;

  try {
    // Find comment element
    const commentElements = await page.$$('div.comments-comment-item');

    for (const commentElement of commentElements) {
      const text = await commentElement.textContent();
      if (text && text.includes(commentText)) {
        // Look for permalink button
        const permalinkButton = await commentElement.$('button[aria-label*="permalink"]');
        if (permalinkButton) {
          const href = await permalinkButton.getAttribute('data-link');
          if (href) return href;
        }
      }
    }

    return null;

  } catch (error) {
    return null;
  }
}

// ============================================================================
// POST FILTERING & SELECTION
// ============================================================================

function filterPostsByReach(posts: PostCandidate[], settings: WorkerSettings): PostCandidate[] {
  return posts.filter(post => {
    const likesMatch = post.likes >= settings.minLikes && post.likes <= settings.maxLikes;
    const commentsMatch = post.comments >= settings.minComments && post.comments <= settings.maxComments;
    return likesMatch && commentsMatch;
  });
}

function selectBestPost(
  filteredPosts: PostCandidate[],
  allPosts: PostCandidate[],
  settings: WorkerSettings
): PostCandidate | null {
  // We strictly need to pick from filtered posts as they are already within Min and Max.
  // If no filtered posts exist, return null.
  if (filteredPosts.length === 0) {
    console.log(`   ⚠️  No posts matched reach criteria. (Found ${allPosts.length} total, but none within ${settings.minLikes}-${settings.maxLikes} likes & ${settings.minComments}-${settings.maxComments} comments)`);
    if (allPosts.length > 0) {
      const bestCandidate = allPosts.sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))[0];
      console.log(`      Best post found had 👍 ${bestCandidate.likes} | 💬 ${bestCandidate.comments}`);
    }
    return null;
  }

  const targetLikes = settings.minLikes;
  const targetComments = settings.minComments;

  // Calculate strict distance from the absolute minimums.
  // Formula: (likes - minLikes) + (comments - minComments) safely prioritizing closest above minimum threshold
  const scoredPosts = filteredPosts.map(post => {
    // Both of these are guaranteed > 0 due to filteredPosts check
    const diffLikes = post.likes - targetLikes;
    const diffComments = post.comments - targetComments;
    const distanceScore = diffLikes + diffComments;
    return { ...post, distance: distanceScore };
  });

  // Sort by lowest distance score (closest to our baseline)
  scoredPosts.sort((a, b) => a.distance - b.distance);

  // The very top result is the post right above our threshold that matched Min/Max rules.
  const bestTargetPost = scoredPosts[0];

  console.log(`   ✅ Selected post closest to target limits. Distance from combined minimum: +${bestTargetPost.distance}`);
  return bestTargetPost;
}

// ============================================================================
// BROWSER MANAGEMENT
// ============================================================================

async function initializeBrowser() {
  console.log('🌐 Initializing browser (headed mode)...');

  browser = await chromium.launch({
    headless: false, // VISIBLE BROWSER
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  // Create fresh browser context with isolated storage
  await createFreshContext();

  isRunning = true;
  console.log('✅ Browser initialized\n');
}

/**
 * Create a completely fresh browser context
 * Each context has isolated cookies, localStorage, sessionStorage
 * IMPORTANT: closes previous context first to avoid tab leaks
 */
async function createFreshContext() {
  if (!browser) throw new Error('Browser not initialized');

  // Close ALL existing contexts first to prevent tab leaks
  const existingContexts = browser.contexts();
  for (const ctx of existingContexts) {
    await ctx.close().catch(() => { });
  }
  page = null;

  console.log('🆕 Creating fresh browser context (isolated session)...');

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    storageState: undefined,
    permissions: [],
  });

  // Remove automation flags
  await context.addInitScript('Object.defineProperty(navigator, "webdriver", { get: () => false })');

  // Dismiss any dialog popups automatically
  context.on('page', newPage => {
    newPage.on('dialog', dialog => dialog.dismiss().catch(() => { }));
  });

  page = await context.newPage();

  // Dismiss dialogs on main page too
  page.on('dialog', dialog => dialog.dismiss().catch(() => { }));

  console.log('✅ Fresh context created (clean cookies, storage, and session)\n');
}

/**
 * Recreate browser context when user/session changes or recovery is needed
 * This ensures complete isolation between different users
 */
async function recreateBrowserContext() {
  console.log('🔄 Recreating browser context for isolation or recovery...');

  // Reset authentication state
  isAuthenticated = false;

  // Safely close old resources
  try {
    if (page) {
      const oldContext = page.context();
      await page.close().catch(() => { });
      await oldContext.close().catch(() => { });
      page = null;
    }
  } catch (e) {
    // Ignore context closure errors
  }

  // Use a short delay to let browser settle
  await sleep(1000);

  // Create completely fresh context
  await createFreshContext();

  console.log('✅ Browser context recreated successfully\n');
}

async function authenticateLinkedIn(sessionCookie: string): Promise<boolean> {
  if (!page) return false;

  try {
    console.log('🔐 Authenticating LinkedIn session...');
    console.log(`   Cookie: ${sessionCookie.slice(0, 20)}...${sessionCookie.slice(-10)}`);

    // Validate cookie format
    if (!sessionCookie || sessionCookie.trim() === '') {
      console.log('❌ Invalid cookie: empty or missing\n');
      return false;
    }

    // Clear any existing cookies first (ensure clean state)
    await page.context().clearCookies();
    console.log('   Cleared existing cookies');

    // Set fresh session cookie
    await page.context().addCookies([{
      name: 'li_at',
      value: sessionCookie,
      domain: '.linkedin.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    }]);
    console.log('   Set new LinkedIn session cookie');

    // Navigate to LinkedIn to verify session
    console.log('   Navigating to LinkedIn feed...');
    try {
      await page.goto('https://www.linkedin.com/feed', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      console.log('   Waiting for page elements to stabilize...');
      // Wait for either the global nav (logged in) or the login form (failed)
      await Promise.race([
        page.waitForSelector('#global-nav', { timeout: 10000 }).catch(() => null),
        page.waitForSelector('.global-nav', { timeout: 10000 }).catch(() => null),
        page.waitForSelector('[aria-label="Primary Navigation"]', { timeout: 10000 }).catch(() => null),
        page.waitForSelector('input[name="session_key"]', { timeout: 10000 }).catch(() => null),
        page.waitForSelector('div.feed-shared-update-v2', { timeout: 10000 }).catch(() => null)
      ]);

      // Explicit short sleep to allow dynamic content (like session fragments) to settle
      await sleep(3000);
    } catch (e: any) {
      console.log(`   ⚠️  Navigation warning: ${e.message}`);
    }

    // Check current state
    const currentUrl = page.url();
    const hasGlobalNav = await page.$('#global-nav') !== null || await page.$('.global-nav') !== null;
    const hasPrimaryNav = await page.$('[aria-label="Primary Navigation"]') !== null;
    const hasFeedPosts = await page.$('div.feed-shared-update-v2') !== null;
    const hasStartPost = await page.$('button[aria-label*="Start a post"]') !== null;
    const isFeedUrl = currentUrl.includes('/feed');
    const onLoginPage = await page.$('input[name="session_key"]') !== null || currentUrl.includes('/login');

    // Robust login determination: 
    // 1. If we are on /feed and NOT on a login page, we are very likely logged in regardless of specific selectors
    // 2. OR if any major logged-in selectors are present
    const isLoggedIn = (isFeedUrl && !onLoginPage) || hasGlobalNav || hasPrimaryNav || hasFeedPosts || hasStartPost;

    if (isLoggedIn) {
      console.log('✅ LinkedIn authentication successful\n');
      console.log(`   Detected via: ${isFeedUrl ? 'Feed URL' : ''} ${hasGlobalNav ? '+ Global Nav' : ''} ${hasPrimaryNav ? '+ Primary Nav' : ''}`);
      await broadcastScreenshot(page, 'Authenticated on LinkedIn');
      return true;
    } else {
      console.log('❌ LinkedIn authentication failed (not logged in)\n');
      console.log(`   Current URL: ${currentUrl}`);

      // Take screenshot for debugging
      await broadcastScreenshot(page, 'Authentication failed');

      // Detailed failure reason
      if (onLoginPage) {
        console.log('   Reason: Redirected to login page (invalid/expired cookie)');
      } else if (currentUrl.includes('/checkpoint')) {
        console.log('   Reason: Security checkpoint detected (e.g. Email/SMS verification needed)');
      } else {
        console.log('   Reason: Unknown navigation state (check the diagnostic screenshot)');
      }

      return false;
    }

  } catch (error: any) {
    console.error('❌ Authentication error:', error.message);

    // Provide helpful error messages
    if (error.message.includes('ERR_TOO_MANY_REDIRECTS')) {
      console.log('   Reason: Too many redirects (likely invalid/expired cookie)');
    } else if (error.message.includes('Timeout')) {
      console.log('   Reason: LinkedIn took too long to respond');
    }

    return false;
  }
}

async function cleanup() {
  console.log('\n🧹 Cleaning up...');

  if (page) {
    await page.close().catch(() => { });
    page = null;
  }

  if (browser) {
    await browser.close().catch(() => { });
    browser = null;
  }

  await prisma.$disconnect();

  console.log('✅ Cleanup complete\n');
}

// ============================================================================
// DATABASE FUNCTIONS
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
    systemActive: settings.systemActive
  };
}

async function getActiveKeywords(userId: string): Promise<KeywordData[]> {
  const keywords = await prisma.keyword.findMany({
    where: {
      userId,
      active: true
    },
    include: {
      comments: {
        where: {
          userId // Only get comments belonging to same user
        }
      }
    }
  });

  return keywords.map(k => ({
    id: k.id,
    keyword: k.keyword,
    comments: k.comments.map(c => ({
      id: c.id,
      text: c.text
    }))
  }));
}

async function isSystemStillActive(userId: string): Promise<boolean> {
  const settings = await prisma.settings.findUnique({
    where: { userId }
  });

  return settings?.systemActive || false;
}

async function logResult(result: ProcessingResult, userId: string) {
  try {
    await prisma.log.create({
      data: {
        userId,
        action: result.success ? 'COMMENT_POSTED' : 'FAILED',
        postUrl: result.postUrl || 'N/A',
        comment: result.commentText || null,
        commentUrl: result.commentUrl || null
      }
    });
  } catch (error) {
    console.error('Failed to log result:', error);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseEngagementNumber(text: string): number {
  const cleaned = text.replace(/,/g, '').trim();
  const match = cleaned.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on('SIGTERM', async () => {
  console.log('\n⚠️  SIGTERM received. Shutting down gracefully...');
  isRunning = false;
  await cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n⚠️  SIGINT received. Shutting down gracefully...');
  isRunning = false;
  await cleanup();
  process.exit(0);
});

// ============================================================================
// START WORKER
// ============================================================================

main().catch(async (error) => {
  console.error('❌ Fatal error:', error);
  await cleanup();
  process.exit(1);
});
